"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface MeetingContact {
  id: string;
  full_name: string;
  department_name: string | null;
}

interface MeetingInvitee {
  userId: string;
  fullName: string;
  response: "pending" | "accepted" | "declined" | "tentative";
}

interface Meeting {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  meet_url: string | null;
  status: "scheduled" | "cancelled";
  created_by: string;
  organizer_name: string;
  my_response: "organizer" | "pending" | "accepted" | "declined" | "tentative";
  invitees: MeetingInvitee[];
}

type TranslationKey = Parameters<typeof translate>[1];

export function CollaborationMeetings({
  locale,
  actorId,
  canSchedule,
}: {
  locale: Locale;
  actorId: string;
  canSchedule: boolean;
}) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [contacts, setContacts] = useState<MeetingContact[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [googleCalendarConfigured, setGoogleCalendarConfigured] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [meetUrl, setMeetUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const text = useCallback((key: TranslationKey) => translate(locale, key), [locale]);

  const load = useCallback(async () => {
    try {
      const [meetingResponse, contactResponse] = await Promise.all([
        fetch("/api/v1/collaboration/meetings"),
        fetch("/api/v1/collaboration/chat/directory"),
      ]);
      const meetingData = await meetingResponse.json() as {
        meetings: Meeting[];
        googleCalendarConfigured: boolean;
        error?: string;
      };
      const contactData = await contactResponse.json() as { users: MeetingContact[]; error?: string };
      if (!meetingResponse.ok) throw new Error(meetingData.error ?? text("requestFailed"));
      if (!contactResponse.ok) throw new Error(contactData.error ?? text("requestFailed"));
      setMeetings(meetingData.meetings);
      setContacts(contactData.users);
      setGoogleCalendarConfigured(meetingData.googleCalendarConfigured);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => {
    void load();
  }, [load]);

  async function scheduleMeeting(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/v1/collaboration/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          attendeeIds: selectedUsers,
          ...(!googleCalendarConfigured ? { meetUrl } : {}),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? text("requestFailed"));
      setTitle("");
      setDescription("");
      setStartsAt("");
      setEndsAt("");
      setMeetUrl("");
      setSelectedUsers([]);
      setSuccess(text("meetingScheduled"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function updateMeeting(meetingId: string, payload: { action: "cancel" } | {
    action: "respond";
    response: "accepted" | "declined" | "tentative";
  }) {
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/v1/collaboration/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? text("requestFailed"));
      setSuccess(payload.action === "cancel" ? text("meetingCancelled") : text("meetingResponseSaved"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    }
  }

  function toggleUser(id: string) {
    setSelectedUsers((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < 100 ? [...current, id] : current);
  }

  const localeTag = locale === "ht" ? "ht-HT" : locale === "en" ? "en-US" : "fr-FR";
  const dateTime = (value: string) => new Intl.DateTimeFormat(localeTag, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Port-au-Prince",
  }).format(new Date(value));

  return (
    <div className="collaboration-workspace">
      <header className="collaboration-section-heading">
        <div>
          <h2>{text("meetings")}</h2>
          <p>{text("meetingDescription")}</p>
        </div>
      </header>
      <p className={googleCalendarConfigured ? "collaboration-note" : "collaboration-notice"} role="status">
        {text(googleCalendarConfigured ? "meetingGoogleConfigured" : "meetingManualLinkRequired")}
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="collaboration-success" role="status">{success}</p>}

      {canSchedule && (
        <form className="panel collaboration-compose" onSubmit={(event) => void scheduleMeeting(event)}>
          <div className="collaboration-form-grid">
            <label>
              {text("meetingTitle")}
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required />
            </label>
            <label>
              {text("meetingStart")}
              <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
            </label>
            <label>
              {text("meetingEnd")}
              <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
            </label>
            {!googleCalendarConfigured && (
              <label>
                {text("meetingMeetLink")}
                <input type="url" value={meetUrl} onChange={(event) => setMeetUrl(event.target.value)}
                  placeholder="https://meet.google.com/..." required />
              </label>
            )}
            <label className="collaboration-message">
              {text("meetingAgenda")}
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={5000} />
            </label>
          </div>
          <fieldset className="collaboration-recipient-list">
            <legend>{text("meetingInvitees")} ({selectedUsers.length}/100)</legend>
            {contacts.length ? contacts.map((contact) => (
              <label key={contact.id}>
                <input type="checkbox" checked={selectedUsers.includes(contact.id)}
                  disabled={selectedUsers.length >= 100 && !selectedUsers.includes(contact.id)}
                  onChange={() => toggleUser(contact.id)} />
                <span>{contact.full_name}</span>
                {contact.department_name && <small>{contact.department_name}</small>}
              </label>
            )) : <p>{text("collaborationNoUsers")}</p>}
          </fieldset>
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? text("saving") : text("meetingSchedule")}
          </button>
        </form>
      )}

      <div className="collaboration-meeting-list" aria-live="polite">
        {loading ? <p className="muted">{text("collaborationLoading")}</p> : meetings.length ? meetings.map((meeting) => (
          <article className="panel collaboration-meeting" key={meeting.id}>
            <div className="collaboration-meeting-heading">
              <div>
                <h3>{meeting.title}</h3>
                <p>{dateTime(meeting.starts_at)} – {dateTime(meeting.ends_at)}</p>
              </div>
              <span className={`collaboration-status is-${meeting.status}`}>
                {text(meeting.status === "scheduled" ? "meetingStatusScheduled" : "meetingStatusCancelled")}
              </span>
            </div>
            {meeting.description && <p className="collaboration-meeting-agenda">{meeting.description}</p>}
            <p className="collaboration-meeting-organizer">{text("meetingOrganizer")}: {meeting.organizer_name}</p>
            {meeting.meet_url && meeting.status === "scheduled" && (
              <a className="button button-secondary collaboration-meet-link"
                href={meeting.meet_url} target="_blank" rel="noreferrer">
                {text("meetingJoin")}
              </a>
            )}
            <div className="collaboration-meeting-people">
              <strong>{text("meetingInvitees")}</strong>
              <ul>
                {meeting.invitees.map((invitee) => (
                  <li key={invitee.userId}>
                    <span>{invitee.fullName}</span>
                    <small>{text(`meetingResponse_${invitee.response}` as TranslationKey)}</small>
                  </li>
                ))}
              </ul>
            </div>
            {meeting.status === "scheduled" && meeting.created_by !== actorId && meeting.my_response !== "organizer" && (
              <div className="collaboration-meeting-actions">
                <button className="button button-secondary" type="button"
                  onClick={() => void updateMeeting(meeting.id, { action: "respond", response: "accepted" })}>
                  {text("meetingAccept")}
                </button>
                <button className="button button-secondary" type="button"
                  onClick={() => void updateMeeting(meeting.id, { action: "respond", response: "tentative" })}>
                  {text("meetingTentative")}
                </button>
                <button className="button button-secondary" type="button"
                  onClick={() => void updateMeeting(meeting.id, { action: "respond", response: "declined" })}>
                  {text("meetingDecline")}
                </button>
              </div>
            )}
            {meeting.status === "scheduled" && meeting.created_by === actorId && (
              <button className="button button-secondary" type="button"
                onClick={() => {
                  if (window.confirm(text("meetingConfirmCancel"))) {
                    void updateMeeting(meeting.id, { action: "cancel" });
                  }
                }}>
                {text("meetingCancel")}
              </button>
            )}
          </article>
        )) : <p className="muted">{text("meetingEmpty")}</p>}
      </div>
    </div>
  );
}
