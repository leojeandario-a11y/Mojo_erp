import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashToken } from "@/lib/auth";
import { sendPasswordResetEmail, validatePasswordResetEmailConfig } from "@/lib/email";
import { getPool, requestIp } from "@/lib/db";

const requestSchema = z.object({ email: z.email().max(254) });
const responseMessage = "If an active account matches this address, a reset link will be sent.";

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  try {
    validatePasswordResetEmailConfig();
  } catch (error) {
    console.error("Password-reset email is not configured.", error);
    return NextResponse.json({ error: "Email password reset is not configured." }, { status: 503 });
  }

  const ipAddress = requestIp(request.headers);
  const client = await getPool().connect();
  let email: string | null = null;
  let fullName = "";
  let locale: "fr" | "ht" | "en" = "fr";
  let token = "";
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.ip', $1, true)", [ipAddress ?? ""]);
    const attempts = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs
       WHERE module = 'auth'
         AND action IN ('PASSWORD_RESET_REQUEST', 'PASSWORD_RESET')
         AND ip_address IS NOT DISTINCT FROM $1
         AND occurred_at >= now() - interval '15 minutes'`,
      [ipAddress],
    );
    if (Number(attempts.rows[0].count) >= 10) {
      await client.query("SELECT log_auth_event('PASSWORD_RESET_REQUEST', 'denied', NULL)");
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, message: responseMessage }, { status: 202 });
    }

    const userResult = await client.query<{ id: string; email: string; full_name: string; locale: "fr" | "ht" | "en" }>(
      "SELECT id, email::text, full_name, locale FROM users WHERE email = $1 AND is_active FOR UPDATE",
      [parsed.data.email],
    );
    const user = userResult.rows[0];
    await client.query("SELECT log_auth_event('PASSWORD_RESET_REQUEST', 'success', NULL)");

    if (user) {
      const recentTokens = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM password_reset_tokens
         WHERE user_id = $1 AND created_at >= now() - interval '15 minutes'`,
        [user.id],
      );
      if (Number(recentTokens.rows[0].count) < 3) {
        token = randomBytes(32).toString("base64url");
        await client.query(
          "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
          [user.id],
        );
        await client.query(
          `INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + interval '1 hour')`,
          [user.id, hashToken(token)],
        );
        email = user.email;
        fullName = user.full_name;
        locale = user.locale;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Unable to create a password-reset request.", error);
    return NextResponse.json({ error: "Unable to process the password-reset request." }, { status: 500 });
  } finally {
    client.release();
  }

  if (email && token) {
    try {
      await sendPasswordResetEmail(email, fullName, token, locale);
    } catch (error) {
      console.error("Unable to deliver a password-reset email.", error);
      try {
        const cleanup = await getPool().query(
          "UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL",
          [hashToken(token)],
        );
        if (!cleanup.rowCount) console.error("The undelivered password-reset token could not be invalidated.");
      } catch (cleanupError) {
        console.error("Unable to invalidate the undelivered password-reset token.", cleanupError);
      }
    }
  }

  return NextResponse.json({ ok: true, message: responseMessage }, { status: 202 });
}
