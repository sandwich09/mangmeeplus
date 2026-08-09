import { createHash } from 'node:crypto';
import { formatThaiExportDate } from '../../../../common/export/thai-date.logic';

export const SUBSTITUTE_RECEIPT_TITLE = 'ใบรับรองแทนใบเสร็จรับเงิน';

const THAI_DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
const WORD_SEGMENTER = new Intl.Segmenter('th', { granularity: 'word' });
const GRAPHEME_SEGMENTER = new Intl.Segmenter('th', { granularity: 'grapheme' });
/** Every glyph width below is calibrated at this size; other sizes scale from it. */
const BODY_FONT_SIZE = 15;
/** Text budgets of the two wrapped table columns, inside their rules at x=560 and x=805. */
const DESCRIPTION_WIDTH = 380;
const NOTE_WIDTH = 52;
/** The baht-in-words row spans the sheet from x=54, less a few px of ink allowance. */
const BAHT_TEXT_WIDTH = 745;
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  RECEIPT: 'ใบเสร็จรับเงิน', TAX_INVOICE: 'ใบกำกับภาษี', TRANSFER_SLIP: 'สลิปโอนเงิน',
  HANDWRITTEN_CASH_BILL: 'บิลเงินสดเขียนมือ', SUPPLIER_BILL: 'บิลผู้ขาย', MARKETPLACE_ORDER_SCREENSHOT: 'ภาพคำสั่งซื้อจากมาร์เก็ตเพลส',
  EXPENSE_NOTE_TEXT: 'บันทึกค่าใช้จ่าย (ข้อความ)', SUBSTITUTE_RECEIPT: SUBSTITUTE_RECEIPT_TITLE,
  OTHER_EXPENSE_DOCUMENT: 'เอกสารค่าใช้จ่ายอื่น', NEEDS_REVIEW: 'รอตรวจประเภทเอกสาร',
};
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', CARD: 'บัตรเครดิต/เดบิต', CHEQUE: 'เช็ค', OTHER: 'อื่น ๆ',
};
const EVIDENCE_PURPOSE_LABELS: Record<string, string> = {
  'expense.receipt.supporting': 'หลักฐานประกอบ',
  'expense.payment.evidence': 'หลักฐานการจ่ายเงิน',
};
const POSITION_LABELS: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ', owner: 'เจ้าของกิจการ', manager: 'ผู้จัดการ', staff: 'พนักงาน',
  finance: 'ฝ่ายการเงิน', accountant: 'นักบัญชี',
};

export type SubstituteReceiptEvidenceRef = {
  id: string;
  purpose: string;
  originalFileName: string;
  mimeType: string;
  checksumSha256: string | null;
};

export type SubstituteReceiptSnapshot = {
  documentNumber: string;
  version: number;
  company: { name: string; branchName: string | null; taxId: string | null };
  expense: {
    id: string;
    expenseNumber: string | null;
    expenseDate: string;
    paymentDate: string | null;
    currency: string;
    grandTotalAmount: string;
    paymentMethod: string | null;
    paymentReference: string | null;
    category: string | null;
    businessPurpose: string;
    lines: Array<{ description: string; quantity: string; amount: string }>;
  };
  originalSourceDocumentType: string;
  reasonCode: string;
  missingReceiptReason: string;
  payee?: { name: string; address: string | null; taxId: string | null };
  payer: { userId: string; name: string; position: string; certifiedAt: string };
  certificationText: string;
  evidence: SubstituteReceiptEvidenceRef[];
  note: string | null;
};

export type SubstituteReceiptApprover = {
  userId: string;
  name: string;
  position: string;
  approvedAt: string;
};

export function buildSubstituteCertificationText(name: string, position: string): string {
  return `ข้าพเจ้า ${name} ตำแหน่ง ${positionLabel(position)} ขอรับรองว่ารายจ่ายข้างต้นนี้ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้ และได้จ่ายไปในงานของบริษัทโดยแท้`;
}

export function thaiBahtText(value: string): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) throw new Error('Amount is outside the supported Thai text range.');
  const [whole = '0', fraction = ''] = normalized.split('.');
  if (whole.length > 12) throw new Error('Amount is outside the supported Thai text range.');
  const roundedSatang = BigInt(fraction.padEnd(3, '0').slice(0, 3));
  let baht = BigInt(whole);
  let satang = Number((roundedSatang + 5n) / 10n);
  if (satang === 100) {
    baht += 1n;
    satang = 0;
  }
  return `${thaiInteger(baht)}บาท${satang === 0 ? 'ถ้วน' : `${thaiInteger(BigInt(satang))}สตางค์`}`;
}

function thaiInteger(value: bigint): string {
  if (value === 0n) return 'ศูนย์';
  if (value >= 1_000_000n) {
    const millions = value / 1_000_000n;
    const remainder = value % 1_000_000n;
    return `${thaiInteger(millions)}ล้าน${remainder ? thaiInteger(remainder) : ''}`;
  }
  const digits = value.toString().padStart(6, '0').split('').map(Number);
  let result = '';
  for (let index = 0; index < digits.length; index += 1) {
    const digit = digits[index]!;
    if (digit === 0) continue;
    const position = digits.length - index - 1;
    if (position === 1) result += digit === 1 ? 'สิบ' : digit === 2 ? 'ยี่สิบ' : `${THAI_DIGITS[digit]}สิบ`;
    else if (position === 0 && digit === 1 && result) result += 'เอ็ด';
    else result += `${THAI_DIGITS[digit]}${THAI_POSITIONS[position]}`;
  }
  return result;
}

export function canonicalSnapshotHash(snapshot: SubstituteReceiptSnapshot): string {
  return createHash('sha256').update(JSON.stringify(sortJsonKeys(snapshot))).digest('hex');
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, sortJsonKeys(item)]),
  );
}

export function renderSubstituteReceiptSvg(
  snapshot: SubstituteReceiptSnapshot,
  payerSignatureDataUrl?: string,
  approver?: SubstituteReceiptApprover,
  approverSignatureDataUrl?: string,
): Buffer {
  if (payerSignatureDataUrl) assertSignatureDataUrl(payerSignatureDataUrl);
  if (approver && !approverSignatureDataUrl) throw new Error('Approver signature is required.');
  if (approverSignatureDataUrl) assertSignatureDataUrl(approverSignatureDataUrl);

  const sourceLines = snapshot.expense.lines.length ? snapshot.expense.lines : [{ description: '-', quantity: '-', amount: '0' }];
  const payeeLines = snapshot.payee ? [
    ...wrapText(`ผู้รับเงิน: ${snapshot.payee.name}`, 750),
    ...(snapshot.payee.address ? wrapText(`ที่อยู่: ${snapshot.payee.address}`, 750) : []),
    ...(snapshot.payee.taxId ? wrapText(`เลขประจำตัวประชาชน/เลขประจำตัวผู้เสียภาษี: ${formatThaiTaxId(snapshot.payee.taxId)}`, 750) : []),
  ] : [];
  const tableTop = 283 + payeeLines.length * 22;
  const headerHeight = 38;
  let rowY = tableTop + headerHeight;
  const rowBreaks: number[] = [];
  const rows = sourceLines.map((line, index) => {
    const descriptions = wrapText(line.description, DESCRIPTION_WIDTH);
    const rowNotes = index === 0 && snapshot.note ? wrapText(snapshot.note, NOTE_WIDTH) : ['-'];
    const rowHeight = Math.max(36, descriptions.length * 21 + 12, rowNotes.length * 21 + 12);
    const contentY = rowY + 24;
    const markup = `<line x1="45" y1="${rowY}" x2="805" y2="${rowY}" stroke="#bbb"/>
      <text x="54" y="${contentY}">${xml(formatDate(snapshot.expense.expenseDate))}</text>
      ${multilineText(165, contentY, descriptions, 21, DESCRIPTION_WIDTH)}
      <text x="615" y="${contentY}" text-anchor="end">${xml(line.quantity)}</text>
      <text x="710" y="${contentY}" text-anchor="end">${xml(money(line.amount))}</text>
      ${multilineText(742, contentY, rowNotes, 21, NOTE_WIDTH)}`;
    rowY += rowHeight;
    rowBreaks.push(rowY);
    return markup;
  }).join('');
  const totalY = rowY + 24;
  const tableBottom = rowY + 68;
  const reasonLines = wrapText(`เหตุผลที่ไม่สามารถเรียกใบเสร็จ: ${snapshot.missingReceiptReason}`, 735);
  const purposeLines = wrapText(`วัตถุประสงค์ทางธุรกิจ: ${snapshot.expense.businessPurpose}`, 735);
  const noteLines = snapshot.note ? wrapText(`หมายเหตุ: ${snapshot.note}`, 735) : [];
  const reasonY = tableBottom + 38;
  const purposeY = reasonY + reasonLines.length * 22 + 12;
  const noteY = purposeY + purposeLines.length * 22 + 12;
  const certificationTop = noteY + noteLines.length * 22 + 10;
  const certificationText = snapshot.certificationText.replace(
    `ตำแหน่ง ${snapshot.payer.position}`,
    `ตำแหน่ง ${positionLabel(snapshot.payer.position)}`,
  );
  const certificationLines = wrapText(certificationText, 720);
  const certificationHeight = Math.max(62, certificationLines.length * 22 + 28);
  const evidenceTitleY = certificationTop + certificationHeight + 38;
  let evidenceY = evidenceTitleY + 30;
  const evidenceBreaks: number[] = [];
  const evidence = snapshot.evidence.length
    ? snapshot.evidence.map((item) => {
      const lines = wrapText(`• ${item.originalFileName} — ${EVIDENCE_PURPOSE_LABELS[item.purpose] ?? 'หลักฐานประกอบ'}`, 720);
      const markup = multilineText(64, evidenceY, lines, 21);
      evidenceY += lines.length * 21 + 6;
      evidenceBreaks.push(evidenceY);
      return markup;
    }).join('')
    : multilineText(64, evidenceY, ['• ไม่มีเอกสารแนบเพิ่มเติม'], 21);
  if (!snapshot.evidence.length) {
    evidenceY += 27;
    evidenceBreaks.push(evidenceY);
  }
  const signaturesStart = evidenceY + 58;
  const selfSigned = approver?.userId === snapshot.payer.userId;
  const height = signaturesStart + 220 + (selfSigned ? 28 : 0);
  // The PDF renderer maps these SVG-space positions to raster rows and prefers them over its
  // legacy low-ink fallback. They are boundaries between logical blocks, never arbitrary text rows.
  const pdfBreaks = [...new Set([
    tableTop,
    ...rowBreaks,
    tableBottom,
    certificationTop,
    evidenceTitleY,
    ...evidenceBreaks,
    signaturesStart,
  ])].filter((value) => value > 0 && value < height).sort((left, right) => left - right);
  const payerSignatureY = signaturesStart + 8;
  const approverSignatureY = signaturesStart + 8;
  const payerSignatureBlock = payerSignatureDataUrl
    ? `<image href="${payerSignatureDataUrl}" x="125" y="${payerSignatureY}" width="220" height="78" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="240" y="${signaturesStart + 58}" text-anchor="middle" fill="#777">ตัวอย่างก่อนลงนาม</text>`;
  const approverBlock = approver && approverSignatureDataUrl
    ? `<image href="${approverSignatureDataUrl}" x="500" y="${approverSignatureY}" width="220" height="78" preserveAspectRatio="xMidYMid meet"/>
       <line x1="480" y1="${signaturesStart + 92}" x2="750" y2="${signaturesStart + 92}" stroke="#222"/>
       <text x="615" y="${signaturesStart + 116}" text-anchor="middle"${fitToWidth(`${approver.name} · ${positionLabel(approver.position)}`, 270)}>${xml(approver.name)} · ${xml(positionLabel(approver.position))}</text>
       <text x="615" y="${signaturesStart + 140}" text-anchor="middle">ผู้อนุมัติ · ${xml(formatDate(approver.approvedAt))}</text>`
    : `<text x="615" y="${signaturesStart + 75}" text-anchor="middle" fill="#777">รอผู้อนุมัติลงนาม</text>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="850" height="${height}" viewBox="0 0 850 ${height}" data-pdf-breaks="${pdfBreaks.join(',')}" role="img" aria-label="${xml(SUBSTITUTE_RECEIPT_TITLE)}">
  <rect width="850" height="${height}" fill="#fff"/>
  <g font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="15" fill="#111">
    <text x="425" y="46" text-anchor="middle" font-size="25" font-weight="700">${SUBSTITUTE_RECEIPT_TITLE}</text>
    <text x="425" y="76" text-anchor="middle" fill="#555">เลขที่ ${xml(snapshot.documentNumber)} · version ${snapshot.version}</text>
    <text x="50" y="120"${fitToWidth(`บริษัท: ${snapshot.company.name}`, 410)}>บริษัท: ${xml(snapshot.company.name)}</text>
    <text x="470" y="120"${fitToWidth(`สาขา: ${snapshot.company.branchName ?? 'สำนักงานใหญ่'}`, 335)}>สาขา: ${xml(snapshot.company.branchName ?? 'สำนักงานใหญ่')}</text>
    <text x="50" y="148">เลขประจำตัวผู้เสียภาษี: ${xml(snapshot.company.taxId ?? '-')}</text>
    <text x="470" y="148">วันที่รายจ่าย: ${xml(formatDate(snapshot.expense.expenseDate))}</text>
    <text x="50" y="176">เลขอ้างอิงรายการ: ${xml(snapshot.expense.expenseNumber ?? snapshot.documentNumber)}</text>
    <text x="470" y="176">วันที่จ่าย: ${xml(snapshot.expense.paymentDate ? formatDate(snapshot.expense.paymentDate) : '-')}</text>
    <text x="50" y="204">หลักฐานต้นทาง: ${xml(DOCUMENT_TYPE_LABELS[snapshot.originalSourceDocumentType] ?? 'เอกสารค่าใช้จ่าย')}</text>
    <text x="470" y="204">วิธีชำระเงิน: ${xml(snapshot.expense.paymentMethod ? PAYMENT_METHOD_LABELS[snapshot.expense.paymentMethod] ?? 'อื่น ๆ' : '-')}</text>
    ${payeeLines.length ? multilineText(50, 242, payeeLines, 22) : ''}
    <g fill="none" stroke="#444" stroke-width="1.2">
      <rect x="45" y="${tableTop}" width="760" height="${tableBottom - tableTop}"/>
      <line x1="150" y1="${tableTop}" x2="150" y2="${rowY}"/>
      <line x1="560" y1="${tableTop}" x2="560" y2="${rowY}"/>
      <line x1="630" y1="${tableTop}" x2="630" y2="${tableBottom}"/>
      <line x1="730" y1="${tableTop}" x2="730" y2="${tableBottom}"/>
      <line x1="45" y1="${rowY}" x2="805" y2="${rowY}"/>
      <line x1="45" y1="${rowY + 36}" x2="805" y2="${rowY + 36}"/>
    </g>
    <text x="96" y="${tableTop + 25}" text-anchor="middle">วัน เดือน ปี</text>
    <text x="355" y="${tableTop + 25}" text-anchor="middle">รายละเอียดรายจ่าย</text>
    <text x="595" y="${tableTop + 25}" text-anchor="middle">จำนวน</text>
    <text x="680" y="${tableTop + 25}" text-anchor="middle">จำนวนเงิน</text>
    <text x="767" y="${tableTop + 25}" text-anchor="middle">หมายเหตุ</text>
    ${rows}
    <text x="620" y="${totalY}" text-anchor="end" font-weight="700">รวมทั้งสิ้น</text><text x="720" y="${totalY}" text-anchor="end" font-weight="700">${xml(money(snapshot.expense.grandTotalAmount))}</text>
    <text x="54" y="${totalY + 34}"${fitToWidth(`รวมเป็นตัวอักษร: ${thaiBahtText(snapshot.expense.grandTotalAmount)}`, BAHT_TEXT_WIDTH)}>รวมเป็นตัวอักษร: ${xml(thaiBahtText(snapshot.expense.grandTotalAmount))}</text>
    ${multilineText(50, reasonY, reasonLines, 22)}
    ${multilineText(50, purposeY, purposeLines, 22)}
    ${noteLines.length ? multilineText(50, noteY, noteLines, 22) : ''}
    <rect x="45" y="${certificationTop}" width="760" height="${certificationHeight}" fill="#fafafa" stroke="#777"/>
    ${multilineText(60, certificationTop + 27, certificationLines, 22)}
    <text x="50" y="${evidenceTitleY}" font-weight="700">หลักฐานประกอบ/หลักฐานการจ่ายที่เชื่อมโยง</text>
    ${evidence}
    ${payerSignatureBlock}
    <line x1="105" y1="${signaturesStart + 92}" x2="375" y2="${signaturesStart + 92}" stroke="#222"/>
    <text x="240" y="${signaturesStart + 116}" text-anchor="middle"${fitToWidth(`${snapshot.payer.name} · ${positionLabel(snapshot.payer.position)}`, 270)}>${xml(snapshot.payer.name)} · ${xml(positionLabel(snapshot.payer.position))}</text>
    <text x="240" y="${signaturesStart + 140}" text-anchor="middle">ผู้จ่ายเงิน/ผู้รับรอง${payerSignatureDataUrl ? ` · ${xml(formatDate(snapshot.payer.certifiedAt))}` : ' · รอลงนาม'}</text>
    ${approverBlock}
    ${selfSigned ? `<text x="425" y="${signaturesStart + 174}" text-anchor="middle" font-size="13" fill="#555">ลงนามโดยเจ้าของกิจการในฐานะผู้จ่ายเงินและผู้อนุมัติ</text>` : ''}
    <text x="425" y="${height - 48}" text-anchor="middle" font-size="12" fill="#555">เอกสารนี้เป็นหลักฐานประกอบรายจ่ายภายใน มิใช่ใบกำกับภาษี และไม่ก่อสิทธิภาษีซื้อโดยลำพัง</text>
  </g>
</svg>`;
  return Buffer.from(svg, 'utf8');
}

/** `fontSize` defaults to this sheet's body size; ใบสำคัญรับเงิน prints at 18 and passes its own. */
export function wrapText(value: unknown, maxWidth: number, fontSize?: number): string[] {
  const text = String(value ?? '').trim();
  if (!text) return ['-'];
  const lines: string[] = [];
  let line = '';
  for (const { segment } of WORD_SEGMENTER.segment(text)) {
    const candidate = `${line}${segment}`;
    if (estimatedWidth(candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }
    // `!line` used to short-circuit here, which accepted a single word wider than the
    // column verbatim and never reached the grapheme split below.
    if (line) lines.push(line.trim());
    line = '';
    for (const { segment: grapheme } of GRAPHEME_SEGMENTER.segment(segment.trimStart())) {
      if (line && estimatedWidth(`${line}${grapheme}`, fontSize) > maxWidth) {
        lines.push(line.trim());
        line = '';
      }
      line += grapheme;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/** Text too wide for its column condenses into it instead of running past the rule. */
export function fitToWidth(value: string, maxWidth: number, fontSize?: number): string {
  return estimatedWidth(value, fontSize) > maxWidth ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : '';
}

/**
 * Advance width of one line, measured from the print font stack instead of guessed.
 * The previous flat 8px/7.5px estimate under-measured Thai by 5-18%, and callers at a
 * larger font-size under-measured by that much again on top.
 */
function estimatedWidth(value: string, fontSize = BODY_FONT_SIZE): number {
  let width = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(value)) width += graphemeWidth(segment);
  return width * (fontSize / BODY_FONT_SIZE);
}

/**
 * Advance of one grapheme cluster, keyed on its base glyph — the vowel/tone marks
 * stacked on top of it carry no advance of their own. Thai glyph widths spread from
 * 5px (เ) to 13px (ฒ), so a single average is wrong at both ends: the buckets below
 * are the measured extremes, chosen to round up rather than down on real sentences.
 */
function graphemeWidth(segment: string): number {
  if (/^\s+$/.test(segment)) return 4.5;
  if (/^[.,:;|!()\-]$/.test(segment)) return 5.5;
  if (/^[%@WM#]/.test(segment)) return 14.5;
  if (/^[A-Z0-9]/.test(segment)) return 9.5;
  if (/^[\u0000-\u007f]/.test(segment)) return 8;
  if (/^[ฌญฑฒณ]/.test(segment)) return 13.2;
  if (/^[ซฆทพฟษหฬ]/.test(segment)) return 11.3;
  if (/^[เรใะวาำงโๆไ]/.test(segment)) return 6.8;
  return 9.7;
}

function positionLabel(value: string): string {
  return POSITION_LABELS[value.trim().toLowerCase()] ?? value;
}

/** `maxWidth` condenses any line the estimate still puts over its column, so a font
 *  wider than the one this renderer was measured against cannot spill either. */
function multilineText(x: number, y: number, lines: string[], lineHeight: number, maxWidth?: number): string {
  return `<text x="${x}" y="${y}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}"${maxWidth ? fitToWidth(line, maxWidth) : ''}>${xml(line)}</tspan>`).join('')}</text>`;
}

function assertSignatureDataUrl(value: string): void {
  if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    throw new Error('Only embedded PNG or JPEG signatures are allowed.');
  }
}

export function xml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function money(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : xml(value);
}

export function formatThaiTaxId(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 13
    ? [digits.slice(0, 1), digits.slice(1, 5), digits.slice(5, 10), digits.slice(10, 12), digits.slice(12)].join('-')
    : value;
}

function formatDate(value: string): string {
  return formatThaiExportDate(value);
}
