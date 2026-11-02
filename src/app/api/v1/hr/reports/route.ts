import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withDbUser } from "@/lib/db";

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const report = await withDbUser(actor.id, null, async (client) => {
    const permission = await client.query<{ allowed: boolean }>(
      "SELECT app_has_permission('hr.report.read') OR app_has_permission('hr.employee.read') AS allowed",
    );
    if (!permission.rows[0]?.allowed) return null;
    const headcount = await client.query(
      `SELECT status, count(*)::int AS count FROM employees GROUP BY status ORDER BY status`,
    );
    const attendance = await client.query(
      `SELECT status, count(*)::int AS count FROM attendance_records
       WHERE work_date >= date_trunc('month', CURRENT_DATE)
       GROUP BY status ORDER BY status`,
    );
    const leave = await client.query(
      `SELECT status, count(*)::int AS count, COALESCE(sum(days),0)::text AS days
       FROM leave_requests
       WHERE EXTRACT(YEAR FROM start_date)=EXTRACT(YEAR FROM CURRENT_DATE)
       GROUP BY status ORDER BY status`,
    );
    return {
      headcount: headcount.rows,
      attendanceThisMonth: attendance.rows,
      leaveThisYear: leave.rows,
      generatedAt: new Date().toISOString(),
    };
  });
  if (!report) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  return NextResponse.json(report);
}
