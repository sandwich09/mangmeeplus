import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { ToastContext } from '@/common/components/toast/use-toast';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
import type { WhtCertificateRow } from './expense-wht-certificates.model';
const api = mutable('./expenses.api');
const modals = mutable('@/common/components/modal/Modal');
const { WhtPayeeAddressDialog } = require('./WhtPayeeAddressDialog');
const modal = mock.method(modals, 'Modal', ({ title, children, footer }: any) => h('section', null, h('h2', null, title), children, footer));
const row = { id: 'handoff', prefill: { payeeSnapshot: { address: null } }, payeeAddress: null } as WhtCertificateRow;
function setup(value = row) {
  const success: string[] = []; let saved = 0, closed = 0;
  const view = certificateHarness(() => h(ToastContext.Provider, { value: { success: (message: string) => success.push(message), error() { throw Error('no second toast'); }, warning() {} } },
    h(WhtPayeeAddressDialog, { companyId: 'co', row: value, locale: 'th', onSaved: () => saved++, onClose: () => closed++ })));
  return { ...view, success, saved: () => saved, closed: () => closed };
}
test('list address dialog validates, keeps typed text on refusal, and saves a trimmed address once', async () => {
  const refusal = 'รายจ่ายเปลี่ยนไปแล้ว กรุณาเปิดหน้านี้ใหม่';
  let reject = true;
  const save = mock.method(api, 'setWhtHandoffPayeeAddress', async (...args: any[]) => {
    assert.deepEqual(args, ['co', 'handoff', { payeeAddress: '99 ถนนทดสอบ' }]);
    if (reject) throw { code: 'expense_wht_source_changed', message: refusal };
    return { ...row, payeeAddress: '99 ถนนทดสอบ' };
  });
  const view = setup();
  try {
    assert.ok(view.render().includes('เพิ่มที่อยู่ผู้รับเงิน'));
    assert.equal(view.find('Modal').closeOnBackdrop, false);
    assert.equal(view.find('textarea').maxLength, 500);
    view.find('form').onSubmit({ preventDefault() {} }); await view.settle();
    assert.equal(save.mock.callCount(), 0); assert.ok(view.render().includes('กรุณากรอกที่อยู่ผู้รับเงิน'));
    view.find('textarea').onChange({ target: { value: ' 99 ถนนทดสอบ ' } }); view.render();
    view.find('form').onSubmit({ preventDefault() {} }); await view.settle();
    assert.ok(view.render().includes(refusal)); assert.equal(view.find('textarea').value, ' 99 ถนนทดสอบ ');
    assert.equal(view.saved(), 0); assert.deepEqual(view.success, []);
    reject = false;
    const submit = view.find('form').onSubmit;
    submit({ preventDefault() {} }); submit({ preventDefault() {} }); await view.settle();
    assert.equal(save.mock.callCount(), 2); assert.equal(view.saved(), 1);
    assert.deepEqual(view.success, ['บันทึกที่อยู่ผู้รับเงินแล้ว']);
  } finally { view.cleanup(); save.mock.restore(); }
});
test('address dialog prefills the typed address before the snapshot and can close without saving', () => {
  const view = setup({ ...row, payeeAddress: ' 99 ถนนใหม่ ', prefill: { payeeSnapshot: { address: 'ถนนเดิม' } } } as WhtCertificateRow);
  try {
    assert.ok(view.render().includes('แก้ไขที่อยู่ผู้รับเงิน'));
    assert.equal(view.find('textarea').value, '99 ถนนใหม่');
    view.find('Modal').onClose(); assert.equal(view.closed(), 1); assert.equal(view.saved(), 0);
  } finally { view.cleanup(); }
});
