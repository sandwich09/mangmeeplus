/**
 * The Admin campaign API against real PostgreSQL (docs/plans/starter-249-bonus-month-promotion-plan.md §6, lane C; spec §4 and §6
 * "Fence ของเพดานและ publication"; A19, A23–A26, A28, A36). A release gate for the parts only a database shows: the draft that is a
 * BillingOperation, the campaigns column on the ACTIVE revision, the publication workflow, the fence that serialises a publication,
 * a pause or an end with a reservation, and the report's one statement over redemptions and invoices.
 *
 * Each test runs in its own Stripe account id, so its settings, revisions, drafts and campaigns start clean. `validateProvider` (the
 * Stripe round trip for every bound Price) is the one thing replaced; submit, approve and the publication around it are the real ones.
 *
 * Run with:
 *   BILLING_PROMOTION_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-promotion-campaigns.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, BILLING_PERMISSIONS, billingOffer, type BillingConfigurationOperation, type BillingPolicy, type BillingPromotionCampaign,
  type BillingPromotionCampaignDraft, type BillingPromotionSnapshot } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { BillingAdminService } from './application/billing-admin.service';
import { BillingConfigurationService } from './application/billing-configuration.service';
import { BillingService } from './application/billing.service';
import { consumePromotion, lockPromotionFence, promotionEligibility, promotionEnvironment, promotionOffers, promotionUsage, reservePromotion } from './application/billing-promotion';
import { configurationHash } from './domain/billing-policy';
import { promotionBoundaries } from './domain/billing-package';
import { promotionOfferSignature } from './domain/billing-promotion';

const databaseUrl = process.env.BILLING_PROMOTION_TEST_DATABASE_URL;
const tax = BILLING_DRAFT_POLICY.taxTreatment, HOUR = 3_600_000, DAY = 86_400_000;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
type Admin = { userId: string; membershipId: string; sessionId: string };
type Shop = { companyId: string; accountId: string };
type Values = Omit<BillingPromotionCampaignDraft, 'campaignId'>;

/** The `code` an HTTP exception carries. */
const codeOf = (error: unknown) => ((error as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined)?.code;
const refused = (promise: Promise<unknown>, code: string) => assert.rejects(promise, error => { assert.equal(codeOf(error), code); return true; });
const forbidden = (promise: Promise<unknown>) => assert.rejects(promise, (error: { getStatus?: () => number }) => error.getStatus?.() === 403);

describe('promotion campaigns, Admin API, on PostgreSQL', { skip: !databaseUrl }, () => {
  let client: PrismaClient, service: BillingConfigurationService, billing: BillingService, platformId = '', adminA: Admin, adminB: Admin, adminC: Admin;
  const run = randomUUID().replaceAll('-', '').slice(0, 12), userIds: string[] = [], companyIds: string[] = [], accounts: string[] = [], invoiceIds: string[] = [];
  const stripe = { enabled: true, accountId: '', livemode: false, assertAccount: async () => undefined, request: async () => ({}) };
  let sequence = 0;
  const next = () => (sequence += 1);
  const key = (name: string) => `${name}-${run}-${next()}`;

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_ci'), 'only a disposable local *_ci database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    billing = new BillingService({ client } as never, {} as never, stripe as never);
    service = new BillingConfigurationService({ client } as never, new BillingAdminService({ client } as never, billing), billing);
    (service as unknown as { validateProvider: () => Promise<void> }).validateProvider = async () => undefined;
    platformId = `campaign-platform-${run}`;
    companyIds.push(platformId);
    await client.company.create({ data: { id: platformId, name: 'Platform (campaign spec)' } });
    const role = await client.role.upsert({ where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } }, update: { isSystem: true, status: 'ACTIVE' },
      create: { scopeKey: 'system', key: 'SYSTEM_ADMIN', name: 'System Admin', isSystem: true } });
    for (const permission of BILLING_PERMISSIONS) {
      const row = await client.permission.upsert({ where: { key: permission }, update: {}, create: { key: permission, description: permission } });
      await client.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: row.id } }, update: {}, create: { roleId: role.id, permissionId: row.id } });
    }
    // The password confirmation lasts five minutes from `billingReauthenticatedAt`; one dated ahead keeps A and B confirmed for the whole run. C never confirmed.
    const admin = async (name: string, confirmed: boolean): Promise<Admin> => {
      const userId = `campaign-${name}-${run}`;
      userIds.push(userId);
      await client.user.create({ data: { id: userId, displayName: `Admin ${name}` } });
      const credential = await client.userCredential.create({ data: { userId, passwordHash: 'synthetic-not-a-real-hash' } });
      const membership = await client.companyMembership.create({ data: { companyId: platformId, userId } });
      await client.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      const session = await client.authSession.create({ data: { userId, tokenId: `campaign-token-${name}-${run}`, expiresAt: new Date(Date.now() + 6 * HOUR),
        ...(confirmed ? { billingReauthenticatedAt: new Date(Date.now() + 3 * HOUR), billingCredentialVersion: credential.updatedAt } : {}) } });
      return { userId, membershipId: membership.id, sessionId: session.id };
    };
    adminA = await admin('a', true);
    adminB = await admin('b', true);
    adminC = await admin('c', false);
  });
  after(async () => {
    await client.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { companyId: { in: companyIds } }] } });
    await client.billingPromotionRedemption.deleteMany({ where: { stripeAccountId: { in: accounts } } });
    await client.billingInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await client.billingOperation.deleteMany({ where: { stripeAccountId: { in: accounts } } });
    await client.billingSettings.deleteMany({ where: { stripeAccountId: { in: accounts } } });
    await client.billingPolicyRevision.deleteMany({ where: { stripeAccountId: { in: accounts } } });
    await client.billingAccount.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await client.userCredential.deleteMany({ where: { userId: { in: userIds } } });
    await client.companyMembership.deleteMany({ where: { userId: { in: userIds } } });
    await client.user.deleteMany({ where: { id: { in: userIds } } });
    await client.company.deleteMany({ where: { id: { in: companyIds } } });
    await client.$disconnect();
  });

  const ctx = (admin: Admin, permissions: readonly string[] = BILLING_PERMISSIONS): RequestContext => ({ requestId: randomUUID(), authSubject: admin.userId, authProvider: 'system',
    userId: admin.userId, companyId: platformId, membershipId: admin.membershipId, sessionId: admin.sessionId, roles: ['SYSTEM_ADMIN'], scopes: {}, permissions: [...permissions] });
  const readOnly = (admin: Admin) => ctx(admin, ['system.billing.read']);

  /** A fresh Stripe account id: its own settings (version 1), ACTIVE revision and gates, so no test sees another's campaigns. */
  async function mode(policy: BillingPolicy = BILLING_DRAFT_POLICY, gates: Record<string, boolean> = {}) {
    stripe.accountId = `acct_campaign_${run}_${next()}`;
    accounts.push(stripe.accountId);
    const revision = await client.billingPolicyRevision.create({ data: { stripeAccountId: stripe.accountId, livemode: false, version: 1, state: 'ACTIVE', policyJson: policy as never,
      createdByUserId: adminA.userId } });
    await client.billingSettings.create({ data: { id: `${stripe.accountId}:test`, stripeAccountId: stripe.accountId, livemode: false, gatesJson: gates, policyRevisionId: revision.id, version: 1 } });
  }
  const settings = () => billing.settings();
  const version = async () => (await settings()).settings.version;
  const revisions = () => client.billingPolicyRevision.count({ where: { stripeAccountId: stripe.accountId } });
  const activeJson = async () => (await client.billingPolicyRevision.findUniqueOrThrow({ where: { id: (await settings()).settings.policyRevisionId! } })).promotionJson;
  const published = async () => (await activeJson() ?? {}) as Record<string, BillingPromotionCampaign>;

  /** Starter month + year, one free month and 30 receipts each, open for two hours around now. */
  const starter = (over: Partial<Values> = {}): Values => ({ type: 'BONUS_MONTHS', internalName: `Starter bonus ${run}`, description: null, displayName: 'ซื้อ 1 เดือน ฟรี 1 เดือน',
    startsAt: at(-HOUR), endsAt: at(HOUR), cap: 5, ...over,
    rules: over.rules ?? [{ offerKey: 'STARTER_249', interval: 'month', bonusMonths: 1, bonusReceiptUnits: 30 }, { offerKey: 'STARTER_249', interval: 'year', bonusMonths: 1, bonusReceiptUnits: 30 }] });
  const save = (values: Values, extra: { campaignId?: string; draftVersion?: number } = {}, by = adminA, draftKey = key('draft')) =>
    service.savePromotionDraft(ctx(by), { ...extra, values, reason: 'ตรวจแคมเปญ' }, draftKey);
  const preview = async (campaignId: string, draftVersion: number | undefined, action: 'PUBLISH' | 'RESUME' = 'PUBLISH', by = adminA) =>
    service.previewPromotion(ctx(by), campaignId, { expectedVersion: await version(), ...(draftVersion === undefined ? {} : { draftVersion }), action, reason: 'ขอเปิดแคมเปญ' });
  /** Submit, then approve: by the same admin (single-admin confirmation) or by a genuine second reviewer. */
  async function publish(operation: BillingConfigurationOperation, by = adminA, approver = by) {
    const submitted = await service.submit(ctx(by), operation.id, operation.version, operation.previewHash, key('submit'));
    return service.approve(ctx(approver), operation.id, submitted.version, submitted.previewHash);
  }
  async function create(values = starter(), by = adminA) {
    const saved = await save(values, {}, by), previewed = await preview(saved.campaign.campaignId, saved.campaign.draft!.version, 'PUBLISH', by);
    await publish(previewed.operation, by);
    return saved.campaign.campaignId;
  }
  /** A policy change through the general settings workflow. */
  async function publishPolicy(policy: BillingPolicy) {
    const operation = await service.preview(ctx(adminA), { type: 'PUBLISH_POLICY', expectedVersion: await version(), policy, gates: (await settings()).gates, reason: 'ปรับนโยบายสำหรับทดสอบ' });
    return publish(operation);
  }
  const detail = (id: string) => service.promotionCampaign(ctx(adminA), id);
  const view = async (id: string) => (await detail(id)).campaign;

  async function shop(): Promise<Shop> {
    const companyId = `campaign-shop-${run}-${next()}`;
    companyIds.push(companyId);
    await client.company.create({ data: { id: companyId, name: `ร้านทดสอบ ${companyId.slice(-4)}` } });
    return { companyId, accountId: (await client.billingAccount.create({ data: { companyId, stripeAccountId: stripe.accountId, livemode: false } })).id };
  }
  /** The quote a buyer accepts: pinned before whatever the test does to the campaign next. */
  async function quote(campaignId: string, s: Shop, interval: 'month' | 'year' = 'month'): Promise<BillingPromotionSnapshot> {
    const state = await settings(), result = await promotionEligibility(client, { settings: state, companyId: s.companyId, campaignId, offer: billingOffer('STARTER_249', interval, state.policy),
      tax: state.policy!.taxTreatment, now: new Date() });
    assert.ok(result.ok, JSON.stringify(result));
    return result.snapshot;
  }
  const attempt = () => `attempt-${randomUUID()}`;
  /** Checkout's order: the fence first, then the reservation; `hold` keeps the transaction open to overlap another command. */
  const reserve = (s: Shop, snapshot: BillingPromotionSnapshot, attemptId = attempt(), hold = 0) => client.$transaction(async tx => {
    await lockPromotionFence(tx, promotionEnvironment(false));
    const result = await reservePromotion(tx, { snapshot, stripeAccountId: stripe.accountId, livemode: false, billingAccountId: s.accountId, companyId: s.companyId, attemptId, policyRevisionId: 'spec' });
    if (hold) await sleep(hold);
    return result;
  });

  it('saves an incomplete draft, reloads it with what is missing, and keeps it out of the active revision, the quote and the package page (A23)', async () => {
    await mode();
    const versionBefore = await version(), name = 'Starter 249 โปรแรก';
    const created = await service.savePromotionDraft(ctx(adminA), { values: { internalName: name }, reason: 'เริ่มร่าง' }, key('create'));
    const id = created.campaign.campaignId;
    assert.match(id, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/, 'the server mints the id');
    assert.deepEqual([created.campaign.status, created.campaign.published, created.campaign.pendingOperationId, created.operation, created.previewRows], ['DRAFT', null, null, null, []]);
    assert.deepEqual(created.campaign.draft?.values, { campaignId: id, internalName: name });
    assert.deepEqual(created.campaign.draft?.validationErrors.map(item => `${item.field}:${item.code}`).sort(),
      ['cap:REQUIRED', 'displayName:REQUIRED', 'endsAt:REQUIRED', 'rules:REQUIRED', 'startsAt:REQUIRED', 'type:REQUIRED']);
    assert.deepEqual(created.campaign.allowedActions, ['EDIT', 'DISCARD_DRAFT'], 'an incomplete draft cannot be previewed');
    // Reload: the same draft, the same list of what is missing; the campaign is in the list although nothing is published.
    assert.deepEqual((await detail(id)).campaign.draft, created.campaign.draft);
    const list = await service.promotionCampaigns(ctx(adminA));
    assert.deepEqual([list.mode, list.settingsVersion, list.campaigns.map(item => item.campaignId), list.template.rules.map(rule => rule.interval)], ['TEST', versionBefore, [id], ['month', 'year']]);

    // It touches nothing a customer sees: no campaign in the ACTIVE revision, none for a quote or the package page, no version bump, no usage.
    const state = await settings(), buyer = await shop();
    assert.deepEqual([state.promotions, await activeJson(), state.settings.version], [{}, null, versionBefore]);
    assert.deepEqual(await promotionEligibility(client, { settings: state, companyId: buyer.companyId, offer: billingOffer('STARTER_249', 'month', state.policy), tax, now: new Date() }), { ok: false, reason: 'OFFER_NOT_COVERED' });
    assert.deepEqual(await promotionOffers(client, { settings: state, companyId: buyer.companyId, offers: [billingOffer('STARTER_249', 'month', state.policy)], tax, now: new Date() }), []);
    assert.deepEqual(await promotionUsage(client, 'TEST', id), { reserved: 0, consumed: 0, taken: 0 });
    // Drafts are not configuration changes: the general list never shows one and its detail route cannot open one.
    assert.deepEqual((await service.list(ctx(adminA))).items, []);
    await assert.rejects(service.get(ctx(adminA), created.campaign.draft!.operationId), NotFoundException);

    // Completing it needs the draft's version; then the preview rows show 2 months / 60 receipts and 13 months / 390 (A23).
    await refused(save(starter(), { campaignId: id, draftVersion: 7 }), 'CONTROL_PREVIEW_STALE');
    await refused(save(starter(), { campaignId: id }), 'CONTROL_PREVIEW_STALE');
    const complete = await save(starter(), { campaignId: id, draftVersion: 0 });
    assert.deepEqual([complete.campaign.draft?.version, complete.campaign.draft?.validationErrors, complete.campaign.allowedActions], [1, [], ['EDIT', 'DISCARD_DRAFT', 'PREVIEW']]);
    const [month, year] = complete.previewRows;
    assert.deepEqual([month!.interval, month!.paidMonths, month!.bonusMonths, month!.totalMonths, month!.baseReceiptUnits, month!.bonusReceiptUnits, month!.totalReceiptUnits, month!.priceSatang, month!.totalSatang, month!.blockers],
      ['month', 1, 1, 2, 30, 30, 60, 24900, 24900, []]);
    assert.deepEqual([year!.interval, year!.paidMonths, year!.bonusMonths, year!.totalMonths, year!.baseReceiptUnits, year!.bonusReceiptUnits, year!.totalReceiptUnits, year!.priceSatang, year!.blockers],
      ['year', 12, 1, 13, 360, 30, 390, 249000, []]);
    for (const row of complete.previewRows) {
      const { paidEnd, benefitEnd } = promotionBoundaries({ serviceStartsAt: new Date(row.exampleStartsAt), interval: row.interval, bonusMonths: 1 });
      assert.deepEqual([row.paidEnd, row.benefitEnd, row.renewalTotalSatang], [paidEnd.toISOString(), benefitEnd.toISOString(), row.totalSatang]);
    }

    // A retried create does not make a second campaign (A26); the same key with other content is refused.
    const retryKey = key('retry'), values = starter();
    const first = await service.savePromotionDraft(ctx(adminA), { values, reason: 'ร่างซ้ำ' }, retryKey);
    const again = await service.savePromotionDraft(ctx(adminA), { values, reason: 'ร่างซ้ำ' }, retryKey);
    assert.equal(again.campaign.campaignId, first.campaign.campaignId);
    assert.equal(await client.billingOperation.count({ where: { stripeAccountId: stripe.accountId, type: 'PROMOTION_CAMPAIGN_DRAFT' } }), 2);
    await refused(service.savePromotionDraft(ctx(adminA), { values: { ...values, cap: 9 }, reason: 'ร่างซ้ำ' }, retryKey), 'CONTROL_PREVIEW_STALE');
    // ...and a retried save of an existing draft is answered, not applied twice.
    const editKey = key('edit'), edited = await save({ ...values, cap: 7 }, { campaignId: first.campaign.campaignId, draftVersion: 0 }, adminA, editKey);
    const edited2 = await save({ ...values, cap: 7 }, { campaignId: first.campaign.campaignId, draftVersion: 0 }, adminA, editKey);
    assert.deepEqual([edited.campaign.draft?.version, edited2.campaign.draft?.version, edited2.campaign.draft?.values.cap], [1, 1, 7]);
    // The create key still answers after later saves.
    assert.equal((await service.savePromotionDraft(ctx(adminA), { values, reason: 'ร่างซ้ำ' }, retryKey)).campaign.campaignId, first.campaign.campaignId);
    // A campaign that does not exist cannot be given a draft by naming an id.
    await assert.rejects(save(starter(), { campaignId: 'not-a-campaign' }), (error: unknown) => codeOf(error) === 'CONTROL_PROMOTION_NOT_FOUND');
    await assert.rejects(detail('not-a-campaign'), (error: unknown) => codeOf(error) === 'CONTROL_PROMOTION_NOT_FOUND');
  });

  it('publishes through submit and approve with revision 1 and pinned signatures; a later policy publication keeps the campaign untouched (R1, A24)', async () => {
    await mode();
    const versionBefore = await version(), policyBefore = (await settings()).policy!;
    const saved = await save(starter()), id = saved.campaign.campaignId, draftOperation = saved.campaign.draft!.operationId;
    const previewed = await preview(id, saved.campaign.draft!.version);
    const campaign = previewed.operation.proposed.promotions![id]!;
    // Built on the server: revision 1, not paused, not ended, each rule pinned to the catalog offer it was previewed against.
    assert.deepEqual([previewed.operation.type, previewed.operation.state, previewed.operation.proposed.campaignId, campaign.revision, campaign.paused, campaign.endedAt, campaign.cap, previewed.operation.impact],
      ['PUBLISH_POLICY', 'PREVIEW', id, 1, false, null, 5, null]);
    for (const rule of campaign.rules) assert.equal(rule.offerSignature, promotionOfferSignature(billingOffer('STARTER_249', rule.interval, policyBefore), tax));
    assert.deepEqual(previewed.previewRows.map(row => [row.interval, row.totalMonths, row.totalReceiptUnits, row.blockers]), [['month', 2, 60, []], ['year', 13, 390, []]]);
    // It carries the current policy and gates unchanged, and a preview publishes nothing.
    assert.deepEqual(previewed.operation.proposed.policy, policyBefore);
    assert.deepEqual(previewed.operation.proposed.gates, (await settings()).gates);
    assert.equal(await activeJson(), null);
    const pending = await view(id);
    assert.deepEqual([pending.status, pending.pendingOperationId, pending.allowedActions], ['DRAFT', previewed.operation.id, ['EDIT', 'DISCARD_DRAFT', 'PREVIEW', 'SUBMIT', 'CANCEL']]);

    const submitted = await service.submit(ctx(adminA), previewed.operation.id, previewed.operation.version, previewed.operation.previewHash, key('submit'));
    const awaiting = await view(id);
    assert.deepEqual([awaiting.status, awaiting.allowedActions], ['AWAITING_APPROVAL', ['EDIT', 'DISCARD_DRAFT', 'PREVIEW', 'APPROVE', 'CANCEL']]);
    assert.equal((await detail(id)).operation?.id, previewed.operation.id);
    // A second reviewer confirms it; the campaign is then in the ACTIVE revision exactly as previewed.
    const done = await service.approve(ctx(adminB), previewed.operation.id, submitted.version, submitted.previewHash);
    assert.deepEqual([done.state, done.approvalMode, done.activeRevisionId === (await settings()).settings.policyRevisionId], ['SUCCEEDED', 'SECOND_REVIEWER', true]);
    const live = await published();
    assert.deepEqual(live[id], campaign);
    assert.equal(await version(), versionBefore + 1);
    assert.equal(configurationHash((await settings()).policy), configurationHash(policyBefore), 'the policy is the one it was');
    const after = await view(id);
    assert.deepEqual([after.status, after.draft, after.pendingOperationId, after.usage, after.allowedActions], ['ACTIVE', null, null, { reserved: 0, consumed: 0, taken: 0, cap: 5 }, ['EDIT', 'PAUSE', 'END']]);
    assert.equal((await client.billingOperation.findUniqueOrThrow({ where: { id: draftOperation } })).state, 'SUCCEEDED', 'the draft it came from is closed');
    // A buyer's quote now sees it, and a reservation is taken against it.
    const buyer = await shop();
    assert.equal(await reserve(buyer, await quote(id, buyer)), true);

    // R1: a general policy publication writes the campaigns back as they are; it can never drop or change one.
    const jsonBefore = await activeJson(), revisionsBefore = await revisions();
    await publishPolicy({ ...BILLING_DRAFT_POLICY, graceDays: 5 });
    assert.equal(await revisions(), revisionsBefore + 1);
    assert.equal((await settings()).policy?.graceDays, 5);
    assert.deepEqual(await activeJson(), jsonBefore);
    assert.equal(configurationHash(await activeJson()), configurationHash(jsonBefore));
    assert.deepEqual((await settings()).promotions[id], campaign);
  });

  it('carries the policy exactly as stored through a publication, a pause and an end, so the revision hash an open Checkout was reserved under does not move (R3)', async () => {
    // Stored the way an older revision might hold it: `parseBillingPolicy` would sort these, which would change the hash.
    const [b, a] = [`campaign-cohort-${run}-b`, `campaign-cohort-${run}-a`];
    companyIds.push(a, b);
    await client.company.createMany({ data: [{ id: a, name: 'Cohort A' }, { id: b, name: 'Cohort B' }] });
    await mode({ ...BILLING_DRAFT_POLICY, salesCompanyIds: [b, a] });
    const id = await create();
    await service.setPromotionState(ctx(adminA), id, 'PAUSE', { expectedVersion: await version(), reason: 'พัก' }, key('pause'));
    await service.setPromotionState(ctx(adminA), id, 'END', { expectedVersion: await version(), reason: 'จบ' }, key('end'));
    const revisionRows = await client.billingPolicyRevision.findMany({ where: { stripeAccountId: stripe.accountId }, orderBy: { version: 'asc' } });
    assert.equal(revisionRows.length, 4, 'the first, the publication, the pause, the end');
    for (const row of revisionRows) assert.deepEqual(row.policyJson, revisionRows[0]!.policyJson);
    assert.deepEqual((revisionRows[0]!.policyJson as BillingPolicy).salesCompanyIds, [b, a]);
    assert.deepEqual(revisionRows.map(row => Object.keys((row.promotionJson ?? {}) as object).length), [0, 1, 1, 1]);
  });

  it('refuses a stale settings or draft version, a caller who cannot manage policy, and a second admin whose page is out of date (A19, A26)', async () => {
    await mode();
    const x = await save(starter({ startsAt: at(-HOUR), endsAt: at(HOUR) })), y = await save(starter({ startsAt: at(2 * HOUR), endsAt: at(3 * HOUR) }), {}, adminB);
    const [xid, yid] = [x.campaign.campaignId, y.campaign.campaignId], v = await version(), reason = 'ทดสอบสิทธิ์';
    await refused(service.previewPromotion(ctx(adminA), xid, { expectedVersion: v + 1, draftVersion: 0, action: 'PUBLISH', reason }), 'CONTROL_PREVIEW_STALE');
    await refused(service.previewPromotion(ctx(adminA), xid, { expectedVersion: v, draftVersion: 3, action: 'PUBLISH', reason }), 'CONTROL_PREVIEW_STALE');
    await assert.rejects(service.previewPromotion(ctx(adminA), xid, { expectedVersion: v, action: 'PUBLISH', reason }), (error: { getStatus?: () => number }) => error.getStatus?.() === 400);
    // Reading needs only system.billing.read; every command needs system.billing.policy.manage, and a reader is offered none.
    const reader = readOnly(adminA);
    await forbidden(service.savePromotionDraft(reader, { values: starter(), reason }, key('d')));
    await forbidden(service.discardPromotionDraft(reader, xid, 0));
    await forbidden(service.previewPromotion(reader, xid, { expectedVersion: v, draftVersion: 0, action: 'PUBLISH', reason }));
    await forbidden(service.setPromotionState(reader, xid, 'PAUSE', { expectedVersion: v, reason }, key('p')));
    const asReader = await service.promotionCampaigns(reader);
    assert.deepEqual(asReader.capabilities, ['system.billing.read']);
    assert.deepEqual(asReader.campaigns.map(item => item.allowedActions), [[], []]);
    assert.equal((await service.promotionCampaign(reader, xid)).campaign.draft?.version, 0);

    // Two admins on the same page (version v): B submits his campaign, A's publication lands first, B's approval is refused.
    const forX = await preview(xid, 0, 'PUBLISH', adminA), forY = await preview(yid, 0, 'PUBLISH', adminB);
    const submittedY = await service.submit(ctx(adminB), forY.operation.id, forY.operation.version, forY.operation.previewHash, key('submit-y'));
    await publish(forX.operation, adminA);
    await refused(service.approve(ctx(adminB), forY.operation.id, submittedY.version, submittedY.previewHash), 'CONTROL_PREVIEW_STALE');
    const live = await published();
    assert.deepEqual(Object.keys(live), [xid], 'the stale publication wrote nothing, and did not touch the other campaign');
    // His page is reloaded and he publishes again: both are live, and the first is exactly as it was.
    await publish((await preview(yid, 0, 'PUBLISH', adminB)).operation, adminB);
    const both = await published();
    assert.deepEqual(Object.keys(both).sort(), [xid, yid].sort());
    assert.deepEqual(both[xid], live[xid]);
    assert.equal(both[yid]!.revision, 1);
  });

  it('approves only the draft that was previewed: an edit or a discard in between makes the approval stale (spec §4)', async () => {
    await mode();
    const saved = await save(starter()), id = saved.campaign.campaignId, approveOf = (operation: BillingConfigurationOperation, submitted: BillingConfigurationOperation) =>
      service.approve(ctx(adminA), operation.id, submitted.version, submitted.previewHash);
    const first = await preview(id, 0), submittedFirst = await service.submit(ctx(adminA), first.operation.id, first.operation.version, first.operation.previewHash, key('s1'));
    await save(starter({ cap: 9 }), { campaignId: id, draftVersion: 0 });
    await refused(approveOf(first.operation, submittedFirst), 'CONTROL_PREVIEW_STALE');
    // The edited draft is previewed again and discarded before the approval.
    const second = await preview(id, 1), submittedSecond = await service.submit(ctx(adminA), second.operation.id, second.operation.version, second.operation.previewHash, key('s2'));
    await service.discardPromotionDraft(ctx(adminA), id, 1);
    await refused(approveOf(second.operation, submittedSecond), 'CONTROL_PREVIEW_STALE');
    assert.deepEqual(await published(), {}, 'nothing of the old snapshot went live');
    // Untouched, the same path publishes.
    const again = await save(starter()), previewed = await preview(again.campaign.campaignId, 0);
    await publish(previewed.operation);
    assert.equal(Object.keys(await published()).length, 1);
  });

  it('never reopens a gate that was closed after the preview, and needs a confirmed password for pause and end (A24)', async () => {
    await mode(BILLING_DRAFT_POLICY, { new_sales: true });
    const id = await create(starter()), saved = await save(starter({ cap: 9 }), { campaignId: id });
    const previewed = await preview(id, saved.campaign.draft!.version), submitted = await service.submit(ctx(adminA), previewed.operation.id, previewed.operation.version, previewed.operation.previewHash, key('s'));
    assert.equal(previewed.operation.proposed.gates.new_sales, true, 'the preview copied the gates as they were');
    // An emergency close lands between submit and approve.
    const closed = Object.fromEntries(BILLING_ACTIONS.map(action => [action, false]));
    await service.close(ctx(adminA), { expectedVersion: await version(), gates: closed, reason: 'ปิดการขายฉุกเฉิน' }, key('close'));
    await refused(service.approve(ctx(adminA), previewed.operation.id, submitted.version, submitted.previewHash), 'CONTROL_PREVIEW_STALE');
    assert.equal((await settings()).gates.new_sales, false);
    assert.equal((await published())[id]!.cap, 5, 'the campaign was not changed');
    // Pause needs a confirmed password like the other closing command.
    await refused(service.setPromotionState(ctx(adminC), id, 'PAUSE', { expectedVersion: await version(), reason: 'พัก' }, key('p')), 'CONTROL_REAUTH_REQUIRED');
    assert.equal((await published())[id]!.paused, false);
  });

  it('pauses at once for reservations, resumes through publication without resetting usage, and ends for good while an accepted reservation keeps its right (A25, A26)', async () => {
    await mode();
    const base = starter({ cap: 10 }), id = await create(base), shops = [await shop(), await shop(), await shop()];
    const quotes = await Promise.all(shops.map(s => quote(id, s)));
    const first = attempt();
    assert.equal(await reserve(shops[0]!, quotes[0]!, first), true);

    // --- pause
    const v0 = await version(), revisionsBefore = await revisions(), pauseKey = key('pause'), policyBefore = (await settings()).revision!.policyJson;
    const paused = await service.setPromotionState(ctx(adminA), id, 'PAUSE', { expectedVersion: v0, reason: 'พักชั่วคราว' }, pauseKey);
    assert.deepEqual([paused.campaign.status, paused.campaign.published?.paused, paused.settingsVersion, paused.campaign.allowedActions], ['PAUSED', true, v0 + 1, ['EDIT', 'RESUME', 'END']]);
    assert.deepEqual((await settings()).revision!.policyJson, policyBefore, 'a pause leaves the policy as it was');
    // A retried command answers with the same result and writes nothing again; the same key for another command is refused.
    const replay = await service.setPromotionState(ctx(adminA), id, 'PAUSE', { expectedVersion: v0, reason: 'พักชั่วคราว' }, pauseKey);
    assert.deepEqual([replay.settingsVersion, await revisions(), await version()], [v0 + 1, revisionsBefore + 1, v0 + 1]);
    await refused(service.setPromotionState(ctx(adminA), id, 'END', { expectedVersion: v0, reason: 'พักชั่วคราว' }, pauseKey), 'CONTROL_PREVIEW_STALE');
    await refused(service.setPromotionState(ctx(adminA), id, 'PAUSE', { expectedVersion: v0 + 1, reason: 'พักอีก' }, key('again')), 'CONTROL_PROMOTION_INVALID');
    await refused(service.setPromotionState(ctx(adminA), id, 'PAUSE', { expectedVersion: v0, reason: 'หน้าเก่า' }, key('old')), 'CONTROL_PREVIEW_STALE');
    // Admission stopped as the command returned; the reservation accepted before it did not move.
    assert.equal(await reserve(shops[1]!, quotes[1]!), 'PAUSED');
    const held = await client.billingPromotionRedemption.findUniqueOrThrow({ where: { attemptId: first } });
    assert.deepEqual([held.state, held.companyId], ['RESERVED', shops[0]!.companyId]);
    const afterPause = await view(id);
    assert.deepEqual([afterPause.usage, afterPause.pendingCheckouts], [{ reserved: 1, consumed: 0, taken: 1, cap: 10 }, 1]);

    // --- resume is a publication; usage is not reset and the buyer's earlier quote still holds (a pause is not a change of terms)
    const resume = await preview(id, undefined, 'RESUME');
    assert.deepEqual([resume.operation.proposed.promotions![id]!.paused, resume.operation.proposed.promotions![id]!.revision, resume.operation.referenceId], [false, 1, null]);
    await publish(resume.operation);
    const resumed = await view(id);
    assert.deepEqual([resumed.status, resumed.usage.taken], ['ACTIVE', 1]);
    assert.equal(await reserve(shops[1]!, quotes[1]!), true);
    assert.deepEqual((await view(id)).usage, { reserved: 2, consumed: 0, taken: 2, cap: 10 });
    await refused(preview(id, undefined, 'RESUME'), 'CONTROL_PROMOTION_INVALID');

    // --- end is final: nothing reserves, resumes, edits, pauses or ends it again — and the accepted reservations keep their right
    const ended = await service.setPromotionState(ctx(adminA), id, 'END', { expectedVersion: await version(), reason: 'จบแคมเปญ' }, key('end'));
    assert.deepEqual([ended.campaign.status, typeof ended.campaign.published?.endedAt, ended.campaign.allowedActions], ['ENDED', 'string', []]);
    assert.equal(await reserve(shops[2]!, quotes[2]!), 'ENDED');
    await refused(preview(id, undefined, 'RESUME'), 'CONTROL_PROMOTION_ENDED');
    await refused(save(base, { campaignId: id }), 'CONTROL_PROMOTION_ENDED');
    await refused(service.setPromotionState(ctx(adminA), id, 'END', { expectedVersion: await version(), reason: 'จบอีก' }, key('end2')), 'CONTROL_PROMOTION_ENDED');
    await refused(service.setPromotionState(ctx(adminA), id, 'PAUSE', { expectedVersion: await version(), reason: 'พักหลังจบ' }, key('p2')), 'CONTROL_PROMOTION_ENDED');
    assert.equal(await consumePromotion(client, { attemptId: first, invoiceId: `invoice-${randomUUID()}`, companyId: shops[0]!.companyId, now: new Date() }), true);
    assert.deepEqual(await promotionUsage(client, 'TEST', id), { reserved: 1, consumed: 1, taken: 2 });
    assert.deepEqual((await view(id)).usage, { reserved: 1, consumed: 1, taken: 2, cap: 10 });
  });

  it('takes the fence a reservation takes: a pause waits for a reservation in flight, which keeps its right (A25, A36)', async () => {
    await mode();
    const id = await create(starter({ cap: 3 })), [s1, s2] = [await shop(), await shop()], [q1, q2] = [await quote(id, s1), await quote(id, s2)];
    const holding = reserve(s1, q1, attempt(), 900);
    await sleep(250);
    const started = Date.now();
    const paused = await service.setPromotionState(ctx(adminA), id, 'PAUSE', { expectedVersion: await version(), reason: 'พักระหว่างมีรายการจอง' }, key('pause'));
    assert.ok(Date.now() - started >= 400, 'the pause waited for the fence');
    assert.equal(await holding, true);
    assert.deepEqual([paused.campaign.status, paused.campaign.usage.taken, paused.campaign.pendingCheckouts], ['PAUSED', 1, 1], 'committed before the pause: the right is accepted');
    assert.equal(await reserve(s2, q2), 'PAUSED', 'committed after the pause: refused');
    assert.equal(await client.billingPromotionRedemption.count({ where: { campaignId: id } }), 1);
  });

  it('refuses a second campaign on the same Starter interval in an overlapping window, allows another interval, and holds to the release-1 template (spec §4)', async () => {
    await mode();
    const month = [{ offerKey: 'STARTER_249', interval: 'month', bonusMonths: 1, bonusReceiptUnits: 30 }] as Values['rules'];
    const year = [{ offerKey: 'STARTER_249', interval: 'year', bonusMonths: 1, bonusReceiptUnits: 30 }] as Values['rules'];
    await create(starter({ rules: month, startsAt: at(-HOUR), endsAt: at(HOUR) }));
    const clash = await save(starter({ startsAt: at(HOUR / 2), endsAt: at(3 * HOUR) }));
    assert.deepEqual(clash.previewRows.map(row => [row.interval, row.blockers]), [['month', ['CONTROL_PROMOTION_OVERLAP']], ['year', []]], 'the preview rows already say which rule collides');
    await refused(preview(clash.campaign.campaignId, 0), 'CONTROL_PROMOTION_OVERLAP');
    const other = await save(starter({ rules: year, startsAt: at(-HOUR / 2), endsAt: at(HOUR / 2) }));
    assert.deepEqual(other.previewRows.map(row => row.blockers), [[]]);
    await publish((await preview(other.campaign.campaignId, 0)).operation);
    const later = await save(starter({ startsAt: at(2 * HOUR), endsAt: at(3 * HOUR) })), laterId = later.campaign.campaignId;
    await publish((await preview(laterId, 0)).operation);
    assert.equal(Object.keys(await published()).length, 3);
    // Release 1 carries one template: another tier or two free months is blocked on its row and refused at preview.
    const odd = await save(starter({ rules: [{ offerKey: 'BASIC_499', interval: 'month', bonusMonths: 2, bonusReceiptUnits: 30 }], startsAt: at(5 * HOUR), endsAt: at(6 * HOUR) }));
    assert.deepEqual(odd.previewRows.map(row => row.blockers), [['CONTROL_PROMOTION_INVALID']]);
    await refused(preview(odd.campaign.campaignId, 0), 'CONTROL_PROMOTION_INVALID');
    // A campaign that has not started is SCHEDULED and can be ended; an ended campaign no longer holds its window.
    assert.equal((await view(laterId)).status, 'SCHEDULED');
    await service.setPromotionState(ctx(adminA), laterId, 'END', { expectedVersion: await version(), reason: 'ยกเลิกก่อนเริ่ม' }, key('end-scheduled'));
    assert.equal((await view(laterId)).status, 'ENDED');
    const reuse = await save(starter({ startsAt: at(2 * HOUR), endsAt: at(3 * HOUR) }));
    await publish((await preview(reuse.campaign.campaignId, 0)).operation);
    assert.equal((await view(reuse.campaign.campaignId)).status, 'SCHEDULED');
  });

  it('refuses a cap below reserved + consumed at approval although the preview came first, and accepts exactly what is taken (A36)', async () => {
    await mode();
    const base = starter({ cap: 4 }), id = await create(base), [s1, s2, s3] = [await shop(), await shop(), await shop()];
    const q1 = await quote(id, s1), q2 = await quote(id, s2);
    assert.equal(await reserve(s1, q1), true);
    // One shop holds the right; lowering the cap to 1 is fine at preview. The draft of a published campaign starts from its terms.
    const lower = await service.savePromotionDraft(ctx(adminA), { campaignId: id, values: { cap: 1 }, reason: 'ลดเพดาน' }, key('cap'));
    assert.deepEqual([lower.campaign.draft?.values.cap, lower.campaign.draft?.values.displayName, lower.campaign.draft?.validationErrors, lower.campaign.published?.cap], [1, base.displayName, [], 4]);
    const previewed = await preview(id, lower.campaign.draft!.version);
    assert.equal(previewed.operation.proposed.promotions![id]!.revision, 2, 'a change of terms is the next revision');
    const submitted = await service.submit(ctx(adminA), previewed.operation.id, previewed.operation.version, previewed.operation.previewHash, key('s'));
    // Another shop reserves before the approval. A reservation does not change the settings version, so the preview is not stale — only usage read again can catch it.
    assert.equal(await reserve(s2, q2), true);
    await refused(service.approve(ctx(adminA), previewed.operation.id, submitted.version, submitted.previewHash), 'CONTROL_PROMOTION_CAP_BELOW_USED');
    assert.deepEqual([(await published())[id]!.cap, (await published())[id]!.revision], [4, 1]);
    await service.cancel(ctx(adminA), previewed.operation.id, submitted.version);
    // The cap may go down to exactly what is taken: 2.
    const exact = await save({ ...base, cap: 2 }, { campaignId: id, draftVersion: lower.campaign.draft!.version });
    await publish((await preview(id, exact.campaign.draft!.version)).operation);
    const done = await view(id);
    assert.deepEqual([done.published?.cap, done.published?.revision, done.usage], [2, 2, { reserved: 2, consumed: 0, taken: 2, cap: 2 }]);
    assert.deepEqual(await promotionEligibility(client, { settings: await settings(), companyId: s3.companyId, campaignId: id, offer: billingOffer('STARTER_249', 'month', (await settings()).policy), tax, now: new Date() }),
      { ok: false, reason: 'CAP_FULL' });
  });

  it('serialises an approval with a reservation through the fence: the cap is checked after the reservation commits (A36)', async () => {
    await mode();
    const id = await create(starter({ cap: 3 })), [s1, s2] = [await shop(), await shop()], [q1, q2] = [await quote(id, s1), await quote(id, s2)];
    assert.equal(await reserve(s1, q1), true);
    const lower = await service.savePromotionDraft(ctx(adminA), { campaignId: id, values: { cap: 1 }, reason: 'ลดเพดาน' }, key('cap'));
    const previewed = await preview(id, lower.campaign.draft!.version);
    const submitted = await service.submit(ctx(adminA), previewed.operation.id, previewed.operation.version, previewed.operation.previewHash, key('s'));
    // The second reservation holds the fence and has written its row; the approval starts while it is open and must wait for it.
    const holding = reserve(s2, q2, attempt(), 900);
    await sleep(250);
    const started = Date.now();
    await refused(service.approve(ctx(adminA), previewed.operation.id, submitted.version, submitted.previewHash), 'CONTROL_PROMOTION_CAP_BELOW_USED');
    assert.ok(Date.now() - started >= 400, 'the approval waited for the fence');
    assert.equal(await holding, true);
    assert.deepEqual(await promotionUsage(client, 'TEST', id), { reserved: 2, consumed: 0, taken: 2 });
    assert.equal((await published())[id]!.cap, 3);
  });

  it('marks a published campaign CATALOG_STALE when the catalog changes, and refuses a re-publication the template cannot carry (A28)', async () => {
    await mode();
    const base = starter(), id = await create(base), s = await shop(), pinned = await quote(id, s);
    // The catalog now sells 50 receipts a month (600 a year): the campaign's pinned offers no longer match.
    await publishPolicy({ ...BILLING_DRAFT_POLICY, offerTerms: { STARTER_249: { monthlyPriceSatang: 24900, annualPriceSatang: 249000, monthlyReceiptAllowance: 50 } } });
    const stale = await detail(id);
    assert.deepEqual([stale.campaign.status, stale.campaign.published?.revision], ['CATALOG_STALE', 1]);
    assert.equal(await reserve(s, pinned), 'CATALOG_STALE');
    assert.deepEqual(stale.previewRows.map(row => [row.interval, row.baseReceiptUnits, row.totalReceiptUnits, row.blockers]),
      [['month', 50, 80, ['CONTROL_PROMOTION_INVALID', 'CONTROL_PROMOTION_CATALOG_STALE']], ['year', 600, 630, ['CONTROL_PROMOTION_INVALID', 'CONTROL_PROMOTION_CATALOG_STALE']]]);
    // Re-pinning cannot help: 50 + 30 is not the promised 60. A resume is refused the same way.
    const edit = await save({ ...base, displayName: 'ชื่อใหม่' }, { campaignId: id });
    assert.deepEqual(edit.previewRows.map(row => row.blockers), [['CONTROL_PROMOTION_INVALID'], ['CONTROL_PROMOTION_INVALID']]);
    await refused(preview(id, edit.campaign.draft!.version), 'CONTROL_PROMOTION_INVALID');
    // It is still a campaign: it can be paused, but not resumed while the catalog differs from the one it was pinned to.
    await service.setPromotionState(ctx(adminA), id, 'PAUSE', { expectedVersion: await version(), reason: 'พักระหว่างปรับแพ็กเกจ' }, key('pause'));
    assert.equal((await view(id)).status, 'PAUSED');
    await refused(preview(id, undefined, 'RESUME'), 'CONTROL_PROMOTION_CATALOG_STALE');
    // With the catalog back to the pinned offers the resume goes through, and the campaign is ACTIVE again.
    await publishPolicy(BILLING_DRAFT_POLICY);
    await publish((await preview(id, undefined, 'RESUME')).operation);
    assert.equal((await view(id)).status, 'ACTIVE');
  });

  it('discards a draft: a campaign never published disappears, a published one keeps its terms; newest first', async () => {
    await mode();
    const older = await save(starter({ internalName: 'เก่า' })), newer = await save(starter({ internalName: 'ใหม่' })), olderId = older.campaign.campaignId, newerId = newer.campaign.campaignId;
    assert.deepEqual((await service.promotionCampaigns(ctx(adminA))).campaigns.map(item => item.campaignId), [newerId, olderId]);
    await refused(service.discardPromotionDraft(ctx(adminA), olderId, 4), 'CONTROL_PREVIEW_STALE');
    const list = await service.discardPromotionDraft(ctx(adminA), olderId, 0);
    assert.deepEqual(list.campaigns.map(item => item.campaignId), [newerId]);
    await refused(service.discardPromotionDraft(ctx(adminA), olderId, 0), 'CONTROL_PREVIEW_STALE');
    await refused(preview(olderId, 0), 'CONTROL_PROMOTION_NOT_FOUND');
    // A published campaign: editing opens a draft beside it; discarding it leaves the terms.
    const id = await create(starter({ internalName: 'เผยแพร่แล้ว' })), live = (await published())[id]!;
    const edit = await save({ ...starter(), cap: 8 }, { campaignId: id });
    assert.deepEqual([edit.campaign.draft?.values.cap, edit.campaign.published?.cap], [8, 5]);
    const kept = await service.discardPromotionDraft(ctx(adminA), id, edit.campaign.draft!.version);
    assert.deepEqual(kept.campaigns.map(item => [item.campaignId, item.draft]).filter(([cid]) => cid === id), [[id, null]]);
    assert.deepEqual((await published())[id], live);
    assert.equal((await client.billingOperation.findUniqueOrThrow({ where: { id: edit.campaign.draft!.operationId } })).state, 'CANCELLED');
  });

  it('reports every state, the bonus granted and the money — and withholds the money without the financial permission', async () => {
    await mode();
    const id = await create(starter({ cap: null })), tick = (n: number) => new Date(Date.now() - n * 60_000);
    let order = 0;
    const row = async (state: 'RESERVED' | 'CONSUMED' | 'RELEASED', over: { paid?: number; refunded?: number; applied?: boolean; bonusEnd?: Date; adjusted?: boolean; releaseCount?: number; interval?: 'month' | 'year' } = {}) => {
      const s = await shop(), acceptedAt = tick(order += 1);
      let invoiceId: string | null = null;
      if (state === 'CONSUMED') {
        const invoice = await client.billingInvoice.create({ data: { billingAccountId: s.accountId, providerInvoiceId: `in_${randomUUID()}`, offerSnapshot: {}, productKind: 'PACKAGE', policyRevisionId: 'spec',
          currency: 'THB', totalSatang: over.paid ?? 24900, paidSatang: over.paid ?? 24900, refundedSatang: over.refunded ?? 0, taxSatang: 0, periodStart: acceptedAt,
          periodEnd: new Date(acceptedAt.getTime() + 30 * DAY), providerStatus: 'paid', evidenceHash: 'spec' } });
        invoiceId = invoice.id;
        invoiceIds.push(invoice.id);
      }
      return client.billingPromotionRedemption.create({ data: { promotionEnvironmentId: 'TEST', campaignId: id, companyId: s.companyId, billingAccountId: s.accountId, stripeAccountId: stripe.accountId,
        livemode: false, state, policyRevisionId: 'spec', campaignRevision: 1, termsHash: 'spec', offerKey: 'STARTER_249', interval: over.interval ?? 'month', offerSignature: 'spec', bonusMonths: 1,
        bonusReceiptUnits: 30, attemptId: state === 'RELEASED' ? null : attempt(), invoiceId, acceptedAt, createBy: new Date(acceptedAt.getTime() + 600_000),
        consumedAt: state === 'CONSUMED' ? acceptedAt : null, releasedAt: state === 'RELEASED' ? acceptedAt : null, releaseCount: over.releaseCount ?? 0,
        benefitAppliedAt: over.applied ? acceptedAt : null, paidStart: over.applied ? acceptedAt : null, paidEnd: over.applied ? new Date(acceptedAt.getTime() + 30 * DAY) : null,
        bonusEnd: over.bonusEnd ?? null, entitlementAdjustedAt: over.adjusted ? new Date() : null } });
    };
    const future = new Date(Date.now() + 10 * DAY), past = new Date(Date.now() - DAY);
    const rows = [await row('RESERVED'), await row('CONSUMED'), await row('CONSUMED', { applied: true, bonusEnd: future }),
      await row('CONSUMED', { applied: true, bonusEnd: future, refunded: 10_000 }), await row('CONSUMED', { applied: true, bonusEnd: future, refunded: 24_900 }),
      await row('CONSUMED', { applied: true, bonusEnd: future, refunded: 24_900, adjusted: true }), await row('RELEASED', { releaseCount: 2 }),
      await row('CONSUMED', { applied: true, bonusEnd: past, paid: 249_000, interval: 'year' })];
    const report = await service.promotionCampaignReport(ctx(adminA), id);
    assert.deepEqual(report.counts, { reserved: 1, paidAwaitingApply: 1, applied: 5, releasedBeforePay: 2, refunded: 3, fullyRefunded: 2, rightsActive: 2 });
    assert.deepEqual([report.campaignId, report.mode, report.bonusMonthsGranted, report.bonusReceiptUnitsGranted, report.moneyReceivedSatang, report.refundedSatang, report.nextCursor],
      [id, 'TEST', 5, 150, 5 * 24_900 + 249_000, 59_800, null], 'free months are never money');
    assert.deepEqual(report.companies.map(item => [item.state, item.interval, item.refund, item.entitlementAdjustmentState]), [
      ['RESERVED', 'month', 'NONE', 'NOT_REQUIRED'], ['CONSUMED', 'month', 'NONE', 'NOT_REQUIRED'], ['CONSUMED', 'month', 'NONE', 'NOT_REQUIRED'], ['CONSUMED', 'month', 'PARTIAL', 'NOT_REQUIRED'],
      ['CONSUMED', 'month', 'FULL', 'PENDING'], ['CONSUMED', 'month', 'FULL', 'ADJUSTED'], ['RELEASED', 'month', 'NONE', 'NOT_REQUIRED'], ['CONSUMED', 'year', 'NONE', 'NOT_REQUIRED']], 'newest first');
    const [reserved, , applied, , , , released] = report.companies;
    assert.equal(reserved!.attemptHref, `/system/billing/companies/${rows[0]!.companyId}/checkouts/${rows[0]!.attemptId}`);
    assert.equal(reserved!.invoiceHref, null);
    assert.equal(applied!.invoiceHref, `/system/billing/companies/${rows[2]!.companyId}/invoices/${rows[2]!.invoiceId}`);
    assert.deepEqual([applied!.benefitAppliedAt !== null, applied!.benefitEnd, applied!.paidEnd !== null, released!.attemptHref, released!.invoiceHref, released!.releasedAt !== null],
      [true, future.toISOString(), true, null, null, true]);
    assert.match(report.companies[0]!.companyName, /^ร้านทดสอบ/);
    // Without the financial permission the same page, the same counts, no money.
    const limited = await service.promotionCampaignReport(readOnly(adminA), id);
    assert.deepEqual([limited.counts, limited.moneyReceivedSatang, limited.refundedSatang, limited.companies.length], [report.counts, null, null, 8]);
    await forbidden(service.promotionCampaignReport(ctx(adminA, []), id));
    await assert.rejects(service.promotionCampaignReport(ctx(adminA), 'no-such-campaign'), (error: unknown) => codeOf(error) === 'CONTROL_PROMOTION_NOT_FOUND');

    // Paging by cursor, newest first, no row twice.
    const crowded = `campaign-${run}-crowded`, base = Date.now();
    await client.billingPromotionRedemption.createMany({ data: Array.from({ length: 26 }, (_, index) => ({ promotionEnvironmentId: 'TEST', campaignId: crowded, companyId: `crowd-${run}-${index}`,
      billingAccountId: 'spec', stripeAccountId: stripe.accountId, livemode: false, state: 'RELEASED', policyRevisionId: 'spec', campaignRevision: 1, termsHash: 'spec', offerKey: 'STARTER_249',
      interval: 'month', offerSignature: 'spec', bonusMonths: 1, bonusReceiptUnits: 30, acceptedAt: new Date(base - index * 1000), createBy: new Date(base + 600_000),
      releasedAt: new Date(base), releaseCount: 1 })) });
    const page1 = await service.promotionCampaignReport(ctx(adminA), crowded);
    assert.deepEqual([page1.companies.length, page1.counts.releasedBeforePay, typeof page1.nextCursor], [25, 26, 'string']);
    const page2 = await service.promotionCampaignReport(ctx(adminA), crowded, page1.nextCursor!);
    assert.deepEqual([page2.companies.length, page2.nextCursor, page2.companies[0]!.companyId], [1, null, `crowd-${run}-25`]);
    assert.equal(new Set([...page1.companies, ...page2.companies].map(item => item.companyId)).size, 26);
    await assert.rejects(service.promotionCampaignReport(ctx(adminA), crowded, randomUUID()), (error: unknown) => codeOf(error) === 'CONTROL_PROMOTION_NOT_FOUND');
  });
});
