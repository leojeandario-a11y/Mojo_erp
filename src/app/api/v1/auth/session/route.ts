import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { z } from "zod";

const preferencesSchema = z.object({
  locale: z.enum(["fr", "ht", "en"]).optional(),
  displayCurrency: z.enum(["HTG", "USD"]).optional(),
}).refine((data) => data.locale !== undefined || data.displayCurrency !== undefined);

export async function GET(request: Request) {
  const user = await getSession(request.headers);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return NextResponse.json({ user });
}

export async function PATCH(request: Request) {
  const user = await getSession(request.headers);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = preferencesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences." }, { status: 400 });

  await withDbUser(user.id, requestIp(request.headers), async (client) => {
    if (parsed.data.locale) {
      await client.query("UPDATE users SET locale = $2 WHERE id = $1", [user.id, parsed.data.locale]);
    }
    if (parsed.data.displayCurrency) {
      await client.query("UPDATE users SET display_currency = $2 WHERE id = $1", [
        user.id,
        parsed.data.displayCurrency,
      ]);
    }
  });
  return NextResponse.json({ ok: true });
}
