import test from "node:test";
import assert from "node:assert/strict";
import { csvCell } from "../src/lib/csv.mjs";

test("CSV fields are quoted and internal quotes are escaped", () => {
  assert.equal(csvCell('A "quoted" value'), '"A ""quoted"" value"');
});

test("CSV formula prefixes are neutralized", () => {
  for (const value of ["=1+1", "+SUM(A1:A2)", "-2+3", "@SUM(A:A)", " \t=HYPERLINK(\"x\")"]) {
    assert.equal(csvCell(value).startsWith("\"'"), true);
  }
});

test("CSV empty values stay empty cells", () => {
  assert.equal(csvCell(null), '""');
});
