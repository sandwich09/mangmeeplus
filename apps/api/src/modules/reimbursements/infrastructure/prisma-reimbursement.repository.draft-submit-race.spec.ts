/** Real PostgreSQL proof that an edit and submit cannot both commit. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { MaterializeClaimExpensesService } from '../application/services/materialize-claim-expenses.service';
import { computeLegacySnapshotHashV1, computeSnapshotHash } from '../domain/logic/reimbursement.logic';
import { PrismaReimbursementRepository } from './prisma-reimbursement.repository';

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
    companyId = (await clients[0]!.company.create({
      data: { name: TAG, status: 'ACTIVE' },
      select: { id: true },
    })).id;
    repos = clients.map((client) => new PrismaReimbursementRepository(
      { client } as any,
      new PrismaDocumentSequenceRepository({ client } as any),
    ));
  });

  after(async () => {
    if (reachable) await clients[0]!.company.deleteMany({ where: { id: companyId } });
    await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
  });

  async function createDraft(suffix: string, attachmentId?: string, amount = '100.0000') {
    const request = await repos[0]!.createRequest({
      companyId,
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
});
