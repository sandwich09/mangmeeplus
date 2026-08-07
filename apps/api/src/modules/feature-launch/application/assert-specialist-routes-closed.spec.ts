import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MATERIALIZABLE_LAUNCH_MATRIX_ROWS } from '../domain/launch-matrix.catalog';
import { SPECIALIST_LEGAL_GATE_KEYS, assertSpecialistRoutesClosed } from './assert-specialist-routes-closed';

type Row = { gateKey: string; routeKey: string; state: 'OPEN' | 'CLOSED' };

/** Applies the real `where` the check sends, so a wrong filter fails the test rather than passing it. */
function prismaWith(rows: Row[]) {
  return { client: { featureLaunchGate: { findMany: async ({ where }: any) => rows.filter(
    (row) => where.gateKey.in.includes(row.gateKey) && row.state === where.state,
  ) } } } as any;
}

/** What the bootstrap actually leaves behind: every materializable row at its seed state. */
const seededBaseline: Row[] = MATERIALIZABLE_LAUNCH_MATRIX_ROWS.map((row) => ({
  gateKey: row.gateKey, routeKey: row.routeKey, state: row.seedState,
}));

describe('assertSpecialistRoutesClosed (v5.1 invariant)', () => {
  it('passes on the seeded baseline', async () => {
    await assertSpecialistRoutesClosed(prismaWith(seededBaseline));
  });

  it('fails and names the route when a SPECIALIST_LEGAL row is OPEN', async () => {
    const rows = seededBaseline.map((row) => (row.gateKey === 'cap.wht50bis' && row.routeKey === 'SYSTEM_INITIAL_ISSUE'
      ? { ...row, state: 'OPEN' as const } : row));
    await assert.rejects(() => assertSpecialistRoutesClosed(prismaWith(rows)), (err: Error) => {
      assert.match(err.message, /v5\.1 invariant violated/);
      assert.match(err.message, /cap\.wht50bis\/SYSTEM_INITIAL_ISSUE/);
      return true;
    });
  });

  it('catches a concrete route materialized under a specialist NAMESPACE gate', async () => {
    // The catalog cannot enumerate this routeKey, so the check matches on the gate key.
    const rows: Row[] = [
      ...seededBaseline,
      { gateKey: 'cap.thai_tax.external_filing_correction', routeKey: 'PP30:AMEND:v1', state: 'OPEN' },
    ];
    await assert.rejects(
      () => assertSpecialistRoutesClosed(prismaWith(rows)),
      /cap\.thai_tax\.external_filing_correction\/PP30:AMEND:v1/,
    );
  });

  it('ignores OPEN ORDINARY routes — those are the grandfathered live features', async () => {
    assert.ok(seededBaseline.some((row) => row.state === 'OPEN'), 'baseline must contain OPEN ORDINARY rows');
    assert.ok(!SPECIALIST_LEGAL_GATE_KEYS.includes('inventory'));
    await assertSpecialistRoutesClosed(prismaWith(seededBaseline));
  });

  it('covers every SPECIALIST_LEGAL gate in the matrix', async () => {
    assert.deepEqual([...SPECIALIST_LEGAL_GATE_KEYS].sort(), [
      'cap.thai_tax.external_filing_correction',
      'cap.thai_tax.vat_credit_in_product_offset',
      'cap.thai_tax.vat_scope_credit_transfer',
      'cap.wht50bis',
    ]);
  });
});
