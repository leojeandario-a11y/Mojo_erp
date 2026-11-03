import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { canStorePermission, decimalQuantity, getStoreEntity, quantityThousandths, requireStorePermission, StorePolicyError } from "@/lib/store";

const updateCountSchema = z.object({
  action: z.enum(["save", "close"]),
  reason: z.string().trim().min(3).max(500).optional(),
  lines: z.array(z.object({
    productId: z.uuid(),
    countedQuantity: z.string().regex(/^\d{1,9}(?:\.\d{1,3})?$/),
  }).strict()).min(1).max(5000),
}).strict().superRefine((data, context) => {
  if (data.action === "close" && !data.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "An adjustment reason is required to close an inventory." });
  }
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid inventory id." }, { status: 400 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      const canRead = await canStorePermission(client, actor, "store.product.read", store.id);
      if (!canRead) await requireStorePermission(client, actor, "store.stock.manage", store.id);
      const count = await client.query(
        `SELECT c.id, c.location_id, l.name AS location, c.counted_on::text, c.status
         FROM inventory_counts c JOIN stock_locations l ON l.id=c.location_id
         WHERE c.id=$1 AND c.entity_id=$2`,
        [id, store.id],
      );
      if (!count.rowCount) throw new StorePolicyError("Inventory not found.", 404);
      const lines = await client.query(
        `SELECT i.product_id, p.sku, p.name, i.expected_qty::text, i.counted_qty::text
         FROM inventory_count_lines i
         JOIN products p ON p.id=i.product_id AND p.entity_id=$2
         WHERE i.count_id=$1 ORDER BY p.name`,
        [id, store.id],
      );
      return NextResponse.json({ count: count.rows[0], lines: lines.rows });
    });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to load Store inventory count.", error);
    return NextResponse.json({ error: "Unable to load inventory count." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid inventory id." }, { status: 400 });
  const parsed = updateCountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid inventory count details." }, { status: 400 });
  if (new Set(parsed.data.lines.map(({ productId }) => productId)).size !== parsed.data.lines.length) {
    return NextResponse.json({ error: "Each product may appear only once in an inventory." }, { status: 400 });
  }
  try {
    const report = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.stock.manage", store.id);
      const count = await client.query<{ location_id: string; status: string }>(
        `SELECT c.location_id, c.status
         FROM inventory_counts c
         WHERE c.id=$1
         FOR UPDATE`,
        [id],
      );
      if (!count.rowCount) throw new StorePolicyError("Inventory not found.", 404);
      if (count.rows[0].status !== "open") throw new StorePolicyError("This inventory is already closed.", 409);
      const location = await client.query(
        "SELECT id FROM stock_locations WHERE id=$1 FOR UPDATE",
        [count.rows[0].location_id],
      );
      if (!location.rowCount) throw new StorePolicyError("Stock location not found.", 404);
      const databaseLines = await client.query<{
        product_id: string; expected_qty: string; counted_qty: string;
      }>(
        `SELECT i.product_id, i.expected_qty::text, i.counted_qty::text
         FROM inventory_count_lines i
         JOIN products p ON p.id=i.product_id AND p.entity_id=$2
         WHERE i.count_id=$1
         ORDER BY i.product_id FOR UPDATE OF p, i`,
        [id, store.id],
      );
      if (!databaseLines.rowCount || databaseLines.rowCount !== parsed.data.lines.length) {
        throw new StorePolicyError("The submitted count must include every inventoried product.", 400);
      }
      const submitted = new Map(parsed.data.lines.map((line) => [line.productId, line.countedQuantity]));
      for (const line of databaseLines.rows) {
        if (!submitted.has(line.product_id)) {
          throw new StorePolicyError("The submitted count must include every inventoried product.", 400);
        }
        await client.query(
          "UPDATE inventory_count_lines SET counted_qty=$3::numeric WHERE count_id=$1 AND product_id=$2",
          [id, line.product_id, submitted.get(line.product_id)],
        );
      }
      const variances = await client.query<{
        product_id: string; sku: string; name: string; expected_qty: string; counted_qty: string;
      }>(
        `SELECT i.product_id, p.sku, p.name, i.expected_qty::text, i.counted_qty::text
         FROM inventory_count_lines i JOIN products p ON p.id=i.product_id
         WHERE i.count_id=$1 AND i.expected_qty <> i.counted_qty
         ORDER BY p.name`,
        [id],
      );
      if (parsed.data.action === "close") {
        for (const line of variances.rows) {
          const difference = quantityThousandths(line.counted_qty) - quantityThousandths(line.expected_qty);
          if (difference === BigInt("0")) continue;
          await client.query(
            `INSERT INTO stock_movements(
               product_id, location_id, movement_type, quantity, reference, note, created_by
             )
             VALUES ($1, $2, 'inventory', $3::numeric, $4, $5, $6)`,
            [
              line.product_id, count.rows[0].location_id, decimalQuantity(difference),
              `INVENTORY-${id}`, parsed.data.reason, actor.id,
            ],
          );
        }
        await client.query("UPDATE inventory_counts SET status='closed' WHERE id=$1", [id]);
      }
      return { status: parsed.data.action === "close" ? "closed" : "open", variances: variances.rows };
    });
    return NextResponse.json({ inventory: report });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23514") {
      return NextResponse.json({ error: "The inventory adjustment would make stock negative." }, { status: 409 });
    }
    console.error("Unable to save Store inventory count.", error);
    return NextResponse.json({ error: "Unable to save inventory count." }, { status: 500 });
  }
}
