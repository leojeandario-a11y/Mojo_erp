import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const createUserSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.email().max(254),
  password: z.string().min(12).max(128),
  departmentId: z.uuid().nullable().optional(),
  roleCodes: z.array(z.string().min(1).max(60)).min(1).max(30).optional(),
  roleAssignments: z.array(z.object({
    roleCode: z.string().min(1).max(60),
    entityId: z.uuid().nullable(),
  })).min(1).max(30).optional(),
}).refine((data) => Boolean(data.roleCodes) !== Boolean(data.roleAssignments))
  .refine((data) => {
    const assignments = data.roleAssignments ?? data.roleCodes?.map((roleCode) => ({ roleCode, entityId: null })) ?? [];
    return new Set(assignments.map(({ roleCode, entityId }) => `${roleCode}:${entityId ?? "global"}`)).size === assignments.length;
  });

class UserPolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.users.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const [users, departments, roles, entities] = await Promise.all([
        client.query(
          `SELECT u.id, u.full_name, u.email::text, u.is_active, u.department_id, d.name AS department,
                  COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                    'roleCode', r.code, 'entityId', ur.entity_id, 'entityName', e.name
                  )) FILTER (WHERE r.code IS NOT NULL), '[]'::jsonb) AS role_assignments
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id
           LEFT JOIN user_roles ur ON ur.user_id = u.id
           LEFT JOIN roles r ON r.id = ur.role_id
           LEFT JOIN entities e ON e.id = ur.entity_id
           GROUP BY u.id, d.name
           ORDER BY u.full_name`,
        ),
        client.query("SELECT id, name, is_active FROM departments ORDER BY name"),
        client.query(
          "SELECT code, name FROM roles WHERE $1 OR code <> 'super_admin' ORDER BY name",
          [actor.permissions.includes("*")],
        ),
        client.query("SELECT id, name FROM entities WHERE is_active ORDER BY name"),
      ]);
      return { users: users.rows, departments: departments.rows, roles: roles.rows, entities: entities.rows };
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unable to load users.", error);
    return NextResponse.json({ error: "Unable to load users." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.users.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the user details and password requirements." }, { status: 400 });
  const assignments = parsed.data.roleAssignments
    ?? parsed.data.roleCodes?.map((roleCode) => ({ roleCode, entityId: null }))
    ?? [];
  if (assignments.some(({ roleCode, entityId }) => roleCode === "super_admin" && entityId !== null)) {
    return NextResponse.json({ error: "The Super Administrator role cannot be entity-scoped." }, { status: 400 });
  }
  if (assignments.some(({ roleCode }) => roleCode === "super_admin") && !actor.permissions.includes("*")) {
    return NextResponse.json({ error: "Only a Super Administrator can grant that role." }, { status: 403 });
  }
  const passwordHash = await hash(parsed.data.password, 12);

  try {
    const created = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(1196245321, 1)");
      const roleCodes = [...new Set(assignments.map(({ roleCode }) => roleCode))];
      const availableRoles = await client.query<{ code: string; id: string }>(
        "SELECT id, code FROM roles WHERE code = ANY($1::text[])",
        [roleCodes],
      );
      if (availableRoles.rowCount !== roleCodes.length) {
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
      const availableEntities = entityIds.length
        ? await client.query("SELECT id FROM entities WHERE id = ANY($1::uuid[]) AND is_active", [entityIds])
        : { rowCount: 0 };
      if (availableEntities.rowCount !== entityIds.length) {
        throw new UserPolicyError("One or more selected entities do not exist.", 400);
      }
      if (parsed.data.departmentId) {
        const department = await client.query(
          "SELECT 1 FROM departments WHERE id = $1 AND is_active",
          [parsed.data.departmentId],
        );
        if (!department.rowCount) throw new UserPolicyError("Selected department is unavailable.", 400);
      }
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users(full_name, email, password_hash, department_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [parsed.data.fullName, parsed.data.email, passwordHash, parsed.data.departmentId ?? null],
      );
      const userId = userResult.rows[0].id;
      for (const assignment of assignments) {
        const roleId = availableRoles.rows.find((role) => role.code === assignment.roleCode)?.id;
        if (!roleId) throw new UserPolicyError("Selected role is unavailable.", 400);
        await client.query(
          `INSERT INTO user_roles(user_id, role_id, entity_id, granted_by)
           VALUES ($1, $2, $3, $4)`,
          [userId, roleId, assignment.entityId, actor.id],
        );
      }
      return userId;
    });
    return NextResponse.json({ id: created }, { status: 201 });
  } catch (error) {
    if (error instanceof UserPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to create user.", error);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Email address is already in use." }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to create user." }, { status: 500 });
  }
}
