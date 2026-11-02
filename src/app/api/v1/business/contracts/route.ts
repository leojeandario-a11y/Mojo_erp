import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const schema = z.object({
  contractKind: z.enum(["client","supplier","partner","exhibitor"]),
  customerId: z.uuid().nullable().optional(), supplierId: z.uuid().nullable().optional(), partnerId: z.uuid().nullable().optional(), opportunityId: z.uuid().nullable().optional(),
  title: z.string().trim().min(2).max(200), contractNumber: z.string().trim().min(2).max(80),
  amount: z.coerce.number().nonnegative().nullable().optional(), currency: z.enum(["USD","HTG"]).nullable().optional(),
  startDate: z.iso.date().nullable().optional(), endDate: z.iso.date().nullable().optional(), renewalDate: z.iso.date().nullable().optional(),
  autoRenew: z.boolean().default(false), terms: z.string().trim().max(5000).nullable().optional(),
}).strict();

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return withDbUser(actor.id, null, async (client) => {
    const result = await client.query(`SELECT co.*,c.full_name,c.company_name,s.name AS supplier_name,p.name AS partner_name,
      COALESCE(json_agg(cm) FILTER (WHERE cm.id IS NOT NULL),'[]') AS milestones
      FROM contracts co LEFT JOIN customers c ON c.id=co.customer_id LEFT JOIN suppliers s ON s.id=co.supplier_id
      LEFT JOIN partners p ON p.id=co.partner_id LEFT JOIN contract_milestones cm ON cm.contract_id=co.id
      GROUP BY co.id,c.full_name,c.company_name,s.name,p.name ORDER BY co.created_at DESC`);
    return NextResponse.json({ contracts: result.rows });
  });
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid contract data." }, { status: 400 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const manage = await client.query<{ allowed:boolean }>("SELECT app_has_permission('business.contract.manage') AS allowed");
      if (!manage.rows[0]?.allowed) return NextResponse.json({ error:"Permission denied." }, { status:403 });
      const entity = await client.query<{id:string}>("SELECT id FROM entities WHERE is_active ORDER BY created_at LIMIT 1");
      if (!entity.rows[0]) return NextResponse.json({error:"No active entity configured."},{status:409});
      const d=parsed.data;
      const result=await client.query(
        `INSERT INTO contracts(entity_id,contract_number,contract_kind,customer_id,supplier_id,partner_id,opportunity_id,title,amount,currency,start_date,end_date,renewal_date,auto_renew,terms,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft') RETURNING *`,
        [entity.rows[0].id,d.contractNumber,d.contractKind,d.customerId??null,d.supplierId??null,d.partnerId??null,d.opportunityId??null,d.title,d.amount??null,d.currency??null,d.startDate??null,d.endDate??null,d.renewalDate??null,d.autoRenew,d.terms??null],
      );
      return NextResponse.json(result.rows[0],{status:201});
    });
  } catch(error) {
    if (typeof error==="object" && error!==null && "code" in error && error.code==="23505") return NextResponse.json({error:"Contract number already exists."},{status:409});
    console.error("Unable to create contract.",error);
    return NextResponse.json({error:"Unable to create contract."},{status:500});
  }
}
