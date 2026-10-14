import { sma, rsi, macd } from "./indicators.js";

// Points-based score. Every rule adds a human-readable reason so you can audit the verdict.
export function analyze(rows) {
  const closes = rows.map((r) => r.c);
  const vols = rows.map((r) => r.v || 0);
  const price = closes.at(-1), prev = closes.at(-2);
  const change = (price / prev - 1) * 100;

  const s50 = sma(closes, 50), s200 = sma(closes, 200);
  const r = rsi(closes);
  const m = macd(closes);
  const avgVol = sma(vols.slice(0, -1), 20);
  const volRatio = avgVol ? vols.at(-1) / avgVol : null;

  let score = 0;
  const reasons = [];
  const add = (pts, why) => { score += pts; reasons.push(`${pts > 0 ? "+" : ""}${pts} ${why}`); };

  if (s50 && price > s50) add(1, "Above 50D SMA");
  if (s200 && price > s200) add(1, "Above 200D SMA");
  if (m.macd > m.signal) add(1, "MACD above signal");
  else add(-1, "MACD below signal");
  if (r >= 50 && r <= 65) add(1, `RSI healthy (${r.toFixed(0)})`);
  if (r > 75) add(-2, `RSI overbought (${r.toFixed(0)})`);
  if (r < 30) add(-1, `RSI weak (${r.toFixed(0)})`);
  if (volRatio && volRatio >= 2) add(1, `Volume ${volRatio.toFixed(1)}x average`);
  if (s50 && price / s50 > 1.3) add(-2, "Extended >30% above 50D SMA");
  if (change < -5) add(-1, "Sharp single-day drop");

  const verdict = score >= 4 ? "BUY" : score >= 2 ? "WATCH" : "AVOID";
  return {
    price: +price.toFixed(2), change: +change.toFixed(2),
    rsi: r && +r.toFixed(1), sma50: s50 && +s50.toFixed(2), sma200: s200 && +s200.toFixed(2),
    volRatio: volRatio && +volRatio.toFixed(2), score, verdict, reasons,
    macd: +m.macd.toFixed(2), macdSignal: +m.signal.toFixed(2),
  };
}
