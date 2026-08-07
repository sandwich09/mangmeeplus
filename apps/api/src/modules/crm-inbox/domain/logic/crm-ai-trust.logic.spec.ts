import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeTrustScore, type CrmTrustSignals } from './crm-ai-trust.logic';

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

const chatOnlyMax = signals({
  tenureDays: 9999,
  consentGranted: true,
  inboundMessages30d: 9999,
});

describe('computeTrustScore chat-only ceiling', () => {
  it('keeps maximal chat-only signals at exactly 80', () => {
    assert.equal(computeTrustScore(chatOnlyMax).score, 80);
  });
});

describe('computeTrustScore exhaustive chat-only sweep', () => {
  it('never crosses the strict >80 gate with chat-only inputs', () => {
    for (const tenureDays of [0, 29, 30, 89, 90, 9999]) {
      for (const consentGranted of [true, false]) {
        for (let inboundMessages30d = 0; inboundMessages30d <= 12; inboundMessages30d += 1) {
          const result = computeTrustScore(signals({ tenureDays, consentGranted, inboundMessages30d }));
          assert.ok(result.score <= 80, JSON.stringify({ tenureDays, consentGranted, inboundMessages30d, result }));
        }
      }
    }
  });
});

describe('computeTrustScore real-world unlocks', () => {
  it('requires verified identity plus a real-world event to lift chat max above the ceiling', () => {
    const identityOnly = computeTrustScore({ ...chatOnlyMax, lineLinked: true });
    assert.equal(identityOnly.score, 80);
    assert.ok(identityOnly.factors.some((factor) => factor.key === 'level2_requires_verified_identity_and_event'));
    assert.equal(computeTrustScore({ ...chatOnlyMax, lineLinked: true, financialIdentity: true }).score, 100);
    assert.equal(computeTrustScore({ ...chatOnlyMax, lineLinked: true, keptAppointments: 1 }).score, 100);
    assert.ok(computeTrustScore({ ...chatOnlyMax, financialIdentity: true, keptAppointments: 2 }).score <= 80);
  });
});

describe('computeTrustScore caps and tiers', () => {
  it('does not add tenure tiers and caps engagement plus kept appointments', () => {
    assert.equal(computeTrustScore(signals({ tenureDays: 90 })).score, 60);
    assert.equal(computeTrustScore(signals({ tenureDays: 30 })).score, 55);
    assert.equal(computeTrustScore(signals({ inboundMessages30d: 9999 })).score, 60);
    assert.equal(computeTrustScore(signals({ keptAppointments: 9999 })).score, 80);
  });
});

describe('computeTrustScore no-shows', () => {
  it('subtracts uncapped no-shows and clamps at the floor', () => {
    assert.equal(computeTrustScore({ ...chatOnlyMax, noShows90d: 4 }).score, 0);
  });
});

describe('computeTrustScore factors', () => {
  it('returns unique factors whose points sum to the pre-clamp score', () => {
    const result = computeTrustScore({
      ...chatOnlyMax,
      lineLinked: true,
      financialIdentity: true,
      keptAppointments: 2,
    });
    const keys = result.factors.map((factor) => factor.key);
    const preClamp = result.factors.reduce((sum, factor) => sum + factor.points, 0);

    assert.equal(preClamp, 130);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(Number.isInteger(result.score), true);
  });

  it('treats negative numeric inputs as zero', () => {
    const result = computeTrustScore(signals({
      tenureDays: -90,
      inboundMessages30d: -5,
      keptAppointments: -2,
      noShows90d: -3,
    }));

    assert.equal(result.score, 50);
    assert.deepEqual(result.factors, [{ key: 'base', points: 50 }]);
  });
});
