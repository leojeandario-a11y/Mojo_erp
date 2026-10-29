import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: z.array(z.string().min(1).max(120)).max(100)
    .refine((codes) => new Set(codes).size === codes.length),
});

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.roles.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const roles = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
    const result = await client.query(
      `SELECT r.id, r.code, r.name, r.description, r.is_system,
              COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       GROUP BY r.id
       ORDER BY r.name`,
    );
    const permissions = await client.query("SELECT code, module FROM permissions ORDER BY module, code");
    return { roles: result.rows, permissions: permissions.rows };
  });
  return NextResponse.json(roles);
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.roles.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const parsed = createRoleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid role details." }, { status: 400 });
  if (parsed.data.permissions.includes("*")) {
    return NextResponse.json({ error: "The universal permission is reserved for the Super Administrator." }, { status: 400 });
  }
  if (!actor.permissions.includes("*") && parsed.data.permissions.some((permission) => !actor.permissions.includes(permission))) {
    return NextResponse.json({ error: "You cannot grant permissions you do not hold." }, { status: 403 });
  }

  try {
    const roleId = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO roles(code, name, description, is_system)
         VALUES ($1, $2, $3, false)
         RETURNING id`,
        [`custom_${parsed.data.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 54) || "role"}`, parsed.data.name, parsed.data.description ?? null],
      );
      const roleId = inserted.rows[0].id;
      if (parsed.data.permissions.length) {
        const permissions = await client.query(
          `INSERT INTO role_permissions(role_id, permission_id)
           SELECT $1, p.id FROM permissions p WHERE p.code = ANY($2::text[])
           RETURNING permission_id`,
          [roleId, parsed.data.permissions],
        );
        if (permissions.rowCount !== parsed.data.permissions.length) {
          throw new Error("One or more selected permissions do not exist.");
        }
      }
      return roleId;
    });
    return NextResponse.json({ id: roleId }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A role with this name already exists." }, { status: 409 });
    }
    console.error("Unable to create role.", error);
    return NextResponse.json({ error: "Unable to create role." }, { status: 500 });
  }
}
