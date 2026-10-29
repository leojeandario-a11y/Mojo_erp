import { NextResponse } from "next/server";
import { getSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

export async function POST(request: Request) {
  const user = await getSession(request.headers);
  if (user) {
    await withDbUser(user.id, requestIp(request.headers), async (client) => {
      await client.query("UPDATE user_sessions SET revoked_at = now() WHERE id = $1", [user.sessionId]);
      await client.query("SELECT log_auth_event('LOGOUT', 'success', NULL)");
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
