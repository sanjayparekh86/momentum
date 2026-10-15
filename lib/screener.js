import { getDaily, getFirstClose } from "./yahoo.js";
import { analyze } from "./verdict.js";
import { RANGES, rangeChange } from "./ranges.js";

export const SCAN_TTL_MS = 5 * 60 * 1000;
export const SCAN_CONCURRENCY = 4;
let cached;
let pending;
let progress;
let progressKey;
const allTimeScans = new WeakMap();

export function getScanProgress(symbols) {
  return progressKey === symbols.join(",") ? progress : null;
}

async function collect(symbols, load, onProgress) {
  const stocks = [], unavailable = [];
  for (let i = 0; i < symbols.length; i += SCAN_CONCURRENCY) {
    const settled = await Promise.allSettled(symbols.slice(i, i + SCAN_CONCURRENCY).map(async (symbol) => {
      try {
        return { symbol, value: await load(symbol) };
      } catch (error) {
        // Stop a rate-limited scan rather than hammering the remaining symbols.
        if (error.status === 429 || error.status >= 500) throw error;
        return { symbol, error: error.message };
      }
    }));
    // Drain this batch before failing so its downloads cannot overlap a retry.
    const failed = settled.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const batch = settled.map((result) => result.value);
    for (const result of batch) {
      if (result.error) unavailable.push({ symbol: result.symbol, reason: result.error });
      else stocks.push({ symbol: result.symbol, ...result.value });
    }
    onProgress?.({
      stocks: [...stocks], unavailable: [...unavailable],
      processed: Math.min(i + SCAN_CONCURRENCY, symbols.length), updatedAt: new Date().toISOString(),
    });
  }
  if (!stocks.length) throw new Error("No stocks could be analyzed. Check Yahoo Finance availability.");
  if (unavailable.length) console.warn(`Screener: ${unavailable.length} of ${symbols.length} stocks unavailable`);
  return { stocks, unavailable, updatedAt: new Date().toISOString() };
}

export async function scanStocks(symbols, fullMarket = false) {
  const load = (onProgress) => collect(symbols, async (symbol) => {
    const rows = await getDaily(symbol);
    // Release daily bars after computing every supported range and the indicators.
    return {
      analysis: analyze(rows),
      changes: Object.fromEntries(Object.keys(RANGES).filter((range) => range !== "all")
        .map((range) => [range, rangeChange(rows, range)])),
      latestClose: rows.at(-1).c,
    };
  }, onProgress);
  if (!fullMarket) return load();
  const key = symbols.join(",");
  if (cached?.key === key && Date.now() - cached.at < SCAN_TTL_MS) return cached.scan;
  if (pending) {
    await pending;
    return scanStocks(symbols, fullMarket);
  }
  cached = undefined;
  progressKey = key;
  progress = null;
  pending = load((snapshot) => { progress = snapshot; }).then((scan) => {
    cached = { key, scan, at: Date.now() };
    return scan;
  });
  try { return await pending; }
  finally { pending = null; progress = null; progressKey = null; }
}

export async function withAllTime(scan) {
  if (!allTimeScans.has(scan)) {
    const promise = collect(scan.stocks.map((stock) => stock.symbol),
      async (symbol) => ({ firstClose: await getFirstClose(symbol) }))
      .then((history) => {
        const firstCloses = new Map(history.stocks.map((stock) => [stock.symbol, stock.firstClose]));
        return {
          ...scan,
          stocks: scan.stocks.filter((stock) => firstCloses.has(stock.symbol))
            .map((stock) => ({
              ...stock, firstClose: firstCloses.get(stock.symbol),
              changes: {
                ...stock.changes,
                all: rangeChange([{ c: stock.latestClose }], "all", firstCloses.get(stock.symbol)),
              },
            })),
          unavailable: [...scan.unavailable, ...history.unavailable],
        };
      });
    allTimeScans.set(scan, promise);
  }
  try { return await allTimeScans.get(scan); }
  catch (error) { allTimeScans.delete(scan); throw error; }
}
