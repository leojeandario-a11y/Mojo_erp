import { NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";
import {
  createAutomaticFundContribution,
  EmergencyFundError,
  reverseFundAccounting,
} from "@/lib/emergency-fund";
import { schedulePushDeliveryAfterResponse } from "@/lib/web-push";

class ValidationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function hasValidationPermission(client: PoolClient, entityId: string) {
  const result = await client.query<{ allowed: boolean }>(
    "SELECT app_has_entity_permission('finance.transaction.validate', $1::uuid) AS allowed",
    [entityId],
  );
  return result.rows[0]?.allowed === true;
}

async function refreshDebtStatus(client: PoolClient, transactionId: string) {
  const debts = await client.query<{ id: string }>(
    `SELECT DISTINCT dp.debt_id AS id
     FROM debt_payments dp
     WHERE dp.transaction_id = $1
        OR dp.transaction_id = (
          SELECT reversal_of_id FROM transactions WHERE id = $1
        )`,
    [transactionId],
  );
  for (const { id } of debts.rows) {
    await client.query(
      `UPDATE debts d
       SET status = CASE
         WHEN d.status = 'cancelled' THEN 'cancelled'
         WHEN COALESCE((
           SELECT SUM(dp.amount)
           FROM debt_payments dp
           JOIN transactions t ON t.id = dp.transaction_id
           WHERE dp.debt_id = d.id AND t.status = 'validated'
         ), 0) = 0 THEN 'open'
         WHEN COALESCE((
           SELECT SUM(dp.amount)
           FROM debt_payments dp
           JOIN transactions t ON t.id = dp.transaction_id
           WHERE dp.debt_id = d.id AND t.status = 'validated'
         ), 0) >= d.principal THEN 'paid'
         ELSE 'partially_paid'
       END
       WHERE d.id = $1`,
      [id],
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid transaction." }, { status: 400 });

  try {
    let fundContribution: {
      id: string;
      amount: string;
      currency: string;
      sourceTransactionId: string;
    } | null = null;
    let shouldProcessPush = false;
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{
        id: string;
        entity_id: string;
        created_by: string | null;
        status: string;
        reversal_of_id: string | null;
        account_id: string;
        tx_type: string;
        adjustment_direction: string | null;
        tx_date: string;
        amount: string;
        currency: string;
        fx_rate_to_usd: string;
        account_transfer_id: string | null;
        source_table: string | null;
        source_id: string | null;
        has_approved_expense_request: boolean;
      }>(
        `SELECT id, entity_id, created_by, status, reversal_of_id, account_id, tx_type, adjustment_direction,
                tx_date::text, amount::text, currency, fx_rate_to_usd::text, account_transfer_id,
                source_table, source_id,
                EXISTS (
                  SELECT 1 FROM approval_requests ar
                  WHERE ar.request_type = 'expense' AND ar.ref_table = 'transactions'
                    AND ar.ref_id = transactions.id AND ar.status = 'approved'
                ) AS has_approved_expense_request
         FROM transactions WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!result.rowCount) throw new ValidationError("Transaction not found.", 404);
      const transaction = result.rows[0];
      if (!hasEntityPermission(actor, "finance.transaction.validate", transaction.entity_id)
          || !await hasValidationPermission(client, transaction.entity_id)) {
        throw new ValidationError("Permission denied for this entity.", 403);
      }
      if (transaction.created_by === actor.id) {
        throw new ValidationError("The transaction creator cannot validate the same transaction.", 403);
      }
      if (transaction.status !== "draft"
          && !(transaction.status === "pending_approval" && transaction.has_approved_expense_request)) {
        throw new ValidationError("Only draft transactions or fully approved expenses can be validated.", 409);
      }
      const transferTransactions = transaction.account_transfer_id
        ? await client.query<{
          id: string;
          account_id: string;
          tx_type: string;
          adjustment_direction: string | null;
          status: string;
          created_by: string | null;
          amount: string;
          tx_date: string;
        }>(
          `SELECT id, account_id, tx_type, adjustment_direction, status, created_by, amount::text, tx_date::text
           FROM transactions WHERE account_transfer_id = $1 ORDER BY id FOR UPDATE`,
          [transaction.account_transfer_id],
        )
        : null;
      if (transferTransactions && (
        transferTransactions.rowCount !== 2
        || transferTransactions.rows.some((item) =>
          item.status !== "draft"
          || item.created_by === actor.id
          || item.amount !== transaction.amount
          || item.tx_date !== transaction.tx_date)
        || !transferTransactions.rows.some((item) => item.tx_type === "transfer_in")
        || !transferTransactions.rows.some((item) => item.tx_type === "transfer_out")
      )) {
        throw new ValidationError("Both draft sides of the transfer must be valid before approval.", 409);
      }
      if (transaction.reversal_of_id) {
        const originalResult = await client.query<{ status: string; reversal_of_id: string | null }>(
          "SELECT status, reversal_of_id FROM transactions WHERE id = $1 FOR UPDATE",
          [transaction.reversal_of_id],
        );
        if (!originalResult.rowCount
            || originalResult.rows[0].status !== "validated"
            || originalResult.rows[0].reversal_of_id !== null) {
          throw new ValidationError("The original transaction is no longer eligible for reversal.", 409);
        }
      }
      const accountIds = [...new Set(
        transferTransactions?.rows.map((item) => item.account_id) ?? [transaction.account_id],
      )].sort();
      const accounts = await client.query<{
        id: string;
        account_type: string;
        cash_ceiling: string | null;
        cash_variance_tolerance: string | null;
      }>(
        `SELECT id, account_type, cash_ceiling::text, cash_variance_tolerance::text
         FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [accountIds],
      );
      const transferItems = transferTransactions?.rows ?? [{
        id,
        account_id: transaction.account_id,
        tx_type: transaction.tx_type,
        adjustment_direction: transaction.adjustment_direction,
        amount: transaction.amount,
        tx_date: transaction.tx_date,
      }];
      for (const account of accounts.rows.filter((item) => item.account_type === "cash")) {
        if (!account.cash_ceiling || account.cash_variance_tolerance === null) {
          throw new ValidationError("Configure the cash ceiling and count tolerance before operating this account.", 409);
        }
        const session = await client.query<{ status: string }>(
          `SELECT status FROM cash_sessions
           WHERE account_id = $1 AND session_date = $2
           FOR UPDATE`,
          [account.id, transaction.tx_date],
        );
        if (session.rows[0]?.status !== "open") {
          throw new ValidationError("The cash session must be open to validate this transaction.", 409);
        }
        const incoming = transferItems
          .filter((item) => item.account_id === account.id
            && (item.tx_type === "income" || item.tx_type === "transfer_in"
              || (item.tx_type === "adjustment" && item.adjustment_direction === "increase")));
        if (incoming.length > 1) {
          throw new ValidationError("A transfer cannot contain multiple incoming transactions for one cash account.", 409);
        }
        if (incoming.length === 1) {
          const balance = await client.query<{ exceeds: boolean }>(
            `SELECT b.balance + $2::numeric > $3::numeric AS exceeds
             FROM v_account_balances b WHERE b.account_id = $1`,
            [account.id, incoming[0].amount, account.cash_ceiling],
          );
          if (balance.rows[0]?.exceeds) {
            throw new ValidationError("This incoming operation would exceed the cash ceiling.", 409);
          }
        }
      }
      if (transaction.account_transfer_id) {
        await client.query(
          `UPDATE transactions
           SET status = 'validated', validated_by = $2, validated_at = now()
           WHERE account_transfer_id = $1 AND status = 'draft'`,
          [transaction.account_transfer_id, actor.id],
        );
      } else {
        await client.query(
          `UPDATE transactions
           SET status = 'validated', validated_by = $2, validated_at = now()
           WHERE id = $1`,
          [id, actor.id],
        );
      }
      if (!transaction.account_transfer_id) {
        shouldProcessPush = transaction.tx_type === "income" && transaction.reversal_of_id === null;
        fundContribution = await createAutomaticFundContribution(client, actor.id, {
          id,
          entity_id: transaction.entity_id,
          tx_type: transaction.tx_type,
          tx_date: transaction.tx_date,
          amount: transaction.amount,
          currency: transaction.currency,
          account_id: transaction.account_id,
          fx_rate_to_usd: transaction.fx_rate_to_usd,
          reversal_of_id: transaction.reversal_of_id,
          account_transfer_id: transaction.account_transfer_id,
          source_table: transaction.source_table,
          source_id: transaction.source_id,
        });
      }
      if (transaction.reversal_of_id) {
        await client.query(
          `UPDATE transactions
           SET status = 'reversed'
           WHERE id = $1 AND status = 'validated'`,
          [transaction.reversal_of_id],
        );
        await reverseFundAccounting(client, actor.id, {
          id,
          reversal_of_id: transaction.reversal_of_id,
          tx_date: transaction.tx_date,
        });
      }
      await refreshDebtStatus(client, id);
    });
    if (shouldProcessPush) schedulePushDeliveryAfterResponse();
    return NextResponse.json({ ok: true, fundContribution });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof EmergencyFundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to validate finance transaction.", error);
    return NextResponse.json({ error: "Unable to validate finance transaction." }, { status: 500 });
  }
}
