import { randomInt } from "node:crypto";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashToken } from "@/lib/auth";
import { getPool, requestIp } from "@/lib/db";
import { sendRegistrationOtpEmail, validatePasswordResetEmailConfig } from "@/lib/email";

const schema = z.object({
  fullName: z.string().trim().normalize("NFKC").min(2).max(160),
  email: z.email().max(254),
  departmentId: z.uuid(),
  badgeId: z.string().trim().normalize("NFKC").regex(/^[A-Z]{3}-[A-Z]{3}-\d{8}$/i),
  password: z.string().min(12).max(128),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the required registration information." }, { status: 400 });
  const normalizedBadge = parsed.data.badgeId.toUpperCase().replace(/[\s-]+/g, "");

  try {
    validatePasswordResetEmailConfig();
  } catch {
    return NextResponse.json({ error: "Email verification is temporarily unavailable." }, { status: 503 });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.ip', $1, true)", [requestIp(request.headers) ?? ""]);
    const badge = (await client.query<{
      id: string;
      full_name: string;
      department_id: string;
      badge_id: string;
    }>(
      `SELECT id, full_name, department_id, badge_id FROM authorized_badges
       WHERE upper(replace(replace(badge_id, '-', ''), ' ', '')) = $1
         AND is_active FOR UPDATE`,
      [normalizedBadge],
    )).rows[0];
    if (!badge || badge.department_id !== parsed.data.departmentId ||
        badge.full_name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase() !==
        parsed.data.fullName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "The badge information does not match an authorized card." }, { status: 400 });
    }

    const existingUser = await client.query("SELECT 1 FROM users WHERE email = $1", [parsed.data.email]);
    if (existingUser.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "An account already uses this email address." }, { status: 409 });
    }
    await client.query("DELETE FROM account_registration_requests WHERE badge_id = $1 AND status IN ('expired')", [badge.id]);
    const otp = String(randomInt(100000, 1000000));
    await client.query(
      `INSERT INTO account_registration_requests
       (badge_id, full_name, email, department_id, password_hash, otp_hash, otp_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + interval '10 minutes')`,
      [badge.id, parsed.data.fullName, parsed.data.email, badge.department_id, await hash(parsed.data.password, 12), hashToken(otp)],
    );
    await client.query("COMMIT");
    await sendRegistrationOtpEmail(parsed.data.email, parsed.data.fullName, otp, "fr");
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    await client.query("ROLLBACK");
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "This badge or email already has a registration request." }, { status: 409 });
    }
    console.error("Unable to start account registration.", error);
    return NextResponse.json({ error: "Unable to start account registration." }, { status: 500 });
  } finally {
    client.release();
  }
}
