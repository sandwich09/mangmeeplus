import { lineMessagingCredentialsFixture } from '../../common/config/line-messaging-credentials.fixture';
import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { PermissionResolverService } from '../access-control/application/permission-resolver.service';
import { PrismaPermissionResolverRepository } from '../access-control/infrastructure/prisma-permission-resolver.repository';
import { GetExpenseUseCase } from '../expenses/application/use-cases/expense-draft.use-case';
import { PrismaExpenseRepository } from '../expenses/infrastructure/prisma-expense.repository';
import { ExpenseGetDetailTool } from './application/use-cases/erp-core-detail-tools.use-case';
import { LineReadEvidenceService, LINE_READ_EVIDENCE_MAX, lineReadResultHash } from './application/line-read-evidence.service';
import type { ErpReadToolPort, ErpToolContext } from './domain/ports/erp-read-tool.port';
import { ProcessLineWebhookUseCase } from './application/use-cases/process-line-webhook.use-case';
import { InternalToolsController } from './presentation/http/internal-tools.controller';
import { AuditService } from '../audit/application/audit.service';
import { PrismaAuditRepository } from '../audit/infrastructure/prisma-audit.repository';
import { RecoverOrphanLineEventsUseCase } from './application/use-cases/recover-orphan-line-events.use-case';
import { DrainLineLedgerUseCase } from './application/use-cases/drain-line-ledger.use-case';
import { LineLedgerDeliveryService, lineLedgerDeliveryId } from './application/line-ledger-delivery.service';
import { LineReplyAdapter } from './infrastructure/line-reply.adapter';
import type { LedgerEntry } from './application/line-ai-ledger.service';

const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;

describe('LINE original-source recheck on isolated PostgreSQL', { skip: !databaseUrl }, () => {
  it('uses the actual expense read and current scopes, retaining only bounded inputs and a result digest', async t => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok((url.port === '15432' && url.pathname === '/mangmee_billing_20260912')
      || (url.port === '5432' && url.pathname === '/watchdog_postmark_ci'), 'only a dedicated disposable local/CI database');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const prisma = { client } as unknown as PrismaService, tag = randomUUID();
    let companyId = '', userId = '', roleId = '';
    const eventIds: string[] = [], lineUsers: string[] = [];
    try {
      const user = await client.user.create({ data: { displayName: `source-${tag}` } }); userId = user.id;
      const company = await client.company.create({ data: { name: `source-${tag}` } }); companyId = company.id;
      const branch = await client.branch.create({ data: { companyId, name: 'Selected', code: 'B1', type: 'HEAD_OFFICE', createdByUserId: userId } });
      const otherBranch = await client.branch.create({ data: { companyId, name: 'Not selected', code: 'B2', type: 'BRANCH', createdByUserId: userId } });
      const permissions = await Promise.all(['ai.tool.invoke', 'line.ai.query', 'expense.read_own'].map(key => client.permission.upsert({ where: { key }, update: {}, create: { key, description: key } })));
      const role = await client.role.create({ data: { companyId, scopeKey: companyId, key: 'SOURCE_READER', name: 'Synthetic source reader', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } }); roleId = role.id;
      const membership = await client.companyMembership.create({ data: { companyId, userId, branchScopeMode: 'SELECTED_BRANCHES',
        roles: { create: { roleId } }, branchScopes: { create: { branchId: branch.id } } } });
      const expense = await client.expenseRecord.create({ data: { companyId, branchId: branch.id, expenseDate: new Date('2026-09-14T00:00:00Z'), createdByUserId: userId,
        vendorNameSnapshot: 'Synthetic private vendor', grandTotalAmount: '123.4500' } });
      const resolver = new PermissionResolverService(new PrismaPermissionResolverRepository(prisma));
      const tool = new ExpenseGetDetailTool(new GetExpenseUseCase(new PrismaExpenseRepository(prisma)));
      let mutationCalls = 0;
      const tools = new Map<string, ErpReadToolPort>([
        [tool.toolName, tool],
        ['expense.draft.set_header', { toolName: 'expense.draft.set_header', execute: async () => { mutationCalls++; throw new Error('must not replay a draft preview'); } }],
      ]);
      const service = new LineReadEvidenceService(prisma, resolver, tools);
      const access = await resolver.resolveAccess(userId, companyId);
      const ctx: ErpToolContext = { requestId: randomUUID(), companyId, userId, membershipId: membership.id,
        roles: access.roles, permissions: access.permissions, branchIds: access.scopes.branchIds, locale: 'th-TH' };
      const input = { expenseId: expense.id }, original = await tool.execute(ctx, input);
      assert.equal(original.status, 'ok');
      const id = await service.record(ctx, input, original);
      const verify = (ids = [id]) => service.verify(companyId, userId, ctx.requestId!, ids);

      await t.test('unchanged source and observation timestamp/key-order changes still verify', async () => {
        assert.equal(await verify(), true);
        assert.deepEqual(await service.forRequest(companyId, userId, ctx.requestId!), [id]);
        assert.equal(lineReadResultHash({ ...original, asOf: 'another-observation' }), lineReadResultHash(original));
        const reordered = { ...original, data: Object.fromEntries(Object.entries(original.data as object).reverse()) };
        assert.equal(lineReadResultHash(reordered), lineReadResultHash(original));
        const saved = await client.lineReadEvidence.findUniqueOrThrow({ where: { id } });
        assert.doesNotMatch(JSON.stringify(saved), /Synthetic private vendor|123\.45/);
        assert.notEqual(lineReadResultHash({ ...original, data: { ...(original.data as object), asOf: 'business-date' } }), lineReadResultHash(original));
      });

      await t.test('API evidence cannot be hidden or substituted by gateway telemetry', async () => {
        const request = { requestId: ctx.requestId, userContext: { companyId, internalUserId: userId } } as any;
        const response = { toolsInvoked: [], sourceRefs: [], refused: false } as any;
        assert.deepEqual(await service.forTurn(request, response), [id], 'omitted telemetry still verifies the actual read');
        assert.equal(await service.forTurn(request, { ...response, toolsInvoked: ['expense.list_recent'] }), null);
        assert.equal(await service.forTurn({ ...request, requestId: randomUUID() }, { ...response, toolsInvoked: [tool.toolName] }), null);
        assert.deepEqual(await service.forTurn({ ...request, requestId: randomUUID() }, { ...response, toolsInvoked: [tool.toolName], toolCalls: [{ name: tool.toolName, status: 'forbidden', durationMs: 1 }] }), []);
      });
      await t.test('same actor and unchanged scopes cannot reuse a record moved to another branch', async () => {
        await client.expenseRecord.update({ where: { id: expense.id }, data: { branchId: otherBranch.id } });
        assert.deepEqual((await resolver.resolveAccess(userId, companyId)).scopes, access.scopes);
        assert.equal(await verify(), false);
        await client.expenseRecord.update({ where: { id: expense.id }, data: { branchId: branch.id } });
      });
      await t.test('a changed result with identical record counts and later restoration is observed', async () => {
        await client.expenseRecord.update({ where: { id: expense.id }, data: { grandTotalAmount: '456.7800' } });
        assert.equal(await verify(), false);
        await client.expenseRecord.update({ where: { id: expense.id }, data: { grandTotalAmount: '123.4500' } });
        assert.equal(await verify(), true);
      });
      await t.test('missing/duplicate/foreign-request and expired evidence cannot authorize a read', async () => {
        assert.equal(await verify([]), false);
        assert.equal(await verify([id, id]), false);
        assert.equal(await verify([randomUUID()]), false);
        assert.equal(await service.verify(companyId, userId, randomUUID(), [id]), false);
        await client.lineReadEvidence.update({ where: { id }, data: { createdAt: new Date(Date.now() - 61 * 60_000) } });
        assert.equal(await verify(), false);
        await client.lineReadEvidence.update({ where: { id }, data: { createdAt: new Date() } });
      });
      await t.test('proof cannot turn a preview/mutation category into a read executor', async () => {
        await client.lineReadEvidence.update({ where: { id }, data: { toolName: 'expense.draft.set_header' } });
        assert.equal(await verify(), false); assert.equal(mutationCalls, 0);
        await client.lineReadEvidence.update({ where: { id }, data: { toolName: tool.toolName } });
        await assert.rejects(service.record(ctx, {}, { ...original, toolName: 'expense.draft.set_header' }), /UNSUPPORTED/);
      });
      await t.test('bounded inputs and evidence reservation do not let concurrent writers exceed64', async () => {
        await assert.rejects(service.record(ctx, { text: 'ก'.repeat(8192) }, original), /INPUT_LIMIT/);
        const requestId = randomUUID(), row = await client.lineReadEvidence.findUniqueOrThrow({ where: { id } });
        await client.lineReadEvidence.createMany({ data: Array.from({ length: LINE_READ_EVIDENCE_MAX - 1 }, () => ({ ...row, inputJson: row.inputJson as Prisma.InputJsonValue, id: randomUUID(), requestId })) });
        const results = await Promise.allSettled([service.record({ ...ctx, requestId }, input, original), service.record({ ...ctx, requestId }, input, original)]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(await client.lineReadEvidence.count({ where: { companyId, userId, requestId } }), LINE_READ_EVIDENCE_MAX);
      });
      for (const race of ['unchanged', 'branch', 'amount', 'handoff', 'fallback', 'replay', 'replay-branch', 'replay-role', 'replay-group', 'replay-channel', 'replay-unlink', 'replay-legacy'] as const) await t.test(`live producer-to-delivery with actual DB and expense API: ${race}`, async () => {
        const quiet = { log() {}, warn() {}, error() {}, debug() {}, info() {} };
        const audit = new AuditService(new PrismaAuditRepository(prisma), quiet as any);
        const controller = new (InternalToolsController as any)({ aiGatewayInternalSecret: 'synthetic-internal' }, prisma, audit, resolver,
          { consume: async (_token: string, expected: any) => ({ ...expected, sub: userId, jti: randomUUID(), workload: 'ai-gateway', aud: 'watchdog-erp-core:internal-ai-tools' }) },
          ...Array.from({ length: 61 }, () => ({})));
        controller.toolMap.set(tool.toolName, tool); controller.readEvidence = service; controller.logger = quiet;
        const lineUserId = `U${randomUUID().replaceAll('-', '')}`; lineUsers.push(lineUserId);
        await client.externalIdentity.create({ data: { userId, provider: 'LINE', providerUserId: lineUserId, providerChannelId: 'synthetic-channel' } });
        await client.lineCompanyContext.create({ data: { lineUserId, companyId } });
        const accepted: unknown[] = [];
        let privateAttempts = 0, modelCalls = 0;
        const changeSource = () => client.expenseRecord.update({ where: { id: expense.id }, data: race === 'amount' ? { grandTotalAmount: '999.9900' } : { branchId: otherBranch.id } });
        const useCase = new ProcessLineWebhookUseCase(lineMessagingCredentialsFixture({ webBaseUrl: 'https://synthetic.example.test', lineAiTerminalOutcomeReplayEnabled: race !== 'handoff' } as any), prisma, { webBaseUrl: 'https://synthetic.example.test', lineAiTerminalOutcomeReplayEnabled: race !== 'handoff' } as any,
          resolver, audit,
          { requestLineIntakeRoute: async () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 1 }),
            requestLineTurn: async (request: any) => {
              modelCalls++;
              const result = await controller.invoke('synthetic-internal', 'synthetic-delegation', { toolName: tool.toolName, input,
                context: { requestId: request.requestId, companyId, userId, membershipId: membership.id, permissions: [] } });
              assert.equal(result.status, 'ok');
              if (race === 'branch' || race === 'amount') await changeSource();
              return { requestId: 'untrusted-model-id', replyText: 'Synthetic private vendor 123.45 บาท', sourceRefs: result.sourceRefs, sourceLabels: [], webLinks: [],
                intent: 'read_detail', agent: 'accounting', refused: false, toolsInvoked: [tool.toolName], durationMs: 1 };
            } } as any,
          { buildTextMessage: (text: string) => ({ type: 'text', text }),
            sendReply: async (_token: string, messages: unknown) => {
              if (/Synthetic private vendor/.test(JSON.stringify(messages))) {
                privateAttempts++;
                if (race === 'fallback') { await changeSource(); return 'failed_token'; }
                if (race.startsWith('replay')) return 'failed_other';
              }
              accepted.push(messages); return 'ok';
            },
            sendPush: async (_to: string, messages: unknown) => { accepted.push(messages); return 'ok'; } } as any,
          {} as any, {} as any, { isRequired: async () => false } as any,
          { startSweep: () => ({ record: async () => {}, flush: async () => {} }) } as any, { assertLaunchRouteOpen: async () => {} } as any);
        (useCase as any).readEvidence = service; (useCase as any).logger = quiet;
        if (race === 'handoff') (useCase as any).handoffLinks = { wrapOutgoingLineContent: async (_recipient: unknown, messages: unknown) => { await changeSource(); return messages; } };
        const webhookEventId = randomUUID(); eventIds.push(webhookEventId);
        await useCase.execute({ webhookEventId, lineUserId, replyToken: 'synthetic-reply', messagingChannelId: 'synthetic-channel', messageText: 'ค่าใช้จ่ายเลขนี้เท่าไร' });
        assert.equal(modelCalls, 1);
        if (race.startsWith('replay')) {
          assert.equal(accepted.length, 0); assert.equal(privateAttempts, 1);
          const outcome = await client.lineTurnOutcome.findUniqueOrThrow({ where: { webhookEventId } });
          assert.ok((outcome.authorizationJson as any).read?.ids.length);
          assert.equal((outcome.authorizationJson as any).read.webhookEventId, webhookEventId);
          assert.doesNotMatch(JSON.stringify(outcome.authorizationJson), new RegExp(lineUserId));
          if (race === 'replay-branch') await changeSource();
          if (race === 'replay-role') await client.role.update({ where: { id: roleId }, data: { status: 'DISABLED' } });
          if (race === 'replay-unlink') await client.externalIdentity.deleteMany({ where: { providerUserId: lineUserId } });
          if (race === 'replay-legacy') await client.lineTurnOutcome.update({ where: { webhookEventId }, data: { authorizationJson: Prisma.DbNull } });
          await client.lineWebhookEventLog.update({ where: { webhookEventId }, data: {
            createdAt: new Date(Date.now() - 180_000), processedAt: new Date(Date.now() - 180_000),
            payloadJson: { lineUserId, chatId: race === 'replay-group' ? 'synthetic-other-chat' : lineUserId,
              messagingChannelId: race === 'replay-channel' ? 'other-channel' : 'synthetic-channel',
              item: { kind: 'text', webhookEventId, replyToken: 'synthetic-reply', text: 'ค่าใช้จ่ายเลขนี้เท่าไร', timestamp: Date.now() } },
          } });
          const recovery = new RecoverOrphanLineEventsUseCase(prisma, { aiDataRetentionDays: 90, lineAiTerminalOutcomeReplayEnabled: true } as any, audit,
            { enqueue: async () => assert.fail('must not reroute the original ERP operation') } as any,
            { buildTextMessage: (text: string) => ({ type: 'text', text }), sendPush: async (_to: string, messages: unknown) => { accepted.push(messages); return 'ok'; } } as any);
          (recovery as any).readEvidence = service; (recovery as any).logger = quiet;
          await recovery.execute(); assert.equal(modelCalls, 1);
          if (race === 'replay') {
            assert.match(JSON.stringify(accepted), /Synthetic private vendor/);
            assert.ok((await client.lineTurnOutcome.findUniqueOrThrow({ where: { webhookEventId } })).deliveredAt);
          } else {
            assert.doesNotMatch(JSON.stringify(accepted), /Synthetic private vendor/);
            assert.match(JSON.stringify(accepted), /กรุณาเปิดเว็บ/);
            assert.equal((await client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId } })).errorCode, 'LINE_OUTCOME_REAUTHORIZATION_REQUIRED');
            assert.equal((await client.lineTurnOutcome.findUniqueOrThrow({ where: { webhookEventId } })).deliveredAt, null);
          }
          await client.role.update({ where: { id: roleId }, data: { status: 'ACTIVE' } });
        } else if (race === 'unchanged') { assert.match(JSON.stringify(accepted), /Synthetic private vendor/); assert.equal(privateAttempts, 1); }
        else {
          assert.doesNotMatch(JSON.stringify(accepted), /Synthetic private vendor/);
          assert.match(JSON.stringify(accepted), /ข้อมูลต้นทางเปลี่ยน/);
          assert.equal(privateAttempts, race === 'fallback' ? 1 : 0);
          assert.equal((await client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId } })).errorCode, 'LINE_DELIVERY_SOURCE_CHANGED');
          if (race !== 'handoff') assert.equal((await client.lineTurnOutcome.findUniqueOrThrow({ where: { webhookEventId } })).deliveredAt, null);
        }
        await client.expenseRecord.update({ where: { id: expense.id }, data: { branchId: branch.id, grandTotalAmount: '123.4500' } });
      });

      for (const failure of ['unknown', 'source-changed', 'accepted-ack-lost'] as const) await t.test(`queued actual PostgreSQL and LINE adapter preserve one answer: ${failure}`, async () => {
        const lineUserId = `U${randomUUID().replaceAll('-', '')}`; lineUsers.push(lineUserId);
        await client.externalIdentity.create({ data: { userId, provider: 'LINE', providerUserId: lineUserId, providerChannelId: 'synthetic-channel' } });
        await client.lineCompanyContext.create({ data: { lineUserId, companyId } });
        const entry: LedgerEntry = { id: '1-0', key: `lineai:ledger:${companyId}:${lineUserId}`, companyId, userId, chatKey: lineUserId,
          webhookEventId: randomUUID(), messagingChannelId: 'synthetic-channel', turnId: randomUUID(), kind: failure === 'source-changed' ? 'sub_request' : 'turn', state: 'pending',
          text: 'ค่าใช้จ่ายเลขนี้เท่าไร', createdAt: new Date().toISOString() };
        eventIds.push(entry.webhookEventId!);
        await client.lineWebhookEventLog.create({ data: { webhookEventId: entry.webhookEventId!, companyId, eventType: 'message', status: 'rate_limited' } });
        let modelCalls = 0, ackCalls = 0, first = true;
        const calls: Array<{ key: string; body: string }> = [], originalFetch = globalThis.fetch;
        try {
          const seen = new Map<string, string>();
          globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
            assert.equal(new URL(String(url)).origin, 'https://api.line.me');
            const key = new Headers(init?.headers).get('X-Line-Retry-Key')!, body = String(init?.body);
            calls.push({ key, body });
            if (seen.has(key)) { assert.equal(body, seen.get(key)); return new Response('', { status: 409, headers: { 'x-line-accepted-request-id': 'synthetic-accepted' } }); }
            seen.set(key, body);
            if (first && failure !== 'accepted-ack-lost') { first = false; throw new TypeError('synthetic response lost after acceptance'); }
            return new Response('{}', { status: 200 });
          }) as typeof fetch;
          const config = { lineMessagingChannelId: 'synthetic-channel', lineMessagingChannelAccessToken: 'synthetic-token', lineAiLedgerClaimMinIdleMs: 1, lineAiLedgerDeliveryCap: 5, webBaseUrl: 'https://synthetic.example.test' } as any;
          const drain = new DrainLineLedgerUseCase(prisma, config, resolver,
            { enabled: true, claimOpenEntries: async () => [{ entry, deliveryCount: 1, idleMs: 1000 }], ack: async () => { ackCalls++; if (failure === 'accepted-ack-lost' && ackCalls === 1) throw new Error('synthetic ack lost'); } } as any,
            { requestLineTurn: async (request: any) => {
              modelCalls++;
              const readCtx = { ...ctx, requestId: request.requestId };
              const result = await tool.execute(readCtx, input); assert.equal(result.status, 'ok'); await service.record(readCtx, input, result);
              return { requestId: request.requestId, replyText: 'Synthetic queued vendor 123.45 บาท', sourceRefs: result.sourceRefs, sourceLabels: [], webLinks: [],
                intent: 'read_detail', agent: 'accounting', refused: false, toolsInvoked: [tool.toolName], durationMs: 1 };
            } } as any, new LineReplyAdapter(lineMessagingCredentialsFixture(config), config), { startSweep: () => ({ record: async () => {}, flush: async () => {} }) } as any);
          (drain as any).readEvidence = service; (drain as any).deliveryStore = new LineLedgerDeliveryService(prisma);
          (drain as any).logger = { log() {}, warn() {}, error() {}, debug() {} };
          await drain.execute();
          const id = lineLedgerDeliveryId(entry);
          assert.equal((await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id } })).status, failure === 'accepted-ack-lost' ? 'ACCEPTED' : 'UNKNOWN');
          if (failure === 'source-changed') await client.expenseRecord.update({ where: { id: expense.id }, data: { branchId: otherBranch.id } });
          if (failure === 'accepted-ack-lost') await client.role.update({ where: { id: roleId }, data: { status: 'DISABLED' } });
          await drain.execute(); await drain.execute();
          assert.equal(modelCalls, 1);
          const stored = await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id } });
          assert.match(JSON.stringify(stored.messagesJson), /Synthetic queued vendor/);
          if (entry.kind === 'turn') {
            const source = await client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId: entry.webhookEventId! } });
            assert.equal(source.deliveryOwnerId, `ledger:${id}`); assert.equal(source.status, 'completed');
          }
          if (failure === 'unknown') { assert.equal(stored.status, 'ACCEPTED'); assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]); }
          else if (failure === 'source-changed') {
            assert.equal(stored.status, 'REFUSED'); assert.equal(calls.length, 2);
            assert.doesNotMatch(calls[1].body, /Synthetic queued vendor/); assert.match(calls[1].body, /กรุณาเปิดเว็บ/);
          } else { assert.equal(stored.status, 'ACCEPTED'); assert.equal(calls.length, 1); }
        } finally {
          globalThis.fetch = originalFetch;
          await client.role.update({ where: { id: roleId }, data: { status: 'ACTIVE' } });
          await client.expenseRecord.update({ where: { id: expense.id }, data: { branchId: branch.id } });
        }
      });

      await t.test('disabled current actor and deleted source both fail revalidation', async () => {
        await client.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
        assert.equal(await verify(), false);
        await client.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
        await client.expenseRecord.delete({ where: { id: expense.id } });
        assert.equal(await verify(), false);
      });
    } finally {
      if (companyId) {
        await client.lineTurnOutcome.deleteMany({ where: { webhookEventId: { in: eventIds } } });
        await client.lineWebhookEventLog.deleteMany({ where: { webhookEventId: { in: eventIds } } });
        await client.aiTurn.deleteMany({ where: { companyId } });
        await client.auditLog.deleteMany({ where: { companyId } });
        await client.lineCompanyContext.deleteMany({ where: { lineUserId: { in: lineUsers } } });
        await client.externalIdentity.deleteMany({ where: { userId } });
        await client.expenseRecord.deleteMany({ where: { companyId } });
        await client.companyMembership.deleteMany({ where: { companyId } });
        if (roleId) { await client.rolePermission.deleteMany({ where: { roleId } }); await client.role.deleteMany({ where: { id: roleId } }); }
        await client.branch.deleteMany({ where: { companyId } });
        await client.company.deleteMany({ where: { id: companyId } });
      }
      if (userId) await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    }
  });
});
