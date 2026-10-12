import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';
import { DISBURSEMENT_VOUCHER_PAYEE_BASIS_WORDS, DISBURSEMENT_VOUCHER_WORDS, disbursementVoucherPaymentAmount, formatCompanyLegalAddressForPrint, type CompanyLegalAddress } from '@watchdog-bms/contracts';
import { fitToWidth, wrapText } from './substitute-receipt.logic';
import { normalizeVendorName } from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import { formatThaiExportDate } from '../../../../common/export/thai-date.logic';

type Actor = { name?: string | null; at?: string | null; selfApproved?: boolean };
export type DisbursementVoucherPrintSnapshot = {
  company?: { name?: string; registeredName?: string | null; taxId?: string | null; addressJson?: unknown };
  branch?: { name?: string; taxBranchCode?: string | null; addressJson?: unknown };
  documentNumber?: string | null; revision?: number; origin?: string; replacesDocumentNumber?: string | null; directPayment?: boolean;
  payee: { name: string; taxId?: string | null; branchCode?: string | null; basis?: string; confirmerName?: string | null };
  payeeAccount?: { bankName?: string | null; accountName?: string | null; last4: string } | null;
  lines: { expenseId?: string; expenseNumber: string | null; expenseDate: string; vendorName: string | null; description?: string | null; grandTotal: string; wht: string; netPayable: string;
    amount?: string; paidThisTime?: string; outstandingAfter?: string }[];
  total?: string; totals?: { grandTotal: string; wht: string; paidThisTime: string };
  plannedPayDate?: string | null; plannedMethod?: string | null; paidDate?: string; paymentMethod?: string | null; paidFromRef?: string | null; note?: string | null;
  preparerName?: string | null; actors?: { preparer?: Actor; approver?: Actor; payer?: Actor };
  snapshotHash?: string;
  paymentEvidence?: { attachedByName: string | null; attachedAt: string } | null;
  cancellation?: { at: string | null; reason: string | null; expenseIds?: string[]; expenseNumbers?: string[]; reissuedDocumentNumber?: string | null };
};

const xml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const money = (value: string | undefined) => new Decimal(value || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const thaiTime = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
const when = (value?: string | null) => value ? `${formatThaiExportDate(value)}${value.includes('T') ? ` ${thaiTime.format(new Date(value))} น.` : ''}` : '';
const methods: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', CHEQUE: 'เช็ค', CARD: 'บัตร', OTHER: 'อื่น ๆ' };

/** Only frozen, masked print facts enter this builder. Rows and signature boxes are kept whole. */
/** The tax-register branch as a tax document words it: head office by name, a branch by its number. */
function taxBranchWords(code: string): string {
  return code === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`;
}

export function renderDisbursementVoucherSvg(snapshot: DisbursementVoucherPrintSnapshot, paid: boolean): Buffer {
  const pageHeight = 1100, bottom = 1040, parts: string[] = [], breaks: number[] = [];
  let page = -1, y = 0;
  const text = (value: unknown, x: number, row: number, width = 780, size = 14, right = false) => {
    if (value == null || !String(value).trim()) return;
    parts.push(`<text x="${x}" y="${page * pageHeight + row}" font-size="${size}"${right ? ' text-anchor="end"' : ''}${fitToWidth(String(value), width, size)}>${xml(value)}</text>`);
  };
  const cancelled = snapshot.cancellation;
  const paymentCancelled = (line: DisbursementVoucherPrintSnapshot['lines'][number]) => paid && Boolean(cancelled?.expenseIds?.includes(line.expenseId ?? ''));
  const band = cancelled ? [`ยกเลิกแล้ว${cancelled.at ? ` เมื่อ ${when(cancelled.at)}` : ''}`,
    ...(paid ? [cancelled.expenseNumbers?.length ? `การจ่ายของรายการ ${cancelled.expenseNumbers.join(', ')} ถูกยกเลิก` : 'การจ่ายในใบนี้ถูกยกเลิก'] : []),
    ...(cancelled.reason ? [`เหตุผล: ${cancelled.reason}`] : []),
    ...(cancelled.reissuedDocumentNumber ? [`ออกใบใหม่แทนแล้ว เลขที่ ${cancelled.reissuedDocumentNumber}`] : [])].flatMap(s => wrapText(s, 780, 13)) : [];
  const newPage = () => {
    page++; if (page) breaks.push(page * pageHeight);
    const offset = band.length ? band.length * 20 + 20 : 0;
    if (band.length) parts.push(`<rect x="25" y="${page * pageHeight + 10}" width="800" height="${offset}" fill="#fee2e2"/>`);
    band.forEach((line, i) => text(line, 35, 30 + i * 20, 780, 13));
    text(paid ? DISBURSEMENT_VOUCHER_WORDS.oncePaid : DISBURSEMENT_VOUCHER_WORDS.beforePaid, 35, 45 + offset, 780, 25);
    text([snapshot.documentNumber ? `เลขที่ ${snapshot.documentNumber}` : '', paid ? '' : `ครั้งที่ ${snapshot.revision ?? 0}`].filter(Boolean).join(' · '), 35, 75 + offset);
    if (!paid) text('ยังไม่ได้จ่ายเงิน', 35, 100 + offset);
    y = (paid ? 105 : 130) + offset;
  };
  const ensure = (height: number) => { if (y + height > bottom) newPage(); };
  const paragraph = (value: unknown, size = 14) => {
    if (value == null || !String(value).trim()) return;
    for (const line of wrapText(value, 780, size)) { ensure(22); text(line, 35, y, 780, size); y += 22; }
  };
  newPage();
  paragraph([snapshot.company?.registeredName || snapshot.company?.name, snapshot.branch?.name ? `สาขา ${snapshot.branch.name}` : ''].filter(Boolean).join(' · '));
  if (snapshot.company?.taxId) paragraph([`เลขผู้เสียภาษี ${snapshot.company.taxId}`, snapshot.branch?.taxBranchCode ? taxBranchWords(snapshot.branch.taxBranchCode) : ''].filter(Boolean).join(' · '));
  for (const address of [snapshot.company?.addressJson, snapshot.branch?.addressJson]) {
    // The print formatter words the parts in address order; the stored JSON's key order is not an address.
    if (address && typeof address === 'object') paragraph(formatCompanyLegalAddressForPrint(address as CompanyLegalAddress) ?? Object.values(address).filter(v => typeof v === 'string').join(' '));
  }
  paragraph(`ผู้รับเงิน ${snapshot.payee.name}`);
  paragraph([snapshot.payee.taxId ? `เลขผู้เสียภาษี ${snapshot.payee.taxId}` : '', snapshot.payee.branchCode ? taxBranchWords(snapshot.payee.branchCode) : ''].filter(Boolean).join(' · '));
  if (snapshot.payee.basis === 'SAME_NAME') paragraph(DISBURSEMENT_VOUCHER_PAYEE_BASIS_WORDS.sameNameNote, 13);
  if (snapshot.payee.basis === 'PREPARER_CONFIRMED') paragraph(DISBURSEMENT_VOUCHER_PAYEE_BASIS_WORDS.preparerConfirmedNote.replace('{name}', snapshot.payee.confirmerName || '').trim(), 13);
  if (paid && snapshot.directPayment) paragraph(DISBURSEMENT_VOUCHER_WORDS.directPayment);
  if (paid && snapshot.origin === 'REISSUED' && snapshot.replacesDocumentNumber) paragraph(`ออกแทนใบเลขที่ ${snapshot.replacesDocumentNumber}`);
  y += 8;
  const showNet = snapshot.lines.some(line => !new Decimal(line.netPayable).eq(paid ? paymentCancelled(line) ? 0 : line.paidThisTime || 0 : line.amount || 0));
  const widths = paid ? showNet ? [150, 110, 150, 70, 65, 70, 80, 85] : [150, 110, 185, 75, 75, 100, 85]
    : showNet ? [150, 110, 220, 75, 75, 75, 75] : [150, 110, 230, 80, 80, 130];
  const headings = ['เลขรายจ่าย', 'วันที่', 'รายละเอียด', 'ยอดรวม', 'ภาษีที่หักไว้', ...(showNet ? ['ยอดสุทธิที่ต้องจ่าย'] : []), paid ? 'ยอดที่จ่าย' : 'ยอดที่จะจ่าย', ...(paid ? ['ค้างหลังจ่าย'] : [])];
  const tableHeader = () => {
    ensure(90); let x = 35;
    const wrapped = headings.map((label, i) => !label ? [] : i === 4 ? [label] : wrapText(label, widths[i]! - 8, 12));
    wrapped.forEach((lines, i) => { lines.forEach((line, j) => text(line, i >= 3 ? x + widths[i]! : x + 4, y + j * 16, widths[i]! - 8, 12, i >= 3)); x += widths[i]!; });
    // As tall as its longest heading (four lines kept the old 85): one-line headings left a blank band above the first row.
    y += Math.max(1, ...wrapped.map(lines => lines.length)) * 16 + 21;
  };
  tableHeader();
  for (const line of snapshot.lines) {
    const cells = [line.expenseNumber || '', when(line.expenseDate), line.description || '', money(line.grandTotal), money(line.wht), ...(showNet ? [money(line.netPayable)] : []), money(paid ? paymentCancelled(line) ? '0' : line.paidThisTime : line.amount), ...(paid ? [paymentCancelled(line) ? 'ยกเลิกการจ่ายแล้ว' : money(line.outstandingAfter)] : [])];
    const vendor = line.vendorName && normalizeVendorName(line.vendorName) !== normalizeVendorName(snapshot.payee.name) ? line.vendorName : null;
    const wrapped = cells.map((cell, i) => i === 2 ? [...(cell ? wrapText(cell, widths[i]! - 8, 12) : []), ...(vendor ? wrapText(vendor, widths[i]! - 8, 12) : [])] : cell ? [cell] : []);
    const height = Math.max(...wrapped.map(c => c.length)) * 18 + 12;
    if (y + height > bottom) { newPage(); tableHeader(); }
    parts.push(`<path d="M35 ${page * pageHeight + y - 12} H815" stroke="#ddd"/>`);
    let x = 35;
    wrapped.forEach((cell, i) => { cell.forEach((value, j) => { if (value) text(value, i >= 3 ? x + widths[i]! : x + 4, y + j * 18, widths[i]! - 8, 12, i >= 3); }); x += widths[i]!; });
    y += height;
  }
  y += 15;
  const sum = (field: 'grandTotal' | 'wht') => snapshot.lines.reduce((total, l) => total.plus(l[field]), new Decimal(0)).toFixed(2);
  const grandTotal = snapshot.totals?.grandTotal ?? sum('grandTotal'), wht = snapshot.totals?.wht ?? sum('wht'), amount = paid && cancelled
    ? disbursementVoucherPaymentAmount(snapshot.totals?.paidThisTime || '0', snapshot.lines.map(line => ({ amount: line.paidThisTime || '0', paymentInEffect: !paymentCancelled(line) }))).amount
    : paid ? snapshot.totals?.paidThisTime : snapshot.total;
  for (const [label, value] of [['รวมเป็นเงิน', grandTotal], ['ภาษีที่หักไว้', wht], [paid ? 'ยอดที่จ่าย' : 'ยอดที่จะจ่าย', amount]]) {
    ensure(22); text(label, 35, y, 600); text(money(value), 815, y, 170, 14, true); y += 22;
  }
  const netTotal = new Decimal(grandTotal).minus(wht);
  const originalAmount = new Decimal((paid ? snapshot.totals?.paidThisTime : snapshot.total) || 0);
  if (!netTotal.eq(amount || 0)) {
    if (!originalAmount.eq(amount || 0)) paragraph('ยอดนี้ไม่รวมรายการที่การจ่ายถูกยกเลิก', 13);
    if (!netTotal.eq(originalAmount)) paragraph('ยอดนี้ไม่เท่ากับยอดรวมหักภาษี เพราะมีรายการที่จ่ายบางส่วน หรือเคยจ่ายไปแล้วบางส่วน', 13);
  }
  const date = paid ? snapshot.paidDate : snapshot.plannedPayDate, method = methods[(paid ? snapshot.paymentMethod : snapshot.plannedMethod) || ''];
  paragraph([date ? `${paid ? 'วันที่จ่าย' : 'กำหนดจ่าย'} ${when(date)}` : '', method ? `วิธีจ่าย ${method}` : ''].filter(Boolean).join(' · '));
  if (paid && snapshot.paidFromRef) paragraph(`จ่ายจาก ${snapshot.paidFromRef}`);
  if (paid) paragraph(snapshot.paymentEvidence ? `หลักฐานการจ่าย: แนบ 1 ไฟล์${snapshot.paymentEvidence.attachedByName ? ` โดย ${snapshot.paymentEvidence.attachedByName}` : ''}${snapshot.paymentEvidence.attachedAt ? ` เมื่อ ${when(snapshot.paymentEvidence.attachedAt)}` : ''}` : 'หลักฐานการจ่าย: ไม่ได้แนบ');
  if (snapshot.payeeAccount?.last4) paragraph(`บัญชีผู้รับเงิน ${[snapshot.payeeAccount.bankName, snapshot.payeeAccount.accountName, `xxx-${snapshot.payeeAccount.last4}`].filter(Boolean).join(' · ')}`);
  if (snapshot.note) paragraph(`หมายเหตุ ${snapshot.note}`);
  y += 20;
  const actors: Actor[] = [snapshot.actors?.preparer ?? { name: snapshot.preparerName }, paid && snapshot.directPayment ? {} : snapshot.actors?.approver ?? {}, paid ? snapshot.actors?.payer ?? {} : {}, {}];
  const labels = ['ผู้จัดทำ', snapshot.actors?.approver?.selfApproved && !snapshot.directPayment ? 'ผู้อนุมัติ (อนุมัติเอง)' : 'ผู้อนุมัติ', 'ผู้จ่าย', 'ผู้รับเงิน'];
  const names = actors.map(a => a.name?.trim() ? wrapText(a.name, 175, 13) : []);
  const boxHeight = Math.max(...names.map(n => n.length)) * 18 + 100;
  ensure(boxHeight);
  actors.forEach((actor, i) => {
    const x = 35 + i * 195;
    text(labels[i], x, y, 185, 13);
    parts.push(`<path d="M${x} ${page * pageHeight + y + 45} h180" stroke="#aaa"/>`);
    if (i < 3) {
      names[i]!.forEach((name, j) => text(name, x, y + 65 + j * 18, 175, 13));
      text(when(actor.at), x, y + boxHeight - 10, 175, 12);
    }
  });
  const pages = page + 1, hash = snapshot.snapshotHash || createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  for (let i = 0; i < pages; i++) {
    page = i;
    text(`${snapshot.documentNumber ? `เลขที่ ${snapshot.documentNumber} · ` : ''}หน้า ${i + 1}/${pages}`, 35, 1065, 780, 12);
    text(`รหัสตรวจสอบเอกสาร ${hash.slice(0, 12)}`, 35, 1085, 780, 10);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="850" height="${(page + 1) * pageHeight}" viewBox="0 0 850 ${(page + 1) * pageHeight}" data-pdf-breaks="${breaks.join(',')}"><rect width="100%" height="100%" fill="white"/><g font-family="Noto Sans Thai, Tahoma, sans-serif" fill="#111">${parts.join('')}</g></svg>`);
}
