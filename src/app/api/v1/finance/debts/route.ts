import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasAnyPermission, hasEntityPermission } from "@/lib/permissions";

const debtSchema = z.object({
  entityId: z.uuid(),
  creditor: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable(),
  principal: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  currency: z.enum(["HTG", "USD"]),
  incurredOn: z.iso.date(),
  dueDate: z.iso.date().nullable(),
}).strict().refine((debt) => !debt.dueDate || debt.dueDate >= debt.incurredOn);

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, ["finance.transaction.read", "finance.transaction.create"])) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  try {
    const debts = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query(
        `SELECT d.id, d.entity_id, e.name AS entity_name, d.creditor, d.description,
                d.principal::text, d.currency, d.incurred_on::text, d.due_date::text,
                CASE
                  WHEN d.status = 'cancelled' THEN 'cancelled'
                  WHEN COALESCE(SUM(dp.amount) FILTER (WHERE t.status = 'validated'), 0) = 0 THEN 'open'
                  WHEN COALESCE(SUM(dp.amount) FILTER (WHERE t.status = 'validated'), 0) >= d.principal THEN 'paid'
                  ELSE 'partially_paid'
                END AS status,
                COALESCE(SUM(dp.amount) FILTER (WHERE t.status = 'validated'), 0)::numeric(18,2)::text AS paid_amount,
                GREATEST(d.principal - COALESCE(SUM(dp.amount) FILTER (WHERE t.status = 'validated'), 0), 0)::numeric(18,2)::text AS balance_due
         FROM debts d
         JOIN entities e ON e.id = d.entity_id
         LEFT JOIN debt_payments dp ON dp.debt_id = d.id
         LEFT JOIN transactions t ON t.id = dp.transaction_id
         GROUP BY d.id, e.name
         ORDER BY d.incurred_on DESC, d.created_at DESC
         LIMIT 100`,
      );
      return result.rows.filter(({ entity_id }) =>
        hasEntityPermission(actor, "finance.transaction.read", entity_id)
        || hasEntityPermission(actor, "finance.transaction.create", entity_id),
      );
    });
    return NextResponse.json({ debts });
  } catch (error) {
    console.error("Unable to load finance debts.", error);
    return NextResponse.json({ error: "Unable to load finance debts." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = debtSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid debt details." }, { status: 400 });
  if (!hasEntityPermission(actor, "finance.transaction.create", parsed.data.entityId)) {
    return NextResponse.json({ error: "Permission denied for this entity." }, { status: 403 });
  }

  try {
    const id = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('finance.transaction.create', $1::uuid) AS allowed",
        [parsed.data.entityId],
      );
      if (!permission.rows[0]?.allowed) {
        return null;
      }
      const entity = await client.query(
        "SELECT 1 FROM entities WHERE id = $1 AND is_active",
        [parsed.data.entityId],
      );
      if (!entity.rowCount) return null;
      const result = await client.query<{ id: string }>(
        `INSERT INTO debts(entity_id, creditor, description, principal, currency, incurred_on, due_date)
         VALUES ($1, $2, $3, $4::numeric, $5, $6, $7)
         RETURNING id`,
        [
          parsed.data.entityId,
          parsed.data.creditor,
          parsed.data.description,
          parsed.data.principal,
          parsed.data.currency,
          parsed.data.incurredOn,
          parsed.data.dueDate,
        ],
      );
      return result.rows[0].id;
    });
    if (!id) return NextResponse.json({ error: "Permission denied or entity unavailable." }, { status: 403 });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error("Unable to create finance debt.", error);
    return NextResponse.json({ error: "Unable to create finance debt." }, { status: 500 });
  }
}
