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

export async function getUniverse() {
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.symbols;
  if (!pending) {
    pending = (async () => {
      const response = await fetch(UNIVERSE_URL, {
        headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`NSE equity list request failed (${response.status})`);
      const symbols = parseSymbols(await response.text());
      cached = { symbols, at: Date.now() };
      return symbols;
    })();
  }
  try { return await pending; }
  finally { pending = null; }
}
