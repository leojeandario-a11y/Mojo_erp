"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface ChatContact {
  id: string;
  full_name: string;
  department_name: string | null;
}

interface ChatRoom {
  id: string;
  kind: "direct" | "group" | "directors";
  title: string;
  last_message: string | null;
  last_message_at: string | null;
}

interface ChatMessage {
  id: string;
  body: string;
  sender_id: string;
  sender_name: string;
  created_at: string;
}

type TranslationKey = Parameters<typeof translate>[1];

export function CollaborationChat({
  locale,
  actorId,
  canCreateGroups,
  canReadDirectorsChat,
}: {
  locale: Locale;
  actorId: string;
  canCreateGroups: boolean;
  canReadDirectorsChat: boolean;
}) {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [activeRoomId, setActiveRoomId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [directUserId, setDirectUserId] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupUserIds, setGroupUserIds] = useState<string[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [canCreateGroup, setCanCreateGroup] = useState(canCreateGroups);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const initialRoomHandled = useRef(false);
  const text = useCallback((key: TranslationKey) => translate(locale, key), [locale]);

  const loadRooms = useCallback(async () => {
    try {
      const [roomResponse, contactResponse] = await Promise.all([
        fetch("/api/v1/collaboration/chat/rooms"),
        fetch("/api/v1/collaboration/chat/directory"),
      ]);
      const roomData = await roomResponse.json() as { rooms: ChatRoom[]; canCreateGroup: boolean; error?: string };
      const contactData = await contactResponse.json() as { users: ChatContact[]; error?: string };
      if (!roomResponse.ok) throw new Error(roomData.error ?? text("requestFailed"));
      if (!contactResponse.ok) throw new Error(contactData.error ?? text("requestFailed"));
      setRooms(roomData.rooms);
      setContacts(contactData.users);
      setCanCreateGroup(roomData.canCreateGroup);
      const requestedRoomId = !initialRoomHandled.current
        && typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("roomId")
        : null;
      initialRoomHandled.current = true;
      setActiveRoomId((current) => requestedRoomId && roomData.rooms.some((room) => room.id === requestedRoomId)
        ? requestedRoomId
        : current && roomData.rooms.some((room) => room.id === current)
          ? current
          : roomData.rooms[0]?.id ?? "");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => {
    void loadRooms();
    const interval = window.setInterval(() => void loadRooms(), 15000);
    return () => window.clearInterval(interval);
  }, [loadRooms]);

  useEffect(() => {
    if (!activeRoomId) {
      setMessages([]);
      return;
    }
    let active = true;
    let cursor = "";
    async function pollMessages() {
      try {
        const search = cursor ? `?after=${encodeURIComponent(cursor)}` : "";
        const response = await fetch(
          `/api/v1/collaboration/chat/rooms/${activeRoomId}/messages${search}`,
        );
        const result = await response.json() as { messages: ChatMessage[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? text("requestFailed"));
        if (!active) return;
        if (result.messages.length) {
          cursor = result.messages[result.messages.length - 1].created_at;
          setMessages((current) => {
            const byId = new Map(current.map((message) => [message.id, message]));
            for (const message of result.messages) byId.set(message.id, message);
            return [...byId.values()].sort((first, second) =>
              first.created_at.localeCompare(second.created_at),
            );
          });
        }
        setError("");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : text("requestFailed"));
      }
    }
    void pollMessages();
    const interval = window.setInterval(() => void pollMessages(), 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activeRoomId, text]);

  async function createRoom(event: React.FormEvent<HTMLFormElement>, kind: "direct" | "group") {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      const payload = kind === "direct"
        ? { kind, userId: directUserId }
        : { kind, title: groupTitle, userIds: groupUserIds };
      const response = await fetch("/api/v1/collaboration/chat/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? text("requestFailed"));
      setActiveRoomId(result.id);
      if (kind === "direct") setDirectUserId("");
      else {
        setGroupTitle("");
        setGroupUserIds([]);
      }
      setSuccess(text("chatRoomReady"));
      await loadRooms();
      setActiveRoomId(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeRoomId || !messageBody.trim()) return;
    setSending(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/v1/collaboration/chat/rooms/${activeRoomId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: messageBody }),
      });
      const result = await response.json() as { message?: ChatMessage; error?: string };
      if (!response.ok || !result.message) throw new Error(result.error ?? text("requestFailed"));
      const sentMessage = result.message;
      setMessageBody("");
      setMessages((current) => {
        const byId = new Map(current.map((message) => [message.id, message]));
        byId.set(sentMessage.id, sentMessage);
        return [...byId.values()].sort((first, second) =>
          first.created_at.localeCompare(second.created_at),
        );
      });
      await loadRooms();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSending(false);
    }
  }

  function toggleGroupUser(id: string) {
    setGroupUserIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < 49 ? [...current, id] : current);
  }

  const localeTag = locale === "ht" ? "ht-HT" : locale === "en" ? "en-US" : "fr-FR";
  const time = (value: string) => new Intl.DateTimeFormat(localeTag, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Port-au-Prince",
  }).format(new Date(value));

  return (
    <div className="collaboration-workspace">
      <header className="collaboration-section-heading">
        <div>
          <h2>{text("chat")}</h2>
          <p>{text("chatDescription")}</p>
        </div>
      </header>
      {canReadDirectorsChat && <p className="collaboration-note">{text("chatDirectorsRoom")}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="collaboration-success" role="status">{success}</p>}

      <div className="collaboration-chat-tools">
        <form className="panel collaboration-chat-start" onSubmit={(event) => void createRoom(event, "direct")}>
          <label>
            {text("chatStartDirect")}
            <select value={directUserId} onChange={(event) => setDirectUserId(event.target.value)} required>
              <option value="">{text("chatChoosePerson")}</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name}</option>)}
            </select>
          </label>
          <button className="button button-secondary" type="submit" disabled={!directUserId}>
            {text("chatOpen")}
          </button>
        </form>

        {canCreateGroup && (
          <details className="panel collaboration-chat-group">
            <summary>{text("chatCreateGroup")}</summary>
            <form onSubmit={(event) => void createRoom(event, "group")}>
              <label>
                {text("chatGroupTitle")}
                <input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)}
                  maxLength={120} required />
              </label>
              <fieldset className="collaboration-recipient-list">
                <legend>{text("chatGroupMembers")} ({groupUserIds.length}/49)</legend>
                {contacts.map((contact) => (
                  <label key={contact.id}>
                    <input type="checkbox" checked={groupUserIds.includes(contact.id)}
                      disabled={groupUserIds.length >= 49 && !groupUserIds.includes(contact.id)}
                      onChange={() => toggleGroupUser(contact.id)} />
                    <span>{contact.full_name}</span>
                    {contact.department_name && <small>{contact.department_name}</small>}
                  </label>
                ))}
              </fieldset>
              <button className="button button-primary" type="submit" disabled={!groupUserIds.length}>
                {text("chatCreate")}
              </button>
            </form>
          </details>
        )}
      </div>

      <div className="collaboration-chat">
        <aside className="panel collaboration-chat-rooms" aria-label={text("chatRooms")}>
          <h3>{text("chatRooms")}</h3>
          {loading ? <p className="muted">{text("collaborationLoading")}</p> : rooms.length ? rooms.map((room) => (
            <button key={room.id} type="button"
              className={room.id === activeRoomId ? "collaboration-chat-room is-active" : "collaboration-chat-room"}
              onClick={() => setActiveRoomId(room.id)}>
              <strong>{room.kind === "directors" ? text("chatDirectorsRoom") : room.title}</strong>
              <small>{room.last_message ?? text("chatNoMessages")}</small>
            </button>
          )) : <p className="muted">{text("chatNoRooms")}</p>}
        </aside>

        <section className="panel collaboration-chat-conversation" aria-label={text("chatConversation")}>
          <div className="collaboration-chat-messages" aria-live="polite">
            {!activeRoomId ? <p className="muted">{text("chatNoRooms")}</p> : messages.length ? messages.map((message) => (
              <article key={message.id}
                className={message.sender_id === actorId ? "collaboration-chat-message is-mine" : "collaboration-chat-message"}>
                <div>
                  <strong>{message.sender_id === actorId ? text("chatYou") : message.sender_name}</strong>
                  <time dateTime={message.created_at}>{time(message.created_at)}</time>
                </div>
                <p>{message.body}</p>
              </article>
            )) : <p className="muted">{text("chatNoMessages")}</p>}
          </div>
          <form className="collaboration-chat-compose" onSubmit={(event) => void sendMessage(event)}>
            <label className="sr-only" htmlFor="collaboration-chat-message">{text("chatMessagePlaceholder")}</label>
            <textarea id="collaboration-chat-message" value={messageBody}
              onChange={(event) => setMessageBody(event.target.value)}
              placeholder={text("chatMessagePlaceholder")} maxLength={5000} rows={2} required />
            <button className="button button-primary" type="submit" disabled={!activeRoomId || !messageBody.trim() || sending}>
              {sending ? text("saving") : text("chatSend")}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
