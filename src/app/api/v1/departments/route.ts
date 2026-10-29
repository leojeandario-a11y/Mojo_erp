import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const departmentSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_-]{2,20}$/),
  name: z.string().trim().min(2).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  headUserId: z.uuid().nullable(),
});

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.config.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
    const [departments, users] = await Promise.all([
      client.query(
        `SELECT d.id, d.code, d.name, d.color, d.is_active, d.head_user_id, u.full_name AS head_name
         FROM departments d LEFT JOIN users u ON u.id = d.head_user_id
         ORDER BY d.name`,
      ),
      client.query("SELECT id, full_name FROM users WHERE is_active ORDER BY full_name"),
    ]);
    return { departments: departments.rows, users: users.rows };
  });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.config.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const parsed = departmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid department details." }, { status: 400 });
  try {
    const id = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      if (parsed.data.headUserId) {
        const head = await client.query("SELECT 1 FROM users WHERE id = $1 AND is_active", [parsed.data.headUserId]);
        if (!head.rowCount) throw new Error("Department head must be an active user.");
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO departments(code, name, color, head_user_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [parsed.data.code, parsed.data.name, parsed.data.color, parsed.data.headUserId],
      );
      return result.rows[0].id;
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A department with this code already exists." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "Department head must be an active user.") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Unable to create department.", error);
    return NextResponse.json({ error: "Unable to create department." }, { status: 500 });
  }
}
