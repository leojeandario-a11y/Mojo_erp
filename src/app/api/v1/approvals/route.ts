import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

interface ApprovalAction {
  decision: "approved" | "rejected" | "returned";
  comment: string | null;
  actor_name: string;
  acted_at: string;
}

interface ApprovalRequestRow {
  id: string;
  request_type: "expense" | "purchase" | "budget" | "fund_rate" | "fund_withdrawal";
  ref_id: string;
  title: string;
  amount: string;
  currency: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "returned";
  created_at: string;
  closed_at: string | null;
  requester_id: string;
  requester_name: string;
  step_label: string | null;
  entity_id: string;
  entity_name: string;
  fund_percentage: string | null;
  effective_from: string | null;
  actions: ApprovalAction[];
}

const requestDetails = `SELECT ar.id, ar.request_type, ar.ref_id,
                               COALESCE(tx.tx_number, pr.description, budget.name,
                                 CASE WHEN rate.id IS NOT NULL
                                   THEN rate.percentage::text || '% à partir du ' || rate.effective_from::text
                                   ELSE withdrawal.reason END, ar.title) AS title,
                               COALESCE(tx.amount, pr.amount, withdrawal.amount, ar.amount, 0)::text AS amount,
                               COALESCE(tx.currency, pr.currency, budget.currency,
                                 withdrawal.currency, rate_fund.currency, ar.currency) AS currency,
                               ar.status, ar.created_at::text, ar.closed_at::text,
                               ar.requester_id, requester.full_name AS requester_name,
                               step.label AS step_label,
                               COALESCE(tx.entity_id, pr.entity_id, budget.entity_id,
                                 withdrawal_fund.entity_id, rate_fund.entity_id) AS entity_id,
                               entity.name AS entity_name, rate.percentage::text AS fund_percentage,
                               rate.effective_from::text,
                               COALESCE(action_history.actions, '[]'::json) AS actions
                        FROM approval_requests ar
                        LEFT JOIN transactions tx
                          ON ar.request_type = 'expense' AND ar.ref_table = 'transactions' AND tx.id = ar.ref_id
                        LEFT JOIN purchase_requests pr
                          ON ar.request_type = 'purchase' AND ar.ref_table = 'purchase_requests' AND pr.id = ar.ref_id
                        LEFT JOIN budgets budget
                          ON ar.request_type = 'budget' AND ar.ref_table = 'budgets' AND budget.id = ar.ref_id
                        LEFT JOIN fund_withdrawals withdrawal
                          ON ar.request_type = 'fund_withdrawal' AND ar.ref_table = 'fund_withdrawals'
                          AND withdrawal.id = ar.ref_id
                        LEFT JOIN emergency_funds withdrawal_fund ON withdrawal_fund.id = withdrawal.fund_id
                        LEFT JOIN emergency_fund_rates rate
                          ON ar.request_type = 'fund_rate' AND ar.ref_table = 'emergency_fund_rates'
                          AND rate.id = ar.ref_id
                        LEFT JOIN emergency_funds rate_fund ON rate_fund.id = rate.fund_id
                        LEFT JOIN entities entity ON entity.id = COALESCE(tx.entity_id, pr.entity_id,
                          budget.entity_id, withdrawal_fund.entity_id, rate_fund.entity_id)
                        JOIN users requester ON requester.id = ar.requester_id
                        LEFT JOIN approval_workflow_steps step
                          ON step.workflow_id = ar.workflow_id AND step.step_order = ar.current_step
                        LEFT JOIN LATERAL (
                          SELECT json_agg(json_build_object(
                                   'decision', aa.decision,
                                   'comment', aa.comment,
                                   'actor_name', approver.full_name,
                                   'acted_at', aa.acted_at::text
                                 ) ORDER BY aa.acted_at, aa.id) AS actions
                          FROM approval_actions aa
                          JOIN users approver ON approver.id = aa.actor_id
                          WHERE aa.request_id = ar.id
                        ) action_history ON true`;

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const queue = await client.query<ApprovalRequestRow>(
        `${requestDetails}
         JOIN approval_workflow_steps current_step
           ON current_step.workflow_id = ar.workflow_id AND current_step.step_order = ar.current_step
         WHERE (
             (ar.request_type = 'expense' AND tx.id IS NOT NULL)
             OR (ar.request_type = 'purchase' AND pr.id IS NOT NULL)
             OR (ar.request_type = 'budget' AND budget.id IS NOT NULL)
             OR (ar.request_type = 'fund_withdrawal' AND withdrawal.id IS NOT NULL)
             OR (ar.request_type = 'fund_rate' AND rate.id IS NOT NULL)
           )
           AND ar.status = 'pending'
           AND ar.requester_id <> $1
           AND (
             current_step.approver_user_id = $1
             OR EXISTS (
               SELECT 1 FROM user_roles assigned_role
               WHERE assigned_role.user_id = $1
                 AND assigned_role.role_id = current_step.approver_role_id
                 AND (
                   assigned_role.entity_id IS NULL
                 OR assigned_role.entity_id = COALESCE(tx.entity_id, pr.entity_id, budget.entity_id,
                   withdrawal_fund.entity_id, rate_fund.entity_id)
               )
             )
           )
           AND (current_step.min_amount_usd IS NULL OR ar.amount_usd >= current_step.min_amount_usd)
           AND app_has_entity_permission(
             'approvals.approve', COALESCE(tx.entity_id, pr.entity_id, budget.entity_id,
             withdrawal_fund.entity_id, rate_fund.entity_id)
           )
           AND (
             ar.request_type NOT IN ('fund_rate', 'fund_withdrawal')
             OR (
             ar.request_type = 'fund_rate'
             AND app_has_entity_permission('finance.fund.set_rate', rate_fund.entity_id)
             )
             OR (
             ar.request_type = 'fund_withdrawal'
             AND (
               app_has_entity_permission('finance.fund.read', withdrawal_fund.entity_id)
               OR app_has_entity_permission('finance.fund.approve_withdrawal', withdrawal_fund.entity_id)
             )
             )
           )
         ORDER BY ar.created_at, ar.id`,
        [actor.id],
      );
      const mine = await client.query<ApprovalRequestRow>(
        `${requestDetails}
         WHERE (
             (ar.request_type = 'expense' AND tx.id IS NOT NULL)
             OR (ar.request_type = 'purchase' AND pr.id IS NOT NULL)
             OR (ar.request_type = 'budget' AND budget.id IS NOT NULL)
             OR (ar.request_type = 'fund_withdrawal' AND withdrawal.id IS NOT NULL)
             OR (ar.request_type = 'fund_rate' AND rate.id IS NOT NULL)
           )
           AND ar.requester_id = $1
         ORDER BY ar.created_at DESC, ar.id DESC`,
        [actor.id],
      );
      const history = await client.query<ApprovalRequestRow>(
        `${requestDetails}
         WHERE (
             (ar.request_type = 'expense' AND tx.id IS NOT NULL)
             OR (ar.request_type = 'purchase' AND pr.id IS NOT NULL)
             OR (ar.request_type = 'budget' AND budget.id IS NOT NULL)
             OR (ar.request_type = 'fund_withdrawal' AND withdrawal.id IS NOT NULL)
             OR (ar.request_type = 'fund_rate' AND rate.id IS NOT NULL)
           )
         AND (
           (ar.requester_id = $1 AND ar.status <> 'pending')
           OR EXISTS (
             SELECT 1 FROM approval_actions actor_action
             WHERE actor_action.request_id = ar.id AND actor_action.actor_id = $1
           )
         )
         ORDER BY COALESCE(ar.closed_at, ar.created_at) DESC, ar.id DESC`,
        [actor.id],
      );
      return { queue: queue.rows, mine: mine.rows, history: history.rows };
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unable to load approval requests.", error);
    return NextResponse.json({ error: "Unable to load approval requests." }, { status: 500 });
  }
}
