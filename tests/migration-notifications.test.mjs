import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration030 = readFileSync(new URL("../db/migrations/030_store_lots_13_15.sql", import.meta.url), "utf8");
const migration034 = readFileSync(new URL("../db/migrations/034_lot16_scheduled_reports.sql", import.meta.url), "utf8");
const migration037 = readFileSync(new URL("../db/migrations/037_lot18_collaboration_foundation.sql", import.meta.url), "utf8");
const migration038 = readFileSync(new URL("../db/migrations/038_lot18_meetings_chat.sql", import.meta.url), "utf8");
const migration039 = readFileSync(new URL("../db/migrations/039_lot18_directors_chat_membership.sql", import.meta.url), "utf8");
const migration040 = readFileSync(new URL("../db/migrations/040_lot18_chat_room_creator_access.sql", import.meta.url), "utf8");
const migration041 = readFileSync(new URL("../db/migrations/041_lot18_direct_chat_membership.sql", import.meta.url), "utf8");

function notificationKinds(migration) {
  const constraint = migration.match(/ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check[\s\S]*?CHECK \(kind IN\s*\(([\s\S]*?)\)\);/i);
  assert.ok(constraint, "migration must define the notifications kind constraint");
  return new Set([...constraint[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]));
}

test("scheduled reports migration preserves all Store and fund notification kinds", () => {
  const previousKinds = notificationKinds(migration030);
  const nextKinds = notificationKinds(migration034);

  for (const kind of previousKinds) {
    assert.ok(nextKinds.has(kind), `migration 034 must keep notification kind "${kind}"`);
  }
  assert.ok(nextKinds.has("scheduled_report"));
});

test("collaboration migration preserves existing notification kinds and adds collaboration events", () => {
  const previousKinds = notificationKinds(migration034);
  const nextKinds = notificationKinds(migration037);

  for (const kind of previousKinds) {
    assert.ok(nextKinds.has(kind), `migration 037 must keep notification kind "${kind}"`);
  }
  for (const kind of ["announcement", "meeting_invitation", "meeting_update", "meeting_response", "chat_message"]) {
    assert.ok(nextKinds.has(kind), `migration 037 must add notification kind "${kind}"`);
  }
});

test("collaboration migration restricts announcements and queues notification emails", () => {
  assert.match(migration037, /ALTER TABLE collaboration_announcements ENABLE ROW LEVEL SECURITY/);
  assert.match(migration037, /ALTER TABLE collaboration_announcement_recipients ENABLE ROW LEVEL SECURITY/);
  assert.match(migration037, /CREATE TRIGGER trg_notification_email_queue\s+AFTER INSERT ON notifications/);
  assert.match(migration037, /CHECK \(audience_type IN \('all', 'department', 'selected'\)\)/);
});

test("Lot 18 meetings and chat enforce director and participant access", () => {
  assert.match(migration038, /CREATE TABLE collaboration_meetings/);
  assert.match(migration038, /CREATE TABLE collaboration_meeting_invitees/);
  assert.match(migration038, /CREATE TABLE collaboration_chat_rooms/);
  assert.match(migration038, /CREATE TABLE collaboration_chat_members/);
  assert.match(migration038, /CREATE TABLE collaboration_chat_messages/);
  assert.match(migration038, /collaboration_user_is_director\(app_user_id\(\)\)/);
  assert.match(migration038, /collaboration_chat_member\(room_id, app_user_id\(\)\)/);
  assert.match(migration038, /ALTER TABLE collaboration_meetings ENABLE ROW LEVEL SECURITY/);
  assert.match(migration038, /ALTER TABLE collaboration_chat_messages ENABLE ROW LEVEL SECURITY/);
});

test("chat message notifications stay in-app and do not enqueue email", () => {
  assert.match(migration038, /IF NEW\.kind <> 'chat_message' THEN/);
  assert.match(migration038, /CREATE OR REPLACE FUNCTION queue_notification_email\(\)/);
});

test("directors chat membership cannot be extended to non-directors", () => {
  assert.match(migration039, /DROP POLICY IF EXISTS collaboration_chat_members_add/);
  assert.match(migration039, /room\.kind = 'directors'[\s\S]*collaboration_user_is_director\(user_id\)/);
  assert.match(migration039, /room\.kind = 'direct'[\s\S]*room\.created_by::text = ANY\(string_to_array\(room\.room_key, ':'\)\)/);
});

test("chat room creators can receive the inserted room under row-level security", () => {
  assert.match(migration040, /DROP POLICY IF EXISTS collaboration_chat_rooms_read/);
  assert.match(migration040, /created_by = app_user_id\(\)[\s\S]*collaboration_chat_member\(id, app_user_id\(\)\)/);
});

test("direct chat membership is restricted to the two identities encoded in its room key", () => {
  assert.match(migration041, /cardinality\(string_to_array\(room\.room_key, ':'\)\) = 3/);
  assert.match(migration041, /room\.created_by::text = ANY\(string_to_array\(room\.room_key, ':'\)\)/);
  assert.match(migration041, /user_id::text = ANY\(string_to_array\(room\.room_key, ':'\)\)/);
});
