import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRenewalPath, planTermView, renewalPathFor } from './plan-term.logic';
import type { PlanTermNotice } from './plan-term.api';

const notice = (over: Partial<PlanTermNotice>): PlanTermNotice => ({
  derivedState: 'ACTIVE',
  termEndsAt: '2026-09-29T07:00:00.000Z',
  daysLeft: 30,
  isOwner: true,
  ...over,
});

describe('plan term view', () => {
  it('shows nothing for a company with no term row', () => {
    assert.equal(planTermView(null), 'none');
  });

  it('shows nothing while the term is active', () => {
    assert.equal(planTermView(notice({ derivedState: 'ACTIVE' })), 'none');
  });

  // Owner decision 2026-08-30: staff are not shown the package dates at all, only the owner is.
  it('warns the owner and stays silent for staff', () => {
    assert.equal(planTermView(notice({ derivedState: 'WARNING', daysLeft: 3 })), 'warning-banner');
    assert.equal(planTermView(notice({ derivedState: 'WARNING', daysLeft: 3, isOwner: false })), 'none');
  });

  it('sends everyone to the renewal page once the term has ended, staff included', () => {
    assert.equal(planTermView(notice({ derivedState: 'EXPIRED', daysLeft: 0 })), 'renewal-page');
    assert.equal(planTermView(notice({ derivedState: 'EXPIRED', daysLeft: 0, isOwner: false })), 'renewal-page');
  });

  it('does not bounce the renewal page onto itself', () => {
    assert.equal(planTermView(notice({ derivedState: 'EXPIRED' }), true), 'none');
  });
});

describe('renewal path', () => {
  it('derives the renewal page from the company in the path', () => {
    assert.equal(renewalPathFor('/companies/abc123/dashboard'), '/companies/abc123/renew');
    assert.equal(renewalPathFor('/companies/abc123'), '/companies/abc123/renew');
    assert.equal(renewalPathFor('/system/partners'), null);
  });

  it('recognises the renewal page itself, with or without a trailing slash', () => {
    assert.equal(isRenewalPath('/companies/abc123/renew'), true);
    assert.equal(isRenewalPath('/companies/abc123/renew/'), true);
    assert.equal(isRenewalPath('/companies/abc123/renewals'), false);
    assert.equal(isRenewalPath('/companies/abc123/dashboard'), false);
  });
});
