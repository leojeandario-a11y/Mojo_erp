import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration030 = readFileSync(new URL("../db/migrations/030_store_lots_13_15.sql", import.meta.url), "utf8");
const migration034 = readFileSync(new URL("../db/migrations/034_lot16_scheduled_reports.sql", import.meta.url), "utf8");

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
