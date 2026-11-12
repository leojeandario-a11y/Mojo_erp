"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/auth";
import type { CollaborationDepartmentCode } from "@/lib/collaboration-roles";
import { translate } from "@/lib/i18n";
import { CollaborationMeetings } from "@/components/collaboration-meetings";
import { CollaborationChat } from "@/components/collaboration-chat";

interface CollaborationUser {
  id: string;
  full_name: string;
  department_name: string | null;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  audience_type: "all" | "department" | "selected";
  department_code: CollaborationDepartmentCode | null;
  created_at: string;
  created_by_name: string;
}

type AudienceType = "all" | "department" | "selected";
type CollaborationTab = "announcements" | "meetings" | "chat";

export function CollaborationManager({
  locale,
  canAnnounce,
  canAnnounceGlobal,
  departmentCode,
  actorId,
  canScheduleMeetings,
  canCreateGroups,
  canReadDirectorsChat,
}: {
  locale: Locale;
  actorId: string;
  canAnnounce: boolean;
  canAnnounceGlobal: boolean;
  departmentCode: CollaborationDepartmentCode | null;
  canScheduleMeetings: boolean;
  canCreateGroups: boolean;
  canReadDirectorsChat: boolean;
}) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [users, setUsers] = useState<CollaborationUser[]>([]);
  const [audience, setAudience] = useState<AudienceType>(
    canAnnounceGlobal ? "all" : departmentCode ? "department" : "selected",
  );
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [emailWorkerConfigured, setEmailWorkerConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeTab, setActiveTab] = useState<CollaborationTab>("announcements");
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const announcementResponse = await fetch("/api/v1/collaboration/announcements");
      const announcementData = await announcementResponse.json() as {
        announcements: Announcement[];
        emailConfigured: boolean;
        emailWorkerConfigured: boolean;
        error?: string;
      };
      if (!announcementResponse.ok) throw new Error(announcementData.error ?? text("requestFailed"));
      setAnnouncements(announcementData.announcements);
      setEmailConfigured(announcementData.emailConfigured);
      setEmailWorkerConfigured(announcementData.emailWorkerConfigured);
      if (canAnnounce) {
        const directoryResponse = await fetch("/api/v1/collaboration/directory");
        const directoryData = await directoryResponse.json() as { users: CollaborationUser[]; error?: string };
        if (!directoryResponse.ok) throw new Error(directoryData.error ?? text("requestFailed"));
        setUsers(directoryData.users);
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setLoading(false);
    }
  }, [canAnnounce, text]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requestedTab = query.get("tab");
    if (requestedTab === "announcements" || requestedTab === "meetings" || requestedTab === "chat") {
      setActiveTab(requestedTab);
    } else if (query.has("roomId")) {
      setActiveTab("chat");
    }
  }, []);

  async function sendAnnouncement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/v1/collaboration/announcements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          audienceType: audience,
          ...(audience === "department" && departmentCode ? { departmentCode } : {}),
          ...(audience === "selected" ? { userIds: selectedUsers } : {}),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? text("requestFailed"));
      setTitle("");
      setBody("");
      setSelectedUsers([]);
      setSuccess(text("announcementSent"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  function toggleUser(id: string) {
    setSelectedUsers((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      return current.length < 100 ? [...current, id] : current;
    });
  }

  return (
    <section className="collaboration-shell">
      <header className="page-heading">
        <div>
          <span className="eyebrow">MOJOPIKTURES · LOT 18</span>
          <h1>{text("collaboration")}</h1>
          <p>{text("collaborationDescription")}</p>
        </div>
      </header>

      <div className="collaboration-tabs" role="tablist" aria-label={text("collaboration")}>
        {(["announcements", "meetings", "chat"] as const).map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "collaboration-tab is-active" : "collaboration-tab"}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          >
            {text(tab === "announcements" ? "announcements" : tab === "meetings" ? "meetings" : "chat")}
          </button>
        ))}
      </div>
      {activeTab === "announcements" && (
        <>
          <div className="collaboration-section-heading">
            <div><h2>{text("announcements")}</h2></div>
          </div>
          {emailConfigured === false && <p className="collaboration-notice" role="status">{text("announcementEmailUnavailable")}</p>}
          {emailConfigured && emailWorkerConfigured === false && <p className="collaboration-notice" role="status">{text("announcementEmailSchedulerUnavailable")}</p>}
          {emailConfigured && emailWorkerConfigured && <p className="collaboration-note">{text("announcementEmailQueued")}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {success && <p className="collaboration-success" role="status">{success}</p>}

          {canAnnounce && (
            <form className="panel collaboration-compose" onSubmit={(event) => void sendAnnouncement(event)}>
          <div className="collaboration-form-grid">
            <label>
              {text("announcementTitle")}
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required />
            </label>
            <label className="collaboration-audience">
              {text("announcementAudience")}
              <select value={audience} onChange={(event) => setAudience(event.target.value as AudienceType)}>
                {canAnnounceGlobal && <option value="all">{text("announcementAll")}</option>}
                {departmentCode && <option value="department">{text("announcementDepartment")}</option>}
                <option value="selected">{text("announcementSelected")}</option>
              </select>
            </label>
            <label className="collaboration-message">
              {text("announcementBody")}
              <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} maxLength={5000} required />
            </label>
          </div>
          {audience === "selected" && (
            <fieldset className="collaboration-recipient-list">
              <legend>
                {text("announcementSelectUsers")} ({selectedUsers.length}/100)
              </legend>
              {users.length ? users.map((user) => (
                <label key={user.id}>
                  <input type="checkbox" checked={selectedUsers.includes(user.id)}
                    disabled={selectedUsers.length >= 100 && !selectedUsers.includes(user.id)}
                    onChange={() => toggleUser(user.id)} />
                  <span>{user.full_name}</span>
                  {user.department_name && <small>{user.department_name}</small>}
                </label>
              )) : <p>{text("collaborationNoUsers")}</p>}
            </fieldset>
          )}
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? text("saving") : text("announcementSend")}
          </button>
            </form>
          )}

          <div className="collaboration-announcements" aria-live="polite">
            {loading ? <p className="muted">{text("collaborationLoading")}</p> : announcements.length ? announcements.map((announcement) => (
              <article className="panel collaboration-announcement" key={announcement.id}>
                <div className="collaboration-announcement-heading">
                  <h3>{announcement.title}</h3>
                  <time dateTime={announcement.created_at}>
                    {new Intl.DateTimeFormat(locale === "ht" ? "ht-HT" : locale === "en" ? "en-US" : "fr-FR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "America/Port-au-Prince",
                    }).format(new Date(announcement.created_at))}
                  </time>
                </div>
                <p>{announcement.body}</p>
                <small>{text("announcementAuthor")} · {announcement.created_by_name}</small>
              </article>
            )) : <p className="muted">{text("announcementEmpty")}</p>}
          </div>
        </>
      )}
      {activeTab === "meetings" && (
        <CollaborationMeetings locale={locale} actorId={actorId} canSchedule={canScheduleMeetings} />
      )}
      {activeTab === "chat" && (
        <CollaborationChat
          locale={locale}
          actorId={actorId}
          canCreateGroups={canCreateGroups}
          canReadDirectorsChat={canReadDirectorsChat}
        />
      )}
    </section>
  );
}
