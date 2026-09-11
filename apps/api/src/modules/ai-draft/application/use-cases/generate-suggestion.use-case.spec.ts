import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { __resetCompanyAiBudgetCache } from '../../../line-ai/application/company-ai-usage-meter';
import { GenerateSuggestionUseCase } from './generate-suggestion.use-case';
import { SuggestionGeneratorService } from '../generators/suggestion-generator.service';
import { FakeLlmDraftProvider } from '../../infrastructure/provider/fake-llm-draft.provider';
import { DisabledLlmDraftProvider } from '../../infrastructure/provider/disabled-llm-draft.provider';

const noopAudit = { log: async () => undefined } as any;

function makeRequest(overrides: Partial<any> = {}) {
  return {
    id: 'req1', companyId: 'co-1', requesterUserId: 'user-1', origin: 'WEB', agent: 'CRM',
    templateKey: 'crm_followup_next_action', sourceRefsJson: {}, language: 'th-TH', status: 'QUEUED',
    idempotencyKey: 'k', sourceModule: 'crm', sourceRecordType: 'customer', sourceRecordId: 'cust1',
    createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), ...overrides,
  };
}

function makeRepo(request: any) {
  const persisted: any[] = [];
  const statusUpdates: Array<{ status: string; options?: any }> = [];
  const repo = {
    findRequestById: mock.fn(async () => request),
    findSuggestionByRequestId: mock.fn(async () => null),
    updateRequestStatus: mock.fn(async (_id: string, status: string, options?: any) => { statusUpdates.push({ status, options }); }),
    persistGeneratedSuggestion: mock.fn(async (_reqId: string, _status: string, input: any) => {
      persisted.push({ status: _status, input });
      return { id: 'sugg1', ...input };
    }),
    createToolLog: mock.fn(async () => undefined),
  } as any;
  return { repo, persisted, statusUpdates };
}

const resolver = {
  resolveAccess: async () => ({ membershipId: 'm', companyId: 'co-1', roles: ['SALES'], permissions: ['ai.suggestion.request', 'crm.customer.read'], scopes: {} }),
} as any;

function makeGenerator() {
  const getCash = { execute: async () => [] } as any;
  const getCustomer = { execute: async () => ({ projection: 'OPERATIONAL', customer: { id: 'cust1', displayName: 'ACME Co', status: 'ACTIVE', nextFollowUpAt: undefined } }) } as any;
  return new SuggestionGeneratorService(getCash, getCustomer);
}

// A provider that authors distinctive content, to prove the suggestion text comes from the model.
const authoringProvider = {
  mode: 'bedrock', available: true,
  generate: async (input: any) => ({
    ok: true, provider: 'bedrock', model: 'anthropic.claude',
    title: 'AI: call ACME now', summary: 'AI summary', recommendation: 'AI-authored recommendation grounded on evidence',
    riskLevel: 'HIGH', confidence: 0.9, actionTitle: 'Call ACME re: renewal',
    _facts: input.facts,
  }),
} as any;

describe('GenerateSuggestionUseCase (AI-authored)', () => {
  it('persists the model-authored content, not deterministic text', async () => {
    const { repo, persisted } = makeRepo(makeRequest());
    const uc = new GenerateSuggestionUseCase(repo, resolver, makeGenerator(), noopAudit, authoringProvider);
    const out = await uc.execute('co-1', 'req1');
    assert.equal(out.status, 'READY');
    const input = persisted[0].input;
    assert.equal(input.title, 'AI: call ACME now');
    assert.equal(input.recommendation, 'AI-authored recommendation grounded on evidence');
    assert.equal(input.riskLevel, 'HIGH');
    assert.equal(input.confidence, 90);
    assert.equal(input.artifact.modelProvider, 'bedrock');
    assert.equal(input.citations.length, 1); // grounded citation preserved
    assert.equal(input.candidateActions[0].actionType, 'CREATE_CRM_FOLLOW_UP_DRAFT');
    assert.equal(input.candidateActions[0].draftPayloadJson.title, 'Call ACME re: renewal'); // model actionTitle
    assert.equal(input.candidateActions[0].draftPayloadJson.customerId, 'cust1'); // grounded id kept
  });

  it('works with the deterministic fake provider for CI', async () => {
    const { repo, persisted } = makeRepo(makeRequest());
    const uc = new GenerateSuggestionUseCase(repo, resolver, makeGenerator(), noopAudit, new FakeLlmDraftProvider());
    const out = await uc.execute('co-1', 'req1');
    assert.equal(out.status, 'READY');
    assert.equal(persisted[0].input.artifact.modelProvider, 'fake');
    assert.ok(persisted[0].input.recommendation.length > 0);
  });

  it('downgrades to NEEDS_DATA when the CRM customer reference is missing (no model call)', async () => {
    const { repo, persisted } = makeRepo(makeRequest({ sourceRecordType: undefined, sourceRecordId: undefined }));
    const generateSpy = mock.fn(async () => ({ ok: true, provider: 'x', summary: '', recommendation: '' }));
    const uc = new GenerateSuggestionUseCase(repo, resolver, makeGenerator(), noopAudit, { mode: 'bedrock', available: true, generate: generateSpy } as any);
    const out = await uc.execute('co-1', 'req1');
    assert.equal(out.status, 'NEEDS_DATA');
    assert.equal(persisted[0].status, 'NEEDS_DATA');
    assert.equal(persisted[0].input.candidateActions[0].actionType, 'NO_SOURCE_DRAFT_AVAILABLE');
    assert.equal(generateSpy.mock.calls.length, 0); // model is not called without evidence
  });

  it('stays PROVIDER_UNAVAILABLE (no canned suggestion) when no provider is available', async () => {
    const { repo, persisted, statusUpdates } = makeRepo(makeRequest());
    const uc = new GenerateSuggestionUseCase(repo, resolver, makeGenerator(), noopAudit, new DisabledLlmDraftProvider());
    const out = await uc.execute('co-1', 'req1');
    assert.equal(out.status, 'PROVIDER_UNAVAILABLE');
    assert.equal(persisted.length, 0); // no deterministic fallback content
    assert.ok(statusUpdates.some((s) => s.status === 'PROVIDER_UNAVAILABLE'));
  });

  it('marks FAILED when the model returns unparseable/invalid output', async () => {
    const { repo, statusUpdates } = makeRepo(makeRequest());
    const badProvider = { mode: 'bedrock', available: true, generate: async () => ({ ok: false, error: { code: 'MODEL_OUTPUT_INVALID', message: 'bad json', retryable: false } }) } as any;
    const uc = new GenerateSuggestionUseCase(repo, resolver, makeGenerator(), noopAudit, badProvider);
    const out = await uc.execute('co-1', 'req1');
    assert.equal(out.status, 'FAILED');
    assert.ok(statusUpdates.some((s) => s.status === 'FAILED'));
  });

  // ── monthly budget cap (spec §7.5; the draft lane's only spend gate) ──────────────

  const budgetConfig = { aiThbPerUsd: 33, aiMonthlyBudgetSatang: 200_000 } as any;

  const budgetPrisma = (spend: { costSatang: number } | null | 'throws') => ({
    client: {
      companyAiConfiguration: { findUnique: async () => null },
      companyAiMonthlyUsage: {
        findUnique: async () => {
          if (spend === 'throws') throw new Error('DB_DOWN');
          return spend;
        },
      },
    },
  }) as any;

  for (const [label, spend, code] of [
    ['exhausted', { costSatang: 200_000 }, 'AI_MONTHLY_BUDGET_EXCEEDED'],
    ['unreadable', 'throws', 'AI_BUDGET_UNAVAILABLE'],
  ] as const) {
    it(`marks FAILED (not PROVIDER_UNAVAILABLE) and calls no model when the budget is ${label}`, async () => {
      __resetCompanyAiBudgetCache();
      const { repo, persisted, statusUpdates } = makeRepo(makeRequest());
      const generateSpy = mock.fn(async () => ({ ok: true, provider: 'x', summary: '', recommendation: '' }));
      const uc = new GenerateSuggestionUseCase(
        repo, resolver, makeGenerator(), noopAudit,
        { mode: 'bedrock', available: true, generate: generateSpy } as any,
        budgetPrisma(spend), budgetConfig,
      );

      const out = await uc.execute('co-1', 'req1');

      assert.equal(out.status, 'FAILED');
      assert.equal(generateSpy.mock.calls.length, 0, 'a refused action must not spend');
      assert.equal(persisted.length, 0);
      // An exhausted budget is a spend decision, not a retryable outage: PROVIDER_UNAVAILABLE
      // would put the request back in the retry lane and burn the cap again.
      assert.equal(statusUpdates.some((s) => s.status === 'PROVIDER_UNAVAILABLE'), false);
      assert.equal(statusUpdates.find((s) => s.status === 'FAILED')?.options?.errorCode, code);
    });
  }

  it('still calls the model while the company is under budget', async () => {
    __resetCompanyAiBudgetCache();
    const { repo, persisted } = makeRepo(makeRequest());
    const uc = new GenerateSuggestionUseCase(
      repo, resolver, makeGenerator(), noopAudit, authoringProvider,
      budgetPrisma({ costSatang: 199_999 }), budgetConfig,
    );

    const out = await uc.execute('co-1', 'req1');

    assert.equal(out.status, 'READY');
    assert.equal(persisted.length, 1);
  });

  it('is idempotent: does not regenerate when a suggestion already exists', async () => {
    const { repo, persisted } = makeRepo(makeRequest());
    repo.findSuggestionByRequestId = mock.fn(async () => ({ id: 'existing' }));
    const uc = new GenerateSuggestionUseCase(repo, resolver, makeGenerator(), noopAudit, authoringProvider);
    const out = await uc.execute('co-1', 'req1');
    assert.equal(out.suggestionId, 'existing');
    assert.equal(persisted.length, 0);
  });
});


it('does not read evidence or call the provider after source access is revoked', async () => {
  const { repo, persisted, statusUpdates } = makeRepo(makeRequest());
  const read = mock.fn(async () => { throw new Error('must not read'); });
  const generate = mock.fn(async () => { throw new Error('must not generate'); });
  const revoked = { resolveAccess: async () => ({ membershipId: 'm', roles: [], permissions: ['ai.suggestion.request'], scopes: {} }) } as any;
  const uc = new GenerateSuggestionUseCase(repo, revoked, { collectEvidence: read } as any, noopAudit, { available: true, mode: 'fake', generate } as any);
  assert.equal((await uc.execute('co-1', 'req1')).status, 'FAILED');
  assert.equal(read.mock.calls.length, 0);
  assert.equal(generate.mock.calls.length, 0);
  assert.equal(persisted.length, 0);
  assert.match(statusUpdates.at(-1)!.options.errorMessage, /permission/);
});
