export const SORT_OPTIONS = {
  movement: "Largest move",
  gain: "Biggest gain",
  loss: "Biggest decline",
  symbol: "Stock A-Z",
  price: "Price",
  rsi: "RSI",
  volRatio: "Relative volume",
  score: "Technical score",
  verdict: "Verdict",
  change: "Today's change",
};

const VERDICT_RANK = { BUY: 3, WATCH: 2, AVOID: 1 };

export function sortsAscending(sort, reverse) {
  return (sort === "symbol" || sort === "loss") !== reverse;
}

export function selectMovers(movers, query, sort, ascending = false) {
  const term = query.trim().toUpperCase();
  const rows = movers.filter((m) => !term || m.symbol.includes(term) || m.name?.toUpperCase().includes(term));
  const value = (m) => sort === "movement" ? Math.abs(m.rangeChange)
    : sort === "gain" || sort === "loss" ? m.rangeChange
    : sort === "verdict" ? VERDICT_RANK[m.verdict] : m[sort];
  return rows.sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    let order = sort === "symbol" ? a.symbol.localeCompare(b.symbol)
      : av == null ? 0 : av - bv;
    if (sort === "verdict" && !order) order = (a.score ?? -Infinity) - (b.score ?? -Infinity);
    return order * (sortsAscending(sort, ascending) ? 1 : -1) || a.symbol.localeCompare(b.symbol);
  });
}
