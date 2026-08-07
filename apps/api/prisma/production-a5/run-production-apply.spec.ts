import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseProductionApplyAuthority, strictProductionDatabaseUrl } from './run-production-apply';

const now = 1_800_000_000_000;
const authority = {
  ownerApprovalRef: {
    artifactKind: 'OWNER_U5E_APPROVAL_V1', producerRunId: '101', producerRunAttempt: 2,
    artifactName: 'owner', contentSha256: 'a'.repeat(64), artifactDigest: `sha256:${'b'.repeat(64)}`,
  },
  maintenanceWindow: {
    windowId: 'u5e-10-a2-20-a3', startsAtEpochMs: now - 1_000, endsAtEpochMs: now + 60_000,
    failurePolicy: 'LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL',
  },
};

describe('production A5 apply boundaries', () => {
  it('normalizes only the exact production host to strict TLS and budgets', () => {
    const host = 'watchdog-bms-prod-db.abc.ap-southeast-1.rds.amazonaws.com';
    const parsed = new URL(strictProductionDatabaseUrl(`postgresql://user:pass@${host}:5432/app`, host));
    assert.equal(parsed.searchParams.get('sslmode'), 'verify-full');
    assert.match(parsed.searchParams.get('options') ?? '', /lock_timeout=2000ms/);
    assert.equal(new URL(strictProductionDatabaseUrl(`postgresql://user:pass@${host}/app`, host)).port, '5432');
    assert.throws(() => strictProductionDatabaseUrl('postgresql://user:pass@evil.example:5432/app', host));
  });

  it('accepts only a fresh exact owner-bound maintenance window', () => {
    assert.deepEqual(parseProductionApplyAuthority(JSON.stringify(authority), now), authority);
    assert.throws(() => parseProductionApplyAuthority(JSON.stringify(authority), now + 61_000));
    assert.throws(() => parseProductionApplyAuthority(JSON.stringify({
      ...authority, extra: true,
    }), now));
  });
});
