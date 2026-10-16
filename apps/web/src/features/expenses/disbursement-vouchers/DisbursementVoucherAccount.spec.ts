import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
(globalThis as any).React = React;
const svg = require.extensions['.svg'];
require.extensions['.svg'] = m => { m.exports = () => null; };
const api = { ...require('./disbursement-vouchers.api') };
require.cache[require.resolve('./disbursement-vouchers.api')]!.exports = api;
const { DisbursementVoucherAccount } = require('./DisbursementVoucherAccount');
const { DisbursementVoucherAccountFields } = require('./DisbursementVoucherAccountFields');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
import { certificateHarness } from '../expense-certificate-test-harness';
import { emptyDisbursementAccount, disbursementAccountBody } from './disbursement-voucher-account.logic';
const h = React.createElement;
const header = { id: 'doc', payeeBankName: 'กสิกรไทย', payeeAccountName: 'ร้าน ก', payeeAccountLast4: '5678' };
const render = (permissions: string[], value: any = header) => renderToStaticMarkup(h(DisbursementVoucherAccount, { companyId: 'shop', header: value, permissions }));
test('document account stays masked, reveal needs approve or pay, and no account renders no row', () => {
  assert.equal(render(['expense.disbursement.pay'], { ...header, payeeAccountLast4: null }), '');
  assert.match(render([]), /กสิกรไทย.*xxx-5678/);
  assert.doesNotMatch(render(['expense.disbursement.read']), /<button|ร้าน ก/);
  assert.match(render([], { ...header, payeeBankName: 'ธนาคารกสิกรไทย' }), /กสิกรไทย/);
  assert.doesNotMatch(render([], { ...header, payeeBankName: 'ธนาคารกสิกรไทย' }), /ธนาคาร/);
  for (const permission of ['expense.disbursement.approve', 'expense.disbursement.pay']) assert.match(render([permission]), /ดูเลขบัญชีเต็ม/);
});
test('account fields show the saved mask inside the number field (no line above it), shared banks and server validation', () => {
  const value = { ...emptyDisbursementAccount, ...header };
  const html = renderToStaticMarkup(h(DisbursementVoucherAccountFields, { value, onChange: () => {} }));
  assert.match(html, /บัญชีผู้รับเงิน \(ถ้ามี\)/); assert.match(html, /xxx-5678/);
  assert.match(html, /placeholder="พิมพ์เลขใหม่เมื่อต้องการเปลี่ยน"/);
  assert.match(html, /inputMode="numeric"[^>]*autoComplete="off"[^>]*value="xxx-5678"/);
  assert.equal(html.match(/xxx-5678/g)?.length, 1); // one place: inside the field
  assert.match(html, /เก็บแบบเข้ารหัส แสดง 4 ตัวท้าย/);
  const invalid = renderToStaticMarkup(h(DisbursementVoucherAccountFields, { value: { ...value, payeeAccountNumber: '123' }, onChange: () => {} }));
  assert.match(invalid, /เลขบัญชีผู้รับเงินต้องเป็นตัวเลข 6 ถึง 20 หลัก/);
});
test('remove clears all account fields and number typing preserves spaces and dashes for local checks', () => {
  const runtime = require('react'), realCreate = runtime.createElement;
  const nodes: any[] = [], patches: any[] = [];
  runtime.createElement = (tag: any, props: any, ...children: any[]) => { if (tag === 'button' || tag === 'input') nodes.push({ tag, ...props, children }); return realCreate(tag, props, ...children); };
  try { renderToStaticMarkup(h(DisbursementVoucherAccountFields, { value: { ...emptyDisbursementAccount, ...header }, onChange: (patch: any) => patches.push(patch) })); }
  finally { runtime.createElement = realCreate; }
  nodes.find(node => node.tag === 'input' && node.inputMode === 'numeric').onChange({ target: { value: '001-234 5678' } });
  nodes.find(node => node.tag === 'button' && node.children.includes('ล้างบัญชี')).onClick();
  assert.deepEqual(patches[0], { payeeAccountNumber: '001-234 5678' });
  assert.deepEqual(patches[1], { ...emptyDisbursementAccount, payeeAccountFromVoucherId: undefined, payeeAccountCleared: true });
});
test('reveal calls the API on every showing, hide drops the number, and leaving aborts and rejects late answers', async () => {
  const runtime = require('react');
  const realState = runtime.useState, realRef = runtime.useRef, realEffect = runtime.useEffect, realCreate = runtime.createElement;
  let states: any[] = [null, false, null], refs: any[] = [{ current: null }, { current: true }];
  let cleanup: () => void = () => {};
  const nodes: any[] = [], requests: { company: string; id: string; signal: AbortSignal }[] = [];
  let late: ((value: any) => void) | null = null;
  const post = mock.method(api, 'revealDisbursementVoucherAccount', async (company: string, id: string, signal: AbortSignal) => {
    requests.push({ company, id, signal });
    return requests.length < 3 ? { accountNumber: '0012345678' } : new Promise(resolve => { late = resolve; });
  });
  const draw = () => {
    let i = 0, r = 0; nodes.length = 0;
    runtime.useState = (init: any) => { const pair = realState(init), index = i++; return index < 3 ? [states[index], (value: any) => { states[index] = value; }] : pair; };
    runtime.useRef = (value: any) => { const real = realRef(value), index = r++; return index < 2 ? refs[index] : real; };
    runtime.useEffect = (effect: any) => { cleanup = effect(); };
    runtime.createElement = (tag: any, props: any, ...children: any[]) => { if (tag === 'button') nodes.push({ ...props, children }); return realCreate(tag, props, ...children); };
    try { return render(['expense.disbursement.approve']); }
    finally { runtime.useState = realState; runtime.useRef = realRef; runtime.useEffect = realEffect; runtime.createElement = realCreate; }
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.doesNotMatch(draw(), /0012 3456 78/);
      nodes[0].onClick(); await new Promise(resolve => setImmediate(resolve));
      assert.match(draw(), /0012 3456 78/); assert.match(draw(), />ซ่อน<\/button>/);
      nodes[0].onClick(); assert.doesNotMatch(draw(), /0012 3456 78/);
    }
    assert.equal(requests.length, 2);
    nodes[0].onClick(); const pending = draw(); assert.match(pending, /aria-busy="true"/);
    cleanup(); assert.equal(requests[2]!.signal.aborted, true);
    (late as unknown as (value: any) => void)({ accountNumber: '9999999999' }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(states[0], null);
    states = [null, false, null]; refs = [{ current: null }, { current: true }];
    assert.doesNotMatch(draw(), /9999 9999 99|0012 3456 78/);
  } finally { post.mock.restore(); }
});
test('account data participates in dirty guarding, stays out of persistence, and appears in the expanded pay block and otherwise in the compact facts', () => {
  const page = readFileSync(new URL('./DisbursementVoucherDraftPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /<DisbursementVoucherAccountFields[^>]*value=\{fields\} onChange=\{changeFields\}/);
  assert.match(page, /const changeFields = [\s\S]*?changed\(\); setFields/);
  assert.match(page, /setDirty\(true\)/); assert.match(page, /!disbursementAccountError\(fields\)/);
  assert.match(page, /\.\.\.disbursementAccountBody\(fields\)/);
  const account = readFileSync(new URL('./DisbursementVoucherAccount.tsx', import.meta.url), 'utf8');
  const fields = readFileSync(new URL('./DisbursementVoucherAccountFields.tsx', import.meta.url), 'utf8');
  assert.match(fields, /BANK_OPTIONS, OTHER_BANK/);
  assert.doesNotMatch(account + fields, /localStorage|sessionStorage|console\.|toast\.|URLSearchParams|window\.location/);
  assert.match(account, /active.current = false; controller.current\?\.abort\(\)/);
  assert.match(readFileSync(new URL('./DisbursementVoucherDocumentPage.tsx', import.meta.url), 'utf8'), /<DisbursementVoucherAccount key=/);
  assert.match(readFileSync(new URL('./DisbursementVoucherPayCard.tsx', import.meta.url), 'utf8'), /<DisbursementVoucherAccount[^>]*permissions=\{permissions\} expanded/);
  assert.match(readFileSync(new URL('./DisbursementVoucherDocumentPage.tsx', import.meta.url), 'utf8'), /header.payeeAccountLast4 && !canPay/);
});

test('prefilled account shows filled bank and name with only a mask and an explicit switch', () => {
  const html = renderToStaticMarkup(h(DisbursementVoucherAccountFields, { value: { ...emptyDisbursementAccount, ...header, payeeAccountFromVoucherId: 'saved' }, onChange: () => {} }));
  assert.match(html, /value="กสิกรไทย"/); assert.match(html, /value="ร้าน ก"/);
  assert.match(html, /xxx-5678/); assert.match(html, /ใช้บัญชีอื่น/);
  assert.doesNotMatch(html, /inputMode="numeric"/);
});

test('expanded approved account names the recipient, bank, account holder and masked number without editable inputs', () => {
  const html = renderToStaticMarkup(h(DisbursementVoucherAccount, { companyId: 'shop', header: { ...header, payeeName: 'ผู้รับ ก' }, permissions: ['expense.disbursement.pay'], expanded: true }));
  for (const fact of ['โอนเข้าบัญชี', 'ผู้รับเงิน', 'ผู้รับ ก', 'ธนาคาร', 'กสิกรไทย', 'ชื่อบัญชี', 'ร้าน ก', 'เลขบัญชี', 'xxx-5678', 'ดูเลขบัญชีเต็ม']) assert.ok(html.includes(fact), fact);
  assert.doesNotMatch(html, /<input/);
});

test('account fields share a desktop row; other-bank name and missing-bank error belong to the bank column', () => {
  const html = renderToStaticMarkup(h(DisbursementVoucherAccountFields, { value: { ...emptyDisbursementAccount, payeeBankName: 'ธนาคารตัวอย่าง', payeeAccountNumber: '123456' }, onChange() {} }));
  assert.match(html, /lg:grid-cols-3/); assert.match(html, /ชื่อธนาคาร/);
  assert.ok(html.indexOf('ชื่อธนาคาร') < html.indexOf('ชื่อบัญชี'));
  const missing = renderToStaticMarkup(h(DisbursementVoucherAccountFields, { value: { ...emptyDisbursementAccount, payeeAccountNumber: '123456' }, onChange() {} }));
  assert.ok(missing.indexOf('ยังไม่ได้ระบุธนาคาร') < missing.indexOf('ชื่อบัญชี'));
});

test('draft editors see the document reveal link; prepare alone cannot reveal later document states', () => {
  assert.match(render(['expense.disbursement.prepare'], { ...header, status: 'DRAFT' }), /ดูเลขบัญชีเต็ม/);
  for (const status of ['PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED']) assert.doesNotMatch(render(['expense.disbursement.prepare'], { ...header, status }), /ดูเลขบัญชีเต็ม/);
});

test('account field eye reveals and hides without dirtying; editing sends only the newly typed number', async () => {
  let value = { ...emptyDisbursementAccount, ...header };
  const patches: any[] = [];
  const post = mock.method(api, 'revealDisbursementVoucherAccount', async () => ({ accountNumber: '0012345678' }));
  const harness = certificateHarness(() => h(DisbursementVoucherAccountFields, { value, companyId: 'shop', voucherId: 'doc', permissions: ['expense.disbursement.prepare'], onChange(patch: any) { patches.push(patch); value = { ...value, ...patch }; } }));
  try {
    assert.match(harness.render(), /aria-label="ดูเลขเต็ม"/);
    harness.find('button', p => p['aria-label'] === 'ดูเลขเต็ม').onClick(); await harness.settle();
    assert.match(harness.render(), /value="0012345678"/);
    assert.equal(patches.length, 0);
    assert.equal(disbursementAccountBody(value).payeeAccountNumber, undefined);
    harness.find('button', p => p['aria-label'] === 'ซ่อนเลข').onClick();
    assert.match(harness.render(), /value="xxx-5678"/);
    harness.find('button', p => p['aria-label'] === 'ดูเลขเต็ม').onClick(); await harness.settle(); harness.render();
    harness.find('input', p => p.id === 'disbursement-account-number').onChange({ target: { value: '9988776655' } });
    assert.equal(disbursementAccountBody(value).payeeAccountNumber, '9988776655');
    assert.doesNotMatch(harness.render(), /aria-label="(?:ดูเลขเต็ม|ซ่อนเลข)"/);
  } finally { post.mock.restore(); harness.cleanup(); }
});

test('prefill eye uses source purpose and stays read-only; failure is under the field without dirtying', async () => {
  const value = { ...emptyDisbursementAccount, ...header, payeeAccountFromVoucherId: 'source' };
  let patches = 0, reads = 0;
  const post = mock.method(api, 'revealDisbursementVoucherAccount', async (...args: any[]) => {
    assert.equal(args[1], 'source'); assert.equal(args[3], 'prefill');
    if (++reads === 1) return { accountNumber: '0012345678' };
    throw new Error('อ่านเลขบัญชีไม่ได้ ลองอีกครั้ง');
  });
  const harness = certificateHarness(() => h(DisbursementVoucherAccountFields, { value, companyId: 'shop', permissions: ['expense.disbursement.prepare'], onChange() { patches++; } }));
  try {
    harness.render();
    assert.equal(harness.find('input', p => p.id === 'disbursement-account-number').readOnly, true);
    harness.find('button', p => p['aria-label'] === 'ดูเลขเต็ม').onClick(); await harness.settle();
    assert.match(harness.render(), /readOnly=""[^>]*value="0012345678"/);
    harness.find('button', p => p['aria-label'] === 'ซ่อนเลข').onClick();
    assert.match(harness.render(), /value="xxx-5678"/);
    harness.find('button', p => p['aria-label'] === 'ดูเลขเต็ม').onClick(); await harness.settle();
    const html = harness.render();
    assert.match(html, /disbursement-account-number-error/);
    assert.ok(html.indexOf('id="disbursement-account-number-error"') > html.indexOf('<input id="disbursement-account-number"'));
    assert.equal(patches, 0);
    const hidden = renderToStaticMarkup(h(DisbursementVoucherAccountFields, { value, companyId: 'shop', permissions: [], onChange() {} }));
    assert.doesNotMatch(hidden, /aria-label="ดูเลขเต็ม"/);
  } finally { post.mock.restore(); harness.cleanup(); }
});
