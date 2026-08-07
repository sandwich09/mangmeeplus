import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasSourceModuleAccess } from './workflow-permission.logic';

describe('hasSourceModuleAccess', () => {
  it('allows access when sourceModule is undefined (rule not yet tied to a module)', () => {
    assert.equal(hasSourceModuleAccess([], undefined), true);
  });

  it('denies workflow.rule.read-only users from a source module they cannot read (no ADMIN bypass)', () => {
    assert.equal(hasSourceModuleAccess(['workflow.rule.read'], 'reimbursements'), false);
  });

  it('allows access when the user holds any one of the mapped source permissions', () => {
    assert.equal(hasSourceModuleAccess(['reimbursement.read_own'], 'reimbursements'), true);
  });

  it('allows unknown/unmapped source modules by default (no accidental lockout)', () => {
    assert.equal(hasSourceModuleAccess([], 'some-future-module'), true);
  });
});
