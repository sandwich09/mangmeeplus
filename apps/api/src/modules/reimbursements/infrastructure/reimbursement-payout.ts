/**
 * Database side of the reimbursement payout account (payout spec §8–§10). Plain functions over a
 * Prisma client or transaction, called from the repository's own transactions — the same shape as
 * `reimbursement-source.ts`. The rules themselves live in `../domain/logic/payout-destination.logic.ts`.
 *
 * Two things hold for every function here:
 *  - the ciphertext is selected only by the two `…Secret` readers, which serve the audited reveal;
 *  - once a claim is submitted, nothing reads the member's default account for it again.
 */
import { ConflictException } from '@nestjs/common';
import type {
  ReimbursementPayoutKind,
  ReimbursementPayoutMethod,
  ReimbursementPayoutNotReadyReason,
  ReimbursementPayoutSource,
  ReimbursementRequestStatus,
} from '@watchdog-bms/contracts';
import {
  draftFollowsDefaultAfterReopen,
  hasPayoutSnapshot,
  payoutAttestationError,
  payoutSubmitToken,
  planSubmitPayout,
  submitPayoutColumns,
  type FrozenPayoutPlan,
  type PayoutDestinationVersionRow,
  type SealedPayoutDestination,
  type SubmitPayoutColumns,
  type SubmitPayoutPlan,
} from '../domain/logic/payout-destination.logic';

/** A member's default account as stored, without the ciphertext. */
export type MemberPayoutAccountRecord = {
  companyId: string;
  userId: string;
  payoutMethod: ReimbursementPayoutMethod;
  payoutKind?: ReimbursementPayoutKind;
  bankName?: string;
  accountName?: string;
  accountLast4?: string;
  fingerprint?: string;
  version: number;
  updatedByUserId: string;
  updatedAt: Date;
};

/** A claim's receiving method and account, masked — the source of every detail payload. */
export type ClaimPayoutRecord = {
  payoutMethod?: ReimbursementPayoutMethod;
  payoutKind?: ReimbursementPayoutKind;
  bankName?: string;
  accountName?: string;
  accountLast4?: string;
  version?: number;
  source?: ReimbursementPayoutSource;
  followsDefault?: boolean;
  /** Set only when someone other than the requester typed or set the account. */
  enteredByUserId?: string;
  verifiedByUserId?: string;
  verifiedAt?: Date;
  notReadyReason?: ReimbursementPayoutNotReadyReason;
};

export type DraftPayoutWrite =
  | { mode: 'DEFAULT' }
  | { mode: 'CASH' }
  | { mode: 'SPECIFIED'; destination: SealedPayoutDestination; source: 'REQUESTER' | 'PREPARER'; actorUserId: string };

type ClaimPayoutPointer = {
  id: string;
  companyId: string;
  requesterUserId: string;
  status: ReimbursementRequestStatus;
  payoutMethod?: ReimbursementPayoutMethod | null;
  payoutDestinationVersion?: number | null;
  payoutFingerprint?: string | null;
};

const opt = <T>(value: T | null | undefined): T | undefined => (value == null ? undefined : value);

/** Every column of a default account except the ciphertext. */
const MEMBER_ACCOUNT_COLUMNS = {
  companyId: true, userId: true, payoutMethod: true, payoutKind: true, bankName: true, accountName: true,
  accountLast4: true, fingerprint: true, version: true, updatedByUserId: true, updatedAt: true,
} as const;

function toMemberAccount(row: any): MemberPayoutAccountRecord {
  return {
    companyId: row.companyId, userId: row.userId, payoutMethod: row.payoutMethod,
    payoutKind: opt(row.payoutKind), bankName: opt(row.bankName), accountName: opt(row.accountName),
    accountLast4: opt(row.accountLast4), fingerprint: opt(row.fingerprint),
    version: row.version, updatedByUserId: row.updatedByUserId, updatedAt: row.updatedAt,
  };
}

export async function readMemberPayoutAccount(client: any, companyId: string, userId: string): Promise<MemberPayoutAccountRecord | null> {
  const row = await client.memberPayoutAccount.findFirst({ where: { companyId, userId }, select: MEMBER_ACCOUNT_COLUMNS });
  return row ? toMemberAccount(row) : null;
}

/** Reveal only. */
export async function readMemberPayoutSecret(client: any, companyId: string, userId: string): Promise<string | null> {
  const row = await client.memberPayoutAccount.findFirst({ where: { companyId, userId }, select: { accountNumberEncrypted: true } });
  return row?.accountNumberEncrypted ?? null;
}

/** Sets the default account (cash carries none) and counts the change. */
export async function writeMemberPayoutAccount(tx: any, data: {
  companyId: string;
  userId: string;
  actorUserId: string;
  payoutMethod: ReimbursementPayoutMethod;
  destination?: SealedPayoutDestination;
}): Promise<{ before: MemberPayoutAccountRecord | null; after: MemberPayoutAccountRecord }> {
  const before = await readMemberPayoutAccount(tx, data.companyId, data.userId);
  const columns = {
    payoutMethod: data.payoutMethod,
    payoutKind: data.destination?.payoutKind ?? null,
    bankName: data.destination?.bankName ?? null,
    accountName: data.destination?.accountName ?? null,
    accountNumberEncrypted: data.destination?.accountNumberEncrypted ?? null,
    accountLast4: data.destination?.accountLast4 ?? null,
    fingerprint: data.destination?.fingerprint ?? null,
    updatedByUserId: data.actorUserId,
  };
  const row = await tx.memberPayoutAccount.upsert({
    where: { companyId_userId: { companyId: data.companyId, userId: data.userId } },
    create: { companyId: data.companyId, userId: data.userId, ...columns },
    update: { ...columns, version: { increment: 1 } },
    select: MEMBER_ACCOUNT_COLUMNS,
  });
  return { before, after: toMemberAccount(row) };
}

export async function deleteMemberPayoutAccount(tx: any, companyId: string, userId: string): Promise<MemberPayoutAccountRecord | null> {
  const before = await readMemberPayoutAccount(tx, companyId, userId);
  if (before) await tx.memberPayoutAccount.deleteMany({ where: { companyId, userId } });
  return before;
}

/**
 * The claim's OWN receiving method and account: its columns and its own version row, nothing else.
 * This is what every detail path shows, what the approver attests and what a reveal decrypts, so it
 * has no way to reach the member's default account. Undefined for a legacy claim (sent without a
 * payout snapshot, see `hasPayoutSnapshot`) and for a draft still following the default.
 */
export async function readClaimPayout(client: any, claim: ClaimPayoutPointer): Promise<ClaimPayoutRecord | undefined> {
  if (claim.status !== 'DRAFT' && !hasPayoutSnapshot(claim)) return undefined;
  if (claim.payoutMethod === 'CASH') return { payoutMethod: 'CASH' };
  if (claim.payoutMethod !== 'BANK_TRANSFER') return undefined;
  const row = claim.payoutDestinationVersion == null ? null : await client.reimbursementPayoutDestination.findFirst({
    where: { companyId: claim.companyId, reimbursementRequestId: claim.id, version: claim.payoutDestinationVersion },
    select: {
      version: true, payoutKind: true, bankName: true, accountName: true, accountLast4: true, source: true,
      createdByUserId: true, verifiedByUserId: true, verifiedAt: true,
    },
  });
  if (!row) return { payoutMethod: 'BANK_TRANSFER', ...(claim.status === 'DRAFT' && { notReadyReason: 'payout_destination_required' as const }) };
  return {
    payoutMethod: 'BANK_TRANSFER', payoutKind: row.payoutKind, ...(row.bankName && { bankName: row.bankName }), accountName: row.accountName,
    accountLast4: row.accountLast4, version: row.version, source: row.source,
    ...(row.source === 'PREPARER' && { enteredByUserId: row.createdByUserId }),
    // An attestation belongs to a sent claim: a draft is about to be frozen and attested again.
    ...(claim.status !== 'DRAFT' && row.verifiedAt && { verifiedByUserId: row.verifiedByUserId, verifiedAt: row.verifiedAt }),
  };
}

/**
 * What a draft with no method of its own will be sent with: the REQUESTER's default account as it
 * is right now (never the viewer's or the preparer's). The only read of a default account on behalf
 * of a claim, and it answers for drafts alone.
 */
export async function readDraftDefaultPayout(client: any, claim: ClaimPayoutPointer): Promise<ClaimPayoutRecord | undefined> {
  if (claim.status !== 'DRAFT' || claim.payoutMethod) return undefined;
  const account = await readMemberPayoutAccount(client, claim.companyId, claim.requesterUserId);
  if (!account) return { followsDefault: true, notReadyReason: 'payout_method_required' };
  return {
    followsDefault: true, payoutMethod: account.payoutMethod, source: 'DEFAULT_ACCOUNT',
    // A cash default carries no account, so the block carries no account keys either.
    ...(account.payoutMethod === 'BANK_TRANSFER' && {
      payoutKind: account.payoutKind, accountName: account.accountName, accountLast4: account.accountLast4,
      ...(account.bankName && { bankName: account.bankName }),
    }),
    ...(account.updatedByUserId !== claim.requesterUserId && { enteredByUserId: account.updatedByUserId }),
  };
}

/** Reveal only: the ciphertext of the claim's CURRENT version, with what the audit row records. */
export async function readClaimPayoutSecret(client: any, companyId: string, requestId: string, version: number): Promise<{
  accountNumberEncrypted: string; accountLast4: string; payoutKind: string; bankName: string | null; version: number;
} | null> {
  return client.reimbursementPayoutDestination.findFirst({
    where: { companyId, reimbursementRequestId: requestId, version },
    select: { accountNumberEncrypted: true, accountLast4: true, payoutKind: true, bankName: true, version: true },
  });
}

async function listVersions(client: any, companyId: string, requestId: string): Promise<Array<PayoutDestinationVersionRow & { id: string }>> {
  return client.reimbursementPayoutDestination.findMany({
    where: { companyId, reimbursementRequestId: requestId },
    select: { id: true, version: true, fingerprint: true, source: true, frozenAt: true },
    orderBy: { version: 'desc' },
  });
}

/**
 * A draft's receiving choice. Returns the request columns to write with it. An account named for
 * this claim lives in one unfrozen working row; a draft that stops naming one keeps no ciphertext.
 * Call under the request lock.
 */
export async function applyDraftPayout(tx: any, companyId: string, requestId: string, write: DraftPayoutWrite): Promise<Record<string, unknown>> {
  if (write.mode !== 'SPECIFIED') {
    await tx.reimbursementPayoutDestination.deleteMany({ where: { companyId, reimbursementRequestId: requestId, frozenAt: null } });
    return { payoutMethod: write.mode === 'CASH' ? 'CASH' : null, payoutDestinationVersion: null, payoutFingerprint: null };
  }
  const versions = await listVersions(tx, companyId, requestId);
  const working = versions.find((row) => !row.frozenAt);
  const columns = { ...write.destination, source: write.source, createdByUserId: write.actorUserId };
  const version = working?.version ?? (versions[0]?.version ?? 0) + 1;
  if (working) await tx.reimbursementPayoutDestination.update({ where: { id: working.id }, data: columns });
  else await tx.reimbursementPayoutDestination.create({ data: { companyId, reimbursementRequestId: requestId, version, ...columns } });
  return { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: version, payoutFingerprint: null };
}

/** The freeze a submit would make, from what is stored right now. */
export async function readSubmitPayoutPlan(client: any, claim: ClaimPayoutPointer): Promise<SubmitPayoutPlan> {
  const [versions, account] = await Promise.all([
    listVersions(client, claim.companyId, claim.id),
    claim.payoutMethod ? null : readMemberPayoutAccount(client, claim.companyId, claim.requesterUserId),
  ]);
  return planSubmitPayout(claim, versions.map(({ id: _id, ...row }) => row), account);
}

/**
 * The payout side of a submit, wholly inside the submit transaction and under the request lock.
 * Nothing about the account is read before the transaction: here the requester's default row is
 * locked (when the draft follows it), what to freeze is decided, it is checked against what the
 * submitter was shown, the claim's own copy is frozen, and the columns the claim's hash is made from
 * are returned. So the stored hash, the claim's fingerprint and the frozen row are one decision.
 */
export async function freezePayoutAtSubmit(tx: any, claim: ClaimPayoutPointer, input: {
  actorUserId: string;
  frozenAt: Date;
  /** `payout.submitToken` of the detail the submitter was looking at. */
  seenToken?: unknown;
}): Promise<{ plan: FrozenPayoutPlan; columns: SubmitPayoutColumns }> {
  // A default-account edit waits for this submit to commit, and this submit waits for one already
  // under way: the account copied below is the account planned from.
  if (!claim.payoutMethod) {
    await tx.$queryRaw`SELECT 1 FROM "MemberPayoutAccount" WHERE "companyId" = ${claim.companyId} AND "userId" = ${claim.requesterUserId} FOR UPDATE`;
  }
  const plan = await readSubmitPayoutPlan(tx, claim);
  // Every payout refusal on submit and approve is a 409: a browser tab opened before the release
  // has no words for these codes, and its text for a conflict is "load the latest and try again".
  if ('error' in plan) throw new ConflictException(plan.error);
  // Show before freeze: whatever account the claim is sent with must be the one the submitter saw,
  // whether it comes from the default or was typed into this claim (by the requester in another tab,
  // or by whoever prepared the claim for them). Only cash the draft itself chose depends on nothing
  // that was shown, and has to match only when a token is sent.
  if ((plan.followsDefault || plan.payoutMethod === 'BANK_TRANSFER' || input.seenToken != null) && input.seenToken !== payoutSubmitToken(claim.id, plan)) {
    throw new ConflictException('payout_destination_changed');
  }
  if (plan.payoutMethod === 'BANK_TRANSFER') {
    const where = { companyId: claim.companyId, reimbursementRequestId: claim.id, version: plan.version };
    if (plan.action === 'COPY_DEFAULT') {
      const account = await tx.memberPayoutAccount.findFirst({ where: { companyId: claim.companyId, userId: claim.requesterUserId } });
      if (!account?.accountNumberEncrypted || account.fingerprint !== plan.fingerprint) throw new ConflictException('payout_destination_changed');
      // The sealed columns are copied as one unit, so the copy's last 4 still match its ciphertext.
      await tx.reimbursementPayoutDestination.create({ data: {
        ...where, payoutKind: account.payoutKind, bankName: account.bankName, accountName: account.accountName,
        accountNumberEncrypted: account.accountNumberEncrypted, accountLast4: account.accountLast4, fingerprint: account.fingerprint,
        source: 'DEFAULT_ACCOUNT', createdByUserId: input.actorUserId, frozenAt: input.frozenAt,
      } });
    } else {
      const changed = plan.action === 'FREEZE'
        ? await tx.reimbursementPayoutDestination.updateMany({ where: { ...where, frozenAt: null }, data: { frozenAt: input.frozenAt } })
        // The same account sent again: an attestation made in an earlier round no longer counts.
        : await tx.reimbursementPayoutDestination.updateMany({
          where: { ...where, frozenAt: { not: null } },
          data: { verifiedByUserId: null, verifiedAt: null, verifiedVia: null, approvalStepId: null },
        });
      if (changed.count !== 1) throw new ConflictException('payout_destination_changed');
    }
  }
  return { plan, columns: submitPayoutColumns(plan) };
}

/**
 * Records "ตรวจบัญชีแล้ว" on the exact version the approver named, inside the approval transaction.
 * A claim paid by transfer is not approved without it; cash and legacy claims pass untouched.
 */
export async function attestClaimPayout(tx: any, claim: ClaimPayoutPointer, attestation: {
  verifiedVersion?: unknown;
  actorUserId: string;
  verifiedAt: Date;
  approvalStepId: string;
}): Promise<void> {
  const error = payoutAttestationError(claim, attestation.verifiedVersion);
  if (error) throw new ConflictException(error);
  // Nothing to attest: cash, or a legacy claim (sent without a snapshot, whatever its draft chose).
  if (claim.payoutMethod !== 'BANK_TRANSFER' || !hasPayoutSnapshot(claim)) return;
  const changed = await tx.reimbursementPayoutDestination.updateMany({
    where: {
      companyId: claim.companyId, reimbursementRequestId: claim.id, version: claim.payoutDestinationVersion,
      fingerprint: claim.payoutFingerprint ?? '', frozenAt: { not: null },
    },
    data: {
      verifiedByUserId: attestation.actorUserId, verifiedAt: attestation.verifiedAt,
      verifiedVia: 'APPROVAL', approvalStepId: attestation.approvalStepId,
    },
  });
  if (changed.count !== 1) throw new ConflictException('payout_destination_changed');
}

/** The request columns of a claim going back to draft: see `draftFollowsDefaultAfterReopen`. */
export async function draftPayoutAfterReopen(tx: any, claim: ClaimPayoutPointer): Promise<Record<string, unknown>> {
  if (!claim.payoutMethod) return {};
  // A draft never carries the fingerprint: only the next submit writes it again.
  if (claim.payoutMethod !== 'BANK_TRANSFER') return { payoutFingerprint: null };
  const versions = await listVersions(tx, claim.companyId, claim.id);
  return draftFollowsDefaultAfterReopen(claim, versions)
    ? { payoutMethod: null, payoutDestinationVersion: null, payoutFingerprint: null }
    : { payoutFingerprint: null };
}
