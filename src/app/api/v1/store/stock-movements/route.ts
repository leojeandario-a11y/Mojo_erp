import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { canStorePermission, getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

const movementSchema = z.object({
  productId: z.uuid(),
  locationId: z.uuid(),
  type: z.enum(["entry", "exit", "loss", "adjustment", "transfer_in", "transfer_out"]),
  quantity: z.string().regex(/^-?\d{1,9}(?:\.\d{1,3})?$/).refine((value) => Number(value) !== 0),
  unitCost: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/).nullable(),
  currency: z.enum(["HTG", "USD"]).nullable(),
  reference: z.string().trim().max(120).nullable(),
  note: z.string().trim().min(2).max(500),
  date: z.iso.datetime().optional(),
}).strict().superRefine((data, context) => {
  if (data.type !== "adjustment" && Number(data.quantity) <= 0) {
    context.addIssue({ code: "custom", path: ["quantity"], message: "Quantity must be positive." });
  }
});

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      const canRead = await canStorePermission(client, actor, "store.product.read", store.id);
      if (!canRead) await requireStorePermission(client, actor, "store.stock.manage", store.id);
      const result = await client.query(
        `SELECT m.id, m.product_id, p.sku, p.name AS product, m.location_id, l.name AS location,
                m.movement_type, m.quantity::text, m.unit_cost::text, m.reference, m.note,
                m.unit_cost_currency, m.occurred_at, u.full_name AS created_by
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         JOIN stock_locations l ON l.id = m.location_id
         LEFT JOIN users u ON u.id = m.created_by
         WHERE p.entity_id = $1 AND l.is_default
         ORDER BY m.occurred_at DESC LIMIT 200`,
        [store.id],
      );
      return NextResponse.json({ movements: result.rows });
    });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to load Store stock movements.", error);
    return NextResponse.json({ error: "Unable to load stock movements." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = movementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid stock movement details." }, { status: 400 });
  if ((parsed.data.unitCost === null) !== (parsed.data.currency === null)) {
    return NextResponse.json({ error: "Cost and currency must be supplied together." }, { status: 400 });
  }

  try {
    const movement = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.stock.manage", store.id);
      const location = await client.query("SELECT 1 FROM stock_locations WHERE id = $1 AND is_default FOR UPDATE", [parsed.data.locationId]);
      if (!location.rowCount) throw new StorePolicyError("Stock location not found.", 404);
      const product = await client.query<{ id: string }>(
        "SELECT id FROM products WHERE id = $1 AND entity_id = $2 FOR UPDATE",
        [parsed.data.productId, store.id],
      );
      if (!product.rowCount) throw new StorePolicyError("Product not found.", 404);
      const openCount = await client.query(
        "SELECT 1 FROM inventory_counts WHERE location_id=$1 AND status='open' LIMIT 1",
        [parsed.data.locationId],
      );
      if (openCount.rowCount) throw new StorePolicyError("Stock movements are paused while this location is being inventoried.", 409);
      const signedQuantity = parsed.data.type === "adjustment"
        ? parsed.data.quantity
        : ["entry", "transfer_in"].includes(parsed.data.type)
          ? parsed.data.quantity
          : `-${parsed.data.quantity}`;
      const result = await client.query<{ id: string }>(
        `INSERT INTO stock_movements(
           product_id, location_id, movement_type, quantity, unit_cost, unit_cost_currency,
           reference, note, occurred_at, created_by
         )
         VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6, $7, $8, COALESCE($9::timestamptz, now()), $10)
         RETURNING id`,
        [
          parsed.data.productId, parsed.data.locationId, parsed.data.type, signedQuantity,
          parsed.data.unitCost, parsed.data.currency, parsed.data.reference, parsed.data.note,
          parsed.data.date ?? null, actor.id,
        ],
      );
      return result.rows[0];
    });
    return NextResponse.json({ movement }, { status: 201 });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23514") {
      return NextResponse.json({ error: "This movement would make stock negative." }, { status: 409 });
    }
    console.error("Unable to create Store stock movement.", error);
    return NextResponse.json({ error: "Unable to create stock movement." }, { status: 500 });
  }
}
