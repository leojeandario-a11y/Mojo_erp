import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/permissions";
import { withDbUser } from "@/lib/db";

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, ["operations.project.manage", "operations.task.manage", "*"])) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  const body = await request.json();
  try {
    return await withDbUser(actor.id, null, async (client) => {
      if (body.kind === "project") {
        const row = await client.query(`INSERT INTO projects(entity_id,code,name,description,department_id,manager_id,budget_amount,currency,start_date,end_date,status,progress_pct)
          VALUES($1,$2,$3,$4,NULLIF($5,'')::uuid,NULLIF($6,'')::uuid,$7,$8,NULLIF($9,'')::date,NULLIF($10,'')::date,$11,$12) RETURNING *`,
          [body.entityId,body.code,body.name,body.description||null,body.departmentId||"",body.managerId||"",body.budgetAmount||0,body.currency||"USD",body.startDate||"",body.endDate||"",body.status||"planned",body.progressPct||0]);
        return NextResponse.json(row.rows[0], { status: 201 });
      }
      if (body.kind === "task") {
        const row = await client.query(`INSERT INTO tasks(project_id,department_id,parent_task_id,title,description,assignee_id,priority,status,due_date,created_by)
          VALUES(NULLIF($1,'')::uuid,NULLIF($2,'')::uuid,NULLIF($3,'')::uuid,$4,$5,NULLIF($6,'')::uuid,$7,$8,NULLIF($9,'')::date,$10) RETURNING *`,
          [body.projectId||"",body.departmentId||"",body.parentTaskId||"",body.title,body.description||null,body.assigneeId||"",body.priority||"medium",body.status||"todo",body.dueDate||"",actor.id]);
        return NextResponse.json(row.rows[0], { status: 201 });
      }
      if (body.kind === "resource") {
        const row = await client.query(`INSERT INTO resources(name,resource_type,status) VALUES($1,$2,$3) RETURNING *`,[body.name,body.resourceType||"equipment",body.status||"available"]);
        return NextResponse.json(row.rows[0], { status: 201 });
      }
      if (body.kind === "allocation") {
        const row = await client.query(`INSERT INTO resource_allocations(resource_id,project_id,task_id,from_date,to_date) VALUES($1,NULLIF($2,'')::uuid,NULLIF($3,'')::uuid,$4,$5) RETURNING *`,
          [body.resourceId,body.projectId||"",body.taskId||"",body.fromDate,body.toDate]);
        return NextResponse.json(row.rows[0], { status: 201 });
      }
      if (body.kind === "activity") {
        const row = await client.query(`INSERT INTO activities(department_id,project_id,title,description,responsible_id,planned_date,status,recurrence,recurrence_until) VALUES(NULLIF($1,'')::uuid,NULLIF($2,'')::uuid,$3,$4,NULLIF($5,'')::uuid,NULLIF($6,'')::date,$7,$8,NULLIF($9,'')::date) RETURNING *`,
          [body.departmentId||"",body.projectId||"",body.title,body.description||null,body.responsibleId||"",body.plannedDate||"",body.status||"planned",body.recurrence||"none",body.recurrenceUntil||""]);
        return NextResponse.json(row.rows[0], { status: 201 });
      }
      return NextResponse.json({ error: "Unsupported operations item." }, { status: 400 });
    });
  } catch (error) {
    console.error("Unable to save operations item.", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save operations item." }, { status: 500 });
  }
}
