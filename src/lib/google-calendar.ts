import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";

interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}

interface CalendarEventInput {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  attendeeEmails: string[];
}

interface CalendarEvent {
  id: string;
  meetUrl: string | null;
}

const accessTokenSchema = z.object({ access_token: z.string().min(1) });
const eventSchema = z.object({
  id: z.string().min(1),
  hangoutLink: z.string().url().optional(),
  conferenceData: z.object({
    entryPoints: z.array(z.object({ entryPointType: z.string(), uri: z.string().url() })).optional(),
  }).optional(),
});

function getConfig(): GoogleCalendarConfig | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return null;
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    refreshToken: GOOGLE_REFRESH_TOKEN,
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
  };
}

export function isGoogleCalendarConfigured(): boolean {
  return getConfig() !== null;
}

async function getAccessToken(config: GoogleCalendarConfig): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new GoogleCalendarError("Google Calendar authentication failed.");
  const parsed = accessTokenSchema.safeParse(await response.json());
  if (!parsed.success) throw new GoogleCalendarError("Google Calendar returned an invalid access token.");
  return parsed.data.access_token;
}

function eventUrl(config: GoogleCalendarConfig, eventId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}`;
}

export async function createGoogleCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  const config = getConfig();
  if (!config) throw new GoogleCalendarError("Google Calendar is not configured.");
  const accessToken = await getAccessToken(config);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events?conferenceDataVersion=1&sendUpdates=none`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        start: { dateTime: input.startsAt, timeZone: "America/Port-au-Prince" },
        end: { dateTime: input.endsAt, timeZone: "America/Port-au-Prince" },
        attendees: input.attendeeEmails.map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new GoogleCalendarError("Google Calendar could not create the meeting.");
  const parsed = eventSchema.safeParse(await response.json());
  if (!parsed.success) throw new GoogleCalendarError("Google Calendar returned an invalid event.");
  const meetUrl = parsed.data.hangoutLink
    ?? parsed.data.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri
    ?? null;
  return { id: parsed.data.id, meetUrl };
}

export async function deleteGoogleCalendarEvent(eventId: string): Promise<void> {
  const config = getConfig();
  if (!config) throw new GoogleCalendarError("Google Calendar is not configured.");
  const accessToken = await getAccessToken(config);
  const response = await fetch(`${eventUrl(config, eventId)}?sendUpdates=none`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new GoogleCalendarError("Google Calendar could not cancel the meeting.");
  }
}

export class GoogleCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}
