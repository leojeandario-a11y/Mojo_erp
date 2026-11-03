import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { exchangeRateToUsd } from "@/lib/finance-exchange-rates";
import { cents, decimal, getStoreEntity, nextStoreTransactionNumber, requireStorePermission, StorePolicyError } from "@/lib/store";

const paymentSchema = z.object({
  accountId: z.uuid(),
  amount: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  method: z.enum(["cash", "card", "mobile_money", "bank_transfer"]),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid statement id." }, { status: 400 });
  const parsed = paymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid exhibitor payment details." }, { status: 400 });

  try {
    const payment = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.exhibitor.pay", store.id);
      const statement = await client.query<{
        exhibitor_id: string;
        status: string;
        period_end: string;
        net_due_to_exhibitor_usd: string;
      }>(
        `SELECT s.exhibitor_id,s.status,s.period_end::text,s.net_due_to_exhibitor_usd::text
         FROM exhibitor_statements s WHERE s.id=$1 FOR UPDATE`,
        [id],
      );
      if (!statement.rowCount) throw new StorePolicyError("Statement not found.", 404);
      if (!["validated", "settled"].includes(statement.rows[0].status)) {
        throw new StorePolicyError("Validate this statement before recording payment.", 409);
      }
      if (statement.rows[0].status === "settled") throw new StorePolicyError("This statement is already settled.", 409);
      const netDue = cents(statement.rows[0].net_due_to_exhibitor_usd);
      if (netDue === BigInt("0")) throw new StorePolicyError("There is no balance due on this statement.", 409);
      const direction = netDue > BigInt("0") ? "to_exhibitor" : "from_exhibitor";
      const transactionType = direction === "to_exhibitor" ? "expense" : "income";
      const account = await client.query<{ currency: string; account_type: string }>(
        "SELECT currency,account_type FROM accounts WHERE id=$1 AND entity_id=$2 AND is_active FOR UPDATE",
        [parsed.data.accountId, store.id],
      );
      if (!account.rowCount) throw new StorePolicyError("Select an active MOJO Store settlement account.", 400);
      if (account.rows[0].currency !== "HTG" && account.rows[0].currency !== "USD") {
        throw new StorePolicyError("Unsupported payment account currency.", 400);
      }
      if (
        (parsed.data.method === "cash") !== (account.rows[0].account_type === "cash")
        || (parsed.data.method === "mobile_money") !== (account.rows[0].account_type === "mobile_money")
      ) {
        throw new StorePolicyError("Payment method must match the selected account type.", 400);
      }
      const { rows: [businessDate] } = await client.query<{ today: string }>("SELECT CURRENT_DATE::text AS today");
      const rate = await exchangeRateToUsd(client, account.rows[0].currency, businessDate.today);
      if (!rate) throw new StorePolicyError(`No exchange rate is available for ${account.rows[0].currency}.`, 409);
      const paymentUsdResult = await client.query<{ amount: string }>(
        "SELECT round($1::numeric * $2::numeric,2)::text AS amount",
        [parsed.data.amount, rate],
      );
      const paymentUsd = cents(paymentUsdResult.rows[0].amount);
      const priorPayments = await client.query<{ paid_usd: string }>(
        `SELECT COALESCE(SUM(amount*fx_rate_to_usd),0)::numeric(18,2)::text AS paid_usd
         FROM exhibitor_payments WHERE statement_id=$1 AND direction=$2`,
        [id, direction],
      );
      const remaining = netDue > BigInt("0") ? netDue : -netDue;
      if (cents(priorPayments.rows[0].paid_usd) + paymentUsd > remaining) {
        throw new StorePolicyError("Payment exceeds the statement balance.", 400);
      }
      if (account.rows[0].account_type === "cash") {
        const session = await client.query(
          "SELECT 1 FROM cash_sessions WHERE account_id=$1 AND session_date=$2::date AND status='open' FOR UPDATE",
          [parsed.data.accountId, businessDate.today],
        );
        if (!session.rowCount) throw new StorePolicyError("Open the Store cash session before taking or making this payment.", 409);
      }
      const category = await client.query<{ id: string }>(
        "SELECT id FROM transaction_categories WHERE entity_id=$1 AND kind=$2 AND is_active ORDER BY name LIMIT 1",
        [store.id, transactionType],
      );
      if (!category.rowCount) {
        throw new StorePolicyError(`Configure an active Store ${transactionType} category before recording payment.`, 409);
      }
      const txNumber = await nextStoreTransactionNumber(client, store.id, store.code, businessDate.today);
      const transaction = await client.query<{ id: string }>(
        `INSERT INTO transactions(
           entity_id,tx_number,tx_type,tx_date,account_id,category_id,amount,currency,
           fx_rate_to_usd,description,source_table,source_id,status,created_by,validated_by,validated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9::numeric,$10,'exhibitor_statements',$11,'validated',$12,$12,now())
         RETURNING id`,
        [
          store.id, txNumber, transactionType, businessDate.today, parsed.data.accountId,
          category.rows[0].id, parsed.data.amount, account.rows[0].currency, rate,
          `${direction === "to_exhibitor" ? "Settlement to" : "Rent/commission received from"} exhibitor statement ${id}`,
          id, actor.id,
        ],
      );
      await client.query(
        `INSERT INTO exhibitor_payments(
           exhibitor_id,statement_id,direction,amount,currency,fx_rate_to_usd,paid_at,
           transaction_id,account_id,payment_method
         )
         VALUES ($1,$2,$3,$4::numeric,$5,$6::numeric,$7::date,$8,$9,$10)`,
        [
          statement.rows[0].exhibitor_id, id, direction, parsed.data.amount,
          account.rows[0].currency, rate, businessDate.today,
          transaction.rows[0].id, parsed.data.accountId, parsed.data.method,
        ],
      );
      const fullyPaid = cents(priorPayments.rows[0].paid_usd) + paymentUsd === remaining;
      if (fullyPaid) await client.query("UPDATE exhibitor_statements SET status='settled' WHERE id=$1", [id]);
      return { transactionId: transaction.rows[0].id, transactionNumber: txNumber, direction, paidUsd: decimal(paymentUsd), status: fullyPaid ? "settled" : "validated" };
    });
    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to record exhibitor payment.", error);
    return NextResponse.json({ error: "Unable to record exhibitor payment." }, { status: 500 });
  }
}
