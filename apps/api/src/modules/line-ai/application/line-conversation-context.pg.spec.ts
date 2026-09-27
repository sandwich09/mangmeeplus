import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { LineConversationContextService, invalidateLineConversationState, lineConversationId, type LineConversationOwner } from './line-conversation-context.service';
const url = process.env.BILLING_TEST_DATABASE_URL;
test('G3 owner/CAS/lifecycle and explicit preference replay/expiry use actual PostgreSQL', { skip: !url }, async () => {
  const parsed = new URL(url!); assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.ok((parsed.port === '15439' && parsed.pathname === '/watchdog_bms_ai_reliability_20260927') || (parsed.port === '5432' && parsed.pathname === '/watchdog_postmark_ci'));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const company = await client.company.create({ data: { name: `context-${randomUUID()}` } }), userId = `user-${randomUUID()}`;
  const service = new LineConversationContextService({ client } as PrismaService);
  const owner: LineConversationOwner = { companyId: company.id, userId, membershipId: 'member-1', channel: 'line', channelKind: 'USER', messagingChannelId: 'oa-A', chatKeyHash: 'chat-1' }, other = { ...owner, messagingChannelId: 'oa-B' };
  const now = new Date();
  try {
    await assert.rejects(invalidateLineConversationState({} as any, {} as any, true), /LINE_CONTEXT_SCOPE_REQUIRED/);
    assert.notEqual(lineConversationId(owner), lineConversationId(other));
    await service.admit(owner); await service.admit(other);
    const projection = { version: 2 as const, tasks: [{ taskId: 'api-task', revision: 1, kind: 'general' as const, state: 'active' as const, userGoal: 'explain', subrequests: [] }] };
    assert.deepEqual((await Promise.all([service.save(owner, 0, 0, projection, now), service.save(owner, 0, 0, projection, now)])).sort(), [false, true]);
    assert.equal((await service.load(other, now))!.state, null);
    assert.equal((await service.load(owner, new Date(now.getTime() + 16 * 60000)))!.state, null);
    assert.equal(await service.changePreferences(owner, { requestId: 'remember-1', expectedVersion: 0, epoch: 0, set: { detail: 'short' } }, now), 'applied');
    assert.equal(await service.changePreferences(owner, { requestId: 'remember-1', expectedVersion: 0, epoch: 0, set: { detail: 'short' } }, now), 'applied');
    assert.deepEqual((await service.listPreferences(owner, now))?.values, { detail: 'short' });
    const expiredPreferences = await service.listPreferences(owner, new Date(now.getTime() + 91 * 86400000));
    assert.deepEqual(expiredPreferences?.values, {});
    assert.equal(await service.changePreferences(owner, { requestId: 'forget-1', expectedVersion: expiredPreferences!.version, epoch: 0, delete: 'all' }, now), 'applied');
    assert.equal(await service.changePreferences(owner, { requestId: 'old-set', expectedVersion: 0, epoch: 0, set: { detail: 'detailed' } }, now), 'stale');
    await client.$transaction(tx => invalidateLineConversationState(tx, { companyId: company.id, userId }, true));
    assert.equal(await service.save(owner, 1, 0, projection, now), false);
    assert.equal(await service.changePreferences(owner, { requestId: 'old-set', expectedVersion: 2, epoch: 0, set: { detail: 'detailed' } }, now), 'stale');
    const tombstone = await service.admit(owner); assert.equal(tombstone.lifecycleEpoch, 1); assert.equal(tombstone.taskStateJson, null);
    assert.deepEqual((await service.listPreferences(owner, now))?.values, {});
    await assert.rejects(client.aiConversation.create({ data: { companyId: company.id, userId, channelKind: 'USER' } }), /constraint/i);
  } finally { await client.company.delete({ where: { id: company.id } }); await client.$disconnect(); }
});

test('QA task binding survives process-local maps and never restores another OA or lifecycle', { skip: !url }, async () => {
  const parsed = new URL(url!); assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.ok((parsed.port === '15439' && parsed.pathname === '/watchdog_bms_ai_reliability_20260927') || (parsed.port === '5432' && parsed.pathname === '/watchdog_postmark_ci'));
  const { ProcessLineWebhookUseCase } = await import('./use-cases/process-line-webhook.use-case');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const company = await client.company.create({ data: { name: `qa-task-${randomUUID()}` } });
  const service = new LineConversationContextService({ client } as PrismaService);
  const owner: LineConversationOwner = { companyId: company.id, userId: `user-${randomUUID()}`, membershipId: 'member', channel: 'line', channelKind: 'USER', messagingChannelId: 'oa-A', chatKeyHash: 'chat' };
  const event = { webhookEventId: 'qa-event' }, flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
  try {
    const row = await service.admit(owner);
    Object.assign(flow, { contextV2: service, boundConversations: new WeakMap([[event, { owner, id: row.id, epoch: 0 }]]), semanticTaskMappings: new WeakMap(),
      documentQa: { getById: async () => ({ id: 'job', ...owner, ownerMembershipId: owner.membershipId, ownerEpoch: 0, revision: 1,
        attachmentsJson: [{ attachmentId: 'file', contentHash: 'a'.repeat(64), requestedPages: [1, 2] }] }) } });
    assert.equal(await flow.preserveSemanticTask(event, [{ index: 0, kind: 'file', goal: 'read total' }, { index: 1, kind: 'general', goal: 'explain weather' }]), true);
    await flow.bindDocumentQaTask(event, 'job');
    flow.semanticTaskMappings = new WeakMap();
    const recovered = { webhookEventId: 'qa-event' }; flow.boundConversations.set(recovered, { owner, id: row.id, epoch: 0 });
    assert.deepEqual((await flow.restoreDocumentQaTask(recovered, 'job')).map((item: any) => item.kind), ['file', 'general']);
    assert.equal((await service.projection(owner))!.tasks[0]!.state, 'waiting_job');
    const otherOwner = { ...owner, messagingChannelId: 'oa-B' }; await service.admit(otherOwner);
    const otherEvent = {}; flow.boundConversations.set(otherEvent, { owner: otherOwner, epoch: 0 });
    assert.deepEqual(await flow.restoreDocumentQaTask(otherEvent, 'job'), []);
    await flow.settleSemanticTask(recovered, [{ index: 0, status: 'handled' }, { index: 1, status: 'needs_user', question: 'explain weather' }]);
    const saved = (await service.projection(owner))!.tasks[0]!;
    assert.equal(saved.state, 'waiting_user'); assert.deepEqual(saved.subrequests.map(item => item.status), ['handled', 'needs_user']);
    await client.$transaction(tx => invalidateLineConversationState(tx, { companyId: company.id, userId: owner.userId }, true));
    assert.deepEqual(await flow.restoreDocumentQaTask(recovered, 'job'), []);
  } finally { await client.company.delete({ where: { id: company.id } }); await client.$disconnect(); }
});

test('actual role/scope/status writers invalidate retained context atomically and preserve unrelated owners', { skip: !url }, async () => {
  const parsed = new URL(url!); assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.ok((parsed.port === '15439' && parsed.pathname === '/watchdog_bms_ai_reliability_20260927') || (parsed.port === '5432' && parsed.pathname === '/watchdog_postmark_ci'));
  const { UpdateRoleUseCase } = await import('../../employee-access/application/use-cases/update-role.use-case');
  const { UpdateEmployeeUseCase } = await import('../../employee-access/application/use-cases/update-employee.use-case');
  const { SetEmployeeStatusUseCase } = await import('../../employee-access/application/use-cases/set-employee-status.use-case');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const user = await client.user.create({ data: { displayName: 'Synthetic context scope' } });
  const company = await client.company.create({ data: { name: `scope-${randomUUID()}` } });
  const foreign = await client.company.create({ data: { name: `foreign-${randomUUID()}` } });
  const previousPermission = await client.permission.findUnique({ where: { key: 'crm.customer.read' } });
  const permission = previousPermission ?? await client.permission.create({ data: { key: 'crm.customer.read', description: 'Read customers' } });
  const role = await client.role.create({ data: { companyId: company.id, scopeKey: company.id, key: 'CONTEXT_SCOPE_TEST', name: 'Synthetic scope', permissions: { create: { permissionId: permission.id } } } });
  const member = await client.companyMembership.create({ data: { companyId: company.id, userId: user.id, roles: { create: { roleId: role.id } } } });
  const employee = await client.employeeAccessProfile.create({ data: { companyId: company.id, userId: user.id, membershipId: member.id,
    displayName: 'Synthetic scope', identityType: 'PASSPORT', identityLast4: '0000', identityHash: randomUUID(), identityEncryptedRef: 'synthetic-only',
    phoneNumber: '0800000000', createdByUserId: user.id, status: 'ACTIVE' } });
  const service = new LineConversationContextService({ client } as PrismaService);
  const owner: LineConversationOwner = { companyId: company.id, userId: user.id, membershipId: member.id, channel: 'line', channelKind: 'USER', messagingChannelId: 'oa', chatKeyHash: 'chat' };
  const other = { ...owner, companyId: foreign.id, membershipId: 'foreign-member' };
  const projection = { version: 2 as const, tasks: [{ taskId: 'scope-task', revision: 1, kind: 'general' as const, state: 'active' as const, userGoal: 'retained private question', subrequests: [] }] };
  const employeeCommand = { companyId: company.id, employeeId: employee.id, requestingUserId: user.id, requesterPermissions: ['access.role.manage', 'access.employee.update'], requestId: randomUUID() };
  try {
    await service.admit(owner); await service.admit(other);
    await service.save(owner, 0, 0, projection); await service.save(other, 0, 0, projection);
    await service.changePreferences(owner, { requestId: randomUUID(), expectedVersion: 0, epoch: 0, set: { detail: 'short' } });
    await new UpdateRoleUseCase({ client } as PrismaService).execute({ companyId: company.id, roleId: role.id, permissionKeys: ['crm.customer.read'], requestingUserId: user.id, requestId: randomUUID(), isOwner: true });
    let current = (await service.load(owner))!;
    assert.equal(current.row.lifecycleEpoch, 1); assert.equal(current.state, null);
    assert.deepEqual((await service.listPreferences(owner))?.values, { detail: 'short' });
    assert.equal((await service.load(other))!.row.lifecycleEpoch, 0); assert.ok((await service.load(other))!.state);
    assert.equal(await service.save(owner, 1, 0, projection), false, 'pre-change worker cannot resurrect the task');
    await service.save(owner, current.row.stateVersion, current.row.lifecycleEpoch, projection);
    // Force a failure after invalidation inside the real transaction, not a fake rollback.
    const failing = { client: new Proxy(client, { get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key);
      return (run: (tx: any) => unknown) => target.$transaction(tx => run(new Proxy(tx, { get(transaction, field) {
        return field === 'auditLog' ? { create: async () => { throw new Error('synthetic audit rollback'); } } : Reflect.get(transaction, field);
      } })) as Promise<any>);
    } }) } as PrismaService;
    await assert.rejects(new UpdateEmployeeUseCase(failing, {} as any).execute({ ...employeeCommand, branchScopeMode: 'ALL_BRANCHES' }), /synthetic audit rollback/);
    assert.equal((await service.load(owner))!.row.lifecycleEpoch, 1); assert.ok((await service.load(owner))!.state);
    await new UpdateEmployeeUseCase({ client } as PrismaService, {} as any).execute({ ...employeeCommand, branchScopeMode: 'ALL_BRANCHES' });
    current = (await service.load(owner))!; assert.equal(current.row.lifecycleEpoch, 2); assert.equal(current.state, null);
    await new SetEmployeeStatusUseCase({ client } as PrismaService).execute({ ...employeeCommand, status: 'SUSPENDED' });
    assert.equal((await service.load(owner))!.row.lifecycleEpoch, 3); assert.deepEqual((await service.listPreferences(owner))?.values, { detail: 'short' });
    await new SetEmployeeStatusUseCase({ client } as PrismaService).execute({ ...employeeCommand, status: 'DISABLED' });
    assert.equal((await service.load(owner))!.row.lifecycleEpoch, 4); assert.deepEqual((await service.listPreferences(owner))?.values, {});
  } finally {
    await client.company.deleteMany({ where: { id: { in: [company.id, foreign.id] } } });
    await client.role.delete({ where: { id: role.id } }); await client.user.delete({ where: { id: user.id } });
    if (!previousPermission) await client.permission.deleteMany({ where: { id: permission.id, roles: { none: {} } } });
    await client.$disconnect();
  }
});
