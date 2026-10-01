/**
 * Pure rules for the reimbursement payout account (payout spec §8–§11). No Nest / Prisma imports.
 *
 * Humans verify the account; this file only checks completeness and format, seals what is typed,
 * and decides — in one place each — who may see the full number, when an approval is attested and
 * which snapshot version a submit freezes.
 */
import { createHmac } from 'node:crypto';
import {
  invalidPayoutDestinationField,
  normalizePayoutAccountNumber,
  type PayoutDestinationInput,
  type ReimbursementApprovalStepStatus,
  type ReimbursementPayoutKind,
  type ReimbursementPayoutMethod,
  type ReimbursementPayoutNotReadyReason,
  type ReimbursementPayoutSource,
} from '@watchdog-bms/contracts';
import { decryptCredential, encryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';

/** The stored form of one account: what both payout tables keep. */
export type SealedPayoutDestination = {
  payoutKind: ReimbursementPayoutKind;
  bankName: string | null;
  accountName: string;
  accountNumberEncrypted: string;
  accountLast4: string;
  fingerprint: string;
};

/**
 * The ONE place a typed account becomes stored columns. The ciphertext, the last 4 digits and the
 * fingerprint all come from the same normalized digit string, so the last 4 can never disagree with
 * what a reveal decrypts. Returns null when the input is incomplete or malformed.
 */
export function sealPayoutDestination(input: Partial<PayoutDestinationInput> | null | undefined, key: Buffer): SealedPayoutDestination | null {
  if (!input || invalidPayoutDestinationField(input)) return null;
  const accountNumber = normalizePayoutAccountNumber(input.accountNumber);
  const destination = {
    payoutKind: input.payoutKind!,
    bankName: input.payoutKind === 'BANK_ACCOUNT' ? input.bankName!.trim() : null,
    accountName: input.accountName!.trim(),
  };
  return {
    ...destination,
    accountNumberEncrypted: encryptCredential(accountNumber, key),
    accountLast4: accountNumber.slice(-4),
    fingerprint: payoutFingerprint({ ...destination, accountNumber }, key),
  };
}

/**
 * Same destination, same fingerprint — the ciphertext is random per write and cannot answer that.
 * Keyed, so the stored value says nothing about the number to anyone without the key.
 */
export function payoutFingerprint(
  destination: { payoutKind: string; bankName: string | null; accountName: string; accountNumber: string },
  key: Buffer,
): string {
  return createHmac('sha256', key)
    .update(JSON.stringify(['reimbursement-payout-destination:v1', destination.payoutKind, destination.bankName ?? '', destination.accountName, destination.accountNumber]))
    .digest('hex');
}

/** The full number, for the audited reveal call only. */
export function openPayoutAccountNumber(accountNumberEncrypted: string, key: Buffer): string {
  return decryptCredential(accountNumberEncrypted, key);
}

/** No account typed at all (the requester still has to give one), as opposed to a malformed one. */
export function isBlankPayoutDestination(input: Partial<PayoutDestinationInput> | null | undefined): boolean {
  return !input?.accountName?.trim() && !normalizePayoutAccountNumber(input?.accountNumber) && !input?.bankName?.trim();
}

// ---- Who may see the full number ----

export type PayoutRevealGroup = 'REQUESTER' | 'APPROVER' | 'PAYER';

/**
 * The single decision of who may see a claim's full account number (owner decision D2): the
 * requester, that claim's approver, and whoever may record its payment. Everyone else gets the last
 * 4 digits. The reveal endpoint and the detail's `canRevealAccountNumber` flag both come from here, so a button is
 * never offered to someone the API would refuse.
 */
export function payoutRevealGroup(input: {
  /** The claim carries its own account row (not cash, not legacy, not a draft still following the default). */
  hasClaimAccount: boolean;
  isDraft: boolean;
  isRequester: boolean;
  isClaimApprover: boolean;
  canRecordPayment: boolean;
}): PayoutRevealGroup | null {
  if (!input.hasClaimAccount) return null;
  if (input.isRequester) return 'REQUESTER';
  // Nobody approves or pays a draft, so nobody but its requester has a reason to read the number.
  if (input.isDraft) return null;
  if (input.isClaimApprover) return 'APPROVER';
  return input.canRecordPayment ? 'PAYER' : null;
}

/**
 * Whether this user approved the claim in its CURRENT round: an approval decided before the claim
 * was last sent (a finance correction sends it again) belongs to an account that may have changed.
 */
export function isEffectiveClaimApprover(
  claim: {
    submittedAt?: Date;
    approvalSteps?: readonly { status: ReimbursementApprovalStepStatus; decidedAt?: Date; decisionByUserId?: string; invalidatedAt?: Date }[];
  },
  userId: string,
): boolean {
  if (!claim.submittedAt) return false;
  const submittedAt = claim.submittedAt.getTime();
  return (claim.approvalSteps ?? []).some((step) => step.status === 'APPROVED' && !step.invalidatedAt
    && step.decisionByUserId === userId && !!step.decidedAt && step.decidedAt.getTime() >= submittedAt);
}

// ---- Attestation at approval ----

/**
 * "ตรวจบัญชีแล้ว" binds to one exact snapshot version. A claim paid by transfer cannot be approved
 * without it, and an attestation of any other version (the claim was withdrawn and sent again) is
 * refused. Cash claims and legacy claims have no account to attest. Null means the approval may go on.
 */
export function payoutAttestationError(
  claim: { payoutMethod?: string | null; payoutDestinationVersion?: number | null },
  verifiedVersion: unknown,
): 'payout_verification_required' | 'payout_destination_changed' | null {
  if (claim.payoutMethod !== 'BANK_TRANSFER') return null;
  if (verifiedVersion === undefined || verifiedVersion === null) return 'payout_verification_required';
  return verifiedVersion === claim.payoutDestinationVersion ? null : 'payout_destination_changed';
}

// ---- Freezing at submit ----

export type PayoutDestinationVersionRow = {
  version: number;
  fingerprint: string;
  source: ReimbursementPayoutSource;
  frozenAt?: Date | null;
};

export type SubmitPayoutPlan =
  | { error: ReimbursementPayoutNotReadyReason }
  | { payoutMethod: 'CASH'; followsDefault: boolean }
  | {
    payoutMethod: 'BANK_TRANSFER';
    followsDefault: boolean;
    version: number;
    fingerprint: string;
    /** COPY_DEFAULT: a new frozen copy of the default; FREEZE: the draft's own row; REUSE: an unchanged frozen version. */
    action: 'COPY_DEFAULT' | 'FREEZE' | 'REUSE';
  };

/**
 * What a submit freezes. A draft with no method follows the requester's default account as it is
 * right now; nothing is ever picked for a requester who has not chosen. An unchanged destination
 * keeps its version, a changed one gets the next.
 */
export function planSubmitPayout(
  claim: { payoutMethod?: ReimbursementPayoutMethod | null; payoutDestinationVersion?: number | null },
  versions: readonly PayoutDestinationVersionRow[],
  defaultAccount: { payoutMethod: ReimbursementPayoutMethod; fingerprint?: string | null } | null | undefined,
): SubmitPayoutPlan {
  if (!claim.payoutMethod) {
    if (!defaultAccount) return { error: 'payout_method_required' };
    if (defaultAccount.payoutMethod === 'CASH') return { payoutMethod: 'CASH', followsDefault: true };
    if (!defaultAccount.fingerprint) return { error: 'payout_destination_required' };
    const latestFrozen = [...versions].filter((row) => !!row.frozenAt).sort((a, b) => b.version - a.version)[0];
    return latestFrozen?.source === 'DEFAULT_ACCOUNT' && latestFrozen.fingerprint === defaultAccount.fingerprint
      ? { payoutMethod: 'BANK_TRANSFER', followsDefault: true, version: latestFrozen.version, fingerprint: latestFrozen.fingerprint, action: 'REUSE' }
      : {
        payoutMethod: 'BANK_TRANSFER', followsDefault: true, fingerprint: defaultAccount.fingerprint, action: 'COPY_DEFAULT',
        version: versions.reduce((max, row) => Math.max(max, row.version), 0) + 1,
      };
  }
  if (claim.payoutMethod === 'CASH') return { payoutMethod: 'CASH', followsDefault: false };
  const own = versions.find((row) => row.version === claim.payoutDestinationVersion);
  if (!own) return { error: 'payout_destination_required' };
  return { payoutMethod: 'BANK_TRANSFER', followsDefault: false, version: own.version, fingerprint: own.fingerprint, action: own.frozenAt ? 'REUSE' : 'FREEZE' };
}

/**
 * A claim going back to draft (rejected, withdrawn, sent back by finance) follows the default again
 * when its frozen account was a copy of the default, so the next submit takes the latest one. An
 * account named for this claim stays the draft's choice.
 */
// ponytail: a cash claim stays cash here, because cash has no version row to say whether it was
// chosen or followed a cash default; the draft shows it above the submit button. Add a source column
// on the request if owners need a cash default to re-follow.
export function draftFollowsDefaultAfterReopen(
  claim: { payoutMethod?: string | null; payoutDestinationVersion?: number | null },
  versions: readonly Pick<PayoutDestinationVersionRow, 'version' | 'source'>[],
): boolean {
  return claim.payoutMethod === 'BANK_TRANSFER'
    && versions.find((row) => row.version === claim.payoutDestinationVersion)?.source === 'DEFAULT_ACCOUNT';
}
