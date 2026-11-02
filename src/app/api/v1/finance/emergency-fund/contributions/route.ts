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
  requireFundPermission,
} from "@/lib/emergency-fund";
import { convertFundCurrency } from "@/lib/emergency-fund";

const manualContributionSchema = z.object({
  amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  currency: z.enum(["HTG", "USD"]),
  date: z.iso.date(),
  reason: z.string().trim().min(3).max(500),
}).strict();

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const fund = await getEmergencyFund(client);
      if (!hasEntityPermission(actor, "finance.fund.read", fund.entity_id)
          && !hasEntityPermission(actor, "finance.fund.contribute", fund.entity_id)
          && !hasEntityPermission(actor, "finance.fund.request_withdrawal", fund.entity_id)) {
        throw new EmergencyFundError("Permission denied for fund contributions.", 403);
      }
      const permission = hasEntityPermission(actor, "finance.fund.read", fund.entity_id)
        ? "finance.fund.read"
        : hasEntityPermission(actor, "finance.fund.contribute", fund.entity_id)
          ? "finance.fund.contribute"
          : "finance.fund.request_withdrawal";
      await requireFundPermission(client, permission, fund.entity_id);
      const contributions = await client.query(
        `SELECT contribution.id, contribution.source_tx_id, source.tx_number AS source_number,
                contribution.rate_id, contribution.base_amount::text,
                contribution.percentage_applied::text, contribution.amount::text,
                contribution.currency, contribution.contribution_date::text,
                contribution.kind, contribution.reason, contribution.created_at::text,
                contribution.transaction_id, incoming.tx_number AS fund_transaction_number,
                outgoing.tx_number AS outgoing_transaction_number, creator.full_name AS created_by,
                contribution.reversal_transaction_id,
                reversal.tx_number AS reversal_transaction_number
         FROM fund_contributions contribution
         LEFT JOIN transactions source ON source.id = contribution.source_tx_id
         LEFT JOIN transactions incoming ON incoming.id = contribution.transaction_id
         LEFT JOIN transactions outgoing ON outgoing.id = contribution.outgoing_transaction_id
         LEFT JOIN transactions reversal ON reversal.id = contribution.reversal_transaction_id
         LEFT JOIN users creator ON creator.id = contribution.created_by
         WHERE contribution.fund_id = $1
         ORDER BY contribution.contribution_date DESC, contribution.created_at DESC
         LIMIT 500`,
        [fund.id],
      );
      const contributionPermission = hasEntityPermission(actor, "finance.fund.contribute", fund.entity_id)
        ? await client.query<{ allowed: boolean }>(
          "SELECT app_has_entity_permission('finance.fund.contribute', $1::uuid) AS allowed",
          [fund.entity_id],
        )
        : null;
      return {
        currency: fund.currency,
        contributions: contributions.rows,
        canContribute: contributionPermission?.rows[0]?.allowed === true,
      };
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof EmergencyFundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to load emergency fund contributions.", error);
    return NextResponse.json({ error: "Unable to load emergency fund contributions." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = manualContributionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid manual contribution details." }, { status: 400 });

  try {
    const contribution = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const fund = await getEmergencyFund(client, true);
      if (!hasEntityPermission(actor, "finance.fund.contribute", fund.entity_id)) {
        throw new EmergencyFundError("Permission denied to contribute to the fund.", 403);
      }
      await requireFundPermission(client, "finance.fund.contribute", fund.entity_id);
      if (!fund.account_id) throw new EmergencyFundError("Configure the fund account first.", 409);

      const accountResult = await client.query<{
        account_type: string;
        currency: string;
        is_active: boolean;
        cash_ceiling: string | null;
        cash_variance_tolerance: string | null;
      }>(
        `SELECT account_type, currency, is_active, cash_ceiling::text, cash_variance_tolerance::text
         FROM accounts WHERE id = $1 AND entity_id = $2 FOR UPDATE`,
        [fund.account_id, fund.entity_id],
      );
      if (!accountResult.rowCount || !accountResult.rows[0].is_active) {
        throw new EmergencyFundError("The fund account is unavailable.", 409);
      }
      const amount = await convertFundCurrency(
        client,
        parsed.data.amount,
        parsed.data.currency,
        fund.currency,
        parsed.data.date,
      );
      if (amount === "0.00") throw new EmergencyFundError("The contribution rounds to zero in the fund currency.", 400);
      const fxRate = await historicalRateToUsd(client, fund.currency, parsed.data.date);
      const idResult = await client.query<{ id: string }>(
        `INSERT INTO fund_contributions(
           fund_id, base_amount, amount, currency, contribution_date, kind, reason, created_by
         )
         VALUES ($1, $2::numeric, $3::numeric, $4, $5, 'manual', $6, $7)
         RETURNING id`,
        [fund.id, parsed.data.amount, amount, fund.currency, parsed.data.date, parsed.data.reason, actor.id],
      );
      const contributionId = idResult.rows[0].id;
      if (accountResult.rows[0].account_type === "cash") {
        if (!accountResult.rows[0].cash_ceiling || accountResult.rows[0].cash_variance_tolerance === null) {
          throw new EmergencyFundError("Configure the fund account cash controls before receiving contributions.", 409);
        }
        const session = await client.query<{ status: string }>(
          "SELECT status FROM cash_sessions WHERE account_id = $1 AND session_date = $2 FOR UPDATE",
          [fund.account_id, parsed.data.date],
        );
        if (session.rows[0]?.status !== "open") {
          throw new EmergencyFundError("Open the fund cash session before recording a contribution.", 409);
        }
        const ceiling = await client.query<{ exceeds: boolean }>(
          `SELECT balance + $2::numeric > $3::numeric AS exceeds
           FROM v_account_balances WHERE account_id = $1`,
          [fund.account_id, amount, accountResult.rows[0].cash_ceiling],
        );
        if (ceiling.rows[0]?.exceeds) throw new EmergencyFundError("This contribution exceeds the cash ceiling.", 409);
      }
      const txNumber = await nextFundTransactionNumber(client, fund.entity_id, parsed.data.date);
      const transaction = await client.query<{ id: string }>(
        `INSERT INTO transactions(
           entity_id, tx_number, tx_type, tx_date, account_id, amount, currency, fx_rate_to_usd,
           description, status, created_by, validated_by, validated_at, source_table, source_id
         )
         VALUES ($1, $2, 'income', $3, $4, $5::numeric, $6, $7::numeric,
                 $8, 'validated', $9, $9, now(), 'fund_contributions', $10)
         RETURNING id`,
        [
          fund.entity_id,
          txNumber,
          parsed.data.date,
          fund.account_id,
          amount,
          fund.currency,
          fxRate,
          `Contribution manuelle au fonds · ${parsed.data.reason}`,
          actor.id,
          contributionId,
        ],
      );
      await client.query("UPDATE fund_contributions SET transaction_id = $2 WHERE id = $1", [
        contributionId,
        transaction.rows[0].id,
      ]);
      return { id: contributionId, amount, currency: fund.currency, transactionId: transaction.rows[0].id };
    });
    return NextResponse.json({ contribution }, { status: 201 });
  } catch (error) {
    if (error instanceof EmergencyFundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to record manual emergency fund contribution.", error);
    return NextResponse.json({ error: "Unable to record manual contribution." }, { status: 500 });
  }
}
