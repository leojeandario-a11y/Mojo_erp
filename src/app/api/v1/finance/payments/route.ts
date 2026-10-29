import { NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasAnyPermission, hasEntityPermission } from "@/lib/permissions";
import { invertExchangeRate } from "@/lib/money.mjs";

const paymentSchema = z.object({
  entityId: z.uuid(),
  accountId: z.uuid(),
  direction: z.enum(["in", "out"]),
  payee: z.string().trim().min(2).max(160),
  amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  currency: z.enum(["HTG", "USD"]),
  method: z.enum(["cash", "bank_transfer", "cheque", "mobile_money", "card"]),
  paidAt: z.iso.date(),
  reference: z.string().trim().max(160).nullable(),
  categoryId: z.uuid().nullable(),
}).strict();

class PaymentPolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function nextTransactionNumber(client: PoolClient, entityId: string, entityCode: string, year: number) {
  const result = await client.query<{ last_value: string }>(
    `INSERT INTO transaction_number_counters(entity_id, calendar_year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (entity_id, calendar_year)
     DO UPDATE SET last_value = transaction_number_counters.last_value + 1
     RETURNING last_value::text`,
    [entityId, year],
  );
  return `${entityCode}-${year}-${result.rows[0].last_value.padStart(6, "0")}`;
}

async function exchangeRateToUsd(client: PoolClient, currency: string, date: string) {
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
  if (!rate) throw new PaymentPolicyError(`No exchange rate is available for ${date}.`, 400);
  return rate.from_currency === "HTG" ? rate.rate : invertExchangeRate(rate.rate);
}

async function canCreateForEntity(client: PoolClient, entityId: string) {
  const result = await client.query<{ allowed: boolean }>(
    "SELECT app_has_entity_permission('finance.transaction.create', $1::uuid) AS allowed",
    [entityId],
  );
  return result.rows[0]?.allowed === true;
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, ["finance.transaction.read", "finance.transaction.create"])) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  try {
    const payments = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query(
        `SELECT p.id, p.entity_id, e.name AS entity_name, p.direction, p.payee,
                p.amount::text, p.currency, p.method, p.paid_at::text, p.reference,
                p.transaction_id, t.tx_number, t.status, a.name AS account_name
         FROM payments p
         JOIN entities e ON e.id = p.entity_id
         LEFT JOIN transactions t ON t.id = p.transaction_id
         LEFT JOIN accounts a ON a.id = t.account_id
         ORDER BY p.paid_at DESC, p.created_at DESC
         LIMIT 100`,
      );
      return result.rows.filter(({ entity_id }) =>
        hasEntityPermission(actor, "finance.transaction.read", entity_id)
        || hasEntityPermission(actor, "finance.transaction.create", entity_id),
      );
    });
    return NextResponse.json({ payments });
  } catch (error) {
    console.error("Unable to load finance payments.", error);
    return NextResponse.json({ error: "Unable to load finance payments." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = paymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payment details." }, { status: 400 });
  if (!hasEntityPermission(actor, "finance.transaction.create", parsed.data.entityId)) {
    return NextResponse.json({ error: "Permission denied for this entity." }, { status: 403 });
  }

  try {
    const payment = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      if (!await canCreateForEntity(client, parsed.data.entityId)) {
        throw new PaymentPolicyError("Permission denied for this entity.", 403);
      }
      const accountResult = await client.query<{
        currency: string;
        account_type: string;
        is_active: boolean;
        cash_ceiling: string | null;
        cash_variance_tolerance: string | null;
      }>(
        `SELECT currency, account_type, is_active, cash_ceiling::text, cash_variance_tolerance::text
         FROM accounts WHERE id = $1 AND entity_id = $2 FOR UPDATE`,
        [parsed.data.accountId, parsed.data.entityId],
      );
      if (!accountResult.rowCount || !accountResult.rows[0].is_active) {
        throw new PaymentPolicyError("The selected account is unavailable for this entity.", 400);
      }
      const account = accountResult.rows[0];
      if (account.currency !== parsed.data.currency) {
        throw new PaymentPolicyError("Payment currency must match the selected account.", 400);
      }
      if (account.account_type === "cash") {
        if (!account.cash_ceiling || account.cash_variance_tolerance === null) {
          throw new PaymentPolicyError("Configure the cash ceiling and count tolerance before operating this account.", 409);
        }
        const session = await client.query<{ status: string }>(
          "SELECT status FROM cash_sessions WHERE account_id = $1 AND session_date = $2 FOR UPDATE",
          [parsed.data.accountId, parsed.data.paidAt],
        );
        if (session.rows[0]?.status !== "open") {
          throw new PaymentPolicyError("Open the cash session before recording a payment for this date.", 409);
        }
      }
      if (parsed.data.categoryId) {
        const category = await client.query(
          `SELECT id FROM transaction_categories
           WHERE id = $1 AND (entity_id IS NULL OR entity_id = $2) AND is_active AND kind = $3`,
          [parsed.data.categoryId, parsed.data.entityId, parsed.data.direction === "in" ? "income" : "expense"],
        );
        if (!category.rowCount) {
          throw new PaymentPolicyError("The selected category is unavailable for this payment.", 400);
        }
      }
      const entity = await client.query<{ code: string }>(
        "SELECT code FROM entities WHERE id = $1 AND is_active",
        [parsed.data.entityId],
      );
      if (!entity.rowCount) throw new PaymentPolicyError("Entity is unavailable.", 400);
      const rate = await exchangeRateToUsd(client, parsed.data.currency, parsed.data.paidAt);
      const txNumber = await nextTransactionNumber(
        client,
        parsed.data.entityId,
        entity.rows[0].code,
        Number(parsed.data.paidAt.slice(0, 4)),
      );
      const transaction = await client.query<{ id: string }>(
        `INSERT INTO transactions(
           entity_id, tx_number, tx_type, tx_date, account_id, category_id, amount,
           currency, fx_rate_to_usd, description, counterparty, source_table, status, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9::numeric, $10, $11, 'payments', 'draft', $12)
         RETURNING id`,
        [
          parsed.data.entityId,
          txNumber,
          parsed.data.direction === "in" ? "income" : "expense",
          parsed.data.paidAt,
          parsed.data.accountId,
          parsed.data.categoryId,
          parsed.data.amount,
          parsed.data.currency,
          rate,
          `${parsed.data.direction === "in" ? "Receipt" : "Payment"}: ${parsed.data.payee}`,
          parsed.data.payee,
          actor.id,
        ],
      );
      const record = await client.query<{ id: string }>(
        `INSERT INTO payments(
           entity_id, direction, payee, amount, currency, method, paid_at,
           reference, transaction_id, created_by
         )
         VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          parsed.data.entityId,
          parsed.data.direction,
          parsed.data.payee,
          parsed.data.amount,
          parsed.data.currency,
          parsed.data.method,
          parsed.data.paidAt,
          parsed.data.reference,
          transaction.rows[0].id,
          actor.id,
        ],
      );
      await client.query(
        "UPDATE transactions SET source_id = $2 WHERE id = $1",
        [transaction.rows[0].id, record.rows[0].id],
      );
      return { id: record.rows[0].id, transactionId: transaction.rows[0].id, txNumber };
    });
    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    if (error instanceof PaymentPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to create finance payment.", error);
    return NextResponse.json({ error: "Unable to create finance payment." }, { status: 500 });
  }
}
