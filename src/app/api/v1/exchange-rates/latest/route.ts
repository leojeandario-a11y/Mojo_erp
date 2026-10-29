import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

export async function GET(request: Request) {
  const user = await getSession(request.headers);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const rate = await withDbUser(user.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{ rate: string; rate_date: string }>(
        `SELECT rate::text, rate_date::text
         FROM exchange_rates
         WHERE from_currency = 'USD' AND to_currency = 'HTG'
           AND rate_date <= CURRENT_DATE
         ORDER BY rate_date DESC, created_at DESC
         LIMIT 1`,
      );
      return result.rows[0] ?? null;
    });
    return NextResponse.json({ rate: rate?.rate ?? null, rateDate: rate?.rate_date ?? null });
  } catch (error) {
    console.error("Unable to read the latest USD/HTG exchange rate.", error);
    return NextResponse.json({ error: "Unable to load the exchange rate." }, { status: 500 });
  }
}
