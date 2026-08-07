import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalFingerprint, canonicalize } from './canonical-fingerprint';

describe('canonicalFingerprint', () => {
  it('ignores key order at every depth', () => {
    const a = { companyId: 'co-1', command: { kind: 'UPSERT_FACT', status: 'REGISTERED' } };
    const b = { command: { status: 'REGISTERED', kind: 'UPSERT_FACT' }, companyId: 'co-1' };
    assert.equal(canonicalFingerprint(a), canonicalFingerprint(b));
  });

  // AC32: an absent optional field and an explicit null are the same intent. If they hashed
  // differently, a retry from a client that omits the key would look like a different command
  // and be refused with a conflict it never caused.
  it('treats an absent key and an explicit null as the same value', () => {
    assert.equal(
      canonicalFingerprint({ companyId: 'co-1', replaceFactId: null }),
      canonicalFingerprint({ companyId: 'co-1', replaceFactId: undefined }),
    );
  });

  it('distinguishes null from a missing key when the key set differs in meaning', () => {
    assert.notEqual(
      canonicalFingerprint({ companyId: 'co-1', replaceFactId: null }),
      canonicalFingerprint({ companyId: 'co-1' }),
    );
  });

  // Golden vectors. They pin the algorithm itself: a change to sorting, null handling or the
  // hash function shows up here rather than as a silent replay failure in production.
  it('matches the pinned vectors for each command type', () => {
    assert.equal(
      canonicalFingerprint({
        companyId: 'co-1',
        kind: 'UPSERT_FACT',
        status: 'REGISTERED',
        effectiveFrom: '2026-08-04',
        replaceFactId: null,
      }),
      '93fb24a2f3d749a23be89669721d234d07efe20084acad7fc528cbdb2c033d58',
    );
    assert.equal(
      canonicalFingerprint({ companyId: 'co-1', kind: 'CANCEL_FUTURE', replaceFactId: 'fact-9' }),
      'bd3bd32969c1f5571fb2d7e0e28de70152d70c0b1bd4743a638932096b52a095',
    );
  });

  it('refuses values that would hash ambiguously', () => {
    assert.throws(() => canonicalFingerprint({ at: new Date('2026-08-04') }), TypeError);
    assert.throws(() => canonicalFingerprint({ amount: Number.NaN }), TypeError);
    assert.throws(() => canonicalFingerprint({ id: 1n as unknown as number }), TypeError);
  });

  it('canonicalizes nested arrays and objects', () => {
    assert.deepEqual(
      canonicalize({ b: [{ z: 1, a: null }], a: 'x' }),
      { a: 'x', b: [{ a: null, z: 1 }] },
    );
  });
});
