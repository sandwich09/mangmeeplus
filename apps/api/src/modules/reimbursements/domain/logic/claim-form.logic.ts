/**
 * Printable ใบเบิกค่าใช้จ่าย (reimbursement claim form), lane D.
 *
 * Pure renderer: snapshot in, SVG bytes out. No Nest / Prisma / storage.
 * Thai wrap/escape/baht-text helpers are replicated from the expense
 * substitute-receipt renderer on purpose — the two documents live in different
 * modules and must not import each other's domain logic.
 */
import { civilDate, maskedPayoutAccountNumber } from '@watchdog-bms/contracts';
import type {
  ReimbursementClaimFormLayout,
  ReimbursementClaimSignatureRole,
  ReimbursementDocumentSignedVia,
  ReimbursementPayoutKind,
} from '@watchdog-bms/contracts';
import { cancelledDocumentReasonBox, cancelledDocumentReasonBoxes, cancelledDocumentWatermark } from '../../../../common/documents/cancelled-document';
import { parseReimbursementPolicySnapshot } from '../reimbursement.constants';

export const REIMBURSEMENT_CLAIM_FORM_TITLE_EN = 'REIMBURSEMENT CLAIM FORM';
export const REIMBURSEMENT_CLAIM_FORM_TITLE_TH = 'ใบเบิกค่าใช้จ่าย';

const THAI_DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
/** Same words as the web payment form. */
const PAYMENT_METHOD_LABELS: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', CHEQUE: 'เช็ค', OTHER: 'อื่น ๆ' };
const SAME_PERSON_NOTE = 'ผู้เบิกและผู้อนุมัติเป็นบุคคลเดียวกัน อนุมัติรายการของตนเองตามนโยบายบริษัท';
const WORD_SEGMENTER = new Intl.Segmenter('th', { granularity: 'word' });
const GRAPHEME_SEGMENTER = new Intl.Segmenter('th', { granularity: 'grapheme' });

/** A4 at 850px wide (210:297) — the printed page is one clean sheet even for a 1-line claim. */
const PAGE_WIDTH = 850;
const MIN_PAGE_HEIGHT = 1202;
const SIGNATURE_BLOCK_HEIGHT = 150;
/** Every width below is calibrated at this size; smaller text scales down from it. */
const BODY_FONT_SIZE = 15;
/** Text budgets of the two wrapped table columns, 8px inside their rules at x=480 and x=655. */
const DESCRIPTION_WIDTH = 264;
/** Text budget between the 45px margins, less a few px because glyph ink can sit slightly
 *  outside its advance width. */
const SHEET_WIDTH = 754;
const PURPOSE_WIDTH = 159;
/** Where the table starts under the header, and how far each payout line under the requester's name pushes it down. */
const TABLE_TOP = 218;
const PAYOUT_LINE_HEIGHT = 22;

export type ClaimFormSigner = {
  name: string;
  /** ISO date of the step that happened. */
  at: string;
  /** Stored signature image (data URL), embedded above the name line when present. */
  signatureDataUrl?: string;
};

/**
 * How the requester is paid back (payout spec §17.1), from the claim's own frozen account version.
 * The renderer does not know who asked for the print: it prints the full number when it is handed
 * one and the last 4 digits otherwise.
 */
export type ClaimFormPayout =
  | { method: 'CASH' }
  | {
    method: 'BANK_TRANSFER';
    kind: ReimbursementPayoutKind;
    bankName: string | null;
    accountName: string;
    accountLast4: string;
    /** Handed in only for a print whose requester may see it. Printed as stored: no grouping, leading zeros kept. */
    accountNumber?: string;
    /**
     * Whoever attested this account version ("ตรวจบัญชีแล้ว"); null until someone has. A requester who
     * attested their own account is not named as its checker: the form says they confirmed it themself.
     */
    verifier: { name: string; at: string } | { byRequester: true; at: string } | null;
  };

export type ReimbursementClaimFormSnapshot = {
  requestNo: string;
  submittedAt: string | null;
  currency: string;
  totalAmount: string;
  reason: string;
  requesterName: string;
  company: { name: string; branchName: string | null; taxId: string | null };
  lines: Array<{
    lineNo: number;
    incurredDate: string;
    description: string;
    purpose: string | null;
    amount: string;
    sourceReference?: string;
  }>;
  /** ANY line carrying a receipt attachment or a linked expense ticks ใบเสร็จรับเงิน. */
  hasReceiptEvidence: boolean;
  /** Printed under the checklist when the claim was waived instead of evidenced. */
  missingReceiptReason: string | null;
  /** Printed when policy legitimately skipped the human approval step. */
  approvalDecisionNote?: string | null;
  cancellation?: { reason: string | null };
  /** LEGACY_FOUR_SIGNERS reprints the old four blocks byte for byte; `payout`, `repayment` and `selfApproved` only print on TWO_SIGNERS. */
  layout: ReimbursementClaimFormLayout;
  /**
   * "รับเงินคืนทาง", under the requester's name. Absent for a claim sent before claims carried a
   * receiving account: that form prints as it always did.
   */
  payout?: ClaimFormPayout | null;
  /** Latest recorded payment, stated as text under the table; null prints ยังไม่จ่าย. */
  repayment: {
    paidAt: string;
    method: string;
    reference: string | null;
    recordedByName: string;
    /** The account the payer confirmed the transfer into: its last 4 digits, the same for every reader. */
    paidInto?: { kind: ReimbursementPayoutKind; accountLast4: string };
  } | null;
  /** That payment carries a slip: ticks หลักฐานการชำระเงิน on TWO_SIGNERS, so paper and screen agree. */
  hasPaymentEvidence?: boolean;
  /** The requester decided their own approval. */
  selfApproved?: boolean;
  /**
   * null = the step has not happened, so the form prints a blank ruled line for
   * wet ink instead of inventing a signer.
   */
  signers: {
    requester: ClaimFormSigner | null;
    approver: ClaimFormSigner | null;
    accounting: ClaimFormSigner | null;
    finance: ClaimFormSigner | null;
  };
};

/**
 * Spec §9: a claim already signed in the accounting or payer block keeps the four-block form it was
 * signed on; every other claim prints two. The ack hash folds only the claim's facts, never the
 * layout, so moving a claim to two blocks leaves its ผู้เบิก/ผู้อนุมัติ signatures valid.
 */
export function claimFormLayout(signatures: readonly { role: ReimbursementClaimSignatureRole }[] = []): ReimbursementClaimFormLayout {
  return signatures.some(({ role }) => role === 'FINANCE_REVIEW' || role === 'PAYER') ? 'LEGACY_FOUR_SIGNERS' : 'TWO_SIGNERS';
}

/**
 * A4, derived at read time. An acknowledged scan means signed on paper (BOTH beside any digital
 * row); otherwise DIGITAL needs every block the form expects: ผู้เบิก, ผู้อนุมัติ unless policy skipped
 * approval, and on the legacy form the payer block plus the accounting block when finance reviewed.
 */
export function documentSignedVia(
  claim: {
    claimSignatures?: readonly { role: ReimbursementClaimSignatureRole }[];
    approvalPolicySnapshotJson?: unknown;
    financeReviewStatus: string;
  },
  hasAcknowledgedPaperCopy: boolean,
): ReimbursementDocumentSignedVia {
  const signed = new Set((claim.claimSignatures ?? []).map(({ role }) => role));
  if (hasAcknowledgedPaperCopy) return signed.size ? 'BOTH' : 'PAPER';
  if (!signed.size) return null;
  const required: ReimbursementClaimSignatureRole[] = ['REQUESTER'];
  if (parseReimbursementPolicySnapshot(claim.approvalPolicySnapshotJson)?.requiresApproval !== false) required.push('APPROVER');
  if (claimFormLayout(claim.claimSignatures) === 'LEGACY_FOUR_SIGNERS') {
    required.push('PAYER');
    if (claim.financeReviewStatus !== 'NOT_REQUIRED') required.push('FINANCE_REVIEW');
  }
  return required.every((role) => signed.has(role)) ? 'DIGITAL' : null;
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

export function renderReimbursementClaimFormSvg(snapshot: ReimbursementClaimFormSnapshot): Buffer {
  const sourceLines = snapshot.lines.length
    ? [...snapshot.lines].sort((a, b) => a.lineNo - b.lineNo)
    : [{ lineNo: 1, incurredDate: '', description: '-', purpose: null, amount: '0' }];

  const header = claimFormHeader(snapshot);
  const { tableTop } = header;
  const headerHeight = 36;
  let rowY = tableTop + headerHeight;
  const rows = sourceLines.map((line) => {
    const descriptions = wrapText([line.description, line.sourceReference].filter(Boolean).join(' · '), DESCRIPTION_WIDTH);
    const purposes = wrapText(line.purpose, PURPOSE_WIDTH);
    const rowHeight = Math.max(34, descriptions.length * 20 + 12, purposes.length * 20 + 12);
    const contentY = rowY + 23;
    const markup = `<line x1="45" y1="${rowY}" x2="805" y2="${rowY}" stroke="#bbb"/>
      <text x="70" y="${contentY}" text-anchor="middle">${xml(line.lineNo)}</text>
      <text x="148" y="${contentY}" text-anchor="middle">${xml(formatDate(line.incurredDate))}</text>
      ${multilineText(208, contentY, descriptions, 20, DESCRIPTION_WIDTH)}
      ${multilineText(488, contentY, purposes, 20, PURPOSE_WIDTH)}
      <text x="795" y="${contentY}" text-anchor="end">${money(line.amount)}</text>`;
    rowY += rowHeight;
    return markup;
  }).join('');

  const totalY = rowY + 24;
  const tableBottom = rowY + 36;
  const bahtTextY = tableBottom + 30;
  const repaymentLines = snapshot.layout === 'TWO_SIGNERS' ? wrapText(repaymentText(snapshot.repayment), SHEET_WIDTH) : [];
  const checklistTitleY = tableBottom + 76 + (repaymentLines.length ? repaymentLines.length * 22 + 8 : 0);
  const checklistY = checklistTitleY + 28;
  // An unevidenced claim must say WHY on paper, or the empty checklist reads as an omission.
  const waiverLines = !snapshot.hasReceiptEvidence && snapshot.missingReceiptReason?.trim()
    ? wrapText(`เหตุผลที่ไม่มีใบเสร็จ: ${snapshot.missingReceiptReason}`, 720)
    : [];
  const waiverY = checklistY + 30;
  const reasonTitleY = checklistY + 44 + (waiverLines.length ? waiverLines.length * 20 + 8 : 0);
  const reasonLines = wrapText(snapshot.reason, 720);
  const reasonY = reasonTitleY + 26;

  const contentEnd = reasonY + reasonLines.length * 22 + 40;
  const cancellationBox = snapshot.cancellation ? cancelledDocumentReasonBox(snapshot.cancellation.reason) : null;
  const cancellationHeight = cancellationBox ? cancellationBox.height + 24 : 0;
  const height = Math.max(MIN_PAGE_HEIGHT, contentEnd + SIGNATURE_BLOCK_HEIGHT + cancellationHeight);
  // Signature row sits at the foot of the sheet like the paper form, whatever the body length.
  const signaturesTop = height - SIGNATURE_BLOCK_HEIGHT - cancellationHeight;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${height}" viewBox="0 0 ${PAGE_WIDTH} ${height}" role="img" aria-label="${xml(REIMBURSEMENT_CLAIM_FORM_TITLE_TH)}">
  <rect width="${PAGE_WIDTH}" height="${height}" fill="#fff"/>
  <g font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="15" fill="#111">
    ${header.markup}
    <g fill="none" stroke="#444" stroke-width="1.2">
      <rect x="45" y="${tableTop}" width="760" height="${tableBottom - tableTop}"/>
      <line x1="45" y1="${tableTop + headerHeight}" x2="805" y2="${tableTop + headerHeight}"/>
      <line x1="95" y1="${tableTop}" x2="95" y2="${rowY}"/>
      <line x1="200" y1="${tableTop}" x2="200" y2="${rowY}"/>
      <line x1="480" y1="${tableTop}" x2="480" y2="${rowY}"/>
      <line x1="655" y1="${tableTop}" x2="655" y2="${tableBottom}"/>
      <line x1="45" y1="${rowY}" x2="805" y2="${rowY}"/>
    </g>
    <text x="70" y="${tableTop + 24}" text-anchor="middle" font-weight="600">ลำดับ</text>
    <text x="148" y="${tableTop + 24}" text-anchor="middle" font-weight="600">วันที่</text>
    <text x="340" y="${tableTop + 24}" text-anchor="middle" font-weight="600">รายการ</text>
    <text x="568" y="${tableTop + 24}" text-anchor="middle" font-weight="600">วัตถุประสงค์</text>
    <text x="730" y="${tableTop + 24}" text-anchor="middle" font-weight="600">จำนวนเงิน (฿)</text>
    ${rows}
    <text x="645" y="${totalY}" text-anchor="end" font-weight="700">รวมเป็นเงิน</text>
    <text x="795" y="${totalY}" text-anchor="end" font-weight="700">${money(snapshot.totalAmount)}</text>
    <text x="45" y="${bahtTextY}"${fitToWidth(`จำนวนเงินรวม (ตัวอักษร): ${thaiBahtText(snapshot.totalAmount)}`, SHEET_WIDTH)}>จำนวนเงินรวม (ตัวอักษร): ${xml(thaiBahtText(snapshot.totalAmount))}</text>${repaymentLines.length ? multilineText(45, bahtTextY + 30, repaymentLines, 22, SHEET_WIDTH) : ''}
    <text x="45" y="${checklistTitleY}" font-weight="700">เอกสารแนบ</text>
    ${checkbox(52, checklistY, snapshot.hasReceiptEvidence, 'ใบเสร็จรับเงิน')}
    ${checkbox(232, checklistY, false, 'ใบกำกับภาษี')}
    ${checkbox(392, checklistY, paymentEvidenceTicked(snapshot), 'หลักฐานการชำระเงิน')}
    ${checkbox(600, checklistY, false, 'อื่น ๆ ______________')}
    ${waiverLines.length ? multilineText(52, waiverY, waiverLines, 20) : ''}
    <text x="45" y="${reasonTitleY}" font-weight="700">เหตุผลในการเบิก</text>
    ${multilineText(52, reasonY, reasonLines, 22)}
    ${signatureSection(snapshot, signaturesTop)}
  </g>
  ${cancellationBox ? cancellationBox.svg.replace('<svg ', `<svg x="45" y="${height - cancellationHeight}" `) : ''}
  ${snapshot.cancellation ? cancelledDocumentWatermark(PAGE_WIDTH, height) : ''}
</svg>`;
  return Buffer.from(svg, 'utf8');
}

/** The header, and the y its table starts at: the payout lines push the table down by their own height. */
function claimFormHeader(snapshot: ReimbursementClaimFormSnapshot): { markup: string; tableTop: number } {
  const branchName = snapshot.company.branchName?.trim() || 'สำนักงานใหญ่';
  const payout = payoutLines(snapshot);
  const markup = `    <text x="425" y="48" text-anchor="middle" font-size="20" font-weight="700" letter-spacing="1">${REIMBURSEMENT_CLAIM_FORM_TITLE_EN}</text>
    <text x="425" y="80" text-anchor="middle" font-size="25" font-weight="700">${REIMBURSEMENT_CLAIM_FORM_TITLE_TH}</text>
    <text x="425" y="110" text-anchor="middle" font-size="17" font-weight="600"${fitToWidth(snapshot.company.name, SHEET_WIDTH, 17)}>${xml(snapshot.company.name)}</text>
    <text x="425" y="134" text-anchor="middle" font-size="13" fill="#555"${fitToWidth(`สาขา: ${branchName} · เลขประจำตัวผู้เสียภาษี: ${snapshot.company.taxId ?? '-'}`, SHEET_WIDTH, 13)}>สาขา: ${xml(branchName)} · เลขประจำตัวผู้เสียภาษี: ${xml(snapshot.company.taxId ?? '-')}</text>
    <line x1="45" y1="152" x2="805" y2="152" stroke="#444" stroke-width="1.2"/>
    <text x="45" y="180">เลขที่เอกสาร: ${xml(snapshot.requestNo)}</text>
    <text x="805" y="180" text-anchor="end">วันที่: ${xml(snapshot.submittedAt ? formatDate(snapshot.submittedAt) : '-')}</text>
    <text x="45" y="202" font-size="13" fill="#555"${fitToWidth(`ผู้ขอเบิก: ${snapshot.requesterName}`, SHEET_WIDTH, 13)}>ผู้ขอเบิก: ${xml(snapshot.requesterName)}</text>
${payout.length ? `    ${multilineText(45, 202 + PAYOUT_LINE_HEIGHT, payout, PAYOUT_LINE_HEIGHT, SHEET_WIDTH)}\n` : ''}`;
  return { markup, tableTop: TABLE_TOP + payout.length * PAYOUT_LINE_HEIGHT };
}

/**
 * "รับเงินคืนทาง" and who attested the account, as wrapped lines. None on the four-block form and
 * none for a claim that carries no receiving account, so both print as they always did. The number
 * is the last 4 digits unless the snapshot was handed the full one.
 */
function payoutLines(snapshot: ReimbursementClaimFormSnapshot): string[] {
  const payout = snapshot.layout === 'TWO_SIGNERS' ? snapshot.payout : null;
  if (!payout) return [];
  if (payout.method === 'CASH') return ['รับเงินคืนทาง: รับเป็นเงินสด'];
  const number = payout.accountNumber ? ` ${payout.accountNumber}` : maskedPayoutAccountNumber(payout.accountLast4);
  const account = payout.kind === 'PROMPTPAY_PHONE'
    ? `พร้อมเพย์เบอร์${number} ชื่อบัญชี ${payout.accountName}`
    : ['โอนเข้าบัญชี', payout.bankName, 'ชื่อบัญชี', payout.accountName, `เลขบัญชี${number}`].filter(Boolean).join(' ');
  const { verifier } = payout;
  // A requester's own attestation is printed in the claim page's words, so the paper never reads as
  // if someone else had checked the account.
  const attestation = verifier
    ? wrapText(`${'byRequester' in verifier ? 'ผู้เบิกยืนยันบัญชีของตนเอง' : `ผู้ตรวจบัญชี ${verifier.name}`} วันที่ ${formatDate(verifier.at)}`, SHEET_WIDTH)
    : [];
  return [...wrapText(`รับเงินคืนทาง: ${account}`, SHEET_WIDTH), ...attestation];
}

/** Fixed A4 pages for preview, printing and PDF export. The legacy tall SVG above remains in the
 * response for older clients; monetary facts and authorization are identical in both renderings. */
export function renderReimbursementClaimFormPages(snapshot: ReimbursementClaimFormSnapshot): Buffer[] {
  const bottom = MIN_PAGE_HEIGHT - 24;
  const header = claimFormHeader(snapshot);
  const top = header.tableTop;
  const pages: string[][] = [[]];
  let page = pages[0]!;
  let y = top;
  const nextPage = () => { page = []; pages.push(page); y = top; };
  const ensure = (height: number) => { if (y + height > bottom) nextPage(); };
  const tableHeading = () => {
    page.push(`<rect x="45" y="${y}" width="760" height="36" fill="#f7f7f7" stroke="#444"/>
      ${[['70', 'ลำดับ'], ['148', 'วันที่'], ['340', 'รายการ'], ['568', 'วัตถุประสงค์'], ['730', 'จำนวนเงิน (฿)']].map(([x, label]) => `<text x="${x}" y="${y + 24}" text-anchor="middle" font-weight="600">${label}</text>`).join('')}`);
    y += 36;
  };
  tableHeading();
  for (const line of [...snapshot.lines].sort((a, b) => a.lineNo - b.lineNo)) {
    const descriptions = wrapText([line.description, line.sourceReference].filter(Boolean).join(' · '), DESCRIPTION_WIDTH);
    const purposes = wrapText(line.purpose, PURPOSE_WIDTH);
    const count = Math.max(descriptions.length, purposes.length);
    const fullHeight = Math.max(34, count * 20 + 12);
    // Move an ordinary row intact; only rows taller than a fresh page are split into continuations.
    if (y + fullHeight > bottom && y > top + 36) { nextPage(); tableHeading(); }
    for (let offset = 0; offset < count;) {
      if (bottom - y < 34) { nextPage(); tableHeading(); }
      const take = Math.min(count - offset, Math.floor((bottom - y - 12) / 20));
      const height = Math.max(34, take * 20 + 12);
      const last = offset + take === count;
      page.push(`<g data-claim-row="${line.lineNo}" data-row-continuation="${offset > 0}">
        <rect x="45" y="${y}" width="760" height="${height}" fill="none" stroke="#444"/>
        ${[95, 200, 480, 655].map((x) => `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + height}" stroke="#444"/>`).join('')}
        <text x="70" y="${y + 23}" text-anchor="middle"${fitToWidth(`${line.lineNo}${offset ? ' (ต่อ)' : ''}`, 40)}>${line.lineNo}${offset ? ' (ต่อ)' : ''}</text>
        <text x="148" y="${y + 23}" text-anchor="middle">${xml(formatDate(line.incurredDate))}</text>
        ${multilineText(208, y + 23, descriptions.slice(offset, offset + take), 20, DESCRIPTION_WIDTH)}
        ${multilineText(488, y + 23, purposes.slice(offset, offset + take), 20, PURPOSE_WIDTH)}
        ${last ? `<text data-claim-amount="${line.lineNo}" x="795" y="${y + 23}" text-anchor="end">${money(line.amount)}</text>` : ''}
      </g>`);
      y += height;
      offset += take;
      if (!last) { nextPage(); tableHeading(); }
    }
  }
  ensure(80);
  page.push(`<g data-claim-total="true"><rect x="45" y="${y}" width="760" height="36" fill="none" stroke="#444"/>
    <text x="645" y="${y + 24}" text-anchor="end" font-weight="700">รวมเป็นเงิน</text>
    <text x="795" y="${y + 24}" text-anchor="end" font-weight="700">${money(snapshot.totalAmount)}</text>
    <text x="45" y="${y + 66}"${fitToWidth(`จำนวนเงินรวม (ตัวอักษร): ${thaiBahtText(snapshot.totalAmount)}`, SHEET_WIDTH)}>จำนวนเงินรวม (ตัวอักษร): ${xml(thaiBahtText(snapshot.totalAmount))}</text></g>`);
  y += 100;
  if (snapshot.layout === 'TWO_SIGNERS') {
    const lines = wrapText(repaymentText(snapshot.repayment), SHEET_WIDTH);
    ensure(lines.length * 22 + 12);
    page.push(multilineText(45, y, lines, 22, SHEET_WIDTH));
    y += lines.length * 22 + 12;
  }
  ensure(64);
  page.push(`<text x="45" y="${y}" font-weight="700">เอกสารแนบ</text>
    ${checkbox(52, y + 28, snapshot.hasReceiptEvidence, 'ใบเสร็จรับเงิน')}
    ${checkbox(232, y + 28, false, 'ใบกำกับภาษี')}
    ${checkbox(392, y + 28, paymentEvidenceTicked(snapshot), 'หลักฐานการชำระเงิน')}
    ${checkbox(600, y + 28, false, 'อื่น ๆ ______________')}`);
  y += 64;
  const paragraph = (title: string, text: string) => {
    const lines = wrapText(text, 720);
    for (let offset = 0; offset < lines.length;) {
      ensure(60);
      if (y === top) y += 20;
      const take = Math.min(lines.length - offset, Math.floor((bottom - y - 34) / 22));
      page.push(`<text x="45" y="${y}" font-weight="700">${xml(title)}${offset ? ' (ต่อ)' : ''}</text>${multilineText(52, y + 26, lines.slice(offset, offset + take), 22, 720)}`);
      y += 34 + take * 22;
      offset += take;
      if (offset < lines.length) nextPage();
    }
  };
  if (!snapshot.hasReceiptEvidence && snapshot.missingReceiptReason?.trim()) paragraph('เหตุผลที่ไม่มีใบเสร็จ', snapshot.missingReceiptReason);
  paragraph('เหตุผลในการเบิก', snapshot.reason);

  const boxes = snapshot.cancellation ? cancelledDocumentReasonBoxes(snapshot.cancellation.reason, bottom - top) : [];
  const boxSpace = boxes.length === 1 ? boxes[0]!.height + 24 : 0;
  ensure(200);
  const signaturesTop = y + 200 + boxSpace <= bottom ? bottom - 150 - boxSpace : bottom - 150;
  page.push(`<g data-claim-signatures="true">${signatureSection(snapshot, signaturesTop)}</g>`);
  y = signaturesTop + 150;
  for (const box of boxes) {
    ensure(box.height);
    page.push(box.svg.replace('<svg ', `<svg data-cancellation-reason="true" x="45" y="${bottom - box.height}" `));
    y = bottom;
  }

  return pages.map((content, index) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1202" viewBox="0 0 850 1202" role="img" aria-label="${REIMBURSEMENT_CLAIM_FORM_TITLE_TH} หน้า ${index + 1}">
    <rect width="850" height="1202" fill="#fff"/>
    <g font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="15" fill="#111">
      ${header.markup}<text x="805" y="24" text-anchor="end" font-size="12" fill="#555">หน้า ${index + 1} / ${pages.length}</text>${content.join('')}
    </g>${snapshot.cancellation ? cancelledDocumentWatermark(PAGE_WIDTH, MIN_PAGE_HEIGHT) : ''}
  </svg>`, 'utf8'));
}

/** Heading and signature row, shared by both renderings. The legacy branch is the old markup verbatim. */
function signatureSection(snapshot: ReimbursementClaimFormSnapshot, top: number): string {
  const { signers, approvalDecisionNote: note } = snapshot;
  if (snapshot.layout === 'LEGACY_FOUR_SIGNERS') {
    return `<text x="45" y="${top - 30}" font-weight="700">การอนุมัติ${note ? ` — ${xml(note)}` : ''}</text>
    ${[['ผู้เบิก', signers.requester], ['ผู้อนุมัติ', signers.approver], ['ฝ่ายบัญชี', signers.accounting], ['ฝ่ายการเงิน', signers.finance]].map(([label, signer], index) => signatureBlock(45 + index * 190, top, label as string, signer as ClaimFormSigner | null)).join('')}`;
  }
  // D3: two half-sheet blocks. No payer/accounting block: the repayment facts print as text instead.
  return `<text x="45" y="${top - 30}" font-weight="700">การอนุมัติ</text>
    ${signatureBlock(45, top, 'ผู้เบิก', signers.requester, 380)}${signatureBlock(425, top, 'ผู้อนุมัติ', signers.approver, 380, note)}${snapshot.selfApproved ? `
    <text x="425" y="${top + 140}" text-anchor="middle" font-size="13">${SAME_PERSON_NOTE}</text>` : ''}`;
}

/** The legacy four-block form reprints byte for byte, so only the two-signer form reports the slip. */
function paymentEvidenceTicked(snapshot: ReimbursementClaimFormSnapshot): boolean {
  return snapshot.layout === 'TWO_SIGNERS' && snapshot.hasPaymentEvidence === true;
}

function repaymentText(repayment: ReimbursementClaimFormSnapshot['repayment']): string {
  if (!repayment) return 'การจ่ายเงินคืน: ยังไม่จ่าย';
  // The last 4 digits for every reader: the full number prints on the "รับเงินคืนทาง" line alone.
  const paidInto = repayment.paidInto
    ? ` เข้า${repayment.paidInto.kind === 'PROMPTPAY_PHONE' ? 'พร้อมเพย์เบอร์' : 'บัญชี'}${maskedPayoutAccountNumber(repayment.paidInto.accountLast4)}`
    : '';
  return `การจ่ายเงินคืน: จ่ายเมื่อ ${formatDate(repayment.paidAt)} วิธี ${PAYMENT_METHOD_LABELS[repayment.method] ?? repayment.method}${paidInto} เลขอ้างอิง ${repayment.reference || '-'} บันทึกโดย ${repayment.recordedByName}`;
}

/** Role label, wet-ink space, ลงชื่อ ruled line, name line, date line — filled only when the step happened. */
function signatureBlock(x: number, top: number, label: string, signer: ClaimFormSigner | null, width = 190, note?: string | null): string {
  const center = x + width / 2;
  // Nobody signs a step policy skipped, so its note replaces the ruled lines.
  if (!signer && note) {
    return `<text x="${center}" y="${top}" text-anchor="middle" font-weight="600">${xml(label)}</text>
    <text x="${center}" y="${top + 66}" text-anchor="middle" font-size="13">${xml(note)}</text>`;
  }
  // A digitally signed role prints its image in the wet-ink space; an unsigned
  // one keeps the empty ruled line so it can still be signed on paper.
  const image = signer?.signatureDataUrl
    ? `<image href="${xml(signer.signatureDataUrl)}" x="${center - 40}" y="${top + 8}" width="130" height="54" preserveAspectRatio="xMidYMid meet"/>`
    : '';
  return `<text x="${center}" y="${top}" text-anchor="middle" font-weight="600">${xml(label)}</text>
    ${image}
    <text x="${center - 82}" y="${top + 66}" font-size="13">ลงชื่อ</text>
    <line x1="${center - 36}" y1="${top + 66}" x2="${center + 82}" y2="${top + 66}" stroke="#222"/>
    <text x="${center}" y="${top + 90}" text-anchor="middle" font-size="13"${fitToWidth(`( ${signer?.name ?? ''} )`, width - 14, 13)}>(${xml(signer ? ` ${signer.name} ` : '  ....................  ')})</text>
    <text x="${center}" y="${top + 114}" text-anchor="middle" font-size="13">วันที่ ${xml(signer ? formatDate(signer.at) : '..................')}</text>`;
}

/** Text too wide for its column condenses into it instead of running into the next one. */
function fitToWidth(value: string, maxWidth: number, fontSize?: number): string {
  return estimatedWidth(value, fontSize) > maxWidth ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : '';
}

/** Drawn box, not ☐/☑: glyph coverage in the print font stack is not guaranteed. */
function checkbox(x: number, y: number, checked: boolean, label: string): string {
  const box = `<rect x="${x}" y="${y - 13}" width="14" height="14" fill="none" stroke="#222" stroke-width="1.2"/>`;
  const tick = checked
    ? `<path d="M${x + 3} ${y - 6} l3 4 l6 -8" fill="none" stroke="#222" stroke-width="2"/>`
    : '';
  return `${box}${tick}<text x="${x + 22}" y="${y}">${xml(label)}</text>`;
}

function wrapText(value: unknown, maxWidth: number): string[] {
  const text = String(value ?? '').trim();
  if (!text) return ['-'];
  const lines: string[] = [];
  let line = '';
  for (const { segment } of WORD_SEGMENTER.segment(text)) {
    const candidate = `${line}${segment}`;
    if (estimatedWidth(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    // `!line` used to short-circuit here, which accepted a single word wider than the
    // column verbatim and never reached the grapheme split below.
    if (line) lines.push(line.trim());
    line = '';
    for (const { segment: grapheme } of GRAPHEME_SEGMENTER.segment(segment.trimStart())) {
      if (line && estimatedWidth(`${line}${grapheme}`) > maxWidth) {
        lines.push(line.trim());
        line = '';
      }
      line += grapheme;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/**
 * Advance width of one line at the body font-size, measured from the print font
 * stack instead of guessed: a Thai grapheme cluster (base consonant plus its
 * zero-width marks) runs ~9.6px and capitals/digits ~9.1px, so the previous flat
 * 8px/7.5px estimate under-measured Thai lines by 5-18% — enough for a wrapped
 * รายการ line to spill past its column rule into วัตถุประสงค์.
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

/** `maxWidth` condenses any line the estimate still puts over its column, so a font
 *  wider than the one this renderer was measured against cannot spill either. */
function multilineText(x: number, y: number, lines: string[], lineHeight: number, maxWidth?: number): string {
  return `<text x="${x}" y="${y}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}"${maxWidth ? fitToWidth(line, maxWidth) : ''}>${xml(line)}</tspan>`).join('')}</text>`;
}

function xml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function money(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : xml(value);
}

/**
 * The day a date falls on in Thailand, as every screen shows it. The submit date and each signer's
 * date are instants, and the UTC calendar day is the day before for anything done between midnight
 * and 07:00 Thai time. A date-only value is stored at UTC midnight, 07:00 of the same Thai day, so
 * it prints unchanged.
 */
function formatDate(value: string): string {
  const instant = new Date(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(Number.isNaN(instant.getTime()) ? value : civilDate(instant));
  if (!match) return value || '-';
  const [, year, month, day] = match;
  const monthLabel = THAI_MONTHS[Number(month) - 1];
  return monthLabel ? `${Number(day)} ${monthLabel} ${Number(year) + 543}` : value;
}
