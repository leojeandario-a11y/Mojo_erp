import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";
import { EmergencyFundError, getEmergencyFund, requireFundPermission } from "@/lib/emergency-fund";
import { csvCell } from "@/lib/csv.mjs";
import { getFundReportDateRange } from "@/lib/emergency-fund-report.mjs";

const querySchema = z.object({
  period: z.enum(["monthly", "quarterly", "annual"]),
  year: z.coerce.number().int().min(2000).max(9998),
  index: z.coerce.number().int().min(1).max(12).optional(),
  format: z.enum(["csv"]).optional(),
}).strict().superRefine((query, context) => {
  if (query.period === "annual" && query.index !== undefined) {
    context.addIssue({ code: "custom", message: "Annual reports do not accept an index.", path: ["index"] });
  }
  if (query.period === "monthly" && query.index === undefined) {
    context.addIssue({ code: "custom", message: "Monthly reports require a month.", path: ["index"] });
  }
  if (query.period === "quarterly" && (query.index === undefined || query.index > 4)) {
    context.addIssue({ code: "custom", message: "Quarterly reports require a quarter from 1 to 4.", path: ["index"] });
  }
});

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    period: url.searchParams.get("period"),
    year: url.searchParams.get("year"),
    index: url.searchParams.has("index") ? url.searchParams.get("index") : undefined,
    format: url.searchParams.has("format") ? url.searchParams.get("format") : undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid emergency fund report period." }, { status: 400 });

  try {
    const range = getFundReportDateRange(parsed.data.period, parsed.data.year, parsed.data.index);
    const report = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const fund = await getEmergencyFund(client);
      if (!hasEntityPermission(actor, "finance.fund.read", fund.entity_id)) {
        throw new EmergencyFundError("Permission denied to view fund reports.", 403);
      }
      await requireFundPermission(client, "finance.fund.read", fund.entity_id);
      const summary = await client.query<{
        opening_balance: string;
        contributions: string;
        contribution_reversals: string;
        withdrawals: string;
        withdrawal_reversals: string;
        closing_balance: string;
        target_amount: string | null;
        progress_percentage: string | null;
      }>(
        `WITH totals AS (
          SELECT
            COALESCE((SELECT SUM(contribution.amount) FROM fund_contributions contribution
             WHERE contribution.fund_id = fund.id
               AND contribution.contribution_date < $2::date), 0)
               AS opening_contributions,
            COALESCE((SELECT SUM(contribution.amount) FROM fund_contributions contribution
              WHERE contribution.fund_id = fund.id
                AND contribution.contribution_date >= $2::date
                AND contribution.contribution_date < $3::date), 0) AS period_contributions,
            COALESCE((SELECT SUM(contribution.amount)
              FROM fund_contributions contribution
              JOIN transactions reversal ON reversal.id = contribution.reversal_transaction_id
              WHERE contribution.fund_id = fund.id AND reversal.tx_date < $2::date), 0)
                AS opening_contribution_reversals,
            COALESCE((SELECT SUM(contribution.amount)
              FROM fund_contributions contribution
              JOIN transactions reversal ON reversal.id = contribution.reversal_transaction_id
              WHERE contribution.fund_id = fund.id
                AND reversal.tx_date >= $2::date AND reversal.tx_date < $3::date), 0)
                AS period_contribution_reversals,
            COALESCE((SELECT SUM(withdrawal.amount)
              FROM fund_withdrawals withdrawal
              JOIN transactions tx ON tx.id = withdrawal.transaction_id
             WHERE withdrawal.fund_id = fund.id
                AND tx.tx_date < $2::date), 0) AS opening_withdrawals,
            COALESCE((SELECT SUM(withdrawal.amount)
              FROM fund_withdrawals withdrawal
              JOIN transactions tx ON tx.id = withdrawal.transaction_id
             WHERE withdrawal.fund_id = fund.id
                AND tx.tx_date >= $2::date
               AND tx.tx_date < $3::date), 0) AS period_withdrawals,
            COALESCE((SELECT SUM(withdrawal.amount)
              FROM fund_withdrawals withdrawal
              JOIN transactions reversal ON reversal.id = withdrawal.reversal_transaction_id
              WHERE withdrawal.fund_id = fund.id
                AND reversal.tx_date < $2::date), 0) AS opening_withdrawal_reversals,
            COALESCE((SELECT SUM(withdrawal.amount)
              FROM fund_withdrawals withdrawal
              JOIN transactions reversal ON reversal.id = withdrawal.reversal_transaction_id
              WHERE withdrawal.fund_id = fund.id
                AND reversal.tx_date >= $2::date AND reversal.tx_date < $3::date), 0)
                AS period_withdrawal_reversals
          FROM emergency_funds fund WHERE fund.id = $1
         ), balances AS (
           SELECT opening_contributions - opening_contribution_reversals
                    - opening_withdrawals + opening_withdrawal_reversals AS opening_balance,
                  period_contributions AS contributions,
                  period_contribution_reversals AS contribution_reversals,
                  period_withdrawals AS withdrawals,
                  period_withdrawal_reversals AS withdrawal_reversals,
                  opening_contributions - opening_contribution_reversals - opening_withdrawals
                    + opening_withdrawal_reversals
                    + period_contributions - period_contribution_reversals
                    - period_withdrawals + period_withdrawal_reversals AS closing_balance
           FROM totals
         )
         SELECT balances.opening_balance::text, balances.contributions::text,
                balances.contribution_reversals::text, balances.withdrawals::text,
                balances.withdrawal_reversals::text, balances.closing_balance::text,
                fund.target_amount::text,
                CASE WHEN fund.target_amount > 0
                  THEN round(balances.closing_balance * 100 / fund.target_amount, 2)::text
                  ELSE NULL END AS progress_percentage
         FROM balances JOIN emergency_funds fund ON fund.id = $1`,
        [fund.id, range.from, range.toExclusive],
      );
      const contributions = await client.query(
        `SELECT contribution.contribution_date::text AS date, contribution.kind,
                contribution.amount::text, contribution.currency, contribution.reason,
                source.tx_number AS source_transaction
         FROM fund_contributions contribution
         LEFT JOIN transactions source ON source.id = contribution.source_tx_id
         WHERE contribution.fund_id = $1
           AND contribution.contribution_date >= $2::date
           AND contribution.contribution_date < $3::date
         UNION ALL
         SELECT reversal.tx_date::text, 'reversal', (-contribution.amount)::text,
                contribution.currency, 'Contre-passation de contribution',
                reversal.tx_number
         FROM fund_contributions contribution
         JOIN transactions reversal ON reversal.id = contribution.reversal_transaction_id
         WHERE contribution.fund_id = $1
           AND reversal.tx_date >= $2::date AND reversal.tx_date < $3::date
         ORDER BY date, source_transaction`,
        [fund.id, range.from, range.toExclusive],
      );
      const withdrawals = await client.query(
        `SELECT tx.tx_date::text AS date, (-withdrawal.amount)::text AS amount,
                withdrawal.currency, withdrawal.reason, tx.tx_number AS transaction_number,
                'disbursement'::text AS kind
         FROM fund_withdrawals withdrawal
         JOIN transactions tx ON tx.id = withdrawal.transaction_id
         WHERE withdrawal.fund_id = $1
           AND tx.tx_date >= $2::date AND tx.tx_date < $3::date
         UNION ALL
         SELECT reversal.tx_date::text, withdrawal.amount::text,
                withdrawal.currency, 'Contre-passation de retrait',
                reversal.tx_number, 'reversal'::text
         FROM fund_withdrawals withdrawal
         JOIN transactions reversal ON reversal.id = withdrawal.reversal_transaction_id
         WHERE withdrawal.fund_id = $1
           AND reversal.tx_date >= $2::date AND reversal.tx_date < $3::date
         ORDER BY date, transaction_number`,
        [fund.id, range.from, range.toExclusive],
      );
      if (!summary.rows[0]) throw new EmergencyFundError("The fund report could not be calculated.", 409);
      return {
        period: parsed.data.period,
        year: parsed.data.year,
        index: parsed.data.index ?? null,
        from: range.from,
        to: range.to,
        currency: fund.currency,
        summary: summary.rows[0],
        contributions: contributions.rows,
        withdrawals: withdrawals.rows,
      };
    });
    if (parsed.data.format === "csv") {
      const { summary, contributions, withdrawals } = report;
      const rows: unknown[][] = [
        ["Rapport du fonds d'urgence", report.currency],
        ["Période", report.from, report.to],
        ["Solde d'ouverture", summary.opening_balance, report.currency],
        ["Contributions", summary.contributions, report.currency],
        ["Contre-passations de contributions", summary.contribution_reversals, report.currency],
        ["Retraits décaissés", summary.withdrawals, report.currency],
        ["Contre-passations de retraits", summary.withdrawal_reversals, report.currency],
        ["Solde de clôture", summary.closing_balance, report.currency],
        ["Objectif", summary.target_amount, report.currency],
        ["Progression (%)", summary.progress_percentage],
        [],
        ["Contributions détaillées"],
        ["Date", "Type", "Montant", "Devise", "Motif", "Transaction source"],
        ...contributions.map((item) => [
          item.date, item.kind, item.amount, item.currency, item.reason, item.source_transaction,
        ]),
        [],
        ["Retraits détaillés"],
        ["Date", "Montant", "Devise", "Motif", "Transaction"],
        ...withdrawals.map((item) => [
          item.date, item.amount, item.currency, item.reason, item.transaction_number,
        ]),
      ];
      return new Response(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="mojo-emergency-fund-${report.from}-${report.to}.csv"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof EmergencyFundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to load emergency fund report.", error);
    return NextResponse.json({ error: "Unable to load emergency fund report." }, { status: 500 });
  }
}
