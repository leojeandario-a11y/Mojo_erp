import { randomBytes } from "node:crypto";
import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { getPool, requestIp } from "@/lib/db";

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid email or password." }, { status: 400 });

  const client = await getPool().connect();
  const ip = requestIp(request.headers);
  try {
    await client.query("BEGIN");
    const settings = await client.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM app_settings
       WHERE key IN ('session_ttl_minutes', 'max_failed_logins')`,
    );
    const config = Object.fromEntries(settings.rows.map((row) => [row.key, Number(row.value)]));
    const ttlMinutes = config.session_ttl_minutes;
    const maxFailedLogins = config.max_failed_logins;
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || !Number.isInteger(maxFailedLogins) || maxFailedLogins < 1) {
      throw new Error("Required authentication settings are missing or invalid.");
    }

    const result = await client.query<{
      id: string;
      password_hash: string;
      is_active: boolean;
      failed_logins: number;
      locked_until: Date | null;
    }>(
      `SELECT id, password_hash, is_active, failed_logins, locked_until
       FROM users WHERE email = $1 FOR UPDATE`,
      [parsed.data.email],
    );
    const user = result.rows[0];

    if (!user || !user.is_active || (user.locked_until && user.locked_until > new Date())) {
      await client.query("SELECT set_config('app.ip', $1, true)", [ip ?? ""]);
      await client.query("SELECT log_auth_event('LOGIN_FAILED', 'denied', 'Invalid credentials')");
      await client.query("COMMIT");
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.ip', $2, true)",
      [user.id, ip ?? ""],
    );
    const passwordMatches = await compare(parsed.data.password, user.password_hash);
    if (!passwordMatches) {
      const failedLogins = user.failed_logins + 1;
      await client.query(
        `UPDATE users
         SET failed_logins = $2,
             locked_until = CASE WHEN $2 >= $3 THEN now() + interval '15 minutes' ELSE locked_until END
         WHERE id = $1`,
        [user.id, failedLogins, maxFailedLogins],
      );
      await client.query("SELECT set_config('app.ip', $1, true)", [ip ?? ""]);
      await client.query("SELECT log_auth_event('LOGIN_FAILED', 'denied', 'Invalid credentials')");
      await client.query("COMMIT");
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token);
    await client.query(
      "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1",
      [user.id],
    );
    await client.query(
      `INSERT INTO user_sessions(user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 minute'))`,
      [user.id, tokenHash, ip, request.headers.get("user-agent"), ttlMinutes],
    );
    await client.query("SELECT log_auth_event('LOGIN', 'success', NULL)");
    await client.query("COMMIT");

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: ttlMinutes * 60,
    });
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Login failed because of a server error.", error);
    return NextResponse.json({ error: "Unable to sign in right now." }, { status: 500 });
  } finally {
    client.release();
  }
}
