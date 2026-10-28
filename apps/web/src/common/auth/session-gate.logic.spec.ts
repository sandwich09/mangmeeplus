import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canOpenSales,
  companyGateReturnPath,
  canOpenSystemBilling,
  isSalesOnlySession,
  isSystemAdmin,
  legalAcceptanceContextCompanyId,
  legalAcceptancePath,
  mapAuthMeStatus,
  recoveryReturnUrl,
  resolveLoginLanding,
  resolvePostLegalAcceptanceTarget,
  resolvePasswordChangeTarget,
  salesGateReturnPath,
  shouldAttemptSessionRecovery,
  systemGateReturnPath,
} from './session-gate.logic';
import type { WebSession } from '../models/web-session.model';
import * as gates from './session-gate.logic';

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
    canSkipCurrentPassword: false,
    legalAcceptanceRequired: false,
    ...overrides,
  };
}

describe('executive report entry', () => {
  const executive = () => session({ roles: ['MANGMEE_EXECUTIVE'], permissions: ['system.executive.read', 'account.read'] });
  it('opens only the report subtree by read permission, including a permission without the named role', () => {
    const canOpen = (gates as unknown as { canOpenSystemExecutive: (s: WebSession, p: string) => boolean }).canOpenSystemExecutive;
    for (const path of ['/system/executive', '/system/executive/companies/c1?month=2026-09']) {
      assert.equal(canOpen(executive(), path), true);
      assert.equal(canOpen(session({ permissions: ['system.executive.read'] }), path), true);
      assert.equal(canOpen(session({ roles: ['MANGMEE_EXECUTIVE'] }), path), false);
    }
    for (const path of ['/system/partners', '/system/executive-users', '/system/executive-other', '/system/executive/../partners']) assert.equal(canOpen(executive(), path), false);
  });
  it('lands an executive on reports through login/legal gates and ignores a remembered company home', () => {
    assert.equal(resolveLoginLanding(null, '/companies/c1/dashboard', executive()), '/system/executive');
    assert.equal(resolveLoginLanding('/system/executive/usage?month=2026-09', undefined, executive()), '/system/executive/usage?month=2026-09');
    assert.equal(resolvePostLegalAcceptanceTarget('/companies/c1/dashboard', executive()), '/system/executive');
  });
  it('keeps company business users and admins distinct from executive-only sessions', () => {
    const only = (gates as unknown as { isExecutiveOnlySession: (s: WebSession) => boolean }).isExecutiveOnlySession;
    assert.equal(only(executive()), true);
    assert.equal(only(session({ roles: ['SYSTEM_ADMIN'], permissions: ['system.executive.read'] })), false);
    assert.equal(only(session({ permissions: ['system.executive.read', 'expenses.read'] })), false);
  });
  it('still recognises an executive-only session after its report read right is removed', () => {
    const revoked = session({ roles: ['MANGMEE_EXECUTIVE'], permissions: ['account.read'] });
    assert.equal(gates.canOpenSystemExecutive(revoked, '/system/executive'), false);
    assert.equal(gates.isExecutiveOnlySession(revoked), true);
    assert.equal(gates.isExecutiveOnlySession(session({ roles: ['MANGMEE_EXECUTIVE'], permissions: ['expenses.read'] })), false);
    assert.equal(gates.isExecutiveOnlySession(session({ roles: ['SYSTEM_ADMIN', 'MANGMEE_EXECUTIVE'], permissions: ['account.read'] })), false);
    assert.equal(gates.isExecutiveOnlySession(session({ permissions: ['account.read'] })), false);
    // The base read role itself gone while the export/contact roles stay: still an executive, never the admin console's words.
    const baseRoleGone = session({ roles: ['MANGMEE_EXECUTIVE_EXPORT', 'MANGMEE_EXECUTIVE_CONTACT'], permissions: ['account.read', 'system.executive.export', 'system.executive.contact.read'] });
    assert.equal(gates.isExecutiveOnlySession(baseRoleGone), true);
    assert.equal(gates.isExecutiveOnlySession(session({ roles: ['MANGMEE_EXECUTIVE_EXPORT', 'MANGMEE_SALES'], permissions: ['account.read', 'system.executive.export', 'sales.deal.read'] })), false);
  });
});

describe('billing delegate shell boundary', () => {
  it('opens only billing paths with the exact read grant, without opening other system sections', () => {
    const support = session({ roles: ['BILLING_SUPPORT'], permissions: ['system.billing.read'] });
    for (const path of ['/system/billing', '/system/billing/issues/issue-1', '/system/billing/companies/c1?invoiceCursor=x']) {
      assert.equal(canOpenSystemBilling(support, path), true);
      assert.equal(canOpenSystemBilling(session(), path), false);
    }
    for (const path of ['/system/partners', '/system/platform-access', '/system/billing-other', '/companies/c1/billing', '/system/billing/../partners', '//evil.example/system/billing']) {
      assert.equal(canOpenSystemBilling(support, path), false);
    }
  });
});

describe('mapAuthMeStatus', () => {
  it('keeps signed-out, forbidden, platform closure and unavailable distinct', () => {
    assert.equal(mapAuthMeStatus(200), 'signed_in');
    assert.equal(mapAuthMeStatus(401), 'signed_out');
    assert.equal(mapAuthMeStatus(403), 'forbidden');
    assert.equal(mapAuthMeStatus(503, 'platform_access_closed'), 'platform_closed');
    assert.equal(mapAuthMeStatus(503, 'different_error'), 'unavailable');
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
  /**
   * Audit H-16: "go to an available company" linked to /login, the remembered home pointed back at
   * the company the user could not open, and the redirect looped — sign out was the only exit.
   * That screen now asks for the remembered landing to be skipped, which is this call shape.
   */
  it('falls back to the session company when the remembered home is skipped', () => {
    // What /login passes once ?home=reset is present.
    assert.equal(
      resolveLoginLanding(null, undefined, session({ companyId: 'c2' })),
      '/companies/c2/dashboard',
    );
    // ...instead of the stale home, which is what produced the loop.
    assert.equal(
      resolveLoginLanding(null, '/companies/c1/dashboard', session({ companyId: 'c2' })),
      '/companies/c1/dashboard',
    );
  });

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

  it('defaults system admins to the platform access control and everyone else to their dashboard', () => {
    assert.equal(resolveLoginLanding(null, undefined, session({ roles: ['SYSTEM_ADMIN'] })), '/system/partners');
    assert.equal(resolveLoginLanding(null, undefined, session()), '/companies/c1/dashboard');
  });

  it('defaults confirmed free shops to expenses while preserving draft and billing recovery homes', () => {
    const free = session({ freeExpenseDrafts: true });
    assert.equal(resolveLoginLanding(null, undefined, free), '/companies/c1/expenses');
    assert.equal(resolveLoginLanding(null, '/companies/c1/dashboard', free), '/companies/c1/expenses');
    assert.equal(resolveLoginLanding(null, '/companies/c1/renew', free), '/companies/c1/expenses');
    assert.equal(resolveLoginLanding(null, '/companies/c1/expenses/exp-1', free), '/companies/c1/expenses/exp-1');
    assert.equal(resolveLoginLanding(null, '/companies/c1/billing/recover', free), '/companies/c1/billing/recover');
    assert.equal(resolveLoginLanding('/companies/c1/billing/recover', '/companies/c1/dashboard', free), '/companies/c1/billing/recover');
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

  it('uses expenses as the free-shop post-acceptance default and keeps billing recovery links', () => {
    const free = session({ freeExpenseDrafts: true });
    assert.equal(resolvePostLegalAcceptanceTarget(null, free), '/companies/c1/expenses');
    assert.equal(resolvePostLegalAcceptanceTarget('/companies/c1/dashboard', free), '/companies/c1/expenses');
    assert.equal(resolvePostLegalAcceptanceTarget('/companies/c1/renew', free), '/companies/c1/expenses');
    assert.equal(resolvePostLegalAcceptanceTarget('/companies/c1/billing/recover', free), '/companies/c1/billing/recover');
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

describe('companyGateReturnPath', () => {
  it('returns a company visitor to the page they actually opened', () => {
    assert.equal(
      companyGateReturnPath('/companies/c1/expenses/e1?tab=signatures', 'c1'),
      '/companies/c1/expenses/e1?tab=signatures',
    );
  });

  it('falls back to the dashboard for anything outside this company', () => {
    const dashboard = '/companies/c1/dashboard';
    assert.equal(companyGateReturnPath(null, 'c1'), dashboard, 'missing header');
    assert.equal(companyGateReturnPath('/companies/c2/expenses/e1', 'c1'), dashboard, 'another tenant');
    assert.equal(companyGateReturnPath('/companies/c1x/expenses/e1', 'c1'), dashboard, 'id prefix is not a match');
    assert.equal(companyGateReturnPath('//evil.example', 'c1'), dashboard, 'protocol-relative');
    assert.equal(companyGateReturnPath('/legal-acceptance?next=/companies/c1/x', 'c1'), dashboard, 'the gate itself');
    assert.equal(companyGateReturnPath('/change-password', 'c1'), dashboard, 'the other gate');
  });
});

describe('systemGateReturnPath', () => {
  it('preserves the system company and query through authentication recovery', () => {
    const target = '/system/partners/c1?tab=billing&reference=invoice-1';
    assert.equal(systemGateReturnPath(target), target);
  });

  it('falls back for missing, external, gate and out-of-scope paths', () => {
    for (const path of [null, undefined, '/', '/system', '/systematic/c1', '/companies/c1/dashboard',
      '//evil.example/system/x', 'https://evil.example/system/x', '/system/../login',
      '/legal-acceptance?next=/system/partners/c1', '/change-password']) {
      assert.equal(systemGateReturnPath(path), '/system/partners', String(path));
    }
  });
});

describe('sales console shell boundary (S07/S29)', () => {
  const lead = () => session({
    companyId: 'platform-tenant',
    roles: ['MANGMEE_SALES_LEAD'],
    permissions: ['sales.console.read', 'sales.company.search', 'sales.deal.create', 'sales.deal.approve',
      'sales.team.manage', 'sales.report.read', 'account.password.change'],
  });
  const agent = () => session({
    companyId: 'platform-tenant',
    roles: ['MANGMEE_SALES'],
    permissions: ['sales.console.read', 'sales.company.search', 'sales.deal.create', 'account.password.change'],
  });

  it('opens /sales for both sales roles and for a system admin, and for nobody else', () => {
    assert.equal(canOpenSales(agent()), true);
    assert.equal(canOpenSales(lead()), true);
    assert.equal(canOpenSales(session({ roles: ['SYSTEM_ADMIN'], permissions: ['sales.console.read'] })), true);
    assert.equal(canOpenSales(session()), false);
    assert.equal(canOpenSales(session({ roles: ['SALES'], permissions: ['crm.sales.read'] })), false, 'the tenant SALES role is a different thing (S06)');
  });

  it('treats only a permission-less-outside-sales session as sales-only, so /system keeps working for an admin', () => {
    assert.equal(isSalesOnlySession(agent()), true);
    assert.equal(isSalesOnlySession(lead()), true);
    assert.equal(isSalesOnlySession(session({ roles: ['SYSTEM_ADMIN'], permissions: ['sales.console.read'] })), false);
    // A hypothetical hybrid membership keeps its business shell rather than losing it to the console.
    assert.equal(isSalesOnlySession(session({ permissions: ['sales.console.read', 'expenses.read'] })), false);
    assert.equal(isSalesOnlySession(session()), false);
  });

  it('lands a sales session on the console, ignoring the platform tenant home cookie it was given', () => {
    // The login BFF derives the home path from `companyId`, which for these roles is มั่งมี's own
    // tenant — following it would bounce off the workspace gate instead of opening anything.
    assert.equal(resolveLoginLanding(null, '/companies/platform-tenant/dashboard', agent()), '/sales/deals');
    assert.equal(resolveLoginLanding('/companies/platform-tenant/dashboard', undefined, agent()), '/sales/deals');
    assert.equal(resolveLoginLanding('/sales/deals/deal-1', undefined, lead()), '/sales/deals/deal-1');
    assert.equal(resolveLoginLanding(null, undefined, lead()), '/sales/deals');
  });

  it('keeps the legal gate in front of the console, exactly as it does for every other landing', () => {
    const pending = session({ ...agent(), legalAcceptanceRequired: true });
    assert.match(resolveLoginLanding(null, undefined, pending) ?? '', /^\/legal-acceptance\?/);
    assert.match(resolveLoginLanding(null, undefined, pending) ?? '', /next=%2Fsales%2Fdeals/);
  });

  it('returns a sales session to the console after the legal gate, never to a company dashboard', () => {
    assert.equal(resolvePostLegalAcceptanceTarget('/companies/platform-tenant/dashboard', agent()), '/sales/deals');
    assert.equal(resolvePostLegalAcceptanceTarget('/sales/team', lead()), '/sales/team');
    assert.equal(resolvePostLegalAcceptanceTarget(null, agent()), '/sales/deals');
  });

  it('preserves a /sales deep link through authentication, and refuses anything outside it', () => {
    assert.equal(salesGateReturnPath('/sales/deals/deal-1?tab=preview'), '/sales/deals/deal-1?tab=preview');
    for (const path of [null, undefined, '/', '/system/partners', '/companies/c1/dashboard',
      '//evil.example/sales/x', 'https://evil.example/sales/x', '/change-password',
      '/legal-acceptance?next=/sales/deals']) {
      assert.equal(salesGateReturnPath(path), '/sales/deals', String(path));
    }
  });
});
