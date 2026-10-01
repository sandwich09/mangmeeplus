import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { THAI_BANK_NAMES, maskedPayoutAccount, type ReimbursementPayoutSummary } from '@watchdog-bms/contracts';
import { ToastContext } from '@/common/components/toast/use-toast';
import { translateApiError } from '@/common/api/api-error-message';
import { SALES_BANK_NAMES } from '../sales-console/sales-console.logic';

/*
 * Payout account screens (payout spec §8–§11, Phase 1 part A). What this guards:
 *  - one format rule and one masked wording, shared with the API;
 *  - every screen shows the last 4 digits; "แสดงเลขบัญชี" is offered only when the server said so;
 *  - a claim sent before the field existed reads the same everywhere;
 *  - the approver cannot approve a transfer claim without attesting the account version shown;
 *  - plain Thai and a 390 px phone.
 */
(globalThis as typeof globalThis & { React: typeof React }).React = React;
// The screens reach the icon set through ExpensesUi; this runner has no SVG loader.
require.extensions['.svg'] = (module) => { module.exports = () => null; };
// Modal portals into document.body, which a server render has none of: render the dialog in place.
Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
const ui = require('./ReimbursementPayout') as typeof import('./ReimbursementPayout');
const { ReimbursementPayoutAccountPage } = require('./ReimbursementPayoutAccountPage') as typeof import('./ReimbursementPayoutAccountPage');
const logic = require('./reimbursement-payout.logic') as typeof import('./reimbursement-payout.logic');
const { approvalComparable, diffApprovalFields } = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
const { StaleApprovalDialog } = require('./ReimbursementDetailSections') as typeof import('./ReimbursementDetailSections');

const h = React.createElement;
const noop = () => undefined;
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, bfcacheId: 'test' };
const toast = { success: noop, warning: noop, error: noop };
const render = (element: React.ReactElement) => renderToStaticMarkup(
  h(AppRouterContext.Provider, { value: router as never }, h(ToastContext.Provider, { value: toast as never }, element)));
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

/** What the customer reads: text nodes plus aria labels, placeholders and tooltips; never other attributes such as links. */
const visible = (html: string) => [...[...html.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/gu)].map((match) => match[1]!),
  ...html.replace(/<[^>]*>/gu, '\n').split('\n')]
  .map((text) => text.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').trim()).filter(Boolean);

const ids = { company: 'cmg7x2k9p0000companyq1w2e3', request: 'cmg7x2k9p0001requestq8w3e5', requester: 'cmg7x2k9p0002userr4t6y8a1', approver: 'cmg7x2k9p0003useru1i3o5p7' };
const KBANK = { payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789' };
const transfer: ReimbursementPayoutSummary = { payoutMethod: 'BANK_TRANSFER', ...KBANK, version: 1, source: 'DEFAULT_ACCOUNT' };
const claim = (overrides: Record<string, unknown> = {}) => ({
  id: ids.request, status: 'PENDING_APPROVAL', requesterUserId: ids.requester, requesterDisplayNameSnapshot: 'สมชาย ใจดี', payout: transfer, ...overrides,
});
const card = (detail: object, userId = ids.approver, editHref?: string) => render(h(ui.ClaimPayoutCard, {
  companyId: ids.company, detail, userId, payoutAccountHref: `/companies/${ids.company}/reimbursements/payout-account`, ...(editHref && { editHref }),
}));
const form = (overrides: Partial<import('./reimbursement-payout.logic').PayoutAccountForm> = {}) => ({
  ...logic.emptyPayoutAccountForm(), bankChoice: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456789', ...overrides,
});
const section = (props: Partial<Parameters<typeof ui.ClaimPayoutFormSection>[0]> = {}) => render(h(ui.ClaimPayoutFormSection, {
  value: logic.emptyClaimPayoutForm(), onChange: noop, forSelf: true, defaultAccount: null, canSaveAsDefault: true,
  payoutAccountHref: `/companies/${ids.company}/reimbursements/payout-account`, ...props,
}));

describe('payout account form: the same rule the server runs, said in Thai', () => {
  it('keeps the number as typed text, leading zeros included, and sends an account only for a transfer', () => {
    assert.deepEqual(logic.payoutDestinationInput(form({ accountNumber: '0012345678' })),
      { payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0012345678' });
    assert.deepEqual(logic.payoutDestinationInput(form({ bankChoice: logic.OTHER_BANK, bankOther: '  ธนาคารทดสอบ ' })).bankName, 'ธนาคารทดสอบ');
    // PromptPay has no bank; a bank left in the picker is not sent with it.
    assert.deepEqual(logic.payoutDestinationInput(form({ payoutKind: 'PROMPTPAY_PHONE', accountNumber: '0812345678' })),
      { payoutKind: 'PROMPTPAY_PHONE', accountName: 'นาย สมชาย ใจดี', accountNumber: '0812345678' });
    assert.deepEqual(logic.memberPayoutAccountInput('CASH', form()), { payoutMethod: 'CASH' });
    assert.deepEqual(logic.memberPayoutAccountInput('BANK_TRANSFER', form()),
      { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456789' });
  });

  it('names the first field that is wrong, and accepts what a person really types', () => {
    const problem = (overrides: Parameters<typeof form>[0]) => logic.payoutAccountFormError(form(overrides));
    for (const accountNumber of ['0123456789', '012-3-45678-9', '012 345 6789', '000123', '12345678901234567890']) assert.equal(problem({ accountNumber }), null, accountNumber);
    assert.deepEqual(problem({ bankChoice: '' }), { field: 'bankName', text: 'กรุณาเลือกธนาคาร' });
    assert.deepEqual(problem({ bankChoice: logic.OTHER_BANK, bankOther: ' ' }), { field: 'bankName', text: 'กรุณาระบุชื่อธนาคาร ไม่เกิน 80 ตัวอักษร' });
    for (const accountName of ['', 'ก', '1234567890']) assert.equal(problem({ accountName })?.field, 'accountName', accountName);
    for (const accountNumber of ['', '12345', '123456789012345678901', '01234x6789', '๐๑๒๓๔๕๖']) {
      assert.deepEqual(problem({ accountNumber }), { field: 'accountNumber', text: 'เลขบัญชีต้องเป็นตัวเลข 6 ถึง 20 หลัก' }, accountNumber);
    }
    // No bank account is forced to 10 digits; a PromptPay phone number is.
    for (const accountNumber of ['081234567', '8123456789', '08123456789']) {
      assert.deepEqual(problem({ payoutKind: 'PROMPTPAY_PHONE', accountNumber }),
        { field: 'accountNumber', text: 'เบอร์พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0' }, accountNumber);
    }
    assert.equal(problem({ payoutKind: 'PROMPTPAY_PHONE', bankChoice: '', accountNumber: '081-234-5678' }), null);
  });

  it('turns the claim form choice into the request field, and leaves a kept account untouched', () => {
    const base = logic.emptyClaimPayoutForm();
    assert.deepEqual(base, { mode: 'DEFAULT', account: logic.emptyPayoutAccountForm(), saveAsDefault: false });
    assert.deepEqual(logic.claimPayoutInput(base), { mode: 'DEFAULT' });
    assert.deepEqual(logic.claimPayoutInput({ ...base, mode: 'CASH', account: form() }), { mode: 'CASH' });
    assert.equal(logic.claimPayoutInput({ ...base, mode: 'KEEP' }), undefined);
    const typed = { mode: 'SPECIFIED', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456789' };
    assert.deepEqual(logic.claimPayoutInput({ mode: 'SPECIFIED', account: form(), saveAsDefault: false }), typed);
    assert.deepEqual(logic.claimPayoutInput({ mode: 'SPECIFIED', account: form(), saveAsDefault: true }), { ...typed, saveAsDefault: true });
    // Only an account being typed can be wrong; the other choices carry none.
    assert.equal(logic.claimPayoutFormError({ ...base, mode: 'CASH', account: form({ accountNumber: '1' }) }), null);
    assert.equal(logic.claimPayoutFormError({ ...base, mode: 'SPECIFIED', account: form({ accountNumber: '1' }) }), 'เลขบัญชีต้องเป็นตัวเลข 6 ถึง 20 หลัก');

    // An existing draft opens on what it stands on.
    assert.equal(logic.claimPayoutFormOf(undefined).mode, 'DEFAULT');
    assert.equal(logic.claimPayoutFormOf({ followsDefault: true, ...transfer }).mode, 'DEFAULT');
    assert.equal(logic.claimPayoutFormOf({ followsDefault: true, notReadyReason: 'payout_method_required' }).mode, 'DEFAULT');
    assert.equal(logic.claimPayoutFormOf({ payoutMethod: 'CASH' }).mode, 'CASH');
    assert.equal(logic.claimPayoutFormOf({ ...transfer, source: 'REQUESTER' }).mode, 'KEEP');
  });
});

describe('what a claim says about where the money goes back to', () => {
  it('uses one masked wording everywhere: the shared one', () => {
    assert.equal(maskedPayoutAccount(KBANK), 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789');
    assert.equal(logic.payoutAccountLine({ payoutMethod: 'BANK_TRANSFER', ...KBANK }), maskedPayoutAccount(KBANK));
    assert.equal(logic.claimPayoutView(claim()).line, maskedPayoutAccount(KBANK));
    assert.equal(logic.payoutAccountLine({ payoutMethod: 'BANK_TRANSFER', payoutKind: 'PROMPTPAY_PHONE', accountLast4: '5678' }), 'พร้อมเพย์เบอร์ลงท้าย 5678');
    assert.equal(logic.payoutAccountLine({ payoutMethod: 'CASH' }), 'รับเป็นเงินสด');
    assert.equal(logic.payoutAccountLine(null), 'ยังไม่ได้ตั้ง');
    assert.equal(logic.setByOtherLine({ updatedAt: '2026-10-01T03:00:00.000Z' }), null);
    assert.match(logic.setByOtherLine({ setByOtherName: 'วิภา', updatedAt: '2026-10-01T03:00:00.000Z' })!, /^ตั้งโดย วิภา เมื่อ 1 ต\.ค\. 2569/);
    // One wording, one place: no screen builds the masked form by hand.
    for (const file of ['./ReimbursementPayout.tsx', './reimbursement-payout.logic.ts', './ReimbursementJourneyPage.tsx', './ReimbursementCreatePage.tsx']) {
      assert.doesNotMatch(read(file), /ลงท้าย/, file);
    }
  });

  it('reads a claim from before the field existed the same way in every status and for every viewer', () => {
    for (const status of ['PENDING_APPROVAL', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PAID', 'REJECTED', 'CANCELLED']) {
      assert.deepEqual(logic.claimPayoutView({ status, requesterUserId: ids.requester }), { state: 'legacy', line: logic.LEGACY_PAYOUT_NOTE, notes: [] }, status);
      assert.equal(logic.claimNeedsPayoutAttestation({}), false);
      assert.equal(logic.claimPayoutSubmitBlock({ status }), null);
      for (const viewer of [ids.requester, ids.approver]) {
        const html = card(claim({ status, payout: undefined }), viewer);
        assert.deepEqual(visible(html), ['การรับเงินคืน', 'ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีข้อมูลบัญชีรับเงินในระบบ'], `${status} ${viewer}`);
        assert.doesNotMatch(html, /<button/, 'nothing to reveal');
      }
    }
  });

  it('shows a draft what it will be sent with, and says so when the default is edited, removed or missing', () => {
    const draft = (payout: ReimbursementPayoutSummary) => logic.claimPayoutView({ status: 'DRAFT', requesterUserId: ids.requester, payout });
    assert.deepEqual(draft({ followsDefault: true, ...transfer }), { state: 'transfer', line: 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789',
      notes: ['ตามบัญชีรับเงินคืนประจำของผู้เบิก ใบนี้จะส่งด้วยบัญชีที่แสดงอยู่นี้ ถ้าบัญชีประจำถูกแก้ก่อนกดส่ง ระบบจะให้ตรวจบัญชีใหม่'] });
    // The default was set by someone else (a claim filed on the requester's behalf shows this to the preparer too).
    assert.deepEqual(draft({ followsDefault: true, ...transfer, enteredByName: 'วิภา' }).notes,
      ['ตามบัญชีรับเงินคืนประจำของผู้เบิก ใบนี้จะส่งด้วยบัญชีที่แสดงอยู่นี้ ถ้าบัญชีประจำถูกแก้ก่อนกดส่ง ระบบจะให้ตรวจบัญชีใหม่', 'บัญชีประจำนี้ตั้งโดย วิภา']);
    assert.deepEqual(draft({ followsDefault: true, payoutMethod: 'CASH', source: 'DEFAULT_ACCOUNT' }),
      { state: 'cash', line: 'รับเป็นเงินสด', notes: ['ตามบัญชีรับเงินคืนประจำของผู้เบิก ใบนี้จะส่งด้วยบัญชีที่แสดงอยู่นี้ ถ้าบัญชีประจำถูกแก้ก่อนกดส่ง ระบบจะให้ตรวจบัญชีใหม่'] });
    // The default was removed, or never set: the draft can be saved but not sent.
    const missing = { followsDefault: true, notReadyReason: 'payout_method_required' as const };
    assert.deepEqual(draft(missing), { state: 'missing', line: 'ยังไม่ได้เลือกวิธีรับเงินคืน',
      notes: ['ผู้เบิกยังไม่ได้ตั้งบัญชีรับเงินคืนประจำ เลือกรับเป็นเงินสด ระบุบัญชีสำหรับใบนี้ หรือตั้งบัญชีประจำก่อนส่งอนุมัติ'] });
    assert.equal(logic.claimPayoutSubmitBlock({ status: 'DRAFT', payout: missing }), 'ยังไม่ได้เลือกวิธีรับเงินคืน เลือกวิธีรับเงินคืนก่อนส่งอนุมัติ');
    assert.equal(draft({ payoutMethod: 'BANK_TRANSFER', notReadyReason: 'payout_destination_required' }).line, 'ยังไม่ได้ระบุบัญชีรับเงินคืน');
    assert.equal(logic.claimPayoutSubmitBlock({ status: 'DRAFT', payout: { followsDefault: true, ...transfer } }), null);
    // An account typed for this claim, by the requester or by whoever prepared it.
    assert.deepEqual(draft({ ...transfer, source: 'REQUESTER' }).notes, ['บัญชีที่ระบุสำหรับใบนี้']);
    assert.deepEqual(draft({ ...transfer, source: 'PREPARER', enteredByName: 'วิภา' }).notes, ['บัญชีที่ระบุสำหรับใบนี้', 'กรอกโดย วิภา']);
    // An action response carries no payout block for a draft: say nothing rather than call it legacy.
    assert.equal(logic.claimPayoutView({ status: 'DRAFT' }).state, 'unknown');
    assert.equal(card(claim({ status: 'DRAFT', payout: undefined })), '');

    const html = card(claim({ status: 'DRAFT', payout: missing }), ids.requester, `/companies/${ids.company}/reimbursements/${ids.request}/edit`);
    // The banner carries the sentence after its warning mark.
    for (const text of ['ยังไม่ได้เลือกวิธีรับเงินคืน', 'เลือกวิธีรับเงินคืนในใบนี้', 'ตั้งบัญชีรับเงินคืนของฉัน']) assert.ok(visible(html).some((shown) => shown.endsWith(text)), text);
    assert.match(html, new RegExp(`href="/companies/${ids.company}/reimbursements/payout-account"`));
    // Someone else looking at the draft is not sent to "my" account page.
    assert.ok(!visible(card(claim({ status: 'DRAFT', payout: missing }), ids.approver)).includes('ตั้งบัญชีรับเงินคืนของฉัน'));
  });

  it('says who attested a sent claim, truthfully when it was the requester', () => {
    const sent = (payout: Partial<ReimbursementPayoutSummary>) => logic.claimPayoutView(claim({ payout: { ...transfer, ...payout } })).notes;
    assert.deepEqual(sent({}), ['ยังไม่มีผู้ตรวจบัญชีนี้']);
    assert.match(sent({ verifiedByUserId: ids.approver, verifiedByName: 'สมศรี', verifiedAt: '2026-10-01T03:00:00.000Z' })[0]!, /^ตรวจบัญชีแล้วโดย สมศรี เมื่อ 1 ต\.ค\. 2569/);
    assert.match(sent({ verifiedByUserId: ids.requester, verifiedByName: 'สมชาย', verifiedAt: '2026-10-01T03:00:00.000Z' })[0]!, /^ผู้เบิกยืนยันบัญชีของตนเอง เมื่อ 1 ต\.ค\. 2569/);
    assert.deepEqual(sent({ source: 'PREPARER', enteredByName: 'วิภา' }), ['กรอกโดย วิภา', 'ยังไม่มีผู้ตรวจบัญชีนี้']);
    assert.deepEqual(logic.claimPayoutView(claim({ payout: { payoutMethod: 'CASH' } })), { state: 'cash', line: 'รับเป็นเงินสด', notes: [] });
    assert.deepEqual([logic.claimNeedsPayoutAttestation(claim()), logic.claimNeedsPayoutAttestation(claim({ payout: { payoutMethod: 'CASH' } }))], [true, false]);
  });
});

describe('the full number: offered only when the server allows it, never in the page itself', () => {
  it('shows the reveal button exactly when the claim says this viewer may reveal', () => {
    const allowed = card(claim({ payout: { ...transfer, canRevealAccountNumber: true } }));
    assert.ok(visible(allowed).includes('แสดงเลขบัญชี'));
    for (const text of ['การรับเงินคืน', 'โอนเข้าบัญชี', 'ผู้เบิก', 'สมชาย ใจดี', 'ชื่อบัญชี', 'นาย สมชาย ใจดี', 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789', 'ยังไม่มีผู้ตรวจบัญชีนี้']) {
      assert.ok(visible(allowed).includes(text), text);
    }
    for (const flag of [false, undefined]) {
      const refused = card(claim({ payout: { ...transfer, canRevealAccountNumber: flag } }));
      assert.doesNotMatch(refused, /แสดงเลขบัญชี|<button/, String(flag));
      // Everything else is identical: the masked account is the same for every viewer.
      assert.deepEqual(visible(refused), visible(allowed).filter((text) => text !== 'แสดงเลขบัญชี'));
    }
    assert.doesNotMatch(card(claim({ payout: { payoutMethod: 'CASH', canRevealAccountNumber: true } })), /แสดงเลขบัญชี/, 'cash has no number');
    // Nothing on the page is a full number: only the last 4 digits are in the markup.
    for (const html of [allowed, section({ defaultAccount: { userId: ids.requester, payoutMethod: 'BANK_TRANSFER', ...KBANK, updatedAt: '2026-10-01T03:00:00.000Z' } })]) {
      assert.deepEqual(html.replace(new RegExp(Object.values(ids).join('|'), 'g'), '').match(/\d{5,}/g), null);
    }
  });

  it('takes the flag from the server and asks the server for the number: no other source', () => {
    const screen = read('./ReimbursementPayout.tsx');
    assert.match(screen, /canReveal=\{payout\.canRevealAccountNumber === true\}/);
    assert.match(screen, /onReveal=\{async \(\) => \(await revealClaimPayoutAccount\(companyId, detail\.id\)\)\.accountNumber\}/);
    // A default account is revealed to its owner alone; an editor of someone else's account gets no button.
    assert.match(screen, /canReveal=\{own\}\s+onReveal=\{async \(\) => \(await revealMyPayoutAccount\(companyId\)\)\.accountNumber\}/);
    assert.match(screen, /const own = !memberUserId;/);
    // The number lives in one component's state, is dropped when the account shown changes, and is never stored.
    assert.match(screen, /useEffect\(\(\) => \{ setShown\(null\); setError\(null\); \}, \[masked\]\);/);
    assert.doesNotMatch(screen, /localStorage|sessionStorage|console\./);
    // The edit form always starts empty: a saved number is never loaded back into a field.
    assert.match(screen, /setForm\(emptyPayoutAccountForm\(\)\); setMethod\(account\?\.payoutMethod \?\? 'BANK_TRANSFER'\);/);

    const api = read('./reimbursement-payout.api.ts');
    assert.deepEqual([...api.matchAll(/export function (\w+)/g)].map((match) => match[1]).sort(),
      ['deleteMyPayoutAccount', 'getMemberPayoutAccount', 'getMyPayoutAccount', 'revealClaimPayoutAccount', 'revealMyPayoutAccount', 'setMemberPayoutAccount', 'setMyPayoutAccount']);
    assert.equal(api.match(/\/reveal/g)?.length, 2, 'two reveal calls: my own default account and a claim');
    // The reveal is a POST the server audits; nothing about an account ever rides in a URL.
    assert.doesNotMatch(api, /\?|accountNumber/);
  });

  it('keeps the number a text field with a numeric keypad, so a leading zero is never lost', () => {
    const html = section({ value: { mode: 'SPECIFIED', account: form({ accountNumber: '0012345678' }), saveAsDefault: false } });
    const [input] = html.match(/<input aria-label="เลขบัญชี"[^>]*>/) ?? [];
    assert.ok(input, 'the account number field');
    for (const attribute of [/type="text"/, /inputMode="numeric"/i, /autoComplete="off"/i, /value="0012345678"/]) assert.match(input, attribute);
    assert.doesNotMatch(html, /type="number"/);
  });
});

describe('the receiving choice on the claim form', () => {
  it('offers the default, cash or an account for this claim, with the bank list everyone shares', () => {
    const mine = section({ defaultAccount: { userId: ids.requester, payoutMethod: 'BANK_TRANSFER', ...KBANK, updatedAt: '2026-10-01T03:00:00.000Z' } });
    for (const text of ['รับเงินคืนทาง', 'ตามบัญชีรับเงินคืนประจำของฉัน', 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789 · นาย สมชาย ใจดี', 'รับเป็นเงินสด', 'ระบุบัญชีสำหรับใบนี้', 'จัดการบัญชีรับเงินคืนของฉัน']) {
      assert.ok(visible(mine).includes(text), text);
    }
    assert.ok(visible(section()).includes('คุณยังไม่ได้ตั้งบัญชีประจำ บันทึกร่างได้ แต่ต้องเลือกวิธีอื่นหรือตั้งบัญชีประจำก่อนส่งอนุมัติ'));
    assert.ok(visible(section({ defaultAccount: undefined })).includes('กำลังโหลดบัญชีประจำของคุณ...'));
    // Set by someone else: the requester is told on the form too, until they save it themselves.
    assert.ok(visible(section({ defaultAccount: { userId: ids.requester, payoutMethod: 'BANK_TRANSFER', ...KBANK, updatedAt: '2026-10-01T03:00:00.000Z', setByOtherName: 'วิภา' } }))
      .some((text) => /^ตั้งโดย วิภา เมื่อ .+ ตรวจว่าเป็นบัญชีของคุณ$/.test(text)));

    const typing = section({ value: { mode: 'SPECIFIED', account: logic.emptyPayoutAccountForm(), saveAsDefault: true } });
    // One bank list for the whole product: the shared one, the same array the sales screens pick from.
    assert.equal(logic.BANK_OPTIONS, THAI_BANK_NAMES);
    assert.equal(SALES_BANK_NAMES, THAI_BANK_NAMES);
    assert.match(read('./ReimbursementPayout.tsx'), /\{BANK_OPTIONS\.map\(\(bank\) => <option key=\{bank\} value=\{bank\}>\{bank\}<\/option>\)\}\s+<option value=\{OTHER_BANK\}>ธนาคารอื่น<\/option>/);
    for (const text of ['ประเภทบัญชี *', 'ธนาคาร *', 'ชื่อบัญชี *', 'เลขบัญชี *', 'บันทึกเป็นบัญชีประจำของฉัน']) assert.ok(visible(typing).includes(text), text);
    assert.ok(!visible(section({ canSaveAsDefault: false, value: { mode: 'SPECIFIED', account: logic.emptyPayoutAccountForm(), saveAsDefault: false } })).some((text) => text.startsWith('บันทึกเป็นบัญชีประจำ')));
    // PromptPay asks for a phone number and no bank.
    const promptPay = visible(section({ value: { mode: 'SPECIFIED', account: form({ payoutKind: 'PROMPTPAY_PHONE' }), saveAsDefault: false } }));
    assert.ok(promptPay.includes('เบอร์พร้อมเพย์ *') && !promptPay.includes('ธนาคาร *'));
  });

  it('files on behalf with the REQUESTER account: the preparer never sees or picks their own', () => {
    const html = section({ forSelf: false, defaultAccount: null, canSaveAsDefault: true, value: { mode: 'SPECIFIED', account: logic.emptyPayoutAccountForm(), saveAsDefault: false } });
    const texts = visible(html);
    for (const text of ['ตามบัญชีรับเงินคืนประจำของผู้เบิก', 'ระบบใช้บัญชีรับเงินคืนประจำของผู้เบิกที่เลือกไว้ และแสดงบัญชีนั้นให้ตรวจในหน้าใบเบิกก่อนกดส่งอนุมัติ',
      'กรอกบัญชีของผู้เบิก หลังบันทึกคุณจะเห็นเฉพาะ 4 ตัวท้าย', 'บันทึกเป็นบัญชีประจำของผู้เบิก']) assert.ok(texts.includes(text), text);
    assert.ok(!texts.some((text) => text.includes('ของฉัน')), 'nothing on an on-behalf form speaks of "my" account');
    assert.doesNotMatch(html, /payout-account/, 'and nothing links to the preparer own account page');

    const page = read('./ReimbursementCreatePage.tsx');
    // The preview of a default is the person's own; another member's default is never fetched into the form.
    assert.match(page, /if \(!userId \|\| requesterUserId !== userId \|\| \(editing \? !canUpdate : !canCreate\)\) return;/);
    assert.match(page, /forSelf=\{requesterUserId === userId\}\s+defaultAccount=\{requesterUserId === userId \? myPayoutAccount : null\}/);
    assert.match(page, /canSaveAsDefault=\{requesterUserId === userId \|\| canEditEmployees\}/);
    // Choosing another requester starts the receiving choice over.
    assert.match(page, /setRequesterUserId\(event\.target\.value\);[^\n]*setPayout\(emptyClaimPayoutForm\(\)\);/);
    assert.equal(page.match(/\.\.\.\(payoutInput && \{ payout: payoutInput \}\)/g)?.length, 2, 'create and update both carry the choice');
  });

  it('keeps an existing draft account unless a new one is typed', () => {
    const existing = section({ current: { ...transfer, source: 'REQUESTER' }, value: { ...logic.emptyClaimPayoutForm(), mode: 'KEEP' } });
    for (const text of ['ใช้บัญชีที่ระบุไว้ในใบนี้', 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789 · นาย สมชาย ใจดี', 'ระบุบัญชีใหม่สำหรับใบนี้']) assert.ok(visible(existing).includes(text), text);
    assert.ok(!visible(section({ current: { followsDefault: true, ...transfer } })).includes('ใช้บัญชีที่ระบุไว้ในใบนี้'));
  });
});

describe('the approver attests the account version shown before approving a transfer claim', () => {
  it('renders the attestation with a full-size touch target', () => {
    const html = render(h(ui.PayoutAttestationCheck, { checked: false, onChange: noop }));
    assert.deepEqual(visible(html), ['ฉันตรวจแล้วว่าบัญชีนี้เป็นบัญชีรับเงินของผู้เบิก', 'ดูชื่อบัญชี เลขบัญชี และธนาคารในการ์ดการรับเงินคืนด้านบน ระบบบันทึกชื่อคุณและเวลาที่ตรวจ']);
    assert.match(html, /<label class="flex min-h-11 [^"]*"><input type="checkbox" class="[^"]*h-5 w-5[^"]*"/);
    assert.doesNotMatch(html, /checked=""/);
  });

  it('binds the tick to one version, blocks approve until then, and sends that version', () => {
    const page = read('./ReimbursementJourneyPage.tsx');
    assert.match(page, /const \[attestedVersion, setAttestedVersion\] = useState<number \| null>\(null\);/);
    assert.match(page, /const needsAttestation = Boolean\(step\?\.actions\.includes\('approve'\)\) && claimNeedsPayoutAttestation\(detail\);/);
    // A claim sent again with another account version is no longer ticked.
    assert.match(page, /const attested = needsAttestation && attestedVersion === detail\.payout\?\.version;/);
    assert.match(page, /onChange=\{\(checked\) => setAttestedVersion\(checked \? detail\.payout\?\.version \?\? null : null\)\}/);
    assert.match(page, /action === 'approve' && needsAttestation && !attested \? PAYOUT_ATTESTATION_REQUIRED/);
    assert.match(page, /disabled=\{busyAction !== null \|\| previewLoadingKey !== null \|\| Boolean\(blockedReason\)\}/);
    // Also after a stale-approval review: the version ticked must be the version about to be approved.
    assert.match(page, /if \(claimNeedsPayoutAttestation\(target\) && verified !== target\.payout\?\.version\) \{/);
    assert.match(page, /approveReimbursement\(companyId, requestId, undefined, target\.approvalSnapshotHash, verified \?\? undefined\)/);
    assert.match(read('./reimbursements.api.ts'), /JSON\.stringify\(\{ comment, approvalSnapshotHash, payoutVerifiedVersion \}\)/);
    // The card sits above the step card, so the account is read before the tick.
    assert.ok(page.indexOf('<ClaimPayoutCard') > 0 && page.indexOf('<ClaimPayoutCard') < page.indexOf('<PayoutAttestationCheck'));
    // A draft that cannot be sent yet says why on the submit button.
    assert.match(page, /const readiness = receiptReadiness\.blocked \|\| !payoutBlock \? receiptReadiness : \{ blocked: true, message: payoutBlock \};/);
  });

  it('sends a transfer claim to its own page instead of approving it from the queue', () => {
    const hub = read('./ReimbursementsPages.tsx');
    assert.match(hub, /if \(r\.payoutMethod === 'BANK_TRANSFER'\) \{ onOpenDetail\(r\.id\); return; \}/);
    assert.equal(hub.match(/\{r\.payoutMethod === 'BANK_TRANSFER' \? 'ตรวจบัญชีและอนุมัติ' : 'อนุมัติ'\}/g)?.length, 2, 'table row and phone card');
    assert.match(hub, /href=\{`\/companies\/\$\{companyId\}\/reimbursements\/payout-account`\}[^\n]*>บัญชีรับเงินคืนของฉัน<\/Link>/);
  });
});

describe('a claim is sent with the account its page showed', () => {
  it('sends back the token of the claim on the page with "ส่งอนุมัติ"', () => {
    assert.match(read('./ReimbursementJourneyPage.tsx'), /submitReimbursement\(companyId, requestId, detail\.payout\?\.submitToken\)/);
    assert.match(read('./reimbursements.api.ts'), /\/submit`, \{ method: 'POST', body: JSON\.stringify\(\{ payoutSubmitToken \}\) \}/);
    // The card with the account sits above the step card that holds the button.
    const page = read('./ReimbursementJourneyPage.tsx');
    assert.ok(page.indexOf('<ClaimPayoutCard') < page.indexOf('cardActions.map(actionButton)'));
  });

  it('sends a draft that follows the default from its own page, never from a list row', () => {
    // A list row carries no account, so there is nothing on it to have been shown.
    for (const row of [{}, { payoutMethod: undefined }, { payoutMethod: null }, { payoutMethod: '' }]) assert.equal(logic.draftRowSubmitsFromItsPage(row), true);
    for (const payoutMethod of ['CASH', 'BANK_TRANSFER']) assert.equal(logic.draftRowSubmitsFromItsPage({ payoutMethod }), false, payoutMethod);
    const hub = read('./ReimbursementsPages.tsx');
    assert.match(hub, /const submitRow = \(r: any\) => \(draftRowSubmitsFromItsPage\(r\)\s+\? onOpenDetail\(r\.id\)\s+: void action\(r\.id, \(\) => submitReimbursement\(companyId, r\.id\), 'ส่งขออนุมัติเรียบร้อยแล้ว'\)\);/);
    assert.equal(hub.match(/\{draftRowSubmitsFromItsPage\(r\) \? 'ตรวจบัญชีและส่งอนุมัติ' : 'ส่งอนุมัติ'\}/g)?.length, 2, 'table row and phone card');
    assert.equal(hub.match(/submitReimbursement\(/g)?.length, 1, 'no other list path submits');
  });
});

describe('the stale-approval dialog names an account change and never approves an account nobody ticked', () => {
  const scb = { ...transfer, bankName: 'ธนาคารไทยพาณิชย์', accountLast4: '9012', version: 2 };
  const payoutRow = (before: object, after: object) => diffApprovalFields(approvalComparable(before, 1), approvalComparable(after, 1)).find((row) => row.key === 'payout');

  it('compares where the money goes back to, masked', () => {
    assert.equal(logic.payoutComparableText({ payout: transfer }), 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789 · นาย สมชาย ใจดี');
    assert.equal(logic.payoutComparableText({ payout: { payoutMethod: 'CASH' } }), 'รับเป็นเงินสด');
    assert.equal(logic.payoutComparableText({ payoutMethod: 'CASH' }), 'รับเป็นเงินสด');
    assert.equal(logic.payoutComparableText({ payoutMethod: 'A_METHOD_ADDED_LATER' }), 'วิธีอื่น');
    for (const none of [{}, null, undefined, { payout: null }]) assert.equal(logic.payoutComparableText(none), '');

    // On the claim page both sides are details: an account changed while the page was open is named.
    assert.deepEqual(payoutRow(claim(), claim({ payout: scb })), {
      key: 'payout', label: 'รับเงินคืนทาง', changed: true,
      before: 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789 · นาย สมชาย ใจดี', after: 'ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 9012 · นาย สมชาย ใจดี',
    });
    assert.equal(payoutRow(claim(), claim())?.changed, false);
    // In the queue the row carries the method only: a cash claim sent again as a transfer is named too.
    assert.deepEqual([payoutRow({ payoutMethod: 'CASH' }, claim({ payout: { payoutMethod: 'CASH' } }))?.changed, payoutRow({ payoutMethod: 'CASH' }, claim())?.changed], [false, true]);
    // A claim from before the field existed has nothing on either side.
    assert.deepEqual(payoutRow({}, claim({ payout: undefined })), { key: 'payout', label: 'รับเงินคืนทาง', before: '—', after: '—', changed: false });
  });

  it('shows the change in the dialog and lets the caller replace the approve button', () => {
    const diff = diffApprovalFields(approvalComparable(claim(), 1), approvalComparable(claim({ payout: scb }), 1));
    const dialog = (props: object = {}) => {
      Object.assign(globalThis, { document: { body: {} } }); // Modal's portal target; never touched by a server render
      try {
        return visible(render(h(StaleApprovalDialog, { requestNo: 'RB-202610-00001', diff, lines: [], currency: 'THB', busy: false, error: null, onClose: noop, onConfirm: noop, ...props })));
      } finally { Reflect.deleteProperty(globalThis, 'document'); }
    };
    for (const text of ['รับเงินคืนทาง', 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789 · นาย สมชาย ใจดี', 'ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 9012 · นาย สมชาย ใจดี', 'อนุมัติด้วยข้อมูลล่าสุด']) {
      assert.ok(dialog().includes(text), text);
    }
    const guarded = dialog({ confirmLabel: 'ปิดเพื่อตรวจบัญชีรับเงิน' });
    assert.ok(guarded.includes('ปิดเพื่อตรวจบัญชีรับเงิน') && !guarded.includes('อนุมัติด้วยข้อมูลล่าสุด'));
  });

  it('approves from the dialog only an account version the approver ticked; otherwise sends them to the account', () => {
    const page = read('./ReimbursementJourneyPage.tsx');
    assert.match(page, /const staleReviewNeedsAttestation = !!staleReview && claimNeedsPayoutAttestation\(staleReview\.detail\)\s+&& attestedVersion !== staleReview\.detail\.payout\?\.version;/);
    assert.match(page, /\{\.\.\.\(staleReviewNeedsAttestation && \{ confirmLabel: 'ปิดเพื่อตรวจบัญชีรับเงิน' \}\)\}/);
    assert.match(page, /onConfirm=\{\(\) => \(staleReviewNeedsAttestation \? setStaleReview\(null\) : void approve\(\{ detail: staleReview\.detail \}\)\)\}/);
    // When the ticked version is still the claim's version, the confirm carries it with the latest hash.
    assert.match(page, /const verified = claimNeedsPayoutAttestation\(target\) \? attestedVersion : null;/);

    const hub = read('./ReimbursementsPages.tsx');
    // The queue row sends the hash it showed; a claim that is a transfer by now is opened, not approved.
    assert.match(hub, /await approveReimbursement\(companyId, r\.id, undefined, r\.approvalSnapshotHash\);/);
    assert.match(hub, /\{\.\.\.\(claimNeedsPayoutAttestation\(staleReview\.detail\) && \{ confirmLabel: 'เปิดใบเพื่อตรวจบัญชีรับเงิน' \}\)\}/);
    assert.match(hub, /if \(claimNeedsPayoutAttestation\(review\.detail\)\) \{ setStaleReview\(null\); onOpenDetail\(review\.row\.id\); return; \}/);
  });
});

describe('"บัญชีรับเงินคืนของฉัน" and the employee page', () => {
  it('opens for whoever may file a claim, and says so plainly to anyone else', () => {
    const page = visible(render(h(ReimbursementPayoutAccountPage, { companyId: ids.company, canManage: true })));
    for (const text of ['บัญชีรับเงินคืนของฉัน', 'บัญชีรับเงินคืนประจำ', 'กำลังโหลดบัญชีรับเงินคืน...',
      'ตั้งครั้งเดียว ใบเบิกใหม่จะใช้บัญชีนี้เอง ใบที่ส่งไปแล้วใช้บัญชีที่บันทึกไว้กับใบนั้น ไม่เปลี่ยนตาม']) assert.ok(page.includes(text), text);
    const refused = visible(render(h(ReimbursementPayoutAccountPage, { companyId: ids.company, canManage: false })));
    for (const text of ['ยังตั้งบัญชีรับเงินคืนไม่ได้', 'บัญชีนี้ยังไม่มีสิทธิ์สร้างคำขอเบิก กรุณาติดต่อผู้ดูแลบริษัท']) assert.ok(refused.includes(text), text);
    const route = read('../../../app/(workspace)/companies/[companyId]/reimbursements/payout-account/page.tsx');
    assert.match(route, /canManage=\{\(session\?\.permissions \?\? \[\]\)\.includes\('reimbursement\.create'\)\}/);
  });

  it('lets an employee-data editor set an employee account, tells them the owner is notified, and never reveals it to them', () => {
    const screen = read('./ReimbursementPayout.tsx');
    assert.match(screen, /memberUserId \? await setMemberPayoutAccount\(companyId, memberUserId, input\) : await setMyPayoutAccount\(companyId, input\)/);
    assert.match(screen, /\{!own && <p[^>]*>หลังบันทึก คุณจะเห็นเฉพาะ 4 ตัวท้าย และเจ้าของบัญชีจะได้รับแจ้งเตือนให้ตรวจ<\/p>\}/);
    assert.match(screen, /own \? 'บันทึกบัญชีรับเงินคืนแล้ว' : 'บันทึกบัญชีรับเงินคืนแล้ว ระบบแจ้งเจ้าของบัญชีให้ตรวจ'/);
    // Only the account owner removes a default account.
    assert.match(screen, /\{own && account && <button[^>]*onClick=\{\(\) => void remove\(\)\}>ลบบัญชี<\/button>\}/);
    // Whose account an editor may set is the server's rule (a manager may not set a peer's, an admin's
    // or another branch's): the button follows the server's answer, never a guess made on the page.
    assert.match(screen, /setMayEdit\(response\.canEdit === true\)/);
    assert.match(screen, /\{canEdit && mayEdit \? \(/);
    assert.match(screen, /บัญชีนี้ตั้งหรือแก้ได้โดยเจ้าของบัญชี เจ้าของกิจการ หรือผู้ดูแลบริษัท ส่วนผู้จัดการและฝ่ายบุคคลตั้งให้ได้เฉพาะพนักงานในสาขาที่ตนดูแล/);

    const employee = read('../employee-access/AddEmployeePrototypePage.tsx');
    // The viewer's own employee page uses their own path; anyone else's goes through the employee-edit path.
    assert.match(employee, /<MemberPayoutAccountCard/);
    assert.match(employee, /canEdit=\{!branchScopeReadOnly\}/);
    // Not for a draft, invited, suspended or disabled employee: the notice the account owner is owed
    // reaches active members only, and the server refuses the save for the same reason.
    assert.match(employee, /const employeeActive = draftActivated \|\| editingEmployee\?\.status === 'ACTIVE';/);
    assert.match(employee, /\{editingEmployee && employeeActive && viewerPermissions\.includes\('reimbursement\.create'\) && \(\s+<MemberPayoutAccountCard/);
    assert.equal(employee.match(/<MemberPayoutAccountCard/g)?.length, 1, 'the one place an employee account is set');
    assert.equal(translateApiError('payout_account_member_not_active'),
      'ตั้งบัญชีรับเงินคืนแทนได้เฉพาะเมื่อเจ้าของบัญชียังใช้งานระบบอยู่ เพราะระบบต้องแจ้งเจ้าของบัญชีทุกครั้ง เปิดใช้งานสมาชิกคนนี้ก่อน หรือให้เจ้าของบัญชีตั้งเองเมื่อเข้าใช้งานได้แล้ว');
  });
});

const MACHINE_TOKENS: Array<[string, RegExp]> = [ // ReimbursementPages.plain-thai.qa.spec.ts's set
  ['cuid/uuid/hash-like id', /\b[a-z0-9]{20,}\b|[0-9a-f]{8}-[0-9a-f]{4}-/iu], ['enum or code', /[A-Z_]{4,}/u],
  ['field path', /\w+\.\d+\.\w+|\b[a-zA-Z]\w*\.(?:\d|[a-z]\w*\b)/u], ['camelCase key', /\b[a-z]+[A-Z]\w*\b/u], ['snake_case code', /\b[a-z]+_[a-z_]+\b/u],
  ['ISO date', /\d{4}-\d{2}-\d{2}/u], ['3+ decimal amount', /\d\.\d{3,}/u], ['category key or currency code', /\b(?:travel|meals|supplies|accommodation|other|THB)\b/u],
  ['raw JSON', /[{}[\]"]/u],
];

describe('payout screens speak plain Thai and fit a 390 px phone', () => {
  const verified = { ...transfer, verifiedByUserId: ids.approver, verifiedByName: 'สมศรี', verifiedAt: '2026-10-01T03:00:00.000Z', canRevealAccountNumber: true };
  const screens: Array<[string, string]> = [
    ['claim card: transfer, may reveal', card(claim({ payout: verified }))],
    ['claim card: self-attested', card(claim({ payout: { ...verified, verifiedByUserId: ids.requester } }), ids.requester)],
    ['claim card: typed by a preparer', card(claim({ payout: { ...transfer, source: 'PREPARER', enteredByName: 'วิภา' } }))],
    ['claim card: PromptPay', card(claim({ payout: { payoutMethod: 'BANK_TRANSFER', payoutKind: 'PROMPTPAY_PHONE', accountName: 'นาย สมชาย ใจดี', accountLast4: '5678', version: 2 } }))],
    ['claim card: cash', card(claim({ payout: { payoutMethod: 'CASH' } }))],
    ['claim card: legacy', card(claim({ payout: undefined }))],
    ['claim card: a method the API may add later', card(claim({ payout: { payoutMethod: 'A_METHOD_ADDED_LATER', accountLast4: '6789' } }))],
    ['claim card: draft following the default', card(claim({ status: 'DRAFT', payout: { followsDefault: true, ...transfer, enteredByName: 'วิภา' } }), ids.requester)],
    ['claim card: draft with nothing chosen', card(claim({ status: 'DRAFT', payout: { followsDefault: true, notReadyReason: 'payout_method_required' } }), ids.requester, '/edit')],
    ['claim card: draft account missing', card(claim({ status: 'DRAFT', payout: { payoutMethod: 'BANK_TRANSFER', notReadyReason: 'payout_destination_required' } }), ids.requester, '/edit')],
    ['form section: own, no default', section()],
    ['form section: own, typing', section({ value: { mode: 'SPECIFIED', account: form({ bankChoice: logic.OTHER_BANK }), saveAsDefault: true } })],
    ['form section: on behalf', section({ forSelf: false, value: { mode: 'SPECIFIED', account: form({ payoutKind: 'PROMPTPAY_PHONE' }), saveAsDefault: false } })],
    ['form section: existing draft account', section({ current: { ...transfer, source: 'REQUESTER' }, value: { ...logic.emptyClaimPayoutForm(), mode: 'KEEP' } })],
    ['attestation', render(h(ui.PayoutAttestationCheck, { checked: true, onChange: noop }))],
    ['my account page', render(h(ReimbursementPayoutAccountPage, { companyId: ids.company, canManage: true }))],
    ['my account page: no permission', render(h(ReimbursementPayoutAccountPage, { companyId: ids.company, canManage: false }))],
  ];
  // Texts that never pass through a render here: validation, the submit block and the server's refusals.
  const messages = [
    logic.LEGACY_PAYOUT_NOTE, logic.PAYOUT_ATTESTATION_TEXT, logic.PAYOUT_ATTESTATION_REQUIRED, ...Object.values(logic.PAYOUT_METHOD_TEXT), ...Object.values(logic.PAYOUT_KIND_TEXT),
    ...[{ bankChoice: '' }, { bankChoice: logic.OTHER_BANK }, { accountName: '' }, { accountNumber: '' }, { payoutKind: 'PROMPTPAY_PHONE' as const, accountNumber: '1' }]
      .map((overrides) => logic.payoutAccountFormError(form(overrides))!.text),
    logic.claimPayoutSubmitBlock({ status: 'DRAFT', payout: { followsDefault: true, notReadyReason: 'payout_method_required' } })!,
    ...['payout_method_required', 'payout_destination_required', 'payout_destination_invalid', 'payout_verification_required', 'payout_destination_changed',
      'payout_reveal_denied', 'payout_account_not_set', 'payout_account_edit_denied', 'payout_member_not_found', 'payout_account_member_not_active'].map((code) => translateApiError(code) ?? code),
  ];

  it('carries no machine token in any state, including a method the API may add later', () => {
    let checked = 0;
    for (const [screen, html] of [...screens, ...messages.map((message): [string, string] => ['message', message])]) {
      for (const raw of visible(html)) {
        for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(raw, pattern, `${name} on ${screen}: ${raw}`);
        checked += 1;
      }
    }
    assert.ok(checked > 150, `only ${checked} texts checked`);
    // Every refusal the server can give has its own Thai sentence, not the code.
    assert.equal(new Set(messages).size, messages.length);
  });

  it('stacks on a phone: full-width 44 px controls, one column, long names wrap', () => {
    for (const [screen, html] of screens) {
      for (const [control] of html.matchAll(/<(?:button|a)\b[^>]*>/g)) {
        // The page header's back link is the shared page chrome, as on every other claim page.
        if (!control.includes('class="')) continue;
        if (/class="[^"]*underline/.test(control)) { assert.match(control, /min-h-11/, `${screen}: ${control}`); continue; }
        assert.match(control, /min-h-11 w-full sm:w-auto/, `${screen}: ${control}`);
      }
      for (const [grid] of html.matchAll(/class="[^"]*\bgrid-cols-\d[^"]*"/g)) {
        // Two columns on a phone only for the short name pair; every form grid is one column until sm.
        assert.match(grid, /sm:grid-cols-2|grid grid-cols-2 gap-3/, `${screen}: ${grid}`);
      }
      assert.doesNotMatch(html, /\bw-\[\d+px\]|min-w-\[\d+px\]|whitespace-nowrap/, `${screen}: a fixed width or an unbreakable line`);
    }
    const cardHtml = screens[0]![1];
    assert.match(cardHtml, /class="[^"]*\[overflow-wrap:anywhere\][^"]*"/);
    // Requester name and account name sit side by side so a person can compare them, and both wrap.
    assert.match(cardHtml, /<dl class="grid grid-cols-2 gap-3"><div class="min-w-0">[\s\S]*?break-words[\s\S]*?<div class="min-w-0">[\s\S]*?break-words/);
    assert.match(read('./ReimbursementPayout.tsx'), /break-all font-mono text-lg[^"]*" data-testid="payout-account-number"/);
    for (const [radio] of screens[10]![1].matchAll(/<label class="[^"]*"><input type="radio"/g)) assert.match(radio, /min-h-11/);
  });
});
