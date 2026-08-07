import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ruleMatchesEventType } from './workflow-event-match.logic';

describe('ruleMatchesEventType', () => {
  it('matches a single configured eventType', () => {
    assert.equal(ruleMatchesEventType({ eventType: 'reimbursement.request_submitted' }, 'reimbursement.request_submitted'), true);
  });

  it('does not match a different eventType', () => {
    assert.equal(ruleMatchesEventType({ eventType: 'reimbursement.request_submitted' }, 'crm.follow_up.created'), false);
  });

  it('matches via an eventTypes array', () => {
    assert.equal(ruleMatchesEventType({ eventTypes: ['a', 'b'] }, 'b'), true);
  });

  it('handles missing config gracefully', () => {
    assert.equal(ruleMatchesEventType({}, 'anything'), false);
  });
});
