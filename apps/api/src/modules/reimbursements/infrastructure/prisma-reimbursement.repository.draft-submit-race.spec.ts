/** Real PostgreSQL proof that an edit and submit cannot both commit. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { reimbursementHubBucket, reimbursementPaidNotice } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { MaterializeClaimExpensesService } from '../application/services/materialize-claim-expenses.service';
import { claimSignatureAckHash, claimSnapshotFields, computeLegacySnapshotHashV1, computeSnapshotHash } from '../domain/logic/reimbursement.logic';
import { PrismaReimbursementRepository } from './prisma-reimbursement.repository';
import { readReimbursementSource, resolveReimbursementSourceLines, assertReimbursementSources, assertProjectionSource } from './reimbursement-source';
import { expenseTaxSourceChecksum } from '../../expenses/domain/logic/expense-status.logic';
import { ConfirmExpenseUseCase } from '../../expenses/application/use-cases/expense-draft.use-case';
import { PrismaAttachmentRepository } from '../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { ReimbursementEvidenceService } from '../application/services/reimbursement-evidence.service';
import { PrismaExpenseRepository } from '../../expenses/infrastructure/prisma-expense.repository';
import { DeleteEmployeeDraftUseCase } from '../../employee-access/application/use-cases/delete-employee-draft.use-case';
import { CreateOrUpdateNotificationEventUseCase } from '../../dashboard-notifications/application/use-cases/notification.use-cases';
import { VoidReimbursementPaymentUseCase } from '../application/use-cases/reimbursement-finance.use-case';
import { ListReimbursementsUseCase } from '../application/use-cases/reimbursement-request.use-case';
import { LineReimbursementDraftAdapterService } from '../../line-ai/application/line-reimbursement-draft-adapter.service';
import { PrismaWorkflowRepository } from '../../workflow/infrastructure/prisma-workflow.repository';
import { RunWorkflowRuleUseCase } from '../../workflow/application/use-cases/workflow-runner.use-case';
import { ExecuteWorkflowActionUseCase } from '../../workflow/application/use-cases/workflow-action-runner.use-case';
import { WORKFLOW_TEMPLATE_CATALOG } from '../../workflow/domain/workflow-template-catalog';
import { buildRunDedupKey } from '../../workflow/domain/logic/workflow-idempotency.logic';
import { PrismaBankingRepository } from '../../banking/infrastructure/prisma-banking.repository';
import { PrismaMatchSourceQuery } from '../../banking/infrastructure/prisma-match-source.query';
import { ConfirmMatchUseCase, ListMatchCandidatesUseCase } from '../../banking/application/use-cases/matching.use-case';
import {
  CompleteReconciliationSessionUseCase, CreateReconciliationSessionUseCase, ReopenReconciliationSessionUseCase,
} from '../../banking/application/use-cases/reconciliation.use-case';
import { MemberPayoutAccountUseCase } from '../application/use-cases/reimbursement-payout.use-case';
import {
  CASH_PAYOUT_FINGERPRINT, legacyPayoutConfirmToken, openPayoutAccountNumber, payoutFingerprint, payoutSubmitToken, sealPayoutDestination, type SubmitPayoutColumns,
} from '../domain/logic/payout-destination.logic';
import { RejectExpenseUseCase, VoidExpenseUseCase } from '../../expenses/application/use-cases/expense-draft.use-case';
import { DeleteExpenseUseCase } from '../../expenses/application/use-cases/delete-expense.use-case';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';
import { ReserveDocumentNumberUseCase } from '../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../data-model-core/application/use-cases/commit-document-number.use-case';
import { CancelDocumentNumberUseCase } from '../../data-model-core/application/use-cases/cancel-document-number.use-case';
import {
  CancelReimbursementUseCase, GetReimbursementDetailUseCase, ResumeReimbursementUseCase, WithdrawReimbursementCancellationUseCase,
} from '../application/use-cases/reimbursement-request.use-case';
import { ReimbursementProjectionOrchestratorService } from '../application/services/reimbursement-projection-orchestrator.service';
import { ReimbursementProjectionReconcilerService } from '../application/services/reimbursement-projection-reconciler.service';
import { ListReimbursementApproverOptionsUseCase } from '../application/use-cases/reimbursement-policy.use-case';
import { ListFinanceQueueUseCase } from '../application/use-cases/reimbursement-finance.use-case';
import { toRequestSummary } from '../application/dto/reimbursement.mapper';
import { ApproveReimbursementUseCase, RejectReimbursementUseCase } from '../application/use-cases/reimbursement-approval.use-case';
import { RequestPayoutCorrectionUseCase, SubmitPayoutCorrectionUseCase } from '../application/use-cases/reimbursement-payout-correction.use-case';
import { eligibleClaimSignatureRoles, SignClaimFormUseCase } from '../application/use-cases/reimbursement-claim-signature.use-case';

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

/**
 * The system side of a claim over one connection: the real reconciler (the scheduled run, and the
 * repair behind "ดำเนินการต่อ") with the real orchestrator, expense confirmation and expense void.
 * The run reads every company's claims and this database is shared with other suites, so the two
 * lists it works from are kept to one company; everything it does with a claim is the real thing.
 */
function claimSystem(client: PrismaClient, repo: PrismaReimbursementRepository, companyId: string) {
  const prisma = { client } as any;
  const audit = { log: (entry: any, tx?: any) => new PrismaAuditRepository(prisma).log(entry, tx) } as any;
  const numbers = new PrismaDocumentSequenceRepository(prisma);
  const expenses = new PrismaExpenseRepository(prisma);
  const voidExpense = new VoidExpenseUseCase(expenses, audit, { append: async () => undefined } as any,
    new ReserveDocumentNumberUseCase(numbers, audit), new CommitDocumentNumberUseCase(numbers, audit), new CancelDocumentNumberUseCase(numbers, audit));
  const confirm = new ConfirmExpenseUseCase(expenses, audit, { resolveLines: async () => [] } as any, {} as any);
  const orchestrator = new ReimbursementProjectionOrchestratorService(repo, expenses, new MaterializeClaimExpensesService(), confirm, audit);
  const ownCompany = <T extends { request: { companyId: string } }>(rows: T[], limit: number) => rows.filter((row) => row.request.companyId === companyId).slice(0, limit);
  const scoped = Object.create(repo, {
    // These cases run the pass the moment a decision is on record. The minute a real pass leaves to the
    // request that is carrying the decision out has a case of its own.
    listPendingProjectionIntents: { value: async (limit = 100) => ownCompany(await repo.listPendingProjectionIntents(1000, new Date(Date.now() + 60_000)), limit) },
    listPendingCancellationIntents: { value: async (limit = 100) => ownCompany(await repo.listPendingCancellationIntents(1000), limit) },
  }) as PrismaReimbursementRepository;
  const reconciler = new ReimbursementProjectionReconcilerService(scoped, orchestrator, audit, voidExpense, prisma, new ListReimbursementApproverOptionsUseCase(prisma));
  // The run logs a line per claim; these cases read the tables instead.
  (reconciler as any).logger = { log: () => undefined, warn: () => undefined };
  return {
    reconciler,
    /** Builds and confirms a decided claim's expense records, and stops there. */
    orchestrator,
    resume: new ResumeReimbursementUseCase(repo, audit, reconciler, new ReimbursementEvidenceService(new PrismaAttachmentRepository(prisma), expenses)),
  };
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
    // The number sequence row exists once a submit has committed. The race test above usually leaves one, but not
    // when the edit won every one of its rounds, and this test then failed on the read below. One claim is sent
    // here first, so the test stands on its own now that CI runs this file against a database.
    await repos[0]!.submitDraftAtomic(submitInput(await createDraft('stale-number-seed')));
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
  function interleavedClient(between: () => Promise<unknown>) {
    return new Proxy(clients[0]!, { get(target, property) {
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
  }
  function interleavedRepo(between: () => Promise<unknown>) {
    return new PrismaReimbursementRepository({ client: interleavedClient(between) } as any, new PrismaDocumentSequenceRepository({ client: clients[0]! } as any));
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
    // A sound file from the claim's own signed copies that is also something else's evidence: its own
    // refusal, so the payer is told to attach the slip as a new file and not that the file is bad.
    for (const file of [alsoAReceipt, alsoAnotherClaims, alsoALineReceipt]) {
      const before = await linksOf(file.id);
      await assert.rejects(() => moveToSlip(claim.requestId, cash.payment.id, file.id), /payment_slip_in_use_elsewhere/);
      await assert.rejects(() => repos[0]!.assertPaymentSlipUsable({ companyId, requestId: claim.requestId, attachmentId: file.id, actorUserId: `${TAG}-finance` }), /payment_slip_in_use_elsewhere/);
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
    await assert.rejects(() => repos[0]!.recordPaymentAtomic(transfer(repayable.requestId, 'copy-race-transfer', second.id)), /payment_slip_in_use_elsewhere/);

    // The same order against the later attach. It reads committed rows once it holds the lock, so it refuses outright.
    const third = await signedCopyOf(claim.requestId);
    const interleavedAttach = interleavedRepo(() => copyOntoAnotherClaim(third.id));
    await assert.rejects(() => moveToSlip(claim.requestId, cash.payment.id, third.id, interleavedAttach), /payment_slip_in_use_elsewhere/);
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

  // ---- A claim payment and the bank statement (impact audit B7, review 2026-10-01) ----
  // Voiding a payment must not leave a bank statement line matched to it. Every step a person takes
  // here goes through its own use case (the bank screen's confirm, complete and reopen, the claim
  // page's void); only the fixtures, a bank account and a statement line, are written directly.

  const quiet = { log: async () => undefined, append: async () => undefined } as any;
  const financeCtx = (requestId = `${TAG}-bank`) => ({
    companyId, userId: `${TAG}-finance`, requestId, scopes: {}, roles: [], authProvider: 'dev',
    permissions: ['bank.match.read', 'bank.match.confirm', 'bank.reconciliation.create', 'bank.reconciliation.complete', 'bank.reconciliation.reopen', 'reimbursement.payment.void'],
  }) as any;
  // The bank screen on its own connection, as another person at another desk.
  const banking = () => new PrismaBankingRepository({ client: clients[1]! } as any);
  /** A bank account linked to the ledger, with one withdrawal line of 100 baht as a statement import leaves it. */
  async function bankLine() {
    const db = clients[0]!;
    const ledger = await db.chartOfAccount.create({ data: { companyId, code: `${TAG}-bank-${++fileSequence}`, nameTh: 'เงินฝากธนาคาร', accountClass: 'ASSET', normalBalance: 'DEBIT' } });
    const account = await db.bankAccount.create({ data: { companyId, branchId, displayName: `${TAG}-bank-${fileSequence}`, ledgerAccountId: ledger.id, createdByUserId: `${TAG}-finance` } });
    const line = await db.bankStatementLine.create({ data: {
      companyId, bankAccountId: account.id, sourceType: 'MANUAL', lineHash: `${TAG}-line-${fileSequence}`, postedDate: new Date('2026-10-01T03:00:00.000Z'),
      description: 'โอนเงินคืนพนักงาน', direction: 'WITHDRAWAL', signedAmount: '-100.0000',
    } });
    return {
      accountId: account.id,
      lineId: line.id,
      status: async () => (await db.bankStatementLine.findUniqueOrThrow({ where: { id: line.id } })).status,
      matches: async () => (await db.bankReconciliationMatch.findMany({ where: { companyId, statementLineId: line.id }, orderBy: { createdAt: 'asc' } }))
        .map((match) => [match.sourceId, match.status]),
      remove: async () => {
        await db.bankReconciliationSession.deleteMany({ where: { companyId, bankAccountId: account.id } });
        await db.bankReconciliationMatch.deleteMany({ where: { companyId, bankAccountId: account.id } });
        await db.bankStatementLine.deleteMany({ where: { companyId, bankAccountId: account.id } });
        await db.bankAccount.deleteMany({ where: { id: account.id } });
        await db.chartOfAccount.deleteMany({ where: { id: ledger.id } });
      },
    };
  }
  const confirmMatch = (lineId: string, paymentId: string) => new ConfirmMatchUseCase(banking(), quiet, quiet).execute(financeCtx(), {
    statementLineId: lineId, sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: paymentId, allocatedAmount: '100.0000', currency: 'THB',
  });
  /** What the bank matching screen lists for an account: its open lines and the payments it offers for them. */
  const matchingScreen = (accountId: string) => new ListMatchCandidatesUseCase(banking(), new PrismaMatchSourceQuery({ client: clients[1]! } as any))
    .execute(financeCtx(), accountId);
  const voidPayment = (requestId: string, paymentId: string, auditRequestId?: string) => new VoidReimbursementPaymentUseCase(
    repos[0]!, { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) } as any,
  ).execute(financeCtx(auditRequestId), requestId, paymentId, { reason: 'โอนผิดบัญชี' });

  it('voids a payment a bank line is fully matched to: the match is undone with it, and the claim and the line can both move again', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const paid = await cashPayment(claim.requestId, 'bank-matched');
    const bank = await bankLine();
    const db = clients[0]!;
    try {
      // The bank screen confirms the whole line against the payment. A fully matched line then leaves that
      // screen's list, so its "ยกเลิกการจับคู่" cannot be reached: the void is the only way left.
      const match = await confirmMatch(bank.lineId, paid.payment.id);
      assert.equal(await bank.status(), 'MATCHED');
      assert.deepEqual((await matchingScreen(bank.accountId)).lines, []);

      // Before: 409 reimbursement_payment_bank_matched, with nothing in the product that could lift it.
      const voidRequestId = `${TAG}-void-matched`;
      const voided = await voidPayment(claim.requestId, paid.payment.id, voidRequestId);
      assert.deepEqual([voided.status, voided.paymentStatus, voided.payments.map((payment) => payment.status)], ['READY_FOR_PAYMENT', 'UNPAID', ['VOIDED']]);
      assert.equal((await db.expenseRecord.findUniqueOrThrow({ where: { id: claim.projectionId } })).paymentStatus, 'UNPAID');
      // The match is undone and the line reads by the bank module's own rule: nothing confirmed, so unmatched.
      assert.deepEqual(await bank.matches(), [[paid.payment.id, 'VOIDED']]);
      assert.equal(await bank.status(), 'UNMATCHED');
      // Both changes are on record, made by the person who voided, in the one request.
      const audits = await db.auditLog.findMany({ where: { companyId, requestId: voidRequestId }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(audits.map((row) => [row.action, row.targetType, row.targetId, row.actorUserId, row.result, row.riskLevel]), [
        ['reimbursement.payment.void', 'reimbursement_payment', paid.payment.id, `${TAG}-finance`, 'SUCCESS', 'CRITICAL'],
        ['bank.match.void', 'bank_reconciliation_match', match.id, `${TAG}-finance`, 'SUCCESS', 'HIGH'],
      ]);
      assert.deepEqual(audits[1]!.metadataJson, { statementLineId: bank.lineId, reason: 'reimbursement_payment_voided', paymentId: paid.payment.id, requestId: claim.requestId });

      // Nothing is stuck. The claim is paid again, and the bank screen lists the line again, offers the new
      // payment for it and no longer the voided one, and takes the match.
      const again = await cashPayment(claim.requestId, 'bank-matched-again');
      assert.deepEqual([again.created, again.request.status], [true, 'PAID']);
      const screen = await matchingScreen(bank.accountId);
      assert.deepEqual(screen.lines.map((line) => [line.id, line.status]), [[bank.lineId, 'UNMATCHED']]);
      const offered = screen.candidates.map((candidate) => candidate.sourceId);
      assert.deepEqual([offered.includes(again.payment.id), offered.includes(paid.payment.id)], [true, false]);
      await confirmMatch(bank.lineId, again.payment.id);
      assert.equal(await bank.status(), 'MATCHED');
      assert.deepEqual(await bank.matches(), [[paid.payment.id, 'VOIDED'], [again.payment.id, 'CONFIRMED']]);
    } finally {
      await bank.remove();
    }
  });

  it('refuses the void only while the matched line sits in a completed reconciliation, and voids once that reconciliation is reopened', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const paid = await cashPayment(claim.requestId, 'bank-reconciled');
    const bank = await bankLine();
    const db = clients[0]!;
    try {
      await confirmMatch(bank.lineId, paid.payment.id);
      const session = await new CreateReconciliationSessionUseCase(banking(), quiet).execute(financeCtx(), {
        bankAccountId: bank.accountId, periodStartDate: '2026-09-01', periodEndDate: '2026-10-31',
        openingStatementBalanceAmount: '0.00', closingStatementBalanceAmount: '0.00', currency: 'THB',
      });
      // An open reconciliation holds nothing; a completed one holds its lines as they stood.
      assert.equal((await new CompleteReconciliationSessionUseCase(banking(), quiet, quiet).execute(financeCtx(), session.id)).status, 'COMPLETED');

      const refused = `${TAG}-void-reconciled`;
      await assert.rejects(() => voidPayment(claim.requestId, paid.payment.id, refused),
        (error: any) => error.getStatus() === 409 && errorCode(error) === 'reimbursement_payment_bank_reconciled');
      // Nothing moved: the payment stands, the claim is still paid, the match and the line are as the reconciliation recorded them.
      assert.deepEqual((await paymentsOf(claim.requestId)).map((payment) => [payment.status, payment.voidedAt]), [['RECORDED', null]]);
      const still = await db.reimbursementRequest.findUniqueOrThrow({ where: { id: claim.requestId } });
      assert.deepEqual([still.status, still.paymentStatus, still.outstandingAmount.toString()], ['PAID', 'PAID', '0']);
      assert.equal((await db.expenseRecord.findUniqueOrThrow({ where: { id: claim.projectionId } })).paymentStatus, 'PAID');
      assert.deepEqual([await bank.matches(), await bank.status()], [[[paid.payment.id, 'CONFIRMED']], 'MATCHED']);
      assert.equal(await db.auditLog.count({ where: { companyId, requestId: refused } }), 0);

      // The way out the message names: reopen that reconciliation on the bank screen, then void.
      await new ReopenReconciliationSessionUseCase(banking(), quiet, quiet).execute(financeCtx(), session.id, 'ยกเลิกการจ่ายที่จับคู่ไว้');
      const voided = await voidPayment(claim.requestId, paid.payment.id);
      assert.deepEqual([voided.status, voided.paymentStatus], ['READY_FOR_PAYMENT', 'UNPAID']);
      assert.deepEqual([await bank.matches(), await bank.status()], [[[paid.payment.id, 'VOIDED']], 'UNMATCHED']);
    } finally {
      await bank.remove();
    }
  });

  // ---- The bank confirm reads the payment it matches (review 2026-10-01) ----
  // The confirm stored its source unread. It now needs the claim payment RECORDED, read under the lock the
  // void takes, in a serializable transaction like the void's: whichever of the two read the other's past
  // is rolled back by PostgreSQL and runs again.

  /** Whether a transaction is queued for the lock every writer of this claim's payments takes, before `other` settles. */
  async function queuedForPaymentLock(requestId: string, other: Promise<unknown>): Promise<boolean> {
    const key = `${companyId}:${requestId}:reimbursement-payment`;
    let settled = false;
    void other.then(() => { settled = true; });
    for (let attempt = 0; attempt < 200 && !settled; attempt += 1) {
      // An advisory lock on one bigint key shows the key's low half as `objid`.
      const [row] = await clients[1]!.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*) AS waiting FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND objid::bigint = (hashtext(${key})::bigint & 4294967295)`;
      if (Number(row!.waiting) > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }
  const paymentNotRecorded = (error: any) => error?.getStatus?.() === 409 && errorCode(error) === 'bank_match_payment_not_recorded';

  it('refuses to match a bank line to a claim payment voided since the bank screen listed it', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const paid = await cashPayment(claim.requestId, 'stale-candidate');
    const bank = await bankLine();
    try {
      // The bank screen is open and offers the payment; a few minutes later the payment is voided on the claim's page.
      assert.equal((await matchingScreen(bank.accountId)).candidates.some((candidate) => candidate.sourceId === paid.payment.id), true);
      await voidPayment(claim.requestId, paid.payment.id);
      // Before: the match was confirmed, and the line read matched to a payment that no longer stands.
      await assert.rejects(() => confirmMatch(bank.lineId, paid.payment.id), paymentNotRecorded);
      assert.deepEqual([await bank.matches(), await bank.status()], [[], 'UNMATCHED']);
      // A payment this company does not have is refused the same way: the id alone proves nothing.
      await assert.rejects(() => confirmMatch(bank.lineId, `${TAG}-no-such-payment`), paymentNotRecorded);
      assert.deepEqual([await bank.matches(), await bank.status()], [[], 'UNMATCHED']);
    } finally {
      await bank.remove();
    }
  });

  it('queues a confirm behind a void in flight, and refuses it once the void has committed', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const paid = await cashPayment(claim.requestId, 'confirm-behind-void');
    const bank = await bankLine();
    try {
      let confirming: Promise<unknown> | undefined;
      let queued = false;
      // The void holds the payment lock and has taken its snapshot when the bank screen confirms the match.
      const racing = interleavedRepo(async () => {
        confirming = confirmMatch(bank.lineId, paid.payment.id).then(() => 'confirmed', (error) => error);
        queued = await queuedForPaymentLock(claim.requestId, confirming);
      });
      const voided = await racing.voidPaymentTrueReversal(companyId, claim.requestId, paid.payment.id, `${TAG}-finance`, 'โอนผิดบัญชี');
      assert.equal(voided.payment.status, 'VOIDED');
      // Before: the confirm took no lock and read nothing, so it committed in the middle of the void, which
      // had already looked for matches: the line stayed matched to the voided payment.
      assert.equal(queued, true, 'the confirm waits for the lock the void holds');
      assert.equal(paymentNotRecorded(await confirming), true, `refused, not ${String(await confirming)}`);
      assert.deepEqual([await bank.matches(), await bank.status()], [[], 'UNMATCHED']);
    } finally {
      await bank.remove();
    }
  });

  it('queues a void behind a confirm in flight, and the void then undoes the match that confirm made', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const paid = await cashPayment(claim.requestId, 'void-behind-confirm');
    const bank = await bankLine();
    const db = clients[0]!;
    try {
      let voiding: Promise<unknown> | undefined;
      let queued = false;
      const auditRequestId = `${TAG}-void-behind-confirm`;
      // The confirm has read the payment and holds its lock when the claim's page voids it, on another connection.
      const interleaved = new PrismaBankingRepository({ client: interleavedClient(async () => {
        voiding = repos[1]!.voidPaymentTrueReversal(companyId, claim.requestId, paid.payment.id, `${TAG}-finance`, 'โอนผิดบัญชี', undefined, auditRequestId)
          .then((result) => result.payment.status, (error) => error);
        queued = await queuedForPaymentLock(claim.requestId, voiding);
      }) } as any);
      const match = await new ConfirmMatchUseCase(interleaved, quiet, quiet).execute(financeCtx(), {
        statementLineId: bank.lineId, sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: paid.payment.id, allocatedAmount: '100.0000', currency: 'THB',
      });
      // Before: the confirm ran no transaction and took no lock, so nothing could queue behind it.
      assert.ok(voiding, 'the confirm reads the payment in a transaction, under the payment lock');
      assert.equal(queued, true, 'the void waits for the lock the confirm holds');
      // The void had taken its snapshot before the confirm committed, so it could not see the match. PostgreSQL
      // rolls that attempt back, and the attempt after it finds the match and undoes it.
      assert.equal(await voiding, 'VOIDED');
      assert.deepEqual([await bank.matches(), await bank.status()], [[[paid.payment.id, 'VOIDED']], 'UNMATCHED']);
      assert.deepEqual((await db.auditLog.findMany({ where: { companyId, requestId: auditRequestId }, orderBy: { createdAt: 'asc' } }))
        .map((row) => [row.action, row.targetId]), [['reimbursement.payment.void', paid.payment.id], ['bank.match.void', match.id]]);
    } finally {
      await bank.remove();
    }
  });

  // ---- The hub list (spec §18.1, §25.1 I1; review 2026-10-01) ----
  // The number on every card and chip is the rows its filter returns over all pages. The fakes of the list's own
  // spec cannot say what PostgreSQL does with the scope predicates, the case-insensitive search, the amount and
  // the paging order, so the whole rule is asked of the real database: every scope, with and without a search.

  it('counts every hub card as the rows its filter returns over all pages: company, own, related and branch-limited, with and without a search', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const hub = (await db.company.create({ data: { name: `${TAG}-hub`, status: 'ACTIVE' }, select: { id: true } })).id;
    try {
      const [north, south] = await Promise.all(['N', 'S'].map(async (code) => (await db.branch.create({
        data: { companyId: hub, code: `HUB-${code}`, name: `${TAG}-hub-${code}` }, select: { id: true },
      })).id));
      // Every status pair the hub places differently, six times over: two requesters, two branches and one branchless
      // claim in six, searchable words on some, and a shared creation time on a third so only the id orders them.
      const PAIRS = [['DRAFT', 'NOT_REQUIRED'], ['PENDING_APPROVAL', 'NOT_REQUIRED'], ['FINANCE_REVIEW', 'PENDING'], ['APPROVED', 'PENDING'],
        ['APPROVED', 'NOT_REQUIRED'], ['READY_FOR_PAYMENT', 'APPROVED_FOR_PAYMENT'], ['PAID', 'NOT_REQUIRED'], ['REJECTED', 'NOT_REQUIRED'], ['CANCELLED', 'NOT_REQUIRED']] as const;
      const fixtures = Array.from({ length: PAIRS.length * 6 }, (_, index) => {
        const [status, financeReviewStatus] = PAIRS[index % PAIRS.length]!;
        const mine = index % 2 === 0;
        return {
          id: `${TAG}-hub-${String(index).padStart(3, '0')}`, companyId: hub, branchId: index % 6 === 5 ? null : index % 3 === 0 ? south! : north!,
          requesterUserId: mine ? `${TAG}-user` : `${TAG}-finance`, createdByUserId: mine ? `${TAG}-user` : `${TAG}-finance`,
          requesterDisplayNameSnapshot: mine ? 'สมชาย ใจดี' : 'Somsri K.', requestNo: status === 'DRAFT' ? null : `RB-HUB-${String(index).padStart(5, '0')}`,
          reason: index % 4 === 0 ? 'ค่าแท็กซี่ไปพบลูกค้า' : 'ค่าที่พักต่างจังหวัด', categoryKey: 'travel', categoryLabelSnapshot: index % 5 === 0 ? 'เดินทาง' : null,
          amount: `${1000 + index}.5000`, currency: 'THB', incurredDate: new Date('2026-09-20T00:00:00.000Z'), status, financeReviewStatus,
          // The requester of the other half is this claim's approver, which is what makes it "related" to them.
          currentApproverUserId: index % 7 === 0 ? `${TAG}-finance` : null,
          createdAt: new Date(Date.UTC(2026, 8, 20, 0, 0, index % 3 === 0 ? 0 : index)),
          // Half of the claims waiting for approval were sent back to have their payout account corrected, and are
          // with their requester (payout spec §14): the card that counts them is still the one whose list shows them.
          ...(status === 'PENDING_APPROVAL' && mine && { payoutCorrectionRequestedAt: new Date('2026-09-25T00:00:00.000Z') }),
        };
      });
      await db.reimbursementRequest.createMany({ data: fixtures as any });

      const list = new ListReimbursementsUseCase(repos[0]!);
      const viewer = (userId: string, permissions: string[], branchIds?: string[]) => ({
        companyId: hub, userId, requestId: `${TAG}-hub-list`, permissions, scopes: branchIds ? { branchIds } : {}, roles: [], authProvider: 'dev',
      }) as any;
      type Fixture = (typeof fixtures)[number];
      const scopes: Array<[string, any, (claim: Fixture) => boolean]> = [
        ['company', viewer(`${TAG}-finance`, ['reimbursement.read']), () => true],
        ['own', viewer(`${TAG}-user`, ['reimbursement.read_own']), (claim) => claim.requesterUserId === `${TAG}-user`],
        ['related', viewer(`${TAG}-finance`, ['reimbursement.read_related']),
          (claim) => claim.requesterUserId === `${TAG}-finance` || claim.currentApproverUserId === `${TAG}-finance`],
        // A branch-limited reader sees that branch and the company-central claims that have none.
        ['branch-limited', viewer(`${TAG}-finance`, ['reimbursement.read'], [north!]), (claim) => claim.branchId === north || claim.branchId === null],
      ];
      const has = (claim: Fixture, word: string) => [claim.requestNo, claim.requesterDisplayNameSnapshot, claim.reason, claim.categoryLabelSnapshot]
        .some((text) => typeof text === 'string' && text.toLowerCase().includes(word.toLowerCase())) || Number(claim.amount) === Number(word.replace(/,/g, ''));
      const BUCKETS = ['draft', 'review', 'payment', 'paid', 'closed'] as const;
      /** Every page of one list, seven rows a page, the way the hub walks it. */
      const walk = async (ctx: any, filter: Record<string, unknown>) => {
        const pages: Awaited<ReturnType<typeof list.execute>>[] = [];
        for (let page = 1; ; page += 1) {
          const answer = await list.execute(ctx, { ...filter, page, pageSize: 7 });
          pages.push(answer);
          if (answer.items.length < answer.pageSize || page * answer.pageSize >= answer.total) return pages;
        }
      };

      const sizes: Record<string, number[]> = {};
      for (const [name, ctx, inScope] of scopes) {
        for (const search of [undefined, 'แท็กซี่', 'somsri', 'RB-HUB-0001', '1,012.5', 'สมชาย ที่พัก', 'เดินทาง', 'ไม่มีใบไหนตรง']) {
          const label = `${name} / ${search ?? 'no search'}`;
          const expected = fixtures.filter((claim) => inScope(claim) && (search ?? '').split(/\s+/).filter(Boolean).every((word) => has(claim, word)));
          (sizes[name] ??= []).push(expected.length);
          const all = await walk(ctx, { search });
          const ids = all.flatMap((answer) => answer.items.map((item) => item.id));
          // Every claim once, none missing and none repeated across the pages, and the total says so.
          assert.deepEqual([...ids].sort(), expected.map((claim) => claim.id).sort(), label);
          const summary = all[0]!.hub;
          assert.deepEqual([all[0]!.total, summary.counts.all], [expected.length, expected.length], label);
          assert.equal(BUCKETS.reduce((sum, bucket) => sum + summary.counts[bucket], 0), summary.counts.all, label);
          assert.equal(Number(summary.totalAmount), expected.reduce((sum, claim) => sum + Number(claim.amount), 0), label);
          for (const bucket of BUCKETS) {
            const pages = await walk(ctx, { search, bucket });
            const items = pages.flatMap((answer) => answer.items);
            // The number on the card: the list's total, and the rows of all its pages, each of them of that bucket.
            assert.equal(items.length, summary.counts[bucket], `${label} / ${bucket}`);
            assert.equal(new Set(items.map((item) => item.id)).size, items.length, `${label} / ${bucket}`);
            for (const answer of pages) assert.deepEqual([answer.total, answer.hub], [summary.counts[bucket], summary], `${label} / ${bucket}`);
            for (const item of items) assert.equal(reimbursementHubBucket(item), bucket, `${label} / ${item.id}`);
          }
        }
      }
      // A claim sent back for its payout account says it is with its requester, and sits in รออนุมัติ/ตรวจสอบ, where it was counted.
      const waiting = (await walk(scopes[0]![1], { bucket: 'review' })).flatMap((answer) => answer.items).filter((item) => item.status === 'PENDING_APPROVAL');
      const sentBack = waiting.filter((item) => item.payoutCorrectionPhase === 'AWAITING_REQUESTER');
      assert.deepEqual([waiting.length, sentBack.length, [...new Set(sentBack.map((item) => item.currentDesk?.kind))], [...new Set(waiting.filter((item) => !item.payoutCorrectionPhase).map((item) => item.currentDesk?.kind))]],
        [6, 3, ['REQUESTER'], ['SYSTEM']]);
      assert.equal((await walk(scopes[0]![1], { bucket: 'draft' })).flatMap((answer) => answer.items).some((item) => item.payoutCorrectionPhase), false);

      // The four scopes really differ, every search narrows its scope, several of them find something in each scope,
      // and the last one finds nothing anywhere.
      assert.deepEqual(Object.fromEntries(Object.entries(sizes).map(([name, counts]) => [name, counts[0]])), { company: 54, own: 27, related: 31, 'branch-limited': 36 });
      for (const counts of Object.values(sizes)) {
        assert.ok(counts.slice(1).every((count) => count < counts[0]!), JSON.stringify(sizes));
        assert.ok(counts.slice(1).filter((count) => count > 0).length >= 4, JSON.stringify(sizes));
        assert.equal(counts.at(-1), 0);
      }
    } finally {
      await db.company.deleteMany({ where: { id: hub } });
    }
  });

  // ---- The LINE claim-draft receipt picker (review 2026-10-01) ----
  // The picker listed every active upload of the requester, and of the caller when they review finance. Whoever
  // records payments has payment slips among their uploads: they were offered as receipts, and picking one was
  // refused when the line was saved. Asked of the real database, because the "not a slip" query has to keep the
  // files that carry no metadata at all, which only PostgreSQL's NULL logic decides.

  it('offers a claim draft the uploader\'s own receipts to pick, and none of their payment slips', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const token = `${TAG}-pick`;
    const claim = await payableClaim();
    const file = (name: string, overrides: Record<string, unknown> = {}) => slipUpload(claim.requestId, { originalFileName: `${token}-${name}`, ...overrides });
    // Receipts as they are stored: a web upload with no metadata, one with other metadata, a photo staged from LINE.
    await file('receipt-plain.jpg', { metadataJson: undefined });
    await file('receipt-web.jpg', { metadataJson: { source: 'web' } });
    await file('receipt-line.jpg', { metadataJson: { lineReimbursementOwner: { userId: `${TAG}-finance` }, lineReimbursementEpoch: 1 } });
    // Slips: one uploaded and never recorded (the tag alone), one a transfer carries (tag and link), and one attached
    // as a signed copy by mistake and moved to the payment (the link alone).
    await file('slip-not-recorded.jpg');
    const recorded = await file('slip-recorded.jpg');
    const paid = await repos[0]!.recordPaymentAtomic(transfer(claim.requestId, 'pick-paid', recorded.id));
    const moved = await file('slip-moved.pdf', { metadataJson: { source: 'web' }, mimeType: 'application/pdf' });
    await repos[0]!.linkSignedClaimFormCopy(companyId, claim.requestId, moved.id, `${TAG}-finance`);
    await moveToSlip(claim.requestId, paid.payment.id, moved.id);
    assert.equal(await db.attachmentObject.count({ where: { companyId, originalFileName: { startsWith: token }, status: 'ACTIVE', uploadedByUserId: `${TAG}-finance`, branchId } }), 6);

    // The picker itself, with the search a person types to narrow the files.
    const adapter = new LineReimbursementDraftAdapterService({ client: db } as any, repos[0]!, null as never, null as never, null as never);
    const viewer = { companyId, userId: `${TAG}-finance`, requestId: `${TAG}-pick`, roles: [], scopes: {}, authProvider: 'line',
      permissions: ['reimbursement.create', 'reimbursement.finance_review'] };
    const options = await (adapter as any).buildOptions(viewer, { actionId: randomUUID(), taskId: randomUUID(), actionOrdinal: 1, operation: 'CREATE' }, 1,
      { operation: 'CREATE', subrequestIndex: 0, query: { family: 'attachment', text: token } }, undefined);
    const offered = options.choices.filter((choice: any) => choice.kind === 'ATTACHMENT').map((choice: any) => choice.label).sort();
    // Before: all six, the three slips included.
    assert.deepEqual(offered, ['receipt-line.jpg', 'receipt-plain.jpg', 'receipt-web.jpg'].map((name) => `${token}-${name}`));
    assert.deepEqual(options.pages.attachment, { returned: 3, hasMore: false });
  });

  // ---- The overdue-approval reminder (review 2026-10-01) ----
  // The reminder is a scan. Every scan window ran the rule again for a claim still overdue, and every run made a
  // task. The real rule runner and the real task query are asked here: which tasks are "of the same rule" is a
  // join only the database can answer.

  it('keeps one open reminder task for a claim while it stays overdue, and gives a claim sent again a task of its own', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const workflow = new PrismaWorkflowRepository({ client: db } as any);
    const seed = WORKFLOW_TEMPLATE_CATALOG.find((template) => template.key === 'approval_sla_breach')!;
    const taskActions = seed.defaultActionJson.filter((action) => action.actionType === 'CREATE_WORKFLOW_TASK');
    assert.equal(taskActions.length, 1);
    // The template row is global: a synced database has it already, a bare one gets it for this test alone.
    const synced = await db.workflowTemplate.findUnique({ where: { key: seed.key } });
    const template = synced ?? await db.workflowTemplate.create({ data: {
      key: seed.key, name: seed.name, description: seed.description, category: seed.category, sourceModule: seed.sourceModule, triggerType: seed.triggerType,
      defaultConditionJson: seed.defaultConditionJson as any, defaultActionJson: seed.defaultActionJson as any, status: 'AVAILABLE',
    } });
    try {
      // The company's reminder rule as the template sync creates it, with the task action alone: the notice beside it
      // has its own once-per-round rule and its own spec.
      const drafted = await workflow.createRule({
        companyId, templateId: template.id, name: seed.name, triggerType: seed.triggerType, triggerConfigJson: {}, conditionJson: seed.defaultConditionJson,
        actionJson: taskActions, recipientConfigJson: {}, cooldownSeconds: 0, timezone: 'Asia/Bangkok', createdByUserId: `${TAG}-finance`,
      });
      await workflow.createRuleVersion({
        ruleId: drafted.id, companyId, version: 1, status: 'ENABLED', triggerSnapshotJson: {}, conditionSnapshotJson: seed.defaultConditionJson,
        actionSnapshotJson: taskActions, recipientSnapshotJson: {}, cooldownSeconds: 0, createdByUserId: `${TAG}-finance`,
      });
      const rule = await workflow.updateRule(companyId, drafted.id, { status: 'ENABLED' });
      const runner = new RunWorkflowRuleUseCase(workflow, quiet,
        new ExecuteWorkflowActionUseCase(workflow, quiet, {} as any, null as never, null as never, null as never, null as never));
      /** One scan window that finds the claim overdue, handed to the runner the way the scan hands it. */
      const window = (claimId: string, hour: string) => runner.execute({
        rule, triggerType: 'SLA_SCAN', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: claimId,
        dedupKey: buildRunDedupKey({ triggerType: 'SLA_SCAN', periodKey: hour, sourceType: 'reimbursement_request', sourceId: claimId }),
        payload: { requestId: claimId, requestNo: 'RB-202610-00007', slaRisk: true, approverTaskRole: 'MANAGER' }, now: new Date(),
      });
      const tasksOf = async (claimId: string) => (await db.workflowTask.findMany({ where: { companyId, sourceType: 'reimbursement_request', sourceId: claimId }, orderBy: { createdAt: 'asc' } }))
        .map((task) => task.status);
      const waiting = async (reason: string) => {
        const draft = await createDraft(reason);
        await repos[0]!.submitDraftAtomic(submitInput(draft));
        return draft.id;
      };
      const [claim, other] = [await waiting('overdue-reminder'), await waiting('overdue-reminder-other')];

      // Three hours overdue, three scan windows.
      for (const hour of ['2026-10-01T01', '2026-10-01T02', '2026-10-01T03']) assert.equal((await window(claim, hour)).status, 'SUCCEEDED', hour);
      // Before: three open tasks, and one more for every further hour.
      assert.deepEqual(await tasksOf(claim), ['OPEN']);
      const results = (await db.workflowActionRun.findMany({ where: { companyId, actionType: 'CREATE_WORKFLOW_TASK' }, orderBy: { createdAt: 'asc' } }))
        .map((run) => [run.status, run.resultJson]);
      assert.deepEqual(results, [['SUCCEEDED', { created: true }], ['SUCCEEDED', { skipped: true, reason: 'open_task_exists' }], ['SUCCEEDED', { skipped: true, reason: 'open_task_exists' }]]);
      assert.deepEqual((await db.workflowTask.findFirstOrThrow({ where: { companyId, sourceId: claim } })).title, 'ใบเบิกรออนุมัติเกินกำหนด: RB-202610-00007');
      // Another overdue claim is reminded for itself.
      await window(other, '2026-10-01T03');
      assert.deepEqual([await tasksOf(claim), await tasksOf(other)], [['OPEN'], ['OPEN']]);

      // The claim is corrected and sent again: its open tasks are closed the way that event closes them, and the
      // new round, overdue in its turn, gets one task of its own however many windows pass.
      assert.equal(await workflow.closeSettledClaimTasks({ companyId, requestId: claim, supersede: true }), 1);
      for (const hour of ['2026-10-02T01', '2026-10-02T02']) await window(claim, hour);
      assert.deepEqual([await tasksOf(claim), await tasksOf(other)], [['CANCELED', 'OPEN'], ['OPEN']]);
      // A task the approver snoozed is still their one reminder.
      await db.workflowTask.updateMany({ where: { companyId, sourceId: claim, status: 'OPEN' }, data: { status: 'SNOOZED' } });
      await window(claim, '2026-10-02T03');
      assert.deepEqual(await tasksOf(claim), ['CANCELED', 'SNOOZED']);
    } finally {
      await db.workflowTask.deleteMany({ where: { companyId } });
      await db.workflowRule.deleteMany({ where: { companyId } });
      if (!synced) await db.workflowTemplate.deleteMany({ where: { id: template.id } });
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
    // Spec §17.2: the claim's account history says the same of the account the draft is about to be sent with again.
    assert.deepEqual((await repos[0]!.listClaimPayoutVersions(reopened)).map((row) => [row.version, row.verifiedByUserId, row.verifiedAt]), [[1, undefined, undefined]]);
    const again = await submit(reopened);
    assert.deepEqual(again.plan, { payoutMethod: 'BANK_TRANSFER', followsDefault: false, version: 1, fingerprint: sentFingerprint, action: 'REUSE' });
    rows = await destinationsOf(created.id);
    assert.deepEqual(rows.map((row) => [row.version, row.verifiedByUserId, row.verifiedAt, row.verifiedVia]), [[1, null, null, null]]);

    // Withdrawn, the account changed, sent again: version 2 is frozen and version 1 stays as it was sent.
    reopened = await repos[0]!.reopenRejectedRequest(companyId, claim.id, again.pending.updatedAt, requester, 'PENDING_APPROVAL');
    const changed = await repos[0]!.updateDraftRequest(companyId, created.id, reopened.updatedAt, {}, undefined, typed(KBANK));
    assert.deepEqual([changed.payoutDestinationVersion, changed.payoutFingerprint], [2, undefined]);
    // The draft's working account is its current choice, not history: only what the claim was sent with is listed.
    assert.deepEqual((await repos[0]!.listClaimPayoutVersions(changed)).map((row) => row.version), [1]);
    const third = await submit(changed);
    assert.deepEqual(third.plan, { payoutMethod: 'BANK_TRANSFER', followsDefault: false, version: 2, fingerprint: fingerprintOf(KBANK), action: 'FREEZE' });
    rows = await destinationsOf(created.id);
    assert.deepEqual(rows.map((row) => [row.version, row.fingerprint, row.frozenAt !== null]), [[1, sentFingerprint, true], [2, fingerprintOf(KBANK), true]]);
    assert.equal((await repos[0]!.findClaimPayout(third.pending))?.accountLast4, '5678');
    assert.notEqual(third.pending.approvalSnapshotHash, again.pending.approvalSnapshotHash, 'a changed account is a changed claim');
    // Both accounts the claim has been sent with, oldest first, masked: what the card "การรับเงินคืน" lists.
    const history = await repos[0]!.listClaimPayoutVersions(third.pending);
    assert.deepEqual(history.map((row) => [row.version, row.accountLast4, row.source, row.enteredByUserId, row.frozenAt.getTime()]),
      rows.map((row) => [row.version, row.accountLast4, 'REQUESTER', undefined, row.frozenAt!.getTime()]));
    assert.deepEqual(history.map((row) => row.version), [1, 2]);
    assert.equal(JSON.stringify(history).includes(rows[0]!.accountNumberEncrypted) || JSON.stringify(history).includes(rows[0]!.fingerprint), false, 'neither the ciphertext nor the fingerprint');
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

  // ---- The payment step (payout Phase 1 part B): what only a real database can prove ----

  /**
   * A repository for the payment step. The claim's projection proof is set aside here: it has its
   * own real-PostgreSQL cases in the suite above, and these claims are put at the payment step
   * directly. `between` runs on another connection right after one statement of the payment
   * transaction: its first (`afterLock` 1), when its snapshot is taken and before it holds the request
   * lock, which is the order a lock alone cannot fix; or its second, once it holds both locks.
   */
  function payingRepo(between?: () => Promise<unknown>, afterLock = 1) {
    const client = !between ? clients[0]! : new Proxy(clients[0]!, { get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property);
      return (work: (tx: any) => Promise<unknown>, options: any) => target.$transaction((tx: any) => {
        let statements = 0;
        return work(new Proxy(tx, { get(inner, name) {
          const value = Reflect.get(inner, name);
          if (name !== '$executeRaw') return typeof value === 'function' ? value.bind(inner) : value;
          return async (...args: unknown[]) => {
            const result = await value.apply(inner, args);
            if (++statements === afterLock) await between();
            return result;
          };
        } }));
      }, { ...options, timeout: 20_000 });
    } });
    const repo = new PrismaReimbursementRepository({ client } as any, new PrismaDocumentSequenceRepository({ client: clients[0]! } as any));
    (repo as any).assertClaimProjectionsReady = async () => undefined;
    return repo;
  }
  const lostTheRace = (error: any) => error?.getStatus?.() === 409 && error.message === 'reimbursement_payment_state_changed';
  const paymentsOf = (requestId: string) => clients[0]!.reimbursementPayment.findMany({ where: { companyId, reimbursementRequestId: requestId }, orderBy: { createdAt: 'asc' } });
  let slipSequence = 0;
  /** A transfer by the claim's approver, with their own completed slip upload for the claim. */
  async function transferOf(requestId: string, attempt: string, payout?: Record<string, unknown>) {
    const slip = await clients[0]!.attachmentObject.create({ data: {
      companyId, branchId, storageProvider: 'LOCAL', bucket: 'test', objectKey: `${PAYOUT_TAG}/slip-${++slipSequence}`, originalFileName: 'slip.jpg',
      mimeType: 'image/jpeg', byteSize: 250_000, checksumSha256: 'e'.repeat(64), uploadedByUserId: approver, status: 'ACTIVE',
      metadataJson: { generatedFor: 'reimbursement_payment_slip', requestId },
    } });
    return {
      companyId, reimbursementRequestId: requestId, idempotencyKey: `${PAYOUT_TAG}-${attempt}`, paidAmount: '100.0000', currency: 'THB',
      paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-1', paidAt: new Date('2026-10-02T03:00:00.000Z'), paidByUserId: approver,
      slipAttachmentId: slip.id, ...(payout && { payout }),
    };
  }
  const atPayment = (requestId: string) => clients[0]!.reimbursementRequest.update({
    where: { id: requestId }, data: { status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', financeReviewStatus: 'NOT_REQUIRED', approvedAt: new Date() },
  });
  /** A claim sent with the requester's default account, approved with its attestation unless told otherwise, waiting for payment. */
  async function claimAtPayment(reason: string, account: typeof KBANK | typeof PROMPTPAY = KBANK, attested = true) {
    await setDefault(account);
    const { pending } = await submit(await draft(reason));
    if (attested) await repos[0]!.beginApprovalDecisionAtomic(approval(pending, pending.payoutDestinationVersion));
    await atPayment(pending.id);
    return (await repos[0]!.findRequestById(companyId, pending.id))!;
  }
  /** A claim sent before claims carried an account (no payout part in its hash), approved and waiting for payment. */
  async function legacyClaimAtPayment(reason: string) {
    await repos[0]!.removeMemberPayoutAccount(companyId, requester, async () => undefined);
    const claimDraft = await draft(reason);
    const hash = computeSnapshotHash(claimSnapshotFields({ ...claimDraft, payoutFingerprint: undefined }));
    const input = submitInput(claimDraft);
    await repos[0]!.submitDraftAtomic({ ...input, payout: undefined, approvalStep: { ...input.approvalStep, requestSnapshotHash: hash }, request: { ...input.request, approvalSnapshotHash: hash } });
    await repos[0]!.beginApprovalDecisionAtomic(approval((await repos[0]!.findRequestById(companyId, claimDraft.id))!));
    await atPayment(claimDraft.id);
    return { claim: (await repos[0]!.findRequestById(companyId, claimDraft.id))!, hash };
  }

  // J19 and J6: one number from the approval to the payment record, through the real submit and approval.
  it('stores on the payment the account version the approver attested and the payer confirmed, and refuses any other', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await claimAtPayment('pay step: one version');
    const repo = payingRepo();
    const [attested] = await destinationsOf(claim.id);
    assert.deepEqual([claim.payoutDestinationVersion, attested!.version, attested!.verifiedByUserId, attested!.verifiedVia], [1, 1, approver, 'APPROVAL']);

    await refusedBy(async () => repo.recordPaymentAtomic(await transferOf(claim.id, 'one-version-unconfirmed')), /payout_confirmation_required/);
    await refusedBy(async () => repo.recordPaymentAtomic(await transferOf(claim.id, 'one-version-stale', { payoutDestinationVersion: 2, payoutConfirmed: true })), /payout_destination_changed/);
    await refusedBy(async () => repo.recordPaymentAtomic({ ...await transferOf(claim.id, 'one-version-cash'), paymentMethod: 'CASH' }), /payment_method_mismatch_reason_required/);
    assert.deepEqual(await paymentsOf(claim.id), [], 'nothing was written by a refused payment');
    assert.equal(await clients[0]!.attachmentLink.count({ where: { companyId, purpose: 'reimbursement.payment.slip', attachment: { metadataJson: { path: ['requestId'], equals: claim.id } } } }), 0);

    const input = await transferOf(claim.id, 'one-version', { payoutDestinationVersion: claim.payoutDestinationVersion, payoutConfirmed: true });
    const paid = await repo.recordPaymentAtomic(input);
    const [payment] = await paymentsOf(claim.id);
    assert.deepEqual([payment!.payoutDestinationVersion, payment!.payoutConfirmedAt instanceof Date, payment!.methodMismatchReason, paid.payout?.payoutDestinationVersion, paid.payout?.payerVerified],
      [1, true, null, 1, false]);
    // The approver stays who checked the account, and the account itself is as it was frozen.
    const [after] = await destinationsOf(claim.id);
    assert.deepEqual([after!.verifiedByUserId, after!.verifiedVia, after!.accountNumberEncrypted, after!.fingerprint], [approver, 'APPROVAL', attested!.accountNumberEncrypted, attested!.fingerprint]);
    // Paying reads the claim's account and never rewrites it: the claim's columns and hash are untouched.
    const claimAfter = (await repos[0]!.findRequestById(companyId, claim.id))!;
    assert.deepEqual([claimAfter.payoutMethod, claimAfter.payoutDestinationVersion, claimAfter.payoutFingerprint, claimAfter.approvalSnapshotHash],
      [claim.payoutMethod, claim.payoutDestinationVersion, claim.payoutFingerprint, claim.approvalSnapshotHash]);
    assert.equal(computeSnapshotHash(claimSnapshotFields(claimAfter)), claim.approvalSnapshotHash);
    // What the payment row shows of that account: masked, from the claim's own snapshot.
    assert.deepEqual(await repos[0]!.listPaymentPayoutDestinations(companyId, claim.id, [1]),
      { 1: { version: 1, payoutKind: 'BANK_ACCOUNT', bankName: KBANK.bankName, accountName: KBANK.accountName, accountLast4: '5678' } });

    // The same request again is the same payment; naming another version, or none, under its key is a conflict.
    assert.equal((await repo.recordPaymentAtomic(input)).created, false);
    for (const payout of [{ payoutDestinationVersion: 2, payoutConfirmed: true }, {}]) {
      await refusedBy(() => repo.recordPaymentAtomic({ ...input, payout }), /reimbursement_payment_idempotency_conflict/);
    }
    assert.equal((await paymentsOf(claim.id)).length, 1);

    // J10: once that payment is voided, its own request is no longer a payment that stands. A retry
    // is never answered as recorded; a new payment needs its own key and its own confirmation.
    await repos[0]!.voidPaymentTrueReversal(companyId, claim.id, payment!.id, approver, 'โอนผิดบัญชี');
    await refusedBy(() => repo.recordPaymentAtomic(input), /reimbursement_payment_idempotency_conflict/);
    await refusedBy(async () => repo.recordPaymentAtomic(await transferOf(claim.id, 'one-version-again')), /payout_confirmation_required/);
    assert.deepEqual((await paymentsOf(claim.id)).map((row) => [row.status, row.payoutDestinationVersion]), [['VOIDED', 1]], 'the voided record keeps the version it was paid into');
  });

  // AC25: a change of the claim's account and a payment into it cannot both take effect.
  it('cannot be raced by an account change: a payment that read the old version never commits', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await claimAtPayment('pay step: account change race');
    const input = await transferOf(claim.id, 'account-race', { payoutDestinationVersion: 1, payoutConfirmed: true });
    const corrected = seal(SCB);
    // The correction of a wrong account, as its own transaction under the request lock the payment
    // also takes: a new frozen version, and the claim pointed at it.
    const correctAccount = () => clients[1]!.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${claim.id}:reimbursement-request`}))`;
      await tx.reimbursementPayoutDestination.create({ data: { companyId, reimbursementRequestId: claim.id, version: 2, ...corrected, source: 'REQUESTER', createdByUserId: requester, frozenAt: new Date() } });
      await tx.reimbursementRequest.update({ where: { id: claim.id }, data: { payoutDestinationVersion: 2, payoutFingerprint: corrected.fingerprint } });
    });

    // The correction commits after the payment transaction took its snapshot. The payment still reads
    // version 1 as current, and PostgreSQL takes it back when it writes the claim: no payment exists
    // that names a version the claim no longer holds.
    await assert.rejects(() => payingRepo(correctAccount).recordPaymentAtomic(input), lostTheRace);
    assert.deepEqual(await paymentsOf(claim.id), []);
    assert.equal(await clients[0]!.attachmentLink.count({ where: { companyId, attachmentId: input.slipAttachmentId } }), 0);
    const moved = (await repos[0]!.findRequestById(companyId, claim.id))!;
    assert.deepEqual([moved.status, moved.paymentStatus, moved.payoutDestinationVersion, moved.payoutFingerprint], ['READY_FOR_PAYMENT', 'UNPAID', 2, corrected.fingerprint]);

    // The retry the answer asks for reads the claim as it is now: the version the payer was shown is gone.
    await refusedBy(() => payingRepo().recordPaymentAtomic(input), /payout_destination_changed/);
    assert.deepEqual(await paymentsOf(claim.id), []);

    // Shown the corrected account and confirming it, the payer records the payment into version 2.
    // Nobody had attested version 2, so the payer is recorded as who checked it; version 1 keeps its approver.
    const paid = await payingRepo().recordPaymentAtomic({ ...input, payout: { payoutDestinationVersion: 2, payoutConfirmed: true } });
    assert.deepEqual([paid.created, paid.payout?.payoutDestinationVersion, paid.payout?.payerVerified, paid.payout?.accountLast4], [true, 2, true, '1112']);
    assert.deepEqual((await paymentsOf(claim.id)).map((payment) => payment.payoutDestinationVersion), [2]);
    assert.deepEqual((await destinationsOf(claim.id)).map((row) => [row.version, row.verifiedByUserId, row.verifiedVia]), [[1, approver, 'APPROVAL'], [2, approver, 'PAYMENT']]);

    // The other order: the payment holds the request lock, so a correction started meanwhile waits for
    // it, and then finds the claim paid. Version 1 was the claim's version when the payment was recorded.
    const second = await claimAtPayment('pay step: account change waits');
    const secondInput = await transferOf(second.id, 'account-waits', { payoutDestinationVersion: 1, payoutConfirmed: true });
    let correctionSettled = false;
    let seenByCorrection: unknown;
    let correction!: Promise<unknown>;
    const holdingBothLocks = payingRepo(async () => {
      correction = clients[1]!.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${second.id}:reimbursement-request`}))`;
        seenByCorrection = await tx.reimbursementRequest.findFirstOrThrow({ where: { id: second.id }, select: { status: true, paymentStatus: true, payoutDestinationVersion: true } });
      }, { timeout: 20_000 }).finally(() => { correctionSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(correctionSettled, false, 'the correction is waiting on the lock the payment holds, not writing beside it');
    }, 2);
    const paidSecond = await holdingBothLocks.recordPaymentAtomic(secondInput);
    await correction;
    assert.equal(paidSecond.created, true);
    assert.deepEqual(seenByCorrection, { status: 'PAID', paymentStatus: 'PAID', payoutDestinationVersion: 1 });
    assert.deepEqual((await paymentsOf(second.id)).map((row) => row.payoutDestinationVersion), [1]);
  });

  // AC14: with no approver's attestation (a claim below the approval threshold), the payer is the one who checks.
  it('records the payer as who checked an account nobody had attested, through the frozen row guard', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await claimAtPayment('pay step: payer verifies', PROMPTPAY, false);
    const [unattested] = await destinationsOf(claim.id);
    assert.deepEqual([unattested!.verifiedByUserId, unattested!.verifiedAt, unattested!.frozenAt instanceof Date], [null, null, true]);
    const paid = await payingRepo().recordPaymentAtomic(await transferOf(claim.id, 'payer-verifies', { payoutDestinationVersion: 1, payoutConfirmed: true }));
    const [checked] = await destinationsOf(claim.id);
    assert.deepEqual([checked!.verifiedByUserId, checked!.verifiedVia, checked!.approvalStepId, paid.payout?.payerVerified], [approver, 'PAYMENT', null, true]);
    assert.equal(checked!.verifiedAt?.getTime(), (await paymentsOf(claim.id))[0]!.payoutConfirmedAt?.getTime(), 'attested at the moment of the confirmation');
    // The database let the attestation through and nothing else: the frozen account is byte for byte what it was.
    for (const column of ['payoutKind', 'bankName', 'accountName', 'accountNumberEncrypted', 'accountLast4', 'fingerprint', 'source', 'createdByUserId'] as const) {
      assert.equal(checked![column], unattested![column], column);
    }
    assert.equal(checked!.frozenAt?.getTime(), unattested!.frozenAt?.getTime());
  });

  // Phase 4 (spec §17.2, §17.3) on real rows: what the "paid" event is handed inside the payment transaction, and
  // the attestation the claim's timeline reads ("อนุมัติและตรวจบัญชีรับเงินโดย …").
  it('hands the payment callback the account just confirmed, inside the transaction, and names the approval that attested it', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await claimAtPayment('history: paid notice');
    const step = (await repos[0]!.findRequestById(companyId, claim.id, true))!.approvalSteps!.find((row) => row.status === 'APPROVED')!;
    const [frozen] = await destinationsOf(claim.id);
    assert.deepEqual(await repos[0]!.listClaimPayoutVersions(claim), [{
      version: 1, payoutKind: 'BANK_ACCOUNT', bankName: KBANK.bankName, accountName: KBANK.accountName, accountLast4: '5678', source: 'DEFAULT_ACCOUNT',
      frozenAt: frozen!.frozenAt, verifiedByUserId: approver, verifiedAt: new Date('2026-10-01T09:00:00.000Z'), approvalStepId: step.id,
    }]);

    const seen: any[] = [];
    const input = await transferOf(claim.id, 'history-paid', { payoutDestinationVersion: 1, payoutConfirmed: true });
    const paid = await payingRepo().recordPaymentAtomic({
      ...input,
      onPaymentPersisted: async (tx: any, payment: any, paymentStatus: string, payout: any) => {
        // The payment row exists for this transaction and for nobody else yet: the event commits with it or not at all.
        seen.push({ payment, paymentStatus, payout, inside: await tx.reimbursementPayment.count({ where: { id: payment.id } }),
          outside: await clients[1]!.reimbursementPayment.count({ where: { id: payment.id } }) });
      },
    });
    assert.equal(seen.length, 1);
    assert.deepEqual([seen[0].paymentStatus, seen[0].inside, seen[0].outside, seen[0].payment.id, seen[0].payment.slipAttachmentId], ['PAID', 1, 0, paid.payment.id, input.slipAttachmentId]);
    assert.deepEqual(seen[0].payout, paid.payout);
    assert.deepEqual([seen[0].payout.accountLast4, seen[0].payout.payoutKind, seen[0].payout.bankName, seen[0].payout.source], ['5678', 'BANK_ACCOUNT', KBANK.bankName, 'CLAIM']);
    // The sentence the use case writes into the event from exactly these two arguments.
    assert.equal(reimbursementPaidNotice({
      paymentMethod: seen[0].payment.paymentMethod, paidAmount: seen[0].payment.paidAmount, currency: seen[0].payment.currency,
      slipCount: seen[0].payment.slipAttachmentId ? 1 : 0, payoutDestination: seen[0].payout,
    }), 'โอนเข้าบัญชีลงท้าย 5678 จำนวน 100.00 บาท มีสลิปแนบ แตะเพื่อดูสลิป');
    // The same request again is the same payment: no second event.
    const replay = await payingRepo().recordPaymentAtomic({ ...input, onPaymentPersisted: async () => { seen.push('replayed'); } });
    assert.deepEqual([replay.created, seen.length], [false, 1]);
    // Paying changed nothing in the account's history: the approver still stands as who attested it.
    assert.deepEqual((await repos[0]!.listClaimPayoutVersions(claim)).map((row) => [row.version, row.verifiedByUserId, row.approvalStepId]), [[1, approver, step.id]]);
  });

  // Owner rule 2026-10-01: at the pay step the person whose turn it is comes first. The list is still exactly
  // the members who hold the pay right for the branch; only its order follows the turn.
  it('lists who can record a payment with whoever\'s turn it is first, from real roles and memberships', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const permission = await db.permission.upsert({ where: { key: 'reimbursement.payment.record' }, update: {}, create: { key: 'reimbursement.payment.record', description: 'Record reimbursement payment' } });
    const payerRole = await db.role.create({ data: { companyId, scopeKey: companyId, key: `${PAYOUT_TAG}-payer`, name: 'ผู้จ่ายเงิน', permissions: { create: [{ permissionId: permission.id }] } } });
    const memberships = await db.companyMembership.findMany({ where: { companyId, userId: { in: [requester, approver] } }, select: { id: true } });
    await db.membershipRole.createMany({ data: memberships.map((membership) => ({ membershipId: membership.id, roleId: payerRole.id })) });
    try {
      // Display names are the user ids here: "…-approver" sorts before "…-requester".
      assert.deepEqual(await repos[0]!.listPaymentRecorderNames(companyId, branchId), [approver, requester]);
      assert.deepEqual(await repos[0]!.listPaymentRecorderNames(companyId, branchId, [requester]), [requester, approver]);
      assert.deepEqual(await repos[0]!.listPaymentRecorderNames(companyId, branchId, [approver]), [approver, requester]);
      // Someone whose turn it is but who cannot pay (not a member here) is not listed, and moves nobody.
      assert.deepEqual(await repos[0]!.listPaymentRecorderNames(companyId, branchId, [outsider, requester]), [requester, approver]);
      assert.deepEqual(await repos[0]!.listPaymentRecorderNames(companyId, branchId, [outsider]), [approver, requester]);
    } finally {
      await db.membershipRole.deleteMany({ where: { roleId: payerRole.id } });
      await db.role.delete({ where: { id: payerRole.id } });
    }
  });

  // Spec §15, AC34, AC35 and invariant J1.
  it('pays a legacy claim into the requester default: the copy is frozen with the payment and the claim keeps its hashes', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const { claim, hash } = await legacyClaimAtPayment('pay step: legacy default');
    const hashesOf = (row: Claim) => [row.approvalSnapshotHash, computeSnapshotHash(claimSnapshotFields(row))];
    assert.deepEqual(hashesOf(claim), [hash, hash]);
    assert.equal(await repos[0]!.findLegacyPayoutDefault(claim), null, 'no default account yet: nothing to show the payer');

    // Exactly as before the feature: a transfer with its slip, no statement, no account recorded.
    const plain = await payingRepo().recordPaymentAtomic(await transferOf(claim.id, 'legacy-plain'));
    assert.deepEqual([plain.created, plain.payout, (await paymentsOf(claim.id))[0]!.payoutDestinationVersion, (await destinationsOf(claim.id)).length], [true, undefined, null, 0]);
    await repos[0]!.voidPaymentTrueReversal(companyId, claim.id, plain.payment.id, approver, 'โอนผิดบัญชี');

    // The requester sets a default account afterwards; the payer is shown it, masked, with its token.
    await setDefault(KBANK);
    const shown = await repos[0]!.findLegacyPayoutDefault(claim);
    assert.deepEqual(shown, { payoutKind: 'BANK_ACCOUNT', bankName: KBANK.bankName, accountName: KBANK.accountName, accountLast4: '5678', confirmToken: legacyPayoutConfirmToken(claim.id, fingerprintOf(KBANK)) });
    const input = await transferOf(claim.id, 'legacy-default', { payoutConfirmed: true, payoutDefaultToken: shown!.confirmToken });

    // The default is changed after the payment transaction took its snapshot: the payment loses on
    // the row lock it takes on that default, and writes neither a payment nor a copy.
    await assert.rejects(() => payingRepo(() => setDefault(SCB, 1)).recordPaymentAtomic(input), lostTheRace);
    assert.deepEqual([(await paymentsOf(claim.id)).filter((row) => row.status === 'RECORDED').length, (await destinationsOf(claim.id)).length], [0, 0]);
    // The retry then reads the default as it is now: no longer the account the payer was shown.
    await refusedBy(() => payingRepo().recordPaymentAtomic(input), /payout_destination_changed/);
    assert.equal((await destinationsOf(claim.id)).length, 0);

    // Shown the new default and confirming it: a copy of it is frozen with the payment.
    const current = (await repos[0]!.findLegacyPayoutDefault(claim))!;
    assert.equal(current.accountLast4, '1112');
    const confirmedInput = { ...input, payout: { payoutConfirmed: true, payoutDefaultToken: current.confirmToken } };
    const paid = await payingRepo().recordPaymentAtomic(confirmedInput);
    const account = await db.memberPayoutAccount.findFirstOrThrow({ where: { companyId, userId: requester } });
    const [copy] = await destinationsOf(claim.id);
    assert.deepEqual([copy!.version, copy!.source, copy!.createdByUserId, copy!.verifiedByUserId, copy!.verifiedVia, copy!.frozenAt instanceof Date],
      [1, 'LEGACY_PAYMENT', requester, approver, 'PAYMENT', true]);
    for (const column of ['payoutKind', 'bankName', 'accountName', 'accountNumberEncrypted', 'accountLast4', 'fingerprint'] as const) assert.equal(copy![column], account[column], column);
    // Invariant I6: the last 4 digits kept are the tail of the number the copy decrypts to.
    assert.equal(openPayoutAccountNumber(copy!.accountNumberEncrypted, key), SCB.accountNumber);
    assert.equal(openPayoutAccountNumber(copy!.accountNumberEncrypted, key).slice(-4), copy!.accountLast4);
    const payment = (await paymentsOf(claim.id)).at(-1)!;
    assert.deepEqual([payment.payoutDestinationVersion, payment.payoutConfirmedAt instanceof Date, paid.payout?.source, paid.payout?.payerVerified], [1, true, 'MEMBER_DEFAULT', true]);

    // J1: the claim is still a legacy claim. None of its payout columns was written, so the hash it was
    // approved under, and every signature made on it, stand as they were.
    const after = (await repos[0]!.findRequestById(companyId, claim.id))!;
    assert.deepEqual([after.payoutMethod, after.payoutDestinationVersion, after.payoutFingerprint], [undefined, undefined, undefined]);
    assert.deepEqual(hashesOf(after), [hash, hash]);
    assert.equal(await repos[0]!.findClaimPayout(after), undefined, 'the claim itself shows no account');
    assert.deepEqual(await repos[0]!.listClaimPayoutVersions(after), [], 'and its account history lists none: the copy belongs to the payment');

    // The copy is the payment's, for good: the database refuses to change or remove it.
    await refusedBy(() => db.reimbursementPayoutDestination.update({ where: { id: copy!.id }, data: { accountName: 'คนอื่น' } }), /reimbursement_payout_destination_frozen/);
    await refusedBy(() => db.reimbursementPayoutDestination.delete({ where: { id: copy!.id } }), /reimbursement_payout_destination_frozen/);
    // A later change of the default never reaches it.
    await setDefault(PROMPTPAY);
    assert.deepEqual(await repos[0]!.listPaymentPayoutDestinations(companyId, claim.id, [1]),
      { 1: { version: 1, payoutKind: 'BANK_ACCOUNT', bankName: SCB.bankName, accountName: SCB.accountName, accountLast4: '1112' } });

    // The same request is the same payment; under its key, another default or no confirmation is a conflict.
    assert.equal((await payingRepo().recordPaymentAtomic(confirmedInput)).created, false);
    const other = legacyPayoutConfirmToken(claim.id, fingerprintOf(PROMPTPAY));
    for (const payout of [{ payoutConfirmed: true, payoutDefaultToken: other }, {}]) {
      await refusedBy(() => payingRepo().recordPaymentAtomic({ ...confirmedInput, payout }), /reimbursement_payment_idempotency_conflict/);
    }
    assert.deepEqual([(await paymentsOf(claim.id)).filter((row) => row.status === 'RECORDED').length, (await destinationsOf(claim.id)).length], [1, 1]);
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

/**
 * Audit B3 on a real database, with the real expense void: a cancellation that cannot finish is
 * refused before anything is written, one that was started stays visible and finishable, and a
 * withdrawal can never leave a voided expense record on a claim that goes on.
 */
describe('a claim is never left half cancelled or half approved (real PostgreSQL)', () => {
  const S = `${TAG}-stuck`;
  const STAFF = `${S}-staff`;
  const FIN = `${S}-fin`;
  const MGR = `${S}-mgr`;
  /** A member only where a case makes them one. */
  const OWNER = `${S}-owner`;
  const day = new Date('2026-09-15T00:00:00.000Z');
  let clients: PrismaClient[] = [];
  let repos: PrismaReimbursementRepository[] = [];
  let companyId = '';
  let branchId = '';
  let accounts = { expense: '', payable: '' };
  let reachable = false;
  let sequence = 0;
  let approverPermissionIds: string[] = [];
  let managerRoleId = '';
  let managerMembershipId = '';

  before(async () => {
    const url = databaseUrl();
    if (!url) {
      if (gateRequired) throw new Error('reimbursement_pg_gate_database_url_required');
      return;
    }
    try {
      clients = [0, 1].map(() => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }));
      await clients[0]!.$queryRaw`SELECT 1`;
    } catch (error) {
      if (gateRequired) throw error;
      return;
    }
    reachable = true;
    const db = clients[0]!;
    await db.user.createMany({ data: [{ id: STAFF, displayName: 'สมชาย พนักงาน' }, { id: FIN, displayName: 'วราภรณ์ การเงิน' }, { id: MGR, displayName: 'สมศรี ผู้จัดการ' }, { id: OWNER, displayName: 'เจ้าของร้าน' }] });
    companyId = (await db.company.create({ data: { name: S, status: 'ACTIVE' }, select: { id: true } })).id;
    await db.companyMembership.createMany({ data: [STAFF, FIN, MGR].map((userId) => ({ companyId, userId, status: 'ACTIVE' as const })) });
    // The manager really holds the role claims are routed to, with the rights an approver needs: the
    // approval route a correction round asks for is resolved from these rows.
    approverPermissionIds = await Promise.all(['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'].map(async (key) =>
      (await db.permission.upsert({ where: { key }, update: {}, create: { key, description: key } })).id));
    managerRoleId = (await db.role.create({ data: {
      companyId, scopeKey: companyId, key: 'MANAGER', name: 'ผู้จัดการ', permissions: { create: approverPermissionIds.map((permissionId) => ({ permissionId })) },
    }, select: { id: true } })).id;
    managerMembershipId = (await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId, userId: MGR } }, select: { id: true } })).id;
    await db.membershipRole.create({ data: { membershipId: managerMembershipId, roleId: managerRoleId } });
    // These claims carry no receipt, only the reason: the company lets such a line be confirmed.
    await db.reimbursementPolicy.create({ data: { companyId, allowMissingReceiptWithReason: true, createdByUserId: FIN } });
    branchId = (await db.branch.create({ data: { companyId, code: 'QA-STUCK', name: S }, select: { id: true } })).id;
    const account = (code: string, accountClass: 'EXPENSE' | 'LIABILITY', normalBalance: 'DEBIT' | 'CREDIT') =>
      db.chartOfAccount.create({ data: { companyId, code, nameTh: code, accountClass, normalBalance }, select: { id: true } });
    accounts = { expense: (await account('QA-5000', 'EXPENSE', 'DEBIT')).id, payable: (await account('QA-2100', 'LIABILITY', 'CREDIT')).id };
    repos = clients.map((client) => new PrismaReimbursementRepository({ client } as any, new PrismaDocumentSequenceRepository({ client } as any)));
  });

  after(async () => {
    if (reachable) {
      const db = clients[0]!;
      await db.auditLog.deleteMany({ where: { companyId } });
      await db.journalEntry.deleteMany({ where: { companyId } });
      await db.role.deleteMany({ where: { scopeKey: companyId } });
      await db.company.deleteMany({ where: { id: companyId } });
      await db.user.deleteMany({ where: { id: { in: [STAFF, FIN, MGR, OWNER] } } });
    }
    await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
  });

  const requester = () => ({ requestId: `${S}-${++sequence}`, authSubject: 's', userId: STAFF, companyId, membershipId: 'm', roles: ['STAFF'],
    permissions: ['reimbursement.read_own', 'reimbursement.cancel_own'], scopes: {}, authProvider: 'dev' }) as any;
  const finance = () => ({ ...requester(), userId: FIN, roles: ['FINANCE'], permissions: ['reimbursement.read', 'reimbursement.finance_review', 'reimbursement.payment.record'] });
  const manager = () => ({ ...requester(), userId: MGR, roles: ['MANAGER'], permissions: ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'] });
  /** The scheduled run and the web call over one connection. */
  const system = (index: number) => claimSystem(clients[index]!, repos[index]!, companyId);
  /** A run takes every claim of the company that waits, other cases' leftovers included; a case reads what it did with its own. */
  const ofThese = (claims: Array<{ requestId: string }>, run: { completed: string[]; failed: Array<{ requestId: string; error: string }>; blocked: string[] }) => {
    const own = (id: string) => claims.some((claim) => claim.requestId === id);
    return { completed: run.completed.filter(own), failed: run.failed.filter((row) => own(row.requestId)).map((row) => [row.requestId, row.error]), blocked: run.blocked.filter(own).sort() };
  };

  /** The use cases over one connection, with the real expense void and audit rows written to the database. */
  function on(index: number) {
    const client = clients[index]!;
    const prisma = { client } as any;
    const audit = { log: (entry: any, tx?: any) => new PrismaAuditRepository(prisma).log(entry, tx) } as any;
    const numbers = new PrismaDocumentSequenceRepository(prisma);
    const expenses = new PrismaExpenseRepository(prisma);
    const voidExpense = new VoidExpenseUseCase(expenses, audit, { append: async () => undefined } as any,
      new ReserveDocumentNumberUseCase(numbers, audit), new CommitDocumentNumberUseCase(numbers, audit), new CancelDocumentNumberUseCase(numbers, audit));
    return {
      cancel: new CancelReimbursementUseCase(repos[index]!, audit, voidExpense),
      withdraw: new WithdrawReimbursementCancellationUseCase(repos[index]!, audit),
      detail: new GetReimbursementDetailUseCase(repos[index]!, new ReimbursementEvidenceService(new PrismaAttachmentRepository(prisma), expenses)),
      /** What the expense screen can ask of a record: void, reject and delete, each with its own right. */
      expenseScreen: {
        void: voidExpense,
        reject: new RejectExpenseUseCase(expenses, audit),
        remove: new DeleteExpenseUseCase(prisma, new PrismaAttachmentRepository(prisma), audit),
      },
    };
  }

  /**
   * A claim waiting for payment whose lines each have a confirmed expense record with a posted
   * journal, the way approval and the posting worker leave it. Each claim gets an accounting period
   * of its own, so closing one never touches another case.
   */
  async function payableClaim(lines = 1) {
    const db = clients[0]!;
    const index = ++sequence;
    const periodKey = `${2100 + index}-09`;
    let request = await repos[0]!.createRequest({
      companyId, branchId, requesterUserId: STAFF, requesterDisplayNameSnapshot: 'สมชาย พนักงาน', reason: `stuck-${index}`, categoryKey: 'travel',
      amount: `${100 * lines}.0000`, currency: 'THB', incurredDate: day, receiptRequirementStatus: 'MISSING_WITH_REASON', missingReceiptReason: 'ใบเสร็จหาย',
      createdByUserId: STAFF,
      lines: Array.from({ length: lines }, (_, line) => ({ lineNo: line + 1, incurredDate: day, description: `รายการ ${line + 1}`, categoryKey: 'travel', amount: '100.0000' })),
    });
    await db.reimbursementRequest.update({ where: { id: request.id }, data: {
      status: 'FINANCE_REVIEW', financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: FIN, requestNo: `RB-${S}-${index}`,
      submittedAt: day, submittedByUserId: STAFF, outstandingAmount: `${100 * lines}.0000`,
    } });
    request = (await repos[0]!.findRequestById(companyId, request.id))!;
    const projections = await repos[0]!.prepareClaimProjections({ companyId, requestId: request.id, decisionKind: 'FINANCE', decisionActorUserId: FIN, scopes: {},
      items: new MaterializeClaimExpensesService().buildItems(request) });
    const confirm = new ConfirmExpenseUseCase(new PrismaExpenseRepository({ client: db } as any), { log: async () => undefined } as any, { resolveLines: async () => [] } as any, {} as any);
    const period = await db.accountingPeriod.create({ data: { companyId, periodKey, startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30') } });
    for (const projection of projections) {
      await confirm.executeForReimbursement({ ...finance(), permissions: [] }, projection.expenseId,
        { reimbursementRequestId: request.id, reimbursementLineId: projection.reimbursementLineId, branchId, allowMissingReceiptWithReason: true });
      await db.journalEntry.create({ data: {
        companyId, periodId: period.id, entryNumber: `JV-${S}-${++sequence}`, entryType: 'GENERATED', sourceType: 'expense.record', sourceId: projection.expenseId,
        status: 'POSTED', entryDate: day, postedAt: day, postedByUserId: FIN, createdByUserId: FIN,
        lines: { create: [
          { accountId: accounts.expense, lineNumber: 1, debitAmount: '100', creditAmount: '0' },
          { accountId: accounts.payable, lineNumber: 2, debitAmount: '0', creditAmount: '100' },
        ] },
      } });
      await db.expenseRecord.update({ where: { id: projection.expenseId }, data: { postingStatus: 'posted' } });
    }
    await db.reimbursementRequest.update({ where: { id: request.id }, data: { status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID' } });
    return { requestId: request.id, periodId: period.id, periodKey, expenseIds: projections.map((projection) => projection.expenseId) };
  }

  const closePeriod = (periodId: string, status: 'CLOSED' | 'OPEN' = 'CLOSED') => clients[0]!.accountingPeriod.update({ where: { id: periodId }, data: { status } });
  /** What a cancellation leaves behind, read from the tables: the claim, its expense records, the reversal journals and the events. */
  async function stored(claim: { requestId: string; expenseIds: string[] }) {
    const db = clients[0]!;
    const row = await db.reimbursementRequest.findUniqueOrThrow({ where: { id: claim.requestId } });
    const expenses = await db.expenseRecord.findMany({ where: { id: { in: claim.expenseIds } }, orderBy: { createdAt: 'asc' } });
    return {
      status: row.status as string, pending: !!row.cancellationPendingAt, pendingReason: row.cancellationPendingReason, closedReason: row.rejectionReason,
      expenses: expenses.map((expense) => expense.status as string),
      voidReasons: [...new Set(expenses.map((expense) => expense.voidReason))],
      reversals: await db.journalEntry.count({ where: { companyId, entryType: 'REVERSAL', sourceId: { in: claim.expenseIds } } }),
      cancelledEvents: await db.outboxEvent.count({ where: { companyId, aggregateId: claim.requestId, eventType: 'reimbursement.cancelled' } }),
      cancelAudits: await db.auditLog.count({ where: { companyId, targetId: claim.requestId, action: 'reimbursement.request.cancel' } }),
    };
  }
  /** A cancellation as production could leave it before this fix: the intent committed, nothing after it. */
  const strand = (claim: { requestId: string }, reason: string) => repos[0]!.findRequestById(companyId, claim.requestId).then((request) => repos[0]!.beginCancellationAtomic({
    companyId, requestId: claim.requestId, expectedStatus: request!.status, expectedUpdatedAt: request!.updatedAt, actorUserId: STAFF, scopes: {}, reason,
    startedAt: new Date(), onIntentPersisted: async () => undefined,
  }));

  it('refuses a short reason and a closed period before any intent is written, then cancels once the period is reopened', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const untouched = { status: 'READY_FOR_PAYMENT', pending: false, pendingReason: null, closedReason: null, expenses: ['CONFIRMED'], voidReasons: [null], reversals: 0, cancelledEvents: 0, cancelAudits: 0 };

    await assert.rejects(() => on(0).cancel.execute(requester(), claim.requestId, 'ก'), (error: any) => error.getStatus() === 400 && errorMessage(error) === 'cancellation_reason_too_short');
    assert.deepEqual(await stored(claim), untouched);

    await closePeriod(claim.periodId);
    await assert.rejects(() => on(0).cancel.execute(requester(), claim.requestId, 'ซื้อซ้ำกับใบก่อน'),
      (error: any) => error.getStatus() === 409 && errorMessage(error) === `reimbursement_cancellation_accounting_period_locked:${claim.periodKey}`);
    assert.deepEqual(await stored(claim), untouched, 'nothing was written: no intent, no void, no reversal number used');
    assert.equal(await clients[0]!.outboxEvent.count({ where: { companyId, aggregateId: claim.requestId } }), 0);

    await closePeriod(claim.periodId, 'OPEN');
    assert.equal((await on(0).cancel.execute(requester(), claim.requestId, 'ซื้อซ้ำกับใบก่อน')).status, 'CANCELLED');
    assert.deepEqual(await stored(claim), { status: 'CANCELLED', pending: true, pendingReason: 'ซื้อซ้ำกับใบก่อน', closedReason: 'ซื้อซ้ำกับใบก่อน',
      expenses: ['VOIDED'], voidReasons: ['ซื้อซ้ำกับใบก่อน'], reversals: 1, cancelledEvents: 1, cancelAudits: 1 });
  });

  it('shows a claim stranded by a short reason and lets another canceller finish it with a corrected reason', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim(2);
    await strand(claim, 'ก');

    const shown = (await on(0).detail.execute(finance(), claim.requestId)).pendingCancellation!;
    assert.deepEqual([shown.startedByUserId, shown.startedByName, shown.reason, shown.blocker, shown.canResume, shown.canWithdraw],
      [STAFF, 'สมชาย พนักงาน', 'ก', { code: 'reason_too_short' }, true, true]);
    // While it is pending, the payment is refused, as before; the difference is that the claim now says why.
    await assert.rejects(() => repos[0]!.assertClaimPaymentReady(companyId, claim.requestId), /reimbursement_cancellation_pending/);

    for (const again of ['ก', undefined]) {
      await assert.rejects(() => on(0).cancel.execute(requester(), claim.requestId, again), (error: any) => errorMessage(error) === 'cancellation_reason_too_short');
    }
    assert.deepEqual((await stored(claim)).expenses, ['CONFIRMED', 'CONFIRMED']);

    assert.equal((await on(1).cancel.execute(finance(), claim.requestId, 'ซื้อซ้ำกับใบก่อน')).status, 'CANCELLED');
    assert.deepEqual(await stored(claim), { status: 'CANCELLED', pending: true, pendingReason: 'ซื้อซ้ำกับใบก่อน', closedReason: 'ซื้อซ้ำกับใบก่อน',
      expenses: ['VOIDED', 'VOIDED'], voidReasons: ['ซื้อซ้ำกับใบก่อน'], reversals: 2, cancelledEvents: 1, cancelAudits: 1 });
    const corrected = await clients[0]!.auditLog.findFirstOrThrow({ where: { companyId, targetId: claim.requestId, action: 'reimbursement.request.cancellation_reason_corrected' } });
    assert.deepEqual([corrected.actorUserId, (corrected.metadataJson as any).previousReason, (corrected.metadataJson as any).reason], [FIN, 'ก', 'ซื้อซ้ำกับใบก่อน']);
  });

  it('shows a period closed after the cancellation started, refuses to void half of it, and finishes once the period is reopened', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim(2);
    await strand(claim, 'ซื้อซ้ำกับใบก่อน');
    await closePeriod(claim.periodId);

    const shown = (await on(0).detail.execute(requester(), claim.requestId)).pendingCancellation!;
    assert.deepEqual([shown.blocker, shown.canResume, shown.canWithdraw], [{ code: 'accounting_period_locked', periodKey: claim.periodKey }, true, true]);
    await assert.rejects(() => on(0).cancel.execute(requester(), claim.requestId),
      (error: any) => error.getStatus() === 409 && errorMessage(error) === `reimbursement_cancellation_accounting_period_locked:${claim.periodKey}`);
    assert.deepEqual([(await stored(claim)).expenses, (await stored(claim)).reversals], [['CONFIRMED', 'CONFIRMED'], 0]);

    await closePeriod(claim.periodId, 'OPEN');
    assert.equal((await on(0).detail.execute(requester(), claim.requestId)).pendingCancellation?.blocker, undefined);
    assert.equal((await on(1).cancel.execute(finance(), claim.requestId)).status, 'CANCELLED');
    assert.deepEqual(await stored(claim), { status: 'CANCELLED', pending: true, pendingReason: 'ซื้อซ้ำกับใบก่อน', closedReason: 'ซื้อซ้ำกับใบก่อน',
      expenses: ['VOIDED', 'VOIDED'], voidReasons: ['ซื้อซ้ำกับใบก่อน'], reversals: 2, cancelledEvents: 1, cancelAudits: 1 });
  });

  it('withdraws a blocked cancellation while nothing was voided, and the claim is paid as if it had never been started', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    await strand(claim, 'ก');
    await closePeriod(claim.periodId);

    assert.equal((await on(0).withdraw.execute(finance(), claim.requestId)).status, 'READY_FOR_PAYMENT');
    assert.deepEqual(await stored(claim), { status: 'READY_FOR_PAYMENT', pending: false, pendingReason: null, closedReason: null,
      expenses: ['CONFIRMED'], voidReasons: [null], reversals: 0, cancelledEvents: 0, cancelAudits: 0 });
    assert.equal((await on(0).detail.execute(finance(), claim.requestId)).pendingCancellation, undefined);
    await assert.rejects(() => on(0).withdraw.execute(finance(), claim.requestId), (error: any) => errorMessage(error) === 'reimbursement_cancellation_not_pending');
    const paid = await repos[0]!.recordPaymentAtomic({ companyId, reimbursementRequestId: claim.requestId, idempotencyKey: `${S}-pay-${claim.requestId}`, paidAmount: '100.0000',
      currency: 'THB', paymentMethod: 'CASH', paidAt: new Date(), paidByUserId: FIN });
    assert.equal(paid.request.status, 'PAID');
  });

  it('refuses to withdraw once an expense record was voided: the cancellation can only be finished', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim(2);
    await strand(claim, 'ซื้อซ้ำกับใบก่อน');
    // The first record is voided and the cancellation stops there (what a crash between the two voids leaves).
    const intent = (await repos[0]!.findRequestById(companyId, claim.requestId))!;
    const line = intent.lines![0]!;
    const numbers = new PrismaDocumentSequenceRepository({ client: clients[0]! } as any);
    const quiet = { log: async () => undefined } as any;
    await new VoidExpenseUseCase(new PrismaExpenseRepository({ client: clients[0]! } as any), quiet, { append: async () => undefined } as any,
      new ReserveDocumentNumberUseCase(numbers, quiet), new CommitDocumentNumberUseCase(numbers, quiet), new CancelDocumentNumberUseCase(numbers, quiet))
      .executeForReimbursement(requester(), claim.expenseIds[0]!, 'ซื้อซ้ำกับใบก่อน', { reimbursementRequestId: claim.requestId, reimbursementLineId: line.id, branchId });

    assert.equal((await on(0).detail.execute(requester(), claim.requestId)).pendingCancellation?.canWithdraw, false);
    await assert.rejects(() => on(0).withdraw.execute(requester(), claim.requestId), (error: any) => error.getStatus() === 409 && errorMessage(error) === 'reimbursement_cancellation_partly_done');
    assert.equal((await on(0).cancel.execute(requester(), claim.requestId)).status, 'CANCELLED');
    assert.deepEqual([(await stored(claim)).expenses, (await stored(claim)).reversals, (await stored(claim)).cancelledEvents], [['VOIDED', 'VOIDED'], 2, 1]);
  });

  // Before: only approval and payment were refused. A rejection, a finance decision or a submit taken while
  // a cancellation was pending moved the claim to a status the cancellation could not complete from.
  it('takes no other decision on a claim while its cancellation is pending, and takes them again once it is withdrawn', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const noop = async () => undefined;
    /** A claim put in `status` the short way: the guard under test sits right after each transaction's status check. */
    const claimIn = async (status: string, extra: Record<string, unknown> = {}) => {
      const index = ++sequence;
      const request = await repos[0]!.createRequest({
        companyId, branchId, requesterUserId: STAFF, requesterDisplayNameSnapshot: 'สมชาย พนักงาน', reason: `guard-${index}`, categoryKey: 'travel',
        amount: '100.0000', currency: 'THB', incurredDate: day, receiptRequirementStatus: 'WAIVED_BY_POLICY', createdByUserId: STAFF,
        lines: [{ lineNo: 1, incurredDate: day, description: 'รายการ', categoryKey: 'travel', amount: '100.0000' }],
      });
      if (status !== 'DRAFT') await db.reimbursementRequest.update({ where: { id: request.id }, data: { status: status as any, submittedAt: day, ...extra } });
      return (await repos[0]!.findRequestById(companyId, request.id))!;
    };
    const decision = (request: { id: string; updatedAt: Date }) => ({ companyId, requestId: request.id, expectedUpdatedAt: request.updatedAt, actorUserId: FIN, scopes: {} });
    const cases: Array<[string, Record<string, unknown>, (request: any) => Promise<unknown>]> = [
      ['DRAFT', {}, (request) => repos[0]!.updateDraftRequest(companyId, request.id, request.updatedAt, { reason: 'แก้ไข', updatedByUserId: STAFF })],
      ['DRAFT', {}, (request) => repos[0]!.submitDraftAtomic({
        companyId, requestId: request.id, expectedUpdatedAt: request.updatedAt, duplicateCandidates: [], evidence: { attachmentIds: [], expenseIds: [] },
        documentNumber: { documentType: 'reimbursement.request', periodKey, idempotencyKey: `reimb-submit:${request.id}`, reservedByUserId: STAFF },
        approvalStep: { sequenceNo: 1, approverRoleSnapshot: 'MANAGER', requestSnapshotHash: 'a'.repeat(32) },
        request: { status: 'PENDING_APPROVAL', submittedAt: new Date(), submittedByUserId: STAFF, approvalSnapshotHash: 'a'.repeat(32), outstandingAmount: '100.0000', updatedByUserId: STAFF },
      } as any)],
      ['PENDING_APPROVAL', {}, (request) => repos[0]!.rejectRequestAtomic({ ...decision(request), actorRoles: ['OWNER'], allowSelfApproval: false, decidedAt: new Date(),
        rejectionReason: 'ไม่อนุมัติ', request: { status: 'REJECTED' }, onRejectedPersisted: noop })],
      ['PENDING_APPROVAL', {}, (request) => repos[0]!.beginApprovalDecisionAtomic({ ...decision(request), expectedApprovalSnapshotHash: 'a'.repeat(32), actorRoles: ['OWNER'],
        allowSelfApproval: false, financeReviewRequired: false, decidedAt: new Date(), financeRequestPatch: {}, onDecisionPersisted: noop })],
      ['FINANCE_REVIEW', { financeReviewStatus: 'PENDING' }, (request) => repos[0]!.beginFinanceApprovalAtomic({ ...decision(request), reviewedAt: new Date(), onDecisionPersisted: noop })],
      ['FINANCE_REVIEW', { financeReviewStatus: 'PENDING' }, (request) => repos[0]!.recordFinanceReviewAtomic({ ...decision(request), reviewedAt: new Date(), decision: 'BLOCKED', onDecisionPersisted: noop })],
      ['READY_FOR_PAYMENT', {}, (request) => repos[0]!.resolvePaymentDuplicatesAtomic({ ...decision(request), resolvedAt: new Date(), reason: 'ไม่ซ้ำ', onResolvedPersisted: noop })],
      ['FINANCE_REVIEW', { financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: FIN }, (request) => repos[0]!.prepareClaimProjections({
        companyId, requestId: request.id, decisionKind: 'FINANCE', decisionActorUserId: FIN, scopes: {}, items: new MaterializeClaimExpensesService().buildItems(request) })],
      ['READY_FOR_PAYMENT', {}, (request) => repos[0]!.assertClaimPaymentReady(companyId, request.id)],
      // The three transactions of a payout account correction round (payout spec §14): sending the claim
      // back, giving its account, approving that account.
      ['READY_FOR_PAYMENT', {}, (request) => repos[0]!.requestPayoutCorrectionAtomic({ ...decision(request), actorRoles: ['FINANCE'], allowSelfApproval: false,
        requestedAt: new Date(), reasonCode: 'OTHER', onPersisted: noop })],
      ['PENDING_APPROVAL', { payoutCorrectionRequestedAt: day }, (request) => repos[0]!.submitPayoutCorrectionAtomic({ ...decision(request), submittedAt: new Date(),
        payout: { write: { mode: 'CASH' } }, approverRouteUserIds: [], onPersisted: noop })],
      ['PENDING_APPROVAL', { payoutCorrectionRequestedAt: day, payoutCorrectionSubmittedAt: day }, (request) => repos[0]!.approvePayoutCorrectionAtomic({ ...decision(request),
        actorRoles: ['OWNER'], allowSelfApproval: false, decidedAt: new Date(), onApprovedPersisted: noop })],
    ];
    const refusedForCancellation = (error: unknown) => errorMessage(error) === 'reimbursement_cancellation_pending' || errorCode(error) === 'reimbursement_draft_changed';

    for (const [status, extra, act] of cases) {
      const before = await claimIn(status, extra);
      await strand({ requestId: before.id }, 'ซื้อซ้ำกับใบก่อน');
      const pending = (await repos[0]!.findRequestById(companyId, before.id))!;
      await assert.rejects(() => act(pending), refusedForCancellation, `${status}: refused while the cancellation is pending`);
      const untouched = await db.reimbursementRequest.findUniqueOrThrow({ where: { id: before.id } });
      assert.deepEqual([untouched.status, untouched.updatedAt.getTime()], [status, pending.updatedAt.getTime()], `${status}: nothing changed`);

      // Withdrawn: the same call is no longer refused for that reason (it may still be refused for its own).
      await repos[0]!.withdrawCancellationAtomic({ companyId, requestId: before.id, actorUserId: FIN, scopes: {}, onWithdrawnPersisted: noop });
      const live = (await repos[0]!.findRequestById(companyId, before.id))!;
      const again = await act(live).then(() => undefined, (error: unknown) => error ?? new Error('rejected with nothing'));
      assert.ok(!again || !refusedForCancellation(again), `${status}: still refused for the cancellation after it was withdrawn`);
    }
  });

  // The fence. A continue reads the claim, then voids each record in a transaction of its own. A
  // withdrawal that lands in between must stop those voids, or the claim goes on with a voided record.
  it('never voids for a cancellation withdrawn while it was being continued, even when the void was already waiting behind the withdrawal', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    for (const voidAlreadyWaiting of [false, true]) {
      const claim = await payableClaim(2);
      await strand(claim, 'ซื้อซ้ำกับใบก่อน');
      const repo = repos[0]! as any;
      const begin = repo.beginCancellationAtomic.bind(repo);
      let withdrawal: Promise<unknown> = Promise.resolve();
      // The continue has read the claim and still holds its intent. Now the withdrawal starts on the other connection.
      repo.beginCancellationAtomic = async (data: any) => {
        const intent = await begin(data);
        await new Promise<void>((reached) => {
          withdrawal = repos[1]!.withdrawCancellationAtomic({
            companyId, requestId: claim.requestId, actorUserId: FIN, scopes: {},
            onWithdrawnPersisted: async () => {
              if (!voidAlreadyWaiting) return;
              // The intent is cleared and the claim's lock held, but nothing is committed: the continue goes
              // on, and its void starts (taking its snapshot) while it waits for this transaction.
              reached();
              await new Promise((resolve) => setTimeout(resolve, 500));
            },
          });
          void withdrawal.then(() => reached(), () => reached());
        });
        return intent;
      };
      try {
        await assert.rejects(() => on(0).cancel.execute(requester(), claim.requestId),
          (error: any) => error.getStatus?.() === 409 && errorMessage(error) === 'reimbursement_cancellation_intent_changed', `void already waiting: ${voidAlreadyWaiting}`);
        await withdrawal;
      } finally {
        delete repo.beginCancellationAtomic;
      }
      assert.deepEqual(await stored(claim), { status: 'READY_FOR_PAYMENT', pending: false, pendingReason: null, closedReason: null,
        expenses: ['CONFIRMED', 'CONFIRMED'], voidReasons: [null], reversals: 0, cancelledEvents: 0, cancelAudits: 0 }, `void already waiting: ${voidAlreadyWaiting}`);
      // The claim goes on: it can still be paid.
      await repos[0]!.assertClaimPaymentReady(companyId, claim.requestId);
    }
  });

  it('a withdrawal and a continue started together end whole either way: cancelled with every record voided, or going on with none voided', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    for (let round = 0; round < 6; round += 1) {
      const claim = await payableClaim(2);
      await strand(claim, 'ซื้อซ้ำกับใบก่อน');
      const proceed = () => on(round % 2).cancel.execute(requester(), claim.requestId);
      const takeBack = () => on((round + 1) % 2).withdraw.execute(finance(), claim.requestId);
      await Promise.allSettled(round % 2 === 0 ? [proceed(), takeBack()] : [takeBack(), proceed()]);

      const after = await stored(claim);
      const whole = after.status === 'CANCELLED'
        ? after.expenses.every((status) => status === 'VOIDED') && after.reversals === 2 && after.cancelledEvents === 1
        : after.status === 'READY_FOR_PAYMENT' && !after.pending && after.expenses.every((status) => status === 'CONFIRMED') && after.reversals === 0 && after.cancelledEvents === 0;
      assert.ok(whole, `round ${round}: ${JSON.stringify(after)}`);
    }
  });

  it('cancels once when two people press ดำเนินการยกเลิกต่อ at the same moment', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    for (let round = 0; round < 6; round += 1) {
      const claim = await payableClaim(2);
      await strand(claim, 'ซื้อซ้ำกับใบก่อน');
      const results = await Promise.allSettled([on(0).cancel.execute(requester(), claim.requestId), on(1).cancel.execute(finance(), claim.requestId)]);
      // One of them cancels it. The other is told it is cancelled, or (when it lost a void to the first) that
      // the cancellation is being finished: a 409 to load the claim again, never a database error.
      const answers = results.map((result) => (result.status === 'fulfilled' ? result.value.status : `${result.reason?.getStatus?.()} ${errorMessage(result.reason)}`));
      assert.ok(answers.includes('CANCELLED'), `round ${round}: ${answers.join(' | ')}`);
      assert.ok(answers.every((answer) => answer === 'CANCELLED' || answer === '409 reimbursement_cancellation_in_progress'), `round ${round}: ${answers.join(' | ')}`);
      assert.deepEqual(await stored(claim), { status: 'CANCELLED', pending: true, pendingReason: 'ซื้อซ้ำกับใบก่อน', closedReason: 'ซื้อซ้ำกับใบก่อน',
        expenses: ['VOIDED', 'VOIDED'], voidReasons: ['ซื้อซ้ำกับใบก่อน'], reversals: 2, cancelledEvents: 1, cancelAudits: 1 }, `round ${round}`);
    }
  });

  it('the scheduled run finishes a cancellation nobody continued, and leaves one a person has to unblock exactly as it is', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const [abandoned, shortReason, closed] = [await payableClaim(2), await payableClaim(), await payableClaim()];
    await strand(abandoned, 'ซื้อซ้ำกับใบก่อน');
    await strand(shortReason, 'ก');
    await strand(closed, 'ซื้อซ้ำกับใบก่อน');
    await closePeriod(closed.periodId);
    /** Reversal numbers reserved for a claim's expense records, kept or thrown away: each void attempt of a posted record takes one. */
    const reversalNumbers = (claim: { expenseIds: string[] }) => clients[0]!.documentNumber.count({
      where: { companyId, OR: claim.expenseIds.map((id) => ({ idempotencyKey: { startsWith: `void-reversal:expense.record:${id}:` } })) },
    });

    const all = [abandoned, shortReason, closed];
    const run = ofThese(all, await system(1).reconciler.execute());

    assert.deepEqual(run, { completed: [abandoned.requestId], failed: [], blocked: [shortReason.requestId, closed.requestId].sort() });
    assert.deepEqual(await stored(abandoned), { status: 'CANCELLED', pending: true, pendingReason: 'ซื้อซ้ำกับใบก่อน', closedReason: 'ซื้อซ้ำกับใบก่อน',
      expenses: ['VOIDED', 'VOIDED'], voidReasons: ['ซื้อซ้ำกับใบก่อน'], reversals: 2, cancelledEvents: 1, cancelAudits: 1 });
    for (const claim of [shortReason, closed]) {
      assert.deepEqual([(await stored(claim)).status, (await stored(claim)).expenses, (await stored(claim)).reversals], ['READY_FOR_PAYMENT', ['CONFIRMED'], 0]);
    }
    // One reversal number for each record it voided, and none spent on the two claims it could not finish.
    assert.deepEqual([await reversalNumbers(abandoned), await reversalNumbers(shortReason), await reversalNumbers(closed)], [2, 0, 0]);

    // Once the period is open again the next run finishes that one; the short reason still waits for a person.
    await closePeriod(closed.periodId, 'OPEN');
    assert.deepEqual(ofThese(all, await system(1).reconciler.execute()), { completed: [closed.requestId], failed: [], blocked: [shortReason.requestId] });
    assert.equal((await stored(closed)).status, 'CANCELLED');
    assert.equal((await on(0).cancel.execute(finance(), shortReason.requestId, 'ซื้อซ้ำกับใบก่อน')).status, 'CANCELLED');
  });

  it('cancels once when ดำเนินการยกเลิกต่อ and the scheduled run take the same claim at the same moment', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    for (let round = 0; round < 6; round += 1) {
      const claim = await payableClaim(2);
      await strand(claim, 'ซื้อซ้ำกับใบก่อน');
      const [person, run] = await Promise.allSettled([on(0).cancel.execute(finance(), claim.requestId), system(1).reconciler.execute()]);
      // The person is told it is cancelled, or (having lost a void to the run) that it is being finished.
      const answer = person.status === 'fulfilled' ? person.value.status : `${person.reason?.getStatus?.()} ${errorMessage(person.reason)}`;
      assert.ok(['CANCELLED', '409 reimbursement_cancellation_in_progress'].includes(answer), `round ${round}: ${answer}`);
      // The run never calls it a failure that a person got there first.
      assert.equal(run.status, 'fulfilled', `round ${round}: ${(run as PromiseRejectedResult).reason}`);
      assert.deepEqual(ofThese([claim], (run as PromiseFulfilledResult<any>).value).failed, [], `round ${round}`);
      assert.deepEqual(await stored(claim), { status: 'CANCELLED', pending: true, pendingReason: 'ซื้อซ้ำกับใบก่อน', closedReason: 'ซื้อซ้ำกับใบก่อน',
        expenses: ['VOIDED', 'VOIDED'], voidReasons: ['ซื้อซ้ำกับใบก่อน'], reversals: 2, cancelledEvents: 1, cancelAudits: 1 }, `round ${round}`);
    }
  });

  it('marks the finance-queue row of a claim being cancelled exactly while the payment is refused, and no row of a cancelled claim', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const queueRow = async () => (await new ListFinanceQueueUseCase(repos[0]!).execute(finance())).find((row) => row.id === claim.requestId);
    const paymentTaken = () => repos[0]!.assertClaimPaymentReady(companyId, claim.requestId).then(() => true, (error) => {
      assert.equal(errorMessage(error), 'reimbursement_cancellation_pending');
      return false;
    });
    const says = async () => { const row = await queueRow(); return [row?.cancellationPending ?? false, row?.currentDesk?.kind, await paymentTaken()]; };

    assert.deepEqual(await says(), [false, 'PAYMENT', true]);
    await strand(claim, 'ก');
    assert.deepEqual(await says(), [true, 'SYSTEM', false]);
    await on(0).withdraw.execute(finance(), claim.requestId);
    assert.deepEqual(await says(), [false, 'PAYMENT', true]);

    // Cancelled: it leaves the queue, and its row elsewhere is a finished claim, not one being cancelled.
    await on(0).cancel.execute(finance(), claim.requestId, 'ซื้อซ้ำกับใบก่อน');
    assert.equal(await queueRow(), undefined);
    const cancelled = (await repos[0]!.findRequestById(companyId, claim.requestId))!;
    assert.deepEqual([cancelled.status, !!cancelled.cancellationPendingAt, toRequestSummary(cancelled).cancellationPending], ['CANCELLED', true, undefined]);
  });

  it('offers no approval on a claim being cancelled, as the approve and reject calls refuse it, and offers both again once it is withdrawn', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const waiting = await waitingClaim();
    const approve = (claim: { id: string; updatedAt: Date; approvalSnapshotHash?: string }) => repos[0]!.beginApprovalDecisionAtomic({
      companyId, requestId: claim.id, expectedUpdatedAt: claim.updatedAt, expectedApprovalSnapshotHash: claim.approvalSnapshotHash,
      actorUserId: MGR, actorRoles: ['MANAGER'], scopes: {}, allowSelfApproval: false, financeReviewRequired: false,
      decidedAt: new Date(), financeRequestPatch: {}, onDecisionPersisted: async () => undefined,
    });
    const reject = (claim: { id: string; updatedAt: Date }) => repos[0]!.rejectRequestAtomic({
      companyId, requestId: claim.id, expectedUpdatedAt: claim.updatedAt, actorUserId: MGR, actorRoles: ['MANAGER'], scopes: {}, allowSelfApproval: false,
      decidedAt: new Date(), rejectionReason: 'ไม่ผ่าน', request: { status: 'REJECTED' }, onRejectedPersisted: async () => undefined,
    } as any);
    assert.deepEqual((await on(0).detail.execute(manager(), waiting.id)).approvalActions, { canApprove: true, canReject: true });

    await strand({ requestId: waiting.id }, 'ซื้อซ้ำกับใบก่อน');

    const cancelling = await on(0).detail.execute(manager(), waiting.id);
    assert.deepEqual([cancelling.approvalActions, cancelling.currentDesk, !!cancelling.pendingCancellation], [{ canApprove: false, canReject: false }, { kind: 'SYSTEM' }, true]);
    // What the flags say is what the two calls answer.
    const now = (await repos[0]!.findRequestById(companyId, waiting.id))!;
    await assert.rejects(() => approve(now), /reimbursement_cancellation_pending/);
    await assert.rejects(() => reject(now), /reimbursement_cancellation_pending/);

    await on(0).withdraw.execute(requester(), waiting.id);
    assert.deepEqual((await on(0).detail.execute(manager(), waiting.id)).approvalActions, { canApprove: true, canReject: true });
    assert.equal((await approve((await repos[0]!.findRequestById(companyId, waiting.id))!)).resumed, false);
  });

  // ---- A claim's expense record ends with its claim ----

  it('refuses to void, reject or delete a standing claim\'s expense record from the expense screen, and the claim goes on as if nobody had asked', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const accountant = () => ({ ...finance(), permissions: ['expense.void', 'expense.reject', 'expense.delete'] });
    const refusedForItsClaim = (requestNo: string) => (error: any) => {
      const response = error.getResponse?.() as { code?: string; message?: string; requestNo?: string } | undefined;
      assert.deepEqual([error.getStatus?.(), response?.code, response?.requestNo], [409, 'expense_belongs_to_reimbursement', requestNo]);
      assert.ok(response!.message!.includes(`คำขอเบิก ${requestNo}`) && response!.message!.includes('ให้ยกเลิกที่คำขอเบิกนั้นในเมนูการเบิกจ่าย'), response!.message);
      return true;
    };

    // A claim waiting for payment: its record is confirmed and its journal posted.
    const payable = await payableClaim();
    const payableNo = (await repos[0]!.findRequestById(companyId, payable.requestId))!.requestNo!;
    const numbers = () => clients[0]!.documentNumber.count({ where: { companyId, idempotencyKey: { startsWith: `void-reversal:expense.record:${payable.expenseIds[0]}:` } } });
    await assert.rejects(() => on(0).expenseScreen.void.execute(accountant(), payable.expenseIds[0]!, 'บันทึกผิด'), refusedForItsClaim(payableNo));
    assert.deepEqual([await stored(payable), await numbers()], [{ status: 'READY_FOR_PAYMENT', pending: false, pendingReason: null, closedReason: null,
      expenses: ['CONFIRMED'], voidReasons: [null], reversals: 0, cancelledEvents: 0, cancelAudits: 0 }, 0], 'nothing voided, no reversal number spent');
    await repos[0]!.assertClaimPaymentReady(companyId, payable.requestId);

    // A claim that was approved and whose record is built and not confirmed yet: the record a rejection could reach.
    const decided = await decidedClaim();
    const decidedRequest = (await repos[0]!.findRequestById(companyId, decided.requestId))!;
    const [built] = await repos[0]!.prepareClaimProjections({ companyId, requestId: decided.requestId, decisionKind: 'MANAGER', decisionActorUserId: MGR,
      approvalStepId: decided.stepId, scopes: {}, items: new MaterializeClaimExpensesService().buildItems(decidedRequest) });
    await assert.rejects(() => on(0).expenseScreen.reject.execute(accountant(), built!.expenseId, 'ซ้ำ'), refusedForItsClaim(decidedRequest.requestNo!));
    await assert.rejects(() => on(0).expenseScreen.remove.execute(accountant(), built!.expenseId), refusedForItsClaim(decidedRequest.requestNo!));
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: built!.expenseId } })).status, 'READY_FOR_CONFIRMATION');
    assert.equal(await clients[0]!.auditLog.count({ where: { companyId, targetId: built!.expenseId, action: 'expense.delete', result: 'DENIED' } }), 1);
    // So the claim is still carried out, and still paid.
    assert.equal((await system(0).resume.execute(manager(), decided.requestId)).status, 'READY_FOR_PAYMENT');
    await repos[0]!.assertClaimPaymentReady(companyId, decided.requestId);

    // The claim's own cancel is the way: it voids the record and closes the claim with it.
    assert.equal((await on(0).cancel.execute(finance(), payable.requestId, 'ซื้อซ้ำกับใบก่อน')).status, 'CANCELLED');
    assert.deepEqual([(await stored(payable)).expenses, (await stored(payable)).reversals], [['VOIDED'], 1]);
    // Once the claim has ended it holds the record no more: the expense screen answers by its own rules again.
    await assert.rejects(() => on(0).expenseScreen.void.execute(accountant(), payable.expenseIds[0]!, 'บันทึกผิด'), /Can only void confirmed expenses/);
  });

  // ---- Audit B4: a decision that is on record and was not carried out ----

  /**
   * A claim sent for approval and waiting for its approver. Every line has an amount of its own: the
   * same person, day and amount twice is parked as a possible duplicate instead of being confirmed.
   */
  async function waitingClaim(lines = 1, payBy: 'unset' | 'transfer' = 'unset') {
    const index = ++sequence;
    const amounts = Array.from({ length: lines }, () => 1000 + ++sequence);
    // A claim paid by transfer is sent with the requester's default account, which the submit freezes onto it.
    if (payBy === 'transfer') {
      await repos[0]!.setMemberPayoutAccount({ companyId, userId: STAFF, actorUserId: STAFF, payoutMethod: 'BANK_TRANSFER',
        destination: sealPayoutDestination({ payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0012345678' }, Buffer.alloc(32, 9))! }, async () => undefined);
    }
    const draft = await repos[0]!.createRequest({
      companyId, branchId, requesterUserId: STAFF, requesterDisplayNameSnapshot: 'สมชาย พนักงาน', reason: `decided-${index}`, categoryKey: 'travel',
      amount: `${amounts.reduce((sum, amount) => sum + amount, 0)}.0000`, currency: 'THB', incurredDate: day, receiptRequirementStatus: 'MISSING_WITH_REASON', missingReceiptReason: 'ใบเสร็จหาย',
      createdByUserId: STAFF,
      lines: amounts.map((amount, line) => ({ lineNo: line + 1, incurredDate: day, description: `รายการ ${line + 1}`, categoryKey: 'travel', amount: `${amount}.0000` })),
    });
    const requestSnapshotHash = computeSnapshotHash(claimSnapshotFields(draft));
    const sent = { status: 'PENDING_APPROVAL', submittedAt: new Date(), submittedByUserId: STAFF, outstandingAmount: draft.amount, updatedByUserId: STAFF };
    await repos[0]!.submitDraftAtomic({
      companyId, requestId: draft.id, expectedUpdatedAt: draft.updatedAt, duplicateCandidates: [], evidence: { attachmentIds: [], expenseIds: [] },
      documentNumber: { documentType: 'reimbursement.request', periodKey, idempotencyKey: `reimb-submit:${draft.id}`, reservedByUserId: STAFF },
      ...(payBy === 'transfer' ? {
        approvalStep: { sequenceNo: 1, approverUserId: MGR, approverRoleSnapshot: 'MANAGER' }, request: sent,
        payout: {
          actorUserId: STAFF, frozenAt: new Date(), seenToken: payoutSubmitToken(draft.id, await repos[0]!.planSubmitPayout(draft)),
          snapshotHash: (columns: SubmitPayoutColumns) => computeSnapshotHash(claimSnapshotFields({ ...draft, ...columns })),
        },
      } : {
        approvalStep: { sequenceNo: 1, approverUserId: MGR, approverRoleSnapshot: 'MANAGER', requestSnapshotHash },
        request: { ...sent, approvalSnapshotHash: requestSnapshotHash },
      }),
    } as any);
    if (payBy === 'transfer') await repos[0]!.removeMemberPayoutAccount(companyId, STAFF, async () => undefined);
    return (await repos[0]!.findRequestById(companyId, draft.id, true))!;
  }

  /** Approved by its approver, and nothing after: what a failure between the decision and the expense records leaves. */
  async function decidedClaim(lines = 1) {
    const waiting = await waitingClaim(lines);
    const decision = await repos[0]!.beginApprovalDecisionAtomic({
      companyId, requestId: waiting.id, expectedUpdatedAt: waiting.updatedAt, expectedApprovalSnapshotHash: waiting.approvalSnapshotHash,
      actorUserId: MGR, actorRoles: ['MANAGER'], scopes: {}, allowSelfApproval: false, financeReviewRequired: false,
      decidedAt: new Date(), financeRequestPatch: {}, onDecisionPersisted: async () => undefined,
    });
    return { requestId: waiting.id, stepId: decision.approvalStepId, lines };
  }

  /** Sent under a policy that asked for no approval, and nothing after: status APPROVED with no expense record. */
  async function noApprovalClaim() {
    const waiting = await waitingClaim();
    await clients[0]!.reimbursementApprovalStep.deleteMany({ where: { reimbursementRequestId: waiting.id } });
    await clients[0]!.reimbursementRequest.update({ where: { id: waiting.id }, data: {
      status: 'APPROVED', approvedAt: new Date(), currentApprovalStepId: null,
      approvalPolicySnapshotJson: {
        schemaVersion: 1, policyId: 'pol', policyVersion: 'v1', approvalRequiredFromAmount: '1000.00', requiresApproval: false, route: null, allowSelfApproval: false,
        requireReceipt: true, allowMissingReceiptWithReason: true, duplicatePolicy: 'BLOCK_PAYMENT', financeReviewRequired: false,
      },
    } });
    return { requestId: waiting.id, lines: 1 };
  }

  /** What carrying a decision out leaves behind, read from the tables. */
  async function carried(claim: { requestId: string }) {
    const db = clients[0]!;
    const row = await db.reimbursementRequest.findUniqueOrThrow({ where: { id: claim.requestId } });
    const expenses = await db.expenseRecord.findMany({ where: { companyId, sourceReimbursementRequestId: claim.requestId }, orderBy: { createdAt: 'asc' } });
    const events = (await db.outboxEvent.findMany({ where: { companyId, aggregateId: claim.requestId }, select: { eventType: true } })).map((event) => event.eventType);
    const count = (eventType: string) => events.filter((type) => type === eventType).length;
    return {
      status: row.status as string, expenses: expenses.map((expense) => expense.status as string),
      linesWithARecord: new Set(expenses.map((expense) => expense.sourceReimbursementLineId)).size,
      approvedEvents: count('reimbursement.approved'), readyEvents: count('reimbursement.ready_for_payment'),
      readyAudits: await db.auditLog.count({ where: { companyId, targetId: claim.requestId, action: { in: ['reimbursement.approval.approve', 'reimbursement.approval.auto_by_policy'] } } }),
      resumeAudits: await db.auditLog.count({ where: { companyId, targetId: claim.requestId, action: 'reimbursement.projection.resume' } }),
    };
  }
  const once = (lines: number, resumeAudits = 0) => ({
    status: 'READY_FOR_PAYMENT', expenses: Array.from({ length: lines }, () => 'CONFIRMED'), linesWithARecord: lines,
    approvedEvents: 1, readyEvents: 1, readyAudits: 1, resumeAudits,
  });
  const untouched = { status: 'PENDING_APPROVAL', expenses: [], linesWithARecord: 0, approvedEvents: 0, readyEvents: 0, readyAudits: 0, resumeAudits: 0 };

  it('finds a decided claim behind a page of claims that still wait for their approver, and takes a bounded number per run', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    // Whatever the cases above left waiting is taken first, so the runs below are about these claims.
    await system(0).reconciler.execute();
    // Older than the decided claims, and PENDING_APPROVAL like them: the page the run used to fill up with.
    for (let waiting = 0; waiting < 3; waiting += 1) await waitingClaim();
    const decided = [await decidedClaim(), await decidedClaim(), await decidedClaim()];
    // And one claim whose frozen policy no build can read: it is nobody's to carry out, and it must not stop the list.
    const unreadable = await noApprovalClaim();
    await clients[0]!.reimbursementRequest.update({ where: { id: unreadable.requestId }, data: { approvalPolicySnapshotJson: { schemaVersion: 99 } } });

    // The repository's own list, across every company in this database: at most three rows, and the newest decided claim is one of them.
    const listed = await repos[0]!.listPendingProjectionIntents(3, new Date(Date.now() + 60_000));
    assert.ok(listed.length <= 3);
    const found = listed.find((intent) => intent.request.id === decided[2]!.requestId);
    assert.deepEqual(found && [found.kind, found.actorUserId, found.approvalStepId], ['MANAGER', MGR, decided[2]!.stepId], 'the decided claim is found');
    assert.ok(!listed.some((intent) => intent.request.id === unreadable.requestId));

    // A run takes at most what it was given, the most recent first, and the next run takes the rest.
    const first = ofThese(decided, await system(0).reconciler.execute(2));
    assert.deepEqual(first, { completed: [decided[2]!.requestId, decided[1]!.requestId], failed: [], blocked: [] });
    assert.deepEqual([(await carried(decided[0]!)).status, (await carried(decided[2]!)).status], ['PENDING_APPROVAL', 'READY_FOR_PAYMENT']);
    assert.deepEqual(ofThese(decided, await system(0).reconciler.execute(2)), { completed: [decided[0]!.requestId], failed: [], blocked: [] });
    for (const claim of decided) assert.deepEqual(await carried(claim), once(1));
    // Nothing is left for a third run: a claim carried out is not carried out again.
    assert.deepEqual(ofThese(decided, await system(0).reconciler.execute()), { completed: [], failed: [], blocked: [] });
    for (const claim of decided) assert.deepEqual(await carried(claim), once(1));
  });

  // Final review W7: the scheduled pass never competes with the request that is still carrying its own decision out.
  it('leaves a decision made less than a minute ago to the request carrying it out, and lists it once it is older', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const approved = await decidedClaim();
    const unapproved = await noApprovalClaim();
    const reviewed = await waitingClaim();
    await db.reimbursementRequest.update({ where: { id: reviewed.id }, data: {
      status: 'FINANCE_REVIEW', currentApprovalStepId: null, financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: FIN, financeReviewedAt: new Date(),
    } });
    const fresh = [approved.requestId, reviewed.id, unapproved.requestId];
    const listed = async () => (await repos[0]!.listPendingProjectionIntents(1000)).filter((intent) => fresh.includes(intent.request.id)).map((intent) => intent.kind).sort();

    // Decided a moment ago: on no list of the pass, though each is a decision waiting to be carried out.
    assert.deepEqual(await listed(), []);
    assert.deepEqual((await repos[0]!.listPendingProjectionIntents(1000, new Date(Date.now() + 60_000))).filter((intent) => fresh.includes(intent.request.id)).map((intent) => intent.kind).sort(), ['FINANCE', 'MANAGER', 'POLICY']);
    // A person who presses "ดำเนินการต่อ" is not kept waiting: the minute is the scheduled pass's own.
    assert.equal((await system(0).resume.execute(manager(), approved.requestId)).status, 'READY_FOR_PAYMENT');

    // Still waiting a minute later: nothing is carrying them out any more, and the pass takes them.
    await db.$executeRaw`UPDATE "ReimbursementRequest" SET "updatedAt" = now() - interval '61 seconds' WHERE "id" IN (${reviewed.id}, ${unapproved.requestId})`;
    assert.deepEqual(await listed(), ['FINANCE', 'POLICY']);
  });

  it('carries a decided claim out when ดำเนินการต่อ is pressed, with no second decision, and does nothing the second time', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await decidedClaim(2);
    const decision = await clients[0]!.reimbursementApprovalStep.findUniqueOrThrow({ where: { id: claim.stepId } });
    const shown = await on(0).detail.execute(manager(), claim.requestId);
    assert.deepEqual([shown.status, shown.awaitingSystem, shown.currentDesk, shown.approvalActions],
      ['PENDING_APPROVAL', { kind: 'APPROVAL', canResume: true }, { kind: 'SYSTEM' }, { canApprove: false, canReject: false }]);
    assert.deepEqual((await on(0).detail.execute(requester(), claim.requestId)).awaitingSystem, { kind: 'APPROVAL', canResume: false });
    await assert.rejects(() => system(0).resume.execute(requester(), claim.requestId), /reimbursement_resume_not_allowed/);
    assert.deepEqual(await carried(claim), untouched);

    assert.equal((await system(0).resume.execute(manager(), claim.requestId)).status, 'READY_FOR_PAYMENT');

    assert.deepEqual(await carried(claim), once(2, 1));
    // The decision is the one made before: same approver, same moment. Nothing was decided again.
    const after = await clients[0]!.reimbursementApprovalStep.findUniqueOrThrow({ where: { id: claim.stepId } });
    assert.deepEqual([after.status, after.decisionByUserId, after.decidedAt], [decision.status, decision.decisionByUserId, decision.decidedAt]);
    assert.equal((await on(0).detail.execute(manager(), claim.requestId)).awaitingSystem, undefined);

    assert.equal((await system(1).resume.execute(manager(), claim.requestId)).status, 'READY_FOR_PAYMENT');
    assert.deepEqual(await carried(claim), once(2, 1), 'pressed again: nothing more');
  });

  it('carries the decision out once when ดำเนินการต่อ and the scheduled run take the same claim at the same moment', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    for (let round = 0; round < 6; round += 1) {
      const claim = await decidedClaim(2);
      const [person, run] = await Promise.allSettled([system(0).resume.execute(manager(), claim.requestId), system(1).reconciler.execute()]);
      // The person is shown the claim, or (having lost an expense record to the run) told that it is being carried out.
      const answer = person.status === 'fulfilled' ? 'shown' : `${person.reason?.getStatus?.()} ${errorMessage(person.reason)}`;
      assert.ok(['shown', '409 reimbursement_resume_in_progress'].includes(answer), `round ${round}: ${answer}`);
      assert.equal(run.status, 'fulfilled', `round ${round}: ${(run as PromiseRejectedResult).reason}`);
      assert.deepEqual(ofThese([claim], (run as PromiseFulfilledResult<any>).value).failed, [], `round ${round}`);
      const left = await carried(claim);
      assert.deepEqual({ ...left, resumeAudits: 0 }, once(2), `round ${round}: one expense record per line, one set of events`);
    }
  });

  it('carries the decision out once when two people press ดำเนินการต่อ at the same moment', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    for (let round = 0; round < 4; round += 1) {
      const claim = await noApprovalClaim();
      const presses = await Promise.allSettled([system(0).resume.execute(finance(), claim.requestId), system(1).resume.execute(finance(), claim.requestId)]);
      const answers = presses.map((press) => (press.status === 'fulfilled' ? 'shown' : `${press.reason?.getStatus?.()} ${errorMessage(press.reason)}`));
      assert.ok(answers.includes('shown') && answers.every((answer) => ['shown', '409 reimbursement_resume_in_progress'].includes(answer)), `round ${round}: ${answers.join(' | ')}`);
      assert.deepEqual({ ...(await carried(claim)), resumeAudits: 0 }, once(1), `round ${round}`);
    }
  });

  it('lets whoever may record the payment carry on a claim nobody had to approve, which the payment itself refuses until then', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await noApprovalClaim();
    const shown = await on(0).detail.execute(finance(), claim.requestId);
    assert.deepEqual([shown.status, shown.awaitingSystem, shown.currentDesk?.kind], ['APPROVED', { kind: 'NO_APPROVAL_NEEDED', canResume: true }, 'PAYMENT']);
    // What the page stops offering is what the API refuses: the payment, until the expense records are confirmed.
    await assert.rejects(() => repos[0]!.assertClaimPaymentReady(companyId, claim.requestId), /reimbursement_projection_not_ready/);
    for (const viewer of [requester(), manager()]) {
      assert.deepEqual((await on(0).detail.execute(viewer, claim.requestId)).awaitingSystem, { kind: 'NO_APPROVAL_NEEDED', canResume: false });
      await assert.rejects(() => system(0).resume.execute(viewer, claim.requestId), /reimbursement_resume_not_allowed/);
    }

    assert.equal((await system(0).resume.execute(finance(), claim.requestId)).status, 'READY_FOR_PAYMENT');

    assert.deepEqual(await carried(claim), once(1, 1));
    await repos[0]!.assertClaimPaymentReady(companyId, claim.requestId);
    assert.equal((await on(0).detail.execute(finance(), claim.requestId)).awaitingSystem, undefined);
  });

  it('builds nothing for a claim that is no longer what was approved, from the web or from the scheduled run', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await decidedClaim();
    const approved = (await repos[0]!.findRequestById(companyId, claim.requestId))!.amount;
    const setAmount = async (amount: string) => {
      await clients[0]!.reimbursementLine.updateMany({ where: { reimbursementRequestId: claim.requestId }, data: { amount } });
      await clients[0]!.reimbursementRequest.update({ where: { id: claim.requestId }, data: { amount, outstandingAmount: amount } });
    };
    // Changed behind the approval: the amount is not the amount the approver saw.
    await setAmount('9000.0000');

    await assert.rejects(() => system(0).resume.execute(manager(), claim.requestId), (error: any) => error.getStatus() === 409 && errorMessage(error) === 'stale_approval_snapshot');
    assert.deepEqual(ofThese([claim], await system(1).reconciler.execute()), { completed: [], failed: [[claim.requestId, 'stale_approval_snapshot']], blocked: [] });

    assert.deepEqual(await carried(claim), untouched, 'no expense record, no event, the claim stays where it was');
    // Put right (here: back to what was approved), the next run carries it out.
    await setAmount(approved);
    assert.deepEqual(ofThese([claim], await system(1).reconciler.execute()).completed, [claim.requestId]);
    assert.deepEqual(await carried(claim), once(1));
  });

  // Approval rules are not weakened: a claim paid by transfer is approved only with the approver's
  // attestation of its account, and carrying an approval out neither needs a second one nor stands in for a missing one.
  it('carries out an attested approval of a transfer claim without asking for the attestation again, and nothing for one nobody attested', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const waiting = await waitingClaim(1, 'transfer');
    const claim = { requestId: waiting.id };
    const destination = () => clients[0]!.reimbursementPayoutDestination.findFirstOrThrow({ where: { reimbursementRequestId: waiting.id } });
    const approve = (payoutVerifiedVersion?: number) => repos[0]!.beginApprovalDecisionAtomic({
      companyId, requestId: waiting.id, expectedUpdatedAt: waiting.updatedAt, expectedApprovalSnapshotHash: waiting.approvalSnapshotHash,
      actorUserId: MGR, actorRoles: ['MANAGER'], scopes: {}, allowSelfApproval: false, financeReviewRequired: false,
      decidedAt: new Date(), financeRequestPatch: {}, onDecisionPersisted: async () => undefined, payoutVerifiedVersion,
    });
    assert.deepEqual([waiting.payoutMethod, waiting.payoutDestinationVersion], ['BANK_TRANSFER', 1]);

    // No attestation, no approval. The claim holds no decision, so neither the web call nor the run has anything to carry out.
    await assert.rejects(() => approve(), /payout_verification_required/);
    assert.equal((await on(0).detail.execute(manager(), waiting.id)).awaitingSystem, undefined);
    assert.equal((await system(0).resume.execute(manager(), waiting.id)).status, 'PENDING_APPROVAL');
    assert.deepEqual(ofThese([claim], await system(1).reconciler.execute()), { completed: [], failed: [], blocked: [] });
    assert.deepEqual([await carried(claim), (await destination()).verifiedAt], [untouched, null]);

    // Attested and approved, and nothing after it.
    const decided = await approve(1);
    const attested = await destination();
    assert.deepEqual([attested.verifiedByUserId, attested.verifiedVia, attested.approvalStepId], [MGR, 'APPROVAL', decided.approvalStepId]);

    // ดำเนินการต่อ takes no attestation and makes none: the claim is carried out with the one on record.
    assert.equal((await system(0).resume.execute(manager(), waiting.id)).status, 'READY_FOR_PAYMENT');
    const after = await destination();
    assert.deepEqual([after.verifiedByUserId, after.verifiedAt?.getTime(), after.verifiedVia, after.approvalStepId],
      [MGR, attested.verifiedAt?.getTime(), 'APPROVAL', decided.approvalStepId]);
    assert.deepEqual(await carried(claim), once(1, 1));
  });

  it('carries nothing out for a claim whose cancellation was started, and carries it out once that is withdrawn', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await decidedClaim();
    await strand(claim, 'ก');

    const shown = await on(0).detail.execute(manager(), claim.requestId);
    assert.deepEqual([shown.awaitingSystem, shown.pendingCancellation?.blocker], [undefined, { code: 'reason_too_short' }]);
    await system(0).resume.execute(manager(), claim.requestId);
    assert.deepEqual(ofThese([claim], await system(1).reconciler.execute()), { completed: [], failed: [], blocked: [claim.requestId] });
    assert.deepEqual(await carried(claim), untouched);

    await on(0).withdraw.execute(requester(), claim.requestId);
    assert.deepEqual(ofThese([claim], await system(1).reconciler.execute()).completed, [claim.requestId]);
    assert.deepEqual(await carried(claim), once(1));
  });

  // Final review W4: a cancellation started while a decision was being carried out. The expense records are
  // built and confirmed, and the last write of each of the three ways to "ready for payment" is still to come.
  it('moves no claim on to ready-for-payment, and sends no such notice, once its cancellation is pending', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const ready = (requestId: string) => db.outboxEvent.count({ where: { companyId, aggregateId: requestId, eventType: 'reimbursement.ready_for_payment' } });
    const notify = (requestId: string) => async (tx: any) => { await tx.outboxEvent.create({ data: {
      companyId, eventType: 'reimbursement.ready_for_payment', aggregateType: 'reimbursement_request', aggregateId: requestId,
      eventKey: `reimbursement.ready_for_payment:reimbursement_request:${requestId}:w4`, payloadJson: {}, priority: 'NORMAL', status: 'PENDING',
    } }); };

    // Approved by its manager.
    const approved = await decidedClaim();
    // Passed by finance.
    const reviewed = await waitingClaim();
    await db.reimbursementApprovalStep.updateMany({ where: { reimbursementRequestId: reviewed.id }, data: { status: 'APPROVED', decisionByUserId: MGR, decidedAt: new Date() } });
    await db.reimbursementRequest.update({ where: { id: reviewed.id }, data: {
      status: 'FINANCE_REVIEW', currentApprovalStepId: null, approvedAt: new Date(), financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: FIN, financeReviewedAt: new Date(),
    } });
    // Sent under a policy that asks for no approval.
    const unapproved = await noApprovalClaim();

    const cases: Array<{ name: string; requestId: string; ctx: any; decision: { kind: 'MANAGER' | 'FINANCE' | 'POLICY'; actorUserId: string; approvalStepId?: string }; complete: () => Promise<{ status: string }> }> = [
      { name: 'approval', requestId: approved.requestId, ctx: manager(), decision: { kind: 'MANAGER', actorUserId: MGR, approvalStepId: approved.stepId },
        complete: () => repos[0]!.completeApprovalProjectionAtomic({ companyId, requestId: approved.requestId, decisionActorUserId: MGR, approvalStepId: approved.stepId, scopes: {}, completedAt: new Date(), onReadyPersisted: notify(approved.requestId) }) },
      { name: 'finance decision', requestId: reviewed.id, ctx: finance(), decision: { kind: 'FINANCE', actorUserId: FIN },
        complete: () => repos[0]!.completeFinanceProjectionAtomic({ companyId, requestId: reviewed.id, decisionActorUserId: FIN, scopes: {}, completedAt: new Date(), onReadyPersisted: notify(reviewed.id) }) },
      { name: 'no-approval submit', requestId: unapproved.requestId, ctx: requester(), decision: { kind: 'POLICY', actorUserId: STAFF },
        complete: () => repos[0]!.completePolicyProjectionAtomic({ companyId, requestId: unapproved.requestId, actorUserId: STAFF, scopes: {}, completedAt: new Date(), onReadyPersisted: notify(unapproved.requestId) }) },
    ];
    for (const { name, requestId, ctx, decision, complete } of cases) {
      const decided = (await repos[0]!.findRequestById(companyId, requestId, true))!;
      await system(0).orchestrator.execute(ctx, decided, { ...decision, allowMissingReceiptWithReason: true });
      const standing = await claimRow(requestId);
      assert.deepEqual((await db.expenseRecord.findMany({ where: { companyId, sourceReimbursementRequestId: requestId } })).map((expense) => expense.status), ['CONFIRMED'], name);

      // The cancellation starts now (a reason the void refuses, so it stays pending until someone acts).
      await strand({ requestId }, 'ก');
      await assert.rejects(complete, conflict('reimbursement_cancellation_pending'), name);
      const refused = await claimRow(requestId);
      assert.deepEqual([refused.status, refused.paymentStatus, refused.cancellationPendingAt !== null, await ready(requestId)], [standing.status, standing.paymentStatus, true, 0], name);

      // Withdrawn: the same write carries the decision out, once, with its notice.
      await on(0).withdraw.execute(requester(), requestId);
      assert.equal((await complete()).status, 'READY_FOR_PAYMENT', name);
      const done = await claimRow(requestId);
      assert.deepEqual([done.status, done.paymentStatus, done.cancellationPendingAt, await ready(requestId)], ['READY_FOR_PAYMENT', 'UNPAID', null, 1], name);
    }
  });

  // ---- Payout spec §14 (AC25, AC29-AC32): the payout account of an approved claim is corrected on the same claim ----

  const roundKey = Buffer.alloc(32, 9);
  const SCB_ACCOUNT = { payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountNumber: '4090001112' };
  /** The requester as the claim page knows them when they may edit their own claims. */
  const requesterWhoEdits = () => ({ ...requester(), permissions: ['reimbursement.read_own', 'reimbursement.cancel_own', 'reimbursement.update_own_draft'] });

  /** The use cases of a round over one connection, with the audit rows and events written to the database. */
  function round(index: number) {
    const prisma = { client: clients[index]! } as any;
    const audit = { log: (entry: any, tx?: any) => new PrismaAuditRepository(prisma).log(entry, tx) } as any;
    const evidence = new ReimbursementEvidenceService(new PrismaAttachmentRepository(prisma), new PrismaExpenseRepository(prisma));
    const payouts = new MemberPayoutAccountUseCase(repos[index]!, audit, { credentialEncryptionKey: roundKey } as any,
      { executeInTransaction: async () => { throw new Error('nobody typed an account for someone else here'); } } as any);
    return {
      sendBack: new RequestPayoutCorrectionUseCase(repos[index]!, audit, evidence),
      giveAccount: new SubmitPayoutCorrectionUseCase(repos[index]!, audit, evidence, payouts, new ListReimbursementApproverOptionsUseCase(prisma)),
      // A round builds no expense record: an approval that asked the orchestrator for one would fail here.
      approve: new ApproveReimbursementUseCase(repos[index]!, audit, { execute: async () => { throw new Error('a correction round builds no expense record'); } } as any, evidence),
      reject: new RejectReimbursementUseCase(repos[index]!, audit, evidence),
    };
  }

  /**
   * A claim paid by transfer that waits for payment the way production leaves it: sent with the
   * requester's default account, approved by its manager who checked account version 1, carried out
   * by the system, and every line with a confirmed expense record and a posted journal.
   */
  async function approvedTransferClaim(lines = 1) {
    const db = clients[0]!;
    const waiting = await waitingClaim(lines, 'transfer');
    await repos[0]!.beginApprovalDecisionAtomic({
      companyId, requestId: waiting.id, expectedUpdatedAt: waiting.updatedAt, expectedApprovalSnapshotHash: waiting.approvalSnapshotHash,
      actorUserId: MGR, actorRoles: ['MANAGER'], scopes: {}, allowSelfApproval: false, financeReviewRequired: false,
      decidedAt: new Date(), financeRequestPatch: {}, onDecisionPersisted: async () => undefined, payoutVerifiedVersion: 1,
    });
    assert.equal((await system(0).resume.execute(manager(), waiting.id)).status, 'READY_FOR_PAYMENT');
    const period = await db.accountingPeriod.create({ data: { companyId, periodKey: `${2100 + ++sequence}-09`, startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30') } });
    const expenses = await db.expenseRecord.findMany({ where: { companyId, sourceReimbursementRequestId: waiting.id }, orderBy: { createdAt: 'asc' } });
    for (const expense of expenses) {
      await db.journalEntry.create({ data: {
        companyId, periodId: period.id, entryNumber: `JV-${S}-${++sequence}`, entryType: 'GENERATED', sourceType: 'expense.record', sourceId: expense.id,
        status: 'POSTED', entryDate: day, postedAt: day, postedByUserId: FIN, createdByUserId: FIN,
        lines: { create: [
          { accountId: accounts.expense, lineNumber: 1, debitAmount: expense.grandTotalAmount, creditAmount: '0' },
          { accountId: accounts.payable, lineNumber: 2, debitAmount: '0', creditAmount: expense.grandTotalAmount },
        ] },
      } });
      await db.expenseRecord.update({ where: { id: expense.id }, data: { postingStatus: 'posted' } });
    }
    const row = await db.reimbursementRequest.findUniqueOrThrow({ where: { id: waiting.id } });
    return { requestId: waiting.id, expenseIds: expenses.map((expense) => expense.id), periodId: period.id, amount: row.amount.toFixed(4), requestNo: row.requestNo! };
  }

  /**
   * Everything of a claim a correction round must leave exactly as it was, read from the tables: the
   * claim's own columns apart from the ones a round is about (its account, its approval, its round),
   * its lines, its expense records, their journals and journal lines, its duplicate candidates and
   * its payments.
   */
  async function leftAloneByARound(claim: { requestId: string; expenseIds: string[] }) {
    const db = clients[0]!;
    const {
      status: _status, approvedAt: _approvedAt, paymentStatus: _paymentStatus, currentApprovalStepId: _step, currentApproverUserId: _approver,
      approvalSnapshotHash: _hash, payoutMethod: _method, payoutDestinationVersion: _version, payoutFingerprint: _fingerprint,
      payoutCorrectionRequestedAt: _requestedAt, payoutCorrectionRequestedByUserId: _requestedBy, payoutCorrectionReasonCode: _reason,
      payoutCorrectionNote: _note, payoutCorrectionSubmittedAt: _submittedAt, payoutCorrectionLogJson: _log, updatedAt: _updatedAt, updatedByUserId: _updatedBy,
      ...kept
    } = await db.reimbursementRequest.findUniqueOrThrow({ where: { id: claim.requestId } });
    return {
      claim: kept,
      lines: await db.reimbursementLine.findMany({ where: { reimbursementRequestId: claim.requestId }, orderBy: { lineNo: 'asc' } }),
      expenses: await db.expenseRecord.findMany({ where: { companyId, sourceReimbursementRequestId: claim.requestId }, orderBy: { id: 'asc' } }),
      journals: await db.journalEntry.findMany({ where: { companyId, sourceId: { in: claim.expenseIds } }, include: { lines: { orderBy: { lineNumber: 'asc' } } }, orderBy: { id: 'asc' } }),
      duplicates: await db.reimbursementDuplicateCandidate.findMany({ where: { reimbursementRequestId: claim.requestId }, orderBy: { id: 'asc' } }),
      payments: await db.reimbursementPayment.findMany({ where: { reimbursementRequestId: claim.requestId }, orderBy: { id: 'asc' } }),
    };
  }
  const claimRow = (requestId: string) => clients[0]!.reimbursementRequest.findUniqueOrThrow({ where: { id: requestId } });
  const stepsOf = (requestId: string) => clients[0]!.reimbursementApprovalStep.findMany({ where: { reimbursementRequestId: requestId }, orderBy: { assignedAt: 'asc' } });
  const accountVersionsOf = (requestId: string) => clients[0]!.reimbursementPayoutDestination.findMany({ where: { reimbursementRequestId: requestId }, orderBy: { version: 'asc' } });
  const eventsOf = async (requestId: string) => (await clients[0]!.outboxEvent.findMany({ where: { companyId, aggregateId: requestId }, orderBy: { createdAt: 'asc' } }));
  let roundSlips = 0;
  /** A transfer recorded by finance with their own completed slip upload for the claim, confirming an account version when one is named. */
  async function transferInto(claim: { requestId: string; amount: string }, attempt: string, payoutDestinationVersion?: number) {
    const slip = await clients[0]!.attachmentObject.create({ data: {
      companyId, branchId, storageProvider: 'LOCAL', bucket: 'test', objectKey: `${S}/round-slip-${++roundSlips}`, originalFileName: 'slip.jpg',
      mimeType: 'image/jpeg', byteSize: 250_000, checksumSha256: 'e'.repeat(64), uploadedByUserId: FIN, status: 'ACTIVE',
      metadataJson: { generatedFor: 'reimbursement_payment_slip', requestId: claim.requestId },
    } });
    return {
      companyId, reimbursementRequestId: claim.requestId, idempotencyKey: `${S}-${attempt}-${roundSlips}`, paidAmount: claim.amount, currency: 'THB',
      paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-ROUND', paidAt: new Date(), paidByUserId: FIN, slipAttachmentId: slip.id,
      ...(payoutDestinationVersion !== undefined && { payout: { payoutDestinationVersion, payoutConfirmed: true } }),
    };
  }
  /** A claim in phase B: sent back by finance, and given another account by its requester. */
  async function claimWithANewAccount(lines = 1) {
    const claim = await approvedTransferClaim(lines);
    await round(0).sendBack.execute(finance(), claim.requestId, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
    await round(0).giveAccount.execute(requesterWhoEdits(), claim.requestId, { mode: 'SPECIFIED', ...SCB_ACCOUNT });
    return claim;
  }
  const conflict = (code: string) => (error: any) => error?.getStatus?.() === 409 && (errorCode(error) ?? errorMessage(error)) === code;

  it('corrects the account of an approved claim and nothing else of it, and pays into the account its approver checked', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await approvedTransferClaim(2);
    const before = await leftAloneByARound(claim);
    const first = await claimRow(claim.requestId);
    assert.deepEqual([first.status, first.payoutDestinationVersion, before.expenses.map((expense) => [expense.status, expense.postingStatus]), before.journals.map((journal) => journal.lines.length)],
      ['READY_FOR_PAYMENT', 1, [['CONFIRMED', 'posted'], ['CONFIRMED', 'posted']], [2, 2]]);

    // Sent back by whoever pays, with a note. The claim is with its requester; nothing else of it moved.
    const sentBack = await round(0).sendBack.execute(finance(), claim.requestId, { reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้' });
    assert.deepEqual([sentBack.status, sentBack.requestNo, sentBack.payoutCorrection?.phase, sentBack.currentDesk, sentBack.payoutCorrection?.previous?.version, sentBack.payoutCorrection?.requestedByName],
      ['PENDING_APPROVAL', claim.requestNo, 'AWAITING_REQUESTER', { kind: 'REQUESTER' }, 1, 'วราภรณ์ การเงิน']);
    assert.deepEqual(await leftAloneByARound(claim), before, 'sent back');
    const withRequester = await claimRow(claim.requestId);
    assert.deepEqual([withRequester.approvedAt, withRequester.paymentStatus, withRequester.currentApprovalStepId, withRequester.approvalSnapshotHash, withRequester.payoutDestinationVersion],
      [null, 'NOT_PAYABLE', null, first.approvalSnapshotHash, 1]);
    // Neither the scheduled run nor "ดำเนินการต่อ" has anything to carry out for it.
    assert.deepEqual(ofThese([claim], await system(1).reconciler.execute()), { completed: [], failed: [], blocked: [] });
    assert.equal(await system(0).reconciler.repair(companyId, claim.requestId), false);
    assert.equal((await on(0).detail.execute(manager(), claim.requestId)).awaitingSystem, undefined);

    // The requester gives another account: a new frozen version, a new hash, and the same approver again.
    const given = await round(0).giveAccount.execute(requesterWhoEdits(), claim.requestId, { mode: 'SPECIFIED', ...SCB_ACCOUNT });
    assert.deepEqual([given.payoutCorrection?.phase, given.payout?.version, given.payout?.accountLast4, given.payoutCorrection?.previous?.accountLast4, given.payout?.verifiedAt ?? null],
      ['AWAITING_APPROVAL', 2, '1112', '5678', null]);
    assert.deepEqual(await leftAloneByARound(claim), before, 'account given');
    const steps = await stepsOf(claim.requestId);
    assert.deepEqual(steps.map((step) => [step.status, step.approverUserId, step.approverRoleSnapshot, step.invalidatedReason, step.sequenceNo]),
      [['APPROVED', MGR, 'MANAGER', 'payout_account_correction', 1], ['PENDING', MGR, 'MANAGER', null, 1]]);
    const withApprover = (await repos[0]!.findRequestById(companyId, claim.requestId))!;
    assert.notEqual(withApprover.approvalSnapshotHash, first.approvalSnapshotHash);
    assert.deepEqual([withApprover.approvalSnapshotHash, steps[1]!.requestSnapshotHash],
      [computeSnapshotHash(claimSnapshotFields(withApprover, withApprover.approvalPolicySnapshotJson)), withApprover.approvalSnapshotHash]);
    assert.deepEqual(ofThese([claim], await system(1).reconciler.execute()), { completed: [], failed: [], blocked: [] });

    // The approver is shown both accounts, checks the new one and approves: ready for payment in that one call.
    const shown = await on(0).detail.execute(manager(), claim.requestId);
    assert.deepEqual([shown.approvalActions, shown.payout?.version, shown.payoutCorrection?.previous?.version, shown.currentDesk?.kind], [{ canApprove: true, canReject: true }, 2, 1, 'APPROVER']);
    await assert.rejects(() => round(0).approve.execute(manager(), claim.requestId, undefined, shown.approvalSnapshotHash, 1), conflict('payout_destination_changed'));
    const approved = await round(0).approve.execute(manager(), claim.requestId, undefined, shown.approvalSnapshotHash, shown.payout!.version);
    assert.deepEqual([approved.status, approved.payoutCorrection, approved.currentDesk?.kind, approved.requestNo], ['READY_FOR_PAYMENT', undefined, 'PAYMENT', claim.requestNo]);
    assert.deepEqual(await leftAloneByARound(claim), before, 'approved again');
    const after = await claimRow(claim.requestId);
    assert.deepEqual([after.status, after.paymentStatus, after.currentApprovalStepId, after.payoutCorrectionRequestedAt, after.payoutCorrectionRequestedByUserId, after.payoutCorrectionReasonCode,
      after.payoutCorrectionNote, after.payoutCorrectionSubmittedAt, after.payoutDestinationVersion], ['READY_FOR_PAYMENT', 'UNPAID', null, null, null, null, null, null, 2]);
    assert.ok(after.approvedAt!.getTime() > first.approvedAt!.getTime(), 'approved anew');
    // Nothing was left for the system: it finds no decision to carry out, and builds nothing.
    assert.deepEqual(ofThese([claim], await system(1).reconciler.execute()), { completed: [], failed: [], blocked: [] });
    assert.deepEqual(await leftAloneByARound(claim), before, 'after the scheduled run');

    // Each account version names who checked it and at which approval.
    const [stepOne, stepTwo] = await stepsOf(claim.requestId);
    assert.deepEqual((await accountVersionsOf(claim.requestId)).map((row) => [row.version, row.accountLast4, row.verifiedByUserId, row.verifiedVia, row.approvalStepId, row.frozenAt !== null]),
      [[1, '5678', MGR, 'APPROVAL', stepOne!.id, true], [2, '1112', MGR, 'APPROVAL', stepTwo!.id, true]]);
    assert.deepEqual([stepTwo!.status, stepTwo!.decisionByUserId], ['APPROVED', MGR]);

    // One notice per step of the round, each written with its step; the claim's own first approval had its own.
    const roundEvents = (await eventsOf(claim.requestId)).filter((event) => event.createdAt.getTime() >= withRequester.payoutCorrectionRequestedAt!.getTime());
    assert.deepEqual(roundEvents.map((event) => event.eventType),
      ['reimbursement.payout_correction_requested', 'reimbursement.payout_correction_submitted', 'reimbursement.ready_for_payment']);
    assert.deepEqual((roundEvents[0]!.payloadJson as any).data.payoutCorrectionNotice, 'เหตุผล: เลขบัญชีไม่ถูกต้อง · เปิดใบเบิกเพื่อแก้บัญชีรับเงิน');
    const audits = await clients[0]!.auditLog.findMany({ where: { companyId, targetId: claim.requestId, action: { startsWith: 'reimbursement.payout' } }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(audits.map((row) => [row.action, row.result]).slice(-4), [
      ['reimbursement.payout_correction.request', 'SUCCESS'], ['reimbursement.payout_correction.submit', 'SUCCESS'],
      ['reimbursement.payout_correction.approve', 'SUCCESS'], ['reimbursement.payout.verify', 'SUCCESS'],
    ]);
    // No full account number, and nothing anyone typed, left the claim.
    const written = JSON.stringify([roundEvents.map((event) => event.payloadJson), audits.map((row) => row.metadataJson)]);
    assert.ok(!/4090001112|0012345678|ไม่พบบัญชีนี้/.test(written));

    // The account the approver checked is the one the payer is shown, and the one the payment is stored with.
    const forPayer = await on(0).detail.execute(finance(), claim.requestId);
    assert.deepEqual([forPayer.payout?.version, forPayer.payout?.accountLast4, forPayer.payout?.verifiedByName, forPayer.payoutCorrectionActions],
      [2, '1112', 'สมศรี ผู้จัดการ', { canRequest: true, canSubmit: false }]);
    await assert.rejects(async () => repos[0]!.recordPaymentAtomic(await transferInto(claim, 'old-account', 1)), conflict('payout_destination_changed'));
    const paid = await repos[0]!.recordPaymentAtomic(await transferInto(claim, 'new-account', forPayer.payout!.version));
    const payments = await clients[0]!.reimbursementPayment.findMany({ where: { reimbursementRequestId: claim.requestId } });
    assert.deepEqual([paid.request.status, payments.map((payment) => payment.payoutDestinationVersion), paid.payout?.payoutDestinationVersion, paid.payout?.accountLast4, paid.payout?.payerVerified],
      ['PAID', [2], 2, '1112', false]);
    // The claim's timeline has the three steps of its round, with the people named.
    assert.deepEqual((await on(0).detail.execute(finance(), claim.requestId)).payoutCorrectionHistory!.map((entry) => [entry.kind, entry.byName, entry.reasonCode ?? entry.payoutVersion ?? entry.approvalStepId]), [
      ['SENT_BACK', 'วราภรณ์ การเงิน', 'ACCOUNT_NUMBER_WRONG'], ['ACCOUNT_SUBMITTED', 'สมชาย พนักงาน', 2], ['REAPPROVED', 'สมศรี ผู้จัดการ', stepTwo!.id],
    ]);
    // A paid claim is not sent back: its payment is voided first.
    await assert.rejects(() => round(0).sendBack.execute(finance(), claim.requestId, { reasonCode: 'OTHER' }), conflict('payout_correction_not_allowed'));
  });

  // AC25: a send-back and a payment take the same two locks in the same order.
  it('lets a send-back and a payment of one claim race to one result: the other is told the claim changed', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const sendBackOn = async (index: number, claim: { requestId: string }, onPersisted: () => Promise<void> = async () => undefined) => {
      const read = (await repos[index]!.findRequestById(companyId, claim.requestId))!;
      return repos[index]!.requestPayoutCorrectionAtomic({
        companyId, requestId: claim.requestId, expectedUpdatedAt: read.updatedAt, actorUserId: FIN, actorRoles: ['FINANCE'], scopes: {}, allowSelfApproval: false,
        requestedAt: new Date(), reasonCode: 'ACCOUNT_NUMBER_WRONG', onPersisted,
      });
    };
    const pause = () => new Promise((resolve) => setTimeout(resolve, 400));

    // The payment holds both locks; a send-back started meanwhile waits for it, then finds the claim paid.
    const paidFirst = await approvedTransferClaim();
    let sendBack!: Promise<unknown>;
    let sendBackSettled = false;
    const payment = await repos[0]!.recordPaymentAtomic({
      ...await transferInto(paidFirst, 'race-paid-first', 1),
      onPaymentPersisted: async () => {
        sendBack = sendBackOn(1, paidFirst).finally(() => { sendBackSettled = true; });
        sendBack.catch(() => undefined);
        await pause();
        assert.equal(sendBackSettled, false, 'the send-back waits on the lock the payment holds, it does not write beside it');
      },
    });
    assert.equal(payment.request.status, 'PAID');
    await assert.rejects(sendBack, conflict('reimbursement_changed'));
    const paidRow = await claimRow(paidFirst.requestId);
    assert.deepEqual([paidRow.status, paidRow.payoutCorrectionRequestedAt, (await stepsOf(paidFirst.requestId)).map((step) => step.invalidatedAt)], ['PAID', null, [null]]);
    assert.equal(await clients[0]!.reimbursementPayment.count({ where: { reimbursementRequestId: paidFirst.requestId, status: 'RECORDED' } }), 1);

    // The send-back holds both locks; a payment started meanwhile waits for it, and is taken back when it writes.
    const sentBackFirst = await approvedTransferClaim();
    const input = await transferInto(sentBackFirst, 'race-sent-back-first', 1);
    let late!: Promise<unknown>;
    let lateSettled = false;
    await sendBackOn(1, sentBackFirst, async () => {
      late = repos[0]!.recordPaymentAtomic(input).finally(() => { lateSettled = true; });
      late.catch(() => undefined);
      await pause();
      assert.equal(lateSettled, false, 'the payment waits on the lock the send-back holds');
    });
    // Whether its snapshot was taken before or after the send-back committed, the payer is told to look again.
    await assert.rejects(late, (error: any) => error?.getStatus?.() === 409
      && ['reimbursement_payment_state_changed', 'payout_correction_in_progress'].includes(errorCode(error) ?? errorMessage(error) ?? error.message));
    const sentBackRow = await claimRow(sentBackFirst.requestId);
    assert.deepEqual([sentBackRow.status, sentBackRow.paymentStatus, sentBackRow.payoutCorrectionRequestedAt !== null], ['PENDING_APPROVAL', 'NOT_PAYABLE', true]);
    assert.equal(await clients[0]!.reimbursementPayment.count({ where: { reimbursementRequestId: sentBackFirst.requestId } }), 0);
    assert.equal(await clients[0]!.attachmentLink.count({ where: { companyId, attachmentId: input.slipAttachmentId } }), 0, 'no slip link without its payment');
    // The retry the answer asks for is refused by name, with a payment number of its own or the same.
    await assert.rejects(() => repos[0]!.recordPaymentAtomic(input), conflict('payout_correction_in_progress'));
    await assert.rejects(async () => repos[0]!.recordPaymentAtomic(await transferInto(sentBackFirst, 'race-retry', 1)), conflict('payout_correction_in_progress'));

    // Two people send the same claim back at the same moment: one round, and the other looks again.
    const twice = await approvedTransferClaim();
    const results = await Promise.allSettled([sendBackOn(0, twice), sendBackOn(1, twice)]);
    assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
    const loser = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(conflict('reimbursement_changed')(loser.reason) || conflict('payout_correction_in_progress')(loser.reason));
    assert.equal(((await claimRow(twice.requestId)).payoutCorrectionLogJson as any[]).length, 1);
  });

  it('approves the corrected account all or nothing: a refusal leaves the step, the account and the claim as they were', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const claim = await claimWithANewAccount(2);
    const standing = async () => {
      const row = await claimRow(claim.requestId);
      return {
        claim: [row.status, row.paymentStatus, row.approvedAt, row.currentApprovalStepId, row.payoutCorrectionSubmittedAt !== null, row.updatedAt.getTime(), (row.payoutCorrectionLogJson as any[]).length],
        steps: (await stepsOf(claim.requestId)).map((step) => [step.id, step.status, step.decisionByUserId, step.decidedAt]),
        accounts: (await accountVersionsOf(claim.requestId)).map((account) => [account.version, account.verifiedByUserId, account.verifiedAt?.getTime() ?? null, account.approvalStepId]),
        ready: (await eventsOf(claim.requestId)).filter((event) => event.eventType === 'reimbursement.ready_for_payment').length,
        expenses: await leftAloneByARound(claim),
      };
    };
    const before = await standing();
    const pending = (await repos[0]!.findRequestById(companyId, claim.requestId))!;
    const approve = (overrides: Record<string, unknown> = {}) => repos[0]!.approvePayoutCorrectionAtomic({
      companyId, requestId: claim.requestId, expectedUpdatedAt: pending.updatedAt, expectedApprovalSnapshotHash: pending.approvalSnapshotHash ?? undefined,
      actorUserId: MGR, actorRoles: ['MANAGER'], scopes: {}, allowSelfApproval: false, decidedAt: new Date(), payoutVerifiedVersion: 2,
      onApprovedPersisted: async (tx: any, approvalStepId: string) => { await tx.outboxEvent.createMany({ data: [{
        companyId, eventType: 'reimbursement.ready_for_payment', aggregateType: 'reimbursement_request', aggregateId: claim.requestId,
        eventKey: `reimbursement.ready_for_payment:reimbursement_request:${claim.requestId}:${approvalStepId}`, payloadJson: {}, priority: 'NORMAL', status: 'PENDING',
      }] }); },
      ...overrides,
    });

    // Refused before anything is written.
    await assert.rejects(() => approve({ payoutVerifiedVersion: undefined }), conflict('payout_verification_required'));
    await assert.rejects(() => approve({ payoutVerifiedVersion: 1 }), conflict('payout_destination_changed'));
    await assert.rejects(() => approve({ expectedApprovalSnapshotHash: 'a'.repeat(32) }), conflict('stale_approval_snapshot'));
    await assert.rejects(() => approve({ expectedUpdatedAt: new Date(pending.updatedAt.getTime() - 1) }), conflict('stale_approval_snapshot'));
    await assert.rejects(() => approve({ actorUserId: FIN, actorRoles: ['FINANCE'] }), (error: any) => error?.getStatus?.() === 403);
    await assert.rejects(() => approve({ actorUserId: STAFF, actorRoles: ['MANAGER'] }), (error: any) => error?.getStatus?.() === 403, 'the requester, by the self-approval rule or the step');
    assert.deepEqual(await standing(), before);

    // Refused after the step was decided and the account attested, inside the transaction: an expense record
    // of the claim no longer matches its line. Everything the transaction had written is taken back.
    const [expenseId] = claim.expenseIds;
    await db.$executeRaw`UPDATE "ExpenseRecord" SET "grandTotalAmount" = "grandTotalAmount" + 1 WHERE "id" = ${expenseId}`;
    await assert.rejects(() => approve(), conflict('reimbursement_projection_source_mismatch'));
    await db.$executeRaw`UPDATE "ExpenseRecord" SET "grandTotalAmount" = "grandTotalAmount" - 1 WHERE "id" = ${expenseId}`;
    assert.deepEqual(await standing(), before);

    // Refused at the very end: the ready-to-pay event could not be written. Still nothing of it stays.
    await assert.rejects(() => approve({ onApprovedPersisted: async () => { throw new Error('event_write_failed'); } }), /event_write_failed/);
    assert.deepEqual(await standing(), before);

    // Whole: the step, the attestation, the claim and the event, together.
    const approved = await approve();
    const after = await standing();
    const [, newStep] = await stepsOf(claim.requestId);
    assert.deepEqual([approved.status, after.claim.slice(0, 2), after.claim[3], after.claim[4], after.ready - before.ready], ['READY_FOR_PAYMENT', ['READY_FOR_PAYMENT', 'UNPAID'], null, false, 1]);
    assert.deepEqual([newStep!.status, newStep!.decisionByUserId, after.accounts[1]!.slice(0, 2), after.accounts[1]![3]], ['APPROVED', MGR, [2, MGR], newStep!.id]);
    assert.deepEqual(after.expenses, before.expenses);
    // A second press finds nothing to approve.
    await assert.rejects(() => approve(), conflict('stale_approval_snapshot'));
    assert.deepEqual(await standing(), after);
  });

  it('never rejects, reopens or decides the old way a claim in a round, nor any claim whose expense records stand', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const noop = async () => undefined;
    const attempts = (request: { id: string; updatedAt: Date; approvalSnapshotHash?: string | null }) => ({
      reject: () => repos[0]!.rejectRequestAtomic({ companyId, requestId: request.id, expectedUpdatedAt: request.updatedAt, actorUserId: MGR, actorRoles: ['MANAGER'], scopes: {},
        allowSelfApproval: false, decidedAt: new Date(), rejectionReason: 'ไม่อนุมัติ', request: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: 'ไม่อนุมัติ' }, onRejectedPersisted: noop }),
      withdraw: () => repos[0]!.reopenRejectedRequest(companyId, request.id, request.updatedAt, STAFF, 'PENDING_APPROVAL'),
      reopen: () => repos[0]!.reopenRejectedRequest(companyId, request.id, request.updatedAt, STAFF, 'REJECTED'),
      decide: () => repos[0]!.beginApprovalDecisionAtomic({ companyId, requestId: request.id, expectedUpdatedAt: request.updatedAt, expectedApprovalSnapshotHash: request.approvalSnapshotHash ?? undefined,
        actorUserId: MGR, actorRoles: ['MANAGER'], scopes: {}, allowSelfApproval: false, financeReviewRequired: false, decidedAt: new Date(), financeRequestPatch: {},
        onDecisionPersisted: noop, payoutVerifiedVersion: 2 }),
    });

    for (const phase of ['with its requester', 'with its approver'] as const) {
      const claim = await approvedTransferClaim();
      await round(0).sendBack.execute(finance(), claim.requestId, { reasonCode: 'BANK_WRONG' });
      if (phase === 'with its approver') await round(0).giveAccount.execute(requesterWhoEdits(), claim.requestId, { mode: 'SPECIFIED', ...SCB_ACCOUNT });
      const before = await leftAloneByARound(claim);
      const standing = await claimRow(claim.requestId);
      const request = (await repos[0]!.findRequestById(companyId, claim.requestId))!;
      for (const [name, attempt] of Object.entries(attempts(request))) {
        await assert.rejects(attempt, conflict('payout_correction_in_progress'), `${phase}: ${name}`);
      }
      await assert.rejects(async () => repos[0]!.recordPaymentAtomic(await transferInto(claim, `guard-${phase}`, request.payoutDestinationVersion!)), conflict('payout_correction_in_progress'), phase);
      // The web's own doors answer the same.
      await assert.rejects(() => round(0).approve.execute(manager(), claim.requestId, undefined, 'a'.repeat(32), 1), (error: any) => error?.getStatus?.() === 409, phase);
      const unchanged = await claimRow(claim.requestId);
      assert.deepEqual([unchanged.status, unchanged.updatedAt.getTime(), (await stepsOf(claim.requestId)).map((step) => step.status)],
        [standing.status, standing.updatedAt.getTime(), phase === 'with its requester' ? ['APPROVED'] : ['APPROVED', 'PENDING']], phase);
      assert.deepEqual(await leftAloneByARound(claim), before, phase);

      // Were the round's own columns ever lost, the claim's expense records alone keep it from REJECTED and from DRAFT.
      if (phase === 'with its approver') {
        await db.reimbursementRequest.update({ where: { id: claim.requestId }, data: { payoutCorrectionRequestedAt: null, payoutCorrectionSubmittedAt: null } });
        const bare = (await repos[0]!.findRequestById(companyId, claim.requestId))!;
        for (const name of ['reject', 'withdraw'] as const) {
          await assert.rejects(attempts(bare)[name], conflict('reimbursement_correction_has_projection'), name);
        }
        const kept = await claimRow(claim.requestId);
        assert.deepEqual([kept.status, (await db.expenseRecord.findMany({ where: { id: { in: claim.expenseIds } } })).map((expense) => expense.status)], ['PENDING_APPROVAL', ['CONFIRMED']]);
      }
    }
  });

  it('removes the signatures and stops counting the declared scan when the claim is sent back, and takes new ones for the new account', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const claim = await approvedTransferClaim();
    const signaturesOf = () => db.reimbursementClaimSignature.findMany({ where: { reimbursementRequestId: claim.requestId }, orderBy: { role: 'asc' } });
    const sign = async (role: 'REQUESTER' | 'APPROVER', userId: string) => repos[0]!.upsertClaimSignature({
      companyId, reimbursementRequestId: claim.requestId, role, signatureAttachmentId: `${S}-signature-${userId}`, signedByUserId: userId, signedAt: new Date(),
      seen: (await repos[0]!.findRequestById(companyId, claim.requestId))! });
    let scans = 0;
    const scan = async () => (await db.attachmentObject.create({ data: {
      companyId, branchId, storageProvider: 'LOCAL', bucket: 'test', objectKey: `${S}/signed-scan-${claim.requestId}-${++scans}`, originalFileName: `signed-${scans}.pdf`,
      mimeType: 'application/pdf', byteSize: 90_000, checksumSha256: 'c'.repeat(64), uploadedByUserId: STAFF, status: 'ACTIVE', metadataJson: { source: 'web' },
    } })).id;
    const declare = (attachmentId: string, version: number | null) => repos[0]!.linkSignedClaimFormCopy(companyId, claim.requestId, attachmentId, STAFF, {
      requestId: claim.requestId, requestNo: claim.requestNo, acknowledgedByUserId: STAFF, acknowledgedAt: new Date().toISOString(), checksumSha256: 'c'.repeat(64), payoutDestinationVersion: version,
    });
    const copies = async () => (await repos[0]!.listSignedClaimFormCopies(companyId, claim.requestId)).map((copy) => [copy.attachmentId, copy.acknowledged, copy.beforePayoutCorrection ?? false]);
    const signedVia = async () => (await on(0).detail.execute(finance(), claim.requestId)).documentSignedVia;

    // Signed in the system by its requester and its approver, and a scan of the paper declared as signed.
    await sign('REQUESTER', STAFF);
    await sign('APPROVER', MGR);
    const declared = await scan();
    const archived = await scan();
    await declare(declared, 1);
    await repos[0]!.linkSignedClaimFormCopy(companyId, claim.requestId, archived, STAFF);
    assert.deepEqual([(await signaturesOf()).length, (await copies()).sort(), await signedVia()], [2, [[archived, false, false], [declared, true, false]].sort(), 'BOTH']);

    const sentBack = await round(0).sendBack.execute(finance(), claim.requestId, { reasonCode: 'ACCOUNT_NAME_MISMATCH' });
    // Both signatures were on a form that printed the account now in question: gone, in the send-back's own transaction.
    assert.deepEqual(await signaturesOf(), []);
    // The scan is still filed with the claim and can be opened; it no longer says the claim is signed.
    assert.deepEqual((await copies()).sort(), [[archived, false, false], [declared, false, true]].sort());
    assert.deepEqual([sentBack.documentSignedVia, sentBack.signedCopies?.find((copy) => copy.attachmentId === declared)?.beforePayoutCorrection], [null, true]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { companyId, targetId: claim.requestId, action: 'reimbursement.payout_correction.request' }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual([(audit.metadataJson as any).signaturesRemoved, (audit.metadataJson as any).declarationsSetAside], [2, 1]);

    // During the round nobody has a block to sign and no scan can be declared; filing one without the declaration still works.
    const inRound = (await repos[0]!.findRequestById(companyId, claim.requestId, true))!;
    assert.deepEqual([eligibleClaimSignatureRoles(inRound, STAFF), eligibleClaimSignatureRoles(inRound, MGR)], [[], []]);
    const during = await scan();
    await assert.rejects(() => declare(during, 1), conflict('payout_correction_in_progress'));
    assert.equal(await db.attachmentLink.count({ where: { attachmentId: during } }), 0, 'refused whole: no link without its declaration');
    await repos[0]!.linkSignedClaimFormCopy(companyId, claim.requestId, during, STAFF);

    await round(0).giveAccount.execute(requesterWhoEdits(), claim.requestId, { mode: 'SPECIFIED', ...SCB_ACCOUNT });
    await assert.rejects(() => declare(during, 2), conflict('payout_correction_in_progress'));
    const shown = await on(0).detail.execute(manager(), claim.requestId);
    await round(0).approve.execute(manager(), claim.requestId, undefined, shown.approvalSnapshotHash, 2);

    // Approved again: still nothing of before counts, and the form for the new account is signed anew.
    assert.deepEqual([await signaturesOf(), await signedVia(), (await copies()).find(([id]) => id === declared)], [[], null, [declared, false, true]]);
    const approvedAgain = (await repos[0]!.findRequestById(companyId, claim.requestId, true))!;
    assert.deepEqual([eligibleClaimSignatureRoles(approvedAgain, STAFF), eligibleClaimSignatureRoles(approvedAgain, MGR)], [['REQUESTER'], ['APPROVER']]);
    await declare(during, 2);
    assert.deepEqual([(await copies()).filter(([, acknowledged]) => acknowledged).map(([id]) => id), await signedVia()], [[during], 'PAPER']);
    const stored = await db.attachmentObject.findUniqueOrThrow({ where: { id: during } });
    assert.equal((stored.metadataJson as any).reimbursementSignedCopyAck.payoutDestinationVersion, 2);
  });

  // Final review S1: a signature is written under the claim's lock, onto the claim its signer was shown.
  it('never leaves a signature on a claim sent back or withdrawn while it was being signed, whichever of the two commits first', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('signature')]);
    const pause = () => new Promise((resolve) => setTimeout(resolve, 400));
    const signaturesOf = (requestId: string) => db.reimbursementClaimSignature.count({ where: { reimbursementRequestId: requestId } });
    let images = 0;
    const image = async (requestId: string, role: 'REQUESTER' | 'APPROVER', userId: string) => (await db.attachmentObject.create({ data: {
      companyId, branchId, storageProvider: 'LOCAL', bucket: 'test', objectKey: `${S}/signature-${requestId}-${++images}`, originalFileName: 'signature.png',
      mimeType: 'image/png', byteSize: PNG.length, uploadedByUserId: userId, status: 'ACTIVE', metadataJson: { generatedFor: 'reimbursement_claim_signature', requestId, role },
    } })).id;
    /** The sign call as the web makes it. `during` runs while the signature image is fetched: after every check, before the write. */
    const signWhile = async (ctx: any, requestId: string, role: 'REQUESTER' | 'APPROVER', during: () => Promise<unknown>) => {
      const shown = (await repos[0]!.findRequestById(companyId, requestId, true))!;
      const storage = { getObject: async () => { await during(); return { bytes: PNG }; } } as any;
      return new SignClaimFormUseCase(repos[0]!, storage, { log: async () => undefined } as any)
        .execute(ctx, requestId, { role, signatureAttachmentId: await image(requestId, role, ctx.userId), snapshotHash: claimSignatureAckHash(shown) });
    };
    /** The signature row alone, written on `repo` for a claim read just now. */
    const write = async (repo: PrismaReimbursementRepository, requestId: string) => repo.upsertClaimSignature({
      companyId, reimbursementRequestId: requestId, role: 'REQUESTER', signatureAttachmentId: `${S}-signature-${requestId}`, signedByUserId: STAFF, signedAt: new Date(),
      seen: (await repos[0]!.findRequestById(companyId, requestId))! });
    /** A repository whose next transaction runs `between` right after its first statement: while it holds the lock that statement took. */
    const holdingItsLock = (between: () => Promise<unknown>) => new PrismaReimbursementRepository({ client: new Proxy(clients[0]!, { get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property);
      return (work: (tx: any) => Promise<unknown>, options: any) => target.$transaction((tx: any) => {
        let fired = false;
        return work(new Proxy(tx, { get(inner, name) {
          const value = Reflect.get(inner, name);
          if (name !== '$executeRaw') return typeof value === 'function' ? value.bind(inner) : value;
          return async (...args: unknown[]) => {
            const result = await value.apply(inner, args);
            if (!fired) { fired = true; await between(); }
            return result;
          };
        } }));
      }, { ...options, timeout: 20_000 });
    } }) } as any, new PrismaDocumentSequenceRepository({ client: clients[0]! } as any));

    // The send-back commits while the signature is being made: the requester's, and the approver's, are both refused.
    for (const [role, signer] of [['REQUESTER', requester()], ['APPROVER', manager()]] as const) {
      const claim = await approvedTransferClaim();
      await assert.rejects(() => signWhile(signer, claim.requestId, role,
        () => round(1).sendBack.execute(finance(), claim.requestId, { reasonCode: 'ACCOUNT_NUMBER_WRONG' })), conflict('stale_claim_snapshot'), role);
      assert.deepEqual([await signaturesOf(claim.requestId), (await claimRow(claim.requestId)).payoutCorrectionRequestedAt !== null], [0, true], role);
    }

    // The send-back holds the claim's lock when the signature arrives: the signature waits for it, then finds another claim.
    const sentBackFirst = await approvedTransferClaim();
    const before = (await repos[1]!.findRequestById(companyId, sentBackFirst.requestId))!;
    let late!: Promise<unknown>;
    let lateSettled = false;
    await repos[1]!.requestPayoutCorrectionAtomic({
      companyId, requestId: sentBackFirst.requestId, expectedUpdatedAt: before.updatedAt, actorUserId: FIN, actorRoles: ['FINANCE'], scopes: {}, allowSelfApproval: false,
      requestedAt: new Date(), reasonCode: 'ACCOUNT_NUMBER_WRONG',
      onPersisted: async () => {
        late = write(repos[0]!, sentBackFirst.requestId).finally(() => { lateSettled = true; });
        late.catch(() => undefined);
        await pause();
        assert.equal(lateSettled, false, 'the signature waits on the lock the send-back holds, it does not write beside it');
      },
    });
    await assert.rejects(late, conflict('stale_claim_snapshot'));
    assert.equal(await signaturesOf(sentBackFirst.requestId), 0);

    // The signature holds the claim's lock when the send-back arrives: the send-back waits for it, then removes it.
    const signedFirst = await approvedTransferClaim();
    let sendBack: Promise<unknown> | undefined;
    let sendBackSettled = false;
    await write(holdingItsLock(async () => {
      sendBack = round(1).sendBack.execute(finance(), signedFirst.requestId, { reasonCode: 'BANK_WRONG' }).finally(() => { sendBackSettled = true; });
      sendBack.catch(() => undefined);
      await pause();
      assert.equal(sendBackSettled, false, 'the send-back waits on the lock the signature holds');
    }), signedFirst.requestId);
    assert.ok(sendBack, 'the signature was written inside a transaction that took the claim lock');
    await sendBack;
    assert.deepEqual([await signaturesOf(signedFirst.requestId), (await claimRow(signedFirst.requestId)).payoutCorrectionRequestedAt !== null], [0, true]);

    // The same against a withdrawal to draft, which removes the claim's signatures too.
    const withdrawn = await waitingClaim();
    await assert.rejects(() => signWhile(requester(), withdrawn.id, 'REQUESTER',
      () => repos[1]!.reopenRejectedRequest(companyId, withdrawn.id, withdrawn.updatedAt, STAFF, 'PENDING_APPROVAL')), conflict('stale_claim_snapshot'));
    assert.deepEqual([await signaturesOf(withdrawn.id), (await claimRow(withdrawn.id)).status], [0, 'DRAFT']);
    const signedThenWithdrawn = await waitingClaim();
    assert.equal((await signWhile(requester(), signedThenWithdrawn.id, 'REQUESTER', async () => undefined)).role, 'REQUESTER');
    assert.equal(await signaturesOf(signedThenWithdrawn.id), 1);
    await repos[1]!.reopenRejectedRequest(companyId, signedThenWithdrawn.id, signedThenWithdrawn.updatedAt, STAFF, 'PENDING_APPROVAL');
    assert.deepEqual([await signaturesOf(signedThenWithdrawn.id), (await claimRow(signedThenWithdrawn.id)).status], [0, 'DRAFT']);
  });

  // Final review S4: a build from before the correction round neither reads nor clears the round's columns.
  it('sends a claim clear of a correction round an older build left on its row', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    // As a rollback leaves it: in a round under this build, returned to draft by the build before it,
    // which resets what it knows of and leaves the rest.
    const waiting = await waitingClaim();
    await repos[0]!.reopenRejectedRequest(companyId, waiting.id, waiting.updatedAt, STAFF, 'PENDING_APPROVAL');
    const history = [{ kind: 'SENT_BACK', at: day.toISOString(), byUserId: FIN, reasonCode: 'ACCOUNT_NUMBER_WRONG' }];
    await db.reimbursementRequest.update({ where: { id: waiting.id }, data: {
      payoutCorrectionRequestedAt: day, payoutCorrectionRequestedByUserId: FIN, payoutCorrectionReasonCode: 'ACCOUNT_NUMBER_WRONG',
      payoutCorrectionNote: 'จากรอบก่อน rollback', payoutCorrectionSubmittedAt: day, payoutCorrectionLogJson: history,
    } });
    const draft = (await repos[0]!.findRequestById(companyId, waiting.id))!;
    assert.deepEqual([draft.status, draft.payoutCorrectionRequestedAt, draft.payoutCorrectionSubmittedAt], ['DRAFT', day, day]);

    const requestSnapshotHash = computeSnapshotHash(claimSnapshotFields(draft));
    await repos[0]!.submitDraftAtomic({
      companyId, requestId: draft.id, expectedUpdatedAt: draft.updatedAt, duplicateCandidates: [], evidence: { attachmentIds: [], expenseIds: [] },
      documentNumber: { documentType: 'reimbursement.request', periodKey, idempotencyKey: `reimb-submit:${draft.id}`, reservedByUserId: STAFF },
      approvalStep: { sequenceNo: 1, approverUserId: MGR, approverRoleSnapshot: 'MANAGER', requestSnapshotHash },
      request: { status: 'PENDING_APPROVAL', submittedAt: new Date(), submittedByUserId: STAFF, outstandingAmount: draft.amount, updatedByUserId: STAFF, approvalSnapshotHash: requestSnapshotHash },
    } as any);

    // Sent, and in no round: the five columns are written as empty by the submit itself. What happened stays on record.
    const sent = await claimRow(waiting.id);
    assert.deepEqual([sent.status, sent.payoutCorrectionRequestedAt, sent.payoutCorrectionRequestedByUserId, sent.payoutCorrectionReasonCode, sent.payoutCorrectionNote, sent.payoutCorrectionSubmittedAt, sent.payoutCorrectionLogJson],
      ['PENDING_APPROVAL', null, null, null, null, null, history]);
    // So it is an ordinary claim waiting for its approver, for every reader and every call.
    const shown = await on(0).detail.execute(manager(), waiting.id);
    assert.deepEqual([shown.payoutCorrectionPhase, shown.payoutCorrection, shown.currentDesk?.kind, shown.approvalActions], [undefined, undefined, 'APPROVER', { canApprove: true, canReject: true }]);
    const pending = (await repos[0]!.findRequestById(companyId, waiting.id))!;
    const decision = await repos[0]!.beginApprovalDecisionAtomic({
      companyId, requestId: pending.id, expectedUpdatedAt: pending.updatedAt, expectedApprovalSnapshotHash: pending.approvalSnapshotHash,
      actorUserId: MGR, actorRoles: ['MANAGER'], scopes: {}, allowSelfApproval: false, financeReviewRequired: false,
      decidedAt: new Date(), financeRequestPatch: {}, onDecisionPersisted: async () => undefined,
    });
    assert.equal(decision.resumed, false);
  });

  // Final review S2: the step of a round keeps only those of the old step's people who are on today's approval route.
  it('asks only who is still on the approval route to approve a corrected account: a demoted approver cannot, and the owner can when nobody else is left', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    /** The claim's step as a submit freezes it: the people the route named that day. */
    const frozenClaim = async () => {
      const claim = await approvedTransferClaim();
      await db.reimbursementApprovalStep.updateMany({ where: { reimbursementRequestId: claim.requestId }, data: { assignedApproverUserIdsJson: [MGR] } });
      await round(0).sendBack.execute(finance(), claim.requestId, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
      return claim;
    };
    const asked = async (requestId: string) => ((await eventsOf(requestId)).filter((event) => event.eventType === 'reimbursement.payout_correction_submitted').at(-1)!.payloadJson as any).data.approverRecipientUserIds;
    const forbidden = (error: any) => error?.getStatus?.() === 403;

    const ownerMembership = await db.companyMembership.create({ data: { companyId, userId: OWNER, status: 'ACTIVE' }, select: { id: true } });
    const ownerRole = await db.role.create({ data: {
      companyId, scopeKey: companyId, key: 'OWNER', name: 'เจ้าของ', permissions: { create: approverPermissionIds.map((permissionId) => ({ permissionId })) },
    }, select: { id: true } });
    await db.membershipRole.create({ data: { membershipId: ownerMembership.id, roleId: ownerRole.id } });
    const owner = () => ({ ...manager(), userId: OWNER, roles: ['OWNER'] });
    try {
      // Still holding the role: the same approver is asked again, by name, and approves.
      const kept = await frozenClaim();
      await round(0).giveAccount.execute(requesterWhoEdits(), kept.requestId, { mode: 'SPECIFIED', ...SCB_ACCOUNT });
      const [, keptStep] = await stepsOf(kept.requestId);
      assert.deepEqual([keptStep!.status, keptStep!.approverUserId, keptStep!.assignedApproverUserIdsJson, await asked(kept.requestId)], ['PENDING', MGR, [MGR], [MGR]]);
      const shownToManager = await on(0).detail.execute(manager(), kept.requestId);
      assert.equal((await round(0).approve.execute(manager(), kept.requestId, undefined, shownToManager.approvalSnapshotHash, 2)).status, 'READY_FOR_PAYMENT');

      // Moved to a staff role after approving the claim: still an active member of the branch, no approve right.
      const claim = await frozenClaim();
      await db.membershipRole.delete({ where: { membershipId_roleId: { membershipId: managerMembershipId, roleId: managerRoleId } } });
      const demoted = () => ({ ...manager(), roles: ['STAFF'], permissions: ['reimbursement.read'] });
      await round(0).giveAccount.execute(requesterWhoEdits(), claim.requestId, { mode: 'SPECIFIED', ...SCB_ACCOUNT });
      const [, step] = await stepsOf(claim.requestId);
      // The new step names nobody, and its notice asks the owner, whom the route falls to today.
      assert.deepEqual([step!.status, step!.approverUserId, step!.assignedApproverUserIdsJson, step!.approverRoleSnapshot, await asked(claim.requestId)],
        ['PENDING', null, null, 'MANAGER', [OWNER]]);
      assert.equal((await claimRow(claim.requestId)).currentApproverUserId, null);

      // The demoted manager is offered nothing and is refused, by the use case and by the repository under the claim's lock.
      const shownToDemoted = await on(0).detail.execute(demoted(), claim.requestId);
      assert.deepEqual([shownToDemoted.approvalActions, shownToDemoted.currentDesk], [{ canApprove: false, canReject: false }, { kind: 'APPROVER' }]);
      await assert.rejects(() => round(0).approve.execute(demoted(), claim.requestId, undefined, shownToDemoted.approvalSnapshotHash, 2), forbidden);
      await assert.rejects(() => round(0).reject.execute(demoted(), claim.requestId, 'ไม่อนุมัติ'), forbidden);
      const pending = (await repos[0]!.findRequestById(companyId, claim.requestId))!;
      await assert.rejects(() => repos[0]!.approvePayoutCorrectionAtomic({
        companyId, requestId: claim.requestId, expectedUpdatedAt: pending.updatedAt, expectedApprovalSnapshotHash: pending.approvalSnapshotHash ?? undefined,
        actorUserId: MGR, actorRoles: ['STAFF'], scopes: {}, allowSelfApproval: false, decidedAt: new Date(), payoutVerifiedVersion: 2, onApprovedPersisted: async () => undefined,
      }), forbidden);
      assert.deepEqual([(await claimRow(claim.requestId)).status, (await stepsOf(claim.requestId)).map((row) => row.status)], ['PENDING_APPROVAL', ['APPROVED', 'PENDING']]);

      // The owner is not refused as "not the assigned approver": nobody is assigned any more.
      const shownToOwner = await on(0).detail.execute(owner(), claim.requestId);
      assert.deepEqual(shownToOwner.approvalActions, { canApprove: true, canReject: true });
      const approved = await round(0).approve.execute(owner(), claim.requestId, undefined, shownToOwner.approvalSnapshotHash, 2);
      const [, decided] = await stepsOf(claim.requestId);
      assert.deepEqual([approved.status, decided!.status, decided!.decisionByUserId, (await accountVersionsOf(claim.requestId)).map((row) => [row.version, row.verifiedByUserId])],
        ['READY_FOR_PAYMENT', 'APPROVED', OWNER, [[1, MGR], [2, OWNER]]]);
    } finally {
      await db.membershipRole.createMany({ data: [{ membershipId: managerMembershipId, roleId: managerRoleId }], skipDuplicates: true });
      await db.role.delete({ where: { id: ownerRole.id } });
      await db.companyMembership.delete({ where: { id: ownerMembership.id } });
    }
  });

  // Final review W6: the requester left after the claim was approved, and the claim was sent back by mistake.
  it('gives a claim the account it had back for a requester who is no longer active: the same sealed account as a new version, approved again', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const db = clients[0]!;
    const claim = await approvedTransferClaim();
    await round(0).sendBack.execute(finance(), claim.requestId, { reasonCode: 'OTHER', note: 'ส่งกลับผิดใบ' });
    const membership = { companyId_userId: { companyId, userId: STAFF } };
    await db.companyMembership.update({ where: membership, data: { status: 'DISABLED' } });
    try {
      // Nobody types an account for a member no notice can reach, in a round as on a draft.
      await assert.rejects(() => round(0).giveAccount.execute(finance(), claim.requestId, { mode: 'SPECIFIED', ...SCB_ACCOUNT }), conflict('payout_account_member_not_active'));
      assert.deepEqual([(await accountVersionsOf(claim.requestId)).length, (await claimRow(claim.requestId)).payoutCorrectionSubmittedAt], [1, null]);

      const given = await round(0).giveAccount.execute(finance(), claim.requestId, { mode: 'PREVIOUS' });
      assert.deepEqual([given.payoutCorrection?.phase, given.payout?.version, given.payout?.accountLast4], ['AWAITING_APPROVAL', 2, '5678']);
      const [first, second] = await accountVersionsOf(claim.requestId);
      // The sealed columns moved as one unit into a frozen version of its own; the first is as it was.
      assert.deepEqual([second!.version, second!.accountNumberEncrypted, second!.accountLast4, second!.fingerprint, second!.source, second!.createdByUserId, second!.frozenAt !== null, second!.verifiedByUserId],
        [2, first!.accountNumberEncrypted, first!.accountLast4, first!.fingerprint, first!.source, first!.createdByUserId, true, null]);
      assert.equal(openPayoutAccountNumber(second!.accountNumberEncrypted, roundKey), '0012345678');
      assert.deepEqual([first!.version, first!.verifiedByUserId], [1, MGR]);
      const row = await claimRow(claim.requestId);
      assert.deepEqual([row.payoutMethod, row.payoutDestinationVersion, row.payoutFingerprint], ['BANK_TRANSFER', 2, first!.fingerprint]);

      // Approved again like any other answer, by the approver who checks version 2.
      const shown = await on(0).detail.execute(manager(), claim.requestId);
      assert.equal((await round(0).approve.execute(manager(), claim.requestId, undefined, shown.approvalSnapshotHash, 2)).status, 'READY_FOR_PAYMENT');
      assert.deepEqual((await accountVersionsOf(claim.requestId)).map((account) => [account.version, account.verifiedByUserId]), [[1, MGR], [2, MGR]]);
    } finally {
      await db.companyMembership.update({ where: membership, data: { status: 'ACTIVE' } });
    }
  });

  it('still cancels a claim in a round by the rule every claim is cancelled by: its records are voided and it closes', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    for (const phase of ['with its requester', 'with its approver'] as const) {
      const claim = phase === 'with its requester' ? await approvedTransferClaim() : await claimWithANewAccount();
      if (phase === 'with its requester') await round(0).sendBack.execute(finance(), claim.requestId, { reasonCode: 'REQUESTER_ASKED' });
      const cancelled = await on(0).cancel.execute(requester(), claim.requestId, 'ยกเลิกเพราะบัญชีรับเงินไม่ถูกต้อง');
      assert.equal(cancelled.status, 'CANCELLED', phase);
      const rows = await stored(claim);
      assert.deepEqual([rows.status, rows.expenses, rows.reversals, rows.cancelledEvents], ['CANCELLED', ['VOIDED'], 1, 1], phase);
      assert.deepEqual((await stepsOf(claim.requestId)).map((step) => step.status).sort(), phase === 'with its requester' ? ['APPROVED'] : ['APPROVED', 'CANCELLED'], phase);
      // It is in no round any more, for any reader or call.
      const detail = await on(0).detail.execute(finance(), claim.requestId);
      assert.deepEqual([detail.payoutCorrection, detail.payoutCorrectionPhase, detail.payoutCorrectionActions, detail.currentDesk], [undefined, undefined, undefined, undefined], phase);
      await assert.rejects(() => round(0).giveAccount.execute(requesterWhoEdits(), claim.requestId, { mode: 'CASH' }), conflict('payout_correction_not_requested'), phase);
    }

    // A cancellation that was started stops the round's own calls until it is finished or withdrawn.
    const claim = await approvedTransferClaim();
    await strand(claim, 'ก');
    await assert.rejects(() => round(0).sendBack.execute(finance(), claim.requestId, { reasonCode: 'OTHER' }), conflict('reimbursement_cancellation_pending'));
    const read = (await repos[0]!.findRequestById(companyId, claim.requestId))!;
    await assert.rejects(() => repos[0]!.requestPayoutCorrectionAtomic({ companyId, requestId: claim.requestId, expectedUpdatedAt: read.updatedAt, actorUserId: FIN, actorRoles: ['FINANCE'], scopes: {},
      allowSelfApproval: false, requestedAt: new Date(), reasonCode: 'OTHER', onPersisted: async () => undefined }), conflict('reimbursement_cancellation_pending'));
    assert.deepEqual([(await claimRow(claim.requestId)).status, (await claimRow(claim.requestId)).payoutCorrectionRequestedAt], ['READY_FOR_PAYMENT', null]);
  });

  // 3B: a claim finance passed, with no approval step, sent before claims carried an account.
  it('gives a legacy claim nobody has to approve an account through a round: ready for payment at once, its finance result and its records kept', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const claim = await payableClaim();
    const first = await claimRow(claim.requestId);
    const before = await leftAloneByARound(claim);
    assert.deepEqual([first.payoutMethod, first.payoutFingerprint, first.financeReviewStatus, (await stepsOf(claim.requestId)).length], [null, null, 'APPROVED_FOR_PAYMENT', 0]);

    const sentBack = await round(0).sendBack.execute(finance(), claim.requestId, { reasonCode: 'OTHER', note: 'เพิ่มบัญชีรับเงินให้ใบนี้' });
    assert.deepEqual([sentBack.status, sentBack.payoutCorrection?.phase, sentBack.payoutCorrection?.previous, sentBack.payout, sentBack.currentDesk, sentBack.awaitingSystem],
      ['PENDING_APPROVAL', 'AWAITING_REQUESTER', undefined, undefined, { kind: 'REQUESTER' }, undefined]);
    assert.equal((await claimRow(claim.requestId)).approvalSnapshotHash, first.approvalSnapshotHash, 'sending back changes no hash');
    assert.deepEqual(ofThese([claim], await system(1).reconciler.execute()), { completed: [], failed: [], blocked: [] });

    const given = await round(0).giveAccount.execute(requesterWhoEdits(), claim.requestId, { mode: 'SPECIFIED', ...SCB_ACCOUNT });
    const after = await claimRow(claim.requestId);
    assert.deepEqual([given.status, given.payoutCorrection, given.payout?.version, given.payout?.accountLast4, given.payout?.verifiedAt ?? null],
      ['READY_FOR_PAYMENT', undefined, 1, '1112', null]);
    assert.deepEqual([after.status, after.paymentStatus, after.financeReviewStatus, after.financeReviewedByUserId, after.requestNo, after.payoutCorrectionRequestedAt, after.currentApprovalStepId],
      ['READY_FOR_PAYMENT', 'UNPAID', 'APPROVED_FOR_PAYMENT', FIN, first.requestNo, null, null]);
    assert.ok(after.approvedAt instanceof Date);
    assert.deepEqual(await leftAloneByARound(claim), before);
    // From here on the claim is hashed with its account, like any claim sent with one.
    const withAccount = (await repos[0]!.findRequestById(companyId, claim.requestId))!;
    assert.notEqual(after.approvalSnapshotHash, first.approvalSnapshotHash);
    assert.equal(after.approvalSnapshotHash, computeSnapshotHash(claimSnapshotFields(withAccount, withAccount.approvalPolicySnapshotJson)));
    assert.deepEqual((await eventsOf(claim.requestId)).map((event) => event.eventType).slice(-2), ['reimbursement.payout_correction_requested', 'reimbursement.ready_for_payment']);

    // Nobody approved the account, so whoever pays is the one to check it, and is recorded as that.
    await assert.rejects(async () => repos[0]!.recordPaymentAtomic(await transferInto({ ...claim, amount: '100.0000' }, 'legacy-unconfirmed')), conflict('payout_confirmation_required'));
    const paid = await repos[0]!.recordPaymentAtomic(await transferInto({ ...claim, amount: '100.0000' }, 'legacy-confirmed', 1));
    assert.deepEqual([paid.request.status, paid.payout?.payerVerified, (await accountVersionsOf(claim.requestId)).map((row) => [row.version, row.verifiedByUserId, row.verifiedVia])],
      ['PAID', true, [[1, FIN, 'PAYMENT']]]);
  });
});
