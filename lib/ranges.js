export const RANGES = {
  "1d": { label: "Today", title: "today" },
  "5d": { label: "5 days", title: "in 5 days", bars: 5 },
  "1mo": { label: "1 month", title: "in 1 month", months: 1 },
  "3mo": { label: "3 months", title: "in 3 months", months: 3 },
  "1y": { label: "1 year", title: "in 1 year", months: 12 },
  all: { label: "All", title: "all time" },
};

// % change over the range. `rows` are daily bars ({ t: unix seconds, c: close }).
// For "all", pass the earliest known close as `firstClose`.
export function rangeChange(rows, range, firstClose) {
  const cfg = RANGES[range];
  const last = rows.at(-1);
  if (!last || (range !== "all" && rows.length < 2)) return null;
  let base;
  if (range === "all") base = firstClose ?? rows[0].c;
  else if (!cfg || range === "1d") base = rows.at(-2).c;
  else if (cfg.bars) base = rows[Math.max(0, rows.length - 1 - cfg.bars)].c;
  else {
    const d = new Date(last.t * 1000);
    d.setMonth(d.getMonth() - cfg.months);
    const target = d.getTime() / 1000;
    let idx = 0;
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].t <= target) { idx = i; break; }
    base = rows[idx].c;
  }
  return +((last.c / base - 1) * 100).toFixed(2);
}
