import { NextResponse } from "next/server";
import { getUniverse } from "@/lib/symbols";
import { scanStocks, withAllTime, SCAN_TTL_MS } from "@/lib/screener";
import { analyze } from "@/lib/verdict";
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
  const requested = custom ? [...new Set(p.get("symbols").split(",").map((s) => s.trim().toUpperCase()))] : null;
  if (!Number.isFinite(threshold) || threshold < 0 || !["both", "up", "down"].includes(direction)
      || (custom && requested.some((s) => !/^[A-Z0-9&_.-]+$/.test(s)))) {
    return NextResponse.json({ error: "Invalid threshold, direction, or stock symbols" }, { status: 400 });
  }

  try {
    const symbols = requested || await getUniverse();
    let scan = await scanStocks(symbols, !custom);
    if (range === "all") scan = await withAllTime(scan);
    const results = scan.stocks.map(({ symbol, rows, firstClose }) => ({
      symbol, ...analyze(rows), rangeChange: rangeChange(rows, range, firstClose),
    }));
    const movers = results
      .filter((r) => (direction === "up" ? r.rangeChange >= threshold
                    : direction === "down" ? r.rangeChange <= -threshold
                    : Math.abs(r.rangeChange) >= threshold))
      .sort((a, b) => Math.abs(b.rangeChange) - Math.abs(a.rangeChange));

    // History stores daily movers only, so skip saving for longer ranges.
    if (p.get("save") === "1" && range === "1d") {
      try { await saveSignals(movers); } catch (e) { console.error("DB save failed:", e.message); }
    }

    return NextResponse.json({
      updatedAt: scan.updatedAt, scanned: symbols.length, available: results.length,
      unavailable: scan.unavailable, universe: custom ? "custom" : "NSE equities",
      cacheSeconds: custom ? 0 : SCAN_TTL_MS / 1000, threshold, range, count: movers.length, movers,
    });
  } catch (error) {
    console.error("Screener scan failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
