import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./BranchSettingsPage.tsx', import.meta.url), 'utf8');

test('expense-focused branch creation excludes warehouse without removing the other types or changing the default', () => {
  assert.match(source, /Object\.entries\(TYPE_LABELS\)\.filter\(\(\[type\]\) => type !== 'WAREHOUSE'\)\.map\(/);
  assert.match(source, /HEAD_OFFICE: 'สำนักงานใหญ่'/);
  assert.match(source, /BRANCH: 'สาขา'/);
  assert.match(source, /ONLINE: 'ออนไลน์'/);
  assert.match(source, /const EMPTY_FORM: CreateBranchInput = \{ code: '', name: '', type: 'BRANCH'/);
});

test('historical warehouse branches retain their label and editing does not rewrite their type', () => {
  assert.match(source, /WAREHOUSE: 'คลังสินค้า'/);
  assert.match(source, /TYPE_LABELS\[b\.type\] \?\? 'ไม่ทราบประเภท'/);
  const editPayload = source.match(/await updateBranch\(companyId, editing\.id, \{([\s\S]*?)\}\);/)?.[1];
  assert.ok(editPayload);
  assert.match(editPayload, /name: editing\.name\.trim\(\)/);
  assert.match(editPayload, /status: editing\.status/);
  assert.doesNotMatch(editPayload, /\btype:/);
});

test('only branch managers receive create/edit controls and handlers fail closed', () => {
  assert.match(source, /permissions\.includes\('company\.branch\.manage'\)/);
  assert.match(source, /if \(!canManage \|\| busy \|\| createTaxError/);
  assert.match(source, /actions=\{canManage && <button[\s\S]*?\+ เพิ่มสาขา/);
  assert.match(source, /\{canManage && <button[^>]*aria-label=\{`แก้ไขสาขา/);
});


test('branches have one off label and archived branches can be restored without an archive choice', () => {
  assert.match(source, /ARCHIVED: 'ปิดใช้งาน'/);
  assert.match(source, /value=\{editing.status === 'ACTIVE' \? 'ACTIVE' : 'DISABLED'\}/);
  assert.match(source, /<option value="ACTIVE">\{STATUS_LABELS.ACTIVE\}<\/option>/);
  assert.match(source, /<option value="DISABLED">\{STATUS_LABELS.DISABLED\}<\/option>/);
  assert.doesNotMatch(source, /เก็บถาวร|value="ARCHIVED"/);
});

test('branch off explains retained records and the toast names the state transition', () => {
  assert.match(source, /ปิดใช้งานแล้วจะเพิ่มรายการในสาขานี้ไม่ได้ รายการเดิมยังอยู่/);
  assert.match(source, /statusChanged \? editing.status === 'ACTIVE' \? 'เปิดใช้งาน' : 'ปิดใช้งาน' : 'บันทึก'/);
  assert.match(source, /toast.success\(`\$\{action\}สาขา \$\{name\} แล้ว`\)/);
});

test('payer question is only for multiple active branches and legal-identity editors answer', () => {
  assert.match(source, /branches.filter\(branch => branch.status === 'ACTIVE'\).length > 1 && <WhtPayerModeSettings/);
  assert.match(source, /canAnswer=\{permissions.includes\('company.legal_identity.manage'\)\}/);
  assert.match(source, /branch-tax-code.*focus/);
  assert.match(source, /กลับไปภาษีหัก ณ ที่จ่าย/);
  assert.match(source, /ใช้รหัส 5 หลักนี้ยื่นแบบภาษีหัก ณ ที่จ่ายในนามสาขาที่จ่าย/);
});

test('view-only branch page renders facts and no add, edit or save controls', () => {
  const React = require('react');
  (globalThis as any).React = React;
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ToastContext } = require('@/common/components/toast/use-toast');
  const priorSvg = require.extensions['.svg'];
  require.extensions['.svg'] = (module) => { module.exports = () => null; };
  const Page = require('./BranchSettingsPage').default;
  if (priorSvg) require.extensions['.svg'] = priorSvg; else delete require.extensions['.svg'];
  const original = React.useState;
  let seeded = false;
  React.useState = (initial: unknown) => {
    if (Array.isArray(initial) && !seeded) {
      seeded = true;
      return [[{ id: 'branch', name: 'สำนักงานใหญ่', code: 'HO', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: '00000' }], () => {}];
    }
    return original(initial === true ? false : initial);
  };
  try {
    const html = renderToStaticMarkup(React.createElement(ToastContext.Provider, { value: { success() {}, warning() {}, error() {} } },
      React.createElement(Page, { companyId: 'shop', permissions: ['company.setup.read', 'company.branch.read', 'document.sequence.read'] })));
    assert.match(html, /สำนักงานใหญ่/);
    assert.match(html, /00000/);
    assert.doesNotMatch(html, /<button|<input|<textarea|<select/);
    assert.doesNotMatch(html, /เพิ่มสาขา|แก้ไขสาขา|>บันทึก</);
  } finally { React.useState = original; }
});
