import type { MangmeeTone } from '@/common/components/mangmee';
import type { SharedEvidenceRow, TaxEvidenceStatus } from './expenses.model';

export type EvidenceFlagKey =
  | 'SOURCE_UNAVAILABLE'
  | 'NO_FILE'
  | 'CLAIM_FORM_EVIDENCE'
  | 'TAX_NEEDS_REVIEW'
  | 'NOT_TAX_EVIDENCE'
  | 'SUPPORTING_ONLY'
  | 'NO_VENDOR'
  | 'NO_CATEGORY'
  | 'LEGACY_NO_NUMBER';

export type EvidenceFlag = { key: EvidenceFlagKey; severity: 'warn' | 'info'; label: string };

const EVIDENCE_FILTER_KEYS: readonly EvidenceFlagKey[] = [
  'SOURCE_UNAVAILABLE',
  'NO_FILE',
  'TAX_NEEDS_REVIEW',
  'NO_VENDOR',
  'NO_CATEGORY',
];

export const TAX_EVIDENCE_TONE: Record<TaxEvidenceStatus, MangmeeTone> = {
  USABLE_FOR_TAX: 'brand',
  SUPPORTING_ONLY: 'slate',
  NOT_TAX_EVIDENCE: 'danger',
  NEEDS_REVIEW: 'amber',
};

export type EvidenceAuditFacts = Pick<SharedEvidenceRow, 'sourceEvidenceUnavailable' | 'sourceReimbursementRequestId' | 'missingReceiptReason' | 'taxEvidenceStatus' | 'vendorNameSnapshot' | 'categoryName' | 'expenseNumber'> & { attachments: Array<{ isHistorical?: boolean }> };

export function deriveEvidenceRowFlags(row: EvidenceAuditFacts): EvidenceFlag[] {
  const flags: EvidenceFlag[] = [];
  if (row.sourceEvidenceUnavailable) flags.push({ key: 'SOURCE_UNAVAILABLE', severity: 'warn', label: 'ตรวจหลักฐานต้นทางที่ไม่พร้อมใช้งาน' });
  if (!row.attachments.some(file => !file.isHistorical)) {
    // A receipt-less claim line is evidenced by its signed ใบเบิก — nothing on the (immutable,
    // confirmed) projection can or should be attached, so a red flag here would be a dead end.
    if (row.sourceReimbursementRequestId && row.missingReceiptReason) {
      flags.push({ key: 'CLAIM_FORM_EVIDENCE', severity: 'info', label: 'ใช้ใบเบิกที่เซ็นเป็นหลักฐาน (บรรทัดเบิกไม่มีใบเสร็จ)' });
    } else {
      flags.push({ key: 'NO_FILE', severity: 'warn', label: row.attachments.length ? 'ไม่มีไฟล์ปัจจุบัน (มีประวัติเอกสาร)' : 'ไม่มีไฟล์' });
    }
  }
  if (row.taxEvidenceStatus === 'NEEDS_REVIEW') flags.push({ key: 'TAX_NEEDS_REVIEW', severity: 'warn', label: 'หลักฐานรายจ่ายรอตรวจ' });
  if (row.taxEvidenceStatus === 'NOT_TAX_EVIDENCE') flags.push({ key: 'NOT_TAX_EVIDENCE', severity: 'warn', label: 'หลักฐานรายจ่ายใช้ไม่ได้' });
  if (!row.vendorNameSnapshot?.trim()) flags.push({ key: 'NO_VENDOR', severity: 'warn', label: 'ไม่มีผู้ขาย' });
  if (row.taxEvidenceStatus === 'SUPPORTING_ONLY') flags.push({ key: 'SUPPORTING_ONLY', severity: 'info', label: 'เป็นหลักฐานประกอบ (ขอคืน VAT ไม่ได้)' });
  if (!row.categoryName) flags.push({ key: 'NO_CATEGORY', severity: 'warn', label: 'ยังไม่จัดหมวด' });
  if (!row.expenseNumber) flags.push({ key: 'LEGACY_NO_NUMBER', severity: 'info', label: 'รายการเดิมไม่มีเลขที่เอกสาร' });
  return flags;
}

export function evidenceRowState(flags: EvidenceFlag[]): 'attention' | 'ok' {
  return flags.some((flag) => flag.severity === 'warn') ? 'attention' : 'ok';
}

export function summarizeEvidenceRows(rows: SharedEvidenceRow[]): { attention: number; ok: number } {
  return rows.reduce((summary, row) => {
    summary[evidenceRowState(deriveEvidenceRowFlags(row))]++;
    return summary;
  }, { attention: 0, ok: 0 });
}

export function summarizeEvidenceFlags(rows: SharedEvidenceRow[]): Array<{ key: EvidenceFlagKey; label: string; count: number }> {
  const summaries = new Map<EvidenceFlagKey, { label: string; count: number }>();
  for (const row of rows) {
    for (const flag of deriveEvidenceRowFlags(row)) {
      if (!EVIDENCE_FILTER_KEYS.includes(flag.key)) continue;
      const summary = summaries.get(flag.key);
      summaries.set(flag.key, { label: flag.label, count: (summary?.count ?? 0) + 1 });
    }
  }
  return EVIDENCE_FILTER_KEYS.flatMap((key) => {
    const summary = summaries.get(key);
    return summary ? [{ key, ...summary }] : [];
  });
}

export function filterRowsByFlag(
  rows: SharedEvidenceRow[],
  key: EvidenceFlagKey | 'all' | 'attention' | 'ok',
): SharedEvidenceRow[] {
  if (key === 'all') return rows;
  return rows.filter((row) => {
    const flags = deriveEvidenceRowFlags(row);
    return key === 'attention' || key === 'ok'
      ? evidenceRowState(flags) === key
      : flags.some((flag) => flag.key === key);
  });
}


export function evidenceRowBadge(row: EvidenceAuditFacts): string {
  const failures = deriveEvidenceRowFlags(row).filter(flag => flag.severity === 'warn');
  return failures.length === 0 ? 'ครบแล้ว' : failures.length === 1 ? failures[0]!.label : `ต้องแก้ ${failures.length} ข้อ`;
}

/** The existing read loads every matching page; sort that complete set before the UI's ten-row slice. */
export function evidenceRowsInDateOrder(rows: SharedEvidenceRow[], order: 'newest' | 'oldest') {
  return [...rows].sort((a, b) => (a.expenseDate.localeCompare(b.expenseDate) || a.expenseId.localeCompare(b.expenseId)) * (order === 'oldest' ? 1 : -1));
}

export function readEvidenceListState(params: Pick<URLSearchParams, 'get'>, currentMonth: string) {
  const month = params.get('yearMonth');
  const page = Number(params.get('page'));
  const flag = params.get('flagFilter');
  return {
    yearMonth: month === '' || month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : currentMonth,
    dateField: params.get('dateField') === 'uploadedAt' ? 'uploadedAt' as const : 'expenseDate' as const,
    documentStatus: params.get('documentStatus') === 'VOIDED' ? 'VOIDED' : 'CONFIRMED',
    sourceDocumentType: params.get('sourceDocumentType') ?? '', taxEvidenceStatus: params.get('taxEvidenceStatus') ?? '',
    postingStatus: params.get('postingStatus') ?? '',
    flagFilter: flag === 'attention' ? 'attention' as const : flag === 'ok' ? 'ok' as const : 'all' as const,
    order: params.get('order') === 'oldest' ? 'oldest' as const : 'newest' as const,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}
