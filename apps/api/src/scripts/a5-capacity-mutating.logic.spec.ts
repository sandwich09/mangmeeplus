import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  U5_CAPACITY_LIMITS,
  U5_CAPACITY_APPROVAL_REF,
  advisoryLockKeys,
  assertClaimRowsScoped,
  canonicalCapacityJson,
  capacityEvidenceHash,
  capacityThresholdsPass,
  latencySummary,
  markerCompanyId,
  parseCapacityBaselineHash,
  parseCapacityConfig,
} from './a5-capacity-mutating.logic';

const sha = 'a'.repeat(40);

describe('A5-CAPACITY-MUTATING v2 safety contract', () => {
  it('accepts only the exact UAT, full-SHA, bounded-marker and owner-approval shape', () => {
    assert.deepEqual(parseCapacityConfig({
      DEPLOY_ENV: 'uat',
      GIT_SHA: sha,
      U5_CAPACITY_MARKER: 'U5C-0123456789AB',
      U5_CAPACITY_APPROVAL_REF: 'owner-approved:2026-08-03:u5-c-v2',
    }), {
      environment: 'uat',
      sourceCommit: sha,
      marker: 'U5C-0123456789AB',
      approvalRef: 'owner-approved:2026-08-03:u5-c-v2',
    });
    assert.throws(() => parseCapacityConfig({
      DEPLOY_ENV: 'production', GIT_SHA: sha, U5_CAPACITY_MARKER: 'U5C-0123456789AB',
      U5_CAPACITY_APPROVAL_REF: 'owner-approved:2026-08-03:u5-c-v2',
    }), /capacity_environment_refused/);
    assert.throws(() => parseCapacityConfig({
      DEPLOY_ENV: 'uat', GIT_SHA: sha, U5_CAPACITY_MARKER: 'customer-1',
      U5_CAPACITY_APPROVAL_REF: 'owner-approved:2026-08-03:u5-c-v2',
    }), /capacity_marker_invalid/);
    assert.throws(() => parseCapacityConfig({
      DEPLOY_ENV: 'uat', GIT_SHA: sha, U5_CAPACITY_MARKER: 'U5C-0123456789AB',
    }), /capacity_exact_approval_missing/);
    assert.throws(() => parseCapacityConfig({
      DEPLOY_ENV: 'uat', GIT_SHA: sha, U5_CAPACITY_MARKER: 'U5C-0123456789AB',
      U5_CAPACITY_APPROVAL_REF: 'owner-approved:2026-08-03:not-u5-c-v2',
    }), /capacity_exact_approval_missing/);
    assert.equal(U5_CAPACITY_APPROVAL_REF, 'owner-approved:2026-08-03:u5-c-v2');
    assert.equal(parseCapacityBaselineHash({ U5_CAPACITY_BASELINE_HASH: 'b'.repeat(64) }), 'b'.repeat(64));
    assert.throws(() => parseCapacityBaselineHash({}), /capacity_baseline_hash_missing/);
  });

  it('locks the reviewed workload bounds in code', () => {
    assert.deepEqual(U5_CAPACITY_LIMITS, {
      smokeRows: 100,
      fullRows: 5_000,
      seedChunkRows: 250,
      maxSeedRowsPerSecond: 500,
      claimBatchSizes: [1, 25],
      claimConcurrencies: [1, 2, 5],
      processingConcurrency: 2,
      backlogDepths: [100, 500, 1_000, 2_500, 5_000],
      samplesPerDepthAndShape: 20,
      lockConcurrencies: [2, 5, 10],
      lockIterations: 20,
      lockHoldMs: 10,
      maxWallMs: 600_000,
      claimP95AbortMs: 250,
      lockP95AbortMs: 500,
      connectionRatioAbort: 0.70,
      statementTimeoutMs: 2_000,
      lockTimeoutMs: 500,
      idleInTransactionTimeoutMs: 5_000,
    });
  });

  it('rejects a claim result outside the exact synthetic marker', () => {
    const marker = 'U5C-0123456789AB';
    const companyId = markerCompanyId(marker);
    assert.doesNotThrow(() => assertClaimRowsScoped([
      { companyId, aggregateType: 'U5CapacityProbe', eventKey: `${marker}:full:1` },
    ], companyId, marker));
    assert.throws(() => assertClaimRowsScoped([
      { companyId: 'real-company', aggregateType: 'U5CapacityProbe', eventKey: `${marker}:full:1` },
    ], companyId, marker), /capacity_non_fixture_row_touched/);
  });

  it('derives stable marker-specific lock keys and exact percentile thresholds', () => {
    assert.deepEqual(advisoryLockKeys('U5C-0123456789AB'), advisoryLockKeys('U5C-0123456789AB'));
    assert.notDeepEqual(advisoryLockKeys('U5C-0123456789AB'), advisoryLockKeys('U5C-FFFFFFFFFFFF'));
    assert.deepEqual(latencySummary([1, 2, 3, 4, 100]), {
      count: 5, p50Ms: 3, p95Ms: 100, p99Ms: 100, maxMs: 100,
    });
    assert.equal(capacityThresholdsPass({ claimP95Ms: 250, lockP95Ms: 500, connectionRatio: 0.69, elapsedMs: 600_000 }), true);
    assert.equal(capacityThresholdsPass({ claimP95Ms: 251, lockP95Ms: 1, connectionRatio: 0.1, elapsedMs: 1 }), false);
    assert.equal(capacityThresholdsPass({ claimP95Ms: 1, lockP95Ms: 1, connectionRatio: 0.70, elapsedMs: 1 }), false);
  });

  it('hashes evidence with recursively canonical object keys while preserving array order', () => {
    const left = { z: [{ b: 2, a: 1 }, 3], a: true };
    const same = { a: true, z: [{ a: 1, b: 2 }, 3] };
    const reordered = { a: true, z: [3, { a: 1, b: 2 }] };
    assert.equal(canonicalCapacityJson(left), '{"a":true,"z":[{"a":1,"b":2},3]}');
    assert.equal(capacityEvidenceHash(left), capacityEvidenceHash(same));
    assert.notEqual(capacityEvidenceHash(left), capacityEvidenceHash(reordered));
    assert.throws(() => canonicalCapacityJson({ invalid: Number.NaN }), /capacity_non_json_number/);
  });
});
