import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const updateDepartmentSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_-]{2,20}$/).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  headUserId: z.uuid().nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined));

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.config.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid department." }, { status: 400 });
  const parsed = updateDepartmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid department details." }, { status: 400 });
  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const current = await client.query<{ head_user_id: string | null }>(
        "SELECT head_user_id FROM departments WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!current.rowCount) throw new Error("Department not found.");
      if (parsed.data.headUserId && parsed.data.headUserId !== current.rows[0].head_user_id) {
        const head = await client.query("SELECT 1 FROM users WHERE id = $1 AND is_active", [parsed.data.headUserId]);
        if (!head.rowCount) throw new Error("Department head must be an active user.");
      }
      const result = await client.query(
        `UPDATE departments SET
           code = COALESCE($2, code),
           name = COALESCE($3, name),
           color = CASE WHEN $4 THEN $5 ELSE color END,
           head_user_id = CASE WHEN $6 THEN $7::uuid ELSE head_user_id END,
           is_active = COALESCE($8, is_active)
         WHERE id = $1`,
        [
          id,
          parsed.data.code ?? null,
          parsed.data.name ?? null,
          parsed.data.color !== undefined,
          parsed.data.color ?? null,
          parsed.data.headUserId !== undefined,
          parsed.data.headUserId ?? null,
          parsed.data.isActive ?? null,
        ],
      );
      if (!result.rowCount) throw new Error("Department not found.");
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A department with this code already exists." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "Department head must be an active user.") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Department not found.") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Unable to update department.", error);
    return NextResponse.json({ error: "Unable to update department." }, { status: 500 });
  }
}
