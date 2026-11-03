import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import {
  getStoreEntity,
  nextStoreTransactionNumber,
  requireStorePermission,
  StorePolicyError,
} from "@/lib/store";

const returnSchema = z.object({
  action: z.enum(["return", "void"]),
  accountId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid sale id." }, { status: 400 });
  const parsed = returnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid return details." }, { status: 400 });

  try {
    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(
        client,
        actor,
        parsed.data.action === "void" ? "store.pos.void" : "store.pos.return",
        store.id,
      );
      const sale = await client.query<{
        receipt_number: string;
        currency: string;
        fx_rate_to_usd: string;
        total: string;
        status: string;
      }>(
        `SELECT receipt_number,currency,fx_rate_to_usd::text,total::text,status
         FROM sales WHERE id=$1 AND entity_id=$2 FOR UPDATE`,
        [id, store.id],
      );
      if (!sale.rowCount) throw new StorePolicyError("Sale not found.", 404);
      if (sale.rows[0].status !== "completed") {
        throw new StorePolicyError("This sale has already been returned or voided.", 409);
      }

      const saleItems = await client.query<{
        product_id: string;
        quantity: string;
        location_id: string;
      }>(
        `SELECT i.product_id,i.quantity::text,m.location_id
         FROM sale_items i
         JOIN stock_movements m ON m.sale_item_id=i.id AND m.movement_type='sale'
         JOIN products p ON p.id=i.product_id AND p.entity_id=$2
         WHERE i.sale_id=$1
         ORDER BY m.location_id,p.id`,
        [id, store.id],
      );
      if (!saleItems.rowCount) throw new StorePolicyError("Sale has no returnable stock items.", 409);
      const locationIds = [...new Set(saleItems.rows.map(({ location_id }) => location_id))];
      await client.query(
        "SELECT id FROM stock_locations WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [locationIds],
      );
      const openCount = await client.query(
        "SELECT 1 FROM inventory_counts WHERE location_id=ANY($1::uuid[]) AND status='open' LIMIT 1",
        [locationIds],
      );
      if (openCount.rowCount) throw new StorePolicyError("Returns are paused while this location is being inventoried.", 409);
      await client.query(
        "SELECT id FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[...new Set(saleItems.rows.map(({ product_id }) => product_id))]],
      );

      const account = await client.query<{ currency: string; account_type: string }>(
        "SELECT currency,account_type FROM accounts WHERE id=$1 AND entity_id=$2 AND is_active FOR UPDATE",
        [parsed.data.accountId, store.id],
      );
      if (!account.rowCount) throw new StorePolicyError("Select an active MOJO Store refund account.", 400);
      if (account.rows[0].currency !== sale.rows[0].currency) {
        throw new StorePolicyError("Refund account currency must match the original sale.", 400);
      }
      if (account.rows[0].account_type === "cash") {
        const session = await client.query(
          "SELECT 1 FROM cash_sessions WHERE account_id=$1 AND session_date=CURRENT_DATE AND status='open' FOR UPDATE",
          [parsed.data.accountId],
        );
        if (!session.rowCount) throw new StorePolicyError("Open the Store cash session before issuing a cash refund.", 409);
      }
      const expenseCategory = await client.query<{ id: string }>(
        `SELECT id FROM transaction_categories
         WHERE entity_id=$1 AND kind='expense' AND is_active ORDER BY name LIMIT 1`,
        [store.id],
      );
      if (!expenseCategory.rowCount) {
        throw new StorePolicyError("Configure an active Store expense category before processing a refund.", 409);
      }
      const { rows: [businessDate] } = await client.query<{ today: string }>("SELECT CURRENT_DATE::text AS today");
      const txNumber = await nextStoreTransactionNumber(client, store.id, store.code, businessDate.today);
      const transaction = await client.query<{ id: string }>(
        `INSERT INTO transactions(
           entity_id,tx_number,tx_type,tx_date,account_id,category_id,amount,currency,
           fx_rate_to_usd,description,source_table,source_id,status,created_by,validated_by,validated_at
         )
         VALUES ($1,$2,'expense',$3,$4,$5,$6::numeric,$7,$8::numeric,$9,'sales',$10,'validated',$11,$11,now())
         RETURNING id`,
        [
          store.id, txNumber, businessDate.today, parsed.data.accountId, expenseCategory.rows[0].id,
          sale.rows[0].total, sale.rows[0].currency, sale.rows[0].fx_rate_to_usd,
          `${parsed.data.action === "void" ? "Void" : "Refund"} of Store receipt ${sale.rows[0].receipt_number}: ${parsed.data.reason}`,
          id, actor.id,
        ],
      );
      await client.query(
        `INSERT INTO store_sale_returns(sale_id,account_id,transaction_id,reason,returned_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, parsed.data.accountId, transaction.rows[0].id, parsed.data.reason, actor.id],
      );
      for (const item of saleItems.rows) {
        await client.query(
          `INSERT INTO stock_movements(
             product_id,location_id,movement_type,quantity,reference,note,created_by
           ) VALUES ($1,$2,'return',$3::numeric,$4,$5,$6)`,
          [
            item.product_id, item.location_id, item.quantity, sale.rows[0].receipt_number,
            `${parsed.data.action === "void" ? "Voided sale" : "Customer return"}: ${parsed.data.reason}`,
            actor.id,
          ],
        );
      }
      await client.query(
        parsed.data.action === "void"
          ? "UPDATE sales SET status='voided',voided_by=$2 WHERE id=$1"
          : "UPDATE sales SET status='returned',returned_at=now(),returned_by=$2 WHERE id=$1",
        [id, actor.id],
      );
      return { id: transaction.rows[0].id, transactionNumber: txNumber, status: parsed.data.action === "void" ? "voided" : "returned" };
    });
    return NextResponse.json({ return: result }, { status: 201 });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23514") {
      return NextResponse.json({ error: "Unable to restock the returned items." }, { status: 409 });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "This sale has already been returned or voided." }, { status: 409 });
    }
    console.error("Unable to process Store sale return.", error);
    return NextResponse.json({ error: "Unable to process Store sale return." }, { status: 500 });
  }
}
