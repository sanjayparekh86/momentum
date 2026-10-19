export const JOURNAL_SOURCE = "Yahoo Finance (unofficial, prices may be delayed)";
export const CSV_FIELDS = ["type", "id", "bucketId", "name", "symbol", "createdAt", "referencePrice",
  "referenceAt", "direction", "targetPercent", "deadline", "reason", "confidence", "status",
  "evaluation", "latest", "reflection"];
const SYMBOL = /^[A-Z0-9&_.-]{1,64}$/;
const validInstant = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const positive = (value) => Number.isFinite(value) && value > 0;
const text = (value, max = 4000) => typeof value === "string" && value.length <= max;

export function emptyJournal() {
  return { version: 1, buckets: [], stocks: [], predictions: [] };
}

export function hasJournalStock(data, symbol) {
  return !!data && (data.stocks.some((s) => s.symbol === symbol)
    || data.predictions.some((p) => p.symbol === symbol));
}

export function exchangeDate(instant = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(instant));
}

export function validDeadline(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const day = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === date
    && day.getUTCDay() !== 0 && day.getUTCDay() !== 6;
}

export function deadlineClose(date) {
  return Date.parse(`${date}T15:30:00+05:30`);
}

export function newPrediction(input, quote, now = Date.now()) {
  const createdAt = new Date(now).toISOString();
  if (!quote || !positive(quote.price) || !validInstant(quote.at)) throw new Error("A timestamped market quote is required.");
  if (Date.parse(quote.at) > now || now - Date.parse(quote.at) > 7 * 86400000) {
    throw new Error("The reference quote is older than seven days or has an invalid future timestamp. Refresh the quote.");
  }
  if (!validDeadline(input.deadline) || deadlineClose(input.deadline) <= now) {
    throw new Error("Choose a future weekday market close (15:30 India time). Exchange holidays may remain awaiting data.");
  }
  const record = {
    id: input.id, bucketId: input.bucketId, symbol: input.symbol, createdAt,
    referencePrice: quote.price, referenceAt: quote.at, direction: input.direction,
    targetPercent: input.targetPercent === "" ? null : Number(input.targetPercent),
    deadline: input.deadline, reason: input.reason.trim(),
    confidence: input.confidence === "" ? null : Number(input.confidence),
    status: "pending", evaluation: null, latest: null, reflection: "",
  };
  validatePrediction(record);
  return record;
}

function validatePrediction(p) {
  if (!SYMBOL.test(p.symbol) || !validInstant(p.createdAt) || !positive(p.referencePrice)
    || !validInstant(p.referenceAt) || Date.parse(p.referenceAt) > Date.parse(p.createdAt)
    || !["up", "down"].includes(p.direction) || !validDeadline(p.deadline)
    || deadlineClose(p.deadline) <= Date.parse(p.createdAt)
    || !(p.targetPercent === null || positive(p.targetPercent) && (p.direction === "up" || p.targetPercent < 100))
    || !(p.confidence === null || Number.isFinite(p.confidence) && p.confidence >= 0 && p.confidence <= 100)
    || !text(p.reason) || !text(p.reflection)
    || !["pending", "completed", "cancelled"].includes(p.status)) {
    throw new Error("Invalid prediction terms, price, date, target, or confidence.");
  }
  if (p.latest !== null && (!positive(p.latest?.price) || !validInstant(p.latest?.at))) {
    throw new Error("Invalid latest price observation.");
  }
  if (p.status === "completed") {
    const e = p.evaluation;
    if (!e || !positive(e.price) || !validInstant(e.at) || !validInstant(e.checkedAt)
      || e.at !== new Date(deadlineClose(p.deadline)).toISOString()
      || Date.parse(e.checkedAt) < Date.parse(`${p.deadline}T18:00:00+05:30`)) {
      throw new Error("Invalid deadline evaluation evidence.");
    }
    const expected = outcome(p, e.price);
    if (e.result !== expected.result || e.directionCorrect !== expected.directionCorrect
      || e.movement !== expected.movement || e.rule !== "deadline-close-v1" || e.source !== JOURNAL_SOURCE) {
      throw new Error("Evaluation does not match its price evidence.");
    }
  } else if (p.evaluation !== null) throw new Error("Only completed predictions can have an evaluation.");
}

export function validateJournal(data) {
  if (data?.version !== 1 || !Array.isArray(data.buckets) || !Array.isArray(data.stocks)
    || !Array.isArray(data.predictions)) throw new Error("Invalid journal format.");
  if (data.buckets.length + data.stocks.length + data.predictions.length > 20000) throw new Error("Journal exceeds 20,000 records.");
  for (const records of [data.buckets, data.stocks, data.predictions]) {
    const ids = new Set();
    for (const row of records) {
      if (!row || !text(row.id, 100) || !row.id || ids.has(row.id)) throw new Error("Missing or duplicate record ID.");
      ids.add(row.id);
    }
  }
  const buckets = new Set(data.buckets.map((b) => b.id));
  for (const b of data.buckets) {
    if (!text(b.name, 80) || !b.name.trim() || !validInstant(b.createdAt)) throw new Error("Invalid bucket.");
  }
  const memberships = new Set();
  for (const s of data.stocks) {
    const key = `${s.bucketId}:${s.symbol}`;
    if (!buckets.has(s.bucketId) || !SYMBOL.test(s.symbol) || !validInstant(s.createdAt) || memberships.has(key)) {
      throw new Error("Invalid or duplicate watchlist membership.");
    }
    memberships.add(key);
  }
  for (const p of data.predictions) {
    if (!buckets.has(p.bucketId)) throw new Error("Prediction references a missing bucket.");
    validatePrediction(p);
  }
  return data;
}

export function outcome(prediction, price) {
  const movement = (price / prediction.referencePrice - 1) * 100;
  const signed = prediction.direction === "up" ? movement : -movement;
  const directionCorrect = signed > 1e-9;
  const result = Math.abs(movement) < 1e-9 ? "unchanged"
    : !directionCorrect ? "incorrect"
      : prediction.targetPercent === null ? "correct"
        : signed + 1e-9 >= prediction.targetPercent ? "target achieved" : "direction correct, target missed";
  return { movement, directionCorrect, result };
}

export function predictionProgress(prediction, quote, now = Date.now()) {
  const observation = [prediction.latest, quote]
    .filter((item) => positive(item?.price) && validInstant(item?.at)
      && Date.parse(item.at) >= Date.parse(prediction.referenceAt) && Date.parse(item.at) <= now)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!observation) return null;
  const comparison = outcome(prediction, observation.price);
  const label = comparison.result === "unchanged" ? "Unchanged"
    : !comparison.directionCorrect ? "Against your direction"
      : prediction.targetPercent === null ? "In your direction"
        : comparison.result === "target achieved" ? "At target now" : "In your direction; target not met";
  return {
    quote: observation, change: observation.price - prediction.referencePrice,
    movement: comparison.movement, label,
    tone: comparison.result === "unchanged" ? "muted" : comparison.directionCorrect ? "positive" : "negative",
  };
}

export function evaluatePrediction(prediction, market, now = Date.now()) {
  if (prediction.status !== "pending") return { prediction, message: "" };
  const updated = { ...prediction };
  if (positive(market.quote?.price) && validInstant(market.quote?.at)
    && Date.parse(market.quote.at) >= Date.parse(prediction.referenceAt)
    && Date.parse(market.quote.at) <= now) updated.latest = market.quote;
  if (now < Date.parse(`${prediction.deadline}T18:00:00+05:30`)) {
    return { prediction: updated, message: "Pending; deadline results are checked after 18:00 India time." };
  }
  // Yahoo can retroactively split-adjust older closes, even after the deadline.
  if (market.splits?.some((s) => s.t * 1000 > Date.parse(prediction.referenceAt))) {
    return { prediction: updated, message: "Unable to evaluate automatically: a stock split affects this prediction. Review corporate actions." };
  }
  const row = market.rows?.find((r) => exchangeDate(r.t * 1000) === prediction.deadline);
  if (!row || !positive(row.c)) {
    return { prediction: updated, message: "Awaiting deadline data. The date may be a holiday or outside provider coverage; no substitute day is used." };
  }
  updated.status = "completed";
  updated.evaluation = {
    ...outcome(prediction, row.c), price: row.c,
    at: new Date(deadlineClose(prediction.deadline)).toISOString(),
    checkedAt: new Date(now).toISOString(), source: JOURNAL_SOURCE, rule: "deadline-close-v1",
  };
  return { prediction: updated, message: "" };
}

function csvCell(value) {
  let string = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Neutralize spreadsheet formulas and escape leading apostrophes reversibly.
  if (/^[=+\-@\t\r']/.test(string)) string = "'" + string;
  return `"${string.replaceAll('"', '""')}"`;
}

export function exportJournal(data) {
  validateJournal(data);
  const records = [
    ...data.buckets.map((b) => ({ type: "bucket", ...b })),
    ...data.stocks.map((s) => ({ type: "stock", ...s })),
    ...data.predictions.map((p) => ({ type: "prediction", ...p })),
  ];
  return "\uFEFF" + [CSV_FIELDS.join(","), ...records.map((r) => CSV_FIELDS.map((f) => csvCell(r[f])).join(","))].join("\r\n");
}

export function parseCSV(input) {
  if (input.length > 5 * 1024 * 1024) throw new Error("CSV backup must be 5 MB or smaller.");
  const source = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false, closed = false;
  const finish = () => { row.push(cell); cell = ""; closed = false; };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += c;
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === ",") finish();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      finish(); rows.push(row); row = [];
    } else {
      if (closed || c === '"') throw new Error("Malformed CSV quoting.");
      cell += c;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (cell || row.length || closed) { finish(); rows.push(row); }
  return rows;
}

export function importJournal(csv) {
  const rows = parseCSV(csv);
  if (rows.shift()?.join(",") !== CSV_FIELDS.join(",")) throw new Error("Use a Momentum journal CSV backup with the original column headers.");
  const data = emptyJournal();
  for (const cells of rows) {
    if (cells.length === 1 && !cells[0]) continue;
    if (cells.length !== CSV_FIELDS.length) throw new Error("CSV row has an incorrect number of columns.");
    const record = Object.fromEntries(CSV_FIELDS.map((key, i) => [key,
      /^'[=+\-@\t\r']/.test(cells[i]) ? cells[i].slice(1) : cells[i]]));
    const { type, id, bucketId, name, symbol, createdAt } = record;
    if (type === "bucket") data.buckets.push({ id, name, createdAt });
    else if (type === "stock") data.stocks.push({ id, bucketId, symbol, createdAt });
    else if (type === "prediction") {
      const numeric = (v) => v === "" ? null : Number(v);
      data.predictions.push({
        id, bucketId, symbol, createdAt, referencePrice: numeric(record.referencePrice),
        referenceAt: record.referenceAt, direction: record.direction,
        targetPercent: numeric(record.targetPercent), deadline: record.deadline,
        reason: record.reason, confidence: numeric(record.confidence), status: record.status,
        evaluation: record.evaluation ? JSON.parse(record.evaluation) : null,
        latest: record.latest ? JSON.parse(record.latest) : null, reflection: record.reflection,
      });
    } else throw new Error(`Unknown CSV record type: ${type}`);
  }
  return validateJournal(data);
}

export function mergeJournals(current, incoming) {
  validateJournal(current); validateJournal(incoming);
  const merged = emptyJournal();
  for (const key of ["buckets", "stocks", "predictions"]) {
    const records = new Map(current[key].map((r) => [r.id, r]));
    for (const record of incoming[key]) {
      const existing = records.get(record.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
        throw new Error(`Import conflict for ${record.id}. Existing records were not changed. Use a fresh browser profile to restore a different version.`);
      }
      records.set(record.id, record);
    }
    merged[key] = [...records.values()];
  }
  return validateJournal(merged);
}
