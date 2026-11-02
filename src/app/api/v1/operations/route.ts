import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/permissions";
import { withDbUser } from "@/lib/db";

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return await withDbUser(actor.id, null, async (client) => {
      if (!hasAnyPermission(actor, ["operations.project.read", "operations.project.manage", "operations.task.manage", "*"])) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      const [projects,tasks,activities,resources,allocations,entities,departments,users] = await Promise.all([
        client.query(`SELECT p.*,e.name entity_name,d.name department_name,u.full_name manager_name,
          COALESCE(SUM(CASE WHEN t.status='validated' AND t.tx_type='expense' THEN t.amount_usd ELSE 0 END),0)::numeric AS expenses_usd,
          COALESCE(SUM(CASE WHEN t.status='validated' AND t.tx_type='income' THEN t.amount_usd ELSE 0 END),0)::numeric AS revenues_usd
          FROM projects p JOIN entities e ON e.id=p.entity_id LEFT JOIN departments d ON d.id=p.department_id LEFT JOIN users u ON u.id=p.manager_id
          LEFT JOIN transactions t ON t.project_id=p.id GROUP BY p.id,e.name,d.name,u.full_name ORDER BY p.created_at DESC`),
        client.query(`SELECT t.*,p.name project_name,u.full_name assignee_name FROM tasks t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.assignee_id ORDER BY t.due_date NULLS LAST,t.created_at DESC`),
        client.query(`SELECT a.*,p.name project_name,u.full_name responsible_name FROM activities a LEFT JOIN projects p ON p.id=a.project_id LEFT JOIN users u ON u.id=a.responsible_id ORDER BY a.planned_date NULLS LAST`),
        client.query(`SELECT * FROM resources ORDER BY name`),
        client.query(`SELECT a.*,r.name resource_name,p.name project_name,t.title task_title FROM resource_allocations a JOIN resources r ON r.id=a.resource_id LEFT JOIN projects p ON p.id=a.project_id LEFT JOIN tasks t ON t.id=a.task_id ORDER BY a.from_date`),
        client.query(`SELECT id,name FROM entities ORDER BY name`),
        client.query(`SELECT id,name FROM departments ORDER BY name`),
        client.query(`SELECT id,full_name FROM users WHERE is_active=true ORDER BY full_name`),
      ]);
      return NextResponse.json({ projects:projects.rows,tasks:tasks.rows,activities:activities.rows,resources:resources.rows,allocations:allocations.rows,entities:entities.rows,departments:departments.rows,users:users.rows });
    });
  } catch (error) {
    console.error("Unable to load operations data.", error);
    return NextResponse.json({ error: "Unable to load operations data." }, { status: 500 });
  }
}
