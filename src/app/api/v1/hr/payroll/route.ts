import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const salarySchema = z.object({
  employeeId: z.uuid(),
  baseSalary: z.coerce.number().nonnegative().max(999999999999.99),
  currency: z.enum(["USD", "HTG"]),
  payFrequency: z.enum(["weekly", "biweekly", "monthly"]),
  effectiveFrom: z.iso.date(),
});

const adjustmentSchema = z.object({
  employeeId: z.uuid(),
  kind: z.enum(["advance", "bonus", "deduction"]),
  amount: z.coerce.number().positive().max(999999999999.99),
  currency: z.enum(["USD", "HTG"]),
  adjustDate: z.iso.date(),
  reason: z.string().trim().max(500).nullable().optional(),
});

const runSchema = z.object({
  entityId: z.uuid().nullable().optional(),
  periodLabel: z.string().trim().min(2).max(80),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  currency: z.enum(["USD", "HTG"]).default("USD"),
}).refine((value) => value.periodEnd >= value.periodStart);

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return await withDbUser(actor.id, null, async (client) => {
      const permission = await client.query<{ salary: boolean; manage: boolean }>(
        `SELECT app_has_permission('hr.salary.read') AS salary,
                app_has_permission('hr.salary.manage') AS manage`,
      );
      if (!permission.rows[0]?.salary && !permission.rows[0]?.manage) {
        return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      }
      const [salaries, adjustments, runs] = await Promise.all([
        client.query(`SELECT s.*, e.employee_code, e.first_name, e.last_name
          FROM employee_salaries s JOIN employees e ON e.id=s.employee_id ORDER BY s.effective_from DESC`),
        client.query(`SELECT a.*, e.employee_code, e.first_name, e.last_name
          FROM salary_adjustments a JOIN employees e ON e.id=a.employee_id ORDER BY a.adjust_date DESC`),
        client.query(`SELECT r.*, COALESCE(json_agg(p ORDER BY p.gross_amount DESC) FILTER (WHERE p.id IS NOT NULL),'[]') AS entries
          FROM payroll_runs r LEFT JOIN payroll_entries p ON p.payroll_run_id=r.id
          GROUP BY r.id ORDER BY r.period_end DESC, r.created_at DESC`),
      ]);
      return NextResponse.json({ salaries: salaries.rows, adjustments: adjustments.rows, runs: runs.rows });
    });
  } catch (error) {
    console.error("Unable to load payroll data.", error);
    return NextResponse.json({ error: "Unable to load payroll data." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { type?: string } | null;
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_permission('hr.salary.manage') AS allowed",
      );
      if (!permission.rows[0]?.allowed) {
        return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      }
      if (body?.type === "salary") {
        const data = salarySchema.parse(body);
        await client.query(
          `UPDATE employee_salaries SET effective_to=$3
           WHERE employee_id=$1 AND currency=$2 AND effective_to IS NULL`,
          [data.employeeId, data.currency, data.effectiveFrom],
        );
        const result = await client.query(
          `INSERT INTO employee_salaries(employee_id,base_salary,currency,pay_frequency,effective_from)
           VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [data.employeeId, data.baseSalary, data.currency, data.payFrequency, data.effectiveFrom],
        );
        return NextResponse.json(result.rows[0], { status: 201 });
      }
      if (body?.type === "adjustment") {
        const data = adjustmentSchema.parse(body);
        const result = await client.query(
          `INSERT INTO salary_adjustments(employee_id,kind,amount,currency,adjust_date,reason,status,created_by)
           VALUES($1,$2,$3,$4,$5,$6,'approved',$7) RETURNING *`,
          [data.employeeId, data.kind, data.amount, data.currency, data.adjustDate, data.reason ?? null, actor.id],
        );
        return NextResponse.json(result.rows[0], { status: 201 });
      }
      if (body?.type === "run") {
        const data = runSchema.parse(body);
        const entity = data.entityId ? data.entityId : (await client.query<{ entity_id: string }>(
          `SELECT DISTINCT entity_id FROM employees WHERE entity_id IS NOT NULL LIMIT 2`,
        )).rows[0]?.entity_id;
        if (!entity) return NextResponse.json({ error: "No payroll entity is configured." }, { status: 409 });
        const run = await client.query<{ id: string }>(
          `INSERT INTO payroll_runs(entity_id,period_label,period_start,period_end,created_by,status)
           VALUES($1,$2,$3,$4,$5,'draft') RETURNING id`,
          [entity, data.periodLabel, data.periodStart, data.periodEnd, actor.id],
        );
        await client.query(
          `WITH current_salary AS (
             SELECT DISTINCT ON (s.employee_id) s.* FROM employee_salaries s
             WHERE s.effective_from <= $3 AND (s.effective_to IS NULL OR s.effective_to >= $2)
               AND s.currency=$4 ORDER BY s.employee_id,s.effective_from DESC
           ), employee_adjustments AS (
             SELECT employee_id,
               COALESCE(sum(amount) FILTER (WHERE kind='bonus' AND status='approved'),0) bonuses,
               COALESCE(sum(amount) FILTER (WHERE kind='deduction' AND status='approved'),0) deductions,
               COALESCE(sum(amount) FILTER (WHERE kind='advance' AND status='approved'),0) advances
             FROM salary_adjustments WHERE adjust_date BETWEEN $2 AND $3 AND currency=$4 GROUP BY employee_id
           )
           INSERT INTO payroll_entries(payroll_run_id,employee_id,gross_amount,bonuses,deductions,advances_recovered,net_amount,currency)
           SELECT $1,e.id,s.base_salary,COALESCE(a.bonuses,0),COALESCE(a.deductions,0),COALESCE(a.advances,0),
                  s.base_salary+COALESCE(a.bonuses,0)-COALESCE(a.deductions,0)-COALESCE(a.advances,0),s.currency
           FROM employees e JOIN current_salary s ON s.employee_id=e.id
           LEFT JOIN employee_adjustments a ON a.employee_id=e.id
           WHERE e.entity_id=$5 AND e.status='active' AND s.currency=$4`,
          [run.rows[0].id, data.periodStart, data.periodEnd, data.currency, entity],
        );
        await client.query(
          `UPDATE salary_adjustments SET status='applied'
           WHERE employee_id IN (SELECT employee_id FROM payroll_entries WHERE payroll_run_id=$1)
             AND status='approved' AND adjust_date BETWEEN $2 AND $3`,
          [run.rows[0].id, data.periodStart, data.periodEnd],
        );
        return NextResponse.json(run.rows[0], { status: 201 });
      }
      return NextResponse.json({ error: "Unsupported payroll operation." }, { status: 400 });
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid payroll data." }, { status: 400 });
    console.error("Unable to save payroll data.", error);
    return NextResponse.json({ error: "Unable to save payroll data." }, { status: 500 });
  }
}
