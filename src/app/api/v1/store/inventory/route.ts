import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { canStorePermission, getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

const createCountSchema = z.object({
  locationId: z.uuid(),
  countedOn: z.iso.date(),
}).strict();

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      const canRead = await canStorePermission(client, actor, "store.product.read", store.id);
      if (!canRead) await requireStorePermission(client, actor, "store.stock.manage", store.id);
      const result = await client.query(
        `SELECT c.id, c.location_id, l.name AS location, c.counted_on::text, c.status,
                c.created_by, u.full_name AS counted_by,
                COUNT(i.product_id)::int AS product_count,
                COUNT(i.product_id) FILTER (WHERE i.expected_qty <> i.counted_qty)::int AS variance_count
         FROM inventory_counts c
         JOIN stock_locations l ON l.id = c.location_id
         LEFT JOIN inventory_count_lines i ON i.count_id = c.id
         LEFT JOIN users u ON u.id = c.created_by
         WHERE c.entity_id = $1
         GROUP BY c.id, l.name, u.full_name
         ORDER BY c.counted_on DESC, c.id DESC LIMIT 100`,
        [store.id],
      );
      return NextResponse.json({ counts: result.rows });
    });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to load Store inventories.", error);
    return NextResponse.json({ error: "Unable to load inventories." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = createCountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid inventory details." }, { status: 400 });
  try {
    const count = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.stock.manage", store.id);
      const location = await client.query("SELECT id FROM stock_locations WHERE id=$1 AND is_default FOR UPDATE", [parsed.data.locationId]);
      if (!location.rowCount) throw new StorePolicyError("Stock location not found.", 404);
      const openCount = await client.query(
        "SELECT id FROM inventory_counts WHERE location_id=$1 AND status='open' FOR UPDATE",
        [parsed.data.locationId],
      );
      if (openCount.rowCount) throw new StorePolicyError("Close the existing inventory before starting another.", 409);
      const created = await client.query<{ id: string }>(
        `INSERT INTO inventory_counts(entity_id, location_id, counted_on, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [store.id, parsed.data.locationId, parsed.data.countedOn, actor.id],
      );
      const id = created.rows[0].id;
      await client.query(
        `INSERT INTO inventory_count_lines(count_id, product_id, expected_qty, counted_qty)
         SELECT $1, p.id, COALESCE(SUM(m.quantity),0), COALESCE(SUM(m.quantity),0)
         FROM products p
         LEFT JOIN stock_movements m ON m.product_id=p.id AND m.location_id=$2
         WHERE p.entity_id=$3 AND p.status='active'
         GROUP BY p.id`,
        [id, parsed.data.locationId, store.id],
      );
      const lines = await client.query(
        `SELECT i.product_id, p.sku, p.name, i.expected_qty::text, i.counted_qty::text
         FROM inventory_count_lines i JOIN products p ON p.id=i.product_id
         WHERE i.count_id=$1 ORDER BY p.name`,
        [id],
      );
      return { id, lines: lines.rows };
    });
    return NextResponse.json({ count }, { status: 201 });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to start Store inventory.", error);
    return NextResponse.json({ error: "Unable to start inventory." }, { status: 500 });
  }
}
