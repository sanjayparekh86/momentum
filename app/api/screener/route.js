import { NextResponse } from "next/server";
import { getUniverse } from "@/lib/symbols";
import { scanStocks, withAllTime, getScanProgress, SCAN_TTL_MS } from "@/lib/screener";
import { analyze, insufficient } from "@/lib/verdict";
import { matchesMove } from "@/lib/table";
import { saveSignals } from "@/lib/db";
import { RANGES, rangeChange } from "@/lib/ranges";

export const dynamic = "force-dynamic";

// GET /api/screener?threshold=5&direction=both&range=1d&save=1&symbols=TCS,INFY
export async function GET(req) {
  const p = new URL(req.url).searchParams;
  const threshold = parseFloat(p.get("threshold") || "5");
  const direction = p.get("direction") || "both";
  const range = Object.hasOwn(RANGES, p.get("range")) ? p.get("range") : "1d";
  const custom = p.has("symbols");
  const partial = p.get("progress") === "1";
  const requested = custom ? [...new Set(p.get("symbols").split(",").map((s) => s.trim().toUpperCase()))] : null;
  if (!Number.isFinite(threshold) || threshold < 0 || !["both", "up", "down"].includes(direction)
      || (custom && requested.some((s) => !/^[A-Z0-9&_.-]+$/.test(s)))) {
    return NextResponse.json({ error: "Invalid threshold, direction, or stock symbols" }, { status: 400 });
  }

  try {
    const symbols = requested || await getUniverse();
    if (partial && (custom || range === "all")) return NextResponse.json({ pending: true });
    let scan = partial ? getScanProgress(symbols) : await scanStocks(symbols, !custom);
    if (!scan) return NextResponse.json({ pending: true });
    if (range === "all") scan = await withAllTime(scan);
    const analyzed = scan.stocks.map(({ symbol, rows, firstClose }) => ({
      symbol, ...analyze(rows), rangeChange: rangeChange(rows, range, firstClose),
    }));
    const results = [...analyzed, ...scan.unavailable.map(({ symbol, reason }) => ({
      symbol, ...insufficient([], `No usable price data: ${reason}`), rangeChange: null,
    }))];
    const movers = results
      .filter((r) => matchesMove(r, threshold, direction))
      .sort((a, b) => Math.abs(b.rangeChange ?? -1) - Math.abs(a.rangeChange ?? -1));
    const analyzable = analyzed.filter((r) => !r.insufficient).length;

    // History stores daily movers only, so skip saving for longer ranges.
    if (!partial && p.get("save") === "1" && range === "1d") {
      try { await saveSignals(movers); } catch (e) { console.error("DB save failed:", e.message); }
    }

    return NextResponse.json({
      updatedAt: scan.updatedAt, scanned: symbols.length, available: analyzable,
      insufficient: results.length - analyzable,
      unavailable: scan.unavailable, universe: custom ? "custom" : "NSE equities",
      cacheSeconds: custom ? 0 : SCAN_TTL_MS / 1000, threshold, direction, range, count: movers.length, movers,
      partial, processed: partial ? scan.processed : symbols.length,
    });
  } catch (error) {
    console.error("Screener scan failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
