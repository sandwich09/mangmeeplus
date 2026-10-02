import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./IndividualPermissionsPrototypePage.tsx', import.meta.url), 'utf8');

test('role changes replace rather than append and refresh every card from the saved employee', () => {
  assert.match(source, /const updated = await updateEmployee\(companyId, selectedEmployee\.id, \{ roleIds: \[roleId\] \}\)/);
  assert.match(source, /setEmployees\(\(current\) => current\.map\(\(employee\) => employee\.id === updated\.id \? updated : employee\)\)/);
  assert.match(source, /aria-label="บทบาทปัจจุบัน" aria-live="polite"/);
  assert.match(source, /setRoleFilter\('all'\)/);
  assert.doesNotMatch(source, /เลือกได้หลายบทบาท|\.\.\.selectedRoleIds, roleId/);
  assert.match(source, /ตำแหน่งงาน: \{selectedEmployee\.jobTitle/);
  assert.match(source, /แก้สิทธิ์ของบทบาท/);
});

test('wizard and legacy forms select one role and preserve protected profile-only edits', () => {
  const wizard = readFileSync(new URL('./AddEmployeePrototypePage.tsx', import.meta.url), 'utf8');
  const legacy = readFileSync(new URL('./EmployeeAccessPages.tsx', import.meta.url), 'utf8');
  assert.match(wizard, /setRoleIds\(\[item\.id\]\)/);
  assert.match(wizard, /roleIds\.length !== 1/);
  assert.match(wizard, /editingSelf \|\| editingProtectedRole\) \? \{ roleIds: undefined \}/);
  assert.doesNotMatch(wizard, /เลือกได้มากกว่า 1 บทบาท|\.\.\.current, roleId/);
  assert.match(legacy, /type="radio" name="create-employee-role"/);
  assert.doesNotMatch(legacy, /\.\.\.prev, r\.id/);
});

test('employee detail empty state distinguishes company-empty from filter-empty', () => {
  assert.match(source, /employees\.length === 0 \? 'ยังไม่มีพนักงานในบริษัทนี้' : 'ไม่พบพนักงานที่ตรงกับตัวกรอง กรุณาปรับตัวกรองหรือคำค้นหา'/);
});

test('menu projection count is not presented as the employee entire permission set', () => {
  assert.doesNotMatch(source, /ใช้งานได้ \{accessProjection\.grantedCount\} เมนู/);
  assert.match(source, /แสดงสิทธิ์ \{accessProjection\.grantedCount\} เมนู/);
  assert.match(source, /หน้านี้สรุปเฉพาะเมนูในตารางสิทธิ์ ไม่ใช่สิทธิ์ทั้งหมดของบทบาท/);
  assert.match(source, /ไม่มีสิทธิ์ในเมนูที่สรุปในตารางนี้/);
});

test('both employee branch pickers use trusted viewer scope and cannot offer all-branch grants to restricted viewers', () => {
  const wizard = readFileSync(new URL('./AddEmployeePrototypePage.tsx', import.meta.url), 'utf8');
  for (const page of ['access-overview', 'employees']) {
    const route = readFileSync(new URL(`../../../app/(workspace)/companies/[companyId]/settings/${page}/page.tsx`, import.meta.url), 'utf8');
    assert.match(route, /viewerBranchIds=\{session\?\.scopes\?\.branchIds\}/);
  }
  assert.match(source, /const allSelected = viewerBranchIds === undefined && next\.length === branches\.length/);
  assert.match(source, /disabled=\{busy \|\| viewerBranchIds !== undefined\}/);
  assert.match(wizard, /const allBranches = viewerBranchIds === undefined && branchIds\.length === branches\.length/);
  assert.match(wizard, /branchScopeReadOnly \? \{\} : branchScope/);
  for (const page of [source, wizard]) assert.match(page, /viewerBranchIds\.includes\(branch\.id\)/);
});

test('disabled roles are labelled and cannot be edited or disabled again', () => {
  const matrix = readFileSync(new URL('./PermissionMatrixPrototypePage.tsx', import.meta.url), 'utf8');
  assert.match(matrix, /disabled \? 'ปิดใช้งาน'/);
  assert.match(matrix, /roleEditable && selectedRole\.status === 'ACTIVE'/);
  assert.match(matrix, /selectedRole\.status !== 'ACTIVE'/);
});

// Owner report 2026-10-02: the table carried an 820 px minimum inside a sideways scroller, so at 390,
// 768 and 1280 px alike the tick columns had to be scrolled to.
test('a role’s menu rights never scroll sideways: stacked rows on a phone, a table that fits from sm up', () => {
  const matrix = readFileSync(new URL('./PermissionMatrixPrototypePage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(matrix, /min-w-\[\d+px\]|overflow-x-(auto|scroll)/);
  assert.match(matrix, /className="[^"]*\bsm:hidden\b[^"]*">\s*\{MENU_GROUP_ORDER\.map/);
  assert.match(matrix, /data-testid="role-permission-row"/);
  assert.match(matrix, /className="hidden [^"]*\bsm:block\b[^"]*">\s*<table className="w-full border-collapse">/);
  // Both layouts print one set of action words, and a menu with nothing granted says so.
  assert.match(matrix, /ACTIONS\.filter\(\(action\) => selectedRow\?\.menus\[menu\.id\]\?\.\[action\.key\]\)/);
  assert.match(matrix, /granted\.length === 0 \? <span[^>]*>ไม่ได้เปิดสิทธิ์<\/span>/);
});

// Owner report 2026-10-02: the role page printed "Company owner", and its editor opened a standard role
// with the stored name "Accountant" and would save that name into the company's copy.
test('the role and employee pages print no English role name or status', () => {
  const matrix = readFileSync(new URL('./PermissionMatrixPrototypePage.tsx', import.meta.url), 'utf8');
  const legacy = readFileSync(new URL('./EmployeeAccessPages.tsx', import.meta.url), 'utf8');
  // One list of standard role names (the dictionary's role.* entries), not a second one kept by hand.
  assert.doesNotMatch(legacy, /ROLE_LABEL_KEYS/);
  assert.match(legacy, /const dictKey = `role\.\$\{key\}`;/);
  assert.match(legacy, /dictKey in workspaceDictionary\.th\s+&& \(typeof roleOrKey === 'string' \|\| hasStandardRoleName\(/);
  // The editor opens with the name the list shows.
  assert.match(matrix, /selectedRole && \{ \.\.\.selectedRole, name: roleDisplayName\(selectedRole, locale\) \}/);
  assert.match(matrix, /initial=\{editedRole\}/);
  assert.doesNotMatch(matrix, /initial=\{selectedRole\}/);
  assert.doesNotMatch(source, /'Draft'|>Draft</);
  // The rights a standard role keeps outside the choices are counted, not printed as one sentence per right.
  assert.match(legacy, /\{permissionCatalog\.length > 0 && \(\s*<ul /);
});

test('both employee branch pickers exclude inactive branches from options and retained selections', () => {
  const wizard = readFileSync(new URL('./AddEmployeePrototypePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /setBranches\(branchesR\.value\.filter\(\(branch\) => branch\.status === 'ACTIVE'\)\)/);
  assert.match(source, /selectedEmployee\.branchScopeBranchIds\.filter\(\(id\) => branches\.some\(\(branch\) => branch\.id === id\)\)/);
  assert.match(wizard, /setBranches\(branchesResult\.value\.filter\(\(branch\) => branch\.status === 'ACTIVE'\)\)/);
  assert.match(wizard, /branchesResult\.value\.filter\(\(branch\) => branch\.status === 'ACTIVE'\)\.map/);
  assert.match(wizard, /employee\.branchScopeBranchIds\.filter\(\(id\) => activeBranchIds\.includes\(id\)\)/);
});
