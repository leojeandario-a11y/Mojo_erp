import { NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";

const amountSchema = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);
const budgetSchema = z.object({
  entityId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  fiscalYear: z.number().int().min(2000).max(2200),
  periodType: z.enum(["annual", "monthly"]),
  periodMonth: z.number().int().min(1).max(12).nullable(),
  scope: z.enum(["global", "department", "project", "category"]),
  departmentId: z.uuid().nullable(),
  projectId: z.uuid().nullable(),
  currency: z.enum(["HTG", "USD"]),
  alertThresholdPct: z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  lines: z.array(z.object({
    categoryId: z.uuid().nullable(),
    label: z.string().trim().max(120).nullable(),
    plannedAmount: amountSchema,
  }).strict().refine((line) => line.categoryId !== null || Boolean(line.label), {
    message: "Each budget line needs a category or a label.",
  })).min(1).max(100),
}).strict().superRefine((budget, context) => {
  if ((budget.periodType === "annual") !== (budget.periodMonth === null)) {
    context.addIssue({ code: "custom", path: ["periodMonth"], message: "The period month does not match the period type." });
  }
  if ((budget.scope === "department") !== (budget.departmentId !== null)) {
    context.addIssue({ code: "custom", path: ["departmentId"], message: "A department is required only for department budgets." });
  }
  if ((budget.scope === "project") !== (budget.projectId !== null)) {
    context.addIssue({ code: "custom", path: ["projectId"], message: "A project is required only for project budgets." });
  }
  if (budget.scope === "category" && budget.lines.some((line) => line.categoryId === null)) {
    context.addIssue({ code: "custom", path: ["lines"], message: "Category budgets require a category on every line." });
  }
});

class BudgetPolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function hasBudgetPermission(client: PoolClient, entityId: string) {
  const result = await client.query<{ allowed: boolean }>(
    "SELECT app_has_entity_permission('finance.budget.manage', $1::uuid) AS allowed",
    [entityId],
  );
  return result.rows[0]?.allowed === true;
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const readableEntities = Object.keys(actor.entityPermissions).filter((entityId) =>
    hasEntityPermission(actor, "finance.budget.read", entityId)
    || hasEntityPermission(actor, "finance.budget.manage", entityId),
  );
  const manageableEntities = Object.keys(actor.entityPermissions).filter((entityId) =>
    hasEntityPermission(actor, "finance.budget.manage", entityId),
  );
  const canReadAll = actor.permissions.includes("*")
    || actor.permissions.includes("finance.budget.read")
    || actor.permissions.includes("finance.budget.manage");
  const canManageAll = actor.permissions.includes("*")
    || actor.permissions.includes("finance.budget.manage");
  if (!canReadAll && readableEntities.length === 0) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const entityResult = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM entities WHERE is_active ORDER BY name",
      );
      const readable = canReadAll
        ? entityResult.rows
        : entityResult.rows.filter(({ id }) => readableEntities.includes(id));
      const manageable = canManageAll
        ? entityResult.rows
        : entityResult.rows.filter(({ id }) => manageableEntities.includes(id));
      const entityIds = readable.map(({ id }) => id);
      const budgetsResult = entityIds.length
        ? await client.query<{
          id: string;
          entity_id: string;
          entity_name: string;
          name: string;
          fiscal_year: number;
          period_type: "annual" | "monthly";
          period_month: number | null;
          scope: string;
          department_id: string | null;
          department_name: string | null;
          project_id: string | null;
          project_name: string | null;
          currency: string;
          status: string;
          alert_threshold_pct: string;
          planned_amount: string;
          actual_amount: string | null;
          threshold_reached: boolean;
          missing_rate_count: string;
        }>(
          `SELECT b.id, b.entity_id, e.name AS entity_name, b.name, b.fiscal_year,
                  b.period_type, b.period_month, b.scope, b.department_id, d.name AS department_name,
                  b.project_id, p.name AS project_name, b.currency, b.status,
                  b.alert_threshold_pct::text,
                  COALESCE((SELECT SUM(bl.planned_amount) FROM budget_lines bl WHERE bl.budget_id = b.id), 0)::text AS planned_amount,
                  CASE WHEN COALESCE(actual.missing_rate_count, 0) > 0
                    THEN NULL ELSE COALESCE(actual.amount, 0)::text END AS actual_amount,
                  COALESCE((SELECT SUM(bl.planned_amount) FROM budget_lines bl WHERE bl.budget_id = b.id), 0) > 0
                    AND COALESCE(actual.missing_rate_count, 0) = 0
                    AND COALESCE(actual.amount, 0) >=
                      COALESCE((SELECT SUM(bl.planned_amount) FROM budget_lines bl WHERE bl.budget_id = b.id), 0)
                      * b.alert_threshold_pct / 100 AS threshold_reached,
                  COALESCE(actual.missing_rate_count, 0)::text AS missing_rate_count
           FROM budgets b
           JOIN entities e ON e.id = b.entity_id
           LEFT JOIN departments d ON d.id = b.department_id
           LEFT JOIN projects p ON p.id = b.project_id
           LEFT JOIN LATERAL (
             SELECT SUM(
                      CASE
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
               AND tx.tx_type = 'expense'
               AND tx.status = 'validated'
               AND tx.tx_date >= CASE
                 WHEN b.period_type = 'annual' THEN make_date(b.fiscal_year, 1, 1)
                 ELSE make_date(b.fiscal_year, b.period_month, 1)
               END
               AND tx.tx_date < CASE
                 WHEN b.period_type = 'annual' THEN make_date(b.fiscal_year + 1, 1, 1)
                 ELSE (make_date(b.fiscal_year, b.period_month, 1) + INTERVAL '1 month')::date
               END
               AND (b.scope <> 'department' OR tx.department_id = b.department_id)
               AND (b.scope <> 'project' OR tx.project_id = b.project_id)
               AND (b.scope <> 'category' OR EXISTS (
                 SELECT 1 FROM budget_lines bl
                 WHERE bl.budget_id = b.id AND bl.category_id = tx.category_id
               ))
           ) actual ON true
           WHERE b.entity_id = ANY($1::uuid[])
           ORDER BY b.fiscal_year DESC, b.period_month NULLS FIRST, e.name, b.name`,
          [entityIds],
        )
        : { rows: [] };
      const budgetIds = budgetsResult.rows.map(({ id }) => id);
      const linesResult = budgetIds.length
        ? await client.query<{
          id: string;
          budget_id: string;
          category_id: string | null;
          category_name: string | null;
          label: string | null;
          planned_amount: string;
        }>(
          `SELECT bl.id, bl.budget_id, bl.category_id, tc.name AS category_name,
                  bl.label, bl.planned_amount::text
           FROM budget_lines bl
           LEFT JOIN transaction_categories tc ON tc.id = bl.category_id
           WHERE bl.budget_id = ANY($1::uuid[])
           ORDER BY bl.budget_id, tc.name NULLS LAST, bl.label`,
          [budgetIds],
        )
        : { rows: [] };
      const departments = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM departments WHERE is_active ORDER BY name",
      );
      const projects = entityIds.length
        ? await client.query<{ id: string; entity_id: string; name: string }>(
          "SELECT id, entity_id, name FROM projects WHERE entity_id = ANY($1::uuid[]) ORDER BY name",
          [entityIds],
        )
        : { rows: [] };
      const categories = entityIds.length
        ? await client.query<{ id: string; entity_id: string | null; name: string }>(
          `SELECT id, entity_id, name FROM transaction_categories
           WHERE kind = 'expense' AND is_active AND (entity_id IS NULL OR entity_id = ANY($1::uuid[]))
           ORDER BY name`,
          [entityIds],
        )
        : { rows: [] };

      return {
        budgets: budgetsResult.rows.map((budget) => ({
          ...budget,
          lines: linesResult.rows.filter((line) => line.budget_id === budget.id),
        })),
        entities: readable,
        manageableEntityIds: manageable.map(({ id }) => id),
        departments: departments.rows,
        projects: projects.rows,
        categories: categories.rows,
      };
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unable to load finance budgets.", error);
    return NextResponse.json({ error: "Unable to load finance budgets." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = budgetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid budget details." }, { status: 400 });
  if (!hasEntityPermission(actor, "finance.budget.manage", parsed.data.entityId)) {
    return NextResponse.json({ error: "Permission denied for this entity." }, { status: 403 });
  }

  try {
    const id = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      if (!await hasBudgetPermission(client, parsed.data.entityId)) {
        throw new BudgetPolicyError("Permission denied for this entity.", 403);
      }
      const { entityId, departmentId, projectId, lines } = parsed.data;
      if (departmentId) {
        const result = await client.query("SELECT 1 FROM departments WHERE id = $1 AND is_active", [departmentId]);
        if (!result.rowCount) throw new BudgetPolicyError("The selected department is not active.", 400);
      }
      if (projectId) {
        const result = await client.query("SELECT 1 FROM projects WHERE id = $1 AND entity_id = $2", [projectId, entityId]);
        if (!result.rowCount) throw new BudgetPolicyError("The selected project is not part of this entity.", 400);
      }
      const categoryIds = [...new Set(lines.flatMap(({ categoryId }) => categoryId ? [categoryId] : []))];
      if (categoryIds.length) {
        const result = await client.query<{ id: string }>(
          `SELECT id FROM transaction_categories
           WHERE id = ANY($1::uuid[]) AND kind = 'expense' AND is_active
             AND (entity_id IS NULL OR entity_id = $2)`,
          [categoryIds, entityId],
        );
        if (result.rowCount !== categoryIds.length) {
          throw new BudgetPolicyError("A selected category is not available for this entity.", 400);
        }
      }

      const budgetResult = await client.query<{ id: string }>(
        `INSERT INTO budgets(
           entity_id, name, fiscal_year, period_type, period_month, scope,
           department_id, project_id, currency, alert_threshold_pct, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11)
         RETURNING id`,
        [
          entityId,
          parsed.data.name,
          parsed.data.fiscalYear,
          parsed.data.periodType,
          parsed.data.periodMonth,
          parsed.data.scope,
          departmentId,
          projectId,
          parsed.data.currency,
          parsed.data.alertThresholdPct,
          actor.id,
        ],
      );
      const budgetId = budgetResult.rows[0].id;
      for (const line of lines) {
        await client.query(
          `INSERT INTO budget_lines(budget_id, category_id, label, planned_amount)
           VALUES ($1, $2, $3, $4::numeric)`,
          [budgetId, line.categoryId, line.label || null, line.plannedAmount],
        );
      }
      return budgetId;
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof BudgetPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to create finance budget.", error);
    return NextResponse.json({ error: "Unable to create finance budget." }, { status: 500 });
  }
}
