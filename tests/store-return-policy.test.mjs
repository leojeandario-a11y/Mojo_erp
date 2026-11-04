import test from "node:test";
import assert from "node:assert/strict";
import { isWithinStoreReturnWindow } from "../src/lib/store-return-policy.mjs";

test("Store returns are allowed for seven calendar days including the purchase day", () => {
  assert.equal(isWithinStoreReturnWindow("2026-11-04", "2026-11-04"), true);
  assert.equal(isWithinStoreReturnWindow("2026-11-04", "2026-11-10"), true);
  assert.equal(isWithinStoreReturnWindow("2026-11-04", "2026-11-11"), false);
});

test("Store returns reject future or invalid sale dates", () => {
  assert.equal(isWithinStoreReturnWindow("2026-11-05", "2026-11-04"), false);
  assert.equal(isWithinStoreReturnWindow("2026-02-30", "2026-11-04"), false);
  assert.equal(isWithinStoreReturnWindow("invalid", "2026-11-04"), false);
});
