import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { hasEntityPermission, hasAnyPermission } from "@/lib/permissions";
import { requestIp, withDbUser } from "@/lib/db";

const reversalSchema = z.object({
  date: z.iso.date(),
  reason: z.string().trim().min(3).max(500),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, ["finance.transaction.reverse"])) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid transaction." }, { status: 400 });
  }
  const parsed = reversalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A reversal date and reason are required." }, { status: 400 });
  }

  try {
    const reversal = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const originalResult = await client.query<{
        id: string;
        entity_id: string;
        tx_number: string;
        tx_date: string;
        tx_type: string;
        adjustment_direction: string | null;
        amount: string;
        currency: string;
        fx_rate_to_usd: string;
        account_id: string;
        category_id: string | null;
        department_id: string | null;
        project_id: string | null;
        status: string;
        reversal_of_id: string | null;
      }>(
        `SELECT id, entity_id, tx_number, tx_date::text, tx_type, adjustment_direction, amount::text,
          currency, fx_rate_to_usd::text, account_id, category_id, department_id, project_id,
          status, reversal_of_id
         FROM transactions
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );
      if (!originalResult.rowCount) {
        throw new ReversalPolicyError("Transaction not found.", 404);
      }
      const original = originalResult.rows[0];
      if (!hasEntityPermission(actor, "finance.transaction.reverse", original.entity_id)) {
        throw new ReversalPolicyError("Permission denied for this entity.", 403);
      }
      const permissionResult = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission($1, $2::uuid) AS allowed",
        ["finance.transaction.reverse", original.entity_id],
      );
      if (!permissionResult.rows[0]?.allowed) {
        throw new ReversalPolicyError("Permission denied for this entity.", 403);
      }
      if (original.status !== "validated" || original.reversal_of_id !== null) {
        throw new ReversalPolicyError("Only validated original transactions can be reversed.", 409);
      }
      if (original.tx_type !== "income" && original.tx_type !== "expense" && original.tx_type !== "adjustment") {
        throw new ReversalPolicyError("Only income, expense, and adjustment transactions can be reversed.", 409);
      }

      const account = await client.query<{
        account_type: string;
        is_active: boolean;
        cash_ceiling: string | null;
        cash_variance_tolerance: string | null;
      }>(
        `SELECT account_type, is_active, cash_ceiling::text, cash_variance_tolerance::text
         FROM accounts WHERE id = $1 FOR UPDATE`,
        [original.account_id],
      );
      if (!account.rowCount || !account.rows[0].is_active) {
        throw new ReversalPolicyError("The original account is unavailable.", 409);
      }
      if (account.rows[0].account_type === "cash") {
        if (!account.rows[0].cash_ceiling || account.rows[0].cash_variance_tolerance === null) {
          throw new ReversalPolicyError("Configure the cash ceiling and count tolerance before operating this account.", 409);
        }
        const session = await client.query<{ status: string }>(
          "SELECT status FROM cash_sessions WHERE account_id = $1 AND session_date = $2 FOR UPDATE",
          [original.account_id, parsed.data.date],
        );
        if (session.rows[0]?.status !== "open") {
          throw new ReversalPolicyError("Open the cash session before reversing a transaction for this date.", 409);
        }
      }

      const existingReversal = await client.query(
        "SELECT 1 FROM transactions WHERE reversal_of_id = $1 LIMIT 1",
        [original.id],
      );
      if (existingReversal.rowCount) {
        throw new ReversalPolicyError("A reversal draft already exists for this transaction.", 409);
      }

      const entityResult = await client.query<{ code: string }>(
        "SELECT code FROM entities WHERE id = $1",
        [original.entity_id],
      );
      if (!entityResult.rowCount) throw new ReversalPolicyError("Entity not found.", 404);

      const counterResult = await client.query<{ last_value: string }>(
        `INSERT INTO transaction_number_counters(entity_id, calendar_year, last_value)
         VALUES ($1, $2, 1)
         ON CONFLICT (entity_id, calendar_year)
         DO UPDATE SET last_value = transaction_number_counters.last_value + 1
         RETURNING last_value::text`,
        [original.entity_id, Number(parsed.data.date.slice(0, 4))],
      );
      const reversalType = original.tx_type === "adjustment"
        ? "adjustment"
        : original.tx_type === "income" ? "expense" : "income";
      const reversalDirection = original.tx_type === "adjustment"
        ? original.adjustment_direction === "increase" ? "decrease" : "increase"
        : null;
      const reason = `Reversal of ${original.tx_number}: ${parsed.data.reason}`;
      const inserted = await client.query<{ id: string; tx_number: string; status: string }>(
        `INSERT INTO transactions (
           entity_id, tx_number, tx_date, tx_type, amount, currency, fx_rate_to_usd,
           account_id, category_id, department_id, project_id, description, status, created_by,
           reversal_of_id, adjustment_direction
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13, $14, $15)
         RETURNING id, tx_number, status`,
        [
          original.entity_id,
          `${entityResult.rows[0].code}-${parsed.data.date.slice(0, 4)}-${counterResult.rows[0].last_value.padStart(6, "0")}`,
          parsed.data.date,
          reversalType,
          original.amount,
          original.currency,
          original.fx_rate_to_usd,
          original.account_id,
          original.category_id,
          original.department_id,
          original.project_id,
          reason,
          actor.id,
          original.id,
          reversalDirection,
        ],
      );
      return inserted.rows[0];
    });
    return NextResponse.json({ reversal }, { status: 201 });
  } catch (error) {
    if (error instanceof ReversalPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to create reversal draft.", error);
    return NextResponse.json({ error: "Unable to create reversal draft." }, { status: 500 });
  }
}

class ReversalPolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ReversalPolicyError";
  }
}
