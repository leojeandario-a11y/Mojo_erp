import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const stages = ["prospect","contact","proposal","negotiation","contract","client","delivery","payment","lost"] as const;
const schema = z.object({ stage: z.enum(stages), lostReason: z.string().trim().max(1000).nullable().optional() }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid stage transition." }, { status: 400 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const manage = await client.query<{ allowed: boolean }>("SELECT app_has_permission('business.opportunity.manage') AS allowed");
      if (!manage.rows[0]?.allowed) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      const current = await client.query<{ stage: string }>("SELECT stage FROM opportunities WHERE id=$1", [id]);
      if (!current.rows[0]) return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
      await client.query("UPDATE opportunities SET stage=$2,lost_reason=$3 WHERE id=$1", [id,parsed.data.stage,parsed.data.lostReason ?? null]);
      await client.query(
        "INSERT INTO opportunity_stage_history(opportunity_id,from_stage,to_stage,changed_by) VALUES($1,$2,$3,$4)",
        [id,current.rows[0].stage,parsed.data.stage,actor.id],
      );
      return NextResponse.json({ id, fromStage: current.rows[0].stage, stage: parsed.data.stage });
    });
  } catch (error) {
    console.error("Unable to transition opportunity.", error);
    return NextResponse.json({ error: "Unable to transition opportunity." }, { status: 500 });
  }
}
