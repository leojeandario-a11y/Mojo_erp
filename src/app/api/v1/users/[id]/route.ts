import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const updateUserSchema = z.object({
  isActive: z.boolean().optional(),
  departmentId: z.uuid().nullable().optional(),
  roleCodes: z.array(z.string().min(1).max(60)).min(1).max(30).optional(),
  roleAssignments: z.array(z.object({
    roleCode: z.string().min(1).max(60),
    entityId: z.uuid().nullable(),
  })).min(1).max(30).optional(),
}).refine((data) => !(data.roleCodes && data.roleAssignments))
  .refine((data) => {
    const assignments = data.roleAssignments ?? data.roleCodes?.map((roleCode) => ({ roleCode, entityId: null })) ?? [];
    return new Set(assignments.map(({ roleCode, entityId }) => `${roleCode}:${entityId ?? "global"}`)).size === assignments.length;
  })
  .refine((data) => data.isActive !== undefined || data.departmentId !== undefined || data.roleCodes !== undefined || data.roleAssignments !== undefined);

class UserPolicyError extends Error {
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
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid user." }, { status: 400 });
  const parsed = updateUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid user details." }, { status: 400 });
  if (id === actor.id && parsed.data.isActive === false) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
  }
  const assignments = parsed.data.roleAssignments
    ?? parsed.data.roleCodes?.map((roleCode) => ({ roleCode, entityId: null }));
  if (assignments?.some(({ roleCode, entityId }) => roleCode === "super_admin" && entityId !== null)) {
    return NextResponse.json({ error: "The Super Administrator role cannot be entity-scoped." }, { status: 400 });
  }
  if (assignments?.some(({ roleCode }) => roleCode === "super_admin") && !actor.permissions.includes("*")) {
    return NextResponse.json({ error: "Only a Super Administrator can grant that role." }, { status: 403 });
  }

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(1196245321, 1)");
      const target = await client.query<{ id: string }>("SELECT id FROM users WHERE id = $1 FOR UPDATE", [id]);
      if (!target.rowCount) throw new UserPolicyError("User not found.", 404);

      if (assignments) {
        const roleCodes = [...new Set(assignments.map(({ roleCode }) => roleCode))];
        const roles = await client.query(
          "SELECT code FROM roles WHERE code = ANY($1::text[])",
          [roleCodes],
        );
        if (roles.rowCount !== roleCodes.length) {
          throw new UserPolicyError("One or more selected roles do not exist.", 400);
        }
        const grantedPermissions = await client.query<{ code: string }>(
          `SELECT DISTINCT p.code FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
           WHERE r.code = ANY($1::text[])`,
          [roleCodes],
        );
        if (!actor.permissions.includes("*") && grantedPermissions.rows.some(({ code }) => !actor.permissions.includes(code))) {
          throw new UserPolicyError("You cannot assign a role with permissions you do not hold.", 403);
        }
        const entityIds = [...new Set(assignments.flatMap(({ entityId }) => entityId ? [entityId] : []))];
        if (entityIds.length) {
          const entities = await client.query(
            "SELECT id FROM entities WHERE id = ANY($1::uuid[]) AND is_active",
            [entityIds],
          );
          if (entities.rowCount !== entityIds.length) {
            throw new UserPolicyError("One or more selected entities do not exist.", 400);
          }
        }
        if (id === actor.id && actor.permissions.includes("*") && !assignments.some(({ roleCode, entityId }) => roleCode === "super_admin" && entityId === null)) {
          throw new UserPolicyError("Your Super Administrator role cannot be removed here.", 400);
        }
      }

      if (parsed.data.isActive === false || assignments?.some(({ roleCode, entityId }) => roleCode !== "super_admin" || entityId !== null)) {
        const currentlyAdmin = await client.query(
          `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = $1 AND r.code = 'super_admin'`,
          [id],
        );
        if (currentlyAdmin.rowCount && parsed.data.isActive !== true) {
          const count = await client.query<{ count: string }>(
            `SELECT count(DISTINCT u.id)::text AS count
             FROM users u JOIN user_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id
             WHERE u.is_active AND r.code = 'super_admin'`,
          );
          const removesLastAdmin = parsed.data.isActive === false
            || Boolean(assignments?.length && !assignments.some(({ roleCode, entityId }) => roleCode === "super_admin" && entityId === null));
          if (Number(count.rows[0].count) <= 1 && removesLastAdmin) {
            throw new UserPolicyError("The last active Super Administrator cannot be removed.", 400);
          }
        }
      }

      if (parsed.data.isActive !== undefined || parsed.data.departmentId !== undefined) {
        await client.query(
          `UPDATE users SET
             is_active = COALESCE($2, is_active),
             department_id = CASE WHEN $3 THEN $4::uuid ELSE department_id END
           WHERE id = $1`,
          [id, parsed.data.isActive ?? null, parsed.data.departmentId !== undefined, parsed.data.departmentId ?? null],
        );
      }
      if (parsed.data.isActive === false) {
        await client.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
      }
      if (assignments) {
        const roleCodes = [...new Set(assignments.map(({ roleCode }) => roleCode))];
        const roleRows = await client.query<{ id: string; code: string }>(
          "SELECT id, code FROM roles WHERE code = ANY($1::text[])",
          [roleCodes],
        );
        await client.query("DELETE FROM user_roles WHERE user_id = $1", [id]);
        for (const assignment of assignments) {
          const roleId = roleRows.rows.find((role) => role.code === assignment.roleCode)?.id;
          if (!roleId) throw new UserPolicyError("One or more selected roles do not exist.", 400);
          await client.query(
            "INSERT INTO user_roles(user_id, role_id, entity_id, granted_by) VALUES ($1, $2, $3, $4)",
            [id, roleId, assignment.entityId, actor.id],
          );
        }
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to update user.", error);
    return NextResponse.json({ error: "Unable to update user." }, { status: 500 });
  }
}
