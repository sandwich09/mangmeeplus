import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CapabilityPackView } from '@watchdog-bms/contracts';

(globalThis as any).React = React;
const priorSvg = require.extensions['.svg'];
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const { RoleBuilder } = require('./EmployeeAccessPages');
if (priorSvg) require.extensions['.svg'] = priorSvg;
else delete require.extensions['.svg'];
const runtime = require('react') as typeof React;
const packs = [
  { key: 'pack.company.settings.view', nameTh: 'ดูตั้งค่าร้าน', permissionKeys: ['company.setup.read'] },
  { key: 'pack.company.settings.manage', nameTh: 'จัดการตั้งค่าร้าน', permissionKeys: ['company.setup.manage'] },
].map(p => ({ ...p, module: 'company', nameEn: p.nameTh, description: '', riskLevel: 'LOW', locked: false, grantableByCurrentUser: true, isCore: false })) as CapabilityPackView[];

test('manage selects view, prevents unchecking it with a reason, and saves both choices', async () => {
  const originalState = runtime.useState, originalCreate = runtime.createElement;
  const states: any[] = [];
  let cursor = 0;
  let checks: any[] = [];
  let submit: any;
  let saved: any;
  Reflect.set(runtime, 'useState', (initial: any) => {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], (next: any) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'input' && props?.type === 'checkbox') checks.push(props);
    if (type === 'form') submit = props.onSubmit;
    return (originalCreate as any)(type, props, ...children);
  });
  const render = () => {
    cursor = 0; checks = [];
    return renderToStaticMarkup(React.createElement(RoleBuilder, { companyId: 'shop', allPacks: packs,
      packModules: [{ module: 'company', packs }], templates: [], roleOptionsAvailable: true,
      initial: { name: 'ผู้ดูแลตั้งค่า', permissionKeys: [] }, onCancel() {}, onSubmit: async (body: any) => { saved = body; } }));
  };
  try {
    render();
    assert.equal(checks[0].checked, false);
    checks[1].onChange();
    const html = render();
    assert.equal(checks[0].checked, true);
    assert.equal(checks[0].disabled, true);
    assert.match(html, /ต้องดูตั้งค่าร้านได้ก่อน จึงจะจัดการตั้งค่าร้านได้/);
    checks[0].onChange(); render();
    assert.equal(checks[0].checked, true, 'handler also preserves the required view');
    await submit({ preventDefault() {} });
    assert.deepEqual(saved.capabilityPackKeys.sort(), packs.map(p => p.key).sort());
    checks[1].onChange(); render();
    assert.equal(checks[0].checked, true);
    assert.equal(checks[0].disabled, false);
    checks[0].onChange(); render();
    assert.equal(checks[0].checked, false);
  } finally {
    Reflect.set(runtime, 'useState', originalState);
    Reflect.set(runtime, 'createElement', originalCreate);
  }
});

for (const canGrantView of [true, false]) test(`an existing manage-only role opens with view checked and locked (explicit view grant: ${canGrantView})`, () => {
  const choices = packs.map(p => p.key === 'pack.company.settings.view' ? { ...p, grantableByCurrentUser: canGrantView } : p);
  const html = renderToStaticMarkup(React.createElement(RoleBuilder, { companyId: 'shop', allPacks: choices,
    packModules: [{ module: 'company', packs: choices }], templates: [], roleOptionsAvailable: true,
    initial: { name: 'ผู้ดูแลตั้งค่าเดิม', permissionKeys: ['company.setup.manage'] }, onCancel() {}, onSubmit: async () => {} }));
  const inputs = html.match(/<input[^>]*type="checkbox"[^>]*>/g)!;
  assert.equal(inputs.length, 2);
  assert.match(inputs[0]!, /checked=""/);
  assert.match(inputs[0]!, /disabled=""/);
  assert.match(inputs[1]!, /checked=""/);
});


test('UAT-R2 each role-editor checkbox has its visible permission name rather than on', () => {
  const html = renderToStaticMarkup(React.createElement(RoleBuilder, { companyId: 'shop', allPacks: packs,
    packModules: [{ module: 'company', packs }], templates: [], roleOptionsAvailable: true,
    onCancel() {}, onSubmit: async () => {} }));
  const inputs = html.match(/<input[^>]*type="checkbox"[^>]*>/g)!;
  assert.equal(inputs.length, packs.length);
  inputs.forEach((input, index) => assert.ok(input.includes(`aria-label="${packs[index]!.nameTh}"`), input));
});

test('UAT-R2 role × summary text never treats incomplete work packs as having only baseline rights', () => {
  const { RoleCanDoList } = require('./EmployeeAccessPages');
  const { roleCanDoPacks } = require('./role-picker.logic');
  const cases = [
    { role: 'ไม่มีสิทธิ์', keys: [], expected: ['ดูสิทธิ์ที่เปิดไว้ในรายการเมนูด้านล่าง'] },
    { role: 'สิทธิ์พื้นฐาน', keys: ['dashboard.read', 'notification.read'], expected: ['ดูสิทธิ์ที่เปิดไว้ในรายการเมนูด้านล่าง'] },
    { role: 'พนักงานเดิมที่มีสิทธิ์บางข้อ', keys: ['expense.read_own', 'expense.create', 'expense.update'], expected: ['ดูสิทธิ์ที่เปิดไว้ในรายการเมนูด้านล่าง'] },
    { role: 'ดูตั้งค่าร้าน', keys: ['company.setup.read'], expected: ['ดูตั้งค่าร้าน'] },
    { role: 'จัดการตั้งค่าร้าน', keys: ['company.setup.read', 'company.setup.manage'], expected: ['ดูตั้งค่าร้าน', 'จัดการตั้งค่าร้าน'] },
  ];
  for (const row of cases) {
    const html = renderToStaticMarkup(React.createElement(RoleCanDoList, { packs: roleCanDoPacks(row.keys, packs),
      corePacks: [{ ...packs[0], isCore: true, nameTh: 'สิทธิ์บัญชีพื้นฐาน', permissionKeys: ['dashboard.read', 'notification.read'] }], permissionKeys: row.keys }));
    assert.equal(html.includes('สิทธิ์พื้นฐานที่มี: สิทธิ์บัญชีพื้นฐาน'), row.role === 'สิทธิ์พื้นฐาน', row.role);
    assert.doesNotMatch(html, /ทุกบทบาททำได้/, row.role);
    row.expected.forEach(text => assert.ok(html.includes(text), row.role));
    assert.doesNotMatch(html, /ทำได้เฉพาะสิ่งที่ทุกบทบาททำได้/, row.role);
  }
});
