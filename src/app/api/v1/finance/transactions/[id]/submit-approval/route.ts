import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";
import { getNextApprovalStep, getStepApproverIds, notifyApprovalUsers } from "@/lib/approvals";
import { schedulePushDeliveryAfterResponse } from "@/lib/web-push";

class SubmissionError extends Error {
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
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid transaction." }, { status: 400 });

  try {
    const approvalRequestId = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{
        id: string;
        entity_id: string;
        tx_number: string;
        tx_type: string;
        amount: string;
        currency: string;
        amount_usd: string;
        status: string;
        created_by: string | null;
      }>(
        `SELECT id, entity_id, tx_number, tx_type, amount::text, currency,
                amount_usd::text, status, created_by
         FROM transactions WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!result.rowCount) throw new SubmissionError("Transaction not found.", 404);
      const transaction = result.rows[0];
      if (!hasEntityPermission(actor, "finance.transaction.create", transaction.entity_id)) {
        throw new SubmissionError("Permission denied for this entity.", 403);
      }
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('finance.transaction.create', $1::uuid) AS allowed",
        [transaction.entity_id],
      );
      if (permission.rows[0]?.allowed !== true) throw new SubmissionError("Permission denied for this entity.", 403);
      if (transaction.created_by !== actor.id) {
        throw new SubmissionError("Only the transaction creator can submit it for approval.", 403);
      }
      if (transaction.tx_type !== "expense" || transaction.status !== "draft") {
        throw new SubmissionError("Only draft expense transactions can be submitted for approval.", 409);
      }
      const existing = await client.query(
        `SELECT 1 FROM approval_requests
         WHERE ref_table = 'transactions' AND ref_id = $1
           AND request_type = 'expense' AND status = 'pending'`,
        [id],
      );
      if (existing.rowCount) throw new SubmissionError("This transaction already has a pending approval request.", 409);

      const workflowResult = await client.query<{ id: string }>(
        `SELECT id FROM approval_workflows
         WHERE request_type = 'expense' AND is_active
           AND (entity_id = $1 OR entity_id IS NULL)
         ORDER BY (entity_id IS NOT NULL) DESC
         LIMIT 1`,
        [transaction.entity_id],
      );
      if (!workflowResult.rowCount) throw new SubmissionError("No active expense approval workflow is configured.", 409);
      const workflowId = workflowResult.rows[0].id;
      const amountResult = await client.query<{ amount_usd: string }>(
        "SELECT GREATEST($1::numeric, 0.01)::numeric(18,2)::text AS amount_usd",
        [transaction.amount_usd],
      );
      const amountUsd = amountResult.rows[0].amount_usd;
      const firstStep = await getNextApprovalStep(client, workflowId, 0, amountUsd);
      if (!firstStep) throw new SubmissionError("The expense workflow has no applicable approval step.", 409);
      const approverIds = (await getStepApproverIds(client, firstStep, transaction.entity_id))
        .filter((userId) => userId !== actor.id);
      if (!approverIds.length) {
        throw new SubmissionError("No eligible approver other than the requester is configured for the first step.", 409);
      }

      const requestResult = await client.query<{ id: string }>(
        `INSERT INTO approval_requests(
           workflow_id, request_type, ref_table, ref_id, requester_id, title,
           amount, currency, amount_usd, current_step
         )
         VALUES ($1, 'expense', 'transactions', $2, $3, $4, $5::numeric, $6, $7::numeric, $8)
         RETURNING id`,
        [
          workflowId,
          id,
          actor.id,
          transaction.tx_number,
          transaction.amount,
          transaction.currency,
          amountUsd,
          firstStep.step_order,
        ],
      );
      const approvalRequestId = requestResult.rows[0].id;
      await client.query("UPDATE transactions SET status = 'pending_approval' WHERE id = $1", [id]);
      await notifyApprovalUsers(client, approverIds, {
        kind: "approval_needed",
        title: {
          fr: "Approbation requise",
          ht: "Apwobasyon nesesè",
          en: "Approval needed",
        },
        body: {
          fr: `La dépense ${transaction.tx_number} attend votre décision.`,
          ht: `Depans ${transaction.tx_number} ap tann desizyon ou.`,
          en: `Expense ${transaction.tx_number} is awaiting your decision.`,
        },
        link: "/modules/approvals",
        refTable: "approval_requests",
        refId: approvalRequestId,
      });
      return approvalRequestId;
    });
    schedulePushDeliveryAfterResponse();
    return NextResponse.json({ id: approvalRequestId }, { status: 201 });
  } catch (error) {
    if (error instanceof SubmissionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to submit expense for approval.", error);
    return NextResponse.json({ error: "Unable to submit expense for approval." }, { status: 500 });
  }
}
