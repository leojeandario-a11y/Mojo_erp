import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashToken } from "@/lib/auth";
import { getPool, requestIp } from "@/lib/db";

const resetSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(12).max(128),
});

export async function POST(request: Request) {
  const parsed = resetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });

  const client = await getPool().connect();
  try {
    const tokenResult = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [hashToken(parsed.data.token)],
    );
    const resetToken = tokenResult.rows[0];
    if (!resetToken) {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.ip', $1, true)", [requestIp(request.headers) ?? ""]);
      await client.query("SELECT log_auth_event('PASSWORD_RESET', 'denied', NULL)");
      await client.query("COMMIT");
      return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
    }

    const passwordHash = await hash(parsed.data.password, 12);
    await client.query("BEGIN");
    const lockedToken = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE id = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [resetToken.id, hashToken(parsed.data.token)],
    );
    if (!lockedToken.rows[0]) {
      await client.query("SELECT set_config('app.ip', $1, true)", [requestIp(request.headers) ?? ""]);
      await client.query("SELECT log_auth_event('PASSWORD_RESET', 'denied', NULL)");
      await client.query("COMMIT");
      return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
    }
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.ip', $2, true)",
      [lockedToken.rows[0].user_id, requestIp(request.headers) ?? ""],
    );
    await client.query("UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1", [
      lockedToken.rows[0].user_id,
      passwordHash,
    ]);
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [lockedToken.rows[0].id]);
    await client.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [
      lockedToken.rows[0].user_id,
    ]);
    await client.query("SELECT log_auth_event('PASSWORD_RESET', 'success', NULL)");
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Unable to reset account password.", error);
    return NextResponse.json({ error: "Unable to reset the password right now." }, { status: 500 });
  } finally {
    client.release();
  }
}
