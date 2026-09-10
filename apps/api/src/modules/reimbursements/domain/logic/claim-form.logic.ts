/**
 * Printable ใบเบิกค่าใช้จ่าย (reimbursement claim form), lane D.
 *
 * Pure renderer: snapshot in, SVG bytes out. No Nest / Prisma / storage.
 * Thai wrap/escape/baht-text helpers are replicated from the expense
 * substitute-receipt renderer on purpose — the two documents live in different
 * modules and must not import each other's domain logic.
 */

export const REIMBURSEMENT_CLAIM_FORM_TITLE_EN = 'REIMBURSEMENT CLAIM FORM';
export const REIMBURSEMENT_CLAIM_FORM_TITLE_TH = 'ใบเบิกค่าใช้จ่าย';

const THAI_DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
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

export type ClaimFormSigner = {
  name: string;
  /** ISO date of the step that happened. */
  at: string;
  /** Stored signature image (data URL), embedded above the name line when present. */
  signatureDataUrl?: string;
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

  const tableTop = 218;
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
  const checklistTitleY = tableBottom + 76;
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
  const height = Math.max(MIN_PAGE_HEIGHT, contentEnd + SIGNATURE_BLOCK_HEIGHT);
  // Signature row sits at the foot of the sheet like the paper form, whatever the body length.
  const signaturesTop = height - SIGNATURE_BLOCK_HEIGHT;
  const signatures = [
    ['ผู้เบิก', snapshot.signers.requester],
    ['ผู้อนุมัติ', snapshot.signers.approver],
    ['ฝ่ายบัญชี', snapshot.signers.accounting],
    ['ฝ่ายการเงิน', snapshot.signers.finance],
  ].map(([label, signer], index) => signatureBlock(45 + index * 190, signaturesTop, label as string, signer as ClaimFormSigner | null)).join('');

  const branchName = snapshot.company.branchName?.trim() || 'สำนักงานใหญ่';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${height}" viewBox="0 0 ${PAGE_WIDTH} ${height}" role="img" aria-label="${xml(REIMBURSEMENT_CLAIM_FORM_TITLE_TH)}">
  <rect width="${PAGE_WIDTH}" height="${height}" fill="#fff"/>
  <g font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="15" fill="#111">
    <text x="425" y="48" text-anchor="middle" font-size="20" font-weight="700" letter-spacing="1">${REIMBURSEMENT_CLAIM_FORM_TITLE_EN}</text>
    <text x="425" y="80" text-anchor="middle" font-size="25" font-weight="700">${REIMBURSEMENT_CLAIM_FORM_TITLE_TH}</text>
    <text x="425" y="110" text-anchor="middle" font-size="17" font-weight="600"${fitToWidth(snapshot.company.name, SHEET_WIDTH, 17)}>${xml(snapshot.company.name)}</text>
    <text x="425" y="134" text-anchor="middle" font-size="13" fill="#555"${fitToWidth(`สาขา: ${branchName} · เลขประจำตัวผู้เสียภาษี: ${snapshot.company.taxId ?? '-'}`, SHEET_WIDTH, 13)}>สาขา: ${xml(branchName)} · เลขประจำตัวผู้เสียภาษี: ${xml(snapshot.company.taxId ?? '-')}</text>
    <line x1="45" y1="152" x2="805" y2="152" stroke="#444" stroke-width="1.2"/>
    <text x="45" y="180">เลขที่เอกสาร: ${xml(snapshot.requestNo)}</text>
    <text x="805" y="180" text-anchor="end">วันที่: ${xml(snapshot.submittedAt ? formatDate(snapshot.submittedAt) : '-')}</text>
    <text x="45" y="202" font-size="13" fill="#555"${fitToWidth(`ผู้ขอเบิก: ${snapshot.requesterName}`, SHEET_WIDTH, 13)}>ผู้ขอเบิก: ${xml(snapshot.requesterName)}</text>
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
    <text x="45" y="${bahtTextY}"${fitToWidth(`จำนวนเงินรวม (ตัวอักษร): ${thaiBahtText(snapshot.totalAmount)}`, SHEET_WIDTH)}>จำนวนเงินรวม (ตัวอักษร): ${xml(thaiBahtText(snapshot.totalAmount))}</text>
    <text x="45" y="${checklistTitleY}" font-weight="700">เอกสารแนบ</text>
    ${checkbox(52, checklistY, snapshot.hasReceiptEvidence, 'ใบเสร็จรับเงิน')}
    ${checkbox(232, checklistY, false, 'ใบกำกับภาษี')}
    ${checkbox(392, checklistY, false, 'หลักฐานการชำระเงิน')}
    ${checkbox(600, checklistY, false, 'อื่น ๆ ______________')}
    ${waiverLines.length ? multilineText(52, waiverY, waiverLines, 20) : ''}
    <text x="45" y="${reasonTitleY}" font-weight="700">เหตุผลในการเบิก</text>
    ${multilineText(52, reasonY, reasonLines, 22)}
    <text x="45" y="${signaturesTop - 30}" font-weight="700">การอนุมัติ${snapshot.approvalDecisionNote ? ` — ${xml(snapshot.approvalDecisionNote)}` : ''}</text>
    ${signatures}
  </g>
</svg>`;
  return Buffer.from(svg, 'utf8');
}

/** Role label, wet-ink space, ลงชื่อ ruled line, name line, date line — filled only when the step happened. */
function signatureBlock(x: number, top: number, label: string, signer: ClaimFormSigner | null): string {
  const center = x + 95;
  // A digitally signed role prints its image in the wet-ink space; an unsigned
  // one keeps the empty ruled line so it can still be signed on paper.
  const image = signer?.signatureDataUrl
    ? `<image href="${xml(signer.signatureDataUrl)}" x="${center - 40}" y="${top + 8}" width="130" height="54" preserveAspectRatio="xMidYMid meet"/>`
    : '';
  return `<text x="${center}" y="${top}" text-anchor="middle" font-weight="600">${xml(label)}</text>
    ${image}
    <text x="${center - 82}" y="${top + 66}" font-size="13">ลงชื่อ</text>
    <line x1="${center - 36}" y1="${top + 66}" x2="${center + 82}" y2="${top + 66}" stroke="#222"/>
    <text x="${center}" y="${top + 90}" text-anchor="middle" font-size="13"${fitToWidth(`( ${signer?.name ?? ''} )`, 176, 13)}>(${xml(signer ? ` ${signer.name} ` : '  ....................  ')})</text>
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

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value || '-';
  const [, year, month, day] = match;
  const monthLabel = THAI_MONTHS[Number(month) - 1];
  return monthLabel ? `${Number(day)} ${monthLabel} ${Number(year) + 543}` : value;
}
