import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { isCollaborationDirector } from "@/lib/collaboration-roles";

const createRoomSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct"), userId: z.uuid() }).strict(),
  z.object({
    kind: z.literal("group"),
    title: z.string().trim().min(1).max(120),
    userIds: z.array(z.uuid()).min(1).max(49),
  }).strict(),
]);

function isDirector(user: { roles: readonly string[] }): boolean {
  return isCollaborationDirector(user.roles) || user.roles.includes("dg");
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const canReadDirectorsChat = hasPermission(actor, "collaboration.chat.directors.read")
    && isDirector(actor);

  try {
    const rooms = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      if (canReadDirectorsChat) {
        await client.query(
          `INSERT INTO collaboration_chat_rooms(room_key, kind, title, created_by)
           VALUES ('directors', 'directors', 'Directors', $1)
           ON CONFLICT (room_key) DO NOTHING`,
          [actor.id],
        );
        const directorsRoom = await client.query<{ id: string }>(
          "SELECT id FROM collaboration_chat_rooms WHERE room_key = 'directors'",
        );
        const roomId = directorsRoom.rows[0]?.id;
        if (roomId) {
          await client.query(
            `INSERT INTO collaboration_chat_members(room_id, user_id)
             SELECT $1, user_record.id
             FROM users user_record
             WHERE user_record.is_active
               AND EXISTS (
                 SELECT 1
                 FROM user_roles user_role
                 JOIN roles role ON role.id = user_role.role_id
                 WHERE user_role.user_id = user_record.id
                   AND role.code IN ('dg', 'daf', 'drh', 'affaires', 'marketing', 'operations', 'stock_manager')
               )
             ON CONFLICT (room_id, user_id) DO NOTHING`,
            [roomId],
          );
        }
      }

      const result = await client.query(
        `SELECT room.id, room.kind,
                CASE WHEN room.kind = 'direct' THEN (
                  SELECT user_record.full_name
                  FROM collaboration_chat_members peer
                  JOIN users user_record ON user_record.id = peer.user_id
                  WHERE peer.room_id = room.id AND peer.user_id <> $1
                  ORDER BY user_record.full_name
                  LIMIT 1
                ) ELSE room.title END AS title,
                room.created_at::text,
                latest.body AS last_message,
                latest.created_at::text AS last_message_at
         FROM collaboration_chat_rooms room
         JOIN collaboration_chat_members member
           ON member.room_id = room.id AND member.user_id = $1
         LEFT JOIN LATERAL (
           SELECT message.body, message.created_at
           FROM collaboration_chat_messages message
           WHERE message.room_id = room.id
           ORDER BY message.created_at DESC
           LIMIT 1
         ) latest ON true
         ORDER BY latest.created_at DESC NULLS LAST, room.created_at DESC`,
        [actor.id],
      );
      return result.rows;
    });
    return NextResponse.json({
      rooms,
      canCreateGroup: hasPermission(actor, "collaboration.chat.group.create") && isDirector(actor),
      directorsChatAvailable: canReadDirectorsChat,
    });
  } catch (error) {
    console.error("Unable to load collaboration chat rooms.", error);
    return NextResponse.json({ error: "Unable to load chat rooms." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = createRoomSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid chat room details." }, { status: 400 });
  if (parsed.data.kind === "group" && (
    !hasPermission(actor, "collaboration.chat.group.create") || !isDirector(actor)
  )) {
    return NextResponse.json({ error: "Only directors may create group chats." }, { status: 403 });
  }
  if (parsed.data.kind === "direct" && parsed.data.userId === actor.id) {
    return NextResponse.json({ error: "Choose another person for a direct chat." }, { status: 400 });
  }

  const requestedIds = parsed.data.kind === "direct"
    ? [actor.id, parsed.data.userId]
    : [...new Set([actor.id, ...parsed.data.userIds])];
  if (parsed.data.kind === "group" && requestedIds.length < 2) {
    return NextResponse.json({ error: "A group chat needs at least one other person." }, { status: 400 });
  }

  try {
    const room = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const activeUsers = await client.query<{ id: string }>(
        `SELECT id FROM users
         WHERE is_active AND id = ANY($1::uuid[])
         ORDER BY id`,
        [requestedIds],
      );
      if (activeUsers.rowCount !== requestedIds.length) throw new ChatValidationError();

      if (parsed.data.kind === "direct") {
        const roomKey = `direct:${[actor.id, parsed.data.userId].sort().join(":")}`;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO collaboration_chat_rooms(room_key, kind, title, created_by)
           VALUES ($1, 'direct', NULL, $2)
           ON CONFLICT (room_key) DO NOTHING
           RETURNING id`,
          [roomKey, actor.id],
        );
        if (inserted.rows[0]) {
          await client.query(
            `INSERT INTO collaboration_chat_members(room_id, user_id)
             SELECT $1, user_id FROM unnest($2::uuid[]) AS user_id`,
            [inserted.rows[0].id, requestedIds],
          );
          return { id: inserted.rows[0].id };
        }
        const existing = await client.query<{ id: string }>(
          "SELECT id FROM collaboration_chat_rooms WHERE room_key = $1",
          [roomKey],
        );
        if (!existing.rows[0]) throw new ChatValidationError();
        return { id: existing.rows[0].id };
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO collaboration_chat_rooms(room_key, kind, title, created_by)
         VALUES ($1, 'group', $2, $3)
         RETURNING id`,
        [`group:${randomUUID()}`, parsed.data.title, actor.id],
      );
      const roomId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO collaboration_chat_members(room_id, user_id)
         SELECT $1, user_id FROM unnest($2::uuid[]) AS user_id`,
        [roomId, requestedIds],
      );
      return { id: roomId };
    });
    return NextResponse.json(room, { status: 201 });
  } catch (error) {
    if (error instanceof ChatValidationError) {
      return NextResponse.json({ error: "One or more selected users are unavailable." }, { status: 400 });
    }
    console.error("Unable to create collaboration chat room.", error);
    return NextResponse.json({ error: "Unable to create the chat room." }, { status: 500 });
  }
}

class ChatValidationError extends Error {}
