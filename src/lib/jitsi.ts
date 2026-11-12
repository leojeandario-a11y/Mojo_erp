import "server-only";
import { createJitsiToken } from "@/lib/jitsi-token.mjs";

export interface JitsiConfig {
  domain: string;
  appId: string;
  appSecret: string;
}

export class JitsiConfigurationError extends Error {}

const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i;

export function getJitsiConfig(): JitsiConfig | null {
  const domain = process.env.JITSI_DOMAIN?.trim().toLowerCase() ?? "";
  const appId = process.env.JITSI_APP_ID?.trim() ?? "";
  const appSecret = process.env.JITSI_APP_SECRET?.trim() ?? "";
  if (!domain && !appId && !appSecret) return null;
  if (!domain || !appId || !appSecret) {
    throw new JitsiConfigurationError("Set JITSI_DOMAIN, JITSI_APP_ID, and JITSI_APP_SECRET together.");
  }
  if (!domainPattern.test(domain) || appSecret.length < 32) {
    throw new JitsiConfigurationError("Jitsi requires a valid HTTPS domain and an app secret of at least 32 characters.");
  }
  return { domain, appId, appSecret };
}

export function createMeetingJitsiToken(
  config: JitsiConfig,
  meeting: { id: string; created_by: string },
  user: { id: string; fullName: string },
): { roomName: string; token: string; moderator: boolean } {
  const roomName = `mojo-${meeting.id.replaceAll("-", "")}`;
  const moderator = meeting.created_by === user.id;
  const token = createJitsiToken({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: config.domain,
    roomName,
    userId: user.id,
    displayName: user.fullName,
    moderator,
  });
  return { roomName, token, moderator };
}
