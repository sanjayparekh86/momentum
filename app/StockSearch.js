"use client";
import { useEffect, useState } from "react";

export default function StockSearch({ onSelect }) {
  const [query, setQuery] = useState("");
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setStocks([]); setError("");
    if (!query.trim()) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/stocks?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || `Search failed (${response.status})`);
        if (!controller.signal.aborted) setStocks(json.stocks);
      } catch (e) { if (!controller.signal.aborted) setError(e.message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  return <section className="stock-search" aria-label="Find an NSE stock">
    <label className="search-label">Company name or NSE symbol
      <input type="search" maxLength={100} value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. Tata Consultancy, TCS or M&M" autoComplete="off" />
    </label>
    <p className="meta">Search the NSE equity list, then choose a stock to analyze. No percentage filter or full-market scan.</p>
    {loading && <p role="status">Finding stocks...</p>}
    {error && <p className="err" role="alert">{error} Edit the search to retry.</p>}
    {!loading && !error && query.trim() && !stocks.length && <p role="status">No matching NSE equity. Try its company name or trading symbol.</p>}
    {stocks.length > 0 && <ul className="stock-search-results" aria-label="Matching stocks">{stocks.map((stock) => (
      <li key={stock.symbol}><button className="stock-search-option" onClick={() => onSelect(stock)}>
        <span><strong>{stock.symbol}</strong><small>{stock.name}</small></span><span className="search-action">Analyze stock</span>
      </button></li>
    ))}</ul>}
  </section>;
}
