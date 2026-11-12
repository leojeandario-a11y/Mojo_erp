"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface VideoRoomAuthorization {
  domain: string;
  roomName: string;
  token: string;
  displayName: string;
  moderator: boolean;
  title: string;
}

interface JitsiMeetApi {
  addEventListener(event: "readyToClose", listener: () => void): void;
  dispose(): void;
}

interface JitsiMeetOptions {
  roomName: string;
  parentNode: HTMLElement;
  width: string;
  height: string;
  jwt: string;
  userInfo: { displayName: string };
  configOverwrite: { prejoinPageEnabled: boolean; startWithAudioMuted: boolean; startWithVideoMuted: boolean };
  lang: string;
}

declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (domain: string, options: JitsiMeetOptions) => JitsiMeetApi;
  }
}

export function CollaborationVideoRoom({
  locale,
  meetingId,
  onClose,
}: {
  locale: Locale;
  meetingId: string;
  onClose: () => void;
}) {
  const [authorization, setAuthorization] = useState<VideoRoomAuthorization | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiMeetApi | null>(null);
  const onCloseRef = useRef(onClose);
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/collaboration/meetings/${meetingId}/room`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as VideoRoomAuthorization & { error?: string };
        if (!response.ok) throw new Error(result.error ?? text("requestFailed"));
        setAuthorization(result);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : text("requestFailed"));
      });
    return () => controller.abort();
  }, [meetingId, text]);

  useEffect(() => {
    if (!authorization || !apiReady || !containerRef.current || !window.JitsiMeetExternalAPI) return;
    const api = new window.JitsiMeetExternalAPI(authorization.domain, {
      roomName: authorization.roomName,
      parentNode: containerRef.current,
      width: "100%",
      height: "100%",
      jwt: authorization.token,
      userInfo: { displayName: authorization.displayName },
      configOverwrite: {
        prejoinPageEnabled: true,
        startWithAudioMuted: true,
        startWithVideoMuted: true,
      },
      lang: locale,
    });
    apiRef.current = api;
    api.addEventListener("readyToClose", () => onCloseRef.current());
    return () => {
      api.dispose();
      apiRef.current = null;
    };
  }, [apiReady, authorization, locale]);

  return (
    <section className="collaboration-video-room" aria-label={authorization?.title ?? text("meetingJoinEmbedded")}>
      {authorization && (
        <Script
          src={`https://${authorization.domain}/external_api.js`}
          strategy="afterInteractive"
          onReady={() => setApiReady(true)}
          onError={() => setError(text("meetingRoomLoadError"))}
        />
      )}
      <header className="collaboration-video-room-heading">
        <div>
          <h4>{authorization?.title ?? text("meetingJoinEmbedded")}</h4>
          <p>{text("meetingRoomPrivacy")}</p>
        </div>
        <button className="button button-secondary" type="button" onClick={onClose}>
          {text("meetingRoomLeave")}
        </button>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!authorization && !error && <p className="muted" role="status">{text("meetingRoomLoading")}</p>}
      {authorization && !apiReady && !error && <p className="muted" role="status">{text("meetingRoomLoading")}</p>}
      <div className="collaboration-video-room-frame" ref={containerRef} />
    </section>
  );
}
