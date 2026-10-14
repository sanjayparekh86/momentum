"use client";
import { useEffect, useRef, useState } from "react";
import SignalBadge from "./SignalBadge";

export default function StockDialog({ stock, onClose }) {
  const dialog = useRef(null);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/stock?symbol=${encodeURIComponent(stock.symbol)}`, { signal: controller.signal })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`);
        if (!controller.signal.aborted) setDetails(json);
      })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [stock.symbol, attempt]);

  const info = details || stock;
  const number = (v) => Number.isFinite(v) ? v.toLocaleString("en-IN") : "Unavailable";
  const price = (v) => Number.isFinite(v) ? `${details?.currency || "INR"} ${number(v)}` : "Unavailable";
  const fields = [
    ["Latest quote", price(details?.marketPrice)], ["Latest daily close", price(info.price)],
    ["Daily change", Number.isFinite(info.change) ? `${info.change}%` : "Unavailable"],
    ["Open", price(details?.open)], ["Previous daily close", price(details?.previousClose)],
    ["Day high", price(details?.dayHigh)], ["Day low", price(details?.dayLow)],
    ["52-week high", price(details?.yearHigh)], ["52-week low", price(details?.yearLow)],
    ["Volume", number(details?.volume)], ["Volume / 20-day average", Number.isFinite(info.volRatio) ? `${info.volRatio}x` : "Unavailable"],
    ["RSI (14)", number(info.rsi)], ["50-day SMA", price(info.sma50)],
    ["200-day SMA", price(info.sma200)], ["Technical score", number(info.score)],
    ["MACD (12, 26)", number(info.macd)], ["MACD signal (9)", number(info.macdSignal)],
  ];

  return (
    <dialog ref={dialog} className="stock-dialog" aria-labelledby="stock-title"
      onClose={onClose} onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }}>
      <article>
        <header className="dialog-header">
          <div><h2 id="stock-title">{details?.name || stock.symbol}</h2>
            <p className="meta">{stock.symbol} · {details?.exchange || "NSE"}</p></div>
          <button autoFocus onClick={() => dialog.current.close()} aria-label="Close stock details">Close</button>
        </header>
        <p><SignalBadge signal={info.signal} /> Technical trend signal only, not a buy/sell recommendation or investment advice.</p>
        <ul className="signal-reasons">{info.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        {loading && <p role="status" className="meta">Loading latest quote and company news…</p>}
        {error && <p role="alert" className="err">{error} <button onClick={() => setAttempt((n) => n + 1)}>Retry details</button></p>}
        <dl className="stock-metrics">{fields.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}</dl>
        {details && <p className="meta">Provider quote: {details.quoteAt ? new Date(details.quoteAt).toLocaleString() : "timestamp unavailable"}.
          {" "}Retrieved {new Date(details.fetchedAt).toLocaleTimeString()}. Prices may be delayed.</p>}
        <h3>Recent company news</h3>
        {details?.newsError && <p role="alert" className="err">News unavailable: {details.newsError}</p>}
        {details && !details.newsError && !details.news.length && <p className="meta">No recent news returned by Yahoo for this company.</p>}
        <ul className="stock-news">{details?.news.map((item) => (
          <li key={item.url}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
            <p className="meta">{item.publisher}{item.publishedAt && ` · ${new Date(item.publishedAt).toLocaleString()}`}</p></li>
        ))}</ul>
        <p><a href={`https://finance.yahoo.com/quote/${encodeURIComponent(stock.symbol + ".NS")}/`} target="_blank" rel="noopener noreferrer">More financial information on Yahoo Finance</a></p>
        <p className="meta">Fundamentals, valuations, order-book bid/ask, and analyst recommendations are not supplied by this data source.
          Review company filings and news independently before trading.</p>
      </article>
    </dialog>
  );
}
