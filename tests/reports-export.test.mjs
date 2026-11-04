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
  assert.match(workbook, /<bookViews><workbookView\/><\/bookViews>/);
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
  assert.match(sheet, /<autoFilter ref="A5:B6"\/>\s*<mergeCells count="4">/);
});

test("exports an additional summary sheet with independent data and workbook relationships", () => {
  const archive = unzipSync(buildXlsx(
    [{ key: "period", header: "Period" }, { key: "income_usd", header: "Income USD" }],
    [{ period: "2026-01", income_usd: "123.45" }],
    "Finance",
    {
      organization: "MoJoPIKtures",
      title: "Finance",
      period: "2026-01",
      generatedAt: "Generated",
    },
    [{
      sheetName: "Financial summary",
      columns: [{ key: "metric", header: "Metric" }, { key: "balance", header: "Balance" }],
      rows: [{ metric: "Treasury", balance: "456.78" }],
    }],
  ));
  const workbook = strFromU8(archive["xl/workbook.xml"]);
  const relationships = strFromU8(archive["xl/_rels/workbook.xml.rels"]);
  const summary = strFromU8(archive["xl/worksheets/sheet2.xml"]);
  const contentTypes = strFromU8(archive["[Content_Types].xml"]);
  assert.match(workbook, /<sheet name="Finance" sheetId="1" r:id="rId1"\/>/);
  assert.match(workbook, /<sheet name="Financial summary" sheetId="2" r:id="rId2"\/>/);
  assert.match(relationships, /Id="rId2".*Target="worksheets\/sheet2\.xml"/);
  assert.match(relationships, /Id="rId3".*Target="styles\.xml"/);
  assert.match(summary, /<c r="A5" s="1" t="inlineStr"><is><t xml:space="preserve">Metric<\/t>/);
  assert.match(summary, /<c r="A6" t="inlineStr"><is><t xml:space="preserve">Treasury<\/t>/);
  assert.match(summary, /<c r="B6"><v>456\.78<\/v><\/c>/);
  assert.match(contentTypes, /PartName="\/xl\/worksheets\/sheet2\.xml"/);
});

test("keeps all finance and summary rows in the exported workbook", () => {
  const financialSummary = Array.from({ length: 28 }, (_, index) => ({
    entity: `Entity ${index + 1}`,
    metric: "treasury",
    subject: `Account ${index + 1}`,
    currency: "USD",
    balance: `${index + 1}.00`,
  }));
  const archive = unzipSync(buildXlsx(
    [{ key: "period", header: "Period" }, { key: "income_usd", header: "Income USD" }],
    [
      { period: "2026-10", income_usd: "12.00" },
      { period: "2026-11", income_usd: "34.00" },
    ],
    "Finance",
    {
      organization: "MoJoPIKtures",
      title: "Finance",
      period: "2025-12-01 – 2026-11-04",
      generatedAt: "Generated",
    },
    [{
      sheetName: "Financial summary",
      columns: [{ key: "entity", header: "Entity" }, { key: "balance", header: "Balance" }],
      rows: financialSummary,
    }],
  ));
  const finance = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  const summary = strFromU8(archive["xl/worksheets/sheet2.xml"]);

  assert.equal([...finance.matchAll(/<row r=/g)].length, 7);
  assert.match(finance, /<c r="B7"><v>34\.00<\/v><\/c>/);
  assert.equal([...summary.matchAll(/<row r=/g)].length, 33);
  assert.match(summary, /<c r="A33" t="inlineStr"><is><t xml:space="preserve">Entity 28<\/t>/);
  assert.match(summary, /<c r="B33"><v>28\.00<\/v><\/c>/);
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
