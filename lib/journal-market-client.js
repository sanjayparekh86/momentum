export async function marketData(symbol, from, signal) {
  const params = new URLSearchParams({ symbol });
  if (from != null) params.set("from", String(Math.max(0, Math.floor(from / 1000) - 86400)));
  const response = await fetch(`/api/journal-market?${params}`, { signal, cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || `Market request failed (${response.status}).`);
  return json;
}
