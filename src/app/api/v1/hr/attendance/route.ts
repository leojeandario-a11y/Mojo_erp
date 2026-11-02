import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const attendanceSchema = z.object({
  employeeId: z.uuid(),
  workDate: z.iso.date(),
  status: z.enum(["present", "absent", "late", "permission", "remote"]),
  checkIn: z.string().nullable().optional(),
  checkOut: z.string().nullable().optional(),
  minutesLate: z.coerce.number().int().min(0).max(1440),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const records = await withDbUser(actor.id, null, async (client) => {
    const result = await client.query(
      `SELECT record.id, record.employee_id, employee.first_name, employee.last_name,
              record.work_date::text, record.status, record.check_in::text, record.check_out::text,
              record.minutes_late, record.note
       FROM attendance_records record
       JOIN employees employee ON employee.id = record.employee_id
       ORDER BY record.work_date DESC, employee.last_name, employee.first_name
       LIMIT 1000`,
    );
    return result.rows;
  });
  return NextResponse.json({ records });
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = attendanceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid attendance record." }, { status: 400 });
  try {
    const record = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_permission('hr.attendance.manage') AS allowed",
      );
      if (!permission.rows[0]?.allowed) return null;
      const result = await client.query<{ id: string }>(
        `INSERT INTO attendance_records(employee_id, work_date, status, check_in, check_out, minutes_late, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (employee_id, work_date) DO UPDATE SET status=EXCLUDED.status,
           check_in=EXCLUDED.check_in, check_out=EXCLUDED.check_out,
           minutes_late=EXCLUDED.minutes_late, note=EXCLUDED.note
         RETURNING id`,
        [parsed.data.employeeId, parsed.data.workDate, parsed.data.status,
          parsed.data.checkIn || null, parsed.data.checkOut || null,
          parsed.data.minutesLate, parsed.data.note ?? null],
      );
      return result.rows[0];
    });
    if (!record) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error("Unable to save attendance.", error);
    return NextResponse.json({ error: "Unable to save attendance." }, { status: 500 });
  }
}
