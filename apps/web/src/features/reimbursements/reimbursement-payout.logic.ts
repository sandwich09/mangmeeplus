// Pure helpers for the payout account screens. The format rule itself is the shared one in
// contracts (the API runs the same function); this file only turns it into Thai and into payloads.

import {
  invalidPayoutDestinationField,
  maskedPayoutAccount,
  THAI_BANK_NAMES,
  type MemberPayoutAccountSummary,
  type PayoutDestinationField,
  type PayoutDestinationInput,
  type ReimbursementPayoutInput,
  type ReimbursementPayoutSummary,
  type SetMemberPayoutAccountInput,
} from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';

export const PAYOUT_METHOD_TEXT: Record<string, string> = { BANK_TRANSFER: 'โอนเข้าบัญชี', CASH: 'รับเป็นเงินสด' };
export const PAYOUT_KIND_TEXT: Record<string, string> = { BANK_ACCOUNT: 'บัญชีธนาคาร', PROMPTPAY_PHONE: 'พร้อมเพย์ (เบอร์มือถือ)' };

/** A claim sent before claims carried a receiving method. One sentence, wherever such a claim is shown. */
export const LEGACY_PAYOUT_NOTE = 'ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีข้อมูลบัญชีรับเงินในระบบ';
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
  bankName: (form) => (form.bankChoice === OTHER_BANK ? 'กรุณาระบุชื่อธนาคาร ไม่เกิน 80 ตัวอักษร' : 'กรุณาเลือกธนาคาร'),
  accountName: () => 'กรุณาระบุชื่อบัญชีตามที่ธนาคารแสดง 2 ถึง 140 ตัวอักษร และไม่ใช่ตัวเลขล้วน',
  accountNumber: (form) => (form.payoutKind === 'PROMPTPAY_PHONE'
    ? 'เบอร์พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0'
    : 'เลขบัญชีต้องเป็นตัวเลข 6 ถึง 20 หลัก'),
};

/** The first problem with the typed account, in Thai, or null. Same rule as the server. */
export function payoutAccountFormError(form: PayoutAccountForm): { field: PayoutDestinationField; message: string } | null {
  const field = invalidPayoutDestinationField(payoutDestinationInput(form));
  return field ? { field, message: FIELD_MESSAGES[field](form) } : null;
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
  return form.mode === 'SPECIFIED' ? payoutAccountFormError(form.account)?.message ?? null : null;
}

/** The `payout` field of a create or update call; undefined leaves the draft's choice untouched. */
export function claimPayoutInput(form: ClaimPayoutForm): ReimbursementPayoutInput | undefined {
  if (form.mode === 'KEEP') return undefined;
  if (form.mode !== 'SPECIFIED') return { mode: form.mode };
  return { mode: 'SPECIFIED', ...payoutDestinationInput(form.account), ...(form.saveAsDefault && { saveAsDefault: true }) };
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
  if (payout.followsDefault) notes.push('ตามบัญชีรับเงินคืนประจำของผู้เบิก ระบบจะใช้บัญชีล่าสุดตอนกดส่งอนุมัติ');
  else if (draft && payout.payoutMethod === 'BANK_TRANSFER') notes.push('บัญชีที่ระบุสำหรับใบนี้');
  if (payout.enteredByName) notes.push(payout.followsDefault ? `บัญชีประจำนี้ตั้งโดย ${payout.enteredByName}` : `กรอกโดย ${payout.enteredByName}`);
  if (payout.payoutMethod === 'CASH') return { state: 'cash', line: PAYOUT_METHOD_TEXT.CASH!, notes };
  if (!draft) {
    notes.push(!payout.verifiedAt
      ? 'ยังไม่มีผู้ตรวจบัญชีนี้'
      : payout.verifiedByUserId && payout.verifiedByUserId === detail.requesterUserId
        ? `ผู้เบิกยืนยันบัญชีของตนเอง เมื่อ ${formatThaiDateTime(payout.verifiedAt)}`
        : `ตรวจบัญชีแล้วโดย ${payout.verifiedByName ?? 'ผู้อนุมัติ'} เมื่อ ${formatThaiDateTime(payout.verifiedAt)}`);
  }
  return { state: 'transfer', line: maskedPayoutAccount(payout), notes };
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

export const BANK_OPTIONS: readonly string[] = THAI_BANK_NAMES;
