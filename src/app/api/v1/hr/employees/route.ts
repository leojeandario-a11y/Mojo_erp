import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/permissions";
import { requestIp, withDbUser } from "@/lib/db";

const employeeSchema = z.object({
  employeeCode: z.string().trim().min(2).max(40),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  userId: z.uuid().nullable().optional(),
  birthDate: z.iso.date().nullable().optional(),
  nationalIdMasked: z.string().trim().min(0).max(30).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  departmentId: z.uuid().nullable().optional(),
  entityId: z.uuid().nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  hireDate: z.iso.date(),
  endDate: z.iso.date().nullable().optional(),
  status: z.enum(["active", "on_leave", "suspended", "terminated"]),
  contractType: z.enum(["permanent", "fixed_term", "consultant", "intern", "part_time"]).nullable().optional(),
  managerId: z.uuid().nullable().optional(),
}).strict();

class HrPolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const canRead = hasAnyPermission(actor, ["hr.employee.read", "hr.employee.manage"]);
  try {
    const employees = await withDbUser(actor.id, null, async (client) => {
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_permission('hr.employee.read') OR app_has_permission('hr.employee.manage') AS allowed",
      );
      if (!permission.rows[0]?.allowed && !canRead) throw new HrPolicyError("Permission denied.", 403);
      const result = await client.query(
        `SELECT employee.id, employee.employee_code, employee.first_name, employee.last_name,
                employee.user_id, employee.birth_date::text, employee.national_id_masked,
                employee.phone, employee.address, employee.department_id, department.name AS department_name,
                employee.entity_id, employee.job_title, employee.position_title,
                employee.hire_date::text, employee.end_date::text, employee.status,
                employee.contract_type, employee.manager_id,
                manager.first_name || ' ' || manager.last_name AS manager_name
         FROM employees employee
         LEFT JOIN departments department ON department.id = employee.department_id
         LEFT JOIN employees manager ON manager.id = employee.manager_id
         WHERE $1 OR employee.user_id = $2
         ORDER BY employee.last_name, employee.first_name`,
        [permission.rows[0]?.allowed === true, actor.id],
      );
      return result.rows.map((employee) => ({
        ...employee,
        national_id_masked: employee.national_id_masked
          ? employee.national_id_masked
          : null,
      }));
    });
    return NextResponse.json({ employees });
  } catch (error) {
    if (error instanceof HrPolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to load employees.", error);
    return NextResponse.json({ error: "Unable to load employees." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = employeeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid employee details." }, { status: 400 });
  try {
    const employee = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_permission('hr.employee.manage') AS allowed",
      );
      if (!permission.rows[0]?.allowed) throw new HrPolicyError("Permission denied.", 403);
      const result = await client.query<{ id: string }>(
        `INSERT INTO employees(employee_code, first_name, last_name, user_id, birth_date,
          national_id_masked, phone, address, department_id, entity_id, job_title, position_title,
          hire_date, end_date, status, contract_type, manager_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [parsed.data.employeeCode, parsed.data.firstName, parsed.data.lastName, parsed.data.userId ?? null,
          parsed.data.birthDate ?? null, parsed.data.nationalIdMasked ?? null, parsed.data.phone ?? null,
          parsed.data.address ?? null, parsed.data.departmentId ?? null, parsed.data.entityId ?? null,
          parsed.data.jobTitle ?? null, parsed.data.hireDate, parsed.data.endDate ?? null,
          parsed.data.status, parsed.data.contractType ?? null, parsed.data.managerId ?? null],
      );
      return result.rows[0];
    });
    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    if (error instanceof HrPolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "This employee code or user is already assigned." }, { status: 409 });
    }
    console.error("Unable to create employee.", error);
    return NextResponse.json({ error: "Unable to create employee." }, { status: 500 });
  }
}
