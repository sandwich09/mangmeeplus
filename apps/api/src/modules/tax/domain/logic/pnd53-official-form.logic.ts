import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { formatCompanyLegalAddress, type CompanyLegalAddress } from '@watchdog-bms/contracts';
import { fitToWidth } from '../../../expenses/domain/logic/substitute-receipt.logic';

// Original printable forms published by the Revenue Department:
// https://www.rd.go.th/fileadmin/tax_pdf/withhold/WHT53_041060.pdf
// https://www.rd.go.th/fileadmin/tax_pdf/withhold/290360_attach53.pdf
const ASSETS = join(__dirname, '../../assets');
const MAIN = join(ASSETS, 'rd-pnd53-main.pdf');
const ANNEX = join(ASSETS, 'rd-pnd53-attachment.pdf');

// Every position below is measured from the masters' own rules and boxes (PDF points, y from the
// bottom): digits sit in the middle of their box, text sits on its dotted line.
const MAIN_TAX_ID = [175, 191.85, 203.15, 214.5, 225.8, 242.65, 253.95, 265.35, 276.7, 288, 305.15, 316.5, 333.35];
const MAIN_BRANCH = [290.3, 301.35, 312.45, 323.5, 334.5];
const MAIN_POSTAL = [105.1, 116.4, 127.7, 139.1, 150.45];
const MONTH_COLUMNS = [50.9, 127.65, 205.65, 280.75];
const MONTH_ROWS = [579.45, 565.45, 551.45];
const ANNEX_PAYER_TAX_ID = [382.9, 398.7, 410.55, 422.5, 434.4, 453.35, 465.45, 477.1, 488.3, 499.85, 517.5, 529.05, 549.25];
const ANNEX_PAYER_BRANCH = [596.75, 608.15, 619.6, 631.55, 644];
// The attachment groups a payee's thirteen digits 1-2-1-3-5-1, unlike the payer's 1-4-5-2-1.
const ANNEX_PAYEE_TAX_ID = [66.75, 83.3, 94.9, 111.45, 128.4, 140.35, 152.25, 171, 182.65, 194.4, 206.25, 217.9, 236.05];
const ANNEX_PAYEE_BRANCH = [346.7, 358.4, 370.2, 382.55, 395.35];
/** The name line of each of the six payee rows; the digit boxes sit above it, the two address lines below. */
const ANNEX_ROWS = [456.8, 405.1, 352.4, 299.7, 247, 194.4];
/** How far below the name line each of a row's three dotted lines is. */
const ANNEX_LINES = [0, 11, 21];

export type Pnd53FilingLine = {
  payeeName: string;
  payeeTaxId: string;
  payeeBranch: string;
  payeeAddress: string;
  paidAt: Date;
  incomeType: string;
  rate: number;
  income: number;
  withheld: number;
};

export type Pnd53Filing = {
  sequence?: number;
  periodKey: string;
  payerName: string;
  payerTaxId: string;
  payerBranch: string;
  payerAddress: CompanyLegalAddress;
  lines: Pnd53FilingLine[];
};

/** Older frozen payee snapshots can contain serialized addressJson. Never print JSON on a form. */
export function printablePnd53PayeeAddress(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const address = value.trim();
  if (!address.startsWith('{')) return address.replace(/\s+/gu, ' ');
  try { return formatCompanyLegalAddress(JSON.parse(address) as CompanyLegalAddress); }
  catch { return null; }
}

export type Mark = { x: number; y: number; value: string; size?: number; width?: number; align?: 'start' | 'middle' | 'end' };

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

export function thaiDate(value: Date): string {
  return `${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}/${value.getUTCFullYear() + 543}`;
}

export function at(marks: Mark[], x: number, y: number, value: string | number, size = 8, width?: number, align?: Mark['align']) {
  marks.push({ x, y, value: String(value), size, width, align });
}

export function digits(marks: Mark[], centres: number[], y: number, value: string, size = 8) {
  for (const [i, digit] of [...value].entries()) at(marks, centres[i]!, y, digit, size, undefined, 'middle');
}

export function tick(marks: Mark[], x: number, y: number) {
  at(marks, x, y - 3.5, '✓', 10, undefined, 'middle');
}

/** Baht ends at the rule before the satang box; satang sits in the middle of its own box. */
export function amount(marks: Mark[], bahtEnd: number, satangCentre: number, y: number, value: number, size: number) {
  const [baht, satang] = value.toFixed(2).split('.');
  at(marks, bahtEnd, y, baht!, size, undefined, 'end');
  at(marks, satangCentre, y, satang!, size, undefined, 'middle');
}

/** The first word goes after the form's `เลขที่`, the rest after its `ถนน`: a typed "ถนน" is not printed twice. */
export function numberAndRoad(line1: string): [number: string, road: string] {
  const [number = '', ...road] = line1.trim().split(/\s+/u);
  return [number, road.join(' ').replace(/^ถนน\s*/u, '')];
}

function overlaySvg(width: number, height: number, marks: Mark[]): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="#102a27" font-family="Noto Sans Thai, Noto Sans, sans-serif">${marks.map((mark) => {
    // The rasterizer ignores textLength: a value wider than its slot gets a smaller font instead.
    const fit = mark.width ? fitToWidth(mark.value, mark.width, mark.size ?? 8) : '';
    return `<text x="${mark.x}" y="${height - mark.y}" font-size="${mark.size ?? 8}" text-anchor="${mark.align ?? 'start'}"${fit}>${xml(mark.value)}</text>`;
  }).join('')}</g></svg>`);
}

async function applyOverlay(pdf: PDFDocument, pageIndex: number, marks: Mark[]): Promise<void> {
  const page = pdf.getPage(pageIndex);
  // The RD masters contain interactive fields, including a red "clear form" button. The filing
  // artifact is a static printed form, so remove widgets before painting the Thai text on top.
  page.node.delete(PDFName.of('Annots'));
  const { width, height } = page.getSize();
  const png = await sharp(overlaySvg(width, height, marks), { density: 192 }).png().toBuffer();
  page.drawImage(await pdf.embedPng(png), { x: 0, y: 0, width, height });
}

export function pnd53MainMarks(filing: Pnd53Filing, payeeCount: number, annexCount: number, totalIncome: number, totalTax: number): Mark[] {
  const marks: Mark[] = [];
  const [year, month] = filing.periodKey.split('-').map(Number);
  digits(marks, MAIN_TAX_ID, 749.35, filing.payerTaxId);
  digits(marks, MAIN_BRANCH, 717.05, filing.payerBranch);
  at(marks, 48.7, 701.1, filing.payerName, 9, 290);
  const [number, road] = numberAndRoad(filing.payerAddress.line1);
  const line2 = filing.payerAddress.line2?.trim();
  if (line2) {
    // The building slot is 60 points wide. A second line that does not fit there goes on the
    // form's unlabelled line beside the postal code, where it stays readable.
    if (!fitToWidth(line2, 60, 7)) at(marks, 99.3, 685.1, line2, 7, 60);
    else at(marks, 161.5, 621.2, line2, 7, 178);
  }
  at(marks, 69.7, 669.2, number, 8, 75);
  if (road) at(marks, 67.2, 653.1, road, 7.4, 110);
  at(marks, 224.8, 653.1, filing.payerAddress.subdistrict, 7.4, 114);
  at(marks, 90.7, 637.2, filing.payerAddress.district, 7.4, 104);
  at(marks, 225.3, 637.2, filing.payerAddress.province, 7.4, 114);
  digits(marks, MAIN_POSTAL, 621.6, filing.payerAddress.postalCode);
  at(marks, 328, 592.9, year + 543, 8, undefined, 'middle');
  tick(marks, MONTH_COLUMNS[Math.floor((month - 1) / 3)]!, MONTH_ROWS[(month - 1) % 3]!);
  tick(marks, 386.5, 725.5); // มาตรา 3 เตรส
  // Master Radio Button2 second widget centre; Text1.18 centre and baseline inset.
  if (filing.sequence) { tick(marks, 472.01, 646.54); at(marks, 557.99, 645.7, filing.sequence, 8, undefined, 'middle'); }
  else tick(marks, 375.65, 646.95); // ยื่นปกติ
  tick(marks, 282.7, 521.85); // ใบแนบ ภ.ง.ด.53
  at(marks, 532, 520.7, payeeCount, 8, undefined, 'middle');
  at(marks, 532, 506.5, annexCount, 8, undefined, 'middle');
  amount(marks, 493.2, 504.85, 361.95, totalIncome, 9);
  amount(marks, 493.2, 504.85, 341.9, totalTax, 9);
  if (!filing.sequence) {
    amount(marks, 493.2, 504.85, 322, 0, 9);
    amount(marks, 493.2, 504.85, 302, totalTax, 9);
  }
  return marks;
}

function annexMarks(filing: Pnd53Filing, pageNumber: number, pageCount: number, rows: Pnd53FilingLine[][]): Mark[] {
  const marks: Mark[] = [];
  digits(marks, ANNEX_PAYER_TAX_ID, 570.65, filing.payerTaxId);
  digits(marks, ANNEX_PAYER_BRANCH, 571.5, filing.payerBranch);
  at(marks, 716.8, 554.3, pageNumber, 8, undefined, 'middle');
  at(marks, 784.9, 554.3, pageCount, 8, undefined, 'middle');
  for (const [index, group] of rows.entries()) {
    const top = ANNEX_ROWS[index]!;
    const first = group[0]!;
    at(marks, 39.45, top + 16.35, (pageNumber - 1) * 6 + index + 1, 8, undefined, 'middle');
    digits(marks, ANNEX_PAYEE_TAX_ID, top + 16.45, first.payeeTaxId, 7.7);
    digits(marks, ANNEX_PAYEE_BRANCH, top + 16.45, first.payeeBranch, 7.7);
    at(marks, 73, top + 2.2, first.payeeName, 7.6, 262);
    const printableAddress = printablePnd53PayeeAddress(first.payeeAddress);
    if (!printableAddress) throw new Error('PND53 payee address cannot be printed');
    const halves = printableAddress.match(/.{1,52}/gu) ?? [];
    if (halves.length > 2) throw new Error('PND53 payee address exceeds the two printed address lines');
    // A long address breaks at the last space the first line can take, not in the middle of a word.
    const cut = halves.length > 1 ? printableAddress.lastIndexOf(' ', 52) : -1;
    const address = cut > 0 ? [printableAddress.slice(0, cut), printableAddress.slice(cut + 1)] : halves;
    if (address[0]) at(marks, 78.5, top - ANNEX_LINES[1]! + 2.2, address[0], 6.8, 257);
    if (address[1]) at(marks, 78.5, top - ANNEX_LINES[2]! + 2.2, address[1], 6.8, 257);
    for (const [j, line] of group.entries()) {
      const y = top - ANNEX_LINES[j]! + 2.2;
      at(marks, 406, y, thaiDate(line.paidAt), 7);
      at(marks, 468.5, y, line.incomeType, 7, 110);
      at(marks, 593.25, y, line.rate, 7, undefined, 'middle');
      amount(marks, 683.3, 696.4, y, line.income, 7);
      amount(marks, 780.7, 793.05, y, line.withheld, 7);
      at(marks, 813.35, y, '1', 7, undefined, 'middle'); // หัก ณ ที่จ่าย
    }
  }
  amount(marks, 683.3, 696.4, 156.9, rows.flat().reduce((sum, row) => sum + row.income, 0), 8);
  amount(marks, 780.7, 793.05, 156.9, rows.flat().reduce((sum, row) => sum + row.withheld, 0), 8);
  return marks;
}

/**
 * The packet both withholding returns share: the RD main form (front side only) followed by as many
 * attachment sheets as the payees need, six payees a sheet and up to three payments a payee.
 */
export async function renderOfficialWithholdingForm(
  masters: { main: string; annex: string },
  filing: Pnd53Filing,
  mainMarks: (filing: Pnd53Filing, payeeCount: number, annexCount: number, totalIncome: number, totalTax: number) => Mark[],
  annexMarks: (filing: Pnd53Filing, pageNumber: number, pageCount: number, rows: Pnd53FilingLine[][]) => Mark[],
): Promise<Buffer> {
  const [mainBytes, annexBytes] = await Promise.all([readFile(masters.main), readFile(masters.annex)]);
  const pdf = await PDFDocument.load(mainBytes);
  pdf.removePage(1); // reverse-side instructions are not part of the filing packet
  pdf.catalog.delete(PDFName.of('AcroForm'));
  const groups: Pnd53FilingLine[][] = [];
  for (const line of filing.lines) {
    const last = groups.at(-1);
    if (last && last.length < 3 && last[0]!.payeeTaxId === line.payeeTaxId && last[0]!.payeeBranch === line.payeeBranch) last.push(line);
    else groups.push([line]);
  }
  const annexCount = Math.ceil(groups.length / 6);
  // "จำนวนราย" counts the numbered payee rows of the attachment, not the payments inside them.
  await applyOverlay(pdf, 0, mainMarks(filing, groups.length, annexCount,
    filing.lines.reduce((sum, line) => sum + line.income, 0),
    filing.lines.reduce((sum, line) => sum + line.withheld, 0)));
  const annexMaster = await PDFDocument.load(annexBytes);
  for (let pageNumber = 1; pageNumber <= annexCount; pageNumber++) {
    const [page] = await pdf.copyPages(annexMaster, [0]);
    pdf.addPage(page);
    await applyOverlay(pdf, pageNumber, annexMarks(filing, pageNumber, annexCount,
      groups.slice((pageNumber - 1) * 6, pageNumber * 6)));
  }
  return Buffer.from(await pdf.save());
}

/** Paper filing form + printable annexes, based on the RD masters. A human signs before filing. */
export function renderPnd53OfficialForm(filing: Pnd53Filing): Promise<Buffer> {
  return renderOfficialWithholdingForm({ main: MAIN, annex: ANNEX }, filing, pnd53MainMarks, annexMarks);
}
