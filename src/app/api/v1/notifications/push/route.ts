import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { getWebPushPublicKey } from "@/lib/web-push";

const subscriptionSchema = z.object({
  endpoint: z.url().max(2048).refine((value) => value.startsWith("https://")),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
  }).strict(),
}).strict();

const removeSchema = z.object({
  endpoint: z.url().max(2048).refine((value) => value.startsWith("https://")),
}).strict();

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const publicKey = getWebPushPublicKey();
    const subscribed = publicKey
      ? await withDbUser(actor.id, requestIp(request.headers), async (client) => {
        const result = await client.query(
          "SELECT 1 FROM push_subscriptions WHERE user_id = $1 LIMIT 1",
          [actor.id],
        );
        return result.rowCount !== 0;
      })
      : false;
    return NextResponse.json({ configured: publicKey !== null, publicKey, subscribed });
  } catch (error) {
    console.error("Unable to load Web Push settings.", error);
    return NextResponse.json({ error: "Unable to load Web Push settings." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });

  try {
    const publicKey = getWebPushPublicKey();
    if (!publicKey) return NextResponse.json({ error: "Web Push is not configured." }, { status: 503 });
    const saved = await withDbUser(actor.id, requestIp(request.headers), async (client) =>
      client.query(
        `INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE
           SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
           WHERE push_subscriptions.user_id = EXCLUDED.user_id
         RETURNING id`,
        [actor.id, parsed.data.endpoint, parsed.data.keys.p256dh, parsed.data.keys.auth],
      ),
    );
    if (!saved.rowCount) {
      return NextResponse.json({ error: "This push subscription belongs to another account." }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to save Web Push subscription.", error);
    return NextResponse.json({ error: "Unable to save Web Push subscription." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      await client.query(
        "DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
        [actor.id, parsed.data.endpoint],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to remove Web Push subscription.", error);
    return NextResponse.json({ error: "Unable to remove Web Push subscription." }, { status: 500 });
  }
}
