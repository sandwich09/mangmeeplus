import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { ToastContext } from '@/common/components/toast/use-toast';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
import { EXPENSE_VOID_CERTIFICATE_WORDS, expenseVoidCertificatePermissionMessage } from '@watchdog-bms/contracts';
import type { ExpenseCertificate } from './ExpenseCertificateReopen';
const api = mutable('./expenses.api');
const modal = mutable('@/common/components/modal/Modal');
const { ExpenseCertificateVoidDialog, expenseCertificateVoidedMessage } = require('./ExpenseCertificateVoidDialog');

function setup(kind: 'SYSTEM' | 'EXTERNAL' = 'SYSTEM', number: string | null = 'WHT-1', initial: unknown[] = [], extra: Record<string, unknown> = {}) {
  const successes: string[] = [];
  let closed = 0, refreshed = 0;
  const certificate: ExpenseCertificate = { kind, number, date: null, canCancel: true };
  const dialog = certificateHarness(() => h(ToastContext.Provider, { value: {
    success: message => successes.push(message), warning: () => {}, error: () => { throw new Error('refusal must stay in dialog'); },
  } }, h(ExpenseCertificateVoidDialog, { companyId: 'co', expenseId: 'expense', certificate,
    onClose: () => { closed++; }, onVoided: async () => { refreshed++; }, ...extra,
  })), initial);
  const transport = mock.method(modal, 'Modal', ({ children, footer, title }: any) => h('section', null, h('h2', null, title), children, footer));
  return { ...dialog, successes, certificate, closed: () => closed, refreshed: () => refreshed, restore: () => transport.mock.restore() };
}

test('void gives truthful SYSTEM/EXTERNAL copy, full-width safe-area buttons, and no backdrop close', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const number of ['WHT-1', null]) {
    const dialog = setup(kind, number);
    try {
      const html = dialog.render();
      assert.match(html, kind === 'SYSTEM' ? /ยกเลิกเอกสารที่ออกหนังสือรับรองแล้ว/ : /ยกเลิกเอกสารที่บันทึกหนังสือรับรองไว้/);
      assert.doesNotMatch(html, /กรุณาแจ้งผู้รับเงิน/);
      assert.match(html, /ยังไม่ได้ยื่นภาษีหัก ณ ที่จ่ายของรายการนี้/);
      assert.doesNotMatch(html, /ข้อมูลที่ยื่นไว้ไม่เปลี่ยนตาม/);
      assert.match(html, /mangmee-safe-bottom/); assert.match(html, /class="mangmee-safe-bottom grid w-full gap-2"/); assert.doesNotMatch(html, /sm:w-auto/);
      assert.equal(dialog.find('Modal').closeOnBackdrop, false);
      assert.equal(html.includes('เลขที่'), Boolean(number));
      if (kind === 'SYSTEM') assert.doesNotMatch(html, /ระบบยกเลิกใบที่ร้านออกเอง/);
      else assert.match(html, /ระบบยกเลิกใบที่ร้านออกเองให้ไม่ได้ ร้านต้องยกเลิกเอง/);
      assert.equal(expenseCertificateVoidedMessage(dialog.certificate), kind === 'SYSTEM'
        ? `ยกเลิกเอกสารและหนังสือรับรอง${number ? `เลขที่ ${number}` : ''} แล้ว`
        : `ยกเลิกเอกสารแล้ว และยกเลิกการบันทึกหนังสือรับรอง${number ? `เลขที่ ${number}` : ''} แล้ว`);
    } finally { dialog.restore(); }
  }
});

test('void requires the server\'s 3-character reason and the tick, keeps the reason limit and sanitizer, and closes without saving', () => {
  const dialog = setup();
  try {
    dialog.render(); assert.equal(dialog.find('button', p => p.type === 'submit').disabled, true);
    const input = dialog.find('textarea'); assert.equal(input.maxLength, 500);
    input.onChange({ target: { value: 'ก<>{}' } }); dialog.render();
    assert.equal(dialog.find('textarea').value, 'ก');
    assert.equal(dialog.find('button', p => p.type === 'submit').disabled, true);
    dialog.find('input').onChange({ target: { checked: true } });
    // One character is refused by the server (expense_void_reason_required): the button says so first.
    assert.doesNotMatch(dialog.render(), /อย่างน้อย 3 ตัวอักษร/);
    dialog.find('form').onSubmit({ preventDefault() {} });
    assert.match(dialog.render(), /อย่างน้อย 3 ตัวอักษร/);
    assert.equal(dialog.find('button', p => p.type === 'submit').disabled, false);
    dialog.find('textarea').onChange({ target: { value: 'แก้ยอด' } }); dialog.render();
    assert.equal(dialog.find('button', p => p.type === 'submit').disabled, false);
    dialog.find('button', p => p.type === 'button').onClick();
    assert.equal(dialog.closed(), 1); assert.equal(dialog.refreshed(), 0);
    assert.equal(setupFreshDisabled(), true);
  } finally { dialog.restore(); }
});
function setupFreshDisabled() {
  const fresh = setup();
  try { fresh.render(); return fresh.find('button', p => p.type === 'submit').disabled; }
  finally { fresh.restore(); }
}

test('void sends attestation, blocks repeated sends while busy, refreshes and closes after success', async () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    const calls: unknown[][] = [];
    let release!: () => void;
    const request = mock.method(api, 'voidExpense', (...args: unknown[]) => { calls.push(args); return new Promise<void>(resolve => { release = resolve; }); });
    const dialog = setup(kind, 'WHT-1', ['แก้ยอด', 'NOT_FILED']);
    try {
      dialog.render(); dialog.find('form').onSubmit({ preventDefault() {} });
      dialog.render();
      assert.equal(dialog.find('button', p => p.type === 'submit').disabled, true);
      assert.equal(dialog.find('button', p => p.type === 'submit')['aria-busy'], true);
      dialog.find('form').onSubmit({ preventDefault() {} });
      dialog.find('Modal').onClose(); assert.equal(dialog.closed(), 0);
      assert.deepEqual(calls, [['co', 'expense', 'แก้ยอด', true]]);
      release(); await dialog.settle();
      assert.equal(dialog.refreshed(), 1); assert.equal(dialog.closed(), 1);
      assert.deepEqual(dialog.successes, [expenseCertificateVoidedMessage(dialog.certificate)]);
    } finally { request.mock.restore(); dialog.restore(); }
  }
});

test('server refusals stay inside the open void dialog once, preserving reason and tick', async () => {
  for (const code of ['expense_changed_retry', 'tax_period_locked', 'certificate_permission_missing', 'expense_certificate_attestation_required']) {
    const message = apiErrorMessage({ code });
    const request = mock.method(api, 'voidExpense', async () => { throw { code, details: { code, message } }; });
    const dialog = setup('SYSTEM', 'WHT-1', ['แก้ยอด', 'NOT_FILED']);
    try {
      dialog.render(); dialog.find('form').onSubmit({ preventDefault() {} }); await dialog.settle();
      const html = dialog.render();
      assert.equal(html.split(message).length - 1, 1);
      assert.equal(dialog.closed(), 0); assert.equal(dialog.refreshed(), 0);
      assert.equal(dialog.find('textarea').value, 'แก้ยอด'); assert.equal(dialog.find('input').checked, true);
      assert.doesNotMatch(html, new RegExp(code)); assert.deepEqual(dialog.successes, []);
    } finally { request.mock.restore(); dialog.restore(); }
  }
});

test('certificate-free void keeps the original bottom reason box and reason-only API path', () => {
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /showVoid && !certificateVoidOpen &&/);
  assert.match(page, /voidExpense\(companyId, expenseId, reason.trim\(\)\)/);
});

test('certificate permission refusal appears before any form for both kinds', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    const dialog = setup(kind);
    dialog.certificate.canCancel = false;
    try {
      const html = dialog.render();
      assert.ok(html.includes(expenseVoidCertificatePermissionMessage(kind, 'WHT-1')));
      assert.doesNotMatch(html, /textarea|checkbox|<form/);
      assert.match(html, />ปิด<\/button>/);
      assert.equal((html.match(/<button/g) ?? []).length, 1);
    } finally { dialog.restore(); }
  }
});

test('a filed withholding month is refused before any form, with the server\'s sentence; other locked forms do not stop the dialog', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const formType of ['PND3', 'PND53'] as const) {
    const dialog = setup(kind, 'WHT-1', [], { lockedTaxPeriods: [{ formType: 'PP30', periodKey: '2026-09' }, { formType, periodKey: '2026-09' }] });
    try {
      const html = dialog.render().replaceAll('&quot;', '"');
      assert.ok(html.includes(EXPENSE_VOID_CERTIFICATE_WORDS.periodLocked(kind, '2026-09', formType)));
      assert.match(html, /ก.ย. 2569/); assert.doesNotMatch(html, /09\/2569/);
      assert.doesNotMatch(html, /textarea|checkbox|<form/);
      assert.equal((html.match(/<button/g) ?? []).length, 1); assert.match(html, />ปิด<\/button>/);
    } finally { dialog.restore(); }
  }
  const vatOnly = setup('SYSTEM', 'WHT-1', [], { lockedTaxPeriods: [{ formType: 'PP30', periodKey: '2026-09' }] });
  try { assert.match(vatOnly.render(), /<form/); } finally { vatOnly.restore(); }
});

test('status changed under the open void dialog displays the server sentence once and keeps the form', async () => {
  const message = EXPENSE_VOID_CERTIFICATE_WORDS.statusChanged;
  const request = mock.method(api, 'voidExpense', async () => { throw { code: 'expense_changed', details: { code: 'expense_changed', message } }; });
  const dialog = setup('SYSTEM', 'WHT-OLD', ['แก้ยอด', 'NOT_FILED']);
  try {
    dialog.render(); dialog.find('form').onSubmit({ preventDefault() {} }); await dialog.settle();
    const html = dialog.render();
    assert.equal(html.split(message).length - 1, 1);
    assert.doesNotMatch(html, /เอกสารถูกแก้ไขก่อนยกเลิก|expense_changed/);
    assert.equal(dialog.find('textarea').value, 'แก้ยอด'); assert.equal(dialog.find('input').checked, true);
    assert.equal(dialog.closed(), 0);
  } finally { request.mock.restore(); dialog.restore(); }
});

test('void toast uses the certificate actually cancelled by the server, including kind and a missing number', async () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const number of ['WHT-NEW', null]) {
    const cancelledCertificate = { kind, number };
    const request = mock.method(api, 'voidExpense', async () => ({ cancelledCertificate }));
    const dialog = setup(kind === 'SYSTEM' ? 'EXTERNAL' : 'SYSTEM', 'WHT-OLD', ['แก้ยอด', 'NOT_FILED']);
    try {
      dialog.render(); dialog.find('form').onSubmit({ preventDefault() {} }); await dialog.settle();
      assert.deepEqual(dialog.successes, [expenseCertificateVoidedMessage(cancelledCertificate)]);
      assert.doesNotMatch(dialog.successes.join(''), /WHT-OLD/);
    } finally { request.mock.restore(); dialog.restore(); }
  }
});

test('void facts precede reason, and the tick sits directly before footer buttons', () => {
  const dialog = setup();
  try {
    const html = dialog.render();
    assert.ok(html.indexOf('เอกสารนี้') < html.indexOf('<textarea'));
    assert.ok(html.indexOf('<textarea') < html.indexOf('type="radio"'));
    assert.ok(html.indexOf('type="radio"') < html.indexOf('<button'));
  } finally { dialog.restore(); }
});

test('void keeps bold certificate facts and only the self-issued consequence before reason', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    const dialog = setup(kind);
    try {
      const html = dialog.render(); const notice = html.slice(html.indexOf('<form'), html.indexOf('<textarea'));
      assert.equal((notice.match(/<p[ >]/g) ?? []).length, kind === 'SYSTEM' ? 1 : 2);
      assert.match(notice, /font-semibold/); assert.match(notice, /เลขที่ WHT-1/);
      assert.doesNotMatch(notice, /ถ้าเคยส่ง|เก็บไว้ในประวัติ/);
    } finally { dialog.restore(); }
  }
});

test('closing and reopening the same void dialog keeps its reason, success clears it', async () => {
  const extra = { open: true };
  const request = mock.method(api, 'voidExpense', async () => ({}));
  const dialog = setup('SYSTEM', 'WHT-1', [], extra);
  try {
    dialog.render(); dialog.find('textarea').onChange({ target: { value: 'เหตุผลเดิม' } }); dialog.render();
    extra.open = false; assert.equal(dialog.render(), '');
    extra.open = true; dialog.render(); assert.equal(dialog.find('textarea').value, 'เหตุผลเดิม');
    dialog.find('input', p => p.value === 'FILED').onChange(); assert.match(dialog.render(), /ข้อมูลที่ยื่นไว้ไม่เปลี่ยนตาม/);
    dialog.find('form').onSubmit({ preventDefault() {} }); await dialog.settle(); dialog.render();
    assert.equal(dialog.find('textarea').value, ''); assert.deepEqual(request.mock.calls[0]!.arguments, ['co', 'expense', 'เหตุผลเดิม', true]);
  } finally { request.mock.restore(); dialog.restore(); }
});
