"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { deadlineClose, evaluatePrediction, exchangeDate, exportJournal, importJournal,
  JOURNAL_SOURCE, mergeJournals, newPrediction, predictionProgress } from "@/lib/journal";
import { journalTransaction } from "@/lib/journal-storage";
import useJournal from "./useJournal";
import Link from "next/link";

const money = (n) => Number.isFinite(n) ? `INR ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "Unavailable";
const percent = (n) => Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(2)}%` : "-";
const priceChange = (n) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${money(Math.abs(n))}`;
const initialForm = { symbol: "", bucketId: "", direction: "up", targetPercent: "", deadline: "", reason: "", confidence: "" };
const shortDate = (value, timeZone) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone });

async function marketData(symbol, from, signal) {
  const params = new URLSearchParams({ symbol });
  if (from != null) params.set("from", String(Math.max(0, Math.floor(from / 1000) - 86400)));
  const response = await fetch(`/api/journal-market?${params}`, { signal, cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || `Market request failed (${response.status}).`);
  return json;
}

export default function PredictionJournal({ symbol = "", initialView = "history", onClose, onStock }) {
  const { data, setData, error: storageError, reload } = useJournal();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshingSymbol, setRefreshingSymbol] = useState(null);
  const [view, setView] = useState(initialView);
  const [bucketName, setBucketName] = useState("");
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [historyPage, setHistoryPage] = useState(1);
  const [watchPage, setWatchPage] = useState(1);
  const [form, setForm] = useState({ ...initialForm, symbol });
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState("");
  const [observations, setObservations] = useState({});
  const [messages, setMessages] = useState({});
  const [reflection, setReflection] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showBucketForm, setShowBucketForm] = useState(false);
  const container = useRef(null);
  const formStart = useRef(null);
  const upload = useRef(null);
  const working = useRef(false);
  const refreshController = useRef(null);
  const isDialog = !!onClose;

  useEffect(() => {
    if (isDialog) container.current.showModal();
    return () => refreshController.current?.abort();
  }, [isDialog]);

  useEffect(() => {
    setQuote(null); setQuoteError("");
    if (view !== "create" || !/^[A-Z0-9&_.-]{1,64}$/.test(form.symbol)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      marketData(form.symbol, null, controller.signal).then((market) => {
        if (!controller.signal.aborted) {
          if (!market.quote) throw new Error("Provider did not supply a timestamped quote.");
          setQuote({ ...market.quote, symbol: form.symbol });
        }
      }).catch((e) => { if (!controller.signal.aborted) setQuoteError(e.message); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [form.symbol, view]);

  const persist = async (update) => {
    const state = await journalTransaction(update);
    setData(state);
    return state;
  };
  const run = async (action) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (e) { setError(e.message); }
    finally { working.current = false; setBusy(false); }
  };

  const refresh = (onlySymbol = null) => run(async () => {
    const controller = new AbortController();
    refreshController.current = controller;
    const state = await journalTransaction();
    const symbols = [...new Set([...state.stocks.map((s) => s.symbol),
      ...state.predictions.map((p) => p.symbol)])]
      .filter((candidate) => (!symbol || candidate === symbol) && (!onlySymbol || candidate === onlySymbol));
    const failures = [];
    let completed = 0;
    for (const symbol of symbols) {
      if (controller.signal.aborted) return;
      setNotice(`Checking ${symbol} (${++completed}/${symbols.length})...`);
      const pending = state.predictions.filter((p) => p.symbol === symbol && p.status === "pending");
      const from = pending.length ? Math.min(...pending.map((p) => Date.parse(p.referenceAt))) : null;
      setRefreshingSymbol(symbol);
      try {
        const market = await marketData(symbol, from, controller.signal);
        if (controller.signal.aborted) return;
        if (market.quote) setObservations((previous) => ({ ...previous, [symbol]: market.quote }));
        else failures.push(`${symbol}: No timestamped market quote returned. Showing the last available observation, if any.`);
        const notes = {};
        await persist((current) => ({
          ...current,
          predictions: current.predictions.map((p) => {
            if (p.symbol !== symbol) return p;
            const progress = predictionProgress(p, market.quote);
            const updated = progress ? { ...p, latest: progress.quote } : p;
            if (!pending.some((old) => old.id === p.id) || p.status !== "pending") return updated;
            const result = evaluatePrediction(updated, { ...market, quote: progress?.quote || null });
            notes[p.id] = result.message;
            return result.prediction;
          }),
        }));
        setMessages((previous) => ({ ...previous, ...notes }));
      } catch (e) {
        if (controller.signal.aborted) return;
        failures.push(`${symbol}: ${e.message}`);
        setMessages((previous) => ({ ...previous,
          ...Object.fromEntries(pending.map((p) => [p.id, `Unable to check: ${e.message}`])) }));
      } finally {
        setRefreshingSymbol(null);
      }
    }
    setNotice(symbols.length ? `${onlySymbol ? `${onlySymbol} price and results` : "Prices and results"} updated. Missing data stays pending.` : "");
    if (failures.length) throw new Error(failures.join(" | "));
  });

  const ready = data !== null;
  useEffect(() => {
    if (ready) refresh();
    // Only check on mount/storage readiness, not after each IndexedDB update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const activeBucket = form.bucketId || data?.buckets[0]?.id || "";
  const updateForm = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const requireBucket = () => {
    if (!activeBucket) throw new Error("Create a bucket first.");
  };
  const addStock = () => run(async () => {
    requireBucket();
    if (!/^[A-Z0-9&_.-]{1,64}$/.test(form.symbol)) throw new Error("Enter a valid NSE symbol.");
    await persist((state) => {
      if (state.stocks.some((s) => s.symbol === form.symbol && s.bucketId === activeBucket)) {
        throw new Error("This stock is already in that bucket.");
      }
      return { ...state, stocks: [...state.stocks, {
        id: crypto.randomUUID(), bucketId: activeBucket, symbol: form.symbol, createdAt: new Date().toISOString(),
      }] };
    });
    setNotice(`${form.symbol} added to your watchlist.`);
    setView("history");
  });
  const savePrediction = (event) => {
    event.preventDefault();
    run(async () => {
      requireBucket();
      const market = await marketData(form.symbol);
      if (!market.quote) throw new Error("Provider did not supply a timestamped reference quote.");
      setQuote({ ...market.quote, symbol: form.symbol });
      const prediction = newPrediction({ ...form, bucketId: activeBucket, id: crypto.randomUUID() }, market.quote);
      prediction.latest = market.quote;
      await persist((state) => ({
        ...state,
        stocks: state.stocks.some((s) => s.symbol === form.symbol && s.bucketId === activeBucket) ? state.stocks
          : [...state.stocks, { id: crypto.randomUUID(), symbol: form.symbol, bucketId: activeBucket, createdAt: prediction.createdAt }],
        predictions: [...state.predictions, prediction],
      }));
      setNotice(`Prediction saved for ${form.symbol}. Its terms are now locked.`);
      setHistoryPage(1);
      setView("history");
    });
  };
  const download = () => run(async () => {
    const state = await journalTransaction();
    const csv = exportJournal(state);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    if (blob.size > 5 * 1024 * 1024) throw new Error("Backup exceeds the 5 MB import limit. Shorten learning notes before exporting.");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `momentum-journal-${exchangeDate()}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("CSV backup downloaded. Keep it private; it includes your notes and history.");
  });
  const importFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    run(async () => {
      if (file.size > 5 * 1024 * 1024) throw new Error("CSV backup must be 5 MB or smaller.");
      const incoming = importJournal(await file.text());
      await persist((state) => mergeJournals(state, incoming));
      setNotice("Backup merged successfully. Identical records were skipped; nothing was overwritten.");
    });
  };
  const predictions = (data?.predictions || []).filter((p) => !symbol || p.symbol === symbol);
  const evaluated = predictions.filter((p) => p.status === "completed");
  const correct = evaluated.filter((p) => p.evaluation.directionCorrect).length;
  const targets = evaluated.filter((p) => p.targetPercent !== null);
  const targetHits = targets.filter((p) => p.evaluation.result === "target achieved").length;
  const history = predictions.filter((p) => (!filter || p.bucketId === filter)
    && (statusFilter === "all" || p.status === statusFilter)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const watches = (data?.stocks || []).filter((s) => (!symbol || s.symbol === symbol) && (!filter || s.bucketId === filter));
  const watchPages = Math.max(1, Math.ceil(watches.length / 100));
  const currentWatchPage = Math.min(watchPage, watchPages);
  const totalPages = Math.max(1, Math.ceil(history.length / 20));
  const currentPage = Math.min(historyPage, totalPages);
  const pendingCount = predictions.filter((p) => p.status === "pending").length;
  const watchedCount = new Set((data?.stocks || []).filter((s) => !symbol || s.symbol === symbol).map((s) => s.symbol)).size;
  const bucket = (id) => data?.buckets.find((b) => b.id === id)?.name || "";
  const pickStock = (symbol) => onStock({ symbol, signal: "INSUFFICIENT", reasons: ["Open details to load technical information."] });
  const repeat = (p) => {
    setView("create");
    setForm({ ...initialForm, symbol: p.symbol, bucketId: p.bucketId, direction: p.direction });
  };
  useEffect(() => {
    if (view === "create") {
      formStart.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      formStart.current?.focus();
    }
  }, [view, ready]);
  const Container = onClose ? "dialog" : "section";

  return (
    <Container ref={container} className={`journal${onClose ? " journal-dialog" : ""}`} aria-label={symbol ? `${symbol} watchlist and predictions` : "Personal prediction journal"}
      onClose={onClose} onClick={onClose ? (event) => { if (event.target === container.current) container.current.close(); } : undefined}>
      <div className="journal-content">
        {(isDialog || view === "create") && <header className="journal-heading">
          <div>
            <span className="eyebrow">{symbol ? "STOCK JOURNAL" : "YOUR WORKSPACE"}</span>
            <h2>{symbol || (view === "create" ? "Add to your journal" : "Watch, predict, learn.")}</h2>
            <p className="meta">{view === "create" ? "Save a stock for later, or record what you think happens next." : "Your stocks and expectations, all in one place."}</p>
          </div>
          {onClose && <button className="btn btn-secondary" autoFocus onClick={() => container.current.close()}>Close</button>}
        </header>}
        <div className="journal-toolbar">
          <div className="journal-tabs" aria-label="Journal view">
            <button aria-pressed={view === "history"} onClick={() => setView("history")}>Overview</button>
            <button aria-pressed={view === "create"} onClick={() => setView("create")}>Add stock / prediction</button>
          </div>
          <div className="journal-actions">
            {view === "history" && <button className="btn btn-secondary" disabled={!ready || busy} onClick={() => refresh()}>{busy ? "Refreshing..." : "Refresh prices"}</button>}
            {!onClose && <details className="backup-menu">
              <summary className="btn btn-secondary">Import / Export</summary>
              <div className="backup-options">
                <strong>Take your journal with you</strong>
                <p>CSV backups open in Excel. Import the original backup to restore on another browser.</p>
                <button className="btn btn-secondary" disabled={!ready || busy} onClick={download}>Export CSV backup</button>
                <button className="btn btn-secondary" disabled={!ready || busy} onClick={() => upload.current.click()}>Import CSV backup</button>
                <small>Identical records are skipped. Conflicting versions are rejected, never overwritten.</small>
              </div>
            </details>}
            {view === "history" && <button className="btn btn-primary" onClick={() => setView("create")}><span aria-hidden="true">+</span> Add stock</button>}
          </div>
        </div>
        <div className="local-notice"><span className="local-dot" aria-hidden="true" /><span>Stored on this device only. <strong>No account needed.</strong> Export a backup before clearing browser data.</span></div>
        {(error || storageError) && <p className="journal-feedback err" role="alert">{error || storageError} {!ready && <button className="btn btn-secondary" onClick={() => run(reload)}>Retry storage</button>}</p>}
        {notice && <p className="journal-feedback" role="status">{notice}</p>}
        <input ref={upload} type="file" accept=".csv,text/csv" hidden onChange={importFile} aria-label="Import journal CSV" />
        {!ready ? <p className="journal-empty">Loading your local journal...</p> : <>
          {view === "create" && <>
          <section className="journal-panel entry-panel">
          <div className="panel-heading"><div><span className="eyebrow">01 / CHOOSE YOUR STOCK</span><h3 ref={formStart} tabIndex={-1}>Where should it belong?</h3></div>
            {data.buckets.length > 0 && <button className="btn btn-ghost" aria-expanded={showBucketForm} onClick={() => setShowBucketForm(!showBucketForm)}>{showBucketForm ? "Never mind" : "+ New bucket"}</button>}
          </div>
          {(!data.buckets.length || showBucketForm) && <form className="bucket-create" onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              const name = bucketName.trim();
              if (!name) throw new Error("Enter a bucket name.");
              const id = crypto.randomUUID();
              await persist((state) => {
                if (state.buckets.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw new Error("A bucket with that name already exists.");
                return { ...state, buckets: [...state.buckets, { id, name, createdAt: new Date().toISOString() }] };
              });
              setBucketName(""); updateForm("bucketId", id); setShowBucketForm(false);
            });
          }}>
            <label>{data.buckets.length ? "New bucket name" : "Start by creating your first bucket"}<input required maxLength={80} value={bucketName} onChange={(e) => setBucketName(e.target.value)} placeholder="e.g. Long-term ideas" /></label>
            <button className="btn btn-secondary" disabled={busy}>Create bucket</button>
          </form>}
          <form className="journal-form" onSubmit={savePrediction}>
            <fieldset disabled={busy}>
              <label>Bucket <select required value={activeBucket} onChange={(e) => updateForm("bucketId", e.target.value)}>
                {!data.buckets.length && <option value="">Create a bucket first</option>}
                {data.buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
              <label>NSE symbol <input required readOnly={!!symbol} maxLength={64} value={form.symbol} onChange={(e) => updateForm("symbol", e.target.value.trim().toUpperCase())} placeholder="TCS" /></label>
              <div className="full-width watch-only-row"><span className="meta">Save it now. Make a prediction later.</span><button className="btn btn-secondary" type="button" disabled={!activeBucket || !form.symbol} onClick={addStock}>Watch only</button></div>
              <div className="full-width form-divider"><span className="eyebrow">02 / RECORD YOUR EXPECTATION</span><h3>What do you think happens next?</h3><p className="meta">Ready to make a prediction? Add your direction and deadline.</p></div>
              <div className="direction-field"><span id={isDialog ? "dialog-direction" : "page-direction"}>Expected direction</span>
                <div className="direction-picker" role="group" aria-labelledby={isDialog ? "dialog-direction" : "page-direction"}>
                  <button type="button" className="direction-up" aria-pressed={form.direction === "up"} onClick={() => updateForm("direction", "up")}>Up</button>
                  <button type="button" className="direction-down" aria-pressed={form.direction === "down"} onClick={() => updateForm("direction", "down")}>Down</button>
                </div>
              </div>
              <label>Optional target move (%) <input type="number" min="0.000001" step="any" max={form.direction === "down" ? "99.999999" : undefined}
                value={form.targetPercent} onChange={(e) => updateForm("targetPercent", e.target.value)} placeholder="Direction only" /></label>
              <label>Deadline date <input required type="date" min={exchangeDate()} value={form.deadline} onChange={(e) => updateForm("deadline", e.target.value)} /><small>Weekday close at 15:30 India time.</small></label>
              <label>Optional confidence (0-100%) <input type="number" min="0" max="100" step="any" value={form.confidence} onChange={(e) => updateForm("confidence", e.target.value)} /></label>
              <label className="full-width">Your reasoning <span className="optional">(optional)</span><textarea maxLength={4000} value={form.reason} onChange={(e) => updateForm("reason", e.target.value)} placeholder="What did you notice? Write a note for your future self." /></label>
              <div className="full-width">
                {quote && quote.symbol === form.symbol && <div className="quote-preview"><div><span className="eyebrow">REFERENCE PREVIEW</span><strong>{money(quote.price)}</strong><small>{new Date(quote.at).toLocaleString()}</small></div>
                  {form.targetPercent !== "" && <div><span className="eyebrow">YOUR TARGET</span><strong>{money(quote.price * (1 + (form.direction === "up" ? 1 : -1) * Number(form.targetPercent) / 100))}</strong></div>}</div>}
                {quoteError && <p className="err" role="alert">Quote: {quoteError}. Saving retries the quote request.</p>}
                <p className="form-hint">{JOURNAL_SOURCE}. A fresh quote is captured on save. Prediction terms are then locked; learning notes remain editable.</p>
                <div className="form-footer"><button className="btn btn-ghost" type="button" onClick={() => setView("history")}>Back to overview</button>
                  <button className="btn btn-primary" type="submit" disabled={!activeBucket || !form.symbol}>{busy ? "Saving..." : "Save prediction"}</button>
                </div>
              </div>
            </fieldset>
          </form>
          </section>
          </>}
          {view === "history" && <>
          <dl className="journal-stats">
            <div><dt>Stocks watched</dt><dd>{watchedCount}</dd><small>Across your buckets</small></div>
            <div><dt>Active predictions</dt><dd>{pendingCount}</dd><small>Pending or awaiting data</small></div>
            <div><dt>Direction accuracy</dt><dd>{evaluated.length ? `${Math.round(correct / evaluated.length * 100)}%` : "--"}</dd><small>{correct} of {evaluated.length} evaluated</small></div>
            <div><dt>Targets achieved</dt><dd>{targetHits}<span> / {targets.length}</span></dd><small>Evaluated percentage targets</small></div>
          </dl>
          <nav className="bucket-nav" aria-label="Filter by bucket">
            <button aria-pressed={!filter} onClick={() => { setFilter(""); setHistoryPage(1); setWatchPage(1); }}>All buckets <span>{data.buckets.length}</span></button>
            {data.buckets.map((b) => <button key={b.id} aria-pressed={filter === b.id} onClick={() => { setFilter(b.id); setHistoryPage(1); setWatchPage(1); }}>{b.name}</button>)}
            <button className="new-bucket" onClick={() => { setShowBucketForm(true); setView("create"); }}>+ New bucket</button>
          </nav>
          <section className="journal-panel">
          <div className="panel-heading"><div><h3>Watching <span className="count-pill">{watches.length}</span></h3><p className="meta">Keep an eye on your next idea.</p></div></div>
          {!watches.length && <div className="journal-empty"><span className="empty-mark" aria-hidden="true">+</span><h4>{filter ? "This bucket is waiting for ideas" : "Your next idea starts here"}</h4><p>Add a stock to watch it, or record a prediction to learn from later.</p>
            <button className="btn btn-primary" onClick={() => { if (filter) updateForm("bucketId", filter); setView("create"); }}>Add your first stock</button></div>}
          {watches.length > 0 && <div className="journal-table" tabIndex={0} role="region" aria-label="Watched stocks table"><table>
            <thead><tr><th>Stock</th><th>Bucket</th><th>Latest quote</th><th>Actions</th></tr></thead>
            <tbody>{watches.slice((currentWatchPage - 1) * 100, currentWatchPage * 100).map((s) => (
            <tr key={s.id}>
              <td><button className="stock-link" onClick={() => pickStock(s.symbol)}>{s.symbol}</button></td>
              <td><span className="bucket-label">{bucket(s.bucketId)}</span></td>
              <td>{observations[s.symbol] ? <><strong>{money(observations[s.symbol].price)}</strong><small className="cell-subtext">{new Date(observations[s.symbol].at).toLocaleString()}</small></> : <span className="meta">Not checked yet</span>}</td>
              <td><div className="row-actions"><button className="btn btn-secondary btn-small" disabled={busy} onClick={() => repeat({ ...s, direction: "up" })}>+ Predict</button>
              <button className="btn btn-ghost btn-small" disabled={busy} aria-label={`Remove ${s.symbol} from ${bucket(s.bucketId)}`} onClick={() => run(async () => {
                await persist((state) => ({ ...state, stocks: state.stocks.filter((stock) => stock.id !== s.id) }));
                setNotice("Removed from watchlist. Prediction history was retained.");
              })}>Remove</button></div></td>
            </tr>
          ))}</tbody></table></div>}
          {watchPages > 1 && <nav className="pager" aria-label="Watchlist pagination">
            <button disabled={currentWatchPage === 1} onClick={() => setWatchPage(currentWatchPage - 1)}>Previous watches</button>
            <span>Page {currentWatchPage} of {watchPages}</span>
            <button disabled={currentWatchPage === watchPages} onClick={() => setWatchPage(currentWatchPage + 1)}>Next watches</button>
          </nav>}
          </section>
          <section className="journal-panel">
          <div className="panel-heading"><div><h3>Prediction history <span className="count-pill">{history.length}</span></h3><p className="meta">Compare what you expected with what happened.</p></div>
          <label className="status-filter"><span className="sr-only">Filter prediction status</span><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setHistoryPage(1); }}>
            <option value="all">All statuses</option><option value="pending">Pending / awaiting data</option>
            <option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select></label>
          </div>
          {!history.length && <div className="journal-empty compact-empty"><h4>{predictions.length ? "No predictions in this view" : "A small prediction. A useful lesson."}</h4><p>{predictions.length ? "Try another bucket or status filter." : "Record a direction and a deadline. Come back to see how it played out."}</p></div>}
          {history.length > 0 && <>
          <p className="table-scroll-hint">Movement is measured from your reference price, not today&apos;s open. Yahoo quotes may be delayed or from the previous session. Refresh prices to check again. Current progress is not the final deadline result.</p>
          <div className="journal-table prediction-table" tabIndex={0} role="region" aria-label="All stock predictions table"><table>
            <thead><tr><th>Stock</th><th>Expectation</th><th>Reference</th><th>Current market price</th>
              <th>Movement / Progress</th><th>Deadline</th><th>Deadline result</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{history.slice((currentPage - 1) * 20, currentPage * 20).map((p) => {
            const progress = predictionProgress(p, observations[p.symbol]);
            const expanded = expandedId === p.id;
            const detailId = `${isDialog ? "dialog" : "page"}-prediction-${p.id}`;
            const result = p.status === "completed" ? p.evaluation.result : p.status;
            const tone = p.status === "pending" ? "pending" : p.status === "cancelled" ? "muted"
              : p.evaluation.result === "incorrect" ? "negative" : p.evaluation.result === "unchanged" ? "muted" : "positive";
            return <Fragment key={p.id}><tr className={expanded ? "expanded" : undefined}>
              <td><button className="stock-link" onClick={() => pickStock(p.symbol)}>{p.symbol}</button><small className="cell-subtext">{bucket(p.bucketId)}</small></td>
              <td><span className={`direction-label ${p.direction}`}>{p.direction === "up" ? "Up" : "Down"}{p.targetPercent !== null && ` ${p.targetPercent}%`}</span>
                <small className="cell-subtext">{p.targetPercent !== null ? `Target ${money(p.referencePrice * (1 + (p.direction === "up" ? 1 : -1) * p.targetPercent / 100))}` : "Direction only"}</small></td>
              <td className="numeric-cell">{money(p.referencePrice)}<small className="cell-subtext">{shortDate(p.referenceAt)}</small></td>
              <td className="numeric-cell"><div className="quote-with-refresh">
                {progress ? <strong>{money(progress.quote.price)}</strong> : <span className="meta">Unavailable</span>}
                <button type="button" className="btn btn-ghost quote-refresh" disabled={busy}
                  aria-label={`Refresh ${p.symbol} price and prediction`} title={`Refresh ${p.symbol} price and prediction`}
                  aria-busy={refreshingSymbol === p.symbol} onClick={() => refresh(p.symbol)}>
                  <svg className={refreshingSymbol === p.symbol ? "refresh-spinning" : undefined} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5" />
                  </svg>
                </button>
              </div>{progress && <><small className="cell-subtext">{new Date(progress.quote.at).toLocaleString()}</small><small className="cell-subtext">Latest available quote</small></>}</td>
              <td>{progress ? <><strong className={`movement-value ${progress.change > 0 ? "up" : progress.change < 0 ? "down" : "meta"}`}>{priceChange(progress.change)} ({percent(progress.movement)})</strong>
                <small className="cell-subtext"><span className={`result-pill ${progress.tone}`}>{progress.label}</span></small></> : <span className="meta">Awaiting price</span>}</td>
              <td>{shortDate(`${p.deadline}T00:00:00+05:30`, "Asia/Kolkata")}<small className="cell-subtext">15:30 India</small></td>
              <td><span className={`result-pill ${tone}`}>{result === "pending" ? "Pending" : result === "cancelled" ? "Cancelled" : result}</span>
                {p.evaluation && <><small className="cell-subtext">Close: {money(p.evaluation.price)}</small><small className="cell-subtext">{percent(p.evaluation.movement)} at deadline</small></>}</td>
              <td><button className="btn btn-ghost btn-small" aria-label={`${expanded ? "Hide" : "View"} ${p.symbol} prediction details`} aria-expanded={expanded}
                aria-controls={detailId} onClick={() => { setExpandedId(expanded ? null : p.id); setReflection(null); }}>{expanded ? "Hide" : "Details"}</button></td>
            </tr>
            <tr className="prediction-detail-row" hidden={!expanded} id={detailId}><td colSpan={8}>
              <div className="prediction-detail">
              <div><h4>Your reasoning</h4><p className="journal-note">{p.reason || "No reason recorded."}</p>
                <div className="evidence-meta"><p>Reference quote: {new Date(p.referenceAt).toLocaleString()}</p>
                <p>Created: {new Date(p.createdAt).toLocaleString()}</p>
                {p.confidence !== null && <p>Confidence: {p.confidence}%</p>}
                {progress && <p>Latest quote: {money(progress.quote.price)} at {new Date(progress.quote.at).toLocaleString()}. Movement: {priceChange(progress.change)} ({percent(progress.movement)}). {progress.label}.</p>}
                {p.evaluation && <p>Final close: {money(p.evaluation.price)} at {new Date(p.evaluation.at).toLocaleString()}.</p>}
                {p.status === "pending" && <p>{messages[p.id] || (Date.now() > deadlineClose(p.deadline) ? "Awaiting deadline data; refresh to check." : "Pending deadline.")}</p>}
                {p.evaluation && <p>Evaluated {new Date(p.evaluation.checkedAt).toLocaleString()} using {p.evaluation.source}; {p.evaluation.rule}.</p>}</div>
              </div>
              <div><h4>What did you learn?</h4>
              {reflection?.id === p.id ? <form onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  await persist((state) => ({ ...state, predictions: state.predictions.map((item) => item.id === p.id ? { ...item, reflection: reflection.text } : item) }));
                  setReflection(null);
                });
              }}>
                <label><span className="sr-only">Learning notes</span><textarea autoFocus maxLength={4000} value={reflection.text} onChange={(e) => setReflection({ id: p.id, text: e.target.value })} placeholder="A lesson to remember next time..." /></label>
                <div className="journal-actions"><button className="btn btn-primary btn-small" disabled={busy}>Save notes</button><button className="btn btn-ghost btn-small" type="button" onClick={() => setReflection(null)}>Discard</button></div>
              </form> : <><p className="journal-note">{p.reflection || "Add a reflection for your next prediction."}</p>
                <button className="btn btn-secondary btn-small" disabled={busy} onClick={() => setReflection({ id: p.id, text: p.reflection })}>{p.reflection ? "Edit notes" : "+ Add learning notes"}</button></>}
              </div>
              <div className="detail-footer">
                <button className="btn btn-secondary btn-small" disabled={busy} onClick={() => repeat(p)}>+ Make another prediction</button>
                {p.status === "pending" && <button className="btn btn-danger btn-small" disabled={busy} onClick={() => run(async () => {
                  await persist((state) => ({ ...state, predictions: state.predictions.map((item) => item.id === p.id && item.status === "pending" ? { ...item, status: "cancelled" } : item) }));
                  setNotice("Prediction cancelled. Its original terms remain in history.");
                })}>Cancel prediction</button>}
              </div></div></td></tr>
            </Fragment>;
          })}</tbody></table></div></>}
          {totalPages > 1 && <nav className="pager" aria-label="Prediction history pagination">
            <button disabled={currentPage === 1} onClick={() => setHistoryPage(currentPage - 1)}>Previous</button>
            <span>Page {currentPage} of {totalPages}</span>
            <button disabled={currentPage === totalPages} onClick={() => setHistoryPage(currentPage + 1)}>Next</button>
          </nav>}
          </section>
          <p className="journal-disclaimer">For personal learning, not investment advice. Statistics cover {symbol ? `${symbol} across ` : ""}all buckets and exclude pending, missing-data and cancelled records. Unchanged prices are not directional successes.</p>
          </>}
          <details className="journal-help"><summary>How predictions &amp; local storage work</summary>
            <div><p>Results compare the chosen weekday&apos;s 15:30 India close with your reference quote, checked after 18:00 India time. A target must be met at that close, not just touched earlier. Holidays or missing prices remain awaiting data. Nothing runs while the page is closed.</p>
              <p>Prices may be delayed. Dividends are excluded; stock splits require manual review. Local history is editable and unverified, not an investment return or a guarantee of future results.</p>
              <p>Clearing site data or using private browsing can lose your journal. CSV backups include your personal notes. Import original Momentum CSV files, not re-saved Excel workbooks.</p>
              {onClose && <Link href="/watchlist">Open full watchlist to manage buckets and backups</Link>}
            </div>
          </details>
        </>}
      </div>
    </Container>
  );
}
