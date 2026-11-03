import assert from "node:assert/strict";
import test from "node:test";
import {
  convertCents,
  formatCents,
  formatQuantityThousandths,
  multiplyCentsByQuantity,
  parseCents,
  parseQuantityThousandths,
} from "../src/lib/store-money.mjs";

test("Store currency amounts retain exact cents", () => {
  assert.equal(parseCents("12345678901234.56"), 1234567890123456n);
  assert.equal(formatCents(parseCents("12345678901234.56")), "12345678901234.56");
  assert.equal(formatCents(parseCents("0.07")), "0.07");
});

test("Store quantities retain exact thousandths", () => {
  assert.equal(parseQuantityThousandths("0.125"), 125n);
  assert.equal(formatQuantityThousandths(parseQuantityThousandths("12.300")), "12.300");
  assert.equal(parseQuantityThousandths("0.1") + parseQuantityThousandths("0.2"), 300n);
});

test("Store sale line totals round half-cents away from zero", () => {
  assert.equal(multiplyCentsByQuantity("0.01", "0.500"), 1n);
  assert.equal(multiplyCentsByQuantity("10.00", "1.250"), 1250n);
});

test("Store price conversion uses exact USD rates and cent rounding", () => {
  assert.equal(convertCents(14000n, "0.00714286", "1.00000000"), 100n);
  assert.equal(convertCents(100n, "1.00000000", "0.00714286"), 14000n);
  assert.equal(convertCents(1n, "1.00000000", "2.00000000"), 1n);
});

test("Store money helpers reject invalid precision and exchange rates", () => {
  assert.throws(() => parseCents("1.001"), RangeError);
  assert.throws(() => parseQuantityThousandths("1.0001"), RangeError);
  assert.throws(() => convertCents(100n, "1.0", "0"), RangeError);
});
