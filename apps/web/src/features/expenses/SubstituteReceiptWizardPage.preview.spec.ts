import { calcLineTotals } from '../../../../api/src/modules/expenses/domain/logic/expense-totals.logic';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { mutable } from './expense-certificate-test-harness';
const css = require.extensions['.css'];
require.extensions['.css'] = (m) => { m.exports = {}; };
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (m) => { m.exports = () => null; };
const api = mutable('./expenses.api');
const navigation = mutable('next/navigation');
const confirm = mutable('@/common/components/modal/use-confirm');
const { SubstituteReceiptWizardPage } = require('./SubstituteReceiptWizardPage');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
const source = readFileSync(new URL('./SubstituteReceiptWizardPage.tsx', import.meta.url), 'utf8').split('export function SubstituteReceiptWizardPage')[1]!;
const names = [...source.matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(m => m[1]!);

// Run the page's actual handlers and preview effects; other page reads and child rendering are not this race.
function setup(effectPattern = /previewRequestRef|setPreviewChecksum/) {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  const evidence = { id: 'evidence', status: 'PREPARED', signatureMode: 'DIGITAL', payerUserId: 'owner', payerName: 'เจ้าของกิจการ', documentNumber: 'SRC-1', updatedAt: 'v1', version: 1, fundingSource: 'COMPANY', supportingAttachmentIds: [], paymentEvidenceAttachmentIds: [] };
  const state: Record<string, any> = { detail: { id: 'expense', status: 'DRAFT', createdByUserId: 'owner', attachments: [], lines: [], payments: [], grandTotalAmount: '100', netPayableAmount: '100', paidAmount: '0', outstandingAmount: '100', whtAmount: '0', vatAmount: '0', substituteReceiptEvidence: evidence }, receiptEvidence: evidence, activeStep: 'certify', loading: false, policy: { approvalMode: 'OWNER_ONLY' } };
  const props = { companyId: 'co', userId: 'owner', permissions: ['expense.read', 'expense.review', 'expense.confirm'], canSelfApprove: true, evidenceId: undefined as string | undefined };
  const refs: any[] = [], memo: any[] = [], effects: any[] = [];
  let nodes: any[] = [];
  const same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  function render() {
    let si = 0, ri = 0, mi = 0, ei = 0; nodes = [];
    const pending: Array<() => void> = [], runtime = require('react');
    const memoized = (fn: () => any, deps: any[]) => { const slot = mi++; if (!memo[slot] || !same(deps, memo[slot].deps)) memo[slot] = { value: fn(), deps }; return memo[slot].value; };
    const realCreate = runtime.createElement;
    const mocks = [
      mock.method(runtime, 'useState', (init: any) => { const name = names[si++]!; if (!(name in state)) state[name] = typeof init === 'function' ? init() : init; return [state[name], (next: any) => { state[name] = typeof next === 'function' ? next(state[name]) : next; }]; }),
      mock.method(runtime, 'useRef', (init: any) => refs[ri++] ?? (refs[ri - 1] = { current: init })),
      mock.method(runtime, 'useContext', (context: any) => context._currentValue),
      mock.method(runtime, 'useMemo', memoized), mock.method(runtime, 'useCallback', (fn: any, deps: any[]) => memoized(() => fn, deps)),
      mock.method(runtime, 'useEffect', (fn: () => any, deps: any[]) => {
        const slot = ei++;
        if (!effectPattern.test(String(fn))) return;
        if (!effects[slot] || !same(deps, effects[slot].deps)) pending.push(() => { effects[slot]?.cleanup?.(); effects[slot] = { deps, cleanup: fn() }; });
      }),
      mock.method(runtime, 'createElement', (tag: any, props: any, ...children: any[]) => { nodes.push({ tag: typeof tag === 'string' ? tag : tag?.name ?? tag?.render?.name, props: { ...props, children } }); return realCreate(tag, props, ...children); }),
      mock.method(navigation, 'useRouter', () => ({ push() {}, replace() {} })),
      mock.method(confirm, 'useConfirm', () => ({ confirm: async () => true, confirmDialog: null })),
    ];
    try { SubstituteReceiptWizardPage(props); } finally { mocks.reverse().forEach(m => m.mock.restore()); }
    pending.forEach(fn => fn());
  }
  const find = (tag: string, predicate: (p: any) => boolean = () => true) => { const node = nodes.find(n => n.tag === tag && predicate(n.props)); assert.ok(node, `missing ${tag}`); return node.props; };
  const read = () => find('button', p => JSON.stringify(p.children).includes('อ่านเอกสาร'));
  return { state, props, render, find, read, settle: () => new Promise(resolve => setImmediate(resolve)), cleanup: () => { effects.forEach(e => e?.cleanup?.()); Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow }); } };
}

test('one read press survives route hydration and form state changes; an open reader never closes on a new revision', async () => {
  let resolve!: (value: any) => void;
  const request = mock.method(api, 'previewSubstituteReceipt', () => new Promise(done => { resolve = done; }));
  const view = setup();
  try {
    view.render(); view.read().onClick(); view.render(); assert.equal(view.read()['aria-busy'], true);
    view.props.evidenceId = 'evidence'; view.state.payerId = 'owner'; view.state.fundingSource = 'COMPANY'; view.render();
    resolve({ svgDataUrl: 'data:image/svg+xml,test', previewChecksumSha256: 'checksum', expectedEvidenceUpdatedAt: 'v1' }); await view.settle(); view.render();
    assert.equal(request.mock.callCount(), 1); assert.equal(view.read()['aria-busy'], false);
    const reader = view.find('DocumentPreviewModal'); reader.onViewed(); assert.equal(view.state.previewChecksum, 'checksum');
    view.state.receiptEvidence = { ...view.state.receiptEvidence, updatedAt: 'v2' }; view.render();
    assert.ok(view.state.preview, 'updated facts must not close the reader');
    assert.equal(view.state.previewChecksum, null, 'changed facts still require a fresh read before signing');
    reader.onViewed(); assert.equal(view.state.previewChecksum, null, 'an old media callback cannot authorize signing');
  } finally { view.cleanup(); request.mock.restore(); }
});

test('a failed read after page state changes shows a retry sentence and releases busy', async () => {
  let reject!: (cause: unknown) => void;
  const request = mock.method(api, 'previewSubstituteReceipt', () => new Promise((_done, fail) => { reject = fail; }));
  const view = setup();
  try {
    view.render(); view.read().onClick(); view.props.evidenceId = 'evidence'; view.state.payerId = 'owner'; view.render();
    reject(new Error('network')); await view.settle(); view.render();
    assert.match(view.state.error, /ลองอีกครั้ง/); assert.equal(view.read()['aria-busy'], false);
    assert.equal(view.state.preview, null); assert.equal(view.find('ErrorBanner').message, view.state.error);
  } finally { view.cleanup(); request.mock.restore(); }
});
test('a staff paper creator knows before creating that the expense reviewer prints and sends the signed copy', () => {
  const view = setup(/$^/);
  Object.assign(view.props, { userId: 'staff', permissions: ['expense.read_own'] });
  Object.assign(view.state, { receiptEvidence: null, activeStep: 'method', signingMethod: 'PAPER' });
  view.state.detail.createdByUserId = 'staff';
  try {
    view.render();
    assert.ok(view.find('Notice', p => JSON.stringify(p.children).includes('คุณพิมพ์และส่งฉบับที่เซ็นแล้วไม่ได้ ให้ผู้ตรวจค่าใช้จ่ายเปิดใบนี้ทำต่อ')));
    assert.ok(view.find('button', p => JSON.stringify(p.children).includes('สร้างใบรับรองให้ผู้ตรวจทำต่อ')));
    view.state.receiptEvidence = { id: 'paper', status: 'PREPARED', signatureMode: 'PAPER', payerUserId: null };
    view.state.activeStep = 'certify'; view.render();
    assert.equal(view.find('SubstitutePaperSigningPanel').canPrepare, false);
  } finally { view.cleanup(); }
});
test('an issued personal advance links only the payer or an authorized preparer to the payer claim', () => {
  for (const [reader, finance, offered] of [['payer', false, true], ['approver', false, false], ['approver', true, true]] as const) {
    const view = setup(/$^/);
    Object.assign(view.props, { userId: reader, permissions: ['expense.read', 'reimbursement.create', ...(finance ? ['reimbursement.finance_review'] : [])] });
    Object.assign(view.state, { activeStep: 'done', receiptEvidence: { ...view.state.receiptEvidence, status: 'ISSUED', fundingSource: 'PERSONAL_ADVANCE', payerUserId: 'payer', payerName: 'สมใจ', artifactAttachmentId: 'pdf' } });
    try {
      view.render();
      if (offered) {
        const link = view.find('LinkComponent', p => p.href?.includes('/reimbursements/new'));
        assert.equal(new URL(link.href, 'http://local').searchParams.get('requesterUserId'), 'payer');
      } else assert.throws(() => view.find('LinkComponent', p => p.href?.includes('/reimbursements/new')));
      const issued = JSON.stringify(view.find('p', p => p.className === 'min-w-0 flex-1 text-sm text-gray-700').children);
      if (reader !== 'payer') assert.doesNotMatch(issued, /คุณจ่ายเต็มจำนวน/);
      if (finance) assert.match(issued, /สมใจ/);
    } finally { view.cleanup(); }
  }
});


test('UX4 a shop detour restores the person’s typed details only after expense loading and does not overwrite them', () => {
  const { writeSubstituteWizardDraft, readSubstituteWizardDraft } = require('./substitute-receipt-wizard.model');
  const view = setup(/readSubstituteWizardDraft|writeSubstituteWizardDraft/);
  const items = new Map<string, string>();
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
  Object.assign(window, { sessionStorage: storage });
  const draft = { step: 'details', consent: true, reasonCode: 'PAYEE_CANNOT_ISSUE',
    missingReason: 'ร้านไม่ออกให้', businessPurpose: 'ซื้อของหน้าร้าน', payeeName: 'ร้านตลาดสด', payeeAddress: '', payeeTaxId: '',
    payerId: 'owner', fundingSource: 'COMPANY', paidInFullAcknowledged: true, paymentMethod: 'CASH', paymentDate: '2026-10-14', supportingIds: [], paymentIds: [] };
  writeSubstituteWizardDraft(storage, 'co', 'expense', 'owner', draft);
  Object.assign(view.state, { receiptEvidence: null, loading: true, activeStep: 'expense', payeeName: '', missingReason: '', businessPurpose: '', draftHydratedFor: null });
  view.state.detail.substituteReceiptEvidence = null;
  try {
    view.render();
    assert.equal(view.state.draftHydratedFor, null, 'cannot hydrate until initializeDraft finishes');
    assert.deepEqual(readSubstituteWizardDraft(storage, 'co', 'expense', 'owner'), draft);
    view.state.loading = false;
    view.render(); view.render();
    assert.equal(view.state.activeStep, 'details');
    assert.equal(view.state.payeeName, draft.payeeName);
    assert.equal(view.state.missingReason, draft.missingReason);
    assert.equal(view.state.businessPurpose, draft.businessPurpose);
    assert.deepEqual(readSubstituteWizardDraft(storage, 'co', 'expense', 'owner'), draft);
  } finally { view.cleanup(); }
});

test('details readiness names only the missing funding or paid-in-full fact', () => {
  const view = setup();
  try {
    Object.assign(view.state, { activeStep: 'details', fundingSource: 'COMPANY', paidInFullAcknowledged: false });
    view.render();
    const blockers = () => JSON.stringify(view.find('BlockedReason').labels);
    assert.match(blockers(), /ติ๊กว่าจ่ายครบ/);
    assert.doesNotMatch(blockers(), /เงินที่ใช้จ่าย/);
    Object.assign(view.state, { fundingSource: '', paidInFullAcknowledged: true }); view.render();
    assert.match(blockers(), /เงินที่ใช้จ่าย/); assert.doesNotMatch(blockers(), /ติ๊กว่าจ่ายครบ/);
  } finally { view.cleanup(); }
});

test('SUB-DOC document header exposes guarded actions, one status and amount facts', () => {
  const view = setup(/$^/);
  try {
    view.state.receiptEvidence = { ...view.state.receiptEvidence, status: 'ISSUED', artifactAttachmentId: 'pdf', payeeName: 'ร้านน้ำแข็ง', paymentDate: '2026-10-16' };
    view.state.activeStep = 'done';
    view.state.detail.expenseNumber = 'EXP-1';
    view.render();
    const header = view.find('MangmeePage');
    assert.equal(header.back.props.children, 'กลับไปรายการ');
    assert.equal(header.meta.props.children, 'ออกแล้ว');
    assert.ok(header.actions);
    assert.equal(view.find('MetricGrid').items[0].value, '100.00');
    assert.equal(view.find('MetricGrid').items[0].unit, 'บาท');
    assert.equal(view.find('MoreActions', p => p.label === 'เพิ่มเติม').closeOnPress, true);
    assert.equal(view.find('button', p => p.children.includes('ดาวน์โหลด PDF')).disabled, false);
    assert.ok(view.find('button', p => p.children.includes('ยกเลิกใบรับรองนี้')));
    view.state.detail.status = 'CONFIRMED'; view.render();
    assert.throws(() => view.find('button', p => p.children.includes('ยกเลิกใบรับรองนี้')), /missing button/);
    assert.ok(view.find('button', p => p.children.includes('แก้ชื่อร้านหรือตำแหน่งผู้เซ็น')));
    view.props.permissions = ['expense.read']; view.render();
    assert.throws(() => view.find('button', p => p.children.includes('แก้ชื่อร้านหรือตำแหน่งผู้เซ็น')), /missing button/);
  } finally { view.cleanup(); }
});

test('SUB-DOC picker requests only eligible server rows and uses the prominent pager without currency symbols', () => {
  const view = setup(/$^/);
  try {
    view.state.receiptEvidence = null; view.state.detail = null; view.state.activeStep = 'expense';
    view.state.entryMode = 'existing'; view.state.candidatesLoading = false;
    view.state.candidateTotal = 6;
    view.state.candidates = [{ id: 'expense', expenseNumber: 'EXP-1', vendorNameSnapshot: 'ร้านน้ำแข็ง', grandTotalAmount: '1940', expenseDate: '2026-10-16', lines: [{ description: 'น้ำแข็ง' }] }];
    view.render();
    assert.equal(view.find('Pagination').prominent, true);
    assert.equal(view.find('Pagination').totalPages, 2);
    assert.ok(view.find('span', p => p.children.includes('1,940.00 บาท')));
  } finally { view.cleanup(); }
});

test('SUB-DOC payer and approver presses with missing inputs focus the first reason without issuing', async () => {
  const originalFrame = globalThis.requestAnimationFrame;
  const originalDocument = globalThis.document;
  const focused: string[] = [];
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (fn: () => void) => { fn(); return 1; } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: (id: string) => { focused.push(id); return null; } } });
  const certify = mock.method(api, 'certifySubstituteReceipt', async () => { throw new Error('must not issue'); });
  const approve = mock.method(api, 'approveSubstituteReceipt', async () => { throw new Error('must not issue'); });
  try {
    for (const step of ['certify', 'approve']) {
      const view = setup(/$^/);
      try {
        view.state.activeStep = step;
        if (step === 'approve') view.state.receiptEvidence = { ...view.state.receiptEvidence, status: 'PAYER_CERTIFIED', payerUserId: 'other', certifiedArtifactAttachmentId: 'certified' };
        for (const missing of ['preview', 'signature', 'acknowledgement']) {
          view.state.previewChecksum = missing === 'preview' ? null : 'checksum';
          view.state.certifiedPreviewed = missing !== 'preview';
          view.state.policy = { ...view.state.policy, hasReusableSignature: missing === 'acknowledgement' };
          view.render();
          const action = view.find('button', p => p.children.some((value: unknown) => typeof value === 'string' && (step === 'approve' ? value === 'อนุมัติและออกใบรับรอง' : value === 'เซ็นรับรองการจ่าย')));
          assert.equal(action.disabled, false);
          action.onClick(); await view.settle(); view.render();
          assert.equal(focused.at(-1), `substitute-sign-${missing}`);
          assert.equal(view.state.signingAttempted, true);
          assert.ok(view.find('p', p => p.role === 'alert'));
        }
      } finally { view.cleanup(); }
    }
    assert.equal(certify.mock.callCount(), 0); assert.equal(approve.mock.callCount(), 0);
  } finally {
    certify.mock.restore(); approve.mock.restore();
    Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: originalFrame });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  }
});

test('manual wizard shows the server-rounded amount when a unit price changes at satang precision, without repeating an unchanged price', () => {
  for (const [quantity, unitPrice, shown] of [['1', '1.005', true], ['1', '1.004', true], ['1', '1.01', false], ['1', '1.0100', false], ['3', '40', true]] as const) {
    const view = setup(/$^/);
    view.props.permissions.push('expense.create');
    Object.assign(view.state, { detail: null, receiptEvidence: null, activeStep: 'expense', entryMode: 'new', categoriesLoading: false,
      categories: [{ id: 'category', name: 'ค่าใช้จ่าย', status: 'ACTIVE' }],
      manualLines: [{ id: 'manual-line-1', description: 'ของใช้', expenseCategoryId: 'category', quantity, unitPrice }] });
    try {
      view.render();
      const total = () => view.find('p', props => JSON.stringify(props.children).includes('รวมรายการนี้'));
      if (shown) {
        const saved = calcLineTotals({ quantity, unitPrice, vatMode: 'NO_VAT' });
        const expected = `${Number(saved.lineTotalAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
        assert.ok(JSON.stringify(total().children).includes(expected), `${quantity} × ${unitPrice} must show ${expected}`);
      } else assert.throws(total, /missing p/, 'an unchanged single-unit price needs no second amount');
    } finally { view.cleanup(); }
  }
});
