/**
 * Minimal dependency-free .xlsx writer (stored-zip OOXML, single sheet).
 * Shared by tax and expense exports; strings become inline text cells,
 * numbers become numeric cells so Excel can SUM them.
 */
export type XlsxCell = string | number;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Rows are cell arrays; the first row is treated as the (frozen) header row. */
export function buildXlsx(rows: XlsxCell[][], sheetName: string): Buffer {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 1);
  const sheetRows = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
      const ref = `${columnName(c + 1)}${r + 1}`;
      return typeof cell === 'number'
        ? `<c r="${ref}"><v>${cell}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;
    }).join('')}</row>`)
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols><col min="1" max="${columnCount}" width="22" customWidth="1"/></cols>`
    + `<sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  return zipStore({
    '[Content_Types].xml': Buffer.from(CONTENT_TYPES),
    '_rels/.rels': Buffer.from(RELS),
    'xl/workbook.xml': Buffer.from(workbook),
    'xl/_rels/workbook.xml.rels': Buffer.from(WORKBOOK_RELS),
    'xl/worksheets/sheet1.xml': Buffer.from(sheet),
  });
}

function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index: number): string {
  let name = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(((n - 1) % 26) + 65) + name;
  }
  return name;
}

// ponytail: stored (uncompressed) entries — Excel accepts them and it keeps this file dependency-free.
function zipStore(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function crc32(buf: Buffer): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

let tableCache: number[] | null = null;
function crc32Table(): number[] {
  if (tableCache) return tableCache;
  tableCache = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  return tableCache;
}
