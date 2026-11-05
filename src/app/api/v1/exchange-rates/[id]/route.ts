import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { isSuperAdmin } from "@/lib/permissions";
import { exchangeRateSchema } from "@/lib/exchange-rate-schema";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!isSuperAdmin(actor)) return NextResponse.json({ error: "Super-administrator access required." }, { status: 403 });

  const { id } = await context.params;
  const parsed = exchangeRateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid exchange-rate details." }, { status: 400 });

  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query(
        `UPDATE exchange_rates
         SET rate_date = $2, from_currency = $3, to_currency = $4, rate = $5::numeric, entered_by = $6
         WHERE id = $1
         RETURNING id`,
        [id, parsed.data.rateDate, parsed.data.fromCurrency, parsed.data.toCurrency, parsed.data.rate, actor.id],
      );
      if (!result.rowCount) return NextResponse.json({ error: "Exchange rate not found." }, { status: 404 });
      return NextResponse.json({ id });
    });
  } catch (error) {
    console.error("Unable to update exchange rate.", error);
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A rate already exists for this date and currency pair." }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to update exchange rate." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!isSuperAdmin(actor)) return NextResponse.json({ error: "Super-administrator access required." }, { status: 403 });

  const { id } = await context.params;
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query("SELECT 1 FROM exchange_rates WHERE id = $1", [id]);
      if (!result.rowCount) return NextResponse.json({ error: "Exchange rate not found." }, { status: 404 });
      return NextResponse.json(
        { error: "Historical exchange rates cannot be deleted because they may be used for financial calculations." },
        { status: 409 },
      );
    });
  } catch (error) {
    console.error("Unable to delete exchange rate.", error);
    return NextResponse.json({ error: "Unable to delete exchange rate." }, { status: 500 });
  }
}
