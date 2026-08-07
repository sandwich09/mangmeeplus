import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SNAPSHOT_GENERATE_PERMISSION, canForceGenerateSnapshot } from './dashboard-home.logic';

describe('canForceGenerateSnapshot', () => {
  it('is true when the viewer holds the generate permission', () => {
    assert.equal(canForceGenerateSnapshot(['dashboard.read', SNAPSHOT_GENERATE_PERMISSION]), true);
  });

  it('is false for a dashboard.read-only viewer', () => {
    assert.equal(canForceGenerateSnapshot(['dashboard.read']), false);
  });

  it('is false for an empty permission list', () => {
    assert.equal(canForceGenerateSnapshot([]), false);
  });

  it('exposes the exact API permission key', () => {
    assert.equal(SNAPSHOT_GENERATE_PERMISSION, 'dashboard.snapshot.generate');
  });
});
