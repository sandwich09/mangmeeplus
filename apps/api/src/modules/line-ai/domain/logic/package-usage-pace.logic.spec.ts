import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { packagePace, singlePaidCycle } from './package-usage-pace.logic';

const september = { startOn: '2026-09-01', endOn: '2026-10-01' };

describe('package-pace-v1 (advisor spec §5.1)', () => {
  it('reproduces the spec §6.3 examples: likely enough, and short by about 12', () => {
    assert.deepEqual(packagePace({ used: 41, limit: 50, ...september, today: '2026-09-29' }),
      { projectedUsed: 43, projectedShortfall: 0, daysElapsed: 29, daysLeft: 1, daysInPeriod: 30 });
    const short = packagePace({ used: 45, limit: 50, ...september, today: '2026-09-22' });
    assert.ok(typeof short === 'object');
    assert.equal(short.projectedUsed, 62);
    assert.equal(short.projectedShortfall, 12);
    assert.equal(short.daysElapsed, 22);
  });

  it('needs seven days of use before it projects anything', () => {
    assert.equal(packagePace({ used: 5, limit: 30, ...september, today: '2026-09-06' }), 'too_early');
    const seventh = packagePace({ used: 7, limit: 30, ...september, today: '2026-09-07' });
    assert.ok(typeof seventh === 'object');
    assert.equal(seventh.projectedUsed, 30);
    // A cycle that has not started yet is too early too, never a negative day count.
    assert.equal(packagePace({ used: 0, limit: 30, ...september, today: '2026-08-31' }), 'too_early');
  });

  it('never projects an unlimited allowance', () => {
    assert.equal(packagePace({ used: 999, limit: null, ...september, today: '2026-09-20' }), 'unlimited');
  });

  it('rounds up and follows the real month length', () => {
    const february = packagePace({ used: 10, limit: 30, startOn: '2027-02-01', endOn: '2027-03-01', today: '2027-02-09' });
    assert.ok(typeof february === 'object');
    assert.equal(february.daysInPeriod, 28);
    assert.equal(february.projectedUsed, 32); // 10 × 28 / 9 = 31.1 → 32
    assert.equal(february.projectedShortfall, 2);
    const unused = packagePace({ used: 0, limit: 30, ...september, today: '2026-09-15' });
    assert.ok(typeof unused === 'object');
    assert.equal(unused.projectedUsed, 0);
    assert.equal(unused.projectedShortfall, 0);
  });

  it('projects a paid period that starts mid-month, and clamps on its last day', () => {
    const paid = { startOn: '2026-09-15', endOn: '2026-10-15' };
    const midway = packagePace({ used: 70, limit: 100, ...paid, today: '2026-09-28' });
    assert.ok(typeof midway === 'object');
    assert.equal(midway.daysElapsed, 14);
    assert.equal(midway.projectedUsed, 150);
    assert.equal(midway.projectedShortfall, 50);
    assert.equal(midway.daysLeft, 16);
    const lastDay = packagePace({ used: 90, limit: 100, ...paid, today: '2026-10-15' });
    assert.ok(typeof lastDay === 'object');
    assert.equal(lastDay.daysElapsed, 30);
    assert.equal(lastDay.projectedUsed, 90);
    assert.equal(lastDay.daysLeft, 0);
  });
});

describe('singlePaidCycle', () => {
  const lot = (start: string, end: string) => ({ serviceStart: new Date(start), serviceEnd: new Date(end) });

  it('reads the one period every lot shares, in Bangkok civil days', () => {
    // 20:00 UTC is already the next morning in Bangkok.
    assert.deepEqual(singlePaidCycle([lot('2026-09-14T20:00:00.000Z', '2026-10-14T20:00:00.000Z')]),
      { startOn: '2026-09-15', endOn: '2026-10-15' });
    assert.deepEqual(singlePaidCycle([lot('2026-09-15T03:00:00.000Z', '2026-10-15T03:00:00.000Z'),
      lot('2026-09-15T03:00:00.000Z', '2026-10-15T03:00:00.000Z')]), { startOn: '2026-09-15', endOn: '2026-10-15' });
  });

  it('returns null when lots from different periods overlap, or when there is no lot', () => {
    assert.equal(singlePaidCycle([lot('2026-08-15T03:00:00.000Z', '2026-09-15T03:00:00.000Z'),
      lot('2026-09-15T03:00:00.000Z', '2026-10-15T03:00:00.000Z')]), null);
    assert.equal(singlePaidCycle([]), null);
  });
});
