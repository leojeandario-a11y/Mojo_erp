import test from "node:test";
import assert from "node:assert/strict";
import { getFundReportDateRange } from "../src/lib/emergency-fund-report.mjs";

test("monthly fund report includes leap-day February", () => {
  assert.deepEqual(getFundReportDateRange("monthly", 2024, 2), {
    from: "2024-02-01",
    toExclusive: "2024-03-01",
    to: "2024-02-29",
  });
});

test("quarterly fund report uses the correct three-month window", () => {
  assert.deepEqual(getFundReportDateRange("quarterly", 2026, 4), {
    from: "2026-10-01",
    toExclusive: "2027-01-01",
    to: "2026-12-31",
  });
});

test("annual fund report spans exactly the selected calendar year", () => {
  assert.deepEqual(getFundReportDateRange("annual", 2025, undefined), {
    from: "2025-01-01",
    toExclusive: "2026-01-01",
    to: "2025-12-31",
  });
});

test("invalid fund report periods are rejected", () => {
  assert.throws(() => getFundReportDateRange("monthly", 2025, undefined), RangeError);
  assert.throws(() => getFundReportDateRange("quarterly", 2025, 5), RangeError);
  assert.throws(() => getFundReportDateRange("annual", 2025, 1), RangeError);
  assert.throws(() => getFundReportDateRange("annual", 1999, undefined), RangeError);
});
