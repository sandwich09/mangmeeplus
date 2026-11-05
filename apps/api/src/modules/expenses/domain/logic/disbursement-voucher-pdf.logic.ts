import Decimal from 'decimal.js';
import { DISBURSEMENT_VOUCHER_WORDS, disbursementVoucherPaymentAmount, formatCompanyLegalAddressForPrint, type CompanyLegalAddress } from '@watchdog-bms/contracts';
import { fitToWidth, wrapText, thaiBahtText } from './substitute-receipt.logic';
import { normalizeVendorName } from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import { formatThaiExportDate } from '../../../../common/export/thai-date.logic';

export type DisbursementSignatureSnapshot = { attachmentId: string; checksumSha256: string; userId: string };
type Actor = { signature?: DisbursementSignatureSnapshot | null; signatureDataUrl?: string; name?: string | null; at?: string | null; selfApproved?: boolean };
export type DisbursementVoucherPrintSnapshot = {
  company?: { name?: string; registeredName?: string | null; taxId?: string | null; addressJson?: unknown; phone?: string | null };
  branch?: { name?: string; taxBranchCode?: string | null; addressJson?: unknown };
  documentNumber?: string | null; documentDate?: string | null; revision?: number; origin?: string; replacesDocumentNumber?: string | null; directPayment?: boolean;
  payee: { name: string; taxId?: string | null; branchCode?: string | null; address?: string | null; basis?: string; confirmerName?: string | null };
  payeeAccount?: { bankName?: string | null; accountName?: string | null; last4: string; accountNumber?: string } | null;
  lines: { expenseId?: string; expenseNumber: string | null; expenseDate: string; vendorName: string | null; vendorTaxId?: string | null; vendorBranchCode?: string | null; vendorAddress?: string | null; vendorDocumentNumber?: string | null; description?: string | null; grandTotal: string; wht: string; netPayable: string;
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

// SVG units before A4 scaling. Noto Sans Thai's ascent/descent are 1.061/0.450 em:
// at 12 units, a 20-unit rule-to-baseline gap clears stacked marks by > 0.35 em,
// including half the rule stroke; a 36-unit row leaves the same clearance below.
export const DISBURSEMENT_VOUCHER_PRINT_SPACING = Object.freeze({
  lineHeight: 20, ruleToBaseline: 20, rowHeight: 36, signatureRuleToBaseline: 24, signatureGap: 80, signatureArea: 66, signatureAnchor: 1020,
});

/** Frozen print facts; full account numbers are supplied only to audited download copies. */
/** The tax-register branch as a tax document words it: head office by name, a branch by its number. */
function taxBranchWords(code: string): string {
  return code === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`;
}

export function renderDisbursementVoucherSvg(snapshot: DisbursementVoucherPrintSnapshot, paid: boolean): Buffer {
  // 850 × 1250 fills the existing A4 renderer's 36-point margins without a large blank foot.
  const pageHeight = 1250, bottom = 1190, parts: string[] = [], breaks: number[] = [];
  const spacing = DISBURSEMENT_VOUCHER_PRINT_SPACING;
  let page = -1, y = 0;
  const text = (value: unknown, x: number, row: number, width = 780, size = 14, right: boolean | 'middle' = false, bold = false) => {
    if (value == null || !String(value).trim()) return;
    parts.push(`<text x="${x}" y="${page * pageHeight + row}" font-size="${size}"${right ? ` text-anchor="${right === 'middle' ? 'middle' : 'end'}"` : ''}${bold ? ' font-weight="700"' : ''}${fitToWidth(String(value), width, size)}>${xml(value)}</text>`);
  };
  const cancelled = snapshot.cancellation;
  const paymentCancelled = (line: DisbursementVoucherPrintSnapshot['lines'][number]) => paid && Boolean(cancelled?.expenseIds?.includes(line.expenseId ?? ''));
  const band = cancelled ? [`ยกเลิกแล้ว${cancelled.at ? ` เมื่อ ${when(cancelled.at)}` : ''}`,
    ...(paid ? [cancelled.expenseNumbers?.length ? `การจ่ายของรายการ ${cancelled.expenseNumbers.join(', ')} ถูกยกเลิก` : 'การจ่ายในใบนี้ถูกยกเลิก'] : []),
    ...(cancelled.reason ? [`เหตุผล: ${cancelled.reason}`] : []),
    ...(cancelled.reissuedDocumentNumber ? [`ออกใบใหม่แทนแล้ว เลขที่ ${cancelled.reissuedDocumentNumber}`] : [])].flatMap(s => wrapText(s, 780, 13)) : [];
  const branch = snapshot.branch?.taxBranchCode ? taxBranchWords(snapshot.branch.taxBranchCode)
    : snapshot.branch?.name ? (snapshot.branch.name === 'สำนักงานใหญ่' ? snapshot.branch.name : `สาขา ${snapshot.branch.name}`) : null;
  const address = snapshot.branch?.taxBranchCode && snapshot.branch.taxBranchCode !== '00000' && snapshot.branch.addressJson
    ? snapshot.branch.addressJson : snapshot.company?.addressJson;
  const companyAddress = address && typeof address === 'object'
    ? formatCompanyLegalAddressForPrint(address as CompanyLegalAddress) ?? Object.values(address).filter(v => typeof v === 'string').join(' ') : null;
  const newPage = () => {
    page++; if (page) breaks.push(page * pageHeight);
    let leftY = 45;
    for (const [value, size] of [[snapshot.company?.registeredName || snapshot.company?.name, 17], [companyAddress, 12],
      [[snapshot.company?.taxId ? `เลขผู้เสียภาษี ${snapshot.company.taxId}` : null, branch].filter(Boolean).join(' · '), 12],
      [snapshot.company?.phone ? `โทร ${snapshot.company.phone}` : null, 12]] as const) {
      if (!value) continue;
      for (const line of wrapText(value, 440, size)) { text(line, 35, leftY, 440, size, false, size === 17); leftY += size === 17 ? 28 : 22; }
    }
    text(`${paid ? DISBURSEMENT_VOUCHER_WORDS.oncePaid : DISBURSEMENT_VOUCHER_WORDS.beforePaid}${page ? ' (ต่อ)' : ''}`, 815, 48, 320, 27, true, true);
    let rightY = 80;
    if (!paid) { text(`ครั้งที่ ${snapshot.revision ?? 0} · ยังไม่ได้จ่ายเงิน`, 815, rightY, 300, 12, true); rightY += 22; }
    for (const [label, value] of [['เลขที่', snapshot.documentNumber], ['วันที่เอกสาร', snapshot.documentDate ? formatThaiExportDate(snapshot.documentDate) : null],
      ['กำหนดจ่าย', snapshot.plannedPayDate ? formatThaiExportDate(snapshot.plannedPayDate) : null]]) {
      if (!value) continue;
      text(label, 515, rightY, 95, 12); text(value, 815, rightY, 195, 12, true); rightY += 22;
    }
    if (cancelled) { text('ยกเลิกแล้ว', 815, rightY, 300, 13, true, true); rightY += 22; }
    y = Math.max(leftY, rightY) + 6;
  };
  const ensure = (height: number) => { if (y + height > bottom) newPage(); };
  const paragraph = (value: unknown, size = 13) => {
    if (value == null || !String(value).trim()) return;
    for (const line of wrapText(value, 780, size)) { ensure(22); text(line, 35, y, 780, size); y += 22; }
  };
  newPage();
  const first = snapshot.lines[0];
  const samePayee = first?.vendorName && snapshot.lines.every(line =>
    ['vendorName', 'vendorTaxId', 'vendorBranchCode', 'vendorAddress'].every(key => {
      const field = key as 'vendorName' | 'vendorTaxId' | 'vendorBranchCode' | 'vendorAddress';
      return line[field] !== undefined && (line[field]?.trim() || null) === (first[field]?.trim() || null);
    }));
  const payee = samePayee ? { name: first.vendorName!, taxId: first.vendorTaxId, branchCode: first.vendorBranchCode, address: first.vendorAddress } : snapshot.payee;
  const payeeTop = y;
  // Lay out both columns before drawing the background; long identities grow the box.
  const boxIndex = parts.length;
  let leftY = y + 24, rightY = leftY;
  const partyLine = (value: unknown, size = 12, bold = false) => {
    if (value == null || !String(value).trim()) return;
    for (const line of wrapText(value, bold ? 330 : 360, size)) { text(line, 49, leftY, 360, size, false, bold); leftY += bold ? 24 : 20; }
  };
  parts.push('<g fill="#555">'); partyLine('ผู้รับเงิน'); parts.push('</g>');
  partyLine(payee.name, 15, true);
  partyLine(payee.address);
  partyLine([payee.taxId ? `เลขผู้เสียภาษี ${payee.taxId}` : '', payee.branchCode ? taxBranchWords(payee.branchCode) : ''].filter(Boolean).join(' · '));
  const methodCode = (paid ? snapshot.paymentMethod : snapshot.plannedMethod) || '';
  const method = methods[methodCode];
  const date = paid ? snapshot.paidDate : snapshot.plannedPayDate;
  const account = snapshot.payeeAccount?.last4 ? [snapshot.payeeAccount.bankName, snapshot.payeeAccount.accountName,
    snapshot.payeeAccount.accountNumber || `xxx-${snapshot.payeeAccount.last4}`].filter(Boolean).join(' · ') : null;
  for (const fact of [date ? `${paid ? 'วันที่จ่าย' : 'กำหนดจ่าย'} ${when(date)}` : null,
    method ? `${paid ? 'วิธีจ่าย' : 'วิธีที่จะจ่าย'} ${method}` : null,
    account ? `บัญชีผู้รับเงิน ${account}` : null,
    ['BANK_TRANSFER', 'CHEQUE'].includes(methodCode) ? `หลักฐานการรับเงิน: ${methodCode === 'BANK_TRANSFER' ? 'สลิปการโอน' : 'สำเนาเช็ค'}` : null,
    paid && snapshot.paidFromRef ? `จ่ายจาก ${snapshot.paidFromRef}` : null]) {
    if (!fact) continue;
    for (const line of wrapText(fact, 350, 12)) { text(line, 451, rightY, 350, 12); rightY += 20; }
  }
  y = Math.max(leftY, rightY);
  parts.splice(boxIndex, 0, `<rect x="35" y="${page * pageHeight + payeeTop}" width="780" height="${y - payeeTop}" rx="8" fill="#f5f5f5"/>`);
  y += 32;
  if (paid && snapshot.origin === 'REISSUED' && snapshot.replacesDocumentNumber) paragraph(`ออกแทนใบเลขที่ ${snapshot.replacesDocumentNumber}`);
  const showNet = snapshot.lines.some(line => !new Decimal(line.netPayable).eq(paid ? paymentCancelled(line) ? 0 : line.paidThisTime || 0 : line.amount || 0));
  const widths = paid ? showNet ? [150, 110, 150, 70, 65, 70, 80, 85] : [150, 110, 185, 75, 75, 100, 85]
    : showNet ? [150, 110, 220, 75, 75, 75, 75] : [150, 110, 230, 80, 80, 130];
  const headings = ['เลขรายจ่าย', 'วันที่', 'รายละเอียด', 'ยอดรวม', 'ภาษีที่หักไว้', ...(showNet ? ['ยอดสุทธิที่ต้องจ่าย'] : []), paid ? 'ยอดที่จ่าย' : 'ยอดที่จะจ่าย', ...(paid ? ['ค้างหลังจ่าย'] : [])];
  const tableHeader = () => {
    const wrapped = headings.map((label, i) => !label ? [] : i === 4 ? [label] : wrapText(label, widths[i]! - 8, 12));
    const height = (Math.max(1, ...wrapped.map(lines => lines.length)) - 1) * spacing.lineHeight + spacing.rowHeight;
    ensure(height + spacing.rowHeight);
    parts.push(`<rect x="35" y="${page * pageHeight + y - spacing.ruleToBaseline}" width="780" height="${height}" fill="#eee"/>`);
    let x = 35;
    wrapped.forEach((lines, i) => { lines.forEach((line, j) => text(line, i >= 3 ? x + widths[i]! : x + 4, y + j * spacing.lineHeight, widths[i]! - 8, 12, i >= 3)); x += widths[i]!; });
    // Keep the bottom of the last heading clear of the first row rule too.
    y += height;
  };
  tableHeader();
  for (const line of snapshot.lines) {
    const cells = [[line.expenseNumber, line.vendorDocumentNumber].filter(Boolean).join(' / '), when(line.expenseDate), line.description || '', money(line.grandTotal), money(line.wht), ...(showNet ? [money(line.netPayable)] : []), money(paid ? paymentCancelled(line) ? '0' : line.paidThisTime : line.amount), ...(paid ? [paymentCancelled(line) ? 'ยกเลิกการจ่ายแล้ว' : money(line.outstandingAfter)] : [])];
    const vendor = line.vendorName && normalizeVendorName(line.vendorName) !== normalizeVendorName(payee.name) ? line.vendorName : null;
    const wrapped = cells.map((cell, i) => i === 2 ? [...(cell ? wrapText(cell, widths[i]! - 8, 12) : []), ...(vendor ? wrapText(vendor, widths[i]! - 8, 12) : [])] : cell ? [cell] : []);
    const height = (Math.max(1, ...wrapped.map(c => c.length)) - 1) * spacing.lineHeight + spacing.rowHeight;
    if (y + height > bottom) { newPage(); tableHeader(); }
    const count = Math.max(1, ...wrapped.map(cell => cell.length));
    for (let offset = 0; offset < count;) {
      if (bottom - y < spacing.rowHeight) { newPage(); tableHeader(); }
      const take = Math.min(count - offset, Math.floor((bottom - y - spacing.rowHeight) / spacing.lineHeight) + 1);
      const fragmentHeight = (take - 1) * spacing.lineHeight + spacing.rowHeight;
      const last = offset + take === count;
      parts.push(`<path d="M35 ${page * pageHeight + y - spacing.ruleToBaseline} H815" stroke="#ddd"/>`);
      let x = 35;
      wrapped.forEach((cell, i) => {
        const values = i === 2 ? cell.slice(offset, offset + take) : i >= 3 ? last ? cell : [] : offset ? cell.map(value => `${value} (ต่อ)`) : cell;
        values.forEach((value, j) => { if (value) text(value, i >= 3 ? x + widths[i]! : x + 4, y + j * spacing.lineHeight, widths[i]! - 8, 12, i >= 3); }); x += widths[i]!;
      });
      y += fragmentHeight; offset += take;
      if (!last) { newPage(); tableHeader(); }
    }
  }
  y += 6;
  const sum = (field: 'grandTotal' | 'wht') => snapshot.lines.reduce((total, l) => total.plus(l[field]), new Decimal(0)).toFixed(2);
  const grandTotal = snapshot.totals?.grandTotal ?? sum('grandTotal'), wht = snapshot.totals?.wht ?? sum('wht'), amount = paid && cancelled
    ? disbursementVoucherPaymentAmount(snapshot.totals?.paidThisTime || '0', snapshot.lines.map(line => ({ amount: line.paidThisTime || '0', paymentInEffect: !paymentCancelled(line) }))).amount
    : paid ? snapshot.totals?.paidThisTime : snapshot.total;
  const totalRows = [['รวมเป็นเงิน', grandTotal], ...(new Decimal(wht).gt(0) ? [['ภาษีที่หักไว้', wht]] : []), [paid ? 'ยอดที่จ่าย' : 'ยอดที่จะจ่าย', amount]];
  const words = wrapText(`(${thaiBahtText(amount || '0')})`, 420, 14);
  const totalsHeight = Math.max(totalRows.length * 30 + 12, words.length * 22 + 16);
  ensure(totalsHeight);
  parts.push(`<rect x="35" y="${page * pageHeight + y - 18}" width="444" height="${words.length * 22 + 16}" rx="8" fill="#f5f5f5"/>`);
  words.forEach((line, i) => text(line, 47, y + 5 + i * 22, 420, 14));
  totalRows.forEach(([label, value], i) => {
    const last = i === totalRows.length - 1, baseline = y + i * 30 + (last ? 10 : 0);
    if (last) parts.push(`<path d="M503 ${page * pageHeight + baseline - 23} H815" stroke="#aaa"/>`);
    text(label, 503, baseline, 185, 14, false, last); text(money(value), 815, baseline, 125, 14, true, last);
  });
  y += totalsHeight;
  const netTotal = new Decimal(grandTotal).minus(wht);
  const originalAmount = new Decimal((paid ? snapshot.totals?.paidThisTime : snapshot.total) || 0);
  if (!netTotal.eq(amount || 0)) {
    if (!originalAmount.eq(amount || 0)) paragraph('ยอดนี้ไม่รวมรายการที่การจ่ายถูกยกเลิก', 13);
    if (!netTotal.eq(originalAmount)) paragraph('ยอดนี้ไม่เท่ากับยอดรวมหักภาษี เพราะมีรายการที่จ่ายบางส่วน หรือเคยจ่ายไปแล้วบางส่วน', 13);
  }
  if (paid) paragraph(snapshot.paymentEvidence ? `หลักฐานการจ่าย: แนบ 1 ไฟล์${snapshot.paymentEvidence.attachedByName ? ` โดย ${snapshot.paymentEvidence.attachedByName}` : ''}${snapshot.paymentEvidence.attachedAt ? ` เมื่อ ${when(snapshot.paymentEvidence.attachedAt)}` : ''}` : 'หลักฐานการจ่าย: ไม่ได้แนบ');
  if (snapshot.note) paragraph(`หมายเหตุ ${snapshot.note}`);
  band.forEach(line => paragraph(line));
  const receiverRequired = !['BANK_TRANSFER', 'CHEQUE'].includes((paid ? snapshot.paymentMethod : snapshot.plannedMethod) || '');
  const actors: Actor[] = [snapshot.actors?.preparer ?? { name: snapshot.preparerName }, paid && snapshot.directPayment ? {} : snapshot.actors?.approver ?? {}, paid ? snapshot.actors?.payer ?? {} : {}, ...(receiverRequired ? [{}] : [])];
  const labels = ['ผู้จัดทำ', snapshot.actors?.approver?.selfApproved && !snapshot.directPayment ? 'ผู้อนุมัติ (อนุมัติเอง)' : 'ผู้อนุมัติ', 'ผู้จ่าย', 'ผู้รับเงิน'];
  const columnWidth = 780 / actors.length, lineWidth = columnWidth - 15;
  const names = actors.map(a => a.name?.trim() ? wrapText(`(${a.name.trim()})`, lineWidth - 5, 13) : []);
  const boxHeight = Math.max(1, ...names.map(n => n.length)) * 18 + 128;
  const contentBottom = y;
  const signatureStart = () => y < pageHeight * 2 / 3
    ? Math.max(Math.min(spacing.signatureAnchor, bottom - boxHeight), y + spacing.signatureGap)
    : y + spacing.signatureGap;
  const signatureTop = signatureStart();
  if (signatureTop + boxHeight > bottom) { newPage(); y = signatureStart(); }
  else y = signatureTop;
  parts.push(`<g data-signature-block="true" data-content-bottom="${contentBottom}" data-top="${y}" data-page="${page + 1}" data-height="${boxHeight}">`);
  actors.forEach((actor, i) => {
    const x = 35 + i * columnWidth;
    parts.push(`<g data-signature-column="${i}">`);
    text(labels[i], x + lineWidth / 2, y, lineWidth, 13, 'middle');
    if (actor.signature && actor.signatureDataUrl) parts.push(`<image x="${x}" y="${page * pageHeight + y + 8}" width="${lineWidth}" height="${spacing.signatureArea}" preserveAspectRatio="xMidYMid meet" href="${xml(actor.signatureDataUrl)}"/>`);
    parts.push(`<path d="M${x} ${page * pageHeight + y + 83} h${lineWidth}" stroke="#aaa"/>`);
    names[i]!.forEach((name, j) => text(name, x + lineWidth / 2, y + 83 + spacing.signatureRuleToBaseline + j * 18, lineWidth - 5, 13, 'middle'));
    if (!names[i]!.length) {
      const baseline = page * pageHeight + y + 83 + spacing.signatureRuleToBaseline;
      text('(', x, y + 83 + spacing.signatureRuleToBaseline, 10, 13);
      text(')', x + lineWidth - 5, y + 83 + spacing.signatureRuleToBaseline, 10, 13);
      parts.push(`<path d="M${x + 10} ${baseline + 2} h${lineWidth - 20}" stroke="#aaa"/>`);
    }
    text(actor.at ? `วันที่ ${formatThaiExportDate(actor.at)}` : 'วันที่', actor.at ? x + lineWidth / 2 : x, y + boxHeight - 10, lineWidth, 12, actor.at ? 'middle' : false);
    if (!actor.at) parts.push(`<path d="M${x + 32} ${page * pageHeight + y + boxHeight - 8} h${lineWidth - 32}" stroke="#aaa"/>`);
    parts.push('</g>');
  });
  parts.push('</g>');
  const pages = page + 1;
  if (pages > 1) for (let i = 0; i < pages; i++) {
    page = i;
    text(`หน้า ${i + 1}/${pages}`, 815, 1220, 100, 11, true);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="850" height="${(page + 1) * pageHeight}" viewBox="0 0 850 ${(page + 1) * pageHeight}" data-pdf-breaks="${breaks.join(',')}"${pages > 1 ? ` data-pdf-page-height="${pageHeight}"` : ''}><rect width="100%" height="100%" fill="white"/><g font-family="Noto Sans Thai, Tahoma, sans-serif" fill="#111">${parts.join('')}</g></svg>`);
}
