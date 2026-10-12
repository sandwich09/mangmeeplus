import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { WHT_CERTIFICATE_CORRECTION_WORDS } from '@watchdog-bms/contracts';
import { subscribeToastBus } from '@/common/feedback/toast-bus';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { expenseEvidenceFingerprint } from '@watchdog-bms/contracts';
import { h, mutable } from './expense-certificate-test-harness';
import type { ExpenseCertificate } from './ExpenseCertificateReopen';
import { expenseCertificateReopenedMessage } from './ExpenseCertificateReopen';
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (m) => { m.exports = () => null; };
const api = mutable('./expenses.api');
const policy = mutable('./expense-capture-policy');
const modals = mutable('@/common/components/modal/Modal');
const confirmation = mutable('@/common/components/modal/use-confirm');
const certificateControls = mutable('./ExpenseCertificateReopen');
const downloads = mutable('@/common/files/download-artifact');
const { ExpenseReviewPage } = require('./ExpenseReviewPage');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];

const permissions = ['expense.read', 'expense.confirm', 'expense.review', 'expense.void', 'wht.certificate.correct'];
function detail(certificate: ExpenseCertificate | null) {
  const value: any = { id: 'expense', companyId: 'co', branchId: 'b', createdByUserId: 'owner', expenseNumber: 'EX-1', status: 'CONFIRMED', expenseDate: '2026-10-11',
    vendorNameSnapshot: 'ร้านทดสอบ', description: 'สินค้า', currency: 'THB', subtotalAmount: '100', grandTotalAmount: '100', netPayableAmount: '100', vatAmount: '0', whtAmount: '0', discountAmount: '0',
    paidAmount: '0', outstandingAmount: '100', paymentStatus: 'UNPAID', postingStatus: 'not_required', vatMode: 'NO_VAT', sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'NON_TAX_INVOICE',
    captureSource: 'MANUAL', duplicateStatus: 'NO_MATCH', duplicateCandidates: [], aiVerifiedFieldsJson: null, lines: [], payments: [], updatedAt: '2026-10-11T03:00:00Z',
    attachments: [{ id: 'att', purpose: 'expense.receipt.primary', originalFileName: 'ใบเสร็จ.pdf', mimeType: 'application/pdf', status: 'ACTIVE' }],
    correctionCapabilities: { canReopen: true, reopenBlockers: [], canReject: true, rejectBlocker: null, canRecordPayment: true, recordPaymentBlocker: null, payments: [], certificateOnExpense: certificate },
  };
  const assessment = { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: ['att'], reason: '' };
  value.aiVerificationSummaryJson = { documentReview: { version: 2, assessment, reviewedAt: value.updatedAt, reviewedByUserId: 'owner', fingerprint: expenseEvidenceFingerprint(value, assessment as any) } };
  return value;
}
function setup(certificate: ExpenseCertificate | null, reason = 'แก้ยอด', attested = false, overrides: Record<string, unknown> = {}, pagePermissions = permissions) {
  const state: Record<string, any> = { detail: detail(certificate), loading: false, step: 'review', correctionAction: {}, correctionReason: reason, ...overrides };
  const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(m => m[1]!);
  const nodes: { tag: string; props: any }[] = [];
  const successes: string[] = [];
  function render() {
    const runtime = require('react');
    let index = 0; nodes.length = 0;
    const realState = runtime.useState, realCreate = runtime.createElement;
    const mocks = [
      mock.method(runtime, 'useState', (init: any) => {
        const pair = realState(init), name = names[index++];
        if (!name) {
          if (init && typeof init === 'object' && 'row' in init && state.certificateRead) return [state.certificateRead, (next: any) => { state.certificateRead = typeof next === 'function' ? next(state.certificateRead) : next; }];
          return pair;
        }
        if (!(name in state)) state[name] = pair[0];
        return [state[name], (next: any) => { state[name] = typeof next === 'function' ? next(state[name]) : next; }];
      }),
      mock.method(runtime, 'createElement', (tag: any, props: any, ...children: any[]) => {
        nodes.push({ tag: typeof tag === 'string' ? tag : tag.name, props: { ...props, children } });
        return realCreate(tag, props, ...children);
      }),
      mock.method(modals, 'Modal', ({ open, title, children, footer }: any) => open ? h('section', { 'data-dialog': true }, h('h2', null, title), children, footer) : null),
      mock.method(confirmation, 'useConfirm', () => ({ confirm: async () => true, confirmDialog: null })),
      mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE', vatStatus: 'NOT_REGISTERED' })),
      // Child's tick and copy are exercised in its own spec; this lane checks the page's existing form.
      mock.method(certificateControls, 'ExpenseCertificateReopen', ({ children, certificate }: any) => children(attested, certificate ? 'คำเตือนหนังสือรับรอง' : null, (content: any) => content, certificate ? 'ช่องยืนยันเรื่องภาษี' : null)),
    ];
    try {
      return renderToStaticMarkup(h(AppRouterContext.Provider, { value: { push() {}, replace() {}, back() {}, prefetch() {} } as any },
        h(ToastContext.Provider, { value: { success: message => successes.push(message), warning() {}, error() { throw Error('refusal must stay by action'); } } },
          h(ExpenseReviewPage, { companyId: 'co', expenseId: 'expense', userId: 'owner', permissions: pagePermissions, canSelfApprove: true }))));
    } finally { mocks.reverse().forEach(m => m.mock.restore()); }
  }
  const find = (tag: string, id: string) => {
    const node = nodes.find(n => n.tag === tag && (n.props?.id === id || n.props?.form === id));
    assert.ok(node, `${tag} ${id}`); return node.props;
  };
  async function submit() { find('form', 'expense-correction-form').onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); return render(); }
  return { state, nodes, render, find, submit, successes };
}

test('the existing reopen form requires three reason characters plus attestation only with a certificate', async () => {
  let calls = 0;
  const reopen = mock.method(api, 'reopenExpense', async () => { calls++; });
  const get = mock.method(api, 'getExpense', async () => ({ ...detail(null), status: 'NEEDS_REVIEW' }));
  try {
    for (const [certificate, reason, attested, disabled] of [
      [{ kind: 'SYSTEM', number: 'WHT-1', date: null, canCancel: true }, 'แก้ยอด', false, true],
      [{ kind: 'SYSTEM', number: 'WHT-1', date: null, canCancel: true }, 'ก', true, false],
      [{ kind: 'EXTERNAL', number: null, date: null, canCancel: true }, 'แก้ยอด', true, false],
      [null, 'แก้ยอด', false, false],
    ] as const) {
      const page = setup(certificate, reason, attested); page.render();
      assert.equal(page.find('button', 'expense-correction-form').disabled, disabled);
      const before = calls; await page.submit(); assert.equal(calls - before, disabled || reason.trim().length < 3 ? 0 : 1);
    }
  } finally { reopen.mock.restore(); get.mock.restore(); }
});

test('reopen reaches the real API wrapper with attestation only for certificate expenses and the exact success toast', async () => {
  const originalFetch = globalThis.fetch;
  const get = mock.method(api, 'getExpense', async () => ({ ...detail(null), status: 'NEEDS_REVIEW' }));
  try {
    for (const certificate of [{ kind: 'SYSTEM', number: 'WHT-1', date: null, canCancel: true }, { kind: 'EXTERNAL', number: null, date: null, canCancel: true }, null] as const) {
      let body: unknown;
      globalThis.fetch = (async (_input, init) => { body = JSON.parse(String(init?.body)); return new Response('{}', { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
      const page = setup(certificate, 'แก้ยอด', Boolean(certificate)); page.render(); await page.submit();
      assert.deepEqual(body, certificate ? { reason: 'แก้ยอด', taxFilingAttested: true } : { reason: 'แก้ยอด' });
      assert.equal(page.state.correctionAction, null);
      if (certificate) assert.deepEqual(page.successes, [expenseCertificateReopenedMessage(certificate)]);
    }
  } finally { get.mock.restore(); globalThis.fetch = originalFetch; }
});

test('late certificate permission and filed-period refusals preserve the server sentence and open reason form', async () => {
  for (const blocker of ['certificate_permission_missing', 'tax_period_filed']) {
    const message = 'ยังแก้ไขเอกสารนี้ไม่ได้ กรุณาให้เจ้าของกิจการตรวจสอบก่อน';
    const reopen = mock.method(api, 'reopenExpense', async () => { throw { details: { code: 'expense_correction_blocked', blockers: [blocker], message } }; });
    const get = mock.method(api, 'getExpense', async () => { throw Error('must not replace reason or certificate after refusal'); });
    try {
      const page = setup({ kind: 'SYSTEM', number: 'WHT-1', date: null, canCancel: true }, 'แก้ยอด', true); page.render();
      const html = await page.submit();
      assert.equal(html.split(message).length - 1, 1); assert.deepEqual(page.state.correctionAction, {}); assert.equal(page.state.correctionReason, 'แก้ยอด');
      assert.equal(get.mock.callCount(), 0); assert.deepEqual(page.successes, []);
    } finally { reopen.mock.restore(); get.mock.restore(); }
  }
});

test('filed withholding refusal on the expense page uses the Thai month from contracts', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    const page = setup({ kind, number: 'WHT-1', date: null, canCancel: true }, '', false, { correctionAction: null });
    page.state.detail.correctionCapabilities = { ...page.state.detail.correctionCapabilities, canReopen: false,
      reopenBlockers: ['tax_period_filed'], lockedTaxPeriods: [{ formType: 'PND3', periodKey: '2026-09' }] };
    const html = page.render();
    assert.match(html, /ภาษีหัก ณ ที่จ่าย \(ภ\.ง\.ด\.3\) ของเดือน ก\.ย\. 2569 ยื่นไปแล้ว/);
    assert.doesNotMatch(html, /09\/2569/);
  }
});

test('reopen toast uses the server cancelled certificate instead of the old dialog facts', async () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const number of ['WHT-NEW', null]) {
    const cancelledCertificate = { kind, number };
    const reopen = mock.method(api, 'reopenExpense', async () => ({ cancelledCertificate }));
    const get = mock.method(api, 'getExpense', async () => ({ ...detail(null), status: 'NEEDS_REVIEW' }));
    try {
      const page = setup({ kind: kind === 'SYSTEM' ? 'EXTERNAL' : 'SYSTEM', number: 'WHT-OLD', date: null, canCancel: true }, 'แก้ยอด', true);
      page.render(); await page.submit();
      assert.deepEqual(page.successes, [expenseCertificateReopenedMessage(cancelledCertificate)]);
      assert.doesNotMatch(page.successes.join(''), /WHT-OLD/);
    } finally { reopen.mock.restore(); get.mock.restore(); }
  }
});

test('certificate void renders the child modal and hides the bottom reason box; certificate-free void keeps it', () => {
  for (const certificate of [{ kind: 'SYSTEM', number: 'WHT-1', date: null, canCancel: true }, { kind: 'EXTERNAL', number: null, date: null, canCancel: true }, null] as const) {
    const page = setup(certificate, 'แก้ยอด', false, { correctionAction: null, showVoid: true });
    const html = page.render();
    assert.equal(html.includes('id="expense-certificate-void-form"'), Boolean(certificate));
    assert.equal(html.includes('rows="2"'), !certificate);
    assert.ok(html.indexOf('mangmee-safe-bottom sticky') < (html.indexOf('expense-certificate-void-form') < 0 ? Infinity : html.indexOf('expense-certificate-void-form')));
  }
});


function correctionHandoff(currentCertificate: any = null) {
  return { id: 'handoff', status: 'SYSTEM_ISSUED', certificateId: 'cert-1', systemCorrectionOpen: true,
    prefill: { formType: 'PND53', incomeCategoryCode: '01', incomeCategoryName: 'ค่าบริการ', whtRate: '3', grossAmount: '1402.00', withheldAmount: '42.06', paymentDate: '2026-10-11T08:30:00Z',
      payeeSnapshot: { name: 'ชื่อเดิม', taxId: '1234567890123', address: 'ที่อยู่เดิม', branchCode: '00000' } }, currentCertificate };
}
function currentCertificate() {
  const prefill = correctionHandoff().prefill;
  return { ...prefill, payee: { ...prefill.payeeSnapshot, name: 'ชื่อที่แก้ครั้งแรก' }, number: 'WHT-2', issuedAt: '2026-10-11T09:00:00Z' };
}
function correctionPage(handoff: any) {
  return setup(null, 'แก้ยอด', false, { correctionAction: null, detail: { ...detail(null), whtAmount: '42.06' }, whtHandoff: handoff });
}
function toggleCorrection(page: ReturnType<typeof setup>) {
  const button = page.nodes.find(n => n.tag === 'button' && n.props['aria-expanded'] !== undefined && n.props.className?.includes('mangmee-btn-secondary'));
  assert.ok(button); button.props.onClick(); return page.render();
}
function changeCorrection(page: ReturnType<typeof setup>, field: string, value: string) {
  page.find(field === 'payee-address' ? 'textarea' : 'input', `wht-correct-${field}-expense`).onChange({ target: { value } }); page.render();
}
async function submitCorrection(page: ReturnType<typeof setup>) {
  const form = page.nodes.find(n => n.tag === 'form' && n.props.className === 'mt-2 grid gap-2 sm:grid-cols-2');
  assert.ok(form); form.props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); return page.render();
}

test('AW2 opens from the current certificate and uses prefill only when currentCertificate is null', () => {
  for (const certificate of [currentCertificate(), null]) {
    const page = correctionPage(correctionHandoff(certificate)); page.render(); toggleCorrection(page);
    assert.equal(page.find('input', 'wht-correct-payee-name-expense').value, certificate ? 'ชื่อที่แก้ครั้งแรก' : 'ชื่อเดิม');
    assert.ok(page.render().includes('1,402.00')); assert.doesNotMatch(page.render(), /id="wht-correct-gross-/);
  }
});

test('C3 rendered correction shows the printed Thai income name, grouped money, a wrapping address and one primary', () => {
  const certificate = { ...currentCertificate(), incomeCategoryCode: 'WHT_SERVICE_5', incomeCategoryName: 'ค่าบริการ (นิติบุคคล)', grossAmount: '10000.0000' };
  const page = correctionPage(correctionHandoff(certificate)); page.render();
  const html = toggleCorrection(page);
  assert.match(html, /ค่าบริการ \(นิติบุคคล\)/); assert.doesNotMatch(html, /WHT_SERVICE_5|รหัสประเภทเงินได้/);
  assert.ok(html.includes('10,000.00')); assert.doesNotMatch(html, /id="wht-correct-gross-/);
  assert.equal(page.find('textarea', 'wht-correct-payee-address-expense').rows, 4);
  assert.equal(page.find('input', 'wht-correct-reason-expense').placeholder, 'เช่น สะกดชื่อผู้รับเงินผิด');
  assert.doesNotMatch(html, />ดาวน์โหลด<\/button>/);
});

test('AW2 sends only the changed payee field and reopens with the newly corrected certificate', async () => {
  const original = currentCertificate();
  const updated = { ...original, number: 'WHT-3', payee: { ...original.payee, address: 'ที่อยู่ใหม่' } };
  const bodies: any[] = [];
  const request = mock.method(api, 'correctSystemWhtCertificate', async (_co: string, _id: string, body: any) => { bodies.push(body); return { id: 'cert-3', pdfArtifact: {} }; });
  const list = mock.method(api, 'listWhtHandoffs', async () => [correctionHandoff(updated)]);
  const download = mock.method(downloads, 'downloadArtifact', () => {});
  try {
    const page = correctionPage(correctionHandoff(original)); page.render(); toggleCorrection(page);
    changeCorrection(page, 'payee-address', 'ที่อยู่ใหม่'); changeCorrection(page, 'reason', 'แก้ที่อยู่');
    await submitCorrection(page);
    assert.deepEqual(bodies, [{ corrected: { payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, reason: 'แก้ที่อยู่' }]);
    toggleCorrection(page);
    assert.equal(page.find('input', 'wht-correct-payee-name-expense').value, 'ชื่อที่แก้ครั้งแรก');
    assert.equal(page.find('textarea', 'wht-correct-payee-address-expense').value, 'ที่อยู่ใหม่');
    assert.equal(list.mock.callCount(), 1); assert.equal(download.mock.callCount(), 1);
  } finally { request.mock.restore(); list.mock.restore(); download.mock.restore(); }
});

test('AW2 read-only facts or a reason alone show the no-change sentence without an API call', async () => {
  const request = mock.method(api, 'correctSystemWhtCertificate', async () => { throw Error('no change must not submit'); });
  try {
    for (const reformatNumbers of [false, true]) {
      const page = correctionPage(correctionHandoff(currentCertificate())); page.render(); toggleCorrection(page);
      if (reformatNumbers) {
        assert.doesNotMatch(page.render(), /id="wht-correct-(gross|withheld|rate|payee-taxid|form-type)-/);
      }
      changeCorrection(page, 'reason', 'ตรวจแล้ว');
      const html = await submitCorrection(page);
      assert.equal(request.mock.callCount(), 0); assert.match(html, /ยังไม่ได้แก้ไขข้อมูลใด/); assert.equal(page.state.correctOpen, true);
    }
  } finally { request.mock.restore(); }
});


test('AW2 a failed handoff refresh keeps the correction successful and prevents opening stale values', async () => {
  const request = mock.method(api, 'correctSystemWhtCertificate', async () => ({ id: 'cert-3', certificateNumber: 'WHT-3', pdfArtifact: {} }));
  const list = mock.method(api, 'listWhtHandoffs', async () => { throw { code: 'insufficient_permissions' }; });
  const download = mock.method(downloads, 'downloadArtifact', () => {});
  try {
    const page = correctionPage(correctionHandoff(currentCertificate())); page.render(); toggleCorrection(page);
    changeCorrection(page, 'payee-address', 'ที่อยู่ใหม่'); changeCorrection(page, 'reason', 'แก้ที่อยู่');
    const html = await submitCorrection(page);
    assert.equal(request.mock.callCount(), 1); assert.equal(page.state.correctOpen, false); assert.equal(page.state.whtHandoff?.certificateNumber, 'WHT-3'); assert.equal(page.state.whtHandoff?.systemCorrectionOpen, false);
    assert.equal(page.state.whtLoading, false); assert.ok(page.state.whtIssueError);
    assert.deepEqual(page.successes, ['แก้ไขแล้ว ออกหนังสือรับรองใบใหม่เลขที่ WHT-3 แทนใบเดิม']);
    assert.doesNotMatch(html, /insufficient_permissions|wht-correct-payee/);
  } finally { request.mock.restore(); list.mock.restore(); download.mock.restore(); }
});

test('certificate edit dialog places its facts first, then reason and the tax tick before buttons', () => {
  const html = setup({ kind: 'SYSTEM', number: 'WHT-1', date: null, canCancel: true }, 'แก้ยอด', false).render();
  const facts = html.indexOf('คำเตือนหนังสือรับรอง');
  const reason = html.indexOf('id="expense-correction-reason"');
  const tick = html.indexOf('ช่องยืนยันเรื่องภาษี');
  assert.doesNotMatch(html.slice(facts, html.indexOf('id="expense-correction-reason"', facts)), /เอกสารจะกลับไปตรวจสอบ/);
  assert.ok(facts < reason && reason < tick);
  assert.ok(tick < html.indexOf('form="expense-correction-form"'));
});

test('server no-change and duplicate-number correction refusals stay once inside the open form with typed values and no toast', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const errors: string[] = [];
  const unsubscribe = subscribeToastBus(event => errors.push(event.message));
  (globalThis as Record<string, unknown>)['window'] = {};
  let body: unknown;
  try {
    for (const [code, message] of [
      ['wht_certificate_correction_no_changes', WHT_CERTIFICATE_CORRECTION_WORDS.noChanges],
      ['wht_certificate_number_duplicate', WHT_CERTIFICATE_CORRECTION_WORDS.numberDuplicate],
      ['wht_correction_field_locked', WHT_CERTIFICATE_CORRECTION_WORDS.fieldLocked],
    ] as const) {
      globalThis.fetch = (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ code, message, requestId: 'A8C_PRIVATE_REQUEST_77' }, { status: 422 });
      }) as typeof fetch;
      const page = correctionPage(correctionHandoff(currentCertificate())); page.render(); toggleCorrection(page);
      changeCorrection(page, 'payee-address', 'ที่อยู่ที่แก้'); changeCorrection(page, 'reason', 'แก้ที่อยู่');
      const html = await submitCorrection(page);
      assert.deepEqual(body, { corrected: { payeeSnapshot: { address: 'ที่อยู่ที่แก้' } }, reason: 'แก้ที่อยู่' });
      assert.equal(html.split(message).length - 1, 1);
      assert.equal(page.state.correctOpen, true);
      assert.equal(page.find('textarea', 'wht-correct-payee-address-expense').value, 'ที่อยู่ที่แก้');
      assert.equal(page.find('input', 'wht-correct-reason-expense').value, 'แก้ที่อยู่');
      assert.deepEqual(page.successes, []); assert.deepEqual(errors, []);
      assert.doesNotMatch(html, /wht_certificate_correction_no_changes|wht_certificate_number_duplicate|A8C_PRIVATE_REQUEST_77/);
      for (const [tag, field, next] of [
        ['input', 'reason', 'แก้ชื่อแทน'], ['textarea', 'payee-address', 'บ้านเลขที่ใหม่'], ['input', 'payee-name', 'ชื่อใหม่'],
        ['input', 'payee-branch', '00001'],
        ['ThemedDate', 'payment-date', '2026-10-10'],
      ]) {
        page.state.correctError = message; page.render();
        const control = page.find(tag!, `wht-correct-${field}-expense`);
        control.onChange({ target: { value: next } });
        assert.ok(!page.render().includes(message), `${field} clears the refusal`);
      }
    }
  } finally {
    unsubscribe(); globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as Record<string, unknown>)['window'];
  }
});

test('duplicate certificate number refusal is shown once beside the issue button without an automatic toast', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const errors: string[] = [];
  const unsubscribe = subscribeToastBus(event => errors.push(event.message));
  (globalThis as Record<string, unknown>)['window'] = {};
  const message = WHT_CERTIFICATE_CORRECTION_WORDS.numberDuplicate;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ code: 'wht_certificate_number_duplicate', message, requestId: 'A8C_PRIVATE_REQUEST_88' }, { status: 409 });
  }) as typeof fetch;
  try {
    const handoff = { ...correctionHandoff(), status: 'REQUIRED', systemIssuanceOpen: true, certificateId: null, missing: [] };
    const page = setup(null, '', false, { correctionAction: null, detail: { ...detail(null), whtAmount: '42.06' },
      whtHandoff: handoff, certificateRead: { row: handoff, loading: false, error: null } }, [...permissions, 'wht.certificate.issue']);
    assert.match(page.render(), /ออกหนังสือรับรอง 50 ทวิ/);
    const issue = page.nodes.find(node => node.tag === 'WhtIssueButton');
    assert.ok(issue); issue.props.onIssue(); await new Promise(resolve => setImmediate(resolve));
    const html = page.render();
    assert.equal(calls, 1); assert.equal(html.split(message).length - 1, 1);
    assert.deepEqual(errors, []); assert.deepEqual(page.successes, []);
    assert.doesNotMatch(html, /wht_certificate_number_duplicate|A8C_PRIVATE_REQUEST_88/);
    page.nodes.find(node => node.tag === 'ExpenseCertificateCard')!.props.onChanged(handoff);
    assert.equal(page.render().split(message).length - 1, 1, 'a late read must not clear the action refusal');
  } finally {
    unsubscribe(); globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as Record<string, unknown>)['window'];
  }
});


test('correction labels describe payee kinds and the recipient branch rather than tax codes', () => {
  const page = correctionPage(correctionHandoff(currentCertificate())); page.render(); toggleCorrection(page);
  const html = page.render();
  assert.ok(html.includes('รหัสสาขาของผู้รับเงิน'));
  assert.ok(html.includes('นิติบุคคล'));
  const individual = correctionPage(correctionHandoff({ ...currentCertificate(), formType: 'PND3' })); individual.render(); toggleCorrection(individual);
  assert.ok(individual.render().includes('บุคคลธรรมดา'));
  assert.doesNotMatch(html, /id="wht-correct-form-type-/);
  assert.ok(!html.includes('>แบบ</span>')); assert.ok(!html.includes('>สาขา</span>'));
});

test('the correction keeps only permitted inputs and its expense edit link opens the existing dialog when allowed', () => {
  for (const allowed of [false, true]) {
    const page = correctionPage(correctionHandoff(currentCertificate()));
    page.state.detail.correctionCapabilities.canReopen = allowed;
    page.render(); const html = toggleCorrection(page);
    assert.doesNotMatch(html, /id="wht-correct-(gross|withheld|rate|form-type|payee-taxid)-/);
    for (const field of ['payee-name', 'payee-branch', 'payee-address', 'payment-date', 'reason']) assert.ok(html.includes(`wht-correct-${field}-expense`), field);
    const button = page.nodes.find(node => node.tag === 'button' && node.props.children.includes('แก้ไขเอกสาร') && node.props.className?.includes('underline'));
    assert.equal(Boolean(button), allowed);
    if (button) { button.props.onClick(); page.render(); assert.deepEqual(page.state.correctionAction, {}); assert.equal(page.state.correctOpen, false); assert.equal(page.state.correctionReason, 'แก้ยอด'); }
  }
});

test('correction names the new-certificate result, explains disabled presses and hides download and replacement actions', () => {
  const page = correctionPage({ ...correctionHandoff(currentCertificate()), systemReplacementOpen: true }); page.render();
  let html = toggleCorrection(page);
  const submit = () => page.nodes.find(node => node.tag === 'button' && node.props.type === 'submit')!.props;
  assert.ok(html.includes('ระบบจะยกเลิกใบเดิมและออกใบใหม่ เลขที่ใหม่ ใบเดิมเก็บไว้ในประวัติ'));
  assert.ok(html.includes('ออกใบใหม่แทนใบเดิม')); assert.ok(html.includes('กรอกเหตุผลก่อน')); assert.equal(submit().disabled, true);
  assert.doesNotMatch(html, />ดาวน์โหลด<\/button>|>พิมพ์ใบแทน \(เลขที่เดิม\)<\/button>|height:6rem/);
  changeCorrection(page, 'reason', 'แก้ชื่อ'); html = page.render(); assert.ok(html.includes('ยังไม่ได้แก้ไขข้อมูลใด')); assert.equal(submit().disabled, true);
  changeCorrection(page, 'payee-name', 'ชื่อใหม่'); html = page.render(); assert.equal(submit().disabled, false);
  assert.doesNotMatch(html, /กรอกเหตุผลก่อน|ยังไม่ได้แก้ไขข้อมูลใด/);
  page.state.correctBusy = true; html = page.render(); assert.ok(html.includes('กำลังออกใบใหม่แทนใบเดิม…')); assert.equal(submit()['aria-busy'], true);
});


test('the issue answer immediately supplies the card number and date and names the number in its toast', async () => {
  const download = mock.method(downloads, 'downloadArtifact', () => {});
  const expense = mock.method(api, 'getExpense', async () => ({ ...detail(null), whtAmount: '42.06' }));
  try {
    for (const number of ['WHT-ISSUED', undefined]) {
      const issue = mock.method(api, 'issueSystemWhtCertificate', async () => ({ id: 'new', certificateNumber: number, issuedAt: '2026-10-11T00:00:00Z', pdfArtifact: {} }));
      try {
        const handoff = { ...correctionHandoff(), status: 'REQUIRED', systemIssuanceOpen: true, certificateId: null, currentCertificate: null, missing: [] };
        const page = setup(null, '', false, { correctionAction: null, detail: { ...detail(null), whtAmount: '42.06' }, whtHandoff: handoff, certificateRead: { row: handoff, loading: false, error: null } }, [...permissions, 'wht.certificate.issue']);
        page.render(); page.nodes.find(node => node.tag === 'WhtIssueButton')!.props.onIssue();
        await new Promise(done => setImmediate(done));
        assert.equal(page.state.whtHandoff.certificateNumber, number ?? null); assert.equal(page.state.whtHandoff.certificateIssuedAt, '2026-10-11T00:00:00Z');
        assert.deepEqual(page.successes, [number ? `ออกหนังสือรับรองเลขที่ ${number} แล้ว` : 'ออกหนังสือรับรองหัก ณ ที่จ่ายในระบบเรียบร้อยแล้ว']);
        if (number) assert.ok(page.render().replace(/<[^>]*>/g, '').includes('ออกแล้ว เลขที่ WHT-ISSUED วันที่'));
      } finally { issue.mock.restore(); }
    }
  } finally { download.mock.restore(); expense.mock.restore(); }
});

test('the correction answer supplies the new card identity before the confirming read completes', async () => {
  let resolve!: (value: any) => void;
  const corrected = mock.method(api, 'correctSystemWhtCertificate', async () => ({ id: 'new', certificateNumber: 'WHT-CORRECTED', issuedAt: '2026-10-11T00:00:00Z', pdfArtifact: {} }));
  const list = mock.method(api, 'listWhtHandoffs', () => new Promise(done => { resolve = done; }));
  const download = mock.method(downloads, 'downloadArtifact', () => {});
  try {
    const handoff = { ...correctionHandoff(currentCertificate()), missing: [] };
    const page = correctionPage(handoff); page.state.certificateRead = { row: handoff, loading: false, error: null }; page.render(); toggleCorrection(page);
    changeCorrection(page, 'payee-address', 'ที่อยู่ใหม่'); changeCorrection(page, 'reason', 'แก้ที่อยู่');
    const html = await submitCorrection(page);
    assert.equal(page.state.whtHandoff.certificateNumber, 'WHT-CORRECTED'); assert.equal(page.state.whtHandoff.certificateIssuedAt, '2026-10-11T00:00:00Z');
    assert.ok(html.replace(/<[^>]*>/g, '').includes('ออกแล้ว เลขที่ WHT-CORRECTED วันที่')); assert.ok(!html.includes('wht-correct-payee'));
    resolve([{ ...handoff, certificateId: 'new', certificateNumber: 'WHT-CORRECTED', currentCertificate: { ...currentCertificate(), number: 'WHT-CORRECTED' } }]);
    await new Promise(done => setImmediate(done)); page.render(); toggleCorrection(page);
    assert.ok(page.render().includes('wht-correct-payee'));
  } finally { corrected.mock.restore(); list.mock.restore(); download.mock.restore(); }
});


test('the pinned page offers no issue action at any location until its handoff has an address', () => {
  const handoff = { ...correctionHandoff(), status: 'REQUIRED', systemIssuanceOpen: true, certificateId: null, currentCertificate: null, missing: [], payeeAddress: null };
  Object.assign(handoff.prefill.payeeSnapshot, { address: null });
  const page = setup(null, '', false, { correctionAction: null, detail: { ...detail(null), whtAmount: '42.06' }, whtHandoff: handoff, certificateRead: { row: handoff, loading: false, error: null } }, [...permissions, 'wht.certificate.issue']);
  const html = page.render(); assert.ok(!html.includes('ออกหนังสือรับรอง 50 ทวิ')); assert.ok(html.includes('เพิ่มที่อยู่'));
  page.state.whtHandoff = { ...handoff, payeeAddress: 'ที่อยู่ใหม่' }; page.state.certificateRead = { row: page.state.whtHandoff, loading: false, error: null };
  assert.ok(page.render().includes('ออกหนังสือรับรอง 50 ทวิ'));
});


test('C16 edit and void dialogs use the newly corrected handoff number instead of the expense load snapshot', async () => {
  const original = currentCertificate();
  const updated = { ...original, number: 'WHT-NEW', payee: { ...original.payee, address: 'ที่อยู่ใหม่' } };
  const request = mock.method(api, 'correctSystemWhtCertificate', async () => ({ id: 'cert-new', certificateNumber: updated.number, pdfArtifact: {} }));
  const list = mock.method(api, 'listWhtHandoffs', async () => [correctionHandoff(updated)]);
  const download = mock.method(downloads, 'downloadArtifact', () => {});
  try {
    const page = correctionPage(correctionHandoff(original));
    page.state.detail.correctionCapabilities.certificateOnExpense = { kind: 'SYSTEM', number: 'WHT-OLD', date: null, canCancel: true };
    page.render(); toggleCorrection(page); changeCorrection(page, 'payee-address', 'ที่อยู่ใหม่'); changeCorrection(page, 'reason', 'แก้ที่อยู่');
    await submitCorrection(page);
    page.state.correctionAction = {}; page.state.showVoid = true; page.render();
    assert.equal(page.nodes.find(node => node.tag === 'ExpenseCertificateReopen')!.props.certificate.number, 'WHT-NEW');
    assert.equal(page.nodes.find(node => node.tag === 'ExpenseCertificateVoidDialog')!.props.certificate.number, 'WHT-NEW');
  } finally { request.mock.restore(); list.mock.restore(); download.mock.restore(); }
});


test('C16 closing and reopening the expense edit keeps its reason and uses a destructive submit', () => {
  const page = setup({ kind: 'SYSTEM', number: 'WHT-1', date: null, canCancel: true }, 'เหตุผลที่จำไว้', true);
  page.render();
  assert.match(page.find('button', 'expense-correction-form').className, /mangmee-btn-danger/);
  const close = page.nodes.find(node => node.tag === 'Modal' && node.props.title === 'แก้ไขเอกสาร')!;
  close.props.onClose(); page.render();
  const reopen = page.nodes.find(node => node.tag === 'button' && node.props.children.includes('แก้ไขเอกสาร') && node.props.className?.includes('whitespace-nowrap'))!;
  reopen.props.onClick(); page.render();
  assert.equal(page.find('textarea', 'expense-correction-reason').value, 'เหตุผลที่จำไว้');
});

test('C16 reason guidance appears only after an invalid edit submit and editable certificate fields precede compact facts', async () => {
  const edit = setup({ kind: 'SYSTEM', number: 'WHT-1', date: null, canCancel: true }, '', true);
  assert.doesNotMatch(edit.render(), /กรุณาระบุเหตุผลอย่างน้อย/);
  assert.match(await edit.submit(), /กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร และไม่เกิน 500 ตัวอักษร/);
  const page = correctionPage(correctionHandoff(currentCertificate())); page.render(); const html = toggleCorrection(page);
  assert.ok(html.indexOf('wht-correct-payment-date') < html.indexOf('wht-correct-payee-name'));
  assert.ok(html.indexOf('wht-correct-payee-address') < html.indexOf('wht-correct-reason'));
  assert.ok(html.indexOf('ออกใบใหม่แทนใบเดิม') < html.indexOf('line-clamp-2'));
  assert.ok(html.indexOf('line-clamp-2') < html.indexOf('ถ้าส่วนนี้ผิด'));
  assert.doesNotMatch(html, /ปิดฟอร์มแก้ไข/);
});
