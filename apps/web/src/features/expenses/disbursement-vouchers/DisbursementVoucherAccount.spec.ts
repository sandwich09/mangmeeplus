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
import { emptyDisbursementAccount } from './disbursement-voucher-account.logic';
const h = React.createElement;
const header = { id: 'doc', payeeBankName: 'กสิกรไทย', payeeAccountName: 'ร้าน ก', payeeAccountLast4: '5678' };
const render = (permissions: string[], value: any = header) => renderToStaticMarkup(h(DisbursementVoucherAccount, { companyId: 'shop', header: value, permissions }));
test('document account stays masked, reveal needs approve or pay, and no account renders no row', () => {
  assert.equal(render(['expense.disbursement.pay'], { ...header, payeeAccountLast4: null }), '');
  assert.match(render([]), /กสิกรไทย ร้าน ก.*xxx-5678/);
  assert.doesNotMatch(render(['expense.disbursement.read']), /<button/);
  for (const permission of ['expense.disbursement.approve', 'expense.disbursement.pay']) assert.match(render([permission]), /ดูเลขบัญชีเต็ม/);
});
test('account fields show the saved mask, an empty replacement input, shared banks and server validation', () => {
  const value = { ...emptyDisbursementAccount, ...header };
  const html = renderToStaticMarkup(h(DisbursementVoucherAccountFields, { value, onChange: () => {} }));
  assert.match(html, /บัญชีผู้รับเงิน \(ไม่บังคับ\)/); assert.match(html, /xxx-5678/);
  assert.match(html, /placeholder="พิมพ์เลขใหม่เมื่อต้องการเปลี่ยน"/);
  assert.match(html, /inputMode="numeric"[^>]*autoComplete="off"[^>]*value=""/);
  assert.match(html, /ระบบเก็บเลขบัญชีแบบเข้ารหัส และแสดงเฉพาะ 4 ตัวท้าย/);
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
  nodes.find(node => node.tag === 'button' && node.children.includes('ลบบัญชีนี้')).onClick();
  assert.deepEqual(patches[0], { payeeAccountNumber: '001-234 5678' });
  assert.deepEqual(patches[1], { ...emptyDisbursementAccount, payeeAccountCleared: true });
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
test('account data participates in dirty guarding, stays out of persistence, and appears in both payment views', () => {
  const page = readFileSync(new URL('./DisbursementVoucherDraftPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /<DisbursementVoucherAccountFields value=\{fields\} onChange=\{changeFields\}/);
  assert.match(page, /const changeFields = [\s\S]*?changed\(\); setFields/);
  assert.match(page, /setDirty\(true\)/); assert.match(page, /!disbursementAccountError\(fields\)/);
  assert.match(page, /\.\.\.disbursementAccountBody\(fields\)/);
  const account = readFileSync(new URL('./DisbursementVoucherAccount.tsx', import.meta.url), 'utf8');
  const fields = readFileSync(new URL('./DisbursementVoucherAccountFields.tsx', import.meta.url), 'utf8');
  assert.match(fields, /BANK_OPTIONS, OTHER_BANK/);
  assert.doesNotMatch(account + fields, /localStorage|sessionStorage|console\.|toast\.|URLSearchParams|window\.location/);
  assert.match(account, /active.current = false; controller.current\?\.abort\(\)/);
  for (const file of ['DisbursementVoucherPayCard.tsx', 'DisbursementVoucherDocumentPage.tsx']) assert.match(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), /<DisbursementVoucherAccount key=/);
});
