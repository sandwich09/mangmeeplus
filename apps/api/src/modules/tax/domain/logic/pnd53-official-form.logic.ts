import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { formatCompanyLegalAddress, type CompanyLegalAddress } from '@watchdog-bms/contracts';

// Original printable forms published by the Revenue Department:
// https://www.rd.go.th/fileadmin/tax_pdf/withhold/WHT53_041060.pdf
// https://www.rd.go.th/fileadmin/tax_pdf/withhold/290360_attach53.pdf
const ASSETS = join(__dirname, '../../assets');
const MAIN = join(ASSETS, 'rd-pnd53-main.pdf');
const ANNEX = join(ASSETS, 'rd-pnd53-attachment.pdf');

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

type Mark = { x: number; y: number; value: string; size?: number; width?: number; align?: 'start' | 'end' };

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

function money(value: number): string { return value.toFixed(2); }
function thaiDate(value: Date): string {
  return `${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}/${value.getUTCFullYear() + 543}`;
}

function at(marks: Mark[], x: number, y: number, value: string | number, size = 8, width?: number, align?: 'start' | 'end') {
  marks.push({ x, y, value: String(value), size, width, align });
}

function boxes(marks: Mark[], x: number, y: number, digits: string, step: number, size = 8) {
  for (const [i, digit] of [...digits].entries()) at(marks, x + i * step, y, digit, size);
}

function taxIdBoxes(marks: Mark[], positions: number[], y: number, digits: string, size = 8) {
  for (const [i, digit] of [...digits].entries()) at(marks, positions[i]!, y, digit, size);
}

function overlaySvg(width: number, height: number, marks: Mark[]): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="#102a27" font-family="Noto Sans Thai, Noto Sans, sans-serif">${marks.map((mark) => {
    const visible = [...mark.value].filter((char) => !/\p{Mark}/u.test(char)).length;
    const fit = mark.width && visible * (mark.size ?? 8) * 0.67 > mark.width
      ? ` textLength="${mark.width}" lengthAdjust="spacingAndGlyphs"` : '';
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

function mainMarks(filing: Pnd53Filing, annexCount: number, totalIncome: number, totalTax: number): Mark[] {
  const marks: Mark[] = [];
  const [year, month] = filing.periodKey.split('-').map(Number);
  taxIdBoxes(marks, [171, 186, 198, 210, 222, 238, 250, 262, 274, 286, 302, 314, 330], 749, filing.payerTaxId);
  boxes(marks, 284, 717, filing.payerBranch, 11.4);
  at(marks, 48, 703, filing.payerName, 9, 290);
  const [number, ...road] = filing.payerAddress.line1.trim().split(/\s+/u);
  if (filing.payerAddress.line2) at(marks, 99, 687, filing.payerAddress.line2, 7, 95);
  at(marks, 69, 672, number ?? '', 8, 72);
  if (road.length) at(marks, 67, 655, road.join(' '), 7.4, 145);
  at(marks, 224, 655, filing.payerAddress.subdistrict, 7.4, 115);
  at(marks, 90, 639, filing.payerAddress.district, 7.4, 115);
  at(marks, 225, 639, filing.payerAddress.province, 7.4, 115);
  at(marks, 101, 622, filing.payerAddress.postalCode, 8, 48);
  at(marks, 318, 593, year + 543, 8);
  const monthIndex = month - 1;
  at(marks, 47 + Math.floor(monthIndex / 3) * 77, 580 - (monthIndex % 3) * 14, '✓', 10);
  at(marks, 382, 726, '✓', 10); // มาตรา 3 เตรส
  at(marks, 371, 646, '✓', 10); // ยื่นปกติ
  at(marks, 279, 521, '✓', 10); // ใบแนบ ภ.ง.ด.53
  at(marks, 512, 522, filing.lines.length, 8);
  at(marks, 512, 508, annexCount, 8);
  at(marks, 510, 363, money(totalIncome), 9, undefined, 'end');
  at(marks, 510, 343, money(totalTax), 9, undefined, 'end');
  at(marks, 510, 322, '0.00', 9, undefined, 'end');
  at(marks, 510, 303, money(totalTax), 9, undefined, 'end');
  return marks;
}

function annexMarks(filing: Pnd53Filing, pageNumber: number, pageCount: number, rows: Pnd53FilingLine[][]): Mark[] {
  const marks: Mark[] = [];
  taxIdBoxes(marks, [378, 394, 407, 420, 433, 449, 462, 475, 488, 501, 518, 531, 547], 571, filing.payerTaxId);
  boxes(marks, 591, 572, filing.payerBranch, 12);
  at(marks, 705, 555, pageNumber, 8);
  at(marks, 770, 555, pageCount, 8);
  const tops = [473, 421, 369, 316, 264, 212];
  for (const [index, group] of rows.entries()) {
    const top = tops[index]!;
    const first = group[0]!;
    at(marks, 27, top, (pageNumber - 1) * 6 + index + 1, 8);
    taxIdBoxes(marks, [59, 75, 88, 101, 114, 130, 143, 156, 169, 182, 199, 212, 228], top, first.payeeTaxId, 7.7);
    boxes(marks, 341, top, first.payeeBranch, 12, 7.7);
    at(marks, 73, top - 13, first.payeeName, 7.6, 260);
    const printableAddress = printablePnd53PayeeAddress(first.payeeAddress);
    if (!printableAddress) throw new Error('PND53 payee address cannot be printed');
    const address = printableAddress.match(/.{1,52}/gu) ?? [];
    if (address.length > 2) throw new Error('PND53 payee address exceeds the two printed address lines');
    if (address[0]) at(marks, 79, top - 24, address[0], 6.8, 255);
    if (address[1]) at(marks, 79, top - 35, address[1], 6.8, 255);
    for (const [j, line] of group.entries()) {
      const y = top - 13 - j * 11;
      at(marks, 405, y, thaiDate(line.paidAt), 7);
      at(marks, 468, y, line.incomeType, 7, 110);
      at(marks, 600, y, line.rate, 7, undefined, 'end');
      at(marks, 698, y, money(line.income), 7, undefined, 'end');
      at(marks, 798, y, money(line.withheld), 7, undefined, 'end');
      at(marks, 811, y, '1', 7); // หัก ณ ที่จ่าย
    }
  }
  at(marks, 698, 153, money(rows.flat().reduce((sum, row) => sum + row.income, 0)), 8, undefined, 'end');
  at(marks, 798, 153, money(rows.flat().reduce((sum, row) => sum + row.withheld, 0)), 8, undefined, 'end');
  return marks;
}

/** Paper filing form + printable annexes, based on the RD masters. A human signs before filing. */
export async function renderPnd53OfficialForm(filing: Pnd53Filing): Promise<Buffer> {
  const [mainBytes, annexBytes] = await Promise.all([readFile(MAIN), readFile(ANNEX)]);
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
  await applyOverlay(pdf, 0, mainMarks(filing, annexCount,
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
