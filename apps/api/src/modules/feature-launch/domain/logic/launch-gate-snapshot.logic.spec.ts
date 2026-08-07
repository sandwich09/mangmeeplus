import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchGatePayloadFingerprint, launchGateSnapshotViolations } from './launch-gate-snapshot.logic';

const NORMAL = {
  targetEnvironment: 'production',
  buildReleaseId: 'sha-abc123',
  expectedGeneration: 0,
  releaseApprovedByUserId: 'release-owner-1',
  emergencyClose: false,
};

const SPECIALIST = {
  ...NORMAL,
  validationEvidenceRef: 'matrix://cap.wht50bis/SYSTEM_INITIAL_ISSUE',
  validationEvidenceHash: 'sha256:deadbeef',
  specialistApprovedByUserId: 'tax-specialist-1',
};

const EMERGENCY = {
  targetEnvironment: 'production',
  buildReleaseId: 'sha-abc123',
  expectedGeneration: 3,
  emergencyClose: true,
  emergencyAuthorityUserId: 'oncall-1',
  incidentRef: 'INC-2026-07-31-01',
};

describe('launchGateSnapshotViolations — normal OPEN (spec:54)', () => {
  it('accepts environment + build + expected generation + non-emergency + release approval', () => {
    assert.deepEqual(launchGateSnapshotViolations('OPEN', 'ORDINARY', NORMAL), []);
  });

  for (const field of ['targetEnvironment', 'buildReleaseId', 'releaseApprovedByUserId'] as const) {
    it(`rejects a normal OPEN missing ${field}`, () => {
      const violations = launchGateSnapshotViolations('OPEN', 'ORDINARY', { ...NORMAL, [field]: '' });
      assert.ok(violations.some((v) => v.includes(field)), violations.join(' '));
    });
  }

  it('rejects a non-integer expected generation', () => {
    const violations = launchGateSnapshotViolations('OPEN', 'ORDINARY', { ...NORMAL, expectedGeneration: 1.5 });
    assert.ok(violations.some((v) => v.includes('expectedGeneration')));
  });

  it('rejects emergency fields on a non-emergency command', () => {
    const violations = launchGateSnapshotViolations('OPEN', 'ORDINARY', { ...NORMAL, incidentRef: 'INC-1' });
    assert.ok(violations.some((v) => v.includes('only valid when emergencyClose=true')));
  });
});

describe('launchGateSnapshotViolations — SPECIALIST_LEGAL OPEN (spec:54)', () => {
  it('accepts evidence ref + hash + specialist approval on top of the normal shape', () => {
    assert.deepEqual(launchGateSnapshotViolations('OPEN', 'SPECIALIST_LEGAL', SPECIALIST), []);
  });

  it('rejects a specialist OPEN carrying only the ordinary shape', () => {
    const violations = launchGateSnapshotViolations('OPEN', 'SPECIALIST_LEGAL', NORMAL);
    assert.equal(violations.length, 3);
    assert.ok(violations.some((v) => v.includes('validationEvidenceRef')));
    assert.ok(violations.some((v) => v.includes('validationEvidenceHash')));
    assert.ok(violations.some((v) => v.includes('specialistApprovedByUserId')));
  });

  it('does not require specialist evidence to CLOSE a specialist route', () => {
    assert.deepEqual(launchGateSnapshotViolations('CLOSE', 'SPECIALIST_LEGAL', NORMAL), []);
  });
});

describe('launchGateSnapshotViolations — CLOSE shapes (spec:54)', () => {
  it('normal CLOSE follows the ordinary policy: environment, build, generation, release authority', () => {
    assert.deepEqual(launchGateSnapshotViolations('CLOSE', 'ORDINARY', NORMAL), []);
    const violations = launchGateSnapshotViolations('CLOSE', 'ORDINARY', { ...NORMAL, releaseApprovedByUserId: undefined });
    assert.ok(violations.some((v) => v.includes('releaseApprovedByUserId')));
  });

  it('emergency CLOSE may omit release and specialist approval so shutdown is not delayed', () => {
    assert.deepEqual(launchGateSnapshotViolations('CLOSE', 'ORDINARY', EMERGENCY), []);
    assert.deepEqual(launchGateSnapshotViolations('CLOSE', 'SPECIALIST_LEGAL', EMERGENCY), []);
  });

  it('emergency CLOSE still requires the authority and the incident reference', () => {
    const noAuthority = launchGateSnapshotViolations('CLOSE', 'ORDINARY', { ...EMERGENCY, emergencyAuthorityUserId: undefined });
    assert.ok(noAuthority.some((v) => v.includes('emergencyAuthorityUserId')));
    const noIncident = launchGateSnapshotViolations('CLOSE', 'ORDINARY', { ...EMERGENCY, incidentRef: '  ' });
    assert.ok(noIncident.some((v) => v.includes('incidentRef')));
  });

  it('an emergency snapshot forbids OPEN', () => {
    const violations = launchGateSnapshotViolations('OPEN', 'ORDINARY', EMERGENCY);
    assert.ok(violations.some((v) => v.includes('forbids an OPEN command')));
  });
});

describe('launchGatePayloadFingerprint', () => {
  it('is stable across equivalent payloads and separates absent from explicit null', () => {
    const a = launchGatePayloadFingerprint('OPEN', NORMAL);
    const b = launchGatePayloadFingerprint('OPEN', { ...NORMAL, validationEvidenceRef: null });
    assert.equal(a, b, 'absent and explicit null must fingerprint the same');
  });

  it('changes when the action changes', () => {
    assert.notEqual(launchGatePayloadFingerprint('OPEN', NORMAL), launchGatePayloadFingerprint('CLOSE', NORMAL));
  });

  it('changes when an approval identity changes', () => {
    const other = { ...NORMAL, releaseApprovedByUserId: 'release-owner-2' };
    assert.notEqual(launchGatePayloadFingerprint('OPEN', NORMAL), launchGatePayloadFingerprint('OPEN', other));
  });
});
