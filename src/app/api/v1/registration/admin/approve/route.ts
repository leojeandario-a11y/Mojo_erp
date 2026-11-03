import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const schema = z.object({
  requestId: z.uuid(),
  roleCodes: z.array(z.string().min(1).max(60)).min(1).max(30),
});

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor || !hasPermission(actor, "settings.users.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Select at least one role." }, { status: 400 });
  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const registration = (await client.query<{
        id: string;
        full_name: string;
        email: string;
        department_id: string;
        password_hash: string;
        badge_id: string;
        otp_verified_at: Date | null;
      }>(
        `SELECT r.id, r.full_name, r.email::text, r.department_id, r.password_hash, r.badge_id, r.otp_verified_at
         FROM account_registration_requests r
         WHERE r.id = $1 AND r.status = 'pending_approval'
         FOR UPDATE`,
        [parsed.data.requestId],
      )).rows[0];
      if (!registration || !registration.otp_verified_at) throw new Error("Registration request unavailable.");
      const roles = await client.query<{ id: string; code: string }>(
        "SELECT id, code FROM roles WHERE code = ANY($1::text[])",
        [parsed.data.roleCodes],
      );
      if (roles.rowCount !== new Set(parsed.data.roleCodes).size) throw new Error("One or more roles are unavailable.");
      if (parsed.data.roleCodes.includes("super_admin") && !actor.permissions.includes("*")) {
        throw new Error("Only a Super Administrator can grant that role.");
      }

      const user = await client.query<{ id: string }>(
        `INSERT INTO users(full_name, email, password_hash, department_id, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [registration.full_name, registration.email, registration.password_hash, registration.department_id],
      );
      await client.query(
        "UPDATE authorized_badges SET user_id = $2 WHERE id = $1",
        [registration.badge_id, user.rows[0].id],
      );
      for (const role of roles.rows) {
        await client.query(
          `INSERT INTO user_roles(user_id, role_id, entity_id, granted_by)
           VALUES ($1, $2, NULL, $3)`,
          [user.rows[0].id, role.id, actor.id],
        );
      }
      await client.query(
        `UPDATE account_registration_requests
         SET status = 'approved', reviewed_by = $2, reviewed_at = now()
         WHERE id = $1`,
        [registration.id, actor.id],
      );
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("Unable to approve account registration.", error);
    if (error instanceof Error && /Registration request unavailable|roles are unavailable/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to approve registration." }, { status: 500 });
  }
}
