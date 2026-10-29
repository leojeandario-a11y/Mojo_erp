import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const requests = await withDbUser(actor.id, requestIp(request.headers), async (client) =>
      client.query<{
        id: string;
        ref_id: string;
        title: string;
        amount: string;
        currency: string;
        created_at: string;
        requester_name: string;
        step_label: string;
        entity_id: string;
        entity_name: string;
      }>(
        `SELECT ar.id, ar.ref_id, ar.title, ar.amount::text, ar.currency,
                ar.created_at::text, requester.full_name AS requester_name,
                step.label AS step_label, tx.entity_id, entity.name AS entity_name
         FROM approval_requests ar
         JOIN transactions tx ON ar.ref_table = 'transactions' AND tx.id = ar.ref_id
         JOIN entities entity ON entity.id = tx.entity_id
         JOIN users requester ON requester.id = ar.requester_id
         JOIN approval_workflow_steps step
           ON step.workflow_id = ar.workflow_id AND step.step_order = ar.current_step
         LEFT JOIN user_roles assigned_role
           ON assigned_role.user_id = $1
          AND assigned_role.role_id = step.approver_role_id
          AND (assigned_role.entity_id IS NULL OR assigned_role.entity_id = tx.entity_id)
         WHERE ar.request_type = 'expense'
           AND ar.status = 'pending'
           AND ar.requester_id <> $1
           AND (step.approver_user_id = $1 OR assigned_role.user_id IS NOT NULL)
           AND (step.min_amount_usd IS NULL OR ar.amount_usd >= step.min_amount_usd)
           AND app_has_entity_permission('approvals.approve', tx.entity_id)
         ORDER BY ar.created_at, ar.id`,
        [actor.id],
      ),
    );
    return NextResponse.json({ requests: requests.rows });
  } catch (error) {
    console.error("Unable to load approval requests.", error);
    return NextResponse.json({ error: "Unable to load approval requests." }, { status: 500 });
  }
}
