/**
 * Receipt image ledger and the add-on grant seam (chat credit and receipt image plan PR B; spec §6, §8.3,
 * §15.3, §16; AO-E15, AO-E18–AO-E20, AO-E70) against real PostgreSQL. A release gate: it writes and reads
 * every column `20260929150000_receipt_unit_entries` adds, and proves reserve/consume/release under the
 * company lock, two months racing for one lot, a late release of an older generation, resume, the D4/D8
 * order, and that a new add-on lot starts a new quota-card generation without writing the plan term. The PROMOTION bonus
 * lot (promotion plan R7, spec Q1; A08, A31) runs through the same admissions: the spec's worked example, a lot that expires
 * under a reservation, a replay that never moves to another lot, and the other kinds' own expiry and group beside it.
 *
 * Run with:
 *   RECEIPT_ADDON_LEDGER_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/receipt-addon-ledger.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import type { PrismaService } from '../../common/database/prisma.service';
import { applyAddOnGrant, type AddOnGrantSourceKind } from './application/billing-addon-grants';
import { grantPaidPackageReceipts, grantPromotionPackageReceipts, paidReceiptBalance, receiptLots, visibleReceiptLots } from './application/billing-receipt-grants';
import { appendPackageInterval, promotionBoundaries } from './domain/billing-package';
import {
  admitCompanyOcr, claimReceiptQuotaNotice, receiptQuotaSnapshot, releaseCompanyOcrAdmission, releaseReceiptQuotaNotice,
  settleCompanyOcrAdmission, type CompanyOcrSourceRoute,
} from '../line-ai/application/company-ocr-governance';

const databaseUrl = process.env.RECEIPT_ADDON_LEDGER_TEST_DATABASE_URL;
type Shop = { companyId: string; accountId: string; packageLotId: string | null };

describe('receipt add-on ledger on PostgreSQL', { skip: !databaseUrl }, () => {
  let client: PrismaClient, prisma: PrismaService;
  const companyIds: string[] = [], webhookEventIds: string[] = [];
  before(() => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_ci'), 'only a disposable local *_ci database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    prisma = { client } as PrismaService;
  });
  after(async () => {
    const where = { companyId: { in: companyIds } };
    await client.companyOcrUsageEvent.deleteMany({ where });
    await client.billingReceiptGrant.deleteMany({ where }); // the ledger cascades with its lots
    await client.companyOcrMonthlyUsage.deleteMany({ where });
    await client.companyPlanTerm.deleteMany({ where });
    await client.auditLog.deleteMany({ where });
    await client.lineWebhookEventLog.deleteMany({ where: { webhookEventId: { in: webhookEventIds } } });
    await client.billingAccount.deleteMany({ where });
    await client.company.deleteMany({ where: { id: { in: companyIds } } });
    await client.$disconnect();
  });

  /** A paid shop reads receipts from its account's lots; a legacy shop (no pointer) keeps the monthly path. */
  async function shop(packageUnits: number | null = 1): Promise<Shop> {
    const run = randomUUID().replaceAll('-', ''), companyId = `ledger-${run}`, now = new Date(), end = appendPackageInterval(now, 'year');
    companyIds.push(companyId);
    await client.company.create({ data: { id: companyId, name: 'Synthetic receipt ledger company' } });
    const account = await client.billingAccount.create({ data: { companyId, stripeAccountId: `acct_${run}`, livemode: false } });
    await client.companyPlanTerm.create({ data: { companyId, tierKey: 'PRO_999', branchLimit: 5, employeeLimit: 10, monthlySlipLimit: 100, termStartAt: now, termEndsAt: end } });
    const lot = packageUnits === null ? null : await client.$transaction((tx) => grantPaidPackageReceipts(tx, { companyId, billingAccountId: account.id,
      sourceKey: `in_${run}`, policyRevisionId: 'TEST_ONLY', kind: 'INITIAL', units: packageUnits, serviceStart: now, serviceEnd: end, availableAt: now, expiresAt: end }));
    return { companyId, accountId: account.id, packageLotId: lot?.id ?? null };
  }
  const grant = (s: Shop, units: number, sourceKind: AddOnGrantSourceKind = 'ADD_ON_ADMIN', sourceKey = `${sourceKind}:${randomUUID()}`, at = new Date()) =>
    client.$transaction((tx) => applyAddOnGrant(tx, { companyId: s.companyId, billingAccountId: s.accountId, productKind: 'RECEIPT_IMAGE',
      sourceKind, sourceKey, sourceHash: 'b'.repeat(64), units, at }));
  const admit = (s: Shop, requestId: string, extra: Partial<Parameters<typeof admitCompanyOcr>[1]> = {}) => admitCompanyOcr(prisma, {
    companyId: s.companyId, sourceRoute: 'receipt-ocr-web', requestId, monthKey: '2026-09', enforceReceiptQuota: true, singlePageImage: true, ...extra });
  const identity = (s: Shop, requestId: string, eventId: string, sourceRoute: CompanyOcrSourceRoute = 'receipt-ocr-web') =>
    ({ companyId: s.companyId, sourceRoute, requestId, eventId });
  const eventId = (decision: Awaited<ReturnType<typeof admitCompanyOcr>>) => { assert.ok(decision.allowed, JSON.stringify(decision)); return decision.eventId; };
  // Operation, generation, then reservation before its outcome: two entries of one read can share a millisecond.
  const rank = (kind: string) => (kind === 'RESERVE' ? 0 : 1);
  const ledger = async (s: Shop) => (await client.receiptUnitEntry.findMany({ where: { companyId: s.companyId } }))
    .sort((a, b) => a.operationKey.localeCompare(b.operationKey) || a.generation - b.generation || rank(a.kind) - rank(b.kind));
  const used = async (s: Shop) => (await paidReceiptBalance(client, s.companyId, s.accountId, new Date(), true)).used;

  it('reserves at admission, consumes a usable result, and hands back a non-receipt and a failure (AO-E18, AO-E19)', async () => {
    const s = await shop(3);
    const a = eventId(await admit(s, 'a'));
    const event = await client.companyOcrUsageEvent.findUniqueOrThrow({ where: { id: a } });
    assert.deepEqual([event.billingReceiptGrantId, event.receiptUnitGeneration], [s.packageLotId, 1]);
    const [reserve] = await ledger(s);
    assert.deepEqual({ ...reserve, id: undefined, createdAt: undefined }, { id: undefined, createdAt: undefined, companyId: s.companyId,
      grantId: s.packageLotId, operationKey: 'receipt-ocr-web:a', generation: 1, kind: 'RESERVE', units: 1 });
    assert.ok(reserve!.createdAt instanceof Date);
    assert.equal(await settleCompanyOcrAdmission(prisma, identity(s, 'a', a)), true);
    assert.equal(await releaseCompanyOcrAdmission(prisma, identity(s, 'a', a)), true, 'a used unit is final');
    // D4/Q4 in a shop whose receipts are lots: a read that found no receipt is not charged, and its fence stays.
    const b = eventId(await admit(s, 'b'));
    assert.equal(await settleCompanyOcrAdmission(prisma, { ...identity(s, 'b', b), noReceipt: true }), true);
    assert.equal((await admit(s, 'b')).allowed, false, 'the same read is still one operation');
    // A system failure hands the unit back and drops the fence, as it always has.
    const c = eventId(await admit(s, 'c'));
    assert.equal(await releaseCompanyOcrAdmission(prisma, { ...identity(s, 'c', c), reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT' }), true);
    assert.equal(await client.companyOcrUsageEvent.count({ where: { id: c } }), 0);
    assert.deepEqual((await ledger(s)).map((row) => `${row.operationKey.split(':')[1]}:${row.kind}`),
      ['a:RESERVE', 'a:CONSUME', 'b:RESERVE', 'b:RELEASE', 'c:RESERVE', 'c:RELEASE']);
    assert.equal(await used(s), 1);
    assert.equal(await client.auditLog.count({ where: { companyId: s.companyId, action: 'receipt.ocr.admission.not_charged' } }), 1);
    const usage = await client.companyOcrMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId: s.companyId, monthKey: '2026-09' } } });
    assert.equal(usage.usedCount, 2, 'the ops brake still counts the non-receipt read the provider ran');
  });

  it('uses package units before team units, and add-on units for one-page images only (D4, D8, AO-E20)', async () => {
    const s = await shop(1), team = await grant(s, 2);
    const first = await admit(s, 'image-1');
    assert.equal((await client.companyOcrUsageEvent.findUniqueOrThrow({ where: { id: eventId(first) } })).billingReceiptGrantId, s.packageLotId);
    const pdf = await admit(s, 'pdf-1', { sourceRoute: 'receipt-capture-web', singlePageImage: false });
    assert.ok(!pdf.allowed && pdf.reason === 'plan_exceeded', 'only add-on units left: a PDF never draws them');
    const second = await admit(s, 'image-2');
    assert.equal((await client.companyOcrUsageEvent.findUniqueOrThrow({ where: { id: eventId(second) } })).billingReceiptGrantId, team.lotId);
    // The existing usage contract keeps its meaning: add-on units are a separate balance (spec §17.3).
    const snapshot = await receiptQuotaSnapshot(prisma, s.companyId);
    assert.deepEqual([snapshot.cadence, snapshot.planLimit, snapshot.usedCount], ['PAID_GRANTS', 1, 1]);
  });

  it('never lets two months take the last unit of one lot (lock order §8.3)', async () => {
    const s = await shop(1);
    const race = await Promise.all([admit(s, 'm-1', { monthKey: '2026-09' }), admit(s, 'm-2', { monthKey: '2026-10' })]);
    assert.equal(race.filter((decision) => decision.allowed).length, 1);
    assert.equal(race.filter((decision) => !decision.allowed && decision.reason === 'plan_exceeded').length, 1);
    assert.equal((await ledger(s)).filter((row) => row.kind === 'RESERVE').length, 1);
  });

  it('keeps a late outcome of an older generation off the newer reservation', async () => {
    const s = await shop(1);
    const old = eventId(await admit(s, 'op'));
    assert.equal(await releaseCompanyOcrAdmission(prisma, { ...identity(s, 'op', old), reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT' }), true);
    const current = eventId(await admit(s, 'op'));
    assert.equal((await client.companyOcrUsageEvent.findUniqueOrThrow({ where: { id: current } })).receiptUnitGeneration, 2);
    assert.equal(await releaseCompanyOcrAdmission(prisma, identity(s, 'op', old)), true);
    assert.equal(await settleCompanyOcrAdmission(prisma, identity(s, 'op', old)), true);
    assert.deepEqual((await ledger(s)).map((row) => `${row.generation}:${row.kind}`), ['1:RESERVE', '1:RELEASE', '2:RESERVE']);
    assert.equal(await used(s), 1, 'generation 2 still holds its unit');
    await settleCompanyOcrAdmission(prisma, identity(s, 'op', current));
    assert.deepEqual((await ledger(s)).map((row) => `${row.generation}:${row.kind}`), ['1:RESERVE', '1:RELEASE', '2:RESERVE', '2:CONSUME']);
  });

  it('keeps the reservation and its generation when resume renews the event id', async () => {
    const s = await shop(1), webhookEventId = `wh-${randomUUID()}`, stuck = new Date(Date.now() - 3_600_000);
    webhookEventIds.push(webhookEventId);
    const line = (extra = {}) => admitCompanyOcr(prisma, { companyId: s.companyId, sourceRoute: 'receipt-ocr-line', requestId: 'line-msg-1',
      monthKey: '2026-09', enforceReceiptQuota: true, singlePageImage: true, ...extra });
    const first = eventId(await line());
    await client.companyOcrUsageEvent.update({ where: { id: first }, data: { createdAt: stuck } });
    // The redelivered turn owns the retry: its own event is fresh while the admission it resumes is old.
    await client.lineWebhookEventLog.create({ data: { webhookEventId, eventType: 'message', status: 'received', companyId: s.companyId,
      processedAt: new Date(), payloadJson: { item: { lineMessageId: 'line-msg-1', companyIdAtAcceptance: s.companyId } } } });
    const resumed = eventId(await line({ retryWebhookEventId: webhookEventId }));
    assert.notEqual(resumed, first);
    assert.equal((await client.companyOcrUsageEvent.findUniqueOrThrow({ where: { id: resumed } })).receiptUnitGeneration, 1);
    assert.equal(await releaseCompanyOcrAdmission(prisma, identity(s, 'line-msg-1', first, 'receipt-ocr-line')), true);
    assert.deepEqual((await ledger(s)).map((row) => row.kind), ['RESERVE'], 'the old execution cannot hand the unit back');
    await settleCompanyOcrAdmission(prisma, identity(s, 'line-msg-1', resumed, 'receipt-ocr-line'));
    assert.deepEqual((await ledger(s)).map((row) => `${row.generation}:${row.kind}`), ['1:RESERVE', '1:CONSUME']);
  });

  it('counts an admission from before the ledger, and the seam pins its source without touching the plan term', async () => {
    const s = await shop(2);
    await client.companyOcrUsageEvent.create({ data: { companyId: s.companyId, monthKey: '2026-09', sourceRoute: 'receipt-ocr-web',
      requestId: 'before-the-ledger', billingReceiptGrantId: s.packageLotId } });
    assert.equal(await used(s), 1, 'a null generation still counts from its event: nothing is backfilled');
    const termBefore = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: s.companyId } });
    const at = new Date('2026-09-29T03:00:00.000Z'), sourceKey = `addon:in_${randomUUID()}`;
    const paid = await grant(s, 20, 'ADD_ON_PAID', sourceKey, at), replay = await grant(s, 20, 'ADD_ON_PAID', sourceKey, new Date());
    assert.deepEqual([replay.replayed, replay.lotId, replay.expiresAt.toISOString()], [true, paid.lotId, appendPackageInterval(at, 'year').toISOString()]);
    await assert.rejects(grant(s, 21, 'ADD_ON_PAID', sourceKey, at), /addon_source_changed/);
    const termAfter = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: s.companyId } });
    assert.equal(termAfter.updatedAt.toISOString(), termBefore.updatedAt.toISOString(), 'no CompanyPlanTerm write: package quotes fence on it (F-19)');
    const legacy = await shop(null);
    await assert.rejects(grant(legacy, 1), /addon_consumer_not_ready/, 'a lot the admission cannot see is never given (spec §15.3)');
    // AO-E15: renewing the package extends package lots only; an add-on lot keeps its own 12 months.
    const packageLot = await client.billingReceiptGrant.findUniqueOrThrow({ where: { id: s.packageLotId! } });
    const extended = appendPackageInterval(packageLot.expiresAt, 'year');
    await client.$transaction((tx) => grantPaidPackageReceipts(tx, { companyId: s.companyId, billingAccountId: s.accountId, sourceKey: `repeat-${randomUUID()}`,
      policyRevisionId: 'TEST_ONLY', kind: 'REPEAT', units: 1, serviceStart: packageLot.expiresAt, serviceEnd: extended, availableAt: new Date(), expiresAt: extended }));
    assert.equal((await client.billingReceiptGrant.findUniqueOrThrow({ where: { id: s.packageLotId! } })).expiresAt.toISOString(), extended.toISOString());
    assert.equal((await client.billingReceiptGrant.findUniqueOrThrow({ where: { id: paid.lotId } })).expiresAt.toISOString(), appendPackageInterval(at, 'year').toISOString());
  });

  it('sends the quota card again after new add-on units, without writing the plan term (AO-E70)', async () => {
    const s = await shop(1);
    assert.equal(await claimReceiptQuotaNotice(prisma, s.companyId, '2026-09'), true);
    assert.equal(await claimReceiptQuotaNotice(prisma, s.companyId, '2026-09'), false);
    assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: s.companyId } })).quotaNoticeSentMonthKey, '2026-09',
      'a shop with no add-on lot keeps the bare month key');
    const lot = await grant(s, 5);
    assert.equal(await claimReceiptQuotaNotice(prisma, s.companyId, '2026-09'), true, 'a new generation of units earns the card again');
    const created = await client.billingReceiptGrant.findUniqueOrThrow({ where: { id: lot.lotId } });
    assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: s.companyId } })).quotaNoticeSentMonthKey, `2026-09#${created.createdAt.getTime()}`);
    assert.equal(await claimReceiptQuotaNotice(prisma, s.companyId, '2026-09'), false);
    await releaseReceiptQuotaNotice(prisma, s.companyId, '2026-09');
    assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: s.companyId } })).quotaNoticeSentMonthKey, null);
  });

  // --- Promotion bonus lot (promotion plan R7, spec Q1/§5; A08, A31) -------------------------------------------------------
  /** A month bought with a free month: the base and the bonus lot, both usable now, both ending at `benefitEnd`. */
  async function promoShop(baseUnits: number, bonusUnits: number) {
    const run = randomUUID().replaceAll('-', ''), companyId = `ledger-${run}`, now = new Date();
    const { paidEnd, benefitEnd } = promotionBoundaries({ serviceStartsAt: now, interval: 'month', bonusMonths: 1 });
    companyIds.push(companyId);
    await client.company.create({ data: { id: companyId, name: 'Synthetic promotion ledger company' } });
    const account = await client.billingAccount.create({ data: { companyId, stripeAccountId: `acct_${run}`, livemode: false } });
    await client.companyPlanTerm.create({ data: { companyId, tierKey: 'STARTER_249', branchLimit: 1, employeeLimit: 3, monthlySlipLimit: 30, termStartAt: now, termEndsAt: benefitEnd } });
    const { base, bonus } = await client.$transaction((tx) => grantPromotionPackageReceipts(tx, { companyId, billingAccountId: account.id, invoiceId: `in_${run}`,
      policyRevisionId: 'TEST_ONLY', kind: 'INITIAL', baseUnits, bonusUnits, serviceStart: now, paidEnd, benefitEnd, availableAt: now }));
    return { companyId, accountId: account.id, packageLotId: base.id, bonusLotId: bonus.id, now, paidEnd, benefitEnd };
  }
  const lotOf = async (eventId: string) => (await client.companyOcrUsageEvent.findUniqueOrThrow({ where: { id: eventId } })).billingReceiptGrantId;
  /** The lot runs out of time under a reservation: its whole window moves into the past (the CHECK still holds), as if the clock had passed it. */
  const expireLot = (lotId: string) => {
    const end = new Date(Date.now() - 3_600_000), start = new Date(end.getTime() - 3_600_000);
    return client.billingReceiptGrant.update({ where: { id: lotId }, data: { serviceStart: start, availableAt: start, serviceEnd: end, expiresAt: end } });
  };
  const expiryOf = async (lotId: string) => (await client.billingReceiptGrant.findUniqueOrThrow({ where: { id: lotId } })).expiresAt.toISOString();

  it('draws the bonus first, carries the base but never the bonus on a repeat, and leaves 60 after the free month — real admissions (A31, Q1)', async () => {
    const s = await promoShop(30, 30), ids: string[] = [];
    for (let i = 0; i < 20; i += 1) ids.push(eventId(await admit(s, `use-${i}`)));
    assert.deepEqual([...new Set(await Promise.all(ids.map(lotOf)))], [s.bonusLotId], 'all 20 reads take the bonus lot, though the base row is the older one');
    for (const [i, id] of ids.entries()) assert.equal(await settleCompanyOcrAdmission(prisma, identity(s, `use-${i}`, id)), true);
    const remaining = async (at: Date) => Object.fromEntries((await receiptLots(client, visibleReceiptLots(s.companyId, s.accountId, at))).map((lot) => [lot.kind, lot.remaining]));
    assert.deepEqual(await remaining(new Date()), { INITIAL: 30, PROMOTION: 10 }, 'base 30 + bonus 10');
    // A normal repeat before the free month ends carries the BASE lot to its new end; the bonus keeps its own date.
    const extended = appendPackageInterval(s.benefitEnd, 'month');
    const repeat = await client.$transaction((tx) => grantPaidPackageReceipts(tx, { companyId: s.companyId, billingAccountId: s.accountId, sourceKey: `repeat-${randomUUID()}`,
      policyRevisionId: 'TEST_ONLY', kind: 'REPEAT', units: 30, serviceStart: s.benefitEnd, serviceEnd: extended, availableAt: new Date(), expiresAt: extended }));
    assert.deepEqual([await expiryOf(s.packageLotId), await expiryOf(s.bonusLotId), await expiryOf(repeat.id)], [extended.toISOString(), s.benefitEnd.toISOString(), extended.toISOString()]);
    const during = await paidReceiptBalance(client, s.companyId, s.accountId, new Date(), true);
    assert.deepEqual([during.remaining, during.nextGrantId], [70, s.bonusLotId], 'the bonus still goes first: it ends first');
    const after = await paidReceiptBalance(client, s.companyId, s.accountId, new Date(s.benefitEnd.getTime() + 1), true);
    assert.deepEqual([after.limit, after.remaining], [60, 60], 'after the free month: base 30 + repeat 30 — not 40 (base drawn first), not 70 (bonus carried)');
  });

  it('lets a bonus unit reserved before its lot expires finish after it: the use is charged, a release never gives the unit back (A08)', async () => {
    const s = await promoShop(2, 2);
    const used = eventId(await admit(s, 'late-use')), failed = eventId(await admit(s, 'late-fail'));
    assert.deepEqual(await Promise.all([used, failed].map(lotOf)), [s.bonusLotId, s.bonusLotId]);
    await expireLot(s.bonusLotId);
    assert.equal(await lotOf(eventId(await admit(s, 'during'))), s.packageLotId, 'an expired lot admits nothing new: the base lot serves the next read');
    assert.equal(await settleCompanyOcrAdmission(prisma, identity(s, 'late-use', used)), true, 'a read admitted on time finishes and is charged');
    assert.equal(await releaseCompanyOcrAdmission(prisma, { ...identity(s, 'late-fail', failed), reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT' }), true);
    const [bonus] = await receiptLots(client, { id: s.bonusLotId });
    assert.deepEqual([bonus!.consumed, bonus!.reserved, bonus!.remaining], [1, 0, 1], 'the released unit returns to its own lot — which is expired');
    const balance = await paidReceiptBalance(client, s.companyId, s.accountId, new Date(), true);
    assert.deepEqual([balance.limit, balance.remaining, balance.nextGrantId], [2, 1, s.packageLotId], 'only the base lot is left to draw');
    assert.equal(await lotOf(eventId(await admit(s, 'after'))), s.packageLotId);
    const refused = await admit(s, 'nothing-left');
    assert.ok(!refused.allowed && refused.reason === 'plan_exceeded', 'the released bonus unit did not come back');
  });

  it('keeps an admission on the lot it reserved: a replay is refused, and a resume after that lot expired is refused too — never moved to the base lot (A31)', async () => {
    const s = await promoShop(2, 2), webhookEventId = `wh-${randomUUID()}`, stuck = new Date(Date.now() - 3_600_000);
    webhookEventIds.push(webhookEventId);
    const line = (extra = {}) => admitCompanyOcr(prisma, { companyId: s.companyId, sourceRoute: 'receipt-ocr-line', requestId: 'line-msg-promo',
      monthKey: '2026-09', enforceReceiptQuota: true, singlePageImage: true, ...extra });
    const first = eventId(await line());
    assert.equal(await lotOf(first), s.bonusLotId);
    const replay = await line();
    assert.ok(!replay.allowed && replay.reason === 'duplicate', 'the same read is one operation');
    await expireLot(s.bonusLotId);
    await client.companyOcrUsageEvent.update({ where: { id: first }, data: { createdAt: stuck } });
    await client.lineWebhookEventLog.create({ data: { webhookEventId, eventType: 'message', status: 'received', companyId: s.companyId,
      processedAt: new Date(), payloadJson: { item: { lineMessageId: 'line-msg-promo', companyIdAtAcceptance: s.companyId } } } });
    const resumed = await line({ retryWebhookEventId: webhookEventId });
    assert.ok(!resumed.allowed && resumed.reason === 'plan_inactive', 'the lot that served the read ended: no re-admission, and no other lot is chosen');
    assert.deepEqual((await ledger(s)).map((row) => [row.grantId, row.kind]), [[s.bonusLotId, 'RESERVE']], 'one reservation, on the bonus lot');
    assert.equal(await lotOf(first), s.bonusLotId);
  });

  it('leaves trial-carryover, Admin and add-on lots on their own expiry and group beside a bonus lot, through a repeat and every draw (A08)', async () => {
    const s = await promoShop(2, 2), run = randomUUID();
    const common = { companyId: s.companyId, sourceHash: 'c'.repeat(64), policyRevisionId: 'TEST_ONLY', serviceStart: s.now, availableAt: s.now };
    const adminEnd = new Date(Date.now() + 3 * 86_400_000);
    // The carry-over ends with the PAID period (promotion plan G13); the Admin gift ends on its own date, with no account.
    const carry = await client.billingReceiptGrant.create({ data: { ...common, billingAccountId: s.accountId, sourceKey: `trial:${run}`, kind: 'TRIAL_CARRYOVER', units: 1,
      serviceEnd: s.paidEnd, expiresAt: s.paidEnd } });
    const gift = await client.billingReceiptGrant.create({ data: { ...common, billingAccountId: null, sourceKey: `admin:${run}`, kind: 'ADMIN_ADJUSTMENT', units: 1,
      serviceEnd: adminEnd, expiresAt: adminEnd } });
    const team = await grant(s, 1, 'ADD_ON_ADMIN'), paid = await grant(s, 1, 'ADD_ON_PAID');
    const own = [carry.id, gift.id, team.lotId, paid.lotId, s.bonusLotId];
    const expiries = () => Promise.all(own.map(expiryOf));
    const before = await expiries();
    const extended = appendPackageInterval(s.benefitEnd, 'month');
    await client.$transaction((tx) => grantPaidPackageReceipts(tx, { companyId: s.companyId, billingAccountId: s.accountId, sourceKey: `repeat-${run}`,
      policyRevisionId: 'TEST_ONLY', kind: 'REPEAT', units: 1, serviceStart: s.benefitEnd, serviceEnd: extended, availableAt: new Date(), expiresAt: extended }));
    assert.deepEqual(await expiries(), before, 'the repeat moved none of them');
    assert.equal(await expiryOf(s.packageLotId), extended.toISOString(), 'it carried the base lot only');
    const kindOf = async (requestId: string, extra: Partial<Parameters<typeof admitCompanyOcr>[1]> = {}) => {
      const decision = await admit(s, requestId, extra);
      return decision.allowed ? (await client.billingReceiptGrant.findUniqueOrThrow({ where: { id: (await lotOf(decision.eventId))! } })).kind : decision.reason;
    };
    const pdf = { sourceRoute: 'receipt-capture-web', singlePageImage: false } as const;
    const order: string[] = [];
    for (let i = 0; i < 7; i += 1) order.push(await kindOf(`pdf-${i}`, pdf));
    assert.deepEqual(order, ['TRIAL_CARRYOVER', 'PROMOTION', 'PROMOTION', 'INITIAL', 'INITIAL', 'REPEAT', 'ADMIN_ADJUSTMENT'],
      'package lots by expiry (the bonus before the base on a tie), then the team lot; a PDF may draw all of them');
    assert.equal(await kindOf('pdf-last', pdf), 'plan_exceeded', 'only add-on units are left, and a PDF never draws them');
    assert.deepEqual([await kindOf('image-1'), await kindOf('image-2'), await kindOf('image-3')], ['ADD_ON_ADMIN', 'ADD_ON_PAID', 'plan_exceeded']);
  });
});
