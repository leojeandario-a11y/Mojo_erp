import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const schemas = {
  training: z.object({ title: z.string().trim().min(2).max(200), provider: z.string().trim().max(160).nullable().optional(), startDate: z.iso.date().nullable().optional(), endDate: z.iso.date().nullable().optional(), cost: z.coerce.number().nonnegative().optional(), currency: z.enum(["USD","HTG"]).nullable().optional() }),
  participant: z.object({ trainingId: z.uuid(), employeeId: z.uuid(), status: z.enum(["enrolled","completed","absent"]) }),
  opening: z.object({ title: z.string().trim().min(2).max(200), departmentId: z.uuid().nullable().optional(), description: z.string().trim().max(5000).nullable().optional(), status: z.enum(["draft","open","closed","filled"]), openedOn: z.iso.date().nullable().optional() }),
  candidate: z.object({ jobOpeningId: z.uuid(), fullName: z.string().trim().min(2).max(200), email: z.email().nullable().optional(), phone: z.string().trim().max(30).nullable().optional(), stage: z.enum(["applied","screening","interview","offer","hired","rejected"]), notes: z.string().trim().max(3000).nullable().optional() }),
  departure: z.object({ employeeId: z.uuid(), departureType: z.enum(["resignation","dismissal","end_of_contract","retirement","other"]), noticeDate: z.iso.date().nullable().optional(), lastDay: z.iso.date(), note: z.string().trim().max(3000).nullable().optional() }),
};

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return withDbUser(actor.id, null, async (client) => {
    const [training, participant, opening, candidate, departure] = await Promise.all([
      client.query(`SELECT * FROM trainings ORDER BY COALESCE(start_date,'9999-12-31'::date) DESC`),
      client.query(`SELECT tp.*, e.employee_code,e.first_name,e.last_name,t.title AS training_title FROM training_participants tp JOIN employees e ON e.id=tp.employee_id JOIN trainings t ON t.id=tp.training_id`),
      client.query(`SELECT o.*,d.name AS department_name FROM job_openings o LEFT JOIN departments d ON d.id=o.department_id ORDER BY opened_on DESC NULLS LAST`),
      client.query(`SELECT c.*,o.title AS opening_title FROM candidates c JOIN job_openings o ON o.id=c.job_opening_id ORDER BY c.created_at DESC`),
      client.query(`SELECT d.*,e.employee_code,e.first_name,e.last_name FROM departures d JOIN employees e ON e.id=d.employee_id ORDER BY d.last_day DESC`),
    ]);
    return NextResponse.json({ trainings: training.rows, participants: participant.rows, openings: opening.rows, candidates: candidate.rows, departures: departure.rows });
  });
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.type !== "string" || !(body.type in schemas)) {
    return NextResponse.json({ error: "Invalid HR operation." }, { status: 400 });
  }
  const type = body.type as keyof typeof schemas;
  const parsed = schemas[type].safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid HR operation data." }, { status: 400 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const permission = await client.query<{ allowed: boolean }>(
        `SELECT app_has_permission('hr.employee.manage') OR app_has_permission('hr.recruitment.manage') AS allowed`,
      );
      if (!permission.rows[0]?.allowed) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      let result;
      if (type === "training") {
        const d = parsed.data as z.infer<typeof schemas.training>;
        result = await client.query("INSERT INTO trainings(title,provider,start_date,end_date,cost,currency) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [d.title,d.provider ?? null,d.startDate ?? null,d.endDate ?? null,d.cost ?? null,d.currency ?? null]);
      } else if (type === "participant") {
        const d = parsed.data as z.infer<typeof schemas.participant>;
        result = await client.query("INSERT INTO training_participants(training_id,employee_id,status) VALUES($1,$2,$3) ON CONFLICT(training_id,employee_id) DO UPDATE SET status=EXCLUDED.status RETURNING *",[d.trainingId,d.employeeId,d.status]);
      } else if (type === "opening") {
        const d = parsed.data as z.infer<typeof schemas.opening>;
        result = await client.query("INSERT INTO job_openings(title,department_id,description,status,opened_on) VALUES($1,$2,$3,$4,$5) RETURNING *",[d.title,d.departmentId ?? null,d.description ?? null,d.status,d.openedOn ?? null]);
      } else if (type === "candidate") {
        const d = parsed.data as z.infer<typeof schemas.candidate>;
        result = await client.query("INSERT INTO candidates(job_opening_id,full_name,email,phone,stage,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[d.jobOpeningId,d.fullName,d.email ?? null,d.phone ?? null,d.stage,d.notes ?? null]);
      } else {
        const d = parsed.data as z.infer<typeof schemas.departure>;
        result = await client.query("INSERT INTO departures(employee_id,departure_type,notice_date,last_day,note) VALUES($1,$2,$3,$4,$5) RETURNING *",[d.employeeId,d.departureType,d.noticeDate ?? null,d.lastDay,d.note ?? null]);
      }
      return NextResponse.json(result.rows[0], { status: 201 });
    });
  } catch (error) {
    console.error("Unable to save HR operation.", error);
    return NextResponse.json({ error: "Unable to save HR operation." }, { status: 500 });
  }
}
