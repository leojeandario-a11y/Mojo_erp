import { NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasAnyPermission, hasEntityPermission } from "@/lib/permissions";

const accountSchema = z.object({
  entityId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  accountType: z.enum(["cash", "bank", "mobile_money", "other"]),
  currency: z.enum(["HTG", "USD"]),
  bankName: z.string().trim().max(120).nullable(),
  accountNumberMasked: z.string().trim().max(80).nullable(),
  openingBalance: z.string().regex(/^-?\d{1,16}(?:\.\d{1,2})?$/).default("0"),
  cashCeiling: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).nullable().default(null),
  cashVarianceTolerance: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).nullable().default(null),
  isActive: z.boolean().optional(),
}).strict().refine((data) =>
  (data.cashCeiling === null) === (data.cashVarianceTolerance === null)
  && (data.cashCeiling === null || Number(data.cashCeiling) > 0)
  && (data.accountType === "cash" || data.cashCeiling === null));

class FinancePolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function canManageAccount(client: PoolClient, entityId: string) {
  const result = await client.query<{ allowed: boolean }>(
    "SELECT app_has_entity_permission('finance.account.manage', $1::uuid) AS allowed",
    [entityId],
  );
  return result.rows[0]?.allowed === true;
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, ["finance.transaction.read", "finance.transaction.create", "finance.account.manage"])) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const entityResult = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM entities WHERE is_active ORDER BY name",
      );
      const readableEntities = entityResult.rows.filter((entity) =>
        hasEntityPermission(actor, "finance.transaction.read", entity.id)
        || hasEntityPermission(actor, "finance.transaction.create", entity.id)
        || hasEntityPermission(actor, "finance.account.manage", entity.id),
      );
      const balanceEntities = entityResult.rows.filter((entity) =>
        hasEntityPermission(actor, "finance.transaction.read", entity.id)
        || hasEntityPermission(actor, "finance.account.manage", entity.id),
      );
      const manageableEntities = entityResult.rows.filter((entity) =>
        hasEntityPermission(actor, "finance.account.manage", entity.id),
      );
      const accountResult = readableEntities.length
        ? await client.query(
          `SELECT a.id, a.entity_id, e.name AS entity_name, a.name, a.account_type,
                  a.currency, a.bank_name, a.account_number_masked,
                  CASE WHEN a.entity_id = ANY($2::uuid[]) THEN a.opening_balance::text END AS opening_balance,
                  a.cash_ceiling::text AS cash_ceiling,
                  a.cash_variance_tolerance::text AS cash_variance_tolerance,
                  a.is_active
           FROM accounts a JOIN entities e ON e.id = a.entity_id
           WHERE a.entity_id = ANY($1::uuid[])
           ORDER BY e.name, a.name`,
          [readableEntities.map(({ id }) => id), balanceEntities.map(({ id }) => id)],
        )
        : { rows: [] };
      return { accounts: accountResult.rows, entities: manageableEntities };
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unable to load finance accounts.", error);
    return NextResponse.json({ error: "Unable to load finance accounts." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = accountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid account details." }, { status: 400 });
  if (!hasEntityPermission(actor, "finance.account.manage", parsed.data.entityId)) {
    return NextResponse.json({ error: "Permission denied for this entity." }, { status: 403 });
  }

  try {
    const id = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      if (!await canManageAccount(client, parsed.data.entityId)) {
        throw new FinancePolicyError("Permission denied for this entity.", 403);
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO accounts(
          entity_id, name, account_type, currency, bank_name, account_number_masked,
          opening_balance, cash_ceiling, cash_variance_tolerance, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9::numeric, COALESCE($10, true))
        RETURNING id`,
        [
          parsed.data.entityId,
          parsed.data.name,
          parsed.data.accountType,
          parsed.data.currency,
          parsed.data.bankName,
          parsed.data.accountNumberMasked,
          parsed.data.openingBalance,
          parsed.data.cashCeiling,
          parsed.data.cashVarianceTolerance,
          parsed.data.isActive,
        ],
      );
      return result.rows[0].id;
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof FinancePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "An account with this name already exists for the entity." }, { status: 409 });
    }
    console.error("Unable to create finance account.", error);
    return NextResponse.json({ error: "Unable to create finance account." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = z.object({
    id: z.uuid(),
    name: z.string().trim().min(2).max(120),
    accountType: z.enum(["cash", "bank", "mobile_money", "other"]),
    currency: z.enum(["HTG", "USD"]),
    bankName: z.string().trim().max(120).nullable(),
    accountNumberMasked: z.string().trim().max(80).nullable(),
    openingBalance: z.string().regex(/^-?\d{1,16}(?:\.\d{1,2})?$/),
    cashCeiling: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).nullable(),
    cashVarianceTolerance: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).nullable(),
    isActive: z.boolean(),
  }).strict().refine((data) =>
    (data.cashCeiling === null) === (data.cashVarianceTolerance === null)
    && (data.cashCeiling === null || Number(data.cashCeiling) > 0)
    && (data.accountType === "cash" || data.cashCeiling === null))
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid account details." }, { status: 400 });

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const current = await client.query<{ entity_id: string }>(
        "SELECT entity_id FROM accounts WHERE id = $1 FOR UPDATE",
        [parsed.data.id],
      );
      if (!current.rowCount) throw new FinancePolicyError("Account not found.", 404);
      const entityId = current.rows[0].entity_id;
      if (!hasEntityPermission(actor, "finance.account.manage", entityId)
          || !await canManageAccount(client, entityId)) {
        throw new FinancePolicyError("Permission denied for this entity.", 403);
      }
      await client.query(
        `UPDATE accounts
         SET name = $2, account_type = $3, currency = $4, bank_name = $5,
             account_number_masked = $6, opening_balance = $7::numeric,
             cash_ceiling = $8::numeric, cash_variance_tolerance = $9::numeric, is_active = $10
         WHERE id = $1`,
        [
          parsed.data.id,
          parsed.data.name,
          parsed.data.accountType,
          parsed.data.currency,
          parsed.data.bankName,
          parsed.data.accountNumberMasked,
          parsed.data.openingBalance,
          parsed.data.cashCeiling,
          parsed.data.cashVarianceTolerance,
          parsed.data.isActive,
        ],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FinancePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "An account with this name already exists for the entity." }, { status: 409 });
    }
    console.error("Unable to update finance account.", error);
    return NextResponse.json({ error: "Unable to update finance account." }, { status: 500 });
  }
}
