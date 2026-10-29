import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const readSchema = z.object({ id: z.uuid() }).strict();

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const [notifications, unread] = await Promise.all([
        client.query<{
          id: string;
          kind: string;
          title: string;
          body: string | null;
          link: string | null;
          is_read: boolean;
          created_at: string;
        }>(
          `SELECT id, kind, title, body, link, is_read, created_at::text
           FROM notifications
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 20`,
          [actor.id],
        ),
        client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM notifications WHERE user_id = $1 AND NOT is_read",
          [actor.id],
        ),
      ]);
      return { notifications: notifications.rows, unreadCount: Number(unread.rows[0].count) };
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unable to load notifications.", error);
    return NextResponse.json({ error: "Unable to load notifications." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = readSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid notification." }, { status: 400 });

  try {
    const updated = await withDbUser(actor.id, requestIp(request.headers), async (client) =>
      client.query(
        `UPDATE notifications
         SET is_read = true, read_at = COALESCE(read_at, now())
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [parsed.data.id, actor.id],
      ),
    );
    if (!updated.rowCount) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to mark notification as read.", error);
    return NextResponse.json({ error: "Unable to update notification." }, { status: 500 });
  }
}
