import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AI_BUDGET_STEP_BOUNDS } from '@watchdog-bms/contracts';
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
      companyAiMonthlyBucketUsage: { findUnique: async () => ({ costSatang: 0 }) },
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

  // ── E1c: the SPLIT envelope. This seam reserved money before E1c but ran the gateway
  // unenforced, which is the one gap ADR 0013 §13b called out.

  const HAIKU = 'apac.anthropic.claude-3-haiku-20240307-v1:0';
  const splitConfig = { aiThbPerUsd: 33, aiMonthlyBudgetSatang: 200_000, approvedAiModelIds: [HAIKU] } as any;

  /** Reservation-capable ledger fake: one SPLIT config row, the aggregates, and a hold table. */
  function splitPrisma() {
    const reservations = new Map<string, any>();
    const events = new Map<string, any>();
    const configRow = {
      modelId: HAIKU, monthlyBudgetSatang: 200_000, budgetMode: 'SPLIT',
      chatMonthlyBudgetSatang: 100_000, ocrMonthlyBudgetSatang: 100_000,
      budgetConfigVersion: 1, pendingBudgetPolicy: null,
    };
    const tx: any = {
      $executeRaw: async () => 0,
      companyAiConfiguration: { findUnique: async () => configRow },
      platformAiBudgetConfig: { findUnique: async () => null },
      aiBudgetReservation: {
        findUnique: async (args: any) => (args.where.invocationKey !== undefined
          ? [...reservations.values()].find((r) => r.invocationKey === args.where.invocationKey) ?? null
          : reservations.get(args.where.id) ?? null),
        findFirst: async () => null,
        groupBy: async () => [],
        count: async () => 0,
        create: async (args: any) => {
          const row = { id: `res-${reservations.size + 1}`, ...args.data };
          reservations.set(row.id, row);
          return { id: row.id };
        },
        update: async (args: any) => Object.assign(reservations.get(args.where.id), args.data),
        updateMany: async (args: any) => {
          const matched = [...reservations.values()].filter((r) =>
            (args.where.id === undefined || r.id === args.where.id)
            && (args.where.ownerToken === undefined || r.ownerToken === args.where.ownerToken)
            && (args.where.status === undefined
              || (typeof args.where.status === 'string' ? r.status === args.where.status : args.where.status.in.includes(r.status)))
            && args.where.createdAt === undefined && args.where.dispatchedAt === undefined);
          for (const row of matched) Object.assign(row, args.data);
          return { count: matched.length };
        },
      },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }), upsert: async () => ({ costSatang: 0 }) },
      companyAiMonthlyBucketUsage: { findUnique: async () => ({ costSatang: 0 }), upsert: async () => ({}) },
      aiUsageEvent: {
        findUnique: async (args: any) => events.get(args.where.invocationKey) ?? null,
        create: async (args: any) => { events.set(args.data.invocationKey, args.data); return args.data; },
        createMany: async (args: any) => ({ count: args.data.length }),
      },
    };
    const client = { ...tx, $transaction: async (fn: (t: any) => Promise<any>) => fn(tx) };
    return { prisma: { client } as any, reservations, events };
  }

  const draftUsage = { tag: 'ai.draft', modelId: HAIKU, ok: true, inputTokens: 100, outputTokens: 10,
    cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 5, usageBasis: 'PROVIDER_REPORTED' as const };

  it('sends companyId + the envelope under SPLIT, and settles the invocation it names', async () => {
    __resetCompanyAiBudgetCache();
    const { prisma, reservations, events } = splitPrisma();
    const { repo } = makeRepo(makeRequest());
    const bodies: any[] = [];
    const provider = { mode: 'bedrock', available: true, generate: async (input: any) => {
      bodies.push(input);
      return { ok: true, provider: 'bedrock', summary: 's', recommendation: 'r', usage: [draftUsage] };
    } } as any;

    await new GenerateSuggestionUseCase(repo, resolver, makeGenerator(), noopAudit, provider, prisma, splitConfig)
      .execute('co-1', 'req1');

    const hold = [...reservations.values()][0];
    assert.ok(hold, 'the draft lane holds money under SPLIT');
    assert.equal(bodies[0].companyId, 'co-1', 'the gateway needs the tenant to validate the fence');
    assert.equal(bodies[0].budgetEnvelope.invocationKey, hold.invocationKey);
    assert.equal(bodies[0].budgetEnvelope.stepKind, 'draft-generate');
    assert.equal(bodies[0].budgetEnvelope.bucket, 'CHAT');
    assert.equal(bodies[0].budgetEnvelope.modelId, HAIKU);
    assert.deepEqual(bodies[0].budgetEnvelope.bounds, AI_BUDGET_STEP_BOUNDS['draft-generate']);
    // The owner token is API-only and must never ride on the wire.
    assert.equal(JSON.stringify(bodies[0]).includes('ownerToken'), false);
    assert.equal(hold.status, 'SETTLED');
    assert.equal(events.size, 1);
    assert.equal([...events.values()][0].invocationKey, hold.invocationKey);
  });

  it('keeps a SHARED request body byte-identical — no companyId, no envelope', async () => {
    __resetCompanyAiBudgetCache();
    const { repo } = makeRepo(makeRequest());
    const bodies: any[] = [];
    const provider = { mode: 'bedrock', available: true, generate: async (input: any) => {
      bodies.push(input);
      return { ok: true, provider: 'bedrock', summary: 's', recommendation: 'r' };
    } } as any;

    await new GenerateSuggestionUseCase(
      repo, resolver, makeGenerator(), noopAudit, provider,
      budgetPrisma({ costSatang: 0 }), budgetConfig,
    ).execute('co-1', 'req1');

    assert.deepEqual(Object.keys(bodies[0]).sort(), [
      'agent', 'citations', 'defaultTitle', 'domain', 'facts', 'language', 'templateKey', 'wantsChecklist',
    ], 'a company with no hold sends exactly the fields it always sent');
  });

  it('releases the hold when the gateway refused before its provider (E1c)', async () => {
    __resetCompanyAiBudgetCache();
    const { prisma, reservations, events } = splitPrisma();
    const { repo } = makeRepo(makeRequest());
    const provider = { mode: 'bedrock', available: true, generate: async () => ({
      ok: false, error: { code: 'AI_BUDGET_UNAVAILABLE', message: 'envelope_invalid', retryable: false, budgetScope: 'CHAT' },
    }) } as any;

    await new GenerateSuggestionUseCase(repo, resolver, makeGenerator(), noopAudit, provider, prisma, splitConfig)
      .execute('co-1', 'req1');

    const hold = [...reservations.values()][0];
    assert.equal(hold.status, 'CANCELLED');
    assert.equal((hold.evidenceJson as { proof: string }).proof, 'gateway_pre_provider_refusal');
    assert.equal(events.size, 0, 'nothing ran, so nothing is billed');
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
