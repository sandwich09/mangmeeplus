// Pure helpers for the payout account screens. The format rule itself is the shared one in
// contracts (the API runs the same function); this file only turns it into Thai and into payloads.

import {
  invalidPayoutDestinationField,
  maskedPayoutAccount,
  reimbursementPaymentRule,
  THAI_BANK_NAMES,
  type MemberPayoutAccountSummary,
  type PayoutDestinationField,
  type PayoutDestinationInput,
  type ReimbursementLegacyPayoutDefault,
  type ReimbursementPaymentDestinationSummary,
  type ReimbursementPaymentRule,
  type ReimbursementPayoutInput,
  type ReimbursementPayoutMethod,
  type ReimbursementPayoutSummary,
  type ReimbursementPayoutVersionSummary,
  type SetMemberPayoutAccountInput,
} from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
// The correction round of payout spec §14 (its own imports, apart from the blocks above).
import {
  isReimbursementPayoutCorrectionReason, looksLikeAccountNumber, REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH,
  REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS,
  type ReimbursementPayoutCorrectionAccount, type ReimbursementPayoutCorrectionReason,
  type RequestReimbursementPayoutCorrectionInput, type SubmitReimbursementPayoutCorrectionInput,
} from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';

export const PAYOUT_METHOD_TEXT: Record<string, string> = { BANK_TRANSFER: 'โอนเข้าบัญชี', CASH: 'รับเป็นเงินสด' };
export const PAYOUT_KIND_TEXT: Record<string, string> = { BANK_ACCOUNT: 'บัญชีธนาคาร', PROMPTPAY_PHONE: 'พร้อมเพย์ (เบอร์มือถือ)' };

/** A claim sent before claims carried a receiving method (payout spec §15). One sentence, wherever such a claim is shown. */
export const LEGACY_PAYOUT_NOTE = 'ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ';
/** What a legacy claim's payer is shown instead: the requester's default as it is now. */
export const LEGACY_DEFAULT_LABEL = 'บัญชีประจำปัจจุบันของผู้เบิก (ยังไม่ผ่านการอนุมัติในใบนี้)';
/** A legacy claim whose requester has no account to transfer into. */
export const LEGACY_ASK_REQUESTER_NOTE = 'สอบถามบัญชีจากผู้เบิกโดยตรง';
/** A transfer recorded with no account confirmed: a legacy claim paid elsewhere, or a claim that asked for cash. */
export const PAYMENT_NO_CLAIM_ACCOUNT = 'ไม่มีบัญชีรับเงินในใบเบิก';
/** The payer's confirmation, spec §12.3. */
export const PAYER_CONFIRMATION_TEXT = 'โอนเข้าบัญชีนี้แล้ว และชื่อผู้รับที่ธนาคารแสดงตรงกับใบเบิก';
export const PAYER_CONFIRMATION_REQUIRED = 'ติ๊กยืนยันว่าโอนเข้าบัญชีนี้แล้ว และชื่อผู้รับที่ธนาคารแสดงตรงกับใบเบิก ก่อนกดบันทึกจ่าย';
/** Spec §10.2: nobody but the requester has checked the account, so the payer is told they are the one checking. */
export const PAYER_IS_VERIFIER_NOTE = 'ยังไม่มีผู้ตรวจบัญชีนี้ คุณเป็นผู้ตรวจ';
/** The mark on a payment recorded by another method than the requester asked for (spec §12.4, §17.2). */
export const PAID_DIFFERENTLY_LABEL = 'จ่ายต่างจากที่ผู้เบิกขอ';
export const MISMATCH_REASON_REQUIRED = 'วิธีจ่ายต่างจากที่ผู้เบิกขอ กรุณาระบุเหตุผล';
export const MISMATCH_REASON_HAS_ACCOUNT_NUMBER = 'อย่าพิมพ์เลขบัญชีในช่องเหตุผล เพราะเหตุผลนี้แสดงในประวัติการจ่ายให้ทุกคนที่เปิดใบเบิกเห็น';
/** Spec §10.2: a requester who approved their own claim gave their own word for the account. It is never called a check. */
export const REQUESTER_SELF_ATTESTED = 'ผู้เบิกยืนยันบัญชีของตนเอง';
export const PAYOUT_ATTESTATION_TEXT = 'ฉันตรวจแล้วว่าบัญชีนี้เป็นบัญชีรับเงินของผู้เบิก';
export const PAYOUT_ATTESTATION_REQUIRED = 'ติ๊กยืนยันว่าตรวจบัญชีรับเงินแล้วก่อนอนุมัติ';

/** The bank picker's "not in the list" choice; the name is then typed. */
export const OTHER_BANK = 'other';

export type PayoutAccountForm = {
  payoutKind: 'BANK_ACCOUNT' | 'PROMPTPAY_PHONE';
  bankChoice: string;
  bankOther: string;
  accountName: string;
  accountNumber: string;
};

export function emptyPayoutAccountForm(): PayoutAccountForm {
  return { payoutKind: 'BANK_ACCOUNT', bankChoice: '', bankOther: '', accountName: '', accountNumber: '' };
}

/** The account as typed, in the one inbound shape that carries a full number. */
export function payoutDestinationInput(form: PayoutAccountForm): PayoutDestinationInput {
  return {
    payoutKind: form.payoutKind,
    ...(form.payoutKind === 'BANK_ACCOUNT' && { bankName: (form.bankChoice === OTHER_BANK ? form.bankOther : form.bankChoice).trim() }),
    accountName: form.accountName.trim(),
    accountNumber: form.accountNumber,
  };
}

const FIELD_MESSAGES: Record<PayoutDestinationField, (form: PayoutAccountForm) => string> = {
  payoutKind: () => 'กรุณาเลือกประเภทบัญชี',
  bankName: (form) => (form.bankChoice === OTHER_BANK ? 'กรุณาระบุชื่อธนาคาร ไม่เกิน 80 ตัวอักษร และไม่ใส่เลขบัญชีในช่องนี้' : 'กรุณาเลือกธนาคาร'),
  accountName: () => 'กรุณาระบุชื่อบัญชีตามที่ธนาคารแสดง 2 ถึง 140 ตัวอักษร ไม่ใช่ตัวเลขล้วน และไม่ใส่เลขบัญชีในช่องนี้',
  accountNumber: (form) => (form.payoutKind === 'PROMPTPAY_PHONE'
    ? 'เบอร์พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0'
    : 'เลขบัญชีต้องเป็นตัวเลข 6 ถึง 20 หลัก'),
};

/** The first problem with the typed account, in Thai, or null. Same rule as the server. */
export function payoutAccountFormError(form: PayoutAccountForm): { field: PayoutDestinationField; text: string } | null {
  const field = invalidPayoutDestinationField(payoutDestinationInput(form));
  return field ? { field, text: FIELD_MESSAGES[field](form) } : null;
}

export function memberPayoutAccountInput(method: 'BANK_TRANSFER' | 'CASH', form: PayoutAccountForm): SetMemberPayoutAccountInput {
  return method === 'CASH' ? { payoutMethod: 'CASH' } : { payoutMethod: 'BANK_TRANSFER', ...payoutDestinationInput(form) };
}

// ---- The receiving choice on the claim form ----

/** KEEP: an existing draft's account for this claim is left as it is (its number cannot be shown again to retype). */
export type ClaimPayoutMode = 'DEFAULT' | 'CASH' | 'SPECIFIED' | 'KEEP';
export type ClaimPayoutForm = { mode: ClaimPayoutMode; account: PayoutAccountForm; saveAsDefault: boolean };

export function emptyClaimPayoutForm(): ClaimPayoutForm {
  return { mode: 'DEFAULT', account: emptyPayoutAccountForm(), saveAsDefault: false };
}

/** Where an existing draft stands: following the default, cash, or its own account (kept until changed). */
export function claimPayoutFormOf(payout?: ReimbursementPayoutSummary | null): ClaimPayoutForm {
  const mode: ClaimPayoutMode = !payout || payout.followsDefault ? 'DEFAULT' : payout.payoutMethod === 'CASH' ? 'CASH' : 'KEEP';
  return { ...emptyClaimPayoutForm(), mode };
}

export function claimPayoutFormError(form: ClaimPayoutForm): string | null {
  return form.mode === 'SPECIFIED' ? payoutAccountFormError(form.account)?.text ?? null : null;
}

/**
 * The form after a receiving choice is picked. "บันทึกเป็นบัญชีประจำ" starts ticked for a requester
 * with no default yet, so their next claim needs no typing — but only where that save is allowed.
 */
export function chooseClaimPayoutMode(
  form: ClaimPayoutForm,
  mode: ClaimPayoutMode,
  offer: { canSaveAsDefault: boolean; forSelf: boolean; hasNoDefault: boolean },
): ClaimPayoutForm {
  return {
    ...form, mode,
    saveAsDefault: mode === 'SPECIFIED' && form.mode !== 'SPECIFIED' ? offer.canSaveAsDefault && offer.forSelf && offer.hasNoDefault : form.saveAsDefault,
  };
}

/**
 * The `payout` field of a create or update call; undefined leaves the draft's choice untouched.
 * `canSaveAsDefault` is the server's answer for this viewer and this requester: a tick the page did
 * not offer (or no longer offers) is never sent, so the save is not refused for it.
 */
export function claimPayoutInput(form: ClaimPayoutForm, canSaveAsDefault = true): ReimbursementPayoutInput | undefined {
  if (form.mode === 'KEEP') return undefined;
  if (form.mode !== 'SPECIFIED') return { mode: form.mode };
  return { mode: 'SPECIFIED', ...payoutDestinationInput(form.account), ...(form.saveAsDefault && canSaveAsDefault && { saveAsDefault: true }) };
}

// ---- Display ----

/** One line for an account, masked: the same words the notification and the printed form use. */
export function payoutAccountLine(account?: Partial<Pick<MemberPayoutAccountSummary, 'payoutMethod' | 'payoutKind' | 'bankName' | 'accountLast4'>> | null): string {
  if (!account?.payoutMethod) return 'ยังไม่ได้ตั้ง';
  return account.payoutMethod === 'CASH' ? PAYOUT_METHOD_TEXT.CASH! : maskedPayoutAccount(account);
}

/** "ตั้งโดย … เมื่อ …": shown until the account owner saves the account themselves. */
export function setByOtherLine(account: Pick<MemberPayoutAccountSummary, 'setByOtherName' | 'updatedAt'>): string | null {
  return account.setByOtherName ? `ตั้งโดย ${account.setByOtherName} เมื่อ ${formatThaiDateTime(account.updatedAt)}` : null;
}

/**
 * The full number on screen: only the one revealed for exactly this account (this claim and account
 * version, or this default as last saved), and only while the viewer may reveal it. Anything else
 * shows nothing, from the first render on.
 */
export function shownAccountNumber(revealed: { revealKey: string; accountNumber: string } | null, revealKey: string, canReveal: boolean): string | null {
  return canReveal && revealed?.revealKey === revealKey ? revealed.accountNumber : null;
}

/**
 * Whether a number the API answered with belongs on the card that asked for it: it must end with the
 * last 4 digits that card shows. The API answers with the account as it is now, so a page loaded
 * before the account changed would otherwise put the new number under the old bank and name.
 */
export function revealedNumberMatchesCard(accountNumber: string, last4?: string | null): boolean {
  return !last4 || accountNumber.endsWith(last4);
}

export type ClaimPayoutView = {
  /**
   * legacy: sent before claims carried a receiving method, so no account is in the system;
   * missing: a draft that cannot be sent yet; unknown: a draft whose payout was not loaded.
   */
  state: 'legacy' | 'missing' | 'cash' | 'transfer' | 'unknown';
  /** The masked account line, or the sentence that stands in for it. */
  line: string;
  /** Small print under the line: where the account comes from and who attested it. */
  notes: string[];
};

/**
 * What the claim page says about where the money goes back to. Everything here is masked; the full
 * number is only ever fetched by the reveal button, which the page offers when `canRevealAccountNumber`.
 */
export function claimPayoutView(detail: { status?: string; requesterUserId?: string; payout?: ReimbursementPayoutSummary | null }): ClaimPayoutView {
  const payout = detail.payout;
  const draft = detail.status === 'DRAFT';
  // Only the detail read carries a draft's payout; an action response without it says nothing either way.
  if (!payout) return draft ? { state: 'unknown', line: '', notes: [] } : { state: 'legacy', line: LEGACY_PAYOUT_NOTE, notes: [] };
  if (payout.notReadyReason || !payout.payoutMethod) {
    return {
      state: 'missing',
      line: payout.notReadyReason === 'payout_destination_required' ? 'ยังไม่ได้ระบุบัญชีรับเงินคืน' : 'ยังไม่ได้เลือกวิธีรับเงินคืน',
      notes: payout.followsDefault ? ['ผู้เบิกยังไม่ได้ตั้งบัญชีรับเงินคืนประจำ เลือกรับเป็นเงินสด ระบุบัญชีสำหรับใบนี้ หรือตั้งบัญชีประจำก่อนส่งอนุมัติ'] : [],
    };
  }
  const notes: string[] = [];
  // Someone other than the requester typed or set the account. It is said also when their name is
  // no longer known (they left the company): silence would read as "the requester entered it".
  const enteredByOther = payout.enteredByName || payout.enteredByUserId;
  if (payout.followsDefault) {
    notes.push('ตามบัญชีรับเงินคืนประจำของผู้เบิก ใบนี้จะส่งด้วยบัญชีที่แสดงอยู่นี้ ถ้าบัญชีประจำถูกแก้ก่อนกดส่ง ระบบจะให้ตรวจบัญชีใหม่');
    if (enteredByOther) notes.push(`บัญชีประจำนี้ตั้งโดย${payout.enteredByName ? ` ${payout.enteredByName}` : 'ผู้อื่น'}`);
  } else {
    if (draft && payout.payoutMethod === 'BANK_TRANSFER') notes.push('บัญชีที่ระบุสำหรับใบนี้');
    // Spec §17.2: a sent claim always says where its account came from. A draft says it when someone else typed it.
    const source = !draft || enteredByOther ? payoutSourceText(payout) : null;
    if (source) notes.push(source);
  }
  if (payout.payoutMethod === 'CASH') return { state: 'cash', line: PAYOUT_METHOD_TEXT.CASH!, notes };
  if (!draft) notes.push(payoutAttestationText(payout, detail.requesterUserId) ?? 'ยังไม่มีผู้ตรวจบัญชีนี้');
  return { state: 'transfer', line: maskedPayoutAccount(payout), notes };
}

type PayoutAccountOrigin = Pick<ReimbursementPayoutSummary, 'source' | 'enteredByUserId' | 'enteredByName' | 'verifiedByUserId' | 'verifiedByName' | 'verifiedAt'>;

/**
 * Where a sent claim's account came from, in one phrase (spec §17.2): a copy of the requester's default
 * account, typed by the requester for this claim, or typed by whoever prepared the claim for them.
 * Null when nothing says (cash has no account, and so no origin).
 */
export function payoutSourceText(account: PayoutAccountOrigin): string | null {
  const other = account.enteredByName || account.enteredByUserId;
  // A copy of the default that someone else set: the approver reads who set that default before attesting.
  if (account.source === 'DEFAULT_ACCOUNT') return `ใช้บัญชีประจำของผู้เบิก${other ? ` ซึ่งตั้งโดย${account.enteredByName ? ` ${account.enteredByName}` : 'ผู้อื่น'}` : ''}`;
  if (other) return `กรอกโดย${account.enteredByName ? ` ${account.enteredByName}` : 'ผู้จัดทำ'}`;
  return account.source === 'REQUESTER' ? 'ผู้เบิกระบุบัญชีนี้สำหรับใบนี้' : null;
}

/** Who attested an account and when: an approver or a payer by name, the requester for their own account. Null when nobody has. */
export function payoutAttestationText(account: PayoutAccountOrigin, requesterUserId?: string): string | null {
  if (!account.verifiedAt) return null;
  return account.verifiedByUserId && account.verifiedByUserId === requesterUserId
    ? `${REQUESTER_SELF_ATTESTED} เมื่อ ${formatThaiDateTime(account.verifiedAt)}`
    : `ตรวจบัญชีแล้วโดย ${account.verifiedByName ?? 'ผู้อนุมัติ'} เมื่อ ${formatThaiDateTime(account.verifiedAt)}`;
}

/** One account the claim has been sent with, in the card's own words. */
export type ClaimPayoutHistoryRow = { version: number; current: boolean; line: string; notes: string[] };

/**
 * The claim's account history for the card "การรับเงินคืน" (spec §17.2): every account the claim has been
 * sent with, oldest first, masked, in the same phrases as the account above it. Empty when there is
 * nothing to tell beyond that account: the claim has only ever been sent with the one in use.
 */
export function claimPayoutHistory(detail: {
  requesterUserId?: string;
  payout?: ReimbursementPayoutSummary | null;
  payoutHistory?: readonly ReimbursementPayoutVersionSummary[] | null;
}): ClaimPayoutHistoryRow[] {
  const versions = detail.payoutHistory ?? [];
  const current = detail.payout?.version;
  if (versions.every((version) => version.version === current)) return [];
  return versions.map((version) => ({
    version: version.version,
    current: version.version === current,
    line: payoutAccountWithName(version),
    // An account no longer in use says who attested it only when someone did: "not yet" would never come true.
    notes: [`เริ่มใช้กับใบนี้เมื่อ ${formatThaiDateTime(version.frozenAt)}`, payoutSourceText(version), payoutAttestationText(version, detail.requesterUserId)]
      .filter((note): note is string => !!note),
  }));
}

/**
 * Payout spec §22: the requester changed their default account after sending the claim. The claim
 * keeps the account it was sent with; this says so, and how to change it while that is still theirs
 * to do (taking the claim back to a draft and sending it again). Null when the server said nothing.
 */
export function payoutDefaultChangedHint(detail: { payout?: ReimbursementPayoutSummary | null }, canWithdraw: boolean): string | null {
  if (detail.payout?.defaultAccountChanged !== true) return null;
  return `บัญชีรับเงินคืนประจำของคุณเปลี่ยนแล้ว แต่ใบนี้ยังใช้บัญชีที่แสดงอยู่นี้ ซึ่งเป็นบัญชีตอนส่งอนุมัติ ${canWithdraw
    ? 'ถ้าต้องการให้ใบนี้ใช้บัญชีใหม่ กดปุ่มแก้ไข (เปิดกลับเป็นร่าง) ในขั้นอนุมัติ แล้วส่งอนุมัติอีกครั้ง'
    : 'ตอนนี้คุณเปิดใบนี้กลับเป็นร่างเองไม่ได้แล้ว ถ้าต้องการเปลี่ยนบัญชี แจ้งผู้อนุมัติหรือผู้จ่ายเงินก่อนมีการโอน'}`;
}

/**
 * The receiving method and account in the words the stale-approval dialog compares: a detail's masked
 * account with its account name, or a queue row's method. Empty for a claim with no payout.
 */
export function payoutComparableText(claim: { payout?: ReimbursementPayoutSummary | null; payoutMethod?: string | null } | null | undefined): string {
  const payout = claim?.payout;
  if (payout?.payoutMethod === 'BANK_TRANSFER' && payout.accountLast4) {
    return `${maskedPayoutAccount(payout)}${payout.accountName ? ` · ${payout.accountName}` : ''}`;
  }
  const method = payout?.payoutMethod ?? claim?.payoutMethod;
  return method ? PAYOUT_METHOD_TEXT[method] ?? 'วิธีอื่น' : '';
}

/**
 * A draft row in a list carries no account. Any draft that may be paid into one — it follows the
 * requester's default (no method of its own), or an account was typed into it — is sent from its own
 * page, where the account that will be frozen is shown first. Only cash the draft itself chose is
 * sent from the row: the server asks for the page's token in every other case.
 */
export function draftRowSubmitsFromItsPage(row: { payoutMethod?: string | null }): boolean {
  return row.payoutMethod !== 'CASH';
}

/** Why "ส่งอนุมัติ" is not offered yet, as far as the payout goes; null when the payout is ready. */
export function claimPayoutSubmitBlock(detail: { status?: string; payout?: ReimbursementPayoutSummary | null }): string | null {
  if (detail.status !== 'DRAFT') return null;
  const view = claimPayoutView(detail);
  return view.state === 'missing' ? `${view.line} เลือกวิธีรับเงินคืนก่อนส่งอนุมัติ` : null;
}

/** An approver must attest the account of a claim paid by transfer; cash and legacy claims have none. */
export function claimNeedsPayoutAttestation(detail: { payout?: ReimbursementPayoutSummary | null }): boolean {
  return detail.payout?.payoutMethod === 'BANK_TRANSFER';
}

// ---- The payment step (payout spec §12.1 to §12.4, §15) ----

type PayStepClaim = {
  requesterUserId?: string;
  payout?: ReimbursementPayoutSummary | null;
  legacyPayoutDefault?: ReimbursementLegacyPayoutDefault | null;
};

/** What the claim's requester asked for, as `reimbursementPaymentRule` takes it. Null: a legacy claim, which asked for nothing. */
export function requestedPayout(detail: PayStepClaim | null | undefined): { payoutMethod: ReimbursementPayoutMethod; hasAccount: boolean } | null {
  const payout = detail?.payout;
  return payout?.payoutMethod ? { payoutMethod: payout.payoutMethod, hasAccount: payout.payoutMethod === 'BANK_TRANSFER' && payout.version != null } : null;
}

/** An account in one line with its holder: the shared masked wording, then the account name. */
export function payoutAccountWithName(account: Parameters<typeof maskedPayoutAccount>[0] & { accountName?: string | null }): string {
  return `${maskedPayoutAccount(account)}${account.accountName ? ` · ชื่อบัญชี ${account.accountName}` : ''}`;
}

/** The account a payer confirms a transfer into, and what the tick is worth. */
export type PaymentFormConfirmation = {
  /** Names exactly this account: a tick given for it is no tick for another version or another default. */
  key: string;
  /** A transfer into the claim's own account is not recorded without it; a legacy claim's payer gives it only when the money went there. */
  required: boolean;
  /** The account in words, so "บัญชีนี้" needs nothing else on the screen to be understood. */
  accountLine: string;
  note?: string;
  /** Legacy claim: the token of the default the page shows, sent back with the confirmation. */
  defaultToken?: string;
};

/** What the payment form asks about the payout, for the method chosen: the API's own rule, turned into fields. */
export type PaymentFormPayout = {
  rule: ReimbursementPaymentRule;
  /** The method the requester asked for, in the payout card's words; absent for a legacy claim. */
  requestedMethodText?: string;
  /** The claim's account version on this page. Sent with every payment, so a page loaded before the account changed is refused. */
  version?: number;
  confirmation?: PaymentFormConfirmation;
};

/**
 * The payout side of the payment form. One rule decides what is shown and what is sent
 * (`reimbursementPaymentRule`, which the API applies under the payment lock), so a field is on the
 * form exactly when the API asks for it.
 */
export function paymentFormPayout(detail: PayStepClaim | null | undefined, paymentMethod: string): PaymentFormPayout {
  const payout = detail?.payout ?? undefined;
  const requested = requestedPayout(detail);
  const rule = reimbursementPaymentRule(requested, paymentMethod);
  const legacyDefault = requested ? undefined : detail?.legacyPayoutDefault ?? undefined;
  const confirmation: PaymentFormConfirmation | undefined = rule.payoutConfirmation === 'required' && payout
    ? {
      key: `version:${payout.version}`, required: true, accountLine: payoutAccountWithName(payout),
      // Nobody attested the account, or only the requester did: this confirmation is its check.
      ...((!payout.verifiedAt || payout.verifiedByUserId === detail?.requesterUserId) && { note: PAYER_IS_VERIFIER_NOTE }),
    }
    : rule.payoutConfirmation === 'optional' && legacyDefault
      ? {
        key: `default:${legacyDefault.confirmToken}`, required: false, accountLine: payoutAccountWithName(legacyDefault), defaultToken: legacyDefault.confirmToken,
        note: `บัญชีนี้ยังไม่ผ่านการอนุมัติในใบนี้ ติ๊กเมื่อโอนเข้าบัญชีนี้ ถ้าโอนเข้าบัญชีอื่นที่สอบถามจากผู้เบิก ไม่ต้องติ๊ก ระบบจะบันทึกว่า${PAYMENT_NO_CLAIM_ACCOUNT}`,
      }
      : undefined;
  return {
    rule,
    ...(requested && { requestedMethodText: PAYOUT_METHOD_TEXT[requested.payoutMethod] }),
    ...(payout?.version != null && { version: payout.version }),
    ...(confirmation && { confirmation }),
  };
}

/** Where a payment went, masked, as its row says it; null when no account was confirmed for it. */
export function paymentDestinationText(payment: { payoutDestination?: ReimbursementPaymentDestinationSummary | null } | null | undefined): string | null {
  return payment?.payoutDestination ? payoutAccountWithName(payment.payoutDestination) : null;
}

export const BANK_OPTIONS: readonly string[] = THAI_BANK_NAMES;

// ---- Correcting the payout account after approval (payout spec §14) ----
//
// A wrong account found after approval is fixed on the same claim: it is sent back from the pay step, its
// requester gives the account again and its approvers approve that account alone. Who may do which is the
// server's answer (`payoutCorrectionActions`, `approvalActions`); nothing here decides it.

export const PAYOUT_CORRECTION_SEND_BACK_LABEL = 'ส่งกลับให้แก้บัญชีรับเงิน';
/** The same send-back from whoever decides the round's waiting step: it is never a refusal of the claim. */
export const PAYOUT_CORRECTION_SEND_BACK_AGAIN_LABEL = 'ส่งกลับให้แก้อีกครั้ง';
export const PAYOUT_CORRECTION_FIX_LABEL = 'แก้บัญชีรับเงิน';
/** A scan declared as signed before the round (spec §14.4): it stays in the list and no longer counts. */
export const SIGNED_COPY_BEFORE_CORRECTION_LABEL = 'สำเนาก่อนแก้บัญชีรับเงิน';

/** The fixed reasons, in the order the form lists them. */
export const PAYOUT_CORRECTION_REASONS = Object.entries(REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS) as ReadonlyArray<[ReimbursementPayoutCorrectionReason, string]>;

/** A reason in words. Empty for a reason this build has no words for: a code is never printed. */
export function payoutCorrectionReasonText(reasonCode: unknown): string {
  return isReimbursementPayoutCorrectionReason(reasonCode) ? REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS[reasonCode] : '';
}

/**
 * "ส่งกลับให้แก้บัญชีรับเงินโดย … : เหตุผล" (spec §14.2, §17.2). One sentence for the step note of a claim that
 * waits for its requester, for the timeline row and for the card its approvers read, so they cannot tell it differently.
 */
export function payoutCorrectionSentBackText(sentBack: { byName?: string | null; reasonCode?: unknown } | null | undefined): string {
  const reason = payoutCorrectionReasonText(sentBack?.reasonCode);
  return `${PAYOUT_CORRECTION_SEND_BACK_LABEL}${sentBack?.byName ? `โดย ${sentBack.byName}` : ''}${reason ? ` : ${reason}` : ''}`;
}

/**
 * What the send-back form refuses before it asks the API, in the API's own words for the same refusals: a reason
 * from the list, a note of at most 500 characters, and no account number in a note every reader of the claim sees.
 */
export function payoutCorrectionRequestError(reasonCode: string, note: string): string | null {
  if (!isReimbursementPayoutCorrectionReason(reasonCode)) return translateApiError('payout_correction_reason_required');
  if (note.trim().length > REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH) return translateApiError('payout_correction_note_too_long');
  if (looksLikeAccountNumber(note)) return translateApiError('note_contains_account_number');
  return null;
}

/** The body of `POST :requestId/payout-correction`. An empty note is not sent. */
export function payoutCorrectionRequestInput(reasonCode: ReimbursementPayoutCorrectionReason, note: string): RequestReimbursementPayoutCorrectionInput {
  return { reasonCode, ...(note.trim() && { note: note.trim() }) };
}

/** What whoever sends a claim back is told before they confirm (spec §14.1, §14.4): what changes, and what is lost. */
export function payoutCorrectionSendBackNotes(detail: {
  payoutCorrectionPhase?: string | null; payout?: ReimbursementPayoutSummary | null;
  signatures?: readonly unknown[] | null; signedCopies?: readonly { acknowledgedAt?: string }[] | null;
}): string[] {
  // From the round's waiting step: the account goes back to the requester once more. Nothing is signed in a round.
  if (detail.payoutCorrectionPhase === 'AWAITING_APPROVAL') {
    return ['ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงินอีกครั้ง ใบไม่ถูกปฏิเสธ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน'];
  }
  return [
    'ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน',
    'เมื่อผู้เบิกแก้แล้ว ผู้อนุมัติชุดเดิมอนุมัติบัญชีใหม่ก่อนจึงจ่ายได้ ใบที่ไม่ต้องอนุมัติตามนโยบายจะกลับมารอจ่ายทันที',
    // A claim sent before claims carried an account gets one through this same path (spec §15).
    ...(!detail.payout ? [`${LEGACY_PAYOUT_NOTE} หลังส่งกลับ ผู้เบิกจะระบุบัญชีรับเงินของใบนี้ได้`] : []),
    ...((detail.signatures ?? []).length > 0 ? ['ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ ต้องลงนามใหม่หลังบัญชีใหม่ได้รับอนุมัติ'] : []),
    ...((detail.signedCopies ?? []).some((copy) => copy.acknowledgedAt)
      ? ['สำเนาใบเบิกที่ลงนามบนกระดาษยังเปิดดูได้ แต่จะไม่นับว่าลงนามแล้ว ต้องแนบสำเนาใหม่หลังบัญชีใหม่ได้รับอนุมัติ'] : []),
  ];
}

/** What the requester picks for a claim in a round. Nothing is picked for them: the account in question may be their default. */
export type PayoutCorrectionForm = { mode: '' | 'DEFAULT' | 'SPECIFIED' | 'CASH'; account: PayoutAccountForm; saveAsDefault: boolean };

export function emptyPayoutCorrectionForm(): PayoutCorrectionForm {
  return { mode: '', account: emptyPayoutAccountForm(), saveAsDefault: false };
}

/** Why the account form cannot be sent yet, with the field to mark; null when it can. The account rule is the API's own. */
export function payoutCorrectionFormError(form: PayoutCorrectionForm): { text: string; field?: PayoutDestinationField } | null {
  if (!form.mode) return { text: 'กรุณาเลือกวิธีรับเงินคืนของใบนี้' };
  return form.mode === 'SPECIFIED' ? payoutAccountFormError(form.account) : null;
}

/**
 * The body of `PUT :requestId/payout-destination`. "Use the default account" names the default the page showed
 * (`payoutCorrectionActions.requesterDefault.token`), so the claim never takes an account nobody was shown. A
 * tick to save as the default is sent only where the server said this viewer may (`canSaveAsDefault`).
 */
export function payoutCorrectionInput(form: PayoutCorrectionForm, defaultToken: string | undefined, canSaveAsDefault: boolean): SubmitReimbursementPayoutCorrectionInput | null {
  if (form.mode === 'CASH') return { mode: 'CASH' };
  if (form.mode === 'DEFAULT') return defaultToken ? { mode: 'DEFAULT', defaultToken } : null;
  if (form.mode !== 'SPECIFIED') return null;
  return { mode: 'SPECIFIED', ...payoutDestinationInput(form.account), ...(form.saveAsDefault && canSaveAsDefault && { saveAsDefault: true }) };
}

/** A receiving method and account of a round, masked, in one line: what the claim was approved with, or what it has now. */
export function payoutCorrectionAccountText(account: ReimbursementPayoutCorrectionAccount | ReimbursementPayoutSummary | null | undefined): string {
  // No method at all: the claim was sent before claims carried one.
  if (!account?.payoutMethod) return 'ไม่มีบัญชีในใบ';
  if (account.payoutMethod === 'CASH') return PAYOUT_METHOD_TEXT.CASH!;
  return account.accountLast4 ? payoutAccountWithName(account) : PAYOUT_METHOD_TEXT.BANK_TRANSFER!;
}

/**
 * What the card "การรับเงินคืน" says of the account it shows while the claim is in a round: in phase A that
 * account is the one in question, in phase B it is the new one and nobody has approved it yet. Null: no round.
 */
export function payoutCorrectionCardNote(detail: { payoutCorrectionPhase?: string | null; payout?: ReimbursementPayoutSummary | null }): string | null {
  if (detail.payoutCorrectionPhase === 'AWAITING_REQUESTER') {
    return detail.payout
      ? 'ใบนี้ถูกส่งกลับให้แก้บัญชีรับเงิน ด้านล่างคือวิธีรับเงินเดิมของใบ ระหว่างนี้ยังบันทึกจ่ายไม่ได้'
      : 'ใบนี้ถูกส่งกลับให้ระบุบัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้';
  }
  if (detail.payoutCorrectionPhase === 'AWAITING_APPROVAL') return 'ด้านล่างคือวิธีรับเงินใหม่ที่ผู้เบิกส่งมา รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้';
  return null;
}
