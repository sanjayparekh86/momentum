export const SORT_OPTIONS = {
  movement: "Largest move",
  gain: "Biggest gain",
  loss: "Biggest decline",
  symbol: "Stock A-Z",
  price: "Price",
  rsi: "RSI",
  volRatio: "Relative volume",
  score: "Technical score",
  signal: "Signal",
  change: "Today's change",
};

const SIGNAL_RANK = { BULLISH: 3, NEUTRAL: 2, BEARISH: 1 };
export const SIGNALS = {
  BULLISH: { icon: "▲", label: "Bullish" },
  NEUTRAL: { icon: "◆", label: "Neutral" },
  BEARISH: { icon: "▼", label: "Bearish" },
  INSUFFICIENT: { icon: "–", label: "Insufficient data" },
};

// Stocks without a measurable move are only included when the user asks for every stock.
export function matchesMove(row, threshold, direction) {
  if (!Number.isFinite(row.rangeChange)) return row.insufficient && threshold === 0 && direction === "both";
  return direction === "up" ? row.rangeChange >= threshold
    : direction === "down" ? row.rangeChange <= -threshold
    : Math.abs(row.rangeChange) >= threshold;
}

export function sortsAscending(sort, reverse) {
  return (sort === "symbol" || sort === "loss") !== reverse;
}

export function selectMovers(movers, query, sort, ascending = false) {
  const term = query.trim().toUpperCase();
  const rows = movers.filter((m) => !term || m.symbol.includes(term) || m.name?.toUpperCase().includes(term));
  const value = (m) => sort === "movement" ? (m.rangeChange == null ? null : Math.abs(m.rangeChange))
    : sort === "gain" || sort === "loss" ? m.rangeChange
    : sort === "signal" ? SIGNAL_RANK[m.signal] : m[sort];
  return rows.sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    let order = sort === "symbol" ? a.symbol.localeCompare(b.symbol)
      : av == null ? 0 : av - bv;
    if (sort === "signal" && !order) order = (a.score ?? -Infinity) - (b.score ?? -Infinity);
    return order * (sortsAscending(sort, ascending) ? 1 : -1) || a.symbol.localeCompare(b.symbol);
  });
}
