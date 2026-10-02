/**
 * Audit H-19: role keys are what approval routing compares — reimbursement steps pin
 * `approverRoleSnapshot: 'MANAGER'` — and the slug kept only ASCII, so every Thai role name
 * stripped to nothing and became `ROLE`. The most natural setup a Thai company can do (add a
 * member, give them the "ผู้จัดการ" preset) produced a role that matched nothing: the employee saw
 * an approval screen whose queue was empty forever, while the owner could not approve either.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reservedRoleKey, roleKeyFromName } from './create-role.use-case';

describe('roleKeyFromName (audit H-19)', () => {
  it('still slugs a Latin name exactly as before', () => {
    assert.equal(roleKeyFromName('Manager'), 'MANAGER');
    assert.equal(roleKeyFromName('Finance Lead'), 'FINANCE_LEAD');
    assert.equal(roleKeyFromName('  Store  Manager  '), 'STORE_MANAGER');
  });

  // The reported bug: every one of these used to be 'ROLE'.
  it('takes the canonical key from the preset when the name has no Latin letters', () => {
    assert.equal(roleKeyFromName('ผู้จัดการ', 'tpl.x.manager'), 'MANAGER');
    assert.equal(roleKeyFromName('การเงิน', 'tpl.x.finance'), 'FINANCE');
    assert.equal(roleKeyFromName('บัญชี', 'tpl.x.accounting'), 'ACCOUNTING');
    assert.equal(roleKeyFromName('แคชเชียร์', 'tpl.retail.cashier'), 'CASHIER');
  });

  // Which is the whole point: this is the comparison the approval queue makes.
  it('produces a key a MANAGER-routed approval step can actually match', () => {
    const roles = [roleKeyFromName('ผู้จัดการ', 'tpl.x.manager')];
    assert.ok(roles.includes('MANAGER'), 'a Thai-named manager role now matches MANAGER routing');
  });

  // The name is the identity when it has one; the preset only fills a gap.
  it('prefers the name over the preset when the name yields a slug', () => {
    assert.equal(roleKeyFromName('Shift Lead', 'tpl.x.manager'), 'SHIFT_LEAD');
  });

  it('uses only the last segment, since the prefix is catalogue bookkeeping', () => {
    assert.equal(roleKeyFromName('พนักงานขาย', 'tpl.retail.sales'), 'SALES');
  });

  // A hand-typed Thai name with no preset has nothing canonical to borrow. It keeps the old
  // fallback and the caller's retry loop numbers collisions; such a role does not match
  // role-routed steps, and the OWNER fallback is what keeps that company able to act.
  it('falls back to ROLE only when there is no preset to borrow from', () => {
    assert.equal(roleKeyFromName('ผู้จัดการ'), 'ROLE');
    assert.equal(roleKeyFromName('หัวหน้าฝ่าย', undefined), 'ROLE');
    assert.equal(roleKeyFromName('ผู้จัดการ', 'tpl.'), 'ROLE');
  });
});

// A custom role named "System Admin" got the key SYSTEM_ADMIN: the key was derived from free text
// with nothing reserved, and role keys are what the owner, platform and routing checks compare.
describe('reservedRoleKey', () => {
  it('reserves a system or platform role key that the NAME derives', () => {
    for (const name of ['System Admin', 'system_admin', 'Owner', 'Company View', 'Admin', 'Manager', 'Staff', 'Auditor Readonly', 'Mangmee Sales', 'MANGMEE SALES LEAD']) {
      assert.equal(reservedRoleKey(name), true, name);
      // Naming a preset does not launder a name that already yields the key.
      assert.equal(reservedRoleKey(name, 'tpl.x.manager'), true, `${name} with a preset`);
    }
    for (const name of ['Cashier', 'Store Manager', 'Owner assistant', 'Admin 2', 'ผู้จัดการ', 'Role']) {
      assert.equal(reservedRoleKey(name), false, name);
    }
  });

  it('lets a preset lend its key only when the preset exists, and never an owner or platform key', () => {
    // Audit H-19 stays as it was: these are ordinary company roles the routing expects.
    for (const preset of ['tpl.x.manager', 'tpl.x.finance', 'tpl.retail.sales', 'tpl.trading.inventory', 'tpl.x.marketing']) {
      assert.equal(reservedRoleKey('ชื่อภาษาไทย', preset), false, preset);
    }
    // `roleTemplateKey` is free text on the request, so its last segment proves nothing by itself.
    for (const preset of ['tpl.x.system_admin', 'x.owner', 'x.company_view', 'x.mangmee_sales', 'made.up.manager', 'manager']) {
      assert.equal(reservedRoleKey('ชื่อภาษาไทย', preset), true, preset);
    }
  });
});
