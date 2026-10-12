import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).React = React;
const svg = require.extensions['.svg'], css = require.extensions['.css'];
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { stack: 'stack', modalFooter: 'modalFooter', approvers: 'approvers', approversScroll: 'approversScroll' }; };
const api: Record<string, any> = { ...require('./disbursement-vouchers.api') };
require.cache[require.resolve('./disbursement-vouchers.api')]!.exports = new Proxy(api, {
  get: (target, key: string) => typeof target[key] === 'function' ? (...args: any[]) => target[key](...args) : target[key],
});
const modalPath = require.resolve('@/common/components/modal'), modal = require(modalPath);
require.cache[modalPath]!.exports = { ...modal, Modal: (props: any) => React.createElement('div', {}, props.title, props.children, props.footer) };
const { DisbursementVoucherCommandDialog } = require('./DisbursementVoucherCommandDialog');
const { ToastContext } = require('@/common/components/toast/use-toast');
require.cache[modalPath]!.exports = modal;
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];

const people = [{ userId: 'a', displayName: 'คุณเอ' }, { userId: 'b', displayName: 'คุณบี' }];
const header = { id: 'doc', branchId: 'branch', status: 'PENDING_APPROVAL', version: 4, documentNumber: 'DV-1', preparedByUserId: 'preparer', requestedApproverUserId: 'a', lastReminderToUserId: 'a', lastReminderAt: '2026-10-11T17:10:00Z' };
const settle = () => new Promise(resolve => setImmediate(resolve));

function dialogHarness(patch: any = {}) {
  const runtime = require('react'), realState = runtime.useState, realRef = runtime.useRef, realEffect = runtime.useEffect, realCreate = runtime.createElement;
  const states: any[] = [], refs: any[] = [], effects: any[] = [], nodes: any[] = [], toasts: string[] = [];
  let closes = 0, reloads = 0;
  const draw = () => {
    let s = 0, r = 0, e = 0; nodes.length = 0;
    runtime.useState = (init: any) => {
      const pair = realState(init), index = s++;
      if (index >= 11) return pair;
      if (!(index in states)) states[index] = pair[0];
      return [states[index], (value: any) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    };
    runtime.useRef = (value: any) => { const ref = realRef(value), index = r++; return index < 4 ? refs[index] ?? (refs[index] = ref) : ref; };
    runtime.useEffect = (effect: any, deps: any) => {
      const index = e++;
      if (index >= 4) return realEffect(effect, deps);
      if (!effects[index] || !deps || deps.some((value: any, i: number) => value !== effects[index].deps?.[i])) {
        effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: effect() };
      }
    };
    runtime.createElement = (tag: any, props: any, ...children: any[]) => {
      if (tag === 'button' || tag === 'input') nodes.push({ tag, ...props, children });
      return realCreate(tag, props, ...children);
    };
    try {
      return renderToStaticMarkup(React.createElement(ToastContext.Provider, { value: { success: (message: string) => toasts.push(message), warning: () => {}, error: () => { throw new Error('unexpected error toast'); } } },
        React.createElement(DisbursementVoucherCommandDialog, {
          companyId: 'shop', viewerUserId: 'preparer', kind: 'remind', detail: { header, actions: { remind: true }, lastReminderToName: 'คุณเอ' },
          onClose: () => { closes++; }, onReload: async () => { reloads++; }, onDeleted: () => {}, ...patch,
        })));
    } finally { runtime.useState = realState; runtime.useRef = realRef; runtime.useEffect = realEffect; runtime.createElement = realCreate; }
  };
  return { draw, nodes, toasts, closes: () => closes, reloads: () => reloads,
    send: () => nodes.find(node => node.children.includes('ส่งเตือน')).onClick(),
    choose: (id: string) => nodes.find(node => node.tag === 'input' && node.value === id).onChange(),
    unmount: () => effects.forEach(effect => effect?.cleanup?.()) };
}

test('reminder dialog loads branch approvers, preselects the person asked and shows the last reminder', async () => {
  const list = mock.method(api, 'listDisbursementApprovers', async (company: string, branch: string) => { assert.equal(company, 'shop'); assert.equal(branch, 'branch'); return people; });
  const screen = dialogHarness();
  try {
    screen.draw(); await settle(); const html = screen.draw();
    assert.match(html, /ส่งเตือนให้ใคร/); assert.match(html, /เตือนล่าสุด: คุณเอ เมื่อ 12 ต.ค. 2569 00:10 น./);
    assert.equal(screen.nodes.find(node => node.value === 'a').checked, true);
    assert.equal(screen.nodes.find(node => node.value === 'b').checked, false);
    assert.equal(screen.nodes.find(node => node.children.includes('ส่งเตือน')).disabled, false);
    assert.equal(list.mock.callCount(), 1);
  } finally { screen.unmount(); list.mock.restore(); }
});

test('reminder dialog has no send button for zero approvers and preselects the sole eligible person', async () => {
  const list = mock.method(api, 'listDisbursementApprovers', async () => [] as any[]);
  const empty = dialogHarness();
  try {
    empty.draw(); await settle(); assert.match(empty.draw(), /ยังไม่มีผู้มีสิทธิ์อนุมัติใบของสาขานี้/);
    assert.equal(empty.nodes.some(node => node.children.includes('ส่งเตือน')), false);
    list.mock.mockImplementation(async () => [people[1]]);
    const sole = dialogHarness();
    try { sole.draw(); await settle(); sole.draw(); assert.equal(sole.nodes.find(node => node.value === 'b').checked, true); }
    finally { sole.unmount(); }
  } finally { empty.unmount(); list.mock.restore(); }
});

test('with nobody originally chosen the reminder dialog still lets the preparer choose any eligible person', async () => {
  const list = mock.method(api, 'listDisbursementApprovers', async () => people);
  const screen = dialogHarness({ detail: { header: { ...header, requestedApproverUserId: null, lastReminderAt: null }, actions: { remind: true }, lastReminderToName: null } });
  try {
    screen.draw(); await settle(); assert.doesNotMatch(screen.draw(), /เตือนล่าสุด:/);
    assert.equal(screen.nodes.filter(node => node.tag === 'input').some(node => node.checked), false);
    assert.equal(screen.nodes.find(node => node.children.includes('ส่งเตือน')).disabled, true);
    screen.choose('b'); screen.draw(); assert.equal(screen.nodes.find(node => node.children.includes('ส่งเตือน')).disabled, false);
  } finally { screen.unmount(); list.mock.restore(); }
});

test('too-soon refusal stays once in the dialog, preserves selection and permits another recipient with a new command id', async () => {
  const list = mock.method(api, 'listDisbursementApprovers', async () => people);
  const bodies: any[] = [];
  const sentence = 'เพิ่งส่งเตือน คุณเอ ไปเมื่อ 5 นาทีที่แล้ว ส่งได้อีกครั้งหลัง 01:10 น. หรือเลือกผู้อนุมัติคนอื่น';
  const remind = mock.method(api, 'remindDisbursementVoucher', async (_company: string, _id: string, body: any) => {
    bodies.push(body);
    if (body.approverUserId === 'a') throw { code: 'disbursement_reminder_cooldown', message: sentence };
    return { ...header, version: 5, lastReminderToUserId: 'b' };
  });
  const screen = dialogHarness();
  try {
    screen.draw(); await settle(); screen.draw(); screen.send(); await settle();
    const failed = screen.draw(); assert.equal(failed.split(sentence).length - 1, 1); assert.match(failed, /role="alert"/);
    assert.equal(screen.nodes.find(node => node.value === 'a').checked, true); assert.deepEqual(screen.toasts, []);
    screen.choose('b'); assert.doesNotMatch(screen.draw(), /role="alert"/); screen.send(); await settle();
    assert.equal(bodies[0].expectedVersion, 4); assert.equal(bodies[1].approverUserId, 'b');
    assert.notEqual(bodies[1].commandId, bodies[0].commandId); assert.deepEqual(screen.toasts, ['ส่งเตือน คุณบี แล้ว']);
    assert.equal(screen.closes(), 1); assert.equal(screen.reloads(), 1);
  } finally { screen.unmount(); list.mock.restore(); remind.mock.restore(); }
});

test('an unchanged lost-answer retry reuses its body and the busy guard prevents a second press', async () => {
  const list = mock.method(api, 'listDisbursementApprovers', async () => people);
  const bodies: any[] = []; let reject: (reason: any) => void = () => {};
  const remind = mock.method(api, 'remindDisbursementVoucher', (_company: string, _id: string, body: any) => {
    bodies.push(body);
    if (bodies.length === 1) return new Promise((_resolve, fail) => { reject = fail; });
    return Promise.resolve({ ...header, version: 5 });
  });
  const screen = dialogHarness();
  try {
    screen.draw(); await settle(); screen.draw(); screen.send(); screen.send(); assert.equal(bodies.length, 1);
    assert.match(screen.draw(), /aria-busy="true"/);
    reject(new Error('ส่งเตือนไม่สำเร็จ กรุณาลองอีกครั้ง')); await settle(); screen.draw(); screen.send(); await settle();
    assert.equal(bodies.length, 2); assert.deepEqual(bodies[1], bodies[0]); assert.deepEqual(screen.toasts, ['ส่งเตือน คุณเอ แล้ว']);
  } finally { screen.unmount(); list.mock.restore(); remind.mock.restore(); }
});

test('a successful reminder followed by a failed detail read retries only the read', async () => {
  const list = mock.method(api, 'listDisbursementApprovers', async () => people);
  const remind = mock.method(api, 'remindDisbursementVoucher', async () => ({ ...header, version: 5 }));
  let reads = 0;
  const screen = dialogHarness({ onReload: async () => { if (++reads === 1) throw new Error('โหลดไม่สำเร็จ กรุณาลองอีกครั้ง'); } });
  try {
    screen.draw(); await settle(); screen.draw(); screen.send(); await settle();
    assert.match(screen.draw(), /โหลดข้อมูลล่าสุด/);
    screen.nodes.find(node => node.children.includes('โหลดข้อมูลล่าสุด')).onClick(); await settle();
    assert.equal(remind.mock.callCount(), 1); assert.equal(reads, 2); assert.equal(screen.closes(), 1);
    assert.deepEqual(screen.toasts, ['ส่งเตือน คุณเอ แล้ว']);
  } finally { screen.unmount(); list.mock.restore(); remind.mock.restore(); }
});

test('reloading after a stale status refusal closes the dialog after the current document is read', async () => {
  const list = mock.method(api, 'listDisbursementApprovers', async () => people);
  const remind = mock.method(api, 'remindDisbursementVoucher', async () => { throw { code: 'disbursement_status_changed', message: 'สถานะของใบนี้เปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุด' }; });
  const screen = dialogHarness();
  try {
    screen.draw(); await settle(); screen.draw(); screen.send(); await settle();
    const stale = screen.draw(); assert.match(stale, /สถานะของใบนี้เปลี่ยนไปแล้ว/); assert.match(stale, /โหลดข้อมูลล่าสุด/);
    screen.nodes.find(node => node.children.includes('โหลดข้อมูลล่าสุด')).onClick(); await settle();
    assert.equal(screen.reloads(), 1); assert.equal(screen.closes(), 1); assert.equal(remind.mock.callCount(), 1);
  } finally { screen.unmount(); list.mock.restore(); remind.mock.restore(); }
});

test('a long list of approvers gets a name search and a scrolling list; the chosen person stays in view', async () => {
  const many = Array.from({ length: 8 }, (_, index) => ({ userId: `p${index}`, displayName: index < 2 ? `สมชาย ${index}` : `วิชัย ${index}` }));
  const list = mock.method(api, 'listDisbursementApprovers', async () => many);
  const screen = dialogHarness({ kind: 'submit', detail: { header: { ...header, status: 'DRAFT', requestedApproverUserId: 'p5' }, revisions: [], actions: { submit: true } } });
  try {
    screen.draw(); await settle(); const html = screen.draw();
    assert.match(html, /ค้นชื่อ/); assert.match(html, /approversScroll/);
    const radios = () => screen.nodes.filter(node => node.tag === 'input' && node.type === 'radio');
    assert.equal(radios().length, 8); assert.equal(radios().find(node => node.value === 'p5').checked, true);
    screen.nodes.find(node => node.tag === 'input' && node.type === 'search').onChange({ target: { value: 'สมชาย' } }); screen.draw();
    assert.deepEqual(radios().map(node => node.value), ['p0', 'p1', 'p5']);
    screen.nodes.find(node => node.tag === 'input' && node.type === 'search').onChange({ target: { value: 'ไม่มี' } });
    assert.deepEqual((screen.draw(), radios().map(node => node.value)), ['p5']);
  } finally { screen.unmount(); list.mock.restore(); }
  const few = mock.method(api, 'listDisbursementApprovers', async () => many.slice(0, 6));
  const short = dialogHarness({ kind: 'submit', detail: { header: { ...header, status: 'DRAFT' }, revisions: [], actions: { submit: true } } });
  try { short.draw(); await settle(); const html = short.draw(); assert.doesNotMatch(html, /ค้นชื่อ/); assert.doesNotMatch(html, /approversScroll/); }
  finally { short.unmount(); few.mock.restore(); }
});

test('a sent-back draft preselects the approver requested on its earlier submission', async () => {
  const list = mock.method(api, 'listDisbursementApprovers', async () => people);
  const screen = dialogHarness({ kind: 'submit', detail: { header: { ...header, status: 'DRAFT', revision: 1 }, actions: { submit: true } } });
  try {
    screen.draw(); await settle(); const html = screen.draw();
    assert.equal(screen.nodes.find(node => node.value === 'a').checked, true);
    assert.match(html, /ผู้ที่เลือกจะได้รับแจ้งเตือน ผู้มีสิทธิ์อนุมัติคนอื่นก็อนุมัติได้เช่นกัน/);
  } finally { screen.unmount(); list.mock.restore(); }
});

test('send-to-other chooser excludes the current sender and uses the existing empty sentence when only that sender may approve', async () => {
  const sender = { userId: 'preparer', displayName: 'ชื่อผู้ส่ง' };
  const list = mock.method(api, 'listDisbursementApprovers', async () => [sender, people[0], people[1]]);
  const draft = { header: { ...header, status: 'DRAFT', requestedApproverUserId: 'preparer' }, revisions: [], actions: { submit: true, submitAndApprove: true } };
  const screen = dialogHarness({ kind: 'submit', detail: draft });
  try {
    screen.draw(); await settle(); const html = screen.draw();
    assert.doesNotMatch(html, /ชื่อผู้ส่ง/);
    assert.deepEqual(screen.nodes.filter(node => node.tag === 'input').map(node => node.value), ['a', 'b']);
    assert.equal(screen.nodes.filter(node => node.tag === 'input').some(node => node.checked), false);
    list.mock.mockImplementation(async () => [sender]);
    const empty = dialogHarness({ kind: 'submit', detail: draft });
    try {
      empty.draw(); await settle(); const text = empty.draw();
      assert.match(text, /ยังไม่มีผู้มีสิทธิ์อนุมัติใบของสาขานี้/);
      assert.equal(empty.nodes.some(node => node.children.includes('ส่งอนุมัติ')), false);
      assert.equal(empty.nodes.filter(node => node.tag === 'input').length, 0);
    } finally { empty.unmount(); }
  } finally { screen.unmount(); list.mock.restore(); }
});

test('approval opens as a question, closing sends none, and confirming twice sends exactly one request', async () => {
  let finish!: (value: any) => void, successfulCloses = 0;
  const approve = mock.method(api, 'approveDisbursementVoucher', (_company: string, _id: string, body: any) => {
    assert.equal(body.expectedVersion, 4); assert.ok(body.commandId);
    return new Promise(yes => { finish = yes; });
  });
  const patch = { kind: 'approve', detail: { header: { ...header, totalAmount: '4850.00', payeeName: 'ร้านศิริพร' }, actions: { approve: true } }, onSuccess: () => { successfulCloses++; } };
  const closed = dialogHarness(patch), confirmed = dialogHarness(patch);
  try {
    const text = closed.draw(); await settle();
    assert.match(text, /อนุมัติจ่าย ฿4,850.00 ให้ ร้านศิริพร ใช่ไหม/);
    assert.equal(approve.mock.callCount(), 0);
    closed.nodes.find(node => node.children.includes('ปิด')).onClick();
    assert.equal(closed.closes(), 1); assert.equal(approve.mock.callCount(), 0); assert.equal(successfulCloses, 0);
    confirmed.draw(); await settle(); confirmed.draw();
    assert.equal(confirmed.nodes.find(node => node.children.includes('อนุมัติ')).disabled, true);
    assert.equal(confirmed.nodes.find(node => node.children.includes('ปิด')).disabled, false);
    await new Promise(resolve => setTimeout(resolve, 610)); confirmed.draw();
    const press = confirmed.nodes.find(node => node.children.includes('อนุมัติ')).onClick;
    press(); press(); assert.equal(approve.mock.callCount(), 1);
    assert.match(confirmed.draw(), /aria-busy="true"/);
    finish({ ...header, status: 'APPROVED' }); await settle();
    assert.equal(confirmed.reloads(), 1); assert.equal(confirmed.closes(), 1); assert.equal(successfulCloses, 1);
  } finally { closed.unmount(); confirmed.unmount(); approve.mock.restore(); }
});
