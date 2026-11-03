import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { deleteStoreProductImage, readStoreProductImage, saveStoreProductImage } from "@/lib/store-files";
import { getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid product id." }, { status: 400 });
  try {
    const key = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.product.read", store.id);
      const result = await client.query<{ image_path: string | null }>(
        "SELECT image_path FROM products WHERE id = $1 AND entity_id = $2 AND status = 'active'",
        [id, store.id],
      );
      if (!result.rowCount) throw new StorePolicyError("Product not found.", 404);
      if (!result.rows[0].image_path) throw new StorePolicyError("Product image not found.", 404);
      return result.rows[0].image_path;
    });
    const image = await readStoreProductImage(key);
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof StorePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to load Store product image.", error);
    return NextResponse.json({ error: "Unable to load product image." }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid product id." }, { status: 400 });

  let uploaded: Awaited<ReturnType<typeof saveStoreProductImage>>;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "An image file is required." }, { status: 400 });
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.product.manage", store.id);
      const product = await client.query(
        "SELECT 1 FROM products WHERE id=$1 AND entity_id=$2",
        [id, store.id],
      );
      if (!product.rowCount) throw new StorePolicyError("Product not found.", 404);
    });
    uploaded = await saveStoreProductImage(file);
  } catch (error) {
    if (error instanceof StorePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to process the image." },
      { status: 400 },
    );
  }

  let oldKey: string | null = null;
  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.product.manage", store.id);
      const result = await client.query<{ image_path: string | null }>(
        "UPDATE products SET image_path = $3 WHERE id = $1 AND entity_id = $2 RETURNING image_path",
        [id, store.id, uploaded.key],
      );
      if (!result.rowCount) throw new StorePolicyError("Product not found.", 404);
      oldKey = result.rows[0].image_path;
    });
  } catch (error) {
    await deleteStoreProductImage(uploaded.key).catch((cleanupError) => {
      console.error("Unable to remove an unreferenced Store product image.", cleanupError);
    });
    if (error instanceof StorePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to save Store product image.", error);
    return NextResponse.json({ error: "Unable to save product image." }, { status: 500 });
  }

  if (oldKey && oldKey !== uploaded.key) {
    await deleteStoreProductImage(oldKey).catch((error) => {
      console.error("Unable to remove a replaced Store product image.", error);
    });
  }
  return NextResponse.json({ success: true });
}
