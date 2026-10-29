import { NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";
import { invertExchangeRate } from "@/lib/money.mjs";

const repaymentSchema = z.object({
  accountId: z.uuid(),
  amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  paidAt: z.iso.date(),
  method: z.enum(["cash", "bank_transfer", "cheque", "mobile_money", "card"]),
  reference: z.string().trim().max(160).nullable(),
}).strict();

class RepaymentPolicyError extends Error {
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
  if (!rate) throw new RepaymentPolicyError(`No exchange rate is available for ${date}.`, 400);
  return rate.from_currency === "HTG" ? rate.rate : invertExchangeRate(rate.rate);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid debt." }, { status: 400 });
  const parsed = repaymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid debt repayment details." }, { status: 400 });

  try {
    const repayment = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const debtResult = await client.query<{
        entity_id: string;
        creditor: string;
        principal: string;
        currency: string;
        status: string;
      }>(
        `SELECT entity_id, creditor, principal::text, currency, status
         FROM debts WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!debtResult.rowCount) throw new RepaymentPolicyError("Debt not found.", 404);
      const debt = debtResult.rows[0];
      if (!hasEntityPermission(actor, "finance.transaction.create", debt.entity_id)) {
        throw new RepaymentPolicyError("Permission denied for this entity.", 403);
      }
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('finance.transaction.create', $1::uuid) AS allowed",
        [debt.entity_id],
      );
      if (!permission.rows[0]?.allowed) throw new RepaymentPolicyError("Permission denied for this entity.", 403);
      if (debt.status === "cancelled") throw new RepaymentPolicyError("Cancelled debts cannot be repaid.", 409);

      const accountResult = await client.query<{
        currency: string;
        account_type: string;
        is_active: boolean;
        cash_ceiling: string | null;
        cash_variance_tolerance: string | null;
      }>(
        `SELECT currency, account_type, is_active, cash_ceiling::text, cash_variance_tolerance::text
         FROM accounts WHERE id = $1 AND entity_id = $2 FOR UPDATE`,
        [parsed.data.accountId, debt.entity_id],
      );
      if (!accountResult.rowCount || !accountResult.rows[0].is_active) {
        throw new RepaymentPolicyError("Select an active account from the debt's entity.", 400);
      }
      const account = accountResult.rows[0];
      if (account.currency !== debt.currency) {
        throw new RepaymentPolicyError("The repayment account must use the debt currency.", 400);
      }
      if (account.account_type === "cash") {
        if (!account.cash_ceiling || account.cash_variance_tolerance === null) {
          throw new RepaymentPolicyError("Configure the cash ceiling and count tolerance before operating this account.", 409);
        }
        const session = await client.query<{ status: string }>(
          "SELECT status FROM cash_sessions WHERE account_id = $1 AND session_date = $2 FOR UPDATE",
          [parsed.data.accountId, parsed.data.paidAt],
        );
        if (session.rows[0]?.status !== "open") {
          throw new RepaymentPolicyError("Open the cash session before recording a repayment for this date.", 409);
        }
      }

      const reserved = await client.query<{ exceeds: boolean }>(
        `SELECT $2::numeric > GREATEST(
          d.principal - COALESCE(SUM(dp.amount) FILTER (
            WHERE t.status IN ('draft','pending_approval','validated')
          ), 0), 0
        ) AS exceeds
         FROM debts d
         LEFT JOIN debt_payments dp ON dp.debt_id = d.id
         LEFT JOIN transactions t ON t.id = dp.transaction_id
           AND t.status IN ('draft','pending_approval','validated')
         WHERE d.id = $1
         GROUP BY d.id`,
        [id, parsed.data.amount],
      );
      if (reserved.rows[0]?.exceeds) {
        throw new RepaymentPolicyError("Repayment exceeds the remaining debt balance.", 409);
      }

      const entity = await client.query<{ code: string }>(
        "SELECT code FROM entities WHERE id = $1 AND is_active",
        [debt.entity_id],
      );
      if (!entity.rowCount) throw new RepaymentPolicyError("Entity is unavailable.", 400);
      const rate = await exchangeRateToUsd(client, debt.currency, parsed.data.paidAt);
      const txNumber = await nextTransactionNumber(
        client,
        debt.entity_id,
        entity.rows[0].code,
        Number(parsed.data.paidAt.slice(0, 4)),
      );
      const transaction = await client.query<{ id: string }>(
        `INSERT INTO transactions(
           entity_id, tx_number, tx_type, tx_date, account_id, amount, currency,
           fx_rate_to_usd, description, counterparty, source_table, status, created_by
         )
         VALUES ($1, $2, 'expense', $3, $4, $5::numeric, $6, $7::numeric, $8, $9, 'debt_payments', 'draft', $10)
         RETURNING id`,
        [
          debt.entity_id,
          txNumber,
          parsed.data.paidAt,
          parsed.data.accountId,
          parsed.data.amount,
          debt.currency,
          rate,
          `Debt repayment: ${debt.creditor}`,
          debt.creditor,
          actor.id,
        ],
      );
      const payment = await client.query<{ id: string }>(
        `INSERT INTO payments(
           entity_id, direction, payee, amount, currency, method, paid_at,
           reference, transaction_id, created_by
         )
         VALUES ($1, 'out', $2, $3::numeric, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          debt.entity_id,
          debt.creditor,
          parsed.data.amount,
          debt.currency,
          parsed.data.method,
          parsed.data.paidAt,
          parsed.data.reference,
          transaction.rows[0].id,
          actor.id,
        ],
      );
      const debtPayment = await client.query<{ id: string }>(
        `INSERT INTO debt_payments(debt_id, amount, paid_at, transaction_id)
         VALUES ($1, $2::numeric, $3, $4)
         RETURNING id`,
        [id, parsed.data.amount, parsed.data.paidAt, transaction.rows[0].id],
      );
      await client.query(
        "UPDATE transactions SET source_id = $2 WHERE id = $1",
        [transaction.rows[0].id, debtPayment.rows[0].id],
      );
      return {
        id: debtPayment.rows[0].id,
        paymentId: payment.rows[0].id,
        transactionId: transaction.rows[0].id,
        txNumber,
      };
    });
    return NextResponse.json({ repayment }, { status: 201 });
  } catch (error) {
    if (error instanceof RepaymentPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to record debt repayment.", error);
    return NextResponse.json({ error: "Unable to record debt repayment." }, { status: 500 });
  }
}
