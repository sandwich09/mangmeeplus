/**
 * Pure rules for the reimbursement payout account (payout spec §8–§11). No Nest / Prisma imports.
 *
 * Humans verify the account; this file only checks completeness and format, seals what is typed,
 * and decides — in one place each — who may see the full number, when an approval is attested and
 * which snapshot version a submit freezes.
 */
import { createHash, createHmac } from 'node:crypto';
import {
  invalidPayoutDestinationField,
  normalizePayoutAccountNumber,
  type PayoutDestinationInput,
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

/**
 * What the submit writes into `payoutFingerprint` for a cash claim, which has no account to
 * fingerprint. With it, every claim sent by the payout-aware submit carries a fingerprint.
 */
export const CASH_PAYOUT_FINGERPRINT = 'cash';

/**
 * Whether a SENT claim carries its own payout snapshot. Decided by `payoutFingerprint`, the one value
 * only the payout-aware submit writes (a draft never has it; going back to draft clears it) — not by
 * the method column, which a draft's choice fills. So a claim sent before the field existed, or sent
 * by an older build while a release was rolled back, is a legacy claim everywhere at once: no payout
 * part in its hash, nothing to attest, nothing to reveal, no account shown.
 */
export function hasPayoutSnapshot(claim: { payoutFingerprint?: string | null }): boolean {
  return !!claim.payoutFingerprint;
}

/** The full number, for the audited reveal call only. */
export function openPayoutAccountNumber(accountNumberEncrypted: string, key: Buffer): string {
  return decryptCredential(accountNumberEncrypted, key);
}

/** No account typed at all (the requester still has to give one), as opposed to a malformed one. */
export function isBlankPayoutDestination(input: Partial<PayoutDestinationInput> | null | undefined): boolean {
  return !input?.accountName?.trim() && !normalizePayoutAccountNumber(input?.accountNumber) && !input?.bankName?.trim();
}

// ---- Who may set someone else's default account ----

/** Roles that manage people by name; a custom role counts when it carries a people-managing grant. */
export const PAYOUT_PEOPLE_MANAGER_ROLE_KEYS: readonly string[] = ['OWNER', 'SYSTEM_ADMIN', 'COMPANY_VIEW', 'ADMIN', 'MANAGER'];

export type PayoutAccountEditRefusal = 'target_not_active' | 'target_manages_people' | 'outside_editor_branch_scope';

/**
 * Whether an employee-data editor may set SOMEONE ELSE's default payout account (owner direction
 * 2026-10-01). The account decides where a person's money goes, and the employee-edit right reaches
 * the whole company, so on its own it would let a manager redirect a peer's, an admin's or another
 * branch's reimbursements. Hence:
 *  - nobody sets the account of a member who is not ACTIVE: the account owner must be told of every
 *    such change, and a notice reaches active members only (a draft, invited, suspended or disabled
 *    member would never see it);
 *  - an owner or an admin may set any active employee's. That means the product's own OWNER or ADMIN
 *    role: the caller looks the role up (`holdsSystemOwnerOrAdminRole`), because a role key proves
 *    nothing — a company role named "Admin" carries the key ADMIN as well;
 *  - any other holder of the right (a manager, HR, a custom role) may set it only for members who do
 *    not manage people themselves, and only for members wholly inside the editor's own branches.
 * Null means allowed. The account owner is told of every such change (see the use case).
 */
export function payoutAccountEditRefusal(input: {
  /** The editor holds the SYSTEM owner or admin role, not merely a role with that key. */
  editorIsOwnerOrAdmin: boolean;
  /** Undefined: the editor holds every branch. */
  editorBranchIds?: readonly string[];
  target: { membershipStatus: string; managesPeople: boolean; allBranches: boolean; branchIds: readonly string[] };
}): PayoutAccountEditRefusal | null {
  if (input.target.membershipStatus !== 'ACTIVE') return 'target_not_active';
  if (input.editorIsOwnerOrAdmin) return null;
  if (input.target.managesPeople) return 'target_manages_people';
  const branches = input.editorBranchIds;
  const outside = branches !== undefined
    && (input.target.allBranches || input.target.branchIds.length === 0 || input.target.branchIds.some((branchId) => !branches.includes(branchId)));
  return outside ? 'outside_editor_branch_scope' : null;
}

// ---- Who may see the full number ----

export type PayoutRevealGroup = 'REQUESTER' | 'APPROVER' | 'PAYER';

/**
 * The single decision of who may see a claim's full account number (owner decision D2): the
 * requester, that claim's approver, and whoever may record its payment. Everyone else gets the last
 * 4 digits. The reveal endpoint and the detail's `canRevealAccountNumber` flag both come from here, so a button is
 * never offered to someone the API would refuse.
 *
 * Who the three are is not decided here: the caller answers `isClaimApprover` from the one rule in
 * contracts (`isReimbursementClaimApprover`, with whoever may decide the pending step: the same two
 * facts `isReimbursementPayoutParty` reads for the payment slip). This adds what only the account
 * number needs: there is an account to show, and a draft is its requester's alone.
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

// ---- The requester's default changed after the claim was sent ----

/** Sent and not yet paid: the only time telling the requester can still change anything. */
export const PAYOUT_DEFAULT_CHANGE_HINT_STATUSES: readonly string[] = ['PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'];

/**
 * Whether the requester's default account is no longer the one a sent claim copied (payout spec §22).
 * The claim keeps the account it froze; the requester is told so on the claim. Decided from the two
 * fingerprints, which never leave the server.
 */
// ponytail: only a claim that copied a default ACCOUNT. An account typed for the claim never
// followed the default, and no row says whether a cash claim did (see `draftFollowsDefaultAfterReopen`).
export function defaultChangedSinceSubmit(
  claim: { status: string; payoutMethod?: string | null; payoutFingerprint?: string | null },
  frozenSource: string | undefined,
  defaultAccount: { payoutMethod: string; fingerprint?: string | null } | null | undefined,
): boolean {
  if (!PAYOUT_DEFAULT_CHANGE_HINT_STATUSES.includes(claim.status) || claim.payoutMethod !== 'BANK_TRANSFER' || !claim.payoutFingerprint) return false;
  // A removed default is not a changed one: there is no newer account the claim could use instead.
  if (frozenSource !== 'DEFAULT_ACCOUNT' || !defaultAccount) return false;
  return defaultAccount.payoutMethod !== 'BANK_TRANSFER' || defaultAccount.fingerprint !== claim.payoutFingerprint;
}

// ---- Attestation at approval ----

/**
 * "ตรวจบัญชีแล้ว" binds to one exact snapshot version. A claim paid by transfer cannot be approved
 * without it, and an attestation of any other version (the claim was withdrawn and sent again) is
 * refused. Cash claims and legacy claims have no account to attest. Null means the approval may go on.
 */
export function payoutAttestationError(
  claim: { payoutMethod?: string | null; payoutDestinationVersion?: number | null; payoutFingerprint?: string | null },
  verifiedVersion: unknown,
): 'payout_verification_required' | 'payout_destination_changed' | null {
  if (claim.payoutMethod !== 'BANK_TRANSFER' || !hasPayoutSnapshot(claim)) return null;
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

export type FrozenPayoutPlan = Exclude<SubmitPayoutPlan, { error: unknown }>;

/** The request columns a submit writes for its payout snapshot. */
export type SubmitPayoutColumns = {
  payoutMethod: ReimbursementPayoutMethod;
  payoutDestinationVersion: number | null;
  payoutFingerprint: string;
};

/** The one place the claim's payout columns, fingerprint included, are derived from a plan. */
export function submitPayoutColumns(plan: FrozenPayoutPlan): SubmitPayoutColumns {
  return plan.payoutMethod === 'CASH'
    ? { payoutMethod: 'CASH', payoutDestinationVersion: null, payoutFingerprint: CASH_PAYOUT_FINGERPRINT }
    : { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: plan.version, payoutFingerprint: plan.fingerprint };
}

/**
 * What a draft's page shows next to "ส่งอนุมัติ", as an opaque token: the method and the account a
 * submit would freeze right now. The submitter sends it back, and a submit whose own answer differs
 * (the default account was changed or removed in between) is refused, so nobody sends a claim to an
 * account they were not shown. Bound to the claim, so two claims never share a token, and derived
 * from the keyed fingerprint, so it says nothing about the number.
 */
export function payoutSubmitToken(claimId: string, plan: SubmitPayoutPlan): string | undefined {
  if ('error' in plan) return undefined;
  return createHash('sha256')
    .update(JSON.stringify(['reimbursement-payout-submit:v1', claimId, plan.payoutMethod, plan.followsDefault, plan.payoutMethod === 'BANK_TRANSFER' ? plan.fingerprint : '']))
    .digest('hex').slice(0, 32);
}

/**
 * A claim going back to draft (rejected, withdrawn, sent back by finance) follows the default again
 * when its frozen account was a copy of the default, so the next submit takes the latest one. An
 * account named for this claim stays the draft's choice.
 */
// ponytail: a cash claim stays cash here, because cash has no version row to say whether it was
// chosen or followed a cash default; the draft shows it above the submit button. Add a source column
// on the request if owners need a cash default to re-follow. Either way the caller clears the
// fingerprint: a draft never carries one.
export function draftFollowsDefaultAfterReopen(
  claim: { payoutMethod?: string | null; payoutDestinationVersion?: number | null },
  versions: readonly Pick<PayoutDestinationVersionRow, 'version' | 'source'>[],
): boolean {
  return claim.payoutMethod === 'BANK_TRANSFER'
    && versions.find((row) => row.version === claim.payoutDestinationVersion)?.source === 'DEFAULT_ACCOUNT';
}
