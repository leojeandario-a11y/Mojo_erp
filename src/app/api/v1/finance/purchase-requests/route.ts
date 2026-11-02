import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { exchangeRateToUsd } from "@/lib/finance-exchange-rates";
import { getNextApprovalStep, getStepApproverIds, notifyApprovalUsers } from "@/lib/approvals";
import { hasAnyPermission, hasEntityPermission } from "@/lib/permissions";
import { schedulePushDeliveryAfterResponse } from "@/lib/web-push";

const purchaseRequestSchema = z.object({
  requestId: z.uuid().optional(),
  entityId: z.uuid(),
  description: z.string().trim().min(2).max(1000),
  amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  currency: z.enum(["HTG", "USD"]),
}).strict();

class PurchaseRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, ["finance.transaction.create"])) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const entityResult = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM entities WHERE is_active ORDER BY name",
      );
      const entities = entityResult.rows.filter((entity) =>
        hasEntityPermission(actor, "finance.transaction.create", entity.id),
      );
      const requests = entities.length
        ? await client.query(
          `SELECT pr.id, pr.entity_id, e.name AS entity_name, pr.description,
                  pr.amount::text, pr.currency, pr.status, pr.created_at::text
           FROM purchase_requests pr
           JOIN entities e ON e.id = pr.entity_id
           WHERE pr.requester_id = $1 AND pr.entity_id = ANY($2::uuid[])
           ORDER BY pr.created_at DESC, pr.id DESC`,
          [actor.id, entities.map(({ id }) => id)],
        )
        : { rows: [] };
      return { entities, requests: requests.rows };
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unable to load purchase requests.", error);
    return NextResponse.json({ error: "Unable to load purchase requests." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = purchaseRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid purchase request details." }, { status: 400 });
  if (!hasEntityPermission(actor, "finance.transaction.create", parsed.data.entityId)) {
    return NextResponse.json({ error: "Permission denied for this entity." }, { status: 403 });
  }

  try {
    const created = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('finance.transaction.create', $1::uuid) AS allowed",
        [parsed.data.entityId],
      );
      if (permission.rows[0]?.allowed !== true) {
        throw new PurchaseRequestError("Permission denied for this entity.", 403);
      }
      const entity = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM entities WHERE id = $1 AND is_active",
        [parsed.data.entityId],
      );
      if (!entity.rowCount) throw new PurchaseRequestError("The selected entity is unavailable.", 400);
      const dateResult = await client.query<{ today: string }>("SELECT CURRENT_DATE::text AS today");
      const today = dateResult.rows[0].today;
      const fxRateToUsd = await exchangeRateToUsd(client, parsed.data.currency, today);
      if (!fxRateToUsd) throw new PurchaseRequestError(`No exchange rate is available for ${today}.`, 400);
      const amountUsd = await client.query<{ amount_usd: string }>(
        "SELECT GREATEST($1::numeric * $2::numeric, 0.01)::numeric(18,2)::text AS amount_usd",
        [parsed.data.amount, fxRateToUsd],
      );
      const workflow = await client.query<{ id: string }>(
        `SELECT id FROM approval_workflows
         WHERE request_type = 'purchase' AND is_active
           AND (entity_id = $1 OR entity_id IS NULL)
         ORDER BY (entity_id IS NOT NULL) DESC
         LIMIT 1`,
        [parsed.data.entityId],
      );
      if (!workflow.rowCount) throw new PurchaseRequestError("No active purchase approval workflow is configured.", 409);
      const workflowId = workflow.rows[0].id;
      const firstStep = await getNextApprovalStep(client, workflowId, 0, amountUsd.rows[0].amount_usd);
      if (!firstStep) throw new PurchaseRequestError("The purchase workflow has no applicable approval step.", 409);
      const approverIds = (await getStepApproverIds(client, firstStep, parsed.data.entityId))
        .filter((userId) => userId !== actor.id);
      if (!approverIds.length) {
        throw new PurchaseRequestError("No eligible approver other than the requester is configured for the first step.", 409);
      }

      let purchaseId = parsed.data.requestId;
      if (purchaseId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM purchase_requests
           WHERE id = $1 AND requester_id = $2 AND status = 'draft'
           FOR UPDATE`,
          [purchaseId, actor.id],
        );
        if (!existing.rowCount) {
          throw new PurchaseRequestError("Only your own draft purchase requests can be resubmitted.", 409);
        }
        const pending = await client.query(
          `SELECT 1 FROM approval_requests
           WHERE request_type = 'purchase' AND ref_table = 'purchase_requests'
             AND ref_id = $1 AND status = 'pending'`,
          [purchaseId],
        );
        if (pending.rowCount) {
          throw new PurchaseRequestError("This purchase request already has a pending approval.", 409);
        }
      } else {
        const purchase = await client.query<{ id: string }>(
          `INSERT INTO purchase_requests(
             entity_id, requester_id, description, amount, currency, status
           )
           VALUES ($1, $2, $3, $4::numeric, $5, 'pending')
           RETURNING id`,
          [parsed.data.entityId, actor.id, parsed.data.description, parsed.data.amount, parsed.data.currency],
        );
        purchaseId = purchase.rows[0].id;
      }
      const approval = await client.query<{ id: string }>(
        `INSERT INTO approval_requests(
           workflow_id, request_type, ref_table, ref_id, requester_id, title,
           amount, currency, amount_usd, current_step
         )
         VALUES ($1, 'purchase', 'purchase_requests', $2, $3, $4, $5::numeric, $6, $7::numeric, $8)
         RETURNING id`,
        [
          workflowId,
          purchaseId,
          actor.id,
          parsed.data.description,
          parsed.data.amount,
          parsed.data.currency,
          amountUsd.rows[0].amount_usd,
          firstStep.step_order,
        ],
      );
      const approvalId = approval.rows[0].id;
      if (parsed.data.requestId) {
        await client.query(
          `UPDATE purchase_requests
           SET entity_id = $2, description = $3, amount = $4::numeric, currency = $5, status = 'pending'
           WHERE id = $1 AND requester_id = $6 AND status = 'draft'`,
          [
            purchaseId,
            parsed.data.entityId,
            parsed.data.description,
            parsed.data.amount,
            parsed.data.currency,
            actor.id,
          ],
        );
      }
      await client.query(
        "UPDATE purchase_requests SET approval_request_id = $2 WHERE id = $1",
        [purchaseId, approvalId],
      );
      await notifyApprovalUsers(client, approverIds, {
        kind: "approval_needed",
        title: {
          fr: "Approbation d’achat requise",
          ht: "Apwobasyon acha nesesè",
          en: "Purchase approval needed",
        },
        body: {
          fr: `La demande d’achat « ${parsed.data.description} » attend votre décision.`,
          ht: `Demann acha « ${parsed.data.description} » ap tann desizyon ou.`,
          en: `Purchase request “${parsed.data.description}” is awaiting your decision.`,
        },
        link: "/modules/approvals",
        refTable: "approval_requests",
        refId: approvalId,
      });
      return { id: purchaseId, approvalRequestId: approvalId, entityName: entity.rows[0].name };
    });
    schedulePushDeliveryAfterResponse();
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to submit purchase request for approval.", error);
    return NextResponse.json({ error: "Unable to submit purchase request for approval." }, { status: 500 });
  }
}
