import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS, type ReimbursementCancellationCertificate, type ReimbursementRequestDetail } from '@watchdog-bms/contracts';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { certificateHarness, h, mutable } from '../expenses/expense-certificate-test-harness';
const modal = mutable('@/common/components/modal/Modal');
const { ReimbursementCertificateCancelDialog, reimbursementCertificatesCancelledMessage } = require('./ReimbursementCertificateCancelDialog');
const certificate = (kind: 'SYSTEM' | 'EXTERNAL' = 'SYSTEM', number: string | null = 'WHT-1'): ReimbursementCancellationCertificate => ({ kind, number, expenseNumber: 'EXP-1' });
function setup(certificates = [certificate()], extra: Record<string, unknown> = {}, state: unknown[] = []) {
  const calls: unknown[][] = [];
  let closed = 0;
  const dialog = certificateHarness(() => h(ReimbursementCertificateCancelDialog, {
    title: 'ยกเลิกใบเบิก', certificates, onClose: () => { closed++; }, onConfirm: (...args: unknown[]) => calls.push(args), ...extra,
  }), state);
  const transport = mock.method(modal, 'Modal', ({ children, footer, title }: any) => h('section', null, h('h2', null, title), children, footer));
  return { ...dialog, calls, closed: () => closed, restore: () => transport.mock.restore() };
}

test('claim cancellation explains each certificate kind, omits absent numbers, and names the print button', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const number of ['WHT-1', null]) {
    const facts = certificate(kind, number);
    const dialog = setup([facts]);
    try {
      const html = dialog.render();
      assert.match(html, kind === 'SYSTEM' ? /ใบเบิกนี้มีรายจ่ายที่ออกหนังสือรับรอง/ : /ใบเบิกนี้มีรายจ่ายที่บันทึกไว้ว่าออกหนังสือรับรอง/);
      assert.match(html, kind === 'SYSTEM' ? /ระบบจะยกเลิกหนังสือรับรองใบนี้ด้วย/ : /ระบบยกเลิกหนังสือรับรองที่คุณออกเองให้ไม่ได้ ยกเลิกใบนั้นเอง/);
      assert.equal(html.includes(t('wht.print_certificate', 'th')), kind === 'SYSTEM');
      if (kind === 'EXTERNAL') assert.match(html, /ให้ทำใบเบิกใหม่ด้วยข้อมูลที่ถูก แล้วบันทึกหนังสือรับรองใบใหม่/);
      assert.match(html, /ถ้าเคยส่งใบให้ผู้รับเงินแล้ว แจ้งผู้รับเงินว่าใบนี้ยกเลิก/);
      assert.match(html, /<label[^>]*>เหตุผลที่ยกเลิกใบเบิก/);
      assert.match(html, /ใบเบิกที่ยกเลิกแล้วนำกลับมาใช้อีกไม่ได้/);
      assert.equal(html.includes('เลขที่'), Boolean(number));
      assert.equal(dialog.find('Modal').closeOnBackdrop, false);
      assert.match(html, /mangmee-safe-bottom/);
      assert.match(html, /w-full sm:w-auto/);
      assert.equal(dialog.find('button', p => p.type === 'submit').children[0], kind === 'SYSTEM' ? 'ยกเลิกใบเบิกและหนังสือรับรอง' : 'ยกเลิกใบเบิก');
      assert.equal(reimbursementCertificatesCancelledMessage([facts]), kind === 'SYSTEM'
        ? `ยกเลิกใบเบิกและหนังสือรับรอง${number ? `เลขที่ ${number}` : ''} แล้ว`
        : `ยกเลิกใบเบิกแล้ว และยกเลิกการบันทึกหนังสือรับรอง${number ? `เลขที่ ${number}` : ''} แล้ว`);
    } finally { dialog.restore(); }
  }
});

test('multiple certificate numbers get separate fact paragraphs; facts, reason, tick, then buttons', () => {
  const dialog = setup([certificate(), certificate('EXTERNAL', 'EXT-2')]);
  try {
    const html = dialog.render();
    assert.match(html, /เลขที่ WHT-1<\/span>/); assert.match(html, /เลขที่ EXT-2<\/span>/);
    assert.ok(html.indexOf('ใบเบิกนี้') < html.indexOf('<textarea'));
    assert.ok(html.indexOf('<textarea') < html.indexOf('type="checkbox"'));
    assert.ok(html.indexOf('type="checkbox"') < html.indexOf('<button'));
  } finally { dialog.restore(); }
});

test('claim requires reason and tick, sends attestation, sanitizes and prevents busy submissions', () => {
  const dialog = setup();
  try {
    dialog.render(); assert.equal(dialog.find('button', p => p.type === 'submit').disabled, true);
    dialog.find('textarea').onChange({ target: { value: 'แก้<>{}ข้อมูล' } }); dialog.render();
    assert.equal(dialog.find('textarea').value, 'แก้ข้อมูล');
    assert.equal(dialog.find('textarea').maxLength, 500);
    dialog.find('form').onSubmit({ preventDefault() {} }); assert.deepEqual(dialog.calls, []);
    dialog.find('input').onChange({ target: { checked: true } }); dialog.render();
    assert.equal(dialog.find('button', p => p.type === 'submit').disabled, false);
    dialog.find('form').onSubmit({ preventDefault() {} }); assert.deepEqual(dialog.calls, [['แก้ข้อมูล', true]]);
  } finally { dialog.restore(); }
  const busy = setup([certificate()], { busy: true }, ['แก้ข้อมูล', true]);
  try {
    busy.render(); busy.find('form').onSubmit({ preventDefault() {} }); busy.find('Modal').onClose();
    assert.equal(busy.find('button', p => p.type === 'submit').disabled, true);
    assert.equal(busy.find('button', p => p.type === 'submit')['aria-busy'], true);
    assert.deepEqual(busy.calls, []); assert.equal(busy.closed(), 0);
  } finally { busy.restore(); }
});

test('server blockers per kind and code show facts, the exact refusal and only close without a form', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const continuation of [false, true]) {
    const facts = certificate(kind);
    for (const blocker of [
      { code: 'certificate_permission_missing', message: REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.permissionMissing(facts) },
      { code: 'reimbursement_cancellation_tax_period_locked', message: REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.periodLocked(kind, '2026-10', 'PND53') },
      { code: 'reimbursement_cancellation_certificate_issued', message: REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.taxWorkspaceCertificate },
    ]) {
      const dialog = setup([facts], { blocker, continuation });
      try {
        const html = dialog.render().replaceAll('&quot;', '"');
        const refusal = blocker.code === 'certificate_permission_missing' ? blocker.message.slice(blocker.message.indexOf('การยกเลิกใบเบิก')) : blocker.message;
        assert.equal(html.split(refusal).length - 1, 1);
        assert.ok(html.indexOf('เลขที่ WHT-1') < html.indexOf(refusal));
        if (blocker.code === 'certificate_permission_missing') assert.equal((html.match(/ใบเบิกนี้มีรายจ่ายที่/g) ?? []).length, 1);
        if (blocker.code.includes('tax_period_locked')) { assert.match(html, /ต.ค. 2569/); assert.doesNotMatch(html, /10\/2569/); }
        assert.doesNotMatch(html, /<form|textarea|checkbox/);
        assert.equal((html.match(/<button/g) ?? []).length, 1);
        assert.match(html, />ปิด<\/button>/);
        dialog.find('button').onClick(); assert.equal(dialog.closed(), 1); assert.deepEqual(dialog.calls, []);
      } finally { dialog.restore(); }
    }
  }
});

test('continuation uses the stored reason and never asks for or resends the tick', () => {
  const facts = certificate();
  const dialog = setup([facts], { continuation: true, initialReason: 'เหตุผลเดิม' });
  try {
    const html = dialog.render(); assert.doesNotMatch(html, /checkbox|ยังไม่ได้ยื่นภาษี/);
    assert.equal(dialog.find('textarea').value, 'เหตุผลเดิม');
    dialog.find('form').onSubmit({ preventDefault() {} }); assert.deepEqual(dialog.calls, [['เหตุผลเดิม', undefined]]);
  } finally { dialog.restore(); }
});

test('server refusal appears once with fields retained, and page keeps the certificate-free dialog', () => {
  const error = REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.periodLocked('EXTERNAL', '2026-10', 'PND53');
  const dialog = setup([certificate()], { error }, ['แก้ข้อมูล', true]);
  try {
    const html = dialog.render(); assert.equal(html.split(error).length - 1, 1);
    assert.equal(dialog.find('textarea').value, 'แก้ข้อมูล'); assert.equal(dialog.find('input').checked, true);
  } finally { dialog.restore(); }
  const page = readFileSync(new URL('./ReimbursementJourneyPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /certificateCancellation \? <ReimbursementCertificateCancelDialog/);
  assert.match(page, /cancelReimbursement\(companyId, requestId, reason, taxFilingAttested\)/);
  assert.match(page, /: <ReasonDialog/);
});

test('claim refusals name the first expense and additional items only when an expense number is known', () => {
  for (const blocked of [false, true]) for (const count of [1, 3]) for (const known of [false, true]) {
    const certificates = Array.from({ length: count }, (_, index) => ({ ...certificate(), expenseNumber: known ? `EXP-${index + 1}` : null }));
    const message = 'ใช้ปุ่มแก้ไขหนังสือรับรองที่หน้ารายจ่าย';
    const dialog = setup(certificates, blocked ? { blocker: { code: 'tax_period_locked', message } } : { error: message });
    try {
      const html = dialog.render();
      const expected = known ? `ที่หน้ารายจ่ายเลขที่ EXP-1${count > 1 ? ` และอีก ${count - 1} รายการ` : ''}` : 'ที่หน้ารายจ่าย';
      assert.equal(html.split(expected).length - 1, 1);
      assert.doesNotMatch(html, /EXP-2|EXP-3|undefined|null/);
      if (blocked) assert.doesNotMatch(html, /<form|textarea|checkbox/);
    } finally { dialog.restore(); }
  }
});

test('claim page wires certificate permission and attestation to the real cancel request without a duplicate refusal', async () => {
  const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime');
  const { ToastContext } = require('@/common/components/toast/use-toast');
  require.extensions['.svg'] = (module: any) => { module.exports = () => null; };
require.extensions['.css'] = module => { module.exports = { menu: 'menu', panel: 'panel' }; };
  const { ReimbursementJourneyPage } = require('./ReimbursementJourneyPage');
  const source = readFileSync(new URL('./ReimbursementJourneyPage.tsx', import.meta.url), 'utf8');
  const names = [...source.matchAll(/const \[(\w+),[^\n]*useState/g)].map(match => match[1]);
  const originalFetch = globalThis.fetch;
  const successes: string[] = [];
  const transport = mock.method(modal, 'Modal', ({ open, children, footer, title }: any) => open ? h('section', null, h('h2', null, title), children, footer) : null);
  try {
    for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const allowed of [true, false]) {
      const facts = certificate(kind);
      const claim = { id: 'claim', requestNo: 'RB-1', status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', requesterUserId: 'staff',
        amount: '100', outstandingAmount: '100', currency: 'THB', lines: [], approvalSteps: [], payments: [], signatures: [], signedCopies: [],
        certificates: [facts], certificateCancelAllowed: allowed,
        ...(!allowed && { certificateCancelBlocker: { code: 'certificate_permission_missing', message: REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.permissionMissing(facts) } }) };
      const state: unknown[] = [];
      state[1 + names.indexOf('detail')] = claim;
      state[1 + names.indexOf('reasonAction')] = 'cancel';
      const permissions = ['reimbursement.cancel_own', ...(allowed ? [kind === 'SYSTEM' ? 'wht.certificate.correct' : 'wht.external_certificate.link'] : [])];
      const view = certificateHarness(() => h(AppRouterContext.Provider, { value: { push() {}, replace() {}, back() {}, prefetch() {}, forward() {}, refresh() {}, bfcacheId: 'test' } },
        h(ToastContext.Provider, { value: { success: (message: string) => successes.push(message), error() {}, warning() {} } },
          h(ReimbursementJourneyPage, { companyId: 'co', requestId: 'claim', userId: 'staff', permissions }))), state);
      let html = view.render();
      if (!allowed) {
        const refusal = REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.permissionMissing(facts);
        assert.ok(html.includes(refusal.slice(refusal.indexOf('การยกเลิกใบเบิก'))));
        assert.doesNotMatch(html, /reimbursement-certificate-cancel-form|type="checkbox"/);
        continue;
      }
      const bodies: unknown[] = [];
      const refusal = REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.periodLocked(kind, '2026-10', 'PND53');
      globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') {
          bodies.push(JSON.parse(String(init.body)));
          return Response.json({ code: 'reimbursement_cancellation_tax_period_locked', message: refusal }, { status: 409 });
        }
        return Response.json(claim);
      }) as typeof fetch;
      view.find('textarea', p => p.placeholder === 'ระบุเหตุผลให้ชัดเจน').onChange({ target: { value: 'แก้ข้อมูล' } });
      view.render(); view.find('input', p => p.type === 'checkbox').onChange({ target: { checked: true } });
      view.render(); view.find('form', p => p.id === 'reimbursement-certificate-cancel-form').onSubmit({ preventDefault() {} });
      await view.settle(); html = view.render();
      assert.deepEqual(bodies, [{ reason: 'แก้ข้อมูล', taxFilingAttested: true }]);
      assert.equal(html.replaceAll('&quot;', '"').split(refusal).length - 1, 1);
      assert.equal(view.find('textarea', p => p.placeholder === 'ระบุเหตุผลให้ชัดเจน').value, 'แก้ข้อมูล');
      assert.equal(view.find('input', p => p.type === 'checkbox').checked, true);
      assert.deepEqual(successes, []);
    }
  } finally { transport.mock.restore(); globalThis.fetch = originalFetch; }
});

test('continuation missing stored attestation requires the tick and sends it once given', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    const dialog = setup([certificate(kind)], { continuation: true, attestationRequired: true, initialReason: 'เหตุผลเดิม' });
    try {
      const html = dialog.render();
      assert.match(html, /ยังไม่ได้ยื่นภาษีหัก ณ ที่จ่ายของรายการนี้ หรือจะยื่นแก้ไขเพิ่มเติมเอง/);
      // Closing a continuation withdraws nothing, so its button does not say "ไม่ยกเลิก".
      assert.match(html, />ปิด<\/button>/); assert.doesNotMatch(html, /ไม่ยกเลิก/);
      assert.equal(dialog.find('button', p => p.type === 'submit').disabled, true);
      dialog.find('form').onSubmit({ preventDefault() {} }); assert.deepEqual(dialog.calls, []);
      dialog.find('input').onChange({ target: { checked: true } }); dialog.render();
      assert.equal(dialog.find('button', p => p.type === 'submit').disabled, false);
      dialog.find('form').onSubmit({ preventDefault() {} }); assert.deepEqual(dialog.calls, [['เหตุผลเดิม', true]]);
    } finally { dialog.restore(); }
  }
});

test('claim page resumes directly with stored attestation and opens the required tick when it is missing', async () => {
  const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime');
  const { ToastContext } = require('@/common/components/toast/use-toast');
  require.extensions['.svg'] = (module: any) => { module.exports = () => null; };
  const { ReimbursementJourneyPage } = require('./ReimbursementJourneyPage');
  const source = readFileSync(new URL('./ReimbursementJourneyPage.tsx', import.meta.url), 'utf8');
  const names = [...source.matchAll(/const \[(\w+),[^\n]*useState/g)].map(match => match[1]);
  const originalFetch = globalThis.fetch;
  const transport = mock.method(modal, 'Modal', ({ open, children, footer, title }: any) => open ? h('section', null, h('h2', null, title), children, footer) : null);
  try {
    for (const needsAttestation of [false, true]) {
      const claim = { id: 'claim', requestNo: 'RB-1', status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', requesterUserId: 'staff',
        amount: '100', outstandingAmount: '100', currency: 'THB', lines: [], approvalSteps: [], payments: [], signatures: [], signedCopies: [],
        certificates: [certificate()], certificateCancelAllowed: true, pendingCancellation: { startedAt: '2026-10-11T08:00:00Z', reason: 'เหตุผลเดิม', canResume: true, canWithdraw: true,
          ...(needsAttestation && { blocker: { code: 'certificate_attestation_required', message: REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.attestationRequired } }) } };
      const bodies: unknown[] = [], successes: string[] = [];
      globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') bodies.push(JSON.parse(String(init.body)));
        return Response.json({ ...claim, status: 'CANCELLED', certificates: [], ...(init?.method === 'POST' && { cancelledCertificates: [{ expenseId: 'exp-1', kind: 'EXTERNAL', number: 'WHT-NEW' }] }) });
      }) as typeof fetch;
      const state: unknown[] = [];
      state[1 + names.indexOf('detail')] = claim;
      const view = certificateHarness(() => h(AppRouterContext.Provider, { value: { push() {}, replace() {}, back() {}, prefetch() {}, forward() {}, refresh() {}, bfcacheId: 'test' } },
        h(ToastContext.Provider, { value: { success: (message: string) => successes.push(message), error() {}, warning() {} } },
          h(ReimbursementJourneyPage, { companyId: 'co', requestId: 'claim', userId: 'staff', permissions: ['reimbursement.cancel_own', 'wht.certificate.correct'] }))), state);
      const before = view.render();
      if (needsAttestation) assert.doesNotMatch(before, /ระบบจะทำต่อให้เองภายในไม่กี่นาที/);
      view.find('button', p => p.children.includes('ทำต่อเพื่อยกเลิก')).onClick();
      if (needsAttestation) {
        assert.deepEqual(bodies, []);
        const html = view.render(); assert.match(html, /เลขที่ WHT-1/);
        assert.equal(view.find('button', p => p.type === 'submit').disabled, true);
        view.find('input', p => p.type === 'checkbox').onChange({ target: { checked: true } });
        view.render(); view.find('form', p => p.id === 'reimbursement-certificate-cancel-form').onSubmit({ preventDefault() {} });
      }
      await view.settle(); const html = view.render();
      assert.deepEqual(bodies, [needsAttestation ? { reason: 'เหตุผลเดิม', taxFilingAttested: true } : {}]);
      assert.deepEqual(successes, [reimbursementCertificatesCancelledMessage([{ kind: 'EXTERNAL', number: 'WHT-NEW' }])]);
      assert.doesNotMatch(html, /reimbursement-certificate-cancel-form|type="checkbox"/);
    }
  } finally { transport.mock.restore(); globalThis.fetch = originalFetch; }
});

test('first claim cancel toast uses every server cancelled certificate and falls back only when the answer has none', async () => {
  const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime');
  const { ToastContext } = require('@/common/components/toast/use-toast');
  require.extensions['.svg'] = (module: any) => { module.exports = () => null; };
  const { ReimbursementJourneyPage } = require('./ReimbursementJourneyPage');
  const source = readFileSync(new URL('./ReimbursementJourneyPage.tsx', import.meta.url), 'utf8');
  const names = [...source.matchAll(/const \[(\w+),[^\n]*useState/g)].map(match => match[1]);
  const originalFetch = globalThis.fetch;
  const transport = mock.method(modal, 'Modal', ({ open, children, footer, title }: any) => open ? h('section', null, h('h2', null, title), children, footer) : null);
  const answers: Array<ReimbursementRequestDetail['cancelledCertificates']> = [
    [{ expenseId: 'exp-1', kind: 'SYSTEM', number: 'WHT-NEW' }, { expenseId: 'exp-2', kind: 'EXTERNAL', number: 'EXT-NEW' }],
    [{ expenseId: 'exp-1', kind: 'EXTERNAL', number: null }], [], undefined,
  ];
  try {
    for (const cancelledCertificates of answers) {
      const claim = { id: 'claim', requestNo: 'RB-1', status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', requesterUserId: 'staff',
        amount: '100', outstandingAmount: '100', currency: 'THB', lines: [], approvalSteps: [], payments: [], signatures: [], signedCopies: [],
        certificates: [certificate('SYSTEM', 'WHT-OLD')], certificateCancelAllowed: true };
      const bodies: unknown[] = [], successes: string[] = [];
      globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') {
          bodies.push(JSON.parse(String(init.body)));
          return Response.json({ ...claim, status: 'CANCELLED', cancelledCertificates });
        }
        // A later GET has no command-result certificate facts.
        return Response.json({ ...claim, status: 'CANCELLED', certificates: [] });
      }) as typeof fetch;
      const state: unknown[] = [];
      state[1 + names.indexOf('detail')] = claim;
      state[1 + names.indexOf('reasonAction')] = 'cancel';
      const view = certificateHarness(() => h(AppRouterContext.Provider, { value: { push() {}, replace() {}, back() {}, prefetch() {}, forward() {}, refresh() {}, bfcacheId: 'test' } },
        h(ToastContext.Provider, { value: { success: (message: string) => successes.push(message), error() {}, warning() {} } },
          h(ReimbursementJourneyPage, { companyId: 'co', requestId: 'claim', userId: 'staff', permissions: ['reimbursement.cancel_own', 'wht.certificate.correct'] }))), state);
      view.render(); view.find('textarea', p => p.placeholder === 'ระบุเหตุผลให้ชัดเจน').onChange({ target: { value: 'แก้ข้อมูล' } });
      view.render(); view.find('input', p => p.type === 'checkbox').onChange({ target: { checked: true } });
      view.render(); view.find('form', p => p.id === 'reimbursement-certificate-cancel-form').onSubmit({ preventDefault() {} });
      await view.settle(); view.render();
      assert.deepEqual(bodies, [{ reason: 'แก้ข้อมูล', taxFilingAttested: true }]);
      assert.deepEqual(successes, [reimbursementCertificatesCancelledMessage(cancelledCertificates ?? claim.certificates)]);
      if (cancelledCertificates) assert.doesNotMatch(successes.join(''), /WHT-OLD|exp-1|exp-2/);
    }
  } finally { transport.mock.restore(); globalThis.fetch = originalFetch; }
});
