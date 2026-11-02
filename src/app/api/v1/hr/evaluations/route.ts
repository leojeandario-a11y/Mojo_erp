import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const evaluationSchema = z.object({
  employeeId: z.uuid(),
  periodLabel: z.string().trim().min(2).max(100),
  score: z.number().min(0).max(100),
  comments: z.string().trim().max(2000).nullable().optional(),
  evaluatedOn: z.iso.date(),
}).strict();

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const evaluations = await withDbUser(actor.id, null, async (client) => {
    const result = await client.query(
      `SELECT evaluation.id, evaluation.employee_id, employee.first_name, employee.last_name,
              evaluation.period_label, evaluation.score::text, evaluation.comments,
              evaluation.evaluated_on::text
       FROM evaluations evaluation
       JOIN employees employee ON employee.id = evaluation.employee_id
       ORDER BY evaluation.evaluated_on DESC, employee.last_name LIMIT 500`,
    );
    return result.rows;
  });
  return NextResponse.json({ evaluations });
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = evaluationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid evaluation." }, { status: 400 });
  const evaluation = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
    const permission = await client.query<{ allowed: boolean }>(
      "SELECT app_has_permission('hr.employee.manage') AS allowed",
    );
    if (!permission.rows[0]?.allowed) return null;
    const result = await client.query<{ id: string }>(
      `INSERT INTO evaluations(employee_id,evaluator_id,period_label,score,comments,evaluated_on)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [parsed.data.employeeId, actor.id, parsed.data.periodLabel, parsed.data.score,
        parsed.data.comments ?? null, parsed.data.evaluatedOn],
    );
    return result.rows[0];
  });
  if (!evaluation) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  return NextResponse.json(evaluation, { status: 201 });
}
