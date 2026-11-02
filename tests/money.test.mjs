import assert from "node:assert/strict";
import test from "node:test";
import { convertMoney, formatExchangeRate, formatMoney, invertExchangeRate } from "../src/lib/money.mjs";

test("converts USD to HTG exactly using the current rate", () => {
  assert.equal(convertMoney("500.00", "USD", "HTG", "132.50000000"), "66250.00");
});

test("converts HTG to USD and rounds to cents", () => {
  assert.equal(convertMoney("20000.00", "HTG", "USD", "132.50000000"), "150.94");
});

test("totals a USD and HTG expense consistently in either display currency", () => {
  const usdHtgExpenseUsdCents = BigInt(convertMoney("20000.00", "HTG", "USD", "140.00000000").replace(".", ""));
  const usdHtgExpenseHtgCents = BigInt(convertMoney("500.00", "USD", "HTG", "140.00000000").replace(".", ""));
  const usdTotalCents = 50000n + usdHtgExpenseUsdCents;
  const htgTotalCents = 2000000n + usdHtgExpenseHtgCents;

  assert.equal(`${usdTotalCents / 100n}.${String(usdTotalCents % 100n).padStart(2, "0")}`, "642.86");
  assert.equal(`${htgTotalCents / 100n}.${String(htgTotalCents % 100n).padStart(2, "0")}`, "90000.00");
});

test("rounds converted half-cents away from zero", () => {
  assert.equal(convertMoney("0.01", "USD", "HTG", "1.50000000"), "0.02");
  assert.equal(convertMoney("-0.01", "USD", "HTG", "1.50000000"), "-0.02");
});

test("does not require a rate when the currencies match", () => {
  assert.equal(convertMoney("12.30", "HTG", "HTG", null), "12.30");
});

test("returns null when conversion has no exchange rate", () => {
  assert.equal(convertMoney("12.30", "USD", "HTG", null), null);
});

test("formats large monetary values without losing cents", () => {
  const formatted = formatMoney("123456789012345.67", "USD", "en");
  assert.match(formatted, /123,456,789,012,345\.67/);
});

test("formats exchange rates with locale-specific decimal separators", () => {
  assert.equal(formatExchangeRate("132.50000000", "en"), "132.50");
  assert.equal(formatExchangeRate("132.56780000", "fr"), "132,5678");
  assert.throws(() => formatExchangeRate("0", "en"), RangeError);
});

test("inverts exchange rates at exact database precision", () => {
  assert.equal(invertExchangeRate("132.50000000"), "0.00754717");
  assert.equal(invertExchangeRate("3.00000000"), "0.33333333");
  assert.throws(() => invertExchangeRate("0"), RangeError);
});

test("rejects amounts and rates with unsupported precision", () => {
  assert.throws(() => convertMoney("1.001", "USD", "HTG", "132.5"), RangeError);
  assert.throws(() => convertMoney("1.00", "USD", "HTG", "0"), RangeError);
});
