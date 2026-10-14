import { getStockChart, getNews } from "./yahoo.js";
import { analyze } from "./verdict.js";

const TTL_MS = 60000;
const cache = new Map();
const pending = new Map();
const number = (value) => Number.isFinite(value) ? value : null;

export async function getStockDetails(symbol) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  if (pending.has(symbol)) return pending.get(symbol);
  const request = (async () => {
    const { meta, rows } = await getStockChart(symbol);
    const last = rows.at(-1);
    const name = meta.longName || meta.shortName || symbol;
    let news = [], newsError = null;
    try { news = await getNews(name); }
    catch (error) {
      console.warn(`Stock news unavailable for ${symbol}:`, error.message);
      newsError = error.message;
    }
    const data = {
      symbol, name, currency: meta.currency || "INR", exchange: meta.fullExchangeName || "NSE",
      quoteAt: Number.isFinite(meta.regularMarketTime)
        ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      fetchedAt: new Date().toISOString(), ...analyze(rows),
      marketPrice: number(meta.regularMarketPrice),
      open: number(last.o), previousClose: number(rows.at(-2).c),
      dayHigh: number(meta.regularMarketDayHigh ?? last.h),
      dayLow: number(meta.regularMarketDayLow ?? last.l),
      yearHigh: number(meta.fiftyTwoWeekHigh), yearLow: number(meta.fiftyTwoWeekLow),
      volume: number(meta.regularMarketVolume ?? last.v),
      news, newsError,
    };
    // Bound the process-local cache rather than retaining every visited stock forever.
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(symbol, { at: Date.now(), data });
    return data;
  })();
  pending.set(symbol, request);
  try { return await request; }
  finally { pending.delete(symbol); }
}
