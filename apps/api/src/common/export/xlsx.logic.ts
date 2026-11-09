import { deflateRawSync } from 'node:zlib';
import { formatThaiExportDate } from './thai-date.logic';

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
  checkSheet(rows, sheetName);
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
<sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
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
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[\t\r\n]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function columnName(index: number): string {
  let name = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(((n - 1) % 26) + 65) + name;
  }
  return name;
}

// ponytail: stored (uncompressed) entries — Excel accepts them and it keeps this file dependency-free.
export function zipStore(files: Record<string, Buffer>, compress = false): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const nameFlags = /[^\x00-\x7f]/.test(name) ? 0x800 : 0; // UTF-8 names, including Thai evidence numbers.
    const packed = compress ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(nameFlags, 6);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(nameFlags, 8);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
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

/**
 * `link` is a real cell hyperlink (works in Excel, Numbers, Google Sheets and LibreOffice, unlike a HYPERLINK formula):
 * `#'Sheet'!A2` jumps inside the workbook; anything else is a relative file path next to the workbook.
 */
export type WorkbookCell = XlsxCell | null | { value: XlsxCell | null; style?: number; formula?: string; link?: string };
export type WorkbookSheet = {
  name: string; rows: WorkbookCell[][]; widths?: number[]; freezeRows?: number; filter?: string;
  merges?: string[]; printArea?: string; charts?: WorkbookChart[]; autoHeightRows?: number[];
  /** Every row grows with its wrapped text instead of a fixed height. */
  autoHeight?: boolean; showGrid?: boolean;
};
export type WorkbookChart = {
  title: string; kind: 'doughnut' | 'bar'; labels: string[]; values: (number | null)[];
  labelRange: string; valueRange: string; from: [number, number]; to: [number, number]; colors?: string[];
};
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006';
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const relation = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${OFFICE_NS}/${type}" Target="${xml(target)}"/>`;
const relationships = (entries: string[]) => `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.join('')}</Relationships>`;
const override = (part: string, kind: string) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${kind}+xml"/>`;

/** Thai text dates stay readable in viewers that ignore Buddhist-calendar number formats. */
export function xlsxThaiDate(at: string | Date | null, withTime = false): string | null {
  if (at === null) return null;
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) throw new Error('XLSX_INVALID_DATE');
  const date = new Date(ms), day = formatThaiExportDate(date.toISOString());
  return withTime ? `${day} ${new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)} น.` : day;
}

function checkSheet(rows: WorkbookCell[][], name: string) {
  if (!name || name.length > 31 || /[\\/?*\[\]:\u0000-\u001F]/.test(name) || name.startsWith("'") || name.endsWith("'")) throw new Error('XLSX_INVALID_SHEET');
  if (rows.length > 1_048_576 || rows.some(row => row.length > 16_384)) throw new Error('XLSX_LIMIT');
  for (const row of rows) for (const cell of row) {
    const value = cell && typeof cell === 'object' ? cell.value : cell;
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('XLSX_INVALID_NUMBER');
    if (typeof value === 'string' && value.length > 32_767) throw new Error('XLSX_LIMIT');
  }
}
function workbookCell(cell: WorkbookCell, ref: string): string {
  if (cell === null) return '';
  const typed = typeof cell === 'object' ? cell : { value: cell };
  const style = typed.style ?? 0, value = typed.value;
  if (!Number.isInteger(style) || style < 0 || style > 15) throw new Error('XLSX_INVALID_STYLE');
  if (typed.formula !== undefined) {
    if (!typed.formula || typed.formula.includes('[') || typed.formula.length > 8192) throw new Error('XLSX_INVALID_FORMULA');
    return `<c r="${ref}" s="${style}"${typeof value === 'number' ? '' : ' t="str"'}><f>${xml(typed.formula)}</f><v>${xml(value)}</v></c>`;
  }
  // A figure that is not known yet stays blank but keeps its look (a dashboard card keeps its box).
  if (value === null) return typed.style ? `<c r="${ref}" s="${style}"/>` : '';
  return typeof value === 'number' ? `<c r="${ref}" s="${style}"><v>${value}</v></c>`
    : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

/** Typed/styled multi-sheet OOXML. Every formula and chart carries server-computed cached values. */
export function buildWorkbook(sheets: WorkbookSheet[], limits: { maxBytes?: number } = {}): Buffer {
  if (!sheets.length || new Set(sheets.map(sheet => sheet.name.toLocaleLowerCase())).size !== sheets.length) throw new Error('XLSX_INVALID_SHEET');
  const files: Record<string, Buffer> = { '_rels/.rels': Buffer.from(RELS), 'xl/styles.xml': Buffer.from(workbookStyles()) };
  const types = [override('xl/workbook.xml', 'spreadsheetml.sheet.main'), override('xl/styles.xml', 'spreadsheetml.styles')];
  const workbookRelations = [relation('styles', 'styles', 'styles.xml')];
  sheets.forEach((sheet, i) => {
    checkSheet(sheet.rows, sheet.name);
    const id = i + 1, freeze = sheet.freezeRows ?? 0, widths = sheet.widths ?? Array.from({ length: Math.max(1, ...sheet.rows.map(row => row.length)) }, () => 22);
    if (widths.some(width => !Number.isFinite(width) || width <= 0 || width > 255)) throw new Error('XLSX_INVALID_WIDTH');
    const links: string[] = [], linkRelations: string[] = [];
    sheet.rows.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell || typeof cell !== 'object' || cell.link === undefined) return;
      const ref = `${columnName(c + 1)}${r + 1}`, link = cell.link;
      if (link.startsWith('#')) { links.push(`<hyperlink ref="${ref}" location="${xml(link.slice(1))}" display="${xml(cell.value)}"/>`); return; }
      if (!link || /^(?:[a-z]+:|[/\\])|(?:^|[/\\])\.\.(?:[/\\]|$)/i.test(link)) throw new Error('XLSX_INVALID_LINK');
      const relationId = `link${linkRelations.length + 1}`;
      linkRelations.push(`<Relationship Id="${relationId}" Type="${OFFICE_NS}/hyperlink" Target="${xml(link.replace(/[%# ?]/g, encodeURIComponent))}" TargetMode="External"/>`);
      links.push(`<hyperlink ref="${ref}" r:id="${relationId}" display="${xml(cell.value)}"/>`);
    }));
    const data = sheet.rows.map((row, r) => `<row r="${r + 1}"${sheet.autoHeight || sheet.autoHeightRows?.includes(r + 1) ? '' : ` ht="${r + 1 === freeze && sheet.filter ? 72 : 24}" customHeight="1"`}>${row.map((cell, c) => workbookCell(cell, `${columnName(c + 1)}${r + 1}`)).join('')}</row>`).join('');
    const sheetXml = `${declaration}<worksheet xmlns="${MAIN_NS}" xmlns:r="${OFFICE_NS}">`
      + (sheet.printArea ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '')
      + `<sheetViews><sheetView${sheet.showGrid ? '' : ' showGridLines="0"'} workbookViewId="0">`
      + (freeze ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/>` : '')
      + `</sheetView></sheetViews><cols>${widths.map((width, c) => `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData>`
      + (sheet.filter ? `<autoFilter ref="${xml(sheet.filter)}"/>` : '')
      + (sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(ref => `<mergeCell ref="${xml(ref)}"/>`).join('')}</mergeCells>` : '')
      + (links.length ? `<hyperlinks>${links.join('')}</hyperlinks>` : '')
      + (sheet.printArea ? '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/>' : '')
      + (sheet.charts?.length ? '<drawing r:id="drawing"/>' : '') + '</worksheet>';
    files[`xl/worksheets/sheet${id}.xml`] = Buffer.from(sheetXml);
    types.push(override(`xl/worksheets/sheet${id}.xml`, 'spreadsheetml.worksheet'));
    workbookRelations.push(relation(`sheet${id}`, 'worksheet', `worksheets/sheet${id}.xml`));
    if (linkRelations.length && !sheet.charts?.length) files[`xl/worksheets/_rels/sheet${id}.xml.rels`] = Buffer.from(relationships(linkRelations));
    if (sheet.charts?.length) {
      const chartRelations: string[] = [];
      files[`xl/worksheets/_rels/sheet${id}.xml.rels`] = Buffer.from(relationships([relation('drawing', 'drawing', `../drawings/drawing${id}.xml`), ...linkRelations]));
      const anchors = sheet.charts.map((chart, n) => {
        const chartName = id === 1 ? `chart${n + 1}` : `chart${id}_${n + 1}`;
        files[`xl/charts/${chartName}.xml`] = Buffer.from(chartXml(chart));
        types.push(override(`xl/charts/${chartName}.xml`, 'drawingml.chart'));
        chartRelations.push(relation(`chart${n + 1}`, 'chart', `../charts/${chartName}.xml`));
        const position = (key: string, [col, row]: [number, number]) => `<xdr:${key}><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${key}>`;
        return `<xdr:twoCellAnchor>${position('from', chart.from)}${position('to', chart.to)}<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${n + 1}" name="${xml(chart.title)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${DRAWING_NS}/chart"><c:chart xmlns:c="${DRAWING_NS}/chart" r:id="chart${n + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
      });
      files[`xl/drawings/drawing${id}.xml`] = Buffer.from(`${declaration}<xdr:wsDr xmlns:xdr="${DRAWING_NS}/spreadsheetDrawing" xmlns:a="${DRAWING_NS}/main" xmlns:r="${OFFICE_NS}">${anchors.join('')}</xdr:wsDr>`);
      files[`xl/drawings/_rels/drawing${id}.xml.rels`] = Buffer.from(relationships(chartRelations));
      types.push(override(`xl/drawings/drawing${id}.xml`, 'drawing'));
    }
  });
  const areas = sheets.flatMap((sheet, i) => sheet.printArea ? [`<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${xml(sheet.name)}'!${xml(sheet.printArea)}</definedName>`] : []);
  files['xl/workbook.xml'] = Buffer.from(`${declaration}<workbook xmlns="${MAIN_NS}" xmlns:r="${OFFICE_NS}"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="sheet${i + 1}"/>`).join('')}</sheets><definedNames>${areas.join('')}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = Buffer.from(relationships(workbookRelations));
  files['[Content_Types].xml'] = Buffer.from(`${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${types.join('')}</Types>`);
  const result = zipStore(files, true);
  if (result.length > (limits.maxBytes ?? 20 * 1024 * 1024)) throw new Error('XLSX_LIMIT');
  return result;
}

function chartXml(chart: WorkbookChart): string {
  if (chart.labels.length !== chart.values.length || chart.values.some(value => value !== null && !Number.isFinite(value))) throw new Error('XLSX_INVALID_CHART');
  const colors = chart.colors ?? ['14532D', 'F59E0B', '6B7280', 'D1D5DB'];
  if (colors.some(color => !/^[0-9A-F]{6}$/i.test(color))) throw new Error('XLSX_INVALID_CHART');
  const cache = (kind: 'str' | 'num', values: (string | number | null)[]) => `<c:${kind}Cache>${kind === 'num' ? '<c:formatCode>General</c:formatCode>' : ''}<c:ptCount val="${values.length}"/>${values.map((value, i) => value === null ? '' : `<c:pt idx="${i}"><c:v>${xml(value)}</c:v></c:pt>`).join('')}</c:${kind}Cache>`;
  const ser = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(chart.title)}</c:v></c:tx>${chart.values.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:spPr><a:solidFill><a:srgbClr val="${colors[i % colors.length]}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="14532D"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join('')}<c:cat><c:strRef><c:f>${xml(chart.labelRange)}</c:f>${cache('str', chart.labels)}</c:strRef></c:cat><c:val><c:numRef><c:f>${xml(chart.valueRange)}</c:f>${cache('num', chart.values)}</c:numRef></c:val></c:ser>`;
  const axes = `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:numFmt formatCode="#,##0.##" sourceLinked="0"/><c:crossAx val="1"/><c:crossBetween val="between"/></c:valAx>`;
  return `${declaration}<c:chartSpace xmlns:c="${DRAWING_NS}/chart" xmlns:a="${DRAWING_NS}/main"><c:lang val="th-TH"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/>`
    + (chart.kind === 'doughnut' ? `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:holeSize val="65"/></c:doughnutChart>` : `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${ser}<c:axId val="1"/><c:axId val="2"/></c:barChart>${axes}`)
    + '</c:plotArea><c:legend><c:legendPos val="b"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>';
}
function workbookStyles(): string {
  const formats = ['#,##0.00;[Red]-#,##0.00', '[$-107041E]d mmm bbbb', '[$-107041E]d mmm bbbb hh:mm" น."', '0.0%'];
  const xfs = [[0, 0, 0], [1, 2, 0], [1, 2, 0], [0, 0, 164], [0, 0, 165], [0, 0, 166], [0, 0, 167], [2, 3, 0], [0, 3, 0], [0, 4, 0], [0, 5, 0], [2, 3, 164], [3, 0, 0], [3, 3, 164], [3, 3, 0], [4, 0, 0]];
  return `${declaration}<styleSheet xmlns="${MAIN_NS}"><numFmts count="4">${formats.map((format, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(format)}"/>`).join('')}</numFmts><fonts count="5"><font><sz val="11"/><color rgb="FF1A2E22"/><name val="Tahoma"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font><font><b/><sz val="24"/><color rgb="FF14532D"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FF1A2E22"/><name val="Tahoma"/></font><font><u/><sz val="11"/><color rgb="FF1D4ED8"/><name val="Tahoma"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['14532D', 'DCFCE7', 'FEF3C7', 'E5E7EB'].map(color => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.map(([font, fill, format]) => `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"${format ? ' horizontal="right"' : ''}/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
