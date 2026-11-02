import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const supplierSchema = z.object({ name: z.string().trim().min(2).max(160), contactName: z.string().trim().max(160).nullable().optional(), email: z.email().nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), address: z.string().trim().max(300).nullable().optional(), paymentTerms: z.string().trim().max(300).nullable().optional(), isActive: z.boolean().default(true) }).strict();
const partnerSchema = z.object({ name: z.string().trim().min(2).max(160), partnerType: z.enum(["partner","collaborator","sponsor","other"]), contactName: z.string().trim().max(160).nullable().optional(), email: z.email().nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), commercialTerms: z.string().trim().max(1000).nullable().optional(), status: z.enum(["active","inactive","ended"]).default("active") }).strict();

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { type?: string } | null;
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const manage = await client.query<{ allowed: boolean }>("SELECT app_has_permission('business.customer.manage') AS allowed");
      if (!manage.rows[0]?.allowed) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      let result;
      if (body?.type === "supplier") {
        const data = supplierSchema.parse(body);
        result = await client.query(
          `INSERT INTO suppliers(name,contact_name,email,phone,address,payment_terms,is_active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [data.name,data.contactName ?? null,data.email ?? null,data.phone ?? null,data.address ?? null,data.paymentTerms ?? null,data.isActive],
        );
      } else if (body?.type === "partner") {
        const data = partnerSchema.parse(body);
        result = await client.query(
          `INSERT INTO partners(name,partner_type,contact_name,email,phone,commercial_terms,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [data.name,data.partnerType,data.contactName ?? null,data.email ?? null,data.phone ?? null,data.commercialTerms ?? null,data.status],
        );
      } else return NextResponse.json({ error: "Unsupported partner operation." }, { status: 400 });
      return NextResponse.json(result.rows[0], { status: 201 });
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid supplier or partner data." }, { status: 400 });
    console.error("Unable to save supplier or partner.", error);
    return NextResponse.json({ error: "Unable to save supplier or partner." }, { status: 500 });
  }
}
