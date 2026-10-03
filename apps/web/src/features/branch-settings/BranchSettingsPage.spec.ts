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
