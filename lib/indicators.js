export const sma = (a, n) => (a.length < n ? null : a.slice(-n).reduce((x, y) => x + y, 0) / n);

export function ema(a, n) {
  const k = 2 / (n + 1);
  let e = a[0];
  return a.map((v) => (e = v * k + e * (1 - k)));
}

// Wilder's RSI
export function rsi(c, n = 14) {
  if (c.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    d >= 0 ? (g += d) : (l -= d);
  }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

export function macd(c) {
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const sig = ema(line, 9);
  return { macd: line.at(-1), signal: sig.at(-1) };
}
