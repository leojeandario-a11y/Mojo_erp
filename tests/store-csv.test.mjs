import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../src/lib/store-csv.mjs";

test("Store CSV parser handles quoted commas, escaped quotes, and CRLF rows", () => {
  assert.deepEqual(parseCsv('sku,name\r\n1,"Tea, green"\r\n2,"He said ""hello"""'), [
    ["sku", "name"],
    ["1", "Tea, green"],
    ["2", 'He said "hello"'],
  ]);
});

test("Store CSV parser preserves embedded newlines and rejects incomplete quotes", () => {
  assert.deepEqual(parseCsv('sku,name\n1,"Tea\nleaves"'), [
    ["sku", "name"],
    ["1", "Tea\nleaves"],
  ]);
  assert.throws(() => parseCsv('sku,name\n1,"Tea'), /unterminated quoted field/);
});
