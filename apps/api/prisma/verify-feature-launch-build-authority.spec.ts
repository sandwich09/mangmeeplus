import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MATERIALIZABLE_LAUNCH_MATRIX_ROWS } from '../src/modules/feature-launch/domain/launch-matrix.catalog';
import { assertIncidentLaunchGateCatalog } from './verify-feature-launch-build-authority';

const gates = MATERIALIZABLE_LAUNCH_MATRIX_ROWS.map((row) => ({
  gateKey: row.gateKey,
  routeKey: row.routeKey,
  state: row.routeClass === 'SPECIALIST_LEGAL' ? 'CLOSED' as const : row.seedState,
  generation: 1,
}));

describe('incident launch authority catalog', () => {
  it('accepts the exact catalog only while specialist routes remain closed', () => {
    assert.doesNotThrow(() => assertIncidentLaunchGateCatalog(gates));
  });

  it('rejects a missing catalog row', () => {
    assert.throws(() => assertIncidentLaunchGateCatalog(gates.slice(1)), /catalog_not_exact/);
  });

  it('rejects an open specialist route', () => {
    const index = MATERIALIZABLE_LAUNCH_MATRIX_ROWS.findIndex((row) => row.routeClass === 'SPECIALIST_LEGAL');
    assert.ok(index >= 0);
    const opened = gates.map((gate, gateIndex) => gateIndex === index ? { ...gate, state: 'OPEN' as const } : gate);
    assert.throws(() => assertIncidentLaunchGateCatalog(opened), /specialist_launch_route_open/);
  });
});
