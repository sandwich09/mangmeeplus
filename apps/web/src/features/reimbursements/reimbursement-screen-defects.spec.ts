import * as React from 'react';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { REIMBURSEMENT_SAVED_PAYOUT_WORDS as W } from '@watchdog-bms/contracts';
(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const ui = require('./ReimbursementPayout');
const logic = require('./reimbursement-payout.logic');
const h = React.createElement;
const noop = () => undefined;
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const render = (element: React.ReactElement) => renderToStaticMarkup(h(AppRouterContext.Provider,
  { value: { push: noop, prefetch: noop } as never }, h(ToastContext.Provider,
    { value: { success: noop, error: noop } as never }, element)));
const account = { ...logic.emptyPayoutAccountForm(), bankChoice: 'ธนาคารกสิกรไทย', accountName: 'สมชาย ใจดี', accountNumber: '00123456789' };

it('W3 retry inside a claim form is explicitly a non-submit button; batch buttons all declare their type', () => {
  const html = render(h('form', {}, h(ui.ClaimPayoutFormSection, { value: logic.emptyClaimPayoutForm(), onChange: noop, forSelf: true,
    canSaveAsDefault: true, payoutAccountHref: '/accounts', savedAccountsError: 'โหลดรายการไม่สำเร็จ', onReloadSaved: noop })));
  assert.match(html, /<button[^>]*type="button"[^>]*>ลองอีกครั้ง<\/button>/);
  for (const file of ['ReimbursementPayout.tsx', 'SavedPayoutAccountsCard.tsx', 'ReimbursementPayoutCorrection.tsx', 'ReimbursementJourneyPage.tsx', 'ReimbursementDetailSections.tsx']) {
    for (const button of read(`./${file}`).matchAll(/<button\b[^>]*>/g)) assert.match(button[0], /\btype="(?:button|submit)"/, file);
  }
});

for (const [name, mode, holderType] of [['default', 'DEFAULT', 'SELF'], ['own saved', 'SAVED', 'SELF'], ['third-party saved', 'SAVED', 'THIRD_PARTY'],
  ['cash', 'CASH', 'SELF'], ['typed own', 'SPECIFIED', 'SELF'], ['typed third-party', 'SPECIFIED', 'THIRD_PARTY']]) {
  it(`W3 branch change preserves ${name} receiving choice and every typed fact`, () => {
    const effect = read('./ReimbursementCreatePage.tsx').match(/useEffect\(\(\) => \{\s*if \(!editing && previousBranchRef.current !== branchId\) \{([\s\S]*?)\n    \}\n  \}, \[branchId[^\]]*\]\);/)!;
    assert.ok(effect);
    const initial = { ...logic.emptyClaimPayoutForm(), mode, savedAccountId: mode === 'SAVED' ? 'saved' : undefined, account,
      holder: { holderType, holderNote: holderType === 'THIRD_PARTY' ? 'คู่สมรสของผู้เบิก' : undefined }, saveForLater: true, saveAsDefault: false };
    let payout = initial;
    new Function('setForm', 'setRequesterUserId', 'setPayout', 'setPayoutInvalidField', 'previousBranchRef', 'branchId', 'userId', 'requesterUserId', 'resetClaimPayoutForRequester', 'emptyLine', effect[1]!)(
      noop, noop, (value: any) => { payout = typeof value === 'function' ? value(payout) : value; }, noop, { current: 'old' }, 'new', 'me', 'me', logic.resetClaimPayoutForRequester, noop);
    assert.deepEqual(payout, initial);
  });
}

for (const [field, value] of [['bankName', { ...account, bankChoice: '' }], ['bankName', { ...account, bankChoice: logic.OTHER_BANK }],
  ['accountName', { ...account, accountName: '' }], ['accountNumber', { ...account, accountNumber: '' }], ['payoutKind', account]]) {
  it(`W3 account refusal is described directly at ${field} (${value.bankChoice}) and clears the header`, () => {
    const html = render(h(ui.PayoutAccountFields, { value, onChange: noop, invalidField: field, error: 'กรุณาตรวจช่องนี้' }));
    const control = html.match(/<(?:input|button|summary)[^>]*aria-invalid="true"[^>]*>/)?.[0];
    assert.ok(control); const id = control.match(/aria-describedby="([^"]+)"/)?.[1]; assert.ok(id);
    assert.match(html, new RegExp(`id="${id}" role="alert"[^>]*>กรุณาตรวจช่องนี้`));
    assert.match(html, /scroll-mt-\[calc\(var\(--app-header-h\)\+1rem\)\]/);
    assert.ok(html.indexOf(`id="${id}"`) > html.indexOf(control));
  });
}
for (const note of ['', 'ก', 'เลขบัญชี 00123456789']) {
  it(`W3 claim holder-note refusal stays with the note (${note.length})`, () => {
    const value = { ...logic.emptyClaimPayoutForm(), mode: 'SPECIFIED', account, holder: { holderType: 'THIRD_PARTY', holderNote: note } };
    const problem = logic.claimPayoutFieldError(value);
    const html = render(h(ui.ClaimPayoutFormSection, { value, onChange: noop, forSelf: true, canSaveAsDefault: true,
      payoutAccountHref: '/accounts', invalidField: problem.field, error: problem.text }));
    const textarea = html.match(/<textarea[^>]*>/)![0]; const id = textarea.match(/aria-describedby="([^"]+)"/)?.[1]; assert.ok(id);
    assert.match(html, new RegExp(`id="${id}" role="alert"`)); assert.ok(html.includes(problem.text));
    assert.match(textarea, /aria-invalid="true"/);
  });
}
it('W3 add-account label refusal reuses FieldError and non-field refusals scroll the banner', () => {
  const saved = read('./SavedPayoutAccountsCard.tsx');
  assert.match(saved, /aria-describedby=\{invalidField === 'label'/);
  assert.match(saved, /<FieldError[^>]*>\{error\}<\/FieldError>/);
  for (const file of ['SavedPayoutAccountsCard.tsx', 'ReimbursementPayout.tsx', 'ReimbursementCreatePage.tsx']) {
    const source = read(`./${file}`);
    assert.match(source, /error && !\w*[Ii]nvalidField/);
    assert.match(source, /errorRef.current\?\.scrollIntoView/);
    assert.match(source, /ref=\{errorRef\} tabIndex=\{-1\}/);
  }
  assert.match(read('./ReimbursementCreatePage.tsx'), /invalidField=\{payoutInvalidField\}\s+error=\{error\}/);
  assert.match(saved, /invalidField=\{invalidField\} error=\{error\}/);
});
it('W3 deletion confirmation identifies the masked account using the same row details', () => {
  const source = read('./SavedPayoutAccountsCard.tsx');
  assert.match(source, /message: <[^>]*>[\s\S]*<SavedPayoutAccountDetails account=\{row\} index=\{index\}/);
  assert.match(source, /remove\(row, index\)/);
});
it('W3 default swap distinguishes a previous transfer account from cash or absence', () => {
  const source = read('./SavedPayoutAccountsCard.tsx');
  assert.match(source, /await getMyPayoutAccount\(companyId\)/);
  assert.match(source, /payoutMethod === 'BANK_TRANSFER' \? W.madeDefaultWithPrevious : W.madeDefault/);
  assert.equal((W as any).madeDefaultWithPrevious, 'ตั้งเป็นบัญชีประจำแล้ว บัญชีประจำเดิมอยู่ในรายการบัญชีที่บันทึกไว้');
});

it('W4 correction answer passes each inline refusal to the existing fields and brings non-field refusals into view', () => {
  const source = read('./ReimbursementPayoutCorrection.tsx').split('export function PayoutCorrectionAccountForm')[1]!;
  assert.match(source, /<PayoutAccountFields[^\n]*invalidField=\{invalidField\}[^\n]*error=\{error\}/);
  assert.match(source, /<PayoutHolderFields[^\n]*invalidField=\{invalidField\}[^\n]*error=\{error\}/);
  assert.match(source, /error && !invalidField/);
  assert.match(source, /errorRef.current\?\.scrollIntoView/);
  assert.match(source, /ref=\{errorRef\} tabIndex=\{-1\}/);
});
it('W4 send-back form omits name mismatch only for another persons account', () => {
  const correction = require('./reimbursement-payout.logic');
  for (const payoutKind of ['BANK_ACCOUNT', 'PROMPTPAY_PHONE']) {
    const own = correction.payoutCorrectionReasons({ payoutMethod: 'BANK_TRANSFER', payout: { payoutKind, holderType: 'SELF' } });
    const third = correction.payoutCorrectionReasons({ payoutMethod: 'BANK_TRANSFER', payout: { payoutKind, holderType: 'THIRD_PARTY' } });
    assert.ok(own.some(([code]: string[]) => code === 'ACCOUNT_NAME_MISMATCH'));
    assert.deepEqual(third, own.filter(([code]: string[]) => code !== 'ACCOUNT_NAME_MISMATCH'));
    assert.equal(require('@/common/api/api-error-message').translateApiError('payout_correction_name_mismatch_third_party'), require('@watchdog-bms/contracts').REIMBURSEMENT_PAYOUT_NAME_MISMATCH_THIRD_PARTY);
  }
});
