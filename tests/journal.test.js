import assert from "node:assert/strict";
import { test } from "node:test";
import { CSV_FIELDS, JOURNAL_SOURCE, deadlineClose, emptyJournal, evaluatePrediction, exchangeDate,
  exportJournal, hasJournalStock, importJournal, mergeJournals, newPrediction, outcome, parseCSV, predictionProgress, validDeadline, validateJournal } from "../lib/journal.js";
import { getJournalMarket } from "../lib/yahoo.js";
import { journalTransaction } from "../lib/journal-storage.js";
import { ALERT_INTERVAL_MS, ALERT_LEASE_MS, alertCandidates, claimAlertCheck, emptyAlerts,
  targetReached, validateAlerts } from "../lib/price-alerts.js";
import { checkPriceAlerts } from "../lib/price-alert-monitor.js";

const now = Date.parse("2026-10-19T10:00:00+05:30");
const quote = { price: 100, at: new Date(now - 60000).toISOString() };
function prediction(overrides = {}) {
  return newPrediction({
    id: "p1", bucketId: "b1", symbol: "TCS", direction: "up", targetPercent: "",
    deadline: "2026-10-20", reason: "A reason", confidence: "", ...overrides,
  }, quote, now);
}
function journal(p = prediction()) {
  return { version: 1, buckets: [{ id: "b1", name: "Study", createdAt: new Date(now).toISOString() }],
    stocks: [{ id: "s1", bucketId: "b1", symbol: "TCS", createdAt: new Date(now).toISOString() }],
    predictions: [p] };
}
const closeTime = Date.parse("2026-10-20T18:00:00+05:30");
const market = (price) => ({ quote: { price, at: new Date(deadlineClose("2026-10-20")).toISOString() },
  rows: [{ t: Date.parse("2026-10-20T09:15:00+05:30") / 1000, c: price }], splits: [] });

test("alerts opt in and claim only one check per 30 minutes across tabs", () => {
  const disabled = emptyAlerts();
  assert.equal(claimAlertCheck(disabled, "tab1", now), disabled);
  const enabled = { ...disabled, enabled: true };
  const claimed = claimAlertCheck(enabled, "tab1", now);
  assert.equal(ALERT_INTERVAL_MS, 30 * 60000);
  assert.equal(claimed.owner, "tab1");
  assert.equal(claimed.leaseUntil, now + ALERT_LEASE_MS);
  assert.equal(claimAlertCheck(claimed, "tab2", now + 1000), claimed);
  assert.equal(claimAlertCheck(claimed, "tab2", now + ALERT_LEASE_MS).owner, "tab2");
  const checked = { ...enabled, lastChecked: now };
  assert.equal(claimAlertCheck(checked, "tab2", now + ALERT_INTERVAL_MS - 1), checked);
  assert.equal(claimAlertCheck(checked, "tab2", now + ALERT_INTERVAL_MS).owner, "tab2");
  assert.throws(() => validateAlerts({ ...enabled, sent: [] }), /Invalid local/);
  assert.throws(() => validateAlerts({ ...enabled, lastChecked: NaN }), /Invalid local/);
  assert.equal(validateAlerts(enabled), enabled);
});

test("target notifications require pending targets, fresh post-creation quotes, and respect deadlines", () => {
  const up = prediction({ targetPercent: "5" });
  const down = prediction({ direction: "down", targetPercent: "5" });
  const checkedAt = now + 60000;
  const observation = (price, at = checkedAt) => ({ quote: { price, at: new Date(at).toISOString() }, splits: [] });
  assert.equal(targetReached(up, observation(105), checkedAt), true);
  assert.equal(targetReached(up, observation(104), checkedAt), false);
  assert.equal(targetReached(down, observation(95), checkedAt), true);
  assert.equal(targetReached(down, observation(96), checkedAt), false);
  assert.equal(targetReached(down, observation(106), checkedAt), false);
  assert.equal(targetReached(up, observation(100), checkedAt), false);
  assert.equal(targetReached(up, observation(105, now - 1), checkedAt), false);
  assert.equal(targetReached(up, observation(105, checkedAt + 1), checkedAt), false);
  assert.equal(targetReached(up, observation(105), checkedAt + ALERT_INTERVAL_MS + 1), false);
  assert.equal(targetReached(up, { quote: null }, checkedAt), false);
  assert.equal(targetReached(up, observation(NaN), checkedAt), false);
  assert.equal(targetReached(prediction(), observation(110), checkedAt), false);
  assert.equal(targetReached({ ...up, status: "cancelled" }, observation(110), checkedAt), false);
  assert.equal(targetReached({ ...up, status: "completed" }, observation(110), checkedAt), false);
  assert.equal(targetReached(up, observation(110), deadlineClose(up.deadline) + 1), false);
  assert.equal(targetReached(up, { ...observation(110), splits: [{ t: checkedAt / 1000 }] }, checkedAt), false);
  assert.deepEqual(alertCandidates([up, prediction(), { ...up, id: "cancelled", status: "cancelled" }], {}, checkedAt), [up]);
  assert.deepEqual(alertCandidates([up], { [up.id]: checkedAt }, checkedAt), []);
  assert.equal(up.status, "pending");
  assert.equal(up.evaluation, null);
});

function alertHarness(predictions = [prediction({ targetPercent: "5" })]) {
  let state = { ...emptyAlerts(), enabled: true };
  let saved = { ...journal(), predictions };
  let clock = now + 60000;
  const notified = [], requests = [];
  const adapters = {
    owner: "tab1", now: () => clock, active: () => true,
    settings: async (update) => {
      if (update) state = validateAlerts(update(structuredClone(state)));
      return structuredClone(state);
    },
    journal: async (update) => {
      if (update) saved = validateJournal(update(structuredClone(saved)));
      return structuredClone(saved);
    },
    fetchMarket: async (symbol, from) => {
      requests.push({ symbol, from });
      return { quote: { price: 105, at: new Date(clock).toISOString() }, splits: [] };
    },
    notify: (p, q) => notified.push({ id: p.id, quote: q }),
  };
  return { adapters, notified, requests, get state() { return state; }, get saved() { return saved; },
    advance: () => { clock += ALERT_INTERVAL_MS; } };
}

test("alert checks fetch each eligible symbol once, persist quotes, deduplicate, and preserve final evidence", async () => {
  const pending = prediction({ targetPercent: "5" });
  const second = { ...pending, id: "p2" };
  const completed = evaluatePrediction({ ...pending, id: "done" }, market(105), closeTime).prediction;
  const h = alertHarness([pending, second, completed]);
  await checkPriceAlerts(h.adapters);
  assert.deepEqual(h.requests, [{ symbol: "TCS", from: Date.parse(pending.referenceAt) }]);
  assert.deepEqual(h.notified.map((n) => n.id), ["p1", "p2"]);
  assert.equal(h.saved.predictions[0].latest.price, 105);
  assert.equal(h.saved.predictions[0].status, "pending");
  assert.deepEqual(h.saved.predictions[2].evaluation, completed.evaluation);
  assert.equal(h.state.owner, null);
  assert.equal(h.state.leaseUntil, 0);
  assert.equal(h.state.error, "");
  await checkPriceAlerts(h.adapters);
  assert.equal(h.requests.length, 1);
  h.advance();
  await checkPriceAlerts(h.adapters);
  assert.equal(h.requests.length, 1);
  assert.equal(h.notified.length, 2);
  await h.adapters.settings((s) => ({ ...s, enabled: false, lastChecked: 0 }));
  await checkPriceAlerts(h.adapters);
  assert.equal(h.requests.length, 1);
});

test("notification failures are visible, release reservations and leases, and retry at the next interval", async () => {
  const h = alertHarness();
  await checkPriceAlerts({ ...h.adapters, notify: () => { throw new Error("Notifications unsupported"); } });
  assert.match(h.state.error, /TCS: Notifications unsupported/);
  assert.deepEqual(h.state.sent, {});
  assert.equal(h.state.owner, null);
  h.advance();
  await checkPriceAlerts(h.adapters);
  assert.equal(h.notified.length, 1);
  assert.equal(h.state.error, "");
  const failed = alertHarness();
  await checkPriceAlerts({ ...failed.adapters, fetchMarket: async () => { throw new Error("Provider unavailable"); } });
  assert.match(failed.state.error, /Provider unavailable/);
  assert.deepEqual(failed.state.sent, {});
  assert.equal(failed.state.owner, null);
});

test("newly imported predictions wait for a check covering their own reference history", async () => {
  const h = alertHarness();
  await checkPriceAlerts({ ...h.adapters, fetchMarket: async (...args) => {
    await h.adapters.journal((data) => ({ ...data, predictions: [...data.predictions,
      { ...prediction({ targetPercent: "5" }), id: "imported", referenceAt: new Date(now - 86400000).toISOString() }] }));
    return h.adapters.fetchMarket(...args);
  } });
  assert.deepEqual(h.notified.map((item) => item.id), ["p1"]);
  h.advance();
  await checkPriceAlerts(h.adapters);
  assert.equal(h.requests[1].from, now - 86400000);
  assert.deepEqual(h.notified.map((item) => item.id), ["p1", "imported"]);
});

test("checks stop on abort, ownership loss, or opt-out during a fetch, without notifying", async () => {
  const inactive = alertHarness();
  await checkPriceAlerts({ ...inactive.adapters, active: () => false });
  assert.equal(inactive.state.owner, null);
  assert.equal(inactive.requests.length, 0);
  const aborted = alertHarness();
  let active = true;
  await checkPriceAlerts({ ...aborted.adapters, active: () => active, fetchMarket: async (...args) => {
    active = false;
    return aborted.adapters.fetchMarket(...args);
  } });
  assert.equal(aborted.notified.length, 0);
  assert.equal(aborted.state.owner, null);
  assert.equal(aborted.state.lastChecked, 0);
  for (const enabled of [true, false]) {
    const h = alertHarness();
    await checkPriceAlerts({ ...h.adapters, fetchMarket: async (...args) => {
      await h.adapters.settings((s) => ({ ...s, enabled, owner: "another-tab" }));
      return h.adapters.fetchMarket(...args);
    } });
    assert.equal(h.notified.length, 0);
    assert.deepEqual(h.state.sent, {});
    assert.equal(h.state.owner, "another-tab");
  }
});

test("prediction terms validate future India weekdays, quote freshness, targets and confidence", () => {
  assert.equal(exchangeDate("2026-10-19T20:00:00Z"), "2026-10-20");
  assert.equal(validDeadline("2026-02-30"), false);
  assert.equal(validDeadline("2026-10-18"), false);
  assert.equal(validDeadline("2026-10-19"), true);
  assert.throws(() => prediction({ deadline: "2026-10-18" }), /future weekday/);
  assert.throws(() => prediction({ deadline: "2026-10-16" }), /future weekday/);
  assert.throws(() => prediction({ targetPercent: "-5" }), /Invalid prediction/);
  assert.throws(() => prediction({ targetPercent: "100", direction: "down" }), /Invalid prediction/);
  assert.throws(() => prediction({ confidence: "101" }), /Invalid prediction/);
  assert.throws(() => prediction({ confidence: "NaN" }), /Invalid prediction/);
  assert.throws(() => newPrediction({}, { price: 0, at: quote.at }, now), /timestamped/);
  assert.throws(() => newPrediction({}, { price: 10, at: new Date(now + 1000).toISOString() }, now), /future timestamp/);
  assert.throws(() => newPrediction({}, { price: 10, at: new Date(now - 8 * 86400000).toISOString() }, now), /older/);
  assert.equal(prediction({ confidence: "0" }).confidence, 0);
  assert.equal(prediction().targetPercent, null);
  assert.equal(prediction({ deadline: "2026-10-19" }).deadline, "2026-10-19");
});

test("direction and targets handle up, down, unchanged, exact thresholds and target misses", () => {
  const up = prediction(), down = prediction({ direction: "down" });
  assert.equal(outcome(up, 101).result, "correct");
  assert.equal(outcome(up, 99).result, "incorrect");
  assert.equal(outcome(up, 100).result, "unchanged");
  assert.equal(outcome(down, 99).result, "correct");
  assert.equal(outcome(down, 101).result, "incorrect");
  assert.equal(outcome(prediction({ targetPercent: "5" }), 105).result, "target achieved");
  assert.equal(outcome(prediction({ targetPercent: "5" }), 104).result, "direction correct, target missed");
  assert.equal(outcome(prediction({ direction: "down", targetPercent: "5" }), 95).result, "target achieved");
  assert.equal(outcome(prediction({ direction: "down", targetPercent: "5" }), 96).directionCorrect, true);
});

test("deadline-close checks do not use provisional bars, adjacent days or stale latest quotes", () => {
  const p = prediction();
  const before = evaluatePrediction(p, market(105), closeTime - 1);
  assert.equal(before.prediction.status, "pending");
  const result = evaluatePrediction(p, market(105), closeTime);
  assert.equal(result.prediction.status, "completed");
  assert.equal(result.prediction.evaluation.result, "correct");
  assert.equal(result.prediction.evaluation.at, new Date(deadlineClose(p.deadline)).toISOString());
  assert.equal(result.prediction.evaluation.source, JOURNAL_SOURCE);
  assert.equal(p.status, "pending");
  validateJournal(journal(result.prediction));
  assert.equal(evaluatePrediction(result.prediction, market(1), closeTime).prediction, result.prediction);
  const cancelled = { ...p, status: "cancelled" };
  assert.equal(evaluatePrediction(cancelled, market(105), closeTime).prediction, cancelled);
  const missing = evaluatePrediction(p, { quote: null, rows: [{ t: Date.parse("2026-10-21T09:15:00+05:30") / 1000, c: 105 }] }, closeTime);
  assert.equal(missing.prediction.status, "pending");
  assert.match(missing.message, /Awaiting deadline data/);
  assert.equal(evaluatePrediction(p, { quote: { price: 20, at: "2026-10-01T10:00:00Z" } }, closeTime).prediction.latest, null);
  const split = evaluatePrediction(p, { ...market(50), splits: [{ t: Date.parse("2026-10-21T09:15:00+05:30") / 1000 }] }, closeTime + 86400000);
  assert.equal(split.prediction.status, "pending");
  assert.match(split.message, /stock split/);
});

test("current progress shows rupee and percentage movement relative to the prediction direction and target", () => {
  const p = prediction();
  const progress = (terms, price) => predictionProgress(terms, { price, at: quote.at }, now);
  assert.equal(progress(p, 105).change, 5);
  assert.ok(Math.abs(progress(p, 105).movement - 5) < 1e-9);
  assert.equal(progress(p, 105).label, "In your direction");
  assert.equal(progress(p, 95).label, "Against your direction");
  assert.equal(progress(prediction({ direction: "down" }), 95).tone, "positive");
  assert.equal(progress(prediction({ direction: "down" }), 105).tone, "negative");
  assert.equal(progress(p, 100).label, "Unchanged");
  assert.equal(progress(p, 100).tone, "muted");
  assert.equal(progress(prediction({ targetPercent: "5" }), 105).label, "At target now");
  assert.equal(progress(prediction({ targetPercent: "5" }), 102).label, "In your direction; target not met");
  assert.equal(progress(prediction({ direction: "down", targetPercent: "5" }), 95).label, "At target now");
  assert.equal(p.status, "pending");
});

test("current quote selection rejects invalid observations and never substitutes the final deadline close", () => {
  const p = prediction();
  assert.equal(predictionProgress(p, null, now), null);
  assert.equal(predictionProgress(p, { price: 0, at: quote.at }, now), null);
  assert.equal(predictionProgress(p, { price: 110, at: "invalid" }, now), null);
  assert.equal(predictionProgress(p, { price: 110, at: new Date(now + 1000).toISOString() }, now), null);
  assert.equal(predictionProgress(p, { price: 110, at: new Date(now - 120000).toISOString() }, now), null);
  const saved = { price: 102, at: new Date(now).toISOString() };
  const withLatest = { ...p, latest: saved };
  assert.deepEqual(predictionProgress(withLatest, { price: 101, at: quote.at }, now).quote, saved);
  const completed = evaluatePrediction(p, market(105), closeTime).prediction;
  const original = structuredClone(completed.evaluation);
  const current = predictionProgress(completed, { price: 90, at: new Date(closeTime + 1000).toISOString() }, closeTime + 2000);
  assert.equal(current.label, "Against your direction");
  assert.equal(current.change, -10);
  assert.deepEqual(completed.evaluation, original);
  assert.equal(completed.evaluation.result, "correct");
  assert.equal(predictionProgress({ ...completed, latest: null }, null, closeTime), null);
});

test("CSV round trips all entities, quoted/newline notes, Unicode, formulas, evaluations and apostrophes", () => {
  const completed = evaluatePrediction(prediction({ targetPercent: "5", confidence: "70" }), market(105), closeTime).prediction;
  completed.reason = '=SUM(1,2)\n"Study", M&M \u20b9';
  completed.reflection = "'Original note\r\nSecond line";
  const data = journal(completed);
  data.buckets[0].name = "@Study";
  const csv = exportJournal(data);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("'=SUM"));
  assert.ok(csv.includes("'@Study"));
  assert.deepEqual(importJournal(csv), data);
  assert.deepEqual(importJournal(exportJournal(emptyJournal())), emptyJournal());
  assert.deepEqual(mergeJournals(data, importJournal(csv)), data);
  const cancelled = journal({ ...prediction(), status: "cancelled" });
  assert.deepEqual(importJournal(exportJournal(cancelled)), cancelled);
});

test("CSV validation rejects malformed or inconsistent backups and merges atomically", () => {
  assert.throws(() => parseCSV('a,"unterminated'), /Unclosed/);
  assert.throws(() => parseCSV('"closed"junk'), /Malformed/);
  assert.throws(() => importJournal("wrong,headers"), /column headers/);
  assert.throws(() => importJournal(CSV_FIELDS.join(",") + "\nwrong,row"), /number of columns/);
  assert.throws(() => parseCSV("a".repeat(5 * 1024 * 1024 + 1)), /5 MB/);
  const current = journal();
  const incoming = structuredClone(current);
  incoming.predictions[0].referencePrice = 99;
  assert.throws(() => mergeJournals(current, incoming), /Import conflict/);
  assert.equal(current.predictions[0].referencePrice, 100);
  const missingBucket = structuredClone(current);
  missingBucket.buckets = [];
  assert.throws(() => validateJournal(missingBucket), /membership|missing bucket/);
  const duplicate = structuredClone(current);
  duplicate.stocks.push({ ...duplicate.stocks[0], id: "s2" });
  assert.throws(() => validateJournal(duplicate), /duplicate watchlist/);
  const corrupted = evaluatePrediction(prediction(), market(105), closeTime).prediction;
  corrupted.evaluation.result = "incorrect";
  assert.throws(() => validateJournal(journal(corrupted)), /does not match/);
  const other = journal(prediction({ id: "p2" }));
  assert.equal(mergeJournals(current, other).predictions.length, 2);
});

test("screener membership detects watched stocks and retained prediction history across buckets", () => {
  assert.equal(hasJournalStock(null, "TCS"), false);
  assert.equal(hasJournalStock(emptyJournal(), "TCS"), false);
  const state = journal();
  assert.equal(hasJournalStock(state, "TCS"), true);
  assert.equal(hasJournalStock(state, "INFY"), false);
  state.stocks = [];
  assert.equal(hasJournalStock(state, "TCS"), true);
  state.predictions = [];
  assert.equal(hasJournalStock(state, "TCS"), false);
  state.stocks = [{ symbol: "INFY", bucketId: "another-bucket" }];
  assert.equal(hasJournalStock(state, "INFY"), true);
});

test("local journal reports unavailable browser storage rather than silently using temporary memory", async () => {
  await assert.rejects(journalTransaction(), /IndexedDB is unavailable/);
});

test("journal market requests only one symbol and exposes timestamped quote, daily closes and splits", async (t) => {
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => {
    requested = url;
    return Response.json({ chart: { result: [{
      meta: { regularMarketPrice: 105, regularMarketTime: Math.floor(now / 1000) },
      timestamp: [Math.floor(now / 1000)],
      indicators: { quote: [{ close: [104] }] },
      events: { splits: { one: { date: Math.floor(now / 1000) } } },
    }] } });
  });
  const response = await getJournalMarket("M&M", 100, 200);
  assert.match(requested, /M%26M\.NS/);
  assert.match(requested, /period1=100&period2=200&events=splits&interval=1d/);
  assert.equal(response.quote.price, 105);
  assert.equal(response.quote.at, new Date(now).toISOString());
  assert.equal(response.rows[0].c, 104);
  assert.equal(response.splits.length, 1);
});
