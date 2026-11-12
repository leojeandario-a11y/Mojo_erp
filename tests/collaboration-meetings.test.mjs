import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const meetingsRoute = readFileSync(
  new URL("../src/app/api/v1/collaboration/meetings/route.ts", import.meta.url),
  "utf8",
);
const meetingsComponent = readFileSync(
  new URL("../src/components/collaboration-meetings.tsx", import.meta.url),
  "utf8",
);
const roomRoute = readFileSync(
  new URL("../src/app/api/v1/collaboration/meetings/[meetingId]/room/route.ts", import.meta.url),
  "utf8",
);
const videoRoomComponent = readFileSync(
  new URL("../src/components/collaboration-video-room.tsx", import.meta.url),
  "utf8",
);
const translations = readFileSync(new URL("../src/lib/i18n.ts", import.meta.url), "utf8");

test("directors can schedule a meeting with no invitees besides the organizer", () => {
  assert.match(meetingsRoute, /attendeeIds:\s*z\.array\(z\.uuid\(\)\)\.max\(100\)/);
  assert.match(meetingsRoute, /const attendeeIds = \[\.\.\.new Set\(\[actor\.id, \.\.\.parsed\.data\.attendeeIds\]\)\]/);
  assert.match(meetingsRoute, /attendee\.id !== actor\.id/);
  assert.match(meetingsRoute, /WHERE invitee_id <> \$5/);
  assert.match(meetingsComponent, /type="submit" disabled=\{saving\}/);
  assert.match(translations, /meetingScheduled:\s*"Réunion planifiée\."/);
  assert.match(translations, /meetingScheduled:\s*"Reyinyon an planifye\."/);
  assert.match(translations, /meetingScheduled:\s*"Meeting scheduled\."/);
});

test("embedded Jitsi rooms require an active meeting invitation and issue uncached room tokens", () => {
  assert.match(roomRoute, /meeting\.created_by = \$2 OR invitation\.user_id = \$2/);
  assert.match(roomRoute, /invitee_response === "declined"/);
  assert.match(roomRoute, /meeting\.status !== "scheduled"/);
  assert.match(roomRoute, /Cache-Control.*no-store/);
  assert.match(videoRoomComponent, /\/room`/);
  assert.match(videoRoomComponent, /new window\.JitsiMeetExternalAPI/);
});
