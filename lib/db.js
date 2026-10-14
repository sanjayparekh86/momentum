import { Pool } from "pg";

let pool;
export const dbEnabled = () => !!process.env.DATABASE_URL;
export function db() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function saveSignals(list) {
  if (!dbEnabled() || !list.length) return;
  for (const s of list) {
    await db().query(
      `INSERT INTO signals (symbol, trade_date, price, change_pct, rsi, score, verdict, reasons)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (symbol, trade_date) DO UPDATE SET
         price = EXCLUDED.price, change_pct = EXCLUDED.change_pct, rsi = EXCLUDED.rsi,
         score = EXCLUDED.score, verdict = EXCLUDED.verdict, reasons = EXCLUDED.reasons`,
      [s.symbol, s.price, s.change, s.rsi, s.score, s.verdict, JSON.stringify(s.reasons)]
    );
  }
}
