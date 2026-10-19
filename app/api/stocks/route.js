import { NextResponse } from "next/server";
import { getEquities, searchEquities } from "@/lib/symbols";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const query = (new URL(req.url).searchParams.get("q") || "").trim();
  if (!query || query.length > 100) {
    return NextResponse.json({ error: "Enter a company name or NSE symbol (up to 100 characters)." }, { status: 400 });
  }
  try {
    return NextResponse.json({ stocks: searchEquities(await getEquities(), query) });
  } catch (error) {
    console.error("Stock search failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
