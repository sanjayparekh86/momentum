export const UNIVERSE_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
let cached;
let pending;

export function parseSymbols(csv) {
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines[0]?.split(",")[0].trim() !== "SYMBOL") {
    throw new Error("NSE returned an invalid equity list");
  }
  // Only the first CSV field is needed; company names may contain quoted commas.
  const symbols = [...new Set(lines.slice(1).filter((line) => line.trim())
    .map((line) => line.split(",")[0].trim().replace(/^"|"$/g, "")))];
  if (!symbols.length || symbols.some((symbol) => !/^[A-Z0-9&_.-]+$/.test(symbol))) {
    throw new Error("NSE equity list contains missing or invalid symbols");
  }
  return symbols;
}

export function parseEquities(csv) {
  const symbols = parseSymbols(csv);
  const names = new Map();
  for (const line of csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const fields = line.match(/^([^,]+),("(?:[^"]|"")*"|[^,]*)(?:,|$)/);
    if (!fields) throw new Error("NSE returned an invalid company name");
    const symbol = fields[1].trim().replace(/^"|"$/g, "");
    const name = fields[2].trim().replace(/^"|"$/g, "").replaceAll('""', '"');
    if (!name) throw new Error("NSE returned a missing company name");
    if (!names.has(symbol)) names.set(symbol, name);
  }
  return symbols.map((symbol) => ({ symbol, name: names.get(symbol) }));
}

export function searchEquities(equities, query) {
  const text = query.trim().toUpperCase();
  if (!text) return [];
  const rank = (item) => item.symbol === text ? 0 : item.symbol.startsWith(text) ? 1
    : item.name.toUpperCase().startsWith(text) ? 2 : 3;
  return equities.filter((item) => item.symbol.includes(text) || item.name.toUpperCase().includes(text))
    .sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol)).slice(0, 20);
}

export async function getEquities() {
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.equities;
  if (!pending) {
    pending = (async () => {
      const response = await fetch(UNIVERSE_URL, {
        headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`NSE equity list request failed (${response.status})`);
      const equities = parseEquities(await response.text());
      cached = { equities, symbols: equities.map((item) => item.symbol), at: Date.now() };
      return equities;
    })();
  }

  try { return await pending; }
  finally { pending = null; }
}

export async function getUniverse() {
  await getEquities();
  return cached.symbols;
}
