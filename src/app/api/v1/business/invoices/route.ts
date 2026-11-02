import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const lineSchema = z.object({ description:z.string().trim().min(1).max(500), quantity:z.coerce.number().positive(), unitPrice:z.coerce.number().nonnegative() });
const invoiceSchema = z.object({
  customerId:z.uuid(), contractId:z.uuid().nullable().optional(), issueDate:z.iso.date(), dueDate:z.iso.date(), currency:z.enum(["USD","HTG"]),
  discount:z.coerce.number().nonnegative().default(0), taxAmount:z.coerce.number().nonnegative().default(0), notes:z.string().trim().max(3000).nullable().optional(), lines:z.array(lineSchema).min(1).max(100),
}).refine((d)=>d.dueDate>=d.issueDate).strict();

export async function GET() {
  const actor=await getSession();
  if(!actor) return NextResponse.json({error:"Authentication required."},{status:401});
  return withDbUser(actor.id,null,async(client)=>{
    const result=await client.query(`SELECT i.*,c.full_name,c.company_name,
      COALESCE(json_agg(il ORDER BY il.description) FILTER (WHERE il.id IS NOT NULL),'[]') AS items,
      COALESCE((SELECT sum(p.amount*p.fx_rate_to_invoice_currency) FROM invoice_payments p WHERE p.invoice_id=i.id),0)::text AS paid
      FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN invoice_items il ON il.invoice_id=i.id
      GROUP BY i.id,c.full_name,c.company_name ORDER BY i.issue_date DESC,i.created_at DESC`);
    return NextResponse.json({invoices:result.rows});
  });
}

export async function POST(request:Request) {
  const actor=await getSession(request.headers);
  if(!actor) return NextResponse.json({error:"Authentication required."},{status:401});
  const parsed=invoiceSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({error:"Invalid invoice data."},{status:400});
  try {
    return await withDbUser(actor.id,requestIp(request.headers),async(client)=>{
      const manage=await client.query<{allowed:boolean}>("SELECT app_has_permission('business.invoice.manage') AS allowed");
      if(!manage.rows[0]?.allowed) return NextResponse.json({error:"Permission denied."},{status:403});
      const entity=await client.query<{id:string}>("SELECT id FROM entities WHERE is_active ORDER BY created_at LIMIT 1");
      if(!entity.rows[0]) return NextResponse.json({error:"No active entity configured."},{status:409});
      const d=parsed.data;
      const subtotal=d.lines.reduce((sum,line)=>sum+Math.round(line.quantity*line.unitPrice*100)/100,0);
      const total=Math.round((subtotal-d.discount+d.taxAmount)*100)/100;
      if(total<0) return NextResponse.json({error:"Invoice total cannot be negative."},{status:400});
      const number=await client.query<{number:string}>("SELECT ('INV-'||to_char(now(),'YYYY')||'-'||lpad(nextval('invoice_numbers')::text,6,'0')) AS number");
      const invoice=await client.query<{id:string}>(
        `INSERT INTO invoices(entity_id,invoice_number,customer_id,contract_id,issue_date,due_date,currency,subtotal,discount,tax_amount,total,status,notes,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'issued',$12,$13) RETURNING id`,
        [entity.rows[0].id,number.rows[0].number,d.customerId,d.contractId??null,d.issueDate,d.dueDate,d.currency,subtotal,d.discount,d.taxAmount,total,d.notes??null,actor.id],
      );
      for(const line of d.lines) await client.query("INSERT INTO invoice_items(invoice_id,description,quantity,unit_price) VALUES($1,$2,$3,$4)",[invoice.rows[0].id,line.description,line.quantity,line.unitPrice]);
      return NextResponse.json({id:invoice.rows[0].id,invoiceNumber:number.rows[0].number,total},{status:201});
    });
  } catch(error) {
    console.error("Unable to create invoice.",error);
    return NextResponse.json({error:"Unable to create invoice."},{status:500});
  }
}
