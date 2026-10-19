"use client";
import { useEffect, useState } from "react";

export default function StockSearch({ onSelect, variant = "screener", initialSymbol = "", onQueryChange }) {
  const isJournal = variant === "journal";
  const [query, setQuery] = useState(initialSymbol);
  const [selected, setSelected] = useState(isJournal && !!initialSymbol);
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setStocks([]); setError("");
    if (!query.trim() || selected) { setLoading(false); return; }
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
  }, [query, selected]);
  return <div className={isJournal ? "journal-stock-search" : "stock-search"} role="region" aria-label="Find an NSE stock">
    <label className="search-label">Company name or NSE symbol
      <input type="search" required={isJournal} maxLength={100} value={query} onChange={(e) => {
        setQuery(e.target.value); setSelected(false); onQueryChange?.();
      }}
        placeholder="e.g. Tata Consultancy, TCS or M&M" autoComplete="off" />
    </label>
    <p className="meta">{isJournal ? selected ? `Selected NSE symbol: ${query}. Edit to find another stock.` : "Choose a matching stock below to add it to your bucket."
      : "Search the NSE equity list, then choose a stock to analyze. No percentage filter or full-market scan."}</p>
    {loading && <p role="status">Finding stocks...</p>}
    {error && <p className="err" role="alert">{error} Edit the search to retry.</p>}
    {!selected && !loading && !error && query.trim() && !stocks.length && <p role="status">No matching NSE equity. Try its company name or trading symbol.</p>}
    {!selected && stocks.length > 0 && <ul className="stock-search-results" aria-label="Matching stocks">{stocks.map((stock) => (
      <li key={stock.symbol}><button type="button" className="stock-search-option" onClick={() => {
        if (isJournal) { setQuery(stock.symbol); setSelected(true); }
        onSelect(stock);
      }}>
        <span><strong>{stock.symbol}</strong><small>{stock.name}</small></span><span className="search-action">{isJournal ? "Select stock" : "Analyze stock"}</span>
      </button></li>
    ))}</ul>}
  </div>;
}
