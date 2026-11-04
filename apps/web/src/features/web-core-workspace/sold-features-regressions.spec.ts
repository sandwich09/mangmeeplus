import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { workspaceDictionary, type DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { canAccessWorkspacePath } from './web-core-workspace.logic';
import { WORKSPACE_MODULES } from './web-core-workspace.constants';

(globalThis as any).React = React;
// CSS modules (the shared MoreActions menu, the list pages) load as their class names, as in the other rendered specs.
require.extensions['.css'] = (module) => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const expense = require('../expenses/ExpensesPages');
const { ThemedSelect } = require('@/common/components/field/ThemedSelect');
const { InfoBanner } = require('../expenses/ExpensesUi');
const { TaxSignatureSettingsPage } = require('../tax/TaxSignatureSettingsPage');
const { ReportsWorkspacePage } = require('../reports/ReportsWorkspacePage');
const { ReimbursementJourneyPage } = require('../reimbursements/ReimbursementJourneyPage');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const runtime = require('react');
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, bfcacheId: 'test' };
const h = React.createElement;
function render(element: React.ReactElement, pick = (_initial: any, _index: number): any => undefined) {
  let index = 0;
  const original = runtime.useState;
  runtime.useState = (initial: any) => {
    const [value, set] = original(initial);
    const next = pick(typeof initial === 'function' ? initial() : initial, index++);
    return [next === undefined ? value : next, set];
  };
  try {
    return renderToStaticMarkup(h(AppRouterContext.Provider, { value: router },
      h(SearchParamsContext.Provider, { value: new URLSearchParams() },
        h(ToastContext.Provider, { value: { success: noop, warning: noop, error: noop } }, element))));
  } finally { runtime.useState = original; }
}
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ');

test('missing extraction facts do not ask read-only readers to fill fields; editors keep their prompt', () => {
  for (const canEdit of [false, true]) {
    const html = render(h(expense.AiFieldMissingHint, { field: 'vendorNameSnapshot', summary: { missingFields: ['vendorName'] }, canEdit }));
    assert.ok(html.length > 0);
    // 2026-10-13: the editor's prompt lost "กรุณา" (thai-ux-standard §1.4); it still tells the editor to fill the field.
    if (canEdit) assert.match(html, /AI อ่านไม่ได้ กรอกเอง/);
    else { assert.match(html, /อ่านข้อมูลช่องนี้ไม่ได้/); assert.doesNotMatch(html, /กรุณา|กรอก|AI/); }
  }
});

test('all validation facts have permission-aware wording with unchanged editable messages', () => {
  for (const key of Object.keys(workspaceDictionary.th).filter(key => key.startsWith('expenses.v_') && !key.endsWith('_readonly'))) {
    const issue = { field: 'test', severity: 'error', messageKey: key, params: { max: '200', computed: '10', ai: '20' } };
    const editable = visible(render(h(expense.FieldIssueNote, { issue, canEdit: true })));
    assert.ok(editable.includes(workspaceDictionary.th[key as DictionaryKey].replace('{max}', '200').replace('{computed}', '10').replace('{ai}', '20')));
    const readonly = visible(render(h(expense.FieldIssueNote, { issue, canEdit: false })));
    assert.doesNotMatch(readonly, /กรุณา|กรอก|เลือก|เติม|ตัดให้|ตรวจสอบว่าพิมพ์|VAT|AI/);
  }
  const page = source('../expenses/ExpensesPages.tsx');
  for (const tag of page.match(/<(?:FieldIssueNote|AiFieldMissingHint)\s[^>]+/g) ?? []) assert.match(tag, /canEdit=\{isMutable(?: && canReview)?\}/);
});

test('unfinished read notices have no success tick and put the reason before the help', async () => {
  assert.doesNotMatch(render(h(InfoBanner, { message: 'อ่านข้อมูลไม่ครบ' })), /✓/);
  const { captureReadNoticeText } = await import('../expenses/expense-capture-status.logic');
  for (const status of ['PARTIAL', 'PAUSED'] as const) {
    const text = captureReadNoticeText({ status, pausedReason: 'page_limit', pagesRead: 1, pageCount: 2, attachmentId: 'a', fileId: null, lastErrorCode: null }, 'th');
    assert.ok(text.indexOf(workspaceDictionary.th['expenses.capture.paused_page_limit']) < text.indexOf('ผู้มีสิทธิ์'));
  }
  assert.match(source('../expenses/ExpenseReviewPage.tsx'), /captureReadNoticeText\(readState, locale\)/);
});

test('document-review selectors have a wrapping label and sufficient column width', () => {
  const select = render(h(ThemedSelect, { wrapLabel: true, value: 'pending' }, h('option', { value: 'pending' }, 'รอตรวจประเภทเอกสาร')));
  assert.match(select, /whitespace-normal break-words/);
  assert.doesNotMatch(select, /truncate/);
  const page = source('../expenses/ExpensesPages.tsx');
  assert.doesNotMatch(page, /ref=\{documentFieldsRef\}[^>]*sm:grid-cols-3/);
  for (const name of ['doc_type', 'tax_evidence_status']) {
    assert.match(page, new RegExp(`<ThemedSelect aria-label=\\{t\\('expenses\\.${name}', locale\\)\\} wrapLabel`));
  }
});

test('signature settings read their narrow endpoint, keep padding and offer no save after a failed load', () => {
  const page = source('../tax/TaxSignatureSettingsPage.tsx');
  assert.match(page, /getTaxSignature\(companyId\)/);
  assert.doesNotMatch(page, /getTaxProfile/);
  const html = render(h(TaxSignatureSettingsPage, { companyId: 'c', permissions: ['company.tax_signature.manage'] }), initial => initial === true ? false : initial === '' ? 'โหลดไม่สำเร็จ' : undefined);
  assert.match(html, /โหลดไม่สำเร็จ/);
  assert.doesNotMatch(html, /type="radio"|>บันทึก<|type="file"/);
  assert.match(html, /mangmee-card[^\"]*p-4/);
});

// Browser check 2026-10-04: the image field read "รูปลายเซ็น ( รูปภาพ (เจเพ็ก, พีเอ็นจี) )", parentheses inside parentheses.
test('the signature image field names its file types once, without nested parentheses', () => {
  const html = visible(render(h(TaxSignatureSettingsPage, { companyId: 'c', permissions: ['company.tax_signature.manage'] }),
    (_initial, index) => index === 0 ? { signatureMode: 'AUTO_STAMP', signatureImageAttachmentId: null } : index === 1 ? 'AUTO_STAMP' : index === 3 ? false : undefined));
  assert.match(html, /รูปลายเซ็น ·\s+รูปภาพ \(JPEG, PNG\)/);
  assert.doesNotMatch(html, /รูปลายเซ็น\s*\(\s*รูปภาพ/);
});

test('denied URLs stay inside the shell with an explanation and a reachable return link', () => {
  const page = source('./WorkspaceLayout.tsx');
  assert.doesNotMatch(page, /!canAccessCurrentPath[^\n]*router\.replace/);
  assert.match(page, /canAccessCurrentPath \? children :/);
  assert.match(page, /<ForbiddenState/);
  // 2026-10-13: the return link is the state's own `action` and is named after where it goes (thai-ux-standard §1.6).
  assert.match(page, /action=\{fallback && <Link className=\{secondaryButtonClass\} href=\{fallback\.href\}>\{`กลับไป\$\{fallback\.label\}`\}<\/Link>\}/);
  assert.match(page, /<ForbiddenState\s+titleAs="h1"/);
  const owner = ['notification.read', 'notification.preference.manage', 'notification.rule.manage', 'dashboard.read', 'company.setup.read'];
  for (const path of ['/settings/notifications', '/settings/notification-rules', '/notifications/preferences', '/notifications/rules']) {
    assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, owner, 'c', `/companies/c${path}`), true);
  }
  for (const path of ['/tax', '/crm', '/inventory', '/settings/tax-codes']) assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, owner, 'c', `/companies/c${path}`), false);
  assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['notification.read'], 'c', '/companies/c/settings/notification-rules'), false);
  assert.equal(canAccessWorkspacePath(WORKSPACE_MODULES, ['notification.read'], 'c', '/companies/c/notifications/preferences'), false);
});

test('report history makes no claim about previous purchase and hides creation/export actions', () => {
  // State 12 is historyOnly; assert the heading so a hook-order change cannot silently bypass the case.
  const html = render(h(ReportsWorkspacePage, { companyId: 'c' }), (_initial, index) => index === 12 ? true : index === 9 ? false : undefined);
  assert.match(html, /ประวัติรายงาน/);
  assert.doesNotMatch(html, /สร้างไว้ก่อนปิดฟีเจอร์|ส่งออก CSV|บันทึกมุมมอง/);
  assert.match(html, /ยังไม่มีไฟล์รายงานที่คุณดูได้/);
});

test('a staff draft shows the receipt-policy warning once even after the same submit error', () => {
  // 2026-10-13 (reimbursement lane): the sentence says what is missing and what the shop asks for, without "นโยบาย".
  const warning = 'มีรายการที่ยังไม่มีใบเสร็จ ร้านกำหนดให้แนบใบเสร็จทุกรายการ จึงส่งอนุมัติได้เมื่อแนบครบ';
  const detail = { id: 'claim', status: 'DRAFT', requesterUserId: 'staff', lines: [], amount: '100', outstandingAmount: '100', currency: 'THB', receiptRequirementStatus: 'REQUIRED', allowMissingReceiptWithReason: false };
  for (const actionError of [null, warning, 'บันทึกไม่สำเร็จ']) {
    let nulls = 0;
    const html = render(h(ReimbursementJourneyPage, { companyId: 'c', requestId: 'claim', userId: 'staff', permissions: ['reimbursement.read_own', 'reimbursement.submit'] }), initial => {
      if (initial !== null) return undefined;
      ++nulls;
      return nulls === 2 ? detail : nulls === 5 ? actionError : undefined;
    });
    assert.equal(html.split(warning).length - 1, 1, 'one visible warning, referenced by the send button');
    assert.match(html, /aria-describedby="claim-submit-readiness"/);
    // CLAIM-DETAIL (2026-10-16): no dead button; ส่งอนุมัติ stays pressable and takes the person to what is missing.
    assert.match(html, /<button type="button" class="mangmee-btn mangmee-btn-primary" aria-describedby="claim-submit-readiness" aria-busy="false">ส่งอนุมัติ<\/button>/);
    if (actionError && actionError !== warning) assert.match(html, /บันทึกไม่สำเร็จ/);
  }
});

test('report history never describes loading or failed reads as empty results', () => {
  for (const error of [null, 'โหลดไม่สำเร็จ']) {
    const html = render(h(ReportsWorkspacePage, { companyId: 'c' }), (_initial, index) =>
      index === 12 ? true : index === 9 ? error === null : index === 13 ? error : undefined);
    assert.match(html, /ประวัติรายงาน/);
    assert.doesNotMatch(html, /ยังไม่มี(?:มุมมองที่บันทึกไว้|ประวัติรายงานที่คุณดูได้|การส่งออกล่าสุด|ไฟล์รายงานที่คุณดูได้)/);
    if (error) assert.match(html, /โหลดไม่สำเร็จ/);
  }
});


test('W2 shared controls keep document prompts out of choices and reuse standard field, text and button sizes', () => {
  const review = source('../expenses/ExpensesPages.tsx');
  assert.match(review, /placeholder=\{t\('expenses\.document_type_choose', locale\)\}/);
  assert.match(review, /filter\(\(\[k\]\) => k !== 'NEEDS_REVIEW'/);
  assert.match(source('TransactionBranchField.tsx'), /invalid \? 'text-sm font-normal text-red-600'/);
  const payout = source('../reimbursements/ReimbursementPayout.tsx').split('export function MemberPayoutAccountLine')[1].split('export function ClaimPayoutFormSection')[0];
  assert.match(payout, /text-sm font-semibold/);
  assert.doesNotMatch(payout, /text-xs|text-\[(?:10|11)px\]/);
  const pager = source('../../common/components/data-table/Pagination.tsx');
  // The prominent pager keeps its 44 px ends on every width (owner 2026-10-05: "a pager nobody overlooks").
  // 44 px tall (owner 2026-10-05); on a phone the two buttons give up their minimum width so "หน้า 1 จาก 9" stays on one line (2026-10-15).
  assert.match(pager, /variant: 'secondary', size: 'md', className: 'min-h-11 min-w-0 whitespace-nowrap px-3 sm:min-w-32 !text-base'/);
});

// Owner 2026-10-13, looking at a window about 1556 px wide: "ทำไมไม่ทำเต็มจอ" and "ยกเลิก บันทึกร่าง ทำไมไปลอยอยู่ข้างๆ".
test('sold pages fill the content area and a form ends in the action bar, never with buttons in a side card', () => {
  const css = source('../../../app/globals.css');
  assert.doesNotMatch(css, /\.mangmee-page\[data-width/);
  assert.match(css, /\.mangmee-form-bar \{\s*position: sticky;\s*bottom: 0;/);
  // Inside a card the bar is the card's footer (it overlapped the card's edge on the signature page, 2026-10-13).
  assert.match(css, /\.mangmee-card \.mangmee-form-bar \{\s*position: static;\s*margin: 0;/);
  for (const path of ['../reimbursements/ReimbursementCreatePage.tsx', '../expenses/ExpensesPages.tsx']) {
    const page = source(path);
    assert.match(page, /<FormActionBar\b/, path);
    assert.doesNotMatch(page, /lg:grid-cols-\[minmax\(0,1fr\)_320px\]|lg:sticky lg:top-4/, path);
  }
  // No sold page narrows itself: the frame takes no width, and cards and the branch field carry no private cap.
  for (const path of ['../expenses/ExpensesPages.tsx', '../expenses/ExpensesWorkspacePanels.tsx', '../tax/WithholdingPage.tsx', '../company-profile/CompanyProfilePage.tsx',
    '../expenses/SubstituteReceiptWizardPage.tsx', '../reimbursements/ReimbursementJourneyPage.tsx', '../counterparties/CounterpartyDetailPage.tsx']) {
    assert.doesNotMatch(source(path), /<MangmeePage[^>]*\bwidth=|<MangmeeCard className="max-w-(?:2xl|3xl)/, path);
  }
  for (const path of ['../expenses/ExpensesPages.tsx', '../reimbursements/ReimbursementCreatePage.tsx', '../expenses/SubstituteReceiptWizardPage.tsx']) {
    assert.match(source(path), /<TransactionBranchField fill /, path);
  }
});

test('the shell explains forbidden pages from package availability and the reader role', () => {
  const source = readFileSync(new URL('./WorkspaceLayout.tsx', import.meta.url), 'utf8');
  assert.match(source, /packageAvailable=\{session.availablePermissions \? canAccessWorkspacePath/);
  assert.match(source, /isOwner=\{session.roles.includes\('OWNER'\)\}/);
  assert.doesNotMatch(source, /ถ้าต้องใช้หน้านี้ ให้/);
});
