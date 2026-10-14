import { getDaily, getFirstClose } from "./yahoo.js";

export const SCAN_TTL_MS = 5 * 60 * 1000;
let cached;
let pending;
const allTimeScans = new WeakMap();

async function collect(symbols, load) {
  const stocks = [], unavailable = [];
  for (let i = 0; i < symbols.length; i += 10) {
    const batch = await Promise.all(symbols.slice(i, i + 10).map(async (symbol) => {
      try {
        return { symbol, value: await load(symbol) };
      } catch (error) {
        // Stop a rate-limited scan rather than hammering the remaining symbols.
        if (error.status === 429 || error.status >= 500) throw error;
        return { symbol, error: error.message };
      }
    }));
    for (const result of batch) {
      if (result.error) unavailable.push({ symbol: result.symbol, reason: result.error });
      else stocks.push({ symbol: result.symbol, ...result.value });
    }
  }
  if (!stocks.length) throw new Error("No stocks could be analyzed. Check Yahoo Finance availability.");
  if (unavailable.length) console.warn(`Screener: ${unavailable.length} of ${symbols.length} stocks unavailable`);
  return { stocks, unavailable, updatedAt: new Date().toISOString() };
}

export async function scanStocks(symbols, fullMarket = false) {
  const load = () => collect(symbols, async (symbol) => ({ rows: await getDaily(symbol) }));
  if (!fullMarket) return load();
  const key = symbols.join(",");
  if (cached?.key === key && Date.now() - cached.at < SCAN_TTL_MS) return cached.scan;
  if (pending) {
    await pending;
    return scanStocks(symbols, fullMarket);
  }
  pending = load().then((scan) => {
    cached = { key, scan, at: Date.now() };
    return scan;
  });
  try { return await pending; }
  finally { pending = null; }
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
            .map((stock) => ({ ...stock, firstClose: firstCloses.get(stock.symbol) })),
          unavailable: [...scan.unavailable, ...history.unavailable],
        };
      });
    allTimeScans.set(scan, promise);
  }
  try { return await allTimeScans.get(scan); }
  catch (error) { allTimeScans.delete(scan); throw error; }
}
