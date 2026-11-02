import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withDbUser } from "@/lib/db";

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return withDbUser(actor.id, null, async (client) => {
    const allowed = await client.query<{ ok: boolean }>(
      "SELECT app_has_permission('hr.salary.read') OR app_has_permission('hr.salary.manage') AS ok",
    );
    if (!allowed.rows[0]?.ok) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
    const result = await client.query(
      `SELECT r.id,r.period_label,r.period_end,r.currency,
              count(p.*)::int AS employee_count,
              COALESCE(sum(p.gross_amount),0)::text AS gross,
              COALESCE(sum(p.bonuses),0)::text AS bonuses,
              COALESCE(sum(p.deductions+p.advances_recovered),0)::text AS deductions,
              COALESCE(sum(p.net_amount),0)::text AS net
       FROM payroll_runs r LEFT JOIN payroll_entries p ON p.payroll_run_id=r.id
       GROUP BY r.id ORDER BY r.period_end DESC`,
    );
    const csv = [
      "Période,Fin,Devise,Employés,Gross,Bonus,Deductions,Net",
      ...result.rows.map((row) => [row.period_label,row.period_end,row.currency,row.employee_count,row.gross,row.bonuses,row.deductions,row.net].map((value) => `"${String(value).replaceAll('"','""')}"`).join(",")),
    ].join("\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": 'attachment; filename="masse-salariale.csv"' } });
  });
}
