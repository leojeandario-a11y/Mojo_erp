import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { parseCsv } from "@/lib/store-csv.mjs";
import { getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

const rowSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().max(120).nullable(),
  name: z.string().trim().min(2).max(180),
  category: z.string().trim().max(100).nullable(),
  supplier: z.string().trim().max(180).nullable(),
  purchasePrice: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/),
  salePrice: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/),
  currency: z.enum(["HTG", "USD"]),
  minStock: z.number().int().min(0).max(1_000_000),
});

const requiredColumns = [
  "sku", "name", "sale_price", "price_currency",
];

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  let records: z.infer<typeof rowSchema>[];
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLocaleLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Choose a CSV file." }, { status: 400 });
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "CSV files must be between 1 byte and 5 MB." }, { status: 400 });
    }
    const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
    if (rows.length < 2) return NextResponse.json({ error: "CSV must include a header and at least one product." }, { status: 400 });
    if (rows.length > 1001) return NextResponse.json({ error: "Import is limited to 1,000 products per file." }, { status: 400 });
    const headers = rows[0].map((header) => header.trim().toLocaleLowerCase());
    if (new Set(headers).size !== headers.length || requiredColumns.some((column) => !headers.includes(column))) {
      return NextResponse.json({ error: "CSV headers must include unique sku, name, sale_price, and price_currency columns." }, { status: 400 });
    }
    const index = Object.fromEntries(headers.map((header, position) => [header, position]));
    const issues: string[] = [];
    records = rows.slice(1).map((cells, rowIndex) => {
      const get = (column: string) => cells[index[column] ?? -1]?.trim() ?? "";
      const result = rowSchema.safeParse({
        sku: get("sku"),
        barcode: get("barcode") || null,
        name: get("name"),
        category: get("category") || null,
        supplier: get("supplier") || null,
        purchasePrice: get("purchase_price") || "0",
        salePrice: get("sale_price"),
        currency: get("price_currency").toUpperCase(),
        minStock: Number(get("min_stock") || "0"),
      });
      if (!result.success) issues.push(`Row ${rowIndex + 2}: invalid product fields.`);
      return result.success ? result.data : null;
    }).filter((record): record is z.infer<typeof rowSchema> => record !== null);
    if (issues.length) return NextResponse.json({ error: "Import contains invalid rows.", issues: issues.slice(0, 50) }, { status: 400 });
    if (new Set(records.map(({ sku }) => sku.toLocaleLowerCase())).size !== records.length) {
      return NextResponse.json({ error: "The CSV contains duplicate SKUs." }, { status: 400 });
    }
    const barcodes = records.flatMap(({ barcode }) => barcode ? [barcode.toLocaleLowerCase()] : []);
    if (new Set(barcodes).size !== barcodes.length) {
      return NextResponse.json({ error: "The CSV contains duplicate barcodes." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `Unable to parse CSV: ${error.message}` : "Unable to parse CSV." },
      { status: 400 },
    );
  }

  try {
    const count = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.product.manage", store.id);
      for (const record of records) {
        const categoryResult = record.category
          ? await client.query<{ id: string }>(
            "SELECT id FROM product_categories WHERE lower(name)=lower($1) AND is_active",
            [record.category],
          )
          : null;
        if (record.category && !categoryResult?.rowCount) {
          throw new StorePolicyError(`Category "${record.category}" does not exist. Create it before importing.`, 400);
        }
        const supplierResult = record.supplier
          ? await client.query<{ id: string }>("SELECT id FROM suppliers WHERE lower(name)=lower($1)", [record.supplier])
          : null;
        if (record.supplier && !supplierResult?.rowCount) {
          throw new StorePolicyError(`Supplier "${record.supplier}" does not exist.`, 400);
        }
        await client.query(
          `INSERT INTO products(
             entity_id, sku, barcode, name, category_id, supplier_id,
             purchase_price, sale_price, price_currency, min_stock
           )
           VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7::numeric, $8::numeric, $9, $10)`,
          [
            store.id, record.sku, record.barcode, record.name,
            categoryResult?.rows[0]?.id ?? null, supplierResult?.rows[0]?.id ?? null,
            record.purchasePrice, record.salePrice, record.currency, record.minStock,
          ],
        );
      }
      return records.length;
    });
    return NextResponse.json({ imported: count }, { status: 201 });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Import was not applied: one or more SKUs or barcodes already exist." }, { status: 409 });
    }
    console.error("Unable to import Store products.", error);
    return NextResponse.json({ error: "Unable to import products." }, { status: 500 });
  }
}
