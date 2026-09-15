import { lineMessagingCredentialsFixture } from '../../common/config/line-messaging-credentials.fixture';
import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { PermissionResolverService } from '../access-control/application/permission-resolver.service';
import { PrismaPermissionResolverRepository } from '../access-control/infrastructure/prisma-permission-resolver.repository';
import { AuditService } from '../audit/application/audit.service';
import { PrismaAuditRepository } from '../audit/infrastructure/prisma-audit.repository';
import { ProcessLineWebhookUseCase } from './application/use-cases/process-line-webhook.use-case';

const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;

/** Real membership/role/entitlement/identity reads and durable outcomes. Model/LINE transport are simulated. */
describe('LINE delivery actor access on isolated PostgreSQL', { skip: !databaseUrl }, () => {
  let client: PrismaClient;
  const companies: string[] = [], users: string[] = [], roles: string[] = [], eventIds: string[] = [], lineUsers: string[] = [];
  const quiet = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok((url.port === '15432' && url.pathname === '/mangmee_billing_20260912')
      || (url.port === '5432' && url.pathname === '/watchdog_postmark_ci'), 'only a dedicated disposable local/CI database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await client.$queryRaw`SELECT 1`;
  });

  after(async () => {
    if (!client) return;
    try {
      await client.lineCompanyContext.deleteMany({ where: { lineUserId: { in: lineUsers } } });
      await client.lineWebhookEventLog.deleteMany({ where: { webhookEventId: { in: eventIds } } });
      await client.auditLog.deleteMany({ where: { companyId: { in: companies } } });
      await client.aiTurn.deleteMany({ where: { companyId: { in: companies } } });
      await client.aiConversation.deleteMany({ where: { companyId: { in: companies } } });
      await client.companyMembership.deleteMany({ where: { companyId: { in: companies } } });
      await client.rolePermission.deleteMany({ where: { roleId: { in: roles } } });
      await client.role.deleteMany({ where: { id: { in: roles } } });
      await client.company.deleteMany({ where: { id: { in: companies } } });
      await client.user.deleteMany({ where: { id: { in: users } } });
    } finally { await client.$disconnect(); }
  });

  async function fixture() {
    const tag = `line-access-${randomUUID()}`;
    const user = await client.user.create({ data: { displayName: tag, status: 'ACTIVE' } }); users.push(user.id);
    const company = await client.company.create({ data: { name: tag, status: 'ACTIVE' } }); companies.push(company.id);
    const permission = await client.permission.upsert({ where: { key: 'line.ai.query' }, update: {}, create: { key: 'line.ai.query', description: 'LINE AI query' } });
    const role = await client.role.create({ data: { key: 'STAFF', scopeKey: company.id, companyId: company.id, name: 'Synthetic LINE staff',
      permissions: { create: { permissionId: permission.id } } } }); roles.push(role.id);
    const membership = await client.companyMembership.create({ data: { userId: user.id, companyId: company.id, roles: { create: { roleId: role.id } } } });
    const lineUserId = `U${randomUUID().replaceAll('-', '')}`; lineUsers.push(lineUserId);
    const identity = await client.externalIdentity.create({ data: { userId: user.id, provider: 'LINE', providerUserId: lineUserId, providerChannelId: 'synthetic-channel' } });
    await client.lineCompanyContext.create({ data: { lineUserId, companyId: company.id } });
    await client.companyFeatureEntitlement.create({ data: { companyId: company.id, featureKey: 'ai_line_assistant', enabled: true } });
    const prisma = { client } as unknown as PrismaService;
    const resolver = new PermissionResolverService(new PrismaPermissionResolverRepository(prisma));
    const requests: any[] = [], deliveries: any[] = [];
    let duringModel = async () => {};
    const useCase = new ProcessLineWebhookUseCase(lineMessagingCredentialsFixture({ webBaseUrl: 'https://synthetic.example.test', lineAiTerminalOutcomeReplayEnabled: true } as any), prisma,
      { webBaseUrl: 'https://synthetic.example.test', lineAiTerminalOutcomeReplayEnabled: true } as any,
      resolver, new AuditService(new PrismaAuditRepository(prisma), quiet as any),
      { requestLineIntakeRoute: async (request: unknown) => { requests.push(request); return { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 1 }; },
        requestLineTurn: async (request: unknown) => {
          requests.push(request); await duringModel();
          return { requestId: 'synthetic-model', replyText: 'ข้อมูลจำลองที่เป็นส่วนตัว 987654 บาท', sourceRefs: [], sourceLabels: [], webLinks: [],
            intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: [], durationMs: 1 };
        } } as any,
      { buildTextMessage: (text: string) => ({ type: 'text', text }),
        sendReply: async (_token: string, messages: unknown) => { deliveries.push(messages); return 'ok'; },
        sendPush: async () => assert.fail('this fixture has a valid reply token') } as any,
      {} as any, {} as any, { isRequired: async () => false } as any,
      { startSweep: () => ({ record: async () => {}, flush: async () => {} }) } as any,
      { assertLaunchRouteOpen: async () => {} } as any);
  (useCase as any).readEvidence = { forTurn: async () => [], verify: async () => true, verifyDelivery: async () => false };
    (useCase as any).logger = quiet;
    const execute = async () => {
      const webhookEventId = randomUUID(); eventIds.push(webhookEventId);
      await useCase.execute({ webhookEventId, lineUserId, replyToken: 'synthetic-reply', messagingChannelId: 'synthetic-channel', messageText: 'ยอดตามสิทธิ์ปัจจุบันเท่าไร' });
      return webhookEventId;
    };
    return { user, company, membership, role, identity, lineUserId, deliveries, requests, execute,
      changeDuringModel: (change: () => Promise<unknown>) => { duringModel = async () => { await change(); }; } };
  }

  it('sends with current access, retains the outcome, and never forwards the old private answer into a second turn', async () => {
    const f = await fixture();
    const first = await f.execute();
    assert.match(JSON.stringify(f.deliveries), /987654/);
    assert.equal((await client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId: first } })).status, 'completed');
    assert.ok((await client.lineTurnOutcome.findUniqueOrThrow({ where: { webhookEventId: first } })).deliveredAt);
    f.requests.length = 0;
    await f.execute();
    assert.doesNotMatch(JSON.stringify(f.requests), /987654/);
    assert.ok(f.requests[0].conversationContext.recentTurns.length > 0);
  });

  for (const change of ['role', 'membership', 'company', 'branch', 'feature', 'unlink', 'optout'] as const) {
    it(`suppresses a prepared answer after actual DB ${change} revocation and preserves the original business outcome`, async () => {
      const f = await fixture();
      f.changeDuringModel(async () => {
        switch (change) {
          case 'role': return client.role.update({ where: { id: f.role.id }, data: { status: 'DISABLED' } });
          case 'membership': return client.companyMembership.update({ where: { id: f.membership.id }, data: { status: 'SUSPENDED' } });
          case 'company': return client.company.update({ where: { id: f.company.id }, data: { status: 'DISABLED' } });
          case 'branch': return client.companyMembership.update({ where: { id: f.membership.id }, data: { branchScopeMode: 'SELECTED_BRANCHES' } });
          case 'feature': return client.companyFeatureEntitlement.update({ where: { companyId_featureKey: { companyId: f.company.id, featureKey: 'ai_line_assistant' } }, data: { enabled: false } });
          case 'unlink': return client.externalIdentity.delete({ where: { id: f.identity.id } });
          case 'optout': return client.user.update({ where: { id: f.user.id }, data: { aiAssistantOptOutAt: new Date() } });
        }
      });
      const id = await f.execute();
      assert.doesNotMatch(JSON.stringify(f.deliveries), /987654|companies\//);
      assert.match(JSON.stringify(f.deliveries), /สิทธิ์หรือร้านที่เลือกเปลี่ยน/);
      const event = await client.lineWebhookEventLog.findUniqueOrThrow({ where: { webhookEventId: id } });
      assert.equal(event.status, 'delivery_failed');
      assert.equal(event.errorCode, 'LINE_DELIVERY_ACCESS_CHANGED');
      const outcome = await client.lineTurnOutcome.findUniqueOrThrow({ where: { webhookEventId: id } });
      assert.equal(outcome.deliveredAt, null);
      assert.match(JSON.stringify(outcome.messagesJson), /987654/, 'retained business outcome is distinct from delivery authority');
      assert.equal(await client.auditLog.count({ where: { companyId: f.company.id, targetId: id, action: 'ai.line.delivery.denied' } }), 1);
    });
  }
});
