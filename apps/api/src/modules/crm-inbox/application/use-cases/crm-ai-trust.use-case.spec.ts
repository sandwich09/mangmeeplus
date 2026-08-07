import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeTrustScore, type CrmTrustSignals } from '../../domain/logic/crm-ai-trust.logic';
import { CrmAiContextRepository } from '../../infrastructure/crm-ai-context.repository';
import { ScanCrmTrustScoresUseCase } from './crm-ai-trust.use-case';

function signals(overrides: Partial<CrmTrustSignals> = {}): CrmTrustSignals {
  return {
    tenureDays: 0,
    lineLinked: false,
    consentGranted: false,
    financialIdentity: false,
    inboundMessages30d: 0,
    keptAppointments: 0,
    noShows90d: 0,
    ...overrides,
  };
}

function makeRepo(candidates: Array<{ id: string; companyId: string }>, options: Partial<any> = {}) {
  const calls: Record<string, any[]> = { findTrustScanCandidates: [], findTrustSignalCustomers: [], getTrustSignals: [], saveTrustScore: [] };
  const signalsById = options.signalsById ?? {};
  const customersById = options.customersById ?? {};
  const throwIds = new Set(options.throwIds ?? []);
  return {
    calls,
    findTrustScanCandidates: async (now: Date) => {
      calls.findTrustScanCandidates.push([now]);
      return candidates.map((candidate) => ({ ...candidate, inbound30d: signalsById[candidate.id]?.inboundMessages30d ?? 0 }));
    },
    findTrustSignalCustomers: async (ids: string[], now: Date) => {
      calls.findTrustSignalCustomers.push([ids, now]);
      return ids
        .filter((id) => !options.missingIds?.includes(id))
        .map((id) => customersById[id] ?? {
          id,
          companyId: candidates.find((candidate) => candidate.id === id)?.companyId ?? 'co-1',
          createdAt: new Date('2026-07-09T12:00:00Z'),
          consentStatus: 'UNKNOWN',
          accountingCounterpartyId: null,
          lineLinked: false,
          keptAppointments: 0,
          noShows90d: 0,
        });
    },
    getTrustSignals: (customer: any, now: Date, inbound30d: number) => {
      calls.getTrustSignals.push([customer, now, inbound30d]);
      if (throwIds.has(customer.id)) throw new Error('bad candidate');
      return signalsById[customer.id] ?? signals({ inboundMessages30d: inbound30d });
    },
    saveTrustScore: async (...args: any[]) => { calls.saveTrustScore.push(args); },
  } as any;
}

describe('ScanCrmTrustScoresUseCase', () => {
  it('maps candidates to signals, formula output, and saves scoped scores', async () => {
    const now = new Date('2026-07-09T12:00:00Z');
    const customerSignals = signals({ tenureDays: 90, consentGranted: true, inboundMessages30d: 4 });
    const expected = computeTrustScore(customerSignals);
    const repo = makeRepo([{ id: 'cust-1', companyId: 'co-1' }], { signalsById: { 'cust-1': customerSignals } });

    const result = await new ScanCrmTrustScoresUseCase(repo).execute(now);

    assert.deepEqual(result, { scanned: 1, updated: 1, failed: 0 });
    assert.deepEqual(repo.calls.findTrustSignalCustomers, [[['cust-1'], now]]);
    assert.equal(repo.calls.getTrustSignals[0][0].id, 'cust-1');
    assert.equal(repo.calls.getTrustSignals[0][1], now);
    assert.equal(repo.calls.getTrustSignals[0][2], 4);
    assert.deepEqual(repo.calls.saveTrustScore, [['co-1', 'cust-1', expected.score, expected.factors, now]]);
  });

  it('flows kept and no-show counts into the trust score', () => {
    const now = new Date('2026-07-09T12:00:00Z');
    const mapped = new CrmAiContextRepository({} as any).getTrustSignals({
      id: 'cust-1',
      companyId: 'co-1',
      createdAt: now,
      consentStatus: 'UNKNOWN',
      accountingCounterpartyId: null,
      lineLinked: false,
      keptAppointments: 2,
      noShows90d: 1,
    }, now, 0);

    assert.deepEqual(computeTrustScore(mapped), {
      score: 60,
      factors: [
        { key: 'base', points: 50 },
        { key: 'keptAppointment', points: 30 },
        { key: 'noShow', points: -20 },
      ],
    });
  });

  it('uses the repository scan batch and batch-loads customers once', async () => {
    const now = new Date('2026-07-09T12:00:00Z');
    const candidates = Array.from({ length: 50 }, (_, index) => ({ id: `cust-${index}`, companyId: 'co-1' }));
    const repo = makeRepo(candidates);

    const result = await new ScanCrmTrustScoresUseCase(repo).execute(now);

    assert.deepEqual(repo.calls.findTrustScanCandidates, [[now]]);
    assert.deepEqual(repo.calls.findTrustSignalCustomers[0][0], candidates.map((candidate) => candidate.id));
    assert.deepEqual(result, { scanned: 50, updated: 50, failed: 0 });
    assert.equal(repo.calls.saveTrustScore.length, 50);
  });

  it('continues after one candidate throws and counts the failure', async () => {
    const repo = makeRepo(
      [
        { id: 'cust-1', companyId: 'co-1' },
        { id: 'cust-2', companyId: 'co-1' },
        { id: 'cust-3', companyId: 'co-2' },
      ],
      { throwIds: ['cust-2'] },
    );

    const result = await new ScanCrmTrustScoresUseCase(repo).execute(new Date('2026-07-09T12:00:00Z'));

    assert.deepEqual(result, { scanned: 3, updated: 2, failed: 1 });
    assert.deepEqual(repo.calls.saveTrustScore.map((call: any[]) => call[1]), ['cust-1', 'cust-3']);
  });

  it('counts missing batch-loaded customers as failed rows', async () => {
    const repo = makeRepo([{ id: 'cust-1', companyId: 'co-1' }], { missingIds: ['cust-1'] });

    const result = await new ScanCrmTrustScoresUseCase(repo).execute(new Date('2026-07-09T12:00:00Z'));

    assert.deepEqual(result, { scanned: 1, updated: 0, failed: 1 });
    assert.equal(repo.calls.saveTrustScore.length, 0);
  });

  it('returns zero counts for empty candidates', async () => {
    const repo = makeRepo([]);

    const result = await new ScanCrmTrustScoresUseCase(repo).execute(new Date('2026-07-09T12:00:00Z'));

    assert.deepEqual(result, { scanned: 0, updated: 0, failed: 0 });
    assert.equal(repo.calls.getTrustSignals.length, 0);
    assert.equal(repo.calls.saveTrustScore.length, 0);
  });
});
