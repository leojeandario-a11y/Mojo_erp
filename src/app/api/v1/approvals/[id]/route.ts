import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { getNextApprovalStep, getStepApproverIds, isAssignedApprover, notifyApprovalUsers } from "@/lib/approvals";
import { hasEntityPermission } from "@/lib/permissions";
import { schedulePushDeliveryAfterResponse } from "@/lib/web-push";
import { notifyFundRequesters } from "@/lib/emergency-fund";

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "returned"]),
  comment: z.string().trim().max(1000).nullable().optional(),
}).strict();

class ApprovalError extends Error {
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
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid approval request." }, { status: 400 });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid approval decision." }, { status: 400 });

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const requestResult = await client.query<{
        id: string;
        workflow_id: string;
        request_type: "expense" | "purchase" | "budget" | "fund_rate" | "fund_withdrawal";
        requester_id: string;
        title: string;
        amount_usd: string | null;
        current_step: number;
        status: string;
        ref_id: string;
        ref_table: string;
      }>(
        `SELECT ar.id, ar.workflow_id, ar.request_type, ar.requester_id, ar.title,
                ar.amount_usd::text, ar.current_step, ar.status, ar.ref_id, ar.ref_table
         FROM approval_requests ar
         WHERE ar.id = $1
           AND ar.request_type IN ('expense', 'purchase', 'budget', 'fund_rate', 'fund_withdrawal')
         FOR UPDATE`,
        [id],
      );
      if (!requestResult.rowCount) throw new ApprovalError("Approval request not found.", 404);
      const approvalRequest = requestResult.rows[0];
      let resource: {
        entity_id: string;
        resource_status: string;
        title: string;
        effective_from?: string;
        amount?: string;
        currency?: string;
        fund_id?: string;
        requester_id?: string;
      } | undefined;
      if (approvalRequest.request_type === "expense" && approvalRequest.ref_table === "transactions") {
        const transaction = await client.query<{ entity_id: string; status: string; tx_number: string }>(
          "SELECT entity_id, status, tx_number FROM transactions WHERE id = $1 FOR UPDATE",
          [approvalRequest.ref_id],
        );
        if (transaction.rowCount) {
          resource = {
            entity_id: transaction.rows[0].entity_id,
            resource_status: transaction.rows[0].status,
            title: transaction.rows[0].tx_number,
          };
        }
      } else if (approvalRequest.request_type === "purchase" && approvalRequest.ref_table === "purchase_requests") {
        const purchase = await client.query<{ entity_id: string; status: string; description: string }>(
          "SELECT entity_id, status, description FROM purchase_requests WHERE id = $1 FOR UPDATE",
          [approvalRequest.ref_id],
        );
        if (purchase.rowCount) {
          resource = {
            entity_id: purchase.rows[0].entity_id,
            resource_status: purchase.rows[0].status,
            title: purchase.rows[0].description,
          };
        }
      } else if (approvalRequest.request_type === "budget" && approvalRequest.ref_table === "budgets") {
        const budget = await client.query<{ entity_id: string; status: string; name: string }>(
          "SELECT entity_id, status, name FROM budgets WHERE id = $1 FOR UPDATE",
          [approvalRequest.ref_id],
        );
        if (budget.rowCount) {
          resource = {
            entity_id: budget.rows[0].entity_id,
            resource_status: budget.rows[0].status,
            title: budget.rows[0].name,
          };
        }
      } else if (approvalRequest.request_type === "fund_rate"
          && approvalRequest.ref_table === "emergency_fund_rates") {
        const rate = await client.query<{
          entity_id: string;
          approval_status: string;
          percentage: string;
          effective_from: string;
        }>(
          `SELECT fund.entity_id, rate.approval_status, rate.percentage::text, rate.effective_from::text
           FROM emergency_fund_rates rate
           JOIN emergency_funds fund ON fund.id = rate.fund_id
           WHERE rate.id = $1 FOR UPDATE OF rate`,
          [approvalRequest.ref_id],
        );
        if (rate.rowCount) {
          resource = {
            entity_id: rate.rows[0].entity_id,
            resource_status: rate.rows[0].approval_status,
            title: `${rate.rows[0].percentage}%`,
            effective_from: rate.rows[0].effective_from,
          };
        }
      } else if (approvalRequest.request_type === "fund_withdrawal"
          && approvalRequest.ref_table === "fund_withdrawals") {
        const withdrawal = await client.query<{
          entity_id: string;
          fund_id: string;
          status: string;
          amount: string;
          currency: string;
          reason: string;
          requested_by: string;
        }>(
          `SELECT fund.entity_id, fund.id AS fund_id, withdrawal.status,
                  withdrawal.amount::text, withdrawal.currency, withdrawal.reason,
                  withdrawal.requested_by
           FROM fund_withdrawals withdrawal
           JOIN emergency_funds fund ON fund.id = withdrawal.fund_id
           WHERE withdrawal.id = $1 FOR UPDATE OF withdrawal`,
          [approvalRequest.ref_id],
        );
        if (withdrawal.rowCount) {
          resource = {
            entity_id: withdrawal.rows[0].entity_id,
            resource_status: withdrawal.rows[0].status,
            title: withdrawal.rows[0].reason,
            amount: withdrawal.rows[0].amount,
            currency: withdrawal.rows[0].currency,
            fund_id: withdrawal.rows[0].fund_id,
            requester_id: withdrawal.rows[0].requested_by,
          };
        }
      }
      if (!resource) throw new ApprovalError("Approval request not found.", 404);
      const approval = { ...approvalRequest, ...resource };
      if (approval.amount_usd === null) throw new ApprovalError("Approval request is missing its converted amount.", 409);
      const expectedResourceStatus = approval.request_type === "expense" || approval.request_type === "budget"
        ? "pending_approval"
        : "pending";
      if (approval.status !== "pending" || resource.resource_status !== expectedResourceStatus) {
        throw new ApprovalError("This approval request is no longer pending.", 409);
      }
      if (approval.requester_id === actor.id) {
        throw new ApprovalError("A requester cannot approve or reject their own request.", 403);
      }
      if (!hasEntityPermission(actor, "approvals.approve", approval.entity_id)) {
        throw new ApprovalError("Permission denied for this entity.", 403);
      }
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('approvals.approve', $1::uuid) AS allowed",
        [approval.entity_id],
      );
      if (permission.rows[0]?.allowed !== true) throw new ApprovalError("Permission denied for this entity.", 403);

      const stepResult = await client.query<{
        step_order: number;
        label: string;
        approver_role_id: string | null;
        approver_user_id: string | null;
        min_amount_usd: string | null;
      }>(
        `SELECT step_order, label, approver_role_id, approver_user_id, min_amount_usd::text
         FROM approval_workflow_steps
         WHERE workflow_id = $1 AND step_order = $2`,
        [approval.workflow_id, approval.current_step],
      );
      const step = stepResult.rows[0];
      if (!step || (step.min_amount_usd !== null && Number(approval.amount_usd) < Number(step.min_amount_usd))) {
        throw new ApprovalError("The current approval step is not applicable.", 409);
      }
      if (!await isAssignedApprover(client, actor.id, approval.entity_id, step)) {
        throw new ApprovalError("You are not assigned to the current approval step.", 403);
      }
      if (parsed.data.decision === "returned"
          && (approval.request_type === "fund_rate" || approval.request_type === "fund_withdrawal")) {
        throw new ApprovalError("Fund requests must be approved or rejected; they cannot be returned to draft.", 409);
      }
      if (parsed.data.decision === "returned") {
        const migrationResult = await client.query<{ applied: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = $1) AS applied",
          ["020_approval_request_returned_status.sql"],
        );
        if (!migrationResult.rows[0]?.applied) {
          throw new ApprovalError("Returning requests is unavailable until migration 020 is applied.", 409);
        }
      }

      await client.query(
        `INSERT INTO approval_actions(request_id, step_order, actor_id, decision, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, step.step_order, actor.id, parsed.data.decision, parsed.data.comment || null],
      );

      if (parsed.data.decision === "rejected") {
        await client.query(
          "UPDATE approval_requests SET status = 'rejected', closed_at = now() WHERE id = $1",
          [id],
        );
        if (approval.request_type === "expense") {
          await client.query(
            "UPDATE transactions SET status = 'rejected' WHERE id = $1 AND status = 'pending_approval'",
            [approval.ref_id],
          );
        } else if (approval.request_type === "purchase") {
          await client.query(
            "UPDATE purchase_requests SET status = 'rejected' WHERE id = $1 AND status = 'pending'",
            [approval.ref_id],
          );
        } else if (approval.request_type === "budget") {
          await client.query(
            "UPDATE budgets SET status = 'rejected' WHERE id = $1 AND status = 'pending_approval'",
            [approval.ref_id],
          );
        } else if (approval.request_type === "fund_rate") {
          await client.query(
            "UPDATE emergency_fund_rates SET approval_status = 'rejected' WHERE id = $1 AND approval_status = 'pending'",
            [approval.ref_id],
          );
        } else {
          await client.query(
            "UPDATE fund_withdrawals SET status = 'rejected', decided_at = now() WHERE id = $1 AND status = 'pending'",
            [approval.ref_id],
          );
        }
        await notifyApprovalUsers(client, [approval.requester_id], {
          kind: "system",
          title: { fr: "Demande refusée", ht: "Demann lan refize", en: "Request rejected" },
          body: {
            fr: `La demande « ${approval.title} » a été refusée.`,
            ht: `Yo refize demann « ${approval.title} ».`,
            en: `Request “${approval.title}” was rejected.`,
          },
          link: "/modules/finance",
          refTable: "approval_requests",
          refId: id,
        });
        return;
      }

      if (parsed.data.decision === "returned") {
        await client.query(
          "UPDATE approval_requests SET status = 'returned', closed_at = now() WHERE id = $1",
          [id],
        );
        let returnedResource: { rowCount: number | null };
        if (approval.request_type === "expense") {
          returnedResource = await client.query(
            "UPDATE transactions SET status = 'draft' WHERE id = $1 AND status = 'pending_approval'",
            [approval.ref_id],
          );
        } else if (approval.request_type === "purchase") {
          returnedResource = await client.query(
            "UPDATE purchase_requests SET status = 'draft' WHERE id = $1 AND status = 'pending'",
            [approval.ref_id],
          );
        } else {
          returnedResource = await client.query(
            "UPDATE budgets SET status = 'draft' WHERE id = $1 AND status = 'pending_approval'",
            [approval.ref_id],
          );
        }
        if (!returnedResource.rowCount) {
          throw new ApprovalError("The request could not be returned to its draft state.", 409);
        }
        await notifyApprovalUsers(client, [approval.requester_id], {
          kind: "system",
          title: { fr: "Modifications demandées", ht: "Yo mande chanjman", en: "Changes requested" },
          body: {
            fr: `La demande « ${approval.title} » vous a été renvoyée pour modification.`,
            ht: `Yo voye demann « ${approval.title} » tounen ba ou pou modifye.`,
            en: `Request “${approval.title}” was returned to you for changes.`,
          },
          link: "/modules/finance",
          refTable: "approval_requests",
          refId: id,
        });
        return;
      }

      const nextStep = await getNextApprovalStep(
        client,
        approval.workflow_id,
        step.step_order,
        approval.amount_usd,
      );
      if (nextStep) {
        const nextApproverIds = (await getStepApproverIds(client, nextStep, approval.entity_id))
          .filter((userId) => userId !== approval.requester_id);
        if (!nextApproverIds.length) {
          throw new ApprovalError("No eligible approver is configured for the next workflow step.", 409);
        }
        await client.query(
          "UPDATE approval_requests SET current_step = $2 WHERE id = $1 AND status = 'pending'",
          [id, nextStep.step_order],
        );
        await notifyApprovalUsers(client, nextApproverIds, {
          kind: "approval_needed",
          title: { fr: "Approbation requise", ht: "Apwobasyon nesesè", en: "Approval needed" },
          body: {
            fr: `La demande « ${approval.title} » attend votre décision.`,
            ht: `Demann « ${approval.title} » ap tann desizyon ou.`,
            en: `Request “${approval.title}” is awaiting your decision.`,
          },
          link: "/modules/approvals",
          refTable: "approval_requests",
          refId: id,
        });
        return;
      }

      await client.query(
        "UPDATE approval_requests SET status = 'approved', closed_at = now() WHERE id = $1",
        [id],
      );
      if (approval.request_type === "purchase") {
        const purchaseResult = await client.query(
          "UPDATE purchase_requests SET status = 'approved' WHERE id = $1 AND status = 'pending'",
          [approval.ref_id],
        );
        if (!purchaseResult.rowCount) {
          throw new ApprovalError("The purchase request could not be marked approved.", 409);
        }
      } else if (approval.request_type === "expense") {
        const expenseResult = await client.query(
          `UPDATE transactions
           SET status = 'validated', validated_by = $2, validated_at = now(), updated_at = now()
           WHERE id = $1 AND status = 'pending_approval'`,
          [approval.ref_id, actor.id],
        );
        if (!expenseResult.rowCount) {
          throw new ApprovalError("The expense transaction could not be marked validated.", 409);
        }
      } else if (approval.request_type === "budget") {
        const budgetResult = await client.query(
          "UPDATE budgets SET status = 'approved' WHERE id = $1 AND status = 'pending_approval'",
          [approval.ref_id],
        );
        if (!budgetResult.rowCount) {
          throw new ApprovalError("The budget could not be marked approved.", 409);
        }
      } else if (approval.request_type === "fund_rate") {
        const rate = await client.query<{ future_or_today: boolean }>(
          "SELECT effective_from >= CURRENT_DATE AS future_or_today FROM emergency_fund_rates WHERE id = $1",
          [approval.ref_id],
        );
        if (!rate.rows[0]?.future_or_today) {
          throw new ApprovalError("This rate's effective date has passed; reject it and submit a new request.", 409);
        }
        const rateResult = await client.query(
          `UPDATE emergency_fund_rates SET approval_status = 'approved'
           WHERE id = $1 AND approval_status = 'pending'`,
          [approval.ref_id],
        );
        if (!rateResult.rowCount) throw new ApprovalError("The fund rate could not be approved.", 409);
      } else if (approval.request_type === "fund_withdrawal") {
        if (!resource.fund_id || !resource.amount) {
          throw new ApprovalError("The fund withdrawal is missing required balance information.", 409);
        }
        const fund = await client.query<{ id: string }>(
          "SELECT id FROM emergency_funds WHERE id = $1 FOR UPDATE",
          [resource.fund_id],
        );
        const balance = await client.query<{ balance: string; reserved: string }>(
          `SELECT fund_balance.balance::text,
                  COALESCE((
                    SELECT SUM(other.amount)
                    FROM fund_withdrawals other
                    WHERE other.fund_id = fund.id AND other.status = 'approved'
                      AND other.id <> $2
                  ), 0)::text AS reserved
           FROM v_fund_balance fund_balance
           JOIN emergency_funds fund ON fund.id = fund_balance.fund_id
           WHERE fund.id = $1`,
          [fund.rows[0]?.id, approval.ref_id],
        );
        const enough = await client.query<{ enough: boolean }>(
          "SELECT $1::numeric - $2::numeric >= $3::numeric AS enough",
          [balance.rows[0]?.balance ?? "0", balance.rows[0]?.reserved ?? "0", resource.amount],
        );
        if (!enough.rows[0]?.enough) {
          throw new ApprovalError("The available fund balance is insufficient to approve this withdrawal.", 409);
        }
        const withdrawalResult = await client.query(
          `UPDATE fund_withdrawals SET status = 'approved', decided_at = now()
           WHERE id = $1 AND status = 'pending'`,
          [approval.ref_id],
        );
        if (!withdrawalResult.rowCount) throw new ApprovalError("The fund withdrawal could not be approved.", 409);
      }
      await notifyApprovalUsers(client, [approval.requester_id], {
        kind: "system",
        title: { fr: "Demande approuvée", ht: "Demann lan apwouve", en: "Request approved" },
        body: {
          fr: `La demande « ${approval.title} » a reçu toutes les approbations requises.`,
          ht: `Demann « ${approval.title} » jwenn tout apwobasyon li bezwen yo.`,
          en: `Request “${approval.title}” has received all required approvals.`,
        },
        link: "/modules/finance",
        refTable: "approval_requests",
        refId: id,
      });
      if (approval.request_type === "fund_withdrawal" && resource.requester_id) {
        await notifyFundRequesters(
          client,
          resource.requester_id,
          { fr: "Retrait du fonds approuvé", ht: "Yo apwouve retrè fon an", en: "Fund withdrawal approved" },
          {
            fr: "Votre retrait a reçu toutes les approbations requises et peut être décaissé.",
            ht: "Retrè ou a jwenn tout apwobasyon li bezwen yo epi li ka debouse.",
            en: "Your withdrawal has received all required approvals and can now be disbursed.",
          },
          id,
        );
      }
    });
    schedulePushDeliveryAfterResponse();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to record approval decision.", error);
    return NextResponse.json({ error: "Unable to record approval decision." }, { status: 500 });
  }
}
