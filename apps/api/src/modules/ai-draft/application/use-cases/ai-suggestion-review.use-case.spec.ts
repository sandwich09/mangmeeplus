import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateSourceDraftUseCase,
  ReviewSuggestionUseCase,
  ValidateCandidateActionUseCase,
} from './ai-suggestion-review.use-case';
import { SourceDraftAdapterService } from '../adapters/source-draft-adapter.service';

const noopAudit = { log: async () => undefined } as any;

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'user-1', companyId: 'co-1', membershipId: 'm',
    roles: ['OWNER'], permissions: ['ai.draft.create_source_draft', 'ai.draft.review', 'crm.follow_up.create', 'crm.customer.read'],
    scopes: {}, authProvider: 'watchdog', ...overrides,
  } as any;
}

function crmAction(overrides: Partial<any> = {}) {
  return {
    id: 'act1', suggestionId: 'sugg1', companyId: 'co-1', actionType: 'CREATE_CRM_FOLLOW_UP_DRAFT',
    targetModule: 'crm', targetRecordType: 'customer', targetRecordId: 'cust1',
    draftPayloadJson: { customerId: 'cust1', title: 'Call ACME', dueAt: '2026-07-02T00:00:00Z' },
    requiredPermissions: ['crm.follow_up.create'], riskLevel: 'MEDIUM', idempotencyKey: 'i', status: 'PROPOSED',
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function suggestion(overrides: Partial<any> = {}) {
  return {
    id: 'sugg1', companyId: 'co-1', draftRequestId: 'req1', templateKey: 'crm_followup_next_action',
    agent: 'CRM', domain: 'SALES_CRM', title: 't', summary: 's', recommendation: 'r', riskLevel: 'MEDIUM',
    confidence: 60, status: 'NEW', needsDataReasonsJson: [], blockedReasonsJson: [], sourceStateHash: 'h1',
    sourceModule: 'crm', sourceRecordType: 'customer', sourceRecordId: 'cust1', candidateActionCount: 1,
    reviewOwnerUserId: 'user-1', expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepo(sug: any, action: any) {
  return {
    findSuggestionById: mock.fn(async () => ({ suggestion: sug, citations: [], artifacts: [], candidateActions: [action], reviews: [] })),
    findCandidateActionById: mock.fn(async () => action),
    updateCandidateAction: mock.fn(async (_id: string, data: any) => ({ ...action, ...data })),
    updateSuggestionStatus: mock.fn(async (_c: string, _id: string, status: string) => ({ ...sug, status })),
    createReview: mock.fn(async (data: any) => ({ id: 'rev1', ...data, createdAt: new Date() })),
  } as any;
}

const adapter = {
  createDraft: mock.fn(async () => ({ createdSourceModule: 'crm', createdSourceRecordType: 'crm_follow_up', createdSourceRecordId: 'fu1', deepLink: '/x' })),
} as any;

const unchangedSourceState = { canRead: async () => true, isChanged: async () => false } as any;
const changedSourceState = { canRead: async () => true, isChanged: async () => true } as any;

describe('CreateSourceDraftUseCase', () => {
  it('refuses source draft creation from LINE (web-only)', async () => {
    const repo = makeRepo(suggestion(), crmAction());
    const uc = new CreateSourceDraftUseCase(repo, noopAudit, unchangedSourceState, adapter);
    await assert.rejects(() => uc.execute(ctx({ authProvider: 'line' }), 'sugg1', 'act1', {}), /web-only/);
  });

  it('blocks when the user lacks ai.draft.create_source_draft', async () => {
    const repo = makeRepo(suggestion(), crmAction());
    const uc = new CreateSourceDraftUseCase(repo, noopAudit, unchangedSourceState, adapter);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.follow_up.create'] }), 'sugg1', 'act1', {}),
      /ai.draft.create_source_draft/,
    );
  });

  it('blocks when the user lacks the source-module permission', async () => {
    const repo = makeRepo(suggestion(), crmAction());
    const uc = new CreateSourceDraftUseCase(repo, noopAudit, unchangedSourceState, adapter);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['ai.draft.create_source_draft'] }), 'sugg1', 'act1', {}),
      /crm.follow_up.create/,
    );
  });

  it('blocks a needs-data suggestion before calling a source adapter', async () => {
    const repo = makeRepo(suggestion({ needsDataReasonsJson: ['citation required'] }), crmAction());
    const localAdapter = { createDraft: mock.fn(async () => ({ createdSourceModule: 'crm' })) } as any;
    const uc = new CreateSourceDraftUseCase(repo, noopAudit, unchangedSourceState, localAdapter);
    await assert.rejects(
      () => uc.execute(ctx(), 'sugg1', 'act1', {}),
      (error: any) => error.getResponse?.().code === 'ai_suggestion_needs_data',
    );
    assert.equal(localAdapter.createDraft.mock.calls.length, 0);
  });

  it('blocks the no-source placeholder instead of reporting a draft as created', async () => {
    const action = crmAction({ actionType: 'NO_SOURCE_DRAFT_AVAILABLE', targetModule: 'ai-draft', draftPayloadJson: {} }) as any;
    const repo = makeRepo(suggestion(), action);
    const localAdapter = { createDraft: mock.fn(async () => ({ createdSourceModule: 'ai-draft' })) } as any;
    const uc = new CreateSourceDraftUseCase(repo, noopAudit, unchangedSourceState, localAdapter);
    await assert.rejects(
      () => uc.execute(ctx(), 'sugg1', 'act1', {}),
      (error: any) => error.getResponse?.().code === 'ai_source_draft_unavailable',
    );
    assert.equal(localAdapter.createDraft.mock.calls.length, 0);
  });

  it('creates the source draft and records a review on the happy path', async () => {
    const repo = makeRepo(suggestion(), crmAction());
    const localAdapter = { createDraft: mock.fn(async () => ({ createdSourceModule: 'crm', createdSourceRecordType: 'crm_follow_up', createdSourceRecordId: 'fu1', deepLink: '/x' })) } as any;
    const uc = new CreateSourceDraftUseCase(repo, noopAudit, unchangedSourceState, localAdapter);
    const out = await uc.execute(ctx(), 'sugg1', 'act1', {});
    assert.equal(out.status, 'SOURCE_DRAFT_CREATED');
    assert.equal(localAdapter.createDraft.mock.calls.length, 1);
    assert.equal(repo.createReview.mock.calls.length, 1);
    assert.equal(repo.createReview.mock.calls[0]!.arguments[0].decision, 'ACCEPT_AS_SOURCE_DRAFT');
  });

  it('blocks creation when the source state changed and is not acknowledged', async () => {
    const repo = makeRepo(suggestion(), crmAction());
    const uc = new CreateSourceDraftUseCase(repo, noopAudit, changedSourceState, adapter);
    await assert.rejects(() => uc.execute(ctx(), 'sugg1', 'act1', {}), /changed after generation/);
    // Suggestion is moved to BLOCKED_BY_SOURCE_STATE.
    assert.ok(repo.updateSuggestionStatus.mock.calls.some((c: any) => c.arguments[2] === 'BLOCKED_BY_SOURCE_STATE'));
  });

  it('proceeds when the source-state change is acknowledged', async () => {
    const repo = makeRepo(suggestion(), crmAction());
    const localAdapter = { createDraft: mock.fn(async () => ({ createdSourceModule: 'crm', createdSourceRecordType: 'crm_follow_up', createdSourceRecordId: 'fu1' })) } as any;
    const uc = new CreateSourceDraftUseCase(repo, noopAudit, changedSourceState, localAdapter);
    const out = await uc.execute(ctx(), 'sugg1', 'act1', { acknowledgeSourceStateChanged: true });
    assert.equal(out.status, 'SOURCE_DRAFT_CREATED');
  });

  it('rejects a second create for an already-created action (idempotency)', async () => {
    const repo = makeRepo(suggestion(), crmAction({ status: 'SOURCE_DRAFT_CREATED' }));
    const uc = new CreateSourceDraftUseCase(repo, noopAudit, unchangedSourceState, adapter);
    await assert.rejects(() => uc.execute(ctx(), 'sugg1', 'act1', {}), /already created/);
  });
});

describe('ValidateCandidateActionUseCase', () => {
  it('validates a well-formed CRM follow-up action', async () => {
    const action = crmAction();
    const repo = makeRepo(suggestion(), action);
    const uc = new ValidateCandidateActionUseCase(repo, noopAudit, unchangedSourceState);
    const out = await uc.execute(ctx(), 'sugg1', 'act1');
    assert.equal(out.status, 'VALIDATED');
  });

  it('reports validation failure for a payload missing required fields', async () => {
    const action = crmAction({ draftPayloadJson: { customerId: 'cust1' } });
    const repo = makeRepo(suggestion(), action);
    const uc = new ValidateCandidateActionUseCase(repo, noopAudit, unchangedSourceState);
    const out = await uc.execute(ctx(), 'sugg1', 'act1');
    assert.equal(out.status, 'VALIDATION_FAILED');
  });

  it('does not mark a needs-data action as validated', async () => {
    const action = crmAction();
    const repo = makeRepo(suggestion({ needsDataReasonsJson: ['citation required'] }), action);
    const uc = new ValidateCandidateActionUseCase(repo, noopAudit, unchangedSourceState);
    await assert.rejects(
      () => uc.execute(ctx(), 'sugg1', 'act1'),
      (error: any) => error.getResponse?.().code === 'ai_suggestion_needs_data',
    );
    assert.equal(repo.updateCandidateAction.mock.calls.length, 0);
  });
});

describe('ReviewSuggestionUseCase', () => {
  it('keeps needs-data suggestions out of accepted state with zero review writes', async () => {
    const repo = makeRepo(suggestion({ needsDataReasonsJson: ['citation required'] }), crmAction());
    const createRequest = { execute: mock.fn(async () => ({ id: 'req2' })) } as any;
    const uc = new ReviewSuggestionUseCase(repo, noopAudit, createRequest, unchangedSourceState);
    await assert.rejects(
      () => uc.execute(ctx(), 'sugg1', { decision: 'ACCEPT_AS_SOURCE_DRAFT' }),
      (error: any) => error.getResponse?.().code === 'ai_suggestion_needs_data',
    );
    assert.equal(repo.createReview.mock.calls.length, 0);
    assert.equal(repo.updateSuggestionStatus.mock.calls.length, 0);
    assert.equal(createRequest.execute.mock.calls.length, 0);
  });

  it('still lets a needs-data suggestion request regeneration', async () => {
    const repo = makeRepo(suggestion({ needsDataReasonsJson: ['citation required'] }), crmAction());
    const createRequest = { execute: mock.fn(async () => ({ id: 'req2' })) } as any;
    const uc = new ReviewSuggestionUseCase(repo, noopAudit, createRequest, unchangedSourceState);
    await uc.execute(ctx(), 'sugg1', { decision: 'REQUEST_REGENERATION' });
    assert.equal(repo.createReview.mock.calls.length, 1);
    assert.ok(repo.updateSuggestionStatus.mock.calls.some((call: any) => call.arguments[2] === 'SUPERSEDED'));
    assert.equal(createRequest.execute.mock.calls.length, 1);
  });
});

describe('SourceDraftAdapterService', () => {
  it('fails closed for the no-source placeholder even if called directly', async () => {
    const service = new SourceDraftAdapterService({ execute: async () => ({ id: 'unused' }) } as any);
    const action = crmAction({ actionType: 'NO_SOURCE_DRAFT_AVAILABLE', targetModule: 'ai-draft', draftPayloadJson: {} }) as any;
    assert.equal(service.supports(action), false);
    await assert.rejects(
      () => service.createDraft(ctx(), action),
      (error: any) => error.getResponse?.().code === 'ai_source_draft_unavailable',
    );
  });
});


it('blocks validate, review and create after source access is revoked, with zero writes', async () => {
  for (const missingPermission of [true, false]) {
    const repo = makeRepo(suggestion(), crmAction());
    const access = ctx(missingPermission ? { permissions: ctx().permissions.filter((p: string) => p !== 'crm.customer.read') } : {});
    const state = { ...unchangedSourceState, canRead: async () => missingPermission } as any;
    const createRequest = { execute: mock.fn() } as any;
    const localAdapter = { createDraft: mock.fn() } as any;
    await assert.rejects(() => new ValidateCandidateActionUseCase(repo, noopAudit, state).execute(access, 'sugg1', 'act1'), /no longer readable/);
    await assert.rejects(() => new ReviewSuggestionUseCase(repo, noopAudit, createRequest, state).execute(access, 'sugg1', { decision: 'REQUEST_REGENERATION' }), /no longer readable/);
    await assert.rejects(() => new CreateSourceDraftUseCase(repo, noopAudit, state, localAdapter).execute(access, 'sugg1', 'act1', { acknowledgeSourceStateChanged: true }), /no longer readable/);
    for (const fn of [repo.updateCandidateAction, repo.updateSuggestionStatus, repo.createReview, createRequest.execute, localAdapter.createDraft]) assert.equal(fn.mock.calls.length, 0);
  }
});
