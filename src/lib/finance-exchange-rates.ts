import "server-only";
import type { PoolClient } from "pg";
import { invertExchangeRate } from "@/lib/money.mjs";

export async function exchangeRateToUsd(client: PoolClient, currency: string, date: string) {
  if (currency === "USD") return "1.00000000";
  const result = await client.query<{ from_currency: string; rate: string }>(
    `SELECT from_currency, rate::text
     FROM exchange_rates
     WHERE rate_date <= $1
       AND ((from_currency = 'USD' AND to_currency = 'HTG')
         OR (from_currency = 'HTG' AND to_currency = 'USD'))
     ORDER BY rate_date DESC, created_at DESC
     LIMIT 1`,
    [date],
  );
  const rate = result.rows[0];
  if (!rate) return null;
  return rate.from_currency === "HTG" ? rate.rate : invertExchangeRate(rate.rate);
}
