// Pure MVP1-0 pilot-tenant setup evaluation (Dev A A2). No I/O, no Nest imports —
// the runnable prisma/crm-mvp1-0-setup.ts loads the tenant snapshot and calls this
// to decide PASS/WARN/FAIL. Kept pure so the setup rules are unit-tested without a DB.

import { CRM_INBOX_ENTITLEMENT_KEY, PDPA_CONSENT_NOTICE_TEXT } from '../crm-inbox.constants';

export type SetupCheckStatus = 'PASS' | 'WARN' | 'FAIL';

export interface SetupCheck {
  key: string;
  status: SetupCheckStatus;
  message: string;
}

/** Minimal messaging-channel shape the evaluation needs. */
export interface SetupChannelState {
  status: string;
}

/** Tenant snapshot the runnable script assembles from Prisma. */
export interface Mvp10SetupState {
  companyId: string;
  /** null when the company row is missing. */
  company: { name: string; status: string } | null;
  /**
   * Distinct enabled feature keys, or null when the company has NO entitlement
   * rows at all (legacy fail-open — matches loadEntitledFeatureKeys()).
   */
  entitledFeatureKeys: Set<string> | null;
  /** Whether a `crm` entitlement row exists but is explicitly disabled. */
  crmEntitlementDisabled: boolean;
  channels: SetupChannelState[];
  pdpaNoticeText: string;
}

export interface Mvp10SetupReport {
  companyId: string;
  checks: SetupCheck[];
  /** No FAIL checks — the tenant is ready (WARNs are advisories). */
  ready: boolean;
}

/** The five PDPA-required disclosure elements the pilot notice must carry. */
const PDPA_REQUIRED_ELEMENTS: ReadonlyArray<{ key: string; keywords: readonly string[] }> = [
  { key: 'data_controller', keywords: ['ผู้ควบคุมข้อมูล'] },
  { key: 'purpose', keywords: ['วัตถุประสงค์'] },
  { key: 'retention', keywords: ['ระยะเวลาเก็บ'] },
  { key: 'rights', keywords: ['สิทธิ'] },
  { key: 'contact', keywords: ['ติดต่อ'] },
];

/** Which required PDPA elements are missing from a notice (empty = complete). */
export function missingPdpaElements(noticeText: string): string[] {
  const text = noticeText ?? '';
  return PDPA_REQUIRED_ELEMENTS.filter((el) => !el.keywords.some((kw) => text.includes(kw))).map((el) => el.key);
}

export function isPdpaNoticeComplete(noticeText: string): boolean {
  return missingPdpaElements(noticeText).length === 0;
}

function activeChannelCount(channels: SetupChannelState[]): number {
  return channels.filter((c) => c.status !== 'DISABLED').length;
}

/**
 * Evaluate whether a company is configured for the CRM LINE inbox pilot.
 * Entitlement semantics mirror loadEntitledFeatureKeys()/feature-gate.logic.ts:
 * no rows = fail-open (inbox works, but WARN to make it explicit); rows present
 * without `crm` enabled = the crm.* permission prefix is stripped = FAIL.
 */
export function evaluateMvp10Setup(state: Mvp10SetupState): Mvp10SetupReport {
  const checks: SetupCheck[] = [];

  // 1. Company exists and is active.
  if (!state.company) {
    checks.push({ key: 'company', status: 'FAIL', message: `ไม่พบบริษัท companyId=${state.companyId}` });
  } else if (state.company.status !== 'ACTIVE') {
    checks.push({ key: 'company', status: 'FAIL', message: `บริษัท "${state.company.name}" สถานะ ${state.company.status} (ต้อง ACTIVE)` });
  } else {
    checks.push({ key: 'company', status: 'PASS', message: `บริษัท "${state.company.name}" ACTIVE` });
  }

  // 2. CRM feature entitlement — the real inbox gate.
  const entitled = state.entitledFeatureKeys;
  if (entitled === null) {
    checks.push({
      key: 'entitlement',
      status: 'WARN',
      message: `ยังไม่มีแถว entitlement — อาศัย fail-open (inbox ใช้งานได้) แนะนำรัน --apply เพื่อเปิด "${CRM_INBOX_ENTITLEMENT_KEY}" อย่างชัดเจน`,
    });
  } else if (entitled.has(CRM_INBOX_ENTITLEMENT_KEY)) {
    checks.push({ key: 'entitlement', status: 'PASS', message: `เปิด entitlement "${CRM_INBOX_ENTITLEMENT_KEY}" แล้ว` });
  } else {
    const reason = state.crmEntitlementDisabled ? 'ถูกปิดไว้' : 'ไม่มีแถว crm ทั้งที่บริษัทตั้งค่า entitlement อื่นแล้ว';
    checks.push({
      key: 'entitlement',
      status: 'FAIL',
      message: `entitlement "${CRM_INBOX_ENTITLEMENT_KEY}" ${reason} — สิทธิ์ crm.* จะถูกตัดทั้งหมด (inbox ใช้งานไม่ได้) รัน --apply เพื่อเปิด`,
    });
  }

  // 3. LINE OA channel (item 10A). Connecting the real OA is Dev B (B1); Dev A only
  //    reports it so the pilot checklist is honest about what still blocks go-live.
  const active = activeChannelCount(state.channels);
  if (active > 0) {
    checks.push({ key: 'line_channel', status: 'PASS', message: `มี LINE OA channel ที่ใช้งานได้ ${active} รายการ` });
  } else {
    checks.push({
      key: 'line_channel',
      status: 'WARN',
      message: 'ยังไม่มี LINE OA channel (ไม่นับ DISABLED) — Dev B ต้องเชื่อม OA ที่ /settings/line-oa ก่อน go-live',
    });
  }

  // 4. PDPA notice text completeness.
  const missing = missingPdpaElements(state.pdpaNoticeText);
  if (missing.length === 0) {
    checks.push({ key: 'pdpa_notice', status: 'PASS', message: 'ประกาศ PDPA ครบองค์ประกอบที่กำหนด' });
  } else {
    checks.push({ key: 'pdpa_notice', status: 'FAIL', message: `ประกาศ PDPA ขาดองค์ประกอบ: ${missing.join(', ')}` });
  }

  return { companyId: state.companyId, checks, ready: checks.every((c) => c.status !== 'FAIL') };
}

/** The canonical notice the pilot ships with — kept here so the script and tests share it. */
export const PILOT_PDPA_NOTICE_TEXT = PDPA_CONSENT_NOTICE_TEXT;
