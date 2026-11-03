import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { canStorePermission, getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

const exhibitorSchema = z.object({
  name: z.string().trim().min(2).max(180),
  contactName: z.string().trim().max(180).nullable(),
  email: z.union([z.email(), z.literal("")]).nullable(),
  phone: z.string().trim().max(80).nullable(),
  spaceLabel: z.string().trim().max(120).nullable(),
  rentAmount: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/),
  rentCurrency: z.enum(["HTG", "USD"]).nullable(),
  rentPeriod: z.enum(["weekly", "monthly", "one_time"]).nullable(),
  commissionPercent: z.number().min(0).max(100),
  commissionBasis: z.enum(["gross_sales", "net_after_discounts"]),
  status: z.enum(["active", "suspended", "ended"]),
}).strict().superRefine((value, context) => {
  if (Number(value.rentAmount) > 0 && (!value.rentCurrency || !value.rentPeriod)) {
    context.addIssue({ code: "custom", path: ["rentPeriod"], message: "Currency and rent period are required for non-zero rent." });
  }
});

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      const canManage = await canStorePermission(client, actor, "store.exhibitor.manage", store.id);
      const canPay = await canStorePermission(client, actor, "store.exhibitor.pay", store.id);
      const canValidate = await canStorePermission(client, actor, "store.exhibitor.validate", store.id);
      if (!canManage && !canPay && !canValidate) await requireStorePermission(client, actor, "store.report.read", store.id);
      const exhibitors = await client.query(
        `SELECT id,name,contact_name,email,phone,space_label,rent_amount::text,
                rent_currency,rent_period,commission_pct::text,commission_basis,status
         FROM exhibitors ORDER BY name`,
      );
      const statements = await client.query(
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
      return NextResponse.json({ exhibitors: exhibitors.rows, statements: statements.rows });
    });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to load Store exhibitors.", error);
    return NextResponse.json({ error: "Unable to load Store exhibitors." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = exhibitorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid exhibitor details." }, { status: 400 });
  try {
    const exhibitor = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.exhibitor.manage", store.id);
      const result = await client.query<{ id: string }>(
        `INSERT INTO exhibitors(
           name,contact_name,email,phone,space_label,rent_amount,rent_currency,rent_period,
           commission_pct,commission_basis,status
         )
         VALUES ($1,$2,NULLIF($3,''),$4,$5,$6::numeric,$7,$8,$9::numeric,$10,$11)
         RETURNING id`,
        [
          parsed.data.name, parsed.data.contactName, parsed.data.email, parsed.data.phone,
          parsed.data.spaceLabel, parsed.data.rentAmount, parsed.data.rentCurrency,
          parsed.data.rentPeriod, parsed.data.commissionPercent, parsed.data.commissionBasis,
          parsed.data.status,
        ],
      );
      return result.rows[0];
    });
    return NextResponse.json({ exhibitor }, { status: 201 });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to create Store exhibitor.", error);
    return NextResponse.json({ error: "Unable to create Store exhibitor." }, { status: 500 });
  }
}
