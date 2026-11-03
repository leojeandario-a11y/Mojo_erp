import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  parentId: z.uuid().nullable().optional(),
}).strict();

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = categorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid category details." }, { status: 400 });
  try {
    const category = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.product.manage", store.id);
      if (parsed.data.parentId) {
        const parent = await client.query("SELECT 1 FROM product_categories WHERE id = $1 AND is_active", [parsed.data.parentId]);
        if (!parent.rowCount) throw new StorePolicyError("The parent category is unavailable.", 400);
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO product_categories(name, parent_id)
         VALUES ($1, $2) RETURNING id`,
        [parsed.data.name, parsed.data.parentId ?? null],
      );
      return result.rows[0];
    });
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof StorePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A category with this name already exists." }, { status: 409 });
    }
    console.error("Unable to create Store category.", error);
    return NextResponse.json({ error: "Unable to create Store category." }, { status: 500 });
  }
}
