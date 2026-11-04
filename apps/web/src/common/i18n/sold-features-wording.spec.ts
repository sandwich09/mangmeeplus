import { MENU_ENTITLEMENT_BINDINGS, FEATURE_CATALOG, TIER_FEATURE_PRESETS } from '@watchdog-bms/contracts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { workspaceDictionary } from './workspace-dictionary';
import { apiErrorMessage } from '../api/api-error-message';
import { uploadSourceFileValidationError, uploadFileValidationError, uploadErrorMessage } from '../files/upload-file.logic';
import { buildExpensesGuide } from '../../features/user-guide/expenses-guide.content';
import { captureMegabytes } from '../../features/expenses/expense-capture-upload.logic';
import { MIME_TYPE_LABELS } from '../../features/expenses/expenses.model';
import * as taxWords from '../../features/tax/tax.logic';
import { billingPurchaseModeLabel } from '../../features/billing/billing-display';
import { filterSettingsMenuItems, filterSettingsSidebarItems } from '../../features/web-core-workspace/settings-menu.logic';

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

for (const path of [
  '../app/billing/companies/page.tsx', 'common/i18n/workspace-dictionary.ts',
  'features/plan-term/plan-term.logic.ts', 'features/billing/billing-error-text.ts',
  'features/billing/BillingPage.tsx', 'features/billing/BillingCapacityPicker.tsx', 'features/company-profile/CompanyProfilePage.tsx',
  'features/external-signup/SignupPage.tsx', 'features/external-signup/SignupWelcomePage.tsx',
  'features/employee-access/AddEmployeePrototypePage.tsx',
  'features/expenses/ExpensesPages.tsx',
]) {
  test(`sold owner-role guidance uses the contracts name: ${path}`, () => {
    const text = source(path);
    assert.deepEqual(text.match(/เจ้าของบริษัท|เจ้าของร้าน|เจ้าของธุรกิจ|(?:รวม|และ)เจ้าของ(?!กิจการ)|เจ้าของหรือผู้ดูแลสิทธิ์|เจ้าของอีกบริษัท/gu) ?? [], [], path);
    assert.match(text, /THAI_SYSTEM_ROLE_NAMES\.OWNER/, path);
  });
}
const remainingEnglish = (text: string) => text.replace(/\{\w+\}/g, '').replace(/\b(?:LINE|QR|AI|PDF|VAT|Excel|CSV|JPEG|PNG|HEIC|HEIF|GIF|e-WHT)\b/g, '').match(/[A-Za-z]+/g) ?? [];

test('the specified e-WHT brand is allowed while internal remittance codes remain forbidden', () => {
  assert.deepEqual(remainingEnglish('ธนาคารนำส่ง (e-WHT)'), []);
  assert.deepEqual(remainingEnglish('E_WHT PAYER_FILES WHT'), ['E', 'WHT', 'PAYER', 'FILES', 'WHT']);
});

test('disbursement-voucher labels use plain Thai and name the owner role with the contracts name', () => {
  assert.ok(workspaceDictionary.th['expenses.disbursement_web_entry.owner_only'].includes('มีเพียงเจ้าของกิจการที่ใช้เมนูนี้ได้'));
  const entries = Object.entries(workspaceDictionary.th).filter(([key]) => /disbursement/.test(key));
  assert.ok(entries.length > 0);
  for (const [key, text] of entries) {
    assert.ok(key.startsWith('expenses.') && !key.startsWith('expenses.v_'), key);
    assert.deepEqual(remainingEnglish(text), [], key);
  }
});
function thaiLiterals(path: string): string[] {
  const ast = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) && /[ก-๛]/u.test(node.text)) values.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return values;
}

test('login progress and expiry use shared plain Thai copy', () => {
  assert.doesNotMatch(workspaceDictionary.th['auth.login.checking_session'], /เซสชัน/);
  assert.doesNotMatch(workspaceDictionary.th['error.session_expired'], /เซสชัน/);
  assert.equal(apiErrorMessage({ status: 401 }), workspaceDictionary.th['error.session_expired']);
  assert.doesNotMatch(source('features/auth/LineQrApprovePage.tsx'), /เซสชัน/);
});

test('sold Thai dictionary and starter settings menus contain no technical English', () => {
  const sold = new Set<string>(TIER_FEATURE_PRESETS.ENTERPRISE_1999);
  for (const binding of MENU_ENTITLEMENT_BINDINGS.filter((item) => item.parentFeatureKey && sold.has(item.parentFeatureKey))) assert.deepEqual(remainingEnglish(binding.labelTh), []);
  for (const feature of FEATURE_CATALOG.filter((item) => sold.has(item.key))) {
    for (const item of [feature, ...feature.submenus.filter((child) => sold.has(child.key))]) assert.deepEqual(remainingEnglish(item.labelTh), []);
  }
  const bad = Object.entries(workspaceDictionary.th)
    .filter(([key]) => /^(shell|auth|state|expenses|counterparties|account_security|common|list)\./.test(key))
    .filter(([, value]) => remainingEnglish(value).length);
  assert.deepEqual(bad, []);
  // No ledger/tax/CRM permission is granted by a starter feature. These unsold cards stay excluded.
  const permissions = ['company.setup.read', 'company.setup.manage', 'company.settings.view', 'company.branch.read'];
  for (const menu of [filterSettingsMenuItems(permissions), filterSettingsSidebarItems(permissions)]) {
    assert.ok(!menu.some((item) => /tax-codes|tax-accounts|chart-of-accounts|accounting-tax-setup/.test(item.key)));
    for (const item of menu) assert.deepEqual(remainingEnglish(`${item.title} ${item.desc}`), []);
  }
});

test('sold expense, employee, profile and login copy removes technical words at every touched surface', () => {
  const paths = [
    'features/expenses/ExpensesWorkspacePanels.tsx', 'features/expenses/SubstituteReceiptSettingsPage.tsx',
    'features/employee-access/EmployeeAccessPages.tsx', 'features/company-profile/CompanyProfilePage.tsx',
    'features/branch-settings/BranchSettingsPage.tsx', 'features/auth/AccountEmailOtpPanel.tsx',
    'features/auth/EmailAccessPage.tsx', 'features/auth/VerifyEmailPage.tsx', 'features/auth/LineQrApprovePage.tsx',
    'features/auth/LegalAcceptancePage.tsx', 'features/auth/LoginPage.tsx', 'features/tax/TaxSignatureSettingsPage.tsx',
  ];
  const forbidden = /\b(?:Tax Code|DDMMYYYY|CEO|CTO|CFO|DBD|TSIC|OTP|PNG|JPEG|JPG|HEIC|HEIF|GIF|MB|active|control|audit|JSON)\b/;
  const bad = paths.flatMap((path) => thaiLiterals(path).filter((text) => forbidden.test(text)).map((text) => ({ path, text })));
  assert.deepEqual(bad, []);
  assert.doesNotMatch(source('features/employee-access/EmployeeAccessPages.tsx'), />Username</);
  assert.doesNotMatch(source('features/auth/LoginPage.tsx'), />LIVE</);
});

test('upload validation and failure guidance uses plain format names and retains its limits', () => {
  for (const policy of ['attachment', 'image'] as const) {
    for (const message of [uploadSourceFileValidationError({ name: 'bad.exe', type: '' }, policy), uploadFileValidationError({ name: 'bad.exe', type: '' }, policy)]) {
      assert.ok(message); assert.deepEqual(remainingEnglish(message), []);
    }
  }
  assert.deepEqual(remainingEnglish(captureMegabytes(1048576)), []);
  for (const label of Object.values(MIME_TYPE_LABELS)) assert.deepEqual(remainingEnglish(label), []);
  for (const code of ['HEIC_DECODE_UNSUPPORTED', 'IMAGE_DECODE_FAILED', 'UNSUPPORTED_UPLOAD_FILE']) assert.deepEqual(remainingEnglish(uploadErrorMessage(new Error(code))), []);
});

test('expense API messages never echo a raw status or an internal tax/version token', () => {
  for (const status of ['DRAFT', 'CONFIRMED', 'VOIDED', 'FUTURE_STATE']) {
    for (const message of [`Cannot confirm expense in status ${status}.`, `Cannot prepare substitute evidence in status ${status}.`]) {
      const rendered = apiErrorMessage({ status: 409, message });
      assert.deepEqual(remainingEnglish(rendered), [], rendered);
      assert.doesNotMatch(rendered, /ต้องตรวจเอกสารจนพร้อมยืนยันก่อน/); // A voided record cannot be reviewed back to ready.
    }
  }
  for (const code of ['EXPENSE_VAT_TAX_TOLERANCE_REQUIRED', 'currency_not_supported', 'claim_signature_must_be_png_or_jpeg_max_2mb', 'claim_signature_too_large', 'claim_form_signed_copy_must_be_pdf_or_image', 'EMAIL_OTP_REQUIRED', 'BILLING_CHECKOUT_PENDING', 'BILLING_DOCUMENT_BINDING', 'invalid_username', 'company_business_type_invalid']) {
    assert.deepEqual(remainingEnglish(apiErrorMessage({ code })), [], code);
  }
});

test('permission guidance does not promise disabled features or shop-admin role management', () => {
  assert.doesNotMatch(workspaceDictionary.th['expenses.upload_capture_hint'], /ส่งเข้ามาทาง LINE ก็ได้/);
  assert.doesNotMatch(workspaceDictionary.th['expenses.upload_dropzone_hint'], /ส่งจาก LINE ได้เลย/);
  for (const key of ['expenses.extract_failed', 'expenses.upload_extract_failed_suffix', 'expenses.capture.read_failed', 'expenses.capture.read_partial', 'expenses.capture.read_paused'] as const) {
    assert.match(workspaceDictionary.th[key], /ผู้มีสิทธิ์แก้ไข/);
  }
  for (const [key, text] of Object.entries(workspaceDictionary.th)) {
    if (key.startsWith('expenses.extract_') && text.includes('กรอกข้อมูลต่อบนเว็บ')) assert.match(text, /ผู้มีสิทธิ์แก้ไข/);
  }
  assert.doesNotMatch(source('features/employee-access/EmployeeAccessPages.tsx'), /พนักงานทุกคนเข้าใช้ระบบ ดูหน้าหลัก และรับการแจ้งเตือนได้อยู่แล้ว/);
  assert.doesNotMatch(source('features/web-core-workspace/WorkspaceLayout.tsx'), /ติดต่อผู้ดูแลบริษัทเพื่อเปิดฟีเจอร์หรือปรับสิทธิ์ให้/);
  assert.doesNotMatch(workspaceDictionary.th['state.forbidden.help'], /ผู้ดูแลระบบ/);
  for (const key of ['counterparties.forbidden_help', 'counterparties.read_only'] as const) assert.doesNotMatch(workspaceDictionary.th[key], /ผู้ดูแลระบบ/);
});

test('expense guide explains the existing return-for-correction route and guides use Thai upload words', () => {
  const expenses = JSON.stringify(buildExpensesGuide('company', []));
  assert.match(expenses, /แก้ไขเอกสาร/);
  assert.match(expenses, /ยกเลิกรายการจ่ายนี้/);
  assert.doesNotMatch(expenses, /ส่งกลับแก้ไข/);
  assert.doesNotMatch(expenses, /หากผิดต้องยกเลิกแล้วบันทึกใหม่|ต้องยกเลิกเอกสารฉบับนั้นแล้วบันทึกใหม่/);
  for (const path of ['features/user-guide/expenses-guide.content.ts', 'features/user-guide/reimbursement-guide.content.ts', 'features/user-guide/substitute-receipt-guide.content.ts']) {
    assert.deepEqual(thaiLiterals(path).filter((text) => /\b(?:PNG|JPEG|JPG|HEIC|HEIF|MB|Service charge|SRC)\b/.test(text)), [], path);
  }
});

test('PND53 renders Thai period statuses and review issues, with a Thai fallback for new codes', () => {
  const words = taxWords as unknown as { taxPeriodStatusLabel: (status: string) => string; taxReviewIssueLabel: (code: string) => string };
  for (const code of ['OPEN', 'NEEDS_REVIEW', 'READY_FOR_REVIEW', 'REVIEWED', 'EXPORTED', 'FILED', 'PAID', 'CLOSED', 'AMENDED', 'future']) assert.deepEqual(remainingEnglish(words.taxPeriodStatusLabel(code)), []);
  for (const code of ['MISSING_TAX_ID', 'WHT_RATE_MISMATCH', 'INCOMPLETE_SOURCE_FACTS', 'FUNCTIONAL_CURRENCY_FX_MISSING', 'future']) assert.deepEqual(remainingEnglish(words.taxReviewIssueLabel(code)), []);
  assert.equal(words.taxPeriodStatusLabel('NEEDS_REVIEW'), 'ต้องตรวจสอบ');
  assert.equal(words.taxPeriodStatusLabel('future'), 'ไม่ทราบสถานะ');
  const branches = source('features/branch-settings/BranchSettingsPage.tsx');
  assert.doesNotMatch(branches, /\?\? b\.(status|type)/);
  assert.doesNotMatch(source('features/tax/TransactionTaxLineSelector.tsx'), /\{item\.externalCode\}/);
  const page = source('features/tax/WithholdingPage.tsx');
  assert.doesNotMatch(page, /\{period\.status\}|\$\{issue\.issueCode\}/);
  assert.match(page, /\{issue\.description\}/, 'the server supplies the Thai repair sentence');
});

test('customer package payment names and provider messages are Thai', () => {
  for (const mode of ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RECURRING'] as const) assert.deepEqual(remainingEnglish(billingPurchaseModeLabel(mode as never)), []);
  for (const path of ['features/billing/BillingPage.tsx', 'features/billing/billing-error-text.ts', 'features/billing/billing-event-discount.ts']) {
    assert.deepEqual(thaiLiterals(path).filter((text) => /\b(?:Stripe|PromptPay)\b/.test(text)), [], path);
  }
});
