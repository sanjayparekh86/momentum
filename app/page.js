"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { RANGES } from "@/lib/ranges";
import { SORT_OPTIONS, selectMovers, sortsAscending } from "@/lib/table";
import SignalBadge from "./SignalBadge";
import StockDialog from "./StockDialog";
import PredictionJournal from "./PredictionJournal";
import Link from "next/link";
import useJournal from "./useJournal";
import { hasJournalStock } from "@/lib/journal";

const REFRESH_MS = 300000;
const PAGE_SIZE = 100;
const PROGRESS_MS = 5000;

export default function Home() {
  const [data, setData] = useState(null);
  const [threshold, setThreshold] = useState(5);
  const [thresholdText, setThresholdText] = useState("5");
  const [direction, setDirection] = useState("both");
  const [range, setRange] = useState("1d");
  const [scanOptions, setScanOptions] = useState({ threshold: 5, direction: "both", range: "1d" });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("movement");
  const [reverse, setReverse] = useState(false);
  const [selected, setSelected] = useState(null);
  const [journalSelection, setJournalSelection] = useState(null);
  const { data: journalData, error: journalError } = useJournal();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqId = useRef(0);
  const inFlight = useRef(false);
  const request = useRef(null);

  const load = useCallback(async () => {
    const { threshold, direction, range } = scanOptions;
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
      if (!finished && !controller.signal.aborted) timer = setTimeout(poll, PROGRESS_MS);
    };
    if (range !== "all") timer = setTimeout(poll, PROGRESS_MS);
    try {
      const r = await fetch(`/api/screener?${params}&save=1`, { signal: controller.signal });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `Request failed (${r.status})`);
      if (id === reqId.current) { setData(json); setError(""); }
    } catch (e) { if (!controller.signal.aborted && id === reqId.current) setError(e.message); }
    finally { finished = true; clearTimeout(timer); }
    if (id === reqId.current) { inFlight.current = false; setLoading(false); }
  }, [scanOptions]);

  // Only refresh while visible; local search and sorting never start a scan.
  useEffect(() => {
    load();
    const tick = () => { if (document.visibilityState === "visible" && !inFlight.current) load(); };
    const t = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); request.current?.abort(); };
  }, [load]);

  useEffect(() => { setPage(1); }, [scanOptions, query, sort, reverse]);

  const optionsChanged = threshold !== scanOptions.threshold || direction !== scanOptions.direction || range !== scanOptions.range;
  const manualScan = () => {
    if (optionsChanged) setScanOptions({ threshold, direction, range });
    else load();
  };
  const openJournal = (stock) => {
    setSelected(null);
    setJournalSelection({ symbol: stock.symbol, view: hasJournalStock(journalData, stock.symbol) ? "history" : "create" });
  };

  const movers = useMemo(() => selectMovers(data?.movers || [], query, sort, reverse), [data, query, sort, reverse]);
  const pages = Math.max(1, Math.ceil(movers.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = movers.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const isToday = (data?.range || range) === "1d";
  const fmt = (v) => Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v}%` : "-";
  const trend = (v) => Number.isFinite(v) ? (v >= 0 ? "up" : "down") : undefined;
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
    <p className="meta screener-notice">Technical signals only, not investment advice. Check news and results for why a stock moved.</p>
      <header>
        <h1>Movers over {data?.threshold ?? scanOptions.threshold}% {RANGES[data?.range || scanOptions.range].title}</h1>
        <div className="controls">
          <Link className="button-link" href="/watchlist">My watchlist</Link>
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
          <button className="btn btn-primary" onClick={manualScan} disabled={loading}>{loading ? "Scanning…" : "Rescan"}</button>
        </div>
      </header>
      {optionsChanged && <p className="meta" role="status">Options changed. Click Rescan to apply them; existing results still use the previous scan settings.</p>}
      {journalError && <p className="err" role="alert">{journalError} Journal membership could not be loaded.</p>}

      {error && <p className="err">{error}. Check your connection and rescan.</p>}
      {loading && <p className="meta" role="status">Scanning all NSE equities. Results appear as batches finish; existing results stay usable.
        {scanOptions.range === "all" && " All-time results appear once historical enrichment is complete."}</p>}
      {data && <p className="meta">{data.count} matches from {data.available} analyzed / {data.scanned} listed stocks
        {data.insufficient > 0 && ` (${data.insufficient} with insufficient data)`}.
        {data.partial ? ` Scan in progress: ${data.processed} / ${data.scanned} checked. Results are incomplete.`
          : ` Scan completed ${new Date(data.updatedAt).toLocaleTimeString()}.`}
        {" "}Page refreshes every {REFRESH_MS / 60000} minutes while visible; full-market scans are cached for 5 minutes. Set Move to 0% with Up and down to show every listed stock.</p>}
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
      {data?.count === 0 && !data.partial && <p>No stock has moved {data.threshold}% or more {RANGES[data.range || range].title}. Lower the threshold to see more.</p>}
      {data && movers.length === 0 && query.trim() && <p>No matching stock in the current results. Clear the search or lower the minimum move to 0% to search more stocks.</p>}

      {movers.length > 0 && (
        <div className="wrap"><table>
          <thead><tr>{sortHeader("symbol", "Stock")}{sortHeader("price", "Price")}
            {!isToday && sortHeader("gain", RANGES[data.range].label)}
            {sortHeader(isToday ? "gain" : "change", isToday ? "Change" : "Today")}
            {sortHeader("rsi", "RSI")}{sortHeader("volRatio", "Volume")}{sortHeader("score", "Score")}
            {sortHeader("signal", "Signal")}<th>Why</th><th>Journal</th></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.symbol} className={m.insufficient ? "insufficient" : undefined}>
              <td data-label="Stock" className="stock-cell"><button className="stock-link" onClick={() => setSelected(m)} aria-label={`View ${m.symbol} details`}>{m.symbol}</button></td>
              <td data-label="Price">{Number.isFinite(m.price) ? `₹${m.price.toLocaleString("en-IN")}` : "-"}</td>
              {!isToday && <td data-label={RANGES[data.range].label} className={trend(m.rangeChange)}>{fmt(m.rangeChange)}</td>}
              <td data-label={isToday ? "Change" : "Today"} className={trend(m.change)}>{fmt(m.change)}</td>
              <td data-label="RSI">{m.rsi ?? "-"}</td>
              <td data-label="Volume">{m.volRatio ? `${m.volRatio}x` : "-"}</td>
              <td data-label="Score">{m.score ?? "-"}</td>
              <td data-label="Signal"><SignalBadge signal={m.signal} /></td>
              <td data-label="Why" className="why">{m.reasons.join(" · ")}</td>
              <td data-label="Journal"><button className={`btn btn-small ${hasJournalStock(journalData, m.symbol) ? "btn-ghost" : "btn-secondary"}`} onClick={() => openJournal(m)}>{hasJournalStock(journalData, m.symbol) ? "View your prediction" : "+ Watch / Predict"}</button></td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      {selected && <StockDialog key={selected.symbol} stock={selected} onClose={() => setSelected(null)} onJournal={openJournal}
        hasPrediction={hasJournalStock(journalData, selected.symbol)} />}
      {journalSelection && <PredictionJournal key={journalSelection.symbol} symbol={journalSelection.symbol}
        initialView={journalSelection.view} onClose={() => setJournalSelection(null)} onStock={setSelected} />}

      {pages > 1 && (
        <nav className="pager" aria-label="Pagination">
          <button onClick={() => setPage(1)} disabled={current === 1}>«</button>
          <button onClick={() => setPage(current - 1)} disabled={current === 1}>‹ Prev</button>
          <span>Page {current} of {pages} · {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, movers.length)} of {movers.length}</span>
          <button onClick={() => setPage(current + 1)} disabled={current === pages}>Next ›</button>
          <button onClick={() => setPage(pages)} disabled={current === pages}>»</button>
        </nav>
      )}
      <footer>Public trend signals only, not investment advice. Check news and company results for why a stock moved.</footer>
    </main>
  );
}
