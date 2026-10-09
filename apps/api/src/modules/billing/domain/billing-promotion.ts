import { BadRequestException, ConflictException } from '@nestjs/common';
import { BILLING_PAID_TIERS, BILLING_PROMOTION_STARTER_TEMPLATE, type BillingInterval, type BillingOffer, type BillingPolicy, type BillingPromotionCampaign,
  type BillingPromotionCampaignDraft, type BillingPromotionDraftError, type BillingPromotionDraftField, type BillingPromotionRule,
  type BillingPromotionUnavailableReason, type BillingPurchaseMode } from '@watchdog-bms/contracts';
import { assertKeys, billingError, configurationHash } from './billing-policy';

/**
 * Promotion campaigns, pure rules only (docs/plans/starter-249-bonus-month-promotion-plan.md §5; spec
 * docs/specs/starter-249-bonus-month-promotion-spec-th.md §4–§6). Campaign terms live in
 * `BillingPolicyRevision.promotionJson` as `Record<campaignId, BillingPromotionCampaign>` (plan R1).
 */
type Tax = BillingPolicy['taxTreatment'];
type SignedOffer = Pick<BillingOffer, 'offerKey' | 'interval' | 'intervalCount' | 'currency' | 'priceSatang' | 'receiptAllowance'>;
export type PromotionCampaigns = Record<string, BillingPromotionCampaign>;

const invalid = () => new BadRequestException({ code: 'CONTROL_PROMOTION_INVALID', message: 'ข้อมูลแคมเปญไม่ถูกต้อง' });
const TEXT: Record<BillingPromotionUnavailableReason, string> = {
  NOT_STARTED: 'โปรโมชั่นนี้ยังไม่เริ่ม', ENDED: 'โปรโมชั่นนี้สิ้นสุดแล้ว', PAUSED: 'โปรโมชั่นนี้พักรับสิทธิ์ชั่วคราว', CAP_FULL: 'สิทธิ์โปรโมชั่นนี้เต็มแล้ว',
  ALREADY_USED: 'ร้านนี้ใช้สิทธิ์โปรโมชั่นนี้แล้ว', IN_PROGRESS: 'ร้านนี้มีรายการชำระเงินที่ใช้สิทธิ์โปรโมชั่นนี้ค้างอยู่',
  CATALOG_STALE: 'เงื่อนไขแพ็กเกจเปลี่ยน โปรโมชั่นนี้จึงยังใช้ไม่ได้', OFFER_NOT_COVERED: 'แพ็กเกจนี้ไม่อยู่ในโปรโมชั่น',
  PURCHASE_KIND_UNSUPPORTED: 'รายการซื้อแบบนี้ยังใช้สิทธิ์โปรโมชั่นไม่ได้', CHANGED: 'เงื่อนไขโปรโมชั่นเปลี่ยน กรุณาตรวจสอบรายการใหม่',
};
/** `PROMOTION_UNAVAILABLE` with its `reason` in the body. NORMAL stays purchasable; the buyer re-quotes, never a silent fallback. */
export const promotionUnavailable = (reason: BillingPromotionUnavailableReason): ConflictException =>
  new ConflictException({ code: 'PROMOTION_UNAVAILABLE', reason, message: TEXT[reason] });

/** What a quote for this offer depends on (spec §4): tier, cadence, currency, price, tax treatment, base receipts. The label does not. */
export function promotionOfferSignature(offer: SignedOffer, tax: Tax): string {
  return configurationHash([1, offer.offerKey, offer.interval, offer.intervalCount ?? 1, offer.currency, offer.priceSatang, tax, offer.receiptAllowance]);
}
export const promotionOfferKey = (rule: { offerKey: string; interval: string }) => `${rule.offerKey}:${rule.interval}`;
/** `offerKey:interval` → the current catalog signature, for `promotionCampaignStatus`. */
export function promotionSignatures(offers: readonly SignedOffer[], tax: Tax): Record<string, string> {
  return Object.fromEntries(offers.map(offer => [promotionOfferKey(offer), promotionOfferSignature(offer, tax)]));
}

const text = (max: number) => (value: unknown) => typeof value === 'string' && !!value.trim() && value.length <= max && !/[<>]/.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const whole = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const rules = (signed: boolean) => (value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > BILLING_PAID_TIERS.length * 2) return false;
  const keys = ['offerKey', 'interval', 'bonusMonths', 'bonusReceiptUnits', ...(signed ? ['offerSignature'] : [])];
  return new Set(value.map(rule => rule && typeof rule === 'object' ? promotionOfferKey(rule) : '')).size === value.length && value.every(rule =>
    rule && typeof rule === 'object' && !Array.isArray(rule) && Object.keys(rule).length === keys.length && keys.every(key => key in rule) &&
    BILLING_PAID_TIERS.includes(rule.offerKey) && ['month', 'year'].includes(rule.interval) && whole(rule.bonusMonths, 1, 12) &&
    whole(rule.bonusReceiptUnits, 1, 100_000) && (!signed || /^[0-9a-f]{64}$/.test(rule.offerSignature)));
};
/** One validator per editable field, shared by the strict publication parse and the draft's "what is missing" list. */
const FIELD: Record<BillingPromotionDraftField, (value: unknown) => boolean> = {
  type: value => value === 'BONUS_MONTHS', internalName: text(120), description: value => value === null || text(500)(value), displayName: text(80),
  rules: rules(false), startsAt: instant, endsAt: instant, cap: value => value === null || whole(value, 1, 2_147_483_647),
};
const DRAFT_FIELDS = Object.keys(FIELD) as BillingPromotionDraftField[];
const CAMPAIGN_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/** Strict: the publication path. Null/absent = no campaign. Anything malformed throws `CONTROL_PROMOTION_INVALID`. */
export function parsePromotionCampaigns(json: unknown): PromotionCampaigns {
  if (json == null) return {};
  if (typeof json !== 'object' || Array.isArray(json)) throw invalid();
  for (const [id, value] of Object.entries(json)) {
    const c = value as BillingPromotionCampaign;
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).length !== DRAFT_FIELDS.length + 4 || c.campaignId !== id || !CAMPAIGN_ID.test(id) ||
        DRAFT_FIELDS.some(field => field !== 'rules' && !FIELD[field](c[field])) || !rules(true)(c.rules) || !whole(c.revision, 1, 2_147_483_647) ||
        typeof c.paused !== 'boolean' || !(c.endedAt === null || instant(c.endedAt)) || c.endsAt <= c.startsAt) throw invalid();
  }
  return json as PromotionCampaigns;
}
/** Readers (plan R1): a parse failure means no campaign is admissible; sales stay open. */
export function parsePromotionCampaignsLenient(json: unknown): PromotionCampaigns {
  try { return parsePromotionCampaigns(json); } catch (error) { if (error instanceof BadRequestException) return {}; throw error; }
}

/**
 * A draft may be incomplete (spec §4 "บันทึกร่าง"): unknown keys and a bad `campaignId` are refused, every other problem
 * is listed. A field that fails its rule is kept only when it is text the Admin typed, so the form can show it back.
 */
export function parsePromotionDraft(input: unknown): { values: BillingPromotionCampaignDraft; validationErrors: BillingPromotionDraftError[] } {
  assertKeys(input, ['campaignId', ...DRAFT_FIELDS]);
  if (typeof input.campaignId !== 'string' || !CAMPAIGN_ID.test(input.campaignId)) throw invalid();
  const values: Record<string, unknown> = { campaignId: input.campaignId }, validationErrors: BillingPromotionDraftError[] = [];
  for (const field of DRAFT_FIELDS) {
    const value = input[field];
    if (value === undefined) { if (field !== 'description') validationErrors.push({ field, code: 'REQUIRED' }); continue; }
    const ok = FIELD[field](value);
    if (!ok) validationErrors.push({ field, code: 'INVALID' });
    if (ok || typeof value === 'string') values[field] = typeof value === 'string' ? value.slice(0, 500) : value;
  }
  if (instant(input.startsAt) && instant(input.endsAt) && input.endsAt <= input.startsAt) validationErrors.push({ field: 'endsAt', code: 'END_NOT_AFTER_START' });
  return { values: values as BillingPromotionCampaignDraft, validationErrors };
}

/** Everything a buyer accepted: all terms and the revision. Pausing or ending does not change it, so a reservation survives both. */
export function promotionTermsHash(campaign: BillingPromotionCampaign): string {
  const { paused: _paused, endedAt: _endedAt, ...terms } = campaign;
  return configurationHash(terms);
}
const ended = (campaign: BillingPromotionCampaign, now: Date) => campaign.endedAt !== null || now.toISOString() >= campaign.endsAt;

/** Spec §4: one rule whose pinned offer differs from the current one makes the whole campaign stale — shown and refused alike. */
const stale = (campaign: BillingPromotionCampaign, currentSignatures: Readonly<Record<string, string>>) =>
  campaign.rules.some(rule => currentSignatures[promotionOfferKey(rule)] !== rule.offerSignature);

/** Status by the clock (`startsAt <= now < endsAt`). CATALOG_STALE: a rule's pinned offer differs from the current one. */
export function promotionCampaignStatus(campaign: BillingPromotionCampaign, now: Date, currentSignatures: Readonly<Record<string, string>>):
  'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'CATALOG_STALE' {
  if (ended(campaign, now)) return 'ENDED';
  if (campaign.paused) return 'PAUSED';
  if (stale(campaign, currentSignatures)) return 'CATALOG_STALE';
  return now.toISOString() < campaign.startsAt ? 'SCHEDULED' : 'ACTIVE';
}

/**
 * May this offer be reserved under this campaign at `now`? The one admission rule behind the quote, the status view and
 * the reservation; the caller adds once-per-company and the cap. `currentSignatures` (`promotionSignatures`) must hold
 * every offer the campaign covers: any stale rule stops admission for the whole campaign, as the console shows it.
 */
export function promotionAdmission(campaign: BillingPromotionCampaign, offer: Pick<SignedOffer, 'offerKey' | 'interval'>,
  currentSignatures: Readonly<Record<string, string>>, now: Date):
  { rule: BillingPromotionRule } | { reason: BillingPromotionUnavailableReason } {
  if (ended(campaign, now)) return { reason: 'ENDED' };
  if (campaign.paused) return { reason: 'PAUSED' };
  if (now.toISOString() < campaign.startsAt) return { reason: 'NOT_STARTED' };
  const rule = campaign.rules.find(item => promotionOfferKey(item) === promotionOfferKey(offer));
  if (!rule) return { reason: 'OFFER_NOT_COVERED' };
  return stale(campaign, currentSignatures) ? { reason: 'CATALOG_STALE' } : { rule };
}

/**
 * Publication guard (spec §4, §6): `before` = the ACTIVE revision's campaigns, `after` = the proposed ones, `takenByCampaign`
 * = RESERVED + CONSUMED read in the final transaction under the fence. A change that opens admission (new campaign, changed
 * terms, resume) must fit the release-1 template against the CURRENT catalog; pausing and ending never need it.
 */
export function assertPromotionPublication(before: PromotionCampaigns, after: PromotionCampaigns, offers: readonly BillingOffer[], tax: Tax,
  takenByCampaign: Readonly<Record<string, number>>, now: Date): void {
  parsePromotionCampaigns(after);
  const template = BILLING_PROMOTION_STARTER_TEMPLATE, offer = (interval: BillingInterval) => offers.find(item => item.offerKey === template.offerKey && item.interval === interval);
  for (const id of Object.keys(before)) if (!after[id]) throw invalid(); // a published campaign is ended, never removed
  for (const next of Object.values(after)) {
    const prev = before[next.campaignId];
    if (prev && ended(prev, now)) {
      if (configurationHash(prev) !== configurationHash(next)) throw billingError('CONTROL_PROMOTION_ENDED', 'แคมเปญนี้จบแล้ว แก้ไขหรือเปิดใหม่ไม่ได้');
      continue;
    }
    const termsChanged = !!prev && promotionTermsHash({ ...next, revision: prev.revision }) !== promotionTermsHash(prev);
    if (next.revision !== (prev ? prev.revision + (termsChanged ? 1 : 0) : 1)) throw invalid();
    if (next.cap !== null && next.cap < (takenByCampaign[next.campaignId] ?? 0))
      throw billingError('CONTROL_PROMOTION_CAP_BELOW_USED', 'เพดานสิทธิ์ต่ำกว่าจำนวนที่จองและใช้ไปแล้วไม่ได้');
    if (prev && !termsChanged && !(prev.paused && !next.paused)) continue;
    if (ended(next, now)) throw invalid();
    for (const rule of next.rules) {
      const current = rule.offerKey === template.offerKey ? offer(rule.interval) : undefined, expected = template.rules.find(item => item.interval === rule.interval)!;
      if (!current || rule.bonusMonths !== expected.bonusMonths || rule.bonusReceiptUnits !== expected.bonusReceiptUnits) throw invalid();
      if (rule.offerSignature !== promotionOfferSignature(current, tax))
        throw billingError('CONTROL_PROMOTION_CATALOG_STALE', 'ราคาหรือโควตาแพ็กเกจเปลี่ยนแล้ว กรุณาตรวจสอบตัวอย่างใหม่');
      // The promise is 60/390 receipts at 249 baht a month: a 50/600 or re-priced catalog cannot carry this template (F01).
      if (current.receiptAllowance !== expected.baseReceiptUnits || offer('month')?.priceSatang !== template.monthlyPriceSatang) throw invalid();
    }
  }
  const open = Object.values(after).filter(campaign => !ended(campaign, now));
  for (const [index, a] of open.entries()) for (const b of open.slice(index + 1))
    if (a.startsAt < b.endsAt && b.startsAt < a.endsAt && a.rules.some(rule => b.rules.some(other => promotionOfferKey(other) === promotionOfferKey(rule))))
      throw billingError('CONTROL_PROMOTION_OVERLAP', 'มีแคมเปญอื่นของแพ็กเกจและรอบเดียวกันในช่วงเวลานี้แล้ว');
}

/**
 * Release-1 support matrix (plan §2): a first purchase or a restart in any mode; a repeat on an active one-time package
 * paid once. Everything else keeps NORMAL purchasable and refuses the promotion with a reason.
 */
export function promotionUnsupportedPurchase(input: { purchaseKind: string | undefined; purchaseMode: BillingPurchaseMode | undefined;
  hasLiveSubscription: boolean; deal: boolean; upgrade: boolean; scheduledChange: boolean }): 'PURCHASE_KIND_UNSUPPORTED' | null {
  const oneTime = input.purchaseMode === 'CARD_ONCE' || input.purchaseMode === 'PROMPTPAY_ONCE';
  const supported = !!input.purchaseMode && !input.deal && !input.upgrade && !input.scheduledChange &&
    (['INITIAL', 'RESTART'].includes(input.purchaseKind ?? '') || (input.purchaseKind === 'REPEAT' && oneTime && !input.hasLiveSubscription));
  return supported ? null : 'PURCHASE_KIND_UNSUPPORTED';
}
