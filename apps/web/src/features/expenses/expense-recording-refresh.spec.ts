import assert from 'node:assert/strict';
import { test, mock, beforeEach, afterEach } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastContext } from '@/common/components/toast/use-toast';
import { h, mutable } from './expense-certificate-test-harness';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { mergeExpenseUnsavedFields, expenseTaxEvidenceReasonMessage, deriveExpenseAuditChecks, TAX_EVIDENCE_STATUS_LABELS } from './expenses.model';
import { readFileSync } from 'node:fs';

require.extensions['.svg'] = (module: any) => { module.exports = () => null; };
const api = mutable('./expenses.api');
const policy = mutable('./expense-capture-policy');
const totals = mutable('./useExpenseReviewTotals');
const select = mutable('@/common/components/field/ThemedSelect');
const tip = mutable('@/common/components/field/InfoTip');
const { DocumentReviewSection, ExpenseReviewEditSection } = require('./ExpensesPages');
const originalDocument = globalThis.document, originalWindow = globalThis.window;
beforeEach(() => {
  (globalThis as any).document = { addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
  (globalThis as any).window = { addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback: () => void) { callback(); return 1; } };
});
afterEach(() => { (globalThis as any).document = originalDocument; (globalThis as any).window = originalWindow; });
const detail = (over: Record<string, unknown> = {}): any => ({
  id: 'expense', companyId: 'co', status: 'DRAFT', updatedAt: 'v1', expenseDate: '2026-10-11',
  vendorNameSnapshot: 'ชื่อเดิม', vendorTaxIdSnapshot: '', vendorAddressSnapshot: '', vendorBranchCodeSnapshot: '',
  vendorDocumentNumber: 'OLD', sourceDocumentType: 'NEEDS_REVIEW', taxEvidenceStatus: 'NEEDS_REVIEW', expenseCategoryId: null,
  vatMode: 'NO_VAT', whtAmount: '0', vatAmount: '0', grandTotalAmount: '100', netPayableAmount: '100', paidAmount: '0',
  lines: [], attachments: [], aiVerificationSummaryJson: null, aiVerifiedFieldsJson: null, ...over,
});

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
        if (!old || deps?.some((value, i) => !Object.is(value, old.deps?.[i]))) {
          pending.push(() => { old?.cleanup?.(); slots[at] = { deps, cleanup: fn() }; });
        }
      }),
      mock.method(runtime, 'createElement', (tag: any, p: any, ...children: any[]) => {
        nodes.push({ tag: typeof tag === 'string' ? tag : tag.name, props: { ...p, children } }); return create(tag, p, ...children);
      }),
      mock.method(api, 'listExpenseCategories', async () => []),
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
  (globalThis as any).window = { addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback: () => void) { callback(); return 1; } };
  try {
    const screen = view(DocumentReviewSection, detail()); screen.render(); screen.render();
    screen.field('ประเภทเอกสาร').onChange({ target: { value: 'RECEIPT' } });
    screen.field('สถานะหลักฐานภาษี').onChange({ target: { value: 'SUPPORTING_ONLY' } });
    screen.click('เอกสารมีปัญหา / เลือกหลักฐาน'); screen.render();
    screen.field('ปัญหาของเอกสาร').onChange({ target: { value: 'NOT_AVAILABLE' } }); screen.render();
    screen.field('เหตุผลที่ใช้หลักฐานนี้').onChange({ target: { value: 'เหตุผลที่กำลังพิมพ์' } });
    screen.props.detail = detail({ updatedAt: 'v2', primaryAttachmentId: 'new', attachments: [{ id: 'new', purpose: 'expense.receipt.primary', status: 'ACTIVE' }], expenseCategoryId: 'server-category' });
    screen.render(); screen.render();
    assert.equal(screen.field('ประเภทเอกสาร').value, 'RECEIPT');
    assert.equal(screen.field('สถานะหลักฐานภาษี').value, 'SUPPORTING_ONLY');
    assert.equal(screen.field('server-category').value, 'server-category');
    assert.equal(screen.field('เหตุผลที่ใช้หลักฐานนี้').value, 'เหตุผลที่กำลังพิมพ์');
    screen.props.detail = detail({ updatedAt: 'v3', expenseCategoryId: 'server-category' });
    screen.render(); screen.render();
    assert.equal(screen.field('ประเภทเอกสาร').value, 'RECEIPT');
    assert.equal(screen.field('สถานะหลักฐานภาษี').value, 'SUPPORTING_ONLY');
    assert.equal(screen.field('เหตุผลที่ใช้หลักฐานนี้').value, 'เหตุผลที่กำลังพิมพ์');
  } finally { (globalThis as any).window = originalWindow; }
});

test('R2 receipt refusal exposes upload and evidence choices; review save is primary and draft save is secondary', () => {
  const files: File[] = [];
  const screen = view(DocumentReviewSection, detail({ sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY' }), {
    onAttachPrimaryReceipt: async (file: File) => { files.push(file); },
  });
  const html = screen.render();
  assert.match(html, /ยังไม่มีหลักฐาน กรุณาแนบหรือเลือกหลักฐาน/);
  assert.equal((html.match(/เอกสารมีปัญหา \/ เลือกหลักฐาน/g) ?? []).length, 1);
  const receipt = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' });
  screen.field('แนบไฟล์ใบเสร็จ').onChange({ target: { files: [receipt], value: 'receipt.pdf' } });
  assert.deepEqual(files, [receipt]);
  screen.click('เอกสารมีปัญหา / เลือกหลักฐาน'); screen.render();
  assert.ok(screen.field('ปัญหาของเอกสาร'));
  const primary = screen.nodes.find(n => n.tag === 'button' && n.props.children.includes('บันทึกการตรวจ'));
  const draft = screen.nodes.find(n => n.tag === 'button' && n.props.children.includes('บันทึกฉบับร่าง'));
  assert.ok(primary?.props.className.includes('mangmee-btn-primary'));
  assert.ok(draft?.props.className.includes('mangmee-btn-secondary'));
  assert.match(html, /ยังไม่นับว่าตรวจแล้ว/); assert.doesNotMatch(html, /เก็บไว้ทำต่อ|บันทึกแบบร่าง|เก็บร่างไว้ก่อน/);
});

test('R2 shows only actionable evidence reasons and uses the evidence option words in the summary', () => {
  assert.equal(expenseTaxEvidenceReasonMessage('MANUAL_OVERRIDE'), null);
  for (const code of ['HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE', 'HANDWRITTEN_RECEIPT_REVIEW', 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE'] as const) assert.ok(expenseTaxEvidenceReasonMessage(code));
  const html = view(DocumentReviewSection, detail({ taxEvidenceReasonCode: 'MANUAL_OVERRIDE' })).render();
  assert.doesNotMatch(html, /ผู้ตรวจแก้ไขผลด้วยตนเอง/);
  const checks = deriveExpenseAuditChecks(detail({ taxEvidenceStatus: 'USABLE_FOR_TAX' }));
  assert.equal(checks.find(check => check.key === 'tax_evidence')?.label, TAX_EVIDENCE_STATUS_LABELS.USABLE_FOR_TAX);
});

test('R2 manual receipt hint stays short and section chips form one scrolling row', () => {
  assert.equal(t('expenses.manual_receipt_helper', 'th'), 'แนบทีหลังได้ ก่อนยืนยันต้องมีใบเสร็จหรือเหตุผล');
  for (const key of ['expenses.source_draft_save', 'expenses.review_save_draft', 'expenses.manual_save_draft'] as const) assert.equal(t(key, 'th'), 'บันทึกฉบับร่าง');
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /guided \? 'flex-wrap gap-y-1\.5' : 'flex-nowrap overflow-x-auto'/);
  assert.match(page, /navChips\.map[\s\S]{0,300}shrink-0 whitespace-nowrap/);
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
  const evidence = view(DocumentReviewSection, detail()); evidence.render();
  const taxId = evidence.field(t('expenses.tax_evidence_status', 'th'))['aria-describedby'];
  assert.ok(taxId);
  assert.ok(evidence.nodes.some(n => n.tag === 'p' && n.props.id === taxId && n.props.className.includes('text-xs text-gray-500')));
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
  assert.doesNotMatch(html, /กรุณากรอกชื่อผู้ขาย|aria-invalid="true"/);
  assert.equal(await saveRef.current!(), false);
  html = screen.render();
  assert.match(html, /กรุณากรอกชื่อผู้ขาย/);
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
  (globalThis as any).document = { addEventListener() {}, removeEventListener() {},
    getElementById: (id: string) => { assert.equal(id, 'expense-review-fields-expense'); return { querySelector: (query: string) => {
      assert.equal(query, '[aria-invalid="true"]'); return { scrollIntoView: () => scrolled++, focus: () => focused++ };
    } }; } };
  try {
    screen.render(); screen.render(); assert.equal(await saveRef.current!(), false);
    assert.equal(scrolled, 1); assert.equal(focused, 1);
  } finally { (globalThis as any).document = previous; }
});
