import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/permissions";
import { withDbUser } from "@/lib/db";

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return await withDbUser(actor.id, null, async (client) => {
      if (!hasAnyPermission(actor, ["marketing.campaign.read", "marketing.campaign.manage", "marketing.report.read", "*"])) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      const [campaigns, content, results, entities, departments, projects, users] = await Promise.all([
        client.query(`SELECT c.*, e.name entity_name, d.name department_name, u.full_name owner_name,
          COALESCE((SELECT SUM(t.amount_usd) FROM campaign_expenses ce JOIN transactions t ON t.id=ce.transaction_id WHERE ce.campaign_id=c.id AND t.status='validated'),0) spent_usd
          FROM marketing_campaigns c JOIN entities e ON e.id=c.entity_id LEFT JOIN departments d ON d.id=c.department_id LEFT JOIN users u ON u.id=c.owner_id ORDER BY c.created_at DESC`),
        client.query(`SELECT ci.*, c.name campaign_name FROM content_items ci LEFT JOIN marketing_campaigns c ON c.id=ci.campaign_id ORDER BY ci.scheduled_at NULLS LAST, ci.id DESC`),
        client.query(`SELECT * FROM campaign_results ORDER BY recorded_on DESC`),
        client.query(`SELECT id,name FROM entities ORDER BY name`),
        client.query(`SELECT id,name FROM departments ORDER BY name`),
        client.query(`SELECT id,name FROM projects ORDER BY name`),
        client.query(`SELECT id,full_name FROM users WHERE is_active=true ORDER BY full_name`),
      ]);
      return NextResponse.json({       campaigns: campaigns.rows, content: content.rows, results: results.rows, documents: [] as unknown[], entities: entities.rows, departments: departments.rows, projects: projects.rows, users: users.rows });
    });
  } catch (error) {
    console.error("Unable to load marketing data.", error);
    return NextResponse.json({ error: "Unable to load marketing data." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, ["marketing.campaign.manage", "*"])) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  const body = await request.json();
  try {
    return await withDbUser(actor.id, null, async (client) => {
      const row = await client.query(
        `INSERT INTO marketing_campaigns(entity_id,name,objective,department_id,project_id,planned_budget,currency,start_date,end_date,owner_id,channels)
         VALUES ($1,$2,$3,NULLIF($4,'')::uuid,NULLIF($5,'')::uuid,$6,$7,NULLIF($8,'')::date,NULLIF($9,'')::date,NULLIF($10,'')::uuid,$11)
         RETURNING *`,
        [body.entityId,body.name,body.objective||null,body.departmentId||"",body.projectId||"",body.plannedBudget||0,body.currency||"USD",body.startDate||"",body.endDate||"",body.ownerId||"",Array.isArray(body.channels)?body.channels:[]],
      );
      return NextResponse.json(row.rows[0], { status: 201 });
    });
  } catch (error) {
    console.error("Unable to create campaign.", error);
    return NextResponse.json({ error: "Unable to create campaign." }, { status: 500 });
  }
}
