import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./IndividualPermissionsPrototypePage.tsx', import.meta.url), 'utf8');

test('employee identity and full role chips wrap on separate grid rows without competing for width', () => {
  const row = source.slice(source.indexOf('function EmployeeRow('), source.indexOf('function BranchAccessChip('));
  assert.match(row, /grid[^']*grid-cols-\[38px_minmax\(0,1fr\)\]/);
  assert.match(row, /<span className="[^"]*\[overflow-wrap:anywhere\][^"]*">\{employeeShortName\(employee\)\}/);
  assert.doesNotMatch(row, /truncate[^"}]*">\{employeeShortName\(employee\)\}/);
  assert.match(row, /<span className="[^"]*col-start-2[^\"]*flex-wrap/);
  assert.match(row, /<RoleBadge[^>]*className="[^"]*max-w-full[^"]*whitespace-normal[^"]*\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(row, /max-w-40|line-clamp-|role\.name\.slice|aria-hidden/);
  // The full shared label remains real text; accessibility does not depend on hovering a title.
  const badge = source.slice(source.indexOf('function RoleBadge('), source.indexOf('function DraftBadge('));
  assert.match(badge, /rounded-full/);
  assert.match(badge, />\s*\{roleDisplayName\(role\)\}/);
});

// A company may give a role a long name, and the picker is where it is chosen: a cut name hides the end that
// tells two long names apart, so neither the current value nor an option may cut it (browser check 2026-10-04).
test('the role picker shows a long role name in full, as the current value and as every option', () => {
  const picker = source.slice(source.indexOf('ref={rolePickerRef}'), source.indexOf('{selectedIsOwner'));
  assert.doesNotMatch(picker, /\btruncate\b/);
  assert.doesNotMatch(picker, /className="inline-flex h-9 /, 'a fixed height would clip the wrapped current value');
  assert.match(picker, /<div className="absolute left-0 top-full /, 'the open list starts below a value that wrapped');
  assert.match(picker, /role="listbox" className="max-h-64 overflow-y-auto"/);
  assert.match(picker, /<span className="[^"]*\[overflow-wrap:anywhere\][^"]*">\{selectedRoleNames\}<\/span>/);
  assert.match(picker, /<span className="[^"]*\[overflow-wrap:anywhere\][^"]*">\{roleDisplayName\(role\)\}<\/span>/);
});

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
  assert.match(source, /employees\.length === 0 \? 'ยังไม่มีพนักงานในร้านนี้' : 'ไม่พบพนักงานที่ตรงกับตัวกรอง ลองเปลี่ยนตัวกรองหรือคำค้น'/);
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
  // The role page reuses the same display rule as every employee picker.
  assert.doesNotMatch(legacy, /ROLE_LABEL_KEYS/);
  assert.match(legacy, /export \{ roleDisplayName \} from '\.\/role-picker\.logic'/);
  // The editor opens with the name the list shows.
  assert.match(legacy, /useState\(initial \? roleDisplayName\(initial, locale\) : ''\)/);
  assert.match(matrix, /initial=\{selectedRole\}/);
  assert.doesNotMatch(source, /'Draft'|>Draft</);
  // The rights a standard role keeps outside the choices are counted, not printed as one sentence per right.
  assert.match(legacy, /\{permissionCatalog\.length > 0 && \(\s*<ul /);
});

test('both employee branch pickers exclude inactive branches from options and retained selections', () => {
  const wizard = readFileSync(new URL('./AddEmployeePrototypePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /setBranches\(branchesR\.value\.filter\(\(branch\) => branch\.status === 'ACTIVE'\)\)/);
  assert.match(source, /employeeBranchIds\(selectedEmployee\)\.filter\(\(id\) => branches\.some\(\(branch\) => branch\.id === id\)\)/);
  assert.match(wizard, /setBranches\(branchesResult\.value\.filter\(\(branch\) => branch\.status === 'ACTIVE'\)\)/);
  assert.match(wizard, /branchesResult\.value\.filter\(\(branch\) => branch\.status === 'ACTIVE'\)\.map/);
  assert.match(wizard, /employeeBranchIds\(employee\)\.filter\(\(id\) => activeBranchIds\.includes\(id\)\)/);
});

test('employees-and-rights prose uses the same standard role names as the pickers', () => {
  const wizard = readFileSync(new URL('./AddEmployeePrototypePage.tsx', import.meta.url), 'utf8');
  const discount = readFileSync(new URL('./DiscountPolicyPage.tsx', import.meta.url), 'utf8');
  for (const page of [source, wizard, discount]) assert.doesNotMatch(page, /เจ้าของร้าน|แอดมิน/);
});

test('the add-employee wizard presents the account and birth-date instructions in Thai', () => {
  const wizard = readFileSync(new URL('./AddEmployeePrototypePage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(wizard, /(?:label=|>)(?:"|')?Username(?:"|')?|DDMMYYYY|DD\/MM\/YYYY|\bSMTP\b|\bDraft\b|\bOA\b|08xxxxxxxx|name@room45\.co|name@company\.com|a-z, A-Z, 0-9|กรุณากรอก Username|รูปแบบ เช่น/);
  assert.doesNotMatch(wizard, /กรุณากรอก Username|แก้ไข Username/);
});


test('one account switch disables with one named confirmation and restores inactive accounts', () => {
  assert.match(source, /selectedActive \? 'DISABLED' : 'ACTIVE'/);
  assert.match(source, /title: `ปิดใช้งาน \$\{name\}`/);
  assert.match(source, /message: 'เข้าสู่ระบบของร้านนี้ไม่ได้และคืนที่นั่งให้ร้าน'/);
  assert.match(source, /confirmLabel: 'ปิดใช้งาน', cancelLabel: 'ไม่ปิด'/);
  assert.match(source, /label="ใช้งาน \/ ปิดใช้งาน"/);
  assert.match(source, /canDisableEmployee && selectedIsDraft && <button/);
  assert.doesNotMatch(source, /'SUSPENDED'|ปิดการใช้งานบัญชี|ระงับการใช้งาน/);
});


test('person cards issue LINE links only with the existing permission and show linked status, copy and expiry', () => {
  assert.match(source, /viewerPermissions.includes\('access.employee.line_link.issue'\)/);
  assert.match(source, /if \(!selectedEmployee \|\| !canIssueLineLink \|\| busy\) return/);
  assert.match(source, /await issueEmployeeLineLinkToken\(companyId, selectedEmployee.id\)/);
  assert.match(source, /employee.lineLinked \? 'เชื่อม LINE แล้ว' : 'ยังไม่ได้เชื่อม LINE'/);
  assert.match(source, /canIssueLineLink && \(/);
  assert.match(source, /ออกลิงก์เชื่อม LINE/);
  assert.match(source, /คัดลอกลิงก์/);
  assert.match(source, /ใช้ได้ 15 นาที/);
  assert.match(source, /formatThaiDateTime\(lineLink.package.expiresAt\)/);
  assert.match(source, /lineLink\?\.employeeId === selectedEmployee.id && lineLink.companyId === companyId/);
});

test('the list and card name the same person and every issued link replaces the whole package', () => {
  assert.match(source, /<h2[^>]*>\{employeeShortName\(selectedEmployee\)\}<\/h2>/);
  assert.match(source, /setLineLink\(\{ employeeId: selectedEmployee.id, companyId, package: result \}\)/);
  const card = source.slice(source.indexOf('data-testid="employee-detail-card"'), source.indexOf('data-testid="access-permission-summary"'));
  assert.equal((card.match(/<ActionGroup/g) ?? []).length, 1);
  assert.match(card, /<ActionGroup[^>]*>[\s\S]*แก้ไขข้อมูล[\s\S]*ออกลิงก์เชื่อม LINE[\s\S]*คัดลอกลิงก์[\s\S]*<\/ActionGroup>/);
});


test('name history is mounted on the permission-checked person card, not in the unused detail panel', () => {
  assert.match(source, /canEditEmployee && <DisplayNameHistoryDisclosure key=\{`\$\{companyId\}:\$\{selectedEmployee.userId\}`\} companyId=\{companyId\} userId=\{selectedEmployee.userId\}/);
  const legacy = readFileSync(new URL('./EmployeeAccessPages.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(legacy, /AccountDisplayName|DisplayNameHistoryDisclosure|ชื่อที่ใช้แสดง/);
  assert.match(legacy, /<FieldLabel>ชื่อที่แสดง<\/FieldLabel>/);
  const editor = readFileSync(new URL('./AddEmployeePrototypePage.tsx', import.meta.url), 'utf8');
  assert.match(editor, /<legend className=\{labelClass\}>ชื่อที่แสดง<\/legend>[\s\S]*employee-first-name[\s\S]*employee-last-name[\s\S]*<\/fieldset>/);
});
