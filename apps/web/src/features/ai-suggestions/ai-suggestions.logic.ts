// Pure helpers for the AI Suggestions review UI (item 17).

import type {
  AiCandidateActionStatus,
  AiCandidateActionType,
  AiReviewDecision,
  AiRiskLevel,
  AiSuggestionStatus,
} from '@watchdog-bms/contracts';

export type SuggestionTab = { key: string; label: string; status?: string; needsData?: boolean };

export const SUGGESTION_TABS: SuggestionTab[] = [
  { key: 'new', label: 'ใหม่', status: 'NEW' },
  { key: 'needs_data', label: 'ต้องการข้อมูล', status: 'NEW', needsData: true },
  { key: 'in_review', label: 'กำลังรีวิว', status: 'IN_REVIEW' },
  { key: 'accepted', label: 'สร้างร่างแล้ว', status: 'SOURCE_DRAFT_CREATED' },
  { key: 'blocked', label: 'ถูกบล็อก', status: 'BLOCKED_BY_SOURCE_STATE' },
  { key: 'dismissed', label: 'ปิดแล้ว', status: 'DISMISSED' },
  { key: 'expired', label: 'หมดอายุ', status: 'EXPIRED' },
];

// The "New" tab excludes needs-data items; the "Needs data" tab keeps only them.
// Both query the same NEW status server-side, so the split is done client-side.
export function filterSuggestionsForTab<T extends { needsData?: boolean }>(items: T[], tab: SuggestionTab): T[] {
  if (tab.needsData) return items.filter((s) => s.needsData);
  if (tab.key === 'new') return items.filter((s) => !s.needsData);
  return items;
}

export function formatConfidencePct(confidence: number | undefined): string {
  return `${Math.round((confidence ?? 0) * 100)}%`;
}

const RISK_LABELS: Record<AiRiskLevel, string> = {
  LOW: 'ปกติ',
  MEDIUM: 'ควรตรวจสอบ',
  HIGH: 'ต้องระวัง',
};

const SUGGESTION_STATUS_LABELS: Record<AiSuggestionStatus, string> = {
  NEW: 'ใหม่',
  IN_REVIEW: 'กำลังตรวจสอบ',
  ACCEPTED_FOR_SOURCE_DRAFT: 'อนุมัติให้สร้างร่าง',
  SOURCE_DRAFT_CREATED: 'สร้างร่างแล้ว',
  DISMISSED: 'ปิดแล้ว',
  SUPERSEDED: 'มีคำแนะนำใหม่กว่า',
  EXPIRED: 'หมดอายุ',
  BLOCKED_BY_SOURCE_STATE: 'ข้อมูลต้นทางเปลี่ยน',
  BLOCKED_BY_PERMISSION: 'สิทธิ์ไม่เพียงพอ',
  FAILED: 'สร้างไม่สำเร็จ',
};

const ACTION_LABELS: Record<AiCandidateActionType, string> = {
  CREATE_CRM_FOLLOW_UP_DRAFT: 'สร้างร่างติดตามลูกค้า',
  CREATE_ACCOUNTING_QUOTATION_DRAFT: 'สร้างร่างใบเสนอราคา',
  CREATE_INVENTORY_REORDER_REVIEW: 'สร้างรายการตรวจสอบการสั่งซื้อสินค้า',
  CREATE_INVENTORY_TRANSFER_OR_COUNT_REQUEST: 'สร้างคำขอโอนหรือนับสินค้า',
  CREATE_TAX_EVIDENCE_CHECKLIST: 'สร้างเช็กลิสต์หลักฐานภาษี',
  CREATE_TAX_CERTIFICATE_DRAFT: 'สร้างร่างหนังสือรับรองภาษี',
  CREATE_WORKFLOW_TASK: 'สร้างงานติดตาม',
  CREATE_REVIEW_CHECKLIST: 'สร้างเช็กลิสต์สำหรับตรวจสอบ',
  NO_SOURCE_DRAFT_AVAILABLE: 'ยังไม่มีร่างที่สร้างได้',
};

const ACTION_STATUS_LABELS: Record<AiCandidateActionStatus, string> = {
  PROPOSED: 'รอตรวจสอบ',
  VALIDATED: 'ตรวจสอบแล้ว',
  VALIDATION_FAILED: 'ข้อมูลยังไม่ครบ',
  SOURCE_DRAFT_CREATED: 'สร้างร่างแล้ว',
  REJECTED: 'ไม่รับข้อเสนอ',
  BLOCKED: 'ยังดำเนินการไม่ได้',
};

const REVIEW_DECISION_LABELS: Record<AiReviewDecision, string> = {
  ACCEPT_AS_SOURCE_DRAFT: 'ยอมรับและสร้างร่าง',
  REQUEST_REGENERATION: 'ขอให้สร้างใหม่',
  EDIT_AND_ACCEPT: 'แก้ไขและยอมรับ',
  DISMISS: 'ปิดคำแนะนำ',
  MARK_NEEDS_DATA: 'ต้องการข้อมูลเพิ่ม',
  MARK_NOT_USEFUL: 'ไม่เป็นประโยชน์',
  ESCALATE_TO_OWNER: 'ส่งต่อให้เจ้าของตรวจสอบ',
};

const GENERIC_NEEDS_DATA_REASON = 'ระบบยังมีข้อมูลไม่พอ กรุณาตรวจสอบข้อมูลต้นทางก่อนดำเนินการต่อ';

export function aiRiskLabel(value: string): string {
  return (RISK_LABELS as Partial<Record<string, string>>)[value] ?? 'ควรตรวจสอบ';
}

export function aiSuggestionStatusLabel(value: string): string {
  return (SUGGESTION_STATUS_LABELS as Partial<Record<string, string>>)[value] ?? 'รอตรวจสอบ';
}

export function aiActionLabel(value: string): string {
  return (ACTION_LABELS as Partial<Record<string, string>>)[value] ?? 'ร่างสำหรับตรวจสอบ';
}

export function aiActionStatusLabel(value: string): string {
  return (ACTION_STATUS_LABELS as Partial<Record<string, string>>)[value] ?? 'รอตรวจสอบ';
}

export function aiReviewDecisionLabel(value: string): string {
  return (REVIEW_DECISION_LABELS as Partial<Record<string, string>>)[value] ?? 'มีการตรวจสอบ';
}

function knownNeedsDataReason(reason: string): string | undefined {
  if (reason === 'Recommendation has no source citations; downgraded to needs-data') {
    return 'ยังไม่มีข้อมูลอ้างอิงเพียงพอ ระบบจึงเก็บไว้ให้ตรวจสอบโดยไม่สร้างร่างอัตโนมัติ';
  }
  if (reason.startsWith('Missing source permission:')) return 'บัญชีนี้ยังไม่มีสิทธิ์ดูข้อมูลต้นทางที่จำเป็น';
  if (reason === 'No bank accounts found for cash-risk analysis') return 'ยังไม่มีบัญชีธนาคารสำหรับวิเคราะห์กระแสเงินสด';
  if (reason.startsWith('A CRM customer reference')) return 'กรุณาเลือกลูกค้าที่ต้องการให้ AI ช่วยวิเคราะห์';
  if (reason === 'Operational CRM customer fields are not permitted for this role') return 'บัญชีนี้ยังไม่มีสิทธิ์ดูข้อมูลลูกค้าที่จำเป็น';
  if (reason === 'Unknown or unavailable template') return 'รูปแบบคำแนะนำนี้ยังไม่พร้อมใช้งาน';
  return undefined;
}

export function aiNeedsDataReason(reason: string): string {
  return knownNeedsDataReason(reason) ?? GENERIC_NEEDS_DATA_REASON;
}

export function aiSuggestionSummaryText(summary: string, needsData: boolean): string {
  if (!needsData) return summary;
  return knownNeedsDataReason(summary) ?? (/[ก-๙]/u.test(summary) ? summary : GENERIC_NEEDS_DATA_REASON);
}

export function aiVisibleDetailSummary(summary: string | undefined, needsDataReasons: string[]): string | undefined {
  const trimmed = summary?.trim();
  if (!trimmed) return undefined;
  if (needsDataReasons.includes(trimmed) || needsDataReasons.join('; ') === trimmed) return undefined;
  return trimmed;
}

export function aiDraftPayloadSummary(payload: unknown): { title?: string; items: string[] } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { items: [] };
  const record = payload as Record<string, unknown>;
  return {
    title: typeof record.title === 'string' ? record.title : undefined,
    items: Array.isArray(record.items) ? record.items.filter((item): item is string => typeof item === 'string') : [],
  };
}

export function aiValidationResultLabel(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  return (result as Record<string, unknown>).ok === true
    ? 'ข้อมูลพร้อมสำหรับสร้างร่าง'
    : 'ยังมีข้อมูลที่ต้องแก้ไขก่อนสร้างร่าง';
}

// A candidate action can create a source draft only when the suggestion is still
// actionable, the action is not self-referential, and it has not already been created.
export function canCreateSourceDraft(
  suggestionStatus: string,
  actionType: string,
  actionStatus: string,
  needsData = false,
): boolean {
  const actionable = ['NEW', 'IN_REVIEW', 'ACCEPTED_FOR_SOURCE_DRAFT'].includes(suggestionStatus);
  return !needsData && actionable && actionType !== 'NO_SOURCE_DRAFT_AVAILABLE' && actionStatus !== 'SOURCE_DRAFT_CREATED';
}
