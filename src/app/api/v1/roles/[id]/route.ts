import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable(),
  permissions: z.array(z.string().min(1).max(120)).max(100)
    .refine((codes) => new Set(codes).size === codes.length),
});

class RolePolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.roles.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  const parsed = updateRoleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid role details." }, { status: 400 });

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const roleResult = await client.query<{ code: string }>("SELECT code FROM roles WHERE id = $1 FOR UPDATE", [id]);
      const role = roleResult.rows[0];
      if (!role) throw new RolePolicyError("Role not found.", 404);
      if (role.code === "super_admin") {
        throw new RolePolicyError("The Super Administrator role is immutable.", 400);
      }
      if (!actor.permissions.includes("*") && parsed.data.permissions.some((permission) => !actor.permissions.includes(permission))) {
        throw new RolePolicyError("You cannot grant permissions you do not hold.", 403);
      }
      if (parsed.data.permissions.includes("*") && role.code !== "super_admin") {
        throw new RolePolicyError("The universal permission can only be assigned to the Super Administrator role.", 400);
      }
      if (role.code === "super_admin" && !parsed.data.permissions.includes("*")) {
        throw new RolePolicyError("The Super Administrator role must retain its universal permission.", 400);
      }
      await client.query("UPDATE roles SET name = $2, description = $3 WHERE id = $1", [
        id,
        parsed.data.name,
        parsed.data.description,
      ]);
      await client.query("DELETE FROM role_permissions WHERE role_id = $1", [id]);
      const inserted = await client.query(
        `INSERT INTO role_permissions(role_id, permission_id)
         SELECT $1, p.id FROM permissions p WHERE p.code = ANY($2::text[])
         RETURNING permission_id`,
        [id, parsed.data.permissions],
      );
      if (inserted.rowCount !== parsed.data.permissions.length) {
        throw new RolePolicyError("One or more selected permissions do not exist.", 400);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RolePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to update role.", error);
    return NextResponse.json({ error: "Unable to update role." }, { status: 500 });
  }
}
