import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityLabels, grantedActions } from './access-overview.model';

describe('access overview model', () => {
  it('returns no actions when the cell or view grant is absent', () => {
    assert.deepEqual(grantedActions(undefined), []);
    assert.deepEqual(grantedActions({}), []);
    assert.deepEqual(grantedActions({ create: true }), []);
  });

  it('returns granted actions in stable display order', () => {
    assert.deepEqual(grantedActions({ view: true }), ['view']);
    assert.deepEqual(
      grantedActions({ view: true, create: true, edit: false, approve: true }),
      ['view', 'create', 'approve'],
    );
  });

  it('maps granted actions to Thai capability labels', () => {
    assert.deepEqual(capabilityLabels({ view: true, del: true }), ['ดู', 'ลบ']);
  });
});
