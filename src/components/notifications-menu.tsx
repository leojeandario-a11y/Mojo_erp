"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}
interface NotificationData {
  notifications: NotificationItem[];
  unreadCount: number;
}
interface PushSettings {
  configured: boolean;
  publicKey: string | null;
  subscribed: boolean;
}

function decodeApplicationServerKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function NotificationsMenu({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [data, setData] = useState<NotificationData>({ notifications: [], unreadCount: 0 });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pushSettings, setPushSettings] = useState<PushSettings | null>(null);
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [pushSupported, setPushSupported] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/notifications");
      const body = await response.json() as NotificationData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
      setData(body);
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

  useEffect(() => {
    let cancelled = false;
    setPushSupported("serviceWorker" in navigator && "PushManager" in window);
    fetch("/api/v1/notifications/push")
      .then(async (response) => {
        const body = await response.json() as PushSettings & { error?: string };
        if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
        if (cancelled) return;
        setPushSettings(body);
        if (body.configured && "serviceWorker" in navigator && "PushManager" in window) {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (!cancelled) setDeviceSubscribed(subscription !== null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : text("requestFailed"));
        }
      });
    return () => { cancelled = true; };
  }, [text]);

  async function togglePush() {
    if (!pushSettings?.publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }
    setPushBusy(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        const response = await fetch("/api/v1/notifications/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        const body = await response.json() as { error?: string };
        if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
        await existing.unsubscribe();
        setDeviceSubscribed(false);
        setPushSettings((current) => current ? { ...current, subscribed: false } : current);
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(text("pushPermissionDenied"));
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(pushSettings.publicKey),
      });
      const json = subscription.toJSON();
      const response = await fetch("/api/v1/notifications/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: json.keys,
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error(body.error ?? text("requestFailed"));
      }
      setDeviceSubscribed(true);
      setPushSettings((current) => current ? { ...current, subscribed: true } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setPushBusy(false);
    }
  }

  async function openNotification(item: NotificationItem) {
    if (!item.is_read) {
      try {
        const response = await fetch("/api/v1/notifications", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: item.id }),
        });
        const body = await response.json() as { error?: string };
        if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
        setData((current) => ({
          ...current,
          unreadCount: Math.max(0, current.unreadCount - 1),
          notifications: current.notifications.map((notification) =>
            notification.id === item.id ? { ...notification, is_read: true } : notification,
          ),
        }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : text("requestFailed"));
        return;
      }
    }
    setOpen(false);
    if (item.link?.startsWith("/") && !item.link.startsWith("//")) router.push(item.link);
  }

  return (
    <div className="notifications-menu">
      <button className="notification-button" type="button" aria-label={text("notifications")}
        aria-expanded={open} aria-controls="notification-list" onClick={() => {
          setOpen((current) => !current);
          if (!open) void load();
        }}>
        ♧{data.unreadCount > 0 && <span className="notification-count">{data.unreadCount > 99 ? "99+" : data.unreadCount}</span>}
      </button>
      {open && (
        <section className="notification-popover" id="notification-list" aria-label={text("notifications")}>
          <div className="notification-popover-heading">
            <strong>{text("notifications")}</strong>
            <span>{data.unreadCount}</span>
          </div>
          {pushSettings && (pushSettings.configured
            ? pushSupported === false
              ? <p className="notification-setup-notice">{text("pushUnsupported")}</p>
              : pushSupported && <button className="notification-push-toggle" type="button" onClick={() => void togglePush()} disabled={pushBusy}>
                {pushBusy ? text("saving") : text(deviceSubscribed ? "disablePushNotifications" : "enablePushNotifications")}
              </button>
            : <p className="notification-setup-notice">{text("pushNotConfigured")}</p>)}
          {error && <p className="form-error" role="alert">{error}</p>}
          {loading ? <p className="muted">{text("loading")}</p> : data.notifications.length ? (
            <div className="notification-items">
              {data.notifications.map((item) => (
                <button className={`notification-item ${item.is_read ? "" : "unread"}`} type="button" key={item.id}
                  onClick={() => void openNotification(item)}>
                  <strong>{item.title}</strong>
                  {item.body && <span>{item.body}</span>}
                  <small>{new Intl.DateTimeFormat(locale === "ht" ? "ht-HT" : locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(item.created_at))}</small>
                </button>
              ))}
            </div>
          ) : !error ? <p className="empty-state">{text("noNotifications")}</p> : null}
        </section>
      )}
    </div>
  );
}
