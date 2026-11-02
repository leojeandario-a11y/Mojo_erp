import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withDbUser } from "@/lib/db";

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return withDbUser(actor.id, null, async (client) => {
    const allowed = await client.query<{ ok: boolean }>(
      "SELECT app_has_permission('business.report.read') OR app_has_permission('business.customer.read') AS ok",
    );
    if (!allowed.rows[0]?.ok) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
    const [prospects, clients, opportunities, pipeline] = await Promise.all([
      client.query(`SELECT count(*)::int AS count FROM customers WHERE kind='prospect'`),
      client.query(`SELECT count(*)::int AS count FROM customers WHERE kind='client'`),
      client.query(`SELECT count(*)::int AS count,COALESCE(sum(estimated_amount),0)::text AS estimated FROM opportunities WHERE stage <> 'lost'`),
      client.query(`SELECT stage,count(*)::int AS count,COALESCE(sum(estimated_amount),0)::text AS estimated FROM opportunities GROUP BY stage ORDER BY stage`),
    ]);
    const report = { prospects: prospects.rows[0].count, clients: clients.rows[0].count, opportunities: opportunities.rows[0].count, estimatedAmount: opportunities.rows[0].estimated, pipeline: pipeline.rows };
    const csv = ["Type,Stage,Valeur","Prospects,,"+report.prospects,"Clients,,"+report.clients,"Opportunités,,"+report.opportunities,
      ...pipeline.rows.map((row) => ["Étape",row.stage,row.estimated].map((value) => `"${String(value).replaceAll('"','""')}"`).join(","))].join("\n");
    return new NextResponse(csv, { headers: { "Content-Type":"text/csv;charset=utf-8", "Content-Disposition":"attachment; filename=\"rapport-affaires.csv\"" } });
  });
}
