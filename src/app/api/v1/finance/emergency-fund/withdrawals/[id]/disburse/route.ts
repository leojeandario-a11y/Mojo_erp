import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";
import {
  EmergencyFundError,
  getEmergencyFund,
  historicalRateToUsd,
  nextFundTransactionNumber,
  notifyFundRequesters,
  requireFundPermission,
} from "@/lib/emergency-fund";
import { schedulePushDeliveryAfterResponse } from "@/lib/web-push";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid fund withdrawal." }, { status: 400 });

  try {
    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const link = await client.query<{ fund_id: string; approval_request_id: string | null }>(
        "SELECT fund_id, approval_request_id FROM fund_withdrawals WHERE id = $1",
        [id],
      );
      if (!link.rowCount || !link.rows[0].approval_request_id) {
        throw new EmergencyFundError("Fund withdrawal not found.", 404);
      }
      const approval = await client.query<{ status: string }>(
        "SELECT status FROM approval_requests WHERE id = $1 FOR UPDATE",
        [link.rows[0].approval_request_id],
      );
      if (approval.rows[0]?.status !== "approved") {
        throw new EmergencyFundError("The withdrawal has not completed all approval steps.", 409);
      }
      const fund = await getEmergencyFund(client, true);
      if (!hasEntityPermission(actor, "finance.fund.approve_withdrawal", fund.entity_id)) {
        throw new EmergencyFundError("Permission denied to disburse this withdrawal.", 403);
      }
      await requireFundPermission(client, "finance.fund.approve_withdrawal", fund.entity_id);
      if (!fund.account_id) throw new EmergencyFundError("The fund account is unavailable.", 409);

      const withdrawalResult = await client.query<{
        amount: string;
        currency: string;
        status: string;
        requested_by: string;
        approval_request_id: string | null;
        transaction_id: string | null;
        reason: string;
      }>(
        `SELECT amount::text, currency, status, requested_by, approval_request_id,
                transaction_id, reason
         FROM fund_withdrawals WHERE id = $1 AND fund_id = $2 FOR UPDATE`,
        [id, fund.id],
      );
      if (!withdrawalResult.rowCount) throw new EmergencyFundError("Fund withdrawal not found.", 404);
      const withdrawal = withdrawalResult.rows[0];
      if (withdrawal.status !== "approved" || !withdrawal.approval_request_id) {
        throw new EmergencyFundError("Only fully approved withdrawals can be disbursed.", 409);
      }
      if (withdrawal.transaction_id) throw new EmergencyFundError("This withdrawal is already disbursed.", 409);

      const account = await client.query<{
        account_type: string;
        is_active: boolean;
        cash_ceiling: string | null;
        cash_variance_tolerance: string | null;
      }>(
        `SELECT account_type, is_active, cash_ceiling::text, cash_variance_tolerance::text
         FROM accounts WHERE id = $1 AND entity_id = $2 FOR UPDATE`,
        [fund.account_id, fund.entity_id],
      );
      if (!account.rowCount || !account.rows[0].is_active) {
        throw new EmergencyFundError("The emergency fund account is unavailable.", 409);
      }
      const balance = await client.query<{ amount: string; reserved: string }>(
        `SELECT fund_balance.balance::text AS amount,
                COALESCE((
                  SELECT SUM(other.amount) FROM fund_withdrawals other
                  WHERE other.fund_id = fund.id AND other.status = 'approved' AND other.id <> $2
                ), 0)::text AS reserved
         FROM v_fund_balance fund_balance
         JOIN emergency_funds fund ON fund.id = fund_balance.fund_id
         WHERE fund.id = $1`,
        [fund.id, id],
      );
      const available = await client.query<{ enough: boolean }>(
        "SELECT $1::numeric - $2::numeric >= $3::numeric AS enough",
        [balance.rows[0].amount, balance.rows[0].reserved, withdrawal.amount],
      );
      if (!available.rows[0].enough) {
        throw new EmergencyFundError("The available fund balance is insufficient for this withdrawal.", 409);
      }

      if (account.rows[0].account_type === "cash") {
        if (!account.rows[0].cash_ceiling || account.rows[0].cash_variance_tolerance === null) {
          throw new EmergencyFundError("Configure the fund account cash controls before disbursement.", 409);
        }
        const session = await client.query<{ status: string }>(
          "SELECT status FROM cash_sessions WHERE account_id = $1 AND session_date = CURRENT_DATE FOR UPDATE",
          [fund.account_id],
        );
        if (session.rows[0]?.status !== "open") {
          throw new EmergencyFundError("Open the fund cash session before disbursement.", 409);
        }
      }
      if (!hasEntityPermission(actor, "finance.transaction.validate", fund.entity_id)) {
        throw new EmergencyFundError("A validator permission is required to record the disbursement.", 403);
      }
      await requireFundPermission(client, "finance.transaction.validate", fund.entity_id);

      const txDate = (await client.query<{ value: string }>(
        "SELECT CURRENT_DATE::text AS value",
      )).rows[0].value;
      const fxRate = await historicalRateToUsd(client, fund.currency, txDate);
      const txNumber = await nextFundTransactionNumber(client, fund.entity_id, txDate);
      const transaction = await client.query<{ id: string }>(
        `INSERT INTO transactions(
           entity_id, tx_number, tx_type, tx_date, account_id, amount, currency, fx_rate_to_usd,
           description, status, created_by, validated_by, validated_at, source_table, source_id
         )
         VALUES ($1, $2, 'expense', CURRENT_DATE, $3, $4::numeric, $5, $6::numeric,
                 $7, 'validated', $8, $8, now(), 'fund_withdrawals', $9)
         RETURNING id`,
        [
          fund.entity_id,
          txNumber,
          fund.account_id,
          withdrawal.amount,
          fund.currency,
          fxRate,
          `Retrait du fonds · ${withdrawal.reason}`,
          actor.id,
          id,
        ],
      );
      const disbursement = await client.query(
        `UPDATE fund_withdrawals
         SET status = 'disbursed', transaction_id = $2, disbursed_at = now()
         WHERE id = $1 AND status = 'approved' AND transaction_id IS NULL`,
        [id, transaction.rows[0].id],
      );
      if (!disbursement.rowCount) {
        throw new EmergencyFundError("The withdrawal has already been disbursed.", 409);
      }
      await notifyFundRequesters(
        client,
        withdrawal.requested_by,
        { fr: "Retrait du fonds décaissé", ht: "Retrè fon an debouse", en: "Fund withdrawal disbursed" },
        {
          fr: `Le retrait de ${withdrawal.amount} ${withdrawal.currency} a été décaissé.`,
          ht: `Yo debouse retrè ${withdrawal.amount} ${withdrawal.currency} la.`,
          en: `The withdrawal of ${withdrawal.amount} ${withdrawal.currency} has been disbursed.`,
        },
        withdrawal.approval_request_id,
      );
      return { transactionId: transaction.rows[0].id, txNumber };
    });
    schedulePushDeliveryAfterResponse();
    return NextResponse.json({ ok: true, disbursement: result });
  } catch (error) {
    if (error instanceof EmergencyFundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to disburse emergency fund withdrawal.", error);
    return NextResponse.json({ error: "Unable to disburse emergency fund withdrawal." }, { status: 500 });
  }
}
