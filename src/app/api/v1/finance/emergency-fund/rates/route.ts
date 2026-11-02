import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";
import {
  EmergencyFundError,
  getEmergencyFund,
  getFundApprovalWorkflow,
  notifyFundApprovers,
  requireFundPermission,
} from "@/lib/emergency-fund";
import { schedulePushDeliveryAfterResponse } from "@/lib/web-push";

const rateSchema = z.object({
  percentage: z.string().regex(/^(?:100(?:\.0{1,2})?|(?:\d|[1-9]\d)(?:\.\d{1,2})?)$/),
  effectiveFrom: z.iso.date(),
  reason: z.string().trim().min(3).max(500),
}).strict();

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const rates = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const fund = await getEmergencyFund(client);
      if (!hasEntityPermission(actor, "finance.fund.read", fund.entity_id)
          && !hasEntityPermission(actor, "finance.fund.set_rate", fund.entity_id)) {
        throw new EmergencyFundError("Permission denied for fund rates.", 403);
      }
      const permission = hasEntityPermission(actor, "finance.fund.read", fund.entity_id)
        ? "finance.fund.read"
        : "finance.fund.set_rate";
      await requireFundPermission(client, permission, fund.entity_id);
      const result = await client.query(
        `SELECT rate.id, rate.percentage::text, rate.effective_from::text,
                rate.reason, rate.approval_status, rate.created_at::text,
                rate.approval_request_id, requester.full_name AS requested_by,
                COALESCE(action_history.actions, '[]'::json) AS actions
         FROM emergency_fund_rates rate
         LEFT JOIN users requester ON requester.id = rate.set_by
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object(
                    'decision', action.decision, 'comment', action.comment,
                    'actor', approver.full_name, 'actedAt', action.acted_at::text
                  ) ORDER BY action.acted_at, action.id) AS actions
           FROM approval_actions action
           JOIN users approver ON approver.id = action.actor_id
           WHERE action.request_id = rate.approval_request_id
         ) action_history ON true
         WHERE rate.fund_id = $1
         ORDER BY rate.effective_from DESC, rate.created_at DESC`,
        [fund.id],
      );
      return {
        rates: result.rows,
        canSetRate: hasEntityPermission(actor, "finance.fund.set_rate", fund.entity_id)
          && await client.query<{ allowed: boolean }>(
            "SELECT app_has_entity_permission('finance.fund.set_rate', $1::uuid) AS allowed",
            [fund.entity_id],
          ).then((permissionResult) => permissionResult.rows[0]?.allowed === true),
      };
    });
    return NextResponse.json(rates);
  } catch (error) {
    if (error instanceof EmergencyFundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to load emergency fund rates.", error);
    return NextResponse.json({ error: "Unable to load emergency fund rates." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = rateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid emergency fund rate request." }, { status: 400 });

  try {
    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const fund = await getEmergencyFund(client, true);
      if (!hasEntityPermission(actor, "finance.fund.set_rate", fund.entity_id)) {
        throw new EmergencyFundError("Permission denied to propose a fund rate.", 403);
      }
      await requireFundPermission(client, "finance.fund.set_rate", fund.entity_id);
      const dateCheck = await client.query<{ future_or_today: boolean }>(
        "SELECT $1::date >= CURRENT_DATE AS future_or_today",
        [parsed.data.effectiveFrom],
      );
      if (!dateCheck.rows[0].future_or_today) {
        throw new EmergencyFundError("A fund rate cannot take effect retroactively.", 400);
      }

      const approval = await getFundApprovalWorkflow(
        client,
        "fund_rate",
        fund.entity_id,
        actor.id,
        "0.01",
      );
      const rateResult = await client.query<{ id: string }>(
        `INSERT INTO emergency_fund_rates(
           fund_id, percentage, effective_from, reason, set_by, approval_status
         )
         VALUES ($1, $2::numeric, $3::date, $4, $5, 'pending')
         RETURNING id`,
        [fund.id, parsed.data.percentage, parsed.data.effectiveFrom, parsed.data.reason, actor.id],
      );
      const rateId = rateResult.rows[0].id;
      const approvalResult = await client.query<{ id: string }>(
        `INSERT INTO approval_requests(
           workflow_id, request_type, ref_table, ref_id, requester_id, title,
           amount, currency, amount_usd, current_step
         )
         VALUES ($1, 'fund_rate', 'emergency_fund_rates', $2, $3, $4, 0, $5, 0, $6)
         RETURNING id`,
        [
          approval.workflowId,
          rateId,
          actor.id,
          `Taux du fonds : ${parsed.data.percentage}% à partir du ${parsed.data.effectiveFrom}`,
          fund.currency,
          approval.step.step_order,
        ],
      );
      const approvalRequestId = approvalResult.rows[0].id;
      await client.query(
        "UPDATE emergency_fund_rates SET approval_request_id = $2 WHERE id = $1",
        [rateId, approvalRequestId],
      );
      await notifyFundApprovers(
        client,
        approval.approverIds,
        { fr: "Taux du fonds à approuver", ht: "To fon an pou apwouve", en: "Fund rate approval required" },
        {
          fr: `Un taux de ${parsed.data.percentage}% est proposé à partir du ${parsed.data.effectiveFrom}.`,
          ht: `Yo pwopoze yon to ${parsed.data.percentage}% apati ${parsed.data.effectiveFrom}.`,
          en: `A ${parsed.data.percentage}% rate is proposed effective ${parsed.data.effectiveFrom}.`,
        },
        approvalRequestId,
      );
      return { id: rateId, approvalRequestId };
    });
    schedulePushDeliveryAfterResponse();
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof EmergencyFundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A rate request already exists for this effective date." }, { status: 409 });
    }
    console.error("Unable to submit emergency fund rate for approval.", error);
    return NextResponse.json({ error: "Unable to submit emergency fund rate for approval." }, { status: 500 });
  }
}
