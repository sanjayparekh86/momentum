"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { RANGES } from "@/lib/ranges";

const REFRESH_MS = 30000;
const PAGE_SIZE = 100;

export default function Home() {
  const [data, setData] = useState(null);
  const [threshold, setThreshold] = useState(5);
  const [direction, setDirection] = useState("both");
  const [range, setRange] = useState("1d");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqId = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    inFlight.current = true;
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/screener?threshold=${threshold}&direction=${direction}&range=${range}&save=1`);
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `Request failed (${r.status})`);
      if (id === reqId.current) setData(json);
    } catch (e) { if (id === reqId.current) setError(e.message); }
    if (id === reqId.current) { inFlight.current = false; setLoading(false); }
  }, [threshold, direction, range]);

  // Initial load + auto refresh every 30s, only while the tab is visible.
  useEffect(() => {
    load();
    const tick = () => { if (document.visibilityState === "visible" && !inFlight.current) load(); };
    const t = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  useEffect(() => { setPage(1); }, [threshold, direction, range]);

  const movers = data?.movers || [];
  const pages = Math.max(1, Math.ceil(movers.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = movers.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const isToday = (data?.range || range) === "1d";
  const fmt = (v) => `${v > 0 ? "+" : ""}${v}%`;

  return (
    <main>
      <header>
        <h1>Movers over {threshold}% {RANGES[range].title}</h1>
        <div className="controls">
          <label>Move ≥
            <input type="number" min="0" step="0.5" value={threshold}
                   onChange={(e) => setThreshold(e.target.value === "" ? 5 : Number(e.target.value))} />%
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
      {loading && <p className="meta">Scanning all NSE equities. A fresh full-market scan can take several minutes.</p>}
      {data && <p className="meta">{data.count} matches from {data.available} analyzed / {data.scanned} listed stocks. Scan completed {new Date(data.updatedAt).toLocaleTimeString()}. Page refreshes every 30 seconds while visible; full-market scans are cached for 5 minutes. Set Move to 0% to show all analyzable stocks.</p>}
      {data?.unavailable?.length > 0 && (
        <details>
          <summary>{data.unavailable.length} stocks could not be analyzed (missing data or insufficient history)</summary>
          <ul>{data.unavailable.map((stock) => <li key={stock.symbol}>{stock.symbol}: {stock.reason}</li>)}</ul>
        </details>
      )}
      {data?.count === 0 && <p>No stock has moved {threshold}% or more {RANGES[data.range || range].title}. Lower the threshold to see more.</p>}

      {data?.count > 0 && (
        <div className="wrap"><table>
          <thead><tr><th>Stock</th><th>Price</th>{!isToday && <th>{RANGES[data.range].label}</th>}<th>{isToday ? "Change" : "Today"}</th><th>RSI</th><th>Volume</th><th>Score</th><th>Verdict</th><th>Why</th></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.symbol}>
              <td><b>{m.symbol}</b></td>
              <td>₹{m.price.toLocaleString("en-IN")}</td>
              {!isToday && <td className={m.rangeChange >= 0 ? "up" : "down"}>{fmt(m.rangeChange)}</td>}
              <td className={m.change >= 0 ? "up" : "down"}>{fmt(m.change)}</td>
              <td>{m.rsi ?? "-"}</td>
              <td>{m.volRatio ? `${m.volRatio}x` : "-"}</td>
              <td>{m.score}</td>
              <td><span className={`v ${m.verdict}`}>{m.verdict}</span></td>
              <td className="why">{m.reasons.join(" · ")}</td>
            </tr>))}
          </tbody>
        </table></div>
      )}

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
