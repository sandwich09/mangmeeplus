// Pure helpers for the partner console's "AI Usage & Budget" card. The API speaks satang; the
// operator thinks in baht, so the conversion and the guardrails live here where they are testable.

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
  const unknown = rows.find((row) => row.usageBasis === 'UNKNOWN');
  const parts = [
    estimated && estimated.calls > 0 ? `ค่าประมาณเมื่อหมดเวลา ${estimated.calls.toLocaleString('th-TH')} ครั้ง (${satangToBaht(estimated.costSatang)})` : null,
    unknown && unknown.calls > 0 ? `ไม่ทราบที่มา ${unknown.calls.toLocaleString('th-TH')} ครั้ง (${satangToBaht(unknown.costSatang)})` : null,
  ].filter(Boolean);
  return parts.length === 0 ? null : `token บางส่วนไม่ได้วัดจริง: ${parts.join(' · ')}`;
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
  SHARED: 'เครดิตรวมก้อนเดียว',
  SPLIT: 'แยกเพดานแชตและอ่านเอกสาร',
};

export const AI_BUDGET_SCOPE_LABELS = {
  total: 'เครดิตรวมทั้งเดือน',
  chat: 'เพดานแชตและ AI ทั่วไป',
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
    chat: policy.chatCapSatang === null ? '' : satangToBahtInput(policy.chatCapSatang),
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
      notice: `ผลรวมเพดาน ${satangToBaht(chat.satang + ocr.satang)} เกินเครดิตรวมที่บันทึกไว้ ${satangToBaht(saved.totalSatang)} กรุณาลดเพดานหรือบันทึกเครดิตรวมที่สูงขึ้นก่อน`,
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
    ? { mode: policy.mode, chat: policy.chatCapSatang, ocr: policy.ocrCapSatang }
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
    { key: 'chat', label: AI_BUDGET_SCOPE_LABELS.chat, capSatang: split ? budget.policy.chatCapSatang : null, ...budget.position.chat },
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
  availableSatang === null ? 'ตามเครดิตรวม' : satangToBaht(availableSatang);

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
    SPLIT_EXCEEDS_TOTAL: 'ผลรวมเพดานแชตและอ่านเอกสารเกินเครดิตรวมของเดือนนี้ ลดเพดานอย่างน้อยหนึ่งส่วน หรือเพิ่มเครดิตรวมก่อน แล้วบันทึกอีกครั้ง',
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
    : 'กลับไปใช้เครดิตรวมก้อนเดียว';
  return `เริ่มเดือน ${formatMonth(pending.effectiveMonthKey)}: ${AI_BUDGET_MODE_LABELS[pending.mode] ?? pending.mode} — ${allocation}`;
}

/** The activation gate is a server readiness flag (ADR 0013 §9), not a permission problem. */
export const AI_BUDGET_SPLIT_DISABLED_NOTE =
  'ระบบยังไม่เปิดให้แยกเพดานแชตกับอ่านเอกสาร จึงบันทึกโหมดแยกเพดานไม่ได้ ยังดูยอดได้ทุกส่วน และยังตั้งเครดิตรวมก้อนเดียวหรือยกเลิกค่าที่ตั้งให้เริ่มเดือนถัดไปได้ตามปกติ';

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
