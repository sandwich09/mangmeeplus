import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
(globalThis as any).React = React;
const svg = require.extensions['.svg'], css = require.extensions['.css'];
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { stack: 'stack', modalFooter: 'modalFooter' }; };
const api = { ...require('./disbursement-vouchers.api') };
require.cache[require.resolve('./disbursement-vouchers.api')]!.exports = api;
const modalPath = require.resolve('@/common/components/modal');
const modal = require(modalPath);
require.cache[modalPath]!.exports = { ...modal, Modal: (props: any) => props.open ? React.createElement('div', {}, props.title, props.children, props.footer) : null };
const { DisbursementVoucherSlip } = require('./DisbursementVoucherSlip');
require.cache[modalPath]!.exports = modal;
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
const h = React.createElement;
const slip = { attachmentId: 'private', attachedByName: 'คุณเอ', attachedAt: '2026-10-11T17:30:00Z' };
const render = (patch: any = {}) => renderToStaticMarkup(h(DisbursementVoucherSlip, { companyId: 'shop', id: 'doc', slip: null, canAttach: false, ...patch }));
test('paid slip rendering follows the server right: view only, attach, replace, or nothing', () => {
  assert.match(render(), /หลักฐานการจ่าย · ยังไม่ได้แนบ/);
  assert.doesNotMatch(render(), /<h3/);
  assert.doesNotMatch(render(), /<button/);
  assert.match(render({ canAttach: true }), /แนบหลักฐาน/);
  const reader = render({ slip });
  assert.match(reader, /หลักฐานการจ่าย: แนบโดย คุณเอ เมื่อ/); assert.match(reader, /ดูไฟล์/); assert.doesNotMatch(reader, />เปลี่ยน<|type="file"/);
  // Beside the statement "หลักฐานการจ่าย: แนบโดย …" the button is the short word: the long name wrapped inside half a phone row.
  assert.match(render({ slip, canAttach: true }), />เปลี่ยน<\/button>/);
});
test('approved form shows a pre-attached slip with its author and a view button', () => {
  const html = render({ slip, canAttach: true, paymentForm: true });
  assert.match(html, /แนบหลักฐานการจ่าย \(ถ้ามี\)/); assert.match(html, /หลักฐานการจ่าย: แนบโดย คุณเอ เมื่อ/); assert.match(html, /ดูไฟล์/);
});
test('upload failures retain the chosen file, show retry and allow payment without the slip', () => {
  const source = readFileSync(new URL('./DisbursementVoucherSlip.tsx', import.meta.url), 'utf8');
  assert.match(source, /uploadDisbursementVoucherSlip/); assert.match(source, /word\('slip_without'\)/);
  assert.match(source, /onBusy\?\.\(false\)/); assert.match(source, /word\('slip_retry'\)/);
  assert.match(source, /setFile\(next\)/); assert.doesNotMatch(source, /toast.error|localStorage|sessionStorage/);
});
test('replacement requires confirmation, keeps refusals inside and uses the shared preview and picker', () => {
  const source = readFileSync(new URL('./DisbursementVoucherSlip.tsx', import.meta.url), 'utf8');
  assert.match(source, /setConfirmOpen\(true\)/); assert.match(source, /closeOnBackdrop=\{false\}/);
  assert.match(source, /word\('slip_replace_confirm'\)/);
  // The footer is the two plain buttons (the shared dialog sizes and orders them); the safe one says what it keeps.
  assert.match(source, /footer=\{<>\s+<button[^\n]*word\('slip_keep'\)[^\n]*\n\s+<button[^\n]*word\('slip_replace'\)/); assert.doesNotMatch(source, /ไม่ออก|styles.modalFooter/);
  assert.match(source, /<ThemedFile/); assert.match(source, /ATTACHMENT_UPLOAD_ACCEPT/); assert.match(source, /<DocumentPreviewModal/);
  assert.match(source, /URL.revokeObjectURL/); assert.match(source, /attachDisbursementVoucherSlip/);
});
test('pay waits only during upload, carries the optional id and shows slip refusals beside the field once', () => {
  const source = readFileSync(new URL('./DisbursementVoucherPayCard.tsx', import.meta.url), 'utf8');
  assert.match(source, /<DisbursementVoucherSlip/); assert.match(source, /slipUploading/);
  assert.match(source, /onChange=\{slipAttachmentId => change\(\{ slipAttachmentId \}\)\}/);
  assert.match(source, /refusal=\{slipError \? error : null\}/); assert.match(source, /error !== null && !dateError && !slipError/);
  assert.ok(source.indexOf('<DisbursementVoucherSlip') < source.indexOf('<FormActionBar>'));
});

function slipHarness(patch: any = {}) {
  const runtime = require('react');
  const realState = runtime.useState, realRef = runtime.useRef, realCreate = runtime.createElement, realEffect = runtime.useEffect;
  let cleanup: () => void = () => {};
  let localCleanup: (() => void) | undefined, previousFile: File | null | undefined;
  const states: any[] = [patch.slip ?? null, null, null, false, null, false, null, null];
  const refs: any[] = [{ current: { click: () => { picked++; } } }, { current: false }, { current: 0 }, { current: null }];
  let picked = 0;
  const nodes: any[] = [];
  const draw = () => {
    let i = 0, r = 0, e = 0; nodes.length = 0;
    runtime.useEffect = (effect: any, dependencies: any) => { const index = e++; if (index === 0) cleanup = effect(); else if (index === 2 && dependencies[0] !== previousFile) { localCleanup?.(); previousFile = dependencies[0]; localCleanup = effect(); } else realEffect(effect, dependencies); };
    runtime.useState = (init: any) => { const pair = realState(init), index = i++; return index < 8 ? [states[index], (value: any) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }] : pair; };
    runtime.useRef = (value: any) => { const ref = realRef(value), index = r++; return index < 4 ? refs[index] : ref; };
    runtime.createElement = (tag: any, props: any, ...children: any[]) => { if (tag === 'button' || tag?.name === 'ThemedFile' || tag?.name === 'DocumentPreviewModal') nodes.push({ tag, ...props, children }); return realCreate(tag, props, ...children); };
    try { return render(patch); }
    finally { runtime.useState = realState; runtime.useRef = realRef; runtime.createElement = realCreate; runtime.useEffect = realEffect; }
  };
  return { draw, nodes, states, refs, cleanup: () => { cleanup(); localCleanup?.(); }, picked: () => picked };
}
const pickedFile = () => new File(['image'], 'สลิป.jpg', { type: 'image/jpeg' });
test('failed upload keeps the file and releases pay immediately; retry uploads it and returns the id', async () => {
  const changes: any[] = [], progress: boolean[] = [];
  let attempts = 0;
  const upload = mock.method(api, 'uploadDisbursementVoucherSlip', async (_company: string, _id: string, chosen: File) => {
    assert.equal(chosen.name, 'สลิป.jpg'); attempts++;
    if (attempts === 1) throw new Error('อัปโหลดไม่สำเร็จ กรุณาลองอีกครั้ง');
    return 'uploaded';
  });
  const screen = slipHarness({ canAttach: true, paymentForm: true, onChange: (id: any) => changes.push(id), onBusy: (busy: boolean) => progress.push(busy) });
  try {
    screen.draw(); const picker = screen.nodes.find(node => node.tag?.name === 'ThemedFile');
    picker.onChange(pickedFile()); await new Promise(resolve => setImmediate(resolve));
    const failed = screen.draw(); assert.match(failed, /สลิป.jpg/); assert.match(failed, /บันทึกจ่ายก่อนได้ แล้วแนบหลักฐานการจ่ายภายหลัง/);
    assert.deepEqual(progress, [true, false]); assert.deepEqual(changes, [undefined]);
    screen.nodes.find(node => node.children.includes('ลองอีกครั้ง')).onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.doesNotMatch(screen.draw(), /role="alert"/); assert.equal(changes.at(-1), 'uploaded');
    screen.nodes.find(node => node.tag?.name === 'ThemedFile').onChange(null);
    assert.equal(changes.at(-1), undefined); assert.doesNotMatch(screen.draw(), /สลิป.jpg/);
  } finally { upload.mock.restore(); }
});
test('a replacement opens the picker only after confirmation, then uploads and attaches once', async () => {
  const calls: string[] = [];
  const upload = mock.method(api, 'uploadDisbursementVoucherSlip', async () => { calls.push('upload'); return 'new'; });
  const attach = mock.method(api, 'attachDisbursementVoucherSlip', async (_company: string, _id: string, id: string) => {
    calls.push('attach'); assert.equal(id, 'new'); return { header: {}, slip: { ...slip, attachmentId: id, attachedByName: 'คุณบี' } };
  });
  const screen = slipHarness({ slip, canAttach: true });
  try {
    screen.draw(); screen.nodes.find(node => node.children.includes('เปลี่ยน')).onClick();
    assert.equal(screen.picked(), 0); assert.deepEqual(calls, []);
    const asked = screen.draw(); assert.match(asked, /เปลี่ยนหลักฐานการจ่าย\?/); assert.match(asked, /หลักฐานเดิมจะไม่แสดงในใบนี้อีก/); assert.match(asked, />ไม่เปลี่ยน<\/button>/);
    screen.nodes.filter(node => node.children.includes('เปลี่ยนหลักฐานการจ่าย')).at(-1).onClick(); assert.equal(screen.picked(), 1);
    screen.nodes.find(node => node.tag?.name === 'ThemedFile').onChange(pickedFile()); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['upload', 'attach']); assert.match(screen.draw(), /หลักฐานการจ่าย: แนบโดย คุณบี เมื่อ/);
  } finally { upload.mock.restore(); attach.mock.restore(); }
});
test('pay refusal is shown once beside the chosen slip and retains that choice', () => {
  const screen = slipHarness({ canAttach: true, paymentForm: true, refusal: { code: 'disbursement_slip_not_owned', message: 'สลิปนี้ไม่ได้อัปโหลดสำหรับใบนี้ กรุณาแนบใหม่' } });
  screen.states[1] = pickedFile(); screen.states[2] = 'uploaded';
  const html = screen.draw(); assert.equal(html.split('หลักฐานการจ่ายนี้ไม่ได้อัปโหลดสำหรับใบนี้ กรุณาแนบใหม่').length - 1, 1);
  assert.match(html, /สลิป.jpg/); assert.match(html, /role="alert"/);
});

require.cache[modalPath]!.exports = { ...modal, Modal: (props: any) => props.open ? React.createElement('div', {}, props.title, props.children, props.footer) : null };
const { DisbursementVoucherPayCard } = require('./DisbursementVoucherPayCard');
require.cache[modalPath]!.exports = modal;
const { ToastContext } = require('@/common/components/toast/use-toast');
function payHarness(patch: any = {}) {
  const runtime = require('react'), realState = runtime.useState, realRef = runtime.useRef, realCreate = runtime.createElement;
  // These handler tests exercise the confirmed payment after the required 600 ms hold.
  const states: any[] = [undefined, null, false, false, true, false, false, null];
  const refs: any[] = Array.from({ length: 8 }, () => ({ current: null }));
  refs[3].current = false; refs[6].current = false; refs[7].current = { version: 2, id: undefined };
  const nodes: any[] = [];
  const detail = { header: { id: 'doc', documentNumber: 'DV-1', status: 'APPROVED', version: 2, plannedMethod: 'CASH', totalAmount: '100.00', payeeName: 'ร้าน ก' }, actions: { pay: true }, canAttachSlip: true, slip: null, lines: [], ...patch };
  const draw = () => {
    let i = 0, r = 0; nodes.length = 0;
    runtime.useState = (init: any) => { const pair = realState(init), index = i++; if (index >= 7) return pair; if (states[index] === undefined) states[index] = pair[0]; return [states[index], (value: any) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; };
    runtime.useRef = (value: any) => { const ref = realRef(value), index = r++; return index < 8 ? refs[index] : ref; };
    runtime.createElement = (tag: any, props: any, ...children: any[]) => { if (tag === 'form' || tag?.name === 'DisbursementVoucherSlip' || tag === 'button') nodes.push({ tag, ...props, children }); return realCreate(tag, props, ...children); };
    try { return renderToStaticMarkup(h(ToastContext.Provider, { value: { success: () => {}, warning: () => {}, error: () => { throw new Error('unexpected toast'); } } }, h(DisbursementVoucherPayCard, { companyId: 'shop', detail, onReload: async () => {} }))); }
    finally { runtime.useState = realState; runtime.useRef = realRef; runtime.createElement = realCreate; }
  };
  const openConfirmation = () => nodes.find(node => node.tag === 'form').onSubmit({ preventDefault: () => {} });
  const confirm = () => nodes.find(node => node.children.some((text: unknown) => typeof text === 'string' && text.startsWith('ยืนยัน จ่ายแล้ว')))?.onClick();
  // Existing slip cases exercise a payment after the new explicit confirmation.
  const submit = () => { openConfirmation(); draw(); confirm(); };
  return { draw, submit, openConfirmation, confirm, states, nodes };
}
test('payment confirmation renders facts, closes without paying and one confirm sends one payment', async () => {
  let finish!: (value: any) => void;
  const pay = mock.method(api, 'payDisbursementVoucher', () => new Promise(resolve => { finish = resolve; }));
  const screen = payHarness();
  try {
    screen.draw(); screen.openConfirmation();
    const question = screen.draw();
    assert.match(question, /จ่าย ฿100.00 ให้ ร้าน ก/); assert.match(question, /· เงินสด/);
    assert.match(question, /ยังไม่ได้แนบหลักฐาน/); assert.doesNotMatch(question, /สลิป/); assert.equal(pay.mock.callCount(), 0);
    screen.nodes.find(node => node.children.includes('กลับไปตรวจ')).onClick();
    screen.draw(); assert.equal(pay.mock.callCount(), 0);
    screen.openConfirmation(); screen.draw(); screen.confirm(); screen.confirm();
    assert.equal(pay.mock.callCount(), 1); finish({ documentNumber: 'DV-1' });
    await new Promise(resolve => setImmediate(resolve));
  } finally { pay.mock.restore(); }
});
test('pay attaches the upload first, uses its new version, and retries a lost answer with the same body', async () => {
  const order: string[] = [], bodies: any[] = [];
  const attach = mock.method(api, 'attachDisbursementVoucherSlip', async () => { order.push('attach'); return { header: { status: 'APPROVED', version: 3 }, slip: { ...slip, attachmentId: 'uploaded' } }; });
  const pay = mock.method(api, 'payDisbursementVoucher', async (_company: string, _id: string, body: any) => {
    order.push('pay'); bodies.push(body); if (bodies.length === 1) throw new Error('บันทึกไม่สำเร็จ ลองอีกครั้ง'); return { documentNumber: 'DV-1' };
  });
  const screen = payHarness();
  try {
    screen.draw(); screen.nodes.find(node => node.tag?.name === 'DisbursementVoucherSlip').onChange('uploaded');
    screen.draw(); screen.submit(); await new Promise(resolve => setImmediate(resolve));
    screen.draw(); screen.submit(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['attach', 'pay', 'pay']); assert.equal(bodies[0].expectedVersion, 3); assert.equal(bodies[0].slipAttachmentId, 'uploaded');
    assert.deepEqual(bodies[1], bodies[0]);
  } finally { attach.mock.restore(); pay.mock.restore(); }
});
test('upload progress blocks pay, then a failed upload releases it with no slip or attachment request', async () => {
  let payments = 0, attachments = 0;
  const attach = mock.method(api, 'attachDisbursementVoucherSlip', async () => { attachments++; });
  const pay = mock.method(api, 'payDisbursementVoucher', async (_company: string, _id: string, body: any) => { payments++; assert.equal('slipAttachmentId' in body, false); return { documentNumber: 'DV-1' }; });
  const screen = payHarness();
  try {
    screen.draw(); screen.nodes.find(node => node.tag?.name === 'DisbursementVoucherSlip').onBusy(true);
    assert.match(screen.draw(), /กำลังแนบหลักฐานการจ่าย…/); screen.submit(); await new Promise(resolve => setImmediate(resolve)); assert.equal(payments, 0);
    screen.nodes.find(node => node.tag?.name === 'DisbursementVoucherSlip').onBusy(false);
    screen.draw(); screen.submit(); await new Promise(resolve => setImmediate(resolve)); assert.equal(payments, 1); assert.equal(attachments, 0);
  } finally { attach.mock.restore(); pay.mock.restore(); }
});
test('attach refusal stays only in the slip field, stops pay and retains entered values', async () => {
  let payments = 0;
  const attach = mock.method(api, 'attachDisbursementVoucherSlip', async () => { throw { code: 'disbursement_slip_not_owned', message: 'สลิปนี้ไม่ได้อัปโหลดสำหรับใบนี้ กรุณาแนบใหม่' }; });
  const pay = mock.method(api, 'payDisbursementVoucher', async () => { payments++; });
  const screen = payHarness();
  try {
    screen.draw(); screen.nodes.find(node => node.tag?.name === 'DisbursementVoucherSlip').onChange('uploaded');
    screen.states[0].paidFromRef = 'บัญชีร้าน';
    screen.draw(); screen.submit(); await new Promise(resolve => setImmediate(resolve));
    const html = screen.draw(); assert.equal(html.split('หลักฐานการจ่ายนี้ไม่ได้อัปโหลดสำหรับใบนี้ กรุณาแนบใหม่').length - 1, 1);
    assert.match(html, /value="บัญชีร้าน"/); assert.equal(payments, 0); assert.equal(screen.states[0].slipAttachmentId, 'uploaded');
  } finally { attach.mock.restore(); pay.mock.restore(); }
});

test('attaching never adopts unrelated newer edits as permission to pay an unseen document', async () => {
  let payments = 0;
  const attach = mock.method(api, 'attachDisbursementVoucherSlip', async () => ({ header: { status: 'APPROVED', version: 5 }, slip: { ...slip, attachmentId: 'uploaded' } }));
  const pay = mock.method(api, 'payDisbursementVoucher', async () => { payments++; });
  const screen = payHarness();
  try {
    screen.draw(); screen.nodes.find(node => node.tag?.name === 'DisbursementVoucherSlip').onChange('uploaded');
    screen.draw(); screen.submit(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(payments, 0); assert.match(screen.draw(), /ใบนี้ถูกแก้ไขจากที่อื่นแล้ว เปิดหน้านี้ใหม่ก่อนบันทึก/);
    assert.match(screen.draw(), /โหลดข้อมูลล่าสุด/);
  } finally { attach.mock.restore(); pay.mock.restore(); }
});


test('view uses a fresh URL for every press and releases the preview when leaving', async () => {
  let reads = 0;
  const read = mock.method(api, 'fetchDisbursementVoucherSlipBlob', async () => { reads++; return new Blob(['image'], { type: 'image/jpeg' }); });
  const revoked: string[] = [];
  const create = mock.method(URL, 'createObjectURL', () => `blob:slip-${reads}`);
  const revoke = mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); });
  const screen = slipHarness({ slip });
  try {
    screen.draw(); screen.nodes.find(node => node.children.includes('ดูไฟล์')).onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(screen.states[6].url, 'blob:slip-1');
    screen.draw(); screen.nodes.find(node => node.children.includes('ดูไฟล์')).onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(screen.states[6].url, 'blob:slip-2'); assert.deepEqual(revoked, ['blob:slip-1']);
    screen.cleanup(); assert.deepEqual(revoked, ['blob:slip-1', 'blob:slip-2']);
    assert.doesNotMatch(render({ slip }), /blob:slip/); assert.equal(reads, 2);
  } finally { read.mock.restore(); create.mock.restore(); revoke.mock.restore(); }
});
test('retry of a failed attach reuses the completed upload and keeps the old visible slip until success', async () => {
  let uploads = 0, attaches = 0;
  const upload = mock.method(api, 'uploadDisbursementVoucherSlip', async () => { uploads++; return 'new'; });
  const attach = mock.method(api, 'attachDisbursementVoucherSlip', async () => {
    attaches++; if (attaches === 1) throw new Error('แนบไม่สำเร็จ กรุณาลองอีกครั้ง');
    return { header: {}, slip: { ...slip, attachmentId: 'new', attachedByName: 'คุณบี' } };
  });
  const screen = slipHarness({ slip, canAttach: true });
  try {
    screen.draw(); screen.nodes.find(node => node.tag?.name === 'ThemedFile').onChange(pickedFile()); await new Promise(resolve => setImmediate(resolve));
    assert.match(screen.draw(), /หลักฐานการจ่าย: แนบโดย คุณเอ เมื่อ/);
    screen.nodes.find(node => node.children.includes('ลองอีกครั้ง')).onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.match(screen.draw(), /หลักฐานการจ่าย: แนบโดย คุณบี เมื่อ/); assert.equal(uploads, 1); assert.equal(attaches, 2);
  } finally { upload.mock.restore(); attach.mock.restore(); }
});

test('pay fields share the concept input style and optional evidence label', () => {
  const html = payHarness().draw();
  assert.match(html, /แนบหลักฐานการจ่าย \(ถ้ามี\)/);
  assert.match(html.match(/<input[^>]*placeholder="เช่น บัญชีร้าน[^>]*>/)![0], /mangmee-input/);
});
test('transfer without an approved account asks the named preparer; switching to cash clears the warning', () => {
  const screen = payHarness({ preparerName: 'คุณเอ' });
  screen.draw(); screen.states[0].paymentMethod = 'BANK_TRANSFER';
  assert.match(screen.draw(), /ใบนี้ไม่มีบัญชีผู้รับ ถามผู้จัดทำ คุณเอ ก่อนโอน/);
  screen.states[0].paymentMethod = 'CASH';
  assert.doesNotMatch(screen.draw(), /ใบนี้ไม่มีบัญชีผู้รับ/);
});

test('local image and document previews open, remove clears the upload, and object URLs are released', async () => {
  const changes: any[] = [], revoked: string[] = [];
  let seq = 0;
  const create = mock.method(URL, 'createObjectURL', () => `blob:local-${++seq}`);
  const revoke = mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); });
  const upload = mock.method(api, 'uploadDisbursementVoucherSlip', async () => 'uploaded');
  const screen = slipHarness({ canAttach: true, paymentForm: true, onChange: (id: any) => changes.push(id) });
  try {
    screen.draw(); screen.nodes.find(n => n.tag?.name === 'ThemedFile').onChange(pickedFile());
    await new Promise(resolve => setImmediate(resolve)); screen.draw();
    assert.match(screen.draw(), /<img[^>]*src="blob:local-1"[^>]*alt="สลิป.jpg"/);
    screen.nodes.find(n => n.children.includes('ดูไฟล์')).onClick(); screen.draw();
    assert.equal(screen.nodes.find(n => n.tag?.name === 'DocumentPreviewModal').source.url, 'blob:local-1');
    screen.nodes.find(n => n.children.includes('เอาออก')).onClick(); screen.draw();
    assert.equal(changes.at(-1), undefined); assert.deepEqual(revoked, ['blob:local-1']);
    assert.doesNotMatch(screen.draw(), /disbursement-local-slip/);
    screen.nodes.find(n => n.tag?.name === 'ThemedFile').onChange(new File(['pdf'], 'หลักฐาน.pdf', { type: 'application/pdf' }));
    await new Promise(resolve => setImmediate(resolve)); screen.draw();
    assert.match(screen.draw(), /หลักฐาน.pdf/); assert.doesNotMatch(screen.draw(), /<img/);
    screen.nodes.find(n => n.tag?.name === 'ThemedFile').onChange(pickedFile());
    await new Promise(resolve => setImmediate(resolve)); screen.draw();
    assert.deepEqual(revoked, ['blob:local-1', 'blob:local-2']);
    screen.cleanup(); assert.deepEqual(revoked, ['blob:local-1', 'blob:local-2', 'blob:local-3']);
  } finally { create.mock.restore(); revoke.mock.restore(); upload.mock.restore(); }
});

test('approved account sits before the pay fields and preserves the named recipient snapshot', () => {
  const html = payHarness({ header: { id: 'doc', status: 'APPROVED', version: 2, totalAmount: '100.00', plannedMethod: 'BANK_TRANSFER', payeeName: 'ร้าน ก', payeeBankName: 'กสิกรไทย', payeeAccountName: 'นาย ก', payeeAccountLast4: '5678' } }).draw();
  for (const fact of ['โอนเข้าบัญชี', 'ผู้รับเงิน', 'ร้าน ก', 'กสิกรไทย', 'นาย ก', 'xxx-5678']) assert.ok(html.includes(fact), fact);
  assert.ok(html.indexOf('โอนเข้าบัญชี') < html.indexOf('วันที่จ่ายจริง'));
  assert.doesNotMatch(html, /ใบนี้ไม่มีบัญชีผู้รับ/);
});
