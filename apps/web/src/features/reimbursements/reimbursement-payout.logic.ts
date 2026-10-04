// Pure helpers for the payout account screens. The format rule itself is the shared one in
// contracts (the API runs the same function); this file only turns it into Thai and into payloads.

import {
  invalidPayoutDestinationField,
  reimbursementPayoutOnBehalfNotice,
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
  isReimbursementPayoutCorrectionReason, looksLikeAccountNumber, reimbursementPayoutCorrectionReasonLabel, reimbursementPayoutCorrectionReasons,
  REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH,
  type ReimbursementPayoutCorrectionAccount, type ReimbursementPayoutCorrectionReason, type ReimbursementPayoutKind,
  type RequestReimbursementPayoutCorrectionInput, type SubmitReimbursementPayoutCorrectionInput,
} from '@watchdog-bms/contracts';
// The words of a round (payout spec §14.2): the contracts' own, chosen there from what the claim holds and from what was answered.
import {
  REIMBURSEMENT_PAYOUT_ROUND_TEXTS, reimbursementPayoutHeld, reimbursementPayoutRoundAsk, reimbursementPayoutRoundCashNote, reimbursementPayoutRoundDid,
  reimbursementPayoutRoundGivenNote, reimbursementPayoutRoundSendBack,
  type ReimbursementPayoutCorrectionEvent, type ReimbursementPayoutHeld, type ReimbursementPayoutRoundAnswer,
} from '@watchdog-bms/contracts';
import { apiErrorCode, translateApiError } from '@/common/api/api-error-message';

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
/**
 * The mark on a payment recorded by another method than the claim states (spec §12.4, §17.2). Said of the claim, never of
 * "what the requester asked for": whoever prepared the claim, or answered a round for the requester, may have chosen it.
 */
export const PAID_DIFFERENTLY_LABEL = 'จ่ายต่างจากที่ระบุในใบ';
export const MISMATCH_REASON_REQUIRED = 'วิธีจ่ายต่างจากที่ระบุในใบ กรุณาระบุเหตุผล';
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
 * What the screens call the full number of an account, by its kind. A bank account has an account number; a PromptPay
 * destination is a phone number, which the entry form calls "เบอร์พร้อมเพย์" and nothing calls "เลขบัญชี". Whole labels, never
 * put together from a noun: the guide quotes them as they read. `check`: what an approver is told to look at before the
 * tick. `denied`: the API's refusal of a reveal, where the sentence of its code (`payout_reveal_denied`) names an account number.
 */
type PayoutNumberWords = Record<'show' | 'full' | 'copy' | 'copied' | 'hide' | 'check', string> & { denied?: string };
const PAYOUT_NUMBER_WORDS: Record<'BANK_ACCOUNT' | 'PROMPTPAY_PHONE', PayoutNumberWords> = {
  BANK_ACCOUNT: {
    show: 'แสดงเลขบัญชี', full: 'เลขบัญชีเต็ม', copy: 'คัดลอกเลขบัญชี', copied: 'คัดลอกเลขบัญชีแล้ว', hide: 'ซ่อนเลขบัญชี',
    check: 'ดูชื่อบัญชี เลขบัญชี และธนาคารในการ์ดการรับเงินคืนด้านบน ระบบบันทึกชื่อคุณและเวลาที่ตรวจ',
  },
  PROMPTPAY_PHONE: {
    show: 'แสดงเบอร์พร้อมเพย์', full: 'เบอร์พร้อมเพย์เต็ม', copy: 'คัดลอกเบอร์พร้อมเพย์', copied: 'คัดลอกเบอร์พร้อมเพย์แล้ว', hide: 'ซ่อนเบอร์พร้อมเพย์',
    check: 'ดูชื่อบัญชีและเบอร์พร้อมเพย์ในการ์ดการรับเงินคืนด้านบน ระบบบันทึกชื่อคุณและเวลาที่ตรวจ',
    denied: 'คุณไม่มีสิทธิ์ดูเบอร์พร้อมเพย์เต็มของใบนี้',
  },
};
export function payoutNumberWords(payoutKind?: string | null): PayoutNumberWords {
  return PAYOUT_NUMBER_WORDS[payoutKind === 'PROMPTPAY_PHONE' ? 'PROMPTPAY_PHONE' : 'BANK_ACCOUNT'];
}
/** The API refused to reveal a number: the viewer's right to it went after the page was read. */
export function isPayoutRevealDenied(e: unknown): boolean {
  return refusalIs(e, 'payout_reveal_denied');
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
export function claimPayoutView(detail: { status?: string; requesterUserId?: string; payout?: ReimbursementPayoutSummary | null } & PayoutRoundFacts): ClaimPayoutView {
  const payout = detail.payout;
  const draft = detail.status === 'DRAFT';
  // Only the detail read carries a draft's payout; an action response without it says nothing either way.
  if (!payout) return draft ? { state: 'unknown', line: '', notes: [] } : { state: 'legacy', line: LEGACY_PAYOUT_NOTE, notes: [] };
  if (payout.notReadyReason || !payout.payoutMethod) {
    return {
      state: 'missing',
      // A claim's account is "บัญชีรับเงิน" on every screen; "บัญชีรับเงินคืน" names the member's standing account.
      line: payout.notReadyReason === 'payout_destination_required' ? 'ยังไม่ได้ระบุบัญชีรับเงิน' : 'ยังไม่ได้เลือกวิธีรับเงินคืน',
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
  if (!draft) {
    const attested = payoutAttestationText(payout, detail.requesterUserId);
    // An account that was kept in a payout round (the server's answer) is the account the claim was approved with: it
    // was checked then, as the history under it says, so it is never said that nobody has checked it. While it waits
    // for approval it is said to wait for its check again.
    const kept = detail.payoutCorrectionAnswer === 'SAME_ACCOUNT' || keptAccountAnswers(detail).has(payout.version);
    if (attested) notes.push(attested);
    else if (!kept) notes.push('ยังไม่มีผู้ตรวจบัญชีนี้');
    else if (detail.payoutCorrectionPhase === 'AWAITING_APPROVAL') notes.push('รอผู้อนุมัติตรวจบัญชีนี้อีกครั้ง');
  }
  return { state: 'transfer', line: maskedPayoutAccount(payout), notes };
}

/** What a claim's detail says of its payout rounds, as far as the card "การรับเงินคืน" reads it. */
type PayoutRoundFacts = {
  payoutCorrectionPhase?: string | null;
  payoutCorrectionAnswer?: string | null;
  payoutCorrectionAnsweredBy?: { onBehalf?: boolean | null; byName?: string | null } | null;
  payoutCorrectionHistory?: readonly ReimbursementPayoutCorrectionEvent[] | null;
};

/**
 * The answers of the claim's rounds that KEPT the account the round began with, by the account version each of them
 * froze. Keeping an account freezes a new version of it (what is approved next is that row), so the claim's account
 * history holds the one account twice. Whether a version is such a copy is the server's fact, decided when the answer
 * was taken (`answer: 'SAME_ACCOUNT'` on the history event that names the version); the page never decides it from the
 * digits it shows.
 */
function keptAccountAnswers(detail: PayoutRoundFacts): Map<number | undefined, ReimbursementPayoutCorrectionEvent> {
  return new Map((detail.payoutCorrectionHistory ?? [])
    .filter((event) => event.kind === 'ACCOUNT_SUBMITTED' && event.answer === 'SAME_ACCOUNT' && event.payoutVersion != null)
    .map((event) => [event.payoutVersion, event]));
}

/** What the card says of a cash claim that no round gave its cash: what the claim states, with no word of who chose it. */
export const CLAIM_STATES_CASH_NOTE = 'ใบนี้ระบุรับเป็นเงินสด ไม่ต้องมีบัญชี';

/**
 * What the card says of a claim paid back in cash. Where a round gave it its cash, who chose it: "ผู้เบิกขอรับเป็นเงินสด" of a
 * requester who answered with cash, and of whoever answered for them by name (the claim's own fact while the answer waits
 * for approval, afterwards the last answer of its history). Where no answer did, no fact says who chose cash: a claim may
 * be prepared for its requester, so the card says what the claim states.
 */
export function claimCashNote(detail: PayoutRoundFacts): string {
  const answers = (detail.payoutCorrectionHistory ?? []).filter((event) => event.kind === 'ACCOUNT_SUBMITTED');
  const last = answers[answers.length - 1];
  const answeredBy = detail.payoutCorrectionAnsweredBy ?? (last?.payoutMethod === 'CASH' ? last : undefined);
  return answeredBy ? reimbursementPayoutRoundCashNote(answeredBy) : CLAIM_STATES_CASH_NOTE;
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
 *
 * An account that was kept in a payout round shows once. The version its answer froze is no second account: it joins
 * the row of that account, the latest one before it that reads the same, as what happened to it next ("ผู้เบิกยืนยัน
 * บัญชีเดิม เมื่อ …", then who checked it again). It did not start to be used with the claim on that day.
 */
export function claimPayoutHistory(detail: {
  requesterUserId?: string;
  payout?: ReimbursementPayoutSummary | null;
  payoutHistory?: readonly ReimbursementPayoutVersionSummary[] | null;
} & PayoutRoundFacts): ClaimPayoutHistoryRow[] {
  const versions = detail.payoutHistory ?? [];
  const current = detail.payout?.version;
  if (versions.every((version) => version.version === current)) return [];
  const kept = keptAccountAnswers(detail);
  const rows: ClaimPayoutHistoryRow[] = [];
  for (const version of versions) {
    const line = payoutAccountWithName(version);
    const attested = payoutAttestationText(version, detail.requesterUserId);
    const answer = kept.get(version.version);
    const sameAccount = answer && [...rows].reverse().find((row) => row.line === line);
    if (sameAccount) {
      sameAccount.current ||= version.version === current;
      sameAccount.notes.push(`${payoutCorrectionAnsweredText(answer.answer, answer)} เมื่อ ${formatThaiDateTime(answer.at)}`, ...(attested ? [attested] : []));
      continue;
    }
    rows.push({
      version: version.version, current: version.version === current, line,
      // An account no longer in use says who attested it only when someone did: "not yet" would never come true.
      notes: [`เริ่มใช้กับใบนี้เมื่อ ${formatThaiDateTime(version.frozenAt)}`, payoutSourceText(version), attested].filter((note): note is string => !!note),
    });
  }
  return rows;
}

/**
 * Payout spec §22: the requester changed their default account after sending the claim. The claim
 * keeps the account it was sent with; this says so, and how to change it while that is still theirs
 * to do (taking the claim back to a draft and sending it again). Null when the server said nothing.
 */
export function payoutDefaultChangedHint(
  detail: { payout?: ReimbursementPayoutSummary | null; payoutCorrectionPhase?: string | null; payoutCorrectionActions?: { canRequest?: boolean; canSubmit?: boolean } | null },
  canWithdraw: boolean,
): string | null {
  if (detail.payout?.defaultAccountChanged !== true) return null;
  // After approval the requester no longer takes the claim back to a draft. Where the server lets them, the way to
  // the new account is the correction round (spec §14.3): give the account now, or send the claim back for it.
  const how = canWithdraw ? 'ถ้าต้องการให้ใบนี้ใช้บัญชีใหม่ กดปุ่มแก้ไข (เปิดกลับเป็นร่าง) ในขั้นอนุมัติ แล้วส่งอนุมัติอีกครั้ง'
    // The button and the line named are the claim's own, as they read: those of a claim that holds an account (it copied
    // the default, which is why it is told this), for its requester, who alone is told.
    : detail.payoutCorrectionActions?.canSubmit === true
      ? `ถ้าต้องการให้ใบนี้ใช้บัญชีใหม่ กด${payoutCorrectionAnswerWords({ ...detail.payout, payoutCorrectionPhase: detail.payoutCorrectionPhase }, true).button}ในขั้นอนุมัติ แล้วเลือกใช้บัญชีประจำ`
      : detail.payoutCorrectionActions?.canRequest === true ? `ถ้าต้องการให้ใบนี้ใช้บัญชีใหม่ กด${payoutRoundTexts(detail.payout).payLink}ที่ท้ายกล่องนี้ ก่อนมีการโอน`
        : 'ตอนนี้คุณเปิดใบนี้กลับเป็นร่างเองไม่ได้แล้ว ถ้าต้องการเปลี่ยนบัญชี แจ้งผู้อนุมัติหรือผู้จ่ายเงินก่อนมีการโอน';
  return `บัญชีรับเงินคืนประจำของคุณเปลี่ยนแล้ว แต่ใบนี้ยังใช้บัญชีที่แสดงอยู่นี้ ซึ่งเป็นบัญชีตอนส่งอนุมัติ ${how}`;
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

/** Words follow the receiving method the row knows; an unstated method may still use a default on the page. */
export function draftRowSubmitLabel(row: { payoutMethod?: string | null }): string {
  return row.payoutMethod === 'CASH' ? 'ส่งอนุมัติ'
    : row.payoutMethod === 'BANK_TRANSFER' ? 'ตรวจบัญชีและส่งอนุมัติ' : 'เลือกวิธีรับเงินคืนและส่งอนุมัติ';
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
// A payout destination found wrong after approval is fixed on the same claim: it is sent back from the pay step, its
// requester gives the destination again and its approvers approve that alone. Who may do which is the server's
// answer (`payoutCorrectionActions`, `approvalActions`); nothing here decides it.
//
// A claim is sent back holding an account, cash, or (sent before claims carried one, spec §15) nothing, and what is
// answered is one of seven things. The words of every screen follow those two facts, and are the contracts' own
// (`REIMBURSEMENT_PAYOUT_ROUND_TEXTS` and the functions beside it): no screen makes a sentence of its own from a
// phase or a reason code.

/**
 * The contracts' sentences of a round for this claim, by what it holds now (its list row's or its detail's
 * `payoutMethod`): the texts of `held` for the pay step and for the claim while it is with its requester, and under
 * `given` those of an answer that waits for approval. The claim then holds what was given, which is never nothing.
 */
export function payoutRoundTexts(claim: { payoutMethod?: string | null } | null | undefined) {
  const held = reimbursementPayoutHeld(claim);
  return { held, ...REIMBURSEMENT_PAYOUT_ROUND_TEXTS.held[held], given: REIMBURSEMENT_PAYOUT_ROUND_TEXTS.given[held === 'CASH' ? 'CASH' : 'ACCOUNT'] };
}

/**
 * The words of the send-back, as the title of its form: by what the claim holds, an account to correct, none yet to
 * add, or cash to choose again. From the step a round waits on it is how the approvers do not take the answer, never
 * a refusal of the claim, and it is the words of their button too.
 */
export function payoutCorrectionSendBackTitle(claim: { payoutMethod?: string | null; payoutCorrectionPhase?: string | null }): string {
  const words = payoutRoundTexts(claim);
  return claim.payoutCorrectionPhase === 'AWAITING_APPROVAL' ? words.given.sendBackAgain : reimbursementPayoutRoundSendBack(words.held);
}
/** The button that saves the answer of a round, whatever is chosen: what is saved may be cash, which is no account. */
export const PAYOUT_CORRECTION_SAVE_LABEL = 'บันทึกวิธีรับเงินคืน';
/**
 * What whoever answers a round is asked to do, by what the claim holds: correct its account, add one, or choose how to
 * be paid back. `title` heads the form; `button` opens it. Whoever answers for the requester reads both as done on the
 * requester's behalf, and a requester whose answer already waits for approval is offered to do it again.
 */
export function payoutCorrectionAnswerWords(
  claim: { payoutMethod?: string | null; payoutCorrectionPhase?: string | null }, forSelf: boolean,
): { title: string; button: string } {
  const words = payoutRoundTexts(claim);
  const title = forSelf ? reimbursementPayoutRoundAsk(words.held) : words.askOnBehalf;
  return { title, button: forSelf && claim.payoutCorrectionPhase === 'AWAITING_APPROVAL' ? words.given.askAgain : title };
}
/**
 * A scan declared as signed before the claim was sent back (spec §14.4): it stays in the list and no longer counts.
 * Named for the send-back alone, for good: a claim is also sent back with no account, or with cash, and what it comes
 * back with may be what it had.
 */
export const SIGNED_COPY_BEFORE_CORRECTION_LABEL = 'สำเนาก่อนส่งกลับ';

/**
 * The API refused a form of the round because the claim is no longer as the page read it (HTTP 409): someone paid it,
 * cancelled it, sent it back or gave its account meanwhile. The page then reads the claim again.
 */
export function isClaimStateConflict(e: unknown): boolean {
  return (e as { status?: unknown } | null)?.status === 409;
}
/**
 * Whether the API's refusal is the one named: a bare Nest exception carries its name as the message, one with a
 * body as the code. A yes or a no only: the message itself is never handed on to be shown.
 */
function refusalIs(e: unknown, name: string): boolean {
  return apiErrorCode(e) === name || (e instanceof Error && e.message.trim() === name);
}
/**
 * The API took no account because the claim is no longer the one the form was opened on (`reimbursement_changed`):
 * the account form sends the `updatedAt` it read, so a press that arrives after an earlier one was taken freezes
 * no further version of the account and sends no further notice (spec §14.5).
 */
export function isClaimChangedRefusal(e: unknown): boolean {
  return refusalIs(e, 'reimbursement_changed');
}
/** Added to such a refusal in a form that is still offered, once the page under it shows the claim as it is now. */
export const PAYOUT_CORRECTION_REREAD_NOTE = 'หน้านี้แสดงสถานะล่าสุดของใบแล้ว ตรวจแล้วกดอีกครั้งได้';
/**
 * Said by the page when it closed an account form that is still offered, because the claim changed after the form
 * was opened (an earlier press of the same form may be what changed it): what was not done, and what to look at
 * before giving the account once more. Nothing typed for the claim as it was is sent to the claim as it is.
 */
export const PAYOUT_CORRECTION_STALE_PRESS = 'ยังไม่ได้บันทึกวิธีรับเงินคืนครั้งนี้ เพราะใบนี้เปลี่ยนไปหลังจากเปิดฟอร์ม หน้านี้แสดงสถานะล่าสุดของใบแล้ว ดูที่หัวข้อการรับเงินคืนว่าตอนนี้ใบใช้วิธีรับเงินคืนใด ถ้ายังไม่ถูก กดปุ่มในขั้นตอนนี้เพื่อเลือกอีกครั้ง';
/** Said by the page when the form is no longer offered: what was not done, why, and where to read what can be done now. */
export const PAYOUT_CORRECTION_SUPERSEDED: Record<'send-back' | 'correct-payout', string> = {
  'send-back': 'ยังไม่ได้ส่งกลับ เพราะมีผู้ทำรายการกับใบนี้ไปก่อนแล้ว หน้านี้แสดงสถานะล่าสุดของใบ ดูในขั้นตอนนี้ว่าใบรอใคร และทำต่อได้ตามปุ่มที่แสดง',
  'correct-payout': 'ยังไม่ได้บันทึกวิธีรับเงินคืน เพราะมีผู้ทำรายการกับใบนี้ไปก่อนแล้ว หน้านี้แสดงสถานะล่าสุดของใบ ดูในขั้นตอนนี้ว่าใบรอใคร และทำต่อได้ตามปุ่มที่แสดง',
};

/**
 * The fixed reasons this claim can be sent back with, in the order the form lists them: the list the API takes for
 * it (`reimbursementPayoutCorrectionReasons`), by what the claim holds. An account can be wrong in five ways (a
 * PromptPay number, which has no bank, in four), cash has its own two, and each list ends with "อื่น ๆ". A claim with
 * no account of its own has the one reason that says so, which its form states and does not ask.
 */
export function payoutCorrectionReasons(
  detail: { payoutMethod?: string | null; payout?: Pick<ReimbursementPayoutSummary, 'payoutMethod' | 'payoutKind'> | null } | null | undefined,
): ReadonlyArray<[ReimbursementPayoutCorrectionReason, string]> {
  // Each in the words of the account the claim holds: a PromptPay number is never called "เลขบัญชี". The code sent is the same.
  return reimbursementPayoutCorrectionReasons(reimbursementPayoutHeld(detail), detail?.payout?.payoutKind)
    .map((code) => [code, reimbursementPayoutCorrectionReasonLabel(code, detail?.payout?.payoutKind)]);
}

/**
 * A reason in words, as the form offered it: by the kind of the account it was said of (`payoutKind`), where the reader
 * knows it. Empty for a reason this build has no words for: a code is never printed.
 */
export function payoutCorrectionReasonText(reasonCode: unknown, payoutKind?: unknown): string {
  return isReimbursementPayoutCorrectionReason(reasonCode)
    ? reimbursementPayoutCorrectionReasonLabel(reasonCode, payoutKind === 'PROMPTPAY_PHONE' ? payoutKind : undefined) : '';
}

/**
 * The kind of the account a claim held at a send-back, for the words of its reason. The server says THAT the claim held
 * an account then (`held` on the event); which one it was is found here, in the claim's own account history: the last
 * account it had been sent with, or given in a round, by that moment. A claim's account is always the latest one frozen
 * for it, and a round's answer is frozen when it is taken, before any later send-back. Undefined where the detail carries
 * no such row (an action's answer has no history): the reason then reads in the list's own words.
 */
export function payoutKindHeldAt(
  payoutHistory: readonly Pick<ReimbursementPayoutVersionSummary, 'payoutKind' | 'frozenAt'>[] | null | undefined, at: unknown,
): ReimbursementPayoutKind | undefined {
  const moment = Date.parse(String(at));
  return [...(payoutHistory ?? [])].reverse().find((row) => Date.parse(row.frozenAt) <= moment)?.payoutKind;
}

/**
 * "ส่งกลับให้แก้บัญชีรับเงินโดย … : เหตุผล" (spec §14.2, §17.2). One sentence for the step note of a claim that
 * waits for its requester, for the timeline row and for the card its approvers read, so they cannot tell it differently.
 * How it is said follows `held`, what the claim held at that send-back: an account to correct, none yet to add, or cash
 * to choose again. Never the reason code, which says why and not what the claim held. A send-back with no record of what
 * was held (an event from an older server) is told in words true of every claim sent back. The reason is worded for the
 * kind of the account that was held (`payoutKind`): a PromptPay number is never called "เลขบัญชี".
 */
export function payoutCorrectionSentBackText(sentBack: { byName?: string | null; reasonCode?: unknown; held?: unknown; payoutKind?: unknown } | null | undefined): string {
  const reason = payoutCorrectionReasonText(sentBack?.reasonCode, sentBack?.payoutKind);
  const held = sentBack?.held;
  const action = typeof held === 'string' && Object.hasOwn(REIMBURSEMENT_PAYOUT_ROUND_TEXTS.held, held)
    ? reimbursementPayoutRoundSendBack(held as ReimbursementPayoutHeld) : 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืน';
  return `${action}${sentBack?.byName ? `โดย ${sentBack.byName}` : ''}${reason ? ` : ${reason}` : ''}`;
}

/**
 * What was answered in a round, where the claim or the event says it in a word this build knows. Undefined: no record
 * of it (a page fed by an older server), or an answer added later. A reader then says what is true of every answer.
 */
export function payoutRoundAnswer(answer: unknown): ReimbursementPayoutRoundAnswer | undefined {
  return typeof answer === 'string' && Object.hasOwn(REIMBURSEMENT_PAYOUT_ROUND_TEXTS.answer, answer) ? answer as ReimbursementPayoutRoundAnswer : undefined;
}

/**
 * Who answered a round and what they did (spec §17.2), in the contracts' words for that answer: "ผู้เบิกแก้บัญชีรับเงิน" of
 * another account, "ผู้เบิกยืนยันบัญชีเดิม" of the same one, "ผู้เบิกเปลี่ยนวิธีรับเงินคืน" between an account and cash, and so on.
 * When someone answered for the requester (a finance reviewer may) it is said of that person, by name: no sentence says
 * the requester did what someone else did for them. `answeredBy`: the history event of the answer, or the claim's
 * `payoutCorrectionAnsweredBy`; either says whether it was on the requester's behalf.
 */
export function payoutCorrectionAnsweredText(answer: unknown, answeredBy?: { onBehalf?: boolean | null; byName?: string | null } | null): string {
  // ponytail: with no answer on record the words are those of a method chosen, which every answer is.
  return reimbursementPayoutRoundDid(payoutRoundAnswer(answer) ?? 'FIRST_CASH', answeredBy);
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
  payoutCorrectionPhase?: string | null; payoutMethod?: string | null;
  signatures?: readonly unknown[] | null; signedCopies?: readonly { acknowledgedAt?: string }[] | null;
}): string[] {
  const words = payoutRoundTexts(detail);
  // From the round's waiting step: the claim goes back to its requester once more, for what was just given: an account
  // to correct, or cash to choose again. Nothing is signed in a round.
  if (detail.payoutCorrectionPhase === 'AWAITING_APPROVAL') return [words.given.sendBackAgainLine1];
  return [
    words.sendBackLine1,
    // What comes after names no "new account": the requester may keep the account, or take cash.
    words.sendBackLine2,
    // A claim sent before claims carried an account gets one through this same path (spec §15): it has none to correct.
    ...(words.held === 'NOTHING' ? [`${LEGACY_PAYOUT_NOTE} หลังส่งกลับ ผู้เบิกจะระบุบัญชีรับเงินของใบนี้ได้`] : []),
    // What is lost comes back when the claim is at its pay step again, whatever was answered in between.
    ...((detail.signatures ?? []).length > 0 ? ['ลายเซ็นในระบบที่ลงไว้ในใบนี้จะถูกลบ ต้องลงนามใหม่เมื่อใบกลับมารอจ่าย'] : []),
    ...((detail.signedCopies ?? []).some((copy) => copy.acknowledgedAt)
      ? ['สำเนาใบเบิกที่ลงนามบนกระดาษยังเปิดดูได้ แต่จะไม่นับว่าลงนามแล้ว ต้องแนบสำเนาใหม่เมื่อใบกลับมารอจ่าย'] : []),
  ];
}

/** What the requester picks for a claim in a round. Nothing is picked for them: the account in question may be their default. */
export type PayoutCorrectionForm = { mode: '' | 'DEFAULT' | 'SPECIFIED' | 'CASH' | 'PREVIOUS'; account: PayoutAccountForm; saveAsDefault: boolean };

/** The choice that keeps the account the claim was approved with before its round, as it is (spec §14.5): nobody types anything. */
export const PAYOUT_CORRECTION_PREVIOUS_LABEL = 'ใช้บัญชีเดิมของใบนี้';

/**
 * The account that choice would take again. Undefined for a claim approved for cash, which the cash choice already
 * says, and for a claim sent before claims carried an account: it had none, and the API refuses the choice.
 */
export function payoutCorrectionPreviousAccount(detail: { payoutCorrection?: { previous?: ReimbursementPayoutCorrectionAccount | null } | null }): ReimbursementPayoutCorrectionAccount | undefined {
  const previous = detail.payoutCorrection?.previous;
  return previous?.payoutMethod === 'BANK_TRANSFER' ? previous : undefined;
}

/**
 * The API refused an account typed on behalf of a requester who is no longer an active member (409, spec §14.5):
 * the notice such an account always sends would reach nobody. The claim itself did not change.
 */
export function isRequesterNotActiveRefusal(e: unknown): boolean {
  return refusalIs(e, 'payout_account_member_not_active');
}
/**
 * Whether the account form of a round offers this choice: the server's list of what its endpoint takes from this
 * viewer (`payoutCorrectionActions.submitModes`), so nobody fills in a choice only to have it refused. An answer
 * without the list (from before the server gave one) offers every choice, and the endpoint's refusal still closes one.
 */
export function payoutCorrectionOffers(
  detail: { payoutCorrectionActions?: { submitModes?: readonly string[] | null; [flag: string]: unknown } | null } | null | undefined, mode: Exclude<PayoutCorrectionForm['mode'], ''>,
): boolean {
  const modes = detail?.payoutCorrectionActions?.submitModes;
  return !Array.isArray(modes) || modes.includes(mode);
}
/**
 * The server said up front that an account cannot be typed on this requester's behalf because they are no longer an
 * active member: the form says so in place of that choice, before anyone types.
 */
export function payoutCorrectionTypingRefusedUpFront(
  detail: { payoutCorrectionActions?: { specifiedRefusal?: string | null; [flag: string]: unknown } | null } | null | undefined,
): boolean {
  return detail?.payoutCorrectionActions?.specifiedRefusal === 'REQUESTER_NOT_ACTIVE';
}
/**
 * Said in the account form to whoever answers for the requester: the requester is told of every answer given for them,
 * whatever is chosen (an account typed, their standing account, the account the claim had, or cash). Shown only where a
 * notice can reach the requester: where none can, the form says why no account can be typed for them instead.
 */
export const PAYOUT_CORRECTION_ON_BEHALF_NOTICE = reimbursementPayoutOnBehalfNotice();
/** Said in the account form in place of the choice it does not offer: what cannot be done, why, and what still can. */
export const PAYOUT_CORRECTION_TYPING_REFUSED = 'ผู้เบิกของใบนี้ไม่ได้ใช้งานระบบแล้ว จึงพิมพ์บัญชีแทนผู้เบิกไม่ได้ เพราะระบบต้องแจ้งผู้เบิกทุกครั้งที่มีผู้พิมพ์บัญชีแทน เลือกวิธีรับเงินคืนจากตัวเลือกที่เหลือ';

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
 * tick to save as the default is sent only where the server said this viewer may (`canSaveAsDefault`). "The
 * account the claim had" names nothing: the server takes the one the claim was approved with. Every choice goes
 * with `expectedUpdatedAt`, the `updatedAt` of the claim the form was opened on, so the server takes it only while
 * the claim is still that one.
 */
export function payoutCorrectionInput(
  form: PayoutCorrectionForm, defaultToken: string | undefined, canSaveAsDefault: boolean, expectedUpdatedAt?: string | null,
): SubmitReimbursementPayoutCorrectionInput | null {
  const choice: SubmitReimbursementPayoutCorrectionInput | null = form.mode === 'CASH' ? { mode: 'CASH' }
    : form.mode === 'PREVIOUS' ? { mode: 'PREVIOUS' }
      : form.mode === 'DEFAULT' ? (defaultToken ? { mode: 'DEFAULT', defaultToken } : null)
        : form.mode === 'SPECIFIED' ? { mode: 'SPECIFIED', ...payoutDestinationInput(form.account), ...(form.saveAsDefault && canSaveAsDefault && { saveAsDefault: true }) }
          : null;
  return choice && { ...choice, ...(expectedUpdatedAt && { expectedUpdatedAt }) };
}

/** A receiving method and account of a round, masked, in one line: what the claim was approved with, or what it has now. */
export function payoutCorrectionAccountText(account: ReimbursementPayoutCorrectionAccount | ReimbursementPayoutSummary | null | undefined): string {
  // No method at all: the claim was sent before claims carried one.
  if (!account?.payoutMethod) return 'ไม่มี ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน';
  if (account.payoutMethod === 'CASH') return PAYOUT_METHOD_TEXT.CASH!;
  return account.accountLast4 ? payoutAccountWithName(account) : PAYOUT_METHOD_TEXT.BANK_TRANSFER!;
}

/**
 * What the card "การรับเงินคืน" says of what it shows while the claim is in a round. With its requester: what the claim
 * was sent back holding, an account or cash that is in question (after a send-back from the round's waiting step, the
 * answer that was not taken, which is not what the claim began with), or that it has no account yet. While an answer
 * waits for approval: that it is what was sent, by whom, and that nobody has approved it yet. Null: no round.
 */
export function payoutCorrectionCardNote(detail: { payoutMethod?: string | null } & PayoutRoundFacts): string | null {
  if (detail.payoutCorrectionPhase === 'AWAITING_REQUESTER') return payoutRoundTexts(detail).cardNote;
  if (detail.payoutCorrectionPhase === 'AWAITING_APPROVAL') return reimbursementPayoutRoundGivenNote(detail.payoutCorrectionAnsweredBy);
  return null;
}
