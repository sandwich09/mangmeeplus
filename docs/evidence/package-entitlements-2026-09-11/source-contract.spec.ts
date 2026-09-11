// Source/document regression only. This does not simulate or prove Stripe billing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PLAN_TIER_PRESETS, SIGNUP_TRIAL_TIER_KEY, SIGNUP_TRIAL_WARMUP_SLIPS } from '../../../packages/contracts/src/plan-term';
import { FEATURE_PACKAGE_PRESETS, MENU_ENTITLEMENT_BINDINGS } from '../../../packages/contracts/src/menu-entitlements';

const root = process.cwd();
const spec = readFileSync(resolve(root, 'docs/specs/mangmee-package-entitlements-spec-th.md'), 'utf8');
const mirror = readFileSync(resolve(root, '../mangmee_web/docs/specs/stripe-billing-alignment-spec-th.md'), 'utf8');
const catalog = (text: string) => {
  const match = text.match(/<!-- package-catalog:start -->([\s\S]*?)<!-- package-catalog:end -->/);
  assert.ok(match, 'canonical catalog markers required');
  return match[1];
};

test('both repo catalogs match the owner poster and actual monthly tier limits', () => {
  assert.equal(catalog(spec), catalog(mirror));
  const rows = catalog(spec).split('\n').filter(line => /^\| `/.test(line));
  const expected = [
    ['FREE_TRIAL_15', 0, null, 1, 2, 15, 'SIGNUP_ONLY'],
    ['STARTER_249', 249, 2490, 1, 2, 30, 'AFTER_READINESS'],
    ['BASIC_499', 499, 4990, 2, 5, 50, 'AFTER_READINESS'],
    ['PRO_999', 999, 9990, 5, 10, 100, 'AFTER_READINESS'],
    ['ENTERPRISE_1999', 1999, 19990, 10, 30, 2000, 'COMING_SOON_LOCKED'],
  ];
  const actual = rows.map(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim().replaceAll('`', ''));
    return [cells[0], ...cells.slice(1, 6).map(cell => cell === '—' ? null : Number(cell.replaceAll(',', ''))), cells[6]];
  });
  assert.deepEqual(actual, expected);
  for (const [key, , , branches, users, slips] of actual) {
    const preset = PLAN_TIER_PRESETS[key as keyof typeof PLAN_TIER_PRESETS];
    assert.deepEqual([preset.branchLimit, preset.employeeLimit, preset.monthlySlipLimit], [branches, users, slips]);
  }
  assert.deepEqual(actual.slice(1).map(row => Number(row[1]) * 12 - Number(row[2])), [498, 998, 1998, 3998]);
});

test('existing starter grants the documented seven menu entries and exact child permissions', () => {
  const expectedKeys = [
    'dashboard_notifications', 'expenses', 'expenses.list', 'expenses.upload', 'expenses.manual',
    'expenses.categories', 'expenses.evidence', 'expenses.signatures', 'reimbursement', 'ai_line_assistant',
    'employee_access', 'employee_access.employees', 'employee_access.roles', 'employee_access.overview',
    'company_settings', 'company_settings.branches', 'company_settings.security',
  ];
  assert.deepEqual([...FEATURE_PACKAGE_PRESETS.starter.featureKeys].sort(), expectedKeys.sort());
  const keys = new Set(FEATURE_PACKAGE_PRESETS.starter.featureKeys);
  const menus = MENU_ENTITLEMENT_BINDINGS.filter(menu => menu.status === 'ready'
    && menu.parentFeatureKey !== null && keys.has(menu.parentFeatureKey));
  assert.deepEqual(menus.map(menu => menu.labelTh).sort(), [
    'แดชบอร์ด', 'AI แนะนำ', 'ค่าใช้จ่ายและใบเสร็จ', 'การเบิกจ่าย', 'พนักงานและสิทธิ์', 'ตั้งค่าบริษัท', 'การแจ้งเตือน',
  ].sort());
  assert.equal(new Set(menus.map(menu => menu.parentFeatureKey)).size, 6);
  for (const key of keys) assert.ok(spec.includes('`' + key + '`'), `missing documented key ${key}`);
  // Actual role/tenant authorization is tested by application suites, not this menu projection.
});

test('self-signup uses the existing trial tier and fifteen from day one', () => {
  assert.equal(SIGNUP_TRIAL_TIER_KEY, 'FREE_TRIAL_15');
  assert.equal(SIGNUP_TRIAL_WARMUP_SLIPS, 15);
  assert.equal(PLAN_TIER_PRESETS[SIGNUP_TRIAL_TIER_KEY].monthlySlipLimit, 15);
  assert.notEqual(SIGNUP_TRIAL_TIER_KEY, 'STARTER_249');
});
