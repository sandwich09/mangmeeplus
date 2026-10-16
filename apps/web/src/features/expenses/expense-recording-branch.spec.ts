import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
require.extensions['.svg'] = (module: any) => { module.exports = () => null; };
const scope = mutable('../web-core-workspace/WorkspaceScope');
const policy = mutable('./expense-capture-policy');
const { ExpensesHubPage } = require('./ExpensesPages');
const noop = () => {};

test('R4 manual entry uses the header branch or sole branch; an unresolved branch stays neutral until a locked tap', () => {
  const branch = { id: 'b1', name: 'สำนักงานใหญ่', code: 'HO', isHeadOffice: true };
  const filter = { branches: [branch, { ...branch, id: 'b2', name: 'สาขา 2' }], branchId: '', setBranchId: noop, locked: false };
  const useFilter = mock.method(scope, 'useBranchFilter', () => filter);
  const capture = mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE', vatStatus: 'NOT_REGISTERED' }));
  const notices: string[] = []; let scrolled = 0;
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  (globalThis as any).window = { innerHeight: 800, scrollBy: () => scrolled++, matchMedia: () => ({ matches: true }) };
  const field = { closest: () => null, matches: () => true, getBoundingClientRect: () => ({ top: 900, bottom: 940, height: 40 }), focus: noop };
  (globalThis as any).document = { querySelector: (selector: string) => selector === '[data-transaction-branch-select]' ? field : null, querySelectorAll: () => [] };
  const view = certificateHarness(() => h(AppRouterContext.Provider, { value: { push: noop, replace: noop } as any },
    h(ToastContext.Provider, { value: { success: noop, warning: noop, error: (message: unknown) => { notices.push(String(message)); } } },
      h(ExpensesHubPage, { companyId: 'co', userId: 'owner', tab: 'manual', permissions: ['expense.create'] }))));
  try {
    view.render(); assert.equal(view.find('TransactionBranchField').invalid, false);
    assert.equal(view.find('TransactionBranchField').helpText, 'เลือกสาขาก่อนบันทึก');
    assert.equal(view.find('fieldset').disabled, true);
    view.find('div', props => Boolean(props.onClickCapture)).onClickCapture();
    view.render(); assert.equal(view.find('TransactionBranchField').invalid, true);
    assert.deepEqual(notices, ['เลือกสาขาก่อน จึงจะกรอกได้']); assert.equal(scrolled, 1);
    filter.branchId = 'b2'; view.render();
    assert.equal(view.find('TransactionBranchField').value, 'b2'); assert.equal(view.find('fieldset').disabled, false);
    assert.equal(view.find('TransactionBranchField').helpText, null);
    filter.branchId = ''; filter.branches = [branch]; view.render();
    assert.equal(view.find('TransactionBranchField').value, 'b1'); assert.equal(view.find('fieldset').disabled, false);
  } finally { useFilter.mock.restore(); capture.mock.restore(); (globalThis as any).document = oldDocument; globalThis.window = oldWindow; }
});

test('upload branch stays inside the card, preselects only a permitted header or sole branch and is neutral before send', () => {
  const branch = { id: 'b1', name: 'สำนักงานใหญ่', code: 'HO', isHeadOffice: true };
  const filter = { branches: [branch, { ...branch, id: 'b2' }], branchId: '', setBranchId: noop, locked: false };
  const useFilter = mock.method(scope, 'useBranchFilter', () => filter);
  const capture = mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE', vatStatus: 'NOT_REGISTERED' }));
  const view = certificateHarness(() => h(AppRouterContext.Provider, { value: { push: noop, replace: noop } as any },
    h(ToastContext.Provider, { value: { success: noop, warning: noop, error: noop } },
      h(ExpensesHubPage, { companyId: 'co', userId: 'owner', tab: 'upload', permissions: ['expense.create', 'expense.receipt.upload'] }))));
  try {
    const html = view.render();
    assert.equal(view.find('TransactionBranchField').invalid, false);
    assert.equal(view.find('TransactionBranchField').helpText, null);
    assert.equal(view.nodes.filter(n => n.tag === 'TransactionBranchField').length, 1);
    assert.match(html, /mangmee-flat/); assert.doesNotMatch(html, /การเงินและบัญชี/);
    assert.ok(html.indexOf('data-receipt-upload-picker') < html.indexOf('data-transaction-branch-select'));
    assert.ok(html.indexOf('data-transaction-branch-select') < html.indexOf('</section>'));
    assert.ok(html.indexOf('</section>') < html.indexOf('data-form-action-bar'));
    filter.branchId = 'b2'; view.render(); assert.equal(view.find('UploadPanel').branchId, 'b2');
    filter.branchId = 'other-shop'; view.render(); assert.equal(view.find('UploadPanel').branchId, '');
    filter.branches = [branch]; view.render(); assert.equal(view.find('UploadPanel').branchId, 'b1');
    filter.branches = []; view.render(); assert.equal(view.find('UploadPanel').branchId, '');
  } finally { view.cleanup(); useFilter.mock.restore(); capture.mock.restore(); }
});
