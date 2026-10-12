import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DisbursementVoucherAccessHint } from './DisbursementVoucherAccessHint';
(globalThis as any).React = React;
const text = 'ชุดสิทธิ์ของใบเตรียมจ่าย/ใบสำคัญจ่ายใช้ได้กับรายจ่ายที่ตำแหน่งนั้นดูได้อยู่แล้วเท่านั้น';
test('the role hint renders the exact sentence only when the session entry is open', () => {
  assert.equal(renderToStaticMarkup(React.createElement(DisbursementVoucherAccessHint, { entryOpen: false })), '');
  assert.ok(renderToStaticMarkup(React.createElement(DisbursementVoucherAccessHint, { entryOpen: true })).includes(text));
  for (const path of ['permissions', 'access-overview']) {
    const route = readFileSync(`app/(workspace)/companies/[companyId]/settings/${path}/page.tsx`, 'utf8');
    assert.match(route, /disbursementEntryOpen=\{canOpenDisbursementVoucherWeb\(session, companyId\)\}/);
  }
});
test('both role builders pass the gate, expense packs keep names, descriptions, checkboxes and their saved keys', () => {
  const matrix = readFileSync(new URL('./PermissionMatrixPrototypePage.tsx', import.meta.url), 'utf8');
  assert.equal([...matrix.matchAll(/disbursementEntryOpen=\{disbursementEntryOpen\} packModules/g)].length, 2);
  const builder = readFileSync(new URL('./EmployeeAccessPages.tsx', import.meta.url), 'utf8');
  assert.match(builder, /module === 'expense' && <DisbursementVoucherAccessHint entryOpen=\{disbursementEntryOpen\}/);
  assert.match(builder, /<label key=\{p.key\} className=\{`flex min-h-11 min-w-0/);
  assert.match(builder, /\{p.nameTh\}/); assert.match(builder, /\{p.description\}/);
  assert.match(builder, /checked=\{checked\} onChange=\{\(\) => togglePack\(p.key\)\}/);
  assert.match(builder, /capabilityPackKeys: selectedPacks/);
  const overview = readFileSync(new URL('./IndividualPermissionsPrototypePage.tsx', import.meta.url), 'utf8');
  assert.match(overview, /group === 'fin' && <DisbursementVoucherAccessHint entryOpen=\{disbursementEntryOpen\}/);
  const registry = readFileSync('../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts', 'utf8');
  const names = ['ดูใบเตรียมจ่าย/ใบสำคัญจ่าย', 'จัดทำใบเตรียมจ่าย', 'อนุมัติใบเตรียมจ่าย', 'บันทึกจ่ายตามใบเตรียมจ่าย', 'ออกใบสำคัญจ่ายจากการจ่ายตรง'];
  for (const [index, key] of ['view', 'prepare', 'approve', 'pay', 'issue'].entries()) {
    const pack = registry.slice(registry.indexOf(`key: 'pack.expense.disbursement.${key}'`)).split('\n  },')[0]!;
    assert.ok(pack.includes("module: 'expense'"));
    assert.ok(pack.includes(`nameTh: '${names[index]}'`));
    assert.match(pack, /description: '[^']+'/);
  }
});
