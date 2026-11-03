import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

class BadgePolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.users.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid badge." }, { status: 400 });
  const parsed = z.object({ isActive: z.boolean() }).strict()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid badge status." }, { status: 400 });

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const badge = await client.query<{ id: string }>(
        "SELECT id FROM authorized_badges WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!badge.rowCount) throw new BadgePolicyError("Badge not found.", 404);
      if (!parsed.data.isActive) {
        const pending = await client.query(
          `SELECT 1 FROM account_registration_requests
           WHERE badge_id = $1 AND status IN ('otp_pending', 'pending_approval')
           LIMIT 1`,
          [id],
        );
        if (pending.rowCount) {
          throw new BadgePolicyError("Resolve the pending registration before deactivating this badge.", 409);
        }
      }
      await client.query("UPDATE authorized_badges SET is_active = $2 WHERE id = $1", [id, parsed.data.isActive]);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BadgePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to update authorized badge.", error);
    return NextResponse.json({ error: "Unable to update authorized badge." }, { status: 500 });
  }
}
