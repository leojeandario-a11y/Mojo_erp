import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const settingsSchema = z.object({
  reference_currency: z.enum(["HTG", "USD"]).optional(),
  default_display_currency: z.enum(["HTG", "USD"]).optional(),
  fiscal_year_start_month: z.number().int().min(1).max(12).optional(),
  session_ttl_minutes: z.number().int().min(1).max(43_200).optional(),
  max_failed_logins: z.number().int().min(1).max(20).optional(),
}).strict().refine((settings) => Object.keys(settings).length > 0);

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.config.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const result = await withDbUser(actor.id, requestIp(request.headers), async (client) =>
    client.query("SELECT key, value, description, updated_at FROM app_settings ORDER BY key"),
  );
  return NextResponse.json({ settings: result.rows });
}

export async function PATCH(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "settings.config.manage")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const parsed = z.object({ settings: settingsSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid application settings." }, { status: 400 });
  const descriptions: Record<string, string> = {
    reference_currency: "Devise de référence des consolidations",
    default_display_currency: "Devise d’affichage par défaut",
    fiscal_year_start_month: "Mois de début de l’exercice",
    session_ttl_minutes: "Durée de session en minutes",
    max_failed_logins: "Nombre maximal d’échecs de connexion",
  };
  await withDbUser(actor.id, requestIp(request.headers), async (client) => {
    for (const [key, value] of Object.entries(parsed.data.settings)) {
      await client.query(
        `INSERT INTO app_settings(key, value, description, updated_by)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, JSON.stringify(value), descriptions[key], actor.id],
      );
    }
  });
  return NextResponse.json({ ok: true });
}
