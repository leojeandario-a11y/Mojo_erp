import { z } from "zod";
import type { PoolClient } from "pg";

const amountSchema = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);

export const budgetSchema = z.object({
  entityId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  fiscalYear: z.number().int().min(2000).max(2200),
  periodType: z.enum(["annual", "monthly"]),
  periodMonth: z.number().int().min(1).max(12).nullable(),
  scope: z.enum(["global", "department", "project", "category", "marketing", "operations", "hr"]),
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

export class BudgetPolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function hasBudgetPermission(client: PoolClient, entityId: string) {
  const result = await client.query<{ allowed: boolean }>(
    "SELECT app_has_entity_permission('finance.budget.manage', $1::uuid) AS allowed",
    [entityId],
  );
  return result.rows[0]?.allowed === true;
}

export async function validateBudgetReferences(
  client: PoolClient,
  budget: z.infer<typeof budgetSchema>,
) {
  const { entityId, departmentId, projectId, lines } = budget;
  if (departmentId) {
    const result = await client.query("SELECT 1 FROM departments WHERE id = $1 AND is_active", [departmentId]);
    if (!result.rowCount) throw new BudgetPolicyError("The selected department is not active.", 400);
  }
  if (projectId) {
    const result = await client.query("SELECT 1 FROM projects WHERE id = $1 AND entity_id = $2", [projectId, entityId]);
    if (!result.rowCount) throw new BudgetPolicyError("The selected project is not part of this entity.", 400);
  }
  const moduleDepartmentCodes: Partial<Record<typeof budget.scope, string>> = {
    marketing: "MKT",
    operations: "OPS",
    hr: "DRH",
  };
  const moduleDepartmentCode = moduleDepartmentCodes[budget.scope];
  if (moduleDepartmentCode) {
    const result = await client.query(
      "SELECT 1 FROM departments WHERE code = $1 AND is_active",
      [moduleDepartmentCode],
    );
    if (!result.rowCount) {
      throw new BudgetPolicyError("The department required for this budget scope is not active.", 400);
    }
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
}
