import * as React from 'react';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { REIMBURSEMENT_PAYOUT_HOLDER_WORDS as W, type SavedPayoutAccountSummary } from '@watchdog-bms/contracts';
import { ToastContext } from '@/common/components/toast/use-toast';
import { translateApiError } from '@/common/api/api-error-message';
(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const logic = require('./reimbursement-payout.logic');
const ui = require('./ReimbursementPayout');
const h = React.createElement;
const noop = () => undefined;
const render = (element: React.ReactElement) => renderToStaticMarkup(h(AppRouterContext.Provider,
  { value: { push: noop, prefetch: noop } as never }, h(ToastContext.Provider,
    { value: { success: noop, error: noop } as never }, element)));
const saved: SavedPayoutAccountSummary = { id: 'first', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'สมชาย ใจดี', accountLast4: '6789', holderType: 'SELF', createdAt: '2026-10-05' };
const other = { ...saved, id: 'second', holderType: 'THIRD_PARTY' as const, holderNote: 'คู่สมรสของผู้เบิก' };
const typed = () => ({ ...logic.emptyClaimPayoutForm(), mode: 'SPECIFIED', account: { ...logic.emptyPayoutAccountForm(), bankChoice: saved.bankName, accountName: saved.accountName, accountNumber: '00123456789' } });
const section = (props: object = {}) => render(h(ui.ClaimPayoutFormSection, { value: logic.emptyClaimPayoutForm(), onChange: noop, forSelf: true, canSaveAsDefault: true, payoutAccountHref: '/accounts', savedAccounts: [saved, other], ...props }));

it('PWS-PAYOUT names saving a receiving account and preserves the submitted-account and owner notices', () => {
  for (const file of ['ReimbursementPayout.tsx', 'SavedPayoutAccountsCard.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, />บันทึกบัญชีรับเงินคืน<\/button>/);
    assert.doesNotMatch(source, />บันทึกบัญชี<\/button>/);
  }
  const source = readFileSync(new URL('./ReimbursementPayout.tsx', import.meta.url), 'utf8');
  assert.match(source, /own \? 'บันทึกบัญชีรับเงินคืนแล้ว' : 'บันทึกบัญชีรับเงินคืนแล้ว ระบบแจ้งเจ้าของบัญชีให้ตรวจ'/);
  assert.match(source, /replaced \? ' ใบเบิกที่ส่งไปแล้วยังใช้บัญชีเดิม'/);
  const { ReimbursementSourceFacts } = require('./ReimbursementSourceFacts');
  const html = render(h(ReimbursementSourceFacts, { source: { seller: { name: 'ร้านวัสดุ' }, expenseDate: '2026-11-04', currency: 'THB', totals: { netPayableAmount: '104', vatAmount: '7', whtAmount: '3' } } }));
  assert.match(html, /VAT \/ หัก ณ ที่จ่าย ตามเอกสารเดิม/);
  assert.match(html, /7\.00[\s\S]*3\.00/);
});

it('saved destinations send only their id, and an unselected destination cannot save', () => {
  assert.deepEqual(logic.claimPayoutInput({ ...typed(), mode: 'SAVED', savedAccountId: saved.id }), { mode: 'SAVED', savedAccountId: saved.id });
  assert.ok(logic.claimPayoutFormError({ ...typed(), mode: 'SAVED' }));
  assert.ok(logic.claimPayoutFormError({ ...typed(), mode: '' }));
});
it('only the requester sees saved rows; the default and saved overlap both stay visible', () => {
  const own = section({ defaultAccount: { payoutMethod: 'BANK_TRANSFER', ...saved } });
  assert.match(own, /1\. บัญชีที่บันทึกไว้/); assert.match(own, /2\. บัญชีที่บันทึกไว้/);
  assert.ok((own.match(/เลขบัญชีลงท้าย 6789/g) ?? []).length >= 3);
  const prepared = section({ forSelf: false });
  assert.doesNotMatch(prepared, /บัญชีที่บันทึกไว้|คู่สมรส/);
  assert.equal((prepared.match(/type="radio"/g) ?? []).length, 3);
});
it('rows with identical masked facts remain distinguishable, and labels are escaped', () => {
  const first = render(h(ui.SavedPayoutAccountDetails, { account: saved, index: 0 }));
  const second = render(h(ui.SavedPayoutAccountDetails, { account: { ...saved, id: 'second' }, index: 1 }));
  assert.notEqual(first, second); assert.match(first, /สมชาย ใจดี/);
  const html = render(h(ui.SavedPayoutAccountDetails, { account: { ...other, label: '<ชื่อ>', holderNote: '<'.repeat(200) }, index: 0 }));
  assert.match(html, /&lt;ชื่อ&gt;/); assert.doesNotMatch(html, /<ชื่อ>/); assert.match(html, /overflow-wrap:anywhere/);
});
it('typed holder choices name the requester correctly, and third-party never offers default saving', () => {
  const html = section({ value: { ...typed(), holder: { holderType: 'THIRD_PARTY', holderNote: other.holderNote }, saveAsDefault: true } });
  assert.match(html, new RegExp(W.noteLabel)); assert.match(html, new RegExp(W.thirdPartyApprovalNotice));
  assert.doesNotMatch(html, /บันทึกเป็นบัญชีประจำของฉัน/); assert.match(html, /บันทึกบัญชีนี้ไว้ใช้ครั้งหน้า/);
  const prepared = section({ forSelf: false, value: typed() });
  assert.match(prepared, new RegExp(W.requesterSelf)); assert.doesNotMatch(prepared, /บันทึกบัญชีนี้ไว้ใช้ครั้งหน้า/);
});
it('third-party notices cover saved, kept and typed choices only when selected', () => {
  assert.match(section({ value: { ...typed(), mode: 'SAVED', savedAccountId: other.id } }), new RegExp(W.thirdPartyApprovalNotice));
  assert.match(section({ current: { payoutMethod: 'BANK_TRANSFER', ...other }, value: { ...typed(), mode: 'KEEP' } }), new RegExp(W.thirdPartyApprovalNotice));
  assert.doesNotMatch(section(), new RegExp(W.thirdPartyApprovalNotice));
});
it('saving checkboxes exclude each other and changing to third-party drops default saving', () => {
  const later = logic.setClaimPayoutSaving({ ...typed(), saveAsDefault: true }, 'saveForLater', true);
  assert.equal(later.saveAsDefault, false); assert.equal(later.saveForLater, true);
  const primary = logic.setClaimPayoutSaving(later, 'saveAsDefault', true);
  assert.equal(primary.saveForLater, false); assert.equal(primary.saveAsDefault, true);
  assert.equal(logic.setClaimPayoutHolder(primary, { holderType: 'THIRD_PARTY', holderNote: other.holderNote }).saveAsDefault, false);
});
it('typed input carries holder facts, suppresses forbidden saving, and preserves all other modes', () => {
  const form = { ...typed(), holder: { holderType: 'THIRD_PARTY', holderNote: '  คู่สมรสของผู้เบิก ' }, saveAsDefault: true, saveForLater: true };
  const input = logic.claimPayoutInput(form, true, true);
  assert.equal(input.holderType, 'THIRD_PARTY'); assert.equal(input.holderNote, other.holderNote);
  assert.equal(input.saveAsDefault, undefined); assert.equal(input.saveForLater, true);
  assert.equal(logic.claimPayoutInput(form, true, false).saveForLater, undefined);
  assert.deepEqual(logic.claimPayoutInput({ ...form, mode: 'CASH' }), { mode: 'CASH' });
  assert.deepEqual(logic.claimPayoutInput({ ...form, mode: 'DEFAULT' }), { mode: 'DEFAULT' });
  assert.equal(logic.claimPayoutInput({ ...form, mode: 'KEEP' }), undefined);
});
it('requester change and not-found refusal clear a saved choice without choosing another', () => {
  const selected = { ...typed(), mode: 'SAVED', savedAccountId: saved.id };
  assert.equal(logic.resetClaimPayoutForRequester(selected).mode, '');
  const recovery = logic.claimPayoutSavedRefusal(selected, { details: { code: 'payout_saved_account_not_found' } });
  assert.equal(recovery.form.mode, ''); assert.equal(recovery.form.savedAccountId, undefined); assert.equal(recovery.reload, true);
  assert.equal(logic.claimPayoutSavedRefusal(selected, { code: 'other' }), null);
});
it('saved account validation names the first failing field including holder and private label', () => {
  assert.equal(logic.savedPayoutAccountFormError(typed().account, { holderType: 'THIRD_PARTY', holderNote: '' }, '')?.field, 'holderNote');
  assert.equal(logic.savedPayoutAccountFormError(typed().account, { holderType: 'SELF' }, '0123456789')?.field, 'label');
  assert.equal(logic.savedPayoutAccountFormError({ ...typed().account, bankChoice: '' }, { holderType: 'THIRD_PARTY' }, '')?.field, 'bankName');
  assert.equal(logic.savedPayoutAccountFormError(typed().account, { holderType: 'SELF' }, 'ค่าเดินทาง'), null);
  assert.equal(logic.claimPayoutFormError({ ...typed(), holder: { holderType: 'THIRD_PARTY', holderNote: '0123456789' } }), W.noteContainsAccountNumber);
});
it('saved refusals have actionable Thai messages, including holder validation and future payment guards', () => {
  for (const code of ['payout_saved_account_not_found', 'payout_saved_account_limit', 'payout_saved_account_duplicate', 'payout_saved_account_is_default', 'payout_default_must_be_own', 'payout_third_party_acceptance_required', 'payout_third_party_needs_approval', 'payment_currency_mismatch', 'payment_source_bank_account_invalid', 'payout_holder_type_invalid', 'payout_holder_note_invalid', 'payout_saved_account_label_invalid']) {
    const text = translateApiError(code); assert.ok(text, code); assert.doesNotMatch(text!, /[A-Za-z_]/); assert.match(text!, /กรุณา|เลือก|ติ๊ก|ระบุ|ลบ|ใช้|ยกเลิก|แก้/);
  }
});
it('saved API client uses the five contracted routes and delete accepts 204', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return init?.method === 'DELETE' ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({ accounts: [saved], limit: 20 }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = require('./reimbursement-payout.api');
    await client.getMySavedPayoutAccounts('company');
    const input = { payoutKind: saved.payoutKind, bankName: saved.bankName, accountName: saved.accountName, accountNumber: '00123456789', holderType: 'SELF' };
    await client.addMySavedPayoutAccount('company', input);
    assert.equal(await client.deleteMySavedPayoutAccount('company', saved.id), undefined);
    await client.revealMySavedPayoutAccount('company', saved.id);
    await client.makeMySavedPayoutAccountDefault('company', saved.id);
    const base = '/api/v1/companies/company/reimbursements/payout-accounts/me/saved';
    assert.deepEqual(calls.map(call => [call.path, call.init?.method ?? 'GET']), [[base, 'GET'], [base, 'POST'], [`${base}/first`, 'DELETE'], [`${base}/first/reveal`, 'POST'], [`${base}/first/make-default`, 'POST']]);
    assert.deepEqual(JSON.parse(calls[1]!.init!.body as string), input);
  } finally { globalThis.fetch = original; }
});
it('saved rows expose audited reveal and own-only promotion with 44px actions', () => {
  const { SavedPayoutAccountRow } = require('./SavedPayoutAccountsCard');
  const row = (account: SavedPayoutAccountSummary) => render(h(SavedPayoutAccountRow, { companyId: 'company', account, index: 0, busy: false, onMakeDefault: noop, onRemove: noop }));
  assert.match(row(saved), /ตั้งเป็นบัญชีประจำ/);
  assert.doesNotMatch(row(other), /ตั้งเป็นบัญชีประจำ/);
  for (const account of [saved, other, { ...saved, payoutKind: 'PROMPTPAY_PHONE' as const }]) {
    const html = row(account);
    // The shared buttons (44 px high on a phone by the shared rule) in one group; deleting is the red one, and a row has no main button.
    assert.match(html, /<div class="mangmee-actions"><button type="button" class="mangmee-btn mangmee-btn-danger"[^>]*>ลบบัญชี<\/button>/);
    assert.doesNotMatch(html, /mangmee-btn-primary/);
    assert.match(html, account.payoutKind === 'PROMPTPAY_PHONE' ? /แสดงเบอร์พร้อมเพย์/ : /แสดงเลขบัญชี/);
    assert.doesNotMatch(html, /00123456789/);
  }
});
it('claim saved-list loading and failures remain visible with retry', () => {
  assert.match(section({ savedAccounts: [], savedAccountsLoading: true }), /กำลังโหลดบัญชีที่บันทึกไว้/);
  assert.match(section({ savedAccounts: [], savedAccountsError: 'โหลดรายการไม่สำเร็จ', onReloadSaved: noop }), /โหลดรายการไม่สำเร็จ/);
});
it('an invalid other-bank name marks only the typed bank name, and account kind can be focused', () => {
  const account = { ...typed().account, bankChoice: logic.OTHER_BANK, bankOther: '' };
  const html = render(h(ui.PayoutAccountFields, { value: account, onChange: noop, invalidField: 'bankName' }));
  assert.equal((html.match(/aria-invalid="true"/g) ?? []).length, 1);
  assert.match(html, /aria-label="ชื่อธนาคาร" aria-invalid="true"/);
  assert.match(render(h(ui.PayoutAccountFields, { value: account, onChange: noop, invalidField: 'payoutKind' })), /aria-label="ประเภทบัญชี" aria-invalid="true"/);
});
