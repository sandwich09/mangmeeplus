/**
 * Drift guard for the SHADOW SURFACE catalog.
 *
 * `shadow-surface.catalog.ts` is a code copy of the ASYNC plane of
 * `docs/specs/feature-entitlement-runoff-matrix.json`, because `docs/` is not in the production
 * image. This spec re-derives the row set from the doc on every run, so an approved-matrix edit
 * that adds, drops or renames an async surface fails the suite instead of silently shrinking the
 * denominator that "full shadow" is measured against.
 *
 * It also pins the two rules that make the catalog trustworthy rather than merely present:
 *   1. a row the matrix leaves UNRESOLVED may not acquire a gateKey (invariant 7 — unknown
 *      ownership records `null`, never a guess), except for the four attributions piece 3 already
 *      shipped, which must carry an explicit OQ-3 note;
 *   2. a row the matrix DID decide must carry that exact gate, so evidence can never land on a
 *      family that does not own the work.
 *
 * Mirrors `runoff-matrix.catalog.spec.ts` and the FEATURE_LAUNCH_MATRIX guard in
 * `seed-launch-gates.spec.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MATERIALIZABLE_LAUNCH_MATRIX_ROWS } from './launch-matrix.catalog';
import {
  SHADOW_SURFACES,
  SHADOW_SURFACE_CATALOG,
  UNOWNED_SHADOW_SURFACES,
  expectedShadowSurfaces,
  notificationSweepSurface,
  shadowCoverageComplete,
} from './shadow-surface.catalog';

type DocRow = { featureKey: string; surfaceKind: string; surfaceId: string };
type Doc = { rows: DocRow[]; counts: { async: number } };

const docPath = path.resolve(__dirname, '../../../../../../docs/specs/feature-entitlement-runoff-matrix.json');
const doc = JSON.parse(readFileSync(docPath, 'utf8')) as Doc;
const asyncRows = doc.rows.filter((row) => row.surfaceKind === 'ASYNC');
const docBySurfaceId = new Map(asyncRows.map((row) => [row.surfaceId, row]));

/** The survey buckets that are not a sellable feature; the catalog maps these to a null gate. */
const NON_FEATURE = new Set(['PLATFORM', 'UNRESOLVED']);

describe('SHADOW_SURFACE_CATALOG', () => {
  it('covers exactly the ASYNC plane of the approved runoff matrix', () => {
    assert.equal(asyncRows.length, doc.counts.async);
    assert.equal(SHADOW_SURFACE_CATALOG.length, asyncRows.length);
    // Set equality in BOTH directions: a one-sided check passes when the catalog silently drops a
    // row and duplicates another, which is exactly the failure that would shrink the denominator.
    assert.deepEqual(
      [...SHADOW_SURFACE_CATALOG].map((row) => row.surfaceId).sort(),
      asyncRows.map((row) => row.surfaceId).sort(),
    );
  });

  it('has no duplicate surfaceId', () => {
    const ids = SHADOW_SURFACE_CATALOG.map((row) => row.surfaceId);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('never invents ownership the matrix left UNRESOLVED', () => {
    const invented = SHADOW_SURFACE_CATALOG.filter((row) => {
      const docRow = docBySurfaceId.get(row.surfaceId)!;
      return docRow.featureKey === 'UNRESOLVED' && row.gateKey !== null && !row.note?.includes('OQ-3');
    });
    assert.deepEqual(invented, [], 'a new surface may not attribute an undecided row to a gate');

    // The four piece-3 attributions, pinned by name so widening the exception is a visible edit.
    const shipped = SHADOW_SURFACE_CATALOG
      .filter((row) => docBySurfaceId.get(row.surfaceId)!.featureKey === 'UNRESOLVED' && row.gateKey !== null)
      .map((row) => row.surfaceId)
      .sort();
    assert.deepEqual(shipped, [
      'OUTBOX_PRODUCER: crm-inbox (conversations/channels/policy)',
      'OUTBOX_PRODUCER: inventory',
      'POST /v1/internal/crm/campaign-delivery-scan',
      "startCrmCampaignWorker (queue 'crm-campaign-delivery')",
    ]);
  });

  it('carries the matrix gate wherever the matrix decided one', () => {
    for (const row of SHADOW_SURFACE_CATALOG) {
      const docRow = docBySurfaceId.get(row.surfaceId)!;
      if (NON_FEATURE.has(docRow.featureKey)) continue;
      assert.equal(row.gateKey, docRow.featureKey, `gate drift on ${row.surfaceId}`);
    }
  });

  it('maps every PLATFORM row to no gate at all', () => {
    for (const row of SHADOW_SURFACE_CATALOG) {
      if (docBySurfaceId.get(row.surfaceId)!.featureKey !== 'PLATFORM') continue;
      assert.equal(row.gateKey, null, `${row.surfaceId} must not name a gate`);
      assert.equal(row.coverage, 'EXEMPT');
    }
  });

  it('binds every gateKey to a materializable launch-matrix route', () => {
    const gates = new Set(MATERIALIZABLE_LAUNCH_MATRIX_ROWS.map((row) => row.gateKey));
    for (const row of SHADOW_SURFACE_CATALOG) {
      if (row.gateKey) assert.ok(gates.has(row.gateKey), `${row.gateKey} has no launch-gate row`);
    }
  });

  it('gives a surface to exactly the covered kinds', () => {
    for (const row of SHADOW_SURFACE_CATALOG) {
      const covered = ['INSTRUMENTED', 'PROXY', 'PRODUCER'].includes(row.coverage);
      assert.equal(row.surface !== null, covered, `surface/coverage mismatch on ${row.surfaceId}`);
      // A covered row must also name the gate its evidence lands on, or the bucket it writes is
      // attributed to nothing and the row is measured without being measurable.
      if (covered) assert.notEqual(row.gateKey, null, `${row.surfaceId} is covered but nameless`);
    }
  });

  it('lists the undecided rows instead of hiding them', () => {
    assert.equal(UNOWNED_SHADOW_SURFACES.length, 13);
    assert.ok(UNOWNED_SHADOW_SURFACES.every((row) => row.gateKey === null && row.surface === null));
    // 13 undecided + the 4 shipped attributions = the matrix's 17 UNRESOLVED async rows.
    assert.equal(
      UNOWNED_SHADOW_SURFACES.length + 4,
      asyncRows.filter((row) => row.featureKey === 'UNRESOLVED').length,
    );
  });
});

describe('SHADOW_SURFACES constants', () => {
  it('are all distinct', () => {
    const values = Object.values(SHADOW_SURFACES);
    assert.equal(new Set(values).size, values.length, 'two surfaces share a string and would merge');
  });

  it('pins the two piece-3 values, which existing bucket rows are already written under', () => {
    assert.equal(SHADOW_SURFACES.outboxDrain, 'outbox.drain');
    assert.equal(SHADOW_SURFACES.crmCampaignDelivery, 'crm.campaign.delivery');
  });

  it('derives the three shared notification sweeps from the helper name', () => {
    assert.equal(notificationSweepSurface('snapshot'), 'notifications.sweep.snapshot');
    assert.equal(notificationSweepSurface('stock_low'), 'notifications.sweep.stock_low');
  });
});

describe('per-family shadow coverage', () => {
  it('is COMPLETE for the two families this piece instruments end to end', () => {
    assert.equal(shadowCoverageComplete('workflow_automation'), true);
    assert.equal(shadowCoverageComplete('ai_line_assistant'), true);
  });

  it('is COMPLETE for dashboard_notifications, the third family in the ruled order', () => {
    assert.equal(shadowCoverageComplete('dashboard_notifications'), true);
  });

  it('is COMPLETE for crm after all three decided scanners gained probes', () => {
    assert.equal(shadowCoverageComplete('crm'), true);
    assert.deepEqual(expectedShadowSurfaces('crm', 'DEFAULT'), [
      'crm.sla.scan',
      'crm.campaign.delivery',
      'crm.newconv.scan',
      'crm.inbox.retry',
      'outbox.drain',
    ]);
  });

  it('is COMPLETE for expense_auto_post only because it probes before the entitlement filter', () => {
    assert.equal(shadowCoverageComplete('expense_auto_post'), true);
    assert.deepEqual(expectedShadowSurfaces('expense_auto_post', 'DEFAULT'), ['expense.auto_post.drain']);
  });

  it('closes the seven FIN producer families on outbox.drain alone (ruling OQ-2)', () => {
    for (const gateKey of [
      'double_entry_ledger', 'expenses', 'sales_documents', 'thai_tax',
      'procurement', 'reimbursement', 'bank_reconciliation',
    ]) {
      assert.equal(shadowCoverageComplete(gateKey), true, gateKey);
      assert.deepEqual(expectedShadowSurfaces(gateKey, 'DEFAULT'), ['outbox.drain'], gateKey);
    }
  });

  it('expects every workflow_automation surface on its DEFAULT route', () => {
    assert.deepEqual([...expectedShadowSurfaces('workflow_automation', 'DEFAULT')].sort(), [
      'outbox.drain',
      'workflow.action.retry',
      'workflow.events.ingest',
      'workflow.scan',
      'workflow.webhook.dispatch',
    ]);
  });

  it('expects every ai_line_assistant surface on its DEFAULT route', () => {
    assert.deepEqual([...expectedShadowSurfaces('ai_line_assistant', 'DEFAULT')].sort(), [
      'ai.draft.drain',
      'ai.draft.generate',
      'ai.ledger.drain',
      'line.webhook.employee',
    ]);
  });

  it('expects nothing on a non-DEFAULT route — no async surface names one', () => {
    assert.deepEqual(expectedShadowSurfaces('cap.wht50bis', 'SYSTEM_INITIAL_ISSUE'), []);
  });

  it('reports a gate with no async surface as having nothing to expect', () => {
    // `reports` is the released family and has zero async rows: empty expectations, and the
    // completeness question does not apply — callers read the two together.
    assert.deepEqual(expectedShadowSurfaces('reports', 'DEFAULT'), []);
    assert.equal(shadowCoverageComplete('reports'), false);
  });
});
