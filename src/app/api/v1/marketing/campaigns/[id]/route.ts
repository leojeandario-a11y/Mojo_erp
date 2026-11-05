import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { isSuperAdmin } from "@/lib/permissions";

const campaignSchema = z.object({
  entityId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  objective: z.string().nullable().optional(),
  departmentId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  projectId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  ownerId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  plannedBudget: z.coerce.number().finite().nonnegative(),
  currency: z.enum(["USD", "HTG"]),
  startDate: z.union([z.iso.date(), z.literal(""), z.null()]).optional(),
  endDate: z.union([z.iso.date(), z.literal(""), z.null()]).optional(),
  status: z.enum(["planned", "running", "paused", "completed", "cancelled"]),
  channels: z.array(z.string().trim().min(1).max(80)).max(30),
}).strict();

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!isSuperAdmin(actor)) return NextResponse.json({ error: "Super-administrator access required." }, { status: 403 });

  const { id } = await context.params;
  const parsed = campaignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid campaign details." }, { status: 400 });

  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const current = await client.query<{
        entity_id: string;
        project_id: string | null;
        planned_budget: string;
        currency: string;
        start_date: string | null;
        end_date: string | null;
        has_history: boolean;
      }>(
        `SELECT c.entity_id, c.project_id, c.planned_budget::text, c.currency,
                c.start_date::text, c.end_date::text,
                EXISTS (SELECT 1 FROM campaign_results cr WHERE cr.campaign_id = c.id)
                OR EXISTS (SELECT 1 FROM campaign_expenses ce WHERE ce.campaign_id = c.id) AS has_history
         FROM marketing_campaigns c
         WHERE c.id = $1
         FOR UPDATE`,
        [id],
      );
      const campaign = current.rows[0];
      if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

      const data = parsed.data;
      if (campaign.has_history && (
        data.entityId !== campaign.entity_id
        || (data.projectId || null) !== campaign.project_id
        || data.plannedBudget !== Number(campaign.planned_budget)
        || data.currency !== campaign.currency.trim()
        || (data.startDate || null) !== campaign.start_date
        || (data.endDate || null) !== campaign.end_date
      )) {
        return NextResponse.json({ error: "Campaign financial and period details cannot be changed after results or expenses exist." }, { status: 409 });
      }

      const result = await client.query(
        `UPDATE marketing_campaigns
         SET entity_id = $2, name = $3, objective = $4,
             department_id = NULLIF($5, '')::uuid, project_id = NULLIF($6, '')::uuid,
             owner_id = NULLIF($7, '')::uuid, planned_budget = $8, currency = $9,
             start_date = NULLIF($10, '')::date, end_date = NULLIF($11, '')::date,
             status = $12, channels = $13
         WHERE id = $1
         RETURNING id, name, status`,
        [
          id, data.entityId, data.name, data.objective ?? null, data.departmentId ?? "",
          data.projectId ?? "", data.ownerId ?? "", data.plannedBudget, data.currency,
          data.startDate ?? "", data.endDate ?? "", data.status, data.channels,
        ],
      );
      return NextResponse.json(result.rows[0]);
    });
  } catch (error) {
    console.error("Unable to update marketing campaign.", error);
    return NextResponse.json({ error: "Unable to update marketing campaign." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!isSuperAdmin(actor)) return NextResponse.json({ error: "Super-administrator access required." }, { status: 403 });

  const { id } = await context.params;
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{ status: string; has_history: boolean }>(
        `SELECT c.status,
           EXISTS (SELECT 1 FROM content_items ci WHERE ci.campaign_id = c.id)
           OR EXISTS (SELECT 1 FROM campaign_results cr WHERE cr.campaign_id = c.id)
           OR EXISTS (SELECT 1 FROM campaign_expenses ce WHERE ce.campaign_id = c.id) AS has_history
         FROM marketing_campaigns c
         WHERE c.id = $1
         FOR UPDATE`,
        [id],
      );
      const campaign = result.rows[0];
      if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
      if (campaign.status === "completed") {
        return NextResponse.json({ error: "Completed campaigns must remain in the campaign history." }, { status: 409 });
      }

      if (!campaign.has_history && campaign.status === "planned") {
        await client.query("DELETE FROM marketing_campaigns WHERE id = $1", [id]);
        return NextResponse.json({ deleted: true });
      }

      await client.query("UPDATE marketing_campaigns SET status = 'cancelled' WHERE id = $1", [id]);
      return NextResponse.json({ archived: true });
    });
  } catch (error) {
    console.error("Unable to remove marketing campaign.", error);
    return NextResponse.json({ error: "Unable to remove marketing campaign." }, { status: 500 });
  }
}
