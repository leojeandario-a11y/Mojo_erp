import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

const discountLimitSchema = z.object({
  roleId: z.uuid(),
  maxPercent: z.number().min(0).max(100),
}).strict();

export async function PUT(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = discountLimitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid discount limit." }, { status: 400 });
  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.pos.configure", store.id);
      const role = await client.query("SELECT 1 FROM roles WHERE id=$1", [parsed.data.roleId]);
      if (!role.rowCount) throw new StorePolicyError("Role not found.", 404);
      await client.query(
        `INSERT INTO store_discount_limits(role_id,max_percent,updated_by,updated_at)
         VALUES ($1,$2::numeric,$3,now())
         ON CONFLICT (role_id) DO UPDATE
         SET max_percent=EXCLUDED.max_percent,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [parsed.data.roleId, parsed.data.maxPercent, actor.id],
      );
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to configure Store discount limit.", error);
    return NextResponse.json({ error: "Unable to configure Store discount limit." }, { status: 500 });
  }
}
