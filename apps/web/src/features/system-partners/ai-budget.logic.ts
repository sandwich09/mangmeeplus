// Pure helpers for the partner console's "เครดิต AI และอ่านรูป" tab. The API speaks satang; the
// operator thinks in baht, so the conversion and the guardrails live here where they are testable.
import { billingPlanLabel, DEFAULT_CHAT_CREDIT_SATANG, type PartnerAiUsageDto, type PartnerReceiptImagesDto } from '@watchdog-bms/contracts';

/** Same money idiom as the expenses surface, kept local to this feature. */
export const satangToBaht = (satang: number) =>
  '฿' + (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Prefill/placeholder value for the baht input — no separators,
 *  and satang are shown, never rounded away: an override of 200050 must round-trip as 2000.50. */
export const satangToBahtInput = (satang: number) =>
  satang % 100 === 0 ? String(satang / 100) : (satang / 100).toFixed(2);

export type BudgetInputParse =
  | { ok: true; monthlyBudgetSatang: number | null }
  | { ok: false; message: string };

/** Baht with at most two decimals (spec §7.4). Parsed as integer + fraction parts rather than
 *  `Number(x) * 100`, so '2000.50' cannot drift into 200049.99999 on the way to satang. */
const BAHT_INPUT = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Empty means "clear the override and inherit the platform default" (the API's `null`).
 * Anything else must be exact, safely representable baht ≥ 1 with at most two decimals — a third decimal is rejected, never
 * silently rounded. The ceiling is enforced server-side so the operator always sees the API's
 * own 422 wording for it.
 */
export function parseBudgetBahtInput(raw: string): BudgetInputParse {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, monthlyBudgetSatang: null };
  const parts = BAHT_INPUT.exec(trimmed);
  if (!parts) {
    return {
      ok: false,
      message: 'กรอกจำนวนเงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 2000.50',
    };
  }
  const satang = Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(satang)) return { ok: false, message: 'จำนวนเงินมากเกินไป กรุณาตรวจตัวเลขแล้วกรอกใหม่' };
  if (satang < 100) {
    return { ok: false, message: 'กรอกเครดิตตั้งแต่ 1 บาท หากต้องการหยุดใช้ AI ให้ปิดสิทธิ์ผู้ช่วย AI ของบริษัท' };
  }
  return { ok: true, monthlyBudgetSatang: satang };
}

/** Month-to-date share of the effective budget. Unclamped: 140% is worth reading as 140%. */
export function budgetPercent(spendSatang: number, budgetSatang: number): number {
  if (!(budgetSatang > 0)) return 0;
  return Math.round((spendSatang / budgetSatang) * 100);
}

/** The bar can only draw 0–100. */
export const budgetBarWidth = (percent: number) => Math.min(100, Math.max(0, percent));

/** At the cap it is a refusal (red); the meter emits its alert at 80% (amber). */
export function budgetBarClass(percent: number): string {
  if (percent >= 100) return 'bg-red-500';
  if (percent > 80) return 'bg-yellow-500';
  return 'bg-brand-600';
}

export function budgetTextClass(percent: number): string {
  if (percent >= 100) return 'text-red-600';
  if (percent > 80) return 'text-yellow-600';
  return 'text-gray-500';
}

export type OcrLimitInputParse =
  | { ok: true; monthlyLimit: number | null }
  | { ok: false; message: string };

/** Empty is intentionally unlimited; otherwise a plain whole-document count only. */
export function parseOcrMonthlyLimitInput(raw: string): OcrLimitInputParse {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, monthlyLimit: null };
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: 'กรุณาใส่จำนวนเอกสารเป็นเลขจำนวนเต็ม เช่น 100 หรือเว้นว่างหากไม่จำกัด' };
  }
  const monthlyLimit = Number(trimmed);
  if (!Number.isSafeInteger(monthlyLimit) || monthlyLimit < 1 || monthlyLimit > 1_000_000) {
    return { ok: false, message: 'จำนวน OCR ต่อเดือนต้องอยู่ระหว่าง 1 ถึง 1,000,000 ครั้ง' };
  }
  return { ok: true, monthlyLimit };
}

export function ocrRemaining(usedCount: number, monthlyLimit: number | null): number | null {
  return monthlyLimit === null ? null : Math.max(0, monthlyLimit - usedCount);
}

/** A switch tap edits a draft; only Save changes the company. Keep that distinction explicit. */
export function ocrUnsavedToggleMessage(savedEnabled: boolean, draftEnabled: boolean): string | null {
  if (savedEnabled === draftEnabled) return null;
  return draftEnabled
    ? 'ยังไม่เปิดใช้งาน — กด “บันทึก OCR” เพื่อเปิดให้บริษัทนี้'
    : 'ยังไม่ได้ปิด — กด “บันทึก OCR” เพื่อปิดการอ่านเอกสารใหม่';
}

/** Historical model-call rows cannot be converted safely into one-document OCR reads. */
export function ocrUsageTrackingNote(monthKey: string): string | null {
  return monthKey === '2026-08'
    ? 'ยอด OCR เริ่มนับตั้งแต่ 27 ส.ค. 2569 จึงไม่รวมการอ่านก่อนวันดังกล่าว เดือนถัดไปจะแสดงยอดครบทั้งเดือน'
    : null;
}

/** This endpoint's only 409 is the dedicated OCR CAS fence; the screen must reload before retry. */
export function isOcrConfigVersionConflict(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 409;
}

export const OCR_CONFIG_STALE_MESSAGE =
  'มีผู้ดูแลอีกคนเปลี่ยนการตั้งค่า OCR แล้ว ระบบโหลดค่าล่าสุดให้ กรุณาตรวจสอบก่อนบันทึกอีกครั้ง';

export async function reloadAfterOcrConfigConflict(
  error: unknown,
  reload: () => Promise<void>,
): Promise<boolean> {
  if (!isOcrConfigVersionConflict(error)) return false;
  await reload();
  return true;
}

// ── D1 usage breakdown (remediation spec §11.1, §11.3) ───────────────────────

/**
 * Baht per provider call. `calls = 0` is '—', never '฿0.00': a month with adjustments but no call
 * has cost and no denominator, and a zero average would read as "AI is free this month".
 */
export function aiAverageCostLabel(costSatang: number, calls: number): string {
  return calls > 0 ? satangToBaht(costSatang / calls) : '—';
}

export const AI_REQUEST_KIND_LABELS: Record<string, string> = {
  TEXT: 'ข้อความ',
  IMAGE: 'รูปภาพ',
  OTHER: 'ไฟล์อื่น',
  UNKNOWN: 'ไม่ทราบประเภท',
};

export const AI_BUDGET_BUCKET_LABELS: Record<string, string> = {
  CHAT: 'แชตและ AI ทั่วไป',
  OCR: 'AI อ่านเอกสาร',
  UNKNOWN: 'ไม่ทราบประเภท',
};

export const AI_USAGE_BASIS_LABELS: Record<string, string> = {
  PROVIDER_REPORTED: 'ผู้ให้บริการรายงานจริง',
  CONSERVATIVE_ESTIMATE: 'ค่าประมาณเมื่อหมดเวลา',
  COMPANY_ABSORBED: 'บริษัทแบก (ไม่หักเครดิตร้าน)',
  // Hold spec §4.2: an operator closed a stranded hold at the amount that was held for it. Money
  // with no measurement behind it and no model call attached, which is why it says "operator".
  OPERATOR_CHARGED_AT_BOUND: 'operator คิดตามยอดที่กันไว้',
  UNKNOWN: 'ไม่ทราบที่มา',
};

/** Missing priced evidence is UNAVAILABLE, never ฿0.00 (spec §11.2). */
export function aiCacheCostLabel(cacheCostSatang: { read: number; write: number } | null): string {
  return cacheCostSatang === null
    ? 'ไม่มีข้อมูล'
    : `อ่าน ${satangToBaht(cacheCostSatang.read)} / เขียน ${satangToBaht(cacheCostSatang.write)}`;
}

/** Labels the rollout month honestly instead of implying the whole month was tagged. */
export function aiCoverageNotice(
  coverage: { status: 'complete' | 'partial' | 'none'; calls: number; callsWithMetadata: number; firstMetadataAt: string | null },
  formatDate: (value: string) => string,
): string | null {
  if (coverage.status === 'complete' || coverage.calls === 0) return null;
  const since = coverage.firstMetadataAt ? ` เริ่มเก็บตั้งแต่ ${formatDate(coverage.firstMetadataAt)}` : '';
  return coverage.status === 'none'
    ? `เดือนนี้ยังไม่มีการแยกประเภท จึงแสดงเป็น “ไม่ทราบประเภท” ทั้งหมด${since}`
    : `เดือนนี้แยกประเภทได้ ${coverage.callsWithMetadata.toLocaleString('th-TH')} จาก ${coverage.calls.toLocaleString('th-TH')} ครั้ง ส่วนที่เหลือแสดงเป็น “ไม่ทราบประเภท”${since}`;
}

/** Says so when any of the month's spend rests on estimated or unknown counters (F-11). */
export function aiUsageBasisNote(rows: Array<{ usageBasis: string; costSatang: number; calls: number }>): string | null {
  const estimated = rows.find((row) => row.usageBasis === 'CONSERVATIVE_ESTIMATE');
  const absorbed = rows.find((row) => row.usageBasis === 'COMPANY_ABSORBED');
  const unknown = rows.find((row) => row.usageBasis === 'UNKNOWN');
  const parts = [
    estimated && estimated.calls > 0 ? `ค่าประมาณเมื่อหมดเวลา ${estimated.calls.toLocaleString('th-TH')} ครั้ง (${satangToBaht(estimated.costSatang)})` : null,
    unknown && unknown.calls > 0 ? `ไม่ทราบที่มา ${unknown.calls.toLocaleString('th-TH')} ครั้ง (${satangToBaht(unknown.costSatang)})` : null,
  ].filter(Boolean);
  const notes = [parts.length === 0 ? null : `token บางส่วนไม่ได้วัดจริง: ${parts.join(' · ')}`,
    absorbed && absorbed.calls > 0 ? `บริษัทแบก ${satangToBaht(absorbed.costSatang)} จาก ${absorbed.calls.toLocaleString('th-TH')} ครั้ง ไม่หักเครดิตร้านค่ะ` : null].filter(Boolean);
  return notes.length === 0 ? null : notes.join(' · ');
}

/**
 * During a rolling deploy this page can be served by a pre-D1 API, whose response carries no
 * `breakdown`/`otherTags` at all. The contract types stay required — the current API always sends
 * them — but the screen must degrade to the old card instead of throwing on a missing field.
 */
export function hasAiUsageBreakdown(usage: { breakdown?: unknown } | null | undefined): boolean {
  return !!usage && typeof usage.breakdown === 'object' && usage.breakdown !== null;
}

// ── Split CHAT/OCR budget policy (remediation spec §11.3, §12.4, §12.5) ──────

export const AI_BUDGET_MODE_LABELS: Record<string, string> = {
  SHARED: 'ไม่แยกเพดาน',
  SPLIT: 'แยกเพดานแชตและอ่านเอกสาร',
};

export const AI_BUDGET_SCOPE_LABELS = {
  total: 'เพดานความปลอดภัยทั้งเดือน',
  chat: 'เครดิตแชตและ AI ทั่วไป',
  ocr: 'เพดาน AI อ่านเอกสาร',
} as const;

/**
 * Read-only operators (`system.partner_dashboard.read` without `system.partner_ai_model.manage`)
 * keep every number and lose the form. `undefined` is a pre-D2 API during a rolling deploy: keep
 * today's behaviour, where the form shows and the server answers 403.
 */
export const canManageAiBudget = (usage: { canManage?: boolean } | null | undefined): boolean =>
  usage?.canManage !== false;

/**
 * `notice`, not `message`, on purpose: `no-raw-api-error-display.spec.ts` rejects any `x.message`
 * reaching a toast or a return, and the two older parsers above only pass through an exact-snippet
 * exemption. A different field name keeps that guard at full strength instead of growing its
 * allowlist — the copy is reviewed client-side Thai either way.
 */
export type AiBudgetCapParse = { ok: true; satang: number } | { ok: false; notice: string };

/**
 * A cap the operator types in baht. `0` closes that bucket on purpose (spec §12.1) — it is NOT
 * "unlimited" and NOT "not set" — and satang stay an exact integer on the wire, parsed in parts so
 * '30.50' cannot drift. Empty is rejected here; "no cap" is expressed by choosing SHARED.
 */
export function parseAiBudgetCapInput(raw: string): AiBudgetCapParse {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, notice: 'กรอกเพดานเป็นบาท ใส่ 0 หากต้องการปิดส่วนนั้น' };
  const parts = BAHT_INPUT.exec(trimmed);
  if (!parts) return { ok: false, notice: 'กรอกเพดานเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 30 หรือ 30.50' };
  const satang = Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(satang)) return { ok: false, notice: 'จำนวนเงินมากเกินไป กรุณาตรวจตัวเลขแล้วกรอกใหม่' };
  return { ok: true, satang };
}

/** The Bangkok month after `monthKey`. */
export function nextAiBudgetMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return month === 12 ? `${year! + 1}-01` : `${year}-${String(month! + 1).padStart(2, '0')}`;
}

/**
 * The only two months the writer accepts (spec §12.4), derived from the month the SERVER pinned in
 * this very response — never from the browser clock, which would disagree with it around midnight
 * and across time zones.
 */
export function aiBudgetMonthOptions(currentMonthKey: string): Array<{ monthKey: string; current: boolean }> {
  return [
    { monthKey: currentMonthKey, current: true },
    { monthKey: nextAiBudgetMonthKey(currentMonthKey), current: false },
  ];
}

/**
 * The Bangkok month the SERVER pinned for this response. `breakdown` is absent only when a pre-D1
 * API served the page, and the OCR block has carried the same month key since long before that.
 */
export function aiBudgetCurrentMonthKey(usage: {
  breakdown?: { monthKey?: string } | null;
  ocr: { current: { monthKey: string } };
}): string {
  return usage.breakdown?.monthKey ?? usage.ocr.current.monthKey;
}

export type AiBudgetMode = 'SHARED' | 'SPLIT';

/** What the operator is editing. Caps stay raw strings so a half-typed value never moves a number. */
export type AiBudgetDraft = {
  mode: AiBudgetMode;
  chat: string;
  ocr: string;
  effectiveMonthKey: string;
};

export type AiBudgetSavedPolicy = {
  mode: string;
  chatCapSatang: number | null;
  ocrCapSatang: number | null;
  pending: { mode: string; chatMonthlyBudgetSatang: number | null; ocrMonthlyBudgetSatang: number | null; effectiveMonthKey: string } | null;
};

/** Prefills the form from the SAVED server state — the active policy for the current month. */
export function aiBudgetDraftFromPolicy(policy: AiBudgetSavedPolicy, currentMonthKey: string): AiBudgetDraft {
  return {
    mode: policy.mode === 'SPLIT' ? 'SPLIT' : 'SHARED',
    // In SHARED the displayed 50-credit stop is not an editable split allocation.
    chat: policy.mode !== 'SPLIT' || policy.chatCapSatang === null ? '' : satangToBahtInput(policy.chatCapSatang),
    ocr: policy.ocrCapSatang === null ? '' : satangToBahtInput(policy.ocrCapSatang),
    effectiveMonthKey: currentMonthKey,
  };
}

export type AiBudgetPolicyRequest = {
  mode: AiBudgetMode;
  chatMonthlyBudgetSatang: number | null;
  ocrMonthlyBudgetSatang: number | null;
  effectiveMonthKey: string;
};

export type AiBudgetDraftValidation =
  | { ok: true; policy: AiBudgetPolicyRequest }
  | { ok: false; notice: string };

/**
 * Mirrors the server's own rules so the operator hears them before a round trip: SPLIT needs BOTH
 * caps, each a non-negative whole number of satang, and `C + O <= T` against the SAVED total —
 * never against an unsaved total draft, which is not the number the server will compare.
 */
export function validateAiBudgetDraft(
  draft: AiBudgetDraft,
  saved: { totalSatang: number; monthOptions: string[] },
): AiBudgetDraftValidation {
  if (!saved.monthOptions.includes(draft.effectiveMonthKey)) {
    return { ok: false, notice: 'เลือกเดือนที่เริ่มใช้เป็นเดือนนี้หรือเดือนถัดไปเท่านั้น' };
  }
  if (draft.mode === 'SHARED') {
    return { ok: true, policy: { mode: 'SHARED', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: null, effectiveMonthKey: draft.effectiveMonthKey } };
  }
  const chat = parseAiBudgetCapInput(draft.chat);
  if (!chat.ok) return { ok: false, notice: `เพดานแชต: ${chat.notice}` };
  const ocr = parseAiBudgetCapInput(draft.ocr);
  if (!ocr.ok) return { ok: false, notice: `เพดานอ่านเอกสาร: ${ocr.notice}` };
  if (chat.satang + ocr.satang > saved.totalSatang) {
    return {
      ok: false,
      notice: `ผลรวมเพดาน ${satangToBaht(chat.satang + ocr.satang)} เกินเพดานความปลอดภัยที่บันทึกไว้ ${satangToBaht(saved.totalSatang)} กรุณาลดเพดานหรือบันทึกเพดานความปลอดภัยที่สูงขึ้นก่อน`,
    };
  }
  return {
    ok: true,
    policy: { mode: 'SPLIT', chatMonthlyBudgetSatang: chat.satang, ocrMonthlyBudgetSatang: ocr.satang, effectiveMonthKey: draft.effectiveMonthKey },
  };
}

/**
 * Whether saving would change anything. Same comparison the writer makes: a draft for the CURRENT
 * month is compared with the active policy, one for next month with the pending policy — so
 * re-saving what is already stored keeps the button disabled instead of writing an audit row.
 */
export function aiBudgetDraftChanged(draft: AiBudgetDraft, policy: AiBudgetSavedPolicy, currentMonthKey: string): boolean {
  const parsed = validateAiBudgetDraft(draft, { totalSatang: Number.MAX_SAFE_INTEGER, monthOptions: [draft.effectiveMonthKey] });
  // A draft that does not parse is not "unchanged": let the operator press Save and hear why.
  if (!parsed.ok) return true;
  const desired = parsed.policy;
  const against = draft.effectiveMonthKey === currentMonthKey
    ? { mode: policy.mode, chat: policy.mode === 'SPLIT' ? policy.chatCapSatang : null,
        ocr: policy.mode === 'SPLIT' ? policy.ocrCapSatang : null }
    : policy.pending
      ? { mode: policy.pending.mode, chat: policy.pending.chatMonthlyBudgetSatang, ocr: policy.pending.ocrMonthlyBudgetSatang }
      : null;
  if (!against) return true;
  return desired.mode !== against.mode
    || desired.chatMonthlyBudgetSatang !== against.chat
    || desired.ocrMonthlyBudgetSatang !== against.ocr;
}

export type AiBudgetScopeRow = {
  key: 'total' | 'chat' | 'ocr';
  label: string;
  capSatang: number | null;
  spentSatang: number;
  reservedSatang: number;
  availableSatang: number | null;
};

/**
 * The saved money position, per scope. Every number comes from the server's own response — nothing
 * here is recomputed from a draft, so a typed-but-unsaved cap can never move a displayed balance
 * (spec §11.3).
 */
export function aiBudgetScopeRows(
  budget: {
    effectiveSatang: number;
    policy: { mode: string; chatCapSatang: number | null; ocrCapSatang: number | null };
    position: {
      total: { spentSatang: number; reservedSatang: number; availableSatang: number | null };
      chat: { spentSatang: number; reservedSatang: number; availableSatang: number | null };
      ocr: { spentSatang: number; reservedSatang: number; availableSatang: number | null };
    };
  },
): AiBudgetScopeRow[] {
  const split = budget.policy.mode === 'SPLIT';
  return [
    { key: 'total', label: AI_BUDGET_SCOPE_LABELS.total, capSatang: budget.effectiveSatang, ...budget.position.total },
    { key: 'chat', label: AI_BUDGET_SCOPE_LABELS.chat, capSatang: budget.policy.chatCapSatang, ...budget.position.chat },
    { key: 'ocr', label: AI_BUDGET_SCOPE_LABELS.ocr, capSatang: split ? budget.policy.ocrCapSatang : null, ...budget.position.ocr },
  ];
}

/** `null` is "not set", never "unlimited" (spec §12.1), so it must not read as money available. */
export const aiBudgetCapLabel = (capSatang: number | null): string =>
  capSatang === null ? 'ยังไม่ตั้ง' : capSatang === 0 ? 'ปิดส่วนนี้ (0 บาท)' : satangToBaht(capSatang);

/**
 * Money LEFT, which is a real number even at zero — an exhausted bucket reads ฿0.00, never
 * "ปิดส่วนนี้" (that is a CAP of 0, a different fact). `null` is a SHARED bucket with no separate
 * cap: what is left there is simply the shared total, not a setting somebody forgot.
 */
export const aiBudgetAvailableLabel = (availableSatang: number | null): string =>
  availableSatang === null ? 'ตามเพดานความปลอดภัย' : satangToBaht(availableSatang);

/**
 * During a rolling deploy this page can be served by a pre-E1a API, whose `budget` carries neither
 * `policy` nor `position`. The contract types stay required — the current API always sends them —
 * but the split panel must simply not render instead of throwing and taking the whole card down
 * with a load error (the same tolerance {@link hasAiUsageBreakdown} gives the D1 breakdown).
 */
export function hasAiBudgetPolicy(
  usage: { budget?: { policy?: unknown; position?: unknown } } | null | undefined,
): boolean {
  const budget = usage?.budget;
  if (!budget) return false;
  const isObject = (value: unknown) => typeof value === 'object' && value !== null;
  return isObject(budget.policy) && isObject(budget.position);
}

/** Says what to fix, not just that something is wrong — this state refuses every AI call. */
export function aiBudgetInvalidNotice(invalidReason: string | undefined): string | null {
  if (!invalidReason) return null;
  const fix: Record<string, string> = {
    SPLIT_CAPS_MISSING: 'โหมดแยกเพดานถูกตั้งไว้แต่ยังไม่มีเพดานครบทั้งสองส่วน กรอกทั้งเพดานแชตและเพดานอ่านเอกสาร (ใส่ 0 หากต้องการปิดส่วนนั้น) แล้วบันทึก',
    SPLIT_EXCEEDS_TOTAL: 'ผลรวมเพดานแชตและอ่านเอกสารเกินเพดานความปลอดภัยของเดือนนี้ ลดเพดานอย่างน้อยหนึ่งส่วน หรือเพิ่มเพดานความปลอดภัยก่อน แล้วบันทึกอีกครั้ง',
    POLICY_MALFORMED: 'ค่าที่บันทึกไว้อ่านไม่ได้ ตั้งโหมดและเพดานใหม่ทั้งชุดแล้วบันทึก',
  };
  return `ตอนนี้ระบบปฏิเสธการเรียก AI ของบริษัทนี้ทุกช่องทาง เพราะการตั้งค่าเครดิตไม่ถูกต้อง — ${fix[invalidReason] ?? 'ตั้งโหมดและเพดานใหม่ทั้งชุดแล้วบันทึก'}`;
}

/** "เริ่มเดือน …" — a scheduled policy, kept visually apart from "ใช้อยู่" (spec §12.5). */
export function aiBudgetPendingText(
  pending: AiBudgetSavedPolicy['pending'],
  formatMonth: (monthKey: string) => string,
): string | null {
  if (!pending) return null;
  const allocation = pending.mode === 'SPLIT'
    ? `แชต ${aiBudgetCapLabel(pending.chatMonthlyBudgetSatang)} · อ่านเอกสาร ${aiBudgetCapLabel(pending.ocrMonthlyBudgetSatang)}`
    : 'กลับไปไม่แยกเพดาน';
  return `เริ่มเดือน ${formatMonth(pending.effectiveMonthKey)}: ${AI_BUDGET_MODE_LABELS[pending.mode] ?? pending.mode} — ${allocation}`;
}

/** Holds are not spend and add no provider call — label them so, wherever the number appears. */
export const AI_BUDGET_RESERVED_NOTE = 'กันไว้ระหว่างเรียก AI';

export const AI_BUDGET_STALE_MESSAGE =
  'ข้อมูลเครดิต AI ถูกแก้จากที่อื่นหรือขึ้นเดือนใหม่แล้ว ระบบโหลดค่าล่าสุดให้ กรุณาตรวจสอบก่อนบันทึกอีกครั้ง';

/** The two 409 fences this writer can answer; both mean "reload, then re-check before saving". */
export function isAiBudgetPolicyConflict(code: string | null | undefined): boolean {
  return code === 'partner_ai_budget_revision_conflict' || code === 'partner_ai_configuration_changed';
}

/** Same shape as {@link reloadAfterOcrConfigConflict}: reload first, then tell the operator. */
export async function reloadAfterAiBudgetConflict(
  code: string | null | undefined,
  reload: () => Promise<void>,
): Promise<boolean> {
  if (!isAiBudgetPolicyConflict(code)) return false;
  await reload();
  return true;
}

// ── Held credit that needs an operator decision (hold-reconciliation spec §4.1–4.2) ─────────────

/**
 * Thai for the declared step kinds (`packages/contracts/src/ai-budget-bounds.ts`). One entry per
 * kind in that table; a kind not listed falls back to its own id, which is what the operator would
 * have to grep for anyway. The words are the ones the rest of the console already uses: "แชต",
 * "อ่านเอกสาร", "ลูกค้าสัมพันธ์".
 */
export const AI_BUDGET_STEP_KIND_LABELS: Record<string, string> = {
  'line-intake-text': 'ข้อความจาก LINE',
  'line-intake-image': 'รูปจาก LINE',
  'line-turn': 'แชตกับผู้ช่วย AI',
  'receipt-ocr': 'อ่านใบเสร็จ',
  'bank-statement': 'อ่านรายการเดินบัญชี',
  'receipt-capture-read': 'อ่านไฟล์หลักฐาน',
  'receipt-capture-extract': 'ดึงข้อมูลจากไฟล์หลักฐาน',
  'crm-summary': 'ลูกค้าสัมพันธ์ — สรุป',
  'crm-reply-draft': 'ลูกค้าสัมพันธ์ — ร่างข้อความตอบ',
  'crm-intake': 'ลูกค้าสัมพันธ์ — อ่านข้อความเข้า',
  'crm-customer-profile-extract': 'ลูกค้าสัมพันธ์ — ดึงข้อมูลลูกค้า',
  'crm-booking-extract': 'ลูกค้าสัมพันธ์ — ดึงข้อมูลนัดหมาย',
  'crm-insights': 'ลูกค้าสัมพันธ์ — ข้อสังเกต',
  'crm-broadcast': 'ลูกค้าสัมพันธ์ — ข้อความบรอดแคสต์',
  'crm-trust-score': 'ลูกค้าสัมพันธ์ — คะแนนความน่าเชื่อถือ',
  'draft-generate': 'ร่างเอกสารให้',
};

export const aiCreditHoldStepLabel = (stepKind: string): string =>
  AI_BUDGET_STEP_KIND_LABELS[stepKind] ?? stepKind;

/** What the row is waiting for. A breach is NOT a stranded hold: it is money already recorded. */
export const AI_CREDIT_HOLD_KIND_LABELS = {
  UNRESOLVED_HOLD: 'ยังไม่ทราบผล',
  BREACH: 'ใช้เกินที่กันไว้',
} as const;

export const aiCreditHoldKindLabel = (kind: string): string =>
  AI_CREDIT_HOLD_KIND_LABELS[kind as keyof typeof AI_CREDIT_HOLD_KIND_LABELS] ?? kind;

/**
 * How long the credit has been held, in the coarsest unit that is still true. Rounded DOWN, so a
 * hold is never reported as older than it is, and a clock skew that makes `createdAt` look
 * fractionally future reads "เมื่อสักครู่" instead of a negative age.
 */
export function aiCreditHoldAgeLabel(createdAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'เมื่อสักครู่';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes.toLocaleString('th-TH')} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours.toLocaleString('th-TH')} ชั่วโมง`;
  return `${Math.floor(hours / 24).toLocaleString('th-TH')} วัน`;
}

export type AiCreditHoldAction = 'release' | 'charge_at_bound' | 'acknowledge_breach';

export const AI_CREDIT_HOLD_ACTION_LABELS: Record<AiCreditHoldAction, string> = {
  release: 'ปล่อยเครดิตที่กันไว้',
  charge_at_bound: 'คิดตามยอดที่กันไว้',
  acknowledge_breach: 'รับทราบ',
};

/**
 * The confirm dialog's body: what happens to the MONEY, in words, before the operator commits.
 *
 * Each action is irreversible in the sense that matters — released credit is spendable again the
 * moment it is released, and a charge lands in the month's spend — so the sentence names the amount
 * and the consequence rather than asking "are you sure?".
 */
export function aiCreditHoldConsequence(
  action: AiCreditHoldAction,
  hold: { upperBoundSatang: number; settledCostSatang: number | null; stepKind: string },
  reason: string,
): { title: string; message: string; confirmLabel: string } {
  const amount = satangToBaht(hold.upperBoundSatang);
  const step = aiCreditHoldStepLabel(hold.stepKind);
  const tail = `\nเหตุผล: ${reason}`;
  if (action === 'release') {
    return {
      title: 'ยืนยันปล่อยเครดิตที่กันไว้',
      message: `${step} · ${amount}\nหลังยืนยัน เครดิต ${amount} จะกลับมาให้ร้านใช้ได้ทันที และจะไม่มีการบันทึกค่าใช้จ่ายจากรายการนี้\n`
        + `ทำเมื่อมั่นใจว่างานนี้ไม่ได้เรียก AI จริง ถ้ามีหลักฐานการใช้จริงมาถึงภายหลัง ระบบจะบันทึกยอดจริงเพิ่มเอง${tail}`,
      confirmLabel: 'ปล่อยเครดิตที่กันไว้',
    };
  }
  if (action === 'charge_at_bound') {
    return {
      title: 'ยืนยันคิดตามยอดที่กันไว้',
      message: `${step} · ${amount}\nหลังยืนยัน ระบบจะบันทึก ${amount} เป็นค่าใช้จ่ายจริงของเดือนนี้ และเครดิตที่กันไว้จะกลายเป็นยอดใช้แล้ว\n`
        + 'ยอดนี้เป็นยอดที่กันไว้ ไม่ใช่ยอดที่วัดจากผู้ให้บริการ จึงไม่นับเป็นจำนวนครั้งที่เรียกโมเดล\n'
        + `ทำเมื่อมั่นใจว่างานนี้เรียก AI จริงแต่ผลไม่กลับมา${tail}`,
      confirmLabel: 'คิดตามยอดที่กันไว้',
    };
  }
  const settled = hold.settledCostSatang === null ? amount : satangToBaht(hold.settledCostSatang);
  return {
    title: 'ยืนยันรับทราบรายการใช้เกินที่กันไว้',
    message: `${step} · ใช้จริง ${settled} จากที่กันไว้ ${amount}\nหลังยืนยัน ระบบจะปิดการแจ้งเตือนนี้ค่ะ ยอดที่บันทึกไว้ไม่เปลี่ยน และไม่มีการคืนเครดิต\n`
      + `ตรวจเพดานของส่วนนี้ก่อน ถ้ายังต่ำเกินไป งานถัดไปจะถูกปฏิเสธเพราะเครดิตไม่พอ${tail}`,
    confirmLabel: 'รับทราบ',
  };
}

/** The one-line help under the table. Why a release is safe even when the operator guesses wrong. */
export const AI_CREDIT_HOLD_HELP_NOTE =
  'ถ้ามีหลักฐานการใช้จริงมาถึงภายหลัง ระบบจะบันทึกยอดจริงเพิ่มเอง';

export const AI_CREDIT_HOLD_EMPTY_NOTE = 'ไม่มีรายการค้าง';

/** The 409s these three actions answer; both mean "the list you are looking at is stale". */
export function isAiCreditHoldConflict(code: string | null | undefined): boolean {
  return code === 'partner_ai_credit_hold_already_resolved'
    || code === 'partner_ai_credit_breach_already_acknowledged'
    || code === 'partner_ai_credit_hold_not_found';
}

// ── Admin tab rework 2026-09-29: chat credit, receipt images, safety ceiling ─────────────────────

/** Money in a sentence: "80 บาท", "2,000 บาท", "12.34 บาท" — never a trailing ".00". */
export const bahtText = (satang: number): string =>
  `${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: satang % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })} บาท`;

type DateText = (iso: string) => string;
const isTrial = (tierKey: string | null) => tierKey === 'FREE_TRIAL_15';

/** Cut over to package cycles and credit lots (add-on spec §11). No shop is, until the cutover tool runs. */
const cutOver = (usage: Pick<PartnerAiUsageDto, 'budget'>, now: number) =>
  !!usage.budget.chatCredit?.cutoverAt && Date.parse(usage.budget.chatCredit.cutoverAt) <= now;

/** Where this month's chat credit comes from, in the words the status list and the credit card share. */
export function aiChatCreditSourceText(usage: Pick<PartnerAiUsageDto, 'budget'>, formatDate: DateText, now = Date.now()): string {
  const { policy, chatCredit } = usage.budget;
  const cap = policy.chatCapSatang ?? 0;
  if (cutOver(usage, now)) return `รอบเครดิต AI ของแพ็กเกจ (${bahtText(cap)} ต่อรอบ) และยอดเพิ่มเติม`;
  if (policy.chatSource === 'ADMIN') return `ผู้ดูแลตั้งให้ร้านนี้ ${bahtText(cap)}`;
  if (policy.chatSource === 'SALES_DEAL') {
    const endsAt = chatCredit?.deal?.endsAt;
    return `ดีลขาย ${bahtText(cap)}${endsAt ? ` ถึง ${formatDate(endsAt)}` : ' ตลอดที่ดีลยังต่ออายุ'}`;
  }
  if (policy.chatSource === 'SPLIT') return `แยกเพดานแชต ${policy.chatCapSatang === null ? 'ยังไม่ตั้ง' : bahtText(cap)} (ตั้งค่าขั้นสูง)`;
  return `ค่าเริ่มต้น ${bahtText(DEFAULT_CHAT_CREDIT_SATANG)}`;
}

/** The package the receipt images come from, e.g. "แพ็กเกจ เริ่มต้น (STARTER) 30 รูป หมดอายุ 29 ต.ค. 2569". */
export function receiptImagesSourceText(images: PartnerReceiptImagesDto, formatDate: DateText): string {
  const plan = billingPlanLabel(images.tierKey);
  const limit = images.package?.limit ?? 0;
  if (images.basis === 'NONE') return 'ยังไม่มีแพ็กเกจ — จำนวนรูปไม่ถูกจำกัดจากแพ็กเกจ';
  if (images.basis === 'PACKAGE_LOTS') {
    return `แพ็กเกจ ${plan} ${limit.toLocaleString('th-TH')} รูป${images.package?.expiresAt ? ` หมดอายุ ${formatDate(images.package.expiresAt)}` : ''}`;
  }
  const scope = isTrial(images.tierKey) ? 'ช่วงทดลอง' : `แพ็กเกจที่ทีมงานตั้งให้ (${plan})`;
  return `${scope} ${limit.toLocaleString('th-TH')} รูปต่อเดือน${images.enforced ? '' : ' — นับอย่างเดียว ไม่หยุดอ่านเมื่อครบ'}`;
}

export type AiTabStatusTone = 'ok' | 'warn' | 'stop';
export type AiTabStatusRow = { key: string; label: string; value: string; tone: AiTabStatusTone };

/**
 * "ใช้ได้หรือไม่ได้" (Owner 2026-09-29): which rule is in force for this shop right now, one row each,
 * from the saved server state only. `stop` = this rule is refusing work now; `warn` = it will, or it
 * does not do what an operator would expect.
 */
export function aiTabStatusRows(usage: PartnerAiUsageDto, formatDate: DateText, now = Date.now()): AiTabStatusRow[] {
  const rows: AiTabStatusRow[] = [];
  const add = (key: string, label: string, value: string, tone: AiTabStatusTone = 'ok') => rows.push({ key, label, value, tone });
  const { budget, ocr } = usage;
  const images = ocr.receiptImages;
  if (hasAiBudgetPolicy(usage)) {
    const invalid = aiBudgetInvalidNotice(budget.policy.invalidReason);
    if (invalid) add('policy', 'การตั้งค่าเครดิต AI', invalid, 'stop');
    add('chat-source', 'เครดิตแชตมาจาก', aiChatCreditSourceText(usage, formatDate, now));
    const cap = budget.policy.chatCapSatang, chat = budget.position.chat;
    if (!cutOver(usage, now) && cap !== null) {
      if (cap === 0) add('chat-balance', 'เครดิตแชตเดือนนี้', 'ปิดแชต AI ของร้านนี้ (0 บาท)', 'stop');
      else if (chat.availableSatang === 0) add('chat-balance', 'เครดิตแชตเดือนนี้', `หมดแล้ว (ใช้ ${bahtText(chat.spentSatang)}) — แชต AI หยุดจนขึ้นเดือนใหม่`, 'stop');
      else add('chat-balance', 'เครดิตแชตเดือนนี้', `ใช้ ${bahtText(chat.spentSatang)} เหลือ ${bahtText(chat.availableSatang ?? cap)}`);
    }
  }
  if (images) {
    const source = receiptImagesSourceText(images, formatDate);
    if (images.basis === 'PACKAGE_LOTS' && !images.active) add('images-source', 'จำนวนอ่านรูปมาจาก', `${source} — แพ็กเกจหมดอายุหรือถูกพัก จึงยังอ่านรูปไม่ได้`, 'stop');
    else add('images-source', 'จำนวนอ่านรูปมาจาก', source, images.basis === 'MONTHLY' && !images.enforced ? 'warn' : 'ok');
    if (images.basis !== 'NONE' && images.package && images.totalRemaining !== null) {
      const parts = `จากแพ็กเกจ ${images.package.remaining.toLocaleString('th-TH')}${images.additional.remaining > 0 ? ` · ยอดเพิ่มเติม ${images.additional.remaining.toLocaleString('th-TH')}` : ''}`;
      if (images.totalRemaining === 0 && images.enforced) {
        add('images-balance', 'รูปใบเสร็จคงเหลือ', images.basis === 'MONTHLY'
          ? 'ครบแล้ว — ระบบไม่อ่านรูปใบเสร็จใหม่จนขึ้นเดือนใหม่' : 'ครบแล้ว — ระบบไม่อ่านรูปใบเสร็จใหม่จนกว่าจะต่อแพ็กเกจหรือเพิ่มยอด', 'stop');
      } else if (images.basis === 'MONTHLY' && !images.enforced && images.package.remaining === 0) {
        add('images-balance', 'รูปใบเสร็จคงเหลือ', 'ครบจำนวนของเดือนนี้แล้ว แต่ยังอ่านต่อได้เพราะตั้งเป็นนับอย่างเดียว', 'warn');
      } else add('images-balance', 'รูปใบเสร็จคงเหลือ', `เหลือ ${images.totalRemaining.toLocaleString('th-TH')} รูป (${parts})`);
    }
  }
  const limit = ocr.config.monthlyLimit, used = ocr.current.usedCount;
  if (limit === null) add('ocr-limit', 'เพดาน OCR รายเดือน', 'ไม่ได้ตั้ง');
  else if (used >= limit) add('ocr-limit', 'เพดาน OCR รายเดือน', `${limit.toLocaleString('th-TH')} ครั้ง — ครบแล้ว ระบบหยุดอ่านเอกสารทุกชนิดจนขึ้นเดือนใหม่ แม้แพ็กเกจยังมีรูปเหลือ`, 'stop');
  else if (images && images.totalRemaining !== null && limit - used < images.totalRemaining) {
    add('ocr-limit', 'เพดาน OCR รายเดือน', `${limit.toLocaleString('th-TH')} ครั้ง (อ่านแล้ว ${used.toLocaleString('th-TH')}) — ต่ำกว่ารูปที่ร้านยังเหลือ ระบบจะหยุดอ่านที่เพดานนี้ก่อน`, 'warn');
  } else add('ocr-limit', 'เพดาน OCR รายเดือน', `${limit.toLocaleString('th-TH')} ครั้ง (อ่านแล้ว ${used.toLocaleString('th-TH')})`);
  add('ocr-enabled', 'การอ่านเอกสารด้วย AI', ocr.config.enabled ? 'เปิดอยู่' : 'ปิดอยู่ — AI ไม่อ่านเอกสารใหม่', ocr.config.enabled ? 'ok' : 'stop');
  if (hasAiBudgetPolicy(usage)) {
    const ceiling = budget.effectiveSatang, spent = budget.position.total.spentSatang;
    const text = `${budget.overrideSatang === null ? 'ค่ากลางของระบบ' : 'ตั้งเฉพาะร้านนี้'} ${bahtText(ceiling)} (ใช้ไป ${bahtText(spent)})`;
    if (spent >= ceiling) add('safety', 'เพดานความปลอดภัยค่า AI', `${text} — ถึงเพดานแล้ว AI หยุดทุกช่องทางจนขึ้นเดือนใหม่`, 'stop');
    else if (budget.policy.chatCapSatang !== null && budget.policy.chatCapSatang > ceiling) {
      add('safety', 'เพดานความปลอดภัยค่า AI', `${text} — ต่ำกว่าเครดิตแชต แชตจึงใช้ได้ไม่เกินเพดานนี้`, 'warn');
    } else add('safety', 'เพดานความปลอดภัยค่า AI', text);
    if (budget.position.breach) add('breach', 'เครดิตที่กันไว้', 'มีรายการใช้เกินที่กันไว้ค่ะ ตรวจสอบได้ที่เครดิตที่กันไว้ค้าง', 'warn');
    else if (budget.position.unresolvedHolds > 0) add('holds', 'เครดิตที่กันไว้', `${budget.position.unresolvedHolds.toLocaleString('th-TH')} รายการยังไม่ทราบผล — เครดิตส่วนนั้นยังถูกกันไว้`, 'warn');
  }
  return rows;
}

/** The chat credit editor. Empty = no own setting (the default or a sales deal); 0 closes chat. */
export type ChatCreditParse = { ok: true; satang: number | null } | { ok: false; notice: string };

export function parseChatCreditInput(raw: string): ChatCreditParse {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, satang: null };
  const parts = BAHT_INPUT.exec(trimmed);
  if (!parts) return { ok: false, notice: 'กรอกเครดิตแชตเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 150 หรือ 150.50' };
  const satang = Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(satang) || satang > 2_147_483_647) return { ok: false, notice: 'จำนวนเงินมากเกินไป กรุณาตรวจตัวเลขแล้วกรอกใหม่' };
  return { ok: true, satang };
}

/** The admin's own chat credit, or '' when the shop follows the default or a sales deal. */
export function chatCreditInputFromUsage(usage: Pick<PartnerAiUsageDto, 'budget'>): string {
  const { policy } = usage.budget;
  return policy.chatSource === 'ADMIN' && policy.chatCapSatang !== null ? satangToBahtInput(policy.chatCapSatang) : '';
}

/** Whether saving would change the shop's own chat credit; a draft that does not parse is "changed". */
export function chatCreditDraftChanged(usage: Pick<PartnerAiUsageDto, 'budget'>, raw: string): boolean {
  const parsed = parseChatCreditInput(raw);
  const { policy } = usage.budget;
  return !parsed.ok || parsed.satang !== (policy.chatSource === 'ADMIN' ? policy.chatCapSatang : null);
}

/**
 * The write for this editor, through the existing budget-policy writer: SHARED with the chat credit,
 * effective this month. `null` hands the shop back to the default or its sales deal.
 */
export function chatCreditPolicyRequest(satang: number | null, currentMonthKey: string): AiBudgetPolicyRequest {
  return { mode: 'SHARED', chatMonthlyBudgetSatang: satang, ocrMonthlyBudgetSatang: null, effectiveMonthKey: currentMonthKey };
}

/** What the confirm dialog says before an admin changes a shop's chat credit. */
export function chatCreditConfirmMessage(usage: Pick<PartnerAiUsageDto, 'budget'>, satang: number | null, reason: string, formatDate: DateText): string {
  const { chatCredit, position, effectiveSatang } = usage.budget;
  const deal = chatCredit?.deal;
  const after = satang !== null ? `ผู้ดูแลตั้งให้ร้านนี้ ${bahtText(satang)}`
    : deal ? `ดีลขาย ${bahtText(deal.satang)}${deal.endsAt ? ` ถึง ${formatDate(deal.endsAt)}` : ''}` : `ค่าเริ่มต้น ${bahtText(DEFAULT_CHAT_CREDIT_SATANG)}`;
  const spent = position.chat.spentSatang, cap = satang ?? deal?.satang ?? DEFAULT_CHAT_CREDIT_SATANG;
  return [
    `เครดิตแชตต่อเดือน: ${aiChatCreditSourceText(usage, formatDate)} → ${after}`,
    `เดือนนี้ใช้แชตไปแล้ว ${bahtText(spent)}${cap <= spent ? ' หลังบันทึกแชต AI จะหยุดจนขึ้นเดือนใหม่' : ''}`,
    ...(cap > effectiveSatang ? [`เครดิตนี้สูงกว่าเพดานความปลอดภัย ${bahtText(effectiveSatang)} แชตจึงใช้ได้ไม่เกินเพดานนั้น`] : []),
    'มีผลกับงานที่เริ่มหลังบันทึก งานที่เริ่มแล้วจะทำจนจบ',
    `เหตุผล: ${reason}`,
  ].join('\n');
}

/** What the confirm dialog says before an admin changes the safety ceiling. Chat credit never moves with it. */
export function safetyCeilingConfirmMessage(usage: Pick<PartnerAiUsageDto, 'budget' | 'current'>, desiredSatang: number, reason: string): string {
  const spent = usage.current?.costSatang ?? 0;
  return [
    `เพดานความปลอดภัยค่า AI ต่อเดือน: ${bahtText(usage.budget.effectiveSatang)} → ${bahtText(desiredSatang)}`,
    `เดือนนี้ใช้ AI ทุกช่องทางไปแล้ว ${bahtText(spent)}${desiredSatang <= spent ? ' หลังบันทึก AI จะหยุดทุกช่องทางจนขึ้นเดือนใหม่' : ''}`,
    'เครดิตแชตของร้านไม่เปลี่ยน',
    `เหตุผล: ${reason}`,
  ].join('\n');
}

/**
 * The trial/staff-set quota enforcement choice has an effect only on a monthly allowance: a paid
 * package always enforces, and a shop with no package has no allowance to enforce. An API without
 * `receiptImages` keeps the old rule (hidden for paid grants only).
 */
export function receiptQuotaControlVisible(ocr: Pick<PartnerAiUsageDto['ocr'], 'receiptImages' | 'planQuota'>): boolean {
  return ocr.receiptImages ? ocr.receiptImages.basis === 'MONTHLY' : ocr.planQuota?.source !== 'PAID_GRANTS';
}

export type ReceiptImageTile = { key: string; label: string; value: string; note: string };

/** The three numbers of the receipt card: from the package, added, and in total — images, never money. */
export function receiptImageTiles(images: PartnerReceiptImagesDto, formatDate: DateText): ReceiptImageTile[] {
  if (images.basis === 'NONE' || !images.package) return [];
  const count = (n: number) => `${n.toLocaleString('th-TH')} รูป`;
  const monthly = images.basis === 'MONTHLY';
  return [
    { key: 'package', label: monthly ? 'เดือนนี้' : 'จากแพ็กเกจ', value: `${count(images.package.remaining)} จาก ${images.package.limit.toLocaleString('th-TH')}`,
      note: monthly ? `ใช้แล้ว ${images.package.used.toLocaleString('th-TH')} · เริ่มนับใหม่ทุกต้นเดือน`
        : `ใช้แล้ว ${images.package.used.toLocaleString('th-TH')}${images.package.expiresAt ? ` · หมดอายุ ${formatDate(images.package.expiresAt)}` : ''}` },
    { key: 'additional', label: 'ยอดเพิ่มเติม', value: count(images.additional.remaining),
      note: images.additional.expiresAt ? `ใช้ได้ถึง ${formatDate(images.additional.expiresAt)}` : 'ทีมงานเพิ่มให้หรือร้านซื้อเพิ่ม' },
    { key: 'total', label: 'คงเหลือรวม', value: count(images.totalRemaining ?? 0),
      note: images.enforced ? 'ครบแล้วระบบหยุดอ่านรูปใบเสร็จใหม่' : 'ตั้งเป็นนับอย่างเดียว ครบแล้วยังอ่านต่อได้' },
  ];
}
