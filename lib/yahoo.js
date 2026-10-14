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

export function dailyRows(res) {
  const q = res.indicators?.quote?.[0];
  if (!res.timestamp || !q?.close) throw new Error("Daily price data is unavailable");
  const rows = res.timestamp
    .map((t, i) => ({ t, c: q.close[i], v: q.volume?.[i], o: q.open?.[i], h: q.high?.[i], l: q.low?.[i] }))
    .filter((x) => Number.isFinite(x.c) && x.c > 0);
  if (!rows.length) throw new Error("Daily price data is unavailable");
  return rows;
}

export async function getDaily(symbol) {
  return dailyRows(await getChart(symbol, "1y", "1d"));
}

export async function getStockChart(symbol) {
  const chart = await getChart(symbol, "1y", "1d");
  return { meta: chart.meta || {}, rows: dailyRows(chart) };
}

export async function getNews(name) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=0&newsCount=6`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Yahoo news request failed (${response.status})`);
  const data = await response.json();
  if (!Array.isArray(data.news)) throw new Error("Yahoo returned invalid news data");
  return data.news.filter((item) => typeof item.title === "string"
    && typeof item.link === "string" && /^https?:\/\//i.test(item.link))
    .map((item) => ({
      title: item.title, url: item.link, publisher: item.publisher || "Unknown publisher",
      publishedAt: Number.isFinite(item.providerPublishTime)
        ? new Date(item.providerPublishTime * 1000).toISOString() : null,
    }));
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
