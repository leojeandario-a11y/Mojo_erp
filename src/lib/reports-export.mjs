import { strToU8, zipSync } from "fflate";

function xmlText(value) {
  return Array.from(String(value))
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === 0x9 || codePoint === 0xA || codePoint === 0xD
        || (codePoint >= 0x20 && codePoint <= 0xD7FF)
        || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
        || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
    })
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cell(reference, value, numeric) {
  const text = value == null ? "" : String(value);
  if (numeric && /^-?\d+(?:\.\d+)?$/.test(text) && text.replace(/[-.]/g, "").length <= 15) {
    return `<c r="${reference}"><v>${text}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

function columnName(index) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + (value - 1) % 26) + name;
  }
  return name;
}

function packageFile(content) {
  return strToU8(content);
}

/**
 * @param {{ key: string, header: string }[]} columns
 * @param {Record<string, string | null>[]} rows
 * @param {string} sheetName
 * @param {{ organization: string, title: string, period: string, generatedAt: string } | null} [metadata]
 * @param {{ columns: { key: string, header: string }[], rows: Record<string, string | null>[], sheetName: string }[]} [additionalSheets]
 */
export function buildXlsx(columns, rows, sheetName, metadata = null, additionalSheets = []) {
  if (!columns.length) throw new RangeError("An Excel report needs at least one column.");
  const allSheets = [{ columns, rows, sheetName }, ...additionalSheets];
  if (allSheets.some((sheet) => !sheet.columns.length)) {
    throw new RangeError("Every Excel report sheet needs at least one column.");
  }
  const usedNames = new Set();
  const safeName = (value) => {
    const base = ["[", "]", ":", "*", "?", "/", "\\"]
      .reduce((name, character) => name.replaceAll(character, " "), String(value))
      .trim().slice(0, 31) || "Report";
    let name = base;
    for (let suffix = 2; usedNames.has(name.toLocaleLowerCase()); suffix += 1) {
      const ending = ` (${suffix})`;
      name = `${base.slice(0, 31 - ending.length)}${ending}`;
    }
    usedNames.add(name.toLocaleLowerCase());
    return name;
  };
  const sheets = allSheets.map((sheet, index) => {
    const name = safeName(sheet.sheetName);
    const lastColumn = columnName(sheet.columns.length - 1);
    const headerRow = metadata ? 5 : 1;
    const metadataMerges = metadata && sheet.columns.length > 1
      ? `<mergeCells count="4">${[1, 2, 3, 4].map((row) => `<mergeCell ref="A${row}:${lastColumn}${row}"/>`).join("")}</mergeCells>`
      : "";
    const rowsXml = [
      ...(metadata ? [
        `<row r="1" ht="24" customHeight="1"><c r="A1" s="2" t="inlineStr"><is><t xml:space="preserve">${xmlText(metadata.organization)}</t></is></c></row>`,
        `<row r="2" ht="21" customHeight="1"><c r="A2" s="3" t="inlineStr"><is><t xml:space="preserve">${xmlText(metadata.title)}</t></is></c></row>`,
        `<row r="3"><c r="A3" t="inlineStr"><is><t xml:space="preserve">${xmlText(metadata.period)}</t></is></c></row>`,
        `<row r="4"><c r="A4" t="inlineStr"><is><t xml:space="preserve">${xmlText(metadata.generatedAt)}</t></is></c></row>`,
      ] : []),
      `<row r="${headerRow}">${sheet.columns.map((column, columnIndex) =>
        `<c r="${columnName(columnIndex)}${headerRow}" s="1" t="inlineStr"><is><t xml:space="preserve">${xmlText(column.header)}</t></is></c>`,
      ).join("")}</row>`,
      ...sheet.rows.map((row, rowIndex) => {
        const rowNumber = rowIndex + headerRow + 1;
        return `<row r="${rowNumber}">${sheet.columns.map((column, columnIndex) =>
          cell(`${columnName(columnIndex)}${rowNumber}`, row[column.key], ![
            "entity", "department", "stage", "currency", "campaign", "status", "project",
            "period", "metric", "subject",
          ].includes(column.key)),
        ).join("")}</row>`;
      }),
    ].join("");
    const columnWidths = sheet.columns.map((column, columnIndex) =>
      `<col min="${columnIndex + 1}" max="${columnIndex + 1}" width="${Math.min(36, Math.max(12, column.header.length + 3))}" customWidth="1"/>`,
    ).join("");
    return {
      name,
      index: index + 1,
      lastColumn,
      headerRow,
      rowCount: sheet.rows.length,
      columnWidths,
      rowsXml,
      metadataMerges,
    };
  });
  const sheetContentTypes = sheets.map((sheet) =>
    `<Override PartName="/xl/worksheets/sheet${sheet.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  const workbookSheets = sheets.map((sheet) =>
    `<sheet name="${xmlText(sheet.name)}" sheetId="${sheet.index}" r:id="rId${sheet.index}"/>`,
  ).join("");
  const workbookRelationships = [
    ...sheets.map((sheet) =>
      `<Relationship Id="rId${sheet.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheet.index}.xml"/>`,
    ),
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  ].join("");
  const files = {
    "[Content_Types].xml": packageFile(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 ${sheetContentTypes}
 <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
 <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`),
    "_rels/.rels": packageFile(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`),
    "xl/workbook.xml": packageFile(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <bookViews><workbookView/></bookViews>
 <sheets>${workbookSheets}</sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": packageFile(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 ${workbookRelationships}
</Relationships>`),
    "xl/styles.xml": packageFile(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Calibri"/></font><font><b/><color rgb="FF173858"/><sz val="14"/><name val="Calibri"/></font><font><b/><color rgb="FF173858"/><sz val="12"/><name val="Calibri"/></font></fonts>
 <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173858"/><bgColor indexed="64"/></patternFill></fill></fills>
 <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
 <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
 <cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1" xfId="0"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" applyFont="1" xfId="0"/></cellXfs>
 <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`),
    "docProps/core.xml": packageFile(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <dc:creator>MOJO ERP</dc:creator><dc:title>${xmlText(sheets[0].name)}</dc:title>
 <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`),
  };
  for (const sheet of sheets) {
    files[`xl/worksheets/sheet${sheet.index}.xml`] = packageFile(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.headerRow}" topLeftCell="A${sheet.headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
 <sheetFormatPr defaultRowHeight="15"/>
 <cols>${sheet.columnWidths}</cols>
 <sheetData>${sheet.rowsXml}</sheetData>
<autoFilter ref="A${sheet.headerRow}:${sheet.lastColumn}${sheet.rowCount + sheet.headerRow}"/>
${sheet.metadataMerges}
</worksheet>`);
  }
  return zipSync(files);
}
