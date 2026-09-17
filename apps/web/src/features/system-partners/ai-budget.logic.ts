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
    return { ok: false, message: 'กรอกงบตั้งแต่ 1 บาท หากต้องการหยุดใช้ AI ให้ปิดสิทธิ์ผู้ช่วย AI ของบริษัท' };
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

/** Top 10 + “อื่น ๆ” must equal the event-derived month total, or the table is lying. */
export function aiTagsReconcile(
  topTags: Array<{ costSatang: number }>,
  otherTags: { costSatang: number },
  totalCostSatang: number,
): boolean {
  return topTags.reduce((sum, row) => sum + row.costSatang, 0) + otherTags.costSatang === totalCostSatang;
}
