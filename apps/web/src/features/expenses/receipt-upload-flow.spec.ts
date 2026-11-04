import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
import { expenseCapabilities, receiptDraftMissingFields, type ExpenseDetail } from './expenses.model';
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
require.extensions['.svg'] = (module: any) => { module.exports = () => null; };
const api = mutable('./expenses.api');
const upload = mutable('./expense-upload.logic');
const select = mutable('@/common/components/field/ThemedSelect');
const confirmation = mutable('@/common/components/modal/use-confirm');
const toast = mutable('@/common/components/toast/use-toast');
const successNotices: string[] = [];
mock.method(toast, 'useToast', () => ({ success: (message: string) => successNotices.push(message), error: noop, warning: noop }));
const dates = mutable('@/common/components/field/ThemedDate');
const resultModule = mutable('./ReceiptUploadResult');
const { UploadPanel, DocumentReviewSection } = require('./ExpensesPages');
const { ReceiptUploadResult } = require('./ReceiptUploadResult');
const senderCaps = expenseCapabilities(['expense.receipt.upload', 'expense.update']);
const noop = () => {};
const photo = { name: 'receipt.jpg', type: 'image/jpeg', size: 1000 };
const detail: any = { id: 'e1', companyId: 'co', createdByUserId: 'sender', status: 'NEEDS_REVIEW', updatedAt: '2026-10-13T01:00:00Z',
  primaryAttachmentId: 'a1', expenseDate: '2026-10-13', vendorNameSnapshot: null, vatMode: 'NO_VAT', lines: [], attachments: [{ id: 'a1', purpose: 'expense.receipt.primary', status: 'ACTIVE' }],
  aiVerificationSummaryJson: { missingFields: ['vendorName', 'expenseDate', 'amount'] }, sourceDocumentType: 'NEEDS_REVIEW', taxEvidenceStatus: 'NEEDS_REVIEW',
  paymentStatus: 'UNPAID', grandTotalAmount: '0' };
function uploadHarness(renderNode: Parameters<typeof certificateHarness>[0]) {
  const view = certificateHarness(renderNode);
  const refs: any[] = [];
  return { ...view, render: (effects = false) => {
    let index = 0;
    const refsMock = mock.method(require('react'), 'useRef', (initial: unknown) => { const slot = index++; return refs[slot] ??= { current: initial }; });
    try { return view.render(effects); } finally { refsMock.mock.restore(); }
  } };
}
function uploadView(branchId = 'b1', caps = senderCaps) {
  return uploadHarness(() => h(UploadPanel, { companyId: 'co', branchId, canManagePlan: false, userId: 'sender', caps, onSuccess: noop, onBatchSuccess: noop }));
}
function uploadStubs() {
  const calls: string[] = [];
  const stubs = [
    mock.method(confirmation, 'useConfirm', () => ({ confirm: async () => true, confirmDialog: null })),
    mock.method(select, 'ThemedSelect', function ThemedSelect(props: any) { return h('select', props, props.children); }),
    mock.method(resultModule, 'ReceiptUploadResult', function ReceiptUploadResult() { return h('p', { role: 'status' }, 'ส่งใบเสร็จแล้ว ผู้ตรวจจะตรวจและยืนยันให้'); }),
    mock.method(api, 'getExpenseCaptureCapability', async () => null),
    mock.method(upload, 'prepareReceiptFile', async (file: any) => ({ file, resized: false })),
    mock.method(api, 'initReceiptUpload', async () => { calls.push('init'); return { expenseId: 'e1', attachmentId: 'a1' }; }),
    mock.method(api, 'uploadReceiptFile', async () => { calls.push('bytes'); }),
    mock.method(api, 'completeReceiptUpload', async () => { calls.push('complete'); }),
    mock.method(api, 'requestExpenseExtraction', async () => { calls.push('read'); return { status: 'ok' }; }),
  ];
  const oldWindow = (globalThis as any).window;
  const oldDocument = globalThis.document;
  const oldSelf = globalThis.self;
  (globalThis as any).self = { setTimeout: () => 0, clearTimeout: noop };
  (globalThis as any).document = { addEventListener: noop, removeEventListener: noop };
  const objectUrl = mock.method(URL, 'createObjectURL', () => 'blob:receipt');
  const revoke = mock.method(URL, 'revokeObjectURL', noop);
  (globalThis as any).window = { addEventListener: noop, removeEventListener: noop, history: { state: {}, pushState: noop }, location: { href: 'http://localhost/upload' }, sessionStorage: { setItem: noop, getItem: () => null, removeItem: noop } };
  return { calls, cleanup: () => { stubs.forEach(stub => stub.mock.restore()); objectUrl.mock.restore(); revoke.mock.restore(); (globalThis as any).self = oldSelf; (globalThis as any).document = oldDocument; (globalThis as any).window = oldWindow; } };
}
test('camera sends the prepared photo once through the ordinary upload and sender result', async () => {
  const stubs = uploadStubs(); const view = uploadView();
  try {
    view.render();
    view.find('input', p => p.capture === 'environment').onChange({ target: { files: [photo], value: 'picked' } });
    await view.settle(); view.render();
    assert.deepEqual(stubs.calls, ['init', 'bytes', 'complete', 'read']);
    assert.match(view.render(), /ส่งใบเสร็จแล้ว ผู้ตรวจจะตรวจและยืนยันให้/);
    assert.doesNotMatch(view.render(), /ยืนยันเอกสาร|ภาษีและเอกสาร/);
  } finally { stubs.cleanup(); }
});
test('device files wait for the send button', async () => {
  const stubs = uploadStubs(); const view = uploadView();
  try {
    view.render(); view.find('input', p => p.multiple).onChange({ target: { files: [photo] } });
    await view.settle(); view.render(); assert.deepEqual(stubs.calls, []);
    await view.find('button', p => Boolean(p['data-loading-indicator'])).onClick();
    await view.settle();
    assert.deepEqual(stubs.calls, ['init', 'bytes', 'complete', 'read']);
  } finally { stubs.cleanup(); }
});
for (const lostStep of ['bytes', 'complete', 'complete-unsaved']) test(`retry resumes the same receipt intent after a lost ${lostStep} answer`, async () => {
  const stubs = uploadStubs(); const view = uploadView();
  let attempts = 0;
  const lost = mock.method(api, lostStep === 'bytes' ? 'uploadReceiptFile' : 'completeReceiptUpload', async (...args: any[]) => {
    stubs.calls.push(lostStep === 'bytes' ? 'bytes' : 'complete');
    if (lostStep !== 'bytes') assert.deepEqual(args, ['co', 'e1', 'a1', { byteSize: photo.size }]);
    if (++attempts === 1) throw new Error('คำตอบหาย');
  });
  const read = mock.method(api, 'getExpense', async (companyId: string, expenseId: string) => {
    assert.deepEqual([companyId, expenseId], ['co', 'e1']); stubs.calls.push('recover');
    return lostStep === 'complete' ? detail : { ...detail, primaryAttachmentId: null, attachments: [] };
  });
  try {
    view.render(); view.find('input', p => p.multiple).onChange({ target: { files: [photo] } });
    await view.settle(); view.render();
    await view.find('button', p => Boolean(p['data-loading-indicator'])).onClick(); await view.settle(); view.render();
    assert.match(view.render(), /คำตอบหาย/);
    await view.find('button', p => p.children.includes('ส่งไฟล์นี้อีกครั้ง')).onClick(); await view.settle(); view.render();
    assert.deepEqual(stubs.calls, lostStep === 'bytes' ? ['init', 'bytes', 'bytes', 'complete', 'read']
      : lostStep === 'complete' ? ['init', 'bytes', 'complete', 'recover', 'read']
        : ['init', 'bytes', 'complete', 'recover', 'complete', 'read']);
    assert.deepEqual(view.find('ReceiptUploadResult').expenseIds, ['e1']);
  } finally { lost.mock.restore(); read.mock.restore(); view.cleanup(); stubs.cleanup(); }
});
test('picking a camera photo without a branch stays neutral and waits for Send', async () => {
  const stubs = uploadStubs(); let branchId = '';
  const view = uploadHarness(() => h(UploadPanel, { companyId: 'co', branchId, canManagePlan: false, userId: 'sender', caps: senderCaps,
    onSuccess: noop, onBatchSuccess: noop }));
  try {
    view.render(); view.find('input', p => p.capture).onChange({ target: { files: [photo], value: 'picked' } });
    await view.settle(); const html = view.render(true);
    assert.deepEqual(stubs.calls, []); assert.match(html, /receipt.jpg/); assert.doesNotMatch(html, /role="alert"/);
    assert.equal(view.find('TransactionBranchField').helpText, null);
    assert.doesNotMatch(html, /เก็บรูปไว้แล้ว|เปลี่ยนรูป|รอส่ง/);
    assert.match(html, /ถ่ายเพิ่ม/); assert.match(html, /เลือกเพิ่ม/);
    branchId = 'b1'; view.render(true);
    assert.equal(view.find('TransactionBranchField').helpText, null); assert.deepEqual(stubs.calls, []);
    await view.find('button', p => Boolean(p['data-loading-indicator'])).onClick(); await view.settle();
    assert.deepEqual(stubs.calls, ['init', 'bytes', 'complete', 'read']);
  } finally { view.cleanup(); stubs.cleanup(); }
});
test('quota refusal keeps the camera photo and stored draft reachable', async () => {
  const stubs = uploadStubs(); const view = uploadView();
  const quota = mock.method(api, 'requestExpenseExtraction', async () => { throw { code: upload.RECEIPT_QUOTA_ERROR_CODE, statusCode: 409 }; });
  try {
    view.render(); view.find('input', p => p.capture).onChange({ target: { files: [photo], value: 'picked' } });
    await view.settle(); const html = view.render();
    assert.match(html, /receipt.jpg/); assert.match(html, /expenses\/e1/); assert.equal(view.find('button', p => Boolean(p['data-loading-indicator'])).disabled, false);
  } finally { quota.mock.restore(); stubs.cleanup(); }
});
test('free limit refusal: ดูแพ็กเกจ for the package holder, ติดต่อเจ้าของกิจการ for others, no resend and no leave guard', async () => {
  for (const canManagePlan of [true, false]) {
    const stubs = uploadStubs();
    const handlers = new Map<string, (event: any) => void>();
    Object.assign(window, { addEventListener: (name: string, handler: any) => handlers.set(name, handler), removeEventListener: (name: string) => handlers.delete(name),
      matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }) });
    const init = mock.method(api, 'initReceiptUpload', async () => { throw Object.assign(new Error('limit'), { code: 'FREE_DOCUMENT_LIMIT_REACHED' }); });
    const view = uploadHarness(() => h(UploadPanel, { companyId: 'co', branchId: 'b1', canManagePlan, userId: 'sender', caps: senderCaps, onSuccess: noop, freeExpenseDrafts: true }));
    try {
      view.render(); view.find('input', p => p.multiple).onChange({ target: { files: [photo, { ...photo, name: 'two.jpg' }] } });
      await view.settle(); view.render(true);
      assert.equal(handlers.has('beforeunload'), true, 'picked files guard leaving before anything is sent');
      await view.find('button', p => p['data-loading-indicator']).onClick(); await view.settle();
      const html = view.render(true);
      assert.equal(init.mock.callCount(), 1, 'the batch stops at the first refusal');
      assert.match(html, /data-upload-quota/);
      assert.equal(html.split('ใช้สิทธิ์อ่านเอกสารฟรีของเดือนนี้ครบแล้ว ยังเปิดดูและแก้ร่างเดิมได้').length - 1, 1);
      assert.equal(html.includes('href="/companies/co/billing"'), canManagePlan);
      assert.equal(/>ดูแพ็กเกจ</.test(html), canManagePlan);
      assert.equal(html.includes('ติดต่อเจ้าของกิจการ'), !canManagePlan);
      assert.doesNotMatch(html, /ส่งไฟล์นี้อีกครั้ง|เปลี่ยนแพ็กเกจ/);
      assert.equal(handlers.has('beforeunload'), false, 'a refused file no longer holds the person on this page');
    } finally { view.cleanup(); init.mock.restore(); stubs.cleanup(); }
  }
});
test('sender result shows only permitted missing fields and returns after a narrow draft save', async () => {
  const confirm = mock.method(confirmation, 'useConfirm', () => ({ confirm: async () => true, confirmDialog: null }));
  let body: any; const save = mock.method(api, 'updateExpenseDraft', async (_co: string, _id: string, payload: any) => { body = payload; });
  const read = mock.method(api, 'getExpense', async () => ({ ...detail, vendorNameSnapshot: 'ร้าน', aiVerificationSummaryJson: null }));
  const view = certificateHarness(() => h(ReceiptUploadResult, { companyId: 'co', expenseIds: ['e1'], userId: 'sender', caps: senderCaps, onSendAnother: noop }), [[detail], null, { vendor: '', date: '', amount: '' }, false, null, false]);
  try {
    const html = view.render(); assert.match(html, /ระบบอ่านบางช่องไม่ออก/); assert.match(html, /ดูรายการที่ส่ง/); assert.match(html, /ส่งอีกใบ/); assert.match(html, /ลบร่างใบเสร็จ/);
    const group = view.nodes.find(node => node.tag === 'ActionGroup' && node.props.children.some((child: any) => child?.props?.children === 'เติมข้อมูล'));
    assert.deepEqual(group?.props.children.map((child: any) => child?.props?.children), ['ลบร่างใบเสร็จ', 'เติมข้อมูล']);
    view.find('button', p => p.children.includes('เติมข้อมูล')).onClick();
    assert.match(view.render(), /เติมข้อมูลใบเสร็จ/); assert.doesNotMatch(view.render(), /ขั้นที่ 1: ข้อมูลใบเสร็จ/);
    assert.doesNotMatch(view.render(), /ประเภทเอกสาร|หลักฐานภาษี|เลขผู้เสียภาษี/);
    view.find('input', p => p.inputMode !== 'decimal').onChange({ target: { value: 'ร้าน' } }); view.render();
    await view.find('form').onSubmit({ preventDefault: noop }); await view.settle();
    assert.deepEqual(body, { expectedUpdatedAt: detail.updatedAt, vendorNameSnapshot: 'ร้าน' });
    assert.equal(successNotices.at(-1), 'บันทึกข้อมูลแล้ว');
    assert.equal(view.state[1], null); assert.match(view.render(), /ส่งใบเสร็จแล้ว ผู้ตรวจจะตรวจและยืนยันให้/);
  } finally { confirm.mock.restore(); save.mock.restore(); read.mock.restore(); }
});
test('sender without draft update has no fill or delete action; known fields stay closed', () => {
  const confirm = mock.method(confirmation, 'useConfirm', () => ({ confirm: noop, confirmDialog: null }));
  const view = certificateHarness(() => h(ReceiptUploadResult, { companyId: 'co', expenseIds: ['e1'], userId: 'sender', caps: expenseCapabilities(['expense.receipt.upload']), onSendAnother: noop }), [[detail], null]);
  try { assert.doesNotMatch(view.render(), /เติมข้อมูล|ลบร่างใบเสร็จ/); assert.equal(receiptDraftMissingFields(detail, 'sender', { canUpdate: false }), null); }
  finally { confirm.mock.restore(); }
});
test('document type presets unanswered evidence and keeps existing server or person answers', async () => {
  const category = mock.method(api, 'listExpenseCategories', async () => []);
  try {
    for (const [type, expected] of [['TAX_INVOICE', 'USABLE_FOR_TAX'], ['RECEIPT', 'SUPPORTING_ONLY'], ['ABBREVIATED_TAX_INVOICE', 'SUPPORTING_ONLY'], ['TRANSFER_SLIP', 'SUPPORTING_ONLY']]) {
      const blank = certificateHarness(() => h(DocumentReviewSection, { companyId: 'co', detail: { ...detail, taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: null }, isMutable: true, canReview: true, onSaved: async () => {} }));
      blank.render(); blank.find('ThemedSelect', p => p['aria-label'] === 'ประเภทเอกสาร').onChange({ target: { value: type } }); blank.render();
      assert.equal(blank.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').value, expected);
      blank.find('ThemedSelect', p => p['aria-label'] === 'ประเภทเอกสาร').onChange({ target: { value: type === 'TAX_INVOICE' ? 'RECEIPT' : 'TAX_INVOICE' } }); blank.render();
      assert.equal(blank.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').value, expected, 'an existing preset is kept too');
    }
    for (const reason of ['UNREADABLE_OR_LOW_CONFIDENCE', 'MANUAL_OVERRIDE']) {
      const answered = certificateHarness(() => h(DocumentReviewSection, { companyId: 'co', detail: { ...detail, taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: reason }, isMutable: true, canReview: true, onSaved: async () => {} }));
      answered.render(); answered.find('ThemedSelect', p => p['aria-label'] === 'ประเภทเอกสาร').onChange({ target: { value: 'TAX_INVOICE' } }); answered.render();
      assert.equal(answered.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').value, 'NEEDS_REVIEW');
    }
  } catch (cause) { category.mock.restore(); throw cause; }
  const view = certificateHarness(() => h(DocumentReviewSection, { companyId: 'co', detail: { ...detail, sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'SUPPORTING_ONLY' }, isMutable: true, canReview: true, onSaved: async () => {} }));
  try {
    view.render(); assert.equal(view.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').value, 'SUPPORTING_ONLY');
    view.find('ThemedSelect', p => p['aria-label'] === 'ประเภทเอกสาร').onChange({ target: { value: 'TAX_INVOICE' } }); view.render();
    assert.equal(view.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').value, 'SUPPORTING_ONLY');
    view.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').onChange({ target: { value: 'NOT_TAX_EVIDENCE' } }); view.render();
    view.find('ThemedSelect', p => p['aria-label'] === 'ประเภทเอกสาร').onChange({ target: { value: 'RECEIPT' } }); view.render();
    assert.equal(view.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').value, 'NOT_TAX_EVIDENCE');
  } finally { category.mock.restore(); }
});
test('an explicit person answer of รอตรวจ is kept when the document type changes', () => {
  const view = certificateHarness(() => h(DocumentReviewSection, { companyId: 'co', detail: { ...detail, taxEvidenceReasonCode: null }, isMutable: true, canReview: true, onSaved: async () => {} }));
  view.render(); view.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').onChange({ target: { value: 'NEEDS_REVIEW' } }); view.render();
  view.find('ThemedSelect', p => p['aria-label'] === 'ประเภทเอกสาร').onChange({ target: { value: 'TAX_INVOICE' } }); view.render();
  assert.equal(view.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').value, 'NEEDS_REVIEW');
});
test('deleting one receipt removes it from every later fill reload', async () => {
  const date = mock.method(dates, 'ThemedDate', function ThemedDate(props: any) { return h('input', { ...props, type: 'date' }); });
  const confirm = mock.method(confirmation, 'useConfirm', () => ({ confirm: async () => true, confirmDialog: null }));
  const removed = mock.method(api, 'deleteExpense', async () => {});
  const updated = mock.method(api, 'updateExpenseDraft', async () => {});
  const reads: string[] = [];
  const read = mock.method(api, 'getExpense', async (_company: string, id: string) => {
    reads.push(id); if (id === 'e1') throw new Error('not found'); return { ...detail, id, vendorNameSnapshot: 'ร้านใหม่' };
  });
  const view = certificateHarness(() => h(ReceiptUploadResult, { companyId: 'co', expenseIds: ['e1', 'e2'], userId: 'sender', caps: senderCaps, onSendAnother: noop }),
    [[detail, { ...detail, id: 'e2' }], null, { vendor: '', date: '', amount: '' }, false, null, false]);
  try {
    view.render(); await view.find('button', p => p.children.includes('ลบร่างใบเสร็จ')).onClick(); await view.settle(); view.render();
    view.find('button', p => p.children.includes('เติมข้อมูล')).onClick(); view.render();
    view.find('input', p => p.inputMode !== 'decimal').onChange({ target: { value: 'ร้านใหม่' } }); view.render();
    await view.find('form').onSubmit({ preventDefault: noop }); await view.settle();
    const html = view.render(); assert.deepEqual(reads, ['e2']); assert.doesNotMatch(html, /not found/);
    assert.equal((view.state[0] as ExpenseDetail[])[0]?.vendorNameSnapshot, 'ร้านใหม่');
  } finally { date.mock.restore(); confirm.mock.restore(); removed.mock.restore(); updated.mock.restore(); read.mock.restore(); }
});
test('Next save rejects missing fields, then saves the evidence preset and a person override', async () => {
  const category = mock.method(api, 'listExpenseCategories', async () => []);
  let saves = 0, refreshed = 0;
  const save = mock.method(api, 'updateExpenseReviewFields', async (_co: string, _id: string, body: any) => { saves++; assert.equal(body.documentReviewAcknowledged, true); });
  const saveRef = { current: null as (() => Promise<boolean>) | null };
  const oldWindow = (globalThis as any).window;
  const oldDocument = (globalThis as any).document;
  (globalThis as any).document = { getElementById: () => null, fonts: undefined, addEventListener: noop, removeEventListener: noop };
  (globalThis as any).window = { addEventListener: noop, removeEventListener: noop };
  const view = certificateHarness(() => h(DocumentReviewSection, { companyId: 'co', detail, isMutable: true, canReview: true, saveRef, onSaved: async () => { refreshed++; } }));
  try {
    const untouched = view.render(true); assert.doesNotMatch(untouched, /role="alert"|เลือกประเภทเอกสาร และตอบว่า/);
    assert.equal(await saveRef.current!(), false);
    const invalid = view.render(); assert.match(invalid, /เลือกประเภทเอกสาร/); assert.match(invalid, /ใช้เป็นหลักฐานรายจ่ายได้ไหม: เลือกคำตอบ/); assert.equal(saves, 0);
    view.find('ThemedSelect', p => p['aria-label'] === 'ประเภทเอกสาร').onChange({ target: { value: 'RECEIPT' } });
    view.render(true);
    assert.equal(view.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').value, 'SUPPORTING_ONLY');
    assert.equal(await saveRef.current!(), true); assert.equal(saves, 1); assert.equal(refreshed, 1);
    view.find('ThemedSelect', p => p['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม').onChange({ target: { value: 'USABLE_FOR_TAX' } });
    view.render(true); assert.equal(await saveRef.current!(), true); assert.equal(saves, 2); assert.equal(refreshed, 2);
  } finally { view.cleanup(); (globalThis as any).window = oldWindow; (globalThis as any).document = oldDocument; save.mock.restore(); category.mock.restore(); }
});

for (const receiptProblem of ['NOT_AVAILABLE', 'LOST']) {
  test(`${receiptProblem} hides document and tax questions, saves neutral values, and requires a fresh type when receipt returns`, async () => {
    const category = mock.method(api, 'listExpenseCategories', async () => []);
    const plainSelect = mock.method(select, 'ThemedSelect', function ThemedSelect(props: any) { return h('select', props, props.children); });
    let saved: any;
    const save = mock.method(api, 'updateExpenseReviewFields', async (_co: string, _id: string, payload: any) => { saved = payload; });
    const saveRef = { current: null as (() => Promise<boolean>) | null };
    const oldWindow = (globalThis as any).window, oldDocument = (globalThis as any).document;
    (globalThis as any).window = { addEventListener: noop, removeEventListener: noop, requestAnimationFrame: noop };
    (globalThis as any).document = { getElementById: () => null, fonts: undefined, addEventListener: noop, removeEventListener: noop };
    const view = certificateHarness(() => h(DocumentReviewSection, { companyId: 'co', detail, isMutable: true, canReview: true, saveRef, onSaved: async () => {} }));
    try {
      view.render();
      view.find('button', p => p.children.includes('ไม่มีใบเสร็จ หรือใบเสร็จมีปัญหา')).onClick();
      view.render();
      view.find('ThemedSelect', p => p['aria-label'] === 'มีใบเสร็จของรายการนี้ไหม').onChange({ target: { value: receiptProblem } });
      view.render();
      assert(!view.nodes.some(node => node.props['aria-label'] === 'ประเภทเอกสาร'));
      assert(!view.nodes.some(node => node.props['aria-label'] === 'ใช้เป็นหลักฐานรายจ่ายได้ไหม'));
      view.find('textarea', p => p['aria-label'] === 'เหตุผลที่ใช้หลักฐานนี้').onChange({ target: { value: 'หลักฐานโอนจ่ายค่าน้ำแข็ง' } });
      view.render(true);
      assert.equal(await saveRef.current!(), true);
      assert.equal(saved.sourceDocumentType, 'EXPENSE_NOTE_TEXT');
      assert.equal(saved.taxEvidenceStatus, 'SUPPORTING_ONLY');
      view.render();
      view.find('ThemedSelect', p => p['aria-label'] === 'มีใบเสร็จของรายการนี้ไหม').onChange({ target: { value: 'NONE' } });
      view.render(true);
      assert.equal(view.find('ThemedSelect', p => p['aria-label'] === 'ประเภทเอกสาร').value, 'NEEDS_REVIEW');
      assert.equal(await saveRef.current!(), false);
      assert.match(view.render(), /เลือกประเภทเอกสาร/);
    } finally { view.cleanup(); (globalThis as any).window = oldWindow; (globalThis as any).document = oldDocument; save.mock.restore(); category.mock.restore(); plainSelect.mock.restore(); }
  });
}

test('empty Send focuses the picker; picked files with no branch focus that field only after Send', async () => {
  const stubs = uploadStubs(); let branchId = '';
  const focused: string[] = [];
  const target = (name: string): any => ({ closest: () => null, matches: () => true, querySelector: () => target(name === 'picker' ? 'camera' : 'branch-control'), getBoundingClientRect: () => ({ top: 900, bottom: 940, height: 40 }), focus: () => focused.push(name) });
  Object.assign(window, { innerHeight: 800, scrollBy: noop, matchMedia: () => ({ matches: false }) });
  Object.assign(document, { querySelector: (selector: string) => selector === '[data-transaction-branch-select]' ? target('branch') : null, querySelectorAll: () => [] });
  const view = uploadHarness(() => h(UploadPanel, { companyId: 'co', branchId, canManagePlan: false, userId: 'sender', caps: senderCaps,
    onSuccess: noop }));
  try {
    assert.doesNotMatch(view.render(true), /เลือกรูปใบเสร็จก่อน|เลือกสาขาก่อนส่ง/);
    const send = () => view.find('button', p => Boolean(p['data-loading-indicator']));
    view.find('div', p => Boolean(p['data-receipt-upload-picker'])).ref.current = target('picker');
    assert.equal(send().disabled, false);
    await send().onClick(); await view.settle();
    assert.match(view.render(true), /เลือกรูปใบเสร็จก่อน/);
    assert.deepEqual(focused, ['camera']); assert.deepEqual(stubs.calls, []);
    view.find('input', p => p.multiple).onChange({ target: { files: [photo] } }); await view.settle(); view.render(true);
    await send().onClick(); await view.settle(); view.render(true);
    assert.equal(view.find('TransactionBranchField').helpText, 'เลือกสาขาก่อนส่ง'); assert.equal(focused.at(-1), 'branch-control');
    branchId = 'b1'; view.render(true);
    assert.equal(view.find('TransactionBranchField').helpText, null); assert.equal(view.find('TransactionBranchField').invalid, false);
    assert.doesNotMatch(view.render(), /เลือกรูปใบเสร็จก่อน/);
    await send().onClick(); await view.settle();
    assert.deepEqual(stubs.calls, ['init', 'bytes', 'complete', 'read']);
  } finally { view.cleanup(); stubs.cleanup(); }
});

test('device picks append with dedupe; each row can be removed; the optional note is always shown', async () => {
  const stubs = uploadStubs(); const view = uploadView();
  try {
    assert.match(view.render(), /id="receipt-upload-note"/);
    assert.doesNotMatch(view.render(), /\+ หมายเหตุ|ไม่มีใบเสร็จ ทำใบรับรองแทนใบเสร็จ/);
    view.find('input', p => p.multiple).onChange({ target: { files: [photo] } });
    await view.settle(); view.render();
    view.find('input', p => p.multiple).onChange({ target: { files: [photo, { ...photo, name: 'two.jpg' }] } });
    await view.settle(); const html = view.render();
    assert.equal(view.nodes.filter(n => n.tag === 'li').length, 2);
    assert.match(html, /ส่งใบเสร็จ 2 ใบ/); assert.doesNotMatch(html, /เปลี่ยนรูป|รอส่ง|✓/);
    view.find('button', p => p['aria-label'] === 'เอาออก receipt.jpg').onClick(); view.render();
    assert.equal(view.nodes.filter(n => n.tag === 'li').length, 1);
    view.find('input', p => p.id === 'receipt-upload-note').onChange({ target: { value: 'ค่ากาแฟ' } });
    assert.match(view.render(), /ค่ากาแฟ/);
    assert.deepEqual(stubs.calls, []);
  } finally { view.cleanup(); stubs.cleanup(); }
});

test('sender result focuses its heading once without scrolling and keeps equal grouped next actions', () => {
  const confirm = mock.method(confirmation, 'useConfirm', () => ({ confirm: noop, confirmDialog: null }));
  const view = certificateHarness(() => h(ReceiptUploadResult, { companyId: 'co', expenseIds: ['e1'], userId: 'sender', caps: senderCaps, onSendAnother: noop }), [[detail], null]);
  try {
    assert.match(view.render(), /mangmee-flat/);
    const heading = view.find('h2'); let focuses = 0;
    const node = { focus: (options: any) => { assert.equal(options.preventScroll, true); focuses++; } };
    heading.ref(node); heading.ref(null); heading.ref(node);
    assert.equal(focuses, 1);
    const actions = view.find('ActionGroup', p => p.children.some((child: any) => child?.props?.children === 'ส่งอีกใบ'));
    assert.match(actions.className, /grid/);
  } finally { confirm.mock.restore(); }
});

test('partial upload stays beside each failure and its retry sends only that file, never a stored file', async () => {
  const stubs = uploadStubs(); const sent: string[] = []; const fail = new Set(['a.jpg', 'b.jpg']);
  const init = mock.method(api, 'initReceiptUpload', async (_co: string, body: any) => {
    sent.push(body.originalFileName);
    if (fail.has(body.originalFileName)) throw new Error(`ส่ง ${body.originalFileName} ไม่ได้ ลองอีกครั้ง`);
    return { expenseId: body.originalFileName, attachmentId: body.originalFileName };
  });
  const view = uploadView();
  try {
    view.render(); view.find('input', p => p.multiple).onChange({ target: { files: ['a.jpg', 'b.jpg', 'c.jpg'].map(name => ({ ...photo, name })) } });
    await view.settle(); view.render();
    await view.find('button', p => p['data-loading-indicator']).onClick(); await view.settle();
    const html = view.render(); assert.match(html, /ส่ง a.jpg ไม่ได้ ลองอีกครั้ง/); assert.match(html, /ส่ง b.jpg ไม่ได้ ลองอีกครั้ง/);
    assert.equal(view.nodes.some(n => n.tag === 'ReceiptUploadResult'), false);
    const retries = () => view.nodes.filter(n => n.tag === 'button' && n.props.children.includes('ส่งไฟล์นี้อีกครั้ง'));
    assert.equal(retries().length, 2);
    fail.delete('b.jpg'); await retries()[1]!.props.onClick(); await view.settle(); view.render();
    assert.deepEqual(sent, ['a.jpg', 'b.jpg', 'c.jpg', 'b.jpg']);
    assert.equal(retries().length, 1); assert.equal(view.nodes.some(n => n.tag === 'ReceiptUploadResult'), false);
    fail.delete('a.jpg'); await retries()[0]!.props.onClick(); await view.settle(); view.render();
    assert.deepEqual(sent, ['a.jpg', 'b.jpg', 'c.jpg', 'b.jpg', 'a.jpg']);
    assert.deepEqual(view.find('ReceiptUploadResult').expenseIds, ['a.jpg', 'b.jpg', 'c.jpg']);
  } finally { view.cleanup(); init.mock.restore(); stubs.cleanup(); }
});

test('image thumbnails release their object URLs on removal and unmount; PDF uses the file icon', async () => {
  const stubs = uploadStubs(); const created: string[] = []; const revoked: string[] = [];
  const create = mock.method(URL, 'createObjectURL', (file: any) => { const url = `blob:${file.name}:${created.length}`; created.push(url); return url; });
  const revoke = mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
  const view = uploadView();
  try {
    view.render(); view.find('input', p => p.multiple).onChange({ target: { files: [photo, { ...photo, name: 'paper.pdf', type: 'application/pdf' }] } });
    await view.settle(); view.render(true);
    assert.equal(created.length, 1); assert.match(created[0]!, /receipt.jpg/);
    view.find('button', p => p['aria-label'] === 'เอาออก receipt.jpg').onClick(); view.render(true);
    assert.deepEqual(revoked, created); assert.equal(created.length, 1);
    view.cleanup(); assert.deepEqual(revoked, created);
  } finally { create.mock.restore(); revoke.mock.restore(); stubs.cleanup(); }
});

test('picked unsent files guard leaving with the expense-page question and the tab-close warning', async () => {
  const stubs = uploadStubs(); let allowed = false; let question: any;
  const handlers = new Map<string, (event: any) => void>();
  Object.assign(window, { addEventListener: (name: string, handler: any) => handlers.set(name, handler), removeEventListener: (name: string) => handlers.delete(name) });
  const confirm = mock.method(confirmation, 'useConfirm', () => ({ confirm: async (value: any) => { question = value; return allowed; }, confirmDialog: null }));
  const view = uploadHarness(() => h(UploadPanel, { companyId: 'co', branchId: 'b1', canManagePlan: false, userId: 'sender', caps: senderCaps, onSuccess: noop }));
  try {
    view.render(); view.find('input', p => p.multiple).onChange({ target: { files: [photo] } }); await view.settle(); view.render(true);
    let warned = false; handlers.get('beforeunload')!({ preventDefault: () => { warned = true; } }); assert.equal(warned, true);
    let switched = false, intercepted = false;
    handlers.get('watchdog:unsaved-navigation')!({ preventDefault: () => { intercepted = true; }, detail: () => { switched = true; } });
    await view.settle(); assert.equal(intercepted, true); assert.equal(switched, false);
    assert.equal(question.title, 'ยังไม่ได้บันทึกสิ่งที่แก้'); assert.equal(question.cancelLabel, 'อยู่ต่อ');
    assert.equal(question.message, 'ออกจากหน้านี้ สิ่งที่แก้ไว้จะหายไป');
    assert.match(view.render(), /receipt.jpg/);
    allowed = true;
    handlers.get('watchdog:unsaved-navigation')!({ preventDefault: noop, detail: () => { switched = true; } });
    await view.settle(); assert.equal(switched, true);
  } finally { view.cleanup(); confirm.mock.restore(); stubs.cleanup(); }
});

test('Send pressed during image preparation sends once when its bytes are ready', async () => {
  const stubs = uploadStubs(); let ready!: (value: any) => void;
  const prepare = mock.method(upload, 'prepareReceiptFile', () => new Promise(resolve => { ready = resolve; }));
  const view = uploadView();
  try {
    view.render(); view.find('input', p => p.multiple).onChange({ target: { files: [photo] } }); view.render();
    const send = view.find('button', p => p['data-loading-indicator']);
    assert.equal(send.disabled, false); await send.onClick(); assert.deepEqual(stubs.calls, []);
    ready({ file: photo, resized: false }); await view.settle(); view.render();
    assert.deepEqual(stubs.calls, ['init', 'bytes', 'complete', 'read']);
    assert.deepEqual(view.find('ReceiptUploadResult').expenseIds, ['e1']);
  } finally { view.cleanup(); prepare.mock.restore(); stubs.cleanup(); }
});
