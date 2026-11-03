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
                round(COALESCE(sum(t.amount_usd) FILTER (
                  WHERE t.tx_type = 'income'
                    OR (t.tx_type = 'adjustment' AND t.adjustment_direction = 'increase')
                ), 0), 2)::text AS income_usd,
                round(COALESCE(sum(t.amount_usd) FILTER (
                  WHERE t.tx_type = 'expense'
                    OR (t.tx_type = 'adjustment' AND t.adjustment_direction = 'decrease')
                ), 0), 2)::text AS expense_usd,
                round(COALESCE(sum(t.amount_usd) FILTER (
                  WHERE t.tx_type = 'income'
                    OR (t.tx_type = 'adjustment' AND t.adjustment_direction = 'increase')
                ), 0) - COALESCE(sum(t.amount_usd) FILTER (
                  WHERE t.tx_type = 'expense'
                    OR (t.tx_type = 'adjustment' AND t.adjustment_direction = 'decrease')
                ), 0), 2)::text AS net_usd,
                count(*)::text AS transactions
         FROM transactions t
         JOIN entities e ON e.id = t.entity_id
         LEFT JOIN departments d ON d.id = t.department_id
         WHERE t.tx_date >= $1::date AND t.tx_date <= $2::date
           AND t.status = 'validated'
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
      const truncated = report.rows.length > MAX_ROWS;
      return {
        kind: "report" as const,
        data: {
          category,
          from,
          to,
          rows: report.rows.slice(0, MAX_ROWS),
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
