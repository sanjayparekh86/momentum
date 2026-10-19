import assert from "node:assert/strict";
import { test } from "node:test";
import { getUniverse, parseSymbols, parseEquities, searchEquities } from "../lib/symbols.js";
import { getDaily, getNews } from "../lib/yahoo.js";
import { scanStocks, withAllTime, getScanProgress, SCAN_TTL_MS, SCAN_CONCURRENCY } from "../lib/screener.js";
import { getStockDetails } from "../lib/stock.js";
import { selectMovers, sortsAscending, matchesMove } from "../lib/table.js";
import { analyze, adviceVerdict, signalFor } from "../lib/verdict.js";
import { rangeChange } from "../lib/ranges.js";

function chart(count = 40) {
  return Response.json({ chart: { result: [{
    timestamp: Array.from({ length: count }, (_, i) => 1700000000 + i * 86400),
    indicators: { quote: [{
      close: Array.from({ length: count }, (_, i) => 100 + i),
      volume: Array(count).fill(1000),
    }] },
  }], error: null } });
}

test("NSE parsing includes all rows, quoted names, special symbols, and deduplicates", () => {
  assert.deepEqual(parseSymbols('\uFEFFSYMBOL,NAME OF COMPANY,SERIES\r\nM&M,"Name, Limited",EQ\r\nABC,Name,BE\r\nM&M,Name,EQ\r\n'), ["M&M", "ABC"]);
  assert.throws(() => parseSymbols("<html>Access denied</html>"), /invalid equity list/);
  assert.throws(() => parseSymbols("SYMBOL,NAME\n,Empty"), /invalid symbols/);
  assert.throws(() => parseSymbols("SYMBOL,NAME\n"), /invalid symbols/);
});

test("stock search resolves company names and symbols, ranking exact symbols first", () => {
  const equities = parseEquities('\uFEFFSYMBOL,NAME OF COMPANY,SERIES\r\nTCS,Tata Consultancy Services,EQ\r\nM&M,"Mahindra, Limited",EQ\r\nTATA,Tata Company,EQ\r\nTCS,Duplicate,EQ\r\n');
  assert.equal(equities.length, 3);
  assert.equal(equities[1].name, "Mahindra, Limited");
  assert.deepEqual(searchEquities(equities, " consultancy "), [equities[0]]);
  assert.equal(searchEquities(equities, "m&m")[0].symbol, "M&M");
  assert.equal(searchEquities(equities, "tata")[0].symbol, "TATA");
  assert.deepEqual(searchEquities(equities, "missing"), []);
  assert.deepEqual(searchEquities(equities, "  "), []);
  assert.equal(searchEquities(Array.from({ length: 30 }, (_, i) => ({ symbol: `ABC${i}`, name: "ABC company" })), "abc").length, 20);
  assert.throws(() => parseEquities("SYMBOL,NAME\nTCS,"), /missing company name/);
});

test("search and sorting are case insensitive, deterministic, and do not mutate results", () => {
  const rows = [
    { symbol: "XYZ", rangeChange: -8, score: 2, rsi: null },
    { symbol: "TCS", name: "Tata Consultancy", rangeChange: 3, score: 4, rsi: 60 },
    { symbol: "ABC", rangeChange: 8, score: 4, rsi: 50 },
  ];
  const symbols = (rows) => rows.map((row) => row.symbol);
  assert.deepEqual(symbols(selectMovers(rows, "", "movement")), ["ABC", "XYZ", "TCS"]);
  assert.deepEqual(symbols(selectMovers(rows, "", "gain")), ["ABC", "TCS", "XYZ"]);
  assert.deepEqual(symbols(selectMovers(rows, "", "loss")), ["XYZ", "TCS", "ABC"]);
  assert.deepEqual(symbols(selectMovers(rows, "", "symbol")), ["ABC", "TCS", "XYZ"]);
  assert.deepEqual(symbols(selectMovers(rows, "", "symbol", true)), ["XYZ", "TCS", "ABC"]);
  assert.deepEqual(symbols(selectMovers(rows, "", "score")), ["ABC", "TCS", "XYZ"]);
  const signals = [
    { symbol: "BEAR1", signal: "BEARISH", score: 1, rangeChange: 1 },
    { symbol: "BULL4", signal: "BULLISH", score: 4, rangeChange: 1 },
    { symbol: "NEUTRAL3", signal: "NEUTRAL", score: 3, rangeChange: 1 },
    { symbol: "BULL5", signal: "BULLISH", score: 5, rangeChange: 1 },
    { symbol: "NODATA", signal: "INSUFFICIENT", score: null, rangeChange: null, insufficient: true },
  ];
  assert.deepEqual(symbols(selectMovers(signals, "", "signal")), ["BULL5", "BULL4", "NEUTRAL3", "BEAR1", "NODATA"]);
  assert.deepEqual(symbols(selectMovers(signals, "", "signal", true)), ["BEAR1", "NEUTRAL3", "BULL4", "BULL5", "NODATA"]);
  assert.equal(symbols(selectMovers(signals, "", "movement")).at(-1), "NODATA");
  assert.equal(symbols(selectMovers(signals, "", "movement", true)).at(-1), "NODATA");
  const today = [{ symbol: "LOW", change: -2 }, { symbol: "HIGH", change: 4 }];
  assert.deepEqual(symbols(selectMovers(today, "", "change")), ["HIGH", "LOW"]);
  assert.equal(sortsAscending("symbol", false), true);
  assert.equal(sortsAscending("score", false), false);
  assert.equal(sortsAscending("score", true), true);
  assert.deepEqual(symbols(selectMovers(rows, "", "rsi", true)), ["ABC", "TCS", "XYZ"]);
  assert.deepEqual(symbols(selectMovers(rows, " tc ", "movement")), ["TCS"]);
  assert.deepEqual(symbols(selectMovers(rows, "consultancy", "movement")), ["TCS"]);
  assert.deepEqual(selectMovers(rows, "missing", "score"), []);
  assert.deepEqual(symbols(rows), ["XYZ", "TCS", "ABC"]);
});

test("public signals are non-advisory and insufficient data is listed explicitly", () => {
  assert.deepEqual([4, 3, 2, 1, -3].map(signalFor), ["BULLISH", "NEUTRAL", "NEUTRAL", "BEARISH", "BEARISH"]);
  assert.deepEqual([4, 2, 1].map(adviceVerdict), ["BUY", "WATCH", "AVOID"]);
  const bars = (count) => Array.from({ length: count }, (_, i) => ({ t: 1700000000 + i * 86400, c: 100 + i, v: 1000 }));
  const full = analyze(bars(40));
  assert.equal(full.insufficient, false);
  assert.ok(["BULLISH", "NEUTRAL", "BEARISH"].includes(full.signal));
  assert.equal("verdict" in full, false);
  const short = analyze(bars(30));
  assert.equal(short.signal, "INSUFFICIENT");
  assert.equal(short.insufficient, true);
  assert.equal(short.price, 129);
  assert.equal(short.score, null);
  assert.match(short.reasons[0], /30 of 31/);
  const single = analyze(bars(1));
  assert.equal(single.change, null);
  assert.equal(rangeChange(bars(1), "1d"), null);
  assert.equal(rangeChange([], "all", 50), null);
  const known = { insufficient: true, rangeChange: 6 }, unknown = { insufficient: true, rangeChange: null };
  assert.equal(matchesMove(known, 5, "up"), true);
  assert.equal(matchesMove(known, 7, "both"), false);
  assert.equal(matchesMove(unknown, 0, "both"), true);
  assert.equal(matchesMove(unknown, 0, "up"), false);
  assert.equal(matchesMove(unknown, 1, "both"), false);
});

test("fresh full scans expose early batches without starting another scan", async (t) => {
  const symbols = Array.from({ length: 21 }, (_, i) => `PART${i}`);
  let release, reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const secondBatch = new Promise((resolve) => { reached = resolve; });
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.includes(`PART${SCAN_CONCURRENCY}.NS`)) { reached(); await gate; }
    return chart();
  });
  const request = scanStocks(symbols, true);
  await secondBatch;
  const progress = getScanProgress(symbols);
  assert.equal(progress.processed, SCAN_CONCURRENCY);
  assert.equal(progress.stocks.length, SCAN_CONCURRENCY);
  assert.equal("rows" in progress.stocks[0], false);
  assert.equal(getScanProgress(["OTHER"]), null);
  release();
  assert.equal((await request).stocks.length, 21);
  assert.equal(progress.stocks.length, SCAN_CONCURRENCY);
  assert.equal(getScanProgress(symbols), null);
});

test("scan summaries preserve exact signals and every range without retaining daily bars", async (t) => {
  const count = 252;
  t.mock.method(globalThis, "fetch", async () => chart(count));
  const bars = await getDaily("SUMMARY");
  const scan = await scanStocks(["SUMMARY"]);
  const stock = scan.stocks[0];
  assert.deepEqual(stock.analysis, analyze(bars));
  assert.equal(stock.latestClose, bars.at(-1).c);
  for (const range of ["1d", "5d", "1mo", "3mo", "1y"]) {
    assert.equal(stock.changes[range], rangeChange(bars, range));
  }
  assert.equal("rows" in stock, false);
  const rawBytes = Buffer.byteLength(JSON.stringify({ symbol: stock.symbol, rows: bars }));
  const summaryBytes = Buffer.byteLength(JSON.stringify(stock));
  assert.ok(summaryBytes < rawBytes * 0.05,
    `Retained summary ${summaryBytes} bytes must be under 5% of raw history ${rawBytes} bytes`);
  globalThis.fetch = async () => chart(1);
  const short = (await scanStocks(["SHORTSUMMARY"])).stocks[0];
  assert.equal(short.analysis.signal, "INSUFFICIENT");
  assert.equal(short.analysis.price, 100);
  assert.deepEqual(Object.values(short.changes), [null, null, null, null, null]);
});

test("stock details fetch on demand, share requests, cache briefly, and keep quote timestamps", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++;
    if (url.includes("/search")) return Response.json({ news: [{
      title: "Company results", link: "https://example.com/results", publisher: "Test publisher",
      providerPublishTime: 1700000000,
    }, { title: "Unsafe link", link: "javascript:alert(1)" }] });
    const data = await chart().json();
    data.chart.result[0].meta = {
      longName: "Test Company", currency: "INR", regularMarketPrice: 140,
      regularMarketTime: 1700000000, regularMarketDayHigh: 141, regularMarketDayLow: 130,
      fiftyTwoWeekHigh: 150, fiftyTwoWeekLow: 80, regularMarketVolume: 123456,
    };
    const quote = data.chart.result[0].indicators.quote[0];
    quote.open = Array(40).fill(135);
    return Response.json(data);
  });
  const [a, b] = await Promise.all([getStockDetails("DETAIL"), getStockDetails("DETAIL")]);
  assert.strictEqual(a, b);
  assert.strictEqual(await getStockDetails("DETAIL"), a);
  assert.equal(calls, 2);
  assert.equal(a.name, "Test Company");
  assert.equal(a.open, 135);
  assert.equal(a.dayHigh, 141);
  assert.equal(a.yearLow, 80);
  assert.equal(a.previousClose, 138);
  assert.equal(a.marketPrice, 140);
  assert.equal(a.quoteAt, new Date(1700000000000).toISOString());
  assert.equal(a.news.length, 1);
  assert.equal(a.newsError, null);
  assert.ok(Number.isFinite(a.macd));
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 60001);
  assert.notStrictEqual(await getStockDetails("DETAIL"), a);
  assert.equal(calls, 4);
});

test("stock details report unavailable news and never invent missing price fields", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => url.includes("/search")
    ? new Response("", { status: 503 }) : chart());
  const details = await getStockDetails("NONEWS");
  assert.match(details.newsError, /503/);
  assert.deepEqual(details.news, []);
  assert.equal(details.yearHigh, null);
  assert.equal(details.open, null);
  assert.equal(details.quoteAt, null);
  globalThis.fetch = async () => new Response("", { status: 404 });
  await assert.rejects(getStockDetails("BADQUOTE"), /404/);
  globalThis.fetch = async () => Response.json({});
  await assert.rejects(getNews("Company"), /invalid news data/);
});

test("NSE list requests share the fetch and cache a successful list", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("SYMBOL,NAME\nABC,Company\nXYZ,Company");
  });
  const [a, b] = await Promise.all([getUniverse(), getUniverse()]);
  assert.deepEqual(a, ["ABC", "XYZ"]);
  assert.strictEqual(a, b);
  assert.strictEqual(await getUniverse(), a);
  assert.equal(calls, 1);
});

test("Yahoo encodes symbols and reports unavailable and insufficient data", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.ok(url.includes("M%26M.NS"));
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal);
    return chart();
  });
  assert.equal((await getDaily("M&M")).length, 40);
  globalThis.fetch = async () => new Response("", { status: 404 });
  await assert.rejects(getDaily("M&M"), /404/);
  globalThis.fetch = async () => chart(30);
  assert.equal((await getDaily("M&M")).length, 30);
  globalThis.fetch = async () => chart(0);
  await assert.rejects(getDaily("M&M"), /Daily price data is unavailable/);
});

test("full scans cover more than 100 symbols, limit concurrency, and share the five-minute cache", async (t) => {
  let calls = 0, active = 0, peak = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return chart();
  });
  const symbols = Array.from({ length: 205 }, (_, i) => `STOCK${i}`);
  const [a, b] = await Promise.all([scanStocks(symbols, true), scanStocks(symbols, true)]);
  assert.equal(a.stocks.length, 205);
  assert.deepEqual(a.unavailable, []);
  assert.strictEqual(a, b);
  assert.strictEqual(await scanStocks(symbols, true), a);
  assert.equal(calls, 205);
  assert.equal(peak, 4);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + SCAN_TTL_MS + 1);
  const fresh = await scanStocks(symbols, true);
  assert.notStrictEqual(fresh, a);
  assert.equal(calls, 410);
});

test("custom scans bypass cache and failed stocks have explicit reasons", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++;
    return url.includes("MISSING") ? new Response("", { status: 404 }) : chart();
  });
  const scan = await scanStocks(["VALID", "MISSING"]);
  assert.equal(scan.stocks.length, 1);
  assert.deepEqual(scan.unavailable, [{ symbol: "MISSING", reason: "Yahoo Finance request failed (404)" }]);
  await scanStocks(["VALID", "MISSING"]);
  assert.equal(calls, 4);
  await assert.rejects(scanStocks(["MISSING"]), /No stocks could be analyzed/);
});

test("rate limits stop the scan before requesting later batches", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("", { status: 429 });
  });
  await assert.rejects(scanStocks(Array.from({ length: 25 }, (_, i) => `RATE${i}`), true), /429/);
  assert.equal(calls, SCAN_CONCURRENCY);
  globalThis.fetch = async () => chart();
  assert.equal((await scanStocks(["RECOVERED"], true)).stocks.length, 1);
});

test("failed scans wait for outstanding batch downloads before accepting a retry", async (t) => {
  let release, finished = false, active = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("DRAIN0.NS")) return new Response("", { status: 429 });
    active++;
    await gate;
    active--;
    return chart();
  });
  const request = scanStocks(Array.from({ length: 8 }, (_, i) => `DRAIN${i}`), true)
    .catch((error) => { finished = true; return error; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, SCAN_CONCURRENCY - 1);
  assert.equal(finished, false);
  release();
  assert.match((await request).message, /429/);
  assert.equal(active, 0);
  assert.equal(getScanProgress(["DRAIN0"]), null);
});

test("all-time failures are reported, not replaced with one-year history; derived scans are shared", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++;
    return url.includes("NOHISTORY") ? new Response("", { status: 404 }) : chart();
  });
  const scan = { stocks: [{ symbol: "HISTORY", latestClose: 139, changes: { "1d": 0.72 } },
    { symbol: "NOHISTORY", latestClose: 139, changes: { "1d": 0.72 } }],
    unavailable: [{ symbol: "MISSING", reason: "No daily data" }], updatedAt: "2026-10-14T00:00:00Z" };
  const [a, b] = await Promise.all([withAllTime(scan), withAllTime(scan)]);
  assert.strictEqual(a, b);
  assert.strictEqual(await withAllTime(scan), a);
  assert.equal(calls, 2);
  assert.equal(a.stocks.length, 1);
  assert.equal(a.stocks[0].firstClose, 100);
  assert.equal(a.stocks[0].changes.all, 39);
  assert.equal(a.stocks[0].changes["1d"], 0.72);
  assert.equal(scan.stocks[0].changes.all, undefined);
  assert.equal(a.unavailable.length, 2);
  assert.equal(a.updatedAt, scan.updatedAt);
});
