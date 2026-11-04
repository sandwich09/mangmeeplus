import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';

const card = readFileSync(new URL('./DisbursementVoucherPayCard.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('./DisbursementVoucherDocumentPage.tsx', import.meta.url), 'utf8');
const list = readFileSync(new URL('./DisbursementVoucherListPage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./disbursement-vouchers.module.css', import.meta.url), 'utf8');
const word = (key: string) => workspaceDictionary.th[`expenses.disbursement.${key}` as keyof typeof workspaceDictionary.th];

test('pay form opens inside the approved step only with the server right and focuses nothing on arrival (a focused date field opened its calendar by itself)', () => {
  assert.match(page, /const canPay = canPayDisbursementVoucher\(detail\)/);
  assert.match(page, /canPay && <div className=\{styles.mainCardEnd\}><DisbursementVoucherPayCard/);
  assert.match(card, /id="disbursement-voucher-pay"[\s\S]*?<form/);
  assert.doesNotMatch(card, /MangmeeCard/);
  assert.doesNotMatch(card.slice(card.indexOf('useEffect(() => {'), card.indexOf('}, []);')), /scrollIntoView|window.scrollTo/);
  assert.doesNotMatch(card, /window.location.hash/);
  assert.match(card, /<h2 ref=\{heading\} tabIndex=\{-1\}/);
  assert.doesNotMatch(card, /router\./);
  assert.match(card, /<Modal open=\{confirmOpen\}/);
});
test('payment fields prefill today and planned method and use shared themed controls with fixed copy', () => {
  assert.match(card, /useState\(\(\) => initialDisbursementPayment\(detail.header\)\)/);
  assert.match(card, /todayCivilDate\('Asia\/Bangkok'\)/);
  assert.match(card, /<ThemedDate[\s\S]*?value=\{fields.paidDate\} max=\{today\} today=\{today\}/);
  assert.match(card, /<SelectField[\s\S]*?value=\{fields.paymentMethod\}/);
  assert.match(card, /Object.entries\(PAYMENT_METHOD_LABELS\).filter\(\(\[method\]\) => !eWht \|\| eWhtPaymentMethodAllowed\(method\)\).map/);
  assert.match(card, /<TextField[\s\S]*?value=\{fields.paidFromRef\} maxLength=\{128\}/);
  for (const [key, text] of [
    ['pay_readonly', 'ใบเลขที่ {number} จ่ายให้ {payee}'], ['actual_paid_date', 'วันที่จ่ายจริง'],
    ['paid_method', 'วิธีจ่าย'], ['paid_from_optional', 'จ่ายจาก (ไม่บังคับ)'],
    ['paid_from_placeholder', 'เช่น บัญชีร้าน กสิกร หรือ เงินสดย่อย'], ['paid_from_hint', 'ไม่ต้องใส่เลขบัญชีเต็ม'],
    ['pay_amount_hint', 'ยอดที่บันทึกต้องเท่ายอดที่อนุมัติ ถ้าจ่ายจริงไม่เท่านี้ ให้กด "กลับไปแก้" ก่อน'],
  ]) assert.equal(word(key!), text);
  assert.doesNotMatch(card, /type="number"|bankAccount/);
});
test('future-date refusal occurs before a request and is shown once under the date', () => {
  const save = card.slice(card.indexOf('const save ='), card.indexOf('return <div'));
  assert.ok(save.indexOf('if (refusal)') < save.indexOf('await payDisbursementVoucher'));
  assert.match(save, /if \(refusal\) \{ setError\(new Error\(refusal\)\); return; \}/);
  assert.match(card, /dateError && <p[^>]*role="alert"[\s\S]*?\{dateError\}/);
  assert.match(card, /error !== null && !dateError/);
  assert.equal(word('future_paid_date'), 'วันที่จ่ายต้องไม่เกินวันนี้');
});
test('one amount button ends the form in the shared action bar above the keyboard and safe area', () => {
  assert.equal((card.match(/type="submit"/g) ?? []).length, 1);
  assert.match(card, /<FormActionBar><ActionGroup>\s*<button type="submit" className=\{btnClass\}/);
  assert.equal(word('pay'), 'บันทึกว่าจ่ายแล้ว');
  assert.match(card, /needsRefresh \? word\('reload_latest'\) : word\('pay'\)/);
  assert.match(card, /viewport.height \+ viewport.offsetTop/);
  assert.match(card, /viewport\?\.addEventListener\('resize', place\)/);
  assert.match(card, /viewport\?\.addEventListener\('scroll', place\)/);
  assert.match(card, /viewport\?\.removeEventListener\('resize', place\)/);
  assert.match(card, /actionBar.style.bottom/);
  assert.match(card, /querySelector<HTMLElement>\('\[data-form-action-bar\]'\)/);
  assert.doesNotMatch(card + page + css, /h[-]screen|100v[h]/);
});
test('pay refusals stay once inside the card with fields retained and latest-data recovery', () => {
  assert.match(card, /catch \(failure\) \{ setError\(failure\); \}/);
  assert.equal((card.match(/apiErrorMessage\(error\)/g) ?? []).length, 1);
  assert.doesNotMatch(card, /catch[^{]*\{[^}]*setFields|toast.error/);
  assert.match(card, /code === 'disbursement_version_conflict' \|\| code === 'disbursement_status_changed'/);
  assert.match(card, /stale && <button[^>]*[\s\S]*?void reload\(\)/);
  assert.match(card, /await onReload\(\); commandId.current = null; setError\(null\)/);
});
test('payment attempts retain command ids, renew after each field edit and never double-submit', () => {
  assert.match(card, /if \(inFlight.current \|\| !confirmationReady \|\| stale \|\| !detail.actions.pay/);
  assert.match(card, /inFlight.current = true; setBusy\(true\)/);
  assert.match(card, /<CoverLoader active=\{busy\} scope="form"/);
  assert.match(card, /<fieldset disabled=\{busy \|\| needsRefresh\}/);
  assert.match(card, /aria-busy=\{busy \|\| actionBlocked \|\| slipUploading\}/);
  assert.match(card, /nextDraftCommand\(commandId.current, false, \(\) => crypto.randomUUID\(\)\)/);
  assert.match(card, /const change = [\s\S]*?commandId.current = null; setError\(null\); setFields/);
  for (const field of ['paidDate', 'paymentMethod', 'paidFromRef']) assert.match(card, new RegExp(`onChange=\\{event => change\\(\\{ ${field}:`));
  assert.match(card, /disbursementPaymentBody\(\{ commandId: commandId.current, expectedVersion: attachedSlip.current.version \}, fields\)/);
});
test('confirmed payment rereads detail in place and a failed read retries only the read', () => {
  assert.match(card, /if \(!committed.current\) committed.current = await payDisbursementVoucher/);
  assert.match(card, /setNeedsRefresh\(true\);\s+await onReload\(\)/);
  assert.match(card, /needsRefresh \? word\('reload_latest'\)/);
  assert.match(card, /toast.success\(word\('paid_toast'\).replace\('\{number\}', committed.current.documentNumber!\)\)/);
  assert.equal(word('paid_toast'), 'บันทึกจ่ายแล้ว ใบนี้เป็นใบสำคัญจ่ายเลขที่ {number}');
  assert.doesNotMatch(card + page, /router.refresh|location.reload/);
});
test('paid summary uses Thai dates, named payment method, payer and recorded time', () => {
  assert.match(page, /formatThaiDate\(header.paidDate\)/);
  assert.match(page, /PAYMENT_METHOD_LABELS\[header.paidMethod\]/);
  assert.match(page, /header.paidFromRef\?\.trim\(\) &&/);
  const history = readFileSync(new URL('./disbursement-voucher-journey.logic.ts', import.meta.url), 'utf8');
  assert.match(history, /at: header.paidRecordedAt[\s\S]*?actor: person\(detail.paidByName\)/);
  assert.doesNotMatch(page, /ผู้บันทึกจ่าย|บันทึกเมื่อ/);
  assert.match(page, /paid \? 'ยอดที่จ่าย'/);
});
test('paid withholding wiring delegates per-line certificate facts and viewer issue rights', () => {
  assert.match(page, /<DisbursementVoucherWithholding companyId=\{companyId\} detail=\{detail\} line=\{line\} canIssue=\{permissions.includes\('wht.certificate.issue'\)\}/);
  const component = readFileSync(new URL('./DisbursementVoucherWithholding.tsx', import.meta.url), 'utf8');
  assert.match(component, /disbursementWithholdingGroups\(\{ \.\.\.detail, lines: \[line\] \}\)/);
  assert.match(component, /#wht-certificate/);
  assert.match(component, /whitespace-nowrap/);
  assert.equal(word('wht_issue_next'), 'รายการนี้หักภาษี ณ ที่จ่ายไว้ ยังไม่ได้ออกหนังสือรับรอง (50 ทวิ)');
  assert.equal(word('wht_external_next'), 'รายการนี้หักภาษี ณ ที่จ่ายไว้ ถ้าทำหนังสือรับรองนอกระบบแล้ว บันทึกไว้ได้ที่หน้ารายจ่าย');
});
test('cancelled payment lines say which payments remain effective', () => {
  assert.match(page, /const cancelledPayments = disbursementCancelledPaymentLines\(detail\)/);
  assert.match(page, /cancelledPayments.length > 0 && line.expensePaymentId &&/);
  assert.match(page, /line.paymentInEffect \? 'expenses.disbursement.payment_live' : 'expenses.disbursement.payment_cancelled'/);
  assert.equal(word('payment_live'), 'ยังมีผล');
  assert.equal(word('payment_cancelled'), 'ถูกยกเลิกแล้ว');
});
test('both card and table pay links point to the payment form', () => {
  assert.match(list, /href=\{disbursementVoucherDocumentHref\(companyId, row\)\}/);
  assert.equal((list.match(/router.push\(disbursementVoucherDocumentHref\(companyId, row\)\)/g) ?? []).length, 2);
  assert.match(list, /role="link" tabIndex=\{0\}/);
});

test('the pay bar is a direct child of the tall form outside its card', () => {
  assert.ok(card.indexOf('<form ref={bar}') < card.indexOf('<h2 ref={heading}'));
  assert.ok(card.indexOf('</CoverLoader>') < card.indexOf('<FormActionBar>'));
  assert.match(card, /<\/ActionGroup><\/FormActionBar>\s*<\/form>/);
});


test('payment correction advice uses the server action and the author names from the detail read', () => {
  assert.match(card, /detail.actions.withdraw && onWithdraw/);
  assert.match(card, /\{disbursementPaymentCorrectionHint\(detail, Boolean\(detail.actions.withdraw && onWithdraw\)\)\}/);
  assert.doesNotMatch(card, /: word\('pay_amount_hint_ask'\)/);
});

test('four equal payment fields start two columns at 640px and the fixed bar retains its gutter', () => {
  assert.match(css, /@media \(min-width: 640px\) \{ fieldset.payFields/);
  assert.match(css, /\.payCard[^{}]*\[data-form-action-bar\][^{}]*\{[^}]*padding:/);
  assert.match(css, /padding-inline: 1.75rem/);
});

test('e-WHT payment screens remove cash/card, show conditional notices and keep bank statements free of certificate links', () => {
  assert.match(card, /eWhtPaymentMethodAllowed/); assert.match(card, /disbursementEWhtPaymentWarning\(detail, fields.paidDate\)/); assert.match(card, /E_WHT_WORDS\['W-P1'\]/);
  const withholding = readFileSync(new URL('./DisbursementVoucherWithholding.tsx', import.meta.url), 'utf8');
  assert.match(withholding, /state === 'E_WHT'/); assert.match(withholding, /'W-V1' : 'W-V1u'/);
  assert.match(withholding, /filter\(\(\{ state \}\) => state !== 'E_WHT'\)/);
  const draft = readFileSync(new URL('./DisbursementVoucherDraftPage.tsx', import.meta.url), 'utf8');
  assert.match(draft, /selectedRows.some\(row => row.whtRemittance === 'E_WHT'\)/); assert.match(draft, /eWhtPaymentMethodAllowed/);
});
