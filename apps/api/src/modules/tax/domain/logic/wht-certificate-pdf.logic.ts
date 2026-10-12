import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { civilDate, formatCompanyLegalAddressForPrint, type CompanyLegalAddress, type PayeeSnapshot, type PayerSnapshot, type WhtFormType } from '@watchdog-bms/contracts';
import { money, thaiBahtText } from '../../../expenses/domain/logic/substitute-receipt.logic';

// Revenue Department printable master: https://rd.go.th/fileadmin/tax_pdf/withhold/approve_wh3_081156.pdf
const MASTER = join(__dirname, '../../assets/rd-wht50bis.pdf');

export type WhtCertificateFields = {
  certificateNumber: string; formType: WhtFormType;
  incomeCategoryCode: string; incomeCategoryName: string; whtRate: string;
  grossAmount: string; withheldAmount: string; paymentDate: string; issuedAt: string;
};
export type WhtCertificateSignature = {
  mode: 'AUTO_STAMP' | 'BLANK';
  signatureImageBase64?: string;
  signatureImageMimeType?: 'image/png' | 'image/jpeg';
};
type Rect = { x: number; y: number; width: number; height: number };
type Mark = { x: number; y: number; text: string; size: number; maxWidth?: number; anchor?: 'start' | 'middle' | 'end' };

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}
function printedAddress(value: string | null): string {
  if (!value) return '-';
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return trimmed.replace(/\s+/gu, ' ');
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { throw new Error('WHT certificate address contains invalid JSON'); }
  const formatted = formatCompanyLegalAddressForPrint(parsed as CompanyLegalAddress);
  if (!formatted) throw new Error('WHT certificate address cannot be printed');
  return formatted;
}
function buddhistDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error('WHT certificate date is invalid');
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear() + 543}`;
}
function field(marks: Mark[], rects: Map<string, Rect>, name: string, text: string, size = 8, anchor: 'start' | 'end' = 'start', lift = 0): void {
  const rect = rects.get(name);
  if (!rect) throw new Error(`Revenue Department 50 ทวิ field missing: ${name}`);
  marks.push({
    x: anchor === 'end' ? rect.x + rect.width - 2 : rect.x + 2,
    y: rect.y + size * 0.35 + lift,
    text, size, maxWidth: rect.width - 4, anchor,
  });
}
function taxId(marks: Mark[], rects: Map<string, Rect>, name: string, value: string | null): void {
  if (!value) return;
  if (!/^\d{13}$/.test(value)) throw new Error('WHT certificate tax ID must contain 13 digits');
  const rect = rects.get(name);
  if (!rect) throw new Error(`Revenue Department 50 ทวิ field missing: ${name}`);
  // The official comb has 17 positions: 1-4-5-2-1 digits plus four printed separators.
  const slots = [0, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 16];
  for (const [i, digit] of [...value].entries()) marks.push({
    x: rect.x + (slots[i]! + 0.5) * rect.width / 17,
    y: rect.y + 3,
    text: digit, size: 8, anchor: 'middle',
  });
}
function incomeFields(code: string): { date: string; paid: string; tax: string; description?: string } {
  if (code === 'WHT_INTEREST') return { date: 'date4', paid: 'pay1.3', tax: 'tax1.3' };
  if (code === 'WHT_DIVIDEND') throw new Error('Dividend 50 ทวิ requires a reviewed dividend-credit classification');
  if (code.startsWith('WHT_OTHER')) return { date: 'date14.1', paid: 'pay1.13.1', tax: 'tax1.13.1', description: 'spec3' };
  if (/^WHT_(SERVICE|RENT|PROFESSIONAL|ADVERTISING|TRANSPORT)_(3|5|IND|JUR)$/.test(code) || code === 'WHT_PRIZE' || code === 'CAT5') {
    return { date: 'date14.0', paid: 'pay1.13.0', tax: 'tax1.13.0' };
  }
  throw new Error(`WHT certificate income category needs statutory row review: ${code}`);
}
export function makeMarks(fields: WhtCertificateFields, payer: PayerSnapshot, payee: PayeeSnapshot, rects: Map<string, Rect>, replacement?: { issuedAt: string }): Mark[] {
  const marks: Mark[] = [];
  const number = /^(.*[-/])([^-\/]+)$/.exec(fields.certificateNumber);
  if (number) field(marks, rects, 'book_no', number[1]!.slice(0, -1), 7);
  field(marks, rects, 'run_no', number ? number[2]! : fields.certificateNumber, 7);
  taxId(marks, rects, 'id1', payer.taxId);
  taxId(marks, rects, 'id1_2', payee.taxId);
  field(marks, rects, 'name1', payer.companyName, 8);
  field(marks, rects, 'name2', payee.name, 8);
  // The address widgets sit lower against their dotted rule than the name widgets do.
  field(marks, rects, 'add1', printedAddress(payer.address), 7.6, 'start', 3);
  field(marks, rects, 'add2', printedAddress(payee.address), 7.6, 'start', 3);
  field(marks, rects, fields.formType === 'PND53' ? 'chk7' : 'chk4', '✓', 11);
  field(marks, rects, 'chk8', '✓', 10);
  const income = incomeFields(fields.incomeCategoryCode);
  field(marks, rects, income.date, buddhistDate(fields.paymentDate), 7.5);
  field(marks, rects, income.paid, money(fields.grossAmount), 8, 'end');
  field(marks, rects, income.tax, money(fields.withheldAmount), 8, 'end');
  if (income.description) field(marks, rects, income.description, fields.incomeCategoryName, 7.5);
  field(marks, rects, 'pay1.14', money(fields.grossAmount), 8, 'end');
  field(marks, rects, 'tax1.14', money(fields.withheldAmount), 8, 'end');
  field(marks, rects, 'total', thaiBahtText(fields.withheldAmount), 8);
  const [day, month, year] = buddhistDate(civilDate(new Date(fields.issuedAt))).split('/');
  field(marks, rects, 'date_pay', day!, 8);
  field(marks, rects, 'month_pay', month!, 8);
  field(marks, rects, 'year_pay', year!, 8);
  if (replacement) marks.push({ x: 408, y: 797, text: `ใบแทน ${buddhistDate(civilDate(new Date(replacement.issuedAt)))}`, size: 8, maxWidth: 93 });
  return marks;
}
function overlay(width: number, height: number, marks: Mark[], signature?: WhtCertificateSignature, stamp?: 'SUPERSEDED'): Buffer {
  const text = marks.map((mark) => {
    const chars = [...mark.text].filter((char) => !/\p{Mark}/u.test(char)).length;
    const fit = mark.maxWidth && chars * mark.size * 0.67 > mark.maxWidth ? ` textLength="${mark.maxWidth}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<text x="${mark.x}" y="${height - mark.y}" font-size="${mark.size}" text-anchor="${mark.anchor ?? 'start'}"${fit}>${xml(mark.text)}</text>`;
  }).join('');
  const image = signature?.mode === 'AUTO_STAMP' && signature.signatureImageBase64
    ? `<image href="data:${signature.signatureImageMimeType ?? 'image/png'};base64,${signature.signatureImageBase64}" x="340" y="${height - 105}" width="133" height="31" preserveAspectRatio="xMidYMid meet"/>`
    : '';
  const state = stamp ? `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="58" fill="#b91c1c" opacity=".4" transform="rotate(-30 ${width / 2} ${height / 2})">SUPERSEDED</text>` : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="#111" font-family="Noto Sans Thai, Noto Sans, sans-serif">${text}</g>${image}${state}</svg>`);
}

/** The statutory certificate has two matching copies; the published RD page supplies all printed labels. */
export async function renderWhtCertificatePdf(
  fields: WhtCertificateFields, payer: PayerSnapshot, payee: PayeeSnapshot,
  signature?: WhtCertificateSignature, replacement?: { issuedAt: string },
  options?: { stateStamp?: 'SUPERSEDED' },
): Promise<Buffer> {
  const master = await PDFDocument.load(await readFile(MASTER));
  const rects = new Map(master.getForm().getFields().map((f) => [f.getName(), f.acroField.getWidgets()[0]!.getRectangle()]));
  const pdf = await PDFDocument.create();
  const pages = await pdf.copyPages(master, [0, 0]);
  for (const page of pages) {
    page.node.delete(PDFName.of('Annots')); // remove the clear-data button and blank widgets
    pdf.addPage(page);
    const { width, height } = page.getSize();
    const png = await sharp(overlay(width, height, makeMarks(fields, payer, payee, rects, replacement), signature, options?.stateStamp), { density: 192 }).png().toBuffer();
    page.drawImage(await pdf.embedPng(png), { x: 0, y: 0, width, height });
  }
  pdf.setTitle(fields.certificateNumber);
  if (options?.stateStamp) pdf.setSubject(`State: ${options.stateStamp}`);
  return Buffer.from(await pdf.save());
}
