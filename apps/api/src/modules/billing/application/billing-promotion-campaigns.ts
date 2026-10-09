import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BILLING_PAID_TIERS, BILLING_PROMOTION_REVIEW_ISSUE, BILLING_PROMOTION_STARTER_TEMPLATE, billingOffer, type BillingInterval, type BillingOffer, type BillingPolicy, type BillingPromotionCampaign,
  type BillingPromotionCampaignAction, type BillingPromotionCampaignDraft, type BillingPromotionCampaignReport, type BillingPromotionCampaignView,
  type BillingPromotionEntitlementAdjustmentState, type BillingPromotionPreviewRow, type PaidTier } from '@watchdog-bms/contracts';
import { Prisma, type BillingOperation } from '../../../generated/prisma/client';
import { billingError, configurationHash, effectiveBillingGates, quoteTotals } from '../domain/billing-policy';
import { promotionBoundaries } from '../domain/billing-package';
import { assertPromotionPublication, parsePromotionCampaigns, parsePromotionDraft, promotionCampaignStatus, promotionOfferKey, promotionOfferSignature, promotionSignatures,
  promotionTermsHash, type PromotionCampaigns } from '../domain/billing-promotion';
import { promotionEnvironment, promotionUsage } from './billing-promotion';
import type { BillingService } from './billing.service';

/**
 * Admin campaign console, everything that is about campaigns only (docs/plans/starter-249-bonus-month-promotion-plan.md §6, lane C;
 * spec docs/specs/starter-249-bonus-month-promotion-spec-th.md §4). BillingConfigurationService owns the transactions, the
 * permissions and the audit; this file builds the views, the publishable campaign, the preview rows and the report.
 */
type Tx = Prisma.TransactionClient;
type State = Awaited<ReturnType<BillingService['settings']>>;
type PreviewRule = { offerKey: PaidTier; interval: BillingInterval; bonusMonths: number; bonusReceiptUnits: number; offerSignature?: string };

/** A campaign draft is a BillingOperation of this type (`referenceId` = campaignId, plan R1). It never touches quotes, the catalog or usage. */
export const PROMOTION_DRAFT_TYPE = 'PROMOTION_CAMPAIGN_DRAFT';

export const campaignNotFound = () => new NotFoundException({ code: 'CONTROL_PROMOTION_NOT_FOUND', message: 'ไม่พบแคมเปญนี้' });
export const campaignEnded = () => billingError('CONTROL_PROMOTION_ENDED', 'แคมเปญนี้จบแล้ว แก้ไขหรือเปิดใหม่ไม่ได้');
export const campaignInvalid = (message: string, extra: Record<string, unknown> = {}) => new BadRequestException({ code: 'CONTROL_PROMOTION_INVALID', message, ...extra });
const stale = () => billingError('CONTROL_PREVIEW_STALE', 'ข้อมูลเปลี่ยนหรือรายการหมดอายุ กรุณาโหลดการตั้งค่าและตรวจสอบใหม่');

/** Finished by the clock or by an Admin: it is read-only history from here on (spec §4 "จบแล้ว"). */
export const isCampaignEnded = (campaign: BillingPromotionCampaign, now: Date) => campaign.endedAt !== null || now.toISOString() >= campaign.endsAt;
export const campaignOffers = (policy: BillingPolicy | null): BillingOffer[] => BILLING_PAID_TIERS.flatMap(tier => (['month', 'year'] as const).map(interval => billingOffer(tier, interval, policy)));
export const campaignSignatures = (policy: BillingPolicy) => promotionSignatures(campaignOffers(policy), policy.taxTreatment);
const scope = (state: State) => ({ stripeAccountId: state.settings.stripeAccountId, livemode: state.settings.livemode, companyId: null });

export const openCampaignDraft = (tx: Tx, state: State, campaignId: string) => tx.billingOperation.findFirst({
  where: { ...scope(state), type: PROMOTION_DRAFT_TYPE, referenceId: campaignId, state: 'DRAFT' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
/** What the form shows back: the saved values and what is still missing, recomputed so a rule change never leaves a stale list. */
export function promotionDraftView(row: BillingOperation): NonNullable<BillingPromotionCampaignView['draft']> {
  const { values, validationErrors } = parsePromotionDraft(row.proposedJson);
  return { operationId: row.id, version: row.version, values, validationErrors };
}
/** A draft of an already published campaign starts from its terms (the published revision stays visible beside it). */
export const publishedDraftValues = (campaign: BillingPromotionCampaign): Omit<BillingPromotionCampaignDraft, 'campaignId'> => ({ type: campaign.type, internalName: campaign.internalName,
  description: campaign.description, displayName: campaign.displayName, startsAt: campaign.startsAt, endsAt: campaign.endsAt, cap: campaign.cap,
  rules: campaign.rules.map(({ offerKey, interval, bonusMonths, bonusReceiptUnits }) => ({ offerKey, interval, bonusMonths, bonusReceiptUnits })) });

/** The raw campaigns column of the ACTIVE revision (plan R1): a publication that does not edit campaigns writes it back as it is. */
export async function activePromotionJson(tx: Tx, settings: State['settings']) {
  const row = settings.policyRevisionId ? await tx.billingPolicyRevision.findUnique({ where: { id: settings.policyRevisionId }, select: { promotionJson: true } }) : null;
  return row?.promotionJson ?? null;
}
export const promotionColumn = (value: unknown) => value == null ? Prisma.DbNull : value as Prisma.InputJsonValue;
/** The draft a publication came from is closed once it is live. */
export const closeCampaignDraft = (tx: Tx, draftId: string, publishedBy: string) => tx.billingOperation.updateMany({
  where: { id: draftId, type: PROMOTION_DRAFT_TYPE, state: 'DRAFT' }, data: { state: 'SUCCEEDED', observedAt: new Date(), version: { increment: 1 }, resultJson: { publishedBy } } });

async function takenBy(tx: Tx, state: State, ids: readonly string[]) {
  const env = promotionEnvironment(state.settings.livemode), taken: Record<string, number> = {};
  for (const id of ids) taken[id] = (await promotionUsage(tx, env, id)).taken;
  return taken;
}

export type CampaignRecord = { campaignId: string; createdAt: string; published: BillingPromotionCampaign | null; draft: BillingOperation | null; pending: BillingOperation | null;
  usage: { reserved: number; consumed: number; taken: number } };
/**
 * Every campaign of this mode: the published ones and the draft-only ones, newest first. A campaign is born with its first
 * draft, so that draft's time is its creation time. `pending` = its publication still in preview or awaiting approval.
 */
export async function readCampaigns(tx: Tx, state: State, now: Date, only?: string): Promise<CampaignRecord[]> {
  const drafts = { ...scope(state), type: PROMOTION_DRAFT_TYPE, ...(only ? { referenceId: only } : {}) };
  const open = await tx.billingOperation.findMany({ where: { ...drafts, state: 'DRAFT' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const born = await tx.billingOperation.groupBy({ by: ['referenceId'], where: drafts, _min: { createdAt: true } });
  // Submit and approve refuse a publication previewed on another settings version, so one is pending only while the settings are still those.
  const publications = await tx.billingOperation.findMany({ where: { ...scope(state), type: 'PUBLISH_POLICY', state: { in: ['PREVIEW', 'AWAITING_APPROVAL'] }, expiresAt: { gt: now },
    sourceVersion: state.settings.version }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const draftBy = new Map<string, BillingOperation>(), pendingBy = new Map<string, BillingOperation>(), createdBy = new Map(born.map(item => [item.referenceId, item._min.createdAt]));
  for (const row of open) if (row.referenceId && !draftBy.has(row.referenceId)) draftBy.set(row.referenceId, row);
  for (const row of publications) { const id = (row.proposedJson as { campaignId?: string }).campaignId; if (id && !pendingBy.has(id)) pendingBy.set(id, row); }
  const env = promotionEnvironment(state.settings.livemode), records: CampaignRecord[] = [];
  for (const id of new Set([...Object.keys(state.promotions), ...draftBy.keys()])) if (!only || id === only) records.push({ campaignId: id, published: state.promotions[id] ?? null,
    draft: draftBy.get(id) ?? null, pending: pendingBy.get(id) ?? null, createdAt: createdBy.get(id)?.toISOString() ?? state.promotions[id]?.startsAt ?? now.toISOString(),
    usage: await promotionUsage(tx, env, id) });
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.campaignId.localeCompare(b.campaignId));
}

const ORDER: BillingPromotionCampaignAction[] = ['EDIT', 'DISCARD_DRAFT', 'PREVIEW', 'SUBMIT', 'APPROVE', 'CANCEL', 'PAUSE', 'RESUME', 'END'];
const WORKFLOW = { submit: 'SUBMIT', approve: 'APPROVE', cancel: 'CANCEL' } as const;
/**
 * `manage` = the caller holds `system.billing.policy.manage`. SUBMIT/APPROVE/CANCEL are the publication workflow's own answer for
 * the caller (`workflow` = the pending operation's allowedActions), so a second reviewer who cannot manage still sees APPROVE.
 */
export function campaignView(record: CampaignRecord, input: { now: Date; signatures: Readonly<Record<string, string>>; manage: boolean;
  workflow: readonly ('submit' | 'approve' | 'cancel' | 'apply')[] }): BillingPromotionCampaignView {
  const { published, usage, pending } = record, ended = !!published && isCampaignEnded(published, input.now), draft = record.draft ? promotionDraftView(record.draft) : null;
  const allowed = new Set<BillingPromotionCampaignAction>();
  if (input.manage) {
    if (!ended) allowed.add('EDIT');
    if (draft) allowed.add('DISCARD_DRAFT');
    if (draft && !ended && !draft.validationErrors.length) allowed.add('PREVIEW');
    if (published && !ended) { allowed.add('END'); allowed.add(published.paused ? 'RESUME' : 'PAUSE'); }
  }
  for (const action of input.workflow) if (action !== 'apply') allowed.add(WORKFLOW[action]);
  return { campaignId: record.campaignId, published, draft, usage: { ...usage, cap: published?.cap ?? null }, pendingOperationId: pending?.id ?? null, pendingCheckouts: usage.reserved,
    status: published ? promotionCampaignStatus(published, input.now, input.signatures) : pending?.state === 'AWAITING_APPROVAL' ? 'AWAITING_APPROVAL' : 'DRAFT',
    allowedActions: ORDER.filter(action => allowed.has(action)) };
}

/**
 * One row per rule from the CURRENT catalog (spec §4 Preview). `blockers` are the stable codes the publication would be refused with;
 * a rule that carries a pinned `offerSignature` (published terms) is also checked against the catalog it was pinned to.
 */
export function previewRows(input: { rules: readonly PreviewRule[]; window: { startsAt?: string; endsAt?: string }; selfId: string; policy: BillingPolicy;
  published: PromotionCampaigns; now: Date }): BillingPromotionPreviewRow[] {
  const { policy, now } = input, template = BILLING_PROMOTION_STARTER_TEMPLATE, tax = policy.taxTreatment, monthlyPrice = billingOffer(template.offerKey, 'month', policy).priceSatang;
  const others = Object.values(input.published).filter(other => other.campaignId !== input.selfId && !isCampaignEnded(other, now));
  return input.rules.map(rule => {
    const offer = billingOffer(rule.offerKey, rule.interval, policy), totals = quoteTotals(offer.priceSatang, tax), signature = promotionOfferSignature(offer, tax);
    const expected = rule.offerKey === template.offerKey ? template.rules.find(item => item.interval === rule.interval) : undefined;
    const { paidEnd, benefitEnd } = promotionBoundaries({ serviceStartsAt: now, interval: rule.interval, bonusMonths: rule.bonusMonths });
    const { startsAt, endsAt } = input.window, blockers: string[] = [];
    if (!expected || rule.bonusMonths !== expected.bonusMonths || rule.bonusReceiptUnits !== expected.bonusReceiptUnits || offer.receiptAllowance !== expected.baseReceiptUnits ||
        monthlyPrice !== template.monthlyPriceSatang) blockers.push('CONTROL_PROMOTION_INVALID');
    if (rule.offerSignature !== undefined && rule.offerSignature !== signature) blockers.push('CONTROL_PROMOTION_CATALOG_STALE');
    if (startsAt && endsAt && others.some(other => other.startsAt < endsAt && startsAt < other.endsAt && other.rules.some(item => promotionOfferKey(item) === promotionOfferKey(rule))))
      blockers.push('CONTROL_PROMOTION_OVERLAP');
    const paidMonths = rule.interval === 'year' ? 12 : 1;
    return { offerKey: rule.offerKey, interval: rule.interval, offerSignature: signature, priceSatang: offer.priceSatang, subtotalSatang: totals.subtotalSatang,
      taxSatang: totals.taxSatang, totalSatang: totals.totalSatang, paidMonths, bonusMonths: rule.bonusMonths, totalMonths: paidMonths + rule.bonusMonths,
      baseReceiptUnits: offer.receiptAllowance, bonusReceiptUnits: rule.bonusReceiptUnits, totalReceiptUnits: offer.receiptAllowance + rule.bonusReceiptUnits,
      exampleStartsAt: now.toISOString(), paidEnd: paidEnd.toISOString(), benefitEnd: benefitEnd.toISOString(), renewalTotalSatang: totals.totalSatang, blockers };
  });
}

/** The publishable campaign, built on the server from the saved draft (never from client terms): offer signatures pinned, revision +1 when terms change. */
function buildCampaign(values: BillingPromotionCampaignDraft, prev: BillingPromotionCampaign | undefined, policy: BillingPolicy): BillingPromotionCampaign {
  const next: BillingPromotionCampaign = { campaignId: values.campaignId, type: 'BONUS_MONTHS', revision: prev?.revision ?? 1, internalName: values.internalName!,
    description: values.description ?? null, displayName: values.displayName!, startsAt: values.startsAt!, endsAt: values.endsAt!, cap: values.cap!,
    paused: prev?.paused ?? false, endedAt: prev?.endedAt ?? null,
    // Sorted, so moving a row in the form is not a change of terms (which would invalidate every open quote).
    rules: values.rules!.map(({ offerKey, interval, bonusMonths, bonusReceiptUnits }) => ({ offerKey, interval, bonusMonths, bonusReceiptUnits,
      offerSignature: promotionOfferSignature(billingOffer(offerKey, interval, policy), policy.taxTreatment) })).sort((a, b) => promotionOfferKey(a).localeCompare(promotionOfferKey(b))) };
  return prev && promotionTermsHash(next) !== promotionTermsHash(prev) ? { ...next, revision: prev.revision + 1 } : next;
}

/**
 * Preview time: PUBLISH builds the campaign from the open draft, RESUME reopens the published one; then the strict publication rules
 * run against the current catalog. The cap check here is advisory — the final transaction reads usage again under the fence.
 */
export async function campaignPublication(tx: Tx, state: State, campaignId: string, input: { action: 'PUBLISH' | 'RESUME'; draftVersion?: number }, now: Date) {
  const policy = state.policy!, before = parsePromotionCampaigns(state.revision!.promotionJson), prev: BillingPromotionCampaign | undefined = before[campaignId];
  let next: BillingPromotionCampaign, draft: BillingOperation | null = null;
  if (input.action === 'RESUME') {
    if (!prev) throw campaignNotFound();
    if (isCampaignEnded(prev, now)) throw campaignEnded();
    if (!prev.paused) throw campaignInvalid('แคมเปญนี้ไม่ได้พักอยู่');
    next = { ...prev, paused: false };
  } else {
    draft = await openCampaignDraft(tx, state, campaignId);
    if (!draft) throw prev ? stale() : campaignNotFound();
    if (draft.version !== input.draftVersion) throw stale();
    if (prev && isCampaignEnded(prev, now)) throw campaignEnded();
    const { values, validationErrors } = parsePromotionDraft(draft.proposedJson);
    if (validationErrors.length) throw campaignInvalid('ข้อมูลแคมเปญยังไม่ครบหรือไม่ถูกต้อง', { validationErrors });
    next = buildCampaign(values, prev, policy);
  }
  const after: PromotionCampaigns = { ...before, [campaignId]: next };
  assertPromotionPublication(before, after, campaignOffers(policy), policy.taxTreatment, await takenBy(tx, state, Object.keys(after)), now);
  return { after, draft, rows: previewRows({ rules: next.rules, window: next, selfId: campaignId, policy, published: before, now }) };
}

/**
 * Approve time, inside the transaction that took `lockPromotionFence` first and the BillingSettings lock after: nothing the preview
 * showed is trusted. The operation must still carry the CURRENT policy and gates, change only its own campaign, come from the draft
 * as it was previewed, and pass the publication rules with `taken` read now — a cap below reserved + consumed is refused here.
 */
export async function assertCampaignPublication(tx: Tx, state: State, operation: BillingOperation, proposed: { policy: BillingPolicy; gates: unknown;
  promotions: PromotionCampaigns; campaignId?: string; draftVersion?: number; effectiveAt?: string }, now: Date) {
  const policy = state.policy;
  // A campaign is "scheduled" by its own startsAt, never by a publication time (plan R5).
  if (proposed.effectiveAt) throw campaignInvalid('แคมเปญตั้งเวลาเริ่มด้วยวันเริ่มของแคมเปญเอง');
  if (!policy || !state.revision || configurationHash([proposed.policy, effectiveBillingGates(proposed.gates)]) !== configurationHash([policy, state.gates])) throw stale();
  const before = parsePromotionCampaigns(await activePromotionJson(tx, state.settings)), after = parsePromotionCampaigns(proposed.promotions);
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (id !== proposed.campaignId && configurationHash(before[id] ?? null) !== configurationHash(after[id] ?? null)) throw stale();
  if (proposed.draftVersion !== undefined && operation.referenceId && !await tx.billingOperation.findFirst({ select: { id: true },
    where: { id: operation.referenceId, type: PROMOTION_DRAFT_TYPE, state: 'DRAFT', version: proposed.draftVersion } })) throw stale();
  assertPromotionPublication(before, after, campaignOffers(policy), policy.taxTreatment, await takenBy(tx, state, Object.keys(after)), now);
}

type Totals = { total: number; reserved: number; paidAwaitingApply: number; applied: number; releasedBeforePay: number; refunded: number; fullyRefunded: number; rightsActive: number;
  bonusMonthsGranted: number; bonusReceiptUnitsGranted: number; moneyReceivedSatang: number; refundedSatang: number };
const refundOf = (invoice?: { paidSatang: number; refundedSatang: number }): 'NONE' | 'PARTIAL' | 'FULL' =>
  !invoice || invoice.refundedSatang <= 0 ? 'NONE' : invoice.paidSatang > 0 && invoice.refundedSatang >= invoice.paidSatang ? 'FULL' : 'PARTIAL';

/**
 * The report of one campaign in this mode (spec §4 "รายงาน"). Counts and sums come from one statement over the redemptions left-joined to
 * their paid invoice; money is the invoices' real money and is withheld without the financial permission. Free months are never money.
 */
export async function promotionReport(tx: Tx, input: { state: State; campaignId: string; cursor?: string; financial: boolean; now: Date }): Promise<BillingPromotionCampaignReport> {
  const { state, campaignId } = input, env = promotionEnvironment(state.settings.livemode), where = { promotionEnvironmentId: env, campaignId };
  const [totals] = await tx.$queryRaw<Totals[]>`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE r.state = 'RESERVED')::int AS reserved,
      count(*) FILTER (WHERE r.state = 'CONSUMED' AND r."benefitAppliedAt" IS NULL)::int AS "paidAwaitingApply",
      count(*) FILTER (WHERE r."benefitAppliedAt" IS NOT NULL)::int AS applied,
      COALESCE(sum(r."releaseCount"), 0)::int AS "releasedBeforePay",
      count(*) FILTER (WHERE r.state = 'CONSUMED' AND i."refundedSatang" > 0)::int AS refunded,
      count(*) FILTER (WHERE r.state = 'CONSUMED' AND i."paidSatang" > 0 AND i."refundedSatang" >= i."paidSatang")::int AS "fullyRefunded",
      count(*) FILTER (WHERE r."benefitAppliedAt" IS NOT NULL AND r."bonusEnd" > (now() AT TIME ZONE 'UTC')
        AND NOT COALESCE(i."paidSatang" > 0 AND i."refundedSatang" >= i."paidSatang", false))::int AS "rightsActive",
      COALESCE(sum(r."bonusMonths") FILTER (WHERE r."benefitAppliedAt" IS NOT NULL), 0)::int AS "bonusMonthsGranted",
      COALESCE(sum(r."bonusReceiptUnits") FILTER (WHERE r."benefitAppliedAt" IS NOT NULL), 0)::int AS "bonusReceiptUnitsGranted",
      COALESCE(sum(i."paidSatang") FILTER (WHERE r.state = 'CONSUMED'), 0)::float8 AS "moneyReceivedSatang",
      COALESCE(sum(i."refundedSatang") FILTER (WHERE r.state = 'CONSUMED'), 0)::float8 AS "refundedSatang"
    FROM "BillingPromotionRedemption" r LEFT JOIN "BillingInvoice" i ON i.id = r."invoiceId"
    WHERE r."promotionEnvironmentId" = ${env} AND r."campaignId" = ${campaignId}`;
  if (!totals!.total && !state.promotions[campaignId] && !await tx.billingOperation.count({ where: { ...scope(state), type: PROMOTION_DRAFT_TYPE, referenceId: campaignId } })) throw campaignNotFound();
  const anchor = input.cursor ? await tx.billingPromotionRedemption.findFirst({ where: { ...where, id: input.cursor } }) : null;
  if (input.cursor && !anchor) throw campaignNotFound();
  // Paged on createdAt: a re-reservation rewrites acceptedAt, which would move a row between two pages.
  const rows = await tx.billingPromotionRedemption.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26,
    where: { ...where, ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) } });
  const page = rows.slice(0, 25), invoiceIds = page.flatMap(row => row.invoiceId ? [row.invoiceId] : []);
  const invoices = new Map((invoiceIds.length ? await tx.billingInvoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, paidSatang: true, refundedSatang: true } }) : []).map(row => [row.id, row]));
  const names = new Map((await tx.company.findMany({ where: { id: { in: page.map(row => row.companyId) } }, select: { id: true, name: true } })).map(row => [row.id, row.name]));
  // The refund's terminal step opens this on the bill when it could not end the entitlement itself; staff close it once they have adjusted it.
  const reviewed = new Set((invoiceIds.length ? await tx.billingIssue.findMany({ where: { livemode: state.settings.livemode, kind: BILLING_PROMOTION_REVIEW_ISSUE,
    referenceId: { in: invoiceIds }, state: { not: 'RESOLVED' } }, select: { referenceId: true } }) : []).map(issue => issue.referenceId));
  return { campaignId, mode: state.settings.livemode ? 'LIVE' : 'TEST', generatedAt: input.now.toISOString(), bonusMonthsGranted: totals!.bonusMonthsGranted,
    bonusReceiptUnitsGranted: totals!.bonusReceiptUnitsGranted, moneyReceivedSatang: input.financial ? totals!.moneyReceivedSatang : null,
    refundedSatang: input.financial ? totals!.refundedSatang : null,
    counts: { reserved: totals!.reserved, paidAwaitingApply: totals!.paidAwaitingApply, applied: totals!.applied, releasedBeforePay: totals!.releasedBeforePay,
      refunded: totals!.refunded, fullyRefunded: totals!.fullyRefunded, rightsActive: totals!.rightsActive },
    companies: page.map(row => {
      const refund = refundOf(row.invoiceId ? invoices.get(row.invoiceId) : undefined);
      const adjustment: BillingPromotionEntitlementAdjustmentState = refund !== 'FULL' ? 'NOT_REQUIRED' : row.entitlementAdjustedAt ? 'ADJUSTED'
        : reviewed.has(row.invoiceId!) ? 'REVIEW' : 'PENDING';
      return { companyId: row.companyId, companyName: names.get(row.companyId) ?? row.companyId, state: row.state as 'RESERVED' | 'CONSUMED' | 'RELEASED',
        offerKey: row.offerKey as PaidTier, interval: row.interval as BillingInterval, acceptedAt: row.acceptedAt.toISOString(), consumedAt: row.consumedAt?.toISOString() ?? null,
        benefitAppliedAt: row.benefitAppliedAt?.toISOString() ?? null, releasedAt: row.releasedAt?.toISOString() ?? null, paidEnd: row.paidEnd?.toISOString() ?? null,
        benefitEnd: row.bonusEnd?.toISOString() ?? null, refund, entitlementAdjustmentState: adjustment,
        attemptHref: row.attemptId ? `/system/billing/companies/${row.companyId}/checkouts/${row.attemptId}` : null,
        invoiceHref: row.invoiceId ? `/system/billing/companies/${row.companyId}/invoices/${row.invoiceId}` : null };
    }),
    nextCursor: rows.length > 25 ? page[24]!.id : null };
}
