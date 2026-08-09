import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ReimbursementClaimSignatureRole, ReimbursementRequestStatus } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import type { ReservedDocumentNumberRecord } from '../../data-model-core/domain/models/document-sequence.model';
import { branchScopeWhere, isBranchInScope, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';
import { expenseRelatedToUserWhere } from '../../expenses/infrastructure/prisma-expense.repository';
import { buildReversalLines } from '../../ledger/domain/logic/journal-balance.logic';
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
} from '../domain/models/reimbursement.model';
import {
  REIMBURSEMENT_ATTACHMENT_TARGET_TYPE,
  REIMBURSEMENT_SIGNED_COPY_PURPOSE,
} from '../domain/reimbursement.constants';
import { effectivePolicy } from '../domain/reimbursement.constants';
import {
  buildPaymentSourceRef,
  computeSnapshotHash,
  computeOutstanding,
  computePaymentStatus,
  d,
  decStr,
  isExactLegacyV1FallbackSnapshot,
  isSelfApproval,
  matchesApproverRole,
  validatePaymentRecording,
} from '../domain/logic/reimbursement.logic';
import { exclusiveEndOfDay } from '@watchdog-bms/contracts';

function dec(v: unknown): string {
  return v != null ? String(v) : '0';
}
function opt<T>(v: T | null | undefined): T | undefined {
  return v == null ? undefined : v;
}

export type ListRequestsWhere = {
  companyId: string;
  requesterUserId?: string;
  relatedUserId?: string;
  scopes?: { branchIds?: string[] };
  status?: string;
  paymentStatus?: string;
  statuses?: string[];
};

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

@Injectable()
export class PrismaReimbursementRepository {
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
  async findActiveApproverUserIds(companyId: string, userIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(userIds.filter((id) => !!id))];
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.client.companyMembership.findMany({
      where: {
        companyId,
        userId: { in: ids },
        status: 'ACTIVE',
        // A suspended or disabled login cannot approve even while the membership row still says
        // ACTIVE — both have to hold for the assignment to still mean something.
        user: { status: 'ACTIVE' },
      },
      select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
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

  // ---- Policy ----

  async findPolicy(companyId: string, branchId?: string | null): Promise<ReimbursementPolicyRecord | null> {
    const row = await this.prisma.client.reimbursementPolicy.findFirst({
      where: { companyId, branchId: branchId ?? null },
    });
    return row ? this.toPolicy(row) : null;
  }

  async upsertPolicy(
    companyId: string,
    branchId: string | null,
    data: Record<string, unknown>,
    userId: string,
  ): Promise<ReimbursementPolicyRecord> {
    const existing = await this.prisma.client.reimbursementPolicy.findFirst({ where: { companyId, branchId } });
    if (existing) {
      const row = await this.prisma.client.reimbursementPolicy.update({
        where: { id: existing.id },
        data: { ...data, updatedByUserId: userId },
      });
      return this.toPolicy(row);
    }
    const row = await this.prisma.client.reimbursementPolicy.create({
      data: { companyId, branchId, ...data, createdByUserId: userId },
    });
    return this.toPolicy(row);
  }

  // ---- Request ----

  async createRequest(data: CreateReimbursementRequestData): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    const row = await client.$transaction(async (tx: any) => {
      const created = await tx.reimbursementRequest.create({
        data: {
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
      return created;
    });
    return (await this.findRequestById(data.companyId, row.id))!;
  }

  /**
   * Wholesale line replacement, mirroring the expense-line convention: advisory
   * lock on the claim, drop the lines the caller no longer sends, upsert the
   * rest on the (requestId, lineNo) unique — never create-then-catch-P2002
   * inside a transaction (Prisma 7 aborts it, 25P02).
   */
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
  ): Promise<ReimbursementRequestRecord> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, companyId, requestId);
      const changed = await tx.reimbursementRequest.updateMany({
        where: { id: requestId, companyId, status: 'DRAFT', updatedAt: expectedUpdatedAt },
        data: { ...data, updatedAt: this.nextVersion(expectedUpdatedAt) },
      });
      if (changed.count !== 1) throw this.draftChanged();
      if (lines) await this.replaceLines(tx, companyId, requestId, lines);
      const row = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: requestId, companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      return this.toRequest(row);
    });
  }

  async submitDraftAtomic(data: {
    companyId: string;
    requestId: string;
    expectedUpdatedAt: Date;
    approvalStep: {
      sequenceNo: number;
      approverUserId?: string;
      approverRoleSnapshot?: string;
      requestSnapshotHash: string;
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
  }): Promise<{
    step: ReimbursementApprovalStepRecord;
    documentNumber: ReservedDocumentNumberRecord;
    documentNumberReused: boolean;
    supersededDuplicateCandidateCount: number;
    supersededApprovalStepCount: number;
  }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await this.lockRequest(tx, data.companyId, data.requestId);
      await this.lockEvidence(tx, data.companyId, data.evidence);
      await this.assertEvidenceAvailable(tx, data.companyId, data.requestId, data.evidence);

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
      const step = await tx.reimbursementApprovalStep.create({
        data: {
          companyId: data.companyId,
          reimbursementRequestId: data.requestId,
          ...data.approvalStep,
        },
      });
      const changed = await tx.reimbursementRequest.updateMany({
        where: {
          id: data.requestId,
          companyId: data.companyId,
          status: 'DRAFT',
          updatedAt: data.expectedUpdatedAt,
        },
        data: {
          ...data.request,
          requestNo: reserved.documentNumber,
          currentApprovalStepId: step.id,
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
      return {
        step: this.toStep(step),
        documentNumber,
        documentNumberReused,
        supersededDuplicateCandidateCount: supersededCandidates.count,
        supersededApprovalStepCount: supersededApprovalSteps.count,
      };
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
    onIntentPersisted: (tx: any) => Promise<void>;
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
        if (request.cancellationPendingByUserId !== data.actorUserId
          || request.cancellationPendingReason !== data.reason) {
          throw new ConflictException('reimbursement_cancellation_already_pending');
        }
        return { request, resumed: true };
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
      if (!request.cancellationPendingAt || request.cancellationPendingByUserId !== data.actorUserId) {
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
          cancellationPendingByUserId: data.actorUserId,
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: data.completedAt,
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

  async listPendingCancellationIntents(limit = 100): Promise<Array<{
    request: ReimbursementRequestRecord;
    actorUserId: string;
    reason: string;
  }>> {
    const rows = await (this.prisma.client as any).reimbursementRequest.findMany({
      where: { cancellationPendingAt: { not: null }, status: { notIn: ['CANCELLED', 'VOIDED'] } },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: { cancellationPendingAt: 'asc' },
      take: limit,
    });
    return rows.flatMap((row: any) => row.cancellationPendingByUserId && row.cancellationPendingReason
      ? [{ request: this.toRequest(row), actorUserId: row.cancellationPendingByUserId, reason: row.cancellationPendingReason }]
      : []);
  }

  private async lockRequest(tx: any, companyId: string, requestId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${requestId}:reimbursement-request`}))`;
  }

  private assertDecisionBranch(
    branchId: string | null | undefined,
    scopes: { branchIds?: string[] },
    systemReconcile = false,
    expectedBranchId?: string,
  ): void {
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
    step: { approverUserId?: string | null; approverRoleSnapshot?: string | null },
    actorUserId: string,
    actorRoles: string[],
  ): Promise<void> {
    // Audit H-20: a step naming a person used to be exact-match forever, so disabling that member
    // froze the request with no reassign route and no OWNER fallback. The assignment now only binds
    // while the person can still act for this company; after that the step falls back to the role
    // it was ALSO recorded with, which is the routing it would have had without a name on it.
    //
    // Read through `tx`: the eligibility decision and the status update it guards have to see the
    // same snapshot, or a member disabled mid-transaction could still be treated as assigned.
    if (step.approverUserId && await this.canActAsApprover(tx, companyId, step.approverUserId)) {
      if (step.approverUserId !== actorUserId) throw new ForbiddenException('not_assigned_approver');
      return;
    }
    // Same predicate as the use-case gate: a role-routed step is approvable by that role or by the
    // OWNER; only a step naming a specific person who can still act stays exact-match.
    if (!matchesApproverRole(step.approverRoleSnapshot, actorRoles)) {
      throw new ForbiddenException('not_eligible_approver_role');
    }
  }

  /** Membership-level, not user-level: an ACTIVE person removed from THIS company cannot approve. */
  private async canActAsApprover(tx: any, companyId: string, userId: string): Promise<boolean> {
    const membership = await tx.companyMembership.findFirst({
      where: { companyId, userId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      select: { id: true },
    });
    return Boolean(membership);
  }

  private async lockEvidence(
    tx: any,
    companyId: string,
    evidence: { attachmentIds: string[]; expenseIds: string[] },
  ): Promise<void> {
    const keys = [
      ...evidence.attachmentIds.map((id) => `attachment:${id}`),
      ...evidence.expenseIds.map((id) => `expense:${id}`),
    ].filter((key, index, all) => all.indexOf(key) === index).sort();
    for (const key of keys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:reimbursement-evidence:${key}`}))`;
    }
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

  private nextVersion(observed: Date): Date {
    return new Date(Math.max(Date.now(), observed.getTime() + 1));
  }

  private assertApprovalSnapshot(
    request: ReimbursementRequestRecord,
    expectedApprovalSnapshotHash?: string,
  ): string {
    const storedHash = request.approvalSnapshotHash;
    if (!storedHash || !request.lines?.length) throw new ConflictException('stale_approval_snapshot');
    const liveHash = computeSnapshotHash({
      amount: request.amount,
      currency: request.currency,
      categoryKey: request.categoryKey,
      incurredDate: request.incurredDate.toISOString(),
      reason: request.reason,
      primaryAttachmentId: request.primaryAttachmentId,
      lines: request.lines,
    });
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
    if (expectedApprovalSnapshotHash && expectedApprovalSnapshotHash !== storedHash) {
      throw new ConflictException('stale_approval_snapshot');
    }
    return storedHash;
  }

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
      if (row.status !== 'PENDING_APPROVAL') {
        throw new UnprocessableEntityException(`Cannot approve from status ${row.status}`);
      }
      if (row.cancellationPendingAt) {
        throw new ConflictException('reimbursement_cancellation_pending');
      }
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        throw new ConflictException('stale_approval_snapshot');
      }

      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes);
      if (isSelfApproval(request.requesterUserId, data.actorUserId, data.allowSelfApproval, data.actorRoles)) {
        throw new ForbiddenException('self_approval_denied');
      }
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
      await this.assertApproverEligibility(tx, data.companyId, step, data.actorUserId, data.actorRoles);

      if (step.status === 'APPROVED') {
        if (data.financeReviewRequired
          || step.decisionByUserId !== data.actorUserId
          || step.decidedAt == null) {
          throw new ConflictException('stale_approval_snapshot');
        }
        return { request, resumed: true, approvalStepId: step.id };
      }
      if (step.status !== 'PENDING') throw new ConflictException('stale_approval_snapshot');

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
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Reimbursement request not found');
      if (row.status !== 'FINANCE_REVIEW') {
        throw new UnprocessableEntityException(`Cannot finance-review from status ${row.status}`);
      }
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        throw new ConflictException('stale_finance_review_snapshot');
      }
      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes);
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
        await tx.reimbursementDuplicateCandidate.updateMany({
          where: { companyId: data.companyId, reimbursementRequestId: data.requestId, status: 'OPEN' },
          data: {
            status: 'OVERRIDDEN',
            resolvedByUserId: data.actorUserId,
            resolvedAt: data.reviewedAt,
            reason: data.duplicateResolutionReason,
          },
        });
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
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        throw new ConflictException('stale_finance_review_snapshot');
      }
      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes);
      if (request.financeReviewStatus === 'APPROVED_FOR_PAYMENT') {
        throw new ConflictException('finance_approval_already_decided');
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
          financeReviewStatus: data.decision,
          financeReviewedByUserId: data.actorUserId,
          financeReviewedAt: data.reviewedAt,
          financeReviewNote: data.note,
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
      return this.toRequest(updated);
    });
  }

  /** Idempotently creates one exact claim projection per source line. */
  async prepareClaimProjections(data: {
    companyId: string;
    requestId: string;
    decisionKind: 'MANAGER' | 'FINANCE';
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
      } else if (request.status !== 'FINANCE_REVIEW'
        || request.financeReviewStatus !== 'APPROVED_FOR_PAYMENT'
        || request.financeReviewedByUserId !== data.decisionActorUserId) {
        throw new ConflictException('reimbursement_projection_decision_changed');
      }

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
            sourceChannelMetadataJson: item.sourceChannelMetadataJson,
            vendorNameSnapshot: item.vendorNameSnapshot,
            note: item.description,
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
        await tx.expenseLine.create({
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
        await tx.reimbursementLine.updateMany({
          where: {
            id: line.id,
            companyId: data.companyId,
            reimbursementRequestId: data.requestId,
            linkedExpenseId: null,
          },
          data: { linkedExpenseId: expense.id },
        });
        results.push({ reimbursementLineId: line.id, expenseId: expense.id, created: true });
      }
      return results;
    });
  }

  async listClaimProjections(
    companyId: string,
    requestId: string,
  ): Promise<Array<{ id: string; sourceReimbursementLineId: string; status: string; duplicateStatus: string; postingStatus: string; branchId?: string }>> {
    const rows = await (this.prisma.client as any).expenseRecord.findMany({
      where: { companyId, sourceReimbursementRequestId: requestId, sourceReimbursementLineId: { not: null } },
    });
    return rows.map((row: any) => ({
      id: row.id,
      sourceReimbursementLineId: row.sourceReimbursementLineId,
      status: row.status,
      duplicateStatus: row.duplicateStatus,
      postingStatus: row.postingStatus,
      branchId: opt(row.branchId),
    }));
  }

  async listPendingProjectionIntents(limit = 100): Promise<Array<{
    request: ReimbursementRequestRecord;
    kind: 'MANAGER' | 'FINANCE';
    actorUserId: string;
    approvalStepId?: string;
  }>> {
    const [managerRows, financeRows] = await Promise.all([
      (this.prisma.client as any).reimbursementRequest.findMany({
        where: { status: 'PENDING_APPROVAL', currentApprovalStepId: { not: null }, cancellationPendingAt: null },
        include: {
          lines: { orderBy: { lineNo: 'asc' } },
          approvalSteps: { where: { status: 'APPROVED' } },
        },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      }),
      (this.prisma.client as any).reimbursementRequest.findMany({
        where: {
          status: 'FINANCE_REVIEW',
          financeReviewStatus: 'APPROVED_FOR_PAYMENT',
          financeReviewedByUserId: { not: null },
          cancellationPendingAt: null,
        },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      }),
    ]);
    const intents: Array<{
      request: ReimbursementRequestRecord;
      kind: 'MANAGER' | 'FINANCE';
      actorUserId: string;
      approvalStepId?: string;
    }> = [];
    for (const row of managerRows) {
      const request = this.toRequest(row);
      const step = request.approvalSteps?.find((candidate) => candidate.id === request.currentApprovalStepId);
      if (step?.status === 'APPROVED' && step.decisionByUserId) {
        intents.push({ request, kind: 'MANAGER', actorUserId: step.decisionByUserId, approvalStepId: step.id });
      }
    }
    for (const row of financeRows) {
      const request = this.toRequest(row);
      if (request.financeReviewedByUserId) {
        intents.push({ request, kind: 'FINANCE', actorUserId: request.financeReviewedByUserId });
      }
    }
    return intents.sort((a, b) => a.request.updatedAt.getTime() - b.request.updatedAt.getTime()).slice(0, limit);
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
        sourceReimbursementLineId: { in: lines.map((line) => line.id) },
      },
    });
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
      if (row.status !== 'PENDING_APPROVAL') {
        throw new UnprocessableEntityException(`Cannot reject from status ${row.status}`);
      }
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        throw new ConflictException('stale_approval_snapshot');
      }

      const request = this.toRequest(row);
      this.assertDecisionBranch(request.branchId, data.scopes);
      if (isSelfApproval(request.requesterUserId, data.actorUserId, data.allowSelfApproval, data.actorRoles)) {
        throw new ForbiddenException('self_approval_denied');
      }
      if (request.currentApproverUserId && request.currentApproverUserId !== data.actorUserId) {
        throw new ForbiddenException('not_assigned_approver');
      }
      if (!request.currentApprovalStepId) throw new ConflictException('stale_approval_snapshot');
      const step = await tx.reimbursementApprovalStep.findFirst({
        where: {
          id: request.currentApprovalStepId,
          companyId: data.companyId,
          reimbursementRequestId: data.requestId,
        },
      });
      if (!step) throw new ConflictException('stale_approval_snapshot');
      await this.assertApproverEligibility(tx, data.companyId, step, data.actorUserId, data.actorRoles);
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

  private async materializeClaimLineExpensesInTransaction(
    tx: any,
    companyId: string,
    requestId: string,
    actorUserId: string,
    items: MaterializeClaimExpenseItem[],
  ): Promise<{ reimbursementLineId: string; expenseId: string }[]> {
    const results: { reimbursementLineId: string; expenseId: string }[] = [];
    for (const item of items) {
        const expense = await tx.expenseRecord.create({
          data: {
            companyId,
            branchId: item.branchId ?? null,
            sourceReimbursementRequestId: requestId,
            status: item.status,
            captureSource: item.captureSource,
            expenseDate: item.expenseDate,
            currency: item.currency,
            vatMode: item.vatMode,
            inputVatClaimStatus: item.inputVatClaimStatus,
            vendorNameSnapshot: item.vendorNameSnapshot,
            note: item.description,
            primaryAttachmentId: item.attachmentId ?? null,
            missingReceiptReason: item.missingReceiptReason ?? null,
            createdByUserId: actorUserId,
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
        await tx.expenseLine.create({
          data: {
            companyId,
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
          // Relink the receipt to the new expense; a pre-existing identical link
          // (retry) is harmless to ignore via the unique constraint.
          await tx.attachmentLink.createMany({
            data: [{
              companyId,
              attachmentId: item.attachmentId,
              targetType: 'expense.record',
              targetId: expense.id,
              purpose: 'expense.receipt.primary',
              linkedByUserId: actorUserId,
            }],
            skipDuplicates: true,
          });
        }
        const linked = await tx.reimbursementLine.updateMany({
          where: {
            id: item.reimbursementLineId,
            companyId,
            reimbursementRequestId: requestId,
            linkedExpenseId: null,
          },
          data: { linkedExpenseId: expense.id },
        });
        if (linked.count !== 1) throw new ConflictException('stale_approval_snapshot');
        results.push({ reimbursementLineId: item.reimbursementLineId, expenseId: expense.id });
    }
    return results;
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

  async findRequestById(companyId: string, id: string, withRelations = false): Promise<ReimbursementRequestRecord | null> {
    const row = await this.prisma.client.reimbursementRequest.findFirst({
      where: { id, companyId },
      // Lines load on every read: the snapshot hash, the receipt gate and the
      // duplicate scan all fold them, so a line-less read would approve stale.
      include: withRelations
        ? {
            lines: { orderBy: { lineNo: 'asc' } },
            approvalSteps: { orderBy: { sequenceNo: 'asc' } },
            payments: { orderBy: { createdAt: 'asc' } },
            duplicateCandidates: true,
            claimSignatures: { orderBy: { signedAt: 'asc' } },
          }
        : { lines: { orderBy: { lineNo: 'asc' } } },
    });
    return row ? this.toRequest(row) : null;
  }

  async listRequests(where: ListRequestsWhere): Promise<ReimbursementRequestRecord[]> {
    const predicates: Prisma.ReimbursementRequestWhereInput[] = [
      branchScopeWhere(where.scopes ?? {}) as Prisma.ReimbursementRequestWhereInput,
    ];
    if (where.relatedUserId) {
      predicates.push(await this.relatedRequestPredicate(where.companyId, where.relatedUserId, where.scopes));
    }
    const rows = await this.prisma.client.reimbursementRequest.findMany({
      where: {
        companyId: where.companyId,
        requesterUserId: where.requesterUserId,
        status: (where.status as any) ?? (where.statuses ? { in: where.statuses as any } : undefined),
        paymentStatus: where.paymentStatus as any,
        AND: predicates,
      },
      // Queues show a line count, not the lines themselves — keep the list query cheap.
      include: {
        _count: { select: { lines: true } },
        ...(where.status === 'PENDING_APPROVAL' && {
          approvalSteps: { where: { status: 'PENDING' as any } },
        }),
      },
      orderBy: { createdAt: 'desc' },
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

  /** Candidate requests for duplicate scoring: same requester, not this request, active states. */
  async findDuplicateCandidates(companyId: string, requesterUserId: string, excludeId: string): Promise<ReimbursementRequestRecord[]> {
    const rows = await this.prisma.client.reimbursementRequest.findMany({
      where: {
        companyId,
        requesterUserId,
        id: { not: excludeId },
        status: { notIn: ['REJECTED', 'CANCELLED', 'VOIDED'] as any },
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRequest(r));
  }

  // ---- Approval step ----

  async createApprovalStep(data: {
    companyId: string;
    reimbursementRequestId: string;
    sequenceNo: number;
    approverUserId?: string;
    approverRoleSnapshot?: string;
    requestSnapshotHash: string;
  }): Promise<ReimbursementApprovalStepRecord> {
    const row = await this.prisma.client.reimbursementApprovalStep.create({
      data: {
        companyId: data.companyId,
        reimbursementRequestId: data.reimbursementRequestId,
        sequenceNo: data.sequenceNo,
        approverUserId: data.approverUserId,
        approverRoleSnapshot: data.approverRoleSnapshot,
        requestSnapshotHash: data.requestSnapshotHash,
      },
    });
    return this.toStep(row);
  }

  async updateApprovalStep(id: string, data: Record<string, unknown>): Promise<ReimbursementApprovalStepRecord> {
    const row = await this.prisma.client.reimbursementApprovalStep.update({ where: { id }, data });
    return this.toStep(row);
  }

  // ---- Payment ----

  async assertClaimPaymentReady(companyId: string, requestId: string): Promise<void> {
    const row = await (this.prisma.client as any).reimbursementRequest.findFirst({
      where: { id: requestId, companyId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Reimbursement request not found');
    if (row.cancellationPendingAt) throw new ConflictException('reimbursement_cancellation_pending');
    await this.assertClaimProjectionsReady(this.prisma.client as any, this.toRequest(row));
  }

  async recordPaymentAtomic(data: {
    companyId: string;
    reimbursementRequestId: string;
    idempotencyKey: string;
    paymentNo?: string;
    paidAmount: string;
    currency: string;
    paymentMethod: string;
    paidAt: Date;
    paymentReference?: string;
    bankAccountId?: string;
    paidByUserId: string;
  }): Promise<{ request: ReimbursementRequestRecord; payment: ReimbursementPaymentRecord; created: boolean }> {
    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${data.companyId}:${data.reimbursementRequestId}:reimbursement-payment`}))`;
      await this.lockRequest(tx, data.companyId, data.reimbursementRequestId);

      const existing = await tx.reimbursementPayment.findFirst({
        where: { companyId: data.companyId, idempotencyKey: data.idempotencyKey },
      });
      if (existing) {
        const samePayment = existing.reimbursementRequestId === data.reimbursementRequestId
          && d(existing.paidAmount).eq(d(data.paidAmount))
          && existing.currency === data.currency
          && existing.paymentMethod === data.paymentMethod
          && existing.paidAt.getTime() === data.paidAt.getTime()
          && (existing.paymentReference ?? undefined) === data.paymentReference
          && (existing.bankAccountId ?? undefined) === data.bankAccountId;
        if (!samePayment) throw new ConflictException('reimbursement_payment_idempotency_conflict');
        const request = await tx.reimbursementRequest.findFirstOrThrow({
          where: { id: data.reimbursementRequestId, companyId: data.companyId },
          include: {
            lines: { orderBy: { lineNo: 'asc' } },
            approvalSteps: { orderBy: { sequenceNo: 'asc' } },
            payments: { orderBy: { createdAt: 'asc' } },
            duplicateCandidates: true,
          },
        });
        return { request: this.toRequest(request), payment: this.toPayment(existing), created: false };
      }

      const request = await tx.reimbursementRequest.findFirst({
        where: { id: data.reimbursementRequestId, companyId: data.companyId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!request) throw new NotFoundException('Reimbursement request not found');
      if (request.paymentStatus === 'PAID') throw new ConflictException('reimbursement_payment_already_recorded');
      if (request.cancellationPendingAt) throw new ConflictException('reimbursement_cancellation_pending');
      await this.assertClaimProjectionsReady(tx, this.toRequest(request));

      const policy = effectivePolicy(await tx.reimbursementPolicy.findFirst({
        where: { companyId: data.companyId, branchId: null },
      }).then((row: any) => row ? this.toPolicy(row) : null));
      const duplicateBlocking = policy.duplicatePolicy === 'BLOCK_PAYMENT'
        && await tx.reimbursementDuplicateCandidate.count({
          where: { companyId: data.companyId, reimbursementRequestId: data.reimbursementRequestId, status: 'OPEN' },
        }) > 0;
      const error = validatePaymentRecording({
        status: request.status,
        financeReviewRequired: policy.financeReviewRequired,
        financeReviewApproved: request.financeReviewStatus === 'APPROVED_FOR_PAYMENT' || !policy.financeReviewRequired,
        duplicateBlocking,
        approvedAmount: dec(request.amount),
        outstandingAmount: dec(request.outstandingAmount),
        paidAmount: data.paidAmount,
        paymentMethod: data.paymentMethod as any,
        paymentReference: data.paymentReference,
      });
      if (error) throw new UnprocessableEntityException(error);

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
        sourcePaymentRef: '',
        paidByUserId: data.paidByUserId,
        postingStatus: 'pending',
      } });
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

      const updated = await tx.reimbursementRequest.findFirstOrThrow({
        where: { id: data.reimbursementRequestId, companyId: data.companyId },
        include: {
          lines: { orderBy: { lineNo: 'asc' } },
          approvalSteps: { orderBy: { sequenceNo: 'asc' } },
          payments: { orderBy: { createdAt: 'asc' } },
          duplicateCandidates: true,
        },
      });
      return { request: this.toRequest(updated), payment: this.toPayment(payment), created: true };
    }, { isolationLevel: 'Serializable' });
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
        sourceReimbursementLineId: { in: lines.map((line) => line.id) },
      },
    });
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
  async updatePaymentPostingStatus(
    companyId: string,
    id: string,
    data: { postingStatus: 'pending' | 'posted' | 'posting_error' | 'reversed' },
  ): Promise<void> {
    await this.prisma.client.reimbursementPayment.updateMany({
      where: { id, companyId },
      data: { postingStatus: data.postingStatus as any },
    });
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
    if (!opts.reversalEntryNumber) {
      throw new ConflictException({ code: 'posting_state_changed', message: 'Posting state changed while voiding. Retry the void.' });
    }
    const period = await tx.accountingPeriod.findFirst({ where: { companyId: opts.companyId, id: original.periodId } });
    if (!period) {
      throw new UnprocessableEntityException(`Accounting period for journal ${original.entryNumber} was not found; cannot void`);
    }
    if (!['OPEN', 'REOPENED'].includes(period.status)) {
      throw new ConflictException({ code: 'accounting_period_locked', message: `Accounting period ${period.periodKey} is not open; reopen it before voiding.` });
    }
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
        companyId: opts.companyId, periodId: original.periodId, entryNumber: opts.reversalEntryNumber,
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
  ): Promise<{ request: ReimbursementRequestRecord; payment: ReimbursementPaymentRecord; reversalEntryId: string | null }> {
    return await (this.prisma.client as any).$transaction(async (tx: any) => {
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
      return { request: this.toRequest(updated), payment: this.toPayment(payment), reversalEntryId: reversal.reversalEntryId };
    }, { isolationLevel: 'Serializable' });
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
        postingStatus: 'pending' as any,
        request: { is: branchScopeWhere(scopes) },
      },
      orderBy: { paidAt: 'asc' },
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
   */
  async upsertClaimSignature(data: {
    companyId: string;
    reimbursementRequestId: string;
    role: ReimbursementClaimSignatureRole;
    signatureAttachmentId: string;
    signedByUserId: string;
    signedAt: Date;
  }): Promise<ReimbursementClaimSignatureRecord> {
    const row = await this.prisma.client.reimbursementClaimSignature.upsert({
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
  }

  async listClaimSignatures(companyId: string, requestId: string): Promise<ReimbursementClaimSignatureRecord[]> {
    const rows = await this.prisma.client.reimbursementClaimSignature.findMany({
      where: { companyId, reimbursementRequestId: requestId },
      orderBy: { signedAt: 'asc' },
    });
    return rows.map((row) => this.toClaimSignature(row));
  }

  /** The signer's own ACTIVE signature image for this claim+role — nobody else's file can be rendered. */
  async findClaimSignatureAttachment(
    companyId: string,
    attachmentId: string,
    actorUserId: string,
    requestId: string,
    role: ReimbursementClaimSignatureRole,
  ): Promise<{ id: string; bucket: string; objectKey: string; objectVersionId?: string; mimeType: string; byteSize: number; checksumSha256: string | null } | null> {
    const row = await this.prisma.client.attachmentObject.findFirst({
      where: {
        id: attachmentId,
        companyId,
        uploadedByUserId: actorUserId,
        status: 'ACTIVE',
        mimeType: { in: ['image/png', 'image/jpeg'] },
        metadataJson: { equals: { generatedFor: 'reimbursement_claim_signature', requestId, role } },
      },
    });
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

  /** Uploaded scans of the wet-ink signed form, newest first. */
  async listSignedClaimFormCopies(companyId: string, requestId: string): Promise<{ attachmentId: string; fileName: string; uploadedAt: Date }[]> {
    const rows = await this.prisma.client.attachmentLink.findMany({
      where: {
        companyId,
        targetType: REIMBURSEMENT_ATTACHMENT_TARGET_TYPE,
        targetId: requestId,
        purpose: REIMBURSEMENT_SIGNED_COPY_PURPOSE,
        attachment: { status: 'ACTIVE' },
      },
      select: { attachmentId: true, createdAt: true, attachment: { select: { originalFileName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => ({ attachmentId: row.attachmentId, fileName: row.attachment.originalFileName, uploadedAt: row.createdAt }));
  }

  /** Link write mirroring LinkAttachmentUseCase semantics; the caller asserts the attachment is ACTIVE and audits. */
  async linkSignedClaimFormCopy(companyId: string, requestId: string, attachmentId: string, linkedByUserId: string): Promise<void> {
    await this.prisma.client.attachmentLink.upsert({
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
    });
  }

  // ---- Mappers ----

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
