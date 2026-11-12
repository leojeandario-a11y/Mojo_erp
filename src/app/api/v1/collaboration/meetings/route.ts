import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { isCollaborationDirector } from "@/lib/collaboration-roles";
import {
  createGoogleCalendarEvent,
  GoogleCalendarError,
  isGoogleCalendarConfigured,
  deleteGoogleCalendarEvent,
} from "@/lib/google-calendar";
import { getJitsiConfig } from "@/lib/jitsi";

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).default(""),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  attendeeIds: z.array(z.uuid()).max(100),
  meetUrl: z.string().url().max(2048).optional(),
}).strict().superRefine((meeting, context) => {
  const startsAt = Date.parse(meeting.startsAt);
  const endsAt = Date.parse(meeting.endsAt);
  if (startsAt <= Date.now()) {
    context.addIssue({ code: "custom", path: ["startsAt"], message: "Choose a future start time." });
  }
  if (endsAt - startsAt < 60_000 || endsAt - startsAt > 12 * 60 * 60 * 1000) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Meeting duration must be between one minute and twelve hours." });
  }
  if (meeting.meetUrl) {
    const url = URL.canParse(meeting.meetUrl) ? new URL(meeting.meetUrl) : null;
    if (!url || url.protocol !== "https:" || url.hostname !== "meet.google.com") {
      context.addIssue({ code: "custom", path: ["meetUrl"], message: "Use a Google Meet link." });
    }
  }
});

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  let jitsiConfigured: boolean;
  try {
    jitsiConfigured = getJitsiConfig() !== null;
  } catch (error) {
    console.error("Jitsi configuration is invalid.", error);
    return NextResponse.json({ error: "Embedded video is not configured correctly." }, { status: 503 });
  }

  try {
    const meetings = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query(
        `SELECT meeting.id, meeting.title, meeting.description,
                meeting.starts_at::text, meeting.ends_at::text, meeting.meet_url,
                meeting.status, meeting.created_by, meeting.created_at::text,
                organizer.full_name AS organizer_name,
                CASE WHEN meeting.created_by = $1
                     THEN 'organizer'
                     ELSE COALESCE(own_invitation.response, 'pending')
                END AS my_response,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'userId', invitee.user_id,
                    'fullName', attendee.full_name,
                    'response', invitee.response
                  ) ORDER BY attendee.full_name)
                  FROM collaboration_meeting_invitees invitee
                  JOIN users attendee ON attendee.id = invitee.user_id
                  WHERE invitee.meeting_id = meeting.id
                ), '[]'::json) AS invitees
         FROM collaboration_meetings meeting
         JOIN users organizer ON organizer.id = meeting.created_by
         LEFT JOIN collaboration_meeting_invitees own_invitation
           ON own_invitation.meeting_id = meeting.id AND own_invitation.user_id = $1
         WHERE meeting.created_by = $1 OR own_invitation.user_id = $1
         ORDER BY CASE WHEN meeting.starts_at >= now() AND meeting.status = 'scheduled' THEN 0 ELSE 1 END,
                  meeting.starts_at DESC
         LIMIT 100`,
        [actor.id],
      );
      return result.rows;
    });
    return NextResponse.json({
      meetings,
      googleCalendarConfigured: isGoogleCalendarConfigured(),
      jitsiConfigured,
    });
  } catch (error) {
    console.error("Unable to load collaboration meetings.", error);
    return NextResponse.json({ error: "Unable to load meetings." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (
    !hasPermission(actor, "collaboration.meeting.schedule")
    || (!isCollaborationDirector(actor.roles) && !actor.roles.includes("dg"))
  ) {
    return NextResponse.json({ error: "Only directors may schedule meetings." }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid meeting details." }, { status: 400 });
  const attendeeIds = [...new Set([actor.id, ...parsed.data.attendeeIds])];
  const googleConfigured = isGoogleCalendarConfigured();
  let jitsiConfigured: boolean;
  try {
    jitsiConfigured = getJitsiConfig() !== null;
  } catch (error) {
    console.error("Jitsi configuration is invalid.", error);
    return NextResponse.json({ error: "Embedded video is not configured correctly." }, { status: 503 });
  }
  if (!googleConfigured && !parsed.data.meetUrl && !jitsiConfigured) {
    return NextResponse.json({ error: "Provide a Google Meet link, configure Google Calendar, or configure the embedded video room." }, { status: 400 });
  }
  if (googleConfigured && parsed.data.meetUrl) {
    return NextResponse.json({ error: "A Meet link is generated by Google Calendar when integration is enabled." }, { status: 400 });
  }

  let attendees: { id: string; email: string }[];
  try {
    attendees = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{ id: string; email: string }>(
        `SELECT id, email::text AS email
         FROM users
         WHERE is_active AND id = ANY($1::uuid[])
         ORDER BY id`,
        [attendeeIds],
      );
      if (result.rowCount !== attendeeIds.length) throw new MeetingValidationError();
      return result.rows;
    });
  } catch (error) {
    if (error instanceof MeetingValidationError) {
      return NextResponse.json({ error: "One or more invitees are unavailable." }, { status: 400 });
    }
    console.error("Unable to validate meeting invitees.", error);
    return NextResponse.json({ error: "Unable to validate invitees." }, { status: 500 });
  }

  let googleEvent: { id: string; meetUrl: string | null } | null = null;
  if (googleConfigured) {
    try {
      googleEvent = await createGoogleCalendarEvent({
        title: parsed.data.title,
        description: parsed.data.description,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        attendeeEmails: attendees.filter((attendee) => attendee.id !== actor.id).map((attendee) => attendee.email),
      });
      if (!googleEvent.meetUrl) {
        await deleteGoogleCalendarEvent(googleEvent.id);
        return NextResponse.json({ error: "Google Calendar did not return a Google Meet link." }, { status: 502 });
      }
    } catch (error) {
      if (error instanceof GoogleCalendarError) {
        return NextResponse.json({ error: error.message }, { status: 502 });
      }
      console.error("Unable to create the Google Calendar meeting.", error);
      return NextResponse.json({ error: "Unable to create the Google Meet." }, { status: 502 });
    }
  }

  try {
    const meeting = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO collaboration_meetings(
           title, description, starts_at, ends_at, meet_url, google_event_id, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          parsed.data.title,
          parsed.data.description,
          parsed.data.startsAt,
          parsed.data.endsAt,
          googleEvent?.meetUrl ?? parsed.data.meetUrl ?? null,
          googleEvent?.id ?? null,
          actor.id,
        ],
      );
      const meetingId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO collaboration_meeting_invitees(meeting_id, user_id, response, responded_at)
         SELECT $1, invitee_id,
                CASE WHEN invitee_id = $3 THEN 'accepted' ELSE 'pending' END,
                CASE WHEN invitee_id = $3 THEN now() ELSE NULL END
         FROM unnest($2::uuid[]) AS invitee_id`,
        [meetingId, attendeeIds, actor.id],
      );
      await client.query(
        `INSERT INTO notifications(user_id, kind, title, body, link, ref_table, ref_id)
         SELECT invitee_id, 'meeting_invitation', $2, $3, '/collaboration?tab=meetings',
                'collaboration_meetings', $1
         FROM unnest($4::uuid[]) AS invitee_id
         WHERE invitee_id <> $5`,
        [meetingId, parsed.data.title, "You have been invited to a meeting.", attendeeIds, actor.id],
      );
      return { id: meetingId, meetUrl: googleEvent?.meetUrl ?? parsed.data.meetUrl ?? null };
    });
    return NextResponse.json(meeting, { status: 201 });
  } catch (error) {
    if (googleEvent) {
      try {
        await deleteGoogleCalendarEvent(googleEvent.id);
      } catch (cleanupError) {
        console.error("Unable to remove the Google Calendar event after meeting creation failed.", cleanupError);
      }
    }
    console.error("Unable to schedule collaboration meeting.", error);
    return NextResponse.json({ error: "Unable to schedule the meeting." }, { status: 500 });
  }
}

class MeetingValidationError extends Error {}
