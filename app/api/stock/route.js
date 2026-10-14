import { NextResponse } from "next/server";
import { getStockDetails } from "@/lib/stock";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const symbol = (new URL(req.url).searchParams.get("symbol") || "").trim().toUpperCase();
  if (!/^[A-Z0-9&_.-]+$/.test(symbol)) {
    return NextResponse.json({ error: "A valid NSE stock symbol is required" }, { status: 400 });
  }
  try { return NextResponse.json(await getStockDetails(symbol)); }
  catch (error) {
    console.error(`Stock details failed for ${symbol}:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
