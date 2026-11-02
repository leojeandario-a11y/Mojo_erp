import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const opportunitySchema = z.object({
  customerId: z.uuid(), title: z.string().trim().min(2).max(200), serviceRequested: z.string().trim().max(1000).nullable().optional(),
  estimatedAmount: z.coerce.number().nonnegative().nullable().optional(), currency: z.enum(["USD","HTG"]).nullable().optional(),
  expectedClose: z.iso.date().nullable().optional(), ownerId: z.uuid().nullable().optional(), stage: z.enum(["prospect","contact","proposal","negotiation","contract","client","delivery","payment"]).optional(),
}).strict();

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = opportunitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid opportunity data." }, { status: 400 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const manage = await client.query<{ allowed: boolean }>("SELECT app_has_permission('business.opportunity.manage') AS allowed");
      if (!manage.rows[0]?.allowed) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      const entity = await client.query<{ id: string }>("SELECT id FROM entities WHERE is_active ORDER BY created_at LIMIT 1");
      if (!entity.rows[0]) return NextResponse.json({ error: "No active entity configured." }, { status: 409 });
      const data = parsed.data;
      const result = await client.query(
        `INSERT INTO opportunities(entity_id,customer_id,title,service_requested,stage,estimated_amount,currency,expected_close,owner_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [entity.rows[0].id,data.customerId,data.title,data.serviceRequested ?? null,data.stage ?? "prospect",
         data.estimatedAmount ?? null,data.currency ?? null,data.expectedClose ?? null,data.ownerId ?? actor.id],
      );
      await client.query(
        `INSERT INTO opportunity_stage_history(opportunity_id,from_stage,to_stage,changed_by) VALUES($1,NULL,$2,$3)`,
        [result.rows[0].id,data.stage ?? "prospect",actor.id],
      );
      return NextResponse.json(result.rows[0], { status: 201 });
    });
  } catch (error) {
    console.error("Unable to create opportunity.", error);
    return NextResponse.json({ error: "Unable to create opportunity." }, { status: 500 });
  }
}
