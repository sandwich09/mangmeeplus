/**
 * Drift guard for the RUNOFF_MATRIX coverage catalog.
 *
 * `runoff-matrix.catalog.ts` is a code copy of aggregates over
 * `docs/specs/feature-entitlement-runoff-matrix.json`, because `docs/` is not in the production
 * image. This spec re-derives every number from the doc on every run, so a matrix edit and the code
 * copy can never drift apart.
 *
 * The catalog is DOCUMENTATION, not enforcement, since the owner's freeze-in-place decision
 * (2026-08-04) deleted the disable preflight — the assertions below are therefore about the numbers
 * matching the approved artifact, never about which family may be switched off.
 *
 * Mirrors the FEATURE_LAUNCH_MATRIX drift guard at `seed-launch-gates.spec.ts:126`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  RUNOFF_MATRIX_FEATURES,
  RUNOFF_MATRIX_VERSION,
  isNonFeatureBucket,
} from './runoff-matrix.catalog';

type DocRow = { featureKey: string; runoffPolicy: string };
type Doc = { generated: string; counts: { total: number }; rows: DocRow[] };

const docPath = path.resolve(__dirname, '../../../../../../docs/specs/feature-entitlement-runoff-matrix.json');
const doc = JSON.parse(readFileSync(docPath, 'utf8')) as Doc;

describe('RUNOFF_MATRIX coverage catalog', () => {
  it('matches docs/specs/feature-entitlement-runoff-matrix.json aggregate for aggregate', () => {
    const derived = new Map<string, { featureKey: string; totalRows: number; blockedRows: number; runoffRootRows: number }>();
    for (const row of doc.rows) {
      const entry = derived.get(row.featureKey)
        ?? { featureKey: row.featureKey, totalRows: 0, blockedRows: 0, runoffRootRows: 0 };
      entry.totalRows += 1;
      if (row.runoffPolicy === 'BLOCKED') entry.blockedRows += 1;
      if (row.runoffPolicy === 'PRE_CUTOFF_RUNOFF_ONLY') entry.runoffRootRows += 1;
      derived.set(row.featureKey, entry);
    }

    // Both sides sorted by the SAME comparator: the catalog is a lookup table, so its literal
    // order is not the contract — its contents are. Comparing raw arrays would turn a harmless
    // re-ordering into a red suite and tempt someone to weaken the assertion instead.
    const byKey = (a: { featureKey: string }, b: { featureKey: string }) => a.featureKey.localeCompare(b.featureKey);
    assert.deepEqual([...RUNOFF_MATRIX_FEATURES].sort(byKey), [...derived.values()].sort(byKey));
  });

  it('accounts for every row in the doc', () => {
    assert.equal(doc.rows.length, doc.counts.total);
    assert.equal(
      RUNOFF_MATRIX_FEATURES.reduce((sum, row) => sum + row.totalRows, 0),
      doc.counts.total,
    );
  });

  it('pins the matrix version stamped into every RunoffSnapshot', () => {
    assert.equal(RUNOFF_MATRIX_VERSION, doc.generated);
  });

  it('records the 103-row non-feature erratum the approved doc states as 100', () => {
    // `feature-entitlement-runoff-matrix.md:10` says 100 and names only four buckets. The real
    // count is 103 across seven buckets. Pinned here so the erratum in the spec amendment cannot
    // drift away from the data, and so a future matrix regeneration that fixes the doc fails
    // loudly rather than silently changing what the coordinator ruling was about.
    const nonFeatureBlocked = doc.rows.filter(
      (row) => isNonFeatureBucket(row.featureKey) && row.runoffPolicy === 'BLOCKED',
    );
    assert.equal(nonFeatureBlocked.length, 103);
  });

  it('records which families the matrix left fully decided', () => {
    // A drift assertion over the approved artifact, not an admission rule: since freeze-in-place a
    // BLOCKED row no longer refuses anything. If a matrix regeneration changes this set, the change
    // is visible in review instead of passing silently.
    const covered = RUNOFF_MATRIX_FEATURES
      .filter((row) => !isNonFeatureBucket(row.featureKey) && row.blockedRows === 0)
      .map((row) => row.featureKey)
      .sort();
    assert.deepEqual(covered, ['ai_line_assistant', 'reports', 'workflow_automation']);
  });

  it('records which families the matrix proposed ordinary-runoff roots for', () => {
    // Also documentation only: freeze-in-place grants no continuation, so `buildRunoffRoots` returns
    // an empty membership for every family and none of these needs a snapshot builder.
    const proposedRoots = RUNOFF_MATRIX_FEATURES
      .filter((row) => row.runoffRootRows > 0)
      .map((row) => row.featureKey)
      .sort();
    assert.deepEqual(proposedRoots, [
      'bank_reconciliation',
      'double_entry_ledger',
      'expenses',
      'procurement',
      'reimbursement',
      'sales_documents',
    ]);
  });
});
