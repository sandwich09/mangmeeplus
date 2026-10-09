import { billingOffer, type BillingOffer, type BillingPolicy, type BillingPromotionCampaign, type BillingPromotionEnvironment, type BillingPromotionOfferView,
  type BillingPromotionSnapshot, type BillingPromotionUnavailableReason } from '@watchdog-bms/contracts';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { parseBillingPolicy } from '../domain/billing-policy';
import { parsePromotionCampaignsLenient, promotionAdmission, promotionOfferKey, promotionSignatures, promotionTermsHash, type PromotionCampaigns } from '../domain/billing-promotion';

/**
 * Promotion campaigns, database side (docs/plans/starter-249-bonus-month-promotion-plan.md §5, R4; spec §6). One
 * `BillingPromotionRedemption` row per company per campaign per environment. `taken` only rises in `reservePromotion`,
 * so only it (and an admission-changing publication) takes the fence — always as the FIRST lock of its transaction.
 * Consume and release are row-guarded writes under the caller's existing Company lock, like the event ticket.
 */
type Tx = Prisma.TransactionClient;
type Tax = BillingPolicy['taxTreatment'];
type Reason = BillingPromotionUnavailableReason;
/** What `BillingService.settings()` returns, as far as promotions read it. */
export type PromotionSettings = { settings: { livemode: boolean }; policy: BillingPolicy | null; promotions: PromotionCampaigns };
/** The current signature of every offer a campaign covers (spec §4: one stale rule stops the whole campaign); the offer
 *  being bought counts as the caller priced it. */
const currentSignatures = (campaign: BillingPromotionCampaign, policy: BillingPolicy | null, tax: Tax, offer?: BillingOffer) =>
  promotionSignatures([...campaign.rules.map(rule => billingOffer(rule.offerKey, rule.interval, policy)), ...(offer ? [offer] : [])], tax);
const TAKEN = ['RESERVED', 'CONSUMED'];
/** Spec Q3: the first Checkout dispatch must start within 10 minutes of the reservation commit. */
const CREATE_BY_MS = 10 * 60_000;

export const promotionEnvironment = (livemode: boolean): BillingPromotionEnvironment => livemode ? 'LIVE' : 'TEST';

/** The one fence of an environment's cap and publications (spec §6). MUST be the first lock of its transaction. */
export async function lockPromotionFence(tx: Tx, env: BillingPromotionEnvironment): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing-promotion-policy:${env}`}))`;
}

/** RESERVED + CONSUMED across every provider binding of the environment; a refund or a HELD apply never lowers it. */
export async function promotionUsage(tx: Tx, env: BillingPromotionEnvironment, campaignId: string): Promise<{ reserved: number; consumed: number; taken: number }> {
  const rows = await tx.billingPromotionRedemption.groupBy({ by: ['state'], where: { promotionEnvironmentId: env, campaignId, state: { in: TAKEN } }, _count: { _all: true } });
  const count = (state: string) => rows.find(row => row.state === state)?._count._all ?? 0;
  const reserved = count('RESERVED'), consumed = count('CONSUMED');
  return { reserved, consumed, taken: reserved + consumed };
}

const redemption = (tx: Tx, env: BillingPromotionEnvironment, campaignId: string, companyId: string) => tx.billingPromotionRedemption.findUnique({
  where: { promotionEnvironmentId_campaignId_companyId: { promotionEnvironmentId: env, campaignId, companyId } } });

/** Once per company per campaign, then the cap. `row` = the company's RELEASED row a reservation reuses, if any. */
async function companyAdmission(tx: Tx, env: BillingPromotionEnvironment, campaign: BillingPromotionCampaign, companyId: string) {
  const row = await redemption(tx, env, campaign.campaignId, companyId);
  const reason: Reason | null = row?.state === 'CONSUMED' ? 'ALREADY_USED' : row?.state === 'RESERVED' ? 'IN_PROGRESS'
    : campaign.cap !== null && (await promotionUsage(tx, env, campaign.campaignId)).taken >= campaign.cap ? 'CAP_FULL' : null;
  return { row, reason };
}

/**
 * The package page's view (spec §3): every rule of a campaign inside its window, with whether this company may take it
 * and why not. No lock: the reservation is the final check. A campaign not started or already ended is not advertised.
 */
export async function promotionOffers(tx: Tx, input: { settings: PromotionSettings; companyId: string; offers: readonly BillingOffer[];
  tax: Tax; now: Date }): Promise<BillingPromotionOfferView[]> {
  const env = promotionEnvironment(input.settings.settings.livemode), views: BillingPromotionOfferView[] = [];
  for (const campaign of Object.values(input.settings.promotions)) {
    const at = input.now.toISOString();
    if (campaign.endedAt !== null || at >= campaign.endsAt || at < campaign.startsAt) continue;
    const company = await companyAdmission(tx, env, campaign, input.companyId);
    for (const rule of campaign.rules) {
      const offer = input.offers.find(item => promotionOfferKey(item) === promotionOfferKey(rule));
      if (!offer) continue;
      const admission = promotionAdmission(campaign, offer, currentSignatures(campaign, input.settings.policy, input.tax, offer), input.now), reason = 'reason' in admission ? admission.reason : company.reason;
      views.push({ campaignId: campaign.campaignId, displayName: campaign.displayName, offerKey: rule.offerKey, interval: rule.interval,
        bonusMonths: rule.bonusMonths, bonusReceiptUnits: rule.bonusReceiptUnits, totalMonths: (rule.interval === 'year' ? 12 : 1) + rule.bonusMonths,
        totalReceiptUnits: offer.receiptAllowance + rule.bonusReceiptUnits, endsAt: campaign.endsAt, available: !reason, reason });
    }
  }
  return views;
}

/**
 * Quote (spec §6 QUOTE): may this company take a promotion on this offer now? Uses nothing and takes no lock. With no
 * `campaignId` it is the campaign open for this offer (publication forbids two at once). The snapshot is what the
 * buyer accepts; `reservePromotion` re-checks it under the fence.
 */
export async function promotionEligibility(tx: Tx, input: { settings: PromotionSettings; companyId: string; campaignId?: string; offer: BillingOffer;
  tax: Tax; now: Date }): Promise<{ ok: true; snapshot: BillingPromotionSnapshot } | { ok: false; reason: Reason }> {
  const env = promotionEnvironment(input.settings.settings.livemode), reasons: Reason[] = [];
  const campaigns = Object.values(input.settings.promotions).filter(campaign => input.campaignId ? campaign.campaignId === input.campaignId
    : campaign.rules.some(rule => promotionOfferKey(rule) === promotionOfferKey(input.offer)));
  if (input.campaignId && !campaigns.length) return { ok: false, reason: 'CHANGED' };
  for (const campaign of campaigns) {
    const admission = promotionAdmission(campaign, input.offer, currentSignatures(campaign, input.settings.policy, input.tax, input.offer), input.now);
    const reason = 'reason' in admission ? admission.reason : (await companyAdmission(tx, env, campaign, input.companyId)).reason;
    if ('reason' in admission || reason) { reasons.push(reason!); continue; }
    const { rule } = admission;
    return { ok: true, snapshot: { environmentId: env, campaignId: campaign.campaignId, revision: campaign.revision, termsHash: promotionTermsHash(campaign),
      displayName: campaign.displayName, offerKey: rule.offerKey, interval: rule.interval, offerSignature: rule.offerSignature,
      bonusMonths: rule.bonusMonths, bonusReceiptUnits: rule.bonusReceiptUnits } };
  }
  // The campaign in its window explains itself; otherwise an upcoming one, then a finished one.
  return { ok: false, reason: reasons.find(reason => reason !== 'ENDED' && reason !== 'NOT_STARTED') ?? reasons.find(reason => reason === 'NOT_STARTED') ?? reasons[0] ?? 'OFFER_NOT_COVERED' };
}

/**
 * Checkout (spec §6 RESERVED), right after the attempt row and `activeAttemptId`, in the same transaction. The caller
 * took `lockPromotionFence` as its first lock. Everything is read again here, on the database clock and from the ACTIVE
 * revision — never from the caller's settings: the window, pause/end, the pinned revision, terms and offer signature,
 * once per company, the cap. `true` = RESERVED and counted; a reason = nothing written (the caller aborts with
 * `PROMOTION_UNAVAILABLE`). `now` is accepted for call-site symmetry and ignored.
 */
export async function reservePromotion(tx: Tx, input: { snapshot: BillingPromotionSnapshot; stripeAccountId: string; livemode: boolean; billingAccountId: string;
  companyId: string; attemptId: string; policyRevisionId: string; now?: Date }): Promise<true | Reason> {
  const { snapshot } = input, env = promotionEnvironment(input.livemode);
  if (snapshot.environmentId !== env) return 'CHANGED';
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const now = clock!.now;
  const settings = await tx.billingSettings.findUnique({ where: { stripeAccountId_livemode: { stripeAccountId: input.stripeAccountId, livemode: input.livemode } } });
  const revision = settings?.policyRevisionId ? await tx.billingPolicyRevision.findUnique({ where: { id: settings.policyRevisionId } }) : null;
  if (!revision || revision.state !== 'ACTIVE' || revision.stripeAccountId !== input.stripeAccountId || revision.livemode !== input.livemode) return 'CHANGED';
  let policy: BillingPolicy;
  try { policy = parseBillingPolicy(revision.policyJson); } catch (error) { if (error instanceof BadRequestException) return 'CHANGED'; throw error; }
  const campaign = parsePromotionCampaignsLenient(revision.promotionJson)[snapshot.campaignId];
  if (!campaign) return 'CHANGED';
  const admission = promotionAdmission(campaign, snapshot, currentSignatures(campaign, policy, policy.taxTreatment), now);
  if ('reason' in admission) return admission.reason;
  if (campaign.revision !== snapshot.revision || promotionTermsHash(campaign) !== snapshot.termsHash || admission.rule.offerSignature !== snapshot.offerSignature) return 'CHANGED';
  const { row, reason } = await companyAdmission(tx, env, campaign, input.companyId);
  if (reason) return row?.state === 'RESERVED' && row.attemptId === input.attemptId ? true : reason; // a replay of this attempt
  const data = { billingAccountId: input.billingAccountId, stripeAccountId: input.stripeAccountId, livemode: input.livemode, state: 'RESERVED',
    policyRevisionId: input.policyRevisionId, campaignRevision: snapshot.revision, termsHash: snapshot.termsHash, offerKey: snapshot.offerKey,
    interval: snapshot.interval, offerSignature: snapshot.offerSignature, bonusMonths: snapshot.bonusMonths, bonusReceiptUnits: snapshot.bonusReceiptUnits,
    attemptId: input.attemptId, acceptedAt: now, createBy: new Date(now.getTime() + CREATE_BY_MS) };
  try {
    if (!row) await tx.billingPromotionRedemption.create({ data: { ...data, promotionEnvironmentId: env, campaignId: snapshot.campaignId, companyId: input.companyId } });
    // A released right is taken again on the same row; its version fences a concurrent writer.
    else if ((await tx.billingPromotionRedemption.updateMany({ where: { id: row.id, state: 'RELEASED', version: row.version },
      data: { ...data, releasedAt: null, version: { increment: 1 } } })).count !== 1) return 'IN_PROGRESS';
    return true;
  } catch (error) {
    // The once-per-company or one-right-per-attempt unique lost a race: the quote is stale.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'IN_PROGRESS';
    throw error;
  }
}

/** Paid (spec §6 CONSUMED): RESERVED → CONSUMED on the verified invoice, before any HELD exit. Idempotent for the same
 *  invoice. False = no right is reserved for this attempt (released, or another invoice used it) — grant no bonus. */
export async function consumePromotion(tx: Tx, input: { attemptId: string; invoiceId: string; companyId: string; now: Date }): Promise<boolean> {
  const changed = await tx.billingPromotionRedemption.updateMany({ where: { attemptId: input.attemptId, companyId: input.companyId, state: 'RESERVED' },
    data: { state: 'CONSUMED', invoiceId: input.invoiceId, consumedAt: input.now, version: { increment: 1 } } });
  return changed.count === 1 || !!await tx.billingPromotionRedemption.findFirst({ where: { attemptId: input.attemptId, companyId: input.companyId,
    invoiceId: input.invoiceId, state: 'CONSUMED' }, select: { id: true } });
}

/** An attempt PROVEN unpaid gives its right back: RESERVED only, the attempt link cleared (the caller's audit row keeps the
 *  old id), so that attempt can never consume or release again. A CONSUMED right is never touched. */
export async function releasePromotion(tx: Tx, attemptId: string): Promise<void> {
  await tx.billingPromotionRedemption.updateMany({ where: { attemptId, state: 'RESERVED' },
    data: { state: 'RELEASED', attemptId: null, releasedAt: new Date(), releaseCount: { increment: 1 }, version: { increment: 1 } } });
}

/** Apply (spec §6 APPLY), in the paid-apply transaction: stamps the applied boundaries once. A replay changes nothing;
 *  an invoice whose right was never consumed throws, so a bonus is never granted without its redemption. */
export async function markPromotionApplied(tx: Tx, input: { invoiceId: string; paidStart: Date; paidEnd: Date; bonusEnd: Date; now: Date }): Promise<void> {
  const where = { invoiceId: input.invoiceId, state: 'CONSUMED' };
  const changed = await tx.billingPromotionRedemption.updateMany({ where: { ...where, benefitAppliedAt: null },
    data: { benefitAppliedAt: input.now, paidStart: input.paidStart, paidEnd: input.paidEnd, bonusEnd: input.bonusEnd, version: { increment: 1 } } });
  if (changed.count !== 1 && !await tx.billingPromotionRedemption.findFirst({ where, select: { id: true } })) throw new Error('billing.promotion_not_consumed');
}

export const promotionForInvoice = (tx: Tx, invoiceId: string) => tx.billingPromotionRedemption.findUnique({ where: { invoiceId } });
export const promotionForAttempt = (tx: Tx, attemptId: string) => tx.billingPromotionRedemption.findUnique({ where: { attemptId } });
