import { compare, hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
}).refine((data) => data.currentPassword !== data.newPassword);

export async function POST(request: Request) {
  const user = await getSession(request.headers);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const parsed = changePasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the current password and new password requirements." }, { status: 400 });
  }

  try {
    const changed = await withDbUser(user.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE id = $1 AND is_active FOR UPDATE",
        [user.id],
      );
      const account = result.rows[0];
      if (!account || !(await compare(parsed.data.currentPassword, account.password_hash))) return null;

      const nextHash = await hash(parsed.data.newPassword, 12);
      await client.query("UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1", [
        user.id,
        nextHash,
      ]);
      await client.query(
        "UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        [user.id, user.sessionId],
      );
      return true;
    });

    if (!changed) {
      return NextResponse.json({ error: "The current password is incorrect." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to change account password.", error);
    return NextResponse.json({ error: "Unable to change the password right now." }, { status: 500 });
  }
}
