// Pure helpers for the promotion-campaign screens (docs/specs/starter-249-bonus-month-promotion-spec-th.md §4,
// plan docs/plans/starter-249-bonus-month-promotion-plan.md §4). The API speaks UTC instants, satang, enum keys and
// error codes; the Admin reads Thai time, baht and Thai words. Every conversion lives here so a unit test can hold it.
import {
  BILLING_PROMOTION_STARTER_TEMPLATE,
  billingLabel,
  billingOfferLabel,
  billingPermissionLabel,
  billingPlanLabel,
  type BillingConfigurationOperation,
  type BillingInterval,
  type BillingMode,
  type BillingPromotionCampaign,
  type BillingPromotionCampaignAction,
  type BillingPromotionCampaignReport,
  type BillingPromotionCampaignStatus,
  type BillingPromotionCampaignView,
  type BillingPromotionDraftError,
  type BillingPromotionDraftField,
  type BillingPromotionDraftInput,
  type BillingPromotionPreviewRow,
  type BillingPromotionReportCompany,
  type BillingPromotionTemplate,
} from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { billingLocalTime, billingTimeIso } from './billing-date-time';

export const CAMPAIGN_MANAGE_PERMISSION = 'system.billing.policy.manage';
/** The same limits `parsePromotionDraft` enforces on the server (billing-promotion.ts). */
export const CAMPAIGN_TEXT_LIMITS = { internalName: 120, description: 500, displayName: 80, reason: 500 } as const;
const CAP_MAX = 2_147_483_647;

export type CampaignTone = 'gray' | 'amber' | 'green' | 'brand';
export const CAMPAIGN_TONE_CLASS: Record<CampaignTone, string> = {
  gray: 'border-gray-200 bg-gray-100 text-gray-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  green: 'border-green-200 bg-green-50 text-green-800',
  brand: 'border-brand-200 bg-brand-50 text-brand-800',
};

// ── words ──

export const CAMPAIGN_STATUS_META: Record<BillingPromotionCampaignStatus, { label: string; tone: CampaignTone; help: string }> = {
  DRAFT: { label: 'ร่าง', tone: 'gray', help: 'บันทึกร่างไว้เท่านั้น ลูกค้ายังไม่เห็นและใช้สิทธิ์ไม่ได้ ตรวจตัวอย่างแล้วยืนยันเปิดเมื่อพร้อม' },
  AWAITING_APPROVAL: { label: 'รออนุมัติ', tone: 'amber', help: 'ส่งคำขอเปิดแล้ว ลูกค้ายังใช้สิทธิ์ไม่ได้จนกว่าจะอนุมัติ' },
  SCHEDULED: { label: 'ตั้งเวลาแล้ว', tone: 'brand', help: 'เผยแพร่แล้วแต่ยังไม่ถึงเวลาเริ่ม ระบบจะเริ่มรับสิทธิ์ตามเวลาจริงโดยไม่ต้องทำอะไรเพิ่ม' },
  ACTIVE: { label: 'กำลังใช้งาน', tone: 'green', help: 'ร้านที่เข้าเงื่อนไขเลือกใช้สิทธิ์ตอนซื้อแพ็กเกจได้' },
  PAUSED: { label: 'พัก', tone: 'amber', help: 'ไม่รับสิทธิ์ใหม่ รายการที่จองไว้แล้วยังได้รับสิทธิ์ตามเดิม กลับมาเปิดได้ภายในช่วงเวลาเดิม' },
  ENDED: { label: 'จบแล้ว', tone: 'gray', help: 'ปิดรับสิทธิ์แล้ว ดูประวัติได้ แต่เปิดใหม่ด้วยแคมเปญเดิมไม่ได้ ถ้าจะจัดรอบใหม่ต้องสร้างแคมเปญใหม่' },
  CATALOG_STALE: { label: 'ต้องตรวจแพ็กเกจใหม่', tone: 'amber', help: 'ราคา โควตา หรือภาษีของแพ็กเกจเปลี่ยนไปจากตอนเปิดแคมเปญ ระบบจึงหยุดรับสิทธิ์ใหม่ (ซื้อแพ็กเกจปกติได้) แก้เงื่อนไขแล้วตรวจตัวอย่างใหม่ก่อนเปิดอีกครั้ง' },
};
export const CAMPAIGN_STATUSES = Object.keys(CAMPAIGN_STATUS_META) as BillingPromotionCampaignStatus[];
export function campaignStatusMeta(status: string): { label: string; tone: CampaignTone; help: string } {
  return Object.hasOwn(CAMPAIGN_STATUS_META, status) ? CAMPAIGN_STATUS_META[status as BillingPromotionCampaignStatus] : { label: 'ต้องตรวจสอบสถานะ', tone: 'gray', help: '' };
}

/** TEST and LIVE must never look alike on a screen that can open a promotion (spec §4). */
export function campaignModeMarker(mode: BillingMode | 'DISABLED'): { label: string; hint: string; tone: CampaignTone } {
  if (mode === 'TEST') return { label: 'โหมดทดสอบ', hint: 'ไม่มีการรับเงินจริง', tone: 'amber' };
  if (mode === 'LIVE') return { label: 'ใช้งานจริง', hint: 'ลูกค้าจ่ายเงินจริง', tone: 'green' };
  return { label: 'ยังไม่เปิดการชำระเงิน', hint: '', tone: 'gray' };
}

export const countText = (value: number): string => value.toLocaleString('th-TH');
/** Satang in, baht out: whole baht without decimals, otherwise two decimals. Never derives a price. */
export function bahtText(satang: number): string {
  const decimals = satang % 100 === 0 ? 0 : 2;
  return `${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: 2 })} บาท`;
}

// ── what a campaign says (published terms or a draft) ──

type Terms = Partial<Pick<BillingPromotionCampaign, 'internalName' | 'displayName' | 'description' | 'startsAt' | 'endsAt' | 'cap'>>
  & { rules?: readonly { offerKey: string; interval: string; bonusMonths: number; bonusReceiptUnits: number }[] };
type TermsRule = NonNullable<Terms['rules']>[number];

export const ruleLabel = (rule: Pick<TermsRule, 'offerKey' | 'interval'>): string => billingOfferLabel(`${rule.offerKey}:${rule.interval}`);
const CYCLE_WORD: Record<string, string> = { month: 'รายเดือน', year: 'รายปี' };
/**
 * The packages and cycles of a campaign's rules, for a list row. One package is said once with its cycles ("เริ่มต้น (STARTER) · รายเดือนและรายปี");
 * rules of several packages, or a cycle this screen has no word for, keep one label per rule.
 */
export function rulesText(rules: readonly Pick<TermsRule, 'offerKey' | 'interval'>[]): string {
  const first = rules[0];
  if (!first || rules.length < 2 || rules.some(rule => rule.offerKey !== first.offerKey || !Object.hasOwn(CYCLE_WORD, rule.interval))) return rules.map(ruleLabel).join(' · ');
  return `${billingPlanLabel(first.offerKey)} · ${[...new Set(rules.map(rule => CYCLE_WORD[rule.interval]!))].join('และ')}`;
}
export const ruleBenefit = (rule: Pick<TermsRule, 'bonusMonths' | 'bonusReceiptUnits'>): string => `แถม ${rule.bonusMonths} เดือน + ใบเสร็จ ${rule.bonusReceiptUnits} ใบ`;

const NOT_SET = 'ยังไม่ได้กรอก';
export function campaignWindowText(startsAt: string | null | undefined, endsAt: string | null | undefined): string {
  if (!startsAt && !endsAt) return 'ยังไม่ได้ตั้งเวลา';
  return `${startsAt ? formatThaiDateTime(startsAt) : NOT_SET} ถึง ${endsAt ? formatThaiDateTime(endsAt) : NOT_SET}`;
}
export function capText(cap: number | null | undefined): string {
  return cap === undefined ? 'ยังไม่ได้เลือก' : cap === null ? 'ไม่จำกัด' : `${countText(cap)} สิทธิ์`;
}
/** One row per fact for a `dl`; a rule is its own row (offer → what it gives). */
export function termsFacts(terms: Terms | null | undefined): { label: string; value: string }[] {
  const t = terms ?? {};
  return [
    { label: 'ชื่อภายใน', value: t.internalName || NOT_SET },
    { label: 'ชื่อที่ลูกค้าเห็น', value: t.displayName || NOT_SET },
    { label: 'คำอธิบาย', value: t.description || '—' },
    ...(t.rules?.length ? t.rules.map(rule => ({ label: ruleLabel(rule), value: ruleBenefit(rule) })) : [{ label: 'แพ็กเกจและรอบ', value: 'ยังไม่ได้เลือก' }]),
    { label: 'เริ่ม', value: t.startsAt ? formatThaiDateTime(t.startsAt) : NOT_SET },
    { label: 'สิ้นสุด', value: t.endsAt ? formatThaiDateTime(t.endsAt) : NOT_SET },
    { label: 'จำนวนสิทธิ์สูงสุด', value: capText(t.cap) },
  ];
}
/** The terms a list row shows: what is live, else what is being drafted. */
export const campaignTerms = (view: Pick<BillingPromotionCampaignView, 'published' | 'draft'>): Terms | null => view.published ?? view.draft?.values ?? null;
export const campaignTitle = (view: Pick<BillingPromotionCampaignView, 'published' | 'draft'>): string => campaignTerms(view)?.internalName || 'แคมเปญที่ยังไม่ได้ตั้งชื่อ';

const PUBLISHED_TERMS_COPY: Partial<Record<BillingPromotionCampaignStatus, { title: string; note: string }>> = {
  ACTIVE: { title: 'เงื่อนไขที่ใช้อยู่', note: 'ลูกค้าเห็นและใช้สิทธิ์ตามเงื่อนไขนี้' },
  SCHEDULED: { title: 'เงื่อนไขที่ตั้งเวลาไว้', note: 'ยังไม่ถึงเวลาเริ่ม ลูกค้ายังใช้สิทธิ์ตามเงื่อนไขนี้ไม่ได้' },
  PAUSED: { title: 'เงื่อนไขที่พักไว้', note: 'ตอนนี้ลูกค้าใช้สิทธิ์ใหม่ตามเงื่อนไขนี้ไม่ได้ รายการที่จองสิทธิ์ไว้แล้วยังได้รับตามเดิม' },
  ENDED: { title: 'เงื่อนไขของแคมเปญที่จบแล้ว', note: 'ปิดรับสิทธิ์แล้ว เก็บไว้ให้ดูเป็นประวัติ' },
  CATALOG_STALE: { title: 'เงื่อนไขที่เผยแพร่ไว้', note: 'ระบบหยุดรับสิทธิ์ใหม่ เพราะราคา โควตา หรือภาษีของแพ็กเกจเปลี่ยนไปจากตอนเปิดแคมเปญ' },
};
/** The published terms are "in use" only while the campaign is active; a scheduled, paused, ended or stale one is worded for what it is. */
export function publishedTermsCopy(status: string): { title: string; note: string } {
  const copy = Object.hasOwn(PUBLISHED_TERMS_COPY, status) ? PUBLISHED_TERMS_COPY[status as BillingPromotionCampaignStatus] : undefined;
  return { title: copy?.title ?? 'เงื่อนไขที่เผยแพร่แล้ว', note: `${copy ? `${copy.note} ` : ''}เวลาแสดงเป็นเวลาประเทศไทย` };
}
/** "used / cap": taken = reserved + consumed, a refund never lowers it. Unpublished has no live cap. */
export function campaignUsageText(view: Pick<BillingPromotionCampaignView, 'published' | 'usage'>): string {
  if (!view.published) return 'ยังไม่เปิดให้ใช้สิทธิ์';
  return `${countText(view.usage.taken)} / ${view.published.cap === null ? 'ไม่จำกัด' : countText(view.published.cap)}`;
}

// ── list filters ──

export type CampaignFilters = { search: string; status: '' | BillingPromotionCampaignStatus; offer: string };
export const NO_CAMPAIGN_FILTERS: CampaignFilters = { search: '', status: '', offer: '' };
const offersOf = (view: BillingPromotionCampaignView) => [...(view.published?.rules ?? []), ...(view.draft?.values.rules ?? [])].map(rule => `${rule.offerKey}:${rule.interval}`);
export function filterCampaigns(campaigns: readonly BillingPromotionCampaignView[], filters: CampaignFilters): BillingPromotionCampaignView[] {
  const query = filters.search.trim().toLowerCase();
  return campaigns.filter(view => {
    const names = [view.published?.internalName, view.published?.displayName, view.draft?.values.internalName, view.draft?.values.displayName].filter(Boolean).join('\n').toLowerCase();
    return (!query || names.includes(query)) && (!filters.status || view.status === filters.status) && (!filters.offer || offersOf(view).includes(filters.offer));
  });
}
export function campaignOfferOptions(campaigns: readonly BillingPromotionCampaignView[]): { value: string; label: string }[] {
  return [...new Set(campaigns.flatMap(offersOf))].sort().map(value => ({ value, label: billingOfferLabel(value) }));
}

// ── the form: what the Admin types ↔ what the API takes ──

export type CampaignFormValues = {
  internalName: string; description: string; displayName: string;
  /** The template's cycles that are ticked. */
  intervals: BillingInterval[];
  /** `YYYY-MM-DDTHH:mm` in Thai time, as BillingDateTimeField edits it. */
  startsAt: string; endsAt: string;
  /** '' = not chosen yet; the unlimited choice is explicit (spec §4). */
  capChoice: '' | 'UNLIMITED' | 'LIMITED'; cap: string;
  reason: string;
};

/** A new campaign starts from the template: every cycle ticked, nothing else decided. */
export function emptyCampaignForm(template: BillingPromotionTemplate = BILLING_PROMOTION_STARTER_TEMPLATE): CampaignFormValues {
  return { internalName: '', description: '', displayName: '', intervals: template.rules.map(rule => rule.interval), startsAt: '', endsAt: '', capChoice: '', cap: '', reason: '' };
}
/** A saved draft or the published terms (editing a live campaign starts from them). */
export function campaignFormFromTerms(terms: Terms | null | undefined, template: BillingPromotionTemplate = BILLING_PROMOTION_STARTER_TEMPLATE): CampaignFormValues {
  if (!terms) return emptyCampaignForm(template);
  return {
    internalName: terms.internalName ?? '', description: terms.description ?? '', displayName: terms.displayName ?? '',
    intervals: (terms.rules ?? []).map(rule => rule.interval as BillingInterval),
    startsAt: terms.startsAt ? billingLocalTime(terms.startsAt) : '', endsAt: terms.endsAt ? billingLocalTime(terms.endsAt) : '',
    capChoice: terms.cap === undefined ? '' : terms.cap === null ? 'UNLIMITED' : 'LIMITED', cap: typeof terms.cap === 'number' ? String(terms.cap) : '',
    reason: '',
  };
}

const capNumber = (raw: string): number | null => {
  const text = raw.trim().replace(/,/g, '');
  const value = /^\d{1,10}$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(value) && value >= 1 && value <= CAP_MAX ? value : null;
};
const blankTime = (value: string) => value.replace('T', '').trim() === '';

export type CampaignFormProblems = Partial<Record<'startsAt' | 'endsAt' | 'cap' | 'reason', string>>;
/**
 * Only what cannot be sent at all: half a date, a cap that is not a whole number, and the reason the audit trail needs.
 * An incomplete draft is allowed (spec §4 "บันทึกร่าง"); what is missing comes back from the server as validationErrors.
 */
export function campaignFormProblems(form: CampaignFormValues): CampaignFormProblems {
  const problems: CampaignFormProblems = {};
  for (const field of ['startsAt', 'endsAt'] as const) {
    if (!blankTime(form[field]) && !billingTimeIso(form[field])) problems[field] = 'กรอกวันที่และเวลาให้ครบและถูกต้อง เช่น 09:00 (เวลาประเทศไทย)';
  }
  if (form.capChoice === 'LIMITED' && form.cap.trim() && capNumber(form.cap) === null) problems.cap = `กรอกจำนวนสิทธิ์สูงสุดเป็นจำนวนเต็มตั้งแต่ 1 ไม่เกิน ${countText(CAP_MAX)}`;
  if (!form.reason.trim()) problems.reason = 'กรอกเหตุผลที่บันทึกครั้งนี้ ระบบเก็บไว้ในประวัติการเปลี่ยนแปลง';
  return problems;
}

/**
 * The draft request. A field the Admin has not decided is left out so the server lists it as missing (REQUIRED), never as
 * invalid; an empty description is null; `type` is always sent. Rules come from the template, never from free text.
 */
export function campaignDraftInput(form: CampaignFormValues, ids: { campaignId?: string; draftVersion?: number },
  template: BillingPromotionTemplate = BILLING_PROMOTION_STARTER_TEMPLATE): BillingPromotionDraftInput {
  const values: BillingPromotionDraftInput['values'] = { type: 'BONUS_MONTHS', description: form.description.trim() || null };
  if (form.internalName.trim()) values.internalName = form.internalName.trim();
  if (form.displayName.trim()) values.displayName = form.displayName.trim();
  const rules = template.rules.filter(rule => form.intervals.includes(rule.interval))
    .map(rule => ({ offerKey: template.offerKey, interval: rule.interval, bonusMonths: rule.bonusMonths, bonusReceiptUnits: rule.bonusReceiptUnits }));
  if (rules.length) values.rules = rules;
  const startsAt = billingTimeIso(form.startsAt), endsAt = billingTimeIso(form.endsAt);
  if (startsAt) values.startsAt = startsAt;
  if (endsAt) values.endsAt = endsAt;
  if (form.capChoice === 'UNLIMITED') values.cap = null;
  else if (form.capChoice === 'LIMITED' && capNumber(form.cap) !== null) values.cap = capNumber(form.cap);
  return { ...(ids.campaignId ? { campaignId: ids.campaignId } : {}), ...(ids.draftVersion !== undefined ? { draftVersion: ids.draftVersion } : {}), values, reason: form.reason.trim() };
}

/** What a template cycle gives, read-only on the form (spec §4: no free-form formula). */
export function templateRuleSummary(rule: BillingPromotionTemplate['rules'][number]): { label: string; months: string; receipts: string } {
  const paid = rule.interval === 'year' ? 12 : 1;
  return {
    label: billingOfferLabel(`${BILLING_PROMOTION_STARTER_TEMPLATE.offerKey}:${rule.interval}`),
    months: `ซื้อ ${paid} เดือน แถม ${rule.bonusMonths} เดือน = ${paid + rule.bonusMonths} เดือน`,
    receipts: `ใบเสร็จ ${rule.baseReceiptUnits} + ${rule.bonusReceiptUnits} = ${rule.baseReceiptUnits + rule.bonusReceiptUnits} ใบ`,
  };
}

// ── what the server says is missing from a draft ──

type DraftText = { REQUIRED: string; INVALID: string; END_NOT_AFTER_START?: string };
const { internalName: NAME_MAX, description: DESCRIPTION_MAX, displayName: DISPLAY_MAX } = CAMPAIGN_TEXT_LIMITS;
const DRAFT_TEXT: Record<BillingPromotionDraftField, DraftText> = {
  type: { REQUIRED: 'ยังไม่ได้เลือกประเภทแคมเปญ', INVALID: 'ประเภทแคมเปญนี้ยังไม่รองรับ ใช้ "ซื้อแพ็กเกจแถมเดือน"' },
  internalName: { REQUIRED: 'ยังไม่ได้กรอกชื่อภายใน', INVALID: `ชื่อภายในต้องไม่เกิน ${NAME_MAX} ตัวอักษรและห้ามมีเครื่องหมาย < >` },
  description: { REQUIRED: 'ยังไม่ได้กรอกคำอธิบาย', INVALID: `คำอธิบายต้องไม่เกิน ${DESCRIPTION_MAX} ตัวอักษรและห้ามมีเครื่องหมาย < >` },
  displayName: { REQUIRED: 'ยังไม่ได้กรอกชื่อที่ลูกค้าเห็น', INVALID: `ชื่อที่ลูกค้าเห็นต้องไม่เกิน ${DISPLAY_MAX} ตัวอักษรและห้ามมีเครื่องหมาย < >` },
  rules: { REQUIRED: 'ยังไม่ได้เลือกแพ็กเกจและรอบ เลือกอย่างน้อยหนึ่งรอบ', INVALID: 'แพ็กเกจและรอบที่เลือกไม่ตรงกับแบบตั้งต้น ตรวจแล้วเลือกใหม่' },
  startsAt: { REQUIRED: 'ยังไม่ได้ตั้งเวลาเริ่ม', INVALID: 'เวลาเริ่มไม่ถูกต้อง เลือกวันและเวลาใหม่' },
  endsAt: { REQUIRED: 'ยังไม่ได้ตั้งเวลาสิ้นสุด', INVALID: 'เวลาสิ้นสุดไม่ถูกต้อง เลือกวันและเวลาใหม่', END_NOT_AFTER_START: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม' },
  cap: { REQUIRED: 'ยังไม่ได้เลือกจำนวนสิทธิ์สูงสุด กรอกจำนวน หรือเลือก "ไม่จำกัด"', INVALID: 'จำนวนสิทธิ์สูงสุดต้องเป็นจำนวนเต็มตั้งแต่ 1' },
};
export function draftErrorText(error: Pick<BillingPromotionDraftError, 'field' | 'code'>): string {
  const entry = Object.hasOwn(DRAFT_TEXT, error.field) ? DRAFT_TEXT[error.field] : undefined;
  return entry ? entry[error.code] ?? entry.INVALID : 'ตรวจข้อมูลของแคมเปญอีกครั้ง';
}
export function draftErrorsByField(errors: readonly BillingPromotionDraftError[]): Partial<Record<BillingPromotionDraftField, string>> {
  const byField: Partial<Record<BillingPromotionDraftField, string>> = {};
  for (const error of errors) byField[error.field] ??= draftErrorText(error);
  return byField;
}

// ── what a failed request says ──

const SIGNED_OUT = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
const FORBIDDEN = 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ หรือสิทธิ์เพิ่งถูกเปลี่ยน โหลดหน้านี้ใหม่เพื่อดูสิทธิ์ล่าสุด';
const UNCONFIRMED = 'ยังยืนยันผลไม่ได้ โหลดข้อมูลล่าสุดเพื่อตรวจ หรือกดทำรายการเดิมอีกครั้ง ระบบจะไม่ทำซ้ำให้';
/** Specific Thai sentences for the codes the campaign API raises; the shared dictionary is not touched by this screen. */
export const CAMPAIGN_ERROR_TEXT: Record<string, string> = {
  CONTROL_PREVIEW_STALE: 'ข้อมูลเปลี่ยนไประหว่างที่เปิดหน้านี้ หรือคำขอหมดอายุ ระบบโหลดข้อมูลล่าสุดให้แล้ว กรุณาตรวจสอบอีกครั้งก่อนดำเนินการต่อ',
  CONTROL_REAUTH_REQUIRED: 'ยืนยันรหัสผ่านก่อน แล้วกดดำเนินการรายการเดิมอีกครั้ง',
  // Two causes share this code: the campaign's own fields, and a catalog that no longer matches the template (which editing the campaign cannot fix).
  CONTROL_PROMOTION_INVALID: `ข้อมูลแคมเปญไม่ตรงกับแบบตั้งต้น ตรวจชื่อ ช่วงเวลา และรอบที่เลือก อีกสาเหตุคือแพ็กเกจเริ่มต้นไม่ตรงกับแบบตั้งต้น ซึ่งใช้ได้เฉพาะเมื่อราคารายเดือน ${bahtText(BILLING_PROMOTION_STARTER_TEMPLATE.monthlyPriceSatang)} และใบเสร็จ ${
    BILLING_PROMOTION_STARTER_TEMPLATE.rules.map(rule => `${rule.baseReceiptUnits} ใบต่อ${rule.interval === 'year' ? 'ปี' : 'เดือน'}`).join(' ')} เรื่องนี้แก้ที่แคมเปญไม่ได้ เมื่อแก้ครบแล้วให้ตรวจสอบก่อนเปิดอีกครั้ง`,
  CONTROL_PROMOTION_NOT_FOUND: 'ไม่พบแคมเปญนี้ อาจถูกยกเลิกร่างไปแล้ว กลับไปรายการแคมเปญเพื่อดูข้อมูลล่าสุด',
  CONTROL_PROMOTION_ENDED: 'แคมเปญนี้จบแล้ว แก้ไข พัก หรือเปิดใหม่ไม่ได้ ถ้าจะจัดรอบใหม่ให้สร้างแคมเปญใหม่',
  CONTROL_PROMOTION_OVERLAP: 'มีแคมเปญอื่นของแพ็กเกจและรอบเดียวกันในช่วงเวลานี้อยู่แล้ว เลื่อนช่วงเวลาหรือจบแคมเปญเดิมก่อน',
  CONTROL_PROMOTION_CAP_BELOW_USED: 'จำนวนสิทธิ์สูงสุดต่ำกว่าจำนวนที่ร้านจองและใช้ไปแล้ว ตั้งให้ไม่น้อยกว่านั้น หรือเลือก "ไม่จำกัด"',
  CONTROL_PROMOTION_CATALOG_STALE: 'ราคา โควตา หรือภาษีของแพ็กเกจเปลี่ยนไปแล้ว ตรวจสอบตัวอย่างใหม่ก่อนเปิดแคมเปญ',
};
/** Saving a draft must never look like the promotion is live (spec §4). */
export const CAMPAIGN_SAVED_NOTICE = 'บันทึกร่างแล้ว ยังไม่เปิดแคมเปญให้ลูกค้า เมื่อพร้อมให้ตรวจสอบก่อนเปิดและยืนยันตามขั้นตอนด้านล่าง';
/** The draft was saved by someone else meanwhile: the form now shows the latest and asks for a new review. */
export const DRAFT_STALE_TEXT = 'ร่างนี้ถูกแก้ไขจากที่อื่นระหว่างที่คุณกำลังแก้ ระบบโหลดร่างล่าสุดมาแสดงในฟอร์มแล้ว กรุณาตรวจค่าที่แสดงอีกครั้งแล้วบันทึกใหม่';
/** A preview blocker is one of those codes; an unknown one still reads as Thai. */
export const blockerText = (code: string): string => (Object.hasOwn(CAMPAIGN_ERROR_TEXT, code) ? CAMPAIGN_ERROR_TEXT[code]! : 'ตรวจเงื่อนไขของรอบนี้ก่อนเปิดแคมเปญ');

export type CampaignErrorKind = 'stale' | 'reauth' | 'not-found' | 'forbidden' | 'signed-out' | 'unconfirmed' | 'other';
const statusOf = (cause: unknown): number | undefined => {
  const status = (cause as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
};
/**
 * `kind` tells the screen what to do (reload, ask for the password, drop the buttons); `text` is what the Admin reads.
 * A code that is not ours falls back to the shared dictionary, which never shows a raw diagnostic.
 */
export function campaignError(cause: unknown): { kind: CampaignErrorKind; text: string } {
  const code = apiErrorCode(cause), status = statusOf(cause);
  const own = code && Object.hasOwn(CAMPAIGN_ERROR_TEXT, code) ? CAMPAIGN_ERROR_TEXT[code] : undefined;
  const kind: CampaignErrorKind = code === 'CONTROL_PREVIEW_STALE' ? 'stale' : code === 'CONTROL_REAUTH_REQUIRED' ? 'reauth'
    : code === 'CONTROL_PROMOTION_NOT_FOUND' || status === 404 ? 'not-found' : status === 401 ? 'signed-out'
      : status === 403 && code !== 'CONTROL_REAUTH_FAILED' ? 'forbidden' : status === undefined || status >= 500 ? 'unconfirmed' : 'other';
  if (own) return { kind, text: own };
  if (code) return { kind, text: apiErrorMessage(cause) };
  return { kind, text: kind === 'signed-out' ? SIGNED_OUT : kind === 'forbidden' ? FORBIDDEN : kind === 'unconfirmed' ? UNCONFIRMED : apiErrorMessage(cause) };
}
export type CampaignLoadFailure = { kind: 'forbidden' | 'not-found' | 'failed'; text: string };
/** A read that failed: the screen shows this instead of the data, with a retry only for `failed`. */
export function campaignLoadFailure(cause: unknown): CampaignLoadFailure {
  const { kind } = campaignError(cause);
  if (kind === 'forbidden') return { kind, text: 'บัญชีนี้ไม่มีสิทธิ์ดูแคมเปญโปรโมชั่น ต้องมีสิทธิ์ดูข้อมูลการชำระเงินระดับระบบ' };
  if (kind === 'not-found') return { kind, text: CAMPAIGN_ERROR_TEXT.CONTROL_PROMOTION_NOT_FOUND! };
  return { kind: 'failed', text: kind === 'signed-out' ? SIGNED_OUT : 'โหลดข้อมูลแคมเปญไม่ได้ กรุณาลองใหม่' };
}

/** A command retried after a lost response keeps its key; any change of payload is a new command. */
export type CampaignIntent = { key: string; signature: string };
export function reuseIntent(previous: CampaignIntent | null, signature: string, makeKey: () => string): CampaignIntent {
  return previous && previous.signature === signature ? previous : { key: makeKey(), signature };
}

// ── which buttons ──

export type CampaignButtons = Record<'edit' | 'discard' | 'preview' | 'resume' | 'pause' | 'end', boolean>;
/** Every campaign-level button exists only when the server listed its action for this caller now. */
export function campaignButtons(allowed: readonly BillingPromotionCampaignAction[]): CampaignButtons {
  const has = (action: BillingPromotionCampaignAction) => allowed.includes(action);
  return { edit: has('EDIT'), discard: has('DISCARD_DRAFT'), preview: has('PREVIEW'), resume: has('RESUME'), pause: has('PAUSE'), end: has('END') };
}
export type CampaignOperationStep = 'submit' | 'approve' | 'cancel';
export const CAMPAIGN_OPERATION_STEPS: readonly CampaignOperationStep[] = ['submit', 'approve', 'cancel'];
export const CAMPAIGN_OPERATION_STEP_TEXT: Record<CampaignOperationStep, string> = { submit: 'ส่งคำขอ', approve: 'อนุมัติและเปิดใช้', cancel: 'ยกเลิกคำขอ' };
/** The open publication's own allowedActions drive the workflow buttons, in a fixed order. A request that can no longer go on offers only "ยกเลิกคำขอ". */
export function operationSteps(operation: Pick<BillingConfigurationOperation, 'allowedActions'> | null, usable = true): CampaignOperationStep[] {
  return operation ? CAMPAIGN_OPERATION_STEPS.filter(step => operation.allowedActions.includes(step) && (usable || step === 'cancel')) : [];
}

// ── an open publication request ──

const OPEN_REQUEST_STATES: readonly string[] = ['PREVIEW', 'AWAITING_APPROVAL'];
/** Waiting on someone: the draft behind it is frozen (spec §4 "รออนุมัติ … ห้ามแก้ข้อมูลขณะรอ"), or the later approval would be refused as stale. */
export const isRequestOpen = (operation: Pick<BillingConfigurationOperation, 'state'> | null | undefined): boolean => !!operation && OPEN_REQUEST_STATES.includes(operation.state);
/** One version of one request, so an answer about it is never read for a later version. */
export const requestKey = (operation: Pick<BillingConfigurationOperation, 'id' | 'version'>): string => `${operation.id}:${operation.version}`;
export type CampaignRequest = { open: boolean; usable: boolean; note: string | null };
/**
 * Whether the open request can still be submitted or approved. The server refuses both (CONTROL_PREVIEW_STALE) once the request expired, once
 * the billing settings moved on since it was previewed, or — `refused` — when it already answered stale for this very version of the request;
 * and it leaves the request as it was, so without this the admin is offered the same button again and again. `note` is the one sentence that
 * leads out: cancel the request, then check before opening again.
 */
export function campaignRequest(operation: Pick<BillingConfigurationOperation, 'id' | 'state' | 'version' | 'expiresAt' | 'sourceVersion' | 'allowedActions'> | null | undefined,
  input: { settingsVersion: number; refused: string | null; now?: number }): CampaignRequest {
  if (!operation || !isRequestOpen(operation)) return { open: false, usable: false, note: null };
  const redo = `${operation.allowedActions.includes('cancel') ? 'ยกเลิกคำขอนี้' : 'ให้ผู้ส่งคำขอยกเลิกคำขอนี้'}แล้วตรวจสอบก่อนเปิดอีกครั้ง`;
  if (Date.parse(operation.expiresAt) <= (input.now ?? Date.now())) return { open: true, usable: false, note: `คำขอนี้หมดอายุเมื่อ ${formatThaiDateTime(operation.expiresAt)} ${redo}` };
  if (operation.sourceVersion !== input.settingsVersion || input.refused === requestKey(operation))
    return { open: true, usable: false, note: `คำขอนี้ใช้ต่อไม่ได้แล้ว เพราะข้อมูลเปลี่ยนไปหลังตรวจสอบก่อนเปิด ${redo}` };
  return { open: true, usable: true, note: null };
}
/** Where "แก้ร่าง" and "ยกเลิกร่าง" were, while a request is open: one sentence, and what to do first. */
export const draftLockedText = (canCancel: boolean): string =>
  `มีคำขอเปิดแคมเปญค้างอยู่ จึงแก้หรือยกเลิกร่างไม่ได้ ต้อง${canCancel ? '' : 'ให้ผู้ส่งคำขอ'}กด “${CAMPAIGN_OPERATION_STEP_TEXT.cancel}” ก่อน`;

export const DETAIL_NEEDS = 'การแก้ไข เปิด พัก และจบแคมเปญ';
export const LIST_NEEDS = 'การสร้างแคมเปญ';
/**
 * Why an account sees no edit buttons. A reviewer who may approve the open request is told so, not that the account can only look.
 * `needs` is what the manage permission is needed for on that screen.
 */
export function permissionNote(input: { canManage: boolean; canApprove: boolean; needs: string }): string | null {
  if (input.canManage) return null;
  const need = `${input.needs}ต้องมีสิทธิ์ “${billingPermissionLabel(CAMPAIGN_MANAGE_PERMISSION)}”`;
  return input.canApprove ? `บัญชีนี้อนุมัติคำขอเปิดแคมเปญที่ส่งมาแล้วได้ แต่${need}` : `บัญชีนี้ดูแคมเปญได้อย่างเดียว ${need}`;
}
const OPERATION_STATE_TEXT: Record<string, string> = {
  PREVIEW: 'ตรวจตัวอย่างแล้ว ส่งคำขอเพื่อให้ผู้อนุมัติยืนยัน',
  AWAITING_APPROVAL: 'ส่งคำขอแล้ว รอยืนยันเปิดใช้',
  SUCCEEDED: 'ดำเนินการแล้ว แคมเปญมีผลตามเวลาที่ตั้งไว้',
  CANCELLED: 'ยกเลิกคำขอแล้ว ยังไม่มีการเปลี่ยนแปลงกับแคมเปญ',
};
export const operationStateText = (state: string): string => (Object.hasOwn(OPERATION_STATE_TEXT, state) ? OPERATION_STATE_TEXT[state]! : billingLabel('operation', state));
/** Why the preview/resume buttons cannot be pressed yet, in Thai; null = pressable. */
export function previewBlockedText(draftErrors: readonly BillingPromotionDraftError[] | undefined, rows: readonly BillingPromotionPreviewRow[]): string | null {
  if (draftErrors?.length) return 'ร่างยังไม่ครบ เติมข้อมูลที่ยังขาดก่อนตรวจสอบก่อนเปิด';
  if (rows.some(row => row.blockers.length)) return 'ตัวอย่างพบเรื่องที่ต้องแก้ก่อนเปิด ตามรายการด้านบน';
  return null;
}
/**
 * "กลับมาเปิด" reopens the published terms and ignores the draft (the server builds it from them): a draft's gaps never block it, and while a
 * draft exists the rows on screen are the draft's, not the terms being reopened, so they cannot block it either.
 */
export const resumeBlockedText = (hasDraft: boolean, rows: readonly BillingPromotionPreviewRow[]): string | null => (hasDraft ? null : previewBlockedText(undefined, rows));

// ── pause / end ──

export function pendingCheckoutsText(count: number): string {
  return count > 0 ? `มีรายการชำระค้าง ${countText(count)} รายการที่จะยังได้รับสิทธิ์ตามเดิม` : 'ไม่มีรายการชำระค้างที่ต้องดูแลเป็นพิเศษ';
}
export const CAMPAIGN_CLOSE_COPY = {
  pause: { open: 'พักแคมเปญ', title: 'พักแคมเปญนี้', confirm: 'ยืนยันพักแคมเปญ', done: 'พักแคมเปญแล้ว',
    effect: 'ร้านที่ยังไม่ได้จองสิทธิ์จะใช้สิทธิ์ไม่ได้ทันที แต่ซื้อแพ็กเกจปกติได้ตามเดิม กลับมาเปิดได้ภายในช่วงเวลาเดิม และจำนวนที่ใช้ไปแล้วไม่ถูกล้าง', final: null },
  end: { open: 'จบแคมเปญ', title: 'จบแคมเปญนี้', confirm: 'ยืนยันจบแคมเปญ', done: 'จบแคมเปญแล้ว',
    effect: 'ร้านที่ยังไม่ได้จองสิทธิ์จะใช้สิทธิ์ไม่ได้ทันที ประวัติและรายงานยังเปิดดูได้', final: 'จบแล้วกลับมาเปิดด้วยแคมเปญนี้ไม่ได้ ถ้าจะจัดรอบใหม่ต้องสร้างแคมเปญใหม่' },
} as const;

// ── the preview table ──

export function previewRowView(row: BillingPromotionPreviewRow) {
  return {
    title: billingOfferLabel(`${row.offerKey}:${row.interval}`),
    price: bahtText(row.totalSatang),
    priceNote: row.taxSatang > 0 ? `รวมภาษี ${bahtText(row.taxSatang)}` : null,
    time: `จ่าย ${row.paidMonths} เดือน + แถม ${row.bonusMonths} เดือน = ${row.totalMonths} เดือน`,
    receipts: `ใบเสร็จ ${row.baseReceiptUnits} + ${row.bonusReceiptUnits} = ${row.totalReceiptUnits} ใบ`,
    dates: `ถ้าจ่ายวันที่ ${formatThaiDateTime(row.exampleStartsAt)} จ่ายถึง ${formatThaiDateTime(row.paidEnd)} และแถมถึง ${formatThaiDateTime(row.benefitEnd)}`,
    next: `${bahtText(row.renewalTotalSatang)} เมื่อครบ ${formatThaiDateTime(row.benefitEnd)} (เฉพาะแบบต่ออายุอัตโนมัติ)`,
    blockers: row.blockers.map(blockerText),
  };
}

// ── the usage report ──

export function reportCountItems(counts: BillingPromotionCampaignReport['counts']): { label: string; value: string }[] {
  return [
    { label: 'สิทธิ์ที่ใช้แล้ว (รวมที่คืนเงิน)', value: countText(counts.paidAwaitingApply + counts.applied) },
    { label: 'สิทธิ์ที่ยังใช้งานอยู่', value: countText(counts.rightsActive) },
    { label: 'กำลังชำระ (จองสิทธิ์ไว้)', value: countText(counts.reserved) },
    { label: 'ชำระแล้ว รอเปิดสิทธิ์', value: countText(counts.paidAwaitingApply) },
    { label: 'เปิดสิทธิ์แล้ว', value: countText(counts.applied) },
    { label: 'ยกเลิกก่อนชำระ', value: countText(counts.releasedBeforePay) },
    { label: 'มีการคืนเงิน', value: countText(counts.refunded) },
    { label: 'คืนเงินเต็มจำนวน', value: countText(counts.fullyRefunded) },
  ];
}
/** null = the caller has no financial permission: say so instead of showing 0. */
export function reportMoneyView(report: Pick<BillingPromotionCampaignReport, 'moneyReceivedSatang' | 'refundedSatang'>): { received: string; refunded: string } | null {
  if (report.moneyReceivedSatang === null || report.refundedSatang === null) return null;
  return { received: bahtText(report.moneyReceivedSatang), refunded: bahtText(report.refundedSatang) };
}
export const REPORT_FREE_MONTHS_NOTE = 'เดือนฟรีไม่นับเป็นรายได้ เงินที่รับจริงคือยอดที่ร้านจ่ายตามราคาปกติของรอบที่ซื้อเท่านั้น และการคืนเงินไม่ทำให้จำนวนสิทธิ์ที่ใช้แล้วลดลง';
const REPORT_STATE_META: Record<BillingPromotionReportCompany['state'], { text: string; tone: CampaignTone }> = {
  RESERVED: { text: 'กำลังชำระ (จองสิทธิ์ไว้)', tone: 'amber' }, CONSUMED: { text: 'ใช้สิทธิ์แล้ว', tone: 'green' }, RELEASED: { text: 'ยกเลิกก่อนชำระ คืนสิทธิ์แล้ว', tone: 'gray' },
};
const REPORT_REFUND_TEXT: Record<BillingPromotionReportCompany['refund'], string | null> = { NONE: null, PARTIAL: 'คืนเงินบางส่วน เวลาและใบเสร็จคงเดิม', FULL: 'คืนเงินเต็มจำนวน' };
const REPORT_ADJUSTMENT_TEXT: Record<BillingPromotionReportCompany['entitlementAdjustmentState'], string | null> = {
  NOT_REQUIRED: null, PENDING: 'รอยุติสิทธิ์ที่ยังไม่ใช้', REVIEW: 'รอเจ้าหน้าที่ตรวจ', ADJUSTED: 'ยุติสิทธิ์ที่ยังไม่ใช้แล้ว',
};
/** A link from the API is followed only when it stays inside the Admin console. */
export function safeAdminHref(href: string | null | undefined): string | null {
  return typeof href === 'string' && /^\/system\/[A-Za-z0-9\-._~%/?=&#:]*$/.test(href) ? href : null;
}
export function reportRowView(row: BillingPromotionReportCompany) {
  const facts: { label: string; value: string }[] = [
    { label: 'แพ็กเกจและรอบ', value: billingOfferLabel(`${row.offerKey}:${row.interval}`) },
    { label: 'ขอใช้สิทธิ์เมื่อ', value: formatThaiDateTime(row.acceptedAt) },
    ...(row.consumedAt ? [{ label: 'ชำระเงินเมื่อ', value: formatThaiDateTime(row.consumedAt) }] : []),
    ...(row.benefitAppliedAt ? [{ label: 'เปิดสิทธิ์เมื่อ', value: formatThaiDateTime(row.benefitAppliedAt) }] : []),
    ...(row.releasedAt ? [{ label: 'ยกเลิกเมื่อ', value: formatThaiDateTime(row.releasedAt) }] : []),
    ...(row.paidEnd ? [{ label: 'ช่วงที่จ่ายสิ้นสุด', value: formatThaiDateTime(row.paidEnd) }] : []),
    ...(row.benefitEnd ? [{ label: 'ใช้ได้ถึง (รวมเดือนฟรี)', value: formatThaiDateTime(row.benefitEnd) }] : []),
  ];
  const notes = [REPORT_REFUND_TEXT[row.refund], REPORT_ADJUSTMENT_TEXT[row.entitlementAdjustmentState]].filter((note): note is string => Boolean(note));
  const state = REPORT_STATE_META[row.state];
  return { title: row.companyName, stateLabel: state.text, tone: state.tone, facts, notes, attemptHref: safeAdminHref(row.attemptHref), invoiceHref: safeAdminHref(row.invoiceHref) };
}
