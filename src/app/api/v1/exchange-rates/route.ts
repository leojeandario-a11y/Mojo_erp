import { NextResponse } from "next/server";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasAnyPermission } from "@/lib/permissions";
import { exchangeRateSchema } from "@/lib/exchange-rate-schema";

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, ["finance.transaction.read", "finance.rate.manage"])) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  try {
    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) =>
      client.query(
        `SELECT id, rate_date::text, from_currency, to_currency, rate::text
         FROM exchange_rates
         ORDER BY rate_date DESC, created_at DESC
         LIMIT 100`,
      ),
    );
    return NextResponse.json({ rates: result.rows });
  } catch (error) {
    console.error("Unable to load exchange-rate history.", error);
    return NextResponse.json({ error: "Unable to load exchange-rate history." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "finance.rate.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const parsed = exchangeRateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid exchange-rate details." }, { status: 400 });

  try {
    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) =>
      client.query<{ id: string }>(
        `INSERT INTO exchange_rates(rate_date, from_currency, to_currency, rate, entered_by)
         VALUES ($1, $2, $3, $4::numeric, $5)
         ON CONFLICT (rate_date, from_currency, to_currency)
         DO NOTHING
         RETURNING id`,
        [
          parsed.data.rateDate,
          parsed.data.fromCurrency,
          parsed.data.toCurrency,
          parsed.data.rate,
          actor.id,
        ],
      ),
    );
    if (!result.rows[0]) {
      return NextResponse.json({ error: "A rate already exists for this date and currency pair. Select it from the history to edit it." }, { status: 409 });
    }
    return NextResponse.json({ id: result.rows[0].id, updated: false }, { status: 201 });
  } catch (error) {
    console.error("Unable to save exchange rate.", error);
    return NextResponse.json({ error: "Unable to save exchange rate." }, { status: 500 });
  }
}
