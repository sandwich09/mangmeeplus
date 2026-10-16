/**
 * "เตรียมใบเบิก" carries its source (capture appendix §13.4 / §12.3, W04b deviation 8).
 *
 * Source guards cover the route; the rendered handler tests below cover category suggestions. What it holds:
 * the id is read from the URL, the SERVER is asked whether that expense may be claimed, and an
 * answer of "no" is printed with its reason instead of leaving a blank draft (the W04b gap).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./ReimbursementCreatePage.tsx', import.meta.url), 'utf8');
const route = readFileSync(
  new URL('../../../app/(workspace)/companies/[companyId]/reimbursements/new/page.tsx', import.meta.url),
  'utf8',
);

test('the route reads ?expenseId= from the search params and passes it down', () => {
  assert.match(route, /searchParams\?: Promise<Record<string, string \| string\[\] \| undefined>>/);
  assert.match(route, /const query = searchParams \? await searchParams : \{\};/);
  assert.match(route, /typeof query\['expenseId'\] === 'string'/);
  assert.match(route, /sourceExpenseId: expenseId/);
});

test('the id is resolved through the server, never trusted as an eligible source', () => {
  assert.match(page, /getReimbursementSourceOptions\(companyId, \{ branchId: selectedBranch, requesterUserId, expenseId: sourceExpenseId \}\)/);
  assert.match(page, /if \(!source\.eligible\) \{ setSourceLinkNotice\(errorMessage\(source\.reason \?\? 'reimbursement_source_unavailable'\)\); return; \}/);
  assert.match(page, /if \(!source\) \{ setSourceLinkNotice\(errorMessage\('reimbursement_source_unavailable'\)\); return; \}/);
});

test('an eligible source becomes line 1 through the same path the picker uses', () => {
  assert.match(page, /setLine\(0, lineFromSource\(source\)\);/);
  // One builder for both, so a source chosen by link and a source chosen by hand cannot differ.
  assert.match(page, /const selectSource = \(index: number, expenseId: string\) => \{[\s\S]*setLine\(index, lineFromSource\(source\)\);/);
  // The facts block renders off the snapshot the line now carries.
  assert.match(page, /sourceExpenseSnapshot: source\.snapshot/);
  assert.match(page, /<ReimbursementSourceFacts/);
});

test('the reason is shown inline, and only once per visit', () => {
  assert.match(page, /\{sourceLinkNotice && <ErrorBanner message=\{`รายการต้นทางที่เลือกมายังเบิกไม่ได้: \$\{sourceLinkNotice\}`\} \/>\}/);
  assert.match(page, /if \(!sourceExpenseId \|\| editing \|\| preselectedRef\.current/, 'never re-applied after the person clears it');
  assert.match(page, /preselectedRef\.current = true;/);
});


test('receipt reason follows bootstrap policy and strict shops name the missing receipt on its line', () => {
  assert.match(page, /const asksReceiptReason = sourceOptions.receiptPolicy\?.allowMissingReceiptWithReason === true/);
  assert.match(page, /receiptPolicy: sourceOptions.receiptPolicy/);
  assert.match(page, /ร้านนี้ต้องแนบใบเสร็จทุกรายการก่อนส่งอนุมัติ/);
});

test('send saves and attaches before fetching a fresh payout token; failed sends open the saved draft', () => {
  assert.ok(page.indexOf('await updateReimbursementDraft(companyId, requestId') < page.indexOf('await finishSavedDraft(requestId, send)'));
  assert.ok(page.indexOf('createdId = created.id') < page.indexOf('await finishSavedDraft(created.id, send)'));
  assert.match(page, /const saved = await getReimbursement\(companyId, id\);\s+await submitReimbursement\(companyId, id, saved.payout\?.submitToken\)/);
  assert.match(page, /if \(send && createdId\) \{[\s\S]*sessionStorage\.setItem\(`claim-submit:\$\{createdId\}`, message\)/);
});

test('failed sends are consumed once outside the address and only shown on drafts', () => {
 const journey = readFileSync(new URL('./ReimbursementJourneyPage.tsx', import.meta.url), 'utf8');
 assert.doesNotMatch(page + journey, /submitError=/);
 assert.match(journey, /sessionStorage.removeItem\(key\)/);
 assert.match(journey, /detail.status === 'DRAFT' && submitFailure/);
});


// Exercise the real page handlers with the existing SSR hook harness; no browser or server.
import { mock } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { certificateHarness, h, mutable } from '../expenses/expense-certificate-test-harness';
require.extensions['.svg'] = module => { module.exports = () => null; };
const select = mutable('@/common/components/field/ThemedSelect');
const api = mutable('../reimbursements/reimbursements.api');
const { ReimbursementCreatePage } = require('./ReimbursementCreatePage');
const noop = () => undefined;
function createView(props: object = {}) {
  return certificateHarness(() => h(AppRouterContext.Provider, { value: { push: noop, prefetch: noop } as never },
    h(ToastContext.Provider, { value: { success: noop, error: noop } as never },
      h(ReimbursementCreatePage, { companyId: 'co', canCreate: true, ...props }))));
}
function category(view: ReturnType<typeof createView>, index = 0) {
  return view.nodes.filter(node => node.tag === 'ThemedSelect' && node.props['aria-label'] === 'หมวด')[index]!.props;
}
function describeLine(view: ReturnType<typeof createView>, value: string, index = 0) {
  view.nodes.filter(node => node.tag === 'input' && node.props['aria-label'] === 'รายการ')[index]!.props.onChange({ target: { value } });
  return view.render();
}
function plainChooser() { return mock.method(select, 'ThemedSelect', function ThemedSelect(props: any) { return h('select', props, props.children); }); }

test('UX9 typing a taxi description selects travel without a hint line (owner: the chooser says it), and re-evaluates until the person chooses', () => {
  const chooser = plainChooser(), view = createView();
  try {
    assert.match(view.render(), /เลือกหมวด/); assert.equal(category(view).value, '');
    assert.doesNotMatch(describeLine(view, 'แท็กซี่ไปลูกค้า'), /เลือกให้จากรายละเอียด/);
    assert.equal(category(view).value, 'travel');
    describeLine(view, 'น้ำดื่ม'); assert.equal(category(view).value, 'meals');
    assert.doesNotMatch(describeLine(view, 'รายการทั่วไป'), /เลือกให้จากรายละเอียด เปลี่ยนได้/);
    assert.equal(category(view).value, '');
    describeLine(view, 'แท็กซี่และข้าว'); assert.equal(category(view).value, '');
    describeLine(view, 'แท็กซี่');
    category(view).onChange({ target: { value: 'supplies' } });
    assert.doesNotMatch(view.render(), /เลือกให้จากรายละเอียด เปลี่ยนได้/);
    describeLine(view, 'โรงแรม'); assert.equal(category(view).value, 'supplies');
  } finally { view.cleanup(); chooser.mock.restore(); }
});
test('UX9 a category choice belongs to its line, including after another line is removed', () => {
  const chooser = plainChooser(), view = createView();
  try {
    view.render(); describeLine(view, 'แท็กซี่');
    category(view).onChange({ target: { value: 'other' } }); view.render();
    view.find('button', p => p.children.includes('+ เพิ่มรายการ')).onClick(); view.render();
    describeLine(view, 'ถุง', 1); assert.equal(category(view, 1).value, 'supplies');
    assert.equal(category(view).value, 'other');
    view.find('button', p => p['aria-label'] === 'ลบรายการ').onClick(); view.render();
    describeLine(view, 'กาแฟ'); assert.equal(category(view).value, 'meals');
  } finally { view.cleanup(); chooser.mock.restore(); }
});
test('UX9 saved draft and saved expense categories survive description edits without a suggestion hint', async () => {
  const chooser = plainChooser();
  const read = mock.method(api, 'getReimbursement', async () => ({ status: 'DRAFT', requesterUserId: '', lines: [
    { description: 'แท็กซี่', categoryKey: 'other' },
    { description: 'ถุง', categoryKey: 'expense-category', categoryLabelSnapshot: 'หมวดจากค่าใช้จ่าย', linkedExpenseId: 'expense' },
  ] }));
  const view = createView({ requestId: 'draft', canUpdate: true });
  try {
    view.render(true); await view.settle(); view.render();
    assert.doesNotMatch(describeLine(view, 'กาแฟ'), /เลือกให้จากรายละเอียด เปลี่ยนได้/);
    assert.equal(category(view).value, 'other');
    describeLine(view, 'โรงแรม', 1); assert.equal(category(view, 1).value, 'expense-category');
  } finally { view.cleanup(); read.mock.restore(); chooser.mock.restore(); }
});

test('CLAIM-LIST first card groups requester and branch, with reason across both columns', () => {
  const view = createView({ canPrepareForOthers: true });
  const html = view.render();
  assert.match(html, /mangmee-flat/);
  const first = html.slice(html.indexOf('grid gap-3 p-4 sm:grid-cols-2'), html.indexOf('รายการที่ขอเบิก'));
  assert.ok(first.indexOf('ผู้เบิก') < first.indexOf('data-transaction-branch-select'));
  assert.ok(first.indexOf('data-transaction-branch-select') < first.indexOf('เหตุผล'));
  assert.match(first, /sm:col-span-2/);
  assert.equal(html.match(/data-transaction-branch-select/g)?.length, 1);
});

test('CLAIM-LIST single item has a heading, receipt first, then description and a three-column money/date/category row', () => {
  const view = createView();
  const html = view.render();
  assert.match(html, /<h4[^>]*>รายการที่ 1<\/h4>/);
  assert.doesNotMatch(html, /<button[^>]*aria-expanded=[^>]*>[\s\S]*?รายการที่ 1<\/span>/);
  assert.match(html, /mt-3 grid gap-3 lg:grid-cols-3/);
  const item = html.slice(html.indexOf('รายการที่ 1'), html.indexOf('+ เพิ่มรายการ'));
  for (const [left, right] of [['ใบเสร็จ', 'เลือกจากค่าใช้จ่ายที่บันทึกไว้'], ['เลือกจากค่าใช้จ่ายที่บันทึกไว้', 'aria-label="รายการ"'],
    ['aria-label="รายการ"', 'aria-label="จำนวนเงิน"'], ['aria-label="จำนวนเงิน"', 'aria-label="วันที่"'], ['aria-label="วันที่"', 'aria-label="หมวด"'], ['aria-label="หมวด"', 'วัตถุประสงค์']]) {
    assert.ok(item.indexOf(left) < item.indexOf(right), `${left} before ${right}`);
  }
  assert.match(page, /form.lines.length > 1 && collapsedLines\[i\] && 'hidden'/);
  assert.match(page, /form.lines.length === 1 \? <h4/);
  assert.match(page, /<div>\s+<label className=\{labelClass\}>หมวด\{req\}<\/label>/);
  assert.match(page, /<div className="lg:col-span-3">\s+<label className=\{labelClass\}>วัตถุประสงค์/);
  const bar = html.slice(html.indexOf('data-form-action-bar'));
  assert.match(bar, /ยกเลิก[\s\S]*บันทึกร่าง[\s\S]*ส่งอนุมัติ/);
  assert.doesNotMatch(html.slice(0, html.indexOf('data-form-action-bar')), />บันทึกร่าง<|>ส่งอนุมัติ</);
});
