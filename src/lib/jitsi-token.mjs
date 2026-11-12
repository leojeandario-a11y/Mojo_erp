import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * @param {{
 *   appId: string;
 *   appSecret: string;
 *   domain: string;
 *   roomName: string;
 *   userId: string;
 *   displayName: string;
 *   moderator: boolean;
 * }} options
 */
export function createJitsiToken(options) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    aud: "jitsi",
    iss: options.appId,
    sub: options.domain,
    room: options.roomName,
    iat: issuedAt,
    nbf: issuedAt - 10,
    exp: issuedAt + 60 * 60,
    context: {
      user: {
        id: options.userId,
        name: options.displayName,
        moderator: options.moderator,
      },
    },
  })).toString("base64url");
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", options.appSecret).update(unsignedToken).digest("base64url");

  return `${unsignedToken}.${signature}`;
}
