import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLineIdentityInventory,
  maskLineUserId,
  undispositionedConflicts,
  type LineIdentityRow,
} from './line-identity-inventory.logic';

const CANONICAL = 'msg-ch-1';

const row = (overrides: Partial<LineIdentityRow>): LineIdentityRow => ({
  id: 'ei-1',
  userId: 'user-1',
  providerUserId: 'U0123456789abcdef0123456789abcdef0',
  providerChannelId: CANONICAL,
  status: 'ACTIVE',
  userStatus: 'ACTIVE',
  activeMembershipCompanyIds: ['co-1'],
  ...overrides,
});

const classify = (identities: LineIdentityRow[], contexts: { lineUserId: string; companyId: string }[] = []) =>
  classifyLineIdentityInventory({ canonicalChannelId: CANONICAL, identities, contexts });

describe('maskLineUserId', () => {
  it('masks long ids to head…tail and never returns the middle', () => {
    const masked = maskLineUserId('U0123456789abcdef0123456789abcdef0');
    assert.equal(masked, 'U012…def0');
    assert.ok(!masked.includes('456789abcdef01'));
  });

  it('masks short ids to a two-char prefix', () => {
    assert.equal(maskLineUserId('U1234'), 'U1…');
  });
});

describe('classifyLineIdentityInventory', () => {
  it('classifies a unique canonical ACTIVE row with active user+membership as AUTO_REUSE', () => {
    const report = classify([row({})]);
    assert.equal(report.entries.length, 1);
    assert.equal(report.entries[0]?.classification, 'AUTO_REUSE');
    assert.deepEqual(report.entries[0]?.reasons, []);
    assert.deepEqual(report.summary, { AUTO_REUSE: 1, BACKFILL: 0, CONFLICT: 0, DENY_REVIEW: 0 });
  });

  it('classifies a legacy-channel row as BACKFILL with reason legacy_channel', () => {
    const report = classify([row({ providerChannelId: 'unknown' })]);
    assert.equal(report.entries[0]?.classification, 'BACKFILL');
    assert.deepEqual(report.entries[0]?.reasons, ['legacy_channel']);
  });

  it('classifies every ACTIVE row of a cross-user LINE account as CONFLICT', () => {
    const report = classify([
      row({ id: 'ei-1', userId: 'user-1' }),
      row({ id: 'ei-2', userId: 'user-2', providerChannelId: 'legacy-ch' }),
    ]);
    assert.equal(report.entries.length, 2);
    for (const entry of report.entries) {
      assert.equal(entry.classification, 'CONFLICT');
      assert.deepEqual(entry.reasons, ['line_account_mapped_to_2_users']);
    }
  });

  it('cross-user conflict wins even when one side would otherwise be denied', () => {
    const report = classify([
      row({ id: 'ei-1', userId: 'user-1', userStatus: 'DISABLED' }),
      row({ id: 'ei-2', userId: 'user-2', providerChannelId: 'legacy-ch' }),
    ]);
    assert.equal(report.entries[0]?.classification, 'CONFLICT');
    assert.equal(report.entries[1]?.classification, 'CONFLICT');
  });

  it('classifies duplicate ACTIVE rows of the same user as BACKFILL (dedupe)', () => {
    const report = classify([
      row({ id: 'ei-1' }),
      row({ id: 'ei-2', providerChannelId: 'legacy-ch' }),
    ]);
    const canonical = report.entries.find((e) => e.identityId === 'ei-1');
    const legacy = report.entries.find((e) => e.identityId === 'ei-2');
    assert.equal(canonical?.classification, 'BACKFILL');
    assert.deepEqual(canonical?.reasons, ['duplicate_active_rows_same_user']);
    assert.equal(legacy?.classification, 'BACKFILL');
    assert.deepEqual(legacy?.reasons, ['legacy_duplicate_of_canonical']);
  });

  it('flags a legacy ACTIVE row whose canonical slot is held by an inactive row', () => {
    const report = classify([
      row({ id: 'ei-1', status: 'UNLINKED' }),
      row({ id: 'ei-2', providerChannelId: 'legacy-ch' }),
    ]);
    assert.equal(report.entries.length, 1);
    assert.equal(report.entries[0]?.classification, 'BACKFILL');
    assert.deepEqual(report.entries[0]?.reasons, ['canonical_slot_held_by_inactive_row']);
    assert.equal(report.inactiveRows, 1);
  });

  it('classifies suspended users and membership-less users as DENY_REVIEW', () => {
    const report = classify([
      row({ id: 'ei-1', userStatus: 'SUSPENDED' }),
      row({ id: 'ei-2', providerUserId: 'U9999999999abcdef0123456789abcdef0', activeMembershipCompanyIds: [] }),
    ]);
    assert.deepEqual(report.entries[0]?.reasons, ['user_status_suspended']);
    assert.deepEqual(report.entries[1]?.reasons, ['no_active_membership']);
    assert.equal(report.summary.DENY_REVIEW, 2);
  });

  it('keeps AUTO_REUSE when the only sibling rows are inactive, with an informational reason', () => {
    const report = classify([
      row({ id: 'ei-1' }),
      row({ id: 'ei-2', providerChannelId: 'legacy-ch', status: 'UNLINKED' }),
    ]);
    assert.equal(report.entries.length, 1);
    assert.equal(report.entries[0]?.classification, 'AUTO_REUSE');
    assert.deepEqual(report.entries[0]?.reasons, ['inactive_sibling_rows']);
  });

  it('reports orphan and stale company contexts, masked', () => {
    const identities = [row({ activeMembershipCompanyIds: ['co-1'] })];
    const report = classify(identities, [
      { lineUserId: identities[0]!.providerUserId, companyId: 'co-1' },
      { lineUserId: identities[0]!.providerUserId, companyId: 'co-2' },
      { lineUserId: 'U9999999999abcdef0123456789abcdef0', companyId: 'co-1' },
    ]);
    assert.equal(report.contextFindings.length, 2);
    const stale = report.contextFindings.find((f) => f.reason === 'stale_company_context');
    const orphan = report.contextFindings.find((f) => f.reason === 'orphan_context');
    assert.equal(stale?.companyId, 'co-2');
    assert.equal(orphan?.maskedLineUserId, 'U999…def0');
    assert.ok(report.contextFindings.every((f) => f.maskedLineUserId.includes('…')));
  });

  it('reports never contain a full provider user id', () => {
    const report = classify(
      [row({})],
      [{ lineUserId: 'U9999999999abcdef0123456789abcdef0', companyId: 'co-1' }],
    );
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('U0123456789abcdef0123456789abcdef0'));
    assert.ok(!serialized.includes('U9999999999abcdef0123456789abcdef0'));
  });
});

describe('undispositionedConflicts', () => {
  it('returns only CONFLICT entries whose identity id is not acknowledged', () => {
    const report = classify([
      row({ id: 'ei-1', userId: 'user-1' }),
      row({ id: 'ei-2', userId: 'user-2', providerChannelId: 'legacy-ch' }),
    ]);
    assert.equal(undispositionedConflicts(report, []).length, 2);
    assert.equal(undispositionedConflicts(report, ['ei-1']).length, 1);
    assert.equal(undispositionedConflicts(report, ['ei-1', 'ei-2']).length, 0);
  });
});
