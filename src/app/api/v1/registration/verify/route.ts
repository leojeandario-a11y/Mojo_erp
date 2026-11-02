import { NextResponse } from "next/server";
import { z } from "zod";
import { hashToken } from "@/lib/auth";
import { getPool, requestIp } from "@/lib/db";

const schema = z.object({
  email: z.email().max(254),
  otp: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the six-digit verification code." }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.ip', $1, true)", [requestIp(request.headers) ?? ""]);
    const registration = (await client.query<{
      id: string;
      otp_hash: string;
      otp_attempts: number;
      otp_expires_at: Date;
      status: string;
    }>(
      `SELECT id, otp_hash, otp_attempts, otp_expires_at, status
       FROM account_registration_requests
       WHERE lower(email::text) = lower($1)
         AND status = 'otp_pending'
       FOR UPDATE`,
      [parsed.data.email],
    )).rows[0];
    if (!registration || registration.otp_expires_at < new Date() || registration.otp_attempts >= 5) {
      if (registration) await client.query("UPDATE account_registration_requests SET status = 'expired' WHERE id = $1", [registration.id]);
      await client.query("COMMIT");
      return NextResponse.json({ error: "The verification code is invalid or has expired." }, { status: 400 });
    }
    if (registration.otp_hash !== hashToken(parsed.data.otp)) {
      await client.query(
        "UPDATE account_registration_requests SET otp_attempts = otp_attempts + 1 WHERE id = $1",
        [registration.id],
      );
      await client.query("COMMIT");
      return NextResponse.json({ error: "The verification code is invalid." }, { status: 400 });
    }
    await client.query(
      `UPDATE account_registration_requests
       SET otp_verified_at = now(), status = 'pending_approval'
       WHERE id = $1`,
      [registration.id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, message: "Verification complete. The super administrator must approve the account." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Unable to verify account registration.", error);
    return NextResponse.json({ error: "Unable to verify the code." }, { status: 500 });
  } finally {
    client.release();
  }
}
