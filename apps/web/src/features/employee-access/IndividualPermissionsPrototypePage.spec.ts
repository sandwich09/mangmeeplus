import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./IndividualPermissionsPrototypePage.tsx', import.meta.url), 'utf8');

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

test('both employee branch pickers exclude inactive branches from options and retained selections', () => {
  const wizard = readFileSync(new URL('./AddEmployeePrototypePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /setBranches\(branchesR\.value\.filter\(\(branch\) => branch\.status === 'ACTIVE'\)\)/);
  assert.match(source, /selectedEmployee\.branchScopeBranchIds\.filter\(\(id\) => branches\.some\(\(branch\) => branch\.id === id\)\)/);
  assert.match(wizard, /setBranches\(branchesResult\.value\.filter\(\(branch\) => branch\.status === 'ACTIVE'\)\)/);
  assert.match(wizard, /branchesResult\.value\.filter\(\(branch\) => branch\.status === 'ACTIVE'\)\.map/);
  assert.match(wizard, /employee\.branchScopeBranchIds\.filter\(\(id\) => activeBranchIds\.includes\(id\)\)/);
});
