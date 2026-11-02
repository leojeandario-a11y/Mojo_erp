import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const customerSchema = z.object({
  kind: z.enum(["prospect","client"]),
  companyName: z.string().trim().max(160).nullable().optional(),
  fullName: z.string().trim().min(2).max(160),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(3000).nullable().optional(),
}).strict();

const contactSchema = z.object({
  customerId: z.uuid(),
  fullName: z.string().trim().min(2).max(160),
  jobTitle: z.string().trim().max(160).nullable().optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
}).strict();

const interactionSchema = z.object({
  customerId: z.uuid(),
  interactionType: z.enum(["call","meeting","email","message","visit","other"]),
  summary: z.string().trim().min(1).max(3000),
}).strict();

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { type?: string } | null;
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const manage = await client.query<{ allowed: boolean }>("SELECT app_has_permission('business.customer.manage') AS allowed");
      if (!manage.rows[0]?.allowed) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      let result;
      if (body?.type === "customer") {
        const data = customerSchema.parse(body);
        const entity = await client.query<{ id: string }>("SELECT id FROM entities WHERE is_active ORDER BY created_at LIMIT 1");
        if (!entity.rows[0]) return NextResponse.json({ error: "No active entity configured." }, { status: 409 });
        result = await client.query(
          `INSERT INTO customers(entity_id,kind,company_name,full_name,email,phone,address,owner_id,notes)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [entity.rows[0].id,data.kind,data.companyName ?? null,data.fullName,data.email ?? null,data.phone ?? null,data.address ?? null,actor.id,data.notes ?? null],
        );
      } else if (body?.type === "contact") {
        const data = contactSchema.parse(body);
        result = await client.query(
          `INSERT INTO customer_contacts(customer_id,full_name,job_title,email,phone) VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [data.customerId,data.fullName,data.jobTitle ?? null,data.email ?? null,data.phone ?? null],
        );
      } else if (body?.type === "interaction") {
        const data = interactionSchema.parse(body);
        result = await client.query(
          `INSERT INTO customer_interactions(customer_id,interaction_type,summary,created_by) VALUES($1,$2,$3,$4) RETURNING *`,
          [data.customerId,data.interactionType,data.summary,actor.id],
        );
      } else return NextResponse.json({ error: "Unsupported customer operation." }, { status: 400 });
      return NextResponse.json(result.rows[0], { status: 201 });
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid business data." }, { status: 400 });
    console.error("Unable to save customer data.", error);
    return NextResponse.json({ error: "Unable to save customer data." }, { status: 500 });
  }
}
