import { removeSubstituteReceiptDisplayMetadata, THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';
import { createHash } from 'node:crypto';
import { formatThaiExportDate } from '../../../../common/export/thai-date.logic';

export const SUBSTITUTE_RECEIPT_TITLE = 'ใบรับรองแทนใบเสร็จรับเงิน';

export const SUBSTITUTE_RECEIPT_ATTESTATION_TITLE = 'หน้ารับรองโดยระบบ (แนบท้ายฟอร์มที่ลงนามด้วยมือ)';

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
// Old (schema 1) snapshots kept a role key as the signer's position. They can still be rendered (an approval or a
// historical copy), so the key prints as the one list names that role; stored documents are never rewritten.
const POSITION_LABELS: Record<string, string> = {
  admin: THAI_SYSTEM_ROLE_NAMES.ADMIN, owner: THAI_SYSTEM_ROLE_NAMES.OWNER, manager: THAI_SYSTEM_ROLE_NAMES.MANAGER,
  staff: THAI_SYSTEM_ROLE_NAMES.STAFF, finance: THAI_SYSTEM_ROLE_NAMES.FINANCE, accountant: THAI_SYSTEM_ROLE_NAMES.ACCOUNTANT,
};

export type SubstituteReceiptEvidenceRef = {
  id: string;
  purpose: string;
  originalFileName: string;
  mimeType: string;
  checksumSha256: string | null;
};

/**
 * W06/D04 — the reviewed allocation this certificate's amount is a share of. Recorded in the
 * snapshot (so it is inside the certified checksum) and printed under the amount, because the bank
 * slip shows the WHOLE purchase and this document certifies only the company's part (§12.2).
 */
export type SubstituteReceiptCaptureAllocation = {
  groupId: string;
  /** What the accountant already sees in `evidenceRef`: `g` + the last 8 of the group id. */
  groupRef: string;
  allocationId: string;
  allocationRevision: number;
  scopeKey: string;
  paidTotal: string;
  companyAmount: string;
  personalAmount: string;
  policyVersion: string;
};

export type SubstituteReceiptSnapshot = {
  schemaVersion?: 2;
  correction?: { evidenceId: string; reason: string };
  captureAllocation?: SubstituteReceiptCaptureAllocation;
  fundingSource?: 'COMPANY' | 'PERSONAL_ADVANCE' | null;
  paymentStatement?: string;
  paperReview?: { uploadedByUserId: string; uploadedByName?: string; uploadedAt: string; reviewerUserId: string; reviewerName: string; samePerson: boolean };
  documentNumber: string;
  version: number;
  company: { name: string; nameSource?: 'REGISTERED' | 'DISPLAY_NAME'; branchName: string | null; taxId: string | null };
  expense: {
    id: string;
    expenseNumber: string | null;
    expenseDate: string;
    paymentDate: string | null;
    currency: string;
    grandTotalAmount: string;
    netPayableAmount?: string;
    whtAmount?: string;
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
  payer: { userId: string | null; name: string; position: string; certifiedAt: string; roleLabel?: 'ผู้รับรองการจ่าย' };
  certificationText: string;
  evidence: SubstituteReceiptEvidenceRef[];
  note: string | null;
};

export type SubstituteReceiptApprover = {
  userId: string | null;
  name: string;
  position: string;
  approvedAt: string;
};

/**
 * D04 wording, verbatim. `null` when the company paid the whole purchase — there is no share to
 * explain, and a sentence saying "810 of 810" would invent a division nobody made. Never states
 * that the payment evidence shows the company amount (§12.2, A17).
 */
export function captureAllocationStatement(snapshot: Pick<SubstituteReceiptSnapshot, 'captureAllocation'>): string | null {
  const capture = snapshot.captureAllocation;
  if (!capture || money(capture.companyAmount) === money(capture.paidTotal)) return null;
  return `ใบรับรองนี้รับรองส่วนของกิจการ ${money(capture.companyAmount)} บาท จากยอดที่จ่ายจริง ${money(capture.paidTotal)} บาท`
    + ` ตามการจัดส่วนที่ตรวจแล้ว (กลุ่มหลักฐาน ${capture.groupRef} ครั้งที่ ${capture.allocationRevision})`;
}

export function buildSubstituteCertificationText(name: string, position: string, literal = false): string {
  return `ข้าพเจ้า ${name}${position.trim() ? ` ตำแหน่ง ${literal ? position : positionLabel(position)}` : ''} ขอรับรองว่ารายจ่ายข้างต้นนี้ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้ และได้จ่ายไปในงานของกิจการโดยแท้`;
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

/** Online and paper forms share the clean document heading. Status stamps belong to the PDF
 * composer; document identity/version remain in the snapshot and reference fields. */
export function renderSubstituteReceiptSvg(
  snapshot: SubstituteReceiptSnapshot,
  payerSignatureDataUrl?: string,
  approver?: SubstituteReceiptApprover,
  approverSignatureDataUrl?: string,
  options: { unsignedForm?: boolean; paperForm?: boolean; approverIsOwner?: boolean } = {},
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
  // D04: the share statement belongs with the amount it qualifies — directly under the total block.
  const captureStatement = captureAllocationStatement(snapshot);
  const captureLines = captureStatement ? wrapText(captureStatement, 735) : [];
  const tableBottom = rowY + 68;
  const reasonLines = wrapText(`เหตุผลที่ไม่สามารถเรียกใบเสร็จ: ${snapshot.missingReceiptReason}`, 735);
  const purposeLines = wrapText(`วัตถุประสงค์ทางธุรกิจ: ${snapshot.expense.businessPurpose}`, 735);
  const fundingNote = snapshot.fundingSource ? `${(snapshot.fundingSource === 'COMPANY' && snapshot.paymentStatement ? `ชำระด้วยเงินของกิจการ ${snapshot.company.name} เต็มจำนวน` : snapshot.paymentStatement) ?? `แหล่งเงิน: ${snapshot.fundingSource === 'COMPANY' ? 'กิจการจ่ายเต็มจำนวน' : 'พนักงานสำรองจ่ายเต็มจำนวน (ยังไม่ใช่การจ่ายคืนจากกิจการ)'}`} · สุทธิจ่าย ${money(snapshot.expense.netPayableAmount ?? snapshot.expense.grandTotalAmount)} บาท · หัก ณ ที่จ่าย ${money(snapshot.expense.whtAmount ?? '0')} บาท` : '';
  const noteLines = [...wrapText(fundingNote, 735), ...(snapshot.correction ? wrapText(`แก้เฉพาะชื่อ/ตำแหน่งจาก ${snapshot.correction.evidenceId}: ${snapshot.correction.reason}`, 735) : []), ...(snapshot.note ? wrapText(`หมายเหตุ: ${snapshot.note}`, 735) : [])];
  const captureY = tableBottom + 30;
  const reasonY = tableBottom + 38 + (captureLines.length ? captureLines.length * 22 + 8 : 0);
  const purposeY = reasonY + reasonLines.length * 22 + 12;
  const noteY = purposeY + purposeLines.length * 22 + 12;
  const certificationTop = noteY + noteLines.length * 22 + 10;
  const certificationText = snapshot.payer.position ? snapshot.certificationText.replace(
    `ตำแหน่ง ${snapshot.payer.position}`,
    `ตำแหน่ง${options.paperForm ? ' (ถ้ามี)' : ''} ${(snapshot.schemaVersion === 2 ? snapshot.payer.position : positionLabel(snapshot.payer.position))}`,
  ) : snapshot.certificationText;
  const certificationLines = wrapText(certificationText.replace('และได้จ่ายไปในงานของบริษัทโดยแท้', 'และได้จ่ายไปในงานของกิจการโดยแท้'), 720);
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
  const selfSigned = Boolean(approver?.userId && approver.userId === snapshot.payer.userId);
  // OWNER_SELF also lets an admin or a manager sign both lines: the owner is named only when the approval
  // checked that role, anyone else by the name printed under the approver's signature.
  const selfSignedNote = options.approverIsOwner
    ? 'ลงนามโดยเจ้าของกิจการในฐานะผู้จ่ายเงินและผู้อนุมัติ'
    : `ลงนามโดย ${approver?.name ?? ''} ในฐานะผู้จ่ายเงินและผู้อนุมัติ`;
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
       <text x="615" y="${signaturesStart + 116}" text-anchor="middle"${fitToWidth(signerNameWithPosition(approver, snapshot.schemaVersion), 270)}>${xml(signerNameWithPosition(approver, snapshot.schemaVersion))}</text>
       <text x="615" y="${signaturesStart + 140}" text-anchor="middle">ผู้อนุมัติ · ${xml(formatDate(approver.approvedAt))}</text>`
    : `<text x="615" y="${signaturesStart + 75}" text-anchor="middle" fill="#777">รอผู้อนุมัติลงนาม</text>`;

  const paperSignatureBlock = (x: number, role: string) => `
    <text x="${x}" y="${signaturesStart + 15}" text-anchor="middle" font-weight="700">${role}</text>
    <line x1="${x - 135}" y1="${signaturesStart + 92}" x2="${x + 135}" y2="${signaturesStart + 92}" stroke="#222"/>
    <text x="${x}" y="${signaturesStart + 118}" text-anchor="middle">ชื่อ (________________________________)</text>
    <text x="${x}" y="${signaturesStart + 150}" text-anchor="middle">ตำแหน่ง (ถ้ามี) _______________________</text>
    <text x="${x}" y="${signaturesStart + 182}" text-anchor="middle">วันที่ ________ / ________ / ____________</text>`;
  const signatures = `${options.paperForm ? paperSignatureBlock(240, 'ผู้รับรองการจ่าย') + paperSignatureBlock(615, 'ผู้อนุมัติ') : `
    ${payerSignatureBlock}
    <line x1="105" y1="${signaturesStart + 92}" x2="375" y2="${signaturesStart + 92}" stroke="#222"/>
    <text x="240" y="${signaturesStart + 116}" text-anchor="middle"${fitToWidth(signerNameWithPosition(snapshot.payer, snapshot.schemaVersion), 270)}>${xml(signerNameWithPosition(snapshot.payer, snapshot.schemaVersion))}</text>
    <text x="240" y="${signaturesStart + 140}" text-anchor="middle">${xml(snapshot.payer.roleLabel ?? 'ผู้จ่ายเงิน/ผู้รับรอง')}${payerSignatureDataUrl ? ` · ${xml(formatDate(snapshot.payer.certifiedAt))}` : ' · รอลงนาม'}</text>
    ${approverBlock}
    `}
    ${selfSigned ? `<text x="425" y="${signaturesStart + 174}" text-anchor="middle" font-size="13" fill="#555"${fitToWidth(selfSignedNote, 760)}>${xml(selfSignedNote)}</text>` : ''}`;
  const heading = `<text x="425" y="46" text-anchor="middle" font-size="25" font-weight="700">${SUBSTITUTE_RECEIPT_TITLE}</text>
    <text x="425" y="80" text-anchor="middle"${fitToWidth(`เลขใบแทน: ${snapshot.documentNumber}`, 750)}>เลขใบแทน: ${xml(snapshot.documentNumber)}</text>
    <text x="50" y="120"${fitToWidth(`กิจการ: ${snapshot.company.name}`, 410)}>กิจการ: ${xml(snapshot.company.name)}</text>
    <text x="470" y="120"${fitToWidth(`สาขา: ${snapshot.company.branchName ?? 'สำนักงานใหญ่'}`, 335)}>สาขา: ${xml(snapshot.company.branchName ?? 'สำนักงานใหญ่')}</text>
    ${snapshot.company.taxId?.trim() ? `<text x="50" y="148">เลขประจำตัวผู้เสียภาษี: ${xml(snapshot.company.taxId)}</text>` : ''}
    <text x="470" y="148">วันที่รายจ่าย: ${xml(formatDate(snapshot.expense.expenseDate))}</text>
    <text x="50" y="176"${fitToWidth(`เลขรายจ่าย: ${snapshot.expense.expenseNumber ?? '-'}`, 400)}>เลขรายจ่าย: ${xml(snapshot.expense.expenseNumber ?? '-')}</text>
    <text x="470" y="176">วันที่จ่าย: ${xml(snapshot.expense.paymentDate ? formatDate(snapshot.expense.paymentDate) : '-')}</text>
    <text x="50" y="204">หลักฐานต้นทาง: ${xml(DOCUMENT_TYPE_LABELS[snapshot.originalSourceDocumentType] ?? 'เอกสารค่าใช้จ่าย')}</text>
    <text x="470" y="204">วิธีชำระเงิน: ${xml(snapshot.expense.paymentMethod ? PAYMENT_METHOD_LABELS[snapshot.expense.paymentMethod] ?? 'อื่น ๆ' : '-')}</text>
    ${payeeLines.length ? multilineText(50, 242, payeeLines, 22) : ''}`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="850" height="${height}" viewBox="0 0 850 ${height}" data-pdf-breaks="${pdfBreaks.join(',')}" role="img" aria-label="${xml(SUBSTITUTE_RECEIPT_TITLE)}">
  <rect width="850" height="${height}" fill="#fff"/>
  <g font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="15" fill="#111">
    ${heading}
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
    ${captureLines.length ? multilineText(50, captureY, captureLines, 22, 735) : ''}
    ${multilineText(50, reasonY, reasonLines, 22)}
    ${multilineText(50, purposeY, purposeLines, 22)}
    ${noteLines.length ? multilineText(50, noteY, noteLines, 22) : ''}
    <rect x="45" y="${certificationTop}" width="760" height="${certificationHeight}" fill="#fafafa" stroke="#777"/>
    ${multilineText(60, certificationTop + 27, certificationLines, 22)}
    <text x="50" y="${evidenceTitleY}" font-weight="700">หลักฐานประกอบ/หลักฐานการจ่ายที่เชื่อมโยง</text>
    ${evidence}
    ${signatures}
  </g>
</svg>`;
  if (height > 1250) {
    return renderSubstituteReceiptContinuationPages(snapshot, heading, tableTop, signatures, signaturesStart,
      [
        ...(captureLines.length ? [{ lines: captureLines }] : []),
        { lines: reasonLines }, { lines: purposeLines }, { lines: noteLines }, { lines: certificationLines, boxed: true },
        { lines: ['หลักฐานประกอบ/หลักฐานการจ่ายที่เชื่อมโยง'], bold: true },
        ...(snapshot.evidence.length ? snapshot.evidence.map(item => ({ lines: wrapText(`• ${item.originalFileName} — ${EVIDENCE_PURPOSE_LABELS[item.purpose] ?? 'หลักฐานประกอบ'}`, 720) })) : [{ lines: ['• ไม่มีเอกสารแนบเพิ่มเติม'] }]),
      ]);
  }
  return Buffer.from(svg, 'utf8');
}

/** Fixed sheets like the claim form: whole rows move together; an unusually tall row continues
 * with its amount only on its final fragment. Each page is rasterized independently by the PDF. */
function renderSubstituteReceiptContinuationPages(
  snapshot: SubstituteReceiptSnapshot, heading: string, firstTableTop: number,
  signatures: string, signaturesStart: number, paragraphs: { lines: string[]; boxed?: boolean; bold?: boolean }[],
): Buffer {
  const pageHeight = 1250, bottom = 1190;
  const pages: string[][] = [[]];
  let page = pages[0]!, y = firstTableTop;
  page.push(heading);
  const nextPage = () => {
    page = []; pages.push(page); y = 125;
    page.push(`<text x="425" y="46" text-anchor="middle" font-size="25" font-weight="700">${SUBSTITUTE_RECEIPT_TITLE} (ต่อ)</text>
      <text x="425" y="80" text-anchor="middle"${fitToWidth(`เลขใบแทน: ${snapshot.documentNumber}`, 750)}>เลขใบแทน: ${xml(snapshot.documentNumber)}</text>`);
  };
  const ensure = (height: number) => { if (y + height > bottom) nextPage(); };
  const tableHeader = () => {
    page.push(`<rect x="45" y="${y}" width="760" height="38" fill="#f7f7f7" stroke="#444"/>
      ${[[96, 'วัน เดือน ปี'], [355, 'รายละเอียดรายจ่าย'], [595, 'จำนวน'], [680, 'จำนวนเงิน'], [767, 'หมายเหตุ']].map(([x, label]) => `<text x="${x}" y="${y + 25}" text-anchor="middle">${label}</text>`).join('')}`);
    y += 38;
  };
  tableHeader();
  const sourceLines = snapshot.expense.lines.length ? snapshot.expense.lines : [{ description: '-', quantity: '-', amount: '0' }];
  sourceLines.forEach((line, index) => {
    const descriptions = wrapText(line.description, DESCRIPTION_WIDTH);
    const notes = index === 0 && snapshot.note ? wrapText(snapshot.note, NOTE_WIDTH) : ['-'];
    const count = Math.max(descriptions.length, notes.length);
    const rowHeight = Math.max(36, count * 21 + 12);
    if (y + rowHeight > bottom) { nextPage(); tableHeader(); }
    for (let offset = 0; offset < count;) {
      if (bottom - y < 36) { nextPage(); tableHeader(); }
      const take = Math.min(count - offset, Math.floor((bottom - y - 12) / 21));
      const height = Math.max(36, take * 21 + 12), last = offset + take === count;
      page.push(`<g data-substitute-row="${index + 1}" data-row-continuation="${offset > 0}" data-top="${y}" data-height="${height}">
        <rect x="45" y="${y}" width="760" height="${height}" fill="none" stroke="#bbb"/>
        ${[150, 560, 630, 730].map(x => `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + height}" stroke="#444"/>`).join('')}
        <text x="54" y="${y + 24}"${fitToWidth(`${formatDate(snapshot.expense.expenseDate)}${offset ? ' (ต่อ)' : ''}`, 96)}>${xml(formatDate(snapshot.expense.expenseDate))}${offset ? ' (ต่อ)' : ''}</text>
        ${multilineText(165, y + 24, descriptions.slice(offset, offset + take), 21, DESCRIPTION_WIDTH)}
        ${last ? `<text x="615" y="${y + 24}" text-anchor="end"${fitToWidth(line.quantity, 60)}>${xml(line.quantity)}</text><text data-substitute-amount="${index + 1}" x="710" y="${y + 24}" text-anchor="end"${fitToWidth(money(line.amount), 90)}>${xml(money(line.amount))}</text>` : ''}
        ${multilineText(742, y + 24, notes.slice(offset, offset + take), 21, NOTE_WIDTH)}</g>`);
      y += height; offset += take;
      if (!last) { nextPage(); tableHeader(); }
    }
  });
  ensure(80);
  page.push(`<g data-substitute-total="true"><text x="620" y="${y + 24}" text-anchor="end" font-weight="700">รวมทั้งสิ้น</text>
    <text x="720" y="${y + 24}" text-anchor="end" font-weight="700">${xml(money(snapshot.expense.grandTotalAmount))}</text>
    <text x="54" y="${y + 58}"${fitToWidth(`รวมเป็นตัวอักษร: ${thaiBahtText(snapshot.expense.grandTotalAmount)}`, BAHT_TEXT_WIDTH)}>รวมเป็นตัวอักษร: ${xml(thaiBahtText(snapshot.expense.grandTotalAmount))}</text></g>`);
  y += 92;
  for (const { lines, boxed, bold } of paragraphs) {
    const padding = boxed ? 28 : 12;
    if (lines.length * 22 + padding <= bottom - 125) ensure(lines.length * 22 + padding);
    for (let offset = 0; offset < lines.length;) {
      ensure(22 + padding);
      const take = Math.min(lines.length - offset, Math.floor((bottom - y - padding) / 22));
      const height = take * 22 + padding;
      if (boxed) page.push(`<rect x="45" y="${y}" width="760" height="${height}" fill="#fafafa" stroke="#777"/>`);
      page.push(`<g${bold ? ' font-weight="700"' : ''}>${multilineText(boxed ? 60 : 50, y + (boxed ? 27 : 18), lines.slice(offset, offset + take), 22, boxed ? 720 : 735)}</g>`);
      y += height; offset += take;
    }
  }
  // Translate the existing signature block intact; it occurs once on the final sheet.
  const signatureHeight = 248;
  ensure(signatureHeight);
  page.push(`<g data-substitute-signatures="true" transform="translate(0 ${y - signaturesStart})">${signatures}</g>`);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="850" height="${pages.length * pageHeight}" viewBox="0 0 850 ${pages.length * pageHeight}" data-pdf-page-height="${pageHeight}" data-pdf-breaks="${pages.slice(1).map((_, i) => (i + 1) * pageHeight).join(',')}" role="img" aria-label="${SUBSTITUTE_RECEIPT_TITLE}">
    <rect width="850" height="${pages.length * pageHeight}" fill="#fff"/>
    <g font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="15" fill="#111">${pages.map((content, i) => `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="${pageHeight}" viewBox="0 0 850 ${pageHeight}" y="${i * pageHeight}" font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="15" fill="#111" data-pdf-sheet="${i + 1}" data-substitute-page="${i + 1}"><rect width="850" height="${pageHeight}" fill="#fff"/>${content.join('')}<text x="805" y="1225" text-anchor="end" font-size="12">หน้า ${i + 1}/${pages.length}</text></svg>`).join('')}</g></svg>`, 'utf8');
}

/** `fontSize` defaults to this sheet's body size; ใบสำคัญรับเงิน prints at 18 and passes its own. */
/**
 * R11 — the system attestation page of the PAPER route. The ink lives on the scan that precedes
 * this page in the artifact, so nothing here is a signature box: it is the system's own statement
 * of what was certified, by whom, when, and against which two checksums.
 *
 * Separate from `renderSubstituteReceiptSvg`, whose signature blocks belong to online signing.
 */
export function renderSubstituteReceiptAttestationSvg(
  snapshot: SubstituteReceiptSnapshot,
  input: {
    snapshotChecksumSha256: string;
    wetSignedScanChecksumSha256: string;
    approver?: SubstituteReceiptApprover;
  },
): Buffer {
  const title = snapshot.paperReview ? 'บันทึกตรวจรับฉบับลงนามบนกระดาษ' : SUBSTITUTE_RECEIPT_ATTESTATION_TITLE;
  const facts: Array<[string, string]> = [
    ['เลขที่เอกสาร', snapshot.documentNumber],
    ['กิจการ', snapshot.company.name],
    ...(snapshot.fundingSource ? [[snapshot.paymentStatement ? 'การชำระเงิน' : 'แหล่งเงิน', (snapshot.fundingSource === 'COMPANY' && snapshot.paymentStatement ? `ชำระด้วยเงินของกิจการ ${snapshot.company.name} เต็มจำนวน` : snapshot.paymentStatement) ?? (snapshot.fundingSource === 'COMPANY' ? 'กิจการจ่ายเต็มจำนวน' : 'พนักงานสำรองจ่ายเต็มจำนวน')] as [string, string]] : []),
    ['สาขา', snapshot.company.branchName ?? 'สำนักงานใหญ่'],
    ...(snapshot.company.taxId?.trim() ? [['เลขประจำตัวผู้เสียภาษี', snapshot.company.taxId] as [string, string]] : []),
    ['เลขรายจ่าย', snapshot.expense.expenseNumber ?? '-'],
    ['วันที่รายจ่าย', formatDate(snapshot.expense.expenseDate)],
    ['วันที่จ่าย', snapshot.expense.paymentDate ? formatDate(snapshot.expense.paymentDate) : '-'],
    ['วิธีชำระเงิน', snapshot.expense.paymentMethod ? PAYMENT_METHOD_LABELS[snapshot.expense.paymentMethod] ?? 'อื่น ๆ' : '-'],
    ['ผู้รับเงิน', snapshot.payee?.name ?? '-'],
    ['จำนวนเงิน', `${money(snapshot.expense.grandTotalAmount)} ${snapshot.expense.currency}`],
    ['จำนวนเงิน (ตัวอักษร)', thaiBahtText(snapshot.expense.grandTotalAmount)],
    // D04: the same sentence the online sheet prints under the amount — the paper route certifies
    // the same share, so it states the same relationship to the purchase that was actually paid.
    ...(captureAllocationStatement(snapshot) ? [['ส่วนของกิจการตามการจัดส่วน', captureAllocationStatement(snapshot)!] as [string, string]] : []),
    ['วัตถุประสงค์ทางธุรกิจ', snapshot.expense.businessPurpose],
    ['เหตุผลที่ไม่มีใบเสร็จ', snapshot.missingReceiptReason],
    [snapshot.payer.roleLabel ?? 'ผู้จ่ายเงิน/ผู้รับรอง', signerNameWithPosition(snapshot.payer, snapshot.schemaVersion)],
    ['รับรองเมื่อ', formatDate(snapshot.payer.certifiedAt)],
    ['ผู้อนุมัติ', input.approver ? signerNameWithPosition(input.approver, snapshot.schemaVersion) : 'รออนุมัติ'],
    ['อนุมัติเมื่อ', input.approver ? formatDate(input.approver.approvedAt) : '-'],
    ...(snapshot.paperReview ? [
      ['ผู้อัปโหลด', snapshot.paperReview.uploadedByName ?? '-'],
      ['อัปโหลดเมื่อ', snapshot.paperReview.uploadedAt],
      ['ผู้ตรวจรับ', snapshot.paperReview.reviewerName],
      ['ลงนามสองฐานะโดยคนเดียว', snapshot.paperReview.samePerson ? 'ใช่ (ตามนโยบายกิจการ)' : 'ไม่ใช่'],
    ] as Array<[string, string]> : []),
  ];
  // A checksum is one token or it is not a checksum: these print on one line, condensed if need be,
  // never wrapped — a hash split across two tspans cannot be compared by eye or by search.
  const checksums: Array<[string, string]> = snapshot.paperReview ? [] : [
    ['SHA-256 ของข้อมูลที่รับรอง', input.snapshotChecksumSha256],
    ['SHA-256 ของภาพฟอร์มที่ลงนามด้วยมือ', input.wetSignedScanChecksumSha256],
  ];
  const noticeLines = wrapText(
    snapshot.paperReview ? 'ชื่อ วันที่ลงนาม และตำแหน่ง (ถ้ามี) ถอดจากฉบับกระดาษ ผู้ตรวจรับตรวจความตรงกันของข้อมูล ลายเซ็น และอำนาจผู้อนุมัติ การตรวจรับนี้ไม่ใช่การลงลายมือชื่อแทนบุคคลบนกระดาษ โปรดเก็บต้นฉบับกระดาษประกอบเอกสารนี้' : 'เอกสารนี้ออกตามเส้นทางลงนามด้วยมือ ลายมือชื่อผู้จ่ายเงินและผู้อนุมัติปรากฏบนภาพฟอร์มที่แนบไว้เป็นหน้าแรกของเอกสารฉบับนี้ ระบบเก็บข้อมูลที่รับรองไว้เป็นต้นฉบับเชิงโครงสร้างพร้อมค่าตรวจสอบทั้งสองค่าด้านบน',
    740,
  );
  let y = 150;
  const rows = facts.map(([label, value]) => {
    const lines = wrapText(value, 520);
    const markup = `<text x="50" y="${y}" font-weight="700"${fitToWidth(label, 250)}>${xml(label)}</text>
      ${multilineText(310, y, lines, 22, 520)}`;
    y += Math.max(28, lines.length * 22 + 6);
    return markup;
  }).join('');
  const checksumRows = checksums.map(([label, value]) => {
    const markup = `<text x="50" y="${y}" font-weight="700"${fitToWidth(label, 250)}>${xml(label)}</text>
      <text x="310" y="${y}" font-size="12"${fitToWidth(value, 490, 12)}>${xml(value)}</text>`;
    y += 28;
    return markup;
  }).join('');
  const noticeY = y + 26;
  const height = noticeY + noticeLines.length * 22 + (snapshot.paperReview ? 28 : 60);
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="850" height="${height}" viewBox="0 0 850 ${height}" role="img" aria-label="${xml(title)}">
  <rect width="850" height="${height}" fill="#fff"/>
  <g font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="15" fill="#111">
    <text x="425" y="52" text-anchor="middle" font-size="24" font-weight="700">${title}</text>
    <text x="425" y="82" text-anchor="middle" fill="#555">${SUBSTITUTE_RECEIPT_TITLE}</text>
    <line x1="45" y1="110" x2="805" y2="110" stroke="#444"/>
    ${rows}
    ${checksumRows}
    <line x1="45" y1="${noticeY - 20}" x2="805" y2="${noticeY - 20}" stroke="#bbb"/>
    ${multilineText(50, noticeY, noticeLines, 22, 740)}
    ${snapshot.paperReview ? '' : `<text x="425" y="${height - 22}" text-anchor="middle" font-size="12" fill="#555">เอกสารนี้เป็นหลักฐานประกอบรายจ่ายภายใน มิใช่ใบกำกับภาษี และไม่ก่อสิทธิภาษีซื้อโดยลำพัง</text>`}
  </g>
</svg>`, 'utf8');
}

/** Retain the stored SVG unchanged; remove only former system display metadata in derived views. */
export function withoutSubstituteReceiptPrintMetadata(svg: Buffer): Buffer {
  return Buffer.from(removeSubstituteReceiptDisplayMetadata(svg.toString('utf8')), 'utf8');
}

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

/** Use font sizing supported by both browsers and the PDF rasterizer, which ignores textLength. */
export function fitToWidth(value: string, maxWidth: number, fontSize = BODY_FONT_SIZE): string {
  const width = estimatedWidth(value, fontSize);
  return width > maxWidth ? ` style="font-size:${Math.floor(fontSize * maxWidth / width * 100) / 100}px"` : '';
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

function signerNameWithPosition(signer: { name: string; position: string }, schemaVersion?: number): string {
  return signer.position.trim() ? `${signer.name} · ${schemaVersion === 2 ? signer.position : positionLabel(signer.position)}` : signer.name;
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
