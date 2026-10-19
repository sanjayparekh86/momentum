import { NextResponse } from "next/server";
import { getJournalMarket } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const symbol = (params.get("symbol") || "").trim().toUpperCase();
  if (!/^[A-Z0-9&_.-]{1,64}$/.test(symbol)) {
    return NextResponse.json({ error: "A valid NSE stock symbol is required." }, { status: 400 });
  }
  const from = params.has("from") ? Number(params.get("from")) : null;
  const to = Math.floor(Date.now() / 1000);
  if (from !== null && (!Number.isInteger(from) || from < 0 || from >= to)) {
    return NextResponse.json({ error: "Invalid history start timestamp." }, { status: 400 });
  }
  try {
    return NextResponse.json(await getJournalMarket(symbol, from, to));
  } catch (error) {
    console.error(`Journal market data failed for ${symbol}:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
