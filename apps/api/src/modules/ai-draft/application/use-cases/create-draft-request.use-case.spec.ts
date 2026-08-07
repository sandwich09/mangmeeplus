import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CreateDraftRequestUseCase } from './create-draft-request.use-case';

const noopAudit = { log: async () => undefined } as any;

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'user-1', companyId: 'co-1',
    membershipId: 'm', roles: ['SALES'], permissions: ['ai.suggestion.request', 'crm.customer.read'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function makeRepo(existing: any = null) {
  const createRequest = mock.fn(async (data: any) => ({
    id: 'req_new', companyId: data.companyId, requesterUserId: data.requesterUserId, origin: data.origin,
    agent: data.agent, templateKey: data.templateKey, sourceRefsJson: {}, language: data.language,
    status: 'QUEUED', idempotencyKey: data.idempotencyKey, createdAt: new Date(), updatedAt: new Date(),
    expiresAt: data.expiresAt, sourceModule: data.sourceModule, sourceRecordType: data.sourceRecordType, sourceRecordId: data.sourceRecordId,
  }));
  const findRequestByIdempotencyKey = mock.fn(async () => existing);
  return { createRequest, findRequestByIdempotencyKey } as any;
}

describe('CreateDraftRequestUseCase', () => {
  it('rejects a requester without ai.suggestion.request', async () => {
    const uc = new CreateDraftRequestUseCase(makeRepo(), noopAudit);
    await assert.rejects(() => uc.execute(ctx({ permissions: [] }), { templateKey: 'crm_followup_next_action' }));
  });

  it('rejects an unknown template', async () => {
    const uc = new CreateDraftRequestUseCase(makeRepo(), noopAudit);
    await assert.rejects(() => uc.execute(ctx(), { templateKey: 'does_not_exist' }));
  });

  it('enforces the template required source permission (bank.cash.read for CFO)', async () => {
    const uc = new CreateDraftRequestUseCase(makeRepo(), noopAudit);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['ai.suggestion.request'] }), { templateKey: 'cfo_cash_risk_summary' }),
      /bank.cash.read/,
    );
  });

  it('creates a QUEUED request on the happy path', async () => {
    const repo = makeRepo();
    const uc = new CreateDraftRequestUseCase(repo, noopAudit);
    const out = await uc.execute(ctx(), { templateKey: 'crm_followup_next_action', sourceRecordType: 'customer', sourceRecordId: 'cust1' });
    assert.equal(out.status, 'QUEUED');
    assert.equal(repo.createRequest.mock.calls.length, 1);
    assert.equal(out.templateKey, 'crm_followup_next_action');
  });

  it('is idempotent: a duplicate returns the existing request without creating another', async () => {
    const existing = {
      id: 'req_existing', companyId: 'co-1', requesterUserId: 'u', origin: 'WORKFLOW', agent: 'CRM',
      templateKey: 'crm_followup_next_action', sourceRefsJson: {}, language: 'th-TH', status: 'READY',
      idempotencyKey: 'k', createdAt: new Date(), updatedAt: new Date(),
    };
    const repo = makeRepo(existing);
    const uc = new CreateDraftRequestUseCase(repo, noopAudit);
    const out = await uc.execute(ctx(), { templateKey: 'crm_followup_next_action', origin: 'WORKFLOW', workflowRunId: 'run1', idempotencyKey: 'k' });
    assert.equal(out.id, 'req_existing');
    assert.equal(repo.createRequest.mock.calls.length, 0);
  });
});
