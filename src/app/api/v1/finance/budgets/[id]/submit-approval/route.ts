import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { exchangeRateToUsd } from "@/lib/finance-exchange-rates";
import { getNextApprovalStep, getStepApproverIds, notifyApprovalUsers } from "@/lib/approvals";
import { hasEntityPermission } from "@/lib/permissions";
import { schedulePushDeliveryAfterResponse } from "@/lib/web-push";

class BudgetSubmissionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid budget." }, { status: 400 });

  try {
    const approvalRequestId = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{
        id: string;
        entity_id: string;
        name: string;
        fiscal_year: number;
        period_type: string;
        period_month: number | null;
        currency: string;
        status: string;
        created_by: string | null;
      }>(
        `SELECT id, entity_id, name, fiscal_year, period_type, period_month,
                currency, status, created_by
         FROM budgets WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!result.rowCount) throw new BudgetSubmissionError("Budget not found.", 404);
      const budget = result.rows[0];
      if (!hasEntityPermission(actor, "finance.budget.manage", budget.entity_id)) {
        throw new BudgetSubmissionError("Permission denied for this entity.", 403);
      }
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('finance.budget.manage', $1::uuid) AS allowed",
        [budget.entity_id],
      );
      if (permission.rows[0]?.allowed !== true) {
        throw new BudgetSubmissionError("Permission denied for this entity.", 403);
      }
      if (budget.created_by !== actor.id) {
        throw new BudgetSubmissionError("Only the budget creator can submit it for approval.", 403);
      }
      if (budget.status !== "draft") {
        throw new BudgetSubmissionError("Only draft budgets can be submitted for approval.", 409);
      }
      const existing = await client.query(
        `SELECT 1 FROM approval_requests
         WHERE request_type = 'budget' AND ref_table = 'budgets'
           AND ref_id = $1 AND status = 'pending'`,
        [id],
      );
      if (existing.rowCount) {
        throw new BudgetSubmissionError("This budget already has a pending approval request.", 409);
      }
      const workflow = await client.query<{ id: string }>(
        `SELECT id FROM approval_workflows
         WHERE request_type = 'budget' AND is_active
           AND (entity_id = $1 OR entity_id IS NULL)
         ORDER BY (entity_id IS NOT NULL) DESC
         LIMIT 1`,
        [budget.entity_id],
      );
      if (!workflow.rowCount) {
        throw new BudgetSubmissionError("No active budget approval workflow is configured.", 409);
      }

      const total = await client.query<{ planned_amount: string }>(
        "SELECT COALESCE(SUM(planned_amount), 0)::text AS planned_amount FROM budget_lines WHERE budget_id = $1",
        [id],
      );
      const today = await client.query<{ today: string }>("SELECT CURRENT_DATE::text AS today");
      const fxRate = await exchangeRateToUsd(client, budget.currency, today.rows[0].today);
      if (!fxRate) {
        throw new BudgetSubmissionError(`No exchange rate is available for ${today.rows[0].today}.`, 409);
      }
      const amountUsd = await client.query<{ amount_usd: string }>(
        "SELECT ROUND($1::numeric * $2::numeric, 2)::text AS amount_usd",
        [total.rows[0].planned_amount, fxRate],
      );
      const workflowId = workflow.rows[0].id;
      const firstStep = await getNextApprovalStep(client, workflowId, 0, amountUsd.rows[0].amount_usd);
      if (!firstStep) {
        throw new BudgetSubmissionError("The budget workflow has no applicable approval step.", 409);
      }
      const approverIds = (await getStepApproverIds(client, firstStep, budget.entity_id))
        .filter((userId) => userId !== actor.id);
      if (!approverIds.length) {
        throw new BudgetSubmissionError("No eligible approver other than the requester is configured for the first step.", 409);
      }

      const approval = await client.query<{ id: string }>(
        `INSERT INTO approval_requests(
           workflow_id, request_type, ref_table, ref_id, requester_id, title,
           amount, currency, amount_usd, current_step
         )
         VALUES ($1, 'budget', 'budgets', $2, $3, $4, $5::numeric, $6, $7::numeric, $8)
         RETURNING id`,
        [
          workflowId,
          id,
          actor.id,
          budget.name,
          total.rows[0].planned_amount,
          budget.currency,
          amountUsd.rows[0].amount_usd,
          firstStep.step_order,
        ],
      );
      const requestId = approval.rows[0].id;
      await client.query("UPDATE budgets SET status = 'pending_approval' WHERE id = $1", [id]);
      await notifyApprovalUsers(client, approverIds, {
        kind: "approval_needed",
        title: {
          fr: "Approbation de budget requise",
          ht: "Apwobasyon bidjè nesesè",
          en: "Budget approval needed",
        },
        body: {
          fr: `Le budget « ${budget.name} » attend votre décision.`,
          ht: `Bidjè « ${budget.name} » ap tann desizyon ou.`,
          en: `Budget “${budget.name}” is awaiting your decision.`,
        },
        link: "/modules/approvals",
        refTable: "approval_requests",
        refId: requestId,
      });
      return requestId;
    });
    schedulePushDeliveryAfterResponse();
    return NextResponse.json({ id: approvalRequestId }, { status: 201 });
  } catch (error) {
    if (error instanceof BudgetSubmissionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to submit budget for approval.", error);
    return NextResponse.json({ error: "Unable to submit budget for approval." }, { status: 500 });
  }
}
