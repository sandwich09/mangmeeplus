import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SweepCrmBookingProposalsUseCase } from './sweep-crm-booking-proposals.use-case';

const within = (ms: number, target: number, tolerance = 2000) => ms >= target - tolerance && ms <= target + tolerance;

describe('SweepCrmBookingProposalsUseCase', () => {
  it('sweeps each affected company: expires past-due proposals and recovers stuck COMMITTING with a 10-minute cutoff', async () => {
    const expireCalls: string[] = [];
    const sweepCalls: { companyId: string; olderThan: Date }[] = [];
    const proposals = {
      findCompanyIdsWithSweepableProposals: async (_now: Date, committingBefore: Date) => {
        assert.ok(within(Date.now() - committingBefore.getTime(), 10 * 60_000));
        return ['co-1', 'co-2'];
      },
      expireStale: async (companyId: string) => { expireCalls.push(companyId); return 2; },
      sweepStuckCommitting: async (companyId: string, olderThan: Date) => { sweepCalls.push({ companyId, olderThan }); return 1; },
    } as any;
    const uc = new SweepCrmBookingProposalsUseCase(proposals);

    const result = await uc.execute();

    assert.deepEqual(result, { companiesScanned: 2, expired: 4, recovered: 2 });
    assert.deepEqual(expireCalls, ['co-1', 'co-2']);
    assert.deepEqual(sweepCalls.map((c) => c.companyId), ['co-1', 'co-2']);
    // sweepStuckCommitting reuses the same ~10-minute cutoff.
    assert.ok(within(Date.now() - sweepCalls[0].olderThan.getTime(), 10 * 60_000));
  });

  it('logs and continues when one company sweep throws, still reporting the others', async () => {
    const proposals = {
      findCompanyIdsWithSweepableProposals: async () => ['co-bad', 'co-good'],
      expireStale: async (companyId: string) => {
        if (companyId === 'co-bad') throw new Error('db hiccup');
        return 3;
      },
      sweepStuckCommitting: async () => 1,
    } as any;
    const uc = new SweepCrmBookingProposalsUseCase(proposals);

    const result = await uc.execute();

    // co-bad's expire threw before its counts landed; co-good still swept fully.
    assert.equal(result.companiesScanned, 2);
    assert.equal(result.expired, 3);
    assert.equal(result.recovered, 1);
  });
});
