import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BillingCollectionOperation, BillingStatus } from '@watchdog-bms/contracts';
import { createBillingPreview } from './billing-preview.fixture';
import { formatThaiDate } from '@/common/i18n/thai-date';
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const BillingCollectionPanel = require('./BillingCollectionPanel').default;
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
(globalThis as any).React = React;
const runtime = require('react') as typeof React;
const words = (node: any): string => Array.isArray(node) ? node.map(words).join('') : React.isValidElement(node) ? words((node.props as any).children) : node == null || typeof node === 'boolean' ? '' : String(node);

for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW'] as const) test(`D4 ${mode}: close only withdraws preview; observed stop preserves paid facts`, async () => {
  const api = createBillingPreview('shop', 'start', null, () => {});
  const status: BillingStatus = { ...await api.status(), renewalMode: mode, renewalInvoiceUrl: mode === 'PROMPTPAY_RENEW' ? 'https://invoice.stripe.com/test' : null, subscriptionState: mode === 'PROMPTPAY_RENEW' ? 'past_due' : 'active', allowedActions: ['portal_cancel_subscription'], termEndsAt: '2026-11-14T00:00:00.000Z', paidThrough: '2026-11-14T00:00:00.000Z' };
  const before = JSON.stringify(status);
  let submitted = 0, withdrawn = 0;
  const preview: BillingCollectionOperation = { id: 'stop', companyId: 'shop', action: 'CANCEL_RENEWAL', state: 'PREVIEW', version: 1, previewHash: 'hash', effectiveAt: status.paidThrough!, nextRenewalTotalSatang: 24900, expiresAt: '2026-11-01T00:00:00.000Z', observedAt: null, errorCode: null, allowedActions: ['submit', 'withdraw'] };
  api.collectionPreview = async () => ({ ...preview });
  api.collectionWithdraw = async op => { withdrawn++; return { ...op, state: 'CANCELLED', allowedActions: [] }; };
  api.collectionSubmit = async op => { submitted++; return { ...op, state: 'QUEUED', allowedActions: ['withdraw'] }; };
  api.collection = async () => ({ ...preview, state: 'SUCCEEDED', observedAt: '2026-10-14T00:00:00.000Z', allowedActions: [] });
  const originalState = runtime.useState, originalCreate = runtime.createElement;
  const states: any[] = []; let cursor = 0, buttons: { name: string; props: any }[] = [];
  Reflect.set(runtime, 'useState', (initial: any) => { const index = cursor++; const [value] = (originalState as any)(initial); if (!(index in states)) states[index] = value; return [states[index], (next: any) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => { if (type === 'button') buttons.push({ name: words(children), props }); return (originalCreate as any)(type, props, ...children); });
  const render = () => { cursor = 0; buttons = []; return renderToStaticMarkup(React.createElement(BillingCollectionPanel, { companyId: 'shop', status, apiOverride: api, onChange: () => {} })); };
  const press = async (name: string) => { const button = buttons.find(b => b.name === name); assert.ok(button, name); button.props.onClick(); await new Promise(resolve => setImmediate(resolve)); return render(); };
  try {
    render(); const entry = 'หยุดต่ออายุอัตโนมัติ';
    const html = await press(entry);
    assert.match(html, new RegExp(mode === 'CARD_AUTO' ? 'หยุดต่ออายุอัตโนมัติ\\?' : 'หยุดออกบิลพร้อมเพย์ทุกงวด\\?'));
    assert.ok(html.replace(/<[^>]+>/g, '').includes(`ใช้แพ็กเกจที่จ่ายไว้ได้ถึง ${formatThaiDate(status.paidThrough!)} การหยุดต่ออายุไม่คืนเงิน`));
    assert.ok(buttons.findIndex(b => b.name === 'ปิด') < buttons.findIndex(b => b.name === (mode === 'CARD_AUTO' ? 'หยุดต่ออายุ' : 'หยุดออกบิล')));
    const closed = await press('ปิด');
    assert.doesNotMatch(closed, /ถอนคำขอ|ไม่คืนเงิน|หยุดต่ออายุอัตโนมัติ\?|หยุดออกบิลพร้อมเพย์ทุกงวด\?/);
    assert.equal(withdrawn, 1); assert.equal(submitted, 0); assert.equal(JSON.stringify(status), before);
    await press(entry); const queued = await press(mode === 'CARD_AUTO' ? 'หยุดต่ออายุ' : 'หยุดออกบิล');
    assert.match(queued, new RegExp(mode === 'CARD_AUTO' ? 'กำลังตรวจผลการหยุดต่ออายุ' : 'กำลังตรวจผลการหยุดออกบิล')); assert.doesNotMatch(queued, />ปิด<|>หยุดต่ออายุแล้ว</); assert.match(queued, /ถอนคำขอหยุด/); assert.doesNotMatch(queued, /หยุดต่ออายุแล้ว/);
    status.cancelAtPeriodEnd = true;
    const done = await press(mode === 'CARD_AUTO' ? 'ตรวจผลการต่ออายุ' : 'ตรวจผลการออกบิล');
    status.cancelAtPeriodEnd = false;
    assert.equal((done.match(new RegExp(mode === 'CARD_AUTO' ? 'หยุดต่ออายุแล้ว' : 'หยุดออกบิลแล้ว', 'g')) ?? []).length, 1);
    assert.doesNotMatch(done, /ปิดการต่ออายุอัตโนมัติแล้ว|ปิดการออกบิล QR ทุกงวดแล้ว|ไม่คืนเงิน/); assert.equal(submitted, 1); assert.equal(JSON.stringify(status), before);
    if (mode === 'PROMPTPAY_RENEW') { assert.match(done, /บิลที่ออกแล้วเปิดจ่ายได้ที่ เปิดบิลพร้อมเพย์/); assert.match(done, /ยอดค้างเดิมยังต้องตรวจแยกกับทีมงาน การหยุดต่ออายุไม่ใช่การยกเว้นหนี้/); }
    states[0] = { ...preview, action: 'RESUME_RENEWAL', state: 'UNKNOWN', allowedActions: ['refresh'] };
    assert.match(render(), /ยังยืนยันผลไม่ได้ เปิดรายการเดิมเพื่อตรวจสอบ/);
    states[0] = { ...preview, action: 'RESUME_RENEWAL', state: 'CANCELLED', allowedActions: [] };
    assert.match(render(), /ถอนคำขอแล้ว/);
    status.planCapacityRepair = { operationId: 'repair', version: 1, offerKey: 'STARTER_249', interval: 'month' };
    assert.match(render(), /รับเงินรอบใหม่แล้ว เลือกสาขาและผู้ใช้ก่อนเปิดแพ็กเกจใหม่/);
  } finally { Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'createElement', originalCreate); }
});

test('PAY-2 renewal state stays visible when stopping is unavailable, without offering the action', async () => {
  const api = createBillingPreview('shop', 'success', null, () => {});
  const status = { ...await api.status(), allowedActions: [] };
  const html = renderToStaticMarkup(React.createElement(BillingCollectionPanel, { companyId: 'shop', status, apiOverride: api, onChange: () => {} }));
  assert.match(html, /ต่ออายุอัตโนมัติเปิดอยู่/);
  assert.doesNotMatch(html, />หยุดต่ออายุอัตโนมัติ<|>เปิดต่ออายุอัตโนมัติ</);
});
