import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSystemAdmin,
  legalAcceptanceContextCompanyId,
  legalAcceptancePath,
  mapAuthMeStatus,
  recoveryReturnUrl,
  resolveLoginLanding,
  resolvePostLegalAcceptanceTarget,
  resolvePasswordChangeTarget,
  shouldAttemptSessionRecovery,
} from './session-gate.logic';
import type { WebSession } from '../models/web-session.model';

function session(overrides: Partial<WebSession> = {}): WebSession {
  return {
    userId: 'u1',
    displayName: 'Owner',
    companyId: 'c1',
    membershipId: 'm1',
    roles: ['OWNER'],
    permissions: [],
    authProvider: 'watchdog',
    mustChangePassword: false,
    legalAcceptanceRequired: false,
    ...overrides,
  };
}

describe('mapAuthMeStatus', () => {
  it('keeps signed-out, forbidden and unavailable distinct', () => {
    assert.equal(mapAuthMeStatus(200), 'signed_in');
    assert.equal(mapAuthMeStatus(401), 'signed_out');
    assert.equal(mapAuthMeStatus(403), 'forbidden');
    // An outage or a bad gateway must never be reported as a signed-out user: that is the
    // mapping that turned an API failure into a /login redirect loop.
    assert.equal(mapAuthMeStatus(500), 'unavailable');
    assert.equal(mapAuthMeStatus(502), 'unavailable');
    assert.equal(mapAuthMeStatus(404), 'unavailable');
  });
});

describe('isSystemAdmin', () => {
  it('is true only for the SYSTEM_ADMIN role', () => {
    assert.equal(isSystemAdmin(session({ roles: ['SYSTEM_ADMIN'] })), true);
    assert.equal(isSystemAdmin(session({ roles: ['OWNER', 'ADMIN'] })), false);
    assert.equal(isSystemAdmin(session({ roles: [] })), false);
  });
});

describe('resolveLoginLanding', () => {
  it('prefers an explicit safe next target', () => {
    assert.equal(
      resolveLoginLanding('/companies/c1/expenses', '/companies/c1/dashboard', session()),
      '/companies/c1/expenses',
    );
  });

  it('never lands off-origin', () => {
    assert.equal(resolveLoginLanding('//example.com', undefined, session()), '/companies/c1/dashboard');
    assert.equal(resolveLoginLanding('https://example.com/x', undefined, session()), '/companies/c1/dashboard');
    assert.equal(resolveLoginLanding('/\\example.com', undefined, session()), '/companies/c1/dashboard');
    assert.equal(resolveLoginLanding('/\t/evil.example', undefined, session()), '/companies/c1/dashboard');
    assert.equal(resolveLoginLanding('/\n/evil.example', undefined, session()), '/companies/c1/dashboard');
  });

  it('falls back to the percent-encoded home cookie', () => {
    assert.equal(
      resolveLoginLanding(null, encodeURIComponent('/companies/c1/dashboard'), session()),
      '/companies/c1/dashboard',
    );
  });

  it('defaults system admins to the platform partner list and everyone else to their dashboard', () => {
    assert.equal(resolveLoginLanding(null, undefined, session({ roles: ['SYSTEM_ADMIN'] })), '/system/partners');
    assert.equal(resolveLoginLanding(null, undefined, session()), '/companies/c1/dashboard');
  });

  it('refuses targets that would bounce straight back to /login', () => {
    // '/' redirects to /login, and /login itself would re-enter this gate — either one is a loop.
    assert.equal(resolveLoginLanding('/', undefined, session()), '/companies/c1/dashboard');
    assert.equal(resolveLoginLanding('/login', undefined, session()), '/companies/c1/dashboard');
    assert.equal(resolveLoginLanding('/login?next=/login', undefined, session()), '/companies/c1/dashboard');
    assert.equal(resolveLoginLanding(null, '/', session()), '/companies/c1/dashboard');
  });

  it('returns null when no safe landing exists, so the caller renders the form instead of looping', () => {
    assert.equal(resolveLoginLanding(null, undefined, session({ companyId: '' })), null);
  });

  it('lands a valid session with no watchdog_home cookie on its own dashboard', () => {
    // The home cookie is optional (cleared on logout, absent for sessions restored by refresh):
    // a valid session must still resolve a landing, never fall through to a loop.
    assert.equal(resolveLoginLanding(null, undefined, session()), '/companies/c1/dashboard');
    assert.equal(resolveLoginLanding(null, '', session()), '/companies/c1/dashboard');
  });

  it('sends a signed-in user through the legal gate while preserving the intended destination', () => {
    const gated = session({ legalAcceptanceRequired: true });
    assert.equal(
      resolveLoginLanding('/companies/c1/expenses', undefined, gated),
      '/legal-acceptance?companyId=c1&next=%2Fcompanies%2Fc1%2Fexpenses',
    );
    assert.equal(resolveLoginLanding('/legal-acceptance', undefined, gated), '/legal-acceptance');
  });

  it('fails closed when a rolling-deployment response omits the legal flag', () => {
    const mixedVersion = session({ legalAcceptanceRequired: undefined as unknown as boolean });
    assert.equal(
      resolveLoginLanding('/companies/c1/dashboard', undefined, mixedVersion),
      '/legal-acceptance?companyId=c1&next=%2Fcompanies%2Fc1%2Fdashboard',
    );
  });
});

describe('legal acceptance redirects', () => {
  it('carries only safe same-app paths into and out of the gate', () => {
    assert.equal(legalAcceptancePath('/companies/c1/expenses?tab=draft'), '/legal-acceptance?companyId=c1&next=%2Fcompanies%2Fc1%2Fexpenses%3Ftab%3Ddraft');
    assert.equal(legalAcceptancePath('//evil.example'), '/legal-acceptance');
    assert.equal(
      legalAcceptancePath('/legal-acceptance?next=%2Fsystem%2Fpartners'),
      '/legal-acceptance?next=%2Fsystem%2Fpartners',
    );
    assert.equal(resolvePostLegalAcceptanceTarget('/companies/c1/inbox', session()), '/companies/c1/inbox');
    assert.equal(resolvePostLegalAcceptanceTarget('https://evil.example', session()), '/companies/c1/dashboard');
  });

  it('binds the gate to the company in the destination before using a fallback company', () => {
    assert.equal(legalAcceptanceContextCompanyId('/companies/c2/inbox', 'c1'), 'c2');
    assert.equal(legalAcceptanceContextCompanyId('/system/partners', 'system-company'), 'system-company');
    assert.equal(legalAcceptanceContextCompanyId('/companies/%2Fescape/inbox', 'c1'), 'c1');
    assert.equal(
      legalAcceptancePath('/companies/c2/inbox', 'c1'),
      '/legal-acceptance?companyId=c2&next=%2Fcompanies%2Fc2%2Finbox',
    );
  });

  it('uses the correct role-based fallback after acceptance', () => {
    assert.equal(resolvePostLegalAcceptanceTarget(null, session()), '/companies/c1/dashboard');
    assert.equal(
      resolvePostLegalAcceptanceTarget(null, session({ roles: ['SYSTEM_ADMIN'] })),
      '/system/partners',
    );
  });
});

describe('session recovery bounce', () => {
  it('attempts recovery once, then treats the marker as spent', () => {
    // A page request can never see the refresh cookie (path-scoped to /api/auth), so the form
    // always tries once — including the case of a missing access cookie but a valid refresh cookie.
    assert.equal(shouldAttemptSessionRecovery(null), true);
    assert.equal(shouldAttemptSessionRecovery('1'), false);
  });

  it('returns through /login so the server re-validates the rotated cookies', () => {
    assert.equal(recoveryReturnUrl(null), '/login?recovered=1');
    assert.equal(
      recoveryReturnUrl('/companies/c1/expenses'),
      '/login?recovered=1&next=%2Fcompanies%2Fc1%2Fexpenses',
    );
  });

  it('never carries an off-origin target through recovery', () => {
    assert.equal(recoveryReturnUrl('//evil.example'), '/login?recovered=1');
    assert.equal(recoveryReturnUrl('https://evil.example/x'), '/login?recovered=1');
  });
});

describe('resolvePasswordChangeTarget', () => {
  it('honours a safe relative next target', () => {
    assert.equal(resolvePasswordChangeTarget('/companies/c1/dashboard', null, null), '/companies/c1/dashboard');
  });

  it('refuses protocol-relative and absolute targets', () => {
    assert.equal(resolvePasswordChangeTarget('//evil.example', null, 'c1'), '/companies/c1/dashboard');
    assert.equal(resolvePasswordChangeTarget('https://evil.example/x', null, 'c1'), '/companies/c1/dashboard');
    assert.equal(resolvePasswordChangeTarget('/\\evil.example', null, 'c1'), '/companies/c1/dashboard');
  });

  it('refuses /login and root, which would bounce the fresh session straight back', () => {
    assert.equal(resolvePasswordChangeTarget('/login', null, 'c1'), '/companies/c1/dashboard');
    assert.equal(resolvePasswordChangeTarget('/', null, 'c1'), '/companies/c1/dashboard');
  });

  it('falls back to the remembered redirect path, then the company dashboard, then root', () => {
    assert.equal(resolvePasswordChangeTarget(null, '/companies/c2/inbox', 'c1'), '/companies/c2/inbox');
    assert.equal(resolvePasswordChangeTarget(null, '//evil.example', 'c1'), '/companies/c1/dashboard');
    assert.equal(resolvePasswordChangeTarget(null, null, null), '/');
  });
});
