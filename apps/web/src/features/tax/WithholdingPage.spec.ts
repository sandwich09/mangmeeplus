import { E_WHT_WORDS } from '@watchdog-bms/contracts';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import * as React from 'react';
import { certificateHarness, h, mutable } from '../expenses/expense-certificate-test-harness';
import { readFileSync } from 'node:fs';
import { ToastContext } from '@/common/components/toast/use-toast';
import { renderToStaticMarkup } from 'react-dom/server';
(globalThis as any).React = React;
(globalThis as any).self = globalThis;
require.extensions['.css'] = module => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }; };
const navigation = mutable('next/navigation');
const visits: string[] = [];
navigation.useRouter = () => ({ push: (href: string) => visits.push(href) });
const svg = require.extensions['.svg'];
require.extensions['.svg'] = module => { module.exports = () => null; };
const outsideClick = mutable('@/common/hooks/use-close-on-outside-click');
const api = mutable('../tax/tax.api');
const expenseApi = mutable('../expenses/expenses.api');
const downloads = mutable('@/common/files/download-artifact');
const toast = { success: mock.fn(), error: mock.fn(), warning: mock.fn() };
const withToast = (node: React.ReactNode) => h(ToastContext.Provider, { value: toast }, node);
const confirmations = mutable('@/common/components/modal/use-confirm');
const { WithholdingPage } = require('./WithholdingPage');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
(globalThis as any).React = React;

test('withholding links to the shop certificate list only when the reader may issue certificates', () => {
  for (const allowed of [true, false]) {
    const html = renderToStaticMarkup(withToast(React.createElement(WithholdingPage, { companyId: 'shop-1', permissions: ['wht.pnd53.read', ...(allowed ? ['wht.certificate.issue'] : [])] })));
    assert.equal(html.includes('ดูหนังสือรับรอง 50 ทวิ'), allowed); // the glossary's name; the link opens the whole list, so it names no month
    assert.equal(html.includes('href="/companies/shop-1/expenses/wht-certificates"'), allowed);
    assert.ok(html.includes('ภาษีหัก ณ ที่จ่าย'));
  }
});

test('WHT-OUTSIDE hides system certificate downloads in withholding rows when the shop no longer has the feature', () => {
  const { WithholdingPayments } = require('./WithholdingPage');
  const row = { id: 'pay', expenseId: 'expense', payeeName: 'ผู้รับ', paymentDate: '2026-10-20', formType: 'PND3', paid: '1000', withheld: '30',
    certificate: { state: 'SYSTEM_ISSUED', number: 'WHT-1', handoffId: 'handoff', canDownload: true } };
  for (const systemCertificatesAvailable of [false, true]) {
    const html = renderToStaticMarkup(h(WithholdingPayments, { rows: [row], month: { forms: [] }, companyId: 'co', order: 'newest',
      onOrder() {}, onOpen() {}, onCertificate() {}, certificateBusy: null, systemCertificatesAvailable }));
    assert.equal(html.includes('aria-label="ดาวน์โหลดหนังสือรับรอง"'), systemCertificatesAvailable);
    assert.match(html, /WHT-1/);
  }
});

const { WithholdingFormCard, withholdingPaymentPage, withholdingState, withholdingErrorMessage } = require('./WithholdingPage');
const form = (over: any = {}) => ({ formType: 'PND3', periodId: 'p', status: 'OPEN', paymentCount: 2, totalPaid: '1000', totalWithheld: '30', dueDate: '2026-11-07', issues: [], ...over });
test('PWS-WHT uses plain payment labels while distinguishing downloads, filings, additional and accountant papers', () => {
  const { WithholdingPayments } = require('./WithholdingPage');
  const html = renderToStaticMarkup(h(WithholdingPayments, { rows: [{ id: 'pay', payeeName: 'ผู้รับ', formType: 'PND3', paid: '1000', withheld: '30', incomeCategoryLabel: null }, { id: 'custom', payeeName: 'ผู้รับ', formType: 'PND3', paid: '1000', withheld: '30', incomeCategoryLabel: 'ประเภทเงินได้ตามเอกสารเดิมของร้าน' }], month: { forms: [] }, companyId: 'co', order: 'newest', onOrder() {}, onOpen() {}, onCertificate() {}, certificateBusy: null }));
  assert.match(html, /<th>จ่ายค่าอะไร<\/th>/);
  assert.match(html, /ยังไม่ได้เลือกว่าจ่ายค่าอะไร/);
  assert.match(html, /ประเภทเงินได้ตามเอกสารเดิมของร้าน/);
  assert.match(card(form({ status: 'EXPORTED' })), /ดาวน์โหลดแบบแล้ว[\s\S]*บันทึกว่ายื่นแล้ว/);
  assert.match(card(form({ status: 'FILED' })), /ยื่นแล้ว[\s\S]*ดาวน์โหลดแบบที่ยื่น/);
  assert.match(card(form({ sequence: 1 })), /ดาวน์โหลดแบบยื่นเพิ่มเติมครั้งที่ 1/);
  assert.match(card(form({ accountantPrepared: true })), /ผู้ทำบัญชีจัดทำแบบนี้เอง[\s\S]*ดาวน์โหลดรายการให้ผู้ทำบัญชี/);
  const view = pageView();
  try {
    (view.state[2] as any).separatePnd2 = [{ id: 'pnd2', payeeName: 'ผู้รับรางวัล', incomeCategoryLabel: 'รางวัลพิเศษ', paid: '1000', withheld: '30', expenseId: 'expense' }];
    assert.match(view.render(), /ต้องจัดทำ ภ.ง.ด.2 แยก[\s\S]*รางวัลพิเศษ[\s\S]*เปิดรายจ่าย/);
  } finally { view.cleanup(); }
});
function card(data: any, rights = ['wht.pnd53.prepare'], error?: string) {
  return renderToStaticMarkup(React.createElement(WithholdingFormCard, { form: data, companyId: 'co', periodKey: '2026-10', permissions: rights, busy: false, error, onDownload: () => {}, onFiled: () => {} }));
}
test('both forms have their own steps; empty forms and readers have no step buttons', () => {
  assert.match(card(form()), /ดาวน์โหลดแบบ ภ.ง.ด.3/);
  assert.match(card(form({ formType: 'PND53' })), /ดาวน์โหลดแบบ ภ.ง.ด.53/);
  assert.doesNotMatch(card(form(), []), /<button/);
  assert.match(card(form({ paymentCount: 0 })), /เดือนนี้ไม่มีรายการ/);
  assert.doesNotMatch(card(form({ paymentCount: 0 })), /<button/);
  assert.match(card(form({ status: 'EXPORTED' })), /บันทึกว่ายื่นแล้ว/);
  for (const status of ['FILED', 'PAID', 'CLOSED']) {
    assert.equal(withholdingState(status), 'ยื่นแล้ว');
    assert.doesNotMatch(card(form({ status })), /บันทึกว่ายื่นแล้ว/);
    assert.match(card(form({ status })), /ดาวน์โหลดแบบ/);
  }
});
test('issues show the server sentence and fixing link, never the code; shop fixes respect permission', () => {
  const issue = { id: 'i', issueCode: 'WHT_PAYEE_KIND_UNKNOWN', description: 'ยังไม่รู้ประเภทผู้รับเงิน เปิดคู่ค้าแล้วเลือกประเภทก่อน', counterpartyId: 'cp', expenseId: 'ex' };
  const html = card(form({ issues: [issue] }), ['wht.pnd53.prepare', 'accounting.counterparty.read', 'accounting.counterparty.manage']);
  assert.match(html, /counterparties\/cp/); assert.match(html, /ยังไม่รู้ประเภทผู้รับเงิน/); assert.doesNotMatch(html, /WHT_PAYEE_KIND_UNKNOWN/);
  const unlinked = card(form({ issues: [{ ...issue, counterpartyId: null }] }), ['expense.read', 'expense.update', 'expense.confirm']);
  assert.match(unlinked, /href="\/companies\/co\/expenses\/ex"[^>]*>เปิดค่าใช้จ่าย/);
  assert.doesNotMatch(unlinked, />เปิดคู่ค้า</);
  const payer = form({ issues: [{ ...issue, issueCode: 'PND3_FILING_PAYER', description: 'ข้อมูลร้านยังไม่ครบ' }] });
  assert.match(card(payer), /ให้เจ้าของกิจการ/);
  assert.match(card(payer, ['company.setup.read', 'company.legal_identity.manage']), /ตั้งค่าร้าน/);
  assert.match(card(form(), [], 'ตรวจประเภทเงินได้แล้วลองอีกครั้ง'), /role="alert"/);
});
test('sorts the whole filtered set before ten-row paging, ties by id and clamps a shorter result', () => {
  const rows = Array.from({ length: 26 }, (_, i) => ({ id: String(i).padStart(2, '0'), paymentDate: `2026-10-${String(Math.floor(i / 2) + 1).padStart(2, '0')}`, formType: i < 2 ? 'PND3' : 'PND53' }));
  assert.deepEqual(withholdingPaymentPage(rows, 'ALL', 1).rows.map((r: any) => r.id), ['25', '24', '23', '22', '21', '20', '19', '18', '17', '16']);
  assert.equal(withholdingPaymentPage(rows, 'ALL', 2).rows[0].id, '15');
  assert.equal(withholdingPaymentPage(rows, 'PND53', 1, 10, 'oldest').rows[0].id, '02');
  assert.equal(withholdingPaymentPage(rows, 'PND53', 3, 10, 'oldest').rows.length, 4);
  assert.equal(withholdingPaymentPage(rows, 'PND3', 3).rows.length, 2);
  assert.equal(rows[0].id, '00'); // sorting does not mutate the response
});

test('a refused export shows the server Thai sentence rather than a generic 409', () => {
  assert.equal(withholdingErrorMessage({ status: 409, code: 'PND3_FILING_PAYER', message: 'ข้อมูลร้านยังไม่ครบ เปิดข้อมูลร้านแล้วตรวจชื่อ' }), 'ข้อมูลร้านยังไม่ครบ เปิดข้อมูลร้านแล้วตรวจชื่อ');
});

function pageView(forms: any[] = [form(), form({ formType: 'PND53', periodId: 'p53' })], payments: any[] = [], permissions = ['wht.pnd53.read', 'wht.pnd53.prepare']) {
  return certificateHarness(() => withToast(h(WithholdingPage, { companyId: 'co', permissions })),
    [['2026-10'], '2026-10', { periodKey: '2026-10', forms, payments }, 'ALL', 1, false, false, {}, {}, '', null]);
}
test('download refusal stays on its form and rereads the current issue without disabling the other form', async () => {
  const sentence = 'ข้อมูลร้านยังไม่ครบ เปิดข้อมูลร้านแล้วตรวจชื่อ';
  const exportCall = mock.method(api, 'exportWithholding', async () => { throw { status: 409, code: 'PND3_FILING_PAYER', message: sentence }; });
  const fresh = { periodKey: '2026-10', forms: [form({ issues: [{ id: 'i', issueCode: 'PND3_FILING_PAYER', description: sentence }] }), form({ formType: 'PND53', periodId: 'p53' })], payments: [] };
  const read = mock.method(api, 'getWithholdingMonth', async () => fresh);
  const view = pageView();
  try {
    view.render(); view.find('WithholdingFormCard', p => p.form.formType === 'PND3').onDownload();
    await view.settle(); const html = view.render();
    assert.equal(read.mock.callCount(), 1); assert.match(html, /ข้อมูลร้านยังไม่ครบ/);
    assert.equal(view.find('WithholdingFormCard', p => p.form.formType === 'PND3').error, sentence);
    assert.equal(view.find('WithholdingFormCard', p => p.form.formType === 'PND53').error, undefined);
    assert.equal(view.find('WithholdingFormCard', p => p.form.formType === 'PND53').busy, false);
    assert.equal((view.state[2] as any).forms[0].issues.length, 1);
  } finally { view.cleanup(); exportCall.mock.restore(); read.mock.restore(); }
});
test('a refused download says its reason once: the listed issue with its link, not a second notice', () => {
  const sentence = 'ข้อมูลร้านยังไม่ครบ เปิดข้อมูลร้านแล้วตรวจชื่อ';
  const listed = card(form({ issues: [{ id: 'i', issueCode: 'PND3_FILING_PAYER', description: sentence }] }), ['wht.pnd53.read', 'wht.pnd53.prepare'], sentence);
  assert.equal(listed.split(sentence).length - 1, 1);
  // Before the month is re-read (or when the refusal recorded no issue) the notice still says it.
  assert.equal(card(form(), ['wht.pnd53.read', 'wht.pnd53.prepare'], sentence).split(sentence).length - 1, 1);
});
test('one sync refreshes the month; official downloads dispatch each form; filing asks once with the month', async () => {
  const fresh = { periodKey: '2026-10', forms: [form({ status: 'EXPORTED' }), form({ formType: 'PND53', periodId: 'p53', status: 'EXPORTED' })], payments: [] };
  const sync = mock.method(api, 'syncWithholding', async () => ({}));
  const months = mock.method(api, 'listWithholdingMonths', async () => ({ months: ['2026-10'] }));
  const read = mock.method(api, 'getWithholdingMonth', async () => fresh);
  const exportCall = mock.method(api, 'exportWithholding', async () => ({ artifact: { fileName: 'form.pdf', contentBase64: '', mimeType: 'application/pdf' } }));
  const save = mock.method(downloads, 'downloadArtifact', () => {});
  const confirm = mock.fn(async (_request: { title: string }) => true);
  const confirmation = mock.method(confirmations, 'useConfirm', () => ({ confirm, confirmDialog: null }));
  const filed = mock.method(api, 'markWithholdingFiled', async () => ({}));
  const view = pageView(fresh.forms);
  try {
    view.render();
    const controls = view.nodes.filter(n => n.tag === 'button' && n.props.children.includes('ดึงรายการล่าสุด'));
    assert.equal(controls.length, 1); controls[0].props.onClick(); await view.settle(); assert.equal(sync.mock.callCount(), 1);
    assert.deepEqual(sync.mock.calls[0].arguments, ['co', 'PND53']);
    assert.equal(read.mock.callCount(), 1);
    assert.deepEqual((view.state[2] as any).forms.map((f: any) => f.formType), ['PND3', 'PND53']);
    assert.deepEqual(toast.success.mock.calls.map(call => call.arguments), [['ดึงรายการล่าสุดแล้ว']]);
    for (const formType of ['PND3', 'PND53']) {
      view.render(); view.find('WithholdingFormCard', p => p.form.formType === formType).onDownload(); await view.settle();
    }
    assert.deepEqual(exportCall.mock.calls.map((call: { arguments: unknown[] }) => call.arguments[1]), ['PND3', 'PND53']); assert.equal(save.mock.callCount(), 2);
    assert.deepEqual(toast.success.mock.calls.slice(-2).map(call => call.arguments), [['ดาวน์โหลดแบบ ภ.ง.ด.3 แล้ว'], ['ดาวน์โหลดแบบ ภ.ง.ด.53 แล้ว']]);
    view.render(); view.find('WithholdingFormCard', p => p.form.formType === 'PND3').onFiled(); await view.settle();
    assert.equal(confirm.mock.callCount(), 1); assert.match(String(confirm.mock.calls[0].arguments[0].title), /ภ.ง.ด.3 ยื่นปกติ เดือน ต\.ค\..*2569/); assert.equal(filed.mock.callCount(), 1);
  } finally { view.cleanup(); for (const m of [sync, months, read, exportCall, save, confirmation, filed]) m.mock.restore(); }
});
test('payment rows show missing categories, certificate visibility and source links; layout fills the screen', () => {
  const payment = { id: 'e', paymentDate: '2026-10-01', payeeName: 'สมชาย', formType: 'PND3', incomeCategoryLabel: null, rate: '3', paid: '1000', withheld: '30', expenseId: 'ex', certificate: { handoffId: 'h', state: 'SYSTEM_ISSUED', number: 'WT-1', canDownload: true } };
  const view = pageView(undefined, [payment]);
  const html = view.render(); assert.match(html, /ยังไม่ได้เลือกว่าจ่ายค่าอะไร/); assert.match(html, /expenses\/ex/); assert.match(html, /WT-1/); assert.match(html, /ดาวน์โหลดหนังสือรับรอง/);
  payment.certificate.canDownload = false; assert.doesNotMatch(view.render(), /ดาวน์โหลดหนังสือรับรอง/); view.cleanup();
  const source = readFileSync(new URL('./WithholdingPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /lg:grid-cols-2/); assert.match(source, /table className=\{styles.table\}/); assert.doesNotMatch(source, /max-w-/);
  const oldRoute = readFileSync(new URL('../../../app/(workspace)/companies/[companyId]/tax/pnd53/page.tsx', import.meta.url), 'utf8');
  assert.match(oldRoute, /redirect\(`/); assert.match(oldRoute, /tax\/withholding/);
});


test('phone pages contain ten payments and changing pages scrolls the list heading into view', () => {
  const payments = Array.from({ length: 23 }, (_, i) => ({ id: String(i), paymentDate: '2026-10-01', payeeName: `ผู้รับ ${i}`, formType: 'PND3', paid: '100', withheld: '3' }));
  const view = pageView(undefined, payments);
  const scroll = mock.fn();
  try {
    view.render();
    assert.equal(view.nodes.filter(n => n.tag === 'tr').length, 11); // heading + ten payments
    const heading = view.find('h2', p => p.children.includes('รายการที่หักภาษีของเดือนนี้'));
    heading.ref.current = { scrollIntoView: scroll };
    view.find('Pagination').onPageChange(2);
    assert.deepEqual(scroll.mock.calls[0].arguments, [{ block: 'start' }]);
    view.render();
    assert.equal(view.state[4], 2);
    assert.equal(view.nodes.filter(n => n.tag === 'tr').length, 11);
    assert.equal(withholdingPaymentPage(payments, 'PND3', 3, 10).rows.length, 3);
    assert.equal(withholdingPaymentPage(payments, 'ALL', 1).rows.length, 10);
  } finally { view.cleanup(); }
});

test('form cards stretch with their equal-width shared actions anchored at the foot', () => {
  for (const formType of ['PND3', 'PND53']) {
    const html = card(form({ formType, status: 'EXPORTED' }));
    assert.match(html, /flex min-w-0 flex-col gap-4/);
    assert.match(html, /mt-auto pt-2/);
    assert.match(html, /sm:\[&amp;&gt;button\]:min-w-48/);
    assert.equal((html.match(/mangmee-btn mangmee-btn-secondary/g) ?? []).length, 2);
  }
});


test('every official export refusal has a Thai code fallback and preserves its server-specific sentence', () => {
  for (const formType of ['PND3', 'PND53']) for (const reason of ['REVIEW', 'EMPTY', 'MONTH', 'OVERDUE', 'BRANCHES', 'BRANCH', 'PAYER', 'EVENT', 'PAYEE', 'CATEGORY', 'AMOUNT', 'KIND', 'SOURCE']) {
    const code = `${formType}_FILING_${reason}`;
    const fallback = withholdingErrorMessage({ status: 409, code });
    assert.match(fallback, /[ก-๙]/);
    assert.doesNotMatch(fallback, /สถานะปัจจุบัน|เปิดหน้านี้ใหม่/);
    assert.equal(withholdingErrorMessage({ status: 409, details: { code, message: 'สมชาย: ตรวจข้อมูลแล้วลองอีกครั้ง' } }), 'สมชาย: ตรวจข้อมูลแล้วลองอีกครั้ง');
  }
});


test('blocking faults explain download beside their reason and unknown kinds appear once above both cards', () => {
  const issue = { id: 'payer', issueCode: 'PND3_FILING_PAYER', severity: 'BLOCKING', description: 'ข้อมูลร้านยังขาด: ชื่อจดทะเบียน', expenseId: null, counterpartyId: null };
  const html = card(form({ issues: [issue] }), ['wht.pnd53.prepare', 'accounting.counterparty.read', 'accounting.counterparty.manage']);
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(html, /ดาวน์โหลดแบบ ภ.ง.ด.3/);
  assert.ok(html.indexOf(issue.description) < html.indexOf('ดาวน์โหลดแบบ ภ.ง.ด.3'));
  const unknown = { ...issue, id: 'unknown', issueCode: 'WHT_PAYEE_KIND_UNKNOWN', description: 'ยังไม่รู้ว่า สมชาย เป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน', expenseId: 'expense', counterpartyId: 'cp' };
  const view = pageView([form(), form({ formType: 'PND53', issues: [unknown] })]);
  try {
    const page = view.render();
    assert.ok(page.indexOf('ต้องแก้ก่อนยื่น') < page.indexOf('ภ.ง.ด.3 (จ่ายให้บุคคล)'));
    assert.equal(page.split(unknown.description).length - 1, 1);
    assert.equal(view.find('WithholdingFormCard', p => p.form.formType === 'PND53').form.issues[0].issueCode, 'WHT_PAYEE_KIND_UNKNOWN');
  } finally { view.cleanup(); }
});

test('opening and changing month refresh quietly for preparers; readers never sync; sync failure still reads', async () => {
  const outside = mock.method(outsideClick, 'useCloseOnOutsideClick', () => {});
  for (const prepare of [true, false]) for (const fail of [false, true]) {
    const calls: string[] = [];
    const months = mock.method(api, 'listWithholdingMonths', async () => ({ months: ['2026-11', '2026-10'] }));
    const sync = mock.method(api, 'syncWithholding', async () => { calls.push('sync'); if (fail) throw new Error('offline'); });
    const read = mock.method(api, 'getWithholdingMonth', async (_company: string, key: string) => { calls.push(key); return { periodKey: key, forms: [form()], payments: [] }; });
    const view = pageView(undefined, [], ['wht.pnd53.read', ...(prepare ? ['wht.pnd53.prepare'] : [])]);
    const toastCount = toast.success.mock.callCount();
    try {
      view.render(true); await view.settle();
      assert.deepEqual(calls, [...(prepare ? ['sync'] : []), '2026-10']);
      assert.equal(view.state[5], false);
      assert.ok(view.state[2]);
      assert.equal(Boolean(view.state[9]), prepare && fail);
      view.state[1] = '2026-11'; view.render(true); await view.settle();
      assert.deepEqual(calls.slice(prepare ? 2 : 1), [...(prepare ? ['sync'] : []), '2026-11']);
      assert.equal(toast.success.mock.callCount(), toastCount);
    } finally { view.cleanup(); for (const m of [months, sync, read]) m.mock.restore(); }
  }
  outside.mock.restore();
});


test('a raced refusal scrolls the refreshed fault list into view after the request finishes', () => {
  const scroll = mock.fn();
  const runtime = require('react'), realRef = runtime.useRef;
  let refIndex = 0;
  const ref = mock.method(runtime, 'useRef', (initial: unknown) => refIndex++ === 0 ? { current: { scrollIntoView: scroll } } : realRef(initial));
  let busy = true;
  const sentence = 'ข้อมูลร้านยังขาด: ชื่อจดทะเบียน · เปิดข้อมูลร้านแล้วแก้ไข';
  const view = certificateHarness(() => h(WithholdingFormCard, {
    form: form({ issues: [{ id: 'payer', issueCode: 'PND3_FILING_PAYER', severity: 'BLOCKING', description: sentence }] }),
    companyId: 'co', periodKey: '2026-10', permissions: ['wht.pnd53.prepare'], busy, error: sentence, onDownload: () => {}, onFiled: () => {},
  }));
  try {
    view.render(true); assert.equal(scroll.mock.callCount(), 0);
    busy = false; refIndex = 0; view.render(true);
    assert.deepEqual(scroll.mock.calls[0].arguments, [{ block: 'start' }]);
    assert.equal(view.find('button').disabled, false);
  } finally { view.cleanup(); ref.mock.restore(); }
});


test('changed payments require another download, hide filing and keep download available', () => {
  const issues = [{ id: 'stale', issueCode: 'WHT_FILING_CHANGED_AFTER_DOWNLOAD', severity: 'WARNING', description: 'ดาวน์โหลดแบบใหม่ก่อนยื่น' }];
  const html = card(form({ status: 'EXPORTED', issues }));
  assert.match(html, /มีรายการเปลี่ยนหลังดาวน์โหลดแบบ/);
  assert.match(html, /ดาวน์โหลดแบบใหม่ก่อนยื่น/);
  assert.doesNotMatch(html, /บันทึกว่ายื่นแล้ว|disabled=""/);
  assert.equal(withholdingErrorMessage({ status: 409, code: 'WHT_FILING_CHANGED_AFTER_DOWNLOAD' }), 'มีรายการเปลี่ยนหลังดาวน์โหลดแบบ ดาวน์โหลดแบบใหม่ก่อนยื่น');
  const current = card(form({ status: 'EXPORTED' }));
  assert.match(current, /ดาวน์โหลดแบบแล้ว/); assert.match(current, /บันทึกว่ายื่นแล้ว/);
  assert.match(current, /!flex-col/);
  assert.ok(current.indexOf('ดาวน์โหลดแบบ ภ.ง.ด.3') < current.indexOf('บันทึกว่ายื่นแล้ว'));
});

test('the accountant card offers its workbook and filing action, with the other form unchanged', () => {
  const html = card(form({ formType: 'PND53', status: 'EXPORTED', accountantPrepared: true, accountantTypes: [{ incomeType: 'อื่นๆ (นิติบุคคล)', payeeName: 'ร้านตัวอย่าง' }] }));
  for (const label of ['ผู้ทำบัญชีจัดทำแบบนี้เอง', 'ดาวน์โหลดรายการให้ผู้ทำบัญชี', 'บันทึกว่ายื่นแล้ว']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /ดาวน์โหลดแบบ ภ.ง.ด.53|มีเงินได้ที่ระบบยังกรอกลงแบบไม่ได้:/);
  assert.match(card(form()), /ดาวน์โหลดแบบ ภ.ง.ด.3/);
});


test('PND2 is a separate readable block and accountant download requests XLSX', async () => {
  const separate = { id: 'separate', paymentDate: '2026-10-01', payeeName: 'สมใจ', formType: 'PND2', incomeCategoryLabel: 'ดอกเบี้ย (บุคคลธรรมดา)', paid: '5000', withheld: '50', expenseId: 'expense-separate' };
  const fresh = { periodKey: '2026-10', forms: [form(), form({ formType: 'PND53', periodId: 'p53', establishmentCode: '00002', accountantPrepared: true })], payments: [], separatePnd2: [separate] };
  const exportCall = mock.method(api, 'exportWithholding', async () => ({ artifact: { fileName: 'รายการ.xlsx', contentBase64: '', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }));
  const save = mock.method(downloads, 'downloadArtifact', () => {});
  const read = mock.method(api, 'getWithholdingMonth', async () => fresh);
  const view = pageView(fresh.forms); view.state[2] = fresh;
  try {
    const html = view.render();
    for (const label of ['ต้องจัดทำ ภ.ง.ด.2 แยก', 'สมใจ', 'ดอกเบี้ย (บุคคลธรรมดา)', 'จ่าย 5,000.00 บาท', 'หักไว้ 50.00 บาท', 'expenses/expense-separate']) assert.ok(html.includes(label), label);
    view.find('WithholdingFormCard', p => p.form.formType === 'PND53').onDownload(); await view.settle();
    assert.deepEqual(exportCall.mock.calls[0].arguments, ['co', 'PND53', 'p53', 'XLSX', '00002', undefined]); assert.equal(save.mock.callCount(), 1);
  } finally { view.cleanup(); exportCall.mock.restore(); save.mock.restore(); read.mock.restore(); }
});

test('filed cards offer the stored paper even when every live payment was cancelled', () => {
  for (const formType of ['PND3', 'PND53']) for (const accountantPrepared of [false, true]) {
    const html = card(form({ formType, accountantPrepared, status: 'FILED', rowsCertain: true, paymentCount: 0 }));
    assert.match(html, /ดาวน์โหลดแบบที่ยื่น/);
    assert.doesNotMatch(html, /เดือนนี้ไม่มีรายการ|บันทึกว่ายื่นแล้ว|ดาวน์โหลดรายการให้ผู้ทำบัญชี/);
  }
});

test('certificate row download saves the artifact and toasts its number only on success', async () => {
  const artifact = { fileName: 'หนังสือรับรอง-50-ทวิ-WT-1.pdf', mimeType: 'application/pdf', contentBase64: '' };
  let refusal = false;
  const read = mock.method(expenseApi, 'downloadSystemWhtCertificate', async () => {
    if (refusal) throw new Error('ลองอีกครั้ง');
    return { certificateNumber: 'WT-1', pdfArtifact: artifact };
  });
  const save = mock.method(downloads, 'downloadArtifact', () => {});
  const view = pageView(undefined, [{ id: 'p', paymentDate: '2026-10-01', payeeName: 'มีนา', rate: '3', paid: '100', withheld: '3',
    certificate: { handoffId: 'h', state: 'SYSTEM_ISSUED', number: 'WT-1', canDownload: true } }]);
  try {
    const before = toast.success.mock.callCount();
    view.render(); view.find('button', p => p['aria-label'] === 'ดาวน์โหลดหนังสือรับรอง').onClick({ stopPropagation() {} }); await view.settle();
    assert.deepEqual(save.mock.calls[0]!.arguments, [artifact]);
    assert.deepEqual(toast.success.mock.calls.at(-1)!.arguments, ['ดาวน์โหลดหนังสือรับรอง WT-1 แล้ว']);
    refusal = true;
    view.render(); view.find('button', p => p['aria-label'] === 'ดาวน์โหลดหนังสือรับรอง').onClick({ stopPropagation() {} }); await view.settle();
    assert.equal(toast.success.mock.callCount(), before + 1);
    assert.equal(save.mock.callCount(), 1);
  } finally { view.cleanup(); read.mock.restore(); save.mock.restore(); }
});

test('paper-specific button availability is honoured without affecting the other card', () => {
  assert.doesNotMatch(card(form({ status: 'EXPORTED', canMarkFiled: false })), /บันทึกว่ายื่นแล้ว/);
  assert.match(card(form({ status: 'EXPORTED', canMarkFiled: true })), /บันทึกว่ายื่นแล้ว/);
  assert.doesNotMatch(card(form({ canDownload: false })), /disabled=""/);
  assert.doesNotMatch(card(form({ canDownload: true })), /disabled=""/);
});

test('establishment chooser selects only its cards; missing-code stop links to the branch and month', () => {
  const view = pageView(undefined, [], ['wht.pnd53.read', 'wht.pnd53.prepare', 'company.branch.read']);
  const forms = [form({ establishmentCode: '00000' })];
  view.state[2] = { periodKey: '2026-10', forms, payments: [{ id: 'missing', formType: 'PND3', paymentDate: '2026-10-01', payeeName: 'ผู้รับเงิน', paid: '100', withheld: '3', establishment: { kind: 'BRANCH_HAS_NO_CODE' } }],
    establishments: [{ code: '00000', name: 'สำนักงานใหญ่', forms }, { code: '00002', name: 'ลาดพร้าว', forms: [form({ establishmentCode: '00002', paymentCount: 7 })] }],
    establishmentIssues: [{ issueCode: 'WHT_BRANCH_HAS_NO_CODE', branchId: 'branch-x', branchName: 'ลาดกระบัง', paymentCount: 1 }] };
  try {
    assert.match(view.render(), /ยื่นในนาม/);
    view.find('SelectField', p => p.id === 'withholding-establishment').onChange({ target: { value: '00002' } });
    const html = view.render(); assert.equal(view.find('WithholdingFormCard').form.paymentCount, 7);
    assert.match(html, /ลาดกระบัง ยังไม่มีรหัสสาขาภาษี · 1 รายการ/);
    assert.match(html, /periodKey=2026-10&amp;branchId=branch-x/);
    assert.match(html, /ยังไม่มีรหัสสาขาภาษี/);
  } finally { view.cleanup(); }
});
test('one establishment has no chooser; unanswered month offers the question link once', () => {
  const view = pageView(undefined, [], ['wht.pnd53.read', 'company.branch.read']);
  const month: any = view.state[2];
  month.establishments = [{ code: '00000', name: 'สำนักงานใหญ่', forms: month.forms }];
  try { assert.doesNotMatch(view.render(), /ยื่นในนาม/);
    month.establishmentIssues = [{ issueCode: 'WHT_PAYER_MODE_REQUIRED', branchId: null }];
    const html = view.render(); assert.match(html, /มีรายการจ่ายจากหลายสาขา บอกก่อนว่าใครจ่ายเงินและหักภาษี/);
    assert.match(html, /settings\/branches\?from=withholding&amp;periodKey=2026-10/);
  } finally { view.cleanup(); }
});

test('filed paper explains late off-paper payments while retaining only its stored download', () => {
  const html = card(form({ status: 'FILED', unfiledPaymentCount: 2 }), ['wht.pnd53.prepare']);
  assert.match(html, /มีรายการที่ยังไม่อยู่ในแบบที่ยื่น 2 รายการ ให้ผู้ทำบัญชียื่นเพิ่มเติม/);
  assert.match(html, /ดาวน์โหลดแบบที่ยื่น/); assert.doesNotMatch(html, /บันทึกว่ายื่นแล้ว/);
});

const paper = (sequence: number, over: any = {}) => form({ id: `paper-${sequence}`, kind: sequence ? 'ADDITIONAL' : 'NORMAL', sequence, establishmentCode: '00000', downloadedAt: null, filedAt: null, ...over });
test('normal-only card renders identically before and after additive paper fields', () => {
  for (const status of ['OPEN', 'EXPORTED', 'FILED']) {
    const old = form({ status });
    assert.equal(card(old), card({ ...old, papers: [paper(0, { status })], monthTotals: { paymentCount: 2, totalPaid: '1000', totalWithheld: '30' } }));
  }
});
test('papers list oldest first, totals cover the month, and every notice belongs to its paper', () => {
  const normal = paper(0, { status: 'FILED', filedAt: '2026-11-07', cancellations: [{ payeeName: 'สมชาย', withheld: '30' }] });
  const additional = paper(1, { status: 'EXPORTED', paymentCount: 1, totalWithheld: '90', noticeCode: 'WHT_ADDITIONAL_SURCHARGE_MANUAL', cancelledPayeeNames: ['สมชาย'] });
  const html = card(form({ papers: [additional, normal], monthTotals: { paymentCount: 3, totalPaid: '4000', totalWithheld: '120' } }));
  for (const text of ['120.00', 'ยื่นปกติ', 'ยื่นเพิ่มเติมครั้งที่ 1', 'ดาวน์โหลดแบบยื่นเพิ่มเติมครั้งที่ 1', 'ยกเลิกหลังยื่น: สมชาย', 'เงินเพิ่ม (ถ้ามี)', 'มีผู้รับเงินที่ถูกยกเลิกหลังยื่นในเดือนนี้: สมชาย']) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf('ยื่นปกติ') < html.indexOf('ยื่นเพิ่มเติมครั้งที่ 1'));
  assert.equal((html.match(/บันทึกว่ายื่นแล้ว/g) ?? []).length, 1);
});
test('uncertain rows offer confirmation only to preparers and show confirmation actor and date', () => {
  const uncertain = form({ id: 'paper', rowsCertain: false, canConfirmRows: true, canDownload: false, rowsUncertainNotice: 'รายการของแบบที่ยื่นไว้ตรวจได้ไม่ครบ ให้ผู้ทำบัญชีเทียบกับแบบที่ยื่นจริง' });
  assert.match(card(uncertain), /ยืนยันรายการของแบบที่ยื่น/);
  assert.doesNotMatch(card(uncertain, []), /<button/);
  assert.match(card(uncertain, []), /ให้ผู้ที่มีสิทธิ์จัดทำแบบภาษียืนยันรายการ/);
  assert.match(card(form({ rowsConfirmation: { userId: 'u', displayName: 'สมใจ', at: '2026-11-07' } })), /ยืนยันรายการของแบบที่ยื่นแล้ว · สมใจ/);
});
test('additional actions send sequence and confirmation names the paper; row labels identify the paper', async () => {
  const additional = paper(1, { status: 'EXPORTED' });
  const fresh = { periodKey: '2026-10', forms: [form({ papers: [paper(0, { status: 'FILED' }), additional] })], payments: [] };
  const exportCall = mock.method(api, 'exportWithholding', async () => ({ artifact: {} }));
  const save = mock.method(downloads, 'downloadArtifact', () => {});
  const read = mock.method(api, 'getWithholdingMonth', async () => fresh);
  const filed = mock.method(api, 'markWithholdingFiled', async () => ({}));
  const confirm = mock.fn(async (_request: { title: string }) => true);
  const confirmation = mock.method(confirmations, 'useConfirm', () => ({ confirm, confirmDialog: null }));
  const view = pageView(fresh.forms);
  try {
    view.render(); view.find('button', p => p.children.includes('ดาวน์โหลดแบบยื่นเพิ่มเติมครั้งที่ 1')).onClick(); await view.settle();
    assert.deepEqual(exportCall.mock.calls[0].arguments, ['co', 'PND3', 'p', 'PDF', '00000', 1]);
    view.render(); view.find('button', p => p.children.includes('บันทึกว่ายื่นแล้ว')).onClick(); await view.settle();
    assert.match((confirm.mock.calls[0].arguments[0] as any).title, /ยื่นเพิ่มเติมครั้งที่ 1/);
    assert.equal(filed.mock.calls[0].arguments[5], 1);
  } finally { view.cleanup(); for (const m of [exportCall, save, read, filed, confirmation]) m.mock.restore(); }
});

test('confirmation is one explicit prepare action and refreshes the paper and actor after success', async () => {
  const uncertain = paper(0, { status: 'FILED', rowsCertain: false, canConfirmRows: true, canDownload: false, rowsUncertainNotice: 'รายการของแบบที่ยื่นไว้ตรวจได้ไม่ครบ ให้ผู้ทำบัญชีเทียบกับแบบที่ยื่นจริง' });
  const fresh = { periodKey: '2026-10', forms: [form({ papers: [{ ...uncertain, rowsCertain: true, canConfirmRows: false, canDownload: true, rowsUncertainNotice: null, rowsConfirmation: { userId: 'u', displayName: 'สมใจ', at: '2026-10-14' } }] })], payments: [] };
  const request = mock.method(api, 'confirmWithholdingRows', async () => ({ confirmed: true }));
  const read = mock.method(api, 'getWithholdingMonth', async () => fresh);
  let accept = false;
  const confirm = mock.fn(async (_question: any) => accept);
  const confirmation = mock.method(confirmations, 'useConfirm', () => ({ confirm, confirmDialog: null }));
  const view = pageView([form({ papers: [uncertain] })]);
  try {
    view.render(); view.find('button', p => p.children.includes('ยืนยันรายการของแบบที่ยื่น')).onClick(); await view.settle();
    assert.equal(request.mock.callCount(), 0);
    accept = true;
    view.render(); view.find('button', p => p.children.includes('ยืนยันรายการของแบบที่ยื่น')).onClick(); await view.settle();
    assert.deepEqual(request.mock.calls[0].arguments, ['co', 'paper-0']);
    assert.match(confirm.mock.calls[0].arguments[0].title, /เดือน ต\.ค\. 2569/);
    assert.match(confirm.mock.calls[0].arguments[0].message, /เทียบรายการกับแบบที่ยื่นจริงแล้ว/);
    assert.match(view.render(), /ยืนยันรายการของแบบที่ยื่นแล้ว · สมใจ/);
    assert.equal(read.mock.callCount(), 1);
  } finally { view.cleanup(); for (const m of [request, read, confirmation]) m.mock.restore(); }
});
test('with multiple papers each payment row names its normal paper, additional paper or no paper', () => {
  for (const [paperRef, label] of [[{ sequence: 0 }, 'ยื่นปกติ'], [{ sequence: 2 }, 'ยื่นเพิ่มเติมครั้งที่ 2'], [null, 'ยังไม่อยู่ในแบบ']] as const) {
    const view = pageView([form({ papers: [paper(0), paper(1), paper(2)] })], [{ id: 'row', payeeName: 'สมใจ', formType: 'PND3', paid: '100', withheld: '3', paymentDate: '2026-10-01', paper: paperRef }]);
    try { assert.match(view.render().split('<tbody')[1]!, new RegExp(label)); } finally { view.cleanup(); }
  }
});

test('a one-establishment month renders the same page with or without the additive paper contract', () => {
  const payment = { id: 'payment', paymentDate: '2026-10-01', payeeName: 'สมใจ', formType: 'PND3', paid: '1000', withheld: '30' };
  const view = pageView([form({ status: 'FILED' })], [payment]);
  try {
    const before = view.render();
    assert.doesNotMatch(before, /ยื่นปกติ|ยื่นเพิ่มเติมครั้งที่|ยังไม่อยู่ในแบบ/);
    (view.state[2] as any).forms[0].papers = [paper(0, { status: 'FILED' })];
    (view.state[2] as any).forms[0].monthTotals = { paymentCount: 2, totalPaid: '1000', totalWithheld: '30' };
    (view.state[2] as any).payments[0].paper = { id: 'paper-0', sequence: 0, kind: 'NORMAL', establishmentCode: '00000' };
    assert.equal(view.render(), before);
  } finally { view.cleanup(); }
});
test('a refused additional download refreshes only that paper notice and leaves its normal stored download available', async () => {
  const additional = paper(1, { status: 'OPEN' });
  const fresh = { periodKey: '2026-10', forms: [form({ papers: [paper(0, { status: 'FILED' }), additional] })], payments: [] };
  const sentence = 'ข้อมูลผู้รับเงินยังขาด: ที่อยู่ เปิดรายจ่ายแล้วแก้ไข';
  const request = mock.method(api, 'exportWithholding', async () => { throw { status: 409, code: 'PND3_FILING_PAYEE', message: sentence }; });
  const read = mock.method(api, 'getWithholdingMonth', async () => fresh);
  const view = pageView(fresh.forms);
  try {
    view.render(); view.find('button', p => p.children.includes('ดาวน์โหลดแบบยื่นเพิ่มเติมครั้งที่ 1')).onClick(); await view.settle();
    view.render();
    assert.equal(view.find('WithholdingPaper', p => p.paper.sequence === 1).error, sentence);
    assert.ok(!view.find('WithholdingPaper', p => p.paper.sequence === 0).error);
    assert.equal(view.find('button', p => p.children.includes('ดาวน์โหลดแบบที่ยื่น')).disabled, false);
    assert.equal(read.mock.callCount(), 1);
  } finally { view.cleanup(); request.mock.restore(); read.mock.restore(); }
});

test('month-level establishment and unknown-payee notices are not repeated inside the new paper list', () => {
  const unknown = { id: 'unknown', issueCode: 'WHT_PAYEE_KIND_UNKNOWN', description: 'ยังไม่รู้ว่า สมใจ เป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน', severity: 'BLOCKING', counterpartyId: 'cp' };
  const payer = { id: 'payer', issueCode: 'WHT_PAYER_MODE_REQUIRED', description: 'มีรายการจ่ายจากหลายสาขา บอกก่อนว่าใครจ่ายเงินและหักภาษี', severity: 'BLOCKING' };
  const view = pageView([form({ issues: [unknown, payer], papers: [paper(0, { issues: [unknown, payer] })] })]);
  (view.state[2] as any).establishmentIssues = [{ issueCode: 'WHT_PAYER_MODE_REQUIRED', branchId: null }];
  try {
    const html = view.render();
    assert.equal(html.split(unknown.description).length - 1, 1);
    assert.equal(html.split(payer.description).length - 1, 1);
  } finally { view.cleanup(); }
});

test('payment names its filing establishment only when the month has more than one', () => {
  const v = pageView(undefined, [{ id: 'e', paymentDate: '2026-10-01', payeeName: 'มีนา', paid: '100', withheld: '3', establishment: { kind: 'ESTABLISHMENT', code: '00000', name: 'สำนักงานใหญ่' } }]);
  const month: any = v.state[2];
  try {
    month.establishments = [{ code: '00000', name: 'สำนักงานใหญ่', forms: month.forms }];
    assert.doesNotMatch(v.render(), /ยื่นโดย /);
    month.establishments.push({ code: '00002', name: 'ตลาด', forms: month.forms });
    v.state.length = 12; // Reset child chooser hook slots after adding another chooser.
    assert.match(v.render(), /ยื่นโดย สำนักงานใหญ่/);
  } finally { v.cleanup(); }
});


test('paper labels use the payment establishment and form, independently of the selected card', () => {
  const establishments = [
    { code: '00000', name: 'สำนักงานใหญ่', forms: [form({ papers: [paper(0), paper(1)] }), form({ formType: 'PND53', papers: [paper(0, { formType: 'PND53' })] })] },
    { code: '00002', name: 'ตลาด', forms: [form({ papers: [paper(0, { establishmentCode: '00002' })] })] },
    { code: '00003', name: 'สวน', forms: [form({ papers: [] })] },
  ];
  for (const [code, formType, sequence, label] of [
    ['00000', 'PND3', 0, 'ยื่นปกติ'],
    ['00000', 'PND3', 1, 'ยื่นเพิ่มเติมครั้งที่ 1'],
    ['00000', 'PND53', 0, null],
    ['00002', 'PND3', 0, null],
    ['00002', 'PND3', null, 'ยังไม่อยู่ในแบบ'],
    ['00003', 'PND3', null, null],
  ] as const) {
    const view = pageView(establishments[0].forms, [{ id: 'row', paymentDate: '2026-10-01', payeeName: 'สมใจ', formType, paid: '100', withheld: '3',
      establishment: { kind: 'ESTABLISHMENT', code, name: code }, paper: sequence === null ? null : { sequence, establishmentCode: code } }]);
    (view.state[2] as any).establishments = establishments;
    try {
      for (const selectedCode of ['00000', '00002']) {
        view.state[11] = selectedCode;
        const rows = view.render().split('<tbody')[1]!;
        if (label) assert.match(rows, new RegExp(`<p[^>]*>${label}</p>`));
        else assert.doesNotMatch(rows, /ยื่นปกติ|ยื่นเพิ่มเติมครั้งที่|ยังไม่อยู่ในแบบ/);
      }
    } finally { view.cleanup(); }
  }
});

test('W4/W7/W8 keeps unpaid trace and date remedy outside papers, and warns only on the preserved paper', () => {
  const view = pageView([form({ status: 'FILED', paymentBasisChanged: true })]);
  Object.assign(view.state[2] as object, { unpaidExpenses: [{ expenseId: 'unpaid', payeeName: 'ยังไม่ได้จ่าย' }], undatedPayments: [{ paymentId: 'p', expenseId: 'e', payeeName: 'สมใจ', amount: '970' }], paidWithoutWithholding: [{ expenseId: 'gross', payeeName: 'จ่ายเต็ม' }] });
  try {
    const html = view.render();
    assert.match(html, /ยืนยันแล้ว ยังไม่ได้จ่าย/); assert.match(html, /expenses\/unpaid/);
    assert.match(html, /ยังไม่รู้วันที่จ่ายจริง/); assert.match(html, /expenses\/e\?section=payment/);
    assert.match(html, /จ่ายเต็มยอด ยังไม่ได้หักภาษี/); assert.match(html, /gross\?section=payment/);
    assert.match(html, /รายการของแบบที่ยื่นไว้ต่างจากวันที่จ่ายจริง/);
  } finally { view.cleanup(); }
});


test('DQ3 filing question names the selected establishment only when the month has several', async () => {
  for (const count of [1, 2]) for (const sequence of [0, 1]) {
    const target = paper(sequence, { status: 'EXPORTED', establishmentCode: '00002' });
    const targetForm = form({ establishmentCode: '00002', papers: [target] });
    const establishments = [
      ...(count === 2 ? [{ code: '00000', name: 'สำนักงานใหญ่', forms: [form({ establishmentCode: '00000' })] }] : []),
      { code: '00002', name: 'ลาดพร้าว', forms: [targetForm] },
    ];
    const confirm = mock.fn(async (_request: { title: string }) => false);
    const confirmation = mock.method(confirmations, 'useConfirm', () => ({ confirm, confirmDialog: null }));
    const filed = mock.method(api, 'markWithholdingFiled', async () => ({}));
    const view = pageView([targetForm]);
    view.state[2] = { periodKey: '2026-10', forms: [targetForm], payments: [], establishments };
    try {
      view.render();
      if (count === 2) { view.find('SelectField', p => p.label === 'ยื่นในนาม').onChange({ target: { value: '00002' } }); view.render(); }
      view.find('button', p => p.children.includes('บันทึกว่ายื่นแล้ว')).onClick(); await view.settle();
      assert.equal(confirm.mock.calls[0].arguments[0].title,
        `บันทึกว่ายื่น ภ.ง.ด.3 ${sequence ? 'ยื่นเพิ่มเติมครั้งที่ 1' : 'ยื่นปกติ'} เดือน ต.ค. 2569${count === 2 ? ' ในนาม ลาดพร้าว (00002)' : ''} แล้ว?`);
      assert.equal(filed.mock.callCount(), 0);
    } finally { view.cleanup(); confirmation.mock.restore(); filed.mock.restore(); }
  }
});


test('missing payment dates are one fix card with native links to the expense payment section, without an inline date picker', () => {
  const view = pageView(undefined, [], ['wht.pnd53.read', 'expense.payment.record']);
  (view.state[2] as any).undatedPayments = [{ paymentId: 'p', expenseId: 'e', payeeName: 'สมใจ', amount: '970' }];
  try {
    const html = view.render();
    assert.equal(html.split('ต้องแก้ก่อนยื่น').length - 1, 1);
    assert.match(html, /href="\/companies\/co\/expenses\/e\?section=payment"/);
    for (const text of ['สมใจ', '970.00 บาท', 'ยังไม่รู้วันที่จ่ายจริง']) assert.ok(html.includes(text));
    assert.doesNotMatch(html, /บันทึกวันที่จ่ายจริง|type="date"|฿|—/);
    assert.equal(view.nodes.some(n => n.tag === 'PaymentDateConfirmation'), false);
  } finally { view.cleanup(); }
});

test('blocked download explains the server reason and fix without dispatching export', () => {
  const download = mock.fn();
  const view = certificateHarness(() => h(WithholdingFormCard, { form: form({ canDownload: false, issues: [{ id: 'payer', issueCode: 'PND3_FILING_PAYER', severity: 'BLOCKING', description: 'ชื่อร้านยังไม่ครบ' }] }), centralIssues: true, companyId: 'co', periodKey: '2026-10', permissions: ['wht.pnd53.prepare', 'company.setup.read'], busy: false, onDownload: download, onFiled() {} }));
  try {
    assert.doesNotMatch(view.render(), /ชื่อร้านยังไม่ครบ/);
    const action = view.find('button', p => p.children.includes('ดาวน์โหลดแบบ ภ.ง.ด.3'));
    assert.equal(action.disabled, false);
    action.onClick();
    const html = view.render();
    assert.match(html, /ชื่อร้านยังไม่ครบ/); assert.match(html, /ตั้งค่าร้าน › ข้อมูลร้าน/);
    assert.equal(download.mock.callCount(), 0);
  } finally { view.cleanup(); }
});

test('monthly table and phone cards open expenses by click or Enter; sort resets the page and form tabs carry whole-month counts', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), expenseId: `expense-${i}`, paymentDate: `2026-10-${String(i + 1).padStart(2, '0')}`, payeeName: `ผู้รับ ${i}`, formType: i < 4 ? 'PND3' : 'PND53', paid: '1000', withheld: '30' }));
  const view = pageView(undefined, rows);
  try {
    const html = view.render();
    assert.match(html, /mangmee-flat/); assert.doesNotMatch(html, /฿|—|>เปิดรายจ่าย<|แสดง 1-/);
    const tabs = view.find('FilterTabs');
    assert.deepEqual(tabs.tabs.map((item: any) => item.count), [12, 4, 8]);
    const row = view.find('tr', p => p.role === 'link');
    row.onClick(); assert.equal(visits.at(-1), '/companies/co/expenses/expense-11');
    const target = {}; const preventDefault = mock.fn();
    row.onKeyDown({ key: 'Enter', target, currentTarget: target, preventDefault });
    assert.equal(preventDefault.mock.callCount(), 1);
    assert.equal(view.nodes.filter(n => n.tag === 'div' && n.props.role === 'link').length, 10);
    view.find('Pagination').onPageChange(2); view.render();
    view.find('WithholdingPayments').onOrder(); view.render();
    assert.equal(view.state[4], 1); assert.equal(view.find('WithholdingPayments').order, 'oldest');
    assert.equal(view.find('tr', p => p.role === 'link')['data-href'], '/companies/co/expenses/expense-0');
    const widths = view.nodes.filter(n => n.tag === 'col').map(n => Number(n.props.style.width.replace('%', '')));
    assert.equal(widths.reduce((a, b) => a + b, 0), 100);
    assert.equal(widths.length, 7);
  } finally { view.cleanup(); }
});

test('refresh is secondary beside the month and the certificate list link lives in MoreActions', () => {
  const view = pageView(undefined, [], ['wht.pnd53.read', 'wht.pnd53.prepare', 'wht.certificate.issue']);
  try {
    view.render();
    assert.match(view.find('button', p => p.children.includes('ดึงรายการล่าสุด')).className, /mangmee-btn-secondary/);
    const menu = view.find('MoreActions');
    assert.ok(menu.children.length > 0);
    assert.equal(view.nodes.filter(n => n.tag === 'MoreActions').length, 1);
    const metrics = view.nodes.filter(n => n.tag === 'MetricGrid');
    assert.equal(metrics.length, 2);
    assert.deepEqual(metrics[0].props.items.map((item: any) => [item.label, item.value, item.unit]), [['รายการ', '2', 'รายการ'], ['ยอดจ่าย', '1,000.00', 'บาท'], ['ภาษีที่หักไว้', '30.00', 'บาท']]);
  } finally { view.cleanup(); }
});

test('MOBILE-3 three paid expenses and multiple establishments keep the certificate menu at the header right edge on phones', () => {
  const view = pageView(undefined, [], ['wht.pnd53.read', 'wht.pnd53.prepare', 'wht.certificate.issue']);
  const forms = [form(), form({ formType: 'PND53', periodId: 'p53' })];
  view.state[2] = { periodKey: '2026-10', forms,
    establishments: [{ code: '00000', name: 'สำนักงานใหญ่', forms }, { code: '00001', name: 'สาขาทดลอง', forms }],
    payments: Array.from({ length: 3 }, (_, i) => ({ id: `pay-${i}`, expenseId: `expense-${i}`, payeeName: `ผู้รับ ${i}`,
      formType: i === 2 ? 'PND53' : 'PND3', paymentDate: '2026-10-20', paid: '1000', withheld: '30' })) };
  try {
    const html = view.render();
    assert.match(html, /ยื่นในนาม/);
    assert.equal((html.match(/>ดูหนังสือรับรอง 50 ทวิ<\/a>/g) ?? []).length, 1);
    const menu = view.find('MoreActions');
    assert.equal(menu.align, 'end');
    assert.match(html, /grid w-full auto-cols-fr grid-flow-col[^]*?<details class="menu end"/);
    const css = readFileSync(new URL('../../common/components/actions/MoreActions.module.css', import.meta.url), 'utf8');
    // End alignment must apply before JS measurement, including the 375px two-column header.
    assert.match(css, /^\.end > \.panel \{ inset-inline-start: auto; inset-inline-end: 0; \}/m);
    assert.match(css, /\.menu:not\(\[open\]\) > \.panel \{ display: none; \}/);
  } finally { view.cleanup(); }
});


test('must-fix card deduplicates shop facts, links unsupported income to its expense and keeps shop access permissions', () => {
  const payer = { id: 'payer', issueCode: 'PND3_FILING_PAYER', severity: 'BLOCKING', description: 'ข้อมูลร้านยังขาด: ชื่อจดทะเบียน' };
  for (const mayOpenShop of [false, true]) {
    const view = pageView([form({ issues: [payer], accountantPrepared: true, accountantTypes: [{ payeeName: 'ร้านทดสอบ', incomeType: 'เงินได้อื่น' }] }), form({ formType: 'PND53', issues: [{ ...payer, id: 'payer53' }] })],
      [{ id: 'row', expenseId: 'expense', payeeName: 'ร้านทดสอบ', paymentDate: '2026-10-01', incomeCategoryLabel: 'เงินได้อื่น', formType: 'PND3', paid: '1000', withheld: '30' }],
      ['wht.pnd53.read', ...(mayOpenShop ? ['company.setup.read'] : [])]);
    try {
      const html = view.render();
      assert.equal(html.split(payer.description).length - 1, 1);
      assert.equal(html.split('ต้องแก้ก่อนยื่น').length - 1, 1);
      assert.equal(html.includes('href="/companies/co/settings/profile?from=withholding"'), mayOpenShop);
      assert.equal(html.includes('ให้ผู้มีสิทธิ์แก้ข้อมูลร้านตรวจข้อมูลให้ครบ'), !mayOpenShop);
      assert.match(html, /href="\/companies\/co\/expenses\/expense"[^>]*>.*ร้านทดสอบ.*เงินได้อื่น.*ให้ผู้ทำบัญชีจัดทำแบบ/);
    } finally { view.cleanup(); }
  }
});

test('the must-fix card reads facts from each form and from each of its papers', () => {
  // 2026-10-16: with an additional filing in the month, the accountant-prepared income sat on the form, not on its papers.
  const page = readFileSync(new URL('./WithholdingPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /const papers = forms\.flatMap\(form => \[form, \.\.\.\(form\.papers \?\? \[\]\)\]\);/);
});

test('R10 source-only blockers preserve correction permissions, hidden-branch privacy and a return action', () => {
  for (const issueCode of ['MISSING_TAX_ID', 'WHT_PAYEE_KIND_UNKNOWN']) for (const count of [0, 1]) for (const mayEdit of [false, true]) {
    const issue = { id: 'source-only', issueCode, sourceType: 'expense.record', sourceId: 'bad', expenseId: 'bad', counterpartyId: 'cp', severity: 'BLOCKING', description: 'ข้อมูลผู้รับเงินยังไม่ครบ เปิดรายการเพื่อแก้ข้อมูล' };
    const view = pageView([form({ paymentCount: count, canDownload: false, issues: [issue] }), form({ formType: 'PND53', paymentCount: 0 })],
      count ? [{ id: 'good', payeeName: 'ผู้รับเงินครบ', formType: 'PND3', paymentDate: '2026-10-01', paid: '1000', withheld: '30' }] : [],
      ['wht.pnd53.read', 'wht.pnd53.prepare', 'expense.read', ...(mayEdit ? ['expense.update', 'expense.confirm', 'accounting.counterparty.read', 'accounting.counterparty.manage'] : [])]);
    try {
      const html = view.render();
      assert.equal(html.split(issue.description).length - 1, 1);
      assert.match(html, /ต้องแก้ก่อนยื่น/);
      assert.equal(html.includes('href="/companies/co/counterparties/cp"'), mayEdit && issueCode.includes('KIND'));
      assert.equal(html.includes('href="/companies/co/expenses/bad"'), mayEdit && !issueCode.includes('KIND'));
      if (!mayEdit) assert.match(html, /กลับไปรายการค่าใช้จ่าย/);
      if (!count) { assert.equal((html.match(/เดือนนี้ไม่มีรายการ/g) ?? []).length, 1, 'only the unrelated empty form may say it has no payments'); assert.match(html, /แก้ข้อมูลรายการจ่ายเพื่อแสดงในแบบ/); }
    } finally { view.cleanup(); }
  }
  const hidden = { id: 'hidden', issueCode: 'PND3_FILING_REVIEW', severity: 'BLOCKING', sourceType: null, sourceId: null, expenseId: null, counterpartyId: null, description: E_WHT_WORDS['W-T5'] };
  const view = pageView([form({ paymentCount: 0, issues: [hidden] }), form({ formType: 'PND53', paymentCount: 0, issues: [{ ...hidden, issueCode: 'PND53_FILING_REVIEW' }] })], [], ['wht.pnd53.read', 'expense.read']);
  try {
    const html = view.render(); assert.equal(html.split(hidden.description).length - 1, 1); assert.match(html, /กลับไปรายการค่าใช้จ่าย/);
    assert.doesNotMatch(html, /counterparties\/|expenses\/(?!wht)|เดือนนี้ไม่มีรายการ/);
  } finally { view.cleanup(); }
});

test('R10 FILED omission warnings keep the stored download and the additional paper separate', async () => {
  const warning = { id: 'omitted', issueCode: 'WHT_FILED_PAYMENT_OMITTED', severity: 'WARNING', description: E_WHT_WORDS['W-T6']('ผู้รับเงิน') };
  const exportCall = mock.method(api, 'exportWithholding', async () => ({ artifact: { fileName: 'เดิม.pdf', contentBase64: 'frozen', checksum: 'original' } }));
  const download = mock.method(downloads, 'downloadArtifact', () => {});
  const forms = [form({ status: 'FILED', canDownload: true, issues: [warning], papers: [paper(0, { status: 'FILED', canDownload: true, issues: [warning] }), paper(1, { status: 'OPEN', canDownload: true })] })];
  const read = mock.method(api, 'getWithholdingMonth', async () => ({ periodKey: '2026-10', forms, payments: [] }));
  const view = pageView(forms);
  try {
    assert.match(view.render(), new RegExp(warning.description));
    view.find('button', p => p.children.includes('ดาวน์โหลดแบบที่ยื่น')).onClick(); await view.settle();
    assert.equal(exportCall.mock.calls[0].arguments[5], 0);
    assert.equal(download.mock.calls[0].arguments[0].checksum, 'original');
    view.render(); assert.ok(view.find('button', p => p.children.includes('ดาวน์โหลดแบบยื่นเพิ่มเติมครั้งที่ 1')));
  } finally { view.cleanup(); for (const m of [exportCall, download, read]) m.mock.restore(); }
});

test('R10 correction reload removes the blocker and loading or an error never claims an empty month', async () => {
  const issue = { id: 'bad', issueCode: 'MISSING_TAX_ID', sourceId: 'bad', expenseId: 'bad', severity: 'BLOCKING', description: 'เปิดรายการเพื่อแก้เลขผู้เสียภาษี' };
  const sync = mock.method(api, 'syncWithholding', async () => ({}));
  const months = mock.method(api, 'listWithholdingMonths', async () => ({ months: ['2026-10'] }));
  const read = mock.method(api, 'getWithholdingMonth', async () => ({ periodKey: '2026-10', forms: [form({ canDownload: true })], payments: [] }));
  const view = pageView([form({ paymentCount: 0, issues: [issue], canDownload: false })]);
  try {
    view.state[5] = true; assert.doesNotMatch(view.render(), /เดือนนี้ไม่มีรายการ/);
    view.state[5] = false; view.state[2] = null; view.state[9] = 'โหลดรายการไม่ได้ ลองอีกครั้ง';
    assert.match(view.render(), /ลองอีกครั้ง/); assert.doesNotMatch(view.render(), /เดือนนี้ไม่มีรายการ/);
    view.state[2] = { periodKey: '2026-10', forms: [form({ paymentCount: 0, issues: [issue], canDownload: false })], payments: [] }; view.state[9] = '';
    view.render(); view.find('button', p => p.children.includes('ดึงรายการล่าสุด')).onClick(); await view.settle();
    assert.doesNotMatch(view.render(), new RegExp(issue.description));
    assert.equal(view.find('WithholdingFormCard').form.canDownload, true);
  } finally { view.cleanup(); for (const m of [sync, months, read]) m.mock.restore(); }
});

test('R10 retry keeps the loading state until the month read completes', async () => {
  let finish!: (value: any) => void;
  const months = mock.method(api, 'listWithholdingMonths', async () => ({ months: ['2026-10'] }));
  const read = mock.method(api, 'getWithholdingMonth', () => new Promise(resolve => { finish = resolve; }));
  const view = pageView(); view.state[2] = null; view.state[9] = 'โหลดรายการไม่ได้ ลองอีกครั้ง';
  try {
    view.render(); view.find('button', p => p.children.includes('ลองอีกครั้ง')).onClick(); await view.settle();
    assert.doesNotMatch(view.render(), /เดือนนี้ไม่มีรายการ/);
    assert.ok(view.nodes.some(n => n.tag === 'LoadingState'));
    finish({ periodKey: '2026-10', forms: [form()], payments: [] }); await view.settle();
    view.render(); assert.equal(view.nodes.some(n => n.tag === 'LoadingState'), false);
    assert.ok(view.nodes.some(n => n.tag === 'WithholdingFormCard'));
  } finally { view.cleanup(); months.mock.restore(); read.mock.restore(); }
});

test('R10 source corrections belong to the selected establishment', () => {
  const issue = { id: 'branch-only', issueCode: 'WHT_PAYEE_KIND_UNKNOWN', sourceId: 'bad', expenseId: 'bad', severity: 'BLOCKING', description: 'ผู้รับเงินสาขาตลาดยังไม่ครบ' };
  const head = [form()], branch = [form({ issues: [issue], canDownload: false })];
  const view = pageView(head, [], ['wht.pnd53.read', 'expense.read']);
  (view.state[2] as any).establishments = [{ code: '00000', name: 'สำนักงานใหญ่', forms: head }, { code: '00002', name: 'ตลาด', forms: branch }];
  try {
    assert.doesNotMatch(view.render(), new RegExp(issue.description));
    view.find('SelectField', p => p.label === 'ยื่นในนาม').onChange({ target: { value: '00002' } });
    assert.match(view.render(), new RegExp(issue.description));
    assert.match(view.render(), /กลับไปรายการค่าใช้จ่าย/);
  } finally { view.cleanup(); }
});

test('R10 a source-only branch without a tax code offers branch settings without a false zero-payment sentence', () => {
  const view = pageView([form({ paymentCount: 0, issues: [{ id: 'source', sourceId: 'bad', expenseId: 'bad', issueCode: 'WHT_PAYEE_KIND_UNKNOWN', description: 'ข้อมูลผู้รับเงินยังไม่ครบ', severity: 'BLOCKING' }] })], [], ['wht.pnd53.read', 'expense.read', 'company.branch.read']);
  (view.state[2] as any).establishmentIssues = [{ issueCode: 'WHT_BRANCH_HAS_NO_CODE', branchId: 'branch', branchName: 'ตลาด', paymentCount: 0 }];
  try {
    const html = view.render();
    assert.match(html, /ตลาด ยังไม่มีรหัสสาขาภาษี/);
    assert.match(html, /settings\/branches\?from=withholding/);
    assert.doesNotMatch(html, /ตลาด ยังไม่มีรหัสสาขาภาษี · 0 รายการ|เดือนนี้ไม่มีรายการ/);
  } finally { view.cleanup(); }
});

test('A6 bank-only forms show one information sentence in place of paper actions', () => {
  for (const formType of ['PND3', 'PND53']) {
    const description = E_WHT_WORDS['W-T3'](formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53', 'บางนา');
    const html = card(form({ formType, paymentCount: 0, issues: [{ id: 'bank', issueCode: `${formType}_FILING_BANK_REMITTED_ONLY`, severity: 'BLOCKING', description }] }));
    assert.equal(html.split(description).length - 1, 1);
    assert.doesNotMatch(html, /<button|ต้องแก้ก่อนยื่น|เปิดค่าใช้จ่าย/);
    assert.match(html, /role="status"/);
  }
});

test('A23 mixed branch keeps bank card and normal PND53 download; warnings are separate from A30 blockers', () => {
  const bank = { ...form({ paymentCount: 0 }), issues: [{ id: 'bank', severity: 'BLOCKING', issueCode: 'PND3_FILING_BANK_REMITTED_ONLY', description: E_WHT_WORDS['W-T3']('ภ.ง.ด.3', 'บางนา') }] };
  const warning = { id: 'rate', issueCode: 'WHT_RATE_MISMATCH', severity: 'WARNING', description: E_WHT_WORDS['W-T4']('สมชาย'), expenseId: 'e' };
  const blocking = { id: 'taxid', issueCode: 'MISSING_TAX_ID', severity: 'BLOCKING', description: 'เลขผู้เสียภาษียังไม่ครบ', expenseId: 'e2' };
  const view = pageView([bank, form({ formType: 'PND53', issues: [warning, blocking] })]);
  (view.state[2] as any).establishments = [{ code: '00001', name: 'บางนา', forms: [bank, form({ formType: 'PND53', issues: [warning, blocking] })] }];
  (view.state[2] as any).bankRemitted = [{ id: 'bankpay', payeeName: 'ผู้รับผ่านธนาคาร', paid: '100', withheld: '1', currency: 'USD', establishment: { kind: 'ESTABLISHMENT', code: '00001' } }];
  try {
    const html = view.render();
    assert.match(html, /จ่ายผ่าน e-WHT/); assert.match(html, /ดาวน์โหลดรายการ e-WHT/);
    assert.match(html, /ผู้รับผ่านธนาคาร/); assert.match(html, /USD/);
    assert.match(html, /ควรตรวจก่อนยื่น/); assert.match(html, /ตรวจอัตรา/); assert.match(html, /ต้องแก้ก่อนยื่น/);
    assert.equal(html.split(warning.description.replaceAll('>', '&gt;')).length - 1, 1);
    assert.match(html, /ดาวน์โหลดแบบ ภ.ง.ด.53/); assert.doesNotMatch(html, /ดาวน์โหลดแบบ ภ.ง.ด.3/);
    const fixes = view.find('WithholdingFixes'); assert.deepEqual(fixes.sourceIssues.map((i: any) => i.id), ['taxid']);
    (view.state[2] as any).establishments[0].forms = [bank];
    assert.match(view.render(), /ดาวน์โหลดรายการ e-WHT/);
  } finally { view.cleanup(); }
});

test('e-WHT download keeps the selected branch, announces loading, preserves errors and retries', async () => {
  let fail = true;
  const artifact = { fileName: 'bank.xlsx', contentBase64: '', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const request = mock.method(api, 'exportWithholdingEWht', async () => { if (fail) throw new Error('ดาวน์โหลดไม่สำเร็จ ลองอีกครั้ง'); return artifact; });
  const download = mock.method(downloads, 'downloadArtifact', () => {});
  const view = pageView();
  (view.state[2] as any).establishments = [{ code: '00001', name: 'บางนา', forms: [form()] }];
  (view.state[2] as any).bankRemitted = [{ id: 'bank', payeeName: 'ธนาคาร', withheld: '1', currency: 'THB', establishment: { kind: 'ESTABLISHMENT', code: '00001' } }];
  try {
    view.render(); view.find('button', p => p.children.includes(E_WHT_WORDS['W-T2b'])).onClick();
    view.render();
    const pending = view.find('button', p => p.children.includes(E_WHT_WORDS['W-T2b']));
    assert.equal(pending.disabled, true); assert.equal(pending['aria-busy'], true);
    await view.settle(); assert.match(view.render(), /ดาวน์โหลดไม่สำเร็จ ลองอีกครั้ง/);
    assert.equal(download.mock.callCount(), 0);
    fail = false; view.find('button', p => p.children.includes(E_WHT_WORDS['W-T2b'])).onClick();
    await view.settle(); view.render();
    assert.deepEqual(request.mock.calls[1].arguments, ['co', '2026-10', '00001']);
    assert.deepEqual(download.mock.calls[0].arguments, [artifact]);
  } finally { view.cleanup(); request.mock.restore(); download.mock.restore(); }
});

test('A30 normal source blockers keep their own notice with the bank card and no bank-only claim', () => {
  const issue = { id: 'taxid', issueCode: 'MISSING_TAX_ID', severity: 'BLOCKING', description: 'เลขผู้เสียภาษียังไม่ครบ', expenseId: 'e' };
  const view = pageView([form({ issues: [issue] })]);
  (view.state[2] as any).bankRemitted = [{ id: 'bank', payeeName: 'ธนาคาร', withheld: '1', currency: 'THB' }];
  try {
    const html = view.render(); assert.match(html, /ต้องแก้ก่อนยื่น/); assert.match(html, /เลขผู้เสียภาษียังไม่ครบ/);
    assert.match(html, /ดาวน์โหลดรายการ e-WHT/); assert.doesNotMatch(html, /จ่ายผ่าน e-WHT ทั้งหมด/);
  } finally { view.cleanup(); }
});
