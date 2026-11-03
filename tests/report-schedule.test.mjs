import test from "node:test";
import assert from "node:assert/strict";
import { nextReportRun } from "../src/lib/report-schedule.mjs";

test("schedules daily reports for the next 08:00 UTC", () => {
  assert.equal(
    nextReportRun("daily", new Date("2026-11-06T07:59:00Z")).toISOString(),
    "2026-11-06T08:00:00.000Z",
  );
  assert.equal(
    nextReportRun("daily", new Date("2026-11-06T08:00:00Z")).toISOString(),
    "2026-11-07T08:00:00.000Z",
  );
});

test("schedules weekly reports for the next Monday at 08:00 UTC", () => {
  assert.equal(
    nextReportRun("weekly", new Date("2026-11-06T09:00:00Z")).toISOString(),
    "2026-11-09T08:00:00.000Z",
  );
  assert.equal(
    nextReportRun("weekly", new Date("2026-11-09T08:00:00Z")).toISOString(),
    "2026-11-16T08:00:00.000Z",
  );
});

test("schedules monthly reports for the first day of next month at 08:00 UTC", () => {
  assert.equal(
    nextReportRun("monthly", new Date("2026-11-30T12:00:00Z")).toISOString(),
    "2026-12-01T08:00:00.000Z",
  );
});

test("rejects unsupported frequencies", () => {
  assert.throws(() => nextReportRun("hourly"), RangeError);
});
