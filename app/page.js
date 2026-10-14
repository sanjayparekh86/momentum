"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { RANGES } from "@/lib/ranges";
import { SORT_OPTIONS, selectMovers, sortsAscending } from "@/lib/table";
import StockDialog from "./StockDialog";

const REFRESH_MS = 300000;
const PAGE_SIZE = 100;

export default function Home() {
  const [data, setData] = useState(null);
  const [threshold, setThreshold] = useState(5);
  const [thresholdText, setThresholdText] = useState("5");
  const [direction, setDirection] = useState("both");
  const [range, setRange] = useState("1d");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("movement");
  const [reverse, setReverse] = useState(false);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqId = useRef(0);
  const inFlight = useRef(false);
  const request = useRef(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const id = ++reqId.current;
    inFlight.current = true;
    setLoading(true); setError("");
    const params = `threshold=${threshold}&direction=${direction}&range=${range}`;
    let finished = false, timer;
    const poll = async () => {
      try {
        const response = await fetch(`/api/screener?${params}&progress=1`, { signal: controller.signal });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`);
        if (!finished && id === reqId.current && json.partial) {
          setData((previous) => previous && !previous.partial && previous.range === range
            && previous.threshold === threshold && previous.direction === direction ? previous : json);
        }
      } catch (error) {
        if (!finished && !controller.signal.aborted && id === reqId.current) {
          console.warn("Scan progress unavailable:", error.message);
          setError(`Live progress unavailable: ${error.message}. Waiting for the completed scan.`);
        }
        return;
      }
      if (!finished && !controller.signal.aborted) timer = setTimeout(poll, 2000);
    };
    if (range !== "all") timer = setTimeout(poll, 2000);
    try {
      const r = await fetch(`/api/screener?${params}&save=1`, { signal: controller.signal });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `Request failed (${r.status})`);
      if (id === reqId.current) { setData(json); setError(""); }
    } catch (e) { if (!controller.signal.aborted && id === reqId.current) setError(e.message); }
    finally { finished = true; clearTimeout(timer); }
    if (id === reqId.current) { inFlight.current = false; setLoading(false); }
  }, [threshold, direction, range]);

  // Only refresh while visible; local search and sorting never start a scan.
  useEffect(() => {
    load();
    const tick = () => { if (document.visibilityState === "visible" && !inFlight.current) load(); };
    const t = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); request.current?.abort(); };
  }, [load]);

  useEffect(() => { setPage(1); }, [threshold, direction, range, query, sort, reverse]);

  const movers = useMemo(() => selectMovers(data?.movers || [], query, sort, reverse), [data, query, sort, reverse]);
  const pages = Math.max(1, Math.ceil(movers.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = movers.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const isToday = (data?.range || range) === "1d";
  const fmt = (v) => `${v > 0 ? "+" : ""}${v}%`;
  const sortHeader = (key, label) => {
    const active = sort === key;
    const ascending = sortsAscending(key, active && reverse);
    return (
      <th aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}>
        <button className={`sort-head${active ? " active" : ""}`}
          onClick={() => { if (active) setReverse(!reverse); else { setSort(key); setReverse(false); } }}
          title={`Sort by ${label}`}>
          {label} <span aria-hidden="true">{active ? (ascending ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  };

  return (
    <main>
      <header>
        <h1>Movers over {threshold}% {RANGES[range].title}</h1>
        <div className="controls">
          <label>Move ≥
            <input type="text" inputMode="decimal" enterKeyHint="done" autoComplete="off" value={thresholdText}
                   aria-label="Minimum move percentage"
                   onFocus={(e) => { const input = e.target; input.select(); setTimeout(() => input.select(), 0); }}
                   onChange={(e) => {
                     const text = e.target.value.replace(",", ".");
                     if (!/^\d*\.?\d*$/.test(text)) return;
                     setThresholdText(text);
                     if (text !== "" && text !== ".") setThreshold(Number(text));
                   }}
                   onBlur={() => setThresholdText(String(threshold))}
                   onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />%
          </label>
          <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Range">
            {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Direction">
            <option value="both">Up and down</option><option value="up">Up only</option><option value="down">Down only</option>
          </select>
          <button onClick={load} disabled={loading}>{loading ? "Scanning…" : "Rescan"}</button>
        </div>
      </header>

      {error && <p className="err">{error}. Check your connection and rescan.</p>}
      {loading && <p className="meta" role="status">Scanning all NSE equities. Results appear as batches finish; existing results stay usable.
        {range === "all" && " All-time results appear once historical enrichment is complete."}</p>}
      {data && <p className="meta">{data.count} matches from {data.available} analyzed / {data.scanned} listed stocks.
        {data.partial ? ` Scan in progress: ${data.processed} / ${data.scanned} checked. Results are incomplete.`
          : ` Scan completed ${new Date(data.updatedAt).toLocaleTimeString()}.`}
        {" "}Page refreshes every {REFRESH_MS / 60000} minutes while visible; full-market scans are cached for 5 minutes. Set Move to 0% to show all analyzable stocks.</p>}
      <div className="table-tools">
        <label className="search-label">Search stocks
          <input type="search" placeholder="Symbol, e.g. TCS or M&M" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>Sort by <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {Object.entries(SORT_OPTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label className="reverse-sort"><input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> Reverse order</label>
        {data && <span className="meta" role="status">{movers.length} of {data.count} matches shown</span>}
      </div>
      {data?.unavailable?.length > 0 && (
        <details>
          <summary>{data.unavailable.length} stocks could not be analyzed (missing data or insufficient history)</summary>
          <ul>{data.unavailable.map((stock) => <li key={stock.symbol}>{stock.symbol}: {stock.reason}</li>)}</ul>
        </details>
      )}
      {data?.count === 0 && !data.partial && <p>No stock has moved {data.threshold}% or more {RANGES[data.range || range].title}. Lower the threshold to see more.</p>}
      {data && movers.length === 0 && query.trim() && <p>No matching stock in the current results. Clear the search or lower the minimum move to 0% to search more stocks.</p>}

      {movers.length > 0 && (
        <div className="wrap"><table>
          <thead><tr>{sortHeader("symbol", "Stock")}{sortHeader("price", "Price")}
            {!isToday && sortHeader("gain", RANGES[data.range].label)}
            {sortHeader(isToday ? "gain" : "change", isToday ? "Change" : "Today")}
            {sortHeader("rsi", "RSI")}{sortHeader("volRatio", "Volume")}{sortHeader("score", "Score")}
            {sortHeader("verdict", "Verdict")}<th>Why</th></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.symbol}>
              <td data-label="Stock" className="stock-cell"><button className="stock-link" onClick={() => setSelected(m)} aria-label={`View ${m.symbol} details`}>{m.symbol}</button></td>
              <td data-label="Price">₹{m.price.toLocaleString("en-IN")}</td>
              {!isToday && <td data-label={RANGES[data.range].label} className={m.rangeChange >= 0 ? "up" : "down"}>{fmt(m.rangeChange)}</td>}
              <td data-label={isToday ? "Change" : "Today"} className={m.change >= 0 ? "up" : "down"}>{fmt(m.change)}</td>
              <td data-label="RSI">{m.rsi ?? "-"}</td>
              <td data-label="Volume">{m.volRatio ? `${m.volRatio}x` : "-"}</td>
              <td data-label="Score">{m.score}</td>
              <td data-label="Verdict"><span className={`v ${m.verdict}`}>{m.verdict}</span></td>
              <td data-label="Why" className="why">{m.reasons.join(" · ")}</td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      {selected && <StockDialog key={selected.symbol} stock={selected} onClose={() => setSelected(null)} />}

      {pages > 1 && (
        <nav className="pager" aria-label="Pagination">
          <button onClick={() => setPage(1)} disabled={current === 1}>«</button>
          <button onClick={() => setPage(current - 1)} disabled={current === 1}>‹ Prev</button>
          <span>Page {current} of {pages} · {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, movers.length)} of {movers.length}</span>
          <button onClick={() => setPage(current + 1)} disabled={current === pages}>Next ›</button>
          <button onClick={() => setPage(pages)} disabled={current === pages}>»</button>
        </nav>
      )}
      <footer>Technical signals only, not investment advice. Check news and results for why a stock moved.</footer>
    </main>
  );
}
