import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

const productSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().max(120).nullable(),
  name: z.string().trim().min(2).max(180),
  categoryId: z.uuid().nullable(),
  supplierId: z.uuid().nullable(),
  exhibitorId: z.uuid().nullable(),
  purchasePrice: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/),
  salePrice: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/),
  priceCurrency: z.enum(["HTG", "USD"]),
  minStock: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid product id." }, { status: 400 });
  const parsed = productSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid product details." }, { status: 400 });
  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.product.manage", store.id);
      if (parsed.data.categoryId) {
        const category = await client.query("SELECT 1 FROM product_categories WHERE id = $1 AND is_active", [parsed.data.categoryId]);
        if (!category.rowCount) throw new StorePolicyError("The selected category is unavailable.", 400);
      }
      if (parsed.data.supplierId) {
        const supplier = await client.query("SELECT 1 FROM suppliers WHERE id = $1", [parsed.data.supplierId]);
        if (!supplier.rowCount) throw new StorePolicyError("The selected supplier is unavailable.", 400);
      }
      if (parsed.data.exhibitorId) {
        const exhibitor = await client.query("SELECT 1 FROM exhibitors WHERE id = $1 AND status = 'active'", [parsed.data.exhibitorId]);
        if (!exhibitor.rowCount) throw new StorePolicyError("The selected exhibitor is unavailable.", 400);
      }
      const result = await client.query(
        `UPDATE products
         SET sku = $3, barcode = NULLIF($4, ''), name = $5, category_id = $6,
             supplier_id = $7, exhibitor_id = $8, purchase_price = $9::numeric,
             sale_price = $10::numeric, price_currency = $11, min_stock = $12,
             status = CASE WHEN $13 THEN 'active' ELSE 'inactive' END
         WHERE id = $1 AND entity_id = $2`,
        [
          id, store.id, parsed.data.sku, parsed.data.barcode, parsed.data.name,
          parsed.data.categoryId, parsed.data.supplierId, parsed.data.exhibitorId,
          parsed.data.purchasePrice, parsed.data.salePrice, parsed.data.priceCurrency,
          parsed.data.minStock, parsed.data.isActive,
        ],
      );
      if (!result.rowCount) throw new StorePolicyError("Product not found.", 404);
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof StorePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "SKU or barcode is already in use." }, { status: 409 });
    }
    console.error("Unable to update Store product.", error);
    return NextResponse.json({ error: "Unable to update Store product." }, { status: 500 });
  }
}
