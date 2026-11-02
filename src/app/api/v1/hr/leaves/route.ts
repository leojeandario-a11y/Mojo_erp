import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const leaveSchema = z.object({
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  reason: z.string().trim().max(500).nullable().optional(),
}).strict().refine((value) => value.endDate >= value.startDate, { message: "End date must follow start date." });

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const data = await withDbUser(actor.id, null, async (client) => {
    const types = await client.query("SELECT id, code, name, days_per_year::text, is_paid FROM leave_types WHERE is_paid IS NOT NULL ORDER BY name");
    const requests = await client.query(
        `SELECT leave.id, leave.employee_id, employee.first_name, employee.last_name,
                leave.leave_type_id, type.name AS leave_type_name, leave.start_date::text,
                leave.end_date::text, leave.days::text, leave.reason, leave.status,
                leave.approval_request_id
         FROM leave_requests leave
         JOIN employees employee ON employee.id = leave.employee_id
         JOIN leave_types type ON type.id = leave.leave_type_id
         ORDER BY leave.created_at DESC LIMIT 500`,
      );
    const balances = await client.query(
        `SELECT balance.id, balance.employee_id, employee.first_name, employee.last_name,
                balance.leave_type_id, type.name AS leave_type_name, balance.balance_year,
                balance.carried_days::text, balance.entitled_days::text, balance.used_days::text
         FROM leave_balances balance
         JOIN employees employee ON employee.id = balance.employee_id
         JOIN leave_types type ON type.id = balance.leave_type_id
         ORDER BY balance.balance_year DESC, employee.last_name`,
      );
    return { types: types.rows, requests: requests.rows, balances: balances.rows };
  });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = leaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid leave request." }, { status: 400 });
  try {
    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const employee = await client.query<{ id: string }>(
        `SELECT id FROM employees WHERE id=$1
           AND (user_id=$2 OR app_has_permission('hr.leave.request')
             OR app_has_permission('hr.leave.approve'))`,
        [parsed.data.employeeId, actor.id],
      );
      if (!employee.rowCount) throw new Error("Permission denied.");
      const overlap = await client.query<{ id: string }>(
        `SELECT id FROM leave_requests WHERE employee_id=$1 AND status IN ('pending','approved')
          AND daterange(start_date,end_date,'[]') && daterange($2::date,$3::date,'[]')`,
        [parsed.data.employeeId, parsed.data.startDate, parsed.data.endDate],
      );
      if (overlap.rowCount) throw new Error("A leave request already covers these dates.");
      const days = await client.query<{ value: string }>(
        `SELECT (($2::date - $1::date + 1) - COALESCE((
           SELECT count(*) FROM generate_series($1::date,$2::date, interval '1 day') day
           WHERE extract(dow from day) IN (0,6)),0))::text AS value`,
        [parsed.data.startDate, parsed.data.endDate],
      );
      const workflow = await client.query<{ id: string }>(
        `SELECT id FROM approval_workflows WHERE request_type='leave' AND is_active
         ORDER BY entity_id NULLS FIRST LIMIT 1`,
      );
      if (!workflow.rowCount) throw new Error("No leave approval workflow is configured.");
      const request = await client.query<{ id: string }>(
        `INSERT INTO leave_requests(employee_id, leave_type_id, start_date, end_date, days, reason, status)
         VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
        [parsed.data.employeeId, parsed.data.leaveTypeId, parsed.data.startDate, parsed.data.endDate,
          days.rows[0].value, parsed.data.reason ?? null],
      );
      const approval = await client.query<{ id: string }>(
        `INSERT INTO approval_requests(workflow_id,request_type,ref_table,ref_id,requester_id,title,status,current_step,amount_usd)
         SELECT $1,'leave','leave_requests',$2,$3,$4,'pending',1,0
         RETURNING id`,
        [workflow.rows[0].id, request.rows[0].id, actor.id,
          `${parsed.data.startDate} - ${parsed.data.endDate}`],
      );
      await client.query("UPDATE leave_requests SET approval_request_id=$2 WHERE id=$1",
        [request.rows[0].id, approval.rows[0].id]);
      return { id: request.rows[0].id, approvalRequestId: approval.rows[0].id, days: Number(days.rows[0].value) };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create leave request.";
    if (message === "Permission denied.") return NextResponse.json({ error: message }, { status: 403 });
    if (message.includes("already covers")) return NextResponse.json({ error: message }, { status: 409 });
    console.error("Unable to create leave request.", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
