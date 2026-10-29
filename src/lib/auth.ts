import "server-only";
import { createHash } from "node:crypto";
import { cookies, headers as nextHeaders } from "next/headers";
import { getPool, requestIp, withDbUser } from "@/lib/db";
export { hasPermission } from "@/lib/permissions";

export const SESSION_COOKIE = "mojo_session";
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export type Locale = "fr" | "ht" | "en";
export type DisplayCurrency = "HTG" | "USD";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  department: string | null;
  locale: Locale;
  displayCurrency: DisplayCurrency;
  roles: string[];
  permissions: string[];
  entityPermissions: Record<string, string[]>;
  sessionId: string;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const hashToken = hashSessionToken;

export async function getSession(requestHeaders?: Headers): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashSessionToken(token);

  try {
    const lookup = await getPool().query<{ user_id: string }>(
      `SELECT user_id FROM user_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    const userId = lookup.rows[0]?.user_id;
    if (!userId) return null;

    const currentHeaders = requestHeaders ?? await nextHeaders();
    return await withDbUser(userId, requestIp(currentHeaders), async (client) => {
      const sessionResult = await client.query<{
        session_id: string;
        id: string;
        email: string;
        full_name: string;
        department: string | null;
        locale: Locale;
        display_currency: DisplayCurrency;
      }>(
        `SELECT s.id AS session_id, u.id, u.email::text, u.full_name, d.name AS department,
                u.locale, u.display_currency
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE s.token_hash = $1 AND s.user_id = $2
           AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active`,
        [tokenHash, userId],
      );
      const user = sessionResult.rows[0];
      if (!user) return null;

      const accessResult = await client.query<{ roles: string[]; permissions: string[] }>(
        `SELECT
           COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), ARRAY[]::text[]) AS roles,
           COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL AND ur.entity_id IS NULL), ARRAY[]::text[]) AS permissions
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = $1
         GROUP BY ur.user_id`,
        [userId],
      );
      const entityAccessResult = await client.query<{ entity_id: string; permissions: string[] }>(
        `SELECT ur.entity_id,
                COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = $1 AND ur.entity_id IS NOT NULL
         GROUP BY ur.entity_id`,
        [userId],
      );
      const entityPermissions = Object.fromEntries(
        entityAccessResult.rows.map((row) => [row.entity_id, row.permissions]),
      );
      return {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        department: user.department,
        locale: user.locale,
        displayCurrency: user.display_currency,
        roles: accessResult.rows[0]?.roles ?? [],
        permissions: accessResult.rows[0]?.permissions ?? [],
        entityPermissions,
        sessionId: user.session_id,
      };
    });
  } catch (error) {
    console.error("Unable to resolve authenticated session.", error);
    throw error;
  }
}
