import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import {
  deleteGoogleCalendarEvent,
  GoogleCalendarError,
  isGoogleCalendarConfigured,
} from "@/lib/google-calendar";

const updateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("respond"),
    response: z.enum(["accepted", "declined", "tentative"]),
  }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);

interface MeetingRecord {
  id: string;
  created_by: string;
  status: "scheduled" | "cancelled";
  google_event_id: string | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { meetingId } = await params;
  if (!z.uuid().safeParse(meetingId).success) {
    return NextResponse.json({ error: "Invalid meeting." }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid meeting update." }, { status: 400 });

  try {
    const meeting = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<MeetingRecord>(
        `SELECT id, created_by, status, google_event_id
         FROM collaboration_meetings
         WHERE id = $1`,
        [meetingId],
      );
      return result.rows[0] ?? null;
    });
    if (!meeting) return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
    if (meeting.status !== "scheduled") {
      return NextResponse.json({ error: "This meeting is no longer active." }, { status: 409 });
    }

    if (parsed.data.action === "cancel") {
      if (meeting.created_by !== actor.id) {
        return NextResponse.json({ error: "Only the organizer may cancel this meeting." }, { status: 403 });
      }
      if (meeting.google_event_id) {
        if (!isGoogleCalendarConfigured()) {
          return NextResponse.json({ error: "Configure Google Calendar before cancelling this linked meeting." }, { status: 503 });
        }
        await deleteGoogleCalendarEvent(meeting.google_event_id);
      }
    } else if (meeting.created_by === actor.id) {
      return NextResponse.json({ error: "The organizer does not need to respond to their own meeting." }, { status: 400 });
    }

    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const locked = await client.query<MeetingRecord>(
        `SELECT id, created_by, status, google_event_id
         FROM collaboration_meetings
         WHERE id = $1${meeting.created_by === actor.id ? " FOR UPDATE" : ""}`,
        [meetingId],
      );
      const current = locked.rows[0];
      if (!current || current.status !== "scheduled") return null;

      if (parsed.data.action === "cancel") {
        if (current.created_by !== actor.id) return { forbidden: true as const };
        await client.query(
          `UPDATE collaboration_meetings
           SET status = 'cancelled', cancelled_at = now()
           WHERE id = $1`,
          [meetingId],
        );
        await client.query(
          `INSERT INTO notifications(user_id, kind, title, body, link, ref_table, ref_id)
           SELECT invitee.user_id, 'meeting_update', meeting.title,
                  'The organizer cancelled this meeting.', '/collaboration?tab=meetings',
                  'collaboration_meetings', meeting.id
           FROM collaboration_meetings meeting
           JOIN collaboration_meeting_invitees invitee ON invitee.meeting_id = meeting.id
           WHERE meeting.id = $1 AND invitee.user_id <> $2`,
          [meetingId, actor.id],
        );
        return { status: "cancelled" as const };
      }

      if (current.created_by === actor.id) return { forbidden: true as const };
      const invitation = await client.query(
        `UPDATE collaboration_meeting_invitees
         SET response = $3, responded_at = now()
         WHERE meeting_id = $1 AND user_id = $2
         RETURNING meeting_id`,
        [meetingId, actor.id, parsed.data.response],
      );
      if (!invitation.rowCount) return { notInvited: true as const };
      await client.query(
        `INSERT INTO notifications(user_id, kind, title, body, link, ref_table, ref_id)
         SELECT meeting.created_by, 'meeting_response', meeting.title, $3,
                '/collaboration?tab=meetings', 'collaboration_meetings', meeting.id
         FROM collaboration_meetings meeting
         WHERE meeting.id = $1 AND meeting.created_by <> $2`,
        [meetingId, actor.id, `Invitee response: ${parsed.data.response}.`],
      );
      return { status: parsed.data.response };
    });

    if (!result) return NextResponse.json({ error: "Meeting is no longer available." }, { status: 409 });
    if ("forbidden" in result) return NextResponse.json({ error: "You cannot update this meeting." }, { status: 403 });
    if ("notInvited" in result) return NextResponse.json({ error: "You are not invited to this meeting." }, { status: 403 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GoogleCalendarError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error("Unable to update collaboration meeting.", error);
    return NextResponse.json({ error: "Unable to update the meeting." }, { status: 500 });
  }
}
