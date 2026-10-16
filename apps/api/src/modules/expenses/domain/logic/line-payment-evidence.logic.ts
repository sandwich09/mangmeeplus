import Decimal from 'decimal.js';

export const LINE_PAYMENT_EVIDENCE_WINDOW_MS = 2 * 60 * 60_000;
export const LINE_PAYMENT_EVIDENCE_VOID_REASON = 'LINE_PAYMENT_EVIDENCE_LINKED';
export const LINE_PAYMENT_RECEIPT_TYPES = ['RECEIPT', 'TAX_INVOICE', 'ABBREVIATED_TAX_INVOICE', 'HANDWRITTEN_CASH_BILL'];
export const LINE_PAYMENT_EDITABLE_STATUSES = ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'];

export type LinePaymentEvidenceCandidate = {
  id: string;
  companyId: string;
  chatKeyHash: string;
  createdAt: Date;
  amount: string;
  currency: string;
  documentDay: string | null;
  vendorName: string | null;
  status: string;
  hasPaymentEvidence: boolean;
};

export function equalPaymentAmount(left: string, right: string): boolean {
  try { return new Decimal(left).isPositive() && new Decimal(left).eq(right); }
  catch { return false; }
}

/** A capture timestamp is never substituted for a missing document day. */
export function decideLinePaymentEvidencePairing(slip: LinePaymentEvidenceCandidate, receipts: LinePaymentEvidenceCandidate[]) {
  const candidates = receipts.filter(receipt => receipt.id !== slip.id
    && receipt.companyId === slip.companyId && receipt.chatKeyHash === slip.chatKeyHash
    && LINE_PAYMENT_EDITABLE_STATUSES.includes(receipt.status) && !receipt.hasPaymentEvidence
    && receipt.currency === slip.currency
    && Math.abs(receipt.createdAt.getTime() - slip.createdAt.getTime()) <= LINE_PAYMENT_EVIDENCE_WINDOW_MS);
  if (!candidates.length) return { kind: 'NONE' as const, candidates };
  // Owner 2026-10-15: automatic only when exactly ONE nearby receipt matches the slip amount and day;
  // other receipts with different amounts in the same window do not make the match ambiguous.
  const matches = candidates.filter(receipt => equalPaymentAmount(slip.amount, receipt.amount)
    && (!slip.documentDay || !receipt.documentDay || slip.documentDay === receipt.documentDay));
  if (matches.length === 1) return { kind: 'AUTO' as const, candidates, receiptId: matches[0]!.id };
  return { kind: 'ASK' as const, candidates };
}

/** Only a clear association statement is intercepted before the ordinary text capture path. */
export function isRecentPaymentEvidenceLinkText(text: string): boolean {
  return !/(?:ไม่ใช่|ไม่ต้อง|อย่า|ห้าม|ใช่ไหม|หรือเปล่า|ได้ไหม)/u.test(text)
    && /(?:สลิป|ใบเสร็จ|หลักฐาน)/u.test(text)
    && /(?:เมื่อกี้|ล่าสุด|ก่อนหน้า)/u.test(text)
    && /(?:เป็นหลักฐาน(?:การจ่าย|ของ)|หลักฐานเดียวกัน|รายการเดียวกัน|แนบ.*(?:รายการ|ค่าใช้จ่าย)|ผูก.*(?:รายการ|ค่าใช้จ่าย)|ข้อมูลและหลักฐานเดียวกัน)/u.test(text);
}
