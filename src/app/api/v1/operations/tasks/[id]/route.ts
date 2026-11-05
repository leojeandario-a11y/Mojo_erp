import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/permissions";
import { isSuperAdmin } from "@/lib/permissions";
import { requestIp, withDbUser } from "@/lib/db";

const taskSchema = z.object({
  projectId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().nullable().optional(),
  assigneeId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  dueDate: z.union([z.iso.date(), z.literal(""), z.null()]).optional(),
}).strict();

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
  const actor=await getSession();
  if(!actor) return NextResponse.json({error:"Authentication required."},{status:401});
  if(!hasAnyPermission(actor,["operations.task.manage","*"])) return NextResponse.json({error:"Permission denied."},{status:403});
  const {id}=await params;
  const body=await request.json();
  if(!["todo","in_progress","blocked","done","cancelled"].includes(body.status)) return NextResponse.json({error:"Invalid task status."},{status:400});
  try {
    return await withDbUser(actor.id,null,async(client)=>{
      const result=await client.query(`UPDATE tasks SET status=$1,completed_at=CASE WHEN $1='done' THEN COALESCE(completed_at,now()) ELSE NULL END WHERE id=$2 RETURNING *`,[body.status,id]);
      if(!result.rowCount) return NextResponse.json({error:"Task not found."},{status:404});
      return NextResponse.json(result.rows[0]);
    });
  } catch(error) {
    console.error("Unable to update task.",error);
    return NextResponse.json({error:"Unable to update task."},{status:500});
  }
}

export async function PUT(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ) {
    const actor = await getSession(request.headers);
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!isSuperAdmin(actor)) return NextResponse.json({ error: "Super-administrator access required." }, { status: 403 });

    const { id } = await context.params;
    const parsed = taskSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid task details." }, { status: 400 });

    try {
      return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
        const current = await client.query<{ status: string }>("SELECT status FROM tasks WHERE id = $1 FOR UPDATE", [id]);
        if (!current.rowCount) return NextResponse.json({ error: "Task not found." }, { status: 404 });
        if (current.rows[0].status === "done") {
          return NextResponse.json({ error: "Completed tasks cannot be edited." }, { status: 409 });
        }
        const result = await client.query(
          `UPDATE tasks
           SET project_id = NULLIF($2, '')::uuid, title = $3, description = $4,
               assignee_id = NULLIF($5, '')::uuid, priority = $6,
               due_date = NULLIF($7, '')::date
           WHERE id = $1
           RETURNING id, title, status`,
          [
            id, parsed.data.projectId ?? "", parsed.data.title, parsed.data.description ?? null,
            parsed.data.assigneeId ?? "", parsed.data.priority, parsed.data.dueDate ?? "",
          ],
        );
        if (!result.rowCount) return NextResponse.json({ error: "Task not found." }, { status: 404 });
        return NextResponse.json(result.rows[0]);
      });
    } catch (error) {
      console.error("Unable to edit task.", error);
      return NextResponse.json({ error: "Unable to edit task." }, { status: 500 });
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
          `SELECT t.status,
             EXISTS (SELECT 1 FROM tasks child WHERE child.parent_task_id = t.id)
             OR EXISTS (SELECT 1 FROM resource_allocations ra WHERE ra.task_id = t.id) AS has_history
           FROM tasks t
           WHERE t.id = $1
           FOR UPDATE`,
          [id],
        );
        const task = result.rows[0];
        if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
        if (task.status === "done") {
          return NextResponse.json({ error: "Completed tasks must remain in the task history." }, { status: 409 });
        }

        if (task.status === "todo" && !task.has_history) {
          await client.query("DELETE FROM tasks WHERE id = $1", [id]);
          return NextResponse.json({ deleted: true });
        }

        await client.query(
          "UPDATE tasks SET status = 'cancelled', completed_at = NULL WHERE id = $1",
          [id],
        );
        return NextResponse.json({ archived: true });
      });
    } catch (error) {
      console.error("Unable to remove task.", error);
      return NextResponse.json({ error: "Unable to remove task." }, { status: 500 });
  }
}
