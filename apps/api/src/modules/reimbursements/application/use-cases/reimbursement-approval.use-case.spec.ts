import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { ApproveReimbursementUseCase, ListApprovalQueueUseCase, RejectReimbursementUseCase, approvalDecisionActions } from './reimbursement-approval.use-case';
import {
  CreateReimbursementDraftUseCase,
  SubmitReimbursementUseCase,
  UpdateReimbursementDraftUseCase,
} from './reimbursement-request.use-case';
import { RecordReimbursementPaymentUseCase } from './reimbursement-finance.use-case';
import { ListReimbursementApproverOptionsUseCase } from './reimbursement-policy.use-case';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { REIMBURSEMENT_POLICY_DEFAULTS } from '../../domain/reimbursement.constants';
import { compileRole } from '../../../employee-access/domain/logic/capability.logic';
import { fakePayoutTables } from '../../infrastructure/reimbursement-payout.fixture';
import {
  applyDraftPayout, attestClaimPayout, draftPayoutAfterReopen, freezePayoutAtSubmit, readClaimPayout, readSubmitPayoutPlan, writeMemberPayoutAccount,
} from '../../infrastructure/reimbursement-payout';
import { payoutSubmitToken, sealPayoutDestination, submitPayoutColumns } from '../../domain/logic/payout-destination.logic';

/** What a submit freezes for the fixture claims below: the claim asks for cash. */
const cashPlan = { payoutMethod: 'CASH', followsDefault: false } as const;

// Evidence fake for detailWithFileNames — decision endpoints now return the same hydrated
// detail as a GET (names + file names), so their specs feed the assembler harmless lookups.
const fakeDetailEvidence = { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) };


const noopAudit = { log: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;
// These drafts carry no payout choice of their own, so the payout use case is never reached.
const noPayouts = {} as any;
const readyApproverRoutes = {
  resolveNamedSubmissionRoute: async () => null,
  resolveSubmissionRoute: async ({ roleKey }: any) => ({
    responsibilityRole: roleKey, effectiveTaskRole: roleKey,
    recipientUserIds: ['approver-1'], ownerRecipientUserIds: ['owner-1'], ownerFallbackUsed: false,
  }),
} as any;
const noopSubmitProjections = { execute: async () => undefined } as any;

function submitUseCase(repo: any, audit: any, outbox: any, evidence: any) {
  return new SubmitReimbursementUseCase(repo, audit, outbox, evidence, readyApproverRoutes, noopSubmitProjections);
}

/** The claim content the fixture approver was looking at. An approval that names none is its own test below. */
const SEEN_HASH = 'hash-the-approver-saw';

function approveUC(repo: any, projections: any = { execute: async () => undefined }, audit: any = noopAudit) {
  const useCase = new ApproveReimbursementUseCase(repo, audit, projections, fakeDetailEvidence as any);
  return {
    // Every approval names what it saw; a test about anything else approves what the fixture showed.
    execute: (context: any, id: string, comment?: string, seenHash: string | undefined = SEEN_HASH, payoutVerifiedVersion?: unknown) =>
      useCase.execute(context, id, comment, seenHash, payoutVerifiedVersion),
    /** The use case itself, for the calls that send no hash. */
    useCase,
  };
}

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'approver-1', companyId: 'co-1',
    membershipId: 'm', roles: ['MANAGER'], permissions: ['reimbursement.approve', 'reimbursement.reject'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function baseRequest(overrides: Partial<any> = {}): any {
  return {
    id: 'rb-1', companyId: 'co-1', requestNo: 'RB-202601-000001', requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'Somchai',
    amount: '500.0000', currency: 'THB', categoryKey: 'travel',
    incurredDate: new Date('2026-01-01T00:00:00.000Z'), reason: 'Taxi',
    status: 'PENDING_APPROVAL', currentApprovalStepId: 'step-1',
    approvalSnapshotHash: undefined, currentApproverUserId: undefined,
    approvalSteps: [{
      id: 'step-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', sequenceNo: 1,
      approverRoleSnapshot: 'MANAGER', status: 'PENDING', assignedAt: new Date('2026-01-01T00:00:00.000Z'),
      requestSnapshotHash: undefined, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }],
    paymentTotalAmount: '0.0000', outstandingAmount: '500.0000',
    createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeTx(events: any[]) {
  return { outboxEvent: { createMany: async ({ data }: any) => { events.push(...data); } } } as any;
}

// Finance review is OFF by default since the 2026-09-21 step-journey change. These tests were written
// for the finance path, so their companies turn it on explicitly; the OFF path has its own tests.
const FINANCE_REVIEW_ON = { ...REIMBURSEMENT_POLICY_DEFAULTS, financeReviewRequired: true } as any;

function fakeRepo(req: any, policy: any = FINANCE_REVIEW_ON, events: any[] = [], activeApprovers?: string[]) {
  return {
    findRequestById: async () => ({ ...req, payments: [], duplicateCandidates: [], signatures: [], signedCopies: [] }),
    // Audit H-20: named approvers who can still act. Defaults to "all of them", so every existing
    // test keeps the exact-match behaviour it was written for.
    findActiveApproverUserIds: async (_companyId: string, ids: string[]) =>
      new Set(activeApprovers ?? ids),
    findPolicy: async () => policy,
    getUserDisplayNames: async () => ({}),
    listSignedClaimFormCopies: async () => [],
    // The claim's own masked snapshot, as the repository reads it.
    findClaimPayout: async (claim: any) => (claim.payoutMethod ? { payoutMethod: claim.payoutMethod, ...claim.payoutSnapshot } : undefined),
    beginApprovalDecisionAtomic: async (data: any) => {
      const step = req.approvalSteps[0];
      step.status = 'APPROVED'; step.decisionByUserId = data.actorUserId; step.decidedAt = data.decidedAt;
      if (data.financeReviewRequired) Object.assign(req, data.financeRequestPatch);
      req.updatedAt = new Date(req.updatedAt.getTime() + 1);
      await data.onDecisionPersisted(fakeTx(events));
      return { request: req, resumed: false, approvalStepId: step.id };
    },
    completeApprovalProjectionAtomic: async (data: any) => {
      Object.assign(req, {
        status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID',
        postingStatus: 'pending', currentApprovalStepId: null, currentApproverUserId: null,
      });
      await data.onReadyPersisted(fakeTx(events));
      return req;
    },
    rejectRequestAtomic: async (data: any) => {
      Object.assign(req, data.request, { updatedAt: new Date(req.updatedAt.getTime() + 1) });
      await data.onRejectedPersisted(fakeTx(events));
    },
  } as any;
}

describe('ApproveReimbursementUseCase', () => {
  // Audit H-17: the default ctx() holds MANAGER, which is now exempt, so the maker-checker rule is
  // asserted with a role outside the exemption. The rule itself is unchanged for everyone else.
  it('blocks self-approval with self_approval_denied', async () => {
    const req = baseRequest({ requesterUserId: 'approver-1', approvalSteps: [{ ...baseRequest().approvalSteps[0], approverRoleSnapshot: 'ACCOUNTANT' }] });
    const uc = approveUC(fakeRepo(req));
    await assert.rejects(() => uc.execute(ctx({ roles: ['ACCOUNTANT'] }), 'rb-1'), /self_approval_denied/);
  });

  it('rejects when missing approve permission', async () => {
    const uc = approveUC(fakeRepo(baseRequest()));
    await assert.rejects(() => uc.execute(ctx({ permissions: [] }), 'rb-1'), /permission/i);
  });

  it('lets an active frozen assignee finish after a later role and permission change', async () => {
    const req = baseRequest({
      approvalSteps: [{ ...baseRequest().approvalSteps[0], assignedApproverUserIds: ['approver-1'] }],
    });
    const detail = await approveUC(fakeRepo(req)).execute(ctx({ roles: ['STAFF'], permissions: [] }), 'rb-1');
    assert.equal(detail.status, 'FINANCE_REVIEW');
  });

  it('does not widen a live frozen assignment to an unrelated permission holder', async () => {
    const req = baseRequest({
      approvalSteps: [{ ...baseRequest().approvalSteps[0], assignedApproverUserIds: ['assigned-1'] }],
    });
    await assert.rejects(
      () => approveUC(fakeRepo(req)).execute(ctx({ roles: ['OWNER'], permissions: ['reimbursement.approve'] }), 'rb-1'),
      /not_eligible_approver/,
    );
  });

  it('blocks a non-assigned approver', async () => {
    const req = baseRequest({ approvalSteps: [{ ...baseRequest().approvalSteps[0], approverUserId: 'other-approver', approverRoleSnapshot: undefined }] });
    const uc = approveUC(fakeRepo(req));
    await assert.rejects(() => uc.execute(ctx(), 'rb-1'), /not_eligible_approver/);
  });

  it('lets the OWNER decide a role-routed step without holding that role', async () => {
    // The default policy routes to MANAGER while a fresh company's principal holds only OWNER —
    // without this, nobody in that company could approve anything and the queue rendered empty.
    const req = baseRequest();
    const uc = approveUC(fakeRepo(req));
    const result = await uc.execute(ctx({ roles: ['OWNER'] }), 'rb-1');
    // This company requires finance review, so a successful decision parks there.
    assert.equal(result.status, 'FINANCE_REVIEW');
  });

  it('still blocks a permission holder whose roles match neither the routing nor OWNER', async () => {
    const uc = approveUC(fakeRepo(baseRequest()));
    await assert.rejects(() => uc.execute(ctx({ roles: ['ACCOUNTANT'] }), 'rb-1'), /not_eligible_approver/);
  });

  it('does not let the OWNER stand in for a step naming a specific person', async () => {
    // Deputising for a named approver is a different decision than holding rank.
    const req = baseRequest({ approvalSteps: [{ ...baseRequest().approvalSteps[0], approverUserId: 'other-approver', approverRoleSnapshot: undefined }] });
    const uc = approveUC(fakeRepo(req));
    await assert.rejects(() => uc.execute(ctx({ roles: ['OWNER'] }), 'rb-1'), /not_eligible_approver/);
  });

  // Audit H-20: with no reassign route, a step naming someone who has left froze the request AND
  // hid it from every queue, because the queue filters on the same predicate. Cancelling was the
  // only exit, and that burns the document number.
  it('lets the OWNER decide a step whose named approver can no longer act', async () => {
    const req = baseRequest({
      approvalSteps: [{ ...baseRequest().approvalSteps[0], approverUserId: 'departed-approver' }],
    });
    // Nobody active: the assignment no longer binds and the step falls back to its recorded role.
    const uc = approveUC(fakeRepo(req, FINANCE_REVIEW_ON, [], []));

    const result = await uc.execute(ctx({ roles: ['OWNER'] }), 'rb-1');

    assert.equal(result.status, 'FINANCE_REVIEW');
  });

  it('still refuses someone who matches neither the departed assignee nor its role', async () => {
    // The fallback widens to the role the step was routed with and OWNER — never to everyone.
    const req = baseRequest({
      approvalSteps: [{ ...baseRequest().approvalSteps[0], approverUserId: 'departed-approver' }],
    });
    const uc = approveUC(fakeRepo(req, FINANCE_REVIEW_ON, [], []));
    await assert.rejects(() => uc.execute(ctx({ roles: ['ACCOUNTANT'] }), 'rb-1'), /not_eligible_approver/);
  });

  it('keeps a step exact-match while its named approver is still active', async () => {
    const req = baseRequest({
      approvalSteps: [{ ...baseRequest().approvalSteps[0], approverUserId: 'other-approver' }],
    });
    const uc = approveUC(fakeRepo(req, FINANCE_REVIEW_ON, [], ['other-approver']));
    await assert.rejects(() => uc.execute(ctx({ roles: ['OWNER'] }), 'rb-1'), /not_eligible_approver/);
  });

  it('detects a stale snapshot when fields changed after submit', async () => {
    const repo = fakeRepo(baseRequest());
    repo.beginApprovalDecisionAtomic = async () => { throw new Error('stale_approval_snapshot'); };
    const uc = approveUC(repo);
    await assert.rejects(() => uc.execute(ctx(), 'rb-1'), /stale_approval_snapshot/);
  });

  it('approves and routes to FINANCE_REVIEW when the company requires finance review', async () => {
    const req = baseRequest();
    const events: any[] = [];
    const projections = { execute: async () => { throw new Error('finance approval must not project'); } };
    const uc = approveUC(fakeRepo(req, FINANCE_REVIEW_ON, events), projections);
    const detail = await uc.execute(ctx(), 'rb-1');
    assert.equal(detail.status, 'FINANCE_REVIEW');
    assert.equal(req.financeReviewStatus, 'PENDING');
    assert.deepEqual(events.find((event) => event.eventType === 'reimbursement.approved')?.payloadJson.data, {
      requestId: 'rb-1', requestNo: 'RB-202601-000001',
      status: 'FINANCE_REVIEW', decision: 'APPROVED', requesterUserId: 'staff-1', amount: '500.0000', currency: 'THB',
    });
  });

  it('rejects approving a non-pending request', async () => {
    const req = baseRequest({ status: 'APPROVED' });
    const uc = approveUC(fakeRepo(req));
    await assert.rejects(() => uc.execute(ctx(), 'rb-1'), /Cannot approve/);
  });

  it('projects only at final manager approval when finance review is not required', async () => {
    const lines = [
      lineRecord({ id: 'rbl-1', amount: '500.0000' }),
      lineRecord({ id: 'rbl-2', lineNo: 2, amount: '250.0000', description: 'Hotel', purpose: 'Client visit', attachmentId: 'att-9' }),
    ];
    const req = baseRequest({ lines });
    const policy = { financeReviewRequired: false, allowSelfApproval: false, allowMissingReceiptWithReason: false } as any;
    const calls: any[] = [];
    const projections = { execute: async (...args: any[]) => { calls.push(args); } };
    const detail = await approveUC(fakeRepo(req, policy), projections).execute(ctx(), 'rb-1');
    assert.equal(detail.status, 'READY_FOR_PAYMENT');
    assert.equal(req.postingStatus, 'pending');
    assert.equal(calls.length, 1);
    // (ctx, request, intent) — the request argument is what the projection service builds from.
    assert.equal(calls[0][1].id, 'rb-1');
    assert.equal(calls[0][2].kind, 'MANAGER');
    assert.equal(calls[0][2].approvalStepId, 'step-1');
  });

  it('keeps the request pending and emits no approved event when projection fails', async () => {
    const req = baseRequest({ lines: [lineRecord({ id: 'rbl-1', amount: '500.0000' })] });
    const policy = { financeReviewRequired: false, allowSelfApproval: false, allowMissingReceiptWithReason: false } as any;
    const events: any[] = [];
    const projections = { execute: async () => { throw new Error('projection failed'); } };
    await assert.rejects(() => approveUC(fakeRepo(req, policy, events), projections).execute(ctx(), 'rb-1'), /projection failed/);
    assert.equal(req.status, 'PENDING_APPROVAL');
    assert.ok(events.some((event) => event.eventType === 'reimbursement.approval_projection_started'));
    assert.ok(!events.some((event) => event.eventType === 'reimbursement.approved'));
  });
});

describe('RejectReimbursementUseCase', () => {
  it('requires a non-empty reason', async () => {
    const uc = new RejectReimbursementUseCase(fakeRepo(baseRequest()), noopAudit, fakeDetailEvidence as any);
    await assert.rejects(() => uc.execute(ctx(), 'rb-1', '  '), /rejection_reason_required/);
  });

  it('rejects with a reason and moves to REJECTED', async () => {
    const req = baseRequest();
    const events: any[] = [];
    const uc = new RejectReimbursementUseCase(fakeRepo(req, null, events), noopAudit, fakeDetailEvidence as any);
    const detail = await uc.execute(ctx(), 'rb-1', 'duplicate receipt');
    assert.equal(detail.status, 'REJECTED');
    assert.equal(req.rejectionReason, 'duplicate receipt');
    assert.deepEqual(events.find((event) => event.eventType === 'reimbursement.rejected')?.payloadJson.data, {
      requestId: 'rb-1', requestNo: 'RB-202601-000001',
      status: 'REJECTED', decision: 'REJECTED', requesterUserId: 'staff-1', amount: '500.0000', currency: 'THB',
    });
  });

  it('blocks self-rejection by requester', async () => {
    const req = baseRequest({ requesterUserId: 'approver-1', approvalSteps: [{ ...baseRequest().approvalSteps[0], approverRoleSnapshot: 'ACCOUNTANT' }] });
    const uc = new RejectReimbursementUseCase(fakeRepo(req), noopAudit, fakeDetailEvidence as any);
    await assert.rejects(() => uc.execute(ctx({ roles: ['ACCOUNTANT'] }), 'rb-1', 'reason'), /self_approval_denied/);
  });
});

function requesterCtx() {
  return ctx({
    userId: 'staff-1',
    roles: ['STAFF'],
    permissions: ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.read_own'],
  });
}

function inputLine(overrides: Partial<any> = {}): any {
  return {
    lineNo: 1, incurredDate: '2026-01-01T00:00:00.000Z', description: 'Taxi to customer',
    categoryKey: 'travel', amount: '500.0000', ...overrides,
  };
}

const requestInput: any = {
  reason: 'Taxi to customer',
  currency: 'THB',
  lines: [inputLine()],
};

function attachment(overrides: Partial<any> = {}) {
  return {
    id: 'att-1', companyId: 'co-1', branchId: 'branch-1', originalFileName: 'receipt.pdf', status: 'ACTIVE',
    uploadedByUserId: 'staff-1', ...overrides,
  } as any;
}

function expense(overrides: Partial<any> = {}) {
  return { id: 'exp-1', companyId: 'co-1', branchId: 'branch-1', createdByUserId: 'staff-1', ...overrides } as any;
}

function evidenceService(attachmentResult: any = null, expenseResult: any = null) {
  return new ReimbursementEvidenceService(
    { findById: async () => attachmentResult, findManyByIds: async () => (attachmentResult ? [attachmentResult] : []) } as any,
    { findById: async () => expenseResult, findSubstituteEvidence: async () => null } as any,
  );
}

/** Persisted line record shape (dates are Date, label is a snapshot). */
function lineRecord(overrides: Partial<any> = {}): any {
  return {
    id: 'rbl-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', lineNo: 1,
    incurredDate: new Date('2026-01-01T00:00:00.000Z'), description: 'Taxi to customer',
    categoryKey: 'travel', amount: '500.0000', ...overrides,
  };
}

function draftRequest(overrides: Partial<any> = {}) {
  return {
    id: 'rb-1', companyId: 'co-1', branchId: 'branch-1', requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'Somchai',
    reason: requestInput.reason, categoryKey: 'travel', amount: '500.0000',
    currency: requestInput.currency, incurredDate: new Date('2026-01-01T00:00:00.000Z'), status: 'DRAFT',
    financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID', duplicateStatus: 'NOT_CHECKED',
    receiptRequirementStatus: 'REQUIRED', postingStatus: 'not_required', paymentTotalAmount: '0.0000',
    outstandingAmount: '500.0000', createdByUserId: 'staff-1', lines: [lineRecord()],
    createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as any;
}

function requestRepo(initial?: any, claimedElsewhere: any[] = []) {
  let request = initial;
  const events: any[] = [];
  const repo = {
    resolveCreateBranchId: async () => 'branch-1',
    assertReimbursementRequester: async (_company: string, _branch: string, userId: string) => ({ userId, displayName: 'Somchai' }),
    resolveSourceLines: async (_company: string, _user: string, _branch: string, _currency: string, lines: any[]) => lines,
    findPolicy: async () => null,
    getUserDisplayName: async () => 'Somchai',
    // Lane D: the detail path resolves approver/reviewer/payer names in one batch.
    getUserDisplayNames: async () => ({}),
    // Lane F: it also lists the uploaded scans of the signed claim form.
    listSignedClaimFormCopies: async () => [],
    createRequest: async (data: any) => {
      request = draftRequest({
        ...data,
        lines: (data.lines ?? []).map((l: any, i: number) => lineRecord({ ...l, id: `rbl-${i + 1}` })),
      });
      return request;
    },
    updateDraftRequest: async (companyId: string, id: string, expectedUpdatedAt: Date, data: any, lines?: any[]) => {
      assert.equal(expectedUpdatedAt, request.updatedAt);
      Object.assign(request, data, { updatedAt: new Date(request.updatedAt.getTime() + 1) });
      if (lines) request.lines = lines.map((line: any, index: number) => (
        lineRecord({ ...line, id: `rbl-${index + 1}`, companyId, reimbursementRequestId: id })
      ));
      return request;
    },
    findLinesClaimedElsewhere: async () => claimedElsewhere,
    findRequestById: async (_companyId: string, _id: string, withRelations?: boolean) => withRelations
      ? { ...request, approvalSteps: [], payments: [], duplicateCandidates: [] }
      : request,
    updateRequest: async (_companyId: string, _id: string, data: any) => {
      Object.assign(request, data);
      return request;
    },
    findDuplicateCandidates: async () => [],
    // The claim asks for cash: it needs no account and no attestation.
    planSubmitPayout: async () => cashPlan,
    findClaimPayout: async (claim: any) => (claim.payoutMethod ? { payoutMethod: claim.payoutMethod } : undefined),
    submitDraftAtomic: async ({ expectedUpdatedAt, request: data, approvalStep, payout, onSubmittedPersisted }: any) => {
      assert.equal(expectedUpdatedAt, request.updatedAt);
      // As in the repository transaction: the payout columns are decided here and the hash is made from them.
      const columns = submitPayoutColumns(cashPlan);
      const snapshotHash = payout.snapshotHash(columns);
      const step = approvalStep ? { id: 'step-1' } : undefined;
      const documentNumber = { id: 'num-1', documentNumber: 'RB-202601-000001' };
      Object.assign(request, data, columns, {
        approvalSnapshotHash: snapshotHash,
        requestNo: documentNumber.documentNumber,
        currentApprovalStepId: step?.id ?? null,
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await onSubmittedPersisted(fakeTx(events), {
        step, documentNumber, documentNumberReused: false,
        supersededDuplicateCandidateCount: 0, supersededApprovalStepCount: 0,
        payout: { plan: cashPlan, columns },
      });
      return {
        step,
        documentNumber,
        documentNumberReused: false,
        supersededDuplicateCandidateCount: 0,
        supersededApprovalStepCount: 0,
      };
    },
  } as any;
  return { repo, events, get request() { return request; } };
}

describe('Reimbursement request evidence validation', () => {
  const invalidAttachments = [
    ['nonexistent', null],
    ['cross-company', attachment({ companyId: 'co-2' })],
    ['other-user', attachment({ uploadedByUserId: 'staff-2' })],
    ['non-ACTIVE', attachment({ status: 'PENDING_UPLOAD' })],
  ] as const;
  const invalidExpenses = [
    ['nonexistent', null],
    ['cross-company', expense({ companyId: 'co-2' })],
    ['other-user', expense({ createdByUserId: 'staff-2' })],
  ] as const;

  for (const [name, record] of invalidAttachments) {
    it(`rejects ${name} attachment at create`, async () => {
      const state = requestRepo();
      const uc = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(record), noPayouts);
      await assert.rejects(() => uc.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ attachmentId: 'att-1' })] }), /invalid_primary_attachment/);
    });

    it(`rejects ${name} attachment at submit`, async () => {
      const state = requestRepo(draftRequest({ lines: [lineRecord({ attachmentId: 'att-1' })] }));
      const uc = submitUseCase(state.repo, noopAudit, noopOutbox, evidenceService(record));
      await assert.rejects(() => uc.execute(requesterCtx(), 'rb-1'), /invalid_primary_attachment/);
    });
  }

  for (const [name, record] of invalidExpenses) {
    it(`rejects ${name} expense at create`, async () => {
      const state = requestRepo();
      const uc = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(null, record), noPayouts);
      await assert.rejects(() => uc.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ linkedExpenseId: 'exp-1' })] }), /invalid_linked_expense/);
    });

    it(`rejects ${name} expense at submit`, async () => {
      const state = requestRepo(draftRequest({ lines: [lineRecord({ linkedExpenseId: 'exp-1' })] }));
      const uc = submitUseCase(state.repo, noopAudit, noopOutbox, evidenceService(null, record));
      await assert.rejects(() => uc.execute(requesterCtx(), 'rb-1'), /invalid_linked_expense/);
    });
  }

  it('validates attachment and expense ids supplied by PATCH', async () => {
    const state = requestRepo(draftRequest());
    const updateAttachment = new UpdateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(null), noPayouts);
    await assert.rejects(
      () => updateAttachment.execute(requesterCtx(), 'rb-1', { lines: [inputLine({ attachmentId: 'missing' })] }),
      /invalid_primary_attachment/,
    );
    const updateExpense = new UpdateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(null, null), noPayouts);
    await assert.rejects(
      () => updateExpense.execute(requesterCtx(), 'rb-1', { lines: [inputLine({ linkedExpenseId: 'missing' })] }),
      /invalid_linked_expense/,
    );
  });

  it('passes create to submit with a valid active attachment and returns its file name on the line', async () => {
    const state = requestRepo();
    const evidence = evidenceService(attachment());
    const create = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidence, noPayouts);
    const created = await create.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ attachmentId: 'att-1' })] });
    const events: any[] = [];
    const outbox = { append: async (...args: any[]) => { events.push(args); } } as any;
    const submit = submitUseCase(state.repo, noopAudit, outbox, evidence);
    const detail = await submit.execute(requesterCtx(), created.id);
    assert.equal(detail.status, 'PENDING_APPROVAL');
    assert.equal(detail.lines[0]?.attachmentFileName, 'receipt.pdf');
    // The reimbursement_pending_approval workflow template's default condition
    // matches on requestId in the event data — without it, enabled rules never fire.
    const submitted = state.events.find((event) => event.eventType === 'reimbursement.request_submitted');
    assert.equal(submitted?.payloadJson.data.requestId, created.id);
  });

  it('finance submits on the requester\'s behalf with the REQUESTER\'s attachment', async () => {
    const state = requestRepo();
    const evidence = evidenceService(attachment()); // uploadedByUserId: staff-1 = requester
    const create = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidence, noPayouts);
    const created = await create.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ attachmentId: 'att-1' })] });
    const financeCtx = ctx({ userId: 'finance-1', roles: ['FINANCE'], permissions: ['reimbursement.submit', 'reimbursement.finance_review'] });
    const submit = submitUseCase(state.repo, noopAudit, noopOutbox, evidence);
    const detail = await submit.execute(financeCtx, created.id);
    assert.equal(detail.status, 'PENDING_APPROVAL');
  });

  it('accepts finance’s own upload on behalf of the requester but rejects a third person’s file', async () => {
    const state = requestRepo();
    const create = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(attachment()), noPayouts);
    const created = await create.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ attachmentId: 'att-1' })] });
    const financeCtx = ctx({ userId: 'finance-1', roles: ['FINANCE'], permissions: ['reimbursement.finance_review'] });
    const update = new UpdateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(attachment({ uploadedByUserId: 'finance-1' })), noPayouts);
    await update.execute(financeCtx, created.id, { lines: [inputLine({ attachmentId: 'att-2' })] });
    const thirdParty = new UpdateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(attachment({ uploadedByUserId: 'other-person' })), noPayouts);
    await assert.rejects(
      () => thirdParty.execute(financeCtx, created.id, { lines: [inputLine({ attachmentId: 'att-3' })] }),
      /invalid_primary_attachment/,
    );
  });

  it('rejects submit after PATCH clears the only receipt evidence under requireReceipt', async () => {
    const state = requestRepo();
    const evidence = evidenceService(attachment());
    const create = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidence, noPayouts);
    const created = await create.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ attachmentId: 'att-1' })] });
    const update = new UpdateReimbursementDraftUseCase(state.repo, noopAudit, evidence, noPayouts);
    await update.execute(requesterCtx(), created.id, { lines: [inputLine({ attachmentId: null })] });
    const submit = submitUseCase(state.repo, noopAudit, noopOutbox, evidence);
    await assert.rejects(
      () => submit.execute(requesterCtx(), created.id),
      (error: any) => error?.status === 422 && /missing_receipt/.test(error.message),
    );
  });
});

/**
 * Audit H-18: the queue listed the viewer's own claims, so the approve button was offered on a
 * request that answers `self_approval_denied` — and the pending-approval notification pushed a deep
 * link straight at it. The invitation and the rule disagreed.
 */
/**
 * Audit H-17 (owner decision 2026-08-10): a small company is one person doing everything, so
 * OWNER/ADMIN/MANAGER may approve their own claim without the company first turning the policy on —
 * the same exemption procurement already carries. The trade is that every such decision is recorded
 * inside the approving transaction, so support can always say who did it.
 */
describe('self-approval role exemption (audit H-17)', () => {
  const auditOf = (calls: any[]) => calls.find((c: any) => String(c.action ?? '').startsWith('reimbursement.approval.'));

  function auditingUC(req: any) {
    const entries: any[] = [];
    const uc = new ApproveReimbursementUseCase(
      fakeRepo(req) as any,
      { log: async (entry: any) => { entries.push(entry); } } as any,
      { runApprovalProjection: async () => undefined } as any,
      fakeDetailEvidence as any,
    );
    return { uc, entries };
  }

  it('lets an owner approve their own claim without the policy being opened', async () => {
    const { uc } = auditingUC(baseRequest({ requesterUserId: 'approver-1' }));
    const result = await uc.execute(ctx({ roles: ['OWNER'] }), 'rb-1', undefined, SEEN_HASH);
    assert.equal(result.status, 'FINANCE_REVIEW');
  });

  // Routed to the role under test: whether that role may approve THIS step is a separate rule
  // (matchesApproverRole), and mixing the two would hide which one the test proves.
  for (const role of ['ADMIN', 'MANAGER']) {
    it(`extends the same exemption to ${role}`, async () => {
      const mine = baseRequest({
        requesterUserId: 'approver-1',
        approvalSteps: [{ ...baseRequest().approvalSteps[0], approverRoleSnapshot: role }],
      });
      const { uc } = auditingUC(mine);
      const result = await uc.execute(ctx({ roles: [role] }), 'rb-1', undefined, SEEN_HASH);
      assert.equal(result.status, 'FINANCE_REVIEW');
    });
  }

  it('still refuses a role outside the exemption', async () => {
    const { uc } = auditingUC(baseRequest({ requesterUserId: 'approver-1' }));
    await assert.rejects(() => uc.execute(ctx({ roles: ['ACCOUNTANT'] }), 'rb-1'), /self_approval_denied/);
  });

  // The point of the trade: an exempted self-approval is never anonymous.
  it('records who self-approved and that a role stood in for the policy', async () => {
    const { uc, entries } = auditingUC(baseRequest({ requesterUserId: 'approver-1' }));

    await uc.execute(ctx({ roles: ['OWNER', 'ACCOUNTANT'] }), 'rb-1', undefined, SEEN_HASH);

    const entry = auditOf(entries);
    assert.equal(entry.actorUserId, 'approver-1');
    assert.deepEqual(entry.metadataJson.selfApproval, {
      approvedOwnRequest: true,
      via: 'role_exemption',
      // Only the roles that actually granted the exemption, not everything the actor holds.
      actorRoles: ['OWNER'],
    });
  });

  it('does not attach a self-approval note when approving someone else\u2019s claim', async () => {
    const { uc, entries } = auditingUC(baseRequest({ requesterUserId: 'staff-1' }));
    await uc.execute(ctx({ roles: ['OWNER'] }), 'rb-1', undefined, SEEN_HASH);
    assert.equal(auditOf(entries).metadataJson.selfApproval, undefined);
  });
});

describe('decision responses are as hydrated as a GET', () => {
  // Live UAT 2026-08-29: the drawer keeps a decision's response on purpose (a frozen assignee
  // may lose read permission the moment they decide), and that response used to skip the name
  // lookup — the signature panel then printed a raw cuid that overflowed onto the ลงนาม button.
  it('returns the approve detail with resolved display names, never bare ids', async () => {
    const req = baseRequest();
    const repo = {
      ...fakeRepo(req),
      getUserDisplayNames: async (_c: string, ids: string[]) => Object.fromEntries(ids.map((id) => [id, `คุณ ${id}`])),
    } as any;
    const uc = new ApproveReimbursementUseCase(repo, noopAudit, { runApprovalProjection: async () => undefined } as any, fakeDetailEvidence as any);
    const detail = await uc.execute(ctx(), 'rb-1', undefined, SEEN_HASH);
    const actor = req.approvalSteps[0].decisionByUserId;
    assert.equal(detail.approvalSteps[0]?.decidedByName, `คุณ ${actor}`);
  });
});

describe('ListApprovalQueueUseCase self-approval (audit H-18)', () => {
  function queueRepo(request: any, policy: any = null) {
    return {
      findPolicy: async () => policy,
      listRequests: async () => [request],
      findActiveApproverUserIds: async (_c: string, ids: string[]) => new Set(ids),
      getUserDisplayNames: async (_c: string, ids: string[]) => Object.fromEntries(ids.map((id) => [id, `คุณ ${id}`])),
    } as any;
  }

  it('keeps frozen work in the assignee queue after their role permissions are removed', async () => {
    const assigned = baseRequest({
      approvalSteps: [{ ...baseRequest().approvalSteps[0], assignedApproverUserIds: ['approver-1'] }],
    });
    const items = await new ListApprovalQueueUseCase(queueRepo(assigned)).execute(ctx({ roles: ['STAFF'], permissions: [] }));
    assert.equal(items.length, 1);
    // The row also says whose desk it is on, from the same frozen assignment.
    assert.deepEqual(items[0]?.currentDesk, { kind: 'APPROVER', names: ['คุณ approver-1'] });
  });

  it('keeps a frozen self-task visible when a later role change removes its exemption', async () => {
    const assignedWhileManager = baseRequest({
      requesterUserId: 'approver-1',
      approvalSteps: [{ ...baseRequest().approvalSteps[0], assignedApproverUserIds: ['approver-1'] }],
    });
    const items = await new ListApprovalQueueUseCase(queueRepo(assignedWhileManager)).execute(ctx({
      roles: ['STAFF'], permissions: [],
    }));
    assert.equal(items.length, 1);
  });

  it('hides a claim from the person who filed it while self-approval is blocked', async () => {
    // A role outside the H-17 exemption: eligible to approve this step, refused by maker-checker.
    // (An OWNER filing their own claim now CAN approve it, so their claim correctly stays listed —
    // the queue and the approve gate share one predicate and move together.)
    const mine = baseRequest({
      requesterUserId: 'approver-1',
      approvalSteps: [{ ...baseRequest().approvalSteps[0], approverRoleSnapshot: 'ACCOUNTANT' }],
    });
    const items = await new ListApprovalQueueUseCase(queueRepo(mine)).execute(ctx({ roles: ['ACCOUNTANT'] }));

    assert.deepEqual(items, [], 'no button is offered for a decision that would be refused');
  });

  it('keeps an exempt role’s own claim listed, because they can now decide it', async () => {
    const mine = baseRequest({ requesterUserId: 'approver-1' });
    const items = await new ListApprovalQueueUseCase(queueRepo(mine)).execute(ctx({ roles: ['OWNER'] }));

    assert.equal(items.length, 1);
  });

  it('still lists everyone else’s claims', async () => {
    const theirs = baseRequest({ requesterUserId: 'staff-1' });
    const items = await new ListApprovalQueueUseCase(queueRepo(theirs)).execute(ctx({ roles: ['OWNER'] }));

    assert.equal(items.length, 1);
  });

  it('lets a reject-only decision maker load the same queue without granting approve', async () => {
    const theirs = baseRequest({ requesterUserId: 'staff-1' });
    const items = await new ListApprovalQueueUseCase(queueRepo(theirs)).execute(ctx({
      permissions: ['reimbursement.reject'],
    }));

    assert.equal(items.length, 1);
  });

  // The company can turn self-approval on, and then the claim is genuinely approvable — the filter
  // reads the same policy field the approve gate does, so the two cannot come to disagree.
  it('shows the filer their own claim once the policy allows self-approval', async () => {
    const mine = baseRequest({ requesterUserId: 'approver-1' });
    const repo = queueRepo(mine, { allowSelfApproval: true });
    const items = await new ListApprovalQueueUseCase(repo).execute(ctx({ roles: ['OWNER'] }));

    assert.equal(items.length, 1);
  });
});

// Spec §15 row 1: a solo requester on a custom role is left off their own route while self-approval
// is off. The journey page can only explain that if the detail says so.
describe('approvalDecisionActions self-approval signal (spec §15)', () => {
  const plain = { canApprove: false, canReject: false };
  const mine = (step: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) => baseRequest({
    requesterUserId: 'approver-1',
    approvalSteps: [{ ...baseRequest().approvalSteps[0], approverRoleSnapshot: 'ACCOUNTANT', assignedApproverUserIds: ['owner-1'], ...step }],
    ...overrides,
  });
  const accountant = ctx({ roles: ['ACCOUNTANT'] });

  it('flags the requester who holds the routed role and is held back only by the switch', async () => {
    const blocked = { ...plain, selfApprovalBlocked: true };
    // Routing left them off the frozen assignment…
    assert.deepEqual(await approvalDecisionActions(accountant, mine(), fakeRepo(null)), blocked);
    // …or an unassigned role-routed step would take them, but for the rule.
    assert.deepEqual(await approvalDecisionActions(accountant, mine({ assignedApproverUserIds: undefined }), fakeRepo(null)), blocked);
  });

  it('says nothing when the switch is not what stands in the way', async () => {
    const repo = fakeRepo(null);
    assert.deepEqual(await approvalDecisionActions(ctx({ roles: ['STAFF'] }), mine(), repo), plain, 'not the routed role');
    assert.deepEqual(await approvalDecisionActions(ctx({ roles: ['ACCOUNTANT'], permissions: ['reimbursement.reject'] }), mine(), repo), plain, 'no approve');
    assert.deepEqual(await approvalDecisionActions(accountant, mine({}, { requesterUserId: 'staff-1' }), repo), plain, 'not their claim');
    assert.deepEqual(await approvalDecisionActions(accountant, mine(), fakeRepo(null, { allowSelfApproval: true })), plain, 'switch already on');
    assert.deepEqual(await approvalDecisionActions(accountant, mine({ status: 'APPROVED' }), repo), plain, 'already decided');
  });
});

// Owner order 2026-09-21 ("ผู้ใช้คนเดียวที่กำหนดบทบาทเอง ต้องทำได้นะ"): submit found nobody but the
// requester, so the step froze them as its approver and the snapshot froze the reason.
describe('solo requester on a custom role (owner order 2026-09-21)', () => {
  const soloSnapshot = {
    schemaVersion: 1, policyId: 'policy-1', policyVersion: '2026-01-01T00:00:00.000Z', approvalRequiredFromAmount: '1.00', requiresApproval: true,
    route: { mode: 'CUSTOM_ROLE', roleKey: 'CUSTOM_SOLO', effectiveTaskRole: 'CUSTOM_SOLO', ownerFallbackUsedAtSubmission: false, soloSelfApprovalAtSubmission: true },
    allowSelfApproval: false, requireReceipt: false, allowMissingReceiptWithReason: false, duplicatePolicy: 'BLOCK_PAYMENT', financeReviewRequired: false,
  };
  const soloClaim = () => baseRequest({
    requesterUserId: 'solo-1', approvalPolicySnapshotJson: soloSnapshot, lines: [lineRecord()],
    approvalSteps: [{ ...baseRequest().approvalSteps[0], approverRoleSnapshot: 'CUSTOM_SOLO', assignedApproverUserIds: ['solo-1'] }],
  });
  const soloPermissions = compileRole({ capabilityPackKeys: ['pack.reimbursement.approve'], entitledFeatureKeys: null }).permissionKeys;
  const solo = ctx({ userId: 'solo-1', roles: ['CUSTOM_SOLO'], permissions: soloPermissions });

  it('offers the decision to the requester, with no self-approval hint', async () => {
    assert.deepEqual(await approvalDecisionActions(solo, soloClaim(), fakeRepo(null)), { canApprove: true, canReject: true });
  });

  it('lets the requester approve with self-approval off and records why in the approval audit', async () => {
    const entries: any[] = [];
    const detail = await approveUC(fakeRepo(soloClaim()), undefined, { log: async (entry: any) => { entries.push(entry); } }).execute(solo, 'rb-1');
    assert.equal(detail.status, 'READY_FOR_PAYMENT');
    assert.deepEqual(entries.find((entry) => entry.action === 'reimbursement.approval.decision_durable')?.metadataJson.selfApproval, {
      approvedOwnRequest: true,
      via: 'no_other_approver',
      // No exempt role stood in, so the roles the requester acted under are recorded.
      actorRoles: ['CUSTOM_SOLO'],
    });
  });

  it('takes a solo user built from the approve pack from submit through approve to payment', async () => {
    assert.ok(['reimbursement.submit', 'reimbursement.approve', 'reimbursement.payment.record'].every((key) => soloPermissions.includes(key)));
    // The company picked the user's own role as the approver; nobody else holds it and nobody holds OWNER.
    const holder = (roleKey: string) => ({ membership: {
      userId: 'solo-1', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null, branchScopes: [], roles: [{ role: { key: roleKey, status: 'ACTIVE' } }],
    } });
    const approverRoutes = new ListReimbursementApproverOptionsUseCase({ client: {
      role: { findMany: async () => [
        { key: 'CUSTOM_SOLO', name: 'เจ้าของร้าน', scopeKey: 'co-1', status: 'ACTIVE', permissions: soloPermissions.map((key) => ({ permission: { key } })), memberships: [holder('CUSTOM_SOLO')] },
        { key: 'OWNER', name: 'Owner', scopeKey: 'system', status: 'ACTIVE', permissions: soloPermissions.map((key) => ({ permission: { key } })), memberships: [] },
      ] },
      branch: { findMany: async () => [] },
      companyFeatureEntitlement: { findMany: async () => [] },
    } } as any);
    const policy = {
      id: 'policy-1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), currency: 'THB', approvalRequiredFromAmount: '1.00',
      approverMode: 'CUSTOM_ROLE', defaultApproverRole: 'CUSTOM_SOLO', allowSelfApproval: false, requireReceipt: false,
      allowMissingReceiptWithReason: false, duplicatePolicy: 'BLOCK_PAYMENT', financeReviewRequired: false, status: 'ACTIVE',
    } as any;
    const state = requestRepo();
    state.repo.findPolicy = async () => policy;
    let frozenStep: any;
    const submitAtomic = state.repo.submitDraftAtomic;
    state.repo.submitDraftAtomic = async (data: any) => { frozenStep = data.approvalStep; return submitAtomic(data); };
    const evidence = evidenceService();
    const created = await new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidence, noPayouts)
      .execute(solo, { ...requestInput, missingReceiptReason: 'ใบเสร็จหาย' });
    await new SubmitReimbursementUseCase(state.repo, noopAudit, noopOutbox, evidence, approverRoutes, noopSubmitProjections).execute(solo, created.id);
    assert.deepEqual(frozenStep.assignedApproverUserIdsJson, ['solo-1']);
    assert.equal(state.request.approvalPolicySnapshotJson.route.soloSelfApprovalAtSubmission, true);

    const req = { ...state.request, approvalSteps: [{
      id: 'step-1', companyId: 'co-1', reimbursementRequestId: created.id, status: 'PENDING', assignedAt: new Date('2026-01-02T00:00:00.000Z'),
      ...frozenStep, assignedApproverUserIds: frozenStep.assignedApproverUserIdsJson,
    }] };
    let paidByUserId: string | undefined;
    const repo = {
      ...fakeRepo(req, policy),
      assertClaimPaymentReady: async () => undefined,
      listOpenDuplicateCandidates: async () => [],
      recordPaymentAtomic: async (data: any) => {
        paidByUserId = data.paidByUserId;
        const payment = { id: 'pay-1', ...data, status: 'RECORDED', postingStatus: 'pending', createdAt: new Date(), updatedAt: new Date() };
        Object.assign(req, { status: 'PAID', paymentStatus: 'PAID', paymentTotalAmount: data.paidAmount, outstandingAmount: '0.0000' });
        return { request: { ...req, payments: [payment], duplicateCandidates: [] }, payment, created: true };
      },
    } as any;
    assert.equal((await approveUC(repo).execute(solo, created.id)).status, 'READY_FOR_PAYMENT');
    const paid = await new RecordReimbursementPaymentUseCase(
      repo, noopAudit, noopOutbox,
      { execute: async () => ({ id: 'seq-1', documentNumber: 'RBPAY-202601-000001' }) } as any,
      { execute: async () => undefined } as any,
      fakeDetailEvidence as any,
    ).execute(solo, created.id, { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' });
    assert.equal(paid.status, 'PAID');
    assert.equal(paidByUserId, 'solo-1');
  });
});

// ---- Payout account: human verification at approval (owner decision P1, payout spec §10) ----

describe('approving a claim that is paid by transfer needs the approver attestation', () => {
  const transferClaim = (overrides: Partial<any> = {}) => baseRequest({
    payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 2, payoutFingerprint: 'fp-2',
    payoutSnapshot: { payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', version: 2, source: 'DEFAULT_ACCOUNT' },
    ...overrides,
  });
  /** Counts what reaches the transaction, so a refusal is proven to happen before any write. */
  function counted(req: any, policy?: any) {
    const repo = fakeRepo(req, policy);
    const decisions: any[] = [];
    const begin = repo.beginApprovalDecisionAtomic;
    repo.beginApprovalDecisionAtomic = async (data: any) => { decisions.push(data); return begin(data); };
    return { repo, decisions };
  }

  it('is refused without "ตรวจบัญชีแล้ว", before anything is written, also on a direct call', async () => {
    const { repo, decisions } = counted(transferClaim());
    await assert.rejects(() => approveUC(repo).execute(ctx(), 'rb-1'), /payout_verification_required/);
    await assert.rejects(() => approveUC(repo).execute(ctx(), 'rb-1', 'ok', undefined, null), /payout_verification_required/);
    assert.equal(decisions.length, 0);
  });

  it('is refused when the attestation names another snapshot version', async () => {
    const { repo, decisions } = counted(transferClaim());
    for (const stale of [1, 3, '2', true]) await assert.rejects(() => approveUC(repo).execute(ctx(), 'rb-1', undefined, undefined, stale), /payout_destination_changed/);
    assert.equal(decisions.length, 0);
  });

  it('goes through with the current version, hands it to the transaction and audits who attested which version', async () => {
    const entries: any[] = [];
    const { repo, decisions } = counted(transferClaim());
    const detail = await approveUC(repo, undefined, { log: async (entry: any, tx: any) => { entries.push({ ...entry, inTransaction: !!tx }); } })
      .execute(ctx(), 'rb-1', undefined, undefined, 2);
    assert.equal(detail.status, 'FINANCE_REVIEW');
    assert.equal(decisions[0].payoutVerifiedVersion, 2);
    const verify = entries.find((entry) => entry.action === 'reimbursement.payout.verify');
    assert.deepEqual(verify.metadataJson, { version: 2, via: 'APPROVAL', approvalStepId: 'step-1', byRequester: false });
    assert.equal(verify.inTransaction, true, 'the attestation is recorded in the decision transaction');
    assert.equal(verify.actorUserId, 'approver-1');
    // The answer shows the account masked; nothing in the audit or the answer is a full number.
    assert.deepEqual([detail.payout?.accountLast4, detail.payout?.version], ['6789', 2]);
    assert.ok(!/accountNumber|\d{6,}/.test(JSON.stringify([entries.map((entry) => entry.metadataJson), detail.payout])));
  });

  it('records the requester attesting their own account when they approve their own claim', async () => {
    const entries: any[] = [];
    const own = transferClaim({ requesterUserId: 'approver-1' });
    await approveUC(fakeRepo(own), undefined, { log: async (entry: any) => { entries.push(entry); } }).execute(ctx({ roles: ['OWNER'] }), 'rb-1', undefined, undefined, 2);
    assert.equal(entries.find((entry) => entry.action === 'reimbursement.payout.verify').metadataJson.byRequester, true);
    // Self-approval still needs it: being the requester is not an attestation.
    await assert.rejects(() => approveUC(fakeRepo(transferClaim({ requesterUserId: 'approver-1' }))).execute(ctx({ roles: ['OWNER'] }), 'rb-1'), /payout_verification_required/);
  });

  it('keeps the eligibility answer first: someone who may not approve learns nothing about the attestation', async () => {
    const assigned = transferClaim({ approvalSteps: [{ ...baseRequest().approvalSteps[0], assignedApproverUserIds: ['assigned-1'] }] });
    await assert.rejects(() => approveUC(fakeRepo(assigned)).execute(ctx({ roles: ['OWNER'] }), 'rb-1'), /not_eligible_approver/);
    await assert.rejects(() => approveUC(fakeRepo(transferClaim())).execute(ctx({ permissions: [] }), 'rb-1'), /permission/i);
  });

  it('resumes a decision that was already made without asking for the attestation again', async () => {
    const decided = transferClaim({ approvalSteps: [{ ...baseRequest().approvalSteps[0], status: 'APPROVED', decisionByUserId: 'approver-1', decidedAt: new Date('2026-01-02T00:00:00.000Z') }] });
    const detail = await approveUC(fakeRepo(decided, { ...REIMBURSEMENT_POLICY_DEFAULTS, financeReviewRequired: false })).execute(ctx(), 'rb-1');
    assert.equal(detail.status, 'READY_FOR_PAYMENT');
  });

  it('asks nothing of a cash claim or a legacy claim: they approve exactly as before', async () => {
    const entries: any[] = [];
    const audit = { log: async (entry: any) => { entries.push(entry); } };
    for (const claim of [baseRequest({ payoutMethod: 'CASH' }), baseRequest()]) {
      assert.equal((await approveUC(fakeRepo(claim), undefined, audit).execute(ctx(), 'rb-1')).status, 'FINANCE_REVIEW');
    }
    // A stray version on a claim with no account changes nothing either.
    assert.equal((await approveUC(fakeRepo(baseRequest())).execute(ctx(), 'rb-1', undefined, undefined, 9)).status, 'FINANCE_REVIEW');
    assert.equal(entries.some((entry) => entry.action === 'reimbursement.payout.verify'), false, 'no attestation is invented for them');
    // A legacy claim answers with no payout block at all.
    assert.equal((await approveUC(fakeRepo(baseRequest())).execute(ctx(), 'rb-1')).payout, undefined);
  });

  it('shows the queue the receiving method and nothing of the account', async () => {
    const queueRepo = {
      findPolicy: async () => null, listRequests: async () => [transferClaim()],
      findActiveApproverUserIds: async (_c: string, ids: string[]) => new Set(ids), getUserDisplayNames: async () => ({}),
    } as any;
    const items = await new ListApprovalQueueUseCase(queueRepo).execute(ctx());
    assert.equal(items[0]?.payoutMethod, 'BANK_TRANSFER');
    assert.ok(!/payoutSnapshot|bankName|accountName|accountLast4|accountNumber|fingerprint|6789/i.test(JSON.stringify(items)));
  });
});

// Audit B2: the quick "อนุมัติ" in the queue named no claim content, and the server compared the hash
// only when one was sent. A claim withdrawn, edited and sent again while the list was open was
// approved with content nobody had looked at.
describe('nothing is approved unseen: an approval names the claim content it saw', () => {
  const queueRepo = (request: any) => ({
    findPolicy: async () => null, listRequests: async () => [request],
    findActiveApproverUserIds: async (_c: string, ids: string[]) => new Set(ids), getUserDisplayNames: async () => ({}),
  }) as any;
  /**
   * Deliberately lenient: it compares the stored hash only WHEN one is sent, as the repository once
   * did. So what this proves is the use case's own refusal of a call that names none; a fake as
   * strict as today's transaction would hide it.
   */
  function comparing(req: any) {
    const repo = fakeRepo(req);
    const decisions: any[] = [];
    const begin = repo.beginApprovalDecisionAtomic;
    repo.beginApprovalDecisionAtomic = async (data: any) => {
      if (data.expectedApprovalSnapshotHash && data.expectedApprovalSnapshotHash !== req.approvalSnapshotHash) throw new ConflictException('stale_approval_snapshot');
      decisions.push(data);
      return begin(data);
    };
    return { repo, decisions };
  }

  it('carries the claim hash on every queue row, and still no account', async () => {
    const [row] = await new ListApprovalQueueUseCase(queueRepo(baseRequest({ approvalSnapshotHash: 'hash-as-listed' }))).execute(ctx());
    assert.equal(row?.approvalSnapshotHash, 'hash-as-listed');
    const [transfer] = await new ListApprovalQueueUseCase(queueRepo(baseRequest({
      approvalSnapshotHash: 'hash-as-listed', payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: 'fp-1',
    }))).execute(ctx());
    assert.deepEqual([transfer?.approvalSnapshotHash, transfer?.payoutMethod], ['hash-as-listed', 'BANK_TRANSFER']);
    assert.ok(!/fp-1|payoutFingerprint|payoutDestinationVersion|accountLast4|bankName/.test(JSON.stringify(transfer)));
  });

  it('refuses an approval that names no hash, with the code that makes the screen load the claim again', async () => {
    const { repo, decisions } = comparing(baseRequest({ approvalSnapshotHash: 'hash-1' }));
    for (const noHash of [undefined, '']) {
      await assert.rejects(() => approveUC(repo).useCase.execute(ctx(), 'rb-1', undefined, noHash), (error: any) => {
        assert.equal(error.getStatus?.(), 409);
        assert.match(error.message, /stale_approval_snapshot/);
        return true;
      });
    }
    assert.equal(decisions.length, 0, 'nothing was decided');
    // Who may not approve at all is still told so, not asked to reload.
    await assert.rejects(() => approveUC(repo).useCase.execute(ctx({ permissions: [] }), 'rb-1'), /permission/i);
  });

  it('refuses the hash of the claim as the list showed it, once the claim was withdrawn, edited and sent again', async () => {
    const claim = baseRequest({ approvalSnapshotHash: 'hash-as-listed' });
    const { repo, decisions } = comparing(claim);
    const [row] = await new ListApprovalQueueUseCase(queueRepo(claim)).execute(ctx());
    // While the approver's list is open, the requester withdraws, edits and sends the claim again.
    Object.assign(claim, { reason: 'a different claim now', amount: '9000.0000', approvalSnapshotHash: 'hash-after-resend' });
    await assert.rejects(() => approveUC(repo).useCase.execute(ctx(), 'rb-1', undefined, row!.approvalSnapshotHash), /stale_approval_snapshot/);
    assert.deepEqual([decisions.length, claim.status, claim.approvalSteps[0].status], [0, 'PENDING_APPROVAL', 'PENDING']);
    // Having looked at the claim as it is now, the approver approves that.
    assert.equal((await approveUC(repo).useCase.execute(ctx(), 'rb-1', undefined, 'hash-after-resend')).status, 'FINANCE_REVIEW');
    assert.equal(decisions[0].expectedApprovalSnapshotHash, 'hash-after-resend');
  });
});

describe('the stored attestation names one snapshot version (attestation binding)', () => {
  const key = Buffer.alloc(32, 5);
  const kbank = sealPayoutDestination({ payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456789' }, key)!;
  const scb = sealPayoutDestination({ payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountNumber: '000123456789012' }, key)!;
  const when = new Date('2026-10-01T04:00:00.000Z');

  /** A claim, its payout tables and the three moves a claim makes: send, attest, come back to draft. */
  function claimWorld() {
    const tables = fakePayoutTables();
    const db = tables.client;
    const claim: any = { id: 'rb-1', companyId: 'co-1', requesterUserId: 'staff-1', status: 'DRAFT', payoutMethod: null, payoutDestinationVersion: null, payoutFingerprint: null };
    return {
      tables, db, claim,
      setDefault: (destination: typeof kbank) => writeMemberPayoutAccount(db, { companyId: 'co-1', userId: 'staff-1', actorUserId: 'staff-1', payoutMethod: 'BANK_TRANSFER', destination }),
      async send() {
        // The page reads what would be frozen, and the submit transaction freezes exactly that.
        const seenToken = payoutSubmitToken(claim.id, await readSubmitPayoutPlan(db, claim));
        const { columns } = await freezePayoutAtSubmit(db, { ...claim }, { actorUserId: 'staff-1', frozenAt: when, seenToken });
        Object.assign(claim, { status: 'PENDING_APPROVAL' }, columns);
      },
      attest: (verifiedVersion: unknown, approvalStepId = 'step-1') => attestClaimPayout(db, claim, { verifiedVersion, actorUserId: 'approver-1', verifiedAt: when, approvalStepId }),
      async backToDraft() { Object.assign(claim, await draftPayoutAfterReopen(db, claim), { status: 'DRAFT' }); },
      shown: () => readClaimPayout(db, claim),
    };
  }

  it('stores who attested, when, which version and which approval step, on that version row', async () => {
    const world = claimWorld();
    await world.setDefault(kbank);
    await world.send();
    await assert.rejects(world.attest(undefined), /payout_verification_required/);
    await assert.rejects(world.attest(2), /payout_destination_changed/);
    assert.equal((await world.shown())?.verifiedAt, undefined);
    await world.attest(1);
    const row = world.tables.destinations[0]!;
    assert.deepEqual([row.version, row.verifiedByUserId, row.verifiedAt, row.verifiedVia, row.approvalStepId], [1, 'approver-1', when, 'APPROVAL', 'step-1']);
    assert.deepEqual([(await world.shown())?.verifiedByUserId, (await world.shown())?.version], ['approver-1', 1]);
  });

  it('a claim sent again with another account gets a new version: the old attestation no longer counts', async () => {
    const world = claimWorld();
    await world.setDefault(kbank);
    await world.send();
    await world.attest(1);
    // Sent back to draft (finance asked for a correction), the member changes the account, sends again.
    await world.backToDraft();
    await world.setDefault(scb);
    await world.send();
    assert.equal(world.claim.payoutDestinationVersion, 2);
    assert.equal((await world.shown())?.verifiedAt, undefined, 'the new snapshot is unattested');
    // An approver still looking at the old page attests version 1: refused until they attest version 2.
    await assert.rejects(world.attest(1, 'step-2'), /payout_destination_changed/);
    assert.equal((await world.shown())?.verifiedAt, undefined);
    await world.attest(2, 'step-2');
    assert.deepEqual(world.tables.destinations.map((row) => [row.version, row.accountLast4, row.approvalStepId]).sort(), [[1, '6789', 'step-1'], [2, '9012', 'step-2']]);
  });

  it('a claim sent again with the SAME account keeps its version but loses the earlier attestation', async () => {
    const world = claimWorld();
    await world.setDefault(kbank);
    await world.send();
    await world.attest(1);
    await world.backToDraft();
    // While it is a draft, the attestation of the round before is not shown as if it still held.
    assert.equal(world.claim.payoutMethod, null);
    await world.send();
    assert.equal(world.claim.payoutDestinationVersion, 1);
    const row = world.tables.destinations[0]!;
    assert.deepEqual([row.verifiedByUserId, row.verifiedAt, row.verifiedVia, row.approvalStepId], [null, null, null, null]);
    assert.equal((await world.shown())?.verifiedAt, undefined);
    await assert.rejects(world.attest(undefined, 'step-2'), /payout_verification_required/);
    await world.attest(1, 'step-2');
    assert.equal(world.tables.destinations[0]!.approvalStepId, 'step-2');
  });

  it('refuses an attestation when the row behind the version is not the one the claim was hashed with', async () => {
    const world = claimWorld();
    await world.setDefault(kbank);
    await world.send();
    world.claim.payoutFingerprint = scb.fingerprint; // the claim says one account, the row holds another
    await assert.rejects(world.attest(1), /payout_destination_changed/);
    // An account named for the claim that was never frozen cannot be attested either.
    const draft = claimWorld();
    Object.assign(draft.claim, await applyDraftPayout(draft.db, 'co-1', 'rb-1', { mode: 'SPECIFIED', destination: kbank, source: 'REQUESTER', actorUserId: 'staff-1' }), { payoutFingerprint: kbank.fingerprint });
    await assert.rejects(draft.attest(1), /payout_destination_changed/);
  });
});
