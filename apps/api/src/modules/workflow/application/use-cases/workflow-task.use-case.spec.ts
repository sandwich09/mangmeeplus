import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ListWorkflowTasksUseCase, CompleteWorkflowTaskUseCase } from './workflow-task.use-case';

const noopAudit = { log: async () => undefined } as any;

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'user-1', companyId: 'co-1',
    membershipId: 'm', roles: ['STAFF'], permissions: ['workflow.task.read', 'workflow.task.work'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

describe('ListWorkflowTasksUseCase', () => {
  it('includes ctx.roles as assigneeRoles so role-only-assigned tasks are visible in "own" scope', async () => {
    const listTasks = mock.fn(async (_input: any) => []);
    const repo = { listTasks } as any;
    const uc = new ListWorkflowTasksUseCase(repo);
    await uc.execute(ctx({ roles: ['MANAGER'] }), { scope: 'own' });
    const call = listTasks.mock.calls[0]?.arguments[0] as any;
    assert.equal(call.assigneeUserId, 'user-1');
    assert.deepEqual(call.assigneeRoles, ['MANAGER']);
  });

  it('does not scope by role for broad-read roles reading scope=all', async () => {
    const listTasks = mock.fn(async (_input: any) => []);
    const repo = { listTasks } as any;
    const uc = new ListWorkflowTasksUseCase(repo);
    await uc.execute(ctx({ roles: ['OWNER'] }), { scope: 'all' });
    const call = listTasks.mock.calls[0]?.arguments[0] as any;
    assert.equal(call.assigneeUserId, undefined);
    assert.equal(call.assigneeRoles, undefined);
  });
});

describe('CompleteWorkflowTaskUseCase', () => {
  it('allows completing a task assigned to a role the caller holds, with no specific assigneeUserId', async () => {
    const task = { id: 't-1', companyId: 'co-1', assigneeUserId: undefined, assigneeRole: 'MANAGER', status: 'OPEN', title: 'x', priority: 'NORMAL', createdAt: new Date(), updatedAt: new Date() };
    const repo = {
      findTaskById: async () => task,
      updateTask: async (_c: string, _id: string, data: any) => ({ ...task, ...data }),
    } as any;
    const uc = new CompleteWorkflowTaskUseCase(repo, noopAudit);
    const result = await uc.execute(ctx({ roles: ['MANAGER'] }), 't-1');
    assert.equal(result.status, 'DONE');
  });

  it('blocks completing a role-assigned task when the caller does not hold that role', async () => {
    const task = { id: 't-1', companyId: 'co-1', assigneeUserId: undefined, assigneeRole: 'MANAGER', status: 'OPEN', title: 'x', priority: 'NORMAL', createdAt: new Date(), updatedAt: new Date() };
    const repo = { findTaskById: async () => task } as any;
    const uc = new CompleteWorkflowTaskUseCase(repo, noopAudit);
    await assert.rejects(() => uc.execute(ctx({ roles: ['STAFF'] }), 't-1'));
  });
});
