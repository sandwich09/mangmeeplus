import { expenseSourceDescription } from '../../expenses/domain/logic/expense-source-description';
import { serializableTransaction } from '../../../common/database/serializable-transaction';
import { isSerializationFailure } from '../../../common/database/prisma-error';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';
import {
  civilDate, civilPeriodKey, hasPrivilegedGrant, todayCivilDate, LEDGER_SEQUENCE_KEY, isFuturePaymentDate, PAYMENT_DATE_IN_FUTURE,
  REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES, REIMBURSEMENT_PAYMENT_SLIP_MAX_FILES,
} from '@watchdog-bms/contracts';
import { expenseDraftNumberingEnabled, expenseNumberInTransaction } from '../../expenses/infrastructure/expense-number';
import { resolveReimbursementSourceLines, assertReimbursementSources, readReimbursementSource, sourceError, type SourceLine } from './reimbursement-source';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { isDeepStrictEqual } from 'node:util';
import { lockFundingEvidence } from '../../expenses/infrastructure/substitute-funding.guard';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { reimbursementDuplicateBlockNotice, reimbursementNeedsCorrection, reimbursementHubBucket, reimbursementPaymentVoidedNotice } from '@watchdog-bms/contracts';
import type {
  ReimbursementClaimSignatureRole, ReimbursementHubBucket, ReimbursementPayoutCorrectionReason, ReimbursementPayoutRoundAnswer, ReimbursementRequestStatus,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  Prisma, ReimbursementFinanceReviewStatus as FinanceReviewStatuses, ReimbursementRequestStatus as RequestStatuses,
} from '../../../generated/prisma/client';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import type { ReservedDocumentNumberRecord } from '../../data-model-core/domain/models/document-sequence.model';
import { branchScopeWhere, isBranchInScope, resolveBranchIds, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';
import { loadEntitledFeatureKeys } from '../../employee-access/application/entitlement.helper';
import { filterPermissionsByEntitlement } from '../../employee-access/domain/logic/feature-gate.logic';
import { resolveTransactionBranchId, requireTransactionBranchId } from '../../data-model-core/application/services/transaction-branch';
import { findAttachmentLinkConflict } from '../../data-model-core/domain/logic/attachment.logic';
import { assertActiveExpenseBranch, expenseRelatedToUserWhere } from '../../expenses/infrastructure/prisma-expense.repository';
import { buildReversalLines } from '../../ledger/domain/logic/journal-balance.logic';
import { calculateStatementLineMatchStatus } from '../../banking/domain/logic/banking.logic';
import type {
  ReimbursementPolicyRecord,
  ReimbursementRequestRecord,
  ReimbursementApprovalStepRecord,
  ReimbursementPaymentRecord,
  ReimbursementDuplicateCandidateRecord,
  ReimbursementLineRecord,
  ReimbursementLineWriteData,
  ReimbursementDuplicateCandidateWriteData,
  ReimbursementClaimSignatureRecord,
  CreateReimbursementRequestData,
  MaterializeClaimExpenseItem,
  ReimbursementSignedCopyAck,
  ReimbursementPaymentSlipLink,
  ReimbursementPaymentSlipSource,
  ReimbursementDraftActionOwner,
  ReimbursementDraftActionRecord,
  ReimbursementDraftPreparedCommand,
  ReimbursementPayoutCorrectionLogEntry,
} from '../domain/models/reimbursement.model';
import {
  REIMBURSEMENT_ATTACHMENT_TARGET_TYPE,
  REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE,
  REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES,
  REIMBURSEMENT_PAYMENT_SLIP_PURPOSE,
  REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG,
  REIMBURSEMENT_SIGNED_COPY_ACK_KEY,
  REIMBURSEMENT_SIGNED_COPY_PURPOSE,
  parseReimbursementPolicySnapshot,
} from '../domain/reimbursement.constants';
import { effectivePolicy, effectivePolicyForRequest, type EffectivePolicy } from '../domain/reimbursement.constants';
import {
  buildPaymentSourceRef,
  claimSnapshotFields,
  computeSnapshotHash,
  computeOutstanding,
  computePaymentStatus,
  d,
  decStr,
  isExactLegacyV1FallbackSnapshot,
  isSamePaymentRequest,
  isSelfApproval,
  isOwnerSelfApproval,
  matchesApproverRole,
  frozenApprovalAuthority,
  pendingProjectionIntent,
  type PendingProjectionIntent,
  validatePaymentRecording,
  validateRequestFields,
  deriveHeaderFromLines,
  computeReceiptRequirement,
  currentDesk,
  duplicateBlocksPayment, claimDuplicateBlocksPayment, claimPaymentDuplicateBlock, claimDuplicateReasons, confirmedDuplicateRefusal,
} from '../domain/logic/reimbursement.logic';
import { CLAIM_PAYOUT_WORKLIST_LIMIT, exclusiveEndOfDay, isExpenseVoidReason } from '@watchdog-bms/contracts';
import { findClaimExpenseVoidBlocker, readExpenseCancellationCertificate, type ExpenseVoidBlocker } from '../../expenses/infrastructure/expense-void-blocker';
import {
  PAYOUT_PEOPLE_MANAGER_ROLE_KEYS,
  type FrozenPayoutPlan, type SealedPayoutDestination, type SubmitPayoutColumns, type SubmitPayoutPlan,
} from '../domain/logic/payout-destination.logic';
import {
  applyDraftPayoutChange, attestClaimPayout, deleteMemberPayoutAccount, draftPayoutAfterReopen, freezePayoutAtSubmit,
  readClaimPayout, readClaimPayoutSecret, readDraftDefaultPayout, readMemberPayoutAccount, readMemberPayoutSecret, readSubmitPayoutPlan,
  writeMemberPayoutAccount, type DraftPayoutChange, type MemberPayoutAccountRecord,
  addSavedPayoutAccount, deleteSavedPayoutAccount, listSavedPayoutAccounts, makeSavedPayoutAccountDefault,
  readSavedPayoutAccount, readSavedPayoutAccountForCopy, readSavedPayoutSecret, readClaimPayoutHolderType,
  type SavedPayoutAccountRecord, type SavedPayoutAccountWrite,
} from './reimbursement-payout';
// The payment step's side of the payout (kept as its own imports, apart from the block above).
import { planPaymentPayout, type PaymentPayoutPlan, type PaymentPayoutStatement } from '../domain/logic/payout-destination.logic';
import {
  assertPaymentPayoutUsable, confirmPaymentPayout, paymentPayoutRefusal, payoutCorrectionKeptDestination, readLegacyPayoutDefault, readPaymentPayoutDestinations, readRecordedPaymentPayout,
  type ConfirmedPaymentPayout,
} from './reimbursement-payout';
// The claim page's account history (its own import too, for the same reason).
import { readClaimPayoutVersions } from './reimbursement-payout';
// The payout account correction round (payout spec §14).
import { PAYOUT_CORRECTION_STEP_REASON, payoutCorrectionFacts, payoutCorrectionPhase, payoutCorrectionRoundStart, payoutCorrectionSourceStep, payoutCorrectionApprovalRequired } from '../domain/logic/reimbursement.logic';
import { hasPayoutSnapshot } from '../domain/logic/payout-destination.logic';
import { freezePayoutCorrection, type CorrectionPayoutWrite } from './reimbursement-payout';
import { deliveryHash, parseDeliveryBatchStates, parseLineDeliveryPlan } from '../../line-ai/domain/logic/line-delivery-plan.logic';

function dec(v: unknown): string {
  return v != null ? String(v) : '0';
}
function opt<T>(v: T | null | undefined): T | undefined {
  return v == null ? undefined : v;
}
function stringArrayOpt(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('invalid_reimbursement_approval_assignment_snapshot');
  }
  return [...new Set(value)];
}

export function assertClaimProjectionsNotVoided(request: Pick<ReimbursementRequestRecord, 'status'>, projections: readonly { status: string }[]): void {
  if (!['CANCELLED', 'VOIDED'].includes(request.status) && projections.some(projection => projection.status === 'VOIDED')) {
    throw new ConflictException('reimbursement_projection_voided');
  }
}

const OWN_DUPLICATE_EXPENSES = {
  where: { OR: [
    { duplicateStatus: 'POSSIBLE_DUPLICATE' as const, status: { not: 'VOIDED' as const } },
    { duplicateStatus: 'OVERRIDDEN' as const, status: 'READY_FOR_CONFIRMATION' as const },
    { duplicateStatus: 'CONFIRMED_DUPLICATE' as const },
  ] },
  select: { duplicateStatus: true, status: true },
};

/**
 * A payment transaction PostgreSQL rolled back because another writer got there first: two payers,
 * a payment against a void, or the slip file changing underneath. Nothing was written, so the
 * answer is the payment paths' own "it changed, reload and retry" (409), never a 500.
 */
function paymentChangedOnSerializationFailure(error: unknown): never {
  if (isSerializationFailure(error)) throw new ConflictException('reimbursement_payment_state_changed');
  throw error;
}

/** A file proven usable as a slip of one claim, with what the link write needs to finish the job. */
type ResolvedPaymentSlip = {
  attachmentId: string;
  source: ReimbursementPaymentSlipSource;
  checksumSha256: string | null;
  uploadedByUserId: string;
  metadataJson: Record<string, unknown> | null;
  signedCopyLinkIds: string[];
  /** A signed copy that carries a "signed on paper" declaration made with a link this move removes. */
  withdrawsDeclaration: boolean;
};

/** What every slip proof is asked: which file, for which claim, by whom, and whether a withdrawal was confirmed. */
type PaymentSlipProofInput = {
  companyId: string; requestId: string; attachmentId: string; actorUserId: string;
  /** The payer's explicit yes to withdrawing the file's "signed on paper" declaration (spec §16.2). */
  confirmSignedCopyWithdrawal?: boolean;
};

function activeApproverMembershipWhere(
  companyId: string,
  userIds: string[],
  branchId?: string | null,
): Prisma.CompanyMembershipWhereInput {
  return {
    companyId,
    userId: { in: [...new Set(userIds)] },
    status: 'ACTIVE',
    user: { status: 'ACTIVE' },
    ...(branchId ? { OR: [
      { branchScopeMode: 'ALL_BRANCHES' },
      { branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: branchId },
      { branchScopeMode: 'SELECTED_BRANCHES', branchScopes: { some: { branchId } } },
    ] } : {}),
  };
}

/** A draft's receiving choice plus anything that must commit with it (setting the default account, its audit row, the requester's notice). */
export type { DraftPayoutChange } from './reimbursement-payout';

/** How long the scheduled pass leaves a fresh decision to the request that is carrying it out. */
const PROJECTION_INTENT_MIN_AGE_MS = 60_000;

/** The five round columns of a claim that is in no payout account correction round. */
const NO_PAYOUT_CORRECTION = {
  payoutCorrectionRequestedAt: null,
  payoutCorrectionRequestedByUserId: null,
  payoutCorrectionReasonCode: null,
  payoutCorrectionNote: null,
  payoutCorrectionSubmittedAt: null,
} as const;

/** The claim's round history with one more step. */
function withPayoutCorrectionStep(row: { payoutCorrectionLogJson?: unknown }, entry: ReimbursementPayoutCorrectionLogEntry): ReimbursementPayoutCorrectionLogEntry[] {
  return [...(Array.isArray(row.payoutCorrectionLogJson) ? row.payoutCorrectionLogJson : []), entry];
}

export type ListRequestsWhere = {
  requesterName?: string;
  categoryName?: string;
  order?: 'newest' | 'oldest';
  correctionUserId?: string;
  companyId: string;
  requesterUserId?: string;
  relatedUserId?: string;
  scopes?: { branchIds?: string[] };
  status?: string;
  paymentStatus?: string;
  statuses?: string[];
  search?: string;
  skip?: number;
  take?: number;
  /** Load each claim's own duplicate candidates too: a queue whose rows say whether a duplicate refuses the payment. */
  withDuplicateCandidates?: boolean;
};

/**
 * A claim's own duplicate candidates that still say something: open, or cleared by a person. The
 * ones a resubmit superseded are history. What a list row needs for `claimDuplicateStatus` and
 * `duplicateBlocksPayment`; the claim detail loads every candidate.
 */
const LIVE_DUPLICATE_CANDIDATES = { where: { status: { in: ['OPEN', 'OVERRIDDEN'] as any } } };

/** The claims of a list scope that share the fields the hub counts on. */
export type ReimbursementRequestGroup = {
  needsCorrection?: boolean;
  status: ReimbursementRequestStatus;
  financeReviewStatus: string;
  receiptRequirementStatus: string;
  count: number;
  amount: string;
};

/** The hub bucket of a status pair: the desk the API resolves for it decides, exactly as a row of the list prints it. */
export function hubBucketOfStatus(status: ReimbursementRequestStatus, financeReviewStatus: string): ReimbursementHubBucket {
  return reimbursementHubBucket({ status, financeReviewStatus, currentDesk: currentDesk({ status, financeReviewStatus: financeReviewStatus as any }) });
}

/**
 * A hub bucket as a query: the bucket rule asked of every status pair the database can hold. Derived, not
 * written out a second time, so the list filter cannot drift from the counts. An unknown bucket matches nothing.
 */
export function hubBucketWhere(bucket: string): Prisma.ReimbursementRequestWhereInput {
  return {
    OR: Object.values(RequestStatuses).flatMap((status) => {
      const finance = Object.values(FinanceReviewStatuses).filter((financeReviewStatus) => hubBucketOfStatus(status, financeReviewStatus) === bucket);
      return finance.length > 0 ? [{ status, financeReviewStatus: { in: finance } }] : [];
    }),
  };
}

/**
 * What the hub's search box finds: every word typed is in the claim's number, its requester's name, its
 * reason or its category, or is its amount. Those are the columns a row prints and a person can type;
 * the status is what the chips filter. Read by the page and by the counts alike.
 * ponytail: the first five words are read; a longer search ignores the rest.
 */
export function hubSearchWhere(search: string): Prisma.ReimbursementRequestWhereInput {
  return {
    AND: search.split(/\s+/).filter(Boolean).slice(0, 5).map((word) => {
      const contains = { contains: word, mode: 'insensitive' as const };
      const amount = word.replace(/,/g, '');
      return { OR: [
        { requestNo: contains }, { requesterDisplayNameSnapshot: contains }, { reason: contains }, { categoryLabelSnapshot: contains },
        ...(/^\d{1,12}(\.\d{1,4})?$/.test(amount) ? [{ amount }] : []),
      ] };
    }),
  };
}

/** View-only actor graph. Linked raw ids are resolved before this predicate is built. */
export function reimbursementRelatedToUserWhere(
  userId: string,
  linkedExpenseIds: readonly string[] = [],
  signedCopyRequestIds: readonly string[] = [],
  sourceExpenseScope: Prisma.ExpenseRecordWhereInput = {},
): Prisma.ReimbursementRequestWhereInput {
  return {
    OR: [
      { requesterUserId: userId },
      { createdByUserId: userId },
      { updatedByUserId: userId },
      { submittedByUserId: userId },
      { currentApproverUserId: userId },
      { financeReviewedByUserId: userId },
      { cancellationPendingByUserId: userId },
      { approvalSteps: { some: { OR: [{ approverUserId: userId }, { decisionByUserId: userId }] } } },
      { payments: { some: { OR: [{ paidByUserId: userId }, { voidedByUserId: userId }] } } },
      { claimSignatures: { some: { signedByUserId: userId } } },
      { sourceExpenses: { some: { AND: [sourceExpenseScope, expenseRelatedToUserWhere(userId)] } } },
      ...(linkedExpenseIds.length > 0
        ? [
            { linkedExpenseId: { in: [...linkedExpenseIds] } },
            { lines: { some: { linkedExpenseId: { in: [...linkedExpenseIds] } } } },
          ]
        : []),
      ...(signedCopyRequestIds.length > 0 ? [{ id: { in: [...signedCopyRequestIds] } }] : []),
    ],
  };
}

/**
 * Approve or reject reached a claim that no longer waits for approval: someone decided it, it was
 * cancelled, or its requester took it back to a draft after the caller's page was loaded. One code
 * for both calls and for the check before the lock and under it, and never the status word: the
 * screen says what happened in its own words and reads the claim again. 409, like every other
 * answer to a page that is behind its claim (it used to be a 422 "Cannot approve from status …").
 */
export function notAwaitingApproval(): ConflictException {
  return new ConflictException('reimbursement_not_awaiting_approval');
}

@Injectable()
export class PrismaReimbursementRepository {
  async resolveCreateBranchId(companyId: string, scopes: BranchScopes, selectedBranchId?: string | null): Promise<string> {
    return resolveTransactionBranchId(this.prisma.client, companyId, scopes, selectedBranchId);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentNumbers: PrismaDocumentSequenceRepository,
  ) {}

  private async relatedRequestPredicate(
    companyId: string,
    userId: string,
    scopes: { branchIds?: string[] } = {},
  ): Promise<Prisma.ReimbursementRequestWhereInput> {
    const expenseScope = branchScopeWhere(scopes) as Prisma.ExpenseRecordWhereInput;
    const [relatedExpenses, signedCopies] = await Promise.all([
      this.prisma.client.expenseRecord.findMany({
        where: { companyId, AND: [expenseScope, expenseRelatedToUserWhere(userId)] },
        select: { id: true },
      }),
      this.prisma.client.attachmentLink.findMany({
        where: {
          companyId,
          targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE,
          purpose: REIMBURSEMENT_SIGNED_COPY_PURPOSE,
          linkedByUserId: userId,
        },
        select: { targetId: true },
      }),
    ]);
    return reimbursementRelatedToUserWhere(
      userId,
      relatedExpenses.map(({ id }) => id),
      signedCopies.map(({ targetId }) => targetId),
      expenseScope,
    );
  }

  async isUserRelatedToRequest(
    companyId: string,
    requestId: string,
    userId: string,
    scopes: { branchIds?: string[] } = {},
  ): Promise<boolean> {
    const relation = await this.relatedRequestPredicate(companyId, userId, scopes);
    return (await this.prisma.client.reimbursementRequest.count({
      where: {
        companyId,
        id: requestId,
        AND: [branchScopeWhere(scopes) as Prisma.ReimbursementRequestWhereInput, relation],
      },
    })) > 0;
  }

  async getUserDisplayName(userId: string): Promise<string> {
    const row = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    return row?.displayName ?? userId;
  }

  /**
   * Batch id → display name for the actors printed on a claim form and shown in
   * the drawer (approver, decider, finance reviewer, payer): one query, never a
   * per-row lookup. Company-scoped like `findActiveMemberIdentity` in expenses,
   * but WITHOUT the ACTIVE filter — a claim form is a historical record, and a
   * member who has since resigned must still print with their name.
   */
  async getUserDisplayNames(companyId: string, userIds: string[]): Promise<Record<string, string>> {
    const ids = [...new Set(userIds.filter((id) => !!id))];
    if (ids.length === 0) return {};
    const rows = await this.prisma.client.companyMembership.findMany({
      where: { companyId, userId: { in: ids } },
      select: { userId: true, user: { select: { displayName: true } } },
    });
    return Object.fromEntries(rows.map((row) => [row.userId, row.user.displayName]));
  }

  /**
   * Of the named approvers given, which can still act (audit H-20).
   *
   * A step routed to a specific person used to be approvable by that person and nobody else, with
   * no OWNER fallback and no reassign route — so disabling or removing that member froze every
   * request waiting on them AND hid it from every queue, because the queue filters on the same
   * predicate. The only way out was cancelling the request, which burns its document number.
   *
   * "Can still act" is membership-level, not user-level: an ACTIVE person who has been removed from
   * THIS company must not keep approving its claims.
   */
  async findActiveApproverUserIds(companyId: string, userIds: string[], branchId?: string | null): Promise<Set<string>> {
    const ids = [...new Set(userIds.filter((id) => !!id))];
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.client.companyMembership.findMany({
      // Branch responsibility remains dynamic even though the exact person is frozen. If every
      // assignee loses this branch, the recorded role/OWNER recovery path must be able to open.
      where: activeApproverMembershipWhere(companyId, ids, branchId),
      select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
  }

  /**
   * Display names of the members the API would accept a payment from on a claim of this branch, for the
   * claim page to say who it waits for. The rule is the permission resolver's, applied to every member in
   * one pass: an ACTIVE membership and user, an ACTIVE role holding the pay right, the entitlement cut,
   * and a branch scope (over ACTIVE branches) that covers the claim. The branch is required: a claim
   * without one is in every scope, yet the payment endpoint refuses it for everyone.
   * `turnUserIds` are the people whose turn it is, first to last (`paymentTurnUserIds`): those of them
   * who can pay head the list in that order, and everyone else follows by name.
   */
  async listPaymentRecorderNames(companyId: string, branchId: string, turnUserIds: readonly string[] = []): Promise<string[]> {
    const key = 'reimbursement.payment.record';
    const [members, branches, entitled] = await Promise.all([
      this.prisma.client.companyMembership.findMany({
        where: {
          companyId, status: 'ACTIVE', user: { status: 'ACTIVE' },
          roles: { some: { role: { status: 'ACTIVE', permissions: { some: { permission: { key } } } } } },
        },
        select: {
          userId: true, branchScopeMode: true, defaultBranchId: true,
          branchScopes: { select: { branchId: true } },
          user: { select: { displayName: true } },
        },
      }),
      this.prisma.client.branch.findMany({ where: { companyId, status: 'ACTIVE' }, select: { id: true } }),
      loadEntitledFeatureKeys(this.prisma, companyId),
    ]);
    if (filterPermissionsByEntitlement([key], entitled).length === 0) return [];
    const activeBranchIds = new Set(branches.map((branch) => branch.id));
    // A place in the turn order, or after everyone who has one.
    const turn = (userId: string) => (turnUserIds.includes(userId) ? turnUserIds.indexOf(userId) : turnUserIds.length);
    return members.filter((member) => {
      const selected = member.branchScopes.map((scope) => scope.branchId).filter((id) => activeBranchIds.has(id));
      // The resolver refuses a SELECTED_BRANCHES member with no active branch outright.
      if (member.branchScopeMode === 'SELECTED_BRANCHES' && selected.length === 0) return false;
      const branchIds = resolveBranchIds(member.branchScopeMode, selected, member.defaultBranchId ?? undefined);
      return isBranchInScope(branchIds === undefined ? {} : { branchIds }, branchId);
    }).sort((a, b) => turn(a.userId) - turn(b.userId) || a.user.displayName.localeCompare(b.user.displayName, 'th'))
      .map((member) => member.user.displayName);
  }

  /** Letterhead for the printed claim form — same precedence as the substitute receipt. */
  async getClaimFormCompanyContext(
    companyId: string,
    branchId: string | null,
  ): Promise<{ name: string; taxId: string | null; branchName: string | null }> {
    const company = await this.prisma.client.company.findFirst({
      where: { id: companyId },
      select: { registeredName: true, name: true, taxId: true },
    });
    if (!company) throw new NotFoundException(`Company ${companyId} not found`);
    const branch = branchId
      ? await this.prisma.client.branch.findFirst({ where: { id: branchId, companyId }, select: { name: true } })
      : null;
    return { name: company.registeredName ?? company.name, taxId: company.taxId, branchName: branch?.name ?? null };
  }

  /** The branch's display name for a LINE draft preview; the customer never reads the branch id. */
  async findBranchName(companyId: string, branchId: string): Promise<string | null> {
    return (await this.prisma.client.branch.findFirst({ where: { id: branchId, companyId }, select: { name: true } }))?.name ?? null;
  }

  // ---- Policy ----

  /** Every ready/void emitter reads the claim's own duplicate facts inside its write transaction. */
  async paymentNoticeFacts(tx: Prisma.TransactionClient, companyId: string, requestId: string) {
    const row = await tx.reimbursementRequest.findFirstOrThrow({ where: { companyId, id: requestId },
      include: { duplicateCandidates: LIVE_DUPLICATE_CANDIDATES, sourceExpenses: { ...OWN_DUPLICATE_EXPENSES, select: { ...OWN_DUPLICATE_EXPENSES.select, duplicateCandidates: { where: { status: 'CONFIRMED_DUPLICATE' }, select: { resolvedAt: true, resolvedByUserId: true } } } } } });
    const request = this.toRequest(row);
    const policyRow = await tx.reimbursementPolicy.findFirst({ where: { companyId, branchId: null } });
    const policy = effectivePolicy(policyRow ? this.toPolicy(policyRow) : null);
    const confirmations = (row.sourceExpenses ?? []).flatMap(expense => (expense.duplicateCandidates ?? []).filter(candidate => candidate.resolvedAt)).sort((a, b) => a.resolvedAt!.getTime() - b.resolvedAt!.getTime());
    return { paymentDuplicateBlock: claimPaymentDuplicateBlock(request, policy), duplicateReasons: claimDuplicateReasons(request),
      ...(confirmations.length && { confirmedDuplicateAt: confirmations[0].resolvedAt!, confirmedDuplicateActorUserId: confirmations[0].resolvedByUserId }) };
  }

  paymentNoticeFactsForRequest(companyId: string, requestId: string) {
    return this.paymentNoticeFacts(this.prisma.client, companyId, requestId);
  }

  async findPolicy(companyId: string, branchId?: string | null): Promise<ReimbursementPolicyRecord | null> {
    const rows = await this.prisma.client.reimbursementPolicy.findMany({
      where: { companyId, branchId: branchId ?? null },
      orderBy: { createdAt: 'asc' },
      take: 2,
    });
    if (rows.length > 1) throw new ConflictException('duplicate_company_policy');
    return rows[0] ? this.toPolicy(rows[0]) : null;
  }

  async upsertPolicy(
    companyId: string,
    branchId: string | null,
    data: Record<string, unknown>,
    userId: string,
    expectedUpdatedAt?: Date,
    onPersisted?: (tx: any, before: ReimbursementPolicyRecord | null, after: ReimbursementPolicyRecord) => Promise<void>,
  ): Promise<ReimbursementPolicyRecord> {
    const client = this.prisma.client as any;
    try {
      return await client.$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${branchId ?? 'company'}:reimbursement-policy`}))`;
        const rows = await tx.reimbursementPolicy.findMany({
          where: { companyId, branchId }, orderBy: { createdAt: 'asc' }, take: 2,
        });
        if (rows.length > 1) throw new ConflictException('duplicate_company_policy');
        const existing = rows[0];
        let row: any;
        if (existing) {
          if (!expectedUpdatedAt || existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
            throw new ConflictException('reimbursement_policy_changed');
          }
          const changed = await tx.reimbursementPolicy.updateMany({
            where: { id: existing.id, companyId, branchId, updatedAt: expectedUpdatedAt },
            data: { ...data, updatedByUserId: userId, updatedAt: this.nextVersion(expectedUpdatedAt) },
          });
          if (changed.count !== 1) throw new ConflictException('reimbursement_policy_changed');
          row = await tx.reimbursementPolicy.findFirstOrThrow({ where: { id: existing.id, companyId } });
        } else {
          if (expectedUpdatedAt) throw new ConflictException('reimbursement_policy_changed');
          row = await tx.reimbursementPolicy.create({
            data: { companyId, branchId, ...data, createdByUserId: userId },
          });
        }
        const before = existing ? this.toPolicy(existing) : null;
        const after = this.toPolicy(row);
        await onPersisted?.(tx, before, after);
        return after;
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('reimbursement_policy_changed');
      }
      throw error;
    }
  }

  async resolveSourceLines<T extends SourceLine>(companyId: string, requesterUserId: string, branchId: string, currency: string, lines: readonly T[]) {
    return resolveReimbursementSourceLines(this.prisma.client, companyId, requesterUserId, branchId, currency, lines);
  }

  async listReimbursementRequesters(companyId: string, branchId: string, ownUserId?: string) {
    const rows = await (this.prisma.client as any).companyMembership.findMany({
      where: { companyId, status: 'ACTIVE', ...(ownUserId ? { userId: ownUserId } : {}), user: { status: 'ACTIVE' }, OR: [
        { branchScopeMode: 'ALL_BRANCHES' }, { branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: branchId }, { branchScopeMode: 'SELECTED_BRANCHES', branchScopes: { some: { branchId } } },
      ] }, select: { userId: true, employeeAccessProfile: { select: { displayName: true } }, user: { select: { displayName: true } } }, orderBy: { user: { displayName: 'asc' } },
    });
    return rows.map((row: any) => ({ userId: row.userId as string, displayName: (row.employeeAccessProfile?.displayName?.trim() || row.user.displayName) as string }));
  }

  async listReimbursementSources(companyId: string, branchId: string, requesterUserId: string, search: string, expenseId?: string,
    page: { skip?: number; take?: number } = {}): Promise<import('@watchdog-bms/contracts').ReimbursementSourceOption[]> {
    const tx = this.prisma.client as any;
    const certificates = await tx.expenseSubstituteReceiptEvidence.findMany({ where: { companyId, branchId, payerUserId: requesterUserId }, select: { expenseId: true } });
    const rows = await tx.expenseRecord.findMany({
      // `payerUserId` joins the picker's OR (capture appendix §5): an expense somebody else
      // uploaded but the server knows THIS requester paid is claimable by them.
      where: { companyId, branchId, sourceReimbursementRequestId: null, ...(expenseId ? { id: expenseId } : {}), OR: [{ createdByUserId: requesterUserId }, { payerUserId: requesterUserId }, { id: { in: certificates.map((row: any) => row.expenseId) } }],
        ...(search ? { AND: [{ OR: [{ vendorNameSnapshot: { contains: search, mode: 'insensitive' } }, { vendorDocumentNumber: { contains: search, mode: 'insensitive' } }, { note: { contains: search, mode: 'insensitive' } }] }] } : {}),
      }, include: { lines: { orderBy: { lineNumber: 'asc' } }, expenseCategory: true }, orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
      skip: page.skip ?? 0, take: page.take ?? 50,
    });
    return Promise.all(rows.map(async (row: any) => {
      let snapshot; let reason;
      try {
        snapshot = await readReimbursementSource(tx, companyId, requesterUserId, branchId, row.currency, row.id);
        // Read-only option hint; the final submit performs the locked duplicate check.
        const hit = await tx.reimbursementLine.findFirst({ where: { companyId, linkedExpenseId: row.id, request: { status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'] } } } });
        if (hit) reason = 'expense_already_claimed';
      } catch (error: any) { const response = error.getResponse?.(); reason = typeof response === 'object' ? response.code : 'reimbursement_source_unavailable'; }
      return { expenseId: row.id, label: [snapshot?.certificate?.documentNumber ?? row.vendorDocumentNumber ?? row.expenseNumber, row.vendorNameSnapshot].filter(Boolean).join(' · ') || row.lines.map((line: any) => line.description).join('; ').slice(0, 100) || 'ค่าใช้จ่าย',
        eligible: !reason, reason, updatedAt: row.updatedAt.toISOString(), incurredDate: row.expenseDate?.toISOString().slice(0, 10) ?? '',
        description: expenseSourceDescription(row.lines), purpose: snapshot?.certificate?.businessPurpose ?? '', categoryKey: row.expenseCategory?.id ?? 'other', categoryLabel: row.expenseCategory?.name,
        amount: dec(row.netPayableAmount), currency: row.currency, snapshot,
      };
    }));
  }

  async assertReimbursementRequester(companyId: string, branchId: string, requesterUserId: string) {
    const [member] = await this.listReimbursementRequesters(companyId, branchId, requesterUserId);
    if (!member) throw sourceError('reimbursement_requester_unavailable');
    return member;
  }

  // ---- Request ----

  async createRequest(data: CreateReimbursementRequestData & { id?: string }, payout?: DraftPayoutChange): Promise<ReimbursementRequestRecord> {
    requireTransactionBranchId(data.branchId);
    const client = this.prisma.client as any;
    const row = await client.$transaction(async (tx: any) => {
      await lockPlanTermCompany(tx, data.companyId);
      if (data.id) {
        const previous = await tx.reimbursementRequest.findFirst({ where: { companyId: data.companyId, id: data.id } });
        if (previous) return previous;
      }
      if (!await tx.branch.findFirst({ where: { id: data.branchId, companyId: data.companyId, status: 'ACTIVE' }, select: { id: true } }))
        throw sourceError('branch_inactive');
      if (!await tx.companyMembership.findFirst({ where: { companyId: data.companyId, userId: data.requesterUserId, status: 'ACTIVE', user: { status: 'ACTIVE' }, OR: [
        { branchScopeMode: 'ALL_BRANCHES' }, { branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: data.branchId },
        { branchScopeMode: 'SELECTED_BRANCHES', branchScopes: { some: { branchId: data.branchId } } },
      ] }, select: { id: true } }) || !await tx.companyMembership.findFirst({ where: { companyId: data.companyId, userId: data.createdByUserId,
        status: 'ACTIVE', user: { status: 'ACTIVE' } }, select: { id: true } })) throw sourceError('reimbursement_requester_unavailable');
      await assertReimbursementSources(tx, data);
      const created = await tx.reimbursementRequest.create({
        data: {
          ...(data.id && { id: data.id }),
          companyId: data.companyId,
          branchId: data.branchId,
          requesterUserId: data.requesterUserId,
          requesterDisplayNameSnapshot: data.requesterDisplayNameSnapshot,
          title: data.title,
          reason: data.reason,
          categoryKey: data.categoryKey,
          categoryLabelSnapshot: data.categoryLabelSnapshot,
          amount: data.amount,
          currency: data.currency,
          incurredDate: data.incurredDate,
          missingReceiptReason: data.missingReceiptReason,
          receiptRequirementStatus: data.receiptRequirementStatus as any,
          outstandingAmount: data.amount,
          createdByUserId: data.createdByUserId,
        },
      });
      await this.replaceLines(tx, data.companyId, created.id, data.lines);
      if (payout) {
        await tx.reimbursementRequest.update({ where: { id: created.id }, data: await applyDraftPayoutChange(tx, created, payout, true) });
      }
      return created;
    });
    return (await this.findRequestById(data.companyId, row.id))!;
  }

  /**
   * Draft header/line replacement and submit use the same request lock and the
   * version observed by their caller. A stale writer therefore changes nothing.
   */
  async updateDraftRequest(
    companyId: string,
    requestId: string,
    expectedUpdatedAt: Date,
    data: Record<string, unknown>,
    lines?: ReimbursementLineWriteData[],
    payout?: DraftPayoutChange,
  ): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, companyId, requestId);
      const before = payout ? await tx.reimbursementRequest.findFirstOrThrow({ where: { companyId, id: requestId } }) : undefined;
      const payoutColumns = payout ? await applyDraftPayoutChange(tx, before, payout) : {};
      const changed = await tx.reimbursementRequest.updateMany({
        // Not while the draft is being cancelled (audit B3): answered like any other change under the editor.
        where: { id: requestId, companyId, status: 'DRAFT', updatedAt: expectedUpdatedAt, cancellationPendingAt: null },
        data: { ...data, ...payoutColumns, updatedAt: this.nextVersion(expectedUpdatedAt) },
      });
      if (changed.count !== 1) throw this.draftChanged();
      const sourceRequest = await tx.reimbursementRequest.findFirstOrThrow({ where: { companyId, id: requestId }, include: { lines: true } });
      await assertReimbursementSources(tx, { ...sourceRequest, lines: lines ?? sourceRequest.lines.map((line: any) => ({ ...line, sourceExpenseSnapshot: line.sourceExpenseSnapshotJson, attachmentSnapshot: line.attachmentSnapshotJson })) });
      if (lines) {
        await this.replaceLines(tx, companyId, requestId, lines);
        await tx.reimbursementClaimSignature.deleteMany({ where: { companyId, reimbursementRequestId: requestId } });
      }
      const row = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: requestId, companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return this.toRequest(row);
    });
  }

  // ---- LINE reimbursement draft actions ----

  async findOrCreateDraftAction(input: ReimbursementDraftActionOwner & {
    id: string;
    taskId: string;
    actionOrdinal: number;
    intentKeyHash: string;
    operation: 'CREATE' | 'UPDATE';
    expiresAt: Date;
  }): Promise<ReimbursementDraftActionRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      const ownerLock = [input.companyId, input.actorUserId, input.membershipId, input.messagingChannelId, input.chatKeyHash, input.ownerEpoch].join(':');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reimbursement-draft-owner:${ownerLock}`}))`;
      const currentTime = await this.transactionTime(tx);
      const active = await tx.reimbursementDraftAction.findFirst({ where: {
        companyId: input.companyId, id: { not: input.id }, status: { in: ['COLLECTING', 'PREVIEW'] }, expiresAt: { gt: currentTime },
        ...this.actionOwnerWhere(input),
      }, select: { id: true } });
      if (active) throw new ConflictException('reimbursement_active_action_exists');
      await tx.reimbursementDraftAction.createMany({ data: [{ ...input, status: 'COLLECTING' }], skipDuplicates: true });
      const row = await tx.reimbursementDraftAction.findFirst({ where: { companyId: input.companyId, intentKeyHash: input.intentKeyHash } });
      if (!row || row.id !== input.id || row.taskId !== input.taskId || row.actionOrdinal !== input.actionOrdinal
        || row.operation !== input.operation || !this.actionOwnerMatches(row, input)) throw new ConflictException('reimbursement_action_identity_conflict');
      return this.toDraftAction(row);
    });
  }

  async findDraftAction(companyId: string, actionId: string): Promise<ReimbursementDraftActionRecord | null> {
    const row = await (this.prisma.client as any).reimbursementDraftAction.findFirst({ where: { id: actionId, companyId } });
    return row ? this.toDraftAction(row) : null;
  }

  async findActiveDraftAction(owner: ReimbursementDraftActionOwner, now = new Date()): Promise<ReimbursementDraftActionRecord | null> {
    const row = await (this.prisma.client as any).reimbursementDraftAction.findFirst({
      where: { status: { in: ['COLLECTING', 'PREVIEW'] }, expiresAt: { gt: now }, ...this.actionOwnerWhere(owner) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return row ? this.toDraftAction(row) : null;
  }

  async isDraftActionOwnerCurrent(owner: ReimbursementDraftActionOwner, sharedMessagingChannelId?: string, allowOptOut = false): Promise<boolean> {
    return this.draftActionOwnerCurrent(this.prisma.client as any, owner, sharedMessagingChannelId, allowOptOut);
  }

  async saveDraftActionCollection(input: {
    owner: ReimbursementDraftActionOwner;
    actionId: string;
    expectedUpdatedAt: Date;
    commandJson: unknown;
    sourceProofJson: unknown;
    requestId?: string;
    expectedRequestUpdatedAt?: Date;
    expiresAt: Date;
  }): Promise<ReimbursementDraftActionRecord | null> {
    const client = this.prisma.client as any;
    const changed = await client.reimbursementDraftAction.updateMany({
      where: {
        id: input.actionId, companyId: input.owner.companyId, updatedAt: input.expectedUpdatedAt,
        status: { in: ['COLLECTING', 'PREVIEW'] }, ...this.actionOwnerWhere(input.owner),
      },
      data: {
        status: 'COLLECTING', previewRevision: 0, confirmationDigest: null, previewJson: Prisma.DbNull,
        previewDeliveryId: null, commandJson: input.commandJson as Prisma.InputJsonValue,
        sourceProofJson: input.sourceProofJson as Prisma.InputJsonValue, requestId: input.requestId ?? null,
        expectedRequestUpdatedAt: input.expectedRequestUpdatedAt ?? null, expiresAt: input.expiresAt,
      },
    });
    if (changed.count !== 1) return null;
    return this.findDraftAction(input.owner.companyId, input.actionId);
  }

  async saveDraftActionPreview(input: {
    owner: ReimbursementDraftActionOwner;
    actionId: string;
    expectedUpdatedAt: Date;
    commandJson: unknown;
    previewJson: unknown;
    sourceProofJson: unknown;
    confirmationDigest: string;
    previewRevision: number;
    requestId?: string;
    expectedRequestUpdatedAt?: Date;
    expiresAt: Date;
  }): Promise<ReimbursementDraftActionRecord | null> {
    const client = this.prisma.client as any;
    const changed = await client.reimbursementDraftAction.updateMany({
      where: {
        id: input.actionId, companyId: input.owner.companyId, updatedAt: input.expectedUpdatedAt,
        status: { in: ['COLLECTING', 'PREVIEW'] }, ...this.actionOwnerWhere(input.owner),
      },
      data: {
        status: 'PREVIEW', previewRevision: input.previewRevision, commandJson: input.commandJson as Prisma.InputJsonValue,
        previewJson: input.previewJson as Prisma.InputJsonValue, sourceProofJson: input.sourceProofJson as Prisma.InputJsonValue,
        confirmationDigest: input.confirmationDigest, previewDeliveryId: null, requestId: input.requestId ?? null,
        expectedRequestUpdatedAt: input.expectedRequestUpdatedAt ?? null, expiresAt: input.expiresAt,
      },
    });
    if (changed.count !== 1) return null;
    return this.findDraftAction(input.owner.companyId, input.actionId);
  }

  async markDraftActionWebRendered(input: {
    owner: ReimbursementDraftActionOwner; actionId: string; previewRevision: number; confirmationDigest: string; receiptId: string; now: Date;
  }): Promise<boolean> {
    return (await (this.prisma.client as any).reimbursementDraftAction.updateMany({
      where: { id: input.actionId, companyId: input.owner.companyId, status: 'PREVIEW', previewRevision: input.previewRevision,
        confirmationDigest: input.confirmationDigest, expiresAt: { gt: input.now }, ...this.actionOwnerWhere(input.owner) },
      data: { previewDeliveryId: input.receiptId },
    })).count === 1;
  }

  async markDraftActionLineDelivered(input: {
    owner: ReimbursementDraftActionOwner; actionId: string; previewRevision: number; confirmationDigest: string; deliveryPlanId: string; now: Date;
  }): Promise<boolean> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      const currentTime = await this.transactionTime(tx);
      const plan = await tx.lineDeliveryPlan.findFirst({ where: { id: input.deliveryPlanId, status: 'ACCEPTED', acceptedAt: { not: null }, expiresAt: { gt: currentTime } } });
      const parsed = plan && plan.planHash === deliveryHash(plan.planJson) ? parseLineDeliveryPlan(plan.planJson) : null;
      const states = parsed ? parseDeliveryBatchStates(plan.batchStateJson, parsed) : null;
      const control = parsed?.control;
      if (!control || control.kind !== 'REIMBURSEMENT_DRAFT_CONFIRM' || control.actionId !== input.actionId
        || control.previewRevision !== input.previewRevision || control.confirmationDigest !== input.confirmationDigest
        || Date.parse(control.expiresAt) <= currentTime.getTime() || !states || states.some((state) => state.status !== 'ACCEPTED')
        || parsed.authorization.kind !== 'PRIVATE' || parsed.authorization.actor.companyId !== input.owner.companyId
        || parsed.authorization.actor.userId !== input.owner.actorUserId || parsed.authorization.actor.membershipId !== input.owner.membershipId
        || parsed.authorization.actor.channel !== input.owner.channel || parsed.authorization.actor.channelKind !== input.owner.channelKind
        || parsed.authorization.actor.channelId !== input.owner.messagingChannelId || parsed.authorization.actor.chatKeyHash !== input.owner.chatKeyHash
        || parsed.authorization.actor.ownerEpoch !== input.owner.ownerEpoch) return false;
      return (await tx.reimbursementDraftAction.updateMany({ where: {
        id: input.actionId, companyId: input.owner.companyId, status: 'PREVIEW', previewRevision: input.previewRevision,
        confirmationDigest: input.confirmationDigest, expiresAt: { gt: currentTime }, ...this.actionOwnerWhere(input.owner),
      }, data: { previewDeliveryId: input.deliveryPlanId } })).count === 1;
    });
  }

  async cancelDraftAction(input: {
    owner: ReimbursementDraftActionOwner; actionId: string; previewRevision: number; confirmationDigest: string; now: Date; sharedMessagingChannelId?: string;
  }): Promise<'cancelled' | 'applied' | 'expired' | 'stale' | 'forbidden'> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      const currentTime = await this.transactionTime(tx);
      await this.lockDraftAction(tx, input.actionId);
      const row = await tx.reimbursementDraftAction.findFirst({ where: { id: input.actionId, companyId: input.owner.companyId } });
      if (!row || !this.actionOwnerMatches(row, input.owner) || !await this.draftActionOwnerCurrent(tx, input.owner, input.sharedMessagingChannelId, true)) return 'forbidden';
      if (row.status === 'APPLIED') return 'applied';
      if (row.status === 'CANCELLED') return 'cancelled';
      if (row.status === 'EXPIRED' || row.expiresAt <= currentTime) {
        if (['COLLECTING', 'PREVIEW'].includes(row.status)) await tx.reimbursementDraftAction.updateMany({ where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
          data: { status: 'EXPIRED', previewDeliveryId: null, commandJson: Prisma.DbNull, previewJson: Prisma.DbNull, sourceProofJson: Prisma.DbNull } });
        return 'expired';
      }
      if (row.status !== 'PREVIEW' || row.previewRevision !== input.previewRevision || row.confirmationDigest !== input.confirmationDigest) return 'stale';
      const changed = await tx.reimbursementDraftAction.updateMany({ where: { id: row.id, status: 'PREVIEW', updatedAt: row.updatedAt }, data: {
        status: 'CANCELLED', expiresAt: currentTime, previewDeliveryId: null,
        commandJson: Prisma.DbNull, previewJson: Prisma.DbNull, sourceProofJson: Prisma.DbNull,
      } });
      return changed.count === 1 ? 'cancelled' : 'stale';
    });
  }

  async cancelDraftCollection(input: {
    owner: ReimbursementDraftActionOwner; actionId: string; sharedMessagingChannelId?: string;
  }): Promise<'cancelled' | 'applied' | 'expired' | 'stale' | 'forbidden'> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      const currentTime = await this.transactionTime(tx);
      await this.lockDraftAction(tx, input.actionId);
      const row = await tx.reimbursementDraftAction.findFirst({ where: { id: input.actionId, companyId: input.owner.companyId } });
      if (!row || !this.actionOwnerMatches(row, input.owner)
        || !await this.draftActionOwnerCurrent(tx, input.owner, input.sharedMessagingChannelId, true)) return 'forbidden';
      if (row.status === 'APPLIED') return 'applied';
      if (row.status === 'CANCELLED') return 'cancelled';
      if (row.status === 'EXPIRED' || row.expiresAt <= currentTime) {
        if (row.status === 'COLLECTING') await tx.reimbursementDraftAction.updateMany({ where: { id: row.id, status: 'COLLECTING', updatedAt: row.updatedAt }, data: {
          status: 'EXPIRED', commandJson: Prisma.DbNull, previewJson: Prisma.DbNull, sourceProofJson: Prisma.DbNull,
          confirmationDigest: null, previewDeliveryId: null,
        } });
        return 'expired';
      }
      if (row.status !== 'COLLECTING') return 'stale';
      const changed = await tx.reimbursementDraftAction.updateMany({ where: { id: row.id, status: 'COLLECTING', updatedAt: row.updatedAt }, data: {
        status: 'CANCELLED', expiresAt: currentTime, commandJson: Prisma.DbNull, previewJson: Prisma.DbNull,
        sourceProofJson: Prisma.DbNull, confirmationDigest: null, previewDeliveryId: null,
      } });
      return changed.count === 1 ? 'cancelled' : 'stale';
    });
  }

  async applyDraftActionAtomic(input: {
    owner: ReimbursementDraftActionOwner;
    actionId: string;
    previewRevision: number;
    confirmationDigest: string;
    requestId: string;
    traceRequestId: string;
    now: Date;
    sharedMessagingChannelId?: string;
  }): Promise<{ kind: 'applied' | 'already_applied'; action: ReimbursementDraftActionRecord; request: ReimbursementRequestRecord }
    | { kind: 'cancelled' | 'expired' | 'stale' | 'needs_fields' | 'not_delivered' | 'forbidden' }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await lockPlanTermCompany(tx, input.owner.companyId);
      const currentTime = await this.transactionTime(tx);
      await this.lockDraftAction(tx, input.actionId);
      const row = await tx.reimbursementDraftAction.findFirst({ where: { id: input.actionId, companyId: input.owner.companyId } });
      if (!row || !this.actionOwnerMatches(row, input.owner)) return { kind: 'forbidden' } as const;
      if (row.status === 'APPLIED') {
        if (!await this.draftActionOwnerCurrent(tx, input.owner, input.sharedMessagingChannelId, true)) return { kind: 'forbidden' } as const;
        const request = await tx.reimbursementRequest.findFirst({ where: { id: row.requestId, companyId: input.owner.companyId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
        return request ? { kind: 'already_applied', action: this.toDraftAction(row), request: this.toRequest(request) } as const : { kind: 'stale' } as const;
      }
      if (!await this.draftActionOwnerCurrent(tx, input.owner, input.sharedMessagingChannelId, false)) return { kind: 'forbidden' } as const;
      if (row.status === 'CANCELLED') return { kind: 'cancelled' } as const;
      if (row.status === 'EXPIRED' || row.expiresAt <= currentTime) {
        if (['COLLECTING', 'PREVIEW'].includes(row.status)) await tx.reimbursementDraftAction.updateMany({ where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
          data: { status: 'EXPIRED', previewDeliveryId: null, commandJson: Prisma.DbNull, previewJson: Prisma.DbNull, sourceProofJson: Prisma.DbNull } });
        return { kind: 'expired' } as const;
      }
      if (row.status === 'COLLECTING') return { kind: 'needs_fields' } as const;
      if (row.status !== 'PREVIEW' || row.previewRevision !== input.previewRevision || row.confirmationDigest !== input.confirmationDigest) return { kind: 'stale' } as const;
      if (!row.previewDeliveryId) return { kind: 'not_delivered' } as const;
      const command = this.parseDraftPreparedCommand(row.commandJson);
      if (!command || command.operation !== row.operation || command.requestId !== (row.requestId ?? undefined)
        || command.expectedRequestUpdatedAt !== (row.expectedRequestUpdatedAt?.toISOString() ?? undefined)) return { kind: 'stale' } as const;
      const policy = effectivePolicy(await tx.reimbursementPolicy.findFirst({ where: { companyId: input.owner.companyId, branchId: null }, orderBy: { createdAt: 'asc' } }).then((value: any) => value ? this.toPolicy(value) : null));
      if (!isDeepStrictEqual(command.policyProof, { currency: policy.currency, requireReceipt: policy.requireReceipt, allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason })) return { kind: 'stale' } as const;
      const lines: ReimbursementLineWriteData[] = command.lines.map((line) => ({ ...line, incurredDate: new Date(line.incurredDate) }));
      if (validateRequestFields({ reason: command.reason, lines }).length > 0) return { kind: 'stale' } as const;
      const header = deriveHeaderFromLines(lines);
      if (header.amount !== command.header.amount || header.categoryKey !== command.header.categoryKey
        || (header.categoryLabelSnapshot ?? undefined) !== command.header.categoryLabelSnapshot
        || header.incurredDate.toISOString() !== command.header.incurredDate) return { kind: 'stale' } as const;
      const receipt = computeReceiptRequirement({ requireReceipt: policy.requireReceipt, allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
        lines, missingReceiptReason: command.missingReceiptReason });
      if (receipt.status !== command.receiptRequirementStatus) return { kind: 'stale' } as const;
      if (!await tx.branch.findFirst({ where: { id: command.branchId, companyId: input.owner.companyId, status: 'ACTIVE' }, select: { id: true } })) return { kind: 'stale' } as const;
      const member = await tx.companyMembership.findFirst({ where: activeApproverMembershipWhere(input.owner.companyId, [command.requesterUserId], command.branchId), include: { employeeAccessProfile: { select: { displayName: true } }, user: { select: { displayName: true } } } });
      if (!member || (member.employeeAccessProfile?.displayName?.trim() || member.user.displayName) !== command.requesterDisplayNameSnapshot) return { kind: 'stale' } as const;
      await assertReimbursementSources(tx, { companyId: input.owner.companyId, requesterUserId: command.requesterUserId, branchId: command.branchId, currency: command.currency, lines });

      let request: any;
      if (command.operation === 'CREATE') {
        if (input.requestId !== row.id) return { kind: 'stale' } as const;
        request = await tx.reimbursementRequest.create({ data: {
          id: input.requestId, companyId: input.owner.companyId, branchId: command.branchId, requesterUserId: command.requesterUserId,
          requesterDisplayNameSnapshot: command.requesterDisplayNameSnapshot, title: command.title, reason: command.reason,
          categoryKey: header.categoryKey, categoryLabelSnapshot: header.categoryLabelSnapshot, amount: header.amount,
          currency: command.currency, incurredDate: header.incurredDate, missingReceiptReason: command.missingReceiptReason,
          receiptRequirementStatus: command.receiptRequirementStatus, outstandingAmount: header.amount, createdByUserId: input.owner.actorUserId,
        } });
        await this.replaceLines(tx, input.owner.companyId, request.id, lines);
      } else {
        if (!command.requestId || command.requestId !== input.requestId || !command.expectedRequestUpdatedAt) return { kind: 'stale' } as const;
        await this.lockRequest(tx, input.owner.companyId, command.requestId);
        const expected = new Date(command.expectedRequestUpdatedAt);
        const changed = await tx.reimbursementRequest.updateMany({ where: { id: command.requestId, companyId: input.owner.companyId, status: 'DRAFT', updatedAt: expected }, data: {
          title: command.title ?? null, reason: command.reason, missingReceiptReason: command.missingReceiptReason ?? null,
          amount: header.amount, categoryKey: header.categoryKey, categoryLabelSnapshot: header.categoryLabelSnapshot ?? null,
          incurredDate: header.incurredDate, outstandingAmount: header.amount, receiptRequirementStatus: command.receiptRequirementStatus,
          updatedByUserId: input.owner.actorUserId, updatedAt: this.nextVersion(expected),
        } });
        if (changed.count !== 1) return { kind: 'stale' } as const;
        await this.replaceLines(tx, input.owner.companyId, command.requestId, lines);
        if (command.invalidateSignatures) await tx.reimbursementClaimSignature.deleteMany({ where: { companyId: input.owner.companyId, reimbursementRequestId: command.requestId } });
        request = await tx.reimbursementRequest.findFirstOrThrow({ where: { id: command.requestId, companyId: input.owner.companyId } });
      }
      const committedAt = currentTime;
      const result = {
        schemaVersion: 1, actionId: row.id, operation: command.operation, requestId: request.id, committedState: 'DRAFT',
        amount: decStr(d(String(request.amount))), currency: request.currency, confirmationDigest: row.confirmationDigest,
        committedAt: committedAt.toISOString(), appliedRequestUpdatedAt: request.updatedAt.toISOString(),
      };
      await new PrismaAuditRepository(this.prisma).log({ companyId: input.owner.companyId, actorUserId: input.owner.actorUserId,
        action: command.operation === 'CREATE' ? 'reimbursement.request.create_line_ai' : 'reimbursement.request.update_draft_line_ai',
        targetType: 'reimbursement_request', targetId: request.id, requestId: input.traceRequestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { actionId: row.id, previewRevision: row.previewRevision, confirmationDigest: row.confirmationDigest, lineCount: lines.length },
      }, tx);
      const applied = await tx.reimbursementDraftAction.updateMany({ where: { id: row.id, status: 'PREVIEW', updatedAt: row.updatedAt,
        previewRevision: input.previewRevision, confirmationDigest: input.confirmationDigest }, data: {
          status: 'APPLIED', requestId: request.id, resultJson: result, appliedAt: committedAt,
          appliedRequestUpdatedAt: request.updatedAt, commandJson: Prisma.DbNull, previewJson: Prisma.DbNull, sourceProofJson: Prisma.DbNull,
        } });
      if (applied.count !== 1) throw new ConflictException('reimbursement_action_changed');
      const action = await tx.reimbursementDraftAction.findUniqueOrThrow({ where: { id: row.id } });
      const complete = await tx.reimbursementRequest.findFirstOrThrow({ where: { id: request.id, companyId: input.owner.companyId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      return { kind: 'applied', action: this.toDraftAction(action), request: this.toRequest(complete) } as const;
    });
  }

  async markDraftActionStale(input: { owner: ReimbursementDraftActionOwner; actionId: string; previewRevision: number; confirmationDigest: string }): Promise<void> {
    await (this.prisma.client as any).reimbursementDraftAction.updateMany({ where: {
      id: input.actionId, companyId: input.owner.companyId, status: 'PREVIEW', previewRevision: input.previewRevision,
      confirmationDigest: input.confirmationDigest, ...this.actionOwnerWhere(input.owner),
    }, data: { status: 'STALE', previewDeliveryId: null, commandJson: Prisma.DbNull, previewJson: Prisma.DbNull, sourceProofJson: Prisma.DbNull } });
  }

  async submitDraftAtomic(data: {
    companyId: string;
    requestId: string;
    expectedUpdatedAt: Date;
    approvalStep?: {
      sequenceNo: number;
      approverUserId?: string;
      approverRoleSnapshot?: string;
      assignedApproverUserIdsJson?: string[];
      /** Left out when `payout` is given: the hash is then made inside this transaction. */
      requestSnapshotHash?: string;
    };
    duplicateCandidates: ReimbursementDuplicateCandidateWriteData[];
    evidence: { attachmentIds: string[]; expenseIds: string[] };
    documentNumber: {
      branchId?: string;
      documentType: string;
      periodKey: string;
      idempotencyKey: string;
      reservedByUserId: string;
    };
    request: Record<string, unknown>;
    /**
     * The claim's payout snapshot. Decided, checked against what the submitter was shown, frozen and
     * hashed inside this transaction: `snapshotHash` is asked for the claim's hash once the payout
     * columns are known, and that hash is what the step and the claim store.
     */
    payout?: {
      actorUserId: string;
      frozenAt: Date;
      seenToken?: unknown;
      expectedThirdParty?: boolean;
      snapshotHash: (columns: SubmitPayoutColumns) => string;
    };
    onSubmittedPersisted?: (tx: any, result: {
      step?: ReimbursementApprovalStepRecord;
      documentNumber: ReservedDocumentNumberRecord;
      documentNumberReused: boolean;
      supersededDuplicateCandidateCount: number;
      supersededApprovalStepCount: number;
      payout?: { plan: FrozenPayoutPlan; columns: SubmitPayoutColumns };
    }) => Promise<void>;
  }): Promise<{
    step?: ReimbursementApprovalStepRecord;
    documentNumber: ReservedDocumentNumberRecord;
    documentNumberReused: boolean;
    supersededDuplicateCandidateCount: number;
    supersededApprovalStepCount: number;
    payout?: { plan: FrozenPayoutPlan; columns: SubmitPayoutColumns };
  }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      await this.lockEvidence(tx, data.companyId, data.evidence);
      await this.assertEvidenceAvailable(tx, data.companyId, data.requestId, data.evidence);
      const sourceRequest = await tx.reimbursementRequest.findFirstOrThrow({ where: { companyId: data.companyId, id: data.requestId }, include: { lines: true } });
      const draft = this.toRequest(sourceRequest);
      this.assertNotBeingCancelled(draft);
      await assertReimbursementSources(tx, draft);
      // Before anything is written: what this submit freezes, and the hash that binds it.
      const payout = data.payout ? await freezePayoutAtSubmit(tx, draft, data.payout) : undefined;
      const snapshotHash = payout ? data.payout!.snapshotHash(payout.columns) : data.approvalStep?.requestSnapshotHash;

      const reserved = await this.documentNumbers.reserveNumberInTransaction(tx, {
        companyId: data.companyId,
        ...data.documentNumber,
      });
      const documentNumberReused = reserved.status === 'COMMITTED'
        && reserved.ownerType === 'reimbursement_request'
        && reserved.ownerId === data.requestId;
      if (reserved.status !== 'RESERVED' && !documentNumberReused) {
        throw new ConflictException({ code: 'reimbursement_document_number_unavailable' });
      }
      const supersededAt = new Date();
      const supersededCandidates = await tx.reimbursementDuplicateCandidate.updateMany({
        where: {
          companyId: data.companyId,
          reimbursementRequestId: data.requestId,
          status: 'OPEN',
        },
        data: {
          status: 'DISMISSED',
          resolvedByUserId: data.documentNumber.reservedByUserId,
          resolvedAt: supersededAt,
        },
      });
      // The pre-atomic implementation committed the number and created this step before its
      // blind header update. A crash/conflict in that last write can therefore leave a DRAFT with
      // a PENDING orphan. Invalidate it inside the same request lock so retry heals itself without
      // deleting history or asking the employee/accountant to repair data.
      const supersededApprovalSteps = await tx.reimbursementApprovalStep.updateMany({
        where: {
          companyId: data.companyId,
          reimbursementRequestId: data.requestId,
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
          invalidatedAt: supersededAt,
          invalidatedReason: 'superseded_by_atomic_resubmit',
        },
      });
      if (data.duplicateCandidates.length > 0) {
        await tx.reimbursementDuplicateCandidate.createMany({
          data: data.duplicateCandidates.map((candidate) => ({
            companyId: data.companyId,
            reimbursementRequestId: data.requestId,
            ...candidate,
          })),
        });
      }
      if (data.approvalStep && !snapshotHash) throw new Error('reimbursement_submit_snapshot_hash_missing');
      const step = data.approvalStep
        ? await tx.reimbursementApprovalStep.create({
          data: {
            companyId: data.companyId,
            reimbursementRequestId: data.requestId,
            ...data.approvalStep,
            requestSnapshotHash: snapshotHash,
          },
        })
        : undefined;
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: 'DRAFT',
          updatedAt: data.expectedUpdatedAt,
        },
        data: {
          ...data.request,
          // The payout columns and the hash made from them, written by this submit and nothing else.
          ...(payout && { ...payout.columns, approvalSnapshotHash: snapshotHash }),
          // A claim that is sent is in no payout account correction round. Written, not assumed: a build
          // from before the round neither reads nor clears these columns, so a claim it returned to draft
          // during a rollback still carries them, and they must never be read as a round again.
          ...NO_PAYOUT_CORRECTION,
          requestNo: reserved.documentNumber,
          currentApprovalStepId: step?.id ?? null,
          updatedAt: this.nextVersion(data.expectedUpdatedAt),
        },
      });
      if (changed.count !== 1) throw this.draftChanged();
      const documentNumber = documentNumberReused
        ? reserved
        : await this.documentNumbers.commitNumberInTransaction(tx, {
          id: reserved.id,
          companyId: data.companyId,
          ownerType: 'reimbursement_request',
          ownerId: data.requestId,
        });
      await data.onSubmittedPersisted?.(tx, {
        step: step ? this.toStep(step) : undefined,
        documentNumber,
        documentNumberReused,
        supersededDuplicateCandidateCount: supersededCandidates.count,
        supersededApprovalStepCount: supersededApprovalSteps.count,
        payout,
      });
      return {
        step: step ? this.toStep(step) : undefined,
        documentNumber,
        documentNumberReused,
        supersededDuplicateCandidateCount: supersededCandidates.count,
        supersededApprovalStepCount: supersededApprovalSteps.count,
        payout,
      };
    });
  }

  async deleteNeverSentDraftAtomic(data: {
    companyId: string; requestId: string; expectedUpdatedAt: Date; actorUserId: string;
    canPrepareOthers: boolean; scopes: { branchIds?: string[] }; onDeleted: (tx: any) => Promise<void>;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      // LINE apply locks Company FOR UPDATE before its action. Take a compatible FK lock first:
      // either apply or delete finishes before the other can hold the action/request locks.
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${data.companyId} FOR KEY SHARE`;
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { companyId: data.companyId, id: data.requestId }, include: { approvalSteps: true },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      this.assertDecisionBranch(row.branchId ?? undefined, data.scopes);
      if (!data.canPrepareOthers && row.requesterUserId !== data.actorUserId) throw new ForbiddenException('Cannot cancel this reimbursement');
      if (row.status !== 'DRAFT' || row.requestNo || row.submittedAt || row.approvalSteps.length || row.cancellationPendingAt
        || row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw this.draftChanged();
      await tx.attachmentLink.deleteMany({ where: {
        companyId: data.companyId, targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE, targetId: data.requestId,
      } });
      // Preserve the draft-action audit history while releasing its optional FK to this deleted draft.
      // An APPLIED or open action must name its request, so it becomes STALE: a LINE replay then answers that the draft is gone.
      await tx.reimbursementDraftAction.updateMany({ where: { companyId: data.companyId, requestId: data.requestId,
        status: { in: ['COLLECTING', 'PREVIEW', 'APPLIED'] } }, data: { status: 'STALE', requestId: null } });
      await tx.reimbursementDraftAction.updateMany({ where: { companyId: data.companyId, requestId: data.requestId }, data: { requestId: null } });
      await tx.reimbursementRequest.delete({ where: { id: data.requestId } });
      await data.onDeleted(tx);
    });
  }

  async cancelRequestAtomic(
    companyId: string,
    requestId: string,
    expectedStatus: ReimbursementRequestStatus,
    expectedUpdatedAt: Date,
    data: Record<string, unknown>,
  ): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, companyId, requestId);
      const changed = await tx.reimbursementRequest.updateMany({
        where: { id: requestId, companyId, status: expectedStatus, updatedAt: expectedUpdatedAt },
        data: { ...data, updatedAt: this.nextVersion(expectedUpdatedAt) },
      });
      if (changed.count !== 1) throw this.draftChanged();
      const row = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: requestId, companyId },
        include: { _count: { select: { lines: true } } },
      });
      return this.toRequest(row);
    });
  }

  async beginCancellationAtomic(data: {
    companyId: string;
    requestId: string;
    expectedStatus: ReimbursementRequestStatus;
    expectedUpdatedAt: Date;
    actorUserId: string;
    scopes: { branchIds?: string[] };
    reason: string;
    startedAt: Date;
    certificateAttestedAt?: Date;
    onIntentPersisted: (tx: any) => Promise<void>;
    /** Runs in the same transaction when a stored reason the void refuses is replaced by `reason`. */
    onReasonCorrected?: (tx: any, previousReason: string | undefined) => Promise<void>;
  }): Promise<{ request: ReimbursementRequestRecord; resumed: boolean }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes);
      if (request.cancellationPendingAt) {
        // Audit B3: a started cancellation is continued by whoever may cancel the claim, not only by
        // the person who started it (the caller has checked that right). Its reason stays the one on
        // record: expense records may already be voided under it. Only a stored reason the void
        // refuses is replaced, because nothing can have been voided with that one.
        const reasonChanged = request.cancellationPendingReason !== data.reason;
        const attestCertificate = !request.cancellationCertificateAttestedAt && data.certificateAttestedAt;
        if (!reasonChanged && !attestCertificate) return { request, resumed: true };
        if (reasonChanged && isExpenseVoidReason(request.cancellationPendingReason)) {
          throw new ConflictException('reimbursement_cancellation_already_pending');
        }
        const corrected = await tx.reimbursementRequest.updateMany({
          where: { id: data.requestId, companyId: data.companyId, updatedAt: row.updatedAt, cancellationPendingAt: row.cancellationPendingAt },
          data: { cancellationPendingReason: data.reason,
            ...(attestCertificate && { cancellationCertificateAttestedAt: attestCertificate }),
            updatedByUserId: data.actorUserId, updatedAt: this.nextVersion(row.updatedAt) },
        });
        if (corrected.count !== 1) throw new ConflictException('reimbursement_cancellation_state_changed');
        if (reasonChanged) await data.onReasonCorrected?.(tx, request.cancellationPendingReason);
        const updated = await tx.reimbursementRequest.findFirstOrThrow({
          where: { id: data.requestId, companyId: data.companyId },
          include: { lines: { orderBy: { lineNo: 'asc' } } },
        });
        return { request: this.toRequest(updated), resumed: true };
      }
      if (request.status !== data.expectedStatus || request.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        throw new ConflictException('reimbursement_cancellation_state_changed');
      }
      const recordedPayments = await tx.reimbursementPayment.count({
        where: { companyId: data.companyId, reimbursementRequestId: data.requestId, status: 'RECORDED' },
      });
      if (recordedPayments || request.paymentStatus === 'PAID' || request.paymentStatus === 'PARTIALLY_PAID') {
        throw new ConflictException('reimbursement_cancellation_has_payment');
      }
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: data.expectedStatus,
          updatedAt: data.expectedUpdatedAt,
          cancellationPendingAt: null,
        },
        data: {
          cancellationPendingAt: data.startedAt,
          cancellationPendingByUserId: data.actorUserId,
          cancellationPendingReason: data.reason,
          cancellationCertificateAttestedAt: data.certificateAttestedAt ?? null,
          updatedByUserId: data.actorUserId,
          updatedAt: this.nextVersion(data.expectedUpdatedAt),
        },
      });
      if (changed.count !== 1) throw new ConflictException('reimbursement_cancellation_state_changed');
      await data.onIntentPersisted(tx);
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return { request: this.toRequest(updated), resumed: false };
    });
  }

  async completeCancellationAtomic(data: {
    companyId: string;
    requestId: string;
    actorUserId: string;
    scopes: { branchIds?: string[] };
    systemReconcile?: boolean;
    expectedBranchId?: string;
    completedAt: Date;
    onCancelledPersisted: (tx: any) => Promise<void>;
  }): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      if (row.status === 'CANCELLED') return this.toRequest(row);
      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes, data.systemReconcile, data.expectedBranchId);
      // Whoever may cancel the claim finishes a cancellation someone else started; what matters is
      // that the intent is still there (it may have been withdrawn in between).
      if (!request.cancellationPendingAt) {
        throw new ConflictException('reimbursement_cancellation_intent_changed');
      }
      const recordedPayments = await tx.reimbursementPayment.count({
        where: { companyId: data.companyId, reimbursementRequestId: data.requestId, status: 'RECORDED' },
      });
      if (recordedPayments) throw new ConflictException('reimbursement_cancellation_has_payment');
      const projections = await tx.expenseRecord.findMany({
        where: { companyId: data.companyId, sourceReimbursementRequestId: data.requestId },
        select: { id: true, status: true, postingStatus: true },
      });
      if (projections.some((projection: any) => projection.status !== 'VOIDED')) {
        throw new ConflictException('reimbursement_cancellation_projection_live');
      }
      await tx.reimbursementApprovalStep.updateMany({
        where: { companyId: data.companyId, reimbursementRequestId: data.requestId, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          invalidatedAt: data.completedAt,
          invalidatedReason: 'reimbursement_cancelled',
        },
      });
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: row.status,
          updatedAt: row.updatedAt,
          cancellationPendingAt: row.cancellationPendingAt,
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: data.completedAt,
          cancellationCertificateAttestedAt: null,
          rejectionReason: request.cancellationPendingReason,
          currentApproverUserId: null,
          currentApprovalStepId: null,
          paymentStatus: 'NOT_PAYABLE',
          postingStatus: projections.some((projection: any) => projection.postingStatus === 'reversed')
            ? 'reversed'
            : 'not_required',
          updatedByUserId: data.actorUserId,
          updatedAt: this.nextVersion(row.updatedAt),
        },
      });
      if (changed.count !== 1) throw new ConflictException('reimbursement_cancellation_state_changed');
      await data.onCancelledPersisted(tx);
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return this.toRequest(updated);
    });
  }

  /**
   * What would stop this claim's cancellation from finishing: the first of its expense records the
   * void would refuse (a closed accounting period, a locked tax period, a journal that is not posted,
   * a record no void takes). Read before a cancellation is started, so the intent is not written for
   * a cancellation that cannot finish, and again whenever a started one is shown or continued.
   */
  async findCancellationBlocker(request: Pick<ReimbursementRequestRecord, 'id' | 'companyId' | 'branchId'>): Promise<ExpenseVoidBlocker | null> {
    for (const projection of await this.listClaimProjections(request.companyId, request.id)) {
      if (projection.status === 'VOIDED') continue;
      // The void's own authority check: a record on another branch than its claim is refused.
      if (projection.branchId !== request.branchId) return { code: 'expense_not_voidable' };
      const blocker = await findClaimExpenseVoidBlocker(this.prisma.client, request.companyId, projection.id);
      if (blocker) return blocker;
    }
    return null;
  }

  async findCancellationCertificates(request: Pick<ReimbursementRequestRecord, 'id' | 'companyId'>): Promise<Array<{
    expenseNumber: string | null; kind: 'SYSTEM' | 'EXTERNAL'; number: string | null;
  }>> {
    const certificates = [];
    for (const projection of await this.listClaimProjections(request.companyId, request.id)) {
      if (projection.status === 'VOIDED') continue;
      const certificate = await readExpenseCancellationCertificate(this.prisma.client, request.companyId, projection.id);
      if (certificate) certificates.push({ expenseNumber: projection.expenseNumber ?? null, ...certificate });
    }
    return certificates;
  }

  /**
   * The fence of a cancellation's expense voids, run first inside each void transaction: the void
   * goes ahead only while the claim still holds its cancellation intent.
   *
   * The claim's lock orders it against a withdrawal: either the withdrawal waits and then finds this
   * record voided (and refuses), or it ran first. The row lock is what makes "ran first" visible to a
   * void whose snapshot was taken while it waited (the confirmed-expense void is serializable):
   * PostgreSQL refuses to lock a row changed since that snapshot, and a read-committed void reads
   * the row as it is now. A shared lock, so two voids of one cancellation do not refuse each other.
   */
  async assertCancellationPending(tx: any, companyId: string, requestId: string, requireCertificateAttestation = false): Promise<void> {
    await this.lockRequest(tx, companyId, requestId);
    const rows: Array<{ pending: Date | null; attested: Date | null }> = await tx.$queryRaw`
      SELECT "cancellationPendingAt" AS pending, "cancellationCertificateAttestedAt" AS attested FROM "ReimbursementRequest"
      WHERE "id" = ${requestId} AND "companyId" = ${companyId} FOR SHARE`;
    if (!rows[0]?.pending || (requireCertificateAttestation && !rows[0].attested)) throw new ConflictException('reimbursement_cancellation_intent_changed');
  }

  /**
   * Takes a started cancellation back, so the claim goes on as before. Only while none of the
   * claim's expense records has been voided: after that the claim cannot go on, and the
   * cancellation has to be finished instead.
   */
  async withdrawCancellationAtomic(data: {
    companyId: string;
    requestId: string;
    actorUserId: string;
    scopes: { branchIds?: string[] };
    onWithdrawnPersisted: (tx: any, withdrawn: { startedByUserId?: string; startedAt: Date; reason?: string }) => Promise<void>;
  }): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({ where: { id: data.requestId, companyId: data.companyId } });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      this.assertDecisionBranch(row.branchId, data.scopes);
      if (!row.cancellationPendingAt) throw new ConflictException('reimbursement_cancellation_not_pending');
      const voided = await tx.expenseRecord.count({
        where: { companyId: data.companyId, sourceReimbursementRequestId: data.requestId, status: 'VOIDED' },
      });
      if (voided > 0) throw new ConflictException('reimbursement_cancellation_partly_done');
      const changed = await tx.reimbursementRequest.updateMany({
        where: { id: data.requestId, companyId: data.companyId, updatedAt: row.updatedAt, cancellationPendingAt: row.cancellationPendingAt },
        data: {
          cancellationPendingAt: null,
          cancellationPendingByUserId: null,
          cancellationPendingReason: null,
          cancellationCertificateAttestedAt: null,
          updatedByUserId: data.actorUserId,
          updatedAt: this.nextVersion(row.updatedAt),
        },
      });
      if (changed.count !== 1) throw new ConflictException('reimbursement_cancellation_state_changed');
      await data.onWithdrawnPersisted(tx, {
        startedByUserId: opt(row.cancellationPendingByUserId), startedAt: row.cancellationPendingAt, reason: opt(row.cancellationPendingReason),
      });
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId },
        include: { _count: { select: { lines: true } } },
      });
      return this.toRequest(updated);
    });
  }

  async listPendingCancellationIntents(limit = 100): Promise<Array<{
    request: ReimbursementRequestRecord;
    actorUserId: string;
    reason: string;
  }>> {
    const rows = await (this.prisma.client as any).reimbursementRequest.findMany({
      where: { cancellationPendingAt: { not: null }, status: { notIn: ['CANCELLED', 'VOIDED'] } },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      // Newest first, like the projection intents: one a person has to unblock never holds the head of the list.
      orderBy: { cancellationPendingAt: 'desc' },
      take: limit,
    });
    return rows.flatMap((row: any) => row.cancellationPendingByUserId && row.cancellationPendingReason
      ? [{ request: this.toRequest(row), actorUserId: row.cancellationPendingByUserId, reason: row.cancellationPendingReason }]
      : []);
  }

  // ---- Payout account (rules: ../domain/logic/payout-destination.logic.ts, SQL: ./reimbursement-payout.ts) ----

  listSavedPayoutAccounts(companyId: string, userId: string) {
    return listSavedPayoutAccounts(this.prisma.client, companyId, userId);
  }

  findSavedPayoutAccount(companyId: string, userId: string, id: string) {
    return readSavedPayoutAccount(this.prisma.client, companyId, userId, id);
  }

  findSavedPayoutSecret(companyId: string, userId: string, id: string) {
    return readSavedPayoutSecret(this.prisma.client, companyId, userId, id);
  }

  /** Server-side copies only, never an outbound payload. */
  findSavedPayoutAccountForCopy(companyId: string, userId: string, id: string) {
    return readSavedPayoutAccountForCopy(this.prisma.client, companyId, userId, id);
  }

  addSavedPayoutAccount(data: SavedPayoutAccountWrite, onPersisted: (tx: any, account: SavedPayoutAccountRecord) => Promise<void>) {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      const account = await addSavedPayoutAccount(tx, data);
      await onPersisted(tx, account);
      return account;
    });
  }

  removeSavedPayoutAccount(companyId: string, userId: string, id: string, onPersisted: (tx: any, account: SavedPayoutAccountRecord) => Promise<void>) {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      const account = await deleteSavedPayoutAccount(tx, companyId, userId, id);
      await onPersisted(tx, account);
    });
  }

  makeSavedPayoutAccountDefault(
    companyId: string, userId: string, id: string,
    writeDefault: (tx: any, destination: SealedPayoutDestination) => Promise<MemberPayoutAccountRecord>,
    onPersisted: (tx: any, account: SavedPayoutAccountRecord) => Promise<void>,
  ): Promise<MemberPayoutAccountRecord> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      const result = await makeSavedPayoutAccountDefault(tx, companyId, userId, id, (destination) => writeDefault(tx, destination));
      await onPersisted(tx, result.saved);
      return result.account;
    });
  }

  findClaimPayoutHolderType(claim: Parameters<typeof readClaimPayoutHolderType>[1]) {
    return readClaimPayoutHolderType(this.prisma.client, claim);
  }

  findMemberPayoutAccount(companyId: string, userId: string): Promise<MemberPayoutAccountRecord | null> {
    return readMemberPayoutAccount(this.prisma.client, companyId, userId);
  }

  /** Reveal only. */
  findMemberPayoutSecret(companyId: string, userId: string): Promise<string | null> {
    return readMemberPayoutSecret(this.prisma.client, companyId, userId);
  }

  /** `tx`: join a draft save that sets the default in the same transaction. */
  async setMemberPayoutAccount(
    data: { companyId: string; userId: string; actorUserId: string; payoutMethod: 'BANK_TRANSFER' | 'CASH'; destination?: SealedPayoutDestination },
    onPersisted: (tx: any, change: { before: MemberPayoutAccountRecord | null; after: MemberPayoutAccountRecord }) => Promise<void>,
    tx?: any,
  ): Promise<MemberPayoutAccountRecord> {
    const write = async (client: any) => {
      const change = await writeMemberPayoutAccount(client, data);
      await onPersisted(client, change);
      return change.after;
    };
    return tx ? write(tx) : (this.prisma.client as any).$transaction(write);
  }

  async removeMemberPayoutAccount(
    companyId: string,
    userId: string,
    onPersisted: (tx: any, before: MemberPayoutAccountRecord) => Promise<void>,
  ): Promise<boolean> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      const before = await deleteMemberPayoutAccount(tx, companyId, userId);
      if (before) await onPersisted(tx, before);
      return !!before;
    });
  }

  /**
   * Whose default account an employee-data editor may set: the member, whether they have an employee
   * record, their branches, and whether they manage people themselves (a manager may not set a
   * peer's or a superior's account).
   */
  async findPayoutMember(companyId: string, userId: string): Promise<{
    displayName: string; membershipStatus: string; hasEmployeeProfile: boolean; allBranches: boolean; branchIds: string[]; managesPeople: boolean;
  } | null> {
    const row = await this.prisma.client.companyMembership.findFirst({
      where: { companyId, userId },
      select: {
        status: true, branchScopeMode: true, defaultBranchId: true, branchScopes: { select: { branchId: true } },
        employeeAccessProfile: { select: { id: true } }, user: { select: { displayName: true } },
        roles: { select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
      },
    });
    if (!row) return null;
    return {
      displayName: row.user.displayName,
      // The status the notification writer filters recipients by: only an ACTIVE member is ever told.
      membershipStatus: row.status,
      hasEmployeeProfile: !!row.employeeAccessProfile,
      // The same reading of "people-managing role" as suspending or deleting an employee uses.
      managesPeople: row.roles.some(({ role }) => PAYOUT_PEOPLE_MANAGER_ROLE_KEYS.includes(role.key)
        || hasPrivilegedGrant(role.permissions.map((entry) => entry.permission.key))),
      allBranches: row.branchScopeMode === 'ALL_BRANCHES',
      branchIds: [...new Set([...row.branchScopes.map((scope) => scope.branchId), ...(row.defaultBranchId ? [row.defaultBranchId] : [])])],
    };
  }

  /**
   * Whether the member holds the product's own OWNER or ADMIN role. Roles are compared by what they
   * are, not by their key: a role a company makes gets its key from its name, so a custom role named
   * "Admin" has the key ADMIN too, and so does the copy a company gets when it edits the Admin role.
   * Both live in the company's scope (`scopeKey` = the company, `isSystem` false) and cannot be told
   * apart, so neither counts: only the system role (`scopeKey` 'system', no company) does.
   */
  async holdsSystemOwnerOrAdminRole(companyId: string, userId: string): Promise<boolean> {
    return !!await this.prisma.client.companyMembership.findFirst({
      where: {
        companyId, userId, status: 'ACTIVE',
        roles: { some: { role: { key: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE', isSystem: true, scopeKey: 'system', companyId: null } } },
      },
      select: { id: true },
    });
  }

  /**
   * The claim's own snapshot. Never the member's default account.
   * `client`: a transaction, for a caller that reads what that transaction has just frozen on the claim.
   */
  findClaimPayout(request: Parameters<typeof readClaimPayout>[1], client: unknown = this.prisma.client) {
    return readClaimPayout(client, request);
  }

  /** Every account the claim has been sent with, oldest first, masked: the claim page's account history. */
  listClaimPayoutVersions(request: ReimbursementRequestRecord) {
    return readClaimPayoutVersions(this.prisma.client, request);
  }

  /** A draft only: the requester's default account it will be sent with. */
  findDraftDefaultPayout(request: ReimbursementRequestRecord) {
    return readDraftDefaultPayout(this.prisma.client, request);
  }

  /** Reveal only. */
  findClaimPayoutSecret(companyId: string, requestId: string, version: number) {
    return readClaimPayoutSecret(this.prisma.client, companyId, requestId, version);
  }

  planSubmitPayout(request: ReimbursementRequestRecord): Promise<SubmitPayoutPlan> {
    return readSubmitPayoutPlan(this.prisma.client, request);
  }

  /** A legacy claim's payer only: the requester's default account as it is now, masked (spec §15). */
  findLegacyPayoutDefault(request: ReimbursementRequestRecord) {
    return readLegacyPayoutDefault(this.prisma.client, request);
  }

  /** The masked accounts a claim's payments were confirmed into, by account version. */
  listPaymentPayoutDestinations(companyId: string, requestId: string, versions: readonly number[]) {
    return readPaymentPayoutDestinations(this.prisma.client, companyId, requestId, versions);
  }

  /** Friendly preflight of the payout proof that `recordPaymentAtomic` repeats under the payment lock. */
  assertPaymentPayoutUsable(request: ReimbursementRequestRecord, plan: PaymentPayoutPlan): Promise<void> {
    return assertPaymentPayoutUsable(this.prisma.client, request, plan);
  }

  /** Shared preflight and locked proof; replay comparisons run before this guard. */
  async assertPaymentRecordInput(request: { companyId: string; currency: string }, input: { currency?: string; bankAccountId?: string }, client: any = this.prisma.client): Promise<void> {
    if (input.currency !== undefined && input.currency !== request.currency) throw new ConflictException('payment_currency_mismatch');
    if (input.bankAccountId !== undefined && !await client.bankAccount.findFirst({
      where: { id: input.bankAccountId, companyId: request.companyId, status: 'ACTIVE' }, select: { id: true },
    })) throw new ConflictException('payment_source_bank_account_invalid');
  }

  /** A recorded payment's account as a payment request states it: see `isSamePaymentRequest`. */
  findRecordedPaymentPayout(request: ReimbursementRequestRecord, payment: ReimbursementPaymentRecord) {
    return readRecordedPaymentPayout(this.prisma.client, request, payment);
  }

  private async lockRequest(tx: any, companyId: string, requestId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${requestId}:reimbursement-request`}))`;
  }

  /**
   * A claim being cancelled takes no other decision until that cancellation is finished or
   * withdrawn (audit B3). A decision taken in between could leave it in a status the cancellation
   * cannot complete from, or build expense records the cancellation then has to void.
   */
  private assertNotBeingCancelled(row: { cancellationPendingAt?: Date | null }): void {
    if (row.cancellationPendingAt) throw new ConflictException('reimbursement_cancellation_pending');
  }

  private assertDecisionBranch(
    branchId: string | null | undefined,
    scopes: { branchIds?: string[] },
    systemReconcile = false,
    expectedBranchId?: string,
  ): void {
    requireTransactionBranchId(branchId);
    if (systemReconcile) {
      if ((branchId ?? undefined) !== expectedBranchId) {
        throw new ForbiddenException('reimbursement_projection_branch_changed');
      }
      return;
    }
    if (!isBranchInScope(scopes, branchId)) {
      throw new ForbiddenException('Branch is outside your assigned branch scope.');
    }
  }

  private async assertApproverEligibility(
    tx: any,
    companyId: string,
    step: { approverUserId?: string | null; approverRoleSnapshot?: string | null; assignedApproverUserIdsJson?: unknown },
    actorUserId: string,
    actorRoles: string[],
    branchId?: string | null,
    requesterUserId?: string,
  ): Promise<boolean> {
    if (requesterUserId && isOwnerSelfApproval(requesterUserId, actorUserId, actorRoles)) return false;
    const frozenAssignees = stringArrayOpt(step.assignedApproverUserIdsJson);
    if (frozenAssignees) {
      const activeAssignees = await this.activeApproverUserIds(tx, companyId, frozenAssignees, branchId);
      const frozenAuthority = frozenApprovalAuthority(frozenAssignees, activeAssignees, actorUserId);
      if (frozenAuthority === 'ASSIGNED') return true;
      if (frozenAuthority === 'DENIED') throw new ForbiddenException('not_assigned_approver');
    }
    // Audit H-20: a step naming a person used to be exact-match forever, so disabling that member
    // froze the request with no reassign route and no OWNER fallback. The assignment now only binds
    // while the person can still act for this company; after that the step falls back to the role
    // it was ALSO recorded with, which is the routing it would have had without a name on it.
    //
    // Read through `tx`: the eligibility decision and the status update it guards have to see the
    // same snapshot, or a member disabled mid-transaction could still be treated as assigned.
    if (step.approverUserId && await this.canActAsApprover(tx, companyId, step.approverUserId, branchId)) {
      if (step.approverUserId !== actorUserId) throw new ForbiddenException('not_assigned_approver');
      return true;
    }
    // Same predicate as the use-case gate: a role-routed step is approvable by that role or by the
    // OWNER; only a step naming a specific person who can still act stays exact-match.
    if (!matchesApproverRole(step.approverRoleSnapshot, actorRoles)) {
      throw new ForbiddenException('not_eligible_approver_role');
    }
    return false;
  }

  private async activeApproverUserIds(tx: any, companyId: string, userIds: string[], branchId?: string | null): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await tx.companyMembership.findMany({
      where: activeApproverMembershipWhere(companyId, userIds, branchId),
      select: { userId: true },
    });
    return new Set(rows.map((row: { userId: string }) => row.userId));
  }

  /** Membership-level, not user-level: an ACTIVE person removed from THIS company cannot approve. */
  private async canActAsApprover(tx: any, companyId: string, userId: string, branchId?: string | null): Promise<boolean> {
    const membership = await tx.companyMembership.findFirst({
      where: activeApproverMembershipWhere(companyId, [userId], branchId),
      select: { id: true },
    });
    return Boolean(membership);
  }

  private async lockEvidence(
    tx: any,
    companyId: string,
    evidence: { attachmentIds: string[]; expenseIds: string[] },
  ): Promise<void> {
    await lockFundingEvidence(tx, companyId, evidence);
  }

  private async assertEvidenceAvailable(
    tx: any,
    companyId: string,
    requestId: string,
    evidence: { attachmentIds: string[]; expenseIds: string[] },
  ): Promise<void> {
    if (evidence.attachmentIds.length === 0 && evidence.expenseIds.length === 0) return;
    const hit = await tx.reimbursementLine.findFirst({
      where: {
        companyId,
        reimbursementRequestId: { not: requestId },
        request: { status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'] } },
        OR: [
          ...(evidence.attachmentIds.length > 0 ? [{ attachmentId: { in: evidence.attachmentIds } }] : []),
          ...(evidence.expenseIds.length > 0 ? [{ linkedExpenseId: { in: evidence.expenseIds } }] : []),
        ],
      },
      select: { attachmentId: true, linkedExpenseId: true },
    });
    if (!hit) return;
    throw new UnprocessableEntityException(
      hit.attachmentId && evidence.attachmentIds.includes(hit.attachmentId)
        ? 'attachment_already_claimed'
        : 'expense_already_claimed',
    );
  }

  private draftChanged(): ConflictException {
    return new ConflictException({
      code: 'reimbursement_draft_changed',
      message: 'Reimbursement draft changed. Reload and review before trying again.',
    });
  }

  private requestChanged(): ConflictException {
    return new ConflictException({ code: 'reimbursement_changed', message: 'Reimbursement changed. Reload and retry.' });
  }

  private nextVersion(observed: Date): Date {
    return new Date(Math.max(Date.now(), observed.getTime() + 1));
  }

  private assertApprovalSnapshot(
    request: ReimbursementRequestRecord,
    expectedApprovalSnapshotHash?: string,
  ): string {
    const storedHash = request.approvalSnapshotHash;
    if (!storedHash || !request.lines?.length) throw new ConflictException('stale_approval_snapshot');
    // Same builder as the submit that stored the hash: a claim sent with a payout snapshot is
    // checked with it, a legacy claim without.
    const liveHash = computeSnapshotHash(claimSnapshotFields(request, request.approvalPolicySnapshotJson));
    const legacyV1Compatible = isExactLegacyV1FallbackSnapshot({
      requestId: request.id,
      companyId: request.companyId,
      amount: request.amount,
      currency: request.currency,
      categoryKey: request.categoryKey,
      categoryLabelSnapshot: request.categoryLabelSnapshot,
      incurredDate: request.incurredDate.toISOString(),
      title: request.title,
      reason: request.reason,
      primaryAttachmentId: request.primaryAttachmentId,
      linkedExpenseId: request.linkedExpenseId,
      lines: request.lines,
    }, storedHash);
    if (storedHash !== liveHash && !legacyV1Compatible) throw new ConflictException('stale_approval_snapshot');
    // Nothing is approved unseen: the approver names the claim content they looked at, and it has to
    // be the content stored now. A call that names none is as stale as one that names another.
    if (expectedApprovalSnapshotHash !== storedHash) {
      throw new ConflictException('stale_approval_snapshot');
    }
    return storedHash;
  }

  /**
   * Wholesale line replacement, mirroring the expense-line convention: advisory
   * lock on the claim, drop the lines the caller no longer sends, upsert the
   * rest on the (requestId, lineNo) unique — never create-then-catch-P2002
   * inside a transaction (Prisma 7 aborts it, 25P02).
   */
  private async replaceLines(
    tx: any,
    companyId: string,
    requestId: string,
    lines: ReimbursementLineWriteData[],
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${requestId}:reimbursement-lines`}))`;
    // The transition trigger's deterministic row id is durable legacy provenance. Once the final
    // writer supplies real lines, remove that fallback instead of upserting over it and making an
    // edited v2 row indistinguishable from the untouched migration mapping.
    await tx.reimbursementLine.deleteMany({
      where: { id: `rbl_${requestId}`, companyId, reimbursementRequestId: requestId },
    });
    await tx.reimbursementLine.deleteMany({
      where: { companyId, reimbursementRequestId: requestId, lineNo: { notIn: lines.map((line) => line.lineNo) } },
    });
    for (const line of lines) {
      const data = {
        companyId,
        reimbursementRequestId: requestId,
        lineNo: line.lineNo,
        incurredDate: line.incurredDate,
        description: line.description,
        purpose: line.purpose ?? null,
        categoryKey: line.categoryKey,
        categoryLabelSnapshot: line.categoryLabelSnapshot ?? null,
        amount: line.amount,
        attachmentId: line.attachmentId ?? null,
        linkedExpenseId: line.linkedExpenseId ?? null,
        sourceExpenseSnapshotJson: line.sourceExpenseSnapshot ?? Prisma.DbNull,
        attachmentSnapshotJson: line.attachmentSnapshot ?? Prisma.DbNull,
      };
      await tx.reimbursementLine.upsert({
        where: { reimbursementRequestId_lineNo: { reimbursementRequestId: requestId, lineNo: line.lineNo } },
        create: data,
        update: data,
      });
    }
  }

  /**
   * Durable manager decision fence. When finance is not required the request
   * deliberately remains PENDING_APPROVAL until projections pass the shared
   * expense-confirm path. An exact retry resumes from the already-approved step.
   */
  async beginApprovalDecisionAtomic(data: {
    previewOnly?: boolean;
    companyId: string;
    requestId: string;
    expectedUpdatedAt: Date;
    expectedApprovalSnapshotHash?: string;
    actorUserId: string;
    actorRoles: string[];
    scopes: { branchIds?: string[] };
    allowSelfApproval: boolean;
    financeReviewRequired: boolean;
    decidedAt: Date;
    comment?: string;
    /** "ตรวจบัญชีแล้ว": the account version the approver looked at. */
    payoutVerifiedVersion?: unknown;
    payoutThirdPartyAccepted?: unknown;
    financeRequestPatch: Record<string, unknown>;
    onDecisionPersisted: (tx: any) => Promise<void>;
  }): Promise<{ request: ReimbursementRequestRecord; resumed: boolean; approvalStepId: string }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      if (row.status !== 'PENDING_APPROVAL') throw notAwaitingApproval();
      if (row.cancellationPendingAt) {
        throw new ConflictException('reimbursement_cancellation_pending');
      }
      // A claim whose payout account is being corrected is approved by `approvePayoutCorrectionAtomic`
      // alone, in one transaction. This two-phase decision would leave it decided and still in its round.
      if (row.payoutCorrectionRequestedAt) throw new ConflictException('payout_correction_in_progress');
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        throw new ConflictException('stale_approval_snapshot');
      }

      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes);
      await assertReimbursementSources(tx, request);
      const storedHash = this.assertApprovalSnapshot(request, data.expectedApprovalSnapshotHash);
      if (!request.currentApprovalStepId) throw new ConflictException('stale_approval_snapshot');
      const step = await tx.reimbursementApprovalStep.findFirst({
        where: {
          id: request.currentApprovalStepId,
          companyId: data.companyId,
          reimbursementRequestId: data.requestId,
        },
      });
      if (!step || step.requestSnapshotHash !== storedHash) throw new ConflictException('stale_approval_snapshot');
      const assignedBySnapshot = await this.assertApproverEligibility(tx, data.companyId, step, data.actorUserId, data.actorRoles, request.branchId, request.requesterUserId);
      if (!assignedBySnapshot && isSelfApproval(request.requesterUserId, data.actorUserId, data.allowSelfApproval, data.actorRoles)) {
        throw new ForbiddenException('self_approval_denied');
      }

      if (step.status === 'APPROVED') {
        if (data.financeReviewRequired
          || step.decisionByUserId !== data.actorUserId
          || step.decidedAt == null) {
          throw new ConflictException('stale_approval_snapshot');
        }
        return { request, resumed: true, approvalStepId: step.id };
      }
      if (step.status !== 'PENDING') throw new ConflictException('stale_approval_snapshot');
      // The LINE card reads the same locked source/snapshot/branch/assignment guards as its press.
      if (data.previewOnly) return { request, resumed: false, approvalStepId: step.id };
      // Same transaction as the decision: an approval of a transfer claim cannot exist without it.
      await attestClaimPayout(tx, request, {
        verifiedVersion: data.payoutVerifiedVersion, thirdPartyAccepted: data.payoutThirdPartyAccepted, actorUserId: data.actorUserId, verifiedAt: data.decidedAt, approvalStepId: step.id,
      });

      const changedStep = await tx.reimbursementApprovalStep.updateMany({
        where: {
          id: step.id,
          companyId: data.companyId,
          reimbursementRequestId: data.requestId,
          status: 'PENDING',
          requestSnapshotHash: storedHash,
        },
        data: {
          status: 'APPROVED',
          decidedAt: data.decidedAt,
          decisionByUserId: data.actorUserId,
          comment: data.comment,
        },
      });
      if (changedStep.count !== 1) throw new ConflictException('stale_approval_snapshot');

      const changedRequest = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: 'PENDING_APPROVAL',
          updatedAt: data.expectedUpdatedAt,
          currentApprovalStepId: step.id,
          cancellationPendingAt: null,
        },
        data: data.financeReviewRequired
          ? { ...data.financeRequestPatch, updatedAt: this.nextVersion(data.expectedUpdatedAt) }
          : { updatedByUserId: data.actorUserId, updatedAt: this.nextVersion(data.expectedUpdatedAt) },
      });
      if (changedRequest.count !== 1) throw new ConflictException('stale_approval_snapshot');
      await data.onDecisionPersisted(tx);
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return { request: this.toRequest(updated), resumed: false, approvalStepId: step.id };
    });
  }

  /** Finance approval is also a durable intent; READY is a separate phase. */
  async beginFinanceApprovalAtomic(data: {
    companyId: string;
    requestId: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
    scopes: { branchIds?: string[] };
    reviewedAt: Date;
    note?: string;
    resolveRequestDuplicates?: boolean;
    duplicateResolutionReason?: string;
    onDecisionPersisted: (tx: any) => Promise<void>;
  }): Promise<{ request: ReimbursementRequestRecord; resumed: boolean }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } }, sourceExpenses: OWN_DUPLICATE_EXPENSES },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      if (row.status !== 'FINANCE_REVIEW') {
        throw new UnprocessableEntityException(`Cannot finance-review from status ${row.status}`);
      }
      this.assertNotBeingCancelled(row);
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        throw new ConflictException('stale_finance_review_snapshot');
      }
      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes);
      const refusal = data.resolveRequestDuplicates && confirmedDuplicateRefusal(request);
      if (refusal) throw new UnprocessableEntityException(refusal);
      await assertReimbursementSources(tx, request);
      if (request.financeReviewStatus === 'APPROVED_FOR_PAYMENT') {
        if (request.financeReviewedByUserId !== data.actorUserId || !request.financeReviewedAt) {
          throw new ConflictException('finance_approval_already_decided');
        }
        return { request, resumed: true };
      }
      if (!['PENDING', 'NEEDS_INFO', 'BLOCKED'].includes(request.financeReviewStatus)) {
        throw new ConflictException('stale_finance_review_snapshot');
      }
      if (data.resolveRequestDuplicates) {
        await this.overrideOpenDuplicates(tx, data.companyId, data.requestId, data.actorUserId, data.reviewedAt, data.duplicateResolutionReason);
      }
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: 'FINANCE_REVIEW',
          updatedAt: data.expectedUpdatedAt,
          financeReviewStatus: row.financeReviewStatus,
        },
        data: {
          financeReviewStatus: 'APPROVED_FOR_PAYMENT',
          financeReviewedByUserId: data.actorUserId,
          financeReviewedAt: data.reviewedAt,
          financeReviewNote: data.note,
          ...(data.resolveRequestDuplicates && { duplicateStatus: 'OVERRIDDEN' }),
          updatedByUserId: data.actorUserId,
          updatedAt: this.nextVersion(data.expectedUpdatedAt),
        },
      });
      if (changed.count !== 1) throw new ConflictException('stale_finance_review_snapshot');
      await data.onDecisionPersisted(tx);
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return { request: this.toRequest(updated), resumed: false };
    });
  }

  /**
   * A duplicate block at the payment step, where no finance decision is left to carry the override
   * (finance review off, or approved without it). Same lock, CAS, branch check and candidate write
   * as the finance approval above. `duplicateStatus` is left alone: after projection it holds the
   * expense-level result; the payment gate reads the candidates and unresolved source expenses.
   */
  async resolvePaymentDuplicatesAtomic(data: {
    companyId: string;
    requestId: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
    scopes: { branchIds?: string[] };
    resolvedAt: Date;
    reason: string;
    onResolvedPersisted: (tx: any) => Promise<void>;
  }): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return serializableTransaction(client, async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({ where: { id: data.requestId, companyId: data.companyId }, include: { sourceExpenses: OWN_DUPLICATE_EXPENSES } });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      if (!['APPROVED', 'READY_FOR_PAYMENT'].includes(row.status)) {
        throw new UnprocessableEntityException(`Cannot resolve duplicates from status ${row.status}`);
      }
      this.assertNotBeingCancelled(row);
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw this.requestChanged();
      this.assertDecisionBranch(row.branchId, data.scopes);
      const refusal = confirmedDuplicateRefusal(this.toRequest(row));
      if (refusal) throw new UnprocessableEntityException(refusal);
      await this.overrideOpenDuplicates(tx, data.companyId, data.requestId, data.actorUserId, data.resolvedAt, data.reason);
      const changed = await tx.reimbursementRequest.updateMany({
        where: { id: data.requestId, companyId: data.companyId, status: row.status, updatedAt: data.expectedUpdatedAt },
        data: { updatedByUserId: data.actorUserId, updatedAt: this.nextVersion(data.expectedUpdatedAt) },
      });
      if (changed.count !== 1) throw this.requestChanged();
      await data.onResolvedPersisted(tx);
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } }, sourceExpenses: OWN_DUPLICATE_EXPENSES },
      });
      return this.toRequest(updated);
    });
  }

  async refreshClaimProjectionState(companyId: string, requestId: string, scopes: { branchIds?: string[] }, db?: Prisma.TransactionClient): Promise<void> {
    const refresh = async (tx: any) => {
      await this.lockRequest(tx, companyId, requestId);
      const row = await tx.reimbursementRequest.findFirst({ where: { companyId, id: requestId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      if (!row || !['APPROVED', 'READY_FOR_PAYMENT'].includes(row.status)) throw new ConflictException('reimbursement_projection_decision_changed');
      this.assertNotBeingCancelled(row);
      this.assertDecisionBranch(row.branchId, scopes);
      const readiness = await this.assertClaimProjectionsReady(tx, this.toRequest(row));
      await tx.reimbursementRequest.update({ where: { id: requestId }, data: { duplicateStatus: readiness.duplicateStatus, postingStatus: readiness.postingStatus } });
    };
    if (db) await refresh(db);
    else await (this.prisma.client as any).$transaction(refresh);
  }

  private async overrideOpenDuplicates(tx: any, companyId: string, requestId: string, actorUserId: string, resolvedAt: Date, reason?: string): Promise<void> {
    await tx.reimbursementDuplicateCandidate.updateMany({
      where: { companyId, reimbursementRequestId: requestId, status: 'OPEN' },
      data: { status: 'OVERRIDDEN', resolvedByUserId: actorUserId, resolvedAt, reason },
    });
  }

  async recordFinanceReviewAtomic(data: {
    companyId: string;
    requestId: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
    scopes: { branchIds?: string[] };
    reviewedAt: Date;
    decision: 'NEEDS_INFO' | 'BLOCKED';
    note?: string;
    onDecisionPersisted: (tx: any) => Promise<void>;
  }): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      if (row.status !== 'FINANCE_REVIEW') {
        throw new UnprocessableEntityException(`Cannot finance-review from status ${row.status}`);
      }
      this.assertNotBeingCancelled(row);
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        throw new ConflictException('stale_finance_review_snapshot');
      }
      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes);
      if (request.financeReviewStatus === 'APPROVED_FOR_PAYMENT') {
        throw new ConflictException('finance_approval_already_decided');
      }
      if (data.decision === 'NEEDS_INFO') {
        const [recordedPayments, liveProjections] = await Promise.all([
          tx.reimbursementPayment.count({
            where: { companyId: data.companyId, reimbursementRequestId: data.requestId, status: 'RECORDED' },
          }),
          tx.expenseRecord.count({
            where: { companyId: data.companyId, sourceReimbursementRequestId: data.requestId, status: { not: 'VOIDED' } },
          }),
        ]);
        if (recordedPayments) throw new ConflictException('reimbursement_correction_has_payment');
        if (liveProjections) throw new ConflictException('reimbursement_correction_has_projection');
      }
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: 'FINANCE_REVIEW',
          updatedAt: data.expectedUpdatedAt,
          financeReviewStatus: row.financeReviewStatus,
        },
        data: {
          ...(data.decision === 'NEEDS_INFO' ? {
            status: 'DRAFT',
            submittedAt: null,
            submittedByUserId: null,
            approvedAt: null,
            currentApproverUserId: null,
            currentApprovalStepId: null,
            approvalSnapshotHash: null,
            approvalPolicySnapshotJson: null,
            paymentStatus: 'NOT_PAYABLE',
            duplicateStatus: 'NOT_CHECKED',
            postingStatus: 'not_required',
            ...await draftPayoutAfterReopen(tx, request),
          } : {}),
          financeReviewStatus: data.decision,
          financeReviewedByUserId: data.actorUserId,
          financeReviewedAt: data.reviewedAt,
          financeReviewNote: data.note,
          updatedByUserId: data.actorUserId,
          updatedAt: this.nextVersion(data.expectedUpdatedAt),
        },
      });
      if (changed.count !== 1) throw new ConflictException('stale_finance_review_snapshot');
      if (data.decision === 'NEEDS_INFO') {
        await Promise.all([
          tx.reimbursementClaimSignature.deleteMany({
            where: { companyId: data.companyId, reimbursementRequestId: data.requestId },
          }),
          tx.attachmentLink.deleteMany({
            where: {
              companyId: data.companyId,
              targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE,
              targetId: data.requestId,
              purpose: REIMBURSEMENT_SIGNED_COPY_PURPOSE,
            },
          }),
        ]);
      }
      await data.onDecisionPersisted(tx);
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return this.toRequest(updated);
    });
  }

  /** Idempotently creates one exact claim projection per source line. */
  async prepareClaimProjections(data: {
    companyId: string;
    requestId: string;
    decisionKind: 'MANAGER' | 'FINANCE' | 'POLICY';
    decisionActorUserId: string;
    approvalStepId?: string;
    scopes: { branchIds?: string[] };
    systemReconcile?: boolean;
    expectedBranchId?: string;
    items: MaterializeClaimExpenseItem[];
  }): Promise<Array<{ reimbursementLineId: string; expenseId: string; created: boolean }>> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes, data.systemReconcile, data.expectedBranchId);
      // No expense record is built for a claim that is being cancelled: the cancellation would have to void it.
      this.assertNotBeingCancelled(request);
      if (data.decisionKind === 'MANAGER') {
        if (request.status !== 'PENDING_APPROVAL' || request.currentApprovalStepId !== data.approvalStepId) {
          throw new ConflictException('reimbursement_projection_decision_changed');
        }
        const step = await tx.reimbursementApprovalStep.findFirst({
          where: {
            id: data.approvalStepId,
            companyId: data.companyId,
            reimbursementRequestId: data.requestId,
            status: 'APPROVED',
            decisionByUserId: data.decisionActorUserId,
          },
        });
        if (!step || step.requestSnapshotHash !== request.approvalSnapshotHash) {
          throw new ConflictException('reimbursement_projection_decision_changed');
        }
        // Whoever carries the decision out, at once or as a retry: the claim must still be what was
        // approved. Nothing is built for a claim whose content moved since (stale_approval_snapshot).
        this.assertApprovalSnapshot(request, request.approvalSnapshotHash);
      } else if (data.decisionKind === 'FINANCE') {
        if (request.status !== 'FINANCE_REVIEW'
          || request.financeReviewStatus !== 'APPROVED_FOR_PAYMENT'
          || request.financeReviewedByUserId !== data.decisionActorUserId) {
          throw new ConflictException('reimbursement_projection_decision_changed');
        }
      } else {
        const snapshot = parseReimbursementPolicySnapshot(request.approvalPolicySnapshotJson);
        if (request.status !== 'APPROVED' || request.currentApprovalStepId
          || !snapshot || snapshot.requiresApproval || snapshot.financeReviewRequired) {
          throw new ConflictException('reimbursement_projection_decision_changed');
        }
      }

      await assertReimbursementSources(tx, request);
      const lines = request.lines ?? [];
      const itemByLineId = new Map(data.items.map((item) => [item.reimbursementLineId, item]));
      if (!lines.length || itemByLineId.size !== lines.length
        || lines.some((line) => !itemByLineId.has(line.id))) {
        throw new ConflictException('reimbursement_projection_source_changed');
      }

      const results: Array<{ reimbursementLineId: string; expenseId: string; created: boolean }> = [];
      for (const line of lines) {
        const item = itemByLineId.get(line.id)!;
        // Normalized on both sides: the item builder writes a NULL branch as `null` while
        // toRequest maps it to `undefined`, so a raw !== rejected every branch-less claim as
        // "source changed" and finance review could never complete for them.
        if ((item.branchId ?? null) !== (request.branchId ?? null)
          || item.expenseDate.getTime() !== line.incurredDate.getTime()
          || !isDeepStrictEqual(item.sourceChannelMetadataJson.reimbursementSource, line.sourceExpenseSnapshot)
          || !d(item.grandTotalAmount).eq(d(line.amount))) {
          throw new ConflictException('reimbursement_projection_source_changed');
        }
        const existing = await tx.expenseRecord.findFirst({
          where: { companyId: data.companyId, sourceReimbursementLineId: line.id },
        });
        if (existing) {
          if (existing.sourceReimbursementRequestId !== data.requestId
            || (existing.branchId ?? undefined) !== request.branchId) {
            throw new ConflictException('reimbursement_projection_source_mismatch');
          }
          results.push({ reimbursementLineId: line.id, expenseId: existing.id, created: false });
          continue;
        }

        await assertActiveExpenseBranch(tx, data.companyId, request.branchId);
        const expense = await tx.expenseRecord.create({
          data: {
            companyId: data.companyId,
            branchId: request.branchId ?? null,
            sourceReimbursementRequestId: data.requestId,
            sourceReimbursementLineId: line.id,
            status: item.status,
            captureSource: item.captureSource,
            expenseDate: item.expenseDate,
            currency: item.currency,
            vatMode: item.vatMode,
            inputVatClaimStatus: item.inputVatClaimStatus,
            sourceDocumentType: item.sourceDocumentType,
            taxEvidenceStatus: item.taxEvidenceStatus,
            vendorDocumentNumber: item.vendorDocumentNumber,
            sourceChannelMetadataJson: item.sourceChannelMetadataJson,
            vendorNameSnapshot: item.vendorNameSnapshot,
            note: item.description,
            ...(line.sourceExpenseSnapshot?.classification ?? {}),
            primaryAttachmentId: item.attachmentId ?? null,
            missingReceiptReason: item.missingReceiptReason ?? null,
            createdByUserId: data.decisionActorUserId,
            subtotalAmount: item.subtotalAmount,
            discountAmount: item.discountAmount,
            taxableAmount: item.taxableAmount,
            vatAmount: item.vatAmount,
            whtAmount: item.whtAmount,
            grandTotalAmount: item.grandTotalAmount,
            netPayableAmount: item.netPayableAmount,
            outstandingAmount: item.outstandingAmount,
          },
        });
        if (item.sourceCostLines) {
          if (!item.sourceCostLines.length || !item.sourceCostLines.reduce((sum, cost) => sum.add(cost.amount), d('0')).eq(item.grandTotalAmount)) throw sourceError('reimbursement_source_fields_mismatch');
          await tx.expenseLine.createMany({ data: item.sourceCostLines.map((cost, index) => ({
            companyId: data.companyId, expenseId: expense.id, lineNumber: index + 1, description: cost.description, chargeKind: cost.chargeKind,
            expenseCategoryId: cost.expenseCategoryId, accountHintKey: cost.accountHintKey, taxCategory: cost.taxCategory,
            quantity: '1', unitPrice: cost.amount, discountAmount: '0', taxableAmount: cost.amount,
            vatAmount: '0', whtAmount: '0', lineSubtotalAmount: cost.amount, lineTotalAmount: cost.amount,
          })) });
        } else await tx.expenseLine.create({
          data: {
            companyId: data.companyId,
            expenseId: expense.id,
            lineNumber: 1,
            description: item.description,
            quantity: item.line.quantity,
            unitPrice: item.line.unitPrice,
            discountAmount: item.line.discountAmount,
            taxableAmount: item.line.taxableAmount,
            vatAmount: item.line.vatAmount,
            whtAmount: item.line.whtAmount,
            lineSubtotalAmount: item.line.lineSubtotalAmount,
            lineTotalAmount: item.line.lineTotalAmount,
          },
        });
        if (item.attachmentId) {
          const conflict = await findAttachmentLinkConflict(tx, {
            companyId: data.companyId, attachmentId: item.attachmentId, targetType: 'expense.record',
          });
          if (conflict) throw new UnprocessableEntityException(conflict);
          await tx.attachmentLink.createMany({
            data: [{
              companyId: data.companyId,
              attachmentId: item.attachmentId,
              targetType: 'expense.record',
              targetId: expense.id,
              purpose: 'expense.receipt.primary',
              linkedByUserId: data.decisionActorUserId,
            }],
            skipDuplicates: true,
          });
        }
        if (expenseDraftNumberingEnabled()) {
          const expenseNumber = await expenseNumberInTransaction(tx, this.documentNumbers, expense, data.decisionActorUserId);
          await tx.expenseRecord.update({ where: { id: expense.id }, data: { expenseNumber, updatedAt: expense.updatedAt } });
        }
        // Source evidence stays unchanged; projection identity is sourceReimbursementLineId.
        results.push({ reimbursementLineId: line.id, expenseId: expense.id, created: true });
      }
      return results;
    });
  }

  async listClaimProjections(
    companyId: string,
    requestId: string,
    db: Prisma.TransactionClient | PrismaService['client'] = this.prisma.client,
  ): Promise<Array<{ id: string; expenseNumber?: string; sourceReimbursementLineId: string; status: string; duplicateStatus: string; postingStatus: string; branchId?: string }>> {
    const rows = await (db as any).expenseRecord.findMany({
      where: { companyId, sourceReimbursementRequestId: requestId, sourceReimbursementLineId: { not: null } },
    });
    return rows.map((row: any) => ({
      id: row.id,
      expenseNumber: opt(row.expenseNumber),
      sourceReimbursementLineId: row.sourceReimbursementLineId,
      status: row.status,
      duplicateStatus: row.duplicateStatus,
      postingStatus: row.postingStatus,
      branchId: opt(row.branchId),
    }));
  }

  /**
   * The claims whose durable decision the system has yet to carry out (`pendingProjectionIntent`),
   * at most `limit` of them, the most recently decided first.
   *
   * Newest first: a claim that failed a moment ago most likely failed in passing and is repaired on
   * this run, while one that cannot be repaired (its line falls in a closed accounting period, say)
   * drops down the list as new ones arrive instead of holding a place at its head for good.
   * ponytail: no attempt counter. Past `limit` claims that cannot complete, the oldest of them stop
   * being retried by the run; add a counter with a backoff if the failure log ever shows that many.
   *
   * Only decisions made before `decidedBefore`, a minute ago unless the caller says otherwise: the
   * newest decision of all is the one a live approve, submit or finance request is still carrying
   * out, and a pass that took it would compete with that request for the same expense records (it
   * can lose a document-number race and answer 409). Left alone for a minute, a decision is either
   * carried out or truly waiting. The claim's `updatedAt` is when it was decided: the decision is the
   * write that put it in this state.
   */
  async listPendingProjectionIntents(
    limit = 100,
    decidedBefore = new Date(Date.now() - PROJECTION_INTENT_MIN_AGE_MS),
  ): Promise<Array<PendingProjectionIntent & { request: ReimbursementRequestRecord }>> {
    const updatedAt = { lt: decidedBefore };
    const [managerRows, financeRows, policyRows] = await Promise.all([
      (this.prisma.client as any).reimbursementRequest.findMany({
        // Decided: no step is waiting any more. Asked of the database, not filtered afterwards:
        // every claim still waiting for its approver is PENDING_APPROVAL too, and a page of those
        // would otherwise crowd the decided ones out of the first `limit` rows.
        where: {
          status: 'PENDING_APPROVAL', currentApprovalStepId: { not: null }, cancellationPendingAt: null, updatedAt,
          // Never a claim whose payout account is being corrected: it holds no decision to carry out.
          payoutCorrectionRequestedAt: null,
          approvalSteps: { some: { status: 'APPROVED' }, none: { status: 'PENDING' } },
        },
        include: {
          lines: { orderBy: { lineNo: 'asc' } },
          approvalSteps: { where: { status: 'APPROVED' } },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
      (this.prisma.client as any).reimbursementRequest.findMany({
        where: {
          status: 'FINANCE_REVIEW',
          financeReviewStatus: 'APPROVED_FOR_PAYMENT',
          financeReviewedByUserId: { not: null },
          cancellationPendingAt: null,
          updatedAt,
        },
        // The approved steps too: the replayed ready-to-pay event names the claim's approver.
        include: { lines: { orderBy: { lineNo: 'asc' } }, approvalSteps: { where: { status: 'APPROVED' } } },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
      (this.prisma.client as any).reimbursementRequest.findMany({
        where: { status: 'APPROVED', currentApprovalStepId: null, cancellationPendingAt: null, updatedAt },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
    ]);
    return [...managerRows, ...financeRows, ...policyRows]
      .map((row: any) => this.toRequest(row))
      .flatMap((request) => {
        // This list is read across every company. A claim whose frozen policy cannot be read (the
        // parser throws, as it does on every other read of that claim) is left out of it, so one
        // such row never stops the run for everyone else's claims.
        try {
          const intent = pendingProjectionIntent(request);
          return intent ? [{ request, ...intent }] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.request.updatedAt.getTime() - a.request.updatedAt.getTime())
      .slice(0, limit);
  }

  /** Whether every line of the claim has its confirmed expense record: what the payment gate asks. */
  async areClaimProjectionsReady(request: ReimbursementRequestRecord): Promise<boolean> {
    try {
      await this.assertClaimProjectionsReady(this.prisma.client as any, request);
      return true;
    } catch (error) {
      if (error instanceof ConflictException && error.message !== 'reimbursement_projection_voided') return false;
      throw error;
    }
  }

  private async assertClaimProjectionsReady(
    tx: any,
    request: ReimbursementRequestRecord,
  ): Promise<{ postingStatus: 'not_required' | 'pending' | 'posted'; duplicateStatus: 'NO_MATCH' | 'POSSIBLE_DUPLICATE' | 'CONFIRMED_DUPLICATE' | 'OVERRIDDEN' }> {
    const lines = request.lines ?? [];
    if (!lines.length) throw new ConflictException('reimbursement_projection_source_changed');
    const rows = await tx.expenseRecord.findMany({
      where: {
        companyId: request.companyId,
        sourceReimbursementRequestId: request.id,
        OR: [{ sourceReimbursementLineId: { in: lines.map((line) => line.id) } }, { status: 'VOIDED' }],
      },
    });
    assertClaimProjectionsNotVoided(request, rows);
    const byLineId = new Map(rows.map((row: any) => [row.sourceReimbursementLineId, row]));
    if (byLineId.size !== lines.length) throw new ConflictException('reimbursement_projection_not_ready');

    for (const line of lines) {
      const projection: any = byLineId.get(line.id);
      if (!projection
        || projection.sourceReimbursementRequestId !== request.id
        || (projection.branchId ?? undefined) !== request.branchId
        || !d(projection.grandTotalAmount).eq(d(line.amount))) {
        throw new ConflictException('reimbursement_projection_source_mismatch');
      }
      const confirmed = projection.status === 'CONFIRMED';
      const duplicateException = projection.status === 'READY_FOR_CONFIRMATION'
        && ['POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE'].includes(projection.duplicateStatus);
      if (!confirmed && !duplicateException) throw new ConflictException('reimbursement_projection_not_ready');
      if (projection.duplicateStatus === 'CONFIRMED_DUPLICATE' && projection.postingStatus !== 'not_required') {
        throw new ConflictException('reimbursement_duplicate_projection_posting_mismatch');
      }
    }

    const duplicateStatus = rows.some((row: any) => row.duplicateStatus === 'CONFIRMED_DUPLICATE')
      ? 'CONFIRMED_DUPLICATE'
      : rows.some((row: any) => row.duplicateStatus === 'POSSIBLE_DUPLICATE')
        ? 'POSSIBLE_DUPLICATE'
        : rows.some((row: any) => row.duplicateStatus === 'OVERRIDDEN')
          ? 'OVERRIDDEN'
          : 'NO_MATCH';
    const postingRows = rows.filter((row: any) => row.status === 'CONFIRMED' && row.duplicateStatus !== 'CONFIRMED_DUPLICATE');
    const postingStatus = postingRows.length === 0
      ? 'not_required'
      : postingRows.every((row: any) => row.postingStatus === 'posted')
        ? 'posted'
        : 'pending';
    return { postingStatus, duplicateStatus };
  }

  async completeApprovalProjectionAtomic(data: {
    companyId: string;
    requestId: string;
    decisionActorUserId: string;
    approvalStepId: string;
    scopes: { branchIds?: string[] };
    systemReconcile?: boolean;
    expectedBranchId?: string;
    completedAt: Date;
    onReadyPersisted: (tx: any) => Promise<void>;
  }): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      if (row.status === 'READY_FOR_PAYMENT') return this.toRequest(row);
      // A cancellation started while the decision was being carried out comes first: the claim is not
      // moved on, and nobody is told to pay it, only for the cancellation to close it a moment later.
      this.assertNotBeingCancelled(row);
      if (row.status !== 'PENDING_APPROVAL' || row.currentApprovalStepId !== data.approvalStepId) {
        throw new ConflictException('reimbursement_projection_decision_changed');
      }
      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes, data.systemReconcile, data.expectedBranchId);
      const step = await tx.reimbursementApprovalStep.findFirst({
        where: {
          id: data.approvalStepId,
          companyId: data.companyId,
          reimbursementRequestId: data.requestId,
          status: 'APPROVED',
          decisionByUserId: data.decisionActorUserId,
        },
      });
      if (!step || step.requestSnapshotHash !== request.approvalSnapshotHash) {
        throw new ConflictException('reimbursement_projection_decision_changed');
      }
      const readiness = await this.assertClaimProjectionsReady(tx, request);
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: 'PENDING_APPROVAL',
          currentApprovalStepId: data.approvalStepId,
          updatedAt: row.updatedAt,
          cancellationPendingAt: null,
        },
        data: {
          status: 'READY_FOR_PAYMENT',
          approvedAt: step.decidedAt ?? data.completedAt,
          currentApproverUserId: null,
          currentApprovalStepId: null,
          financeReviewStatus: 'NOT_REQUIRED',
          paymentStatus: 'UNPAID',
          duplicateStatus: readiness.duplicateStatus,
          postingStatus: readiness.postingStatus,
          updatedByUserId: data.decisionActorUserId,
          updatedAt: this.nextVersion(row.updatedAt),
        },
      });
      if (changed.count !== 1) throw new ConflictException('reimbursement_projection_decision_changed');
      await data.onReadyPersisted(tx);
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return this.toRequest(updated);
    });
  }

  async completePolicyProjectionAtomic(data: {
    companyId: string;
    requestId: string;
    actorUserId: string;
    scopes: { branchIds?: string[] };
    systemReconcile?: boolean;
    expectedBranchId?: string;
    completedAt: Date;
    onReadyPersisted: (tx: any) => Promise<void>;
  }): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      if (row.status === 'READY_FOR_PAYMENT') return this.toRequest(row);
      this.assertNotBeingCancelled(row);
      const request = this.toRequest(row);
      const snapshot = parseReimbursementPolicySnapshot(request.approvalPolicySnapshotJson);
      if (request.status !== 'APPROVED' || request.currentApprovalStepId
        || !snapshot || snapshot.requiresApproval || snapshot.financeReviewRequired) {
        throw new ConflictException('reimbursement_projection_decision_changed');
      }
      this.assertDecisionBranch(request.branchId, data.scopes, data.systemReconcile, data.expectedBranchId);
      const readiness = await this.assertClaimProjectionsReady(tx, request);
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: 'APPROVED',
          currentApprovalStepId: null,
          updatedAt: row.updatedAt,
          cancellationPendingAt: null,
        },
        data: {
          status: 'READY_FOR_PAYMENT',
          paymentStatus: 'UNPAID',
          duplicateStatus: readiness.duplicateStatus,
          postingStatus: readiness.postingStatus,
          updatedByUserId: data.actorUserId,
          updatedAt: this.nextVersion(row.updatedAt),
        },
      });
      if (changed.count !== 1) throw new ConflictException('reimbursement_projection_decision_changed');
      await data.onReadyPersisted(tx);
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return this.toRequest(updated);
    });
  }

  async completeFinanceProjectionAtomic(data: {
    companyId: string;
    requestId: string;
    decisionActorUserId: string;
    scopes: { branchIds?: string[] };
    systemReconcile?: boolean;
    expectedBranchId?: string;
    completedAt: Date;
    onReadyPersisted: (tx: any) => Promise<void>;
  }): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      if (row.status === 'READY_FOR_PAYMENT') return this.toRequest(row);
      this.assertNotBeingCancelled(row);
      if (row.status !== 'FINANCE_REVIEW'
        || row.financeReviewStatus !== 'APPROVED_FOR_PAYMENT'
        || row.financeReviewedByUserId !== data.decisionActorUserId) {
        throw new ConflictException('reimbursement_projection_decision_changed');
      }
      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes, data.systemReconcile, data.expectedBranchId);
      const readiness = await this.assertClaimProjectionsReady(tx, request);
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: 'FINANCE_REVIEW',
          financeReviewStatus: 'APPROVED_FOR_PAYMENT',
          financeReviewedByUserId: data.decisionActorUserId,
          updatedAt: row.updatedAt,
          cancellationPendingAt: null,
        },
        data: {
          status: 'READY_FOR_PAYMENT',
          paymentStatus: 'UNPAID',
          duplicateStatus: readiness.duplicateStatus,
          postingStatus: readiness.postingStatus,
          updatedByUserId: data.decisionActorUserId,
          updatedAt: this.nextVersion(row.updatedAt),
        },
      });
      if (changed.count !== 1) throw new ConflictException('reimbursement_projection_decision_changed');
      await data.onReadyPersisted(tx);
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return this.toRequest(updated);
    });
  }

  async rejectRequestAtomic(data: {
    companyId: string;
    requestId: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
    actorRoles: string[];
    scopes: { branchIds?: string[] };
    allowSelfApproval: boolean;
    decidedAt: Date;
    rejectionReason: string;
    request: Record<string, unknown>;
    onRejectedPersisted: (tx: any) => Promise<void>;
  }): Promise<void> {
    const client = this.prisma.client as any;
    await client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      if (row.status !== 'PENDING_APPROVAL') throw notAwaitingApproval();
      this.assertNotBeingCancelled(row);
      // REJECTED releases the claim's receipts to other claims. A claim whose payout account is being
      // corrected was approved and has its expense records, so refusing its new account sends it back to
      // its requester (`requestPayoutCorrectionAtomic`) and never rejects it; and no claim at all is
      // rejected while expense records of its own still stand.
      if (row.payoutCorrectionRequestedAt) throw new ConflictException('payout_correction_in_progress');
      await this.assertNoLiveProjections(tx, data.companyId, data.requestId);
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        throw new ConflictException('stale_approval_snapshot');
      }

      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes);
      if (!request.currentApprovalStepId) throw new ConflictException('stale_approval_snapshot');
      const step = await tx.reimbursementApprovalStep.findFirst({
        where: {
          id: request.currentApprovalStepId,
          companyId: data.companyId,
          reimbursementRequestId: data.requestId,
        },
      });
      if (!step) throw new ConflictException('stale_approval_snapshot');
      const assignedBySnapshot = await this.assertApproverEligibility(tx, data.companyId, step, data.actorUserId, data.actorRoles, request.branchId, request.requesterUserId);
      if (!assignedBySnapshot && isSelfApproval(request.requesterUserId, data.actorUserId, data.allowSelfApproval, data.actorRoles)) {
        throw new ForbiddenException('self_approval_denied');
      }
      const changedStep = await tx.reimbursementApprovalStep.updateMany({
        where: {
          id: step.id,
          companyId: data.companyId,
          reimbursementRequestId: data.requestId,
          status: 'PENDING',
        },
        data: {
          status: 'REJECTED',
          decidedAt: data.decidedAt,
          decisionByUserId: data.actorUserId,
          rejectionReason: data.rejectionReason,
        },
      });
      if (changedStep.count !== 1) throw new ConflictException('stale_approval_snapshot');

      const changedRequest = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: 'PENDING_APPROVAL',
          updatedAt: data.expectedUpdatedAt,
        },
        data: { ...data.request, updatedAt: this.nextVersion(data.expectedUpdatedAt) },
      });
      if (changedRequest.count !== 1) throw new ConflictException('stale_approval_snapshot');
      await data.onRejectedPersisted(tx);
    });
  }

  // ---- Payout account correction round (payout spec §14) ----

  /** A claim keeps the status its expense records were built under while any of them still stands. */
  private async assertNoLiveProjections(tx: any, companyId: string, requestId: string): Promise<void> {
    const live = await tx.expenseRecord.count({ where: { companyId, sourceReimbursementRequestId: requestId, status: { not: 'VOIDED' } } });
    if (live > 0) throw new ConflictException('reimbursement_correction_has_projection');
  }

  /**
   * The scans declared as the claim's signed form stop counting from here: they show the account that
   * is now in question. Each stays in the list, marked as from before the correction. The same place a
   * slip move withdraws a declaration (`linkPaymentSlip`): the scan's own metadata, under its link id.
   */
  private async supersedeSignedCopyDeclarations(tx: any, companyId: string, requestId: string, at: Date): Promise<number> {
    const links: Array<{ id: string; attachmentId: string; attachment: { metadataJson: unknown } }> = await tx.attachmentLink.findMany({
      where: { companyId, targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE, targetId: requestId, purpose: REIMBURSEMENT_SIGNED_COPY_PURPOSE },
      select: { id: true, attachmentId: true, attachment: { select: { metadataJson: true } } },
    });
    let superseded = 0;
    for (const link of links) {
      const metadata = (link.attachment.metadataJson ?? {}) as Record<string, any>;
      const ack = metadata[REIMBURSEMENT_SIGNED_COPY_ACK_KEY];
      if (ack?.linkId !== link.id || ack.supersededAt) continue;
      await tx.attachmentObject.update({
        where: { id: link.attachmentId },
        data: { metadataJson: { ...metadata, [REIMBURSEMENT_SIGNED_COPY_ACK_KEY]: { ...ack, supersededAt: at.toISOString() } } },
      });
      superseded += 1;
    }
    return superseded;
  }

  /**
   * Sends a claim back to have its payout account corrected: out of READY_FOR_PAYMENT, or, while the
   * account it was given waits for approval, back again to its requester (`again`). It takes the two
   * locks recording a payment takes, in the same order, so a send-back and a payment of one claim
   * cannot both succeed: whichever commits first leaves the other with a claim that changed under it.
   *
   * Only the round is written. The approval the claim stood on is set aside, `approvedAt` is cleared
   * and the claim is not payable; its number, lines, amounts, evidence, duplicate state, finance
   * result, expense records and journals are not touched. What was signed was signed on the account
   * now in question: the signature rows go, and a scan declared as signed stops counting.
   */
  async requestPayoutCorrectionAtomic(data: {
    companyId: string;
    requestId: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
    actorRoles: string[];
    scopes: { branchIds?: string[] };
    /** The claim's self-approval rule, for a send-back made by deciding the waiting step. */
    allowSelfApproval: boolean;
    requestedAt: Date;
    reasonCode: ReimbursementPayoutCorrectionReason;
    note?: string;
    onPersisted: (tx: any, result: { again: boolean; setAsideStepIds: string[]; signaturesRemoved: number; declarationsSetAside: number }) => Promise<void>;
  }): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${data.companyId}:${data.requestId}:reimbursement-payment`}))`;
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({ where: { id: data.requestId, companyId: data.companyId } });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      this.assertNotBeingCancelled(row);
      // Paid, cancelled or sent back by someone else since the caller read it: they look again.
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw this.requestChanged();
      this.assertDecisionBranch(row.branchId, data.scopes);
      const phase = payoutCorrectionPhase(row);
      if (phase === 'AWAITING_REQUESTER') throw new ConflictException('payout_correction_in_progress');
      const again = phase === 'AWAITING_APPROVAL';
      const where = { companyId: data.companyId, reimbursementRequestId: data.requestId };
      const setAside = { invalidatedAt: data.requestedAt, invalidatedReason: PAYOUT_CORRECTION_STEP_REASON };
      let setAsideStepIds: string[];
      if (again) {
        // The step that waits: whoever may decide it sends the claim back, exactly as they would reject.
        const step = row.currentApprovalStepId
          ? await tx.reimbursementApprovalStep.findFirst({ where: { ...where, id: row.currentApprovalStepId } }) : null;
        if (!step || step.status !== 'PENDING') throw this.requestChanged();
        const assignedBySnapshot = await this.assertApproverEligibility(tx, data.companyId, step, data.actorUserId, data.actorRoles, row.branchId, row.requesterUserId);
        if (!assignedBySnapshot && isSelfApproval(row.requesterUserId, data.actorUserId, data.allowSelfApproval, data.actorRoles)) {
          throw new ForbiddenException('self_approval_denied');
        }
        const cancelled = await tx.reimbursementApprovalStep.updateMany({ where: { ...where, id: step.id, status: 'PENDING' }, data: { status: 'CANCELLED', ...setAside } });
        if (cancelled.count !== 1) throw this.requestChanged();
        setAsideStepIds = [step.id];
      } else {
        if (row.status !== 'READY_FOR_PAYMENT') throw new ConflictException('payout_correction_not_allowed');
        // A payment that stands is voided first: the account it went into is never changed under it.
        if (await tx.reimbursementPayment.count({ where: { ...where, status: 'RECORDED' } }) > 0) {
          throw new ConflictException('payout_correction_not_allowed');
        }
        // The approval the claim stands on (`isReimbursementClaimApprover`): in force, and given in the
        // round the claim was last sent in. It stays as history. A claim nobody had to approve has none.
        const approvals: Array<{ id: string }> = row.submittedAt ? await tx.reimbursementApprovalStep.findMany({
          where: { ...where, status: 'APPROVED', invalidatedAt: null, decidedAt: { gte: row.submittedAt } }, select: { id: true },
        }) : [];
        setAsideStepIds = approvals.map((step) => step.id);
        if (setAsideStepIds.length > 0) await tx.reimbursementApprovalStep.updateMany({ where: { ...where, id: { in: setAsideStepIds } }, data: setAside });
      }
      const entry: ReimbursementPayoutCorrectionLogEntry = {
        kind: 'SENT_BACK', at: data.requestedAt.toISOString(), byUserId: data.actorUserId, reasonCode: data.reasonCode,
        ...(data.note && { note: data.note }),
        // What the claim was approved with, for the comparison its approvers are shown. A legacy claim had no method.
        ...(!again && { approved: {
          ...(hasPayoutSnapshot(row) && { payoutMethod: row.payoutMethod, ...(row.payoutDestinationVersion != null && { payoutVersion: row.payoutDestinationVersion }) }),
          ...(row.approvedAt && { at: row.approvedAt.toISOString() }),
        } }),
      };
      const changed = await tx.reimbursementRequest.updateMany({
        where: { id: data.requestId, companyId: data.companyId, status: row.status, updatedAt: row.updatedAt, cancellationPendingAt: null },
        data: {
          status: 'PENDING_APPROVAL',
          approvedAt: null,
          paymentStatus: 'NOT_PAYABLE',
          currentApproverUserId: null,
          currentApprovalStepId: null,
          payoutCorrectionRequestedAt: data.requestedAt,
          payoutCorrectionRequestedByUserId: data.actorUserId,
          payoutCorrectionReasonCode: data.reasonCode,
          payoutCorrectionNote: data.note ?? null,
          payoutCorrectionSubmittedAt: null,
          payoutCorrectionLogJson: withPayoutCorrectionStep(row, entry),
          updatedByUserId: data.actorUserId,
          updatedAt: this.nextVersion(row.updatedAt),
        },
      });
      if (changed.count !== 1) throw this.requestChanged();
      const signatures = await tx.reimbursementClaimSignature.deleteMany({ where: where });
      const declarationsSetAside = await this.supersedeSignedCopyDeclarations(tx, data.companyId, data.requestId, data.requestedAt);
      await data.onPersisted(tx, { again, setAsideStepIds, signaturesRemoved: signatures.count, declarationsSetAside });
      return this.toRequest(await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId }, include: { _count: { select: { lines: true } } },
      }));
    });
  }

  /**
   * The account a claim in a round is given (payout spec §14.5), in one transaction: it is frozen as a
   * new version, the claim's approval hash is made again from the same claim with that account, and a
   * new approval step waits for the approvers the claim had (`payoutCorrectionSourceStep`; a step
   * still waiting from an earlier answer is replaced). A claim nobody had to approve is ready for
   * payment at once, its expense records checked first: whoever pays it is the one to check the account.
   *
   * Of the people the claim's step named, the new step keeps only those on today's approval route
   * (`approverRouteUserIds`, final review S2). The old step may be weeks old and a claim in a round
   * cannot be withdrawn and sent again, so a person who has since lost the approve right would
   * otherwise be the only one able to approve a change of bank account. When none of them is left
   * the step names nobody, and its recorded role, or the owner, decides it.
   */
  async submitPayoutCorrectionAtomic(data: {
    companyId: string;
    requestId: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
    scopes: { branchIds?: string[] };
    submittedAt: Date;
    /** The receiving choice with whatever must commit with it, as for a draft (`draftPayoutChange`), or the account the claim had. */
    payout: { write: CorrectionPayoutWrite; onPersisted?: DraftPayoutChange['onPersisted'] };
    /** For "use the default account": the token of the default the page showed. */
    seenDefaultToken?: unknown;
    /** The default account is set by `payout.onPersisted` in this transaction: what was typed is what is copied. */
    defaultSetInThisTransaction?: boolean;
    /** Who is on today's approval route for the step the round takes its approvers from, as a submit would resolve it. */
    approverRouteUserIds: readonly string[];
    onPersisted: (tx: any, result: {
      columns: SubmitPayoutColumns; step?: ReimbursementApprovalStepRecord; replacedStepId?: string; readyForPayment: boolean;
      /** What was given, against what the round began with (`payoutCorrectionFacts`). Undefined only for a round with no opening on record. */
      answer?: ReimbursementPayoutRoundAnswer;
    }) => Promise<void>;
  }): Promise<{ request: ReimbursementRequestRecord; step?: ReimbursementApprovalStepRecord; readyForPayment: boolean }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } }, approvalSteps: true },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      this.assertNotBeingCancelled(row);
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw this.requestChanged();
      const request = this.toRequest(row);
      if (!payoutCorrectionPhase(request)) throw new ConflictException('payout_correction_not_requested');
      this.assertDecisionBranch(request.branchId, data.scopes);

      // First what commits with the choice: a default account set here is the one copied below.
      if (data.payout.write.mode === 'DEFAULT') await data.payout.onPersisted?.(tx, data.requestId);
      const columns = await freezePayoutCorrection(tx, request, {
        write: data.payout.write, frozenAt: data.submittedAt,
        seenDefaultToken: data.seenDefaultToken, defaultSetInThisTransaction: data.defaultSetInThisTransaction,
        previous: payoutCorrectionRoundStart(request),
        approvalRequired: payoutCorrectionApprovalRequired(request),
      });
      if (data.payout.write.mode !== 'DEFAULT') await data.payout.onPersisted?.(tx, data.requestId);
      // The same claim with the account it has now: nothing else of it moved, so nothing else of the hash does.
      const snapshotHash = computeSnapshotHash(claimSnapshotFields({ ...request, ...columns }, request.approvalPolicySnapshotJson));

      const where = { companyId: data.companyId, reimbursementRequestId: data.requestId };
      const source = payoutCorrectionSourceStep(request);
      const replaced = source?.status === 'PENDING' ? source : undefined;
      if (replaced) {
        const cancelled = await tx.reimbursementApprovalStep.updateMany({
          where: { ...where, id: replaced.id, status: 'PENDING' },
          data: { status: 'CANCELLED', invalidatedAt: data.submittedAt, invalidatedReason: PAYOUT_CORRECTION_STEP_REASON },
        });
        if (cancelled.count !== 1) throw this.requestChanged();
      }
      const onRoute = (userId: string) => data.approverRouteUserIds.includes(userId);
      // In the shape the old step had: a frozen list stays a list, a step that only named a person names that person.
      const stillAssigned = source?.assignedApproverUserIds?.filter(onRoute) ?? [];
      const step = source ? this.toStep(await tx.reimbursementApprovalStep.create({ data: {
        ...where,
        sequenceNo: source.sequenceNo,
        approverUserId: source.approverUserId && onRoute(source.approverUserId) ? source.approverUserId : null,
        approverRoleSnapshot: source.approverRoleSnapshot,
        ...(stillAssigned.length > 0 && { assignedApproverUserIdsJson: stillAssigned }),
        requestSnapshotHash: snapshotHash,
        assignedAt: data.submittedAt,
      } })) : undefined;
      // Nobody approves it: it is payable again from here, so its expense records are held to its lines first.
      if (!step) await this.assertClaimProjectionsReady(tx, request);

      // Whether this is the very destination the claim was approved with: decided here, once, and kept on
      // the entry, so every later reader of the round says the same of it without comparing anything.
      const sameAsApproved = await payoutCorrectionKeptDestination(tx, request, columns, payoutCorrectionRoundStart(request));
      const entry: ReimbursementPayoutCorrectionLogEntry = {
        kind: 'ACCOUNT_SUBMITTED', at: data.submittedAt.toISOString(), byUserId: data.actorUserId, payoutMethod: columns.payoutMethod,
        ...(columns.payoutDestinationVersion !== null && { payoutVersion: columns.payoutDestinationVersion }),
        ...(sameAsApproved && { sameAsApproved: true as const }),
      };
      const log = withPayoutCorrectionStep(row, entry);
      const changed = await tx.reimbursementRequest.updateMany({
        where: { id: data.requestId, companyId: data.companyId, status: 'PENDING_APPROVAL', updatedAt: row.updatedAt, cancellationPendingAt: null },
        data: {
          ...columns,
          approvalSnapshotHash: snapshotHash,
          ...(step
            ? { currentApprovalStepId: step.id, currentApproverUserId: step.approverUserId ?? null, payoutCorrectionSubmittedAt: data.submittedAt }
            : { status: 'READY_FOR_PAYMENT', approvedAt: data.submittedAt, paymentStatus: 'UNPAID', currentApprovalStepId: null, currentApproverUserId: null, ...NO_PAYOUT_CORRECTION }),
          payoutCorrectionLogJson: log,
          updatedByUserId: data.actorUserId,
          updatedAt: this.nextVersion(row.updatedAt),
        },
      });
      if (changed.count !== 1) throw this.requestChanged();
      await data.onPersisted(tx, {
        columns, ...(step && { step }), ...(replaced && { replacedStepId: replaced.id }), readyForPayment: !step,
        // What the requester gave against what the round began with, as every reader of the log will say it.
        answer: payoutCorrectionFacts(log).at(-1)?.answer,
      });
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId }, include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return { request: this.toRequest(updated), ...(step && { step }), readyForPayment: !step };
    });
  }

  /**
   * Approves the account a correction round gave the claim (payout spec §14.6), in ONE transaction:
   * the step is decided, the new account version gets its attester, the claim's expense records are
   * held to its lines again, the claim is READY_FOR_PAYMENT and out of its round, and the caller's
   * ready-to-pay event is written. Nothing is left for a second phase or for the reconciler, because
   * nothing is built: the expense records and their journals are the ones the claim already has.
   * Any refusal leaves the claim exactly as it was, the step and the attestation included.
   */
  async approvePayoutCorrectionAtomic(data: {
    companyId: string;
    requestId: string;
    expectedUpdatedAt: Date;
    expectedApprovalSnapshotHash?: string;
    actorUserId: string;
    actorRoles: string[];
    scopes: { branchIds?: string[] };
    allowSelfApproval: boolean;
    decidedAt: Date;
    comment?: string;
    /** "ตรวจบัญชีแล้ว": the account version the approver looked at. */
    payoutVerifiedVersion?: unknown;
    payoutThirdPartyAccepted?: unknown;
    onApprovedPersisted: (tx: any, approvalStepId: string) => Promise<void>;
  }): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({
        where: { id: data.requestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      this.assertNotBeingCancelled(row);
      if (payoutCorrectionPhase(row) !== 'AWAITING_APPROVAL' || row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        throw new ConflictException('stale_approval_snapshot');
      }
      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes);
      await assertReimbursementSources(tx, request);
      const storedHash = this.assertApprovalSnapshot(request, data.expectedApprovalSnapshotHash);
      const where = { companyId: data.companyId, reimbursementRequestId: data.requestId };
      const step = request.currentApprovalStepId
        ? await tx.reimbursementApprovalStep.findFirst({ where: { ...where, id: request.currentApprovalStepId } }) : null;
      if (!step || step.status !== 'PENDING' || step.requestSnapshotHash !== storedHash) throw new ConflictException('stale_approval_snapshot');
      const assignedBySnapshot = await this.assertApproverEligibility(tx, data.companyId, step, data.actorUserId, data.actorRoles, request.branchId, request.requesterUserId);
      if (!assignedBySnapshot && isSelfApproval(request.requesterUserId, data.actorUserId, data.allowSelfApproval, data.actorRoles)) {
        throw new ForbiddenException('self_approval_denied');
      }
      await attestClaimPayout(tx, request, {
        verifiedVersion: data.payoutVerifiedVersion, thirdPartyAccepted: data.payoutThirdPartyAccepted, actorUserId: data.actorUserId, verifiedAt: data.decidedAt, approvalStepId: step.id,
      });
      const decided = await tx.reimbursementApprovalStep.updateMany({
        where: { ...where, id: step.id, status: 'PENDING', requestSnapshotHash: storedHash },
        data: { status: 'APPROVED', decidedAt: data.decidedAt, decisionByUserId: data.actorUserId, comment: data.comment },
      });
      if (decided.count !== 1) throw new ConflictException('stale_approval_snapshot');
      // Only held to the lines, never written: the duplicate and posting states of the claim stay as they were.
      await this.assertClaimProjectionsReady(tx, request);
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId, companyId: data.companyId, status: 'PENDING_APPROVAL', updatedAt: data.expectedUpdatedAt,
          currentApprovalStepId: step.id, cancellationPendingAt: null,
        },
        data: {
          status: 'READY_FOR_PAYMENT',
          approvedAt: data.decidedAt,
          paymentStatus: 'UNPAID',
          currentApproverUserId: null,
          currentApprovalStepId: null,
          ...NO_PAYOUT_CORRECTION,
          payoutCorrectionLogJson: withPayoutCorrectionStep(row, {
            kind: 'REAPPROVED', at: data.decidedAt.toISOString(), byUserId: data.actorUserId, approvalStepId: step.id,
          }),
          updatedByUserId: data.actorUserId,
          updatedAt: this.nextVersion(data.expectedUpdatedAt),
        },
      });
      if (changed.count !== 1) throw new ConflictException('stale_approval_snapshot');
      await data.onApprovedPersisted(tx, step.id);
      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.requestId, companyId: data.companyId }, include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return this.toRequest(updated);
    });
  }

  /**
   * Lines of OTHER still-live claims that already reference one of these
   * receipts/expenses — the double-claim guard at submit.
   */
  async findLinesClaimedElsewhere(
    companyId: string,
    excludeRequestId: string,
    attachmentIds: string[],
    expenseIds: string[],
  ): Promise<{ lineNo: number; attachmentId?: string; linkedExpenseId?: string; requestNo?: string }[]> {
    if (attachmentIds.length === 0 && expenseIds.length === 0) return [];
    const rows = await (this.prisma.client as any).reimbursementLine.findMany({
      where: {
        companyId,
        reimbursementRequestId: { not: excludeRequestId },
        // A draft has not claimed the evidence yet; concurrent submits serialize
        // on the evidence lock and exactly one becomes live.
        request: { status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'] } },
        OR: [
          ...(attachmentIds.length > 0 ? [{ attachmentId: { in: attachmentIds } }] : []),
          ...(expenseIds.length > 0 ? [{ linkedExpenseId: { in: expenseIds } }] : []),
        ],
      },
      select: { lineNo: true, attachmentId: true, linkedExpenseId: true, request: { select: { requestNo: true } } },
      take: 20,
    });
    return rows.map((row: any) => ({
      lineNo: row.lineNo,
      attachmentId: opt(row.attachmentId),
      linkedExpenseId: opt(row.linkedExpenseId),
      requestNo: opt(row.request?.requestNo),
    }));
  }

  /** Only comparison facts of candidates belonging to this claim, never arbitrary expense ids. */
  async listClaimDuplicateExpenseTargets(companyId: string, requestId: string) {
    const source = { companyId, sourceReimbursementRequestId: requestId, status: { not: 'VOIDED' as const } };
    const fields = { id: true, sourceReimbursementRequestId: true, expenseNumber: true, vendorNameSnapshot: true, grandTotalAmount: true, currency: true, expenseDate: true } as const;
    const rows = await this.prisma.client.expenseDuplicateCandidate.findMany({
      where: { companyId, status: { in: ['OPEN', 'DISMISSED'] }, expense: { companyId }, candidateExpense: { companyId }, OR: [{ expense: source }, { candidateExpense: source }] },
      select: { id: true, score: true, status: true, resolvedByUserId: true, resolvedAt: true,
        expense: { select: fields }, candidateExpense: { select: fields } },
      orderBy: { id: 'asc' },
    });
    const names = await this.getUserDisplayNames(companyId, rows.flatMap(row => row.resolvedByUserId ? [row.resolvedByUserId] : []));
    return rows.map(row => {
      const other = row.expense.sourceReimbursementRequestId === requestId ? row.candidateExpense : row.expense;
      return { id: row.id, candidateType: 'MANUAL' as const, status: row.status === 'OPEN' ? 'OPEN' as const : 'DISMISSED' as const, score: row.score,
        candidateExpenseId: other.id, documentNumber: other.expenseNumber ?? undefined,
        requesterOrPayee: other.vendorNameSnapshot ?? undefined, amount: String(other.grandTotalAmount), currency: other.currency, date: other.expenseDate.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString(), resolvedByName: row.resolvedByUserId ? names[row.resolvedByUserId] : undefined };
    });
  }

  async findRequestById(companyId: string, id: string, withRelations = false): Promise<ReimbursementRequestRecord | null> {
    const row = await this.prisma.client.reimbursementRequest.findFirst({
      where: { id, companyId },
      // Lines load on every read: the snapshot hash, the receipt gate and the
      // duplicate scan all fold them, so a line-less read would approve stale.
      include: withRelations
        ? {
            lines: { orderBy: { lineNo: 'asc' } },
            _count: { select: { sourceExpenses: { where: { status: 'VOIDED' } } } },
            approvalSteps: { orderBy: { sequenceNo: 'asc' } },
            payments: { orderBy: { createdAt: 'asc' } },
            duplicateCandidates: true,
            sourceExpenses: OWN_DUPLICATE_EXPENSES,
            claimSignatures: { orderBy: { signedAt: 'asc' } },
          }
        : { lines: { orderBy: { lineNo: 'asc' } }, sourceExpenses: OWN_DUPLICATE_EXPENSES },
    });
    return row ? this.toRequest(row) : null;
  }

  async listInternalNotes(companyId: string, requestId: string) {
    return this.prisma.client.reimbursementInternalNote.findMany({
      where: { companyId, reimbursementRequestId: requestId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async findInternalNote(companyId: string, requestId: string, noteId: string) {
    return this.prisma.client.reimbursementInternalNote.findFirst({
      where: { id: noteId, companyId, reimbursementRequestId: requestId },
    });
  }

  async createInternalNote(companyId: string, requestId: string, authorUserId: string, body: string) {
    return this.prisma.client.reimbursementInternalNote.create({
      data: { companyId, reimbursementRequestId: requestId, authorUserId, body },
    });
  }

  async updateInternalNote(companyId: string, requestId: string, noteId: string, body: string) {
    const changed = await this.prisma.client.reimbursementInternalNote.updateMany({
      where: { id: noteId, companyId, reimbursementRequestId: requestId }, data: { body },
    });
    if (changed.count !== 1) throw new NotFoundException('Internal note not found');
  }

  async deleteInternalNote(companyId: string, requestId: string, noteId: string) {
    const changed = await this.prisma.client.reimbursementInternalNote.deleteMany({
      where: { id: noteId, companyId, reimbursementRequestId: requestId },
    });
    if (changed.count !== 1) throw new NotFoundException('Internal note not found');
  }

  /** The list predicate: company, requester, status filters, branch scope, the related-records relation and the search. */
  private async requestListWhere(where: ListRequestsWhere): Promise<Prisma.ReimbursementRequestWhereInput & { AND: Prisma.ReimbursementRequestWhereInput[] }> {
    const predicates: Prisma.ReimbursementRequestWhereInput[] = [
      branchScopeWhere(where.scopes ?? {}) as Prisma.ReimbursementRequestWhereInput,
    ];
    if (where.relatedUserId) {
      predicates.push(await this.relatedRequestPredicate(where.companyId, where.relatedUserId, where.scopes));
    }
    if (where.requesterName) predicates.push({ requesterDisplayNameSnapshot: { contains: where.requesterName, mode: 'insensitive' } });
    if (where.categoryName) predicates.push({ OR: [
      { categoryLabelSnapshot: { contains: where.categoryName, mode: 'insensitive' } },
      { title: { contains: where.categoryName, mode: 'insensitive' } },
      { lines: { some: { description: { contains: where.categoryName, mode: 'insensitive' } } } },
    ] });
    return {
      companyId: where.companyId,
      requesterUserId: where.requesterUserId,
      status: (where.status as any) ?? (where.statuses ? { in: where.statuses as any } : undefined),
      paymentStatus: where.paymentStatus as any,
      AND: [...predicates, ...(where.search ? [{ OR: [
        { requestNo: { contains: where.search, mode: 'insensitive' as const } },
        { title: { contains: where.search, mode: 'insensitive' as const } },
        { reason: { contains: where.search, mode: 'insensitive' as const } },
      ] }] : [])],
    };
  }

  /**
   * One page of a list, read with LIMIT and OFFSET in the database, and the whole scope grouped by the
   * fields the hub counts on. The page, groups and payment duplicate facts share one predicate, so the
   * groups of a bucket add up to exactly the claims its pages hold. A search narrows that one predicate
   * (`hubSearchWhere`), so with a search the groups count what was found, bucket by bucket.
   */
  async listRequestPage(where: ListRequestsWhere & { bucket?: string; skip: number; take: number }, currentPolicy?: EffectivePolicy): Promise<{
    rows: ReimbursementRequestRecord[];
    groups: ReimbursementRequestGroup[];
    duplicateBlockedCount: number;
    duplicateBlockedAmount: string;
  }> {
    const scope = await this.requestListWhere({ ...where, search: undefined });
    if (where.search) scope.AND.push(hubSearchWhere(where.search));
    const policy = currentPolicy ?? effectivePolicy(await this.findPolicy(where.companyId, null));
    // ponytail: one extra read, bounded by unpaid payment-step claims in this searched scope.
    // If scopes outgrow the facts read/id filter, index an eligibility projection maintained by this domain predicate.
    const paymentClaims = await this.prisma.client.reimbursementRequest.findMany({
      where: { ...scope, AND: [...scope.AND, hubBucketWhere('payment')] },
      select: { id: true, amount: true, approvalPolicySnapshotJson: true,
        _count: { select: { duplicateCandidates: { where: { status: 'OPEN' } } } }, sourceExpenses: OWN_DUPLICATE_EXPENSES },
    });
    const blocked = paymentClaims.filter((row) => claimDuplicateBlocksPayment(this.toRequest(row), policy, row._count.duplicateCandidates));
    const blockedIds = blocked.map((row) => row.id);
    const correction = { AND: [
      { OR: [{ requesterUserId: where.correctionUserId ?? '' }, { createdByUserId: where.correctionUserId ?? '' }] },
      { OR: [{ status: 'REJECTED' }, { status: 'DRAFT', financeReviewStatus: 'NEEDS_INFO' },
        { status: 'PENDING_APPROVAL', payoutCorrectionRequestedAt: { not: null }, payoutCorrectionSubmittedAt: null }] },
    ] } as Prisma.ReimbursementRequestWhereInput;
    const normalBucket = where.bucket === 'duplicate_blocked' ? { id: { in: blockedIds } }
      : where.bucket === 'payment' ? { AND: [hubBucketWhere('payment'), { id: { notIn: blockedIds } }] }
      : where.bucket === undefined ? {} : hubBucketWhere(where.bucket);
    const bucketWhere = where.bucket === 'correction' ? { OR: [{ status: 'REJECTED' as const }, correction] } : where.bucket ? { AND: [normalBucket, { NOT: correction }] } : {};
    const [rows, groups] = await Promise.all([
      this.prisma.client.reimbursementRequest.findMany({
        where: { ...scope, AND: [...scope.AND, bucketWhere] },
        // The page's rows report the same duplicate status as the claim's own page: one batched read for the page.
        include: { claimSignatures: true, _count: { select: { lines: true } }, duplicateCandidates: LIVE_DUPLICATE_CANDIDATES, sourceExpenses: OWN_DUPLICATE_EXPENSES },
        // The same stable order as `listRequests`: OFFSET pages need every row to keep its place.
        orderBy: [{ incurredDate: where.order === 'oldest' ? 'asc' : 'desc' }, { createdAt: where.order === 'oldest' ? 'asc' : 'desc' }, { id: where.order === 'oldest' ? 'asc' : 'desc' }],
        skip: where.skip,
        take: where.take,
      }),
      this.prisma.client.reimbursementRequest.groupBy({
        by: ['status', 'financeReviewStatus', 'receiptRequirementStatus', 'requesterUserId', 'createdByUserId', 'payoutCorrectionRequestedAt', 'payoutCorrectionSubmittedAt'],
        where: scope,
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    return {
      rows: rows.map((row) => this.toRequest(row)),
      duplicateBlockedCount: blockedIds.length,
      duplicateBlockedAmount: decStr(blocked.reduce((sum, row) => sum.add(d(String(row.amount))), d(0))),
      groups: groups.map((group) => ({
        needsCorrection: reimbursementNeedsCorrection(group, where.correctionUserId ?? ''),
        status: group.status,
        financeReviewStatus: group.financeReviewStatus,
        receiptRequirementStatus: group.receiptRequirementStatus,
        count: group._count._all,
        amount: dec(group._sum.amount),
      })),
    };
  }

  async listRequests(where: ListRequestsWhere): Promise<ReimbursementRequestRecord[]> {
    const rows = await this.prisma.client.reimbursementRequest.findMany({
      where: await this.requestListWhere(where),
      // Queues show a line count, not the lines themselves — keep the list query cheap.
      include: {
        _count: { select: { lines: true } },
        ...(where.status === 'PENDING_APPROVAL' && {
          approvalSteps: { where: { status: 'PENDING' as any } },
        }),
        // A row's own expense duplicates decide what it may say about being paid (a confirmed one waits to be cancelled), on every list.
        sourceExpenses: OWN_DUPLICATE_EXPENSES,
        ...(where.withDuplicateCandidates && { duplicateCandidates: LIVE_DUPLICATE_CANDIDATES }),
      },
      // F2 (tuning-6b): rows created in the same instant (seeded data, bulk imports) came back in
      // arbitrary order under createdAt alone, so the LINE list's "1./2." numbering ("ใบที่สอง") could
      // point at a different claim between two asks. `id` is a stable, always-distinct tie-breaker —
      // shared by this web approval list too, so it only narrows an existing tie, never reorders one.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: where.skip,
      take: where.take,
    });
    return rows.map((r) => this.toRequest(r));
  }

  async updateRequest(companyId: string, id: string, data: Record<string, unknown>): Promise<ReimbursementRequestRecord> {
    const changed = await this.prisma.client.reimbursementRequest.updateMany({ where: { id, companyId }, data });
    if (changed.count !== 1) throw new NotFoundException('Reimbursement request not found');
    const row = await this.prisma.client.reimbursementRequest.findFirstOrThrow({
      where: { id, companyId },
      include: { _count: { select: { lines: true } } },
    });
    return this.toRequest(row);
  }

  /**
   * REJECTED -> DRAFT, or PENDING_APPROVAL -> DRAFT while nobody has decided (the requester
   * withdraws it), with CAS so the requester can correct and resubmit. The requestNo is
   * kept on purpose: submit reserves numbers under `reimb-submit:{id}`, so resubmission
   * reuses the same document number instead of burning a new one.
   */
  async reopenRejectedRequest(
    companyId: string,
    id: string,
    expectedUpdatedAt: Date,
    actorUserId: string,
    expectedStatus: 'REJECTED' | 'PENDING_APPROVAL' = 'REJECTED',
  ): Promise<ReimbursementRequestRecord> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      await this.lockRequest(tx, companyId, id);
      // A draft can be edited line by line. A claim whose payout account is being corrected keeps its
      // lines and its expense records, so it never goes back to one (payout spec §14.7); nor does any
      // claim while expense records of its own still stand.
      const claim = await tx.reimbursementRequest.findFirst({
        where: { id, companyId }, select: { status: true, payoutCorrectionRequestedAt: true, payoutCorrectionSubmittedAt: true },
      });
      if (claim && payoutCorrectionPhase(claim)) throw new ConflictException('payout_correction_in_progress');
      await this.assertNoLiveProjections(tx, companyId, id);
      if (expectedStatus === 'PENDING_APPROVAL') {
        // An approval's projection phase keeps the claim PENDING_APPROVAL after its step is decided,
        // so only an undecided current step may be withdrawn. It is cancelled the way a cancellation
        // cancels it: the resubmission then has no live step to inherit and builds a fresh route.
        const row = await tx.reimbursementRequest.findFirst({ where: { id, companyId }, select: { currentApprovalStepId: true } });
        const withdrawn = row?.currentApprovalStepId
          ? await tx.reimbursementApprovalStep.updateMany({
            where: { id: row.currentApprovalStepId, companyId, reimbursementRequestId: id, status: 'PENDING' },
            data: { status: 'CANCELLED', invalidatedAt: new Date(), invalidatedReason: 'withdrawn_by_requester' },
          })
          : { count: 0 };
        if (withdrawn.count !== 1) throw this.requestChanged();
      }
      const sent = await tx.reimbursementRequest.findFirst({
        where: { id, companyId },
        select: { id: true, companyId: true, requesterUserId: true, status: true, payoutMethod: true, payoutDestinationVersion: true },
      });
      const changed = await tx.reimbursementRequest.updateMany({
        where: { id, companyId, status: expectedStatus, updatedAt: expectedUpdatedAt, cancellationPendingAt: null },
        data: {
          ...(sent ? await draftPayoutAfterReopen(tx, sent) : {}),
          status: 'DRAFT',
          submittedAt: null,
          submittedByUserId: null,
          approvedAt: null,
          rejectedAt: null,
          rejectionReason: null,
          currentApproverUserId: null,
          currentApprovalStepId: null,
          approvalSnapshotHash: null,
          approvalPolicySnapshotJson: null,
          financeReviewStatus: 'NOT_REQUIRED',
          financeReviewedByUserId: null,
          financeReviewedAt: null,
          financeReviewNote: null,
          paymentStatus: 'NOT_PAYABLE',
          duplicateStatus: 'NOT_CHECKED',
          postingStatus: 'not_required',
          updatedByUserId: actorUserId,
          updatedAt: this.nextVersion(expectedUpdatedAt),
        },
      });
      if (changed.count !== 1) throw this.requestChanged();
      await Promise.all([
        tx.reimbursementClaimSignature.deleteMany({ where: { companyId, reimbursementRequestId: id } }),
        tx.attachmentLink.deleteMany({
          where: {
            companyId,
            targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE,
            targetId: id,
            purpose: REIMBURSEMENT_SIGNED_COPY_PURPOSE,
          },
        }),
      ]);
      const row = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id, companyId },
        include: { _count: { select: { lines: true } } },
      });
      // Going back to draft had no event at all, so the workflow module could not close the approval task (audit B8).
      await tx.outboxEvent.create({ data: { companyId, eventType: 'reimbursement.reopened',
        aggregateType: 'reimbursement_request', aggregateId: id, eventKey: `reimbursement.reopened:reimbursement_request:${id}:${row.updatedAt.toISOString()}`,
        payloadJson: { companyId, actorUserId, aggregateType: 'reimbursement_request', aggregateId: id,
          occurredAt: row.updatedAt.toISOString(), data: { requestId: id, status: 'DRAFT', previousStatus: expectedStatus } },
        priority: 'NORMAL', status: 'PENDING' } });
      return this.toRequest(row);
    });
  }

  async recordBlockedSubmitDuplicates(data: { companyId: string; requestId: string; expectedUpdatedAt: Date; candidates: ReimbursementDuplicateCandidateWriteData[]; onPersisted: (tx: any) => Promise<void> }): Promise<void> {
    await (this.prisma.client as any).$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      const row = await tx.reimbursementRequest.findFirst({ where: { id: data.requestId, companyId: data.companyId } });
      if (!row || row.status !== 'DRAFT' || row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw this.requestChanged();
      await tx.reimbursementDuplicateCandidate.deleteMany({ where: { companyId: data.companyId, reimbursementRequestId: data.requestId } });
      await tx.reimbursementDuplicateCandidate.createMany({ data: data.candidates.map(candidate => ({ ...candidate, companyId: data.companyId, reimbursementRequestId: data.requestId, status: 'OPEN' })) });
      const changed = await tx.reimbursementRequest.updateMany({ where: { id: data.requestId, companyId: data.companyId, status: 'DRAFT', updatedAt: data.expectedUpdatedAt }, data: { duplicateStatus: 'POSSIBLE_DUPLICATE', updatedAt: this.nextVersion(data.expectedUpdatedAt) } });
      if (changed.count !== 1) throw this.requestChanged();
      await data.onPersisted(tx);
    });
  }

  async findReceiptChecksums(companyId: string, attachmentIds: string[]): Promise<Record<string, string>> {
    if (!attachmentIds.length) return {};
    const rows = await this.prisma.client.attachmentObject.findMany({ where: { companyId, id: { in: attachmentIds } }, select: { id: true, checksumSha256: true } });
    return Object.fromEntries(rows.filter(row => row.checksumSha256).map(row => [row.id, row.checksumSha256!]));
  }

  async findDuplicateCandidates(companyId: string, requesterUserId: string, excludeId: string, evidence: { attachmentIds: string[]; attachmentChecksums: Record<string, string>; expenseIds: string[] }): Promise<ReimbursementRequestRecord[]> {
    const checksums = [...new Set(Object.values(evidence.attachmentChecksums))];
    const files = checksums.length ? await this.prisma.client.attachmentObject.findMany({
      where: { companyId, checksumSha256: { in: checksums } }, select: { id: true, checksumSha256: true },
    }) : [];
    const attachmentIds = [...new Set([...evidence.attachmentIds, ...files.map(file => file.id)])];
    const strong = [
      ...(attachmentIds.length ? [{ attachmentId: { in: attachmentIds } }] : []),
      ...(evidence.expenseIds.length ? [{ linkedExpenseId: { in: evidence.expenseIds } }] : []),
    ];
    const active = { companyId, id: { not: excludeId }, status: { notIn: ['REJECTED', 'CANCELLED', 'VOIDED'] as any } };
    const [softRows, strongRows] = await Promise.all([
      this.prisma.client.reimbursementRequest.findMany({ where: { ...active, requesterUserId }, include: { lines: { orderBy: { lineNo: 'asc' } } }, take: 50, orderBy: { createdAt: 'desc' } }),
      strong.length ? this.prisma.client.reimbursementRequest.findMany({ where: { ...active, lines: { some: { OR: strong } } }, include: { lines: { orderBy: { lineNo: 'asc' } } } }) : [],
    ]);
    const byId = new Map([...softRows, ...strongRows].map(row => [row.id, row]));
    const checksumById = new Map(files.map(file => [file.id, file.checksumSha256]));
    return [...byId.values()].map(row => {
      const request = this.toRequest(row);
      request.lines = request.lines?.map(line => ({ ...line, attachmentChecksum: line.attachmentId ? checksumById.get(line.attachmentId) ?? undefined : undefined }));
      return request;
    });
  }

  // ---- Approval step ----

  async createApprovalStep(data: {
    companyId: string;
    reimbursementRequestId: string;
    sequenceNo: number;
    approverUserId?: string;
    approverRoleSnapshot?: string;
    assignedApproverUserIdsJson?: string[];
    requestSnapshotHash: string;
  }): Promise<ReimbursementApprovalStepRecord> {
    const row = await this.prisma.client.reimbursementApprovalStep.create({
      data: {
        companyId: data.companyId,
        reimbursementRequestId: data.reimbursementRequestId,
        sequenceNo: data.sequenceNo,
        approverUserId: data.approverUserId,
        approverRoleSnapshot: data.approverRoleSnapshot,
        assignedApproverUserIdsJson: data.assignedApproverUserIdsJson,
        requestSnapshotHash: data.requestSnapshotHash,
      },
    });
    return this.toStep(row);
  }

  async updateApprovalStep(id: string, data: Record<string, unknown>): Promise<ReimbursementApprovalStepRecord> {
    const row = await this.prisma.client.reimbursementApprovalStep.update({ where: { id }, data });
    return this.toStep(row);
  }

  /**
   * Live pending steps of the given claims — the "อยู่ที่" desk of a list row. One query for the
   * whole page, never one per row, and none at all when the page holds no PENDING_APPROVAL claim.
   * (`listRequests` already includes them when the whole query is filtered to PENDING_APPROVAL.)
   */
  async findPendingApprovalSteps(companyId: string, requestIds: string[]): Promise<ReimbursementApprovalStepRecord[]> {
    if (requestIds.length === 0) return [];
    const rows = await this.prisma.client.reimbursementApprovalStep.findMany({
      where: { companyId, reimbursementRequestId: { in: requestIds }, status: 'PENDING', invalidatedAt: null },
      orderBy: { sequenceNo: 'asc' },
    });
    return rows.map((row) => this.toStep(row));
  }

  // ---- Payment ----

  async assertClaimPaymentReady(companyId: string, requestId: string, paidAt?: Date): Promise<void> {
    const row = await (this.prisma.client as any).reimbursementRequest.findFirst({
      where: { id: requestId, companyId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Reimbursement request not found');
    if (row.cancellationPendingAt) throw new ConflictException('reimbursement_cancellation_pending');
    await this.assertClaimProjectionsReady(this.prisma.client as any, this.toRequest(row));
    if (paidAt) await this.assertPaymentPeriodOpen(companyId, paidAt);
  }

  /**
   * A payment may only be dated in an accounting period that still takes entries, the rule expense
   * confirmation applies. Recorded in a closed month, the payout could never be posted until that
   * month was reopened. A month nobody has opened yet has no row, and is open.
   * A check before the write, not a lock: the period close holds none either, for any source.
   */
  async assertPaymentPeriodOpen(companyId: string, paidAt: Date): Promise<void> {
    const periodKey = civilPeriodKey(civilDate(paidAt));
    const period = await (this.prisma.client as any).accountingPeriod.findUnique({
      where: { companyId_periodKey: { companyId, periodKey } }, select: { status: true },
    });
    if (period && !['OPEN', 'REOPENED'].includes(String(period.status))) {
      throw new ConflictException(`reimbursement_payment_accounting_period_locked:${periodKey}`);
    }
  }

  async recordPaymentAtomic(data: {
    companyId: string;
    /**
     * Runs inside the payment transaction, once the payment and the claim totals are written. `payout` is
     * the account this payment was just confirmed into (masked: kind, bank, last 4), when there is one.
     */
    onPaymentPersisted?: (tx: any, payment: ReimbursementPaymentRecord, paymentStatus: string, payout?: ConfirmedPaymentPayout) => Promise<void>;
    reimbursementRequestId: string;
    idempotencyKey: string;
    paymentNo?: string;
    paidAmount: string;
    currency: string;
    paymentMethod: string;
    paidAt: Date;
    paymentReference?: string;
    bankAccountId?: string;
    /** Payment evidence: proven for this claim and payer, then linked, inside this transaction. */
    slipAttachmentId?: string;
    /** The payer's yes to withdrawing a "signed on paper" declaration the slip file carries. */
    confirmSignedCopyWithdrawal?: boolean;
    /**
     * What the payer said about the payout account, as sent. It is held against the claim under the
     * payment lock (`planPaymentPayout`), never trusted from a check made before it.
     */
    payout?: Omit<PaymentPayoutStatement, 'paymentMethod'>;
    paidByUserId: string;
  }): Promise<{
    request: ReimbursementRequestRecord; payment: ReimbursementPaymentRecord; created: boolean;
    slip?: ReimbursementPaymentSlipLink; payout?: ConfirmedPaymentPayout;
  }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${data.companyId}:${data.reimbursementRequestId}:reimbursement-payment`}))`;
      await this.lockRequest(tx, data.companyId, data.reimbursementRequestId);
      const statement: PaymentPayoutStatement = { ...data.payout, paymentMethod: data.paymentMethod };

      const existing = await tx.reimbursementPayment.findFirst({
        where: { companyId: data.companyId, idempotencyKey: data.idempotencyKey },
      });
      if (existing) {
        const request = await tx.reimbursementRequest.findFirst({
          where: { id: data.reimbursementRequestId, companyId: data.companyId },
          include: {
            lines: { orderBy: { lineNo: 'asc' } },
            approvalSteps: { orderBy: { sequenceNo: 'asc' } },
            payments: { orderBy: { createdAt: 'asc' } },
            duplicateCandidates: true,
          },
        });
        if (!request) throw new NotFoundException('Reimbursement request not found');
        const plan = planPaymentPayout(request, statement);
        // A voided payment is not this payment any more: replaying its key must not read as paid.
        // Nor is a replay that names another account, or none, than the one that payment went into.
        const samePayment = existing.reimbursementRequestId === data.reimbursementRequestId
          && existing.status === 'RECORDED'
          && !('error' in plan)
          && isSamePaymentRequest({ ...existing, ...await readRecordedPaymentPayout(tx, request, existing) }, { ...data, ...plan });
        if (!samePayment) throw new ConflictException('reimbursement_payment_idempotency_conflict');
        return { request: this.toRequest(request), payment: this.toPayment(existing), created: false };
      }

      const request = await tx.reimbursementRequest.findFirst({
        where: { id: data.reimbursementRequestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } }, sourceExpenses: OWN_DUPLICATE_EXPENSES, duplicateCandidates: LIVE_DUPLICATE_CANDIDATES },
      });
      if (!request) throw new NotFoundException('Reimbursement request not found');
      if (request.paymentStatus === 'PAID') throw new ConflictException('reimbursement_payment_already_recorded');
      if (data.bankAccountId !== undefined) await tx.$executeRaw`SELECT 1 FROM "BankAccount" WHERE "id" = ${data.bankAccountId} AND "companyId" = ${data.companyId} FOR SHARE`;
      await this.assertPaymentRecordInput(request, data, tx);
      if (request.cancellationPendingAt) throw new ConflictException('reimbursement_cancellation_pending');
      // Its status refuses the payment anyway (payout spec §14.7); this says why in the payer's words.
      if (payoutCorrectionPhase(request)) throw new ConflictException('payout_correction_in_progress');
      requireTransactionBranchId(request.branchId);
      if (isFuturePaymentDate(data.paidAt)) throw new BadRequestException(PAYMENT_DATE_IN_FUTURE);
      await assertReimbursementSources(tx, this.toRequest(request));

      const policy = effectivePolicyForRequest(this.toRequest(request), effectivePolicy(await tx.reimbursementPolicy.findFirst({
        where: { companyId: data.companyId, branchId: null },
      }).then((row: any) => row ? this.toPolicy(row) : null)));
      const duplicateBlocking = duplicateBlocksPayment(policy.duplicatePolicy, await tx.reimbursementDuplicateCandidate.count({
        where: { companyId: data.companyId, reimbursementRequestId: data.reimbursementRequestId, status: 'OPEN' },
      }), (this.toRequest(request).possibleDuplicateExpenseCount ?? 0) + (this.toRequest(request).duplicateConfirmationPendingCount ?? 0), this.toRequest(request).confirmedDuplicateExpenseCount);
      const duplicateReasons = claimDuplicateReasons(this.toRequest(request));
      const error = validatePaymentRecording({
        status: request.status,
        financeReviewRequired: policy.financeReviewRequired,
        financeReviewApproved: request.financeReviewStatus === 'APPROVED_FOR_PAYMENT' || !policy.financeReviewRequired,
        duplicateBlocking,
        duplicateReasons,
        approvedAmount: dec(request.amount),
        outstandingAmount: dec(request.outstandingAmount),
        paidAmount: data.paidAmount,
        paymentMethod: data.paymentMethod as any,
        paymentReference: data.paymentReference,
        hasSlip: Boolean(data.slipAttachmentId),
      });
      if (error) throw new UnprocessableEntityException(error === 'duplicate_unresolved' || error === 'duplicate_confirmed' ? { code: error, duplicatePhase: 'PAYMENT', message: reimbursementDuplicateBlockNotice(duplicateReasons, false, { status: request.status }), duplicateReasons, claimStatus: request.status } : error);
      await this.assertClaimProjectionsReady(tx, this.toRequest(request));
      // Spec §12.3, §12.4, §12.6: the account version the payer was shown is the claim's version NOW,
      // a transfer into the claim's account is confirmed, and a method other than the one asked for
      // has its reason. Decided here, from the row read under the lock, so no account change that
      // committed before this transaction can slip between the check and the payment.
      const payoutPlan = planPaymentPayout(request, statement);
      if ('error' in payoutPlan) throw paymentPayoutRefusal(payoutPlan.error);
      const slip = data.slipAttachmentId
        ? await this.resolvePaymentSlipLocked(tx, {
          companyId: data.companyId, requestId: data.reimbursementRequestId,
          attachmentId: data.slipAttachmentId, actorUserId: data.paidByUserId,
          confirmSignedCopyWithdrawal: data.confirmSignedCopyWithdrawal,
        })
        : undefined;
      const payout = await confirmPaymentPayout(tx, request, payoutPlan, { actorUserId: data.paidByUserId, confirmedAt: new Date() });

      let payment = await tx.reimbursementPayment.create({ data: {
        companyId: data.companyId,
        reimbursementRequestId: data.reimbursementRequestId,
        idempotencyKey: data.idempotencyKey,
        paymentNo: data.paymentNo,
        paidAmount: data.paidAmount,
        currency: data.currency,
        paymentMethod: data.paymentMethod,
        paidAt: data.paidAt,
        paymentReference: data.paymentReference,
        bankAccountId: data.bankAccountId,
        slipAttachmentId: slip?.attachmentId,
        slipChecksumSha256: slip?.checksumSha256,
        // The version stored is the one just proven current: what the approver attested, what the
        // payer was shown and confirmed, and what this payment went into are one number.
        payoutDestinationVersion: payout?.payoutDestinationVersion,
        payoutConfirmedAt: payout?.payoutConfirmedAt,
        methodMismatchReason: payoutPlan.methodMismatchReason,
        sourcePaymentRef: '',
        paidByUserId: data.paidByUserId,
        postingStatus: 'pending',
      } });
      // Same transaction as the payment row: a payment never exists without the slip it was
      // recorded with, and a slip link never outlives a payment that failed to commit.
      const slipLink = slip
        ? await this.linkPaymentSlip(tx, { companyId: data.companyId, paymentId: payment.id, linkedByUserId: data.paidByUserId, slip })
        : undefined;
      const sourcePaymentRef = JSON.stringify(buildPaymentSourceRef({
        id: payment.id,
        paidAmount: data.paidAmount,
        currency: data.currency,
        paidAt: data.paidAt,
        requesterDisplayNameSnapshot: request.requesterDisplayNameSnapshot,
        reimbursementRequestId: data.reimbursementRequestId,
      }));
      payment = await tx.reimbursementPayment.update({
        where: { id: payment.id },
        data: { sourcePaymentRef },
      });

      const newTotal = decStr(d(request.paymentTotalAmount).add(d(data.paidAmount)));
      const outstandingAmount = computeOutstanding(dec(request.amount), newTotal);
      const paymentStatus = computePaymentStatus(dec(request.amount), newTotal);
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.reimbursementRequestId,
          companyId: data.companyId,
          status: request.status,
          updatedAt: request.updatedAt,
        },
        data: {
          paymentTotalAmount: newTotal,
          outstandingAmount,
          paymentStatus,
          status: paymentStatus === 'PAID' ? 'PAID' : 'PARTIALLY_PAID',
          updatedByUserId: data.paidByUserId,
        },
      });
      if (changed.count !== 1) throw new ConflictException('reimbursement_payment_state_changed');
      // Audit B10: the "paid" event commits with the payment. Appended after commit it was lost,
      // with no retry, whenever that append failed, and the requester was never told.
      await data.onPaymentPersisted?.(tx, this.toPayment(payment), paymentStatus, payout);

      if (paymentStatus === 'PAID') {
        // Mirror the payout onto the claim's CONFIRMED expense projections (owner decision
        // 2026-08-10): the cash left through THIS payment, so a projection must stop reading
        // ยังไม่ชำระ. Deliberately no ExpensePayment row — bank reconciliation already matches
        // the reimbursement payment's own source ref, and a projection-side row would offer
        // the same cash to the matcher twice. Unconfirmed projections (duplicate suspects
        // parked by finance) are left untouched; ReimbursementPaymentMethod values are a
        // subset of ExpensePaymentMethod, so the method carries over verbatim.
        const projections = await tx.expenseRecord.findMany({
          where: { companyId: data.companyId, sourceReimbursementRequestId: data.reimbursementRequestId, status: 'CONFIRMED' },
          select: { id: true, netPayableAmount: true },
        });
        for (const projection of projections) {
          await tx.expenseRecord.update({
            where: { id: projection.id },
            data: {
              paymentStatus: 'PAID',
              paidAmount: projection.netPayableAmount,
              outstandingAmount: '0.0000',
              paymentMethod: data.paymentMethod,
              paidAt: data.paidAt,
              updatedByUserId: data.paidByUserId,
            },
          });
        }
      }

      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.reimbursementRequestId, companyId: data.companyId },
        include: {
          lines: { orderBy: { lineNo: 'asc' } },
          approvalSteps: { orderBy: { sequenceNo: 'asc' } },
          payments: { orderBy: { createdAt: 'asc' } },
          duplicateCandidates: true,
        },
      });
      return {
        request: this.toRequest(updated), payment: this.toPayment(payment), created: true,
        ...(slipLink && { slip: slipLink }), ...(payout && { payout }),
      };
    }, { isolationLevel: 'Serializable' }).catch(paymentChangedOnSerializationFailure);
  }

  // ---- Payment slips (spec §12.5, §16) ----

  /** Friendly preflight of the slip proof that `recordPaymentAtomic` repeats under the payment lock. */
  async assertPaymentSlipUsable(input: PaymentSlipProofInput): Promise<void> {
    await this.resolvePaymentSlip(this.prisma.client as any, input);
  }

  /**
   * What a file offered as a payment slip is to THIS claim and THIS payer (spec §12.5, AC22). Three
   * things qualify: a slip already on another payment of the claim (a re-pay after a void), the
   * payer's own slip upload for the claim, and a file attached to the claim as a signed copy (the
   * misfiled slip, §16). Anything else is refused: another claim's slip, somebody else's upload, a receipt.
   *
   * A slip is exclusive (owner 2026-10-01: never an expense receipt, never a signed claim copy). The
   * generic file paths stop serving a slip to everyone, so a file that is also something else's
   * evidence is refused here: every link it has must be the kind its source allows, and no claim
   * line may name it as a receipt.
   */
  private async resolvePaymentSlip(db: any, input: PaymentSlipProofInput): Promise<ResolvedPaymentSlip> {
    const invalid = () => new UnprocessableEntityException('payment_slip_invalid');
    const file = await db.attachmentObject.findFirst({
      where: { id: input.attachmentId, companyId: input.companyId, status: 'ACTIVE', mimeType: { in: REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES } },
      select: { id: true, byteSize: true, checksumSha256: true, uploadedByUserId: true, metadataJson: true },
    });
    if (!file) throw invalid();
    const links: { id: string; targetType: string; targetId: string; purpose: string }[] = await db.attachmentLink.findMany({
      where: { companyId: input.companyId, attachmentId: input.attachmentId },
      select: { id: true, targetType: true, targetId: true, purpose: true },
    });
    const slipPaymentIds = links
      .filter((link) => link.targetType === REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE && link.purpose === REIMBURSEMENT_PAYMENT_SLIP_PURPOSE)
      .map((link) => link.targetId);
    const signedCopyLinkIds = links
      .filter((link) => link.targetType === REIMBURSEMENT_ATTACHMENT_TARGET_TYPE && link.targetId === input.requestId && link.purpose === REIMBURSEMENT_SIGNED_COPY_PURPOSE)
      .map((link) => link.id);
    const alsoReceipt = await db.reimbursementLine.count({ where: { companyId: input.companyId, attachmentId: input.attachmentId } }) > 0;
    const metadataJson = (file.metadataJson ?? null) as Record<string, unknown> | null;

    let source: ReimbursementPaymentSlipSource;
    if (slipPaymentIds.length > 0) {
      // Already a slip somewhere: it may serve again only for payments of this same claim.
      const ofThisClaim = await db.reimbursementPayment.count({
        where: { companyId: input.companyId, reimbursementRequestId: input.requestId, id: { in: slipPaymentIds } },
      });
      if (alsoReceipt || links.length !== slipPaymentIds.length || ofThisClaim !== new Set(slipPaymentIds).size) throw invalid();
      source = 'PREVIOUS_SLIP';
    } else if (metadataJson?.['generatedFor'] === REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG) {
      if (alsoReceipt || links.length !== 0 || metadataJson['requestId'] !== input.requestId || file.uploadedByUserId !== input.actorUserId
        || file.byteSize > REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES) throw invalid();
      source = 'UPLOAD';
    } else if (signedCopyLinkIds.length > 0) {
      // Only this claim's signed copy: the same file on another claim, or as a receipt, stays what it
      // is there. Said as its own refusal: nothing is wrong with the file's type or size, and the
      // payer can do something about it (attach the slip as a new file).
      if (alsoReceipt || links.length !== signedCopyLinkIds.length) throw new UnprocessableEntityException('payment_slip_in_use_elsewhere');
      source = 'SIGNED_COPY';
    } else {
      throw invalid();
    }
    // Only the declaration made with a link this move removes. One bound to any other link is not this
    // claim's to withdraw, and it never counted for this claim either.
    const declaredLinkId = (metadataJson?.[REIMBURSEMENT_SIGNED_COPY_ACK_KEY] as { linkId?: string } | null | undefined)?.linkId ?? '';
    const withdrawsDeclaration = source === 'SIGNED_COPY' && signedCopyLinkIds.includes(declaredLinkId);
    // The signed form picked as the slip (upgrade test 2026-10-02): the move cannot be undone, so a
    // declared copy leaves its list only on the payer's explicit word. A page that predates the
    // question sends nothing and is told to reload (409), where the picker asks it.
    if (withdrawsDeclaration && input.confirmSignedCopyWithdrawal !== true) throw new ConflictException('payment_slip_signed_copy_unconfirmed');
    return {
      attachmentId: file.id, source, checksumSha256: file.checksumSha256 ?? null,
      uploadedByUserId: file.uploadedByUserId, metadataJson, signedCopyLinkIds, withdrawsDeclaration,
    };
  }

  /**
   * The proof inside a transaction, safe against a generic delete of the same file from either side.
   * The advisory key is the one deletion takes before it looks for holds: a delete that starts now
   * waits, then finds the slip and refuses. The row lock covers the other order: a delete that
   * committed after this transaction's snapshot was taken fails this transaction (a serialization
   * conflict under the payment's isolation level) instead of leaving a slip on a deleted file.
   */
  private async resolvePaymentSlipLocked(tx: any, input: PaymentSlipProofInput): Promise<ResolvedPaymentSlip> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.attachmentId}:attachment-retention`}))`;
    await tx.$executeRaw`SELECT 1 FROM "AttachmentObject" WHERE "id" = ${input.attachmentId} AND "companyId" = ${input.companyId} FOR UPDATE`;
    return this.resolvePaymentSlip(tx, input);
  }

  /**
   * Writes the slip link. A file that came from the signed copies leaves that list in the same
   * transaction and takes its "signed on paper" declaration with it (§16.2): the declaration was
   * bound to the link now gone, and the stored copy of it is removed so nothing stale is left behind.
   */
  private async linkPaymentSlip(tx: any, input: {
    companyId: string; paymentId: string; linkedByUserId: string; slip: ResolvedPaymentSlip;
  }): Promise<ReimbursementPaymentSlipLink> {
    const { slip } = input;
    await tx.attachmentLink.create({ data: {
      companyId: input.companyId,
      attachmentId: slip.attachmentId,
      targetType: REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE,
      targetId: input.paymentId,
      purpose: REIMBURSEMENT_PAYMENT_SLIP_PURPOSE,
      linkedByUserId: input.linkedByUserId,
    } });
    if (slip.source === 'SIGNED_COPY') {
      await tx.attachmentLink.deleteMany({ where: { companyId: input.companyId, id: { in: slip.signedCopyLinkIds } } });
      // The declaration the proof found (and the payer confirmed withdrawing) goes with its link.
      const { [REIMBURSEMENT_SIGNED_COPY_ACK_KEY]: _withdrawn, ...rest } = slip.metadataJson ?? {};
      if (slip.withdrawsDeclaration) await tx.attachmentObject.update({ where: { id: slip.attachmentId }, data: { metadataJson: rest } });
    }
    return { attachmentId: slip.attachmentId, source: slip.source, uploadedByUserId: slip.uploadedByUserId, declarationWithdrawn: slip.withdrawsDeclaration };
  }

  /**
   * Adds a slip to a payment already recorded (spec §12.5 "แนบเพิ่มทีหลัง", §16.2). Add-only: a slip
   * is never removed. Takes the same two locks as recording and voiding, so it cannot interleave
   * with either. Attaching the same file to the same payment again changes nothing.
   */
  async attachPaymentSlipAtomic(data: {
    companyId: string; requestId: string; paymentId: string; attachmentId: string; actorUserId: string;
    confirmSignedCopyWithdrawal?: boolean;
  }): Promise<{ created: boolean; slip?: ReimbursementPaymentSlipLink }> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${data.companyId}:${data.requestId}:reimbursement-payment`}))`;
      await this.lockRequest(tx, data.companyId, data.requestId);
      const payment = await tx.reimbursementPayment.findFirst({
        where: { id: data.paymentId, companyId: data.companyId, reimbursementRequestId: data.requestId },
        select: { id: true, status: true },
      });
      if (!payment) throw new NotFoundException('Payment not found');
      // A voided payment is history: it keeps the slips it had and takes no new ones.
      if (payment.status !== 'RECORDED') {
        throw new ConflictException({ code: 'reimbursement_payment_changed', message: 'Payment changed before the slip was attached. Reload and retry.' });
      }
      const attached: { attachmentId: string }[] = await tx.attachmentLink.findMany({
        where: {
          companyId: data.companyId, targetType: REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE,
          targetId: data.paymentId, purpose: REIMBURSEMENT_PAYMENT_SLIP_PURPOSE,
        },
        select: { attachmentId: true },
      });
      if (attached.some((link) => link.attachmentId === data.attachmentId)) return { created: false };
      if (attached.length >= REIMBURSEMENT_PAYMENT_SLIP_MAX_FILES) throw new UnprocessableEntityException('payment_slip_limit_reached');
      const slip = await this.resolvePaymentSlipLocked(tx, data);
      return {
        created: true,
        slip: await this.linkPaymentSlip(tx, { companyId: data.companyId, paymentId: data.paymentId, linkedByUserId: data.actorUserId, slip }),
      };
    }).catch(paymentChangedOnSerializationFailure);
  }

  /** Slips per payment, oldest first. Ids and times only; the file opens through the slip endpoint. */
  async listPaymentSlips(companyId: string, paymentIds: readonly string[]): Promise<Record<string, { attachmentId: string; attachedAt: Date }[]>> {
    const byPayment: Record<string, { attachmentId: string; attachedAt: Date }[]> = {};
    if (paymentIds.length === 0) return byPayment;
    const rows = await this.prisma.client.attachmentLink.findMany({
      where: {
        companyId,
        targetType: REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE,
        targetId: { in: [...paymentIds] },
        purpose: REIMBURSEMENT_PAYMENT_SLIP_PURPOSE,
        attachment: { status: 'ACTIVE' },
      },
      select: { attachmentId: true, targetId: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) (byPayment[row.targetId] ??= []).push({ attachmentId: row.attachmentId, attachedAt: row.createdAt });
    return byPayment;
  }

  /** The payer's own slip upload for this claim, in any status: the complete step must not finish a stranger's intent. */
  async findPaymentSlipUpload(
    companyId: string, attachmentId: string, actorUserId: string, requestId: string,
  ): Promise<{ id: string; status: string } | null> {
    const row = await this.prisma.client.attachmentObject.findFirst({
      where: {
        id: attachmentId,
        companyId,
        uploadedByUserId: actorUserId,
        metadataJson: { equals: { generatedFor: REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG, requestId } },
      },
      select: { id: true, status: true },
    });
    return row ?? null;
  }

  /** Storage coordinates of one slip of one payment; null unless that exact link exists on a live file. */
  async findPaymentSlipFile(companyId: string, paymentId: string, attachmentId: string): Promise<{
    id: string; bucket: string; objectKey: string; objectVersionId?: string; mimeType: string; originalFileName: string;
  } | null> {
    const link = await this.prisma.client.attachmentLink.findFirst({
      where: {
        companyId,
        attachmentId,
        targetType: REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE,
        targetId: paymentId,
        purpose: REIMBURSEMENT_PAYMENT_SLIP_PURPOSE,
        attachment: { status: 'ACTIVE' },
      },
      select: { attachment: { select: { id: true, bucket: true, objectKey: true, objectVersionId: true, mimeType: true, originalFileName: true } } },
    });
    if (!link) return null;
    const { objectVersionId, ...file } = link.attachment;
    return { ...file, ...(objectVersionId ? { objectVersionId } : {}) };
  }

  async findPaymentById(companyId: string, id: string): Promise<ReimbursementPaymentRecord | null> {
    const row = await this.prisma.client.reimbursementPayment.findFirst({ where: { id, companyId } });
    return row ? this.toPayment(row) : null;
  }

  /**
   * Settlement is allowed only after every real claim expense accrual is posted.
   * A suspected duplicate may be paid in cash, but its ledger leg stays pending
   * until finance resolves it; a confirmed duplicate needs no accrual.
   */
  async assertSettlementPostingReady(
    companyId: string,
    paymentId: string,
  ): Promise<{ branchId?: string }> {
    const payment = await (this.prisma.client as any).reimbursementPayment.findFirst({
      where: { id: paymentId, companyId },
      include: { request: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
    });
    if (!payment) throw new NotFoundException('Reimbursement payment not found');
    const request = this.toRequest(payment.request);
    const lines = request.lines ?? [];
    const projections = await (this.prisma.client as any).expenseRecord.findMany({
      where: {
        companyId,
        sourceReimbursementRequestId: request.id,
        OR: [{ sourceReimbursementLineId: { in: lines.map((line) => line.id) } }, { status: 'VOIDED' }],
      },
    });
    assertClaimProjectionsNotVoided(request, projections);
    const byLine = new Map(projections.map((row: any) => [row.sourceReimbursementLineId, row]));
    if (!lines.length || byLine.size !== lines.length) {
      throw new ConflictException('reimbursement_projection_not_ready');
    }
    for (const line of lines) {
      const projection: any = byLine.get(line.id);
      if (!projection || projection.sourceReimbursementRequestId !== request.id) {
        throw new ConflictException('reimbursement_projection_source_mismatch');
      }
      if (projection.duplicateStatus === 'POSSIBLE_DUPLICATE') {
        throw new ConflictException('reimbursement_duplicate_settlement_pending');
      }
      if (projection.duplicateStatus === 'CONFIRMED_DUPLICATE') {
        if (projection.postingStatus !== 'not_required') {
          throw new ConflictException('reimbursement_duplicate_projection_posting_mismatch');
        }
        continue;
      }
      if (projection.status !== 'CONFIRMED') {
        throw new ConflictException('reimbursement_projection_not_confirmed');
      }
      const accrual = await (this.prisma.client as any).journalEntry.findFirst({
        where: {
          companyId,
          sourceType: 'expense.record',
          sourceId: projection.id,
          entryType: 'GENERATED',
          status: 'POSTED',
        },
        select: { id: true },
      });
      if (!accrual) throw new ConflictException('reimbursement_accrual_not_posted');
    }
    return { branchId: request.branchId };
  }

  async voidPayment(id: string, data: { voidReason: string; voidedByUserId: string }): Promise<ReimbursementPaymentRecord> {
    const row = await this.prisma.client.reimbursementPayment.update({
      where: { id },
      data: { status: 'VOIDED' as any, voidedAt: new Date(), voidReason: data.voidReason, voidedByUserId: data.voidedByUserId },
    });
    return this.toPayment(row);
  }

  // GAP-02: settlement postingStatus flip driven by GenerateJournalFromSourceUseCase,
  // mirroring how expense/vendor-bill/supplier-payment sources flip after generate.
  // ReimbursementPayment carries no journalEntryId/postingError columns, so only
  // the status changes here.
  // RECORDED only, and it says whether it wrote: a void owns the posting status of a voided payment
  // (`reversed` / `not_required`), so a late stamp from the generator or the worker must not land.
  // Inside a transaction (`db`) the write holds the payment row, which is what makes the generator's
  // settlement and the void's own update of that row take turns.
  async updatePaymentPostingStatus(
    companyId: string,
    id: string,
    data: { postingStatus: 'pending' | 'posted' | 'posting_error' | 'reversed' },
    db: any = this.prisma.client,
  ): Promise<boolean> {
    const stamped = await db.reimbursementPayment.updateMany({
      where: { id, companyId, status: 'RECORDED' },
      data: { postingStatus: data.postingStatus as any },
    });
    return stamped.count === 1;
  }

  // GAP-02 (mirrors expenses H-04): the ledger journal table is the source of
  // truth for whether a void needs a reversing entry — the payment's
  // postingStatus can lag and must not gate the reversal.
  async findPostedGeneratedJournalId(companyId: string, paymentId: string): Promise<string | null> {
    const row = await this.prisma.client.journalEntry.findFirst({
      where: { companyId, sourceType: 'reimbursement.payment', sourceId: paymentId, entryType: 'GENERATED' as any, status: 'POSTED' as any },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  // GAP-02 (mirrors expenses reverseExpenseJournalInTx): reverse the GENERATED
  // settlement journal of a voided payment inside the same transaction. Fail
  // closed on an unresolved posting state or a locked accounting period. No
  // tax-form lock check: the settlement journal is Dr 2130-01 / Cr 1110-01 with
  // no VAT lines.
  private async reversePaymentJournalInTx(tx: any, opts: {
    companyId: string;
    paymentId: string;
    reversalEntryNumber?: string;
    actorUserId: string;
    memo: string;
  }): Promise<{ reversalEntryId: string | null; reversed: boolean }> {
    const sourceWhere = { companyId: opts.companyId, sourceType: 'reimbursement.payment', sourceId: opts.paymentId };
    // A REVERSAL row for this source is the authoritative "already reversed"
    // signal (one per source by unique constraint) — the original stays POSTED.
    const existingReversal = await tx.journalEntry.findFirst({ where: { ...sourceWhere, entryType: 'REVERSAL' }, select: { id: true } });
    if (existingReversal) return { reversalEntryId: null, reversed: true };
    const original = await tx.journalEntry.findFirst({
      where: { ...sourceWhere, entryType: 'GENERATED' },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) return { reversalEntryId: null, reversed: false };
    if (original.status !== 'POSTED') {
      throw new UnprocessableEntityException(`Generated journal ${original.entryNumber} is ${original.status}; resolve its posting state before voiding`);
    }
    const period = await tx.accountingPeriod.findFirst({ where: { companyId: opts.companyId, id: original.periodId } });
    if (!period) {
      throw new UnprocessableEntityException(`Accounting period for journal ${original.entryNumber} was not found; cannot void`);
    }
    if (!['OPEN', 'REOPENED'].includes(period.status)) {
      throw new ConflictException({ code: 'accounting_period_locked', message: `Accounting period ${period.periodKey} is not open; reopen it before voiding.` });
    }
    const reserved = opts.reversalEntryNumber ? null : await this.documentNumbers.reserveNumberInTransaction(tx, {
      companyId: opts.companyId, documentType: LEDGER_SEQUENCE_KEY, periodKey: civilPeriodKey(todayCivilDate()),
      idempotencyKey: `void-reversal:reimbursement.payment:${opts.paymentId}`, reservedByUserId: opts.actorUserId,
    });
    const reversalLines = buildReversalLines((original.lines ?? []).map((l: any) => ({
      accountId: l.accountId, branchId: l.branchId, description: l.description,
      debitAmount: l.debitAmount.toString(), creditAmount: l.creditAmount.toString(),
      currency: l.currency, taxCode: l.taxCode,
    })));
    const now = new Date();
    // @@unique([companyId, sourceType, sourceId, entryType]) makes a second
    // REVERSAL for this source abort the transaction — DB-level idempotency.
    const reversal = await tx.journalEntry.create({
      data: {
        companyId: opts.companyId, periodId: original.periodId, entryNumber: opts.reversalEntryNumber ?? reserved!.documentNumber,
        entryType: 'REVERSAL', sourceType: 'reimbursement.payment', sourceId: opts.paymentId,
        reversalOfJournalEntryId: original.id, status: 'POSTED', entryDate: now, postedAt: now,
        postedByUserId: opts.actorUserId, memo: opts.memo, createdByUserId: opts.actorUserId,
        lines: {
          create: reversalLines.map((l, idx) => ({
            accountId: l.accountId, branchId: l.branchId ?? null,
            lineNumber: idx + 1, description: l.description,
            debitAmount: parseFloat(l.debitAmount ?? '0') || 0,
            creditAmount: parseFloat(l.creditAmount ?? '0') || 0,
            currency: l.currency ?? 'THB', taxCode: l.taxCode ?? null,
          })),
        },
      },
    });
    if (reserved) await this.documentNumbers.commitNumberInTransaction(tx, {
      id: reserved.id, companyId: opts.companyId, ownerType: 'journal_entry', ownerId: reversal.id,
    });
    // The original stays POSTED: GL/report queries count POSTED entries only,
    // so original + reversal net to zero.
    return { reversalEntryId: reversal.id, reversed: true };
  }

  // GAP-02 (mirrors expenses voidExpenseTrueReversal): the payment void, the
  // request rollup recompute and the GL reversal commit or roll back together.
  async voidPaymentTrueReversal(
    companyId: string,
    requestId: string,
    paymentId: string,
    actorUserId: string,
    reason: string,
    reversalEntryNumber?: string,
    auditRequestId?: string,
  ): Promise<{ request: ReimbursementRequestRecord; payment: ReimbursementPaymentRecord; reversalEntryId: string | null; alreadyVoided?: boolean }> {
    return serializableTransaction(this.prisma.client, async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${requestId}:reimbursement-payment`}))`;
      await this.lockRequest(tx, companyId, requestId);
      const prior = await tx.reimbursementPayment.findFirst({ where: { id: paymentId, companyId, reimbursementRequestId: requestId } });
      if (!prior) throw new NotFoundException('Payment not found');
      if (prior.status === 'VOIDED') {
        const request = await tx.reimbursementRequest.findFirstOrThrow({ where: { id: requestId, companyId }, include: {
          lines: { orderBy: { lineNo: 'asc' } }, approvalSteps: { orderBy: { sequenceNo: 'asc' } },
          payments: { orderBy: { createdAt: 'asc' } }, duplicateCandidates: true, claimSignatures: { orderBy: { signedAt: 'asc' } },
        } });
        return { request: this.toRequest(request), payment: this.toPayment(prior), reversalEntryId: null, alreadyVoided: true };
      }
      // A bank statement line confirmed against this payment would be left matched to a payment that
      // no longer stands. A fully matched line is not listed on the bank matching screen, so nobody
      // could undo the match there first: the void undoes it here, by the banking module's own rule
      // (the match is voided and the line's status is derived again from the matches that still
      // stand). Only a line inside a completed reconciliation is refused: that one is reopened first.
      const bankMatches: Array<{ id: string; statementLineId: string }> = await tx.bankReconciliationMatch.findMany({
        where: { companyId, sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: paymentId, status: 'CONFIRMED' },
        select: { id: true, statementLineId: true },
      });
      for (const match of bankMatches) {
        const reconciled = await tx.bankReconciliationSessionLine.count({
          where: { companyId, statementLineId: match.statementLineId, session: { status: 'COMPLETED' } },
        });
        if (reconciled > 0) {
          throw new ConflictException({ code: 'reimbursement_payment_bank_reconciled', message: 'This payment is matched to a bank statement line in a completed reconciliation. Reopen that reconciliation before voiding the payment.' });
        }
        await tx.bankReconciliationMatch.update({ where: { id: match.id }, data: { status: 'VOIDED' } });
        const line = await tx.bankStatementLine.findFirstOrThrow({
          where: { id: match.statementLineId, companyId },
          select: { signedAmount: true, matches: { where: { status: 'CONFIRMED' }, select: { allocatedAmount: true } } },
        });
        await tx.bankStatementLine.update({
          where: { id: match.statementLineId },
          data: { status: calculateStatementLineMatchStatus({
            statementLineAmount: String(line.signedAmount),
            confirmedAllocations: line.matches.map((standing: { allocatedAmount: unknown }) => String(standing.allocatedAmount)),
          }) },
        });
      }
      const voided = await tx.reimbursementPayment.updateMany({
        where: { id: paymentId, companyId, reimbursementRequestId: requestId, status: 'RECORDED' },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason, voidedByUserId: actorUserId },
      });
      if (voided.count !== 1) throw new ConflictException({ code: 'reimbursement_payment_changed', message: 'Payment changed before void. Reload and retry.' });
      const payment = await tx.reimbursementPayment.findFirstOrThrow({ where: { id: paymentId, companyId } });

      const reversal = await this.reversePaymentJournalInTx(tx, {
        companyId, paymentId, reversalEntryNumber, actorUserId,
        memo: `[VOID] ${payment.paymentNo ?? paymentId}`,
      });
      // reversed → the settlement JV is backed out (posted); otherwise the
      // payment was never posted, so there is nothing to reverse.
      await tx.reimbursementPayment.update({
        where: { id: paymentId },
        data: { postingStatus: reversal.reversed ? 'reversed' : 'not_required' },
      });

      // Rollup recompute — identical arithmetic to the prior use-case behavior.
      const request = await tx.reimbursementRequest.findFirstOrThrow({ where: { id: requestId, companyId } });
      const newTotal = decStr(d(request.paymentTotalAmount).sub(d(payment.paidAmount)));
      const clampedTotal = d(newTotal).lt(0) ? '0.0000' : newTotal;
      const outstanding = computeOutstanding(dec(request.amount), clampedTotal);
      const paymentStatus = computePaymentStatus(dec(request.amount), clampedTotal);
      const requestStatus = paymentStatus === 'PAID' ? 'PAID' : paymentStatus === 'PARTIALLY_PAID' ? 'PARTIALLY_PAID' : 'READY_FOR_PAYMENT';
      await tx.reimbursementRequest.update({
        where: { id: requestId },
        data: { paymentTotalAmount: clampedTotal, outstandingAmount: outstanding, paymentStatus, status: requestStatus, updatedByUserId: actorUserId },
      });

      if (paymentStatus !== 'PAID') {
        // Take the payout mirror back with the void (MVP payments are full-amount, so a void
        // returns the claim — and therefore its projections — to unpaid in one step).
        const projections = await tx.expenseRecord.findMany({
          where: { companyId, sourceReimbursementRequestId: requestId, status: 'CONFIRMED', paymentStatus: 'PAID' },
          select: { id: true, netPayableAmount: true },
        });
        for (const projection of projections) {
          await tx.expenseRecord.update({
            where: { id: projection.id },
            data: {
              paymentStatus: 'UNPAID',
              paidAmount: '0.0000',
              // FIN-01: reset to the satang outstanding the expense page prints, not the raw
              // 4dp payable of a legacy projection — otherwise the void leaves a residue that
              // can never be settled (mirrors the expense-side reset).
              outstandingAmount: computeOutstanding(dec(projection.netPayableAmount), '0'),
              paymentMethod: null,
              paidAt: null,
              updatedByUserId: actorUserId,
            },
          });
        }
      }

      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: requestId, companyId },
        include: {
          lines: { orderBy: { lineNo: 'asc' } },
          approvalSteps: { orderBy: { sequenceNo: 'asc' } },
          payments: { orderBy: { createdAt: 'asc' } },
          duplicateCandidates: true,
          claimSignatures: { orderBy: { signedAt: 'asc' } },
        },
      });
      if (auditRequestId) {
        await new PrismaAuditRepository(this.prisma).log({ companyId, actorUserId, action: 'reimbursement.payment.void',
          targetType: 'reimbursement_payment', targetId: paymentId, requestId: auditRequestId, result: 'SUCCESS', riskLevel: 'CRITICAL',
          metadataJson: { reason, requestId, reversalEntryId: reversal.reversalEntryId } }, tx);
        // The row and the event the bank screen's own "ยกเลิกการจับคู่" writes, so a match reads the same
        // whoever undid it. The event in the shape of that screen's (`VoidMatchUseCase`), one per match.
        for (const match of bankMatches) {
          await new PrismaAuditRepository(this.prisma).log({ companyId, actorUserId, action: 'bank.match.void',
            targetType: 'bank_reconciliation_match', targetId: match.id, requestId: auditRequestId, result: 'SUCCESS', riskLevel: 'HIGH',
            metadataJson: { statementLineId: match.statementLineId, reason: 'reimbursement_payment_voided', paymentId, requestId } }, tx);
          await tx.outboxEvent.create({ data: { companyId, eventType: 'banking.statement_line.unmatched',
            aggregateType: 'bank_statement_line', aggregateId: match.statementLineId,
            eventKey: `banking.statement_line.unmatched:bank_statement_line:${match.statementLineId}:${match.id}`,
            payloadJson: { companyId, actorUserId, requestId: auditRequestId, aggregateType: 'bank_statement_line', aggregateId: match.statementLineId,
              occurredAt: new Date().toISOString(), data: { matchId: match.id, statementLineId: match.statementLineId } },
            priority: 'NORMAL', status: 'PENDING' } });
        }
        await tx.outboxEvent.create({ data: { companyId, eventType: 'reimbursement.payment_voided',
          aggregateType: 'reimbursement_payment', aggregateId: paymentId, eventKey: `reimbursement.payment_voided:${paymentId}`,
          payloadJson: { companyId, actorUserId, requestId: auditRequestId, aggregateType: 'reimbursement_payment', aggregateId: paymentId,
            occurredAt: new Date().toISOString(), data: { requestId, requestNo: updated.requestNo, requesterUserId: updated.requesterUserId, paymentStatus, reversalEntryId: reversal.reversalEntryId,
              paymentVoidedNotice: reimbursementPaymentVoidedNotice({ status: requestStatus, cancellationPending: !!updated.cancellationPendingAt,
                ...await this.paymentNoticeFacts(tx, companyId, requestId) }) } },
          priority: 'NORMAL', status: 'PENDING' } });
      }
      return { request: this.toRequest(updated), payment: this.toPayment(payment), reversalEntryId: reversal.reversalEntryId };
    }).catch(paymentChangedOnSerializationFailure);
  }

  // GAP-02: recorded-but-unposted settlement payments awaiting a generate call.
  // The AP page posts sources by explicit id (no generic pending-postings list),
  // so this slim worklist lets finance discover which reimbursement payments
  // still need posting.
  // Branch lives on the request, not the payment row, so the scope filter travels through the
  // relation. Same `branchScopeWhere` as listRequests: company-central (null) claims stay visible.
  async listUnpostedReimbursementPayments(companyId: string, scopes: BranchScopes = {}): Promise<Array<{
    paymentId: string;
    reimbursementRequestId: string;
    requestNo?: string;
    requesterDisplayNameSnapshot?: string;
    paymentNo?: string;
    paidAmount: string;
    currency: string;
    paidAt: Date;
    postingStatus: string;
  }>> {
    const rows = await this.prisma.client.reimbursementPayment.findMany({
      where: {
        companyId,
        status: 'RECORDED',
        // A failed attempt (posting_error) still needs posting, and a retry is how it clears.
        postingStatus: { in: ['pending', 'posting_error'] as any },
        request: { is: branchScopeWhere(scopes) },
      },
      orderBy: { paidAt: 'asc' },
      take: CLAIM_PAYOUT_WORKLIST_LIMIT,
      include: { request: { select: { requestNo: true, requesterDisplayNameSnapshot: true } } },
    });
    return rows.map((row: any) => ({
      paymentId: row.id,
      reimbursementRequestId: row.reimbursementRequestId,
      requestNo: opt(row.request?.requestNo),
      requesterDisplayNameSnapshot: opt(row.request?.requesterDisplayNameSnapshot),
      paymentNo: opt(row.paymentNo),
      paidAmount: dec(row.paidAmount),
      currency: row.currency,
      paidAt: row.paidAt,
      postingStatus: row.postingStatus,
    }));
  }

  /**
   * GAP-02 Phase 4: period-close blockers for claim money still off the books.
   * - `unconfirmedClaimExpenses`: approved claim-born expenses whose accrual
   *   cannot post yet (status not CONFIRMED/VOIDED). CONFIRMED-but-unposted is
   *   already counted by the expense posting blocker, so it is excluded here to
   *   avoid double counting.
   * - `pendingPayments` / `paymentErrors`: RECORDED settlement payments whose
   *   posting leg is still pending / errored, by `paidAt` in range.
   */
  async countReimbursementPostingBlockers(
    companyId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<{ unconfirmedClaimExpenses: number; pendingPayments: number; paymentErrors: number }> {
    const client = this.prisma.client as any;
    const paymentWhere = { companyId, paidAt: { gte: fromDate, lt: exclusiveEndOfDay(toDate) }, status: 'RECORDED' as any };
    const [unconfirmedClaimExpenses, pendingPayments, paymentErrors] = await Promise.all([
      client.expenseRecord.count({ where: {
        companyId,
        sourceReimbursementRequestId: { not: null },
        expenseDate: { gte: fromDate, lt: exclusiveEndOfDay(toDate) },
        status: { notIn: ['CONFIRMED', 'VOIDED'] as any },
      } }),
      client.reimbursementPayment.count({ where: { ...paymentWhere, postingStatus: 'pending' as any } }),
      client.reimbursementPayment.count({ where: { ...paymentWhere, postingStatus: 'posting_error' as any } }),
    ]);
    return { unconfirmedClaimExpenses, pendingPayments, paymentErrors };
  }

  // ---- Duplicate candidate ----

  async createDuplicateCandidate(data: {
    companyId: string;
    reimbursementRequestId: string;
    candidateType: string;
    candidateRequestId?: string;
    candidateExpenseId?: string;
    candidateAttachmentId?: string;
    score: number;
    reason?: string;
  }): Promise<ReimbursementDuplicateCandidateRecord> {
    const row = await this.prisma.client.reimbursementDuplicateCandidate.create({
      data: {
        companyId: data.companyId,
        reimbursementRequestId: data.reimbursementRequestId,
        candidateType: data.candidateType as any,
        candidateRequestId: data.candidateRequestId,
        candidateExpenseId: data.candidateExpenseId,
        candidateAttachmentId: data.candidateAttachmentId,
        score: data.score,
        reason: data.reason,
      },
    });
    return this.toDuplicate(row);
  }

  async listClaimDuplicateComparisons(companyId: string, requestId: string): Promise<ReimbursementDuplicateCandidateRecord[]> {
    const rows = await this.prisma.client.reimbursementDuplicateCandidate.findMany({
      where: { companyId, OR: [{ reimbursementRequestId: requestId }, { candidateRequestId: requestId }], status: { in: ['OPEN', 'OVERRIDDEN', 'DISMISSED'] } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(row => this.toDuplicate({ ...row, candidateRequestId: row.reimbursementRequestId === requestId ? row.candidateRequestId : row.reimbursementRequestId }));
  }

  async listOpenDuplicateCandidates(companyId: string, reimbursementRequestId: string): Promise<ReimbursementDuplicateCandidateRecord[]> {
    const rows = await this.prisma.client.reimbursementDuplicateCandidate.findMany({
      where: { companyId, reimbursementRequestId, status: 'OPEN' as any },
    });
    return rows.map((r) => this.toDuplicate(r));
  }

  async resolveDuplicateCandidates(
    companyId: string,
    reimbursementRequestId: string,
    status: 'DISMISSED' | 'CONFIRMED' | 'OVERRIDDEN',
    userId: string,
    reason?: string,
  ): Promise<void> {
    await this.prisma.client.reimbursementDuplicateCandidate.updateMany({
      where: { companyId, reimbursementRequestId, status: 'OPEN' as any },
      data: { status: status as any, resolvedByUserId: userId, resolvedAt: new Date(), reason },
    });
  }

  // ---- Claim-form signatures + signed copies ----

  /**
   * Re-signing replaces the signer's own row — an upsert on the (request, role)
   * unique, never create-then-catch-P2002 (Prisma 7 aborts the transaction).
   *
   * Written under the claim's lock, and only onto the claim its signer was shown: `seen` is the claim
   * the caller checked the signer's role and acknowledgement on. A send-back for the payout account
   * and a return to draft both delete the claim's signatures under this lock, so a signature that
   * passed its checks before either of them committed is refused here instead of landing after it.
   */
  async upsertClaimSignature(data: {
    companyId: string;
    reimbursementRequestId: string;
    role: ReimbursementClaimSignatureRole;
    signatureAttachmentId: string;
    signedByUserId: string;
    signedAt: Date;
    seen: Pick<ReimbursementRequestRecord, 'status' | 'updatedAt' | 'payoutCorrectionRequestedAt' | 'payoutCorrectionSubmittedAt'>;
  }): Promise<ReimbursementClaimSignatureRecord> {
    return (this.prisma.client as any).$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.reimbursementRequestId);
      const claim = await tx.reimbursementRequest.findFirst({
        where: { id: data.reimbursementRequestId, companyId: data.companyId },
        select: { status: true, updatedAt: true, payoutCorrectionRequestedAt: true, payoutCorrectionSubmittedAt: true },
      });
      const at = (value?: Date | null) => value?.getTime() ?? null;
      if (!claim || claim.status !== data.seen.status || at(claim.updatedAt) !== at(data.seen.updatedAt)
        || at(claim.payoutCorrectionRequestedAt) !== at(data.seen.payoutCorrectionRequestedAt)
        || at(claim.payoutCorrectionSubmittedAt) !== at(data.seen.payoutCorrectionSubmittedAt)) {
        throw new ConflictException('stale_claim_snapshot');
      }
      const row = await tx.reimbursementClaimSignature.upsert({
        where: {
          reimbursementRequestId_role: {
            reimbursementRequestId: data.reimbursementRequestId,
            role: data.role as any,
          },
        },
        create: {
          companyId: data.companyId,
          reimbursementRequestId: data.reimbursementRequestId,
          role: data.role as any,
          signatureAttachmentId: data.signatureAttachmentId,
          signedByUserId: data.signedByUserId,
          signedAt: data.signedAt,
        },
        update: {
          signatureAttachmentId: data.signatureAttachmentId,
          signedByUserId: data.signedByUserId,
          signedAt: data.signedAt,
        },
      });
      return this.toClaimSignature(row);
    });
  }

  async listClaimSignatures(companyId: string, requestId: string): Promise<ReimbursementClaimSignatureRecord[]> {
    const rows = await this.prisma.client.reimbursementClaimSignature.findMany({
      where: { companyId, reimbursementRequestId: requestId },
      orderBy: { signedAt: 'asc' },
    });
    return rows.map((row) => this.toClaimSignature(row));
  }

  /** Latest approved reusable signature owned by this signer; used only at sign time. */
  async findLatestActiveSavedSignatureAttachmentId(companyId: string, actorUserId: string): Promise<string | null> {
    const asset = await this.prisma.client.companySignatureAsset.findFirst({
      where: { companyId, submittedByUserId: actorUserId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { originalAttachmentId: true, derivedAttachmentId: true },
    });
    return asset ? (asset.derivedAttachmentId ?? asset.originalAttachmentId) : null;
  }

  /** The signer's own ACTIVE signature image for this claim+role — nobody else's file can be rendered. */
  async findClaimSignatureAttachment(
    companyId: string,
    attachmentId: string,
    actorUserId: string,
    requestId: string,
    role: ReimbursementClaimSignatureRole,
  ): Promise<{ id: string; bucket: string; objectKey: string; objectVersionId?: string; mimeType: string; byteSize: number; checksumSha256: string | null } | null> {
    let row = await this.prisma.client.attachmentObject.findFirst({
      where: {
        id: attachmentId,
        companyId,
        uploadedByUserId: actorUserId,
        status: 'ACTIVE',
        mimeType: { in: ['image/png', 'image/jpeg'] },
        metadataJson: { equals: { generatedFor: 'reimbursement_claim_signature', requestId, role } },
      },
    });
    // Saved company signatures are reusable across claims. The ownership lookup is separate
    // from current ACTIVE status so an already-signed historical form still renders after the
    // asset is archived; signing a new form resolves only ACTIVE assets in the method above.
    if (!row) {
      const ownedAsset = await this.prisma.client.companySignatureAsset.findFirst({
        where: {
          companyId,
          submittedByUserId: actorUserId,
          OR: [{ originalAttachmentId: attachmentId }, { derivedAttachmentId: attachmentId }],
        },
        select: { id: true },
      });
      if (ownedAsset) {
        row = await this.prisma.client.attachmentObject.findFirst({
          where: {
            id: attachmentId,
            companyId,
            uploadedByUserId: actorUserId,
            status: 'ACTIVE',
            mimeType: { in: ['image/png', 'image/jpeg'] },
          },
        });
      }
    }
    return row
      ? { id: row.id, bucket: row.bucket, objectKey: row.objectKey, objectVersionId: row.objectVersionId ?? undefined, mimeType: row.mimeType, byteSize: row.byteSize, checksumSha256: row.checksumSha256 }
      : null;
  }

  /** The PENDING_UPLOAD twin of the above: the complete step must not finish a stranger's intent. */
  async findClaimSignatureUploadAttachment(
    companyId: string,
    attachmentId: string,
    actorUserId: string,
    requestId: string,
    role: ReimbursementClaimSignatureRole,
  ): Promise<{ id: string; status: string; mimeType: string } | null> {
    const row = await this.prisma.client.attachmentObject.findFirst({
      where: {
        id: attachmentId,
        companyId,
        uploadedByUserId: actorUserId,
        mimeType: { in: ['image/png', 'image/jpeg'] },
        metadataJson: { equals: { generatedFor: 'reimbursement_claim_signature', requestId, role } },
      },
      select: { id: true, status: true, mimeType: true },
    });
    return row ?? null;
  }

  /**
   * Uploaded scans of the wet-ink signed form, newest first; `acknowledged` = attached with the A4 declaration,
   * whose maker and time ride along for the "ลงนามบนกระดาษ · แนบเมื่อ … โดย …" line.
   */
  async findAcknowledgedSignedCopyRequestIds(companyId: string, requestIds: string[]): Promise<Set<string>> {
    if (!requestIds.length) return new Set();
    const rows = await this.prisma.client.attachmentLink.findMany({
      where: { companyId, targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE, targetId: { in: requestIds },
        purpose: REIMBURSEMENT_SIGNED_COPY_PURPOSE, attachment: { status: 'ACTIVE' } },
      select: { id: true, targetId: true, attachment: { select: { metadataJson: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const seen = new Map<string, number>();
    return new Set(rows.filter((row) => {
      const count = (seen.get(row.targetId) ?? 0) + 1; seen.set(row.targetId, count);
      const ack = (row.attachment.metadataJson as Record<string, Partial<ReimbursementSignedCopyAck> & { linkId?: unknown; supersededAt?: unknown }> | null)?.[REIMBURSEMENT_SIGNED_COPY_ACK_KEY];
      return count <= 50 && ack?.linkId === row.id && !ack.supersededAt;
    }).map((row) => row.targetId));
  }

  async listSignedClaimFormCopies(companyId: string, requestId: string): Promise<{
    attachmentId: string; fileName: string; uploadedAt: Date; acknowledged: boolean; acknowledgedByUserId?: string; acknowledgedAt?: string;
    beforePayoutCorrection?: true;
  }[]> {
    const rows = await this.prisma.client.attachmentLink.findMany({
      where: {
        companyId,
        targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE,
        targetId: requestId,
        purpose: REIMBURSEMENT_SIGNED_COPY_PURPOSE,
        attachment: { status: 'ACTIVE' },
      },
      select: { id: true, attachmentId: true, createdAt: true, attachment: { select: { originalFileName: true, metadataJson: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => {
      const ack = (row.attachment.metadataJson as Record<string, (Partial<ReimbursementSignedCopyAck> & { linkId?: unknown; supersededAt?: unknown }) | undefined> | null)
        ?.[REIMBURSEMENT_SIGNED_COPY_ACK_KEY];
      const declared = ack?.linkId === row.id;
      // Declared, and then the claim was sent back to have its payout account corrected: the scan shows
      // the account that was in question, so it is kept and no longer counts (payout spec §14.4).
      const acknowledged = declared && !ack?.supersededAt;
      return {
        attachmentId: row.attachmentId,
        fileName: row.attachment.originalFileName,
        uploadedAt: row.createdAt,
        acknowledged,
        // Only the declaration bound to this link: a pre-filled or stale one names nobody.
        ...(acknowledged && { acknowledgedByUserId: ack?.acknowledgedByUserId, acknowledgedAt: ack?.acknowledgedAt }),
        ...(declared && !acknowledged && { beforePayoutCorrection: true as const }),
      };
    });
  }

  /**
   * Link write mirroring LinkAttachmentUseCase semantics; the caller asserts the attachment is ACTIVE and audits.
   * An A4 acknowledgement is merged into the scan's metadata under its link id, in the same transaction.
   */
  async linkSignedClaimFormCopy(
    companyId: string,
    requestId: string,
    attachmentId: string,
    linkedByUserId: string,
    ack?: ReimbursementSignedCopyAck,
  ): Promise<void> {
    const client = this.prisma.client as any;
    await client.$transaction(async (tx: any) => {
      if (ack) {
        // A declaration says the scan is the claim's signed form as the claim stands. Under the claim's
        // lock (taken first, as a payment takes it before a file's), so one made while the claim is
        // sent back for its payout account is refused, and one that commits just before the send-back
        // is set aside by it. A scan without the declaration is only filed, as before.
        await this.lockRequest(tx, companyId, requestId);
        const claim = await tx.reimbursementRequest.findFirst({
          where: { id: requestId, companyId }, select: { status: true, payoutCorrectionRequestedAt: true, payoutCorrectionSubmittedAt: true },
        });
        if (claim && payoutCorrectionPhase(claim)) throw new ConflictException('payout_correction_in_progress');
      }
      // The key a slip link and a delete of this file take, so the check below sees whichever of
      // them committed first: a payment slip never becomes a signed copy (owner 2026-10-01).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${attachmentId}:attachment-retention`}))`;
      const conflict = await findAttachmentLinkConflict(tx, {
        companyId, attachmentId, targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE,
      });
      if (conflict) throw new UnprocessableEntityException(conflict);
      // The other order: a payment that started before this commit reads the file under its older
      // snapshot and would not see the link written here. Writing the file's row makes that payment
      // fail on its own row lock and retry, instead of putting a slip link beside this copy.
      await tx.$executeRaw`UPDATE "AttachmentObject" SET "updatedAt" = now() WHERE "id" = ${attachmentId} AND "companyId" = ${companyId}`;
      const link = await tx.attachmentLink.upsert({
        where: {
          attachmentId_targetType_targetId_purpose: {
            attachmentId,
            targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE,
            targetId: requestId,
            purpose: REIMBURSEMENT_SIGNED_COPY_PURPOSE,
          },
        },
        create: {
          companyId,
          attachmentId,
          targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE,
          targetId: requestId,
          purpose: REIMBURSEMENT_SIGNED_COPY_PURPOSE,
          linkedByUserId,
        },
        update: {},
        select: { id: true },
      });
      if (!ack) return;
      const { metadataJson } = await tx.attachmentObject.findFirstOrThrow({
        where: { id: attachmentId, companyId },
        select: { metadataJson: true },
      });
      await tx.attachmentObject.update({
        where: { id: attachmentId },
        data: { metadataJson: { ...metadataJson, [REIMBURSEMENT_SIGNED_COPY_ACK_KEY]: { ...ack, linkId: link.id } } },
      });
    });
  }

  // ---- Mappers ----

  private actionOwnerWhere(owner: ReimbursementDraftActionOwner) {
    return {
      actorUserId: owner.actorUserId,
      membershipId: owner.membershipId,
      channel: owner.channel,
      channelKind: owner.channelKind,
      messagingChannelId: owner.messagingChannelId,
      chatKeyHash: owner.chatKeyHash,
      ownerEpoch: owner.ownerEpoch,
    };
  }

  private actionOwnerMatches(row: any, owner: ReimbursementDraftActionOwner): boolean {
    return row.companyId === owner.companyId && Object.entries(this.actionOwnerWhere(owner)).every(([key, value]) => row[key] === value);
  }

  private async draftActionOwnerCurrent(
    tx: any,
    owner: ReimbursementDraftActionOwner,
    sharedMessagingChannelId: string | undefined,
    allowOptOut: boolean,
  ): Promise<boolean> {
    const channelCurrent = owner.messagingChannelId === sharedMessagingChannelId || Boolean(await tx.lineChannelBinding.findFirst({
      where: { companyId: owner.companyId, messagingChannelId: owner.messagingChannelId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      select: { id: true },
    }));
    if (!channelCurrent) return false;
    const member = await tx.companyMembership.findFirst({
      where: {
        id: owner.membershipId, companyId: owner.companyId, userId: owner.actorUserId, status: 'ACTIVE',
        user: { status: 'ACTIVE', ...(!allowOptOut ? { aiAssistantOptOutAt: null } : {}) }, company: { status: 'ACTIVE' },
      }, select: { id: true },
    });
    if (!member) return false;
    return Boolean(await tx.aiConversation.findFirst({ where: {
      companyId: owner.companyId, userId: owner.actorUserId, membershipId: owner.membershipId,
      channel: owner.channel, channelKind: owner.channelKind, messagingChannelId: owner.messagingChannelId,
      chatKeyHash: owner.chatKeyHash, lifecycleEpoch: owner.ownerEpoch,
    }, select: { id: true } }));
  }

  private async lockDraftAction(tx: any, actionId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reimbursement-draft-action:${actionId}`}))`;
    await tx.$queryRaw`SELECT "id" FROM "ReimbursementDraftAction" WHERE "id" = ${actionId}::uuid FOR UPDATE`;
  }

  private async transactionTime(tx: any): Promise<Date> {
    const [row] = await tx.$queryRaw<Array<{ currentTime: Date }>>`SELECT CURRENT_TIMESTAMP AS "currentTime"`;
    if (!row?.currentTime) throw new Error('reimbursement_database_time_unavailable');
    return row.currentTime;
  }

  private parseDraftPreparedCommand(value: unknown): ReimbursementDraftPreparedCommand | null {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > 128 * 1024) return null;
    const command = value as Partial<ReimbursementDraftPreparedCommand>;
    const string = (candidate: unknown, max = 1_000) => typeof candidate === 'string' && candidate.length <= max;
    if (command.schemaVersion !== 1 || !['CREATE', 'UPDATE'].includes(String(command.operation))
      || !string(command.requesterUserId, 200) || !string(command.requesterDisplayNameSnapshot, 500)
      || !string(command.branchId, 200) || !string(command.reason, 1_000) || !command.reason!.trim()
      || !string(command.currency, 3) || !command.header || typeof command.header !== 'object'
      || !string(command.header.amount, 32) || !string(command.header.categoryKey, 80)
      || !string(command.header.incurredDate, 40) || !Number.isFinite(Date.parse(command.header.incurredDate!))
      || !Array.isArray(command.lines) || command.lines.length < 1 || command.lines.length > 50
      || !command.policyProof || typeof command.policyProof !== 'object'
      || !string(command.policyProof.currency, 3) || typeof command.policyProof.requireReceipt !== 'boolean'
      || typeof command.policyProof.allowMissingReceiptWithReason !== 'boolean'
      || typeof command.invalidateSignatures !== 'boolean'
      || !['REQUIRED', 'ATTACHED', 'MISSING_WITH_REASON', 'WAIVED_BY_POLICY'].includes(String(command.receiptRequirementStatus))) return null;
    if (command.title !== undefined && !string(command.title, 200)
      || command.missingReceiptReason !== undefined && !string(command.missingReceiptReason, 500)
      || command.header.categoryLabelSnapshot !== undefined && !string(command.header.categoryLabelSnapshot, 160)) return null;
    if (command.operation === 'CREATE' && (command.requestId !== undefined || command.expectedRequestUpdatedAt !== undefined)) return null;
    if (command.operation === 'UPDATE' && (!string(command.requestId, 200) || !string(command.expectedRequestUpdatedAt, 40)
      || !Number.isFinite(Date.parse(command.expectedRequestUpdatedAt!)))) return null;
    for (const [index, line] of command.lines.entries()) {
      if (!line || typeof line !== 'object' || line.lineNo !== index + 1 || !string(line.incurredDate, 40)
        || !Number.isFinite(Date.parse(line.incurredDate)) || !string(line.description, 500) || !line.description.trim()
        || !string(line.categoryKey, 80) || !line.categoryKey || !string(line.amount, 32)
        || !/^\d{1,14}(?:\.\d{1,4})?$/.test(line.amount)
        || line.purpose != null && !string(line.purpose, 500)
        || line.categoryLabelSnapshot != null && !string(line.categoryLabelSnapshot, 160)
        || line.attachmentId != null && !string(line.attachmentId, 64)
        || line.linkedExpenseId != null && !string(line.linkedExpenseId, 64)) return null;
    }
    return command as ReimbursementDraftPreparedCommand;
  }

  private toDraftAction(row: any): ReimbursementDraftActionRecord {
    return {
      id: row.id, companyId: row.companyId, actorUserId: row.actorUserId, membershipId: row.membershipId,
      channel: row.channel, channelKind: row.channelKind, messagingChannelId: row.messagingChannelId,
      chatKeyHash: row.chatKeyHash, ownerEpoch: row.ownerEpoch, taskId: row.taskId, actionOrdinal: row.actionOrdinal,
      intentKeyHash: row.intentKeyHash, operation: row.operation, status: row.status, previewRevision: row.previewRevision,
      requestId: opt(row.requestId), expectedRequestUpdatedAt: opt(row.expectedRequestUpdatedAt),
      commandJson: opt(row.commandJson), previewJson: opt(row.previewJson), sourceProofJson: opt(row.sourceProofJson),
      confirmationDigest: opt(row.confirmationDigest), resultJson: opt(row.resultJson),
      appliedRequestUpdatedAt: opt(row.appliedRequestUpdatedAt), previewDeliveryId: opt(row.previewDeliveryId),
      expiresAt: row.expiresAt, appliedAt: opt(row.appliedAt), createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private toPolicy(row: any): ReimbursementPolicyRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      branchId: opt(row.branchId),
      currency: row.currency,
      approvalThresholdAmount: dec(row.approvalThresholdAmount),
      approvalRequiredFromAmount: dec(row.approvalRequiredFromAmount),
      approverMode: row.approverMode,
      defaultApproverUserId: opt(row.defaultApproverUserId),
      defaultApproverRole: opt(row.defaultApproverRole),
      // A row saved before roles became a list (or by seed) still routes to its single role.
      defaultApproverRoles: row.defaultApproverRoles?.length
        ? row.defaultApproverRoles
        : row.defaultApproverRole ? [row.defaultApproverRole] : [],
      allowSelfApproval: row.allowSelfApproval,
      requireReceipt: row.requireReceipt,
      allowMissingReceiptWithReason: row.allowMissingReceiptWithReason,
      duplicatePolicy: row.duplicatePolicy,
      financeReviewRequired: row.financeReviewRequired,
      slaHours: opt(row.slaHours),
      status: row.status,
      createdByUserId: row.createdByUserId,
      updatedByUserId: opt(row.updatedByUserId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toRequest(row: any): ReimbursementRequestRecord {
    return {
      ...(row._count?.sourceExpenses > 0 && !['CANCELLED', 'VOIDED'].includes(row.status) ? { hasVoidedProjections: true as const } : {}),
      id: row.id,
      companyId: row.companyId,
      branchId: opt(row.branchId),
      requestNo: opt(row.requestNo),
      requesterUserId: row.requesterUserId,
      requesterDisplayNameSnapshot: row.requesterDisplayNameSnapshot,
      title: opt(row.title),
      reason: row.reason,
      categoryKey: row.categoryKey,
      categoryLabelSnapshot: opt(row.categoryLabelSnapshot),
      amount: dec(row.amount),
      currency: row.currency,
      incurredDate: row.incurredDate,
      submittedAt: opt(row.submittedAt),
      submittedByUserId: opt(row.submittedByUserId),
      currentApproverUserId: opt(row.currentApproverUserId),
      currentApprovalStepId: opt(row.currentApprovalStepId),
      approvedAt: opt(row.approvedAt),
      rejectedAt: opt(row.rejectedAt),
      rejectionReason: opt(row.rejectionReason),
      cancelledAt: opt(row.cancelledAt),
      cancellationPendingAt: opt(row.cancellationPendingAt),
      cancellationPendingByUserId: opt(row.cancellationPendingByUserId),
      cancellationPendingReason: opt(row.cancellationPendingReason),
      cancellationCertificateAttestedAt: opt(row.cancellationCertificateAttestedAt),
      financeReviewStatus: row.financeReviewStatus,
      financeReviewedByUserId: opt(row.financeReviewedByUserId),
      financeReviewedAt: opt(row.financeReviewedAt),
      financeReviewNote: opt(row.financeReviewNote),
      status: row.status,
      paymentStatus: row.paymentStatus,
      duplicateStatus: row.duplicateStatus,
      receiptRequirementStatus: row.receiptRequirementStatus,
      postingStatus: row.postingStatus,
      linkedExpenseId: opt(row.linkedExpenseId),
      primaryAttachmentId: opt(row.primaryAttachmentId),
      missingReceiptReason: opt(row.missingReceiptReason),
      approvalSnapshotHash: opt(row.approvalSnapshotHash),
      approvalPolicySnapshotJson: opt(row.approvalPolicySnapshotJson),
      payoutMethod: opt(row.payoutMethod),
      payoutDestinationVersion: opt(row.payoutDestinationVersion),
      payoutFingerprint: opt(row.payoutFingerprint),
      payoutCorrectionRequestedAt: opt(row.payoutCorrectionRequestedAt),
      payoutCorrectionRequestedByUserId: opt(row.payoutCorrectionRequestedByUserId),
      payoutCorrectionReasonCode: opt(row.payoutCorrectionReasonCode),
      payoutCorrectionNote: opt(row.payoutCorrectionNote),
      payoutCorrectionSubmittedAt: opt(row.payoutCorrectionSubmittedAt),
      payoutCorrectionLog: Array.isArray(row.payoutCorrectionLogJson) ? row.payoutCorrectionLogJson : undefined,
      paymentTotalAmount: dec(row.paymentTotalAmount),
      outstandingAmount: dec(row.outstandingAmount),
      idempotencyKey: opt(row.idempotencyKey),
      createdByUserId: row.createdByUserId,
      updatedByUserId: opt(row.updatedByUserId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lineCount: row._count?.lines ?? row.lines?.length ?? 0,
      lines: row.lines ? row.lines.map((l: any) => this.toLine(l)) : undefined,
      approvalSteps: row.approvalSteps ? row.approvalSteps.map((s: any) => this.toStep(s)) : undefined,
      payments: row.payments ? row.payments.map((p: any) => this.toPayment(p)) : undefined,
      possibleDuplicateExpenseCount: row.sourceExpenses?.filter((expense: any) => expense.duplicateStatus === 'POSSIBLE_DUPLICATE').length ?? 0,
      duplicateConfirmationPendingCount: row.sourceExpenses?.filter((expense: any) => expense.duplicateStatus === 'OVERRIDDEN' && expense.status === 'READY_FOR_CONFIRMATION').length ?? 0,
      confirmedDuplicateExpenseCount: row.sourceExpenses?.filter((expense: any) => expense.duplicateStatus === 'CONFIRMED_DUPLICATE').length ?? 0,
      duplicateCandidates: row.duplicateCandidates ? row.duplicateCandidates.map((d: any) => this.toDuplicate(d)) : undefined,
      claimSignatures: row.claimSignatures ? row.claimSignatures.map((s: any) => this.toClaimSignature(s)) : undefined,
    };
  }

  private toLine(row: any): ReimbursementLineRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      reimbursementRequestId: row.reimbursementRequestId,
      lineNo: row.lineNo,
      incurredDate: row.incurredDate,
      description: row.description,
      purpose: opt(row.purpose),
      categoryKey: row.categoryKey,
      categoryLabelSnapshot: opt(row.categoryLabelSnapshot),
      amount: dec(row.amount),
      attachmentId: opt(row.attachmentId),
      linkedExpenseId: opt(row.linkedExpenseId),
      sourceExpenseSnapshot: row.sourceExpenseSnapshotJson ?? undefined,
      attachmentSnapshot: row.attachmentSnapshotJson ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toStep(row: any): ReimbursementApprovalStepRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      reimbursementRequestId: row.reimbursementRequestId,
      sequenceNo: row.sequenceNo,
      approverUserId: opt(row.approverUserId),
      approverRoleSnapshot: opt(row.approverRoleSnapshot),
      assignedApproverUserIds: stringArrayOpt(row.assignedApproverUserIdsJson),
      status: row.status,
      assignedAt: row.assignedAt,
      decidedAt: opt(row.decidedAt),
      decisionByUserId: opt(row.decisionByUserId),
      comment: opt(row.comment),
      rejectionReason: opt(row.rejectionReason),
      requestSnapshotHash: row.requestSnapshotHash,
      invalidatedAt: opt(row.invalidatedAt),
      invalidatedReason: opt(row.invalidatedReason),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toPayment(row: any): ReimbursementPaymentRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      reimbursementRequestId: row.reimbursementRequestId,
      idempotencyKey: row.idempotencyKey,
      paymentNo: opt(row.paymentNo),
      paidAmount: dec(row.paidAmount),
      currency: row.currency,
      paymentMethod: row.paymentMethod,
      paidAt: row.paidAt,
      paymentReference: opt(row.paymentReference),
      bankAccountId: opt(row.bankAccountId),
      slipAttachmentId: opt(row.slipAttachmentId),
      slipChecksumSha256: opt(row.slipChecksumSha256),
      payoutDestinationVersion: opt(row.payoutDestinationVersion),
      payoutConfirmedAt: opt(row.payoutConfirmedAt),
      methodMismatchReason: opt(row.methodMismatchReason),
      sourcePaymentRef: row.sourcePaymentRef,
      status: row.status,
      voidedAt: opt(row.voidedAt),
      voidReason: opt(row.voidReason),
      paidByUserId: row.paidByUserId,
      voidedByUserId: opt(row.voidedByUserId),
      postingStatus: row.postingStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toClaimSignature(row: any): ReimbursementClaimSignatureRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      reimbursementRequestId: row.reimbursementRequestId,
      role: row.role,
      signatureAttachmentId: row.signatureAttachmentId,
      signedByUserId: row.signedByUserId,
      signedAt: row.signedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toDuplicate(row: any): ReimbursementDuplicateCandidateRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      reimbursementRequestId: row.reimbursementRequestId,
      candidateType: row.candidateType,
      candidateRequestId: opt(row.candidateRequestId),
      candidateExpenseId: opt(row.candidateExpenseId),
      candidateAttachmentId: opt(row.candidateAttachmentId),
      score: row.score,
      status: row.status,
      reason: opt(row.reason),
      resolvedByUserId: opt(row.resolvedByUserId),
      resolvedAt: opt(row.resolvedAt),
      createdAt: row.createdAt,
    };
  }
}
