/**
 * AI credit funding on real PostgreSQL (add-on plan PR C3/C5; spec §5.1–§5.3, §8.3, A05/A07/A09/A34/A36).
 * Drives `reserveAiBudgetStep` the way the LINE v2 issuer does (a rendered authority), so cycle time,
 * month and races are controlled exactly. Runs with the reliability PostgreSQL suites. The promotion free time (plan R9, Q2;
 * A09, A32) is read from a real bonus receipt lot written by the grant seam.
 *
 * Run with: AI_BUDGET_RESERVATION_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/<local>_ci' \
 *   pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/ai-credit-funding.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { AppConfigService } from '../../../common/config/app-config.service';
import { priceRenderedAiInvocationV2 } from './ai-model-pricing';
import { appendPackageInterval, promotionBoundaries } from '../../billing/domain/billing-package';
import { grantPromotionPackageReceipts } from '../../billing/application/billing-receipt-grants';
import {
  cancelAiBudgetStep, chargeAiBudgetHoldAtBound, releaseAiBudgetHoldByOperator, reserveAiBudgetStep, settleAiBudgetStep,
  type RenderedAiReservationAuthority,
} from './company-ai-budget-reservation';
import { applyAiCreditGrant, readAiCreditBalance, revokeAiCreditGrant } from './ai-credit-ledger';
import { aiCreditCycleAllowance } from './company-ai-budget-policy';
import { bangkokMonthKey, previousBangkokMonthKey } from './company-ai-usage-meter';
import { PartnerAiCreditHoldsUseCase } from '../../system-partner-management/application/use-cases/partner-ai-credit-holds.use-case';
import { applyAddOnGrant } from '../../billing/application/billing-addon-grants';

const url = process.env.AI_BUDGET_RESERVATION_TEST_DATABASE_URL;
const model = 'apac.anthropic.claude-3-haiku-20240307-v1:0';
const DAY = 86_400_000;
const tariff = { version: 'synthetic-tariff:1', provider: 'bedrock' as const, modelId: model, region: 'ap-southeast-1', thbPerUsd: 33,
  usdPerMTok: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 } };
const priced = priceRenderedAiInvocationV2(tariff, 100_000, 4_000)!;
const BOUND = priced.upperBoundSatang;

describe('AI credit funding of LINE v2 CHAT holds on PostgreSQL', { skip: !url }, () => {
  const tag = `aicf-${randomUUID().slice(0, 8)}`;
  const operator = `${tag}-operator`;
  const DECISION = (companyId: string, reservationId: string) => ({ companyId, reservationId, actorUserId: operator, requestId: `req-${reservationId}`, reason: 'synthetic check' });
  let client: PrismaClient; let prisma: PrismaService;
  const config = { aiMonthlyBudgetSatang: 1_000_000 } as AppConfigService;
  const now = new Date();
  const monthKey = bangkokMonthKey(now);

  before(async () => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url!).hostname)) throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await client.$connect(); prisma = { client } as PrismaService;
    await client.user.create({ data: { id: operator, displayName: 'Synthetic credit operator', status: 'ACTIVE' } });
  });
  after(async () => {
    if (!client) return;
    await client.auditLog.deleteMany({ where: { companyId: { startsWith: tag } } });
    await client.aiBudgetReservation.deleteMany({ where: { companyId: { startsWith: tag } } });
    await client.companyPlanTerm.deleteMany({ where: { companyId: { startsWith: tag } } });
    await client.billingReceiptGrant.deleteMany({ where: { companyId: { startsWith: tag } } });
    const accounts = await client.billingAccount.findMany({ where: { companyId: { startsWith: tag } }, select: { id: true } });
    await client.billingInvoice.deleteMany({ where: { billingAccountId: { in: accounts.map(row => row.id) } } });
    await client.billingAccount.deleteMany({ where: { companyId: { startsWith: tag } } });
    await client.company.deleteMany({ where: { id: { startsWith: tag } } });
    await client.user.deleteMany({ where: { id: operator } });
    await client.$disconnect();
  });

  const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY);
  /** `count` calendar months back to back from `start`, the way one-time renewals chain. */
  const months = (start: Date, count: number): Array<readonly [Date, Date]> => Array.from({ length: count }, (_, k) =>
    [k ? appendPackageInterval(start, 'month', start.getUTCDate(), k) : start, appendPackageInterval(start, 'month', start.getUTCDate(), k + 1)] as const);
  /** A paid company; paidThrough = the last period end. Default: one calendar month that began 10 days ago. */
  async function fixture(suffix: string, opts: { allowance?: number; cutOver?: boolean; mode?: 'SHARED' | 'SPLIT'; chatCap?: number;
    periods?: Array<readonly [Date, Date]>; account?: Record<string, unknown>; term?: boolean } = {}) {
    const companyId = `${tag}-${suffix}`;
    await client.company.create({ data: { id: companyId, name: companyId } });
    const split = opts.mode === 'SPLIT';
    await client.companyAiConfiguration.create({ data: { companyId, modelId: model, budgetMode: opts.mode ?? 'SHARED',
      chatMonthlyBudgetSatang: split ? opts.chatCap ?? 500_000 : null, ocrMonthlyBudgetSatang: split ? 100_000 : null,
      salesDealChatCreditSatang: opts.allowance ?? 5_000,
      aiCreditCutoverAt: opts.cutOver === false ? null : new Date(now.getTime() - 60 * DAY), aiCreditCutoverSource: 'SYNTHETIC' } });
    const periods = opts.periods ?? months(daysFromNow(-10), 1);
    const account = await client.billingAccount.create({ data: { companyId, stripeAccountId: `acct_${companyId}`, livemode: false,
      renewalMode: 'CARD_ONCE', billingAnchorDay: periods[0]![0].getUTCDate(), paidThrough: periods[periods.length - 1]![1], ...opts.account } });
    for (const [index, [periodStart, periodEnd]] of periods.entries()) {
      await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: `in_${companyId}_${index}`, offerSnapshot: {},
        policyRevisionId: 'synthetic', currency: 'thb', totalSatang: 24_900, paidSatang: 24_900, periodStart, periodEnd,
        providerStatus: 'paid', evidenceHash: 'synthetic', applyStatus: 'APPLIED', appliedAt: periodStart } });
    }
    if (opts.term !== false) {
      await client.companyPlanTerm.create({ data: { companyId, tierKey: 'STARTER', branchLimit: 1, employeeLimit: 3, monthlySlipLimit: 30,
        termStartAt: periods[0]![0], termEndsAt: periods[periods.length - 1]![1], billingReceiptAccountId: account.id } });
    }
    return { companyId, accountId: account.id };
  }
  /**
   * A shop that bought a month with a free month, `startDaysAgo` days back: paid `[start, paidEnd)`, free `[paidEnd, benefitEnd)` (a month is
   * 28–31 days, so 40 days back puts today inside the free time and 75 days back just after it). The base invoice keeps `periodEnd = paidEnd`
   * and carries `benefitEnd`; the bonus lot comes from the real grant seam. `later` adds a paid month starting at `benefitEnd` (a gap, not a tail).
   */
  async function promoFixture(suffix: string, opts: { startDaysAgo: number; allowance?: number; later?: boolean; paidThrough?: Date }) {
    const start = daysFromNow(-opts.startDaysAgo);
    const { paidEnd, benefitEnd } = promotionBoundaries({ serviceStartsAt: start, interval: 'month', bonusMonths: 1 });
    const periods: Array<readonly [Date, Date]> = [[start, paidEnd]];
    if (opts.later) periods.push([benefitEnd, appendPackageInterval(benefitEnd, 'month', start.getUTCDate())]);
    const paidThrough = opts.paidThrough ?? (opts.later ? periods[1]![1] : benefitEnd);
    const shop = await fixture(suffix, { allowance: opts.allowance, periods, account: { paidThrough } });
    await client.companyPlanTerm.update({ where: { companyId: shop.companyId }, data: { termEndsAt: paidThrough } });
    const invoice = await client.billingInvoice.findFirstOrThrow({ where: { billingAccountId: shop.accountId }, orderBy: { periodStart: 'asc' } });
    await client.billingInvoice.update({ where: { id: invoice.id }, data: { benefitEnd } });
    const { bonus } = await client.$transaction(tx => grantPromotionPackageReceipts(tx, { companyId: shop.companyId, billingAccountId: shop.accountId,
      invoiceId: invoice.id, policyRevisionId: 'synthetic', kind: 'INITIAL', baseUnits: 30, bonusUnits: 30, serviceStart: start, paidEnd, benefitEnd, availableAt: start }));
    return { ...shop, invoiceId: invoice.id, bonusLotId: bonus.id, start, paidEnd, benefitEnd };
  }
  const cycleLots = (companyId: string) => client.aiCreditGrant.findMany({ where: { companyId, sourceKind: 'INCLUDED_CYCLE' }, orderBy: { availableAt: 'asc' } });
  const rendered = (over: Partial<RenderedAiReservationAuthority> = {}): RenderedAiReservationAuthority & { claims: Array<unknown> } => {
    const claims: Array<unknown> = [];
    return { upperBoundSatang: BOUND, maxCalls: 4, snapshot: structuredClone(priced.snapshot) as never, fundsAiCredit: true, fundingAsOf: now,
      authorizeAndClaim: async (_tx: unknown, funding?: unknown) => { claims.push(funding ?? null); return true; }, claims, ...over };
  };
  const reserve = (companyId: string, attempt: string, authority = rendered(), month = monthKey) => reserveAiBudgetStep(prisma, config, {
    companyId, monthKey: month, bucket: 'CHAT', stepKind: 'provider-v2', attemptKey: `${companyId}-${attempt}`, ordinal: 0,
    sourceRoute: 'line-ai-v2', requestKind: 'TEXT', modelId: model, thbPerUsd: 33, thbPerUsdSource: 'pinned-grant', now,
  }, authority);
  const settle = (invocationKey: string) => settleAiBudgetStep(prisma, { invocationKey, meta: { sourceRoute: 'line-ai-v2' },
    entry: { modelId: model, tag: 'fixture', ok: true, inputTokens: 80_000, outputTokens: 3_000, cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0, usageBasis: 'PROVIDER_REPORTED' } as never });
  const entries = (companyId: string, reservationId?: string) => client.aiCreditEntry.findMany({
    where: { companyId, ...(reservationId ? { reservationId } : {}) }, orderBy: { createdAt: 'asc' } });
  const balance = async (companyId: string) => {
    const row = await client.companyAiConfiguration.findUniqueOrThrow({ where: { companyId } });
    return readAiCreditBalance(client, { companyId, at: now,
      allowance: cycle => aiCreditCycleAllowance({ row, totalSatang: 1_000_000, override: false, monthKey, at: cycle.start }) });
  };
  const addLot = (companyId: string, sourceKind: 'ADD_ON_ADMIN' | 'ADD_ON_PAID' | 'SALES_EVENT', units: number, daysAgo = 1) => client.$transaction(tx =>
    applyAiCreditGrant(tx, { companyId, billingAccountId: null, sourceKind, sourceKey: `${companyId}:${sourceKind}:${units}`, sourceHash: 'h',
      units, at: new Date(now.getTime() - daysAgo * DAY), operationId: 'op' }));

  it('known v2 timeout releases funded credit and preserves only company cost', async () => {
    const { companyId } = await fixture('nocharge-timeout');
    const before = await balance(companyId);
    const held = await reserve(companyId, 'timeout');
    assert.ok(held.ok); if (!held.ok) return;
    await client.aiBudgetReservation.update({ where: { id: held.reservation.id }, data: { status: 'DISPATCHED' } });
    const input = { invocationKey: held.reservation.invocationKey, meta: { sourceRoute: 'line-ai-v2' },
      entry: { modelId: model, tag: 'line.loop', ok: false, inputTokens: 1200, outputTokens: 100,
        cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 1, usageBasis: 'CONSERVATIVE_ESTIMATE' as const } };
    assert.equal(await settleAiBudgetStep(prisma, input), 'settled');
    assert.equal((await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: held.reservation.id } })).status, 'CANCELLED');
    assert.equal((await entries(companyId)).filter(entry => entry.kind === 'CONSUME').length, 0);
    const after = await balance(companyId);
    assert.equal(after.totalRemainingUnits, before.totalRemainingUnits);
    assert.equal(after.packageRemainingUnits, before.packageRemainingUnits);
    assert.equal(after.lots.reduce((sum, lot) => sum + lot.reservedUnits + lot.consumedUnits, 0), 0);
    assert.equal(await client.companyAiMonthlyUsage.count({ where: { companyId } }), 0);
    assert.equal(await client.companyAiMonthlyBucketUsage.count({ where: { companyId } }), 0);
    const event = await client.aiUsageEvent.findUniqueOrThrow({ where: { invocationKey: input.invocationKey } });
    assert.equal(event.usageBasis, 'COMPANY_ABSORBED'); assert.ok(event.costSatang > 0);
    assert.equal(await settleAiBudgetStep(prisma, input), 'duplicate');
    assert.equal((await chargeAiBudgetHoldAtBound(prisma, DECISION(companyId, held.reservation.id),
      { ip: null, userAgent: null } as never)).ok, false, 'operator cannot charge a known timeout after release');
  });

  it('funds a cut-over call from the cycle, then team-given, then purchased credit — past the old calendar CHAT cap (A05, C01)', async () => {
    const { companyId } = await fixture('order', { allowance: 50 });
    const gift = await addLot(companyId, 'ADD_ON_ADMIN', 1000);
    const paid = await addLot(companyId, 'ADD_ON_PAID', 1000);
    // The calendar CHAT spend is already above this shop's old CHAT cap of 50 satang.
    await client.companyAiMonthlyUsage.create({ data: { companyId, monthKey, costSatang: 9_000 } });
    await client.companyAiMonthlyBucketUsage.create({ data: { companyId, monthKey, bucket: 'CHAT', costSatang: 9_000 } });
    const authority = rendered();
    const result = await reserve(companyId, 'a1', authority);
    assert.ok(result.ok, JSON.stringify(result));
    const cycle = await client.aiCreditGrant.findFirstOrThrow({ where: { companyId, sourceKind: 'INCLUDED_CYCLE' } });
    assert.deepEqual(authority.claims, [{ cycleKey: cycle.cycleKey }], 'the issuer is told which cycle to pin');
    assert.equal(cycle.units, 50); assert.equal(cycle.allowanceSource, 'SALES_DEAL'); assert.equal(cycle.cycleState, 'PAID');
    const byLot = (rows: Array<{ grantId: string; kind: string; units: number }>, kind: string) =>
      Object.fromEntries(rows.filter(row => row.kind === kind).map(row => [row.grantId, row.units]));
    assert.deepEqual(byLot(await entries(companyId, result.reservation.id), 'RESERVE'), { [cycle.id]: -50, [gift.lotId]: -(BOUND - 50) });
    assert.equal((await balance(companyId)).totalRemainingUnits, 2050 - BOUND, 'a live hold is not available');
    assert.equal(await settle(result.reservation.invocationKey), 'settled');
    const cost = (await client.aiUsageEvent.findUniqueOrThrow({ where: { invocationKey: result.reservation.invocationKey } })).costSatang;
    assert.ok(cost < BOUND);
    assert.deepEqual(byLot(await entries(companyId, result.reservation.id), 'CONSUME'), { [cycle.id]: -50, [gift.lotId]: -(cost - 50) });
    const after = await balance(companyId);
    assert.equal(after.packageRemainingUnits, 0);
    assert.equal(after.additionalRemainingUnits, 2000 - (cost - 50));
    assert.equal(after.lots.find(lot => lot.id === paid.lotId)!.availableUnits, 1000, 'purchased credit is last');
    // The same shop before cutover is refused by the calendar CHAT cap, exactly as today.
    const { companyId: legacy } = await fixture('legacy', { allowance: 50, cutOver: false });
    await client.companyAiMonthlyUsage.create({ data: { companyId: legacy, monthKey, costSatang: 9_000 } });
    await client.companyAiMonthlyBucketUsage.create({ data: { companyId: legacy, monthKey, bucket: 'CHAT', costSatang: 9_000 } });
    const refused = await reserve(legacy, 'l1');
    assert.equal(refused.ok, false); assert.equal(!refused.ok && refused.reason, 'exceeded');
    assert.equal(await client.aiCreditGrant.count({ where: { companyId: legacy } }), 0, 'no ledger rows for a legacy shop');
  });

  it('refuses spent-out credit with the existing code shape and an internal cause, before the ordinal claim (C3)', async () => {
    const { companyId: empty } = await fixture('empty', { allowance: 0 });
    const authority = rendered();
    const exhausted = await reserve(empty, 'e1', authority);
    assert.deepEqual(!exhausted.ok && [exhausted.reason, 'budgetScope' in exhausted && exhausted.budgetScope, 'aiCredit' in exhausted && exhausted.aiCredit], ['exceeded', 'CHAT', 'EXHAUSTED']);
    assert.deepEqual(authority.claims, [], 'the turn keeps its ordinal');
    assert.equal(await client.aiBudgetReservation.count({ where: { companyId: empty } }), 0);
    const { companyId: short } = await fixture('short', { allowance: 10 });
    const insufficient = await reserve(short, 's1');
    assert.deepEqual(!insufficient.ok && [insufficient.reason, 'aiCredit' in insufficient && insufficient.aiCredit], ['insufficient', 'INSUFFICIENT']);
    const { companyId: ended } = await fixture('ended', { term: false });
    const noPackage = await reserve(ended, 'n1');
    assert.deepEqual(!noPackage.ok && [noPackage.reason, 'aiCredit' in noPackage && noPackage.aiCredit], ['unavailable', 'PACKAGE_REQUIRED']);
  });

  it('never spends AI credit on an image intake, which keeps its CHAT cost bucket (C4)', async () => {
    const { companyId } = await fixture('image', { allowance: 0 });
    const result = await reserve(companyId, 'i1', rendered({ fundsAiCredit: false }));
    assert.ok(result.ok);
    assert.equal(result.reservation.bucket, 'CHAT');
    assert.equal(await client.aiCreditEntry.count({ where: { companyId } }), 0);
  });

  it('frees a cancelled or operator-released hold with no second write; late evidence after release is the provider\'s; charge-at-bound uses the hold (A30)', async () => {
    const { companyId } = await fixture('holds', { allowance: BOUND * 3 });
    const full = BOUND * 3;
    const r1 = await reserve(companyId, 'h1'); assert.ok(r1.ok);
    assert.equal((await balance(companyId)).packageRemainingUnits, full - BOUND);
    assert.equal(await cancelAiBudgetStep(prisma, { reservationId: r1.reservation.id, ownerToken: r1.reservation.ownerToken, proof: 'gateway_pre_provider_refusal' }), true);
    assert.equal((await balance(companyId)).packageRemainingUnits, full);
    const r2 = await reserve(companyId, 'h2'); assert.ok(r2.ok);
    await client.aiBudgetReservation.update({ where: { id: r2.reservation.id }, data: { status: 'UNRESOLVED' } });
    assert.equal((await balance(companyId)).packageRemainingUnits, full - BOUND, 'an unresolved hold keeps counting');
    assert.equal((await releaseAiBudgetHoldByOperator(prisma, DECISION(companyId, r2.reservation.id), { action: 'ai_credit_hold.released' })).ok, true);
    assert.equal((await balance(companyId)).packageRemainingUnits, full);
    assert.equal(await settle(r2.reservation.invocationKey), 'settled-anomaly');
    assert.equal(await client.aiCreditEntry.count({ where: { reservationId: r2.reservation.id, kind: 'CONSUME' } }), 0);
    assert.equal((await balance(companyId)).packageRemainingUnits, full, 'the released credit is not debited again');
    const r3 = await reserve(companyId, 'h3'); assert.ok(r3.ok);
    await client.aiBudgetReservation.update({ where: { id: r3.reservation.id }, data: { status: 'UNRESOLVED' } });
    assert.equal((await chargeAiBudgetHoldAtBound(prisma, DECISION(companyId, r3.reservation.id), { action: 'ai_credit_hold.charged' })).ok, true);
    assert.equal((await client.aiCreditEntry.aggregate({ where: { reservationId: r3.reservation.id, kind: 'CONSUME' }, _sum: { units: true } }))._sum.units, -BOUND);
    assert.equal((await balance(companyId)).packageRemainingUnits, full - BOUND);
    assert.equal(await client.aiCreditEntry.count({ where: { companyId, kind: 'RELEASE' } }), 0);
  });

  it('lets two months race for one lot without spending it twice, because both take the company lock first (§8.3)', async () => {
    const { companyId } = await fixture('race', { allowance: BOUND });
    const results = await Promise.all([reserve(companyId, 'm1'), reserve(companyId, 'm0', rendered(), previousBangkokMonthKey(now))]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal((await balance(companyId)).packageRemainingUnits, 0);
  });

  it('keeps a turn on the cycle it was admitted in across the boundary, and opens the next cycle once (A36)', async () => {
    // Cycle A began 45 days ago and B a calendar month later; the first turn was admitted 20 days ago, inside A.
    const { companyId } = await fixture('boundary', { allowance: 1_000, periods: months(daysFromNow(-45), 2) });
    const t0 = daysFromNow(-20);
    const first = await reserve(companyId, 'b1', rendered({ fundingAsOf: t0 })); assert.ok(first.ok);
    const old = await client.aiCreditGrant.findFirstOrThrow({ where: { companyId, sourceKind: 'INCLUDED_CYCLE' } });
    const second = await reserve(companyId, 'b2'); assert.ok(second.ok);
    const lots = await client.aiCreditGrant.findMany({ where: { companyId, sourceKind: 'INCLUDED_CYCLE' }, orderBy: { availableAt: 'asc' } });
    assert.equal(lots.length, 2);
    assert.equal(lots[0]!.cycleState, 'CLOSED'); assert.ok(lots[0]!.closedAt);
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'ai_credit.cycle.opened' } }), 1);
    // The next call of the first turn arrives after the boundary: it stays on its pinned cycle.
    const pinned = await reserve(companyId, 'b3', rendered({ pinnedCycleKey: old.cycleKey! }));
    assert.ok(pinned.ok);
    assert.deepEqual((await entries(companyId, pinned.reservation.id)).map(row => row.grantId), [old.id]);
    assert.equal(await client.aiCreditGrant.count({ where: { companyId, sourceKind: 'INCLUDED_CYCLE' } }), 2, 'no extra allowance');
  });

  it('opens the renewal cycle at the boundary while the QR is unpaid, and keeps the same lot once paid (O-01, A34)', async () => {
    // A whole calendar month that ended one to four days ago, whatever today is. `[now-31d, now-1d]` is only
    // 30 days: on the 1st after a 31-day month it began on the 1st, so the renewal cycle it anchors was already over.
    const paidMonth = months(daysFromNow(-32), 1), ended = paidMonth[0]![1];
    const { companyId, accountId } = await fixture('renewal', { allowance: 1_000, periods: paidMonth,
      account: { renewalMode: 'PROMPTPAY_RENEW', subscriptionState: 'active', graceEndsAt: new Date(now.getTime() + 5 * DAY), billingAnchorDay: null } });
    const pending = await reserve(companyId, 'p1'); assert.ok(pending.ok);
    const lot = await client.aiCreditGrant.findFirstOrThrow({ where: { companyId, sourceKind: 'INCLUDED_CYCLE' } });
    assert.equal(lot.cycleState, 'RENEWAL_PENDING'); assert.equal(lot.invoiceId, null);
    const paidFrom = ended, paidTo = new Date(now.getTime() + 29 * DAY);
    const renewal = await client.billingInvoice.create({ data: { billingAccountId: accountId, providerInvoiceId: `in_${companyId}_renewal`, offerSnapshot: {},
      policyRevisionId: 'synthetic', currency: 'thb', totalSatang: 24_900, paidSatang: 24_900, periodStart: paidFrom, periodEnd: paidTo,
      providerStatus: 'paid', evidenceHash: 'synthetic', applyStatus: 'APPLIED', appliedAt: now } });
    await client.billingAccount.update({ where: { id: accountId }, data: { paidThrough: paidTo, graceEndsAt: null } });
    const paid = await reserve(companyId, 'p2'); assert.ok(paid.ok);
    const after = await client.aiCreditGrant.findMany({ where: { companyId, sourceKind: 'INCLUDED_CYCLE' } });
    assert.equal(after.length, 1, 'paying never gives the cycle twice');
    assert.equal(after[0]!.id, lot.id); assert.equal(after[0]!.cycleState, 'PAID'); assert.equal(after[0]!.invoiceId, renewal.id);
  });

  it('keeps an explicit SPLIT CHAT cap as a safety cap for a cut-over company (§18.3)', async () => {
    const { companyId } = await fixture('split', { mode: 'SPLIT', chatCap: 20_000, allowance: 50_000 });
    await client.companyAiMonthlyUsage.create({ data: { companyId, monthKey, costSatang: 20_000 } });
    await client.companyAiMonthlyBucketUsage.create({ data: { companyId, monthKey, bucket: 'CHAT', costSatang: 20_000 } });
    const capped = await reserve(companyId, 'x1');
    assert.deepEqual(!capped.ok && [capped.reason, 'budgetScope' in capped && capped.budgetScope, 'aiCredit' in capped ? capped.aiCredit : undefined], ['exceeded', 'CHAT', undefined]);
    const { companyId: open } = await fixture('split-open', { mode: 'SPLIT', chatCap: 20_000 });
    const funded = await reserve(open, 'x2'); assert.ok(funded.ok);
    const lot = await client.aiCreditGrant.findFirstOrThrow({ where: { companyId: open, sourceKind: 'INCLUDED_CYCLE' } });
    assert.equal(lot.units, 20_000); assert.equal(lot.allowanceSource, 'SPLIT_CHAT_CAP');
  });

  it('revokes only what is unused and unheld, and a revoked lot funds nothing new (§16 item 8)', async () => {
    const { companyId } = await fixture('revoke', { allowance: 0 });
    const gift = await addLot(companyId, 'ADD_ON_ADMIN', BOUND * 2);
    const again = await addLot(companyId, 'ADD_ON_ADMIN', BOUND * 2);
    assert.deepEqual([again.replayed, again.lotId], [true, gift.lotId], 'a replayed grant never mints a second lot (§16 item 6)');
    assert.equal(gift.expiresAt.toISOString(), appendPackageInterval(gift.availableAt, 'year').toISOString(), '12 months from the grant (D8)');
    const held = await reserve(companyId, 'v1'); assert.ok(held.ok);
    const withdrawn = await client.$transaction(tx => revokeAiCreditGrant(tx, { companyId, grantId: gift.lotId, operationKey: `revoke:${gift.lotId}`, now }));
    assert.equal(withdrawn, BOUND);
    assert.equal(await client.$transaction(tx => revokeAiCreditGrant(tx, { companyId, grantId: gift.lotId, operationKey: `revoke:${gift.lotId}`, now })), BOUND, 'a replay withdraws nothing more');
    assert.equal(await settle(held.reservation.invocationKey), 'settled');
    const refused = await reserve(companyId, 'v2');
    assert.equal(refused.ok, false, 'what the hold left over stays withdrawn');
  });

  it('grants AI credit through the shared add-on seam once the company is cut over, replaying the same source (C7, §16)', async () => {
    const { companyId, accountId } = await fixture('seam', { allowance: 0 });
    const input = { companyId, billingAccountId: accountId, productKind: 'CHAT_CREDIT' as const, sourceKind: 'ADD_ON_ADMIN' as const,
      sourceKey: `addon-admin:${companyId}`, sourceHash: 'a'.repeat(64), units: 5_000, at: now };
    const first = await client.$transaction(tx => applyAddOnGrant(tx, input));
    assert.deepEqual([first.productKind, first.units, first.replayed], ['CHAT_CREDIT', 5_000, false]);
    assert.equal(first.expiresAt.toISOString(), appendPackageInterval(now, 'year').toISOString(), '12 months, never chosen by the caller');
    const again = await client.$transaction(tx => applyAddOnGrant(tx, input));
    assert.deepEqual([again.lotId, again.replayed], [first.lotId, true]);
    await assert.rejects(client.$transaction(tx => applyAddOnGrant(tx, { ...input, units: 6_000 })), /billing\.addon_source_changed/);
    const funded = await reserve(companyId, 'seam-1'); assert.ok(funded.ok);
    assert.deepEqual((await entries(companyId, funded.reservation.id)).map(row => row.grantId), [first.lotId], 'the lot funds calls like any added credit');
    const { companyId: legacy, accountId: legacyAccount } = await fixture('seam-legacy', { cutOver: false });
    await assert.rejects(client.$transaction(tx => applyAddOnGrant(tx, { ...input, companyId: legacy, billingAccountId: legacyAccount,
      sourceKey: `addon-admin:${legacy}` })), /billing\.addon_consumer_not_ready/, 'no lot a legacy shop cannot use');
  });

  it('finds a hold older than two months and sweeps its month before listing (C11)', async () => {
    const { companyId } = await fixture('old-holds');
    const old = new Date(now.getTime() - 100 * DAY);
    const oldMonth = bangkokMonthKey(old), olderMonth = bangkokMonthKey(new Date(now.getTime() - 130 * DAY));
    const base = { companyId, bucket: 'CHAT', policyRevision: 'synthetic', sourceRoute: 'line-ai-v2', stepKind: 'provider-v2',
      upperBoundSatang: 10, pricingSnapshot: {}, ownerToken: 'owner' };
    await client.aiBudgetReservation.create({ data: { ...base, monthKey: oldMonth, attemptKey: 'old-1', invocationKey: `${companyId}#old-1`, status: 'UNRESOLVED', createdAt: old } });
    await client.aiBudgetReservation.create({ data: { ...base, monthKey: olderMonth, attemptKey: 'old-2', invocationKey: `${companyId}#old-2`,
      status: 'DISPATCHED', dispatchedAt: new Date(now.getTime() - 130 * DAY), createdAt: new Date(now.getTime() - 130 * DAY) } });
    const read = await new PartnerAiCreditHoldsUseCase(prisma).read({ companyId, canManage: true, now });
    assert.deepEqual(read.items.map(item => [item.monthKey, item.status]), [[oldMonth, 'UNRESOLVED'], [olderMonth, 'UNRESOLVED']]);
    assert.ok(read.monthKeys.includes(olderMonth));
    assert.equal(read.nextCursor, null);
  });

  it('funds the free time of a promotion lazily, once, as one cycle keyed on the paid end — two reads, one lot (plan R9, Q2; A09, A32)', async () => {
    const f = await promoFixture('promo-tail', { startDaysAgo: 40, allowance: BOUND * 4 });
    const key = `${f.accountId}:${f.paidEnd.toISOString()}`;
    const read = await balance(f.companyId);
    assert.deepEqual([read.cycle?.cycleKey, read.cycle?.fundingSource, read.packageRemainingUnits], [key, 'PROMOTION', BOUND * 4], 'the free time is projected at the normal allowance');
    assert.equal(await client.aiCreditGrant.count({ where: { companyId: f.companyId } }), 0, 'reading funds nothing: a cycle nobody used gets no lot');
    const first = await reserve(f.companyId, 'f1'); assert.ok(first.ok);
    const second = await reserve(f.companyId, 'f2'); assert.ok(second.ok);
    const lots = await cycleLots(f.companyId);
    assert.equal(lots.length, 1, 'two reads, one lot — and no lot for the 13 months a longer promotion would span');
    const [lot] = lots;
    assert.deepEqual([lot!.cycleKey, lot!.cycleState, lot!.invoiceId, lot!.availableAt.toISOString(), lot!.expiresAt.toISOString(), lot!.units, lot!.allowanceSource],
      [key, 'PAID', f.invoiceId, f.paidEnd.toISOString(), f.benefitEnd.toISOString(), BOUND * 4, 'SALES_DEAL']);
    assert.deepEqual([...new Set((await entries(f.companyId)).map(row => row.grantId))], [lot!.id], 'both holds draw the one free-time lot');
    assert.equal((await balance(f.companyId)).packageRemainingUnits, BOUND * 2);
  });

  it('opens the free-time cycle once after the paid month used its own, closes the paid one, and funds the same lot in a gap before a later paid period (A32)', async () => {
    const f = await promoFixture('promo-gap', { startDaysAgo: 40, allowance: BOUND * 4, later: true });
    const paidMonth = await reserve(f.companyId, 'g0', rendered({ fundingAsOf: daysFromNow(-30) })); assert.ok(paidMonth.ok);
    const free = await reserve(f.companyId, 'g1'); assert.ok(free.ok);
    await reserve(f.companyId, 'g2');
    const lots = await cycleLots(f.companyId);
    assert.deepEqual(lots.map(lot => [lot.cycleKey, lot.cycleState]), [[`${f.accountId}:${f.start.toISOString()}`, 'CLOSED'], [`${f.accountId}:${f.paidEnd.toISOString()}`, 'PAID']]);
    assert.equal(lots[1]!.invoiceId, f.invoiceId);
    assert.equal(await client.auditLog.count({ where: { companyId: f.companyId, action: 'ai_credit.cycle.opened' } }), 1, 'the free time opened exactly one cycle');
    // Before this change the gap had no cycle at all (the paid period ended, the next one has not begun) and the call was refused.
    assert.equal((await balance(f.companyId)).cycle?.fundingSource, 'PROMOTION');
  });

  it('opens no free-time cycle once the bonus lot is revoked, and a fully refunded promotion funds nothing at all (A32)', async () => {
    // Revoked bonus lot, term still running: no free time is known, so today's rule for gift days applies — the last paid cycle stretches.
    const open = await promoFixture('promo-revoked', { startDaysAgo: 40, allowance: BOUND * 4 });
    await client.billingReceiptGrant.update({ where: { id: open.bonusLotId }, data: { revokedAt: now } });
    assert.ok((await reserve(open.companyId, 'r1')).ok);
    assert.deepEqual((await cycleLots(open.companyId)).map(lot => lot.cycleKey), [`${open.accountId}:${open.start.toISOString()}`], 'never the free-time key');
    // A full refund also revokes the base lot and ends the term at the refund: nothing is funded, not a lot, not a hold.
    const refunded = await promoFixture('promo-refunded', { startDaysAgo: 40, allowance: BOUND * 4 });
    await client.billingReceiptGrant.updateMany({ where: { companyId: refunded.companyId }, data: { revokedAt: now } });
    await client.billingAccount.update({ where: { id: refunded.accountId }, data: { paidThrough: daysFromNow(-1) } });
    const refusal = await reserve(refunded.companyId, 'r2');
    assert.deepEqual(!refusal.ok && [refusal.reason, 'aiCredit' in refusal && refusal.aiCredit], ['unavailable', 'PACKAGE_REQUIRED']);
    assert.equal(await client.aiCreditGrant.count({ where: { companyId: refunded.companyId } }), 0);
  });

  it('adds no lot for plain admin gift days, after a free month or without one — the running cycle stretches (A09, A32)', async () => {
    // Without a promotion: the paid month's lot already exists; gift days after it reuse it.
    const plainStart = daysFromNow(-35);
    const plain = await fixture('gift-plain', { allowance: BOUND * 4, periods: months(plainStart, 1), account: { paidThrough: daysFromNow(10) } });
    assert.ok((await reserve(plain.companyId, 'k1', rendered({ fundingAsOf: daysFromNow(-20) }))).ok);
    assert.ok((await reserve(plain.companyId, 'k2')).ok, 'today is past the paid month, inside the gift days');
    assert.equal((await cycleLots(plain.companyId)).length, 1);
    // With one: the free month ended, gift days run on — they stretch the FREE-TIME cycle, not the closed paid one.
    const f = await promoFixture('gift-promo', { startDaysAgo: 75, allowance: BOUND * 4, paidThrough: daysFromNow(5) });
    assert.ok((await reserve(f.companyId, 'p0', rendered({ fundingAsOf: daysFromNow(-55) }))).ok, 'a read in the paid month');
    assert.ok((await reserve(f.companyId, 'p1', rendered({ fundingAsOf: daysFromNow(-30) }))).ok, 'a read in the free month');
    assert.ok((await reserve(f.companyId, 'p2')).ok, 'a read in the gift days');
    const lots = await cycleLots(f.companyId);
    assert.deepEqual(lots.map(lot => lot.cycleKey), [`${f.accountId}:${f.start.toISOString()}`, `${f.accountId}:${f.paidEnd.toISOString()}`], 'two lots, none for the gift days');
    const read = await balance(f.companyId);
    assert.deepEqual([read.cycle?.cycleKey, read.cycle?.end.toISOString(), read.cycle?.fundingSource], [lots[1]!.cycleKey, daysFromNow(5).toISOString(), 'PROMOTION']);
  });
});
