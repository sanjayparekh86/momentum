// Unofficial Yahoo Finance chart endpoint. Fine for prototyping; swap for a broker API
// (Kite Connect / Upstox / Angel One) when you need reliable real-time data.
async function getChart(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol + ".NS")}?range=${range}&interval=${interval}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const error = new Error(`Yahoo Finance request failed (${r.status})`);
    error.status = r.status;
    throw error;
  }
  const chart = (await r.json()).chart;
  if (chart?.error) throw new Error(chart.error.description || "Yahoo Finance returned an error");
  const result = chart?.result?.[0];
  if (!result) throw new Error("Yahoo Finance returned no chart data");
  return result;
}

export async function getDaily(symbol) {
  const res = await getChart(symbol, "1y", "1d");
  const q = res.indicators?.quote?.[0];
  if (!res.timestamp || !q?.close) throw new Error("Daily price data is unavailable");
  const rows = res.timestamp
    .map((t, i) => ({ t, c: q.close[i], v: q.volume?.[i] }))
    .filter((x) => Number.isFinite(x.c) && x.c > 0);
  if (rows.length <= 30) throw new Error("Insufficient price history (at least 31 daily bars required)");
  return rows;
}

// Earliest available close (for "all time" change). It never changes, so cache it.
const firstCloseCache = new Map();
export async function getFirstClose(symbol) {
  if (firstCloseCache.has(symbol)) return firstCloseCache.get(symbol);
  const res = await getChart(symbol, "max", "1mo");
  const first = res.indicators?.quote?.[0]?.close?.find((c) => Number.isFinite(c) && c > 0);
  if (first == null) throw new Error("All-time price history is unavailable");
  firstCloseCache.set(symbol, first);
  return first;
}
