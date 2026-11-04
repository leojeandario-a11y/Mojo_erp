import test from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { buildXlsx } from "../src/lib/reports-export.mjs";

test("builds an XLSX workbook with a frozen header and typed numeric cells", () => {
  const archive = unzipSync(buildXlsx(
    [{ key: "period", header: "Period" }, { key: "amount", header: "Amount" }],
    [{ period: "2026-01", amount: "123.45" }],
    "Finance",
  ));
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  const workbook = strFromU8(archive["xl/workbook.xml"]);
  assert.match(workbook, /<sheet name="Finance" sheetId="1" r:id="rId1"\/>/);
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2"/);
  assert.match(sheet, /<c r="B2"><v>123\.45<\/v><\/c>/);
  assert.match(sheet, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">2026-01<\/t><\/is><\/c>/);
});

test("escapes untrusted report content and never treats text as a formula", () => {
  const archive = unzipSync(buildXlsx(
    [{ key: "campaign", header: "Campaign" }],
    [{ campaign: `=1+1 & <script> "quoted"` }],
    "Marketing / FY",
  ));
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  const workbook = strFromU8(archive["xl/workbook.xml"]);
  assert.ok(workbook.includes('<sheet name="Marketing   FY"'));
  assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">=1\+1 &amp; &lt;script&gt; &quot;quoted&quot;<\/t><\/is>/);
  assert.doesNotMatch(sheet, /<f>/);
});

test("adds a localized organization and period header to branded Excel exports", () => {
  const archive = unzipSync(buildXlsx(
    [{ key: "period", header: "Période" }, { key: "amount", header: "Montant" }],
    [{ period: "2026-01", amount: "123.45" }],
    "Finance",
    {
      organization: "MoJoPIKtures",
      title: "Finances & rapports",
      period: "Du 1 janvier au 31 janvier",
      generatedAt: "Généré le 31 janvier",
    },
  ));
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /<pane ySplit="5" topLeftCell="A6"/);
  assert.match(sheet, /<mergeCell ref="A1:B1"\/>/);
  assert.ok(sheet.includes("Finances &amp; rapports"));
  assert.match(sheet, /<c r="A5" s="1"/);
  assert.match(sheet, /<c r="B6"><v>123\.45<\/v><\/c>/);
  assert.match(sheet, /<autoFilter ref="A5:B6"\/>/);
});

test("preserves long decimal values as strings and rejects empty reports", () => {
  const archive = unzipSync(buildXlsx(
    [{ key: "amount", header: "Amount" }],
    [{ amount: "1234567890123456.78" }],
    "Finance",
  ));
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">1234567890123456\.78<\/t>/);
  assert.throws(() => buildXlsx([], [], "Empty"), RangeError);
});
