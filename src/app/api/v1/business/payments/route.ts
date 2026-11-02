import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const schema=z.object({
  invoiceId:z.uuid(), amount:z.coerce.number().positive(), currency:z.enum(["USD","HTG"]),
  fxRate:z.coerce.number().positive().default(1), method:z.enum(["cash","bank_transfer","cheque","mobile_money","card"]),
  paidAt:z.iso.date(), reference:z.string().trim().max(160).nullable().optional(),
}).strict();

export async function POST(request:Request) {
  const actor=await getSession(request.headers);
  if(!actor) return NextResponse.json({error:"Authentication required."},{status:401});
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({error:"Invalid payment data."},{status:400});
  try {
    return await withDbUser(actor.id,requestIp(request.headers),async(client)=>{
      const allowed=await client.query<{allowed:boolean}>("SELECT app_has_permission('business.payment.record') AS allowed");
      if(!allowed.rows[0]?.allowed) return NextResponse.json({error:"Permission denied."},{status:403});
      const d=parsed.data;
      const invoice=await client.query<{id:string;entity_id:string;currency:string;total:string;paid:string}>(
        `SELECT i.id,i.entity_id,i.currency,i.total,COALESCE(sum(p.amount*p.fx_rate_to_invoice_currency),0)::text AS paid
         FROM invoices i LEFT JOIN invoice_payments p ON p.invoice_id=i.id WHERE i.id=$1 GROUP BY i.id`,[d.invoiceId]);
      if(!invoice.rows[0]) return NextResponse.json({error:"Invoice not found."},{status:404});
      const balance=Number(invoice.rows[0].total)-Number(invoice.rows[0].paid);
      const amountInInvoiceCurrency=d.currency===invoice.rows[0].currency?d.amount:d.amount*d.fxRate;
      if(amountInInvoiceCurrency>balance+0.001) return NextResponse.json({error:"Payment exceeds the amount due.",due:balance},{status:409});
      const account=await client.query<{id:string}>(
        `SELECT id FROM accounts WHERE entity_id=$1 AND currency=$2 AND is_active ORDER BY created_at LIMIT 1`,
        [invoice.rows[0].entity_id,d.currency],
      );
      if(!account.rows[0]) return NextResponse.json({error:"No active account matches the payment currency."},{status:409});
      const receipt=await client.query<{number:string}>("SELECT ('REC-'||to_char(now(),'YYYY')||'-'||lpad(nextval('invoice_numbers')::text,6,'0')) AS number");
      const transaction=await client.query<{id:string}>(
        `INSERT INTO transactions(entity_id,tx_type,tx_date,account_id,amount,currency,fx_rate_to_usd,description,source_table,source_id,status,created_by)
         VALUES($1,'income',$2,$3,$4,$5,1,'Invoice payment',$6,$7,'draft',$8) RETURNING id`,
        [invoice.rows[0].entity_id,d.paidAt,account.rows[0].id,d.amount,d.currency,d.invoiceId,d.invoiceId,actor.id],
      );
      const payment=await client.query(
        `INSERT INTO invoice_payments(invoice_id,amount,currency,fx_rate_to_invoice_currency,method,paid_at,reference,receipt_number,transaction_id,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [d.invoiceId,d.amount,d.currency,d.currency===invoice.rows[0].currency?1:d.fxRate,d.method,d.paidAt,d.reference??null,receipt.rows[0].number,transaction.rows[0].id,actor.id],
      );
      const paidAfter=Number(invoice.rows[0].paid)+amountInInvoiceCurrency;
      const status=paidAfter>=Number(invoice.rows[0].total)-0.001?"paid":paidAfter>0?"partially_paid":"issued";
      await client.query("UPDATE invoices SET status=$2 WHERE id=$1",[d.invoiceId,status]);
      return NextResponse.json({payment:payment.rows[0],receiptNumber:receipt.rows[0].number,status,balance:Math.max(0,Number(invoice.rows[0].total)-paidAfter)},{status:201});
    });
  } catch(error) {
    console.error("Unable to record invoice payment.",error);
    return NextResponse.json({error:"Unable to record invoice payment."},{status:500});
  }
}
