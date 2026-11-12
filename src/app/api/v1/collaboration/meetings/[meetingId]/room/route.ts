import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { createMeetingJitsiToken, getJitsiConfig, JitsiConfigurationError } from "@/lib/jitsi";

interface MeetingRoomRecord {
  id: string;
  title: string;
  status: "scheduled" | "cancelled";
  created_by: string;
  invitee_response: "pending" | "accepted" | "declined" | "tentative" | null;
  full_name: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { meetingId } = await params;
  if (!z.uuid().safeParse(meetingId).success) {
    return NextResponse.json({ error: "Invalid meeting." }, { status: 400 });
  }

  let config;
  try {
    config = getJitsiConfig();
  } catch (error) {
    console.error("Jitsi configuration is invalid.", error);
    return NextResponse.json({ error: "Embedded video is not configured correctly." }, { status: 503 });
  }
  if (!config) {
    return NextResponse.json({ error: "Embedded video is not configured." }, { status: 503 });
  }

  try {
    const meeting = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<MeetingRoomRecord>(
        `SELECT meeting.id, meeting.title, meeting.status, meeting.created_by,
                invitation.response AS invitee_response, participant.full_name
         FROM collaboration_meetings meeting
         JOIN users participant ON participant.id = $2
         LEFT JOIN collaboration_meeting_invitees invitation
           ON invitation.meeting_id = meeting.id AND invitation.user_id = $2
         WHERE meeting.id = $1
           AND (meeting.created_by = $2 OR invitation.user_id = $2)`,
        [meetingId, actor.id],
      );
      return result.rows[0] ?? null;
    });

    if (!meeting) return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
    if (meeting.status !== "scheduled") {
      return NextResponse.json({ error: "This meeting is no longer active." }, { status: 409 });
    }
    if (meeting.created_by !== actor.id && meeting.invitee_response === "declined") {
      return NextResponse.json({ error: "You declined this meeting and cannot join its room." }, { status: 403 });
    }

    const room = createMeetingJitsiToken(config, meeting, { id: actor.id, fullName: meeting.full_name });
    return NextResponse.json({
      domain: config.domain,
      roomName: room.roomName,
      token: room.token,
      displayName: meeting.full_name,
      moderator: room.moderator,
      title: meeting.title,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof JitsiConfigurationError) {
      console.error("Jitsi configuration is invalid.", error);
      return NextResponse.json({ error: "Embedded video is not configured correctly." }, { status: 503 });
    }
    console.error("Unable to authorize the collaboration video room.", error);
    return NextResponse.json({ error: "Unable to open the video room." }, { status: 500 });
  }
}
