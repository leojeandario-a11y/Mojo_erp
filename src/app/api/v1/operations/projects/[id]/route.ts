import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { isSuperAdmin } from "@/lib/permissions";

const projectSchema = z.object({
  entityId: z.uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  description: z.string().nullable().optional(),
  departmentId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  managerId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  budgetAmount: z.coerce.number().finite().nonnegative(),
  currency: z.enum(["USD", "HTG"]),
  startDate: z.union([z.iso.date(), z.literal(""), z.null()]).optional(),
  endDate: z.union([z.iso.date(), z.literal(""), z.null()]).optional(),
  progressPct: z.coerce.number().finite().min(0).max(100),
  status: z.enum(["planned", "in_progress", "on_hold", "completed", "cancelled"]),
}).strict();

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!isSuperAdmin(actor)) return NextResponse.json({ error: "Super-administrator access required." }, { status: 403 });

  const { id } = await context.params;
  const parsed = projectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid project details." }, { status: 400 });

  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const current = await client.query<{ status: string }>("SELECT status FROM projects WHERE id = $1 FOR UPDATE", [id]);
      if (!current.rowCount) return NextResponse.json({ error: "Project not found." }, { status: 404 });
      if (current.rows[0].status === "completed") {
        return NextResponse.json({ error: "Completed projects cannot be edited." }, { status: 409 });
      }

      const row = await client.query(
        `UPDATE projects
         SET entity_id = $2, code = $3, name = $4, description = $5,
             department_id = NULLIF($6, '')::uuid, manager_id = NULLIF($7, '')::uuid,
             budget_amount = $8, currency = $9,
             start_date = NULLIF($10, '')::date, end_date = NULLIF($11, '')::date,
             progress_pct = $12, status = $13
         WHERE id = $1
         RETURNING id, name, code, status`,
        [
          id, parsed.data.entityId, parsed.data.code, parsed.data.name, parsed.data.description ?? null,
          parsed.data.departmentId ?? "", parsed.data.managerId ?? "", parsed.data.budgetAmount,
          parsed.data.currency, parsed.data.startDate ?? "", parsed.data.endDate ?? "",
          parsed.data.progressPct, parsed.data.status,
        ],
      );
      return NextResponse.json(row.rows[0]);
    });
  } catch (error) {
    console.error("Unable to update project.", error);
    return NextResponse.json({ error: "Unable to update project." }, { status: 500 });
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
      const result = await client.query<{
        status: string;
        progress_pct: string;
        has_history: boolean;
      }>(
        `SELECT p.status, p.progress_pct,
           EXISTS (SELECT 1 FROM transactions t WHERE t.project_id = p.id)
           OR EXISTS (SELECT 1 FROM project_expenses pe WHERE pe.project_id = p.id)
           OR EXISTS (SELECT 1 FROM budgets b WHERE b.project_id = p.id)
           OR EXISTS (SELECT 1 FROM invoices i WHERE i.project_id = p.id)
           OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id)
           OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id)
           OR EXISTS (SELECT 1 FROM activities a WHERE a.project_id = p.id)
           OR EXISTS (SELECT 1 FROM resource_allocations ra WHERE ra.project_id = p.id)
           OR EXISTS (SELECT 1 FROM marketing_campaigns mc WHERE mc.project_id = p.id) AS has_history
         FROM projects p
         WHERE p.id = $1
         FOR UPDATE`,
        [id],
      );
      const project = result.rows[0];
      if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

      if (project.status === "completed") {
        return NextResponse.json({ error: "Completed projects must remain in the project history." }, { status: 409 });
      }

      if (!project.has_history && project.status === "planned" && Number(project.progress_pct) === 0) {
        await client.query("DELETE FROM projects WHERE id = $1", [id]);
        return NextResponse.json({ deleted: true });
      }

      await client.query("UPDATE projects SET status = 'cancelled' WHERE id = $1", [id]);
      return NextResponse.json({ archived: true });
    });
  } catch (error) {
    console.error("Unable to remove project.", error);
    return NextResponse.json({ error: "Unable to remove project." }, { status: 500 });
  }
}
