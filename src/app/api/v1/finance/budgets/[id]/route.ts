import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";
import { budgetSchema, BudgetPolicyError, hasBudgetPermission, validateBudgetReferences } from "@/lib/finance-budgets";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid budget." }, { status: 400 });
  const parsed = budgetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid budget details." }, { status: 400 });
  if (!hasEntityPermission(actor, "finance.budget.manage", parsed.data.entityId)) {
    return NextResponse.json({ error: "Permission denied for this entity." }, { status: 403 });
  }

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const current = await client.query<{ entity_id: string; created_by: string | null; status: string }>(
        "SELECT entity_id, created_by, status FROM budgets WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!current.rowCount) throw new BudgetPolicyError("Budget not found.", 404);
      if (current.rows[0].created_by !== actor.id) {
        throw new BudgetPolicyError("Only the budget creator can edit it.", 403);
      }
      if (current.rows[0].status !== "draft") {
        throw new BudgetPolicyError("Only draft budgets can be edited.", 409);
      }
      if (current.rows[0].entity_id !== parsed.data.entityId) {
        throw new BudgetPolicyError("A budget cannot be moved to another entity.", 400);
      }
      if (!await hasBudgetPermission(client, parsed.data.entityId)) {
        throw new BudgetPolicyError("Permission denied for this entity.", 403);
      }
      await validateBudgetReferences(client, parsed.data);

      const update = await client.query(
        `UPDATE budgets SET name = $2, fiscal_year = $3, period_type = $4, period_month = $5,
           scope = $6, department_id = $7, project_id = $8, currency = $9,
           alert_threshold_pct = $10::numeric
         WHERE id = $1 AND status = 'draft'`,
        [
          id,
          parsed.data.name,
          parsed.data.fiscalYear,
          parsed.data.periodType,
          parsed.data.periodMonth,
          parsed.data.scope,
          parsed.data.departmentId,
          parsed.data.projectId,
          parsed.data.currency,
          parsed.data.alertThresholdPct,
        ],
      );
      if (!update.rowCount) throw new BudgetPolicyError("Only draft budgets can be edited.", 409);
      await client.query("DELETE FROM budget_lines WHERE budget_id = $1", [id]);
      for (const line of parsed.data.lines) {
        await client.query(
          `INSERT INTO budget_lines(budget_id, category_id, label, planned_amount)
           VALUES ($1, $2, $3, $4::numeric)`,
          [id, line.categoryId, line.label || null, line.plannedAmount],
        );
      }
    });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof BudgetPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to update finance budget.", error);
    return NextResponse.json({ error: "Unable to update finance budget." }, { status: 500 });
  }
}
