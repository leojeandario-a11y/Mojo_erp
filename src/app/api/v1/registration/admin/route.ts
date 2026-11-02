import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { getPool, requestIp, withDbUser } from "@/lib/db";

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor || !hasPermission(actor, "settings.users.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
    const [requests, badges, roles] = await Promise.all([
      client.query(
        `SELECT r.id, r.full_name, r.email::text, r.status, r.created_at, r.otp_verified_at,
                d.name AS department, b.badge_id
         FROM account_registration_requests r
         JOIN departments d ON d.id = r.department_id
         JOIN authorized_badges b ON b.id = r.badge_id
         WHERE r.status IN ('pending_approval', 'approved', 'rejected')
         ORDER BY r.created_at DESC`,
      ),
      client.query(
        `SELECT b.id, b.badge_id, b.full_name, b.job_title, b.is_active, d.name AS department
         FROM authorized_badges b JOIN departments d ON d.id = b.department_id
         ORDER BY b.full_name`,
      ),
      client.query("SELECT code, name FROM roles WHERE code <> 'super_admin' OR $1 ORDER BY name", [
        actor.permissions.includes("*"),
      ]),
    ]);
    return { requests: requests.rows, badges: badges.rows, roles: roles.rows };
  });
  return NextResponse.json(data);
}

const badgeSchema = z.object({
  badgeId: z.string().trim().regex(/^[A-Za-z]{3}-[A-Za-z]{3}-\d{8}$/),
  fullName: z.string().trim().min(2).max(160),
  jobTitle: z.string().trim().max(160).nullable().optional(),
  departmentId: z.uuid(),
  isActive: z.boolean().optional(),
});

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor || !hasPermission(actor, "settings.users.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const parsed = badgeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid badge details." }, { status: 400 });
  try {
    const normalized = parsed.data.badgeId.toUpperCase();
    const result = await getPool().query<{ id: string }>(
      `INSERT INTO authorized_badges(badge_id, full_name, job_title, department_id, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [normalized, parsed.data.fullName, parsed.data.jobTitle ?? null, parsed.data.departmentId, parsed.data.isActive ?? true],
    );
    return NextResponse.json({ id: result.rows[0].id }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "This badge ID is already registered." }, { status: 409 });
    }
    console.error("Unable to register authorized badge.", error);
    return NextResponse.json({ error: "Unable to register badge." }, { status: 500 });
  }
}
