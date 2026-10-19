import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: {} }; };
require.extensions['.svg'] = m => { m.exports = () => null; };
const api = mutable('./expenses.api');
const toast = mutable('@/common/components/toast/use-toast');
const modal = mutable('@/common/components/modal');
const { SignaturePanel } = require('./ExpensesWorkspacePanels');
const noop = () => {};

test('signature load failure retries the read and recovers without offering an upload too early', async () => {
  let finish!: (value: any[]) => void;
  const read = mock.method(api, 'listSignatureAssets', () => new Promise<any[]>(resolve => { finish = resolve; }));
  const notifications = mock.method(toast, 'useToast', () => ({ success: noop, warning: noop, error: noop }));
  const confirm = mock.method(modal, 'useConfirm', () => ({ confirm: noop, confirmDialog: null }));
  const view = certificateHarness(() => h(SignaturePanel, { companyId: 'co' }), [[], false, 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง']);
  try {
    const failed = view.render();
    assert.match(failed, /ลองอีกครั้ง/);
    assert.doesNotMatch(failed, /เพิ่มลายเซ็น/);
    view.find('ErrorState').onRetry();
    assert.match(view.render(), /กำลังโหลด/);
    assert.equal(read.mock.callCount(), 1);
    assert.deepEqual(read.mock.calls[0]!.arguments, ['co']);
    finish([]); await view.settle();
    const recovered = view.render();
    assert.match(recovered, /เพิ่มลายเซ็น/);
    assert.doesNotMatch(recovered, /เชื่อมต่อไม่ได้|โหลดไม่สำเร็จ/);
  } finally { view.cleanup(); read.mock.restore(); notifications.mock.restore(); confirm.mock.restore(); }
});
