import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordResetUrl, getAppBaseUrl } from "@/lib/email";
import { getSession, hashToken, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.users.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid user." }, { status: 400 });

  try {
    getAppBaseUrl();
  } catch (error) {
    console.error("Unable to generate an admin password-reset link.", error);
    return NextResponse.json({ error: "The application base URL is not configured." }, { status: 503 });
  }

  const token = randomBytes(32).toString("base64url");
  try {
    const user = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{ locale: "fr" | "ht" | "en" }>(
        "SELECT locale FROM users WHERE id = $1 AND is_active FOR UPDATE",
        [id],
      );
      if (!result.rowCount) return null;
      await client.query(
        "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
        [id],
      );
      await client.query(
        "INSERT INTO password_reset_tokens(user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [id, hashToken(token)],
      );
      await client.query(
        "SELECT log_auth_event('ADMIN_PASSWORD_RESET_LINK', 'success', $1)",
        [`User ${id}`],
      );
      return result.rows[0];
    });
    if (!user) return NextResponse.json({ error: "Active user not found." }, { status: 404 });
    return NextResponse.json({ url: createPasswordResetUrl(token, user.locale).href, expiresInSeconds: 3600 });
  } catch (error) {
    console.error("Unable to generate an admin password-reset link.", error);
    return NextResponse.json({ error: "Unable to generate the password-reset link." }, { status: 500 });
  }
}
