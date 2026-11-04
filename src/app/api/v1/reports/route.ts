import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasAnyPermission, hasEntityPermission } from "@/lib/permissions";
import { reportDefinitions, type ReportCategory } from "@/lib/reports";

const querySchema = z.object({
  category: z.enum(["finance", "hr", "business", "marketing", "operations", "store"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  entityId: z.uuid().optional(),
}).strict();

const MAX_ROWS = 1000;

const incomeAmountExpression = `CASE
  WHEN t.tx_type = 'income' AND source_original.id IS NOT NULL THEN 0
  WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'increase'
    AND source_original.adjustment_direction = 'decrease' THEN 0
  WHEN t.tx_type = 'expense' AND source_original.tx_type = 'income' THEN -t.amount_usd
  WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'decrease'
    AND source_original.tx_type = 'adjustment'
    AND source_original.adjustment_direction = 'increase' THEN -t.amount_usd
  WHEN t.tx_type = 'income' THEN t.amount_usd
  WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'increase' THEN t.amount_usd
  ELSE 0
END`;

const expenseAmountExpression = `CASE
  WHEN t.tx_type = 'expense' AND source_original.tx_type = 'income' THEN 0
  WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'decrease'
    AND source_original.tx_type = 'adjustment'
    AND source_original.adjustment_direction = 'increase' THEN 0
  WHEN t.tx_type = 'income' AND source_original.tx_type = 'expense' THEN -t.amount_usd
  WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'increase'
    AND source_original.tx_type = 'adjustment'
    AND source_original.adjustment_direction = 'decrease' THEN -t.amount_usd
  WHEN t.tx_type = 'expense' THEN t.amount_usd
  WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'decrease' THEN t.amount_usd
  ELSE 0
END`;

type FinancialSummaryRow = {
  entity: string;
  metric: string;
  subject: string;
  currency: string | null;
  balance: string | null;
  target_amount: string | null;
  planned_amount: string | null;
  actual_amount: string | null;
  income_usd: string | null;
  expense_usd: string | null;
  net_usd: string | null;
  net_margin_pct: string | null;
  missing_rate_count: string | null;
};

function summaryRow(
  entity: string,
  metric: string,
  subject: string,
  values: Partial<Omit<FinancialSummaryRow, "entity" | "metric" | "subject">> = {},
): FinancialSummaryRow {
  return {
    entity,
    metric,
    subject,
    currency: null,
    balance: null,
    target_amount: null,
    planned_amount: null,
    actual_amount: null,
    income_usd: null,
    expense_usd: null,
    net_usd: null,
    net_margin_pct: null,
    missing_rate_count: null,
    ...values,
  };
}

async function buildFinancialSummary(
  client: PoolClient,
  from: string,
  to: string,
  entityId: string | null,
): Promise<FinancialSummaryRow[]> {
  const rows: FinancialSummaryRow[] = [];
  const results = await client.query<{
    entity: string;
    income_usd: string;
    expense_usd: string;
    net_usd: string;
    net_margin_pct: string | null;
  }>(
    `WITH totals AS (
       SELECT e.id, e.name AS entity,
              COALESCE(SUM(${incomeAmountExpression}), 0) AS income_usd,
              COALESCE(SUM(${expenseAmountExpression}), 0) AS expense_usd
       FROM entities e
       LEFT JOIN transactions t ON t.entity_id = e.id
         AND t.tx_date >= $1::date AND t.tx_date <= $2::date
         AND (t.status = 'validated' OR (
           t.status = 'reversed'
           AND EXISTS (SELECT 1 FROM transactions reversal
             WHERE reversal.reversal_of_id = t.id AND reversal.tx_date > $2::date)
         ))
         AND t.tx_type IN ('income', 'expense', 'adjustment')
       LEFT JOIN transactions source_original ON source_original.id = t.reversal_of_id
       WHERE app_has_entity_permission('finance.report.read', e.id)
         AND ($3::uuid IS NULL OR e.id = $3::uuid)
       GROUP BY e.id
     )
     SELECT entity,
            round(income_usd, 2)::text AS income_usd,
            round(expense_usd, 2)::text AS expense_usd,
            round(income_usd - expense_usd, 2)::text AS net_usd,
            CASE WHEN income_usd > 0
              THEN round((income_usd - expense_usd) * 100 / income_usd, 2)::text
              ELSE NULL
            END AS net_margin_pct
     FROM totals
     ORDER BY entity`,
    [from, to, entityId],
  );
  rows.push(...results.rows.map((row) => summaryRow(row.entity, "result", "", {
    currency: "USD",
    income_usd: row.income_usd,
    expense_usd: row.expense_usd,
    net_usd: row.net_usd,
    net_margin_pct: row.net_margin_pct,
  })));

  const accounts = await client.query<{
    entity: string;
    subject: string;
    currency: string;
    balance: string;
  }>(
    `SELECT e.name AS entity, a.name AS subject, a.currency::text AS currency,
            (a.opening_balance + COALESCE(SUM(CASE
              WHEN t.tx_type IN ('income', 'transfer_in') THEN t.amount
              WHEN t.tx_type IN ('expense', 'transfer_out') THEN -t.amount
              WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'increase' THEN t.amount
              WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'decrease' THEN -t.amount
              ELSE 0
            END) FILTER (WHERE t.status IN ('validated', 'reversed') AND t.tx_date <= $1::date), 0))::text AS balance
     FROM accounts a
     JOIN entities e ON e.id = a.entity_id
     LEFT JOIN transactions t ON t.account_id = a.id
     WHERE a.is_active
       AND (app_has_entity_permission('finance.account.manage', e.id)
         OR app_has_entity_permission('finance.transaction.read', e.id))
       AND ($2::uuid IS NULL OR e.id = $2::uuid)
     GROUP BY e.id, e.name, a.id
     ORDER BY e.name, a.name`,
    [to, entityId],
  );
  rows.push(...accounts.rows.map((row) => summaryRow(row.entity, "treasury", row.subject, {
    currency: row.currency.trim(),
    balance: row.balance,
  })));

  const funds = await client.query<{
    entity: string;
    subject: string;
    currency: string;
    balance: string;
    target_amount: string | null;
  }>(
    `SELECT e.name AS entity, fund.name AS subject, fund.currency::text AS currency,
            (
              COALESCE((SELECT SUM(contribution.amount) FROM fund_contributions contribution
                WHERE contribution.fund_id = fund.id
                  AND contribution.contribution_date <= $1::date), 0)
              - COALESCE((SELECT SUM(contribution.amount)
                FROM fund_contributions contribution
                JOIN transactions reversal ON reversal.id = contribution.reversal_transaction_id
                WHERE contribution.fund_id = fund.id AND reversal.tx_date <= $1::date), 0)
              - COALESCE((SELECT SUM(withdrawal.amount)
                FROM fund_withdrawals withdrawal
                JOIN transactions tx ON tx.id = withdrawal.transaction_id
                WHERE withdrawal.fund_id = fund.id AND tx.tx_date <= $1::date), 0)
              + COALESCE((SELECT SUM(withdrawal.amount)
                FROM fund_withdrawals withdrawal
                JOIN transactions reversal ON reversal.id = withdrawal.reversal_transaction_id
                WHERE withdrawal.fund_id = fund.id AND reversal.tx_date <= $1::date), 0)
            )::text AS balance,
            fund.target_amount::text AS target_amount
     FROM emergency_funds fund
     JOIN entities e ON e.id = fund.entity_id
     WHERE fund.is_active
       AND app_has_entity_permission('finance.fund.read', e.id)
       AND ($2::uuid IS NULL OR e.id = $2::uuid)
     ORDER BY e.name, fund.name`,
    [to, entityId],
  );
  rows.push(...funds.rows.map((row) => summaryRow(row.entity, "emergency_fund", row.subject, {
    currency: row.currency.trim(),
    balance: row.balance,
    target_amount: row.target_amount,
  })));

  const budgets = await client.query<{
    entity: string;
    subject: string;
    currency: string;
    planned_amount: string;
    actual_amount: string | null;
    missing_rate_count: string;
  }>(
    `SELECT e.name AS entity, b.name AS subject, b.currency::text AS currency,
            COALESCE((SELECT SUM(bl.planned_amount) FROM budget_lines bl WHERE bl.budget_id = b.id), 0)::text AS planned_amount,
            CASE WHEN COALESCE(actual.missing_rate_count, 0) > 0
              THEN NULL ELSE COALESCE(actual.amount, 0)::text END AS actual_amount,
            COALESCE(actual.missing_rate_count, 0)::text AS missing_rate_count
     FROM budgets b
     JOIN entities e ON e.id = b.entity_id
     LEFT JOIN LATERAL (
       SELECT SUM(
                (CASE
                  WHEN tx.tx_type = 'income' AND source_original.tx_type = 'expense' THEN -1
                  WHEN tx.tx_type = 'adjustment'
                    AND tx.adjustment_direction = 'increase'
                    AND source_original.tx_type = 'adjustment'
                    AND source_original.adjustment_direction = 'decrease' THEN -1
                  ELSE 1
                END) * CASE
                  WHEN b.currency = 'USD' THEN tx.amount_usd
                  WHEN tx.currency = 'HTG' THEN tx.amount
                  WHEN tx.currency = 'USD' AND fx.htg_per_usd IS NOT NULL
                    THEN ROUND(tx.amount_usd * fx.htg_per_usd, 2)
                END
              ) AS amount,
              COUNT(*) FILTER (
                WHERE b.currency = 'HTG' AND tx.currency = 'USD' AND fx.htg_per_usd IS NULL
              ) AS missing_rate_count
       FROM transactions tx
       LEFT JOIN transactions source_original ON source_original.id = tx.reversal_of_id
       LEFT JOIN LATERAL (
         SELECT CASE WHEN er.from_currency = 'USD' THEN er.rate ELSE 1 / er.rate END AS htg_per_usd
         FROM exchange_rates er
         WHERE er.rate_date <= tx.tx_date
           AND ((er.from_currency = 'USD' AND er.to_currency = 'HTG')
             OR (er.from_currency = 'HTG' AND er.to_currency = 'USD'))
         ORDER BY er.rate_date DESC, (er.from_currency = 'USD') DESC, er.created_at DESC
         LIMIT 1
       ) fx ON true
       WHERE tx.entity_id = b.entity_id
         AND (
         (tx.tx_type = 'expense' AND source_original.tx_type IS DISTINCT FROM 'income')
         OR (tx.tx_type = 'adjustment' AND tx.adjustment_direction = 'decrease'
           AND NOT (source_original.tx_type = 'adjustment'
             AND source_original.adjustment_direction = 'increase'))
         OR (tx.tx_type = 'income' AND source_original.tx_type = 'expense')
         OR (tx.tx_type = 'adjustment' AND tx.adjustment_direction = 'increase'
             AND source_original.tx_type = 'adjustment' AND source_original.adjustment_direction = 'decrease')
         )
         AND tx.status IN ('validated', 'reversed')
         AND tx.tx_date >= CASE
           WHEN b.period_type = 'annual' THEN make_date(b.fiscal_year, 1, 1)
           ELSE make_date(b.fiscal_year, b.period_month, 1)
         END
         AND tx.tx_date <= $1::date
         AND (b.scope <> 'department' OR COALESCE(tx.department_id, source_original.department_id) = b.department_id)
         AND (b.scope <> 'project' OR COALESCE(tx.project_id, source_original.project_id) = b.project_id)
         AND (b.scope <> 'category' OR EXISTS (
           SELECT 1 FROM budget_lines bl
           WHERE bl.budget_id = b.id AND bl.category_id = COALESCE(tx.category_id, source_original.category_id)
         ))
         AND (b.scope <> 'marketing' OR COALESCE(tx.department_id, source_original.department_id) = (
           SELECT id FROM departments WHERE code = 'MKT'
         ))
         AND (b.scope <> 'operations' OR COALESCE(tx.department_id, source_original.department_id) = (
           SELECT id FROM departments WHERE code = 'OPS'
         ))
         AND (b.scope <> 'hr' OR COALESCE(tx.department_id, source_original.department_id) = (
           SELECT id FROM departments WHERE code = 'DRH'
         ))
     ) actual ON true
     WHERE b.status = 'approved'
       AND CASE
         WHEN b.period_type = 'annual' THEN make_date(b.fiscal_year, 1, 1)
         ELSE make_date(b.fiscal_year, b.period_month, 1)
       END <= $1::date
       AND CASE
         WHEN b.period_type = 'annual' THEN make_date(b.fiscal_year + 1, 1, 1)
         ELSE (make_date(b.fiscal_year, b.period_month, 1) + INTERVAL '1 month')::date
       END > $1::date
       AND (app_has_entity_permission('finance.budget.read', e.id)
         OR app_has_entity_permission('finance.budget.manage', e.id))
       AND ($2::uuid IS NULL OR e.id = $2::uuid)
     ORDER BY e.name, b.name`,
    [to, entityId],
  );
  rows.push(...budgets.rows.map((row) => summaryRow(row.entity, "budget", row.subject, {
    currency: row.currency.trim(),
    planned_amount: row.planned_amount,
    actual_amount: row.actual_amount,
    missing_rate_count: row.missing_rate_count,
  })));

  const receivables = await client.query<{
    entity: string;
    currency: string;
    balance: string;
  }>(
    `SELECT e.name AS entity, i.currency::text AS currency,
            round(SUM(GREATEST(i.total - COALESCE(payments.paid, 0), 0)), 2)::text AS balance
     FROM invoices i
     JOIN entities e ON e.id = i.entity_id
     LEFT JOIN LATERAL (
       SELECT SUM(round(payment.amount * payment.fx_rate_to_invoice_currency, 2)) AS paid
       FROM invoice_payments payment
       LEFT JOIN transactions payment_tx ON payment_tx.id = payment.transaction_id
       WHERE payment.invoice_id = i.id
         AND payment.paid_at <= $1::date
         AND (payment_tx.id IS NULL OR (
           payment_tx.tx_date <= $1::date
           AND (payment_tx.status = 'validated' OR (
             payment_tx.status = 'reversed'
             AND EXISTS (SELECT 1 FROM transactions reversal
               WHERE reversal.reversal_of_id = payment_tx.id AND reversal.tx_date > $1::date)
           ))
         ))
     ) payments ON true
     WHERE i.issue_date <= $1::date
       AND i.status NOT IN ('draft', 'cancelled')
       AND (app_has_entity_permission('business.invoice.read', e.id)
         OR app_has_entity_permission('business.invoice.manage', e.id))
       AND ($2::uuid IS NULL OR e.id = $2::uuid)
     GROUP BY e.id, e.name, i.currency
     HAVING SUM(GREATEST(i.total - COALESCE(payments.paid, 0), 0)) > 0
     ORDER BY e.name, i.currency`,
    [to, entityId],
  );
  rows.push(...receivables.rows.map((row) => summaryRow(row.entity, "receivable", "", {
    currency: row.currency.trim(),
    balance: row.balance,
  })));

  const debts = await client.query<{
    entity: string;
    currency: string;
    balance: string;
  }>(
    `SELECT e.name AS entity, debt.currency::text AS currency,
            round(SUM(GREATEST(debt.principal - COALESCE(payments.paid, 0), 0)), 2)::text AS balance
     FROM debts debt
     JOIN entities e ON e.id = debt.entity_id
     LEFT JOIN LATERAL (
       SELECT SUM(payment.amount) AS paid
       FROM debt_payments payment
       JOIN transactions payment_tx ON payment_tx.id = payment.transaction_id
       WHERE payment.debt_id = debt.id
         AND payment.paid_at <= $1::date
         AND payment_tx.tx_date <= $1::date
         AND (payment_tx.status = 'validated' OR (
           payment_tx.status = 'reversed'
           AND EXISTS (SELECT 1 FROM transactions reversal
             WHERE reversal.reversal_of_id = payment_tx.id AND reversal.tx_date > $1::date)
         ))
     ) payments ON true
     WHERE debt.incurred_on <= $1::date
       AND debt.status <> 'cancelled'
       AND (app_has_entity_permission('finance.transaction.read', e.id)
         OR app_has_entity_permission('finance.transaction.create', e.id))
       AND ($2::uuid IS NULL OR e.id = $2::uuid)
     GROUP BY e.id, e.name, debt.currency
     HAVING SUM(GREATEST(debt.principal - COALESCE(payments.paid, 0), 0)) > 0
     ORDER BY e.name, debt.currency`,
    [to, entityId],
  );
  rows.push(...debts.rows.map((row) => summaryRow(row.entity, "debt", "", {
    currency: row.currency.trim(),
    balance: row.balance,
  })));

  return rows;
}

function scopedEntityClause(entityAlias: string) {
  return `app_has_entity_permission($4::text, ${entityAlias}.id)
    AND ($3::uuid IS NULL OR ${entityAlias}.id = $3::uuid)`;
}

async function buildRows(
  client: PoolClient,
  category: ReportCategory,
  from: string,
  to: string,
  entityId: string | null,
) {
  const permission = reportDefinitions[category].permission;
  const scope = scopedEntityClause("e");
  const values = [from, to, entityId, permission];

  switch (category) {
    case "finance":
      return client.query(
        `SELECT to_char(date_trunc('month', t.tx_date), 'YYYY-MM') AS period,
                e.name AS entity, COALESCE(d.name, '—') AS department,
                round(COALESCE(sum(${incomeAmountExpression}), 0), 2)::text AS income_usd,
                round(COALESCE(sum(${expenseAmountExpression}), 0), 2)::text AS expense_usd,
                round(COALESCE(sum(${incomeAmountExpression}), 0)
                  - COALESCE(sum(${expenseAmountExpression}), 0), 2)::text AS net_usd,
                count(*)::text AS transactions
         FROM transactions t
         JOIN entities e ON e.id = t.entity_id
         LEFT JOIN departments d ON d.id = t.department_id
         LEFT JOIN transactions source_original ON source_original.id = t.reversal_of_id
         WHERE t.tx_date >= $1::date AND t.tx_date <= $2::date
           AND (t.status = 'validated' OR (
             t.status = 'reversed'
             AND EXISTS (SELECT 1 FROM transactions reversal
               WHERE reversal.reversal_of_id = t.id AND reversal.tx_date > $2::date)
           ))
           AND t.tx_type IN ('income', 'expense', 'adjustment')
           AND ${scope}
         GROUP BY date_trunc('month', t.tx_date), e.id, d.id
         ORDER BY period DESC, entity, department
         LIMIT ${MAX_ROWS + 1}`,
        values,
      );
    case "hr":
      return client.query(
        `SELECT to_char(date_trunc('month', a.work_date), 'YYYY-MM') AS period,
                e.name AS entity, COALESCE(d.name, '—') AS department,
                count(*) FILTER (WHERE a.status = 'present')::text AS present,
                count(*) FILTER (WHERE a.status = 'absent')::text AS absent,
                count(*) FILTER (WHERE a.status = 'late')::text AS late,
                count(*) FILTER (WHERE a.status = 'permission')::text AS permission,
                count(*) FILTER (WHERE a.status = 'remote')::text AS remote
         FROM attendance_records a
         JOIN employees employee ON employee.id = a.employee_id
         JOIN entities e ON e.id = employee.entity_id
         LEFT JOIN departments d ON d.id = employee.department_id
         WHERE a.work_date >= $1::date AND a.work_date <= $2::date
           AND ${scope}
         GROUP BY date_trunc('month', a.work_date), e.id, d.id
         ORDER BY period DESC, entity, department
         LIMIT ${MAX_ROWS + 1}`,
        values,
      );
    case "business":
      return client.query(
        `SELECT to_char(date_trunc('month', opportunity.created_at), 'YYYY-MM') AS period,
                e.name AS entity, opportunity.stage,
                COALESCE(opportunity.currency, '—') AS currency,
                count(*)::text AS opportunities,
                COALESCE(sum(opportunity.estimated_amount), 0)::text AS estimated
         FROM opportunities opportunity
         JOIN entities e ON e.id = opportunity.entity_id
         WHERE opportunity.created_at >= $1::date
           AND opportunity.created_at < $2::date + interval '1 day'
           AND ${scope}
         GROUP BY date_trunc('month', opportunity.created_at), e.id,
                  opportunity.stage, opportunity.currency
         ORDER BY period DESC, entity, opportunity.stage, currency
         LIMIT ${MAX_ROWS + 1}`,
        values,
      );
    case "marketing":
      return client.query(
        `SELECT campaign.name AS campaign, e.name AS entity,
                COALESCE(d.name, '—') AS department, campaign.status,
                COALESCE(campaign.start_date, campaign.created_at::date)::text AS period,
                campaign.planned_budget::text AS budget, campaign.currency,
                CASE WHEN app_has_entity_permission('finance.transaction.read', e.id)
                  THEN round(COALESCE(expenses.spent_usd, 0), 2)::text
                  ELSE NULL
                END AS spent_usd
         FROM marketing_campaigns campaign
         JOIN entities e ON e.id = campaign.entity_id
         LEFT JOIN departments d ON d.id = campaign.department_id
         LEFT JOIN LATERAL (
           SELECT sum(tx.amount_usd) AS spent_usd
           FROM transactions tx
           WHERE tx.entity_id = campaign.entity_id
             AND EXISTS (
               SELECT 1 FROM campaign_expenses campaign_expense
               WHERE campaign_expense.campaign_id = campaign.id
                 AND campaign_expense.transaction_id = tx.id
             )
             AND tx.status = 'validated'
             AND tx.tx_date >= $1::date AND tx.tx_date <= $2::date
             AND app_has_entity_permission('finance.transaction.read', e.id)
         ) expenses ON true
         WHERE COALESCE(campaign.end_date, campaign.start_date, campaign.created_at::date) >= $1::date
           AND COALESCE(campaign.start_date, campaign.created_at::date) <= $2::date
           AND ${scope}
         ORDER BY campaign.start_date DESC NULLS LAST, campaign.name
         LIMIT ${MAX_ROWS + 1}`,
        values,
      );
    case "operations":
      return client.query(
        `SELECT project.name AS project, e.name AS entity,
                COALESCE(d.name, '—') AS department, project.status,
                project.progress_pct::text AS progress_pct,
                project.budget_amount::text AS budget, project.currency,
                CASE WHEN app_has_entity_permission('finance.transaction.read', e.id)
                  THEN round(COALESCE(expenses.amount_usd, 0), 2)::text
                  ELSE NULL
                END AS expenses_usd
         FROM projects project
         JOIN entities e ON e.id = project.entity_id
         LEFT JOIN departments d ON d.id = project.department_id
         LEFT JOIN LATERAL (
           SELECT sum(tx.amount_usd) AS amount_usd
           FROM transactions tx
           WHERE tx.project_id = project.id AND tx.entity_id = project.entity_id
             AND tx.tx_type = 'expense' AND tx.status = 'validated'
             AND tx.tx_date >= $1::date AND tx.tx_date <= $2::date
             AND app_has_entity_permission('finance.transaction.read', e.id)
         ) expenses ON true
         WHERE COALESCE(project.end_date, project.start_date, project.created_at::date) >= $1::date
           AND COALESCE(project.start_date, project.created_at::date) <= $2::date
           AND ${scope}
         ORDER BY project.updated_at DESC, project.name
         LIMIT ${MAX_ROWS + 1}`,
        values,
      );
    case "store":
      return client.query(
        `SELECT to_char(date_trunc('month', tx.tx_date), 'YYYY-MM') AS period,
                e.name AS entity,
                count(DISTINCT tx.source_id) FILTER (WHERE tx.tx_type = 'income')::text AS receipts,
                round(COALESCE(sum(tx.amount_usd) FILTER (WHERE tx.tx_type = 'income'), 0), 2)::text AS gross_sales_usd,
                round(COALESCE(sum(tx.amount_usd) FILTER (WHERE tx.tx_type = 'expense'), 0), 2)::text AS returned_sales_usd,
                round(COALESCE(sum(tx.amount_usd) FILTER (WHERE tx.tx_type = 'income'), 0)
                  - COALESCE(sum(tx.amount_usd) FILTER (WHERE tx.tx_type = 'expense'), 0), 2)::text AS net_sales_usd
         FROM transactions tx
         JOIN entities e ON e.id = tx.entity_id
         WHERE tx.source_table = 'sales'
           AND tx.tx_type IN ('income', 'expense')
           AND tx.status = 'validated'
           AND tx.tx_date >= $1::date AND tx.tx_date <= $2::date
           AND ${scope}
         GROUP BY date_trunc('month', tx.tx_date), e.id
         ORDER BY period DESC, entity
         LIMIT ${MAX_ROWS + 1}`,
        values,
      );
  }
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    category: params.get("category") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    entityId: params.get("entityId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid report filters." }, { status: 400 });
  }

  try {
    if (!parsed.data.category) {
      const catalog = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
        const categories = await Promise.all(
          (Object.entries(reportDefinitions) as [ReportCategory, (typeof reportDefinitions)[ReportCategory]][])
            .filter(([, definition]) => hasAnyPermission(actor, [definition.permission]))
            .map(async ([category, definition]) => {
              const entities = await client.query<{ id: string; name: string }>(
                `SELECT e.id, e.name FROM entities e
                 WHERE e.is_active AND app_has_entity_permission($1, e.id)
                 ORDER BY e.name`,
                [definition.permission],
              );
              return { category, entities: entities.rows };
            }),
        );
        return { categories: categories.filter((item) => item.entities.length > 0) };
      });
      return NextResponse.json(catalog, { headers: { "Cache-Control": "private, no-store" } });
    }

    const { category, from, to, entityId } = parsed.data;
    if (!from || !to || from > to) {
      return NextResponse.json({ error: "A valid start and end date are required." }, { status: 400 });
    }
    if (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime() > 5 * 366 * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "Report periods cannot exceed five years." }, { status: 400 });
    }

    const permission = reportDefinitions[category].permission;
    if (!hasAnyPermission(actor, [permission])) {
      return NextResponse.json({ error: "Permission denied." }, { status: 403 });
    }
    if (entityId && !hasEntityPermission(actor, permission, entityId)) {
      return NextResponse.json({ error: "Permission denied for this entity." }, { status: 403 });
    }

    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      if (entityId) {
        const selectedEntity = await client.query<{ id: string }>(
          "SELECT id FROM entities WHERE id = $1::uuid AND is_active",
          [entityId],
        );
        if (!selectedEntity.rowCount) return { kind: "not_found" as const };
        const entityAccess = await client.query<{ allowed: boolean }>(
          "SELECT app_has_entity_permission($1, $2::uuid) AS allowed",
          [permission, entityId],
        );
        if (!entityAccess.rows[0]?.allowed) return { kind: "forbidden" as const };
      } else {
        const availableEntity = await client.query<{ allowed: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM entities e
             WHERE e.is_active AND app_has_entity_permission($1, e.id)
           ) AS allowed`,
          [permission],
        );
        if (!availableEntity.rows[0]?.allowed) return { kind: "forbidden" as const };
      }
      const report = await buildRows(client, category, from, to, entityId ?? null);
      const financialSummary = category === "finance"
        ? await buildFinancialSummary(client, from, to, entityId ?? null)
        : undefined;
      const truncated = report.rows.length > MAX_ROWS;
      return {
        kind: "report" as const,
        data: {
          category,
          from,
          to,
          rows: report.rows.slice(0, MAX_ROWS),
          ...(financialSummary ? { financialSummary } : {}),
          rowCount: Math.min(report.rows.length, MAX_ROWS),
          truncated,
          generatedAt: new Date().toISOString(),
        },
      };
    });
    if (result.kind === "not_found") {
      return NextResponse.json({ error: "Entity not found or unavailable." }, { status: 404 });
    }
    if (result.kind === "forbidden") {
      return NextResponse.json({ error: "Permission denied for this entity." }, { status: 403 });
    }
    return NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Unable to load unified reports.", error);
    return NextResponse.json({ error: "Unable to load report data." }, { status: 500 });
  }
}
