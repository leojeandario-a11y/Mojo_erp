import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { exchangeRateToUsd } from "@/lib/finance-exchange-rates";
import {
  cents,
  decimalQuantity,
  decimal,
  getStoreEntity,
  multiplyMoney,
  nextStoreReceiptNumber,
  nextStoreTransactionNumber,
  quantityThousandths,
  requireStorePermission,
  StorePolicyError,
} from "@/lib/store";

const saleSchema = z.object({
  offlineSaleId: z.uuid().nullable(),
  locationId: z.uuid(),
  currency: z.enum(["HTG", "USD"]),
  customerId: z.uuid().nullable(),
  discount: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/),
  paymentMethod: z.enum(["cash", "card", "mobile_money", "bank_transfer"]),
  accountId: z.uuid(),
  tenderedAmount: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/),
  items: z.array(z.object({
    productId: z.uuid(),
    quantity: z.string().regex(/^\d{1,9}(?:\.\d{1,3})?$/).refine((value) => Number(value) > 0),
  }).strict()).min(1).max(100),
}).strict();

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.product.read", store.id);
      const params = new URL(request.url).searchParams;
      const result = await client.query(
        `SELECT s.id, s.receipt_number, s.sold_at, s.currency, s.subtotal::text,
                s.discount::text, s.total::text, s.status, u.full_name AS cashier,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'name', p.name, 'sku', p.sku, 'quantity', i.quantity::text,
                  'lineTotal', i.line_total::text
                )) FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb) AS items
         FROM sales s JOIN users u ON u.id=s.cashier_id
         LEFT JOIN sale_items i ON i.sale_id=s.id
         LEFT JOIN products p ON p.id=i.product_id
         WHERE s.entity_id=$1
           AND ($2::date IS NULL OR s.sold_at::date >= $2::date)
           AND ($3::date IS NULL OR s.sold_at::date <= $3::date)
         GROUP BY s.id,u.full_name ORDER BY s.sold_at DESC LIMIT 200`,
        [store.id, params.get("from") || null, params.get("to") || null],
      );
      return NextResponse.json({ sales: result.rows });
    });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to load Store sales.", error);
    return NextResponse.json({ error: "Unable to load sales history." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = saleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid sale details." }, { status: 400 });
  const aggregated = new Map<string, string>();
  for (const item of parsed.data.items) {
    const previous = quantityThousandths(aggregated.get(item.productId) ?? "0");
    const sum = previous + quantityThousandths(item.quantity);
    if (sum > BigInt("999999999999")) {
      return NextResponse.json({ error: "Product quantity exceeds the supported limit." }, { status: 400 });
    }
    aggregated.set(item.productId, decimalQuantity(sum));
  }

  try {
    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.pos.sell", store.id);
      const duplicate = parsed.data.offlineSaleId
        ? await client.query(
          `SELECT s.id, s.receipt_number, s.currency, s.subtotal::text, s.discount::text,
                  s.total::text, p.tendered_amount::text, p.change_amount::text
           FROM sales s LEFT JOIN sale_payments p ON p.sale_id=s.id
           WHERE s.offline_sale_id=$1 AND s.entity_id=$2`,
          [parsed.data.offlineSaleId, store.id],
        )
        : { rows: [] };
      if (duplicate.rows[0]) {
        return {
          duplicate: true,
          sale: {
            id: duplicate.rows[0].id,
            receiptNumber: duplicate.rows[0].receipt_number,
            currency: duplicate.rows[0].currency,
            subtotal: duplicate.rows[0].subtotal,
            discount: duplicate.rows[0].discount,
            total: duplicate.rows[0].total,
            tendered: duplicate.rows[0].tendered_amount,
            change: duplicate.rows[0].change_amount,
          },
          items: [],
        };
      }

      const location = await client.query(
        "SELECT id FROM stock_locations WHERE id=$1 FOR UPDATE",
        [parsed.data.locationId],
      );
      if (!location.rowCount) throw new StorePolicyError("Stock location not found.", 404);
      const inventory = await client.query(
        "SELECT 1 FROM inventory_counts WHERE location_id=$1 AND status='open' LIMIT 1",
        [parsed.data.locationId],
      );
      if (inventory.rowCount) throw new StorePolicyError("Sales are paused while this location is being inventoried.", 409);

      const productIds = [...aggregated.keys()].sort();
      const products = await client.query<{
        id: string;
        sku: string;
        name: string;
        status: string;
        price_currency: string;
        sale_price: string;
        purchase_price: string;
        exhibitor_id: string | null;
        quantity: string;
      }>(
        `SELECT p.id,p.sku,p.name,p.status,p.price_currency,p.sale_price::text,p.purchase_price::text,
                p.exhibitor_id,
                COALESCE((SELECT SUM(m.quantity) FROM stock_movements m
                          WHERE m.product_id=p.id AND m.location_id=$3),0)::text AS quantity
         FROM products p
         WHERE p.id=ANY($1::uuid[]) AND p.entity_id=$2
         ORDER BY p.id FOR UPDATE OF p`,
        [productIds, store.id, parsed.data.locationId],
      );
      if (products.rowCount !== productIds.length || products.rows.some(({ status }) => status !== "active")) {
        throw new StorePolicyError("One or more products are unavailable.", 400);
      }

      const { rows: [businessDate] } = await client.query<{ today: string }>("SELECT CURRENT_DATE::text AS today");
      const saleRate = await exchangeRateToUsd(client, parsed.data.currency, businessDate.today);
      if (!saleRate) throw new StorePolicyError("No exchange rate is available for this sale.", 409);
      const rateByCurrency = new Map<string, string>([[parsed.data.currency, saleRate], ["USD", "1.00000000"]]);
      for (const currency of new Set(products.rows.map(({ price_currency }) => price_currency))) {
        if (!rateByCurrency.has(currency)) {
          const rate = await exchangeRateToUsd(client, currency, businessDate.today);
          if (!rate) throw new StorePolicyError(`No exchange rate is available for ${currency}.`, 409);
          rateByCurrency.set(currency, rate);
        }
      }

      const lines = products.rows.map((product) => {
        const quantity = aggregated.get(product.id);
        if (!quantity) throw new StorePolicyError("Invalid sale item.", 400);
        if (quantityThousandths(product.quantity) < quantityThousandths(quantity)) {
          throw new StorePolicyError(`Insufficient stock for ${product.sku}.`, 409);
        }
        const unitPrice = convertCents(
          cents(product.sale_price),
          rateByCurrency.get(product.price_currency)!,
          saleRate,
        );
        const unitCost = convertCents(
          cents(product.purchase_price),
          rateByCurrency.get(product.price_currency)!,
          saleRate,
        );
        return {
          ...product,
          quantity,
          unitPrice,
          unitCost,
          gross: multiplyMoney(decimal(unitPrice), quantity),
        };
      });
      const subtotal = lines.reduce((total, line) => total + line.gross, BigInt("0"));
      const discount = cents(parsed.data.discount);
      if (discount > subtotal) throw new StorePolicyError("Discount cannot exceed the subtotal.", 400);
      const membership = await client.query<{ maximum: string }>(
        `SELECT COALESCE(MAX(d.max_percent), 0)::text AS maximum
         FROM user_roles ur JOIN store_discount_limits d ON d.role_id=ur.role_id
         WHERE ur.user_id=$1 AND (ur.entity_id IS NULL OR ur.entity_id=$2)`,
        [actor.id, store.id],
      );
      const maxPercentHundredths = BigInt(membership.rows[0].maximum.replace(".", "").padEnd(4, "0"));
      if (discount * BigInt("10000") > subtotal * maxPercentHundredths) {
        throw new StorePolicyError("Your role does not allow this discount.", 403);
      }
      const total = subtotal - discount;
      if (total <= BigInt("0")) throw new StorePolicyError("Sale total must be greater than zero.", 400);
      const tendered = cents(parsed.data.tenderedAmount);
      const change = tendered - total;
      if (change < BigInt("0")) throw new StorePolicyError("The tendered amount is below the sale total.", 400);
      if (change > BigInt("0") && parsed.data.paymentMethod !== "cash") {
        throw new StorePolicyError("Only cash payments can return change.", 400);
      }
      const account = await client.query<{ id: string; currency: string; account_type: string }>(
        "SELECT id,currency,account_type FROM accounts WHERE id=$1 AND entity_id=$2 AND is_active FOR UPDATE",
        [parsed.data.accountId, store.id],
      );
      if (!account.rowCount) throw new StorePolicyError("Select an active MOJO Store payment account.", 400);
      if (account.rows[0].currency !== parsed.data.currency) {
        throw new StorePolicyError("Payment account currency must match the sale currency.", 400);
      }
      if (
        (parsed.data.paymentMethod === "cash") !== (account.rows[0].account_type === "cash")
        || (parsed.data.paymentMethod === "mobile_money") !== (account.rows[0].account_type === "mobile_money")
      ) {
        throw new StorePolicyError("Payment method must match the selected account type.", 400);
      }
      if (parsed.data.paymentMethod === "cash") {
        const session = await client.query(
          "SELECT 1 FROM cash_sessions WHERE account_id=$1 AND session_date=CURRENT_DATE AND status='open' FOR UPDATE",
          [account.rows[0].id],
        );
        if (!session.rowCount) throw new StorePolicyError("Open the Store cash session before taking a cash payment.", 409);
      }
      if (parsed.data.customerId) {
        const customer = await client.query("SELECT 1 FROM customers WHERE id=$1", [parsed.data.customerId]);
        if (!customer.rowCount) throw new StorePolicyError("Customer not found.", 404);
      }
      const category = await client.query<{ id: string }>(
        "SELECT id FROM transaction_categories WHERE entity_id=$1 AND kind='income' AND is_active ORDER BY name LIMIT 1",
        [store.id],
      );
      if (!category.rowCount) throw new StorePolicyError("Configure an active Store income category before selling.", 409);

      const date = businessDate.today;
      const receiptNumber = await nextStoreReceiptNumber(client, date);
      const sale = await client.query<{ id: string }>(
        `INSERT INTO sales(
           entity_id,receipt_number,customer_id,cashier_id,currency,fx_rate_to_usd,
           subtotal,discount,total,status,offline_sale_id
         )
         VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9::numeric,'completed',$10)
         RETURNING id`,
        [
          store.id, receiptNumber, parsed.data.customerId, actor.id, parsed.data.currency,
          saleRate, decimal(subtotal), decimal(discount), decimal(total), parsed.data.offlineSaleId,
        ],
      );
      const saleId = sale.rows[0].id;
      const lineDiscounts = lines.map((line) => subtotal === BigInt("0") ? BigInt("0") : discount * line.gross / subtotal);
      let discountRemainder = discount - lineDiscounts.reduce((sum, item) => sum + item, BigInt("0"));
      for (let index = 0; discountRemainder > BigInt("0"); index = (index + 1) % lines.length) {
        if (lineDiscounts[index] < lines[index].gross) {
          lineDiscounts[index] += BigInt("1");
          discountRemainder -= BigInt("1");
        }
      }
      for (const [index, line] of lines.entries()) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost,discount)
           VALUES ($1,$2,$3::numeric,$4::numeric,$5::numeric,$6::numeric) RETURNING id`,
          [saleId, line.id, line.quantity, decimal(line.unitPrice), decimal(line.unitCost), decimal(lineDiscounts[index])],
        );
        await client.query(
          `INSERT INTO stock_movements(
             product_id,location_id,movement_type,quantity,unit_cost,unit_cost_currency,
             sale_item_id,reference,note,created_by
           )
           VALUES ($1,$2,'sale',-$3::numeric,$4::numeric,$5,$6,$7,'POS sale',$8)`,
          [
            line.id, parsed.data.locationId, line.quantity, decimal(line.unitCost), parsed.data.currency,
            inserted.rows[0].id, receiptNumber, actor.id,
          ],
        );
      }
      const payment = await client.query<{ id: string }>(
        `INSERT INTO sale_payments(sale_id,method,amount,currency,account_id,tendered_amount,change_amount)
         VALUES ($1,$2,$3::numeric,$4,$5,$6::numeric,$7::numeric) RETURNING id`,
        [saleId, parsed.data.paymentMethod, decimal(total), parsed.data.currency, parsed.data.accountId, decimal(tendered), decimal(change)],
      );
      const transactionNumber = await nextStoreTransactionNumber(client, store.id, store.code, date);
      const transaction = await client.query<{ id: string }>(
        `INSERT INTO transactions(
           entity_id,tx_number,tx_type,tx_date,account_id,category_id,amount,currency,
           fx_rate_to_usd,description,source_table,source_id,status,created_by,validated_by,validated_at
         )
         VALUES ($1,$2,'income',$3,$4,$5,$6::numeric,$7,$8::numeric,$9,'sales',$10,'validated',$11,$11,now())
         RETURNING id`,
        [
          store.id, transactionNumber, date, parsed.data.accountId, category.rows[0].id,
          decimal(total), parsed.data.currency, saleRate, `MOJO Store sale ${receiptNumber}`, saleId, actor.id,
        ],
      );
      await client.query("UPDATE sale_payments SET transaction_id=$2 WHERE id=$1", [payment.rows[0].id, transaction.rows[0].id]);
      return {
        duplicate: false,
        sale: { id: saleId, receiptNumber, currency: parsed.data.currency, subtotal: decimal(subtotal), discount: decimal(discount), total: decimal(total), tendered: decimal(tendered), change: decimal(change) },
        items: lines.map((line, index) => ({
          sku: line.sku,
          name: line.name,
          quantity: line.quantity,
          unitPrice: decimal(line.unitPrice),
          lineTotal: decimal(line.gross - lineDiscounts[index]),
        })),
      };
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23514") {
      return NextResponse.json({ error: "Insufficient stock for this sale." }, { status: 409 });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "This sale was already synchronized." }, { status: 409 });
    }
    console.error("Unable to complete MOJO Store sale.", error);
    return NextResponse.json({ error: "Unable to complete Store sale." }, { status: 500 });
  }
}

function convertCents(amountCents: bigint, sourceRate: string, targetRate: string) {
  const source = rateUnits(sourceRate);
  const target = rateUnits(targetRate);
  if (target <= BigInt("0")) throw new StorePolicyError("Invalid exchange rate.", 409);
  const numerator = amountCents * source;
  return (numerator + target / BigInt("2")) / target;
}

function rateUnits(value: string) {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value);
  if (!match) throw new StorePolicyError("Invalid exchange rate.", 409);
  return BigInt(match[1]) * BigInt("100000000")
    + BigInt((match[2] ?? "").padEnd(8, "0"));
}
