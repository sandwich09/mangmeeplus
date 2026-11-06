import { packageAnchorDay } from '../../billing/domain/billing-package';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { AppConfigService } from '../../../common/config/app-config.service';
import { LineAiBudgetAuthorityService, LineAiBudgetDeadlineExceededError, documentQaAuthorityInputDigest, type IssueLineAiBudgetGrant } from './line-ai-budget-authority.service';
import { settleAiBudgetStep } from './company-ai-budget-reservation';
import { LineConversationContextService } from './line-conversation-context.service';
import type { AiBudgetGrantV2, AiBudgetInvocationV2, AiBudgetProfileIdV2 } from '@watchdog-bms/contracts';
const url = process.env.AI_BUDGET_RESERVATION_TEST_DATABASE_URL;
const model = 'apac.anthropic.claude-3-haiku-20240307-v1:0';
const hash = 'a'.repeat(64);

describe('v2 durable grant and global dispatch fencing on PostgreSQL', { skip: !url }, () => {
  const tag = `grant-${randomUUID().slice(0, 8)}`;
  let client: PrismaClient; let service: LineAiBudgetAuthorityService; let prisma: PrismaService;
  before(async () => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url!).hostname)) throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await client.$connect(); prisma = { client } as PrismaService;
    service = new LineAiBudgetAuthorityService(prisma, { approvedAiModelIds: [model], aiGatewayInternalSecret: 'synthetic-local-grant-test-key', aiMonthlyBudgetSatang: 1000000 } as AppConfigService);
  });
  after(async () => {
    if (!client) return;
    await client.lineWebhookEventLog.deleteMany({ where: { companyId: { startsWith: tag } } });
    await client.companyPlanTerm.deleteMany({ where: { companyId: { startsWith: tag } } });
    const accounts = await client.billingAccount.findMany({ where: { companyId: { startsWith: tag } }, select: { id: true } });
    await client.billingInvoice.deleteMany({ where: { billingAccountId: { in: accounts.map(row => row.id) } } });
    await client.billingAccount.deleteMany({ where: { companyId: { startsWith: tag } } });
    await client.company.deleteMany({ where: { id: { startsWith: tag } } });
    await client.user.deleteMany({ where: { id: { startsWith: tag } } });
    await client.$disconnect();
  });
  async function fixture(suffix: string, mode = 'SPLIT', classified = true, extra: Partial<IssueLineAiBudgetGrant> = {}) {
    const companyId = `${tag}-${suffix}`; const userId = `${companyId}-user`; const membershipId = `${companyId}-member`;
    await client.company.create({ data: { id: companyId, name: companyId } });
    await client.user.create({ data: { id: userId, displayName: 'Synthetic grant user', status: 'ACTIVE' } });
    await client.companyMembership.create({ data: { id: membershipId, companyId, userId, status: 'ACTIVE' } });
    await client.lineChannelBinding.create({ data: { companyId, messagingChannelId: `${companyId}-channel` } });
    await client.companyAiConfiguration.create({ data: { companyId, modelId: model, monthlyBudgetSatang: 1000000,
      budgetMode: mode, chatMonthlyBudgetSatang: mode === 'SPLIT' ? 500000 : null, ocrMonthlyBudgetSatang: mode === 'SPLIT' ? 500000 : null } });
    const owner = { companyId, userId, membershipId, channel: 'line' as const, channelKind: 'USER' as const, messagingChannelId: `${companyId}-channel`, chatKeyHash: hash };
    const context = await new LineConversationContextService(prisma).admit(owner);
    const event = await client.lineWebhookEventLog.create({ data: { companyId, webhookEventId: `${companyId}-event`, eventType: 'message', status: 'received' } });
    const input: IssueLineAiBudgetGrant = { authorityKind: 'webhook_event', authorityId: event.id, owner: { kind: 'PRIVATE', owner, epoch: context.lifecycleEpoch },
      turnKey: `${companyId}-turn`, attemptKey: `${companyId}-attempt`, inputDigest: hash, requestKind: 'TEXT', admittedAtMs: Date.now(), coalescingExtraMs: 0, lane: 'public',
      model: { provider: 'bedrock', modelId: model, region: 'ap-southeast-1' }, modelContextTokens: 200000, modelMaxOutputTokens: 4096,
      tariff: { version: 'synthetic-tariff:1', provider: 'bedrock', modelId: model, region: 'ap-southeast-1', thbPerUsd: 33,
        usdPerMTok: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 } },
      allowedProfileIds: ['line-intake-text/2'], ...extra,
    };
    let grant = await service.issue(input); assert.ok(grant);
    if (classified) {
      const intake = await service.reserve(invocation(grant, 0, 'line-intake-text/2')); assert.ok(intake.ok);
      await settle(intake.envelope.invocationKey);
      grant = await service.narrow(grant, 'mixed', ['line-control/2', 'line-answer/2']); assert.ok(grant);
    }
    return { input, grant, owner, context };
  }
  const invocation = (grant: AiBudgetGrantV2, ordinal = grant.nextOrdinal ?? 0, profileId: AiBudgetProfileIdV2 = 'line-control/2'): AiBudgetInvocationV2 => ({
    grant, ordinal, profileId, inputTokenBound: 1024, requestedOutputTokens: 100, estimatorVersion: 'utf8-split-prefix-v4', promptVersion: 'fixture:1', payloadDigest: hash, schemaDigest: hash, inputDigest: hash,
  });
  async function settle(key: string) {
    return settleAiBudgetStep(prisma, { invocationKey: key, meta: { sourceRoute: 'line-ai-v2' }, entry: { modelId: model, tag: 'fixture', ok: true,
      inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, usageBasis: 'PROVIDER_REPORTED' } as never });
  }
  it('a private webhook grant may answer directly only for the server-decided fixed read', async () => {
    const { input, grant } = await fixture('fixed-read', 'SPLIT', false,
      { lane: 'simple', serverRoute: 'fixed_read', allowedProfileIds: ['line-answer/2'] });
    assert.ok(grant);
    const { serverRoute: _route, ...withoutRoute } = input;
    assert.equal(await service.issue({ ...withoutRoute, authorityId: `${input.authorityId}-plain` }), null);
    assert.equal(await service.issue({ ...input, authorityId: `${input.authorityId}-mixed`, allowedProfileIds: ['line-answer/2', 'line-control/2'] }), null);
  });
  it('R10 Q1: webhook counterparty intake reserves ordinal zero before narrowing the real grant', async () => {
    const { ProcessLineWebhookUseCase } = await import('./use-cases/process-line-webhook.use-case');
    const { grant, owner } = await fixture('counterparty-intake', 'SPLIT', false);
    assert.equal(await service.narrow(grant, 'mixed', ['line-control/2', 'line-answer/2']), null);
    const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
    let intakeCalls = 0;
    Object.assign(flow, { mediaTextContinuations: new WeakMap(), intakePlansV2: new WeakMap(), boundConversations: new WeakMap(),
      config: {}, logger: { log() {}, warn() {} }, prepareTextGrantV2: async () => grant, reliabilityContext: async () => ({}),
      aiGateway: { requestLineIntakeRoute: async () => {
        intakeCalls += 1;
        const reserved = await service.reserve(invocation(grant, 0, 'line-intake-text/2')); assert.ok(reserved.ok);
        assert.equal(await settle(reserved.envelope.invocationKey), 'settled');
        return { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.98 };
      } } });
    const text = 'เพิ่มผู้ขาย บริษัท ทดสอบ จำกัด เลขผู้เสียภาษี 0105556000011';
    const plan = await flow.tryRouteIntake({ event: { messageText: text }, requestId: 'r10-counterparty', companyId: owner.companyId,
      userId: owner.userId, permissions: ['line.ai.query', 'ai.tool.invoke', 'accounting.counterparty.manage'], messageText: text });
    assert.equal(plan.status, 'ROUTED'); assert.equal(intakeCalls, 1);
    const narrowed = await service.narrow(grant, 'mixed', ['line-control/2', 'line-answer/2']); assert.ok(narrowed);
    assert.equal(narrowed.nextOrdinal, 1);
    assert.equal(await client.aiBudgetReservation.count({ where: { companyId: owner.companyId } }), 1);
  });
  it('atomically claims one global ordinal across racing profiles and commits DISPATCHED before returning', async () => {
    const { grant } = await fixture('race');
    const results = await Promise.all([service.reserve(invocation(grant)), service.reserve(invocation(grant, 1, 'line-answer/2'))]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    const first = results.find((result) => result.ok)!; assert.ok(first.ok);
    const stored = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: first.envelope.reservationId } });
    assert.equal(stored.status, 'DISPATCHED');
    assert.equal((await service.reserve(invocation(grant, 2))).ok, false, 'unresolved prior dispatch prevents overlap');
    assert.equal(await settle(first.envelope.invocationKey), 'settled');
    assert.ok((await service.reserve(invocation(grant, 2))).ok);
  });
  it('rejects tampering, source digest change, model swaps, and expired work without a hold', async () => {
    const { grant } = await fixture('tamper');
    for (const bad of [{ ...invocation(grant), inputDigest: 'b'.repeat(64) }, { ...invocation(grant), grant: { ...grant, maxTurnSlots: 2 as const } },
      { ...invocation(grant), grant: { ...grant, model: { ...grant.model, modelId: 'other' } } }]) assert.equal((await service.reserve(bad)).ok, false);
    assert.equal((await service.reserve(invocation(grant), false, new Date(grant.workDeadlineAtMs))).ok, false);
    assert.equal(await client.aiBudgetReservation.count({ where: { companyId: grant.payerCompanyId } }), 1);
  });
  it('retains the original grant on replay and rejects lifecycle revocation without losing prior money evidence', async () => {
    const { input, grant, context } = await fixture('revoke');
    const replay = await service.issue({ ...input, admittedAtMs: Date.now(), tariff: { ...input.tariff, thbPerUsd: 99 } });
    assert.deepEqual(replay, grant);
    const first = await service.reserve(invocation(grant)); assert.ok(first.ok);
    await client.aiConversation.update({ where: { id: context.id }, data: { lifecycleEpoch: { increment: 1 } } });
    assert.equal(await settle(first.envelope.invocationKey), 'settled');
    assert.equal((await service.reserve(invocation(grant, 1))).ok, false);
    assert.equal(await client.aiUsageEvent.count({ where: { invocationKey: first.envelope.invocationKey } }), 1);
  });
  it('counts repairs across all profiles and keeps the SHARED total-money fence', async () => {
    const { grant } = await fixture('shared', 'SHARED');
    const first = await service.reserve(invocation(grant), true); assert.ok(first.ok);
    await settle(first.envelope.invocationKey);
    assert.equal((await service.reserve(invocation(grant, 2, 'line-answer/2'), true)).ok, false);
    const second = await service.reserve(invocation(grant, 2, 'line-answer/2')); assert.ok(second.ok);
    const row = await client.lineWebhookEventLog.findUniqueOrThrow({ where: { id: grant.authorityId } });
    const authority = row.budgetAuthorityJson as any;
    assert.equal(authority.nextOrdinal, 3); assert.equal(authority.repairCount, 1);
  });
  it('answers public general turns without requiring or loading a private conversation', async () => {
    const { input, owner, context } = await fixture('public', 'SPLIT', false);
    await client.aiConversation.delete({ where: { id: context.id } });
    await client.companyMembership.update({ where: { id: owner.membershipId }, data: { status: 'DISABLED' } });
    const event = await client.lineWebhookEventLog.create({ data: { companyId: owner.companyId, webhookEventId: `${tag}-public-second`, eventType: 'message' } });
    const publicOwner = { companyId: owner.companyId, channel: 'line' as const, channelKind: 'GROUP' as const,
      messagingChannelId: owner.messagingChannelId, chatKeyHash: owner.chatKeyHash };
    const grant = await service.issue({ ...input, authorityId: event.id, turnKey: `${tag}-public-turn`, attemptKey: `${tag}-public-attempt`,
      owner: { kind: 'PUBLIC_GENERAL', owner: publicOwner }, lane: 'general', admittedAtMs: Date.now(), allowedProfileIds: ['line-answer/2'] });
    assert.ok(grant);
    assert.equal(grant.membershipEpoch, undefined); assert.equal(grant.maxTurnSlots, 2);
    const scope = { companyId: owner.companyId, publicAdmission: { channelKind: 'GROUP' as const, channelKeyHash: owner.chatKeyHash, admissionId: event.id } };
    assert.equal(await service.validate(grant, hash, scope), true);
    assert.equal(await service.validate(grant, hash, { ...scope, userId: owner.userId }), false);
    assert.equal(await service.validate(grant, hash, { ...scope, publicAdmission: { ...scope.publicAdmission, channelKind: 'USER' } }), false);
    assert.equal(await service.validate(grant, hash, { ...scope, publicAdmission: { ...scope.publicAdmission, channelKeyHash: 'b'.repeat(64) } }), false);
    assert.equal(await service.validate(grant, hash, { ...scope, publicAdmission: { ...scope.publicAdmission, admissionId: 'other-event' } }), false);
    assert.ok((await service.reserve(invocation(grant, 0, 'line-answer/2'))).ok);
  });
  it('retains unknown external usage and settles later evidence exactly once at the pinned rates', async () => {
    const { grant } = await fixture('external');
    const result = await service.reserve(invocation(grant)); assert.ok(result.ok);
    const reservation = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: result.envelope.reservationId } });
    // Synthetic hosted-tool tariff fixture: no provider is dispatched by this database test.
    const snapshot = reservation.pricingSnapshot as any;
    snapshot.externalUnitBound = 2; snapshot.tariff.externalUsdPerUnit = 0.01;
    await client.aiBudgetReservation.update({ where: { id: reservation.id }, data: { pricingSnapshot: snapshot, upperBoundSatang: 1000 } });
    assert.equal(await settle(result.envelope.invocationKey), 'invalid-evidence');
    assert.equal((await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, 'UNRESOLVED');
    const evidence = { invocationKey: result.envelope.invocationKey, externalUnits: 1, meta: { sourceRoute: 'line-ai-v2' }, entry: { modelId: model,
      tag: 'fixture', ok: true, inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, usageBasis: 'PROVIDER_REPORTED' } as never };
    assert.equal(await settleAiBudgetStep(prisma, evidence), 'settled');
    assert.equal(await settleAiBudgetStep(prisma, evidence), 'duplicate');
    const billed = await client.aiUsageEvent.findUniqueOrThrow({ where: { invocationKey: result.envelope.invocationKey } });
    assert.equal((billed.pricingSnapshot as any).externalUnits, 1);
    assert.equal(billed.costSatang, 33);
  });

  it('accepts the actual webhook claim timestamp and narrows once without resetting ordinal, money or admission time', async () => {
    const { grant, input } = await fixture('narrow', 'SPLIT', false);
    await client.lineWebhookEventLog.update({ where: { id: grant.authorityId }, data: { processedAt: new Date() } });
    const first = await service.reserve(invocation(grant, 0, 'line-intake-text/2')); assert.ok(first.ok);
    await settle(first.envelope.invocationKey);
    const storedBefore = await client.lineWebhookEventLog.findUniqueOrThrow({ where: { id: grant.authorityId } });
    const altered = { ...grant, finalDeadlineAtMs: grant.finalDeadlineAtMs + 60_000, workDeadlineAtMs: grant.workDeadlineAtMs + 60_000 };
    assert.equal(await service.narrow(altered, 'simple', ['line-answer/2'], new Date(grant.admittedAtMs + 8_000)), null);
    const afterAltered = await client.lineWebhookEventLog.findUniqueOrThrow({ where: { id: grant.authorityId } });
    assert.equal(afterAltered.budgetAuthorityRevision, storedBefore.budgetAuthorityRevision, 'reused signature cannot mutate the durable authority');
    assert.deepEqual(afterAltered.budgetAuthorityJson, storedBefore.budgetAuthorityJson);
    const narrowed = await service.narrow(grant, 'simple', ['line-answer/2'], new Date(grant.admittedAtMs + 8_000)); assert.ok(narrowed);
    assert.equal(narrowed.maxTurnSlots, 2);
    assert.equal(narrowed.admittedAtMs, input.admittedAtMs);
    assert.equal(narrowed.finalDeadlineAtMs, grant.finalDeadlineAtMs);
    assert.equal(narrowed.workDeadlineAtMs, grant.workDeadlineAtMs);
    assert.deepEqual(await service.narrow(grant, 'simple', ['line-answer/2'], new Date(grant.admittedAtMs + 9_000)), narrowed);
    assert.equal(await service.narrow(narrowed, 'mixed', ['line-control/2', 'line-answer/2']), null);
    assert.equal((await service.reserve(invocation(grant, 1, 'line-answer/2'))).ok, false, 'old broader authority is no longer spendable');
    assert.equal((await service.reserve(invocation(narrowed, 1, 'line-control/2'))).ok, false);
    const second = await service.reserve(invocation(narrowed, 1, 'line-answer/2')); assert.ok(second.ok);
    await settle(second.envelope.invocationKey);
    assert.equal((await service.reserve(invocation(narrowed, 2, 'line-answer/2'))).ok, false);
    assert.equal(await client.aiUsageEvent.count({ where: { companyId: grant.payerCompanyId } }), 2);
    await assert.rejects(service.narrow(narrowed, 'simple', ['line-answer/2'], new Date(grant.workDeadlineAtMs)), LineAiBudgetDeadlineExceededError);
  });

  it('keeps the admitted envelope across every private lane and expires first narrowing only at its stored work deadline', async () => {
    const cases = [
      { suffix: 'general-before', lane: 'general' as const, profiles: ['line-answer/2' as const], offset: 6_999, slots: 2 },
      { suffix: 'general-after', lane: 'general' as const, profiles: ['line-answer/2' as const], offset: 7_001, slots: 2 },
      { suffix: 'simple-after', lane: 'simple' as const, profiles: ['line-answer/2' as const], offset: 7_001, slots: 2 },
      { suffix: 'mixed-after', lane: 'mixed' as const, profiles: ['line-control/2' as const, 'line-answer/2' as const], offset: 7_001, slots: 4 },
    ];
    for (const item of cases) {
      const { grant } = await fixture(item.suffix, 'SPLIT', false);
      const intake = await service.reserve(invocation(grant, 0, 'line-intake-text/2')); assert.ok(intake.ok);
      await settle(intake.envelope.invocationKey);
      const narrowed = await service.narrow(grant, item.lane, item.profiles, new Date(grant.admittedAtMs + item.offset)); assert.ok(narrowed);
      assert.equal(narrowed.finalDeadlineAtMs, grant.finalDeadlineAtMs);
      assert.equal(narrowed.workDeadlineAtMs, grant.workDeadlineAtMs);
      assert.equal(narrowed.nextOrdinal, 1); assert.equal(narrowed.maxTurnSlots, item.slots);
      assert.deepEqual(narrowed.allowedProfileIds, item.profiles);
    }
    const { grant } = await fixture('first-expired', 'SPLIT', false);
    const intake = await service.reserve(invocation(grant, 0, 'line-intake-text/2')); assert.ok(intake.ok); await settle(intake.envelope.invocationKey);
    await assert.rejects(service.narrow(grant, 'general', ['line-answer/2'], new Date(grant.workDeadlineAtMs)), LineAiBudgetDeadlineExceededError);
    const row = await client.lineWebhookEventLog.findUniqueOrThrow({ where: { id: grant.authorityId } });
    assert.equal((row.budgetAuthorityJson as any).narrowedLane, undefined);
  });

  // UAT 2026-09-29 ("สวัสดีจ้า"): the intake's repair used to spend a general lane's only answer slot, so compose
  // was refused before any model call. A repair never spends an answer slot; the turn still has one repair.
  it('never lets an intake repair spend the answer slot of the lane it narrows into', async () => {
    for (const item of [
      { suffix: 'repair-general', lane: 'general' as const, profiles: ['line-answer/2' as const], slots: 2 },
      { suffix: 'repair-simple', lane: 'simple' as const, profiles: ['line-answer/2' as const], slots: 2 },
      { suffix: 'repair-mixed', lane: 'mixed' as const, profiles: ['line-control/2' as const, 'line-answer/2' as const], slots: 4 },
    ]) {
      const { grant } = await fixture(item.suffix, 'SPLIT', false);
      const intake = await service.reserve(invocation(grant, 0, 'line-intake-text/2')); assert.ok(intake.ok); await settle(intake.envelope.invocationKey);
      const repair = await service.reserve(invocation(grant, 1, 'line-intake-text/2'), true); assert.ok(repair.ok); await settle(repair.envelope.invocationKey);
      const narrowed = await service.narrow(grant, item.lane, item.profiles, new Date(grant.admittedAtMs + 5_000)); assert.ok(narrowed);
      assert.equal(narrowed.nextOrdinal, 2); assert.equal(narrowed.maxTurnSlots, item.slots);
      const answer = await service.reserve(invocation(narrowed, 2, 'line-answer/2'));
      assert.ok(answer.ok, `${item.lane}: the answer keeps its slot after the intake repair`); await settle(answer.envelope.invocationKey);
      assert.equal((await service.reserve(invocation(narrowed, 3, 'line-answer/2'), true)).ok, false, `${item.lane}: the one repair was the intake's`);
      if (item.slots === 2) assert.equal((await service.reserve(invocation(narrowed, 3, 'line-answer/2'))).ok, false, `${item.lane}: no third non-repair call`);
    }
  });

  it('honors a reviewed model output ceiling before spending and validates the live owner and input', async () => {
    const { grant, owner } = await fixture('capacity');
    assert.equal((await service.reserve({ ...invocation(grant, 0, 'line-answer/2'), requestedOutputTokens: 4097 })).ok, false);
    assert.equal(await service.validate(grant, hash, { companyId: owner.companyId, userId: owner.userId, membershipId: owner.membershipId }), true);
    assert.equal(await service.validate(grant, hash, { companyId: owner.companyId, userId: 'other' }), false);
    assert.equal(await service.validate(grant, 'b'.repeat(64), { companyId: owner.companyId, userId: owner.userId }), false);
    await client.user.update({ where: { id: owner.userId }, data: { aiAssistantOptOutAt: new Date() } });
    assert.equal(await service.validate(grant, hash, { companyId: owner.companyId, userId: owner.userId }), false);
    assert.equal(await client.aiBudgetReservation.count({ where: { companyId: owner.companyId } }), 1);
  });

  async function qaJob(f: Awaited<ReturnType<typeof fixture>>, suffix: string) {
    const source = { questionText: 'Synthetic document question', attachmentsJson: [{ attachmentId: 'asset-1', contentHash: hash, mimeType: 'image/png', byteSize: 100, requestedPages: [1] }] };
    return (client as any).lineDocumentQaJob.create({ data: {
      id: `${f.owner.companyId}-${suffix}`, companyId: f.owner.companyId, userId: f.owner.userId,
      ownerMembershipId: f.owner.membershipId, ownerEpoch: f.context.lifecycleEpoch, ownerDigest: hash,
      channelKind: 'USER', messagingChannelId: f.owner.messagingChannelId, chatKeyHash: hash, turnId: f.grant.turnKey,
      ...source, inputDigest: documentQaAuthorityInputDigest(source)!, inputSetHash: hash, questionDigest: hash,
      readerVersion: 'fixture:1', foregroundDeadlineAt: new Date(f.grant.admittedAtMs + 40000),
      jobDeadlineAt: new Date(f.grant.admittedAtMs + 900000), expiresAt: new Date(f.grant.admittedAtMs + 900000),
      purgeAt: new Date(f.grant.admittedAtMs + 86400000),
    } });
  }

  it('transfers one settled intake into QA without a new paid turn and seals the old grant', async () => {
    const f = await fixture('qa-transfer', 'SPLIT', false);
    const job = await qaJob(f, 'job');
    const inputDigest = documentQaAuthorityInputDigest(job)!;
    assert.equal(await service.issue({ ...f.input, authorityKind: 'qa_job', authorityId: job.id, lane: 'document_qa', allowedProfileIds: ['document-qa/2'] }), null);
    const first = await service.reserve(invocation(f.grant, 0, 'line-intake-text/2')); assert.ok(first.ok);
    assert.equal(await service.transferToDocumentQa(f.grant, job.id, inputDigest), null, 'unresolved vendor call cannot overlap QA');
    await settle(first.envelope.invocationKey);
    assert.equal(await service.transferToDocumentQa(f.grant, job.id, hash), null, 'bind question and ordered attachment set together');
    const grant = await service.transferToDocumentQa(f.grant, job.id, inputDigest); assert.ok(grant);
    assert.equal(grant.attemptKey, f.grant.attemptKey); assert.equal(grant.admittedAtMs, f.grant.admittedAtMs);
    assert.equal(grant.maxTurnSlots, 2); assert.equal(grant.nextOrdinal, 1);
    assert.equal(grant.finalDeadlineAtMs, f.grant.admittedAtMs + 900000);
    assert.deepEqual(await service.transferToDocumentQa(f.grant, job.id, inputDigest), grant);
    // Owner 2026-09-30: the queued question was accepted with its turn, so its later calls pass the cap.
    assert.equal(((await (client as any).lineDocumentQaJob.findUniqueOrThrow({ where: { id: job.id } })).budgetAuthorityJson as { admitOverCap?: unknown }).admitOverCap, true);
    assert.equal(await service.issue(f.input), null);
    assert.equal(await service.narrow(f.grant, 'mixed', ['line-control/2']), null);
    assert.equal(await service.validate(f.grant, hash, f.owner), false);
    assert.equal((await service.reserve(invocation(f.grant, 1, 'line-intake-text/2'))).ok, false);
    const call = { ...invocation(grant, 1, 'document-qa/2'), inputDigest };
    const results = await Promise.all([service.reserve(call), service.reserve(call)]);
    assert.equal(results.filter(result => result.ok).length, 1);
    const accepted = results.find(result => result.ok)!; assert.ok(accepted.ok); await settle(accepted.envelope.invocationKey);
    assert.equal((await service.reserve({ ...call, ordinal: 2 })).ok, false);
    assert.equal(await client.aiUsageEvent.count({ where: { companyId: f.owner.companyId } }), 2);
  });

  it('fences QA owner transplants and racing transfers to two jobs', async () => {
    const f = await fixture('qa-race', 'SPLIT', false);
    const first = await service.reserve(invocation(f.grant, 0, 'line-intake-text/2')); assert.ok(first.ok); await settle(first.envelope.invocationKey);
    const job1 = await qaJob(f, 'one');
    const otherSource = { ...job1, questionText: 'Different synthetic question' };
    const job2 = await (client as any).lineDocumentQaJob.create({ data: { ...otherSource, id: `${f.owner.companyId}-two`, questionDigest: 'b'.repeat(64), inputDigest: documentQaAuthorityInputDigest(otherSource)! } });
    await (client as any).lineDocumentQaJob.update({ where: { id: job1.id }, data: { messagingChannelId: 'other-OA' } });
    assert.equal(await service.transferToDocumentQa(f.grant, job1.id, documentQaAuthorityInputDigest(job1)!), null);
    await (client as any).lineDocumentQaJob.update({ where: { id: job1.id }, data: { messagingChannelId: f.owner.messagingChannelId } });
    const raced = await Promise.all([
      service.transferToDocumentQa(f.grant, job1.id, documentQaAuthorityInputDigest(job1)!),
      service.transferToDocumentQa(f.grant, job2.id, documentQaAuthorityInputDigest(job2)!),
    ]);
    assert.equal(raced.filter(Boolean).length, 1);
    const live = raced.find(Boolean)!;
    await client.aiConversation.update({ where: { id: f.context.id }, data: { lifecycleEpoch: { increment: 1 } } });
    assert.equal(await service.validate(live, documentQaAuthorityInputDigest(live.authorityId === job1.id ? job1 : job2)!, f.owner), false);
  });

  // Owner 2026-09-30: work accepted before the credit ran out passes the cap on every call of its turn
  // ("ทุกกรณีที่ระบบรับไว้ก่อน"); an admin's closure — a cap of 0 — is never passed ("ไม่ทำต่อ").
  it('owner 2026-09-30: an authority for accepted work reserves past a full CHAT; a fresh one is refused; a closed CHAT refuses both', async () => {
    const spendChat = async (companyId: string, monthKey: string, costSatang: number) => {
      await client.companyAiMonthlyUsage.create({ data: { companyId, monthKey, costSatang, callCount: 1 } });
      await client.companyAiMonthlyBucketUsage.create({ data: { companyId, monthKey, bucket: 'CHAT', costSatang, callCount: 1 } });
    };
    const fresh = await fixture('overcap-fresh', 'SPLIT', false);
    await spendChat(fresh.owner.companyId, fresh.grant.monthKey, 500000);
    const refused = await service.reserve(invocation(fresh.grant, 0, 'line-intake-text/2'));
    assert.equal(refused.ok, false);
    assert.equal((refused as { reason: string }).reason, 'exceeded');

    const accepted = await fixture('overcap-accepted', 'SPLIT', false, { admitOverCap: true });
    await spendChat(accepted.owner.companyId, accepted.grant.monthKey, 500000);
    const first = await service.reserve(invocation(accepted.grant, 0, 'line-intake-text/2')); assert.ok(first.ok);
    assert.equal(await settle(first.envelope.invocationKey), 'settled');
    const narrowed = await service.narrow(accepted.grant, 'mixed', ['line-control/2', 'line-answer/2']); assert.ok(narrowed);
    const second = await service.reserve(invocation(narrowed, 1)); assert.ok(second.ok, 'the whole turn passes, not only its first call');
    assert.equal(await settle(second.envelope.invocationKey), 'settled');
    assert.equal(await settle(second.envelope.invocationKey), 'duplicate', 'never charged twice');
    assert.equal(await client.aiUsageEvent.count({ where: { companyId: accepted.owner.companyId } }), 2, 'each call recorded once');
    const stored = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: second.envelope.reservationId } });
    assert.equal((stored.pricingSnapshot as { admitOverCap?: unknown }).admitOverCap, true);
    assert.equal(stored.status, 'SETTLED');

    const closed = await fixture('overcap-closed', 'SPLIT', false, { admitOverCap: true });
    await client.companyAiConfiguration.update({ where: { companyId: closed.owner.companyId }, data: { chatMonthlyBudgetSatang: 0 } });
    assert.equal((await service.reserve(invocation(closed.grant, 0, 'line-intake-text/2'))).ok, false, 'a CHAT cap of 0 is an admin closure');
    assert.equal(await client.aiBudgetReservation.count({ where: { companyId: closed.owner.companyId } }), 0, 'and no hold is left behind');
  });

  it('resolves private tools from authenticated durable ownership only', async () => {
    const f = await fixture('private-owner');
    assert.deepEqual(await service.resolvePrivateOwner(f.grant, hash, f.owner), f.input.owner);
    assert.equal(await service.resolvePrivateOwner(f.grant, hash, { ...f.owner, userId: 'other' }), null);
    assert.equal(await service.resolvePrivateOwner(f.grant, 'b'.repeat(64), f.owner), null);
  });

  it('direct accepted QA retains a zero cursor and permits at most one repair within the same two-call turn', async () => {
    const f = await fixture('qa-direct', 'SPLIT', false), job = await qaJob(f, 'job');
    const inputDigest = documentQaAuthorityInputDigest(job)!;
    const grant = await service.transferToDocumentQa(f.grant, job.id, inputDigest); assert.ok(grant);
    assert.equal(grant.nextOrdinal, 0);
    const first = await service.reserve({ ...invocation(grant, 0, 'document-qa/2'), inputDigest }); assert.ok(first.ok); await settle(first.envelope.invocationKey);
    const repair = await service.reserve({ ...invocation(grant, 1, 'document-qa/2'), inputDigest }, true); assert.ok(repair.ok); await settle(repair.envelope.invocationKey);
    assert.equal((await service.reserve({ ...invocation(grant, 2, 'document-qa/2'), inputDigest }, true)).ok, false);
  });

  it('pins the AI credit cycle of a cut-over turn in the API-side authority, never in the signed grant (A36, C4)', async () => {
    const { grant, input, owner } = await fixture('credit', 'SHARED', false);
    const companyId = grant.payerCompanyId;
    const start = new Date(Date.now() - 5 * 86_400_000), end = new Date(Date.now() + 25 * 86_400_000);
    const account = await client.billingAccount.create({ data: { companyId, stripeAccountId: `acct_${companyId}`, livemode: false,
      renewalMode: 'CARD_ONCE', billingAnchorDay: packageAnchorDay(start), paidThrough: end } });
    await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: `in_${companyId}`, offerSnapshot: {},
      policyRevisionId: 'synthetic', currency: 'thb', totalSatang: 24_900, paidSatang: 24_900, periodStart: start, periodEnd: end,
      providerStatus: 'paid', evidenceHash: 'synthetic', applyStatus: 'APPLIED', appliedAt: start } });
    await client.companyPlanTerm.create({ data: { companyId, tierKey: 'STARTER', branchLimit: 1, employeeLimit: 3, monthlySlipLimit: 30,
      termStartAt: start, termEndsAt: end, billingReceiptAccountId: account.id } });
    await client.companyAiConfiguration.update({ where: { companyId }, data: { aiCreditCutoverAt: new Date(Date.now() - 86_400_000) } });
    const intake = await service.reserve(invocation(grant, 0, 'line-intake-text/2')); assert.ok(intake.ok);
    const authority = (await client.lineWebhookEventLog.findUniqueOrThrow({ where: { id: grant.authorityId } })).budgetAuthorityJson as any;
    const lot = await client.aiCreditGrant.findFirstOrThrow({ where: { companyId, sourceKind: 'INCLUDED_CYCLE' } });
    assert.deepEqual(authority.fundingContext, { cycleKey: lot.cycleKey });
    assert.deepEqual(authority.grant, grant, 'the signed grant is unchanged');
    assert.equal(JSON.stringify(grant).includes('cycle'), false);
    await settle(intake.envelope.invocationKey);
    const narrowed = await service.narrow(grant, 'mixed', ['line-control/2', 'line-answer/2']); assert.ok(narrowed);
    const next = await service.reserve(invocation(narrowed, 1, 'line-control/2')); assert.ok(next.ok);
    assert.deepEqual((await client.aiCreditEntry.findMany({ where: { reservationId: next.envelope.reservationId } })).map(row => row.grantId), [lot.id]);
    // An image intake keeps its CHAT bucket and spends no AI credit (plan C4).
    const event = await client.lineWebhookEventLog.create({ data: { companyId, webhookEventId: `${companyId}-image`, eventType: 'message' } });
    const image = await service.issue({ ...input, authorityId: event.id, turnKey: `${companyId}-image-turn`, attemptKey: `${companyId}-image`,
      requestKind: 'IMAGE', admittedAtMs: Date.now(), allowedProfileIds: ['line-intake-image/2'], owner: { kind: 'PRIVATE', owner, epoch: input.owner.kind === 'PRIVATE' ? input.owner.epoch : 0 } });
    assert.ok(image);
    const read = await service.reserve(invocation(image, 0, 'line-intake-image/2')); assert.ok(read.ok);
    assert.equal(await client.aiCreditEntry.count({ where: { reservationId: read.envelope.reservationId } }), 0);
  });
});
