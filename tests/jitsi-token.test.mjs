import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createJitsiToken } from "../src/lib/jitsi-token.mjs";

test("Jitsi tokens are signed, scoped to one room, and expire after one hour", () => {
  const appSecret = "a".repeat(64);
  const token = createJitsiToken({
    appId: "mojo-erp",
    appSecret,
    domain: "meet.example.com",
    roomName: "mojo-room-123",
    userId: "user-123",
    displayName: "Test User",
    moderator: true,
  });
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  const expectedSignature = createHmac("sha256", appSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  assert.deepEqual(header, { alg: "HS256", typ: "JWT" });
  assert.equal(signature, expectedSignature);
  assert.equal(payload.aud, "jitsi");
  assert.equal(payload.iss, "mojo-erp");
  assert.equal(payload.sub, "meet.example.com");
  assert.equal(payload.room, "mojo-room-123");
  assert.equal(payload.context.user.moderator, true);
  assert.equal(payload.context.user.name, "Test User");
  assert.equal(payload.exp - payload.iat, 3600);
});
