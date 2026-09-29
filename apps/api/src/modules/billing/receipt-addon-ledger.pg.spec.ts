/**
 * Receipt image ledger and the add-on grant seam (chat credit and receipt image plan PR B; spec §6, §8.3,
 * §15.3, §16; AO-E15, AO-E18–AO-E20, AO-E70) against real PostgreSQL. A release gate: it writes and reads
 * every column `20260929150000_receipt_unit_entries` adds, and proves reserve/consume/release under the
 * company lock, two months racing for one lot, a late release of an older generation, resume, the D4/D8
 * order, and that a new add-on lot starts a new quota-card generation without writing the plan term.
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
import { grantPaidPackageReceipts, paidReceiptBalance } from './application/billing-receipt-grants';
import { appendPackageInterval } from './domain/billing-package';
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
});
