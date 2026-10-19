import assert from 'node:assert/strict';
import { after, test, mock } from 'node:test';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
require.extensions['.svg'] = module => { module.exports = () => null; };
const api = mutable('./expenses.api');
const toast = mutable('@/common/components/toast/use-toast');
require('next/link');
const linkModule = require.cache[require.resolve('next/link')]!;
const originalLink = linkModule.exports;
linkModule.exports = { __esModule: true, default: ({ href, children, ...props }: any) => h('a', { ...props, href }, children) };
after(() => { linkModule.exports = originalLink; });
const { SubstituteReceiptSettingsPage } = require('./SubstituteReceiptSettingsPage');
const runtime = require('react');
const STRICT = 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE';
const ALLOW = 'ALLOW_SUPPORTING_EVIDENCE_ONLY';
const policy = (overrides = {}) => ({ approvalMode: 'OWNER_SELF', approverUserIds: [], invalidApproverUserIds: [], cashEvidencePolicy: STRICT,
  cashEvidenceInstructions: null, approverCandidates: [{ userId: 'approver', displayName: 'สมใจ' }], configured: true, ready: true, ...overrides });
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<any>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function screen(initial?: any) {
  const refs: any[] = [];
  const page = certificateHarness(() => h(SubstituteReceiptSettingsPage, { companyId: 'co' }), initial
    ? [initial, initial.approvalMode, initial.approverUserIds, initial.cashEvidencePolicy, initial.cashEvidenceInstructions ?? '', false] : []);
  const render = (effects = false) => {
    let index = 0;
    const ref = mock.method(runtime, 'useRef', (value: any) => refs[index++] ?? (refs[index - 1] = { current: value }));
    try { return page.render(effects); } finally { ref.mock.restore(); }
  };
  const choice = (label: string) => {
    const node = page.nodes.find(node => node.props.label === label);
    assert.ok(node, `missing choice ${label}`); return node.props;
  };
  return { ...page, render, choice, save: () => page.find('button', props => props.children.includes('บันทึกการตั้งค่า')).onClick() };
}
const allowLabel = 'ใช้หลักฐานประกอบอย่างเดียวได้';
const noop = () => {};

test('two settings reads cannot undo a radio choice or make save send the previous policy', async () => {
  const reads = [deferred(), deferred()]; let index = 0;
  const read = mock.method(api, 'getSubstituteReceiptPolicy', () => reads[index++]!.promise);
  const write = mock.method(api, 'updateSubstituteReceiptPolicy', async (_company: string, input: any) => policy(input));
  const notify = mock.method(toast, 'useToast', () => ({ success: noop }));
  const view = screen();
  try {
    view.render(true); view.render(true);
    assert.equal(read.mock.callCount(), 2);
    reads[1]!.resolve(policy()); await view.settle(); view.render();
    view.choice(allowLabel).onChange(); view.render();
    reads[0]!.resolve(policy()); await view.settle(); view.render();
    assert.equal(view.choice(allowLabel).checked, true);
    view.save(); await view.settle(); view.render();
    assert.equal(write.mock.calls[0]!.arguments[1].cashEvidencePolicy, ALLOW);
    assert.equal(view.choice(allowLabel).checked, true);
  } finally { view.cleanup(); read.mock.restore(); write.mock.restore(); notify.mock.restore(); }
});

test('only the newest settings read can open the form and reads after cleanup do nothing', async () => {
  const reads = [deferred(), deferred(), deferred()]; let index = 0;
  const read = mock.method(api, 'getSubstituteReceiptPolicy', () => reads[index++]!.promise);
  const notify = mock.method(toast, 'useToast', () => ({ success: noop }));
  const view = screen();
  try {
    view.render(true); view.render(true);
    reads[0]!.resolve(policy({ cashEvidencePolicy: ALLOW })); await view.settle();
    assert.match(view.render(), /กำลังโหลด/);
    reads[1]!.resolve(policy()); await view.settle(); view.render();
    assert.equal(view.choice(allowLabel).checked, false);
    view.render(true); view.cleanup();
    const before = [...view.state];
    reads[2]!.reject(new Error('obsolete read')); await view.settle();
    assert.deepEqual(view.state, before);
  } finally { view.cleanup(); read.mock.restore(); notify.mock.restore(); }
});

test('a current settings read preserves every field edited since the form opened', async () => {
  for (const field of ['cash', 'approval', 'approvers', 'instructions']) {
    const pending = deferred();
    const read = mock.method(api, 'getSubstituteReceiptPolicy', () => pending.promise);
    const notify = mock.method(toast, 'useToast', () => ({ success: noop }));
    const original = policy(field === 'approvers' ? { approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver'] } : {});
    const view = screen(original);
    try {
      view.render(true);
      if (field === 'cash') view.choice(allowLabel).onChange();
      if (field === 'approval') view.choice('กำหนดผู้อนุมัติ').onChange();
      if (field === 'approvers') view.choice('สมใจ').onChange();
      if (field === 'instructions') view.find('textarea').onChange({ target: { value: 'คำแนะนำที่กำลังแก้' } });
      pending.resolve(original); await view.settle(); view.render();
      if (field === 'cash') assert.equal(view.choice(allowLabel).checked, true);
      if (field === 'approval') assert.equal(view.choice('กำหนดผู้อนุมัติ').checked, true);
      if (field === 'approvers') assert.equal(view.choice('สมใจ').checked, false);
      if (field === 'instructions') assert.equal(view.find('textarea').value, 'คำแนะนำที่กำลังแก้');
    } finally { view.cleanup(); read.mock.restore(); notify.mock.restore(); }
  }
});

test('a successful save is the pristine baseline and an outstanding old read cannot roll it back', async () => {
  const pending = deferred();
  const read = mock.method(api, 'getSubstituteReceiptPolicy', () => pending.promise);
  const write = mock.method(api, 'updateSubstituteReceiptPolicy', async (_company: string, input: any) => policy({ ...input, cashEvidenceInstructions: 'คำแนะนำจากคำตอบบันทึก' }));
  const notify = mock.method(toast, 'useToast', () => ({ success: noop }));
  const view = screen(policy());
  try {
    view.render(); view.choice(allowLabel).onChange();
    view.render(true); view.save(); await view.settle(); view.render();
    assert.equal(view.choice(allowLabel).checked, true);
    assert.equal(view.find('textarea').value, 'คำแนะนำจากคำตอบบันทึก');
    pending.resolve(policy()); await view.settle(); view.render();
    assert.equal(view.choice(allowLabel).checked, true);
    assert.equal(view.find('textarea').value, 'คำแนะนำจากคำตอบบันทึก');
  } finally { view.cleanup(); read.mock.restore(); write.mock.restore(); notify.mock.restore(); }
});
