import assert from "node:assert/strict";
import { test } from "node:test";
import { getUniverse, parseSymbols } from "../lib/symbols.js";
import { getDaily } from "../lib/yahoo.js";
import { scanStocks, withAllTime, SCAN_TTL_MS } from "../lib/screener.js";

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
  await assert.rejects(getDaily("M&M"), /Insufficient price history/);
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
  assert.equal(peak, 10);
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
  assert.equal(calls, 10);
  globalThis.fetch = async () => chart();
  assert.equal((await scanStocks(["RECOVERED"], true)).stocks.length, 1);
});

test("all-time failures are reported, not replaced with one-year history; derived scans are shared", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++;
    return url.includes("NOHISTORY") ? new Response("", { status: 404 }) : chart();
  });
  const scan = { stocks: [{ symbol: "HISTORY", rows: [] }, { symbol: "NOHISTORY", rows: [] }],
    unavailable: [{ symbol: "MISSING", reason: "No daily data" }], updatedAt: "2026-10-14T00:00:00Z" };
  const [a, b] = await Promise.all([withAllTime(scan), withAllTime(scan)]);
  assert.strictEqual(a, b);
  assert.strictEqual(await withAllTime(scan), a);
  assert.equal(calls, 2);
  assert.equal(a.stocks.length, 1);
  assert.equal(a.stocks[0].firstClose, 100);
  assert.equal(a.unavailable.length, 2);
  assert.equal(a.updatedAt, scan.updatedAt);
});
