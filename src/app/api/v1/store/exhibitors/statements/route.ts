import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { exchangeRateToUsd } from "@/lib/finance-exchange-rates";
import { canStorePermission, cents, decimal, getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

const statementSchema = z.object({
  periodStart: z.iso.date(),
}).strict();

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      const canPay = await canStorePermission(client, actor, "store.exhibitor.pay", store.id);
      const canValidate = await canStorePermission(client, actor, "store.exhibitor.validate", store.id);
      if (!canPay && !canValidate) await requireStorePermission(client, actor, "store.report.read", store.id);
      const result = await client.query(
        `SELECT s.id,s.exhibitor_id,e.name AS exhibitor,s.period_start::text,s.period_end::text,
                s.sales_total_usd::text,s.commission_usd::text,s.rent_usd::text,
                s.net_due_to_exhibitor_usd::text,s.status,s.commission_basis,
                s.validated_by,s.validated_at,
                COALESCE(SUM(p.amount * p.fx_rate_to_usd) FILTER (WHERE p.direction='to_exhibitor'),0)::text AS paid_to_exhibitor_usd,
                COALESCE(SUM(p.amount * p.fx_rate_to_usd) FILTER (WHERE p.direction='from_exhibitor'),0)::text AS paid_by_exhibitor_usd
         FROM exhibitor_statements s
         JOIN exhibitors e ON e.id=s.exhibitor_id
         LEFT JOIN exhibitor_payments p ON p.statement_id=s.id
         GROUP BY s.id,e.name ORDER BY s.period_end DESC,e.name LIMIT 200`,
      );
      return NextResponse.json({ statements: result.rows });
    });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to load exhibitor statements.", error);
    return NextResponse.json({ error: "Unable to load exhibitor statements." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = statementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid Monday as the statement start date." }, { status: 400 });
  const start = new Date(`${parsed.data.periodStart}T00:00:00.000Z`);
  if (start.getUTCDay() !== 1) {
    return NextResponse.json({ error: "Weekly statements must start on a Monday." }, { status: 400 });
  }
  start.setUTCDate(start.getUTCDate() + 6);
  const endDate = start.toISOString().slice(0, 10);
  const startDate = parsed.data.periodStart;

  try {
    const statements = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.exhibitor.manage", store.id);
      const exhibitors = await client.query<{
        id: string;
        commission_pct: string;
        commission_basis: "gross_sales" | "net_after_discounts";
        rent_amount: string;
        rent_currency: string | null;
        rent_period: string | null;
      }>(
        `SELECT id,commission_pct::text,commission_basis,rent_amount::text,rent_currency,rent_period
         FROM exhibitors WHERE status='active' ORDER BY id FOR UPDATE`,
      );
      const created: Array<{ id: string; exhibitorId: string }> = [];
      for (const exhibitor of exhibitors.rows) {
        const saleLines = await client.query<{
          sale_id: string;
          sales_amount_usd: string;
          commission_usd: string;
        }>(
          `SELECT s.id AS sale_id,
                  round(SUM(
                    CASE WHEN $4='gross_sales' THEN i.quantity * i.unit_price
                         ELSE i.line_total END * s.fx_rate_to_usd
                  ),2)::text AS sales_amount_usd,
                  round(SUM(
                    CASE WHEN $4='gross_sales' THEN i.quantity * i.unit_price
                         ELSE i.line_total END * s.fx_rate_to_usd
                  ) * $5::numeric / 100,2)::text AS commission_usd
           FROM sales s
           JOIN sale_items i ON i.sale_id=s.id
           JOIN products p ON p.id=i.product_id AND p.exhibitor_id=$1
           WHERE s.entity_id=$2 AND s.status='completed'
             AND s.sold_at >= $3::date AND s.sold_at < ($6::date + interval '1 day')
           GROUP BY s.id ORDER BY s.id`,
          [
            exhibitor.id, store.id, startDate, exhibitor.commission_basis,
            exhibitor.commission_pct, endDate,
          ],
        );
        const salesTotal = saleLines.rows.reduce((sum, line) => sum + cents(line.sales_amount_usd), BigInt("0"));
        const commissionTotal = saleLines.rows.reduce((sum, line) => sum + cents(line.commission_usd), BigInt("0"));
        let rentUsd = BigInt("0");
        const hasRent = Number(exhibitor.rent_amount) > 0 && exhibitor.rent_currency && exhibitor.rent_period;
        const monthEnd = new Date(Date.UTC(Number(endDate.slice(0, 4)), Number(endDate.slice(5, 7)), 0));
        const isMonthlyDue = exhibitor.rent_period === "monthly"
          && monthEnd >= new Date(`${startDate}T00:00:00.000Z`)
          && monthEnd <= new Date(`${endDate}T00:00:00.000Z`);
        let rentDue = hasRent && (
          exhibitor.rent_period === "weekly"
          || isMonthlyDue
          || exhibitor.rent_period === "one_time"
        );
        if (rentDue && exhibitor.rent_currency && exhibitor.rent_period) {
          if (exhibitor.rent_period === "one_time") {
            const alreadyCharged = await client.query(
              "SELECT 1 FROM exhibitor_statements WHERE exhibitor_id=$1 AND rent_usd>0 LIMIT 1",
              [exhibitor.id],
            );
            if (alreadyCharged.rowCount) rentDue = false;
          }
          if (rentDue) rentUsd = await calculateRent();
        }
        const net = salesTotal - commissionTotal - rentUsd;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO exhibitor_statements(
             exhibitor_id,period_start,period_end,sales_total_usd,commission_usd,
             rent_usd,net_due_to_exhibitor_usd,commission_basis
           )
           VALUES ($1,$2::date,$3::date,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8)
           RETURNING id`,
          [
            exhibitor.id, startDate, endDate, decimal(salesTotal), decimal(commissionTotal),
            decimal(rentUsd), decimal(net), exhibitor.commission_basis,
          ],
        );
        for (const line of saleLines.rows) {
          await client.query(
            `INSERT INTO exhibitor_statement_lines(statement_id,sale_id,sales_amount_usd,commission_usd)
             VALUES ($1,$2,$3::numeric,$4::numeric)`,
            [inserted.rows[0].id, line.sale_id, line.sales_amount_usd, line.commission_usd],
          );
        }
        created.push({ id: inserted.rows[0].id, exhibitorId: exhibitor.id });

        async function calculateRent() {
          const rate = await exchangeRateToUsd(client, exhibitor.rent_currency!, endDate);
          if (!rate) throw new StorePolicyError(`No exchange rate is available for ${exhibitor.rent_currency} on ${endDate}.`, 409);
          const converted = await client.query<{ amount: string }>(
            "SELECT round($1::numeric * $2::numeric,2)::text AS amount",
            [exhibitor.rent_amount, rate],
          );
          return cents(converted.rows[0].amount);
        }
      }
      return created;
    });
    return NextResponse.json({ statements }, { status: 201 });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Weekly statements already exist for at least one exhibitor in this period." }, { status: 409 });
    }
    console.error("Unable to generate exhibitor statements.", error);
    return NextResponse.json({ error: "Unable to generate exhibitor statements." }, { status: 500 });
  }
}
