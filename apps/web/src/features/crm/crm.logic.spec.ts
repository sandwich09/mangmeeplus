import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCrmTab, visibleCrmTabs } from './crm.logic';

describe('visibleCrmTabs', () => {
  it('keeps CRM tabs in source order and hides unavailable endpoints', () => {
    assert.deepEqual(
      visibleCrmTabs(['crm.lead.read', 'crm.follow_up.read']),
      ['leads', 'followups'],
    );
  });

  it('shows overview when either of its independent reads is available', () => {
    assert.deepEqual(visibleCrmTabs(['crm.report.read']), ['overview']);
    assert.deepEqual(visibleCrmTabs(['crm.ai.read']), ['overview']);
  });

  it('returns no tabs for unrelated permissions', () => {
    assert.deepEqual(visibleCrmTabs(['crm.customer.read', 'crm.booking.read']), []);
  });
});

describe('parseCrmTab', () => {
  it('accepts a requested visible tab', () => {
    assert.equal(parseCrmTab('pipeline', ['leads', 'pipeline']), 'pipeline');
  });

  it('falls back to the first visible tab for hidden and invalid deep links', () => {
    assert.equal(parseCrmTab('overview', ['leads', 'followups']), 'leads');
    assert.equal(parseCrmTab('__proto__', ['pipeline']), 'pipeline');
    assert.equal(parseCrmTab(null, ['followups']), 'followups');
  });

  it('has a stable fallback when no tab is visible', () => {
    assert.equal(parseCrmTab('pipeline', []), 'overview');
  });
});
