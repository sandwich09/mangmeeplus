import assert from 'node:assert/strict';
import { test, mock, beforeEach, afterEach } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastContext } from '@/common/components/toast/use-toast';
import { h, mutable } from './expense-certificate-test-harness';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { mergeExpenseUnsavedFields, expenseTaxEvidenceReasonMessage, deriveExpenseAuditChecks, TAX_EVIDENCE_STATUS_LABELS } from './expenses.model';
import { expenseEvidenceImageMissing } from '@watchdog-bms/contracts';
import { deriveEvidenceRowFlags } from './evidence-audit.logic';
import { readFileSync } from 'node:fs';

(globalThis as any).self = globalThis;
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
require.extensions['.svg'] = (module: any) => { module.exports = () => null; };
const api = mutable('./expenses.api');
const policy = mutable('./expense-capture-policy');
const totals = mutable('./useExpenseReviewTotals');
const select = mutable('@/common/components/field/ThemedSelect');
const tip = mutable('@/common/components/field/InfoTip');
const { DocumentReviewSection, ExpenseReviewEditSection } = require('./ExpensesPages');
const originalDocument = globalThis.document, originalWindow = globalThis.window;
beforeEach(() => {
  (globalThis as any).document = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
  (globalThis as any).window = { innerHeight: 800, scrollBy() {}, matchMedia: () => ({ matches: true }), addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback: () => void) { callback(); return 1; } };
});
afterEach(() => { (globalThis as any).document = originalDocument; (globalThis as any).window = originalWindow; });
function focusDomField(focus: () => void): any { return { closest: () => null, matches: () => true, getBoundingClientRect: () => ({ top: 900, bottom: 940, height: 40 }), focus }; }
const detail = (over: Record<string, unknown> = {}): any => ({
  id: 'expense', companyId: 'co', status: 'DRAFT', updatedAt: 'v1', expenseDate: '2026-10-11',
  vendorNameSnapshot: 'ชื่อเดิม', vendorTaxIdSnapshot: '', vendorAddressSnapshot: '', vendorBranchCodeSnapshot: '',
  vendorDocumentNumber: 'OLD', sourceDocumentType: 'NEEDS_REVIEW', taxEvidenceStatus: 'NEEDS_REVIEW', expenseCategoryId: null,
  vatMode: 'NO_VAT', whtAmount: '0', vatAmount: '0', grandTotalAmount: '100', netPayableAmount: '100', paidAmount: '0',
  lines: [], attachments: [], aiVerificationSummaryJson: null, aiVerifiedFieldsJson: null, ...over,
});

// What the shop's category list answers; a test that needs names sets it and puts it back.
let shopCategories: any[] = [];

// Persist hooks and run effects only when their dependencies change, as an upload re-read does.
function view(component: any, initial: any, extra: Record<string, unknown> = {}) {
  const props = { companyId: 'co', detail: initial, isMutable: true, canReview: true, canConfirm: false, onSaved: async () => {}, ...extra };
  const slots: any[] = [], nodes: any[] = [], previewBlockers: unknown[] = [];
  function render() {
    let index = 0; nodes.length = 0;
    const pending: Array<() => void> = [];
    const runtime = require('react');
    const create = runtime.createElement;
    const mocks = [
      mock.method(runtime, 'useState', (init: any) => {
        const at = index++;
        if (!(at in slots)) slots[at] = typeof init === 'function' ? init() : init;
        return [slots[at], (next: any) => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }];
      }),
      mock.method(runtime, 'useRef', (init: any) => { const at = index++; return slots[at] ??= { current: init }; }),
      mock.method(runtime, 'useEffect', (fn: any, deps: any[]) => {
        const at = index++, old = slots[at];
        if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) {
          pending.push(() => { old?.cleanup?.(); slots[at] = { deps, cleanup: fn() }; });
        }
      }),
      mock.method(runtime, 'createElement', (tag: any, p: any, ...children: any[]) => {
        nodes.push({ tag: typeof tag === 'string' ? tag : tag.name, props: { ...p, children } }); return create(tag, p, ...children);
      }),
      mock.method(api, 'listExpenseCategories', async () => shopCategories),
      mock.method(api, 'listExpenseWhtIncomeCategories', async () => []),
      mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE', vatStatus: 'NOT_REGISTERED' })),
      mock.method(totals, 'useExpenseReviewTotals', (...args: unknown[]) => { previewBlockers.push(args[4]); return null; }),
      mock.method(select, 'ThemedSelect', (p: any) => h('select', p)),
      mock.method(tip, 'InfoTip', () => null),
    ];
    try {
      const html = renderToStaticMarkup(h(ToastContext.Provider, { value: { success() {}, warning() {}, error() {} } }, h(component, props)));
      pending.forEach(fn => fn()); return html;
    } finally { mocks.reverse().forEach(m => m.mock.restore()); }
  }
  const field = (label: string) => {
    const node = nodes.find(n => (n.props?.['aria-label'] === label || n.props?.value === label) && n.props?.onChange);
    assert.ok(node, label); return node.props;
  };
  const click = (text: string) => nodes.find(n => n.tag === 'button' && n.props.children?.includes(text))?.props.onClick();
  return { props, render, field, click, nodes, previewBlockers };
}

test('upload and removal refreshes retain review choices and evidence text while clean server fields arrive', () => {
  const originalWindow = globalThis.window;
  (globalThis as any).window = { innerHeight: 800, scrollBy() {}, matchMedia: () => ({ matches: true }), addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback: () => void) { callback(); return 1; } };
  try {
    const screen = view(DocumentReviewSection, detail()); screen.render(); screen.render();
    screen.field('ประเภทเอกสาร').onChange({ target: { value: 'RECEIPT' } });
    screen.field(t('expenses.tax_evidence_status', 'th')).onChange({ target: { value: 'SUPPORTING_ONLY' } });
    screen.click('ไม่มีใบเสร็จ หรือใบเสร็จมีปัญหา'); screen.render();
    screen.field('มีใบเสร็จของรายการนี้ไหม').onChange({ target: { value: 'NOT_AVAILABLE' } }); screen.render();
    screen.field('เหตุผลที่ใช้หลักฐานนี้').onChange({ target: { value: 'เหตุผลที่กำลังพิมพ์' } });
    screen.props.detail = detail({ updatedAt: 'v2', primaryAttachmentId: 'new', attachments: [{ id: 'new', purpose: 'expense.receipt.primary', status: 'ACTIVE' }], expenseCategoryId: 'server-category' });
    screen.render(); screen.render();
    assert(!screen.nodes.some(node => node.props['aria-label'] === 'ประเภทเอกสาร'));
    assert(!screen.nodes.some(node => node.props['aria-label'] === t('expenses.tax_evidence_status', 'th')));
    assert.equal(screen.field('มีใบเสร็จของรายการนี้ไหม').value, 'NOT_AVAILABLE');
    assert.equal(screen.field('server-category').value, 'server-category');
    assert.equal(screen.field('เหตุผลที่ใช้หลักฐานนี้').value, 'เหตุผลที่กำลังพิมพ์');
    screen.props.detail = detail({ updatedAt: 'v3', expenseCategoryId: 'server-category' });
    screen.render(); screen.render();
    assert(!screen.nodes.some(node => node.props['aria-label'] === 'ประเภทเอกสาร'));
    assert(!screen.nodes.some(node => node.props['aria-label'] === t('expenses.tax_evidence_status', 'th')));
    assert.equal(screen.field('มีใบเสร็จของรายการนี้ไหม').value, 'NOT_AVAILABLE');
    assert.equal(screen.field('เหตุผลที่ใช้หลักฐานนี้').value, 'เหตุผลที่กำลังพิมพ์');
  } finally { (globalThis as any).window = originalWindow; }
});

test('R2 receipt refusal exposes upload and evidence choices; review save is the one primary and draft save is the quiet way out', () => {
  const files: File[] = [];
  const screen = view(DocumentReviewSection, detail({ sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY' }), {
    onAttachPrimaryReceipt: async (file: File) => { files.push(file); },
  });
  const html = screen.render();
  // 2026-10-13: the refusal is said before the button it blocks and carries its own way out (attach), without "กรุณา".
  assert.match(html, /ยังไม่มีใบเสร็จ แนบไฟล์ หรือบอกว่าไม่มีใบเสร็จ/);
  assert.ok(html.indexOf('ยังไม่มีใบเสร็จ แนบไฟล์') < html.indexOf('>บันทึกการตรวจ<'), 'the reason comes before the save button');
  assert.equal((html.match(/ไม่มีใบเสร็จ หรือใบเสร็จมีปัญหา/g) ?? []).length, 1);
  const receipt = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' });
  screen.field('แนบไฟล์ใบเสร็จ').onChange({ target: { files: [receipt], value: 'receipt.pdf' } });
  assert.deepEqual(files, [receipt]);
  // Nothing is unsaved yet, so only the one save button is offered.
  assert.equal(screen.nodes.some(n => n.tag === 'button' && n.props.children.includes('บันทึกร่าง')), false);
  screen.click('ไม่มีใบเสร็จ หรือใบเสร็จมีปัญหา'); screen.render();
  screen.field('มีใบเสร็จของรายการนี้ไหม').onChange({ target: { value: 'LOST' } });
  const dirtyHtml = screen.render();
  const primary = screen.nodes.find(n => n.tag === 'button' && n.props.children.includes('บันทึกการตรวจ'));
  const draft = screen.nodes.find(n => n.tag === 'button' && n.props.children.includes('บันทึกร่าง'));
  assert.ok(primary?.props.className.includes('mangmee-btn-primary'));
  // One primary per view: keeping unfinished answers is quiet, and appears only while something is unsaved.
  assert.ok(draft?.props.className.includes('mangmee-btn-quiet'));
  assert.doesNotMatch(dirtyHtml, /ยังไม่นับว่าตรวจแล้ว|เก็บไว้ทำต่อ|บันทึกแบบร่าง|เก็บร่างไว้ก่อน/);
});

// 2026-10-13: the certificate wizard embeds this card. Its step used to refuse without saying that it wanted
// this card's answers, and the certificate offered as a document type was a trap before a certificate exists.
test('substituteReceiptFlow starts the card on "no receipt, make a certificate" as screen defaults only; a saved answer wins and both screens show the shared line category', async () => {
  const lines = [{ expenseCategoryId: 'cat-travel' }, { expenseCategoryId: 'cat-travel' }];
  shopCategories = [{ id: 'cat-travel', name: 'ค่าเดินทาง' }, { id: 'cat-food', name: 'ค่าอาหาร' }];
  try {
    // Off (the expense page): closed questions, every type, the plain empty category.
    const off = view(DocumentReviewSection, detail({ lines })); off.render(); await new Promise(resolve => setImmediate(resolve));
    const offHtml = off.render();
    assert.doesNotMatch(offHtml, /มีใบเสร็จของรายการนี้ไหม/);
    assert.match(offHtml, />ใบรับรองแทนใบเสร็จรับเงิน<\/option>/);
    assert.match(offHtml, />ค่าเดินทาง \(ตามรายการ\)<\/option>/);
    assert.equal(off.field(t('expenses.category', 'th')).value, '');

    const on = view(DocumentReviewSection, detail({ lines }), { substituteReceiptFlow: true }); on.render(); await new Promise(resolve => setImmediate(resolve));
    const onHtml = on.render();
    assert.equal(on.field('มีใบเสร็จของรายการนี้ไหม').value, 'NOT_AVAILABLE');
    assert.equal(on.field('จะใช้อะไรแทน').value, 'SUBSTITUTE_RECEIPT');
    // Screen defaults are not unsaved work: no quiet draft button, and the answers this card did not default stay as saved.
    assert.equal(on.nodes.some(n => n.tag === 'button' && n.props.children.includes('บันทึกร่าง')), false);
    assert.ok(on.nodes.some(n => n.tag === 'button' && n.props.children.includes('บันทึกการตรวจ')));
    assert.equal(on.field(t('expenses.tax_evidence_status', 'th')).value, 'NEEDS_REVIEW');
    // The certificate is not a type to pick here; every other type stays.
    assert.doesNotMatch(onHtml, />ใบรับรองแทนใบเสร็จรับเงิน<\/option>/);
    assert.match(onHtml, />สลิปโอนเงิน<\/option>/);
    // One category across the lines is shown in the box; the value that would be saved stays empty.
    assert.match(onHtml, />ค่าเดินทาง \(ตามรายการ\)<\/option>/);
    assert.equal(on.field(t('expenses.category', 'th')).value, '');

    // Two different line categories: nothing to show.
    const mixed = view(DocumentReviewSection, detail({ lines: [{ expenseCategoryId: 'cat-travel' }, { expenseCategoryId: 'cat-food' }] }), { substituteReceiptFlow: true });
    mixed.render(); await new Promise(resolve => setImmediate(resolve));
    assert.doesNotMatch(mixed.render(), /ตามรายการ/);

    // A saved answer always wins, and a record already saved with the certificate type still shows it.
    const saved = view(DocumentReviewSection, detail({ sourceDocumentType: 'SUBSTITUTE_RECEIPT', expenseCategoryId: 'cat-food', lines,
      aiVerificationSummaryJson: { documentEvidenceDraft: { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: [], reason: '' } } }), { substituteReceiptFlow: true });
    saved.render(); await new Promise(resolve => setImmediate(resolve));
    const savedHtml = saved.render();
    assert.equal(saved.field('มีใบเสร็จของรายการนี้ไหม').value, 'NONE');
    assert.match(savedHtml, />ใบรับรองแทนใบเสร็จรับเงิน<\/option>/);
    assert.equal(saved.field(t('expenses.category', 'th')).value, 'cat-food');
    assert.doesNotMatch(savedHtml, /ตามรายการ/);
  } finally { shopCategories = []; }
});

test('R2 shows only actionable evidence reasons and uses the evidence option words in the summary', () => {
  assert.equal(expenseTaxEvidenceReasonMessage('MANUAL_OVERRIDE'), null);
  for (const code of ['HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE', 'HANDWRITTEN_RECEIPT_REVIEW', 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE'] as const) assert.ok(expenseTaxEvidenceReasonMessage(code));
  const html = view(DocumentReviewSection, detail({ taxEvidenceReasonCode: 'MANUAL_OVERRIDE' })).render();
  assert.doesNotMatch(html, /ผู้ตรวจแก้ไขผลด้วยตนเอง/);
  const checks = deriveExpenseAuditChecks(detail({ taxEvidenceStatus: 'USABLE_FOR_TAX' }));
  assert.equal(checks.find(check => check.key === 'tax_evidence')?.label, `หลักฐานรายจ่าย: ${TAX_EVIDENCE_STATUS_LABELS.USABLE_FOR_TAX}`);
});

test('R2 manual receipt hint stays short and section chips form one scrolling row', () => {
  assert.equal(t('expenses.manual_receipt_helper', 'th'), 'แนบทีหลังได้ ก่อนยืนยันต้องมีใบเสร็จหรือเหตุผล');
  for (const key of ['expenses.source_draft_save', 'expenses.review_save_draft', 'expenses.manual_save_draft'] as const) assert.equal(t(key, 'th'), 'บันทึกร่าง');
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /guided \? 'flex-wrap gap-y-1\.5' : 'flex-nowrap overflow-x-auto'/);
  assert.doesNotMatch(page, /navChips\.map/);
  assert.match(page, /\{guided && <><div id="expense-review-start" tabIndex=\{-1\} ref=\{reviewStartRef\}/);
});

test('upload refresh retains typed vendor fields on step one and receives untouched server fields', () => {
  const screen = view(ExpenseReviewEditSection, detail()); screen.render(); screen.render();
  screen.field('ชื่อเดิม').onChange({ target: { value: 'ชื่อที่กำลังกรอก' } });
  screen.props.detail = detail({ updatedAt: 'v2', primaryAttachmentId: 'new', vendorDocumentNumber: 'SERVER-NEW' });
  screen.render(); const html = screen.render();
  assert.match(html, /value="ชื่อที่กำลังกรอก"/);
  assert.match(html, /value="SERVER-NEW"/);
  screen.props.detail = detail({ id: 'other-expense', updatedAt: 'v3', vendorNameSnapshot: 'รายการอื่น' });
  screen.render(); assert.match(screen.render(), /value="รายการอื่น"/);
});

test('an unsaved withholding decision and tax input survive attachment removal', () => {
  const screen = view(ExpenseReviewEditSection, detail()); screen.render(); screen.render();
  screen.field(t('expenses.wht_choice', 'th')).onChange({ target: { value: 'YES' } }); screen.render();
  screen.props.detail = detail({ updatedAt: 'v2', vendorAddressSnapshot: 'ที่อยู่จากระบบ' });
  screen.render(); const html = screen.render();
  assert.equal(screen.field(t('expenses.wht_choice', 'th')).value, 'YES');
  assert.match(html, /ผู้รับเงินเป็นใคร/);
  assert.match(html, /ที่อยู่จากระบบ/);
});

test('three-way refresh keeps edited fields and nested inputs, accepts server changes to clean fields and uses the new baseline', () => {
  const previous = { name: 'เดิม', address: '', lines: [{ amount: '100' }] };
  const current = { ...previous, name: 'กำลังกรอก', lines: [{ amount: '1402.00' }] };
  const incoming = { ...previous, name: 'จากระบบ', address: 'ที่อยู่ใหม่', lines: [{ amount: '200' }] };
  const merged = mergeExpenseUnsavedFields(previous, incoming, current);
  assert.deepEqual(merged, { name: 'กำลังกรอก', address: 'ที่อยู่ใหม่', lines: [{ amount: '1402.00' }] });
  assert.deepEqual(mergeExpenseUnsavedFields(incoming, { ...incoming, address: 'ที่อยู่ล่าสุด' }, merged), { ...merged, address: 'ที่อยู่ล่าสุด' });
});

test('all four questions expose their grey hint through aria-describedby, with the rate note only when editable', () => {
  // The hint under the tax answer speaks of slips and hand-written bills: it is shown beside a type it can be
  // about, never before a type is chosen and never for a tax invoice (which answer fits is not written here).
  const evidence = view(DocumentReviewSection, detail({ sourceDocumentType: 'RECEIPT' })); evidence.render();
  const taxId = evidence.field(t('expenses.tax_evidence_status', 'th'))['aria-describedby'];
  assert.ok(taxId);
  assert.ok(evidence.nodes.some(n => n.tag === 'p' && n.props.id === taxId && n.props.className.includes('text-sm text-gray-500')));
  for (const sourceDocumentType of ['NEEDS_REVIEW', 'TAX_INVOICE', 'ABBREVIATED_TAX_INVOICE']) {
    const quiet = view(DocumentReviewSection, detail({ sourceDocumentType })); const quietHtml = quiet.render();
    assert.equal(quiet.field(t('expenses.tax_evidence_status', 'th'))['aria-describedby'], undefined, sourceDocumentType);
    assert.equal(quietHtml.includes(t('expenses.tax_evidence_status_hint', 'th')), false, sourceDocumentType);
  }
  for (const editable of [true, false]) {
    const screen = view(ExpenseReviewEditSection, detail({ whtAmount: '3', whtRate: '3', whtInput: { inputType: 'RATE', value: '3' } }));
    screen.props.isMutable = editable;
    const html = screen.render();
    for (const key of ['expenses.wht_choice', 'expenses.payee_entity_kind', ...(editable ? ['expenses.wht_income_category'] : [])]) {
      const hintId = screen.field(t(key as any, 'th'))['aria-describedby'];
      assert.ok(hintId, key);
      assert.ok(screen.nodes.some(n => n.tag === 'p' && n.props.id === hintId && n.props.className.includes('text-xs text-gray-500')));
    }
    assert.equal(html.includes('แก้อัตราได้ถ้าเอกสารระบุไว้ต่างออกไป'), editable);
  }
});

test('R4 untouched review fields are quiet; one Next attempt reveals every missing answer', async () => {
  const saveRef = { current: null as null | (() => Promise<boolean>) };
  const screen = view(ExpenseReviewEditSection, detail({ vendorNameSnapshot: '', whtAmount: '3', whtInput: { inputType: 'RATE', value: '3' },
    lines: [{ id: 'line', description: 'ค่าบริการ', quantity: '1', unitPrice: '100', discountAmount: '0', vatRate: '', whtRate: '0.03' }] }), { saveRef });
  screen.render(); let html = screen.render();
  assert.doesNotMatch(html, /กรอกชื่อผู้ขาย|aria-invalid="true"/);
  assert.equal(await saveRef.current!(), false);
  html = screen.render();
  assert.match(html, />กรอกชื่อผู้ขาย</);
  assert.match(html, /เลือกก่อนว่าผู้รับเงินเป็นบริษัทหรือบุคคลธรรมดา/);
  assert.match(html, /เลือก “จ่ายค่าอะไร” ก่อนยืนยันเอกสาร/);
  assert.equal(screen.field('ผู้รับเงินเป็นใคร')['aria-invalid'], true);
  assert.equal(screen.field('จ่ายค่าอะไร')['aria-invalid'], true);
});

test('R4 missing identity answers never block the money preview; malformed money still does', () => {
  const line = { description: 'ค่าบริการ', quantity: '1', unitPrice: '100', discountAmount: '0', vatRate: '', whtRate: '0.03' };
  const screen = view(ExpenseReviewEditSection, detail({ vendorNameSnapshot: '', whtAmount: '3', whtInput: { inputType: 'RATE', value: '3' }, lines: [line] }));
  screen.render(); assert.equal(screen.previewBlockers.at(-1), null);
  const invalid = view(ExpenseReviewEditSection, detail({ lines: [{ ...line, unitPrice: '-1' }] }));
  invalid.render(); assert.ok(invalid.previewBlockers.at(-1));
});

test('R5 warns under the seller tax field only for a complete invalid 13-digit number and never disables save', () => {
  const short = view(ExpenseReviewEditSection, detail({ vendorTaxIdSnapshot: '123456789012' }));
  assert.doesNotMatch(short.render(), /เลขผู้เสียภาษี 13 หลักนี้ดูไม่ถูกต้อง/);
  const invalid = view(ExpenseReviewEditSection, detail({ vendorTaxIdSnapshot: '1234567890123' }));
  const html = invalid.render();
  assert.match(html, /เลขผู้เสียภาษี 13 หลักนี้ดูไม่ถูกต้อง ลองตรวจกับใบเสร็จอีกครั้ง/);
  const taxField = invalid.nodes.find(n => n.props?.id === 'expense-vendor-tax-expense');
  assert.equal(taxField?.props['aria-describedby'], 'expense-vendor-tax-warning-expense');
  assert.notEqual(taxField?.props['aria-invalid'], true);
  assert.doesNotMatch(html, /กรุณากรอกเลขผู้เสียภาษีให้ครบ 13 หลัก/);
});

test('R4 the first refusal focuses the first invalid field after revealing all answers', async () => {
  const saveRef = { current: null as null | (() => Promise<boolean>) };
  const screen = view(ExpenseReviewEditSection, detail({ vendorNameSnapshot: '' }), { saveRef });
  const previous = globalThis.document; let scrolled = 0, focused = 0;
  (globalThis as any).document = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
    getElementById: (id: string) => { assert.equal(id, 'expense-review-fields-expense'); return { querySelector: (query: string) => {
      assert.equal(query, '[aria-invalid="true"]'); window.scrollBy = (() => scrolled++) as any; return focusDomField(() => focused++);
    } }; } };
  try {
    screen.render(); screen.render(); assert.equal(await saveRef.current!(), false); screen.render();
    assert.equal(scrolled, 1); assert.equal(focused, 1);
  } finally { (globalThis as any).document = previous; }
});

test('receiptless review prefills a missing seller from its certificate as unsaved input and keeps typed edits on refresh', () => {
  for (const status of ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED']) {
    const dirty: boolean[] = [];
    const initial = detail({ vendorNameSnapshot: '', substituteReceiptEvidence: { status, payeeName: 'ป้าศรี แผงผัก ตลาดเช้า' },
      aiVerificationSummaryJson: { documentReview: { assessment: { route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', reason: '', attachmentIds: [] } } } });
    const screen = view(ExpenseReviewEditSection, initial, { onDirtyChange: (value: boolean) => dirty.push(value) });
    screen.render(); const html = screen.render();
    assert.match(html, /value="ป้าศรี แผงผัก ตลาดเช้า"/);
    assert.equal(dirty.at(-1), true);
    assert.doesNotMatch(html, /ชื่อตามใบเสร็จ|วันที่บนใบเสร็จ ไม่ใช่วันที่จ่าย/);
    screen.field('ป้าศรี แผงผัก ตลาดเช้า').onChange({ target: { value: 'ชื่อที่แก้เอง' } });
    screen.props.detail = { ...initial, updatedAt: 'v2' }; screen.render();
    assert.match(screen.render(), /value="ชื่อที่แก้เอง"/);
  }
});

test('the expense evidence step displays a shared line category without writing an expense category', async () => {
  shopCategories = [{ id: 'cat', name: 'วัตถุดิบ' }];
  try {
    const screen = view(DocumentReviewSection, detail({ lines: [{ expenseCategoryId: 'cat' }] }));
    screen.render(); await new Promise(resolve => setImmediate(resolve));
    const html = screen.render();
    assert.match(html, /วัตถุดิบ \(ตามรายการ\)/);
    assert.equal(screen.field(t('expenses.category', 'th')).value, '');
    screen.props.detail = detail({ updatedAt: 'v2', lines: [{ expenseCategoryId: 'cat' }, { expenseCategoryId: null }] });
    assert.doesNotMatch(screen.render(), /วัตถุดิบ \(ตามรายการ\)/);
  } finally { shopCategories = []; }
});

test('Next saves the certificate payee through the existing review call and clears dirty state after the readback', async () => {
  const saveRef = { current: null as null | (() => Promise<boolean>) };
  const dirty: boolean[] = [], payloads: any[] = [];
  const initial = detail({ vendorNameSnapshot: '', sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY',
    substituteReceiptEvidence: { status: 'PREPARED', payeeName: 'ป้าศรี', businessPurpose: 'ซื้อผัก' },
    lines: [{ id: 'line', description: 'ผัก', quantity: '1', unitPrice: '100', discountAmount: '0', vatRate: '0', whtRate: '0', expenseCategoryId: 'cat' }],
    aiVerificationSummaryJson: { documentReview: { assessment: { route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: [], reason: 'ร้านไม่มีใบเสร็จ' } } },
  });
  const screen = view(ExpenseReviewEditSection, initial, { saveRef, onDirtyChange: (value: boolean) => dirty.push(value),
    onSaved: async () => { screen.props.detail = { ...initial, vendorNameSnapshot: 'ป้าศรี', updatedAt: 'v2' }; },
  });
  const update = mock.method(api, 'updateExpenseReviewFields', async (_company: string, _expense: string, payload: any) => { payloads.push(payload); return {}; });
  try {
    screen.render(); screen.render(); assert.equal(dirty.at(-1), true);
    assert.equal(await saveRef.current!(), true);
    assert.equal(payloads.length, 1); assert.equal(payloads[0].vendorNameSnapshot, 'ป้าศรี');
    screen.render(); screen.render(); assert.equal(dirty.at(-1), false);
  } finally { update.mock.restore(); }
});

test('UX7 validation waits for the rendered invalid field and focuses it once', async () => {
  const saveRef = { current: null as null | (() => Promise<boolean>) };
  const screen = view(ExpenseReviewEditSection, detail({ vendorNameSnapshot: '' }), { saveRef });
  let rendered = false, focused = 0, scrolled = 0, observe: (() => void) | undefined, disconnected = 0;
  const previous = globalThis.MutationObserver;
  const previousGetElementById = document.getElementById;
  window.scrollBy = (() => scrolled++) as any; const target = focusDomField(() => focused++);
  const root = { querySelector: () => rendered ? target : null };
  (globalThis as any).document.getElementById = () => root;
  (globalThis as any).MutationObserver = class {
    constructor(callback: () => void) { observe = callback; }
    observe(node: unknown, options: any) { assert.equal(node, root); assert.equal(options.subtree, true); }
    disconnect() { disconnected++; }
  };
  try {
    screen.render(); screen.render(); assert.equal(await saveRef.current!(), false);
    screen.render(); assert.equal(focused, 0);
    assert.ok(observe, 'waits for DOM changes rather than a number of frames');
    observe(); assert.equal(focused, 0);
    rendered = true; observe(); assert.equal(focused, 1); assert.equal(scrolled, 1); assert.ok(disconnected > 0);
  } finally { globalThis.MutationObserver = previous; document.getElementById = previousGetElementById; }
});

test('BEH-P evidence refusal focuses its rendered file control, not the document-type grid', async () => {
  const saveRef = { current: null as null | (() => Promise<boolean>) };
  const screen = view(DocumentReviewSection, detail({ sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY' }), { saveRef, onAttachPrimaryReceipt() {} });
  screen.render(); screen.render();
  assert.equal(await saveRef.current!(), false);
  const html = screen.render();
  assert.match(html, /id="expense-evidence-files-expense"[^>]*aria-invalid="true"/);
  assert.ok(screen.nodes.some(n => n.tag === 'input' && n.props.type === 'file' && n.props['aria-label'] === 'แนบไฟล์'));
});

test('BEH-P adding and removing lines focuses their first input or the add button after rendering', () => {
  const screen = view(ExpenseReviewEditSection, detail());
  const focused: string[] = [];
  document.getElementById = (id: string): any => {
    if (!screen.nodes.some(n => n.props.id === id)) return null;
    return focusDomField(() => focused.push(id));
  };
  screen.render();
  screen.click('เพิ่มรายการ'); screen.render();
  assert.equal(focused.at(-1), 'expense-review-line-input-expense-0');
  screen.click('เพิ่มรายการ'); screen.render();
  assert.equal(focused.at(-1), 'expense-review-line-input-expense-1');
  screen.nodes.find(n => n.props['aria-label'] === 'ลบรายการที่ 2')!.props.onClick(); screen.render();
  assert.equal(focused.at(-1), 'expense-review-line-input-expense-0');
  screen.nodes.find(n => n.props['aria-label'] === 'ลบรายการที่ 1')!.props.onClick(); screen.render();
  assert.equal(focused.at(-1), 'expense-add-line-expense');
});

test('BEH-P repeated Next refusal focuses the rendered file field and its first control', async () => {
  const saveRef = { current: null as null | (() => Promise<boolean>) };
  const screen = view(DocumentReviewSection, detail({ sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY' }), { saveRef, onAttachPrimaryReceipt() {} });
  let focused = 0;
  document.getElementById = (id: string): any => {
    const node = screen.nodes.find(n => n.props.id === id);
    if (!node) return null;
    assert.equal(id, 'expense-evidence-files-expense');
    return { closest: () => null, matches: () => false, getBoundingClientRect: () => ({ top: 900, bottom: 1000, height: 100 }), querySelector: () => focusDomField(() => focused++) };
  };
  screen.render(); screen.render();
  for (let attempt = 1; attempt <= 2; attempt++) {
    assert.equal(await saveRef.current!(), false);
    screen.render();
    assert.equal(focused, attempt);
  }
});

test('EVID-1 original-paper choice saves without files, keeps tax answers and shows a reminder until a later image is selected', async () => {
  const saveRef = { current: null as null | (() => Promise<boolean>) }; const bodies: any[] = [];
  const saved = mock.method(api, 'updateExpenseReviewFields', async (_company: string, _id: string, body: any) => { bodies.push(body); return {}; });
  const initial = detail({ sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', inputVatClaimStatus: 'CLAIMABLE', expenseCategoryId: 'cat' });
  const screen = view(DocumentReviewSection, initial, { saveRef });
  try {
    screen.render(); screen.field('มีตัวจริง ยังไม่ได้แนบรูป').onChange({ target: { checked: true } }); screen.render();
    screen.field('หมายเหตุ').onChange({ target: { value: 'อยู่กับผู้ทำบัญชี' } }); screen.render();
    assert.equal(await saveRef.current!(), true);
    assert.equal(bodies[0].taxEvidenceStatus, 'USABLE_FOR_TAX'); assert.equal(bodies[0].sourceDocumentType, 'TAX_INVOICE');
    assert.deepEqual(bodies[0].evidenceAssessment, { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: [], reason: '', originalDocumentAvailable: true, note: 'อยู่กับผู้ทำบัญชี' });
    screen.props.detail = { ...initial, updatedAt: 'v2', aiVerificationSummaryJson: { documentEvidenceDraft: bodies[0].evidenceAssessment } };
    const html = screen.render(); assert.match(html, /มีตัวจริง ยังไม่ได้แนบรูป/); assert.match(html, /หมายเหตุ/);
    assert(deriveExpenseAuditChecks(screen.props.detail).some(check => check.label === 'ยังไม่มีรูปเอกสาร'));
    assert(deriveEvidenceRowFlags({ ...screen.props.detail, categoryName: 'หมวด' }).some(flag => flag.label === 'ยังไม่มีรูปเอกสาร'));
    const file = { id: 'later', status: 'ACTIVE', purpose: 'expense.receipt.primary', originalFileName: 'ใบกำกับ.png' };
    screen.props.detail = { ...screen.props.detail, updatedAt: 'v3', attachments: [file] }; screen.render();
    assert(expenseEvidenceImageMissing(screen.props.detail));
    screen.click('ไม่มีใบเสร็จ หรือใบเสร็จมีปัญหา'); screen.render();
    screen.field('ใบกำกับ.png').onChange({ target: { checked: true } }); screen.render();
    assert.equal(await saveRef.current!(), true);
    screen.props.detail = { ...screen.props.detail, updatedAt: 'v4', aiVerificationSummaryJson: { documentEvidenceDraft: bodies[1].evidenceAssessment } }; screen.render();
    assert(!deriveExpenseAuditChecks(screen.props.detail).some(check => check.label === 'ยังไม่มีรูปเอกสาร'));
    assert(!deriveEvidenceRowFlags({ ...screen.props.detail, categoryName: 'หมวด' }).some(flag => flag.label === 'ยังไม่มีรูปเอกสาร'));
    assert(!screen.nodes.some(node => node.props['aria-label'] === 'มีตัวจริง ยังไม่ได้แนบรูป'));
    assert.equal(screen.field('หมายเหตุ').maxLength, 500);
  } finally { saved.mock.restore(); }
});

test('e-WHT setting gates the live review form, preserves saved bank records on read failure and makes no free-shop request', async () => {
  const { E_WHT_WORDS } = require('@watchdog-bms/contracts');
  for (const used of [true, false, 'failed'] as const) for (const stored of ['PAYER_FILES', 'E_WHT']) for (const free of [false, true]) for (const canManage of [false, true]) {
    const request = mock.method(api, 'getExpenseEWhtSetting', async () => { if (used === 'failed') throw new Error('offline'); return { used }; });
    const screen = view(ExpenseReviewEditSection, detail({ whtAmount: '1', whtRemittance: stored, whtCategoryCode: 'WHT_ADVERTISING_IND',
      vendorEntityKindSnapshot: 'INDIVIDUAL', whtRate: '1', whtInputJson: { inputType: 'RATE', value: '1' } }),
      { freeExpenseDrafts: free, permissions: canManage ? ['company.setup.manage'] : [] });
    try {
      screen.render(); await new Promise(resolve => setImmediate(resolve));
      const html = screen.render();
      const visible = screen.nodes.some(node => node.props['aria-label'] === E_WHT_WORDS['W-F1']);
      assert.equal(visible, !free && (used === true || stored === 'E_WHT'), `${used}/${stored}/${free}`);
      assert.equal(request.mock.callCount(), free ? 0 : 1);
      if (!free && used !== true && stored === 'PAYER_FILES') {
        assert.ok(html.includes(E_WHT_WORDS[canManage ? 'W-F10o' : "W-F10o'"]));
        assert.equal(html.includes('href="/companies/co/settings/e-wht"'), canManage);
      }
    } finally { request.mock.restore(); }
  }
});
