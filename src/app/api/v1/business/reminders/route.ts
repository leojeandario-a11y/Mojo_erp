import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const schema = z.object({ opportunityId: z.uuid(), remindOn: z.iso.date(), note: z.string().trim().max(1000).nullable().optional() }).strict();

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid reminder." }, { status: 400 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const manage = await client.query<{ allowed: boolean }>("SELECT app_has_permission('business.opportunity.manage') AS allowed");
      if (!manage.rows[0]?.allowed) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      const result = await client.query(
        `INSERT INTO opportunity_reminders(opportunity_id,remind_on,note,created_by)
         VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *`,
        [parsed.data.opportunityId,parsed.data.remindOn,parsed.data.note ?? null,actor.id],
      );
      if (!result.rows[0]) return NextResponse.json({ error: "This reminder already exists." }, { status: 409 });
      return NextResponse.json(result.rows[0], { status: 201 });
    });
  } catch (error) {
    console.error("Unable to create business reminder.", error);
    return NextResponse.json({ error: "Unable to create business reminder." }, { status: 500 });
  }
}
