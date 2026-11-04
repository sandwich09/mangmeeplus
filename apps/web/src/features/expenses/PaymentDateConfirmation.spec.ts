import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { ToastContext } from '@/common/components/toast/use-toast';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
const api = mutable('./expenses.api');
const { PaymentDateConfirmation } = require('./PaymentDateConfirmation');
test('unknown payment date starts blank, keeps input on refusal and records only the chosen date', async () => {
  let saved = 0, fail = true;
  const success = mock.fn();
  const toast = { success, warning: mock.fn(), error: mock.fn() };
  const request = mock.method(api, 'confirmExpensePaymentDate', async (...args: unknown[]) => { assert.deepEqual(args, ['co', 'e', 'p', '2026-09-05']); if (fail) throw Error('ลองอีกครั้ง'); });
  const view = certificateHarness(() => h(ToastContext.Provider, { value: toast }, h(PaymentDateConfirmation, { companyId: 'co', expenseId: 'e', paymentId: 'p', canRecord: true, onSaved: () => { saved++; } })));
  try {
    view.render(); assert.equal(view.find('ThemedDate').value, '');
    view.find('ThemedDate').onChange({ target: { value: '2026-09-05' } }); view.render();
    await view.find('form').onSubmit({ preventDefault() {} }); assert.match(view.render(), /ลองอีกครั้ง/); assert.equal(view.find('ThemedDate').value, '2026-09-05');
    assert.equal(success.mock.callCount(), 0);
    fail = false; await view.find('form').onSubmit({ preventDefault() {} }); assert.equal(saved, 1);
    assert.deepEqual(success.mock.calls.map(call => call.arguments), [['บันทึกวันที่จ่ายแล้ว รายการนี้อยู่ในแบบเดือน ก.ย. 2569']]);
  } finally { request.mock.restore(); view.cleanup(); }
});


test('confirmed month reaches the page notice after refresh, even if refresh fails, without a second toast', async () => {
  for (const refreshFails of [false, true]) {
    const success = mock.fn();
    const confirmed = mock.fn();
    const request = mock.method(api, 'confirmExpensePaymentDate', async () => ({}));
    let refreshed = false;
    const view = certificateHarness(() => h(ToastContext.Provider, { value: { success, warning: mock.fn(), error: mock.fn() } },
      h(PaymentDateConfirmation, { companyId: 'co', expenseId: 'e', paymentId: 'p', canRecord: true,
        onSaved: async () => { refreshed = true; if (refreshFails) throw Error('ลองอีกครั้ง'); },
        onConfirmed: (month: string, message: string) => { assert.equal(refreshed, true); confirmed(month, message); } })));
    try {
      view.render(); view.find('ThemedDate').onChange({ target: { value: '2026-09-05' } }); view.render();
      await view.find('form').onSubmit({ preventDefault() {} });
      assert.deepEqual(confirmed.mock.calls.map(call => call.arguments), [['2026-09', 'บันทึกวันที่จ่ายแล้ว รายการนี้อยู่ในแบบเดือน ก.ย. 2569']]);
      assert.equal(success.mock.callCount(), 0);
    } finally { request.mock.restore(); view.cleanup(); }
  }
});

test('e-WHT date confirmation uses bank sentences and warns only for an expired reduced 1%', async () => {
  const { E_WHT_WORDS } = require('@watchdog-bms/contracts');
  const success = mock.fn(); const request = mock.method(api, 'confirmExpensePaymentDate', async () => ({}));
  const view = certificateHarness(() => h(ToastContext.Provider, { value: { success, warning: mock.fn(), error: mock.fn() } },
    h(PaymentDateConfirmation, { companyId: 'co', expenseId: 'e', paymentId: 'p', canRecord: true, whtRemittance: 'E_WHT', whtCategoryCode: 'WHT_ADVERTISING_IND', whtRate: '1', onSaved: () => {} })));
  try {
    assert.ok(view.render().includes(E_WHT_WORDS['W-PD1']));
    view.find('ThemedDate').onChange({ target: { value: '2022-12-31' } }); assert.ok(view.render().includes(E_WHT_WORDS['W-P2']));
    await view.find('form').onSubmit({ preventDefault() {} }); assert.equal(success.mock.calls[0].arguments[0], E_WHT_WORDS['W-PD2']);
  } finally { request.mock.restore(); view.cleanup(); }
});
