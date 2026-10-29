import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { getNextApprovalStep, getStepApproverIds, isAssignedApprover, notifyApprovalUsers } from "@/lib/approvals";
import { hasEntityPermission } from "@/lib/permissions";

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
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
        requester_id: string;
        title: string;
        amount_usd: string | null;
        current_step: number;
        status: string;
        entity_id: string;
        ref_id: string;
        tx_status: string;
        tx_number: string;
      }>(
        `SELECT ar.id, ar.workflow_id, ar.requester_id, ar.title, ar.amount_usd::text,
                ar.current_step, ar.status, ar.ref_id, tx.entity_id, tx.status AS tx_status, tx.tx_number
         FROM approval_requests ar
         JOIN transactions tx ON ar.ref_table = 'transactions' AND tx.id = ar.ref_id
         WHERE ar.id = $1 AND ar.request_type = 'expense'
         FOR UPDATE OF ar, tx`,
        [id],
      );
      if (!requestResult.rowCount) throw new ApprovalError("Approval request not found.", 404);
      const approval = requestResult.rows[0];
      if (approval.amount_usd === null) throw new ApprovalError("Approval request is missing its converted amount.", 409);
      if (approval.status !== "pending" || approval.tx_status !== "pending_approval") {
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
        await client.query(
          "UPDATE transactions SET status = 'rejected' WHERE id = $1 AND status = 'pending_approval'",
          [approval.ref_id],
        );
        await notifyApprovalUsers(client, [approval.requester_id], {
          kind: "system",
          title: { fr: "Demande refusée", ht: "Demann lan refize", en: "Request rejected" },
          body: {
            fr: `La dépense ${approval.tx_number} a été refusée.`,
            ht: `Yo refize depans ${approval.tx_number}.`,
            en: `Expense ${approval.tx_number} was rejected.`,
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
            fr: `La dépense ${approval.tx_number} attend votre décision.`,
            ht: `Depans ${approval.tx_number} ap tann desizyon ou.`,
            en: `Expense ${approval.tx_number} is awaiting your decision.`,
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
      await notifyApprovalUsers(client, [approval.requester_id], {
        kind: "system",
        title: { fr: "Demande approuvée", ht: "Demann lan apwouve", en: "Request approved" },
        body: {
          fr: `La dépense ${approval.tx_number} a reçu toutes les approbations requises.`,
          ht: `Depans ${approval.tx_number} jwenn tout apwobasyon li bezwen yo.`,
          en: `Expense ${approval.tx_number} has received all required approvals.`,
        },
        link: "/modules/finance",
        refTable: "approval_requests",
        refId: id,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to record approval decision.", error);
    return NextResponse.json({ error: "Unable to record approval decision." }, { status: 500 });
  }
}
