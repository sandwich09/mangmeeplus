/**
 * Database side of the reimbursement payout account (payout spec §8–§10). Plain functions over a
 * Prisma client or transaction, called from the repository's own transactions — the same shape as
 * `reimbursement-source.ts`. The rules themselves live in `../domain/logic/payout-destination.logic.ts`.
 *
 * Two things hold for every function here:
 *  - the ciphertext is selected only by the `…Secret` readers, which serve the audited reveal,
 *    and by the copies that move a sealed account as one unit: when promoting a saved account,
 *    at submit, in a correction round
 *    (the requester's default account, or the account the claim had), and at the payment of a
 *    legacy claim;
 *  - once a claim is submitted, nothing reads the member's default account for it again. The one
 *    exception is a legacy claim, which froze no account: its payer is shown the requester's current
 *    default (`readLegacyPayoutDefault`) and a payment into it keeps a copy (`confirmPaymentPayout`).
 */
import { BadRequestException, ConflictException, NotFoundException, type HttpException } from '@nestjs/common';
import { PAYOUT_SAVED_ACCOUNT_LIMIT } from '@watchdog-bms/contracts';
import type {
  ReimbursementLegacyPayoutDefault,
  ReimbursementPayoutKind,
  ReimbursementPayoutMethod,
  ReimbursementPayoutNotReadyReason,
  ReimbursementPayoutSource,
  ReimbursementRequestStatus,
  SavedPayoutAccountSummary,
  PayoutHolderFacts,
  ReimbursementPayoutHolderType,
} from '@watchdog-bms/contracts';
import {
  CASH_PAYOUT_FINGERPRINT,
  claimPayoutFingerprint,
  draftFollowsDefaultAfterReopen,
  hasPayoutSnapshot,
  LEGACY_PAYMENT_PAYOUT_SOURCE,
  legacyPayoutConfirmToken,
  payoutAttestationError,
  payoutDefaultToken,
  payoutSubmitToken,
  planSubmitPayout,
  submitPayoutColumns,
  type FrozenPayoutPlan,
  type PaymentPayoutError,
  type PaymentPayoutPlan,
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
  /** Set only when someone other than the requester typed the account, or set the default it was copied from. */
  enteredByUserId?: string;
  holderType?: ReimbursementPayoutHolderType;
  verifiedByUserId?: string;
  verifiedAt?: Date;
  notReadyReason?: ReimbursementPayoutNotReadyReason;
};

export type DraftPayoutWrite =
  | { mode: 'DEFAULT' }
  | { mode: 'CASH' }
  | { mode: 'SPECIFIED'; destination: SealedPayoutDestination & Partial<PayoutHolderFacts>; source: 'REQUESTER' | 'PREPARER' | 'SAVED_ACCOUNT'; actorUserId: string }
  | { mode: 'SAVED'; savedAccountId: string; requesterUserId: string; actorUserId: string; key: Buffer };

export type DraftPayoutChange = {
  write: DraftPayoutWrite;
  onPersisted?: (tx: any, requestId: string) => Promise<void>;
  onChanged?: (tx: any, requestId: string, given: ClaimPayoutRecord | undefined) => Promise<void>;
};

/** What a claim in a correction round may be given: a draft's three choices, or the account it was approved with (`payoutCorrectionRoundStart`). */
export type CorrectionPayoutWrite = DraftPayoutWrite | { mode: 'PREVIOUS' };

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

// ---- Other saved accounts: always scoped to their owning membership, never read by default paths ----

export type SavedPayoutAccountRecord = Omit<SavedPayoutAccountSummary, 'createdAt'> & { createdAt: Date };
export type SavedPayoutAccountWrite = PayoutHolderFacts & {
  companyId: string; userId: string; label?: string; destination: SealedPayoutDestination;
};
export type SavedPayoutAccountCopy = Omit<SavedPayoutAccountRecord, 'bankName'> & SealedPayoutDestination;

const SAVED_ACCOUNT_COLUMNS = {
  id: true, label: true, holderType: true, holderNote: true, payoutKind: true, bankName: true,
  accountName: true, accountLast4: true, createdAt: true,
} as const;

function toSavedAccount(row: any): SavedPayoutAccountRecord {
  return {
    id: row.id, label: opt(row.label), holderType: row.holderType, holderNote: opt(row.holderNote),
    payoutKind: row.payoutKind, bankName: opt(row.bankName), accountName: row.accountName,
    accountLast4: row.accountLast4, createdAt: row.createdAt,
  };
}

export async function listSavedPayoutAccounts(client: any, companyId: string, userId: string): Promise<SavedPayoutAccountRecord[]> {
  const rows = await client.memberSavedPayoutAccount.findMany({
    where: { companyId, userId }, select: SAVED_ACCOUNT_COLUMNS, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toSavedAccount);
}

export async function readSavedPayoutAccount(client: any, companyId: string, userId: string, id: string): Promise<SavedPayoutAccountRecord | null> {
  const row = await client.memberSavedPayoutAccount.findFirst({ where: { companyId, userId, id }, select: SAVED_ACCOUNT_COLUMNS });
  return row ? toSavedAccount(row) : null;
}

/** Reveal only. */
export async function readSavedPayoutSecret(client: any, companyId: string, userId: string, id: string): Promise<string | null> {
  const row = await client.memberSavedPayoutAccount.findFirst({ where: { companyId, userId, id }, select: { accountNumberEncrypted: true } });
  return row?.accountNumberEncrypted ?? null;
}

/** Copies only: a sealed account moves as one unit, without opening its number. */
export async function readSavedPayoutAccountForCopy(client: any, companyId: string, userId: string, id: string): Promise<SavedPayoutAccountCopy | null> {
  const row = await client.memberSavedPayoutAccount.findFirst({
    where: { companyId, userId, id }, select: { ...SAVED_ACCOUNT_COLUMNS, accountNumberEncrypted: true, fingerprint: true },
  });
  return row ? { ...toSavedAccount(row), bankName: row.bankName, accountNumberEncrypted: row.accountNumberEncrypted, fingerprint: row.fingerprint } : null;
}

async function lockSavedPayoutMember(tx: any, companyId: string, userId: string): Promise<void> {
  // One membership lock serializes saved-list mutations, including the count when the list is empty.
  await tx.$queryRaw`SELECT 1 FROM "CompanyMembership" WHERE "companyId" = ${companyId} AND "userId" = ${userId} FOR NO KEY UPDATE`;
}

/** Reuse under the membership lock before inserting: unique violations abort draft transactions. */
export async function savePayoutAccountForLater(tx: any, data: SavedPayoutAccountWrite): Promise<{ account: SavedPayoutAccountRecord; added: boolean }> {
  await lockSavedPayoutMember(tx, data.companyId, data.userId);
  const existing = await tx.memberSavedPayoutAccount.findFirst({
    where: { companyId: data.companyId, userId: data.userId, fingerprint: data.destination.fingerprint }, select: SAVED_ACCOUNT_COLUMNS,
  });
  return existing ? { account: toSavedAccount(existing), added: false } : { account: await addSavedPayoutAccount(tx, data), added: true };
}

export async function addSavedPayoutAccount(tx: any, data: SavedPayoutAccountWrite): Promise<SavedPayoutAccountRecord> {
  await lockSavedPayoutMember(tx, data.companyId, data.userId);
  await tx.$queryRaw`SELECT 1 FROM "MemberPayoutAccount" WHERE "companyId" = ${data.companyId} AND "userId" = ${data.userId} FOR UPDATE`;
  const current = await readMemberPayoutAccount(tx, data.companyId, data.userId);
  if (current?.fingerprint === data.destination.fingerprint) throw new ConflictException('payout_saved_account_is_default');
  if (await tx.memberSavedPayoutAccount.count({ where: { companyId: data.companyId, userId: data.userId } }) >= PAYOUT_SAVED_ACCOUNT_LIMIT) {
    throw new ConflictException('payout_saved_account_limit');
  }
  try {
    const row = await tx.memberSavedPayoutAccount.create({
      data: { companyId: data.companyId, userId: data.userId, label: data.label ?? null, holderType: data.holderType, holderNote: data.holderNote ?? null, ...data.destination },
      select: SAVED_ACCOUNT_COLUMNS,
    });
    return toSavedAccount(row);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') throw new ConflictException('payout_saved_account_duplicate');
    throw error;
  }
}

export async function deleteSavedPayoutAccount(tx: any, companyId: string, userId: string, id: string): Promise<SavedPayoutAccountRecord> {
  await lockSavedPayoutMember(tx, companyId, userId);
  const before = await readSavedPayoutAccount(tx, companyId, userId, id);
  if (!before) throw new NotFoundException('payout_saved_account_not_found');
  await tx.memberSavedPayoutAccount.deleteMany({ where: { companyId, userId, id } });
  return before;
}

export async function makeSavedPayoutAccountDefault(
  tx: any, companyId: string, userId: string, id: string,
  writeDefault: (destination: SealedPayoutDestination) => Promise<MemberPayoutAccountRecord>,
): Promise<{ saved: SavedPayoutAccountRecord; account: MemberPayoutAccountRecord }> {
  await lockSavedPayoutMember(tx, companyId, userId);
  await tx.$queryRaw`SELECT 1 FROM "MemberPayoutAccount" WHERE "companyId" = ${companyId} AND "userId" = ${userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT 1 FROM "MemberSavedPayoutAccount" WHERE "companyId" = ${companyId} AND "userId" = ${userId} AND "id" = ${id} FOR UPDATE`;
  const saved = await readSavedPayoutAccountForCopy(tx, companyId, userId, id);
  if (!saved) throw new NotFoundException('payout_saved_account_not_found');
  if (saved.holderType !== 'SELF') throw new ConflictException('payout_default_must_be_own');
  // The old default is selected with its ciphertext only because it is copied into the saved list.
  const old = await tx.memberPayoutAccount.findFirst({ where: { companyId, userId }, select: {
    payoutMethod: true, payoutKind: true, bankName: true, accountName: true, accountNumberEncrypted: true, accountLast4: true, fingerprint: true,
  } });
  const account = await writeDefault({
    payoutKind: saved.payoutKind, bankName: saved.bankName, accountName: saved.accountName,
    accountNumberEncrypted: saved.accountNumberEncrypted, accountLast4: saved.accountLast4, fingerprint: saved.fingerprint,
  });
  await tx.memberSavedPayoutAccount.deleteMany({ where: { companyId, userId, id } });
  if (old?.payoutMethod === 'BANK_TRANSFER') {
    const { payoutMethod: _method, ...destination } = old;
    await tx.memberSavedPayoutAccount.createMany({
      data: [{ companyId, userId, label: null, holderType: 'SELF', holderNote: null, ...destination }], skipDuplicates: true,
    });
  }
  return { saved: toSavedAccount(saved), account };
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
    // Typed by a preparer, or copied from a default someone else set: anyone but the requester is named.
    ...(row.createdByUserId !== claim.requesterUserId && { enteredByUserId: row.createdByUserId }),
    // An attestation belongs to a sent claim: a draft is about to be frozen and attested again.
    ...(claim.status !== 'DRAFT' && row.verifiedAt && { verifiedByUserId: row.verifiedByUserId, verifiedAt: row.verifiedAt }),
  };
}

/** One account a claim has been sent with, masked: a row of the claim page's account history. */
export type ClaimPayoutVersionRecord = {
  version: number;
  payoutKind: ReimbursementPayoutKind;
  bankName?: string;
  accountName: string;
  accountLast4: string;
  source: ReimbursementPayoutSource;
  enteredByUserId?: string;
  frozenAt: Date;
  verifiedByUserId?: string;
  verifiedAt?: Date;
  approvalStepId?: string;
};

/**
 * Every account the claim has been sent with, oldest first, masked like the claim's current one: the
 * account history of the claim page (spec §17.2). Frozen rows only: a draft's working row is the
 * draft's own choice, which `readClaimPayout` shows. Never the copy of the requester's default kept
 * with a legacy claim's payment: that row belongs to its payment, and the claim never pointed at it.
 */
export async function readClaimPayoutVersions(client: any, claim: ClaimPayoutPointer): Promise<ClaimPayoutVersionRecord[]> {
  const rows: any[] = await client.reimbursementPayoutDestination.findMany({
    where: { companyId: claim.companyId, reimbursementRequestId: claim.id, frozenAt: { not: null }, source: { not: LEGACY_PAYMENT_PAYOUT_SOURCE } },
    select: {
      version: true, payoutKind: true, bankName: true, accountName: true, accountLast4: true, source: true,
      createdByUserId: true, frozenAt: true, verifiedByUserId: true, verifiedAt: true, approvalStepId: true,
    },
  });
  return rows.sort((a, b) => a.version - b.version).map((row) => ({
    version: row.version, payoutKind: row.payoutKind, ...(row.bankName && { bankName: row.bankName }), accountName: row.accountName,
    accountLast4: row.accountLast4, source: row.source, frozenAt: row.frozenAt,
    // The same two rules as the claim's current account (`readClaimPayout`): anyone but the requester
    // is named, and the version a draft is about to be sent with again carries no attestation.
    ...(row.createdByUserId !== claim.requesterUserId && { enteredByUserId: row.createdByUserId }),
    ...(row.verifiedAt && !(claim.status === 'DRAFT' && row.version === claim.payoutDestinationVersion) && {
      verifiedByUserId: row.verifiedByUserId, verifiedAt: row.verifiedAt, ...(row.approvalStepId && { approvalStepId: row.approvalStepId }),
    }),
  }));
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
    select: { id: true, version: true, fingerprint: true, source: true, frozenAt: true, holderType: true },
    orderBy: { version: 'desc' },
  });
}

/**
 * A draft's receiving choice. Returns the request columns to write with it. An account named for
 * this claim lives in one unfrozen working row; a draft that stops naming one keeps no ciphertext.
 * Call under the request lock.
 */
export async function applyDraftPayout(tx: any, companyId: string, requestId: string, write: DraftPayoutWrite): Promise<Record<string, unknown>> {
  if (write.mode === 'SAVED') {
    const saved = write.actorUserId === write.requesterUserId ? await readSavedPayoutAccountForCopy(tx, companyId, write.requesterUserId, write.savedAccountId) : null;
    if (!saved) throw new NotFoundException('payout_saved_account_not_found');
    return applyDraftPayout(tx, companyId, requestId, { mode: 'SPECIFIED', source: 'SAVED_ACCOUNT', actorUserId: write.actorUserId, destination: {
      payoutKind: saved.payoutKind, bankName: saved.bankName, accountName: saved.accountName,
      accountNumberEncrypted: saved.accountNumberEncrypted, accountLast4: saved.accountLast4,
      holderType: saved.holderType, holderNote: saved.holderNote,
      fingerprint: claimPayoutFingerprint(saved.fingerprint, saved, write.key),
    } });
  }
  if (write.mode !== 'SPECIFIED') {
    if (write.mode !== 'DEFAULT' && write.mode !== 'CASH') throw new BadRequestException('payout_mode_invalid');
    await tx.reimbursementPayoutDestination.deleteMany({ where: { companyId, reimbursementRequestId: requestId, frozenAt: null } });
    return { payoutMethod: write.mode === 'CASH' ? 'CASH' : null, payoutDestinationVersion: null, payoutFingerprint: null };
  }
  const versions = await listVersions(tx, companyId, requestId);
  const working = versions.find((row) => !row.frozenAt);
  const columns = { ...write.destination, holderType: write.destination.holderType ?? 'SELF', holderNote: write.destination.holderNote ?? null, source: write.source, createdByUserId: write.actorUserId };
  const version = working?.version ?? (versions[0]?.version ?? 0) + 1;
  if (working) await tx.reimbursementPayoutDestination.update({ where: { id: working.id }, data: columns });
  else await tx.reimbursementPayoutDestination.create({ data: { companyId, reimbursementRequestId: requestId, version, ...columns } });
  return { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: version, payoutFingerprint: null };
}

/** Draft creation and edits use the same comparison, inside their transaction and request lock.
 * The submit token compares method, following the default and the full keyed destination fingerprint,
 * never random ciphertext, a working-row version or just the last four digits.
 */
export async function applyDraftPayoutChange(tx: any, claim: ClaimPayoutPointer, change: DraftPayoutChange, creating = false): Promise<Record<string, unknown>> {
  if (change.write.mode === 'SAVED' && (change.write.requesterUserId !== claim.requesterUserId || change.write.actorUserId !== claim.requesterUserId)) throw new NotFoundException('payout_saved_account_not_found');
  const before = change.onChanged && !creating ? payoutSubmitToken(claim.id, await readSubmitPayoutPlan(tx, claim)) : undefined;
  const columns = await applyDraftPayout(tx, claim.companyId, claim.id, change.write);
  await change.onPersisted?.(tx, claim.id);
  if (change.onChanged) {
    const after = { ...claim, ...columns };
    if (creating || before !== payoutSubmitToken(claim.id, await readSubmitPayoutPlan(tx, after))) {
      const given = await readDraftDefaultPayout(tx, after) ?? await readClaimPayout(tx, after);
      await change.onChanged(tx, claim.id, given && { ...given, holderType: await readClaimPayoutHolderType(tx, after) });
    }
  }
  return columns;
}

/** The freeze a submit would make, from what is stored right now. */
export async function readSubmitPayoutPlan(client: any, claim: ClaimPayoutPointer): Promise<SubmitPayoutPlan> {
  const [versions, account] = await Promise.all([
    listVersions(client, claim.companyId, claim.id),
    claim.payoutMethod ? null : readMemberPayoutAccount(client, claim.companyId, claim.requesterUserId),
  ]);
  return planSubmitPayout(claim, versions.map(({ id: _id, ...row }) => row), account);
}

/** Server-side routing/attestation fact; the masked screen payload is wired separately. */
export async function readClaimPayoutHolderType(client: any, claim: ClaimPayoutPointer): Promise<ReimbursementPayoutHolderType | undefined> {
  if (claim.payoutMethod !== 'BANK_TRANSFER' || claim.payoutDestinationVersion == null) return undefined;
  const row = await client.reimbursementPayoutDestination.findFirst({
    where: { companyId: claim.companyId, reimbursementRequestId: claim.id, version: claim.payoutDestinationVersion }, select: { holderType: true },
  });
  return row?.holderType;
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
  expectedThirdParty?: boolean;
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
  if (input.expectedThirdParty !== undefined && input.expectedThirdParty !== (plan.payoutMethod === 'BANK_TRANSFER' && plan.thirdParty === true)) throw new ConflictException('payout_destination_changed');
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
      // "Who entered this account" is whoever last set the default, not whoever pressed send: the
      // approver is shown that name when it is not the requester's (the submitter is on the claim).
      await tx.reimbursementPayoutDestination.create({ data: {
        ...where, payoutKind: account.payoutKind, bankName: account.bankName, accountName: account.accountName,
        accountNumberEncrypted: account.accountNumberEncrypted, accountLast4: account.accountLast4, fingerprint: account.fingerprint,
        source: 'DEFAULT_ACCOUNT', createdByUserId: account.updatedByUserId, frozenAt: input.frozenAt,
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
 * The payout side of a correction round (payout spec §14.5), inside its transaction and under the
 * request lock: the account the claim is given is frozen at once as a NEW version of the claim, and
 * the columns the claim's hash is made from are returned. A new version also when the account is the
 * one the claim had: what is approved next is this row, never the one set aside. Earlier versions
 * stay as they are, attestation included. Cash freezes no row.
 *
 * "Use the default account" copies the requester's default as it is now, the way a submit does, and
 * is held to what the page showed (`payoutDefaultToken`) unless that default was set in this same
 * transaction, which is then exactly what was typed. "The account the claim had" copies the version
 * the claim was approved with before the round, so a claim sent back by mistake gets its account back
 * without anyone typing it.
 */
export async function freezePayoutCorrection(tx: any, claim: ClaimPayoutPointer, input: {
  write: CorrectionPayoutWrite;
  frozenAt: Date;
  seenDefaultToken?: unknown;
  defaultSetInThisTransaction?: boolean;
  /** For "the account the claim had": what the claim was approved with when its round began. */
  previous?: { payoutMethod?: string; payoutVersion?: number };
}): Promise<SubmitPayoutColumns> {
  const cash: SubmitPayoutColumns = { payoutMethod: 'CASH', payoutDestinationVersion: null, payoutFingerprint: CASH_PAYOUT_FINGERPRINT };
  if (input.write.mode === 'CASH') return cash;
  const row = { companyId: claim.companyId, reimbursementRequestId: claim.id, frozenAt: input.frozenAt };
  const nextVersion = async () => ((await listVersions(tx, claim.companyId, claim.id))[0]?.version ?? 0) + 1;
  if (input.write.mode === 'PREVIOUS') {
    // A claim sent before claims carried a receiving method had no account of its own to keep.
    if (!input.previous?.payoutMethod) throw new ConflictException('payout_destination_required');
    if (input.previous.payoutMethod === 'CASH') return cash;
    const approved = input.previous.payoutVersion === undefined ? null : await tx.reimbursementPayoutDestination.findFirst({
      where: { companyId: claim.companyId, reimbursementRequestId: claim.id, version: input.previous.payoutVersion, frozenAt: { not: null }, source: { not: LEGACY_PAYMENT_PAYOUT_SOURCE } },
    });
    if (!approved) throw new ConflictException('payout_destination_changed');
    const version = await nextVersion();
    // Nobody types anything: the sealed columns move as one unit, with who entered that account as it was.
    await tx.reimbursementPayoutDestination.create({ data: {
      ...row, version, payoutKind: approved.payoutKind, bankName: approved.bankName, accountName: approved.accountName,
      accountNumberEncrypted: approved.accountNumberEncrypted, accountLast4: approved.accountLast4, fingerprint: approved.fingerprint,
      source: approved.source, createdByUserId: approved.createdByUserId,
    } });
    return { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: version, payoutFingerprint: approved.fingerprint };
  }
  if (input.write.mode === 'SPECIFIED') {
    const version = await nextVersion();
    await tx.reimbursementPayoutDestination.create({ data: { ...row, version, ...input.write.destination, source: input.write.source, createdByUserId: input.write.actorUserId } });
    return { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: version, payoutFingerprint: input.write.destination.fingerprint };
  }
  // An edit of the default waits for this correction, and this correction for one already under way.
  await tx.$queryRaw`SELECT 1 FROM "MemberPayoutAccount" WHERE "companyId" = ${claim.companyId} AND "userId" = ${claim.requesterUserId} FOR UPDATE`;
  const account = await tx.memberPayoutAccount.findFirst({ where: { companyId: claim.companyId, userId: claim.requesterUserId } });
  if (!account) throw new ConflictException('payout_method_required');
  if (!input.defaultSetInThisTransaction && input.seenDefaultToken !== payoutDefaultToken(claim.id, account)) throw new ConflictException('payout_destination_changed');
  if (account.payoutMethod === 'CASH') return cash;
  if (!account.accountNumberEncrypted || !account.fingerprint) throw new ConflictException('payout_destination_required');
  const version = await nextVersion();
  // The sealed columns move as one unit, and "who entered it" is whoever last set the default: as at submit.
  await tx.reimbursementPayoutDestination.create({ data: {
    ...row, version, payoutKind: account.payoutKind, bankName: account.bankName, accountName: account.accountName,
    accountNumberEncrypted: account.accountNumberEncrypted, accountLast4: account.accountLast4, fingerprint: account.fingerprint,
    source: 'DEFAULT_ACCOUNT', createdByUserId: account.updatedByUserId,
  } });
  return { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: version, payoutFingerprint: account.fingerprint };
}

/**
 * Records "ตรวจบัญชีแล้ว" on the exact version the approver named, inside the approval transaction.
 * A claim paid by transfer is not approved without it; cash and legacy claims pass untouched.
 */
export async function attestClaimPayout(tx: any, claim: ClaimPayoutPointer, attestation: {
  verifiedVersion?: unknown;
  thirdPartyAccepted?: unknown;
  actorUserId: string;
  verifiedAt: Date;
  approvalStepId: string;
}): Promise<void> {
  const holderType = hasPayoutSnapshot(claim) ? await readClaimPayoutHolderType(tx, claim) : undefined;
  const error = payoutAttestationError({ ...claim, holderType }, attestation.verifiedVersion, attestation.thirdPartyAccepted);
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

// ---- The payment step (payout spec §12.3, §15) ----

/** An account as a payment row shows it: masked, the same for every reader. */
export type PaymentPayoutDestinationRecord = {
  version: number;
  payoutKind: ReimbursementPayoutKind;
  bankName?: string;
  accountName: string;
  accountLast4: string;
};

/**
 * How a payer's statement that the claim does not accept is answered. 409, like the payout refusals
 * of submit and approve: a page opened before the release has no words for these codes, and its text
 * for a conflict is "load the latest and try again". The guard on the reason is the 400 it is on
 * every other note that may not carry an account number.
 */
export function paymentPayoutRefusal(error: PaymentPayoutError): HttpException {
  return error === 'note_contains_account_number' ? new BadRequestException(error) : new ConflictException(error);
}

/** What recording a payment did about its account, for the audit row. Never the number. */
export type ConfirmedPaymentPayout = {
  payoutDestinationVersion: number;
  payoutConfirmedAt: Date;
  /** CLAIM: the claim's own snapshot. MEMBER_DEFAULT: a copy of the requester's default, on a legacy claim. */
  source: 'CLAIM' | 'MEMBER_DEFAULT';
  payoutKind: string;
  bankName: string | null;
  accountLast4: string;
  /** Nobody but the requester had checked this account, so the payer is now recorded as who did (§10.2). */
  payerVerified: boolean;
};

/**
 * The accounts the given versions of a claim name, masked, by version: what each payment row of the
 * claim shows as the account it was confirmed into.
 */
export async function readPaymentPayoutDestinations(
  client: any, companyId: string, requestId: string, versions: readonly number[],
): Promise<Record<number, PaymentPayoutDestinationRecord>> {
  if (versions.length === 0) return {};
  const rows = await client.reimbursementPayoutDestination.findMany({
    where: { companyId, reimbursementRequestId: requestId, version: { in: [...versions] } },
    select: { version: true, payoutKind: true, bankName: true, accountName: true, accountLast4: true },
  });
  return Object.fromEntries(rows.map((row: any) => [row.version, {
    version: row.version, payoutKind: row.payoutKind, ...(row.bankName && { bankName: row.bankName }),
    accountName: row.accountName, accountLast4: row.accountLast4,
  }]));
}

/**
 * Whether the account a claim holds now is the very account one of its earlier versions named: the same
 * kind, bank, account name and number. Answered from the two stored fingerprints, and only the answer
 * leaves: the approver of a correction round is told "the same account", never what was compared
 * (payout spec §14.6). False for cash and for a claim with no snapshot, which have no account to compare.
 */
export async function claimPayoutMatchesVersion(client: any, claim: ClaimPayoutPointer, version: number): Promise<boolean> {
  if (claim.payoutMethod !== 'BANK_TRANSFER' || !hasPayoutSnapshot(claim)) return false;
  const row = await client.reimbursementPayoutDestination.findFirst({
    where: { companyId: claim.companyId, reimbursementRequestId: claim.id, version, frozenAt: { not: null }, source: { not: LEGACY_PAYMENT_PAYOUT_SOURCE } },
    select: { fingerprint: true },
  });
  return !!row?.fingerprint && row.fingerprint === claim.payoutFingerprint;
}

/**
 * Whether what a round's answer froze (`columns`) is the very destination the claim was approved with
 * when the round began (`start`): cash both times, or the same account by `claimPayoutMatchesVersion`.
 * Asked ONCE, inside the transaction that takes the answer, and kept on the round's log entry
 * (`sameAsApproved`): a list row, a queue row, a notice and the LINE backlog then say "the same account"
 * without a query each (payout spec §14.6). A claim that had no account, or changed its method, kept nothing.
 */
export async function payoutCorrectionKeptDestination(
  tx: any, claim: ClaimPayoutPointer, columns: SubmitPayoutColumns, start: { payoutMethod?: string; payoutVersion?: number } | undefined,
): Promise<boolean> {
  if (start?.payoutMethod === 'CASH') return columns.payoutMethod === 'CASH';
  if (start?.payoutMethod !== 'BANK_TRANSFER' || start.payoutVersion === undefined) return false;
  return claimPayoutMatchesVersion(tx, { ...claim, ...columns }, start.payoutVersion);
}

/**
 * A legacy claim's payer is shown the REQUESTER's default account as it is now (spec §15): masked,
 * with the token that names it. Null when the requester has no account to transfer into (no default,
 * or a cash default). The caller has already established that the claim is legacy and payable and
 * that the viewer may record its payment; nothing else reads a default on behalf of a sent claim.
 */
export async function readLegacyPayoutDefault(
  client: any, claim: { id: string; companyId: string; requesterUserId: string },
): Promise<ReimbursementLegacyPayoutDefault | null> {
  const account = await readMemberPayoutAccount(client, claim.companyId, claim.requesterUserId);
  if (account?.payoutMethod !== 'BANK_TRANSFER' || !account.payoutKind || !account.accountName || !account.accountLast4 || !account.fingerprint) return null;
  return {
    payoutKind: account.payoutKind, ...(account.bankName && { bankName: account.bankName }),
    accountName: account.accountName, accountLast4: account.accountLast4,
    confirmToken: legacyPayoutConfirmToken(claim.id, account.fingerprint),
  };
}

type ResolvedPaymentPayout =
  | { kind: 'NONE' }
  | { kind: 'CLAIM'; row: { id: string; version: number; payoutKind: string; bankName: string | null; accountLast4: string; verifiedByUserId: string | null } }
  | { kind: 'MEMBER_DEFAULT'; account: any };

/**
 * A payment's payout plan held against what is stored. The claim's own snapshot must be the exact
 * frozen row its fingerprint was made from; a legacy claim's default must still be the account the
 * payer was shown. Anything else: the account changed since the page was loaded.
 */
async function resolvePaymentPayout(client: any, claim: ClaimPayoutPointer, plan: PaymentPayoutPlan): Promise<ResolvedPaymentPayout> {
  if (plan.payoutDestinationVersion !== undefined) {
    const row = await client.reimbursementPayoutDestination.findFirst({
      where: {
        companyId: claim.companyId, reimbursementRequestId: claim.id, version: plan.payoutDestinationVersion,
        fingerprint: claim.payoutFingerprint ?? '', frozenAt: { not: null },
      },
      select: { id: true, version: true, payoutKind: true, bankName: true, accountLast4: true, verifiedByUserId: true },
    });
    if (!row) throw new ConflictException('payout_destination_changed');
    return { kind: 'CLAIM', row };
  }
  if (plan.payoutDefaultToken !== undefined) {
    const account = await client.memberPayoutAccount.findFirst({ where: { companyId: claim.companyId, userId: claim.requesterUserId } });
    if (account?.payoutMethod !== 'BANK_TRANSFER' || !account.accountNumberEncrypted || !account.fingerprint
      || legacyPayoutConfirmToken(claim.id, account.fingerprint) !== plan.payoutDefaultToken) {
      throw new ConflictException('payout_destination_changed');
    }
    return { kind: 'MEMBER_DEFAULT', account };
  }
  return { kind: 'NONE' };
}

/** Friendly check before the payment lock of what `confirmPaymentPayout` proves again under it. */
export async function assertPaymentPayoutUsable(client: any, claim: ClaimPayoutPointer, plan: PaymentPayoutPlan): Promise<void> {
  await resolvePaymentPayout(client, claim, plan);
}

/**
 * The payout side of recording a payment, inside the payment transaction and under the request lock:
 * the account the payer confirmed is proven current, and the payment gets the version it went into.
 *
 *  - The claim's own snapshot (spec §12.3): the version stored on the payment is the claim's current
 *    one, the same row the approver attested. Where nobody but the requester has checked that row
 *    (no approval step, or the requester approved their own claim) the payer is recorded as who did.
 *  - A legacy claim paid into the requester's default (§15): the default row is locked, so an edit
 *    of it waits for this payment or fails it; its sealed columns are copied as one unit into a
 *    frozen row of the claim's own table, and the payment points at that copy. The claim's payout
 *    columns are not touched: it stays a legacy claim, with the hash it was approved and signed under.
 */
export async function confirmPaymentPayout(tx: any, claim: ClaimPayoutPointer, plan: PaymentPayoutPlan, input: {
  actorUserId: string;
  confirmedAt: Date;
}): Promise<ConfirmedPaymentPayout | undefined> {
  if (plan.payoutDefaultToken !== undefined) {
    await tx.$queryRaw`SELECT 1 FROM "MemberPayoutAccount" WHERE "companyId" = ${claim.companyId} AND "userId" = ${claim.requesterUserId} FOR UPDATE`;
  }
  const resolved = await resolvePaymentPayout(tx, claim, plan);
  if (resolved.kind === 'NONE') return undefined;
  const attestation = { verifiedByUserId: input.actorUserId, verifiedAt: input.confirmedAt, verifiedVia: 'PAYMENT' };
  if (resolved.kind === 'CLAIM') {
    const { row } = resolved;
    const payerVerified = !row.verifiedByUserId || (row.verifiedByUserId === claim.requesterUserId && input.actorUserId !== claim.requesterUserId);
    if (payerVerified) await tx.reimbursementPayoutDestination.update({ where: { id: row.id }, data: { ...attestation, approvalStepId: null } });
    return {
      payoutDestinationVersion: row.version, payoutConfirmedAt: input.confirmedAt, source: 'CLAIM',
      payoutKind: row.payoutKind, bankName: row.bankName, accountLast4: row.accountLast4, payerVerified,
    };
  }
  const { account } = resolved;
  const version = ((await listVersions(tx, claim.companyId, claim.id))[0]?.version ?? 0) + 1;
  // "Who entered this account" is whoever last set the default, as for the copy a submit makes.
  await tx.reimbursementPayoutDestination.create({ data: {
    companyId: claim.companyId, reimbursementRequestId: claim.id, version,
    payoutKind: account.payoutKind, bankName: account.bankName, accountName: account.accountName,
    accountNumberEncrypted: account.accountNumberEncrypted, accountLast4: account.accountLast4, fingerprint: account.fingerprint,
    source: LEGACY_PAYMENT_PAYOUT_SOURCE, createdByUserId: account.updatedByUserId, frozenAt: input.confirmedAt, ...attestation,
  } });
  return {
    payoutDestinationVersion: version, payoutConfirmedAt: input.confirmedAt, source: 'MEMBER_DEFAULT',
    payoutKind: account.payoutKind, bankName: account.bankName, accountLast4: account.accountLast4, payerVerified: true,
  };
}

/**
 * A recorded payment's account in the terms a payment request states it, for the replay comparison
 * (`isSamePaymentRequest`): the claim's own account version, or, for a copy of the default kept with
 * a legacy claim's payment, the token of that account. Both keys always, so the pair replaces the
 * payment's own column when the two are compared.
 */
export async function readRecordedPaymentPayout(
  client: any, claim: { id: string; companyId: string }, payment: { payoutDestinationVersion?: number | null },
): Promise<{ payoutDestinationVersion: number | undefined; payoutDefaultToken: string | undefined }> {
  const version = payment.payoutDestinationVersion ?? undefined;
  const row = version === undefined ? null : await client.reimbursementPayoutDestination.findFirst({
    where: { companyId: claim.companyId, reimbursementRequestId: claim.id, version },
    select: { source: true, fingerprint: true },
  });
  return row?.source === LEGACY_PAYMENT_PAYOUT_SOURCE
    ? { payoutDestinationVersion: undefined, payoutDefaultToken: legacyPayoutConfirmToken(claim.id, row.fingerprint) }
    : { payoutDestinationVersion: version, payoutDefaultToken: undefined };
}
