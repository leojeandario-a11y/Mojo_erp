import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  isActive: z.boolean(),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid category id." }, { status: 400 });
  const parsed = categorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid category details." }, { status: 400 });
  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.product.manage", store.id);
      const result = await client.query(
        "UPDATE product_categories SET name=$2,is_active=$3 WHERE id=$1",
        [id, parsed.data.name, parsed.data.isActive],
      );
      if (!result.rowCount) throw new StorePolicyError("Category not found.", 404);
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A category with this name already exists." }, { status: 409 });
    }
    console.error("Unable to update Store category.", error);
    return NextResponse.json({ error: "Unable to update Store category." }, { status: 500 });
  }
}
