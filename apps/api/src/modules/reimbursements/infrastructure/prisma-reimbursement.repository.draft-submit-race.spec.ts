/** Real PostgreSQL proof that an edit and submit cannot both commit. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { MaterializeClaimExpensesService } from '../application/services/materialize-claim-expenses.service';
import { claimSnapshotFields, computeLegacySnapshotHashV1, computeSnapshotHash } from '../domain/logic/reimbursement.logic';
import { PrismaReimbursementRepository } from './prisma-reimbursement.repository';
import { readReimbursementSource, resolveReimbursementSourceLines, assertReimbursementSources, assertProjectionSource } from './reimbursement-source';
import { expenseTaxSourceChecksum } from '../../expenses/domain/logic/expense-status.logic';
import { ConfirmExpenseUseCase } from '../../expenses/application/use-cases/expense-draft.use-case';
import { PrismaAttachmentRepository } from '../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { ReimbursementEvidenceService } from '../application/services/reimbursement-evidence.service';
import { PrismaExpenseRepository } from '../../expenses/infrastructure/prisma-expense.repository';
import { DeleteEmployeeDraftUseCase } from '../../employee-access/application/use-cases/delete-employee-draft.use-case';
import { CreateOrUpdateNotificationEventUseCase } from '../../dashboard-notifications/application/use-cases/notification.use-cases';
import { MemberPayoutAccountUseCase } from '../application/use-cases/reimbursement-payout.use-case';
import {
  CASH_PAYOUT_FINGERPRINT, openPayoutAccountNumber, payoutFingerprint, payoutSubmitToken, sealPayoutDestination, type SubmitPayoutColumns,
} from '../domain/logic/payout-destination.logic';

const TAG = `reimbursement-draft-race-${process.pid}`;
const periodKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
const gateRequired = process.env.REIMBURSEMENT_PG_GATE_REQUIRED === 'true';

function databaseUrl(): string | null {
  return process.env.DATABASE_URL?.trim() || null;
}

function errorCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return response && typeof response === 'object' ? (response as { code?: string }).code : undefined;
}

function errorMessage(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return typeof response === 'string'
    ? response
    : response && typeof response === 'object'
      ? String((response as { message?: unknown }).message ?? '')
      : undefined;
}

describe('reimbursement draft edit vs submit (real PostgreSQL)', () => {
  let clients: PrismaClient[] = [];
  let repos: PrismaReimbursementRepository[] = [];
  let companyId = '';
  let branchId = '';
  let reachable = false;

  before(async () => {
    const url = databaseUrl();
    if (!url) {
      if (gateRequired) throw new Error('reimbursement_pg_gate_database_url_required');
      return;
    }
    try {
      clients = [
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
      ];
      await clients[0]!.$queryRaw`SELECT 1`;
    } catch (error) {
      if (gateRequired) throw error;
      return;
    }
    reachable = true;
    // Confirmation writes its real audit in the aggregate transaction.
    await clients[0]!.user.createMany({ data: [{ id: `${TAG}-finance`, displayName: 'Race Finance' }, { id: `${TAG}-user`, displayName: 'Race User' }] });
    companyId = (await clients[0]!.company.create({
      data: { name: TAG, status: 'ACTIVE' },
      select: { id: true },
    })).id;
    await clients[0]!.companyMembership.createMany({ data: ['finance', 'user'].map(suffix => ({ companyId, userId: `${TAG}-${suffix}`, status: 'ACTIVE' as const })) });
    branchId = (await clients[0]!.branch.create({
      data: { companyId, code: 'QA-RACE', name: TAG },
      select: { id: true },
    })).id;
    repos = clients.map((client) => new PrismaReimbursementRepository(
      { client } as any,
      new PrismaDocumentSequenceRepository({ client } as any),
    ));
  });

  after(async () => {
    if (reachable) {
      await clients[0]!.auditLog.deleteMany({ where: { companyId } });
      await clients[0]!.expenseSubstituteReceiptEvidence.deleteMany({ where: { companyId } });
      await clients[0]!.company.deleteMany({ where: { id: companyId } });
      await clients[0]!.user.deleteMany({ where: { id: { in: [`${TAG}-finance`, `${TAG}-user`] } } });
    }
    await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
  });

  async function createDraft(suffix: string, attachmentId?: string, amount = '100.0000') {
    const request = await repos[0]!.createRequest({
      companyId,
      branchId,
      requesterUserId: `${TAG}-user`,
      requesterDisplayNameSnapshot: 'Race User',
      reason: suffix,
      categoryKey: 'travel',
      amount,
      currency: 'THB',
      incurredDate: new Date('2026-08-03T00:00:00.000Z'),
      receiptRequirementStatus: attachmentId ? 'ATTACHED' : 'WAIVED_BY_POLICY',
      createdByUserId: `${TAG}-user`,
      lines: [{
        lineNo: 1,
        incurredDate: new Date('2026-08-03T00:00:00.000Z'),
        description: suffix,
        categoryKey: 'travel',
        amount,
        attachmentId,
      }],
    });
    assert.equal(request.lines?.length, 1);
    assert.notEqual(request.lines?.[0]?.id, `rbl_${request.id}`);
    return request;
  }

  function submitInput(request: { id: string; updatedAt: Date; amount?: string }, options: {
    attachmentIds?: string[];
    duplicateCandidates?: Array<Record<string, unknown>>;
    requestSnapshotHash?: string;
    approverUserId?: string;
  } = {}) {
    const requestSnapshotHash = options.requestSnapshotHash ?? 'a'.repeat(32);
    return {
      companyId,
      requestId: request.id,
      expectedUpdatedAt: request.updatedAt,
      duplicateCandidates: options.duplicateCandidates ?? [],
      evidence: { attachmentIds: options.attachmentIds ?? [], expenseIds: [] },
      documentNumber: {
        documentType: 'reimbursement.request',
        periodKey,
        idempotencyKey: `reimb-submit:${request.id}`,
        reservedByUserId: `${TAG}-user`,
      },
      approvalStep: {
        sequenceNo: 1,
        approverUserId: options.approverUserId,
        approverRoleSnapshot: 'MANAGER',
        requestSnapshotHash,
      },
      request: {
        status: 'PENDING_APPROVAL',
        submittedAt: new Date(),
        submittedByUserId: `${TAG}-user`,
        approvalSnapshotHash: requestSnapshotHash,
        outstandingAmount: request.amount ?? '100.0000',
        updatedByUserId: `${TAG}-user`,
      },
    } as any;
  }

  async function submitValidPending(suffix: string, legacyV1 = false, amount = '100.0000') {
    let draft = await createDraft(suffix, undefined, amount);
    if (legacyV1 && draft.lines?.[0]?.id !== `rbl_${draft.id}`) {
      // The migration spec proves that the backfill creates this exact id. Keep
      // this repository proof self-contained when a developer DB has not run
      // the pending migration yet.
      await clients[0]!.reimbursementLine.update({
        where: { id: draft.lines![0]!.id },
        data: { id: `rbl_${draft.id}` },
      });
      draft = (await repos[0]!.findRequestById(companyId, draft.id))!;
    }
    const requestSnapshotHash = legacyV1
      ? computeLegacySnapshotHashV1({
        amount: draft.amount,
        currency: draft.currency,
        categoryKey: draft.categoryKey,
        incurredDate: draft.incurredDate.toISOString(),
        reason: draft.reason,
        primaryAttachmentId: draft.primaryAttachmentId,
      })
      : computeSnapshotHash({
        amount: draft.amount,
        currency: draft.currency,
        categoryKey: draft.categoryKey,
        incurredDate: draft.incurredDate.toISOString(),
        reason: draft.reason,
        primaryAttachmentId: draft.primaryAttachmentId,
        lines: draft.lines,
      });
    const approverUserId = `${TAG}-approver`;
    await repos[0]!.submitDraftAtomic(submitInput(draft, { requestSnapshotHash, approverUserId }));
    const pending = await repos[0]!.findRequestById(companyId, draft.id);
    assert.ok(pending);
    return { pending, approverUserId };
  }

  /**
   * The live CC2 decision step. `approveRequestAtomic` was the one-shot legacy path; it has been
   * fail-closed with no callers and is now gone, so the real-Postgres race coverage moved here.
   */
  function decisionInput(
    pending: NonNullable<Awaited<ReturnType<PrismaReimbursementRepository['findRequestById']>>>,
    approverUserId: string,
  ) {
    return {
      companyId,
      requestId: pending.id,
      expectedUpdatedAt: pending.updatedAt,
      expectedApprovalSnapshotHash: pending.approvalSnapshotHash ?? undefined,
      actorUserId: approverUserId,
      actorRoles: ['OWNER'],
      scopes: {},
      allowSelfApproval: false,
      financeReviewRequired: true,
      decidedAt: new Date(),
      comment: 'decided in PostgreSQL proof',
      financeRequestPatch: {
        financeReviewStatus: 'PENDING',
        paymentStatus: 'UNPAID',
        updatedByUserId: approverUserId,
      },
      onDecisionPersisted: async () => undefined,
    };
  }

  function rejectionInput(
    pending: NonNullable<Awaited<ReturnType<PrismaReimbursementRepository['findRequestById']>>>,
    approverUserId: string,
    status = 'REJECTED',
  ) {
    return {
      companyId,
      requestId: pending.id,
      expectedUpdatedAt: pending.updatedAt,
      actorUserId: approverUserId,
      // Both added when the signature gained branch scoping. The `as any` below used to hide
      // their absence from tsc, so the drift only surfaced at runtime as a TypeError.
      actorRoles: ['OWNER'],
      scopes: {},
      allowSelfApproval: false,
      decidedAt: new Date(),
      rejectionReason: 'duplicate receipt',
      onRejectedPersisted: async () => undefined,
      request: {
        status,
        rejectedAt: new Date(),
        rejectionReason: 'duplicate receipt',
        currentApproverUserId: null,
        currentApprovalStepId: null,
        paymentStatus: 'NOT_PAYABLE',
        postingStatus: 'not_required',
        updatedByUserId: approverUserId,
      },
    };
  }

  it('commits exactly one winner and leaves one internally consistent aggregate', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    for (let round = 0; round < 8; round += 1) {
      const initial = await repos[0]!.createRequest({
        companyId,
        branchId,
        requesterUserId: `${TAG}-user`,
        requesterDisplayNameSnapshot: 'Race User',
        reason: 'original',
        categoryKey: 'travel',
        amount: '100.0000',
        currency: 'THB',
        incurredDate: new Date('2026-08-03T00:00:00.000Z'),
        receiptRequirementStatus: 'WAIVED_BY_POLICY',
        createdByUserId: `${TAG}-user`,
        lines: [{
          lineNo: 1,
          incurredDate: new Date('2026-08-03T00:00:00.000Z'),
          description: 'original line',
          categoryKey: 'travel',
          amount: '100.0000',
        }],
      });

      const edit = () => repos[round % 2]!.updateDraftRequest(
        companyId,
        initial.id,
        initial.updatedAt,
        { reason: 'edited', amount: '200.0000', outstandingAmount: '200.0000', updatedByUserId: `${TAG}-user` },
        [{
          lineNo: 1,
          incurredDate: new Date('2026-08-03T00:00:00.000Z'),
          description: 'edited line',
          categoryKey: 'travel',
          amount: '200.0000',
        }],
      );
      const submit = () => repos[(round + 1) % 2]!.submitDraftAtomic({
        companyId,
        requestId: initial.id,
        expectedUpdatedAt: initial.updatedAt,
        duplicateCandidates: [],
        evidence: { attachmentIds: [], expenseIds: [] },
        documentNumber: {
          documentType: 'reimbursement.request',
          periodKey,
          idempotencyKey: `reimb-submit:${initial.id}`,
          reservedByUserId: `${TAG}-user`,
        },
        approvalStep: {
          sequenceNo: 1,
          approverRoleSnapshot: 'MANAGER',
          requestSnapshotHash: 'a'.repeat(32),
        },
        request: {
          status: 'PENDING_APPROVAL',
          submittedAt: new Date(),
          submittedByUserId: `${TAG}-user`,
          approvalSnapshotHash: 'a'.repeat(32),
          outstandingAmount: '100.0000',
          updatedByUserId: `${TAG}-user`,
        },
      });

      const settled = await Promise.allSettled(round % 2 === 0 ? [edit(), submit()] : [submit(), edit()]);
      assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
      const loser = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      assert.equal(errorCode(loser?.reason), 'reimbursement_draft_changed');

      const stored = await clients[0]!.reimbursementRequest.findUniqueOrThrow({
        where: { id: initial.id },
        include: { lines: { orderBy: { lineNo: 'asc' } }, approvalSteps: true },
      });
      if (stored.status === 'DRAFT') {
        assert.equal(String(stored.amount), '200');
        assert.equal(stored.lines[0]?.description, 'edited line');
        assert.equal(stored.approvalSteps.length, 0, 'a losing submit must roll its approval step back');
        assert.equal(stored.currentApprovalStepId, null);
      } else {
        assert.equal(stored.status, 'PENDING_APPROVAL');
        assert.equal(String(stored.amount), '100');
        assert.equal(stored.lines[0]?.description, 'original line', 'a losing edit must not replace lines');
        assert.equal(stored.approvalSteps.length, 1);
        assert.equal(stored.currentApprovalStepId, stored.approvalSteps[0]?.id);
      }
    }
  });

  it('a stale submit rolls back candidates and numbering, then retry uses the unconsumed number', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const initial = await createDraft('stale-number');
    const sequenceBefore = await clients[0]!.documentSequence.findUniqueOrThrow({
      where: { companyId_branchScopeKey_documentType_periodKey: {
        companyId, branchScopeKey: 'GLOBAL', documentType: 'reimbursement.request', periodKey,
      } },
    });
    await repos[0]!.updateDraftRequest(companyId, initial.id, initial.updatedAt, {
      reason: 'newer edit', updatedByUserId: `${TAG}-user`,
    });

    const candidate = [{
      candidateType: 'AMOUNT_DATE_VENDOR', candidateRequestId: 'candidate-request', score: 75,
    }];
    const prior = await clients[0]!.reimbursementDuplicateCandidate.create({
      data: {
        companyId,
        reimbursementRequestId: initial.id,
        candidateType: 'MANUAL',
        score: 61,
        reason: 'prior review reason',
      },
    });
    await assert.rejects(
      () => repos[1]!.submitDraftAtomic(submitInput(initial, { duplicateCandidates: candidate })),
      (error: unknown) => errorCode(error) === 'reimbursement_draft_changed',
    );
    assert.deepEqual(await clients[0]!.reimbursementDuplicateCandidate.findUnique({
      where: { id: prior.id },
      select: { status: true, reason: true, resolvedAt: true, resolvedByUserId: true },
    }), { status: 'OPEN', reason: 'prior review reason', resolvedAt: null, resolvedByUserId: null });
    assert.equal(await clients[0]!.reimbursementApprovalStep.count({
      where: { companyId, reimbursementRequestId: initial.id },
    }), 0);
    assert.equal(await clients[0]!.documentNumber.count({
      where: { companyId, idempotencyKey: `reimb-submit:${initial.id}` },
    }), 0);
    assert.equal((await clients[0]!.documentSequence.findUniqueOrThrow({ where: { id: sequenceBefore.id } })).nextNumber, sequenceBefore.nextNumber);

    const fresh = await repos[0]!.findRequestById(companyId, initial.id);
    const retried = await repos[1]!.submitDraftAtomic(submitInput(fresh!, { duplicateCandidates: candidate }));
    assert.equal(retried.supersededDuplicateCandidateCount, 1);
    assert.equal(retried.supersededApprovalStepCount, 0);
    const expectedNumber = `RB-${periodKey.replace('-', '')}-${String(sequenceBefore.nextNumber).padStart(5, '0')}`;
    assert.equal(retried.documentNumber.documentNumber, expectedNumber);
    assert.equal(retried.documentNumber.status, 'COMMITTED');
    const retryCandidates = await clients[0]!.reimbursementDuplicateCandidate.findMany({
      where: { companyId, reimbursementRequestId: initial.id },
      orderBy: { createdAt: 'asc' },
      select: { status: true, reason: true, resolvedAt: true, resolvedByUserId: true },
    });
    assert.deepEqual(retryCandidates.map(({ status, reason }) => ({ status, reason })), [
      { status: 'DISMISSED', reason: 'prior review reason' },
      { status: 'OPEN', reason: null },
    ]);
    assert.equal(retryCandidates[0]?.resolvedByUserId, `${TAG}-user`);
    assert.ok(retryCandidates[0]?.resolvedAt instanceof Date);
    assert.equal((await clients[0]!.documentSequence.findUniqueOrThrow({ where: { id: sequenceBefore.id } })).nextNumber, sequenceBefore.nextNumber + 1);
  });

  it('two requests submitting the same receipt have exactly one winner', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const attachmentId = `${TAG}-shared-receipt`;
    const [left, right] = await Promise.all([
      createDraft('shared-left', attachmentId),
      createDraft('shared-right', attachmentId),
    ]);
    const settled = await Promise.allSettled([
      repos[0]!.submitDraftAtomic(submitInput(left, { attachmentIds: [attachmentId] })),
      repos[1]!.submitDraftAtomic(submitInput(right, { attachmentIds: [attachmentId] })),
    ]);
    assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
    const loser = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.equal(errorMessage(loser?.reason), 'attachment_already_claimed');

    const requests = await clients[0]!.reimbursementRequest.findMany({
      where: { id: { in: [left.id, right.id] } },
      include: { approvalSteps: true },
    });
    assert.deepEqual(requests.map((request) => request.status).sort(), ['DRAFT', 'PENDING_APPROVAL']);
    assert.equal(requests.reduce((total, request) => total + request.approvalSteps.length, 0), 1);
    assert.equal(await clients[0]!.documentNumber.count({
      where: { companyId, idempotencyKey: { in: [`reimb-submit:${left.id}`, `reimb-submit:${right.id}`] } },
    }), 1);
  });

  it('reuses only a committed document number already owned by the same request', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const numbers = new PrismaDocumentSequenceRepository({ client: clients[0]! } as any);
    const owned = await createDraft('owned-committed');
    const reserved = await numbers.reserveNumber({
      companyId,
      documentType: 'reimbursement.request',
      periodKey,
      idempotencyKey: `reimb-submit:${owned.id}`,
      reservedByUserId: `${TAG}-user`,
    });
    const committed = await numbers.commitNumber({
      id: reserved.id,
      companyId,
      ownerType: 'reimbursement_request',
      ownerId: owned.id,
    });
    const staleStep = await clients[0]!.reimbursementApprovalStep.create({
      data: {
        companyId,
        reimbursementRequestId: owned.id,
        sequenceNo: 1,
        approverRoleSnapshot: 'MANAGER',
        requestSnapshotHash: `${TAG}-stale-snapshot`,
      },
    });
    const result = await repos[1]!.submitDraftAtomic(submitInput(owned));
    assert.equal(result.documentNumberReused, true);
    assert.equal(result.supersededApprovalStepCount, 1);
    assert.equal(result.supersededDuplicateCandidateCount, 0);
    assert.equal(result.documentNumber.id, committed.id);
    assert.equal((await clients[0]!.documentNumber.findUniqueOrThrow({ where: { id: committed.id } })).committedAt?.getTime(), committed.committedAt?.getTime());
    const recoveredSteps = await clients[0]!.reimbursementApprovalStep.findMany({
      where: { companyId, reimbursementRequestId: owned.id },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(recoveredSteps.length, 2);
    assert.equal(recoveredSteps.find((step) => step.id === staleStep.id)?.status, 'CANCELLED');
    assert.equal(recoveredSteps.find((step) => step.id === staleStep.id)?.invalidatedReason, 'superseded_by_atomic_resubmit');
    assert.ok(recoveredSteps.find((step) => step.id === staleStep.id)?.invalidatedAt instanceof Date);
    assert.equal(recoveredSteps.find((step) => step.id !== staleStep.id)?.status, 'PENDING');

    for (const status of ['WRONG_OWNER', 'CANCELLED', 'VOIDED'] as const) {
      const draft = await createDraft(`unavailable-${status}`);
      const number = await numbers.reserveNumber({
        companyId,
        documentType: 'reimbursement.request',
        periodKey,
        idempotencyKey: `reimb-submit:${draft.id}`,
        reservedByUserId: `${TAG}-user`,
      });
      if (status === 'CANCELLED') {
        await numbers.cancelReservation({ id: number.id, companyId });
      } else {
        await numbers.commitNumber({
          id: number.id,
          companyId,
          ownerType: 'reimbursement_request',
          ownerId: status === 'WRONG_OWNER' ? `${draft.id}-other` : draft.id,
        });
        if (status === 'VOIDED') await numbers.voidNumber({ id: number.id, companyId });
      }
      await assert.rejects(
        () => repos[1]!.submitDraftAtomic(submitInput(draft)),
        (error: unknown) => errorCode(error) === 'reimbursement_document_number_unavailable',
      );
      assert.equal(await clients[0]!.reimbursementApprovalStep.count({ where: { reimbursementRequestId: draft.id } }), 0);
    }
  });

  it('cancel and submit use the same request lock and have exactly one winner', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    for (let round = 0; round < 8; round += 1) {
      const draft = await createDraft(`cancel-submit-${round}`);
      const cancel = () => repos[round % 2]!.cancelRequestAtomic(
        companyId,
        draft.id,
        'DRAFT',
        draft.updatedAt,
        {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          paymentStatus: 'NOT_PAYABLE',
          updatedByUserId: `${TAG}-user`,
        },
      );
      const submit = () => repos[(round + 1) % 2]!.submitDraftAtomic(submitInput(draft));
      const settled = await Promise.allSettled(round % 2 === 0 ? [cancel(), submit()] : [submit(), cancel()]);
      assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
      const loser = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      assert.equal(errorCode(loser?.reason), 'reimbursement_draft_changed');

      const stored = await clients[0]!.reimbursementRequest.findUniqueOrThrow({
        where: { id: draft.id },
        include: { approvalSteps: true },
      });
      const numberCount = await clients[0]!.documentNumber.count({
        where: { companyId, idempotencyKey: `reimb-submit:${draft.id}` },
      });
      if (stored.status === 'CANCELLED') {
        assert.equal(stored.approvalSteps.length, 0);
        assert.equal(numberCount, 0);
      } else {
        assert.equal(stored.status, 'PENDING_APPROVAL');
        assert.equal(stored.approvalSteps.length, 1);
        assert.equal(numberCount, 1);
      }
    }
  });

  it('a failed rejection transition rolls its step decision back before retry', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const { pending, approverUserId } = await submitValidPending('reject-rollback');

    await assert.rejects(() => repos[0]!.rejectRequestAtomic(
      rejectionInput(pending, approverUserId, 'INVALID_REIMBURSEMENT_STATUS'),
    ));
    const rolledBack = await clients[0]!.reimbursementRequest.findUniqueOrThrow({
      where: { id: pending.id },
      include: { approvalSteps: true },
    });
    assert.equal(rolledBack.status, 'PENDING_APPROVAL');
    assert.equal(rolledBack.approvalSteps[0]?.status, 'PENDING');

    await repos[1]!.rejectRequestAtomic(rejectionInput(pending, approverUserId));
    const rejected = await clients[0]!.reimbursementRequest.findUniqueOrThrow({
      where: { id: pending.id },
      include: { approvalSteps: true },
    });
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.approvalSteps[0]?.status, 'REJECTED');
  });


  // Migrated from the removed legacy one-shot path. This is the only real-Postgres race proof
  // for an approval decision — reimbursement-approval.use-case.spec.ts covers the policy rules
  // against mocks, not two transactions contending for the same row.
  it('two concurrent approval decisions have exactly one winner', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const { pending, approverUserId } = await submitValidPending('decide-race');

    const results = await Promise.allSettled([
      repos[0]!.beginApprovalDecisionAtomic(decisionInput(pending, approverUserId)),
      repos[1]!.beginApprovalDecisionAtomic(decisionInput(pending, approverUserId)),
    ]);
    const winners = results.filter((r) => r.status === 'fulfilled');
    assert.equal(winners.length, 1, 'exactly one decision may commit');

    const after = await clients[0]!.reimbursementRequest.findUniqueOrThrow({
      where: { id: pending.id },
      include: { approvalSteps: true },
    });
    assert.equal(after.approvalSteps.filter((step: any) => step.status === 'APPROVED').length, 1,
      'the losing transaction must not leave a second decided step behind');
  });

  it('blocks approval after a requester cancellation intent has started', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const { pending, approverUserId } = await submitValidPending('approve-during-cancel');
    const intent = await repos[0]!.beginCancellationAtomic({
      companyId,
      requestId: pending.id,
      expectedStatus: 'PENDING_APPROVAL',
      expectedUpdatedAt: pending.updatedAt,
      actorUserId: pending.requesterUserId,
      scopes: {},
      reason: 'requester cancelled while awaiting approval',
      startedAt: new Date(),
      onIntentPersisted: async () => undefined,
    });

    await assert.rejects(
      () => repos[1]!.beginApprovalDecisionAtomic(decisionInput(intent.request, approverUserId)),
      (error: unknown) => errorMessage(error) === 'reimbursement_cancellation_pending',
    );

    const after = await clients[0]!.reimbursementRequest.findUniqueOrThrow({
      where: { id: pending.id },
      include: { approvalSteps: true },
    });
    assert.ok(after.cancellationPendingAt);
    assert.equal(after.status, 'PENDING_APPROVAL');
    assert.equal(after.approvalSteps[0]?.status, 'PENDING');
  });

  let sourceSequence = 0;
  async function sourceFixture(withCertificate = true) {
    const db = clients[0]!;
    const index = ++sourceSequence;
    const at = new Date('2026-08-22T00:00:00Z');
    const payer = `${TAG}-user`;
    const expense = await db.expenseRecord.create({ data: {
      companyId, branchId, createdByUserId: withCertificate ? `${TAG}-finance` : payer,
      expenseDate: at, vendorNameSnapshot: 'ร้านต้นทาง', vendorDocumentNumber: `SOURCE-${index}`, status: 'NEEDS_REVIEW',
      vatMode: 'NO_VAT', sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE',
      subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', netPayableAmount: '100', outstandingAmount: '100',
      lines: { create: [{ companyId, lineNumber: 1, description: 'ค่าเดินทาง', quantity: '1', unitPrice: '60', taxableAmount: '60', lineSubtotalAmount: '60', lineTotalAmount: '60', accountHintKey: 'travel' },
        { companyId, lineNumber: 2, description: 'ค่าส่งสินค้า', quantity: '1', unitPrice: '40', taxableAmount: '40', lineSubtotalAmount: '40', lineTotalAmount: '40', accountHintKey: 'delivery' }] },
    } });
    const file = await db.attachmentObject.create({ data: { companyId, branchId, storageProvider: 'LOCAL', bucket: 'test', objectKey: `${TAG}/${index}`, originalFileName: 'receipt.pdf', mimeType: 'application/pdf', byteSize: 1,
      checksumSha256: 'b'.repeat(64), uploadedByUserId: payer, status: 'ACTIVE' } });
    await db.attachmentLink.create({ data: { companyId, attachmentId: file.id, targetType: 'expense.record', targetId: expense.id, purpose: 'expense.receipt.primary', linkedByUserId: payer } });
    const certificate = withCertificate ? await db.expenseSubstituteReceiptEvidence.create({ data: {
      companyId, branchId, expenseId: expense.id, version: 1, status: 'ISSUED', fundingSource: 'PERSONAL_ADVANCE', signatureMode: 'DIGITAL',
      documentNumber: `SRC-202608-SOURCE-${index}`, idempotencyKey: `${TAG}-source-${index}`, originalSourceDocumentType: 'RECEIPT',
      reasonCode: 'RECEIPT_UNAVAILABLE', missingReceiptReason: 'ไม่มีใบเสร็จ', businessPurpose: 'ใช้ในกิจการ', paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [],
      paymentDate: at, paymentMethod: 'CASH', preparedByUserId: `${TAG}-finance`, preparedAt: at, expenseUpdatedAtAtPreparation: expense.updatedAt,
      payerUserId: payer, payerName: 'พนักงานผู้จ่าย', artifactAttachmentId: file.id, checksumSha256: file.checksumSha256,
      snapshotJson: { test: index }, snapshotChecksumSha256: file.checksumSha256, payerPosition: '', certifiedAt: at,
      payerSignatureAttachmentId: file.id, payerSignatureChecksumSha256: file.checksumSha256, certifiedArtifactAttachmentId: file.id, certifiedArtifactChecksumSha256: file.checksumSha256,
      approverUserId: `${TAG}-finance`, approverName: 'ผู้อนุมัติ', approverPosition: '', approverSignatureAttachmentId: file.id, approvedAt: at, issuedByUserId: `${TAG}-finance`, issuedAt: at,
    } }) : null;
    const input = { lineNo: 1, incurredDate: at, description: 'เบิกคืนจากค่าใช้จ่าย', categoryKey: 'travel', amount: '100.0000', linkedExpenseId: expense.id, sourceExpenseUpdatedAt: expense.updatedAt.toISOString() };
    return { db, expense, file, certificate, payer, input };
  }

  async function claimFromSource(source: Awaited<ReturnType<typeof sourceFixture>>) {
    const lines = await resolveReimbursementSourceLines(source.db, companyId, source.payer, branchId, 'THB', [source.input]);
    return repos[0]!.createRequest({ companyId, branchId, requesterUserId: source.payer, requesterDisplayNameSnapshot: 'พนักงานผู้จ่าย',
      createdByUserId: `${TAG}-finance`, reason: 'ทดสอบหลักฐานต้นทาง', currency: 'THB', categoryKey: 'travel', amount: '100.0000', incurredDate: source.input.incurredDate,
      receiptRequirementStatus: 'ATTACHED', lines });
  }

  it('imports the actual payer independently of the preparer and retains source facts after JSONB round-trip', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const source = await sourceFixture();
    const options = await repos[0]!.listReimbursementSources(companyId, branchId, source.payer, 'ร้านต้นทาง');
    assert.equal(options.find(row => row.expenseId === source.expense.id)?.eligible, true);
    assert.equal(options.find(row => row.expenseId === source.expense.id)?.purpose, 'ใช้ในกิจการ');
    const request = await claimFromSource(source);
    const snapshot = request.lines![0]!.sourceExpenseSnapshot!;
    assert.equal(request.requesterUserId, source.payer);
    assert.notEqual(request.createdByUserId, request.requesterUserId);
    assert.equal(snapshot.seller.documentNumber, source.expense.vendorDocumentNumber);
    assert.equal(snapshot.paymentDate, '2026-08-22T00:00:00.000Z');
    assert.equal(snapshot.certificate?.artifactChecksumSha256, 'b'.repeat(64));
    assert.deepEqual(snapshot.lines.map(line => line.accountHintKey), ['travel', 'delivery']);
    await source.db.$transaction(tx => assertReimbursementSources(tx, request));
    const [projection] = new MaterializeClaimExpensesService().buildItems(request);
    assert.equal(projection!.attachmentId, null);
    assert.deepEqual(projection!.sourceCostLines?.map(line => [line.amount, line.accountHintKey]), [['60', 'travel'], ['40', 'delivery']]);
  });

  it('rejects wrong tenant/branch/payee, company money, unissued/paper-unlinked evidence, tax handoff and amount/date tampering', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const source = await sourceFixture();
    const read = (company = companyId, user = source.payer, branch = branchId) => readReimbursementSource(source.db, company, user, branch, 'THB', source.expense.id);
    await assert.rejects(() => read('other-company'), error => errorCode(error) === 'reimbursement_source_unavailable');
    await assert.rejects(() => read(companyId, source.payer, 'other-branch'), error => errorCode(error) === 'REIMBURSEMENT_EVIDENCE_BRANCH_MISMATCH');
    await assert.rejects(() => read(companyId, `${TAG}-finance`), error => errorCode(error) === 'reimbursement_source_wrong_payer');
    for (const [patch, code] of [[{ fundingSource: 'COMPANY' }, 'reimbursement_source_not_personal'], [{ fundingSource: 'PERSONAL_ADVANCE', status: 'PREPARED' }, 'reimbursement_source_not_issued'],
      [{ status: 'ISSUED', payerUserId: null, signatureMode: 'PAPER', approverUserId: null, payerSignatureAttachmentId: null, approverSignatureAttachmentId: null,
        wetSignedScanAttachmentId: source.file.id, wetSignedScanChecksumSha256: source.file.checksumSha256, paperFormSnapshotJson: {}, paperSubmissionJson: {}, paperReviewedByUserId: `${TAG}-finance` }, 'reimbursement_source_payer_unlinked']] as const) {
      await source.db.expenseSubstituteReceiptEvidence.update({ where: { id: source.certificate!.id }, data: patch });
      await assert.rejects(() => read(), error => errorCode(error) === code);
    }
    await source.db.expenseSubstituteReceiptEvidence.update({ where: { id: source.certificate!.id }, data: { payerUserId: source.payer, signatureMode: 'DIGITAL', payerSignatureAttachmentId: source.file.id, approverUserId: `${TAG}-finance`, approverSignatureAttachmentId: source.file.id } });
    for (const patch of [{ amount: '99.00' }, { incurredDate: new Date('2026-08-23T00:00:00Z') }]) {
      await assert.rejects(() => resolveReimbursementSourceLines(source.db, companyId, source.payer, branchId, 'THB', [{ ...source.input, ...patch }]), error => errorCode(error) === 'reimbursement_source_fields_mismatch');
    }
    await source.db.expenseRecord.update({ where: { id: source.expense.id }, data: { whtAmount: '3' } });
    await assert.rejects(() => read(), error => errorCode(error) === 'reimbursement_source_tax_review_required');
  });

  it('requires draft refresh after source edits and locks ordinary expense edits after submit', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const source = await sourceFixture(false);
    let request = await claimFromSource(source);
    const expenses = new PrismaExpenseRepository({ client: source.db } as any);
    await expenses.updateExpense({ companyId, id: source.expense.id, updatedByUserId: source.payer, vendorNameSnapshot: 'ร้านที่แก้ชื่อแล้ว' });
    await assert.rejects(() => source.db.$transaction(tx => assertReimbursementSources(tx, request)), error => errorCode(error) === 'reimbursement_source_changed');
    const fresh = await readReimbursementSource(source.db, companyId, source.payer, branchId, 'THB', source.expense.id);
    const refreshedLines = await resolveReimbursementSourceLines(source.db, companyId, source.payer, branchId, 'THB', [{ ...source.input, sourceExpenseUpdatedAt: fresh.expenseUpdatedAt }]);
    request = await repos[0]!.updateDraftRequest(companyId, request.id, request.updatedAt, { updatedByUserId: source.payer }, refreshedLines);
    const submission = submitInput(request);
    submission.evidence.expenseIds = [source.expense.id];
    await repos[0]!.submitDraftAtomic(submission);
    await assert.rejects(() => expenses.updateExpense({ companyId, id: source.expense.id, updatedByUserId: source.payer, vendorNameSnapshot: 'ห้ามแก้ระหว่างเบิก' }), error => errorCode(error) === 'substitute_source_has_live_claim');
    assert.equal((await source.db.expenseRecord.findUniqueOrThrow({ where: { id: source.expense.id } })).vendorNameSnapshot, 'ร้านที่แก้ชื่อแล้ว');
  });

  it('prevents claiming one expense twice through different receipt files and catches a newly linked manual receipt', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const source = await sourceFixture(false);
    await assert.rejects(() => resolveReimbursementSourceLines(source.db, companyId, source.payer, branchId, 'THB', [source.input, { ...source.input, lineNo: 2, linkedExpenseId: undefined, attachmentId: source.file.id }]), error => errorCode(error) === 'expense_already_claimed');
    await assert.rejects(() => source.db.$transaction(tx => assertReimbursementSources(tx, { companyId, branchId, currency: 'THB', requesterUserId: source.payer, lines: [{ ...source.input, linkedExpenseId: null, attachmentId: source.file.id }] })), error => errorCode(error) === 'reimbursement_source_review_required');
    const first = await claimFromSource(source); const second = await claimFromSource(source);
    const submissions = [first, second].map(request => ({ ...submitInput(request), evidence: { expenseIds: [source.expense.id], attachmentIds: [] } }));
    const outcomes = await Promise.allSettled(submissions.map((input, index) => repos[index]!.submitDraftAtomic(input)));
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    const failure = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    assert.match(errorMessage(failure.reason) ?? JSON.stringify(failure.reason.getResponse?.()), /already_claimed/);
  });

  it('rejects source changes at claim-born confirmation, without attaching the original receipt twice', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const source = await sourceFixture();
    const request = await claimFromSource(source);
    await source.db.reimbursementRequest.update({ where: { id: request.id }, data: { status: 'FINANCE_REVIEW' } });
    const projection = { companyId, branchId, currency: 'THB', netPayableAmount: '100', sourceReimbursementRequestId: request.id, sourceReimbursementLineId: request.lines![0]!.id,
      sourceChannelMetadataJson: { reimbursementSource: request.lines![0]!.sourceExpenseSnapshot } };
    await source.db.$transaction(tx => assertProjectionSource(tx, companyId, projection));
    await source.db.attachmentObject.update({ where: { id: source.file.id }, data: { checksumSha256: 'c'.repeat(64) } });
    await assert.rejects(() => source.db.$transaction(tx => assertProjectionSource(tx, companyId, projection)), error => errorCode(error) === 'reimbursement_source_not_issued');
  });

  it('retains a finance-owned upload for the employee while rejecting unvalidated or changed files', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const source = await sourceFixture(false);
    await source.db.attachmentLink.deleteMany({ where: { attachmentId: source.file.id } });
    await source.db.attachmentObject.update({ where: { id: source.file.id }, data: { uploadedByUserId: `${TAG}-finance` } });
    const files = new PrismaAttachmentRepository({ client: source.db } as any);
    const evidence = new ReimbursementEvidenceService(files, new PrismaExpenseRepository({ client: source.db } as any));
    const ctx = { companyId, userId: source.payer, scopes: {}, permissions: ['reimbursement.submit'] } as any;
    const refs = [{ attachmentId: source.file.id }];
    await assert.rejects(() => evidence.validate(ctx, source.payer, refs, branchId), /invalid_primary_attachment/);
    await evidence.validate({ ...ctx, userId: `${TAG}-finance`, permissions: ['reimbursement.finance_review'] }, source.payer, refs, branchId);
    const lines = await resolveReimbursementSourceLines(source.db, companyId, source.payer, branchId, 'THB', [{ ...source.input, linkedExpenseId: null, attachmentId: source.file.id }]);
    const request = await repos[0]!.createRequest({ companyId, branchId, requesterUserId: source.payer, createdByUserId: `${TAG}-finance`,
      requesterDisplayNameSnapshot: 'พนักงาน', reason: 'การเงินแนบให้พนักงาน', currency: 'THB', categoryKey: 'travel', amount: '100.0000', incurredDate: source.input.incurredDate, receiptRequirementStatus: 'ATTACHED', lines });
    const retained = new Map(request.lines!.map(line => [line.attachmentSnapshot!.id, line.attachmentSnapshot!.uploadedByUserId]));
    await evidence.validate(ctx, source.payer, refs, branchId, retained);
    await source.db.$transaction(tx => assertReimbursementSources(tx, request));
    const input = submitInput(request, { attachmentIds: [source.file.id] });
    await repos[0]!.submitDraftAtomic(input);
    await assert.rejects(() => files.markDeleted({ companyId, id: source.file.id }), error => errorCode(error) === 'substitute_source_has_live_claim');
    await source.db.attachmentObject.update({ where: { id: source.file.id }, data: { checksumSha256: 'd'.repeat(64) } });
    await assert.rejects(() => source.db.$transaction(tx => assertReimbursementSources(tx, request)), error => errorCode(error) === 'reimbursement_source_changed');
  });

  it('freezes generic file deletion and new evidence links after a source is submitted', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const source = await sourceFixture(false);
    const request = await claimFromSource(source);
    await repos[0]!.submitDraftAtomic({ ...submitInput(request), evidence: { expenseIds: [source.expense.id], attachmentIds: [] } });
    const files = new PrismaAttachmentRepository({ client: source.db } as any);
    await assert.rejects(() => files.markDeleted({ companyId, id: source.file.id }), error => errorCode(error) === 'substitute_source_has_live_claim');
    const { id: _id, metadataJson: _metadata, ...copy } = source.file;
    const extra = await source.db.attachmentObject.create({ data: { ...copy, objectKey: `${copy.objectKey}-extra` } });
    await assert.rejects(() => files.linkToTarget({ companyId, attachmentId: extra.id, targetType: 'expense.record', targetId: source.expense.id, purpose: 'expense.payment.evidence', linkedByUserId: source.payer }), error => errorCode(error) === 'substitute_source_has_live_claim');
    assert.equal((await source.db.attachmentObject.findUniqueOrThrow({ where: { id: source.file.id } })).status, 'ACTIVE');
    assert.equal(await source.db.attachmentLink.count({ where: { attachmentId: extra.id } }), 0);
  });

  it('confirms source-backed gross costs and pays the employee once without settling the original expense twice', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const source = await sourceFixture();
    let request = await claimFromSource(source);
    // Policy/route unit tests exercise the decision. Here use a recorded finance decision
    // to exercise the actual database materialization, expense confirmation and payout.
    await source.db.reimbursementRequest.update({ where: { id: request.id }, data: { status: 'FINANCE_REVIEW', financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: `${TAG}-finance` } });
    request = (await repos[0]!.findRequestById(companyId, request.id))!;
    const items = new MaterializeClaimExpensesService().buildItems(request);
    const [projection] = await repos[0]!.prepareClaimProjections({ companyId, requestId: request.id, decisionKind: 'FINANCE', decisionActorUserId: `${TAG}-finance`, scopes: {}, items });
    const expenses = new PrismaExpenseRepository({ client: source.db } as any);
    const confirm = new ConfirmExpenseUseCase(expenses, { log: async () => undefined } as any, { resolveLines: async () => [] } as any,
      {} as any);
    const confirmationCtx = { companyId, userId: `${TAG}-finance`, permissions: [], scopes: {}, roles: [], authProvider: 'dev' } as any;
    await assert.rejects(() => confirm.executeForReimbursement(confirmationCtx, projection!.expenseId,
      { reimbursementRequestId: request.id, reimbursementLineId: 'wrong-line', branchId, allowMissingReceiptWithReason: false }),
      /reimbursement_projection_authority_mismatch/);
    const projectionSource = (await expenses.findByIdWithRelations(companyId, projection!.expenseId))!;
    const confirmInput = {
      companyId, id: projection!.expenseId, actorUserId: `${TAG}-finance`, expectedUpdatedAt: projectionSource.updatedAt,
      expectedSourceChecksum: expenseTaxSourceChecksum(projectionSource), postingStatus: 'pending' as const, vendorSnapshotJson: null,
      outboxEvent: { eventKey: `claim-review:${projection!.expenseId}`, payloadJson: {} },
    };
    await assert.rejects(confirm.execute({ companyId, userId: `${TAG}-finance`, permissions: ['expense.confirm'], scopes: {}, authProvider: 'dev' } as any,
      projection!.expenseId), error => errorCode(error) === 'EXPENSE_EVIDENCE_REVIEW_REQUIRED');
    await assert.rejects(expenses.finalizeAndConfirmExpenseCas(confirmInput, async () => []),
      error => errorCode(error) === 'EXPENSE_EVIDENCE_REVIEW_REQUIRED');
    await assert.rejects(expenses.finalizeAndConfirmExpenseCas({ ...confirmInput,
      reimbursementReview: { requestId: request.id, lineId: 'wrong-line' } }, async () => []), /reimbursement_projection_authority_mismatch/);
    assert.equal(await source.db.outboxEvent.count({ where: { companyId, aggregateId: projection!.expenseId, eventType: 'expense.confirmed' } }), 0);
    const confirmed = await confirm.executeForReimbursement({ companyId, userId: `${TAG}-finance`, permissions: [], scopes: {}, roles: [], authProvider: 'dev' } as any, projection!.expenseId,
      { reimbursementRequestId: request.id, reimbursementLineId: request.lines![0]!.id, branchId, allowMissingReceiptWithReason: false });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(await source.db.auditLog.count({ where: { companyId, targetId: projection!.expenseId, action: 'expense.confirm' } }), 1);
    assert.equal(confirmed.primaryAttachmentId, null);
    const cost = await source.db.expenseLine.findMany({ where: { expenseId: projection!.expenseId }, orderBy: { lineNumber: 'asc' } });
    assert.deepEqual(cost.map(line => [line.lineTotalAmount.toString(), line.accountHintKey]), [['60', 'travel'], ['40', 'delivery']]);
    await source.db.reimbursementRequest.update({ where: { id: request.id }, data: { status: 'READY_FOR_PAYMENT' } });
    const input = { companyId, reimbursementRequestId: request.id, idempotencyKey: `${TAG}-pay-${request.id}`, paidAmount: '100.0000', currency: 'THB', paymentMethod: 'CASH', paidAt: new Date(), paidByUserId: `${TAG}-finance` };
    const paid = await repos[0]!.recordPaymentAtomic(input);
    assert.equal(paid.created, true);
    assert.equal(paid.request.status, 'PAID');
    assert.equal((await repos[0]!.recordPaymentAtomic(input)).created, false);
    assert.equal(await source.db.reimbursementPayment.count({ where: { reimbursementRequestId: request.id } }), 1);
    const original = await source.db.expenseRecord.findUniqueOrThrow({ where: { id: source.expense.id } });
    assert.equal(original.status, 'NEEDS_REVIEW');
    assert.equal(original.paidAmount.toString(), '0');
    assert.equal((await source.db.expenseRecord.findUniqueOrThrow({ where: { id: projection!.expenseId } })).paidAmount.toString(), '100');
    assert.equal(await source.db.expensePayment.count({ where: { companyId } }), 0);
    assert.equal((await repos[0]!.findRequestById(companyId, request.id))!.lines![0]!.linkedExpenseId, source.expense.id);
  });

  // ---- Payment slips (claim payout Phase 2): what only a real database can prove ----

  /** A claim at the payment step with its confirmed expense projection, the way approval leaves it. */
  async function payableClaim() {
    const source = await sourceFixture();
    let request = await claimFromSource(source);
    await source.db.reimbursementRequest.update({ where: { id: request.id }, data: { status: 'FINANCE_REVIEW', financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: `${TAG}-finance` } });
    request = (await repos[0]!.findRequestById(companyId, request.id))!;
    const items = new MaterializeClaimExpensesService().buildItems(request);
    const [projection] = await repos[0]!.prepareClaimProjections({ companyId, requestId: request.id, decisionKind: 'FINANCE', decisionActorUserId: `${TAG}-finance`, scopes: {}, items });
    const expenses = new PrismaExpenseRepository({ client: source.db } as any);
    const confirm = new ConfirmExpenseUseCase(expenses, { log: async () => undefined } as any, { resolveLines: async () => [] } as any, {} as any);
    await confirm.executeForReimbursement({ companyId, userId: `${TAG}-finance`, permissions: [], scopes: {}, roles: [], authProvider: 'dev' } as any, projection!.expenseId,
      { reimbursementRequestId: request.id, reimbursementLineId: request.lines![0]!.id, branchId, allowMissingReceiptWithReason: false });
    await source.db.reimbursementRequest.update({ where: { id: request.id }, data: { status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID' } });
    return { db: source.db, requestId: request.id, projectionId: projection!.expenseId };
  }

  let fileSequence = 0;
  /** The payer's completed slip upload for a claim, as the slip upload endpoint leaves it. */
  async function slipUpload(requestId: string, overrides: Record<string, unknown> = {}) {
    return clients[0]!.attachmentObject.create({ data: {
      companyId, branchId, storageProvider: 'LOCAL', bucket: 'test', objectKey: `${TAG}/slip-${++fileSequence}`, originalFileName: 'slip.jpg',
      mimeType: 'image/jpeg', byteSize: 250_000, checksumSha256: 'e'.repeat(64), uploadedByUserId: `${TAG}-finance`, status: 'ACTIVE',
      metadataJson: { generatedFor: 'reimbursement_payment_slip', requestId }, ...overrides,
    } });
  }

  const transfer = (requestId: string, key: string, slipAttachmentId?: string) => ({
    companyId, reimbursementRequestId: requestId, idempotencyKey: `${TAG}-${key}`, paidAmount: '100.0000', currency: 'THB',
    paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-1', paidAt: new Date('2026-10-01T03:00:00.000Z'), paidByUserId: `${TAG}-finance`,
    ...(slipAttachmentId && { slipAttachmentId }),
  });

  const paymentsOf = (requestId: string) => clients[0]!.reimbursementPayment.findMany({ where: { companyId, reimbursementRequestId: requestId }, orderBy: { createdAt: 'asc' } });
  async function slipLinksOf(requestId: string) {
    const paymentIds = (await paymentsOf(requestId)).map((payment) => payment.id);
    const links = await clients[0]!.attachmentLink.findMany({
      where: { companyId, targetType: 'reimbursement_payment', purpose: 'reimbursement.payment.slip', targetId: { in: paymentIds } },
      orderBy: { createdAt: 'asc' },
    });
    return links.map((link) => [link.attachmentId, link.targetId]);
  }
  /** Payments that name a slip the links do not carry: the invariant the record transaction keeps. */
  const paymentsWithoutTheirSlipLink = () => clients[0]!.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "ReimbursementPayment" p
    WHERE p."companyId" = ${companyId} AND p."slipAttachmentId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "AttachmentLink" l
      WHERE l."companyId" = p."companyId" AND l."attachmentId" = p."slipAttachmentId" AND l."targetId" = p.id
        AND l."targetType" = 'reimbursement_payment' AND l.purpose = 'reimbursement.payment.slip')`;

  it('commits a transfer and its slip link together, and neither when either fails', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const slip = await slipUpload(claim.requestId);

    // No slip, and a slip that belongs to another claim: refused under the payment lock, nothing written.
    await assert.rejects(() => repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'no-slip')), /payment_slip_required/);
    const foreign = await slipUpload('another-claim');
    await assert.rejects(() => repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'foreign-slip', foreign.id)), /payment_slip_invalid/);

    // The slip link fails AFTER the payment row is written: the real transaction must take the payment back with it.
    const failingLinks = new Proxy(clients[0]!, { get(client, property) {
      if (property !== '$transaction') return Reflect.get(client, property);
      return (work: (tx: any) => Promise<unknown>, options: any) => client.$transaction((tx: any) => work(new Proxy(tx, { get(inner, name) {
        if (name === 'attachmentLink') {
          return new Proxy(inner.attachmentLink, { get(links, method) {
            return method === 'create' ? async () => { throw new Error('slip link write failed'); } : Reflect.get(links, method);
          } });
        }
        const value = Reflect.get(inner, name);
        return typeof value === 'function' ? value.bind(inner) : value;
      } })), options);
    } });
    const failingRepo = new PrismaReimbursementRepository({ client: failingLinks } as any, new PrismaDocumentSequenceRepository({ client: clients[0]! } as any));
    await assert.rejects(() => failingRepo.recordPaymentAtomic(transfer(claim.requestId, 'link-fails', slip.id)), /slip link write failed/);

    assert.deepEqual(await paymentsOf(claim.requestId), [], 'no payment row survives any of the three failures');
    assert.deepEqual(await slipLinksOf(claim.requestId), []);
    const untouched = await claim.db.reimbursementRequest.findUniqueOrThrow({ where: { id: claim.requestId } });
    assert.deepEqual([untouched.status, untouched.paymentStatus, untouched.paymentTotalAmount.toString(), untouched.outstandingAmount.toString()], ['READY_FOR_PAYMENT', 'UNPAID', '0', '100']);
    assert.equal((await claim.db.expenseRecord.findUniqueOrThrow({ where: { id: claim.projectionId } })).paymentStatus, 'UNPAID');

    // The same request, with nothing failing: both rows, one transaction.
    const paid = await repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'link-fails', slip.id));
    assert.equal(paid.created, true);
    assert.deepEqual(paid.slip, { attachmentId: slip.id, source: 'UPLOAD', uploadedByUserId: `${TAG}-finance`, declarationWithdrawn: false });
    const [payment] = await paymentsOf(claim.requestId);
    assert.deepEqual([payment!.paymentMethod, payment!.paymentReference, payment!.slipAttachmentId, payment!.slipChecksumSha256, payment!.status],
      ['BANK_TRANSFER', 'TXN-1', slip.id, 'e'.repeat(64), 'RECORDED']);
    assert.deepEqual(await slipLinksOf(claim.requestId), [[slip.id, payment!.id]]);
    assert.equal(paid.request.status, 'PAID');
    assert.deepEqual(await paymentsWithoutTheirSlipLink(), []);
    assert.deepEqual(await repos[0]!.listPaymentSlips(companyId, [payment!.id]), { [payment!.id]: [{ attachmentId: slip.id, attachedAt: (await clients[0]!.attachmentLink.findFirstOrThrow({ where: { attachmentId: slip.id } })).createdAt }] });

    // The two lookups the slip endpoints make, against real JSONB metadata and the real link relation.
    assert.deepEqual(await repos[0]!.findPaymentSlipUpload(companyId, slip.id, `${TAG}-finance`, claim.requestId), { id: slip.id, status: 'ACTIVE' });
    assert.equal(await repos[0]!.findPaymentSlipUpload(companyId, slip.id, `${TAG}-user`, claim.requestId), null, 'another person cannot complete this upload');
    assert.equal(await repos[0]!.findPaymentSlipUpload(companyId, slip.id, `${TAG}-finance`, 'another-claim'), null, 'nor can it be completed against another claim');
    const file = await repos[0]!.findPaymentSlipFile(companyId, payment!.id, slip.id);
    assert.deepEqual([file?.id, file?.bucket, file?.mimeType, file?.originalFileName], [slip.id, 'test', 'image/jpeg', 'slip.jpg']);
    assert.equal(await repos[0]!.findPaymentSlipFile(companyId, payment!.id, foreign.id), null, 'a file that is not this payment\'s slip');
    assert.equal(await repos[0]!.findPaymentSlipFile(companyId, 'another-payment', slip.id), null, 'the slip, asked for under another payment');
  });

  it('gives two concurrent requests for the same transfer one payment and one slip link', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const slip = await slipUpload(claim.requestId);
    const input = transfer(claim.requestId, 'race', slip.id);

    const results = await Promise.allSettled([repos[0]!.recordPaymentAtomic(input), repos[1]!.recordPaymentAtomic(input)]);
    const fulfilled = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    assert.equal(fulfilled.filter((result) => result.created).length, 1, 'exactly one request records the payment');
    // The other either reads the committed payment back or is turned away to retry; it never pays again.
    for (const result of fulfilled) assert.equal(result.payment.slipAttachmentId, slip.id);
    assert.equal((await paymentsOf(claim.requestId)).length, 1);
    assert.equal((await slipLinksOf(claim.requestId)).length, 1);
    assert.equal((await repos[1]!.recordPaymentAtomic(input)).created, false, 'the retry is the same payment');
    assert.equal((await paymentsOf(claim.requestId)).length, 1);
  });

  it('gives two payers with two different slips one payment, and leaves the loser\'s slip unlinked', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const first = await slipUpload(claim.requestId);
    const second = await slipUpload(claim.requestId);

    const results = await Promise.allSettled([
      repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'payer-a', first.id)),
      repos[1]!.recordPaymentAtomic(transfer(claim.requestId, 'payer-b', second.id)),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const [payment] = await paymentsOf(claim.requestId);
    assert.equal((await paymentsOf(claim.requestId)).length, 1);
    assert.deepEqual(await slipLinksOf(claim.requestId), [[payment!.slipAttachmentId, payment!.id]]);
    assert.deepEqual(await paymentsWithoutTheirSlipLink(), []);
    const request = await claim.db.reimbursementRequest.findUniqueOrThrow({ where: { id: claim.requestId } });
    assert.deepEqual([request.status, request.paymentTotalAmount.toString(), request.outstandingAmount.toString()], ['PAID', '100', '0']);
  });

  it('refuses a replay that names a different slip and keeps what was recorded', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const slip = await slipUpload(claim.requestId);
    const other = await slipUpload(claim.requestId);
    await repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'replay', slip.id));

    await assert.rejects(() => repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'replay', other.id)), /reimbursement_payment_idempotency_conflict/);
    await assert.rejects(() => repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'replay')), /reimbursement_payment_idempotency_conflict/);
    // A fresh key cannot slip a second payment in either: the claim is already paid.
    await assert.rejects(() => repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'second', other.id)), /reimbursement_payment_already_recorded/);
    const [payment] = await paymentsOf(claim.requestId);
    assert.equal(payment!.slipAttachmentId, slip.id);
    assert.deepEqual(await slipLinksOf(claim.requestId), [[slip.id, payment!.id]]);
  });

  it('keeps the slip on a voided payment, and a new payment carries a link of its own', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const slip = await slipUpload(claim.requestId);
    const first = await repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'before-void', slip.id));

    const voided = await repos[0]!.voidPaymentTrueReversal(companyId, claim.requestId, first.payment.id, `${TAG}-finance`, 'บันทึกเลขอ้างอิงผิด');
    assert.deepEqual([voided.request.status, voided.request.paymentStatus, Number(voided.request.outstandingAmount), Number(voided.request.paymentTotalAmount)], ['READY_FOR_PAYMENT', 'UNPAID', 100, 0]);
    assert.deepEqual([voided.payment.status, voided.payment.slipAttachmentId, voided.payment.slipChecksumSha256], ['VOIDED', slip.id, 'e'.repeat(64)]);
    assert.deepEqual(await slipLinksOf(claim.requestId), [[slip.id, first.payment.id]], 'the void removes no slip');
    assert.equal((await claim.db.expenseRecord.findUniqueOrThrow({ where: { id: claim.projectionId } })).paymentStatus, 'UNPAID');

    // The old key is not a way back to "paid", and a new transfer is refused until it names a slip.
    await assert.rejects(() => repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'before-void', slip.id)), /reimbursement_payment_idempotency_conflict/);
    await assert.rejects(() => repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'after-void')), /payment_slip_required/);

    // The same transfer recorded again: the earlier slip of this claim serves, on a link of the new payment's own.
    const second = await repos[1]!.recordPaymentAtomic({ ...transfer(claim.requestId, 'after-void', slip.id), paymentReference: 'TXN-2' });
    assert.equal(second.slip?.source, 'PREVIOUS_SLIP');
    assert.deepEqual(await slipLinksOf(claim.requestId), [[slip.id, first.payment.id], [slip.id, second.payment.id]]);
    assert.deepEqual((await paymentsOf(claim.requestId)).map((payment) => [payment.status, payment.paymentReference, payment.slipAttachmentId]), [
      ['VOIDED', 'TXN-1', slip.id], ['RECORDED', 'TXN-2', slip.id],
    ]);
    const request = await claim.db.reimbursementRequest.findUniqueOrThrow({ where: { id: claim.requestId } });
    assert.deepEqual([request.status, request.paymentStatus, request.paymentTotalAmount.toString(), request.outstandingAmount.toString()], ['PAID', 'PAID', '100', '0']);
    assert.deepEqual(await paymentsWithoutTheirSlipLink(), []);
  });

  it('cannot be raced by a generic delete of the slip file, in either order', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const files = new PrismaAttachmentRepository({ client: clients[1]! } as any);
    const cash = await repos[0]!.recordPaymentAtomic({ ...transfer(claim.requestId, 'cash-race'), paymentMethod: 'CASH', paymentReference: undefined });
    const proof = (tx: unknown, attachmentId: string) => (repos[0] as any).resolvePaymentSlipLocked(tx, {
      companyId, requestId: claim.requestId, attachmentId, actorUserId: `${TAG}-finance`,
    });

    // Order 1: the link is being written when the delete starts. The delete waits for it, then finds the slip.
    const linked = await slipUpload(claim.requestId);
    let slipIsLinked!: () => void;
    let commit!: () => void;
    const linkedSignal = new Promise<void>((resolve) => { slipIsLinked = resolve; });
    const commitSignal = new Promise<void>((resolve) => { commit = resolve; });
    const linking = clients[0]!.$transaction(async (tx) => {
      await proof(tx, linked.id);
      await tx.attachmentLink.create({ data: { companyId, attachmentId: linked.id, targetType: 'reimbursement_payment', targetId: cash.payment.id, purpose: 'reimbursement.payment.slip', linkedByUserId: `${TAG}-finance` } });
      slipIsLinked();
      await commitSignal;
    }, { timeout: 20_000 });
    await linkedSignal;
    let deleteSettled = false;
    const deleting = files.markDeleted({ companyId, id: linked.id }).finally(() => { deleteSettled = true; });
    deleting.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(deleteSettled, false, 'the delete is waiting on the slip link, not deciding without it');
    commit();
    await linking;
    await assert.rejects(deleting, (error) => errorCode(error) === 'reimbursement_payment_slip_retained');
    assert.equal((await clients[0]!.attachmentObject.findUniqueOrThrow({ where: { id: linked.id } })).status, 'ACTIVE');

    // Order 2: the delete commits after the payment transaction took its snapshot. That transaction
    // fails and can be retried; it never links a file that is already gone.
    const deleted = await slipUpload(claim.requestId);
    await assert.rejects(() => clients[0]!.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      await files.markDeleted({ companyId, id: deleted.id });
      await proof(tx, deleted.id);
    }, { isolationLevel: 'Serializable', timeout: 20_000 }),
    // PostgreSQL's serialization failure, raised by the row lock: the stale snapshot still showed the file as live.
    (error: any) => error?.meta?.driverAdapterError?.cause?.originalCode === '40001');
    assert.equal((await clients[0]!.attachmentObject.findUniqueOrThrow({ where: { id: deleted.id } })).status, 'DELETED');
    assert.equal(await clients[0]!.attachmentLink.count({ where: { attachmentId: deleted.id } }), 0);
    // The retry reads the truth and says the file cannot be used.
    await assert.rejects(() => repos[0]!.attachPaymentSlipAtomic({ companyId, requestId: claim.requestId, paymentId: cash.payment.id, attachmentId: deleted.id, actorUserId: `${TAG}-finance` }), /payment_slip_invalid/);
  });

  it('moves a misfiled signed copy to be the slip in one transaction, and the generic file paths then refuse it', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    await claim.db.reimbursementRequest.update({ where: { id: claim.requestId }, data: { requestNo: `RB-${TAG}-${++fileSequence}` } });
    // Recorded as cash before the slip existed: the six production claims, once their payment is recorded.
    const cash = await repos[0]!.recordPaymentAtomic({ ...transfer(claim.requestId, 'cash'), paymentMethod: 'CASH', paymentReference: undefined });
    assert.deepEqual([cash.payment.slipAttachmentId, cash.payment.slipChecksumSha256], [undefined, undefined]);
    assert.deepEqual(await slipLinksOf(claim.requestId), []);

    // The slip, attached through the signed-copy uploader with the paper declaration.
    const misfiled = await slipUpload(claim.requestId, { uploadedByUserId: `${TAG}-user`, metadataJson: { source: 'web' }, byteSize: 12_000_000, mimeType: 'application/pdf', originalFileName: 'slip.pdf' });
    await repos[0]!.linkSignedClaimFormCopy(companyId, claim.requestId, misfiled.id, `${TAG}-user`, {
      requestId: claim.requestId, requestNo: 'RB', acknowledgedByUserId: `${TAG}-user`, acknowledgedAt: '2026-10-01T02:00:00.000Z', checksumSha256: misfiled.checksumSha256,
    });
    assert.deepEqual((await repos[0]!.listSignedClaimFormCopies(companyId, claim.requestId)).map((copy) => [copy.attachmentId, copy.acknowledged]), [[misfiled.id, true]]);
    const files = new PrismaAttachmentRepository({ client: claim.db } as any);
    assert.equal(await files.isReimbursementPaymentSlip({ id: misfiled.id, companyId }), false);

    const moved = await repos[0]!.attachPaymentSlipAtomic({ companyId, requestId: claim.requestId, paymentId: cash.payment.id, attachmentId: misfiled.id, actorUserId: `${TAG}-finance` });
    assert.deepEqual(moved, { created: true, slip: { attachmentId: misfiled.id, source: 'SIGNED_COPY', uploadedByUserId: `${TAG}-user`, declarationWithdrawn: true } });

    // Out of the signed copies, declaration gone from the stored metadata (the rest kept), linked as the slip.
    assert.deepEqual(await repos[0]!.listSignedClaimFormCopies(companyId, claim.requestId), []);
    const stored = await claim.db.attachmentObject.findUniqueOrThrow({ where: { id: misfiled.id } });
    assert.deepEqual([stored.status, stored.metadataJson], ['ACTIVE', { source: 'web' }]);
    assert.deepEqual((await claim.db.attachmentLink.findMany({ where: { attachmentId: misfiled.id } })).map((link) => [link.targetType, link.targetId, link.purpose, link.linkedByUserId]),
      [['reimbursement_payment', cash.payment.id, 'reimbursement.payment.slip', `${TAG}-finance`]]);
    // The payment row is history: attaching later never rewrites what it was recorded with.
    assert.equal((await paymentsOf(claim.requestId))[0]!.slipAttachmentId, null);

    // Payment evidence now: no generic download, no generic delete, no way back into the signed copies.
    assert.equal(await files.isReimbursementPaymentSlip({ id: misfiled.id, companyId }), true);
    await assert.rejects(() => files.markDeleted({ companyId, id: misfiled.id }), (error) => errorCode(error) === 'reimbursement_payment_slip_retained');
    assert.equal((await claim.db.attachmentObject.findUniqueOrThrow({ where: { id: misfiled.id } })).status, 'ACTIVE');
    // Doing it again changes nothing.
    assert.deepEqual(await repos[1]!.attachPaymentSlipAtomic({ companyId, requestId: claim.requestId, paymentId: cash.payment.id, attachmentId: misfiled.id, actorUserId: `${TAG}-finance` }), { created: false });
    assert.equal((await slipLinksOf(claim.requestId)).length, 1);
  });

  // ---- A slip is an exclusive link (review S1, 2026-10-01) ----

  /** An ordinary upload of the requester's, attached to a claim through the signed-copy uploader. */
  async function signedCopyOf(requestId: string, declared = false) {
    const file = await slipUpload(requestId, { uploadedByUserId: `${TAG}-user`, metadataJson: { source: 'web' }, mimeType: 'application/pdf', originalFileName: 'scan.pdf' });
    await repos[0]!.linkSignedClaimFormCopy(companyId, requestId, file.id, `${TAG}-user`, declared ? {
      requestId, requestNo: 'RB', acknowledgedByUserId: `${TAG}-user`, acknowledgedAt: '2026-10-01T02:00:00.000Z', checksumSha256: file.checksumSha256,
    } : undefined);
    return file;
  }
  const linksOf = async (attachmentId: string) => (await clients[0]!.attachmentLink.findMany({ where: { attachmentId }, orderBy: { createdAt: 'asc' } }))
    .map((link) => [link.targetType, link.targetId, link.purpose]);
  const moveToSlip = (requestId: string, paymentId: string, attachmentId: string, repo = repos[0]!) =>
    repo.attachPaymentSlipAtomic({ companyId, requestId, paymentId, attachmentId, actorUserId: `${TAG}-finance` });
  const cashPayment = (requestId: string, key: string) =>
    repos[0]!.recordPaymentAtomic({ ...transfer(requestId, key), paymentMethod: 'CASH', paymentReference: undefined });

  /**
   * A repository whose next transaction is interleaved: `between` runs on another connection right
   * after that transaction's first statement, when its snapshot is already taken. This is the order
   * a lock alone cannot fix: the other writer commits first, and the payment still reads the past.
   */
  function interleavedRepo(between: () => Promise<unknown>) {
    const client = new Proxy(clients[0]!, { get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property);
      return (work: (tx: any) => Promise<unknown>, options: any) => target.$transaction((tx: any) => {
        let fired = false;
        return work(new Proxy(tx, { get(inner, name) {
          const value = Reflect.get(inner, name);
          if (name === '$executeRaw') {
            return async (...args: unknown[]) => {
              const result = await value.apply(inner, args);
              if (!fired) { fired = true; await between(); }
              return result;
            };
          }
          return typeof value === 'function' ? value.bind(inner) : value;
        } }));
      }, { ...options, timeout: 20_000 });
    } });
    return new PrismaReimbursementRepository({ client } as any, new PrismaDocumentSequenceRepository({ client: clients[0]! } as any));
  }
  const paymentChanged = (error: any) => error?.getStatus?.() === 409 && error.message === 'reimbursement_payment_state_changed';

  it('keeps a slip exclusive: never also a receipt, a signed copy or another claim\'s file', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const files = new PrismaAttachmentRepository({ client: clients[1]! } as any);
    const asReceipt = (attachmentId: string) => files.linkToTarget({
      companyId, attachmentId, targetType: 'expense.record', targetId: claim.projectionId, purpose: 'expense.receipt.supporting', linkedByUserId: `${TAG}-finance`,
    });
    const refusedAsSlip = /payment slip cannot be attached to anything else/;

    // A slip upload no payment carries yet: the tag alone keeps it out of every other list.
    const upload = await slipUpload(claim.requestId);
    await assert.rejects(() => asReceipt(upload.id), refusedAsSlip);
    await assert.rejects(() => repos[0]!.linkSignedClaimFormCopy(companyId, claim.requestId, upload.id, `${TAG}-finance`), refusedAsSlip);
    assert.deepEqual(await linksOf(upload.id), []);

    // What may not become a slip: a file that is already evidence of something else.
    const cash = await cashPayment(claim.requestId, 'exclusive-cash');
    const alsoAReceipt = await signedCopyOf(claim.requestId);
    await clients[0]!.attachmentLink.create({ data: { companyId, attachmentId: alsoAReceipt.id, targetType: 'expense.record', targetId: claim.projectionId, purpose: 'expense.receipt.supporting', linkedByUserId: `${TAG}-user` } });
    const alsoAnotherClaims = await signedCopyOf(claim.requestId);
    await repos[0]!.linkSignedClaimFormCopy(companyId, 'another-claim', alsoAnotherClaims.id, `${TAG}-user`);
    const alsoALineReceipt = await signedCopyOf(claim.requestId);
    await clients[0]!.reimbursementLine.updateMany({ where: { companyId, reimbursementRequestId: claim.requestId }, data: { attachmentId: alsoALineReceipt.id } });
    for (const file of [alsoAReceipt, alsoAnotherClaims, alsoALineReceipt]) {
      const before = await linksOf(file.id);
      await assert.rejects(() => moveToSlip(claim.requestId, cash.payment.id, file.id), /payment_slip_invalid/);
      await assert.rejects(() => repos[0]!.assertPaymentSlipUsable({ companyId, requestId: claim.requestId, attachmentId: file.id, actorUserId: `${TAG}-finance` }), /payment_slip_invalid/);
      assert.deepEqual(await linksOf(file.id), before, 'what it is elsewhere is untouched');
    }
    assert.deepEqual(await slipLinksOf(claim.requestId), []);

    // A copy that is only this claim's becomes the slip, and from then on is nothing else.
    const onlyThisClaims = await signedCopyOf(claim.requestId, true);
    assert.equal((await moveToSlip(claim.requestId, cash.payment.id, onlyThisClaims.id)).created, true);
    assert.deepEqual(await linksOf(onlyThisClaims.id), [['reimbursement_payment', cash.payment.id, 'reimbursement.payment.slip']]);
    await assert.rejects(() => asReceipt(onlyThisClaims.id), refusedAsSlip);
    for (const requestId of [claim.requestId, 'another-claim']) {
      await assert.rejects(() => repos[1]!.linkSignedClaimFormCopy(companyId, requestId, onlyThisClaims.id, `${TAG}-user`), refusedAsSlip);
    }
    assert.deepEqual(await linksOf(onlyThisClaims.id), [['reimbursement_payment', cash.payment.id, 'reimbursement.payment.slip']]);
    assert.deepEqual(await repos[0]!.listSignedClaimFormCopies(companyId, 'another-claim').then((copies) => copies.map((copy) => copy.attachmentId)), [alsoAnotherClaims.id]);
  });

  it('cannot be raced by a signed-copy link of the same file, in either order', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const cash = await cashPayment(claim.requestId, 'copy-race-cash');
    const copyOntoAnotherClaim = (attachmentId: string) => repos[1]!.linkSignedClaimFormCopy(companyId, 'another-claim', attachmentId, `${TAG}-user`);

    // Order 1: the slip link is being written when the signed-copy link starts. The copy waits on
    // the file's lock, then looks again inside its own transaction and finds a slip.
    const first = await signedCopyOf(claim.requestId);
    let slipIsLinked!: () => void;
    let commit!: () => void;
    const linkedSignal = new Promise<void>((resolve) => { slipIsLinked = resolve; });
    const commitSignal = new Promise<void>((resolve) => { commit = resolve; });
    const moving = clients[0]!.$transaction(async (tx) => {
      const slip = await (repos[0] as any).resolvePaymentSlipLocked(tx, { companyId, requestId: claim.requestId, attachmentId: first.id, actorUserId: `${TAG}-finance` });
      await (repos[0] as any).linkPaymentSlip(tx, { companyId, paymentId: cash.payment.id, linkedByUserId: `${TAG}-finance`, slip });
      slipIsLinked();
      await commitSignal;
    }, { timeout: 20_000 });
    await linkedSignal;
    let copySettled = false;
    const copying = copyOntoAnotherClaim(first.id).finally(() => { copySettled = true; });
    copying.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(copySettled, false, 'the signed-copy link is waiting on the slip link, not deciding without it');
    commit();
    await moving;
    await assert.rejects(copying, /payment slip cannot be attached to anything else/);
    assert.deepEqual(await linksOf(first.id), [['reimbursement_payment', cash.payment.id, 'reimbursement.payment.slip']]);

    // Order 2: the signed-copy link commits after the payment transaction took its snapshot. The
    // payment cannot see that link, so it must not get as far as writing a slip beside it. Through
    // the real payment write: it fails as "the payment changed", and the retry reads the truth.
    const repayable = await payableClaim();
    const second = await signedCopyOf(repayable.requestId);
    const interleavedPayment = interleavedRepo(() => copyOntoAnotherClaim(second.id));
    await assert.rejects(() => interleavedPayment.recordPaymentAtomic(transfer(repayable.requestId, 'copy-race-transfer', second.id)), paymentChanged);
    assert.deepEqual(await paymentsOf(repayable.requestId), [], 'no payment, so no slip link');
    const bothCopies = [['reimbursement_request', 'another-claim'], ['reimbursement_request', repayable.requestId]].sort();
    assert.deepEqual((await linksOf(second.id)).map(([targetType, targetId]) => [targetType, targetId]).sort(), bothCopies);
    await assert.rejects(() => repos[0]!.recordPaymentAtomic(transfer(repayable.requestId, 'copy-race-transfer', second.id)), /payment_slip_invalid/);

    // The same order against the later attach. It reads committed rows once it holds the lock, so it refuses outright.
    const third = await signedCopyOf(claim.requestId);
    const interleavedAttach = interleavedRepo(() => copyOntoAnotherClaim(third.id));
    await assert.rejects(() => moveToSlip(claim.requestId, cash.payment.id, third.id, interleavedAttach), /payment_slip_invalid/);
    assert.deepEqual((await linksOf(third.id)).map(([, , purpose]) => purpose), ['reimbursement.claim_form.signed', 'reimbursement.claim_form.signed']);
    assert.deepEqual(await paymentsWithoutTheirSlipLink(), []);
  });

  it('answers a payment that lost its race as 409 "the payment changed", never a raw database error', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const slip = await slipUpload(claim.requestId);
    const files = new PrismaAttachmentRepository({ client: clients[1]! } as any);
    // The slip file is deleted after the payment transaction took its snapshot: PostgreSQL rolls
    // the payment back on its row lock (40001), which reaches the caller as a conflict to retry.
    const racing = interleavedRepo(() => files.markDeleted({ companyId, id: slip.id }));
    await assert.rejects(() => racing.recordPaymentAtomic(transfer(claim.requestId, 'lost-race', slip.id)), paymentChanged);
    assert.deepEqual(await paymentsOf(claim.requestId), []);
    assert.equal(await clients[0]!.attachmentLink.count({ where: { attachmentId: slip.id } }), 0);
    const untouched = await claim.db.reimbursementRequest.findUniqueOrThrow({ where: { id: claim.requestId } });
    assert.deepEqual([untouched.status, untouched.paymentStatus, untouched.outstandingAmount.toString()], ['READY_FOR_PAYMENT', 'UNPAID', '100']);
    // The retry the message asks for gets the real answer: that file is gone.
    await assert.rejects(() => repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'lost-race', slip.id)), /payment_slip_invalid/);

    // Two payers at once: whoever loses is told the same thing or that the claim is already paid, never a 500.
    const second = await payableClaim();
    const [a, b] = [await slipUpload(second.requestId), await slipUpload(second.requestId)];
    const results = await Promise.allSettled([
      repos[0]!.recordPaymentAtomic(transfer(second.requestId, 'two-payers-a', a.id)),
      repos[1]!.recordPaymentAtomic(transfer(second.requestId, 'two-payers-b', b.id)),
    ]);
    const lost = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    assert.equal(lost.length, 1);
    assert.equal(lost[0]?.getStatus?.(), 409, `a conflict, not ${String(lost[0]?.code ?? lost[0]?.message)}`);
  });

  // B7 (impact audit 2026-10-01): voiding a payment must not leave a bank statement line matched to it.
  it('refuses to void a payment a bank statement line is confirmed against, and voids once the match is undone', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const paid = await cashPayment(claim.requestId, 'bank-matched');
    const db = clients[0]!;
    const account = await db.bankAccount.create({ data: { companyId, branchId, displayName: `${TAG}-bank-${++fileSequence}`, createdByUserId: `${TAG}-finance` } });
    const line = await db.bankStatementLine.create({ data: {
      companyId, bankAccountId: account.id, sourceType: 'MANUAL', lineHash: `${TAG}-line-${fileSequence}`, postedDate: new Date('2026-10-01T00:00:00.000Z'),
      description: 'โอนเงินคืนพนักงาน', direction: 'WITHDRAWAL', signedAmount: '-100.0000', status: 'MATCHED',
    } });
    const match = await db.bankReconciliationMatch.create({ data: {
      companyId, bankAccountId: account.id, statementLineId: line.id, sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: paid.payment.id,
      sourceDisplayNumber: paid.payment.paymentNo ?? null, allocatedAmount: '100.0000', status: 'CONFIRMED', confirmedByUserId: `${TAG}-finance`, confirmedAt: new Date(),
    } });
    try {
      const voidIt = () => repos[0]!.voidPaymentTrueReversal(companyId, claim.requestId, paid.payment.id, `${TAG}-finance`, 'โอนผิดบัญชี');
      await assert.rejects(voidIt, (error: any) => error.getStatus() === 409 && errorCode(error) === 'reimbursement_payment_bank_matched');
      // Nothing moved: the payment stands, the claim is still paid, its expense record still reads paid.
      assert.deepEqual((await paymentsOf(claim.requestId)).map((payment) => [payment.status, payment.voidedAt]), [['RECORDED', null]]);
      const still = await db.reimbursementRequest.findUniqueOrThrow({ where: { id: claim.requestId } });
      assert.deepEqual([still.status, still.paymentStatus, still.outstandingAmount.toString()], ['PAID', 'PAID', '0']);
      assert.equal((await db.expenseRecord.findUniqueOrThrow({ where: { id: claim.projectionId } })).paymentStatus, 'PAID');

      // The match is undone in the bank screen first; then the void goes through.
      await db.bankReconciliationMatch.update({ where: { id: match.id }, data: { status: 'VOIDED' } });
      const voided = await voidIt();
      assert.deepEqual([voided.payment.status, voided.request.status, voided.request.paymentStatus], ['VOIDED', 'READY_FOR_PAYMENT', 'UNPAID']);
    } finally {
      await db.bankReconciliationMatch.deleteMany({ where: { companyId, bankAccountId: account.id } });
      await db.bankStatementLine.deleteMany({ where: { companyId, bankAccountId: account.id } });
      await db.bankAccount.deleteMany({ where: { id: account.id } });
    }
  });

});

/**
 * Real PostgreSQL proof for the payout account (payout spec §8–§10): what the database itself
 * refuses, that the number survives encryption digit for digit, and that a submit freezes exactly
 * the account its hash was made from.
 */
describe('reimbursement payout account and claim snapshot (real PostgreSQL)', () => {
  const PAYOUT_TAG = `reimbursement-payout-${process.pid}`;
  const key = Buffer.alloc(32, 9);
  const requester = `${PAYOUT_TAG}-requester`;
  const approver = `${PAYOUT_TAG}-approver`;
  const merged = `${PAYOUT_TAG}-merged`;
  const outsider = `${PAYOUT_TAG}-outsider`;
  const draftEmployee = `${PAYOUT_TAG}-draft-employee`;
  let clients: PrismaClient[] = [];
  let repos: PrismaReimbursementRepository[] = [];
  let companyId = '';
  let otherCompanyId = '';
  let branchId = '';
  let reachable = false;

  const KBANK = { payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0012345678' };
  const SCB = { payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountNumber: '4090001112' };
  const PROMPTPAY = { payoutKind: 'PROMPTPAY_PHONE' as const, accountName: 'นาย สมชาย ใจดี', accountNumber: '0812345678' };
  const seal = (input: Parameters<typeof sealPayoutDestination>[0]) => sealPayoutDestination(input, key)!;
  const fingerprintOf = (input: typeof KBANK | typeof PROMPTPAY) =>
    payoutFingerprint({ payoutKind: input.payoutKind, bankName: 'bankName' in input ? input.bankName : null, accountName: input.accountName, accountNumber: input.accountNumber }, key);

  before(async () => {
    const url = databaseUrl();
    if (!url) {
      if (gateRequired) throw new Error('reimbursement_pg_gate_database_url_required');
      return;
    }
    try {
      clients = [
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
      ];
      await clients[0]!.$queryRaw`SELECT 1`;
    } catch (error) {
      if (gateRequired) throw error;
      return;
    }
    reachable = true;
    const db = clients[0]!;
    await db.user.createMany({ data: [requester, approver, merged, outsider, draftEmployee].map((id) => ({ id, displayName: id })) });
    companyId = (await db.company.create({ data: { name: PAYOUT_TAG, status: 'ACTIVE' }, select: { id: true } })).id;
    otherCompanyId = (await db.company.create({ data: { name: `${PAYOUT_TAG}-other`, status: 'ACTIVE' }, select: { id: true } })).id;
    await db.companyMembership.createMany({ data: [
      { companyId, userId: requester, status: 'ACTIVE' }, { companyId, userId: approver, status: 'ACTIVE' },
      { companyId: otherCompanyId, userId: requester, status: 'ACTIVE' },
    ] });
    branchId = (await db.branch.create({ data: { companyId, code: 'QA-PAYOUT', name: PAYOUT_TAG }, select: { id: true } })).id;
    repos = clients.map((client) => new PrismaReimbursementRepository({ client } as any, new PrismaDocumentSequenceRepository({ client } as any)));
  });

  after(async () => {
    if (reachable) {
      await clients[0]!.auditLog.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
      await clients[0]!.role.deleteMany({ where: { scopeKey: companyId } });
      await clients[0]!.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
      await clients[0]!.user.deleteMany({ where: { id: { in: [requester, approver, merged, outsider, draftEmployee] } } });
    }
    await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
  });

  /** What the database said when it refused a write, whichever layer carried the text. */
  async function refusedBy(run: () => Promise<unknown>, pattern: RegExp, label = String(pattern)) {
    await assert.rejects(run, (error: any) => {
      const text = [error?.message, error?.code, JSON.stringify(error?.meta ?? {}), error?.cause?.message].join(' ');
      assert.match(text, pattern, label);
      return true;
    }, label);
  }

  const setDefault = (input: typeof KBANK | typeof PROMPTPAY, index = 0, userId = requester, company = companyId) => repos[index]!.setMemberPayoutAccount(
    { companyId: company, userId, actorUserId: userId, payoutMethod: 'BANK_TRANSFER', destination: seal(input) }, async () => undefined,
  );
  const destinationsOf = (requestId: string) => clients[0]!.reimbursementPayoutDestination.findMany({ where: { reimbursementRequestId: requestId }, orderBy: { version: 'asc' } });
  const insertAccount = (columns: Record<string, unknown>) => clients[0]!.memberPayoutAccount.create({ data: {
    companyId, userId: approver, payoutMethod: 'BANK_TRANSFER', updatedByUserId: approver, ...seal(KBANK), ...columns,
  } as any });

  async function draft(reason: string, payout?: Parameters<PrismaReimbursementRepository['createRequest']>[1]) {
    return repos[0]!.createRequest({
      companyId, branchId, requesterUserId: requester, requesterDisplayNameSnapshot: 'สมชาย', createdByUserId: requester,
      reason, categoryKey: 'travel', amount: '100.0000', currency: 'THB', incurredDate: new Date('2026-10-01T00:00:00.000Z'),
      receiptRequirementStatus: 'WAIVED_BY_POLICY',
      lines: [{ lineNo: 1, incurredDate: new Date('2026-10-01T00:00:00.000Z'), description: reason, categoryKey: 'travel', amount: '100.0000' }],
    }, payout);
  }

  type Claim = NonNullable<Awaited<ReturnType<PrismaReimbursementRepository['findRequestById']>>>;

  /** What the claim page shows next to "ส่งอนุมัติ": the token of the account a submit would freeze now. */
  const shownToken = async (request: Claim) => payoutSubmitToken(request.id, await repos[0]!.planSubmitPayout(request));

  /**
   * The submit the use case makes. Nothing about the payout is decided here: the transaction decides
   * what to freeze, checks it against `seenToken`, and asks `snapshotHash` for the claim's hash.
   */
  function submitInput(request: Claim, seenToken?: unknown) {
    return {
      companyId, requestId: request.id, expectedUpdatedAt: request.updatedAt, duplicateCandidates: [],
      evidence: { attachmentIds: [], expenseIds: [] },
      documentNumber: { documentType: 'reimbursement.request', periodKey, idempotencyKey: `reimb-submit:${request.id}`, reservedByUserId: requester },
      approvalStep: { sequenceNo: 1, approverUserId: approver, approverRoleSnapshot: 'MANAGER' },
      request: { status: 'PENDING_APPROVAL', submittedAt: new Date(), submittedByUserId: requester, outstandingAmount: request.amount, updatedByUserId: requester },
      payout: {
        actorUserId: requester, frozenAt: new Date(), seenToken,
        snapshotHash: (columns: SubmitPayoutColumns) => computeSnapshotHash(claimSnapshotFields({ ...request, ...columns })),
      },
    } as any;
  }

  /** Read the page, then send what it showed. */
  async function submit(request: Claim) {
    const result = await repos[0]!.submitDraftAtomic(submitInput(request, await shownToken(request)));
    return { plan: result.payout!.plan, pending: (await repos[0]!.findRequestById(companyId, request.id))! };
  }

  const approval = (pending: NonNullable<Awaited<ReturnType<PrismaReimbursementRepository['findRequestById']>>>, payoutVerifiedVersion?: unknown) => ({
    companyId, requestId: pending.id, expectedUpdatedAt: pending.updatedAt, expectedApprovalSnapshotHash: pending.approvalSnapshotHash ?? undefined,
    actorUserId: approver, actorRoles: ['OWNER'], scopes: {}, allowSelfApproval: false, financeReviewRequired: true,
    decidedAt: new Date('2026-10-01T09:00:00.000Z'), payoutVerifiedVersion,
    financeRequestPatch: { financeReviewStatus: 'PENDING', paymentStatus: 'UNPAID', updatedByUserId: approver },
    onDecisionPersisted: async () => undefined,
  });

  it('stores the number encrypted, gives back every digit including leading zeros, and derives the last 4 from the same digits', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    for (const [index, input] of [KBANK, PROMPTPAY, { ...KBANK, accountNumber: '000123456789012' }, { ...KBANK, accountNumber: '001-2-34567-8' }].entries()) {
      const digits = input.accountNumber.replace(/\D/g, '');
      const saved = await setDefault(input);
      assert.equal(saved.version, index + 1, 'every change is counted');
      assert.equal(saved.accountLast4, digits.slice(-4));
      assert.equal('accountNumberEncrypted' in saved, false, 'the stored number never rides along with the masked record');

      const [stored] = await db.$queryRaw<Array<{ encrypted: string; last4: string; type: string }>>`
        SELECT "accountNumberEncrypted" AS encrypted, "accountLast4" AS last4, pg_typeof("accountLast4")::text AS type
          FROM "MemberPayoutAccount" WHERE "companyId" = ${companyId} AND "userId" = ${requester}`;
      assert.equal(stored!.type, 'text');
      assert.ok(!stored!.encrypted.includes(digits) && !stored!.encrypted.includes(digits.slice(-4).padStart(6, 'x')), 'the column holds ciphertext, not the number');
      const opened = openPayoutAccountNumber((await repos[0]!.findMemberPayoutSecret(companyId, requester))!, key);
      assert.equal(opened, digits);
      assert.equal(opened.slice(-4), stored!.last4, 'the last 4 shown are the last 4 of what a reveal decrypts');
      assert.throws(() => openPayoutAccountNumber(stored!.encrypted, Buffer.alloc(32, 1)), 'another key opens nothing');
    }
    // Cash carries no account at all.
    await repos[0]!.setMemberPayoutAccount({ companyId, userId: requester, actorUserId: requester, payoutMethod: 'CASH' }, async () => undefined);
    assert.equal(await repos[0]!.findMemberPayoutSecret(companyId, requester), null);
    assert.deepEqual({ ...(await repos[0]!.findMemberPayoutAccount(companyId, requester)), updatedAt: undefined }, {
      companyId, userId: requester, payoutMethod: 'CASH', payoutKind: undefined, bankName: undefined, accountName: undefined,
      accountLast4: undefined, fingerprint: undefined, version: 5, updatedByUserId: requester, updatedAt: undefined,
    });
  });

  it('keeps one default account per member per company, tied to the membership itself', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    await setDefault(KBANK);
    await setDefault(SCB, 0, requester, otherCompanyId);
    assert.equal((await repos[0]!.findMemberPayoutAccount(companyId, requester))?.accountLast4, '5678');
    assert.equal((await repos[0]!.findMemberPayoutAccount(otherCompanyId, requester))?.accountLast4, '1112');
    assert.equal(await repos[0]!.findMemberPayoutAccount(otherCompanyId, approver), null);

    await refusedBy(() => insertAccount({ userId: requester }), /MemberPayoutAccount_companyId_userId_key|P2002|Unique constraint/i, 'a second account for the same member');
    await refusedBy(() => insertAccount({ userId: outsider }), /MemberPayoutAccount_companyId_userId_fkey|P2003|Foreign key constraint/i, 'an account for someone who is not a member');
    await refusedBy(() => insertAccount({ companyId: otherCompanyId, userId: approver }), /MemberPayoutAccount_companyId_userId_fkey|P2003|Foreign key constraint/i, 'an account in a company the user does not belong to');

    // An account merge moves the membership to the surviving user: the account goes with it.
    await db.$executeRaw`UPDATE "CompanyMembership" SET "userId" = ${merged} WHERE "companyId" = ${otherCompanyId} AND "userId" = ${requester}`;
    assert.equal(await repos[0]!.findMemberPayoutAccount(otherCompanyId, requester), null);
    assert.equal(openPayoutAccountNumber((await repos[0]!.findMemberPayoutSecret(otherCompanyId, merged))!, key), SCB.accountNumber);
    // Leaving the company removes the account with the membership; the other company's account is untouched.
    await db.companyMembership.deleteMany({ where: { companyId: otherCompanyId, userId: merged } });
    assert.equal(await db.memberPayoutAccount.count({ where: { companyId: otherCompanyId } }), 0);
    assert.equal((await repos[0]!.findMemberPayoutAccount(companyId, requester))?.accountLast4, '5678');
  });

  it('refuses a half-filled default account at the database, whatever code wrote it', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const cash = { payoutKind: null, bankName: null, accountName: null, accountNumberEncrypted: null, accountLast4: null, fingerprint: null };
    for (const [label, columns] of Object.entries({
      'a transfer without a number': { accountNumberEncrypted: null },
      'a transfer without an account name': { accountName: null },
      'a transfer without the fingerprint': { fingerprint: null },
      'a bank account without a bank': { bankName: null },
      'PromptPay with a bank': { payoutKind: 'PROMPTPAY_PHONE' },
      'an unknown kind': { payoutKind: 'CRYPTO_WALLET' },
      'three digits where four belong': { accountLast4: '678' },
      'letters where digits belong': { accountLast4: '56a8' },
      'a whole number where the last four belong': { accountLast4: '0012345678' },
      'cash that still carries an account': { payoutMethod: 'CASH' },
      'cash that still carries the last four': { payoutMethod: 'CASH', ...cash, accountLast4: '5678' },
    })) await refusedBy(() => insertAccount(columns), /MemberPayoutAccount_shape_check/, label);
    await refusedBy(() => insertAccount({ version: 0 }), /MemberPayoutAccount_version_check/, 'version 0');
    assert.equal(await clients[0]!.memberPayoutAccount.count({ where: { companyId, userId: approver } }), 0);
  });

  it('freezes the claim own copy at submit: later changes to the default never reach it, and the row itself cannot be edited', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    await setDefault(KBANK);
    const created = await draft('copy of the default');
    assert.deepEqual([created.payoutMethod, created.payoutDestinationVersion, created.payoutFingerprint], [undefined, undefined, undefined], 'a new draft follows the default');
    assert.equal((await destinationsOf(created.id)).length, 0);

    const { plan, pending } = await submit(created);
    assert.deepEqual(plan, { payoutMethod: 'BANK_TRANSFER', followsDefault: true, version: 1, fingerprint: fingerprintOf(KBANK), action: 'COPY_DEFAULT' });
    assert.deepEqual([pending.status, pending.payoutMethod, pending.payoutDestinationVersion, pending.payoutFingerprint], ['PENDING_APPROVAL', 'BANK_TRANSFER', 1, fingerprintOf(KBANK)]);
    const [frozen] = await destinationsOf(created.id);
    assert.deepEqual([frozen!.version, frozen!.source, frozen!.accountLast4, frozen!.fingerprint, frozen!.frozenAt !== null, frozen!.verifiedAt],
      [1, 'DEFAULT_ACCOUNT', '5678', fingerprintOf(KBANK), true, null]);
    const before = { shown: await repos[0]!.findClaimPayout(pending), number: openPayoutAccountNumber((await repos[0]!.findClaimPayoutSecret(companyId, created.id, 1))!.accountNumberEncrypted, key) };
    assert.equal(before.number, KBANK.accountNumber);
    assert.deepEqual(before.shown, { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: KBANK.bankName, accountName: KBANK.accountName, accountLast4: '5678', version: 1, source: 'DEFAULT_ACCOUNT' });

    // The member changes the default, then removes it: the sent claim still shows, reveals and hashes the same account.
    await setDefault(SCB);
    await repos[0]!.removeMemberPayoutAccount(companyId, requester, async () => undefined);
    const after = (await repos[0]!.findRequestById(companyId, created.id))!;
    assert.deepEqual(await repos[0]!.findClaimPayout(after), before.shown);
    assert.equal(openPayoutAccountNumber((await repos[0]!.findClaimPayoutSecret(companyId, created.id, 1))!.accountNumberEncrypted, key), before.number);
    assert.deepEqual([after.payoutDestinationVersion, after.payoutFingerprint, after.approvalSnapshotHash], [1, fingerprintOf(KBANK), pending.approvalSnapshotHash]);
    assert.equal((await destinationsOf(created.id)).length, 1);
    // One decision, three places: the fingerprint on the claim, on its row, and of the row's own
    // decrypted fields are the same value, and the stored hash is made of exactly that.
    assert.equal(payoutFingerprint({ payoutKind: frozen!.payoutKind, bankName: frozen!.bankName, accountName: frozen!.accountName, accountNumber: before.number }, key), after.payoutFingerprint);
    assert.equal(after.approvalSnapshotHash, computeSnapshotHash(claimSnapshotFields({ ...after, payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: frozen!.fingerprint })));
    assert.notEqual(after.approvalSnapshotHash, computeSnapshotHash(claimSnapshotFields({ ...after, payoutFingerprint: undefined })), 'the payout part is in the hash');

    // Not even a direct write moves a frozen account.
    const other = seal(SCB);
    for (const [label, data] of Object.entries({
      'the number': { accountNumberEncrypted: other.accountNumberEncrypted },
      'the last four': { accountLast4: '9999' },
      'the bank': { bankName: SCB.bankName },
      'the account name': { accountName: 'คนอื่น' },
      'the fingerprint': { fingerprint: other.fingerprint },
      'the version': { version: 2 },
      'the origin': { source: 'PREPARER' },
      'who entered it': { createdByUserId: approver },
      'unfreezing': { frozenAt: null },
      'a new freeze time': { frozenAt: new Date('2030-01-01T00:00:00.000Z') },
    })) await refusedBy(() => db.reimbursementPayoutDestination.update({ where: { id: frozen!.id }, data: data as any }), /reimbursement_payout_destination_frozen/, label);
    assert.deepEqual(await repos[0]!.findClaimPayout(after), before.shown);
  });

  // A frozen snapshot is history: what an approver attested and what a payment went to. It is never
  // removed on its own, by any code. It goes only together with its claim.
  it('refuses deleting a frozen snapshot on its own, and still lets it go with its claim', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    await setDefault(KBANK);
    const { pending } = await submit(await draft('frozen snapshot is not deleted'));
    const [frozen] = await destinationsOf(pending.id);
    assert.ok(frozen!.frozenAt);
    for (const [label, run] of Object.entries({
      'by id': () => db.reimbursementPayoutDestination.delete({ where: { id: frozen!.id } }),
      'by claim': () => db.reimbursementPayoutDestination.deleteMany({ where: { reimbursementRequestId: pending.id } }),
      'in SQL': () => db.$executeRaw`DELETE FROM "ReimbursementPayoutDestination" WHERE "id" = ${frozen!.id}`,
    })) await refusedBy(run, /reimbursement_payout_destination_frozen/, label);
    assert.equal((await destinationsOf(pending.id)).length, 1);
    // Withdrawn to a draft again, an account typed for the claim is a working row beside the history:
    // the working row is replaced or dropped freely, the frozen one stays.
    const reopened = await repos[0]!.reopenRejectedRequest(companyId, pending.id, pending.updatedAt, requester, 'PENDING_APPROVAL');
    const typed = await repos[0]!.updateDraftRequest(companyId, pending.id, reopened.updatedAt, {}, undefined,
      { write: { mode: 'SPECIFIED', destination: seal(SCB), source: 'REQUESTER', actorUserId: requester } });
    assert.deepEqual((await destinationsOf(pending.id)).map((row) => [row.version, row.frozenAt !== null]), [[1, true], [2, false]]);
    await repos[0]!.updateDraftRequest(companyId, pending.id, typed.updatedAt, {}, undefined, { write: { mode: 'CASH' } });
    assert.deepEqual((await destinationsOf(pending.id)).map((row) => [row.version, row.frozenAt !== null]), [[1, true]]);
    // The claim itself deleted (a company or a claim removed outright): its snapshots go with it.
    await db.reimbursementRequest.delete({ where: { id: pending.id } });
    assert.equal((await destinationsOf(pending.id)).length, 0);
  });

  it('sends the claim with the account its page showed: a default changed, removed or never shown refuses the submit', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await setDefault(KBANK);
    const stale = await draft('default changed before submit');
    const seen = await shownToken(stale);
    assert.match(String(seen), /^[0-9a-f]{32}$/);
    // Nothing shown (a list-row submit, an old browser tab), or a token that is not this claim's.
    for (const token of [undefined, null, 'f'.repeat(32), fingerprintOf(KBANK)]) {
      await refusedBy(() => repos[0]!.submitDraftAtomic(submitInput(stale, token)), /payout_destination_changed/, `token ${String(token)}`);
    }
    // Someone changes the default after the page was read (a manager may, by the owner's decision).
    await setDefault(SCB, 1);
    await refusedBy(() => repos[0]!.submitDraftAtomic(submitInput(stale, seen)), /payout_destination_changed/);
    const untouched = (await repos[0]!.findRequestById(companyId, stale.id))!;
    assert.deepEqual([untouched.status, untouched.payoutMethod, untouched.payoutFingerprint, untouched.requestNo, (await destinationsOf(stale.id)).length],
      ['DRAFT', undefined, undefined, undefined, 0]);
    // The same when the default is removed after the page was read: there is nothing to send.
    const seenScb = await shownToken(untouched);
    await repos[1]!.removeMemberPayoutAccount(companyId, requester, async () => undefined);
    await refusedBy(() => repos[0]!.submitDraftAtomic(submitInput(untouched, seenScb)), /payout_method_required/);
    assert.equal(await shownToken(untouched), undefined);

    // Racing for real: whoever wins, the claim is either still a draft with nothing frozen, or sent
    // with one frozen row whose every column belongs to the account the page showed and the hash holds.
    const outcomes: string[] = [];
    for (let round = 0; round < 8; round += 1) {
      await setDefault(KBANK);
      const racing = await draft(`race ${round}`);
      const input = submitInput(racing, await shownToken(racing));
      const [sent] = await Promise.allSettled([repos[0]!.submitDraftAtomic(input), setDefault(round % 2 ? SCB : PROMPTPAY, 1)]);
      const claim = (await repos[0]!.findRequestById(companyId, racing.id))!;
      const rows = await destinationsOf(racing.id);
      outcomes.push(sent.status);
      if (sent.status === 'rejected') {
        assert.match(String((sent.reason as any)?.message), /payout_destination_changed/);
        assert.deepEqual([claim.status, claim.payoutMethod, claim.payoutFingerprint, rows.length], ['DRAFT', undefined, undefined, 0]);
      } else {
        assert.deepEqual([claim.status, claim.payoutDestinationVersion, claim.payoutFingerprint, rows.length], ['PENDING_APPROVAL', 1, fingerprintOf(KBANK), 1]);
        assert.deepEqual([rows[0]!.fingerprint, rows[0]!.accountLast4, rows[0]!.bankName, openPayoutAccountNumber(rows[0]!.accountNumberEncrypted, key)],
          [fingerprintOf(KBANK), '5678', KBANK.bankName, KBANK.accountNumber]);
        assert.equal(claim.approvalSnapshotHash, computeSnapshotHash(claimSnapshotFields(claim)));
      }
      // Either way the default edit itself went through: it waited for the submit, it was not lost.
      assert.notEqual((await repos[0]!.findMemberPayoutAccount(companyId, requester))?.fingerprint, fingerprintOf(KBANK));
    }
    assert.equal(outcomes.length, 8);
  });

  it('keeps an account typed for one claim editable until it is sent, then gives a changed account the next version', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await repos[0]!.removeMemberPayoutAccount(companyId, requester, async () => undefined);
    const typed = (account: typeof KBANK | typeof PROMPTPAY) => ({ write: { mode: 'SPECIFIED' as const, destination: seal(account), source: 'REQUESTER' as const, actorUserId: requester } });
    const created = await draft('typed for this claim', typed(KBANK));
    assert.deepEqual([created.payoutMethod, created.payoutDestinationVersion, created.payoutFingerprint], ['BANK_TRANSFER', 1, undefined]);
    // The working row is rewritten in place: one row, one version, while the claim is a draft.
    const edited = await repos[0]!.updateDraftRequest(companyId, created.id, created.updatedAt, {}, undefined, typed(PROMPTPAY));
    let rows = await destinationsOf(created.id);
    assert.deepEqual(rows.map((row) => [row.version, row.accountLast4, row.frozenAt, row.source]), [[1, '5678', null, 'REQUESTER']]);
    assert.equal(openPayoutAccountNumber(rows[0]!.accountNumberEncrypted, key), PROMPTPAY.accountNumber);

    // An edit and a submit of the same draft: one wins, and what is frozen is what was hashed.
    const input = submitInput(edited, await shownToken(edited));
    const [sent, saved] = await Promise.allSettled([
      repos[0]!.submitDraftAtomic(input),
      repos[1]!.updateDraftRequest(companyId, created.id, edited.updatedAt, {}, undefined, typed(SCB)),
    ]);
    assert.equal([sent, saved].filter((result) => result.status === 'fulfilled').length, 1, 'exactly one of the edit and the submit commits');
    let claim = (await repos[0]!.findRequestById(companyId, created.id))!;
    rows = await destinationsOf(created.id);
    if (sent.status === 'fulfilled') {
      assert.deepEqual([claim.status, claim.payoutFingerprint, rows.length, rows[0]!.fingerprint, rows[0]!.frozenAt !== null], ['PENDING_APPROVAL', fingerprintOf(PROMPTPAY), 1, fingerprintOf(PROMPTPAY), true]);
    } else {
      assert.deepEqual([claim.status, claim.payoutFingerprint, rows.length, rows[0]!.fingerprint, rows[0]!.frozenAt], ['DRAFT', undefined, 1, fingerprintOf(SCB), null]);
      claim = (await submit(claim)).pending;
      rows = await destinationsOf(created.id);
    }
    const sentFingerprint = rows[0]!.fingerprint;

    // Withdrawn and sent again unchanged: same version, and any earlier attestation is gone.
    await clients[0]!.$executeRaw`UPDATE "ReimbursementPayoutDestination" SET "verifiedByUserId" = ${approver}, "verifiedAt" = now(), "verifiedVia" = 'APPROVAL' WHERE id = ${rows[0]!.id}`;
    let reopened = await repos[0]!.reopenRejectedRequest(companyId, claim.id, claim.updatedAt, requester, 'PENDING_APPROVAL');
    assert.deepEqual([reopened.status, reopened.payoutMethod, reopened.payoutDestinationVersion, reopened.payoutFingerprint], ['DRAFT', 'BANK_TRANSFER', 1, undefined], 'an account named for this claim stays the draft choice');
    assert.equal((await repos[0]!.findClaimPayout(reopened))?.verifiedAt, undefined, 'a draft shows no attestation');
    const again = await submit(reopened);
    assert.deepEqual(again.plan, { payoutMethod: 'BANK_TRANSFER', followsDefault: false, version: 1, fingerprint: sentFingerprint, action: 'REUSE' });
    rows = await destinationsOf(created.id);
    assert.deepEqual(rows.map((row) => [row.version, row.verifiedByUserId, row.verifiedAt, row.verifiedVia]), [[1, null, null, null]]);

    // Withdrawn, the account changed, sent again: version 2 is frozen and version 1 stays as it was sent.
    reopened = await repos[0]!.reopenRejectedRequest(companyId, claim.id, again.pending.updatedAt, requester, 'PENDING_APPROVAL');
    const changed = await repos[0]!.updateDraftRequest(companyId, created.id, reopened.updatedAt, {}, undefined, typed(KBANK));
    assert.deepEqual([changed.payoutDestinationVersion, changed.payoutFingerprint], [2, undefined]);
    const third = await submit(changed);
    assert.deepEqual(third.plan, { payoutMethod: 'BANK_TRANSFER', followsDefault: false, version: 2, fingerprint: fingerprintOf(KBANK), action: 'FREEZE' });
    rows = await destinationsOf(created.id);
    assert.deepEqual(rows.map((row) => [row.version, row.fingerprint, row.frozenAt !== null]), [[1, sentFingerprint, true], [2, fingerprintOf(KBANK), true]]);
    assert.equal((await repos[0]!.findClaimPayout(third.pending))?.accountLast4, '5678');
    assert.notEqual(third.pending.approvalSnapshotHash, again.pending.approvalSnapshotHash, 'a changed account is a changed claim');
  });

  it('approves a transfer claim only with an attestation of its current version, recorded in the approval transaction', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    await setDefault(KBANK);
    const { pending } = await submit(await draft('attested at approval'));
    const [row] = await destinationsOf(pending.id);

    for (const [verified, refusal] of [[undefined, /payout_verification_required/], [null, /payout_verification_required/], [2, /payout_destination_changed/], ['1', /payout_destination_changed/]] as const) {
      await refusedBy(() => repos[0]!.beginApprovalDecisionAtomic(approval(pending, verified)), refusal, `attesting ${String(verified)}`);
    }
    const untouched = await db.reimbursementRequest.findUniqueOrThrow({ where: { id: pending.id }, include: { approvalSteps: true } });
    assert.deepEqual([untouched.status, untouched.approvalSteps.map((step) => step.status), (await destinationsOf(pending.id))[0]!.verifiedAt], ['PENDING_APPROVAL', ['PENDING'], null]);

    const decided = await repos[0]!.beginApprovalDecisionAtomic(approval(pending, 1));
    const [attested] = await destinationsOf(pending.id);
    assert.deepEqual([attested!.verifiedByUserId, attested!.verifiedAt?.toISOString(), attested!.verifiedVia, attested!.approvalStepId],
      [approver, '2026-10-01T09:00:00.000Z', 'APPROVAL', decided.approvalStepId]);
    // The attestation changed nothing about the account it attests.
    assert.deepEqual([attested!.accountNumberEncrypted, attested!.accountLast4, attested!.fingerprint, attested!.frozenAt?.getTime()],
      [row!.accountNumberEncrypted, row!.accountLast4, row!.fingerprint, row!.frozenAt?.getTime()]);

    // Who, when and how are one fact, and only a frozen snapshot can carry it.
    await refusedBy(() => db.$executeRaw`UPDATE "ReimbursementPayoutDestination" SET "verifiedVia" = NULL WHERE id = ${attested!.id}`, /ReimbursementPayoutDestination_verification_check/, 'an attestation without its channel');
    await refusedBy(() => db.$executeRaw`UPDATE "ReimbursementPayoutDestination" SET "verifiedByUserId" = NULL WHERE id = ${attested!.id}`, /ReimbursementPayoutDestination_verification_check/, 'an attestation without its author');
    await repos[0]!.removeMemberPayoutAccount(companyId, requester, async () => undefined);
    const working = await draft('unfrozen row', { write: { mode: 'SPECIFIED', destination: seal(SCB), source: 'REQUESTER', actorUserId: requester } });
    await refusedBy(() => db.$executeRaw`UPDATE "ReimbursementPayoutDestination" SET "verifiedByUserId" = ${approver}, "verifiedAt" = now(), "verifiedVia" = 'APPROVAL' WHERE "reimbursementRequestId" = ${working.id}`,
      /ReimbursementPayoutDestination_verification_check/, 'an attestation of a draft account');

    // A cash claim is approved without any attestation. It still carries the marker only this submit
    // writes, so it is hashed as a cash claim and cannot quietly become a transfer.
    const cash = await submit(await draft('cash', { write: { mode: 'CASH' } }));
    assert.deepEqual([cash.plan, cash.pending.payoutMethod, cash.pending.payoutDestinationVersion, cash.pending.payoutFingerprint, (await destinationsOf(cash.pending.id)).length],
      [{ payoutMethod: 'CASH', followsDefault: false }, 'CASH', undefined, CASH_PAYOUT_FINGERPRINT, 0]);
    await repos[0]!.beginApprovalDecisionAtomic(approval(cash.pending));

    // Legacy claims: sent before the field existed, or — during a rollback — sent by an older build
    // from a draft that had already chosen its method under this one. The older build writes no
    // fingerprint and hashes no payout part; all three stay approvable, with nothing to attest.
    const sentByAnOlderBuild = async (claimDraft: Claim) => {
      const hash = computeSnapshotHash(claimSnapshotFields({ ...claimDraft, payoutFingerprint: undefined }));
      const input = submitInput(claimDraft);
      await repos[0]!.submitDraftAtomic({ ...input, payout: undefined, approvalStep: { ...input.approvalStep, requestSnapshotHash: hash }, request: { ...input.request, approvalSnapshotHash: hash } });
      return (await repos[0]!.findRequestById(companyId, claimDraft.id))!;
    };
    for (const [label, legacyDraft, method] of [
      ['before the field existed', await draft('legacy'), undefined],
      ['a draft that chose an account', await draft('rollback transfer', { write: { mode: 'SPECIFIED', destination: seal(KBANK), source: 'REQUESTER', actorUserId: requester } }), 'BANK_TRANSFER'],
      ['a draft that chose cash', await draft('rollback cash', { write: { mode: 'CASH' } }), 'CASH'],
    ] as const) {
      const legacy = await sentByAnOlderBuild(legacyDraft);
      assert.deepEqual([legacy.status, legacy.payoutMethod, legacy.payoutFingerprint, await repos[0]!.findClaimPayout(legacy)], ['PENDING_APPROVAL', method, undefined, undefined], label);
      await repos[0]!.beginApprovalDecisionAtomic(approval(legacy));
      assert.equal((await db.reimbursementApprovalStep.findFirstOrThrow({ where: { reimbursementRequestId: legacy.id } })).status, 'APPROVED', label);
      // Nothing was attested on the draft's leftover row, and it was never frozen.
      assert.deepEqual((await destinationsOf(legacy.id)).map((entry) => [entry.frozenAt, entry.verifiedAt]), method === 'BANK_TRANSFER' ? [[null, null]] : [], label);
    }
  });

  // Security review S1: the approver is told who set the account they attest, when it was not the requester.
  it('freezes who last set the default with the copy, not who pressed send', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    // Someone else (an employee-data editor) set the requester's default; the requester sends the claim.
    await repos[0]!.setMemberPayoutAccount({ companyId, userId: requester, actorUserId: approver, payoutMethod: 'BANK_TRANSFER', destination: seal(SCB) }, async () => undefined);
    const byOther = await submit(await draft('default set by someone else'));
    assert.deepEqual((await destinationsOf(byOther.pending.id)).map((row) => [row.source, row.createdByUserId]), [['DEFAULT_ACCOUNT', approver]]);
    assert.equal((await repos[0]!.findClaimPayout(byOther.pending))?.enteredByUserId, approver);
    // The requester saves the account themselves: the next claim names nobody, and the sent one keeps what it froze.
    await setDefault(KBANK);
    const byRequester = await submit(await draft('default set by the requester'));
    assert.deepEqual((await destinationsOf(byRequester.pending.id)).map((row) => [row.source, row.createdByUserId]), [['DEFAULT_ACCOUNT', requester]]);
    assert.equal((await repos[0]!.findClaimPayout(byRequester.pending))?.enteredByUserId, undefined);
    assert.equal((await repos[0]!.findClaimPayout(byOther.pending))?.enteredByUserId, approver);
  });

  it('counts versions per claim, not per member: the default at its third change freezes as the claim first', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    // Two counters start at 1 — the member default's and the claim's. They are made to differ here,
    // so an attestation that named the wrong one cannot pass by coincidence.
    await repos[0]!.removeMemberPayoutAccount(companyId, requester, async () => undefined);
    await setDefault(SCB);
    await setDefault(PROMPTPAY);
    assert.equal((await setDefault(KBANK)).version, 3);
    const { pending } = await submit(await draft('default at version 3'));
    assert.equal(pending.payoutDestinationVersion, 1);
    await refusedBy(() => repos[0]!.beginApprovalDecisionAtomic(approval(pending, 3)), /payout_destination_changed/, 'the default account version is not the claim version');
    await repos[0]!.beginApprovalDecisionAtomic(approval(pending, 1));
    assert.equal((await destinationsOf(pending.id))[0]!.verifiedByUserId, approver);
  });

  it('refuses an approval that names the claim as it was before it was withdrawn, edited and sent again', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const first = await submit(await draft('queue row', { write: { mode: 'CASH' } }));
    // The approver's list was loaded here: its row carries this hash.
    const hashOnTheQueueRow = first.pending.approvalSnapshotHash;
    const reopened = await repos[0]!.reopenRejectedRequest(companyId, first.pending.id, first.pending.updatedAt, requester, 'PENDING_APPROVAL');
    assert.equal(reopened.payoutFingerprint, undefined, 'back in draft the claim carries no snapshot marker');
    const edited = await repos[0]!.updateDraftRequest(companyId, reopened.id, reopened.updatedAt, { reason: 'a different claim now' });
    const second = await submit(edited);
    assert.notEqual(second.pending.approvalSnapshotHash, hashOnTheQueueRow);
    await refusedBy(() => repos[0]!.beginApprovalDecisionAtomic({ ...approval(second.pending), expectedApprovalSnapshotHash: hashOnTheQueueRow ?? undefined }), /stale_approval_snapshot/);
    // And an approval that names no content at all is refused inside the transaction too.
    await refusedBy(() => repos[0]!.beginApprovalDecisionAtomic({ ...approval(second.pending), expectedApprovalSnapshotHash: undefined }), /stale_approval_snapshot/);
    const untouched = await clients[0]!.reimbursementRequest.findUniqueOrThrow({ where: { id: second.pending.id }, include: { approvalSteps: { where: { status: 'PENDING' } } } });
    assert.deepEqual([untouched.status, untouched.approvalSteps.length], ['PENDING_APPROVAL', 1]);
    await repos[0]!.beginApprovalDecisionAtomic(approval(second.pending));
  });

  // "บันทึกเป็นบัญชีประจำ" on the claim form writes the member's default and the draft that follows it.
  // One without the other is a draft following a default that does not exist, or a default nobody
  // asked the claim to follow: both are written, or neither.
  it('saves the default account and the draft that follows it together, or neither', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    await repos[0]!.removeMemberPayoutAccount(companyId, requester, async () => undefined);
    const saveDefault = (fail: boolean) => ({
      write: { mode: 'DEFAULT' as const },
      onPersisted: async (tx: any) => {
        await repos[0]!.setMemberPayoutAccount(
          { companyId, userId: requester, actorUserId: requester, payoutMethod: 'BANK_TRANSFER', destination: seal(KBANK) },
          async () => { if (fail) throw new Error('the audit row or the notice could not be written'); }, tx);
      },
    });

    await assert.rejects(draft('saved as default, failing', saveDefault(true)), /could not be written/);
    assert.deepEqual([await db.reimbursementRequest.count({ where: { companyId, reason: 'saved as default, failing' } }),
      await repos[0]!.findMemberPayoutAccount(companyId, requester)], [0, null]);

    const created = await draft('saved as default', saveDefault(false));
    assert.deepEqual([created.payoutMethod, (await repos[0]!.findMemberPayoutAccount(companyId, requester))?.accountLast4], [undefined, '5678']);
    // The same on a draft edit: a failed default leaves the draft exactly as it was.
    await assert.rejects(repos[0]!.updateDraftRequest(companyId, created.id, created.updatedAt, { reason: 'edited' }, undefined, {
      write: { mode: 'DEFAULT' },
      onPersisted: async (tx: any) => {
        await repos[0]!.setMemberPayoutAccount({ companyId, userId: requester, actorUserId: requester, payoutMethod: 'BANK_TRANSFER', destination: seal(SCB) },
          async () => { throw new Error('the audit row or the notice could not be written'); }, tx);
      },
    }), /could not be written/);
    const untouched = (await repos[0]!.findRequestById(companyId, created.id))!;
    assert.deepEqual([untouched.reason, untouched.updatedAt.getTime(), (await repos[0]!.findMemberPayoutAccount(companyId, requester))?.accountLast4],
      ['saved as default', created.updatedAt.getTime(), '5678']);
  });

  // Payout impact audit M6: "ลบพนักงานที่ยังกรอกไม่เสร็จ" hard-deletes the membership, and whatever
  // account row hangs off it must go with it, not block it. (The use case no longer sets an account
  // for a member who is not active; the row here is written directly to prove the cascade.)
  it('lets a draft employee be deleted together with the payout account set for them', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const membership = await db.companyMembership.create({ data: { companyId, userId: draftEmployee, status: 'DRAFT' }, select: { id: true } });
    const profile = await db.employeeAccessProfile.create({ data: {
      companyId, userId: draftEmployee, membershipId: membership.id, displayName: 'พนักงานใหม่', identityType: 'THAI_NATIONAL_ID',
      identityLast4: '0001', identityHash: `${PAYOUT_TAG}-identity`, identityEncryptedRef: 'sealed', phoneNumber: `${PAYOUT_TAG}-phone`,
      status: 'DRAFT', createdByUserId: approver,
    }, select: { id: true } });
    await repos[0]!.setMemberPayoutAccount({ companyId, userId: draftEmployee, actorUserId: approver, payoutMethod: 'BANK_TRANSFER', destination: seal(KBANK) }, async () => undefined);
    assert.equal((await repos[0]!.findMemberPayoutAccount(companyId, draftEmployee))?.updatedByUserId, approver);

    await new DeleteEmployeeDraftUseCase({ client: db } as any).execute({
      companyId, employeeId: profile.id, requestingUserId: approver, requesterPermissions: ['access.employee.disable'], requestId: `${PAYOUT_TAG}-delete-draft`,
    });
    assert.deepEqual([
      await db.companyMembership.count({ where: { id: membership.id } }),
      await db.employeeAccessProfile.count({ where: { id: profile.id } }),
      await db.memberPayoutAccount.count({ where: { companyId, userId: draftEmployee } }),
    ], [0, 0, 0]);
    // The shared user row itself is untouched, as before.
    assert.equal(await db.user.count({ where: { id: draftEmployee } }), 1);
  });

  it('knows from their roles whether a member manages people, for the rule about whose account an editor may set', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    assert.deepEqual(await repos[0]!.findPayoutMember(companyId, requester), {
      displayName: requester, membershipStatus: 'ACTIVE', hasEmployeeProfile: false, managesPeople: false, allBranches: true, branchIds: [],
    });
    // The status is the membership's own, the one the notification writer filters recipients by.
    for (const status of ['DRAFT', 'INVITED', 'SUSPENDED', 'DISABLED', 'ACTIVE'] as const) {
      await db.companyMembership.update({ where: { companyId_userId: { companyId, userId: requester } }, data: { status } });
      assert.equal((await repos[0]!.findPayoutMember(companyId, requester))?.membershipStatus, status);
    }
    assert.equal(await repos[0]!.findPayoutMember(companyId, outsider), null, 'not a member of this company');
    const approverMembership = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId, userId: approver } }, select: { id: true } });
    // A plain custom role does not manage people; one that carries the employee-edit grant does, whatever it is called.
    const permission = await db.permission.upsert({ where: { key: 'access.employee.update' }, update: {}, create: { key: 'access.employee.update', description: 'Update employee access profile/role' } });
    const plain = await db.role.create({ data: { companyId, scopeKey: companyId, key: `${PAYOUT_TAG}-cashier`, name: 'แคชเชียร์' } });
    await db.membershipRole.create({ data: { membershipId: approverMembership.id, roleId: plain.id } });
    assert.equal((await repos[0]!.findPayoutMember(companyId, approver))?.managesPeople, false);
    const lead = await db.role.create({ data: { companyId, scopeKey: companyId, key: `${PAYOUT_TAG}-shift-lead`, name: 'หัวหน้ากะ', permissions: { create: [{ permissionId: permission.id }] } } });
    await db.membershipRole.create({ data: { membershipId: approverMembership.id, roleId: lead.id } });
    assert.equal((await repos[0]!.findPayoutMember(companyId, approver))?.managesPeople, true);
    // A role named like the system manager counts by its key alone.
    await db.membershipRole.deleteMany({ where: { membershipId: approverMembership.id } });
    const manager = await db.role.create({ data: { companyId, scopeKey: companyId, key: 'MANAGER', name: 'ผู้จัดการ' } });
    await db.membershipRole.create({ data: { membershipId: approverMembership.id, roleId: manager.id } });
    assert.equal((await repos[0]!.findPayoutMember(companyId, approver))?.managesPeople, true);
    await db.membershipRole.deleteMany({ where: { membershipId: approverMembership.id } });
  });

  // Security review M1 and S2, with the real notification writer. It makes recipients of ACTIVE
  // members only, so a notice for anyone else is an event nobody receives: that is why the use case
  // refuses them. And a notice is written for the one person it concerns, with the change itself.
  it('writes the notice for the account owner alone, with the change, and refuses a member it could not reach', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const writer = new CreateOrUpdateNotificationEventUseCase(null as never, null as never, null as never, null as never, null as never, { client: db } as never);
    const payouts = new MemberPayoutAccountUseCase(repos[0]!, { log: async () => undefined } as never, { credentialEncryptionKey: key } as never, writer);
    const editor = { requestId: `${PAYOUT_TAG}-notice`, userId: approver, companyId, roles: ['MANAGER'], permissions: ['access.employee.read', 'access.employee.update', 'reimbursement.create', 'reimbursement.finance_review'], scopes: {} } as never;
    const membership = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId, userId: requester } }, select: { id: true } });
    // An employee record makes the requester someone an editor may set an account for.
    const profile = await db.employeeAccessProfile.create({ data: {
      companyId, userId: requester, membershipId: membership.id, displayName: 'สมชาย', identityType: 'THAI_NATIONAL_ID',
      identityLast4: '0002', identityHash: `${PAYOUT_TAG}-notice-identity`, identityEncryptedRef: 'sealed', phoneNumber: `${PAYOUT_TAG}-notice-phone`,
      status: 'ACTIVE', createdByUserId: approver,
    }, select: { id: true } });
    const told = () => db.notificationRecipient.findMany({
      where: { companyId }, orderBy: { createdAt: 'asc' },
      select: { userId: true, event: { select: { triggerKey: true, severity: true, title: true, body: true, deepLinkHref: true } }, deliveries: { select: { channel: true }, orderBy: { channel: 'asc' } } },
    });
    try {
      await repos[0]!.removeMemberPayoutAccount(companyId, requester, async () => undefined);
      for (const status of ['DRAFT', 'INVITED', 'SUSPENDED', 'DISABLED'] as const) {
        await db.companyMembership.update({ where: { id: membership.id }, data: { status } });
        await refusedBy(() => payouts.setForMember(editor, requester, { payoutMethod: 'BANK_TRANSFER', ...KBANK }), /payout_account_member_not_active/, status);
        // What the refusal prevents: the writer takes the event and gives it to nobody.
        await db.$transaction((tx) => writer.executeInTransaction({
          companyId, triggerKey: 'reimbursement.payout_account_set_by_other', sourceModule: 'reimbursements', sourceType: 'member_payout_account',
          sourceId: requester, periodKey: `unreachable-${status}`, severity: 'critical', title: 'ไม่มีผู้รับ', body: 'ไม่มีผู้รับ', recipientUserIds: [requester],
        }, tx));
      }
      assert.deepEqual([await repos[0]!.findMemberPayoutAccount(companyId, requester), (await told()).length, await db.notificationEvent.count({ where: { companyId } })], [null, 0, 4]);
      await db.notificationEvent.deleteMany({ where: { companyId } });

      // Active again: the account is set and the notice is there, for that one member, on both channels.
      await db.companyMembership.update({ where: { id: membership.id }, data: { status: 'ACTIVE' } });
      const saved = await payouts.setForMember(editor, requester, { payoutMethod: 'BANK_TRANSFER', ...KBANK });
      assert.equal(saved.account?.accountLast4, '5678');
      const [defaultNotice, ...none] = await told();
      assert.equal(none.length, 0);
      assert.deepEqual([defaultNotice!.userId, defaultNotice!.event.triggerKey, defaultNotice!.event.severity, defaultNotice!.event.title, defaultNotice!.event.deepLinkHref, defaultNotice!.deliveries.map((delivery) => delivery.channel)],
        [requester, 'reimbursement.payout_account_set_by_other', 'CRITICAL', `${approver} ตั้งบัญชีรับเงินคืนของคุณ`, `/companies/${companyId}/reimbursements/payout-account`, ['WEB', 'LINE']]);
      assert.match(defaultNotice!.event.body, /^ธนาคารกสิกรไทย เลขบัญชีลงท้าย 5678 ตั้งเมื่อ /);

      // The same for an account typed into a claim filed for the requester: one notice, to the requester, linking the claim.
      const typed = await payouts.draftPayoutChange(editor, requester, { mode: 'SPECIFIED', ...SCB });
      const claim = await draft('typed by a preparer', typed);
      const notices = await told();
      assert.equal(notices.length, 2);
      assert.deepEqual([notices[1]!.userId, notices[1]!.event.title, notices[1]!.event.deepLinkHref, notices[1]!.deliveries.length],
        [requester, `${approver} ระบุบัญชีรับเงินคืนในใบเบิกของคุณ`, `/companies/${companyId}/reimbursements/${claim.id}`, 2]);
      assert.match(notices[1]!.event.body, /^ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 1112 ระบุเมื่อ /);
      // Nobody else in the company was written to, and no text carries a number.
      assert.ok(notices.every((notice) => notice.userId === requester));
      for (const number of [KBANK.accountNumber, SCB.accountNumber]) assert.equal(JSON.stringify(notices).includes(number), false);
      // A change that fails takes its notice with it: the draft, the account row and the notice are one transaction.
      await db.companyMembership.update({ where: { id: membership.id }, data: { status: 'SUSPENDED' } });
      await assert.rejects(payouts.draftPayoutChange(editor, requester, { mode: 'SPECIFIED', ...KBANK }), /payout_account_member_not_active/);
      assert.equal((await told()).length, 2);
    } finally {
      await db.companyMembership.update({ where: { id: membership.id }, data: { status: 'ACTIVE' } });
      await db.notificationEvent.deleteMany({ where: { companyId } });
      await db.employeeAccessProfile.delete({ where: { id: profile.id } });
    }
  });

  // Security review S6: "owner or admin" is the system role, never a key. A role a company makes
  // takes its key from its name, and the copy a company gets by editing the Admin role is stored the
  // same way: company scope, same key, not a system role.
  it('counts only the system owner or admin role, not a company role that carries the same key', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const membership = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId, userId: approver } }, select: { id: true } });
    const holds = () => repos[0]!.holdsSystemOwnerOrAdminRole(companyId, approver);
    const give = async (roleId: string) => {
      await db.membershipRole.deleteMany({ where: { membershipId: membership.id } });
      await db.membershipRole.create({ data: { membershipId: membership.id, roleId } });
    };
    const created: string[] = [];
    try {
      assert.equal(await holds(), false, 'no role at all');
      for (const [key, name] of [['ADMIN', 'Admin'], ['OWNER', 'Owner']] as const) {
        // What CreateRoleUseCase writes for a role named "Admin", and what a company's edited copy of the Admin role looks like.
        await give((await db.role.create({ data: { companyId, scopeKey: companyId, key, name, isSystem: false } })).id);
        assert.equal(await holds(), false, `a company role with the key ${key}`);
        const existing = await db.role.findUnique({ where: { scopeKey_key: { scopeKey: 'system', key } } });
        const system = existing ?? await db.role.create({ data: { scopeKey: 'system', key, name, isSystem: true } });
        if (!existing) created.push(system.id);
        await give(system.id);
        assert.equal(await holds(), true, `the system role ${key}`);
        assert.equal(await repos[0]!.holdsSystemOwnerOrAdminRole(otherCompanyId, approver), false, 'not a member of that company');
        // A member who is not active holds nothing for this purpose.
        await db.companyMembership.update({ where: { id: membership.id }, data: { status: 'SUSPENDED' } });
        assert.equal(await holds(), false, 'a suspended member');
        await db.companyMembership.update({ where: { id: membership.id }, data: { status: 'ACTIVE' } });
      }
      // Any other system role is not owner or admin.
      const existingManager = await db.role.findUnique({ where: { scopeKey_key: { scopeKey: 'system', key: 'MANAGER' } } });
      const manager = existingManager ?? await db.role.create({ data: { scopeKey: 'system', key: 'MANAGER', name: 'Manager', isSystem: true } });
      if (!existingManager) created.push(manager.id);
      await give(manager.id);
      assert.equal(await holds(), false, 'the system manager role');
    } finally {
      await db.membershipRole.deleteMany({ where: { membershipId: membership.id } });
      await db.role.deleteMany({ where: { id: { in: created } } });
      await db.role.deleteMany({ where: { scopeKey: companyId, key: { in: ['ADMIN', 'OWNER'] } } });
    }
  });

  it('keeps every snapshot row inside its own claim and company', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const claim = await draft('row ownership', { write: { mode: 'SPECIFIED', destination: seal(KBANK), source: 'REQUESTER', actorUserId: requester } });
    const row = { reimbursementRequestId: claim.id, version: 2, ...seal(SCB), source: 'REQUESTER', createdByUserId: requester };
    await refusedBy(() => db.reimbursementPayoutDestination.create({ data: { ...row, companyId, version: 1 } as any }), /ReimbursementPayoutDestination_request_version_key|P2002|Unique constraint/i, 'a second row for the same version');
    await refusedBy(() => db.reimbursementPayoutDestination.create({ data: { ...row, companyId: otherCompanyId } as any }), /ReimbursementPayoutDestination_request_fkey|P2003|Foreign key constraint/i, 'a row filed under another company');
    await refusedBy(() => db.reimbursementPayoutDestination.create({ data: { ...row, companyId, version: 0 } as any }), /ReimbursementPayoutDestination_version_check/, 'version 0');
    await refusedBy(() => db.reimbursementPayoutDestination.create({ data: { ...row, companyId, accountLast4: '12' } as any }), /ReimbursementPayoutDestination_shape_check/, 'two digits where four belong');
    await refusedBy(() => db.reimbursementPayoutDestination.create({ data: { ...row, companyId, bankName: null } as any }), /ReimbursementPayoutDestination_shape_check/, 'a bank account without a bank');
    assert.equal((await destinationsOf(claim.id)).length, 1);
    // A deleted draft takes its account with it; nothing is left to decrypt.
    await db.reimbursementRequest.delete({ where: { id: claim.id } });
    assert.equal((await destinationsOf(claim.id)).length, 0);
  });
});
