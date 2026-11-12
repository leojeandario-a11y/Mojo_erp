import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const messageSchema = z.object({ body: z.string().trim().min(1).max(5000) }).strict();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { roomId } = await params;
  if (!z.uuid().safeParse(roomId).success) return NextResponse.json({ error: "Invalid chat room." }, { status: 400 });
  const after = new URL(request.url).searchParams.get("after");
  if (after && !z.string().datetime({ offset: true }).safeParse(after).success) {
    return NextResponse.json({ error: "Invalid message cursor." }, { status: 400 });
  }

  try {
    const messages = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const room = await client.query(
        `SELECT id FROM collaboration_chat_rooms
         WHERE id = $1 AND collaboration_chat_member(id, $2)`,
        [roomId, actor.id],
      );
      if (!room.rows[0]) throw new ChatAccessError();
      const result = await client.query(
        `SELECT message.id, message.body, message.sender_id,
                sender.full_name AS sender_name, message.created_at::text
         FROM (
           SELECT id, body, sender_id, created_at
           FROM collaboration_chat_messages
           WHERE room_id = $1 AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)
           ORDER BY created_at DESC
           LIMIT 100
         ) message
         JOIN users sender ON sender.id = message.sender_id
         ORDER BY message.created_at`,
        [roomId, after ?? null],
      );
      return result.rows;
    });
    return NextResponse.json({ messages });
  } catch (error) {
    if (error instanceof ChatAccessError) {
      return NextResponse.json({ error: "You do not have access to this chat room." }, { status: 403 });
    }
    console.error("Unable to load collaboration chat messages.", error);
    return NextResponse.json({ error: "Unable to load chat messages." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { roomId } = await params;
  if (!z.uuid().safeParse(roomId).success) return NextResponse.json({ error: "Invalid chat room." }, { status: 400 });
  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid chat message." }, { status: 400 });

  try {
    const message = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const room = await client.query<{ id: string }>(
        `SELECT id FROM collaboration_chat_rooms
         WHERE id = $1 AND collaboration_chat_member(id, $2)`,
        [roomId, actor.id],
      );
      if (!room.rows[0]) throw new ChatAccessError();
      const inserted = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO collaboration_chat_messages(room_id, sender_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, created_at::text`,
        [roomId, actor.id, parsed.data.body],
      );
      await client.query(
        `INSERT INTO notifications(user_id, kind, title, body, link, ref_table, ref_id)
         SELECT member.user_id, 'chat_message', $2, $3, $4, 'collaboration_chat_rooms', $1
         FROM collaboration_chat_members member
         WHERE member.room_id = $1 AND member.user_id <> $5`,
        [
          roomId,
          actor.fullName,
          parsed.data.body,
          `/collaboration?tab=chat&roomId=${encodeURIComponent(roomId)}`,
          actor.id,
        ],
      );
      return {
        id: inserted.rows[0].id,
        body: parsed.data.body,
        sender_id: actor.id,
        sender_name: actor.fullName,
        created_at: inserted.rows[0].created_at,
      };
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    if (error instanceof ChatAccessError) {
      return NextResponse.json({ error: "You do not have access to this chat room." }, { status: 403 });
    }
    console.error("Unable to send collaboration chat message.", error);
    return NextResponse.json({ error: "Unable to send the chat message." }, { status: 500 });
  }
}

class ChatAccessError extends Error {}
