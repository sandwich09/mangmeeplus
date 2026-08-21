import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApproveReimbursementUseCase, ListApprovalQueueUseCase, RejectReimbursementUseCase } from './reimbursement-approval.use-case';
import {
  CreateReimbursementDraftUseCase,
  SubmitReimbursementUseCase,
  UpdateReimbursementDraftUseCase,
} from './reimbursement-request.use-case';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';

const noopAudit = { log: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;

function approveUC(repo: any, projections: any = { execute: async () => undefined }, audit: any = noopAudit) {
  return new ApproveReimbursementUseCase(repo, audit, projections);
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

function fakeRepo(req: any, policy: any = null, events: any[] = [], activeApprovers?: string[]) {
  return {
    findRequestById: async () => ({ ...req, payments: [], duplicateCandidates: [], signatures: [], signedCopies: [] }),
    // Audit H-20: named approvers who can still act. Defaults to "all of them", so every existing
    // test keeps the exact-match behaviour it was written for.
    findActiveApproverUserIds: async (_companyId: string, ids: string[]) =>
      new Set(activeApprovers ?? ids),
    findPolicy: async () => policy,
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
    // Default policy requires finance review, so a successful decision parks there.
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
    const uc = approveUC(fakeRepo(req, null, [], []));

    const result = await uc.execute(ctx({ roles: ['OWNER'] }), 'rb-1');

    assert.equal(result.status, 'FINANCE_REVIEW');
  });

  it('still refuses someone who matches neither the departed assignee nor its role', async () => {
    // The fallback widens to the role the step was routed with and OWNER — never to everyone.
    const req = baseRequest({
      approvalSteps: [{ ...baseRequest().approvalSteps[0], approverUserId: 'departed-approver' }],
    });
    const uc = approveUC(fakeRepo(req, null, [], []));
    await assert.rejects(() => uc.execute(ctx({ roles: ['ACCOUNTANT'] }), 'rb-1'), /not_eligible_approver/);
  });

  it('keeps a step exact-match while its named approver is still active', async () => {
    const req = baseRequest({
      approvalSteps: [{ ...baseRequest().approvalSteps[0], approverUserId: 'other-approver' }],
    });
    const uc = approveUC(fakeRepo(req, null, [], ['other-approver']));
    await assert.rejects(() => uc.execute(ctx({ roles: ['OWNER'] }), 'rb-1'), /not_eligible_approver/);
  });

  it('detects a stale snapshot when fields changed after submit', async () => {
    const repo = fakeRepo(baseRequest());
    repo.beginApprovalDecisionAtomic = async () => { throw new Error('stale_approval_snapshot'); };
    const uc = approveUC(repo);
    await assert.rejects(() => uc.execute(ctx(), 'rb-1'), /stale_approval_snapshot/);
  });

  it('approves and routes to FINANCE_REVIEW when finance review required (default)', async () => {
    const req = baseRequest();
    const events: any[] = [];
    const projections = { execute: async () => { throw new Error('finance approval must not project'); } };
    const uc = approveUC(fakeRepo(req, null, events), projections);
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
    const uc = new RejectReimbursementUseCase(fakeRepo(baseRequest()), noopAudit);
    await assert.rejects(() => uc.execute(ctx(), 'rb-1', '  '), /rejection_reason_required/);
  });

  it('rejects with a reason and moves to REJECTED', async () => {
    const req = baseRequest();
    const events: any[] = [];
    const uc = new RejectReimbursementUseCase(fakeRepo(req, null, events), noopAudit);
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
    const uc = new RejectReimbursementUseCase(fakeRepo(req), noopAudit);
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
    id: 'att-1', companyId: 'co-1', originalFileName: 'receipt.pdf', status: 'ACTIVE',
    uploadedByUserId: 'staff-1', ...overrides,
  } as any;
}

function expense(overrides: Partial<any> = {}) {
  return { id: 'exp-1', companyId: 'co-1', createdByUserId: 'staff-1', ...overrides } as any;
}

function evidenceService(attachmentResult: any = null, expenseResult: any = null) {
  return new ReimbursementEvidenceService(
    { findById: async () => attachmentResult, findManyByIds: async () => (attachmentResult ? [attachmentResult] : []) } as any,
    { findById: async () => expenseResult } as any,
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
    id: 'rb-1', companyId: 'co-1', requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'Somchai',
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
  const repo = {
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
    submitDraftAtomic: async ({ expectedUpdatedAt, request: data }: any) => {
      assert.equal(expectedUpdatedAt, request.updatedAt);
      const step = { id: 'step-1' };
      const documentNumber = { id: 'num-1', documentNumber: 'RB-202601-000001' };
      Object.assign(request, data, {
        requestNo: documentNumber.documentNumber,
        currentApprovalStepId: step.id,
        updatedAt: new Date(request.updatedAt.getTime() + 1),
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
  return { repo, get request() { return request; } };
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
      const uc = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(record));
      await assert.rejects(() => uc.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ attachmentId: 'att-1' })] }), /invalid_primary_attachment/);
    });

    it(`rejects ${name} attachment at submit`, async () => {
      const state = requestRepo(draftRequest({ lines: [lineRecord({ attachmentId: 'att-1' })] }));
      const uc = new SubmitReimbursementUseCase(state.repo, noopAudit, noopOutbox, evidenceService(record));
      await assert.rejects(() => uc.execute(requesterCtx(), 'rb-1'), /invalid_primary_attachment/);
    });
  }

  for (const [name, record] of invalidExpenses) {
    it(`rejects ${name} expense at create`, async () => {
      const state = requestRepo();
      const uc = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(null, record));
      await assert.rejects(() => uc.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ linkedExpenseId: 'exp-1' })] }), /invalid_linked_expense/);
    });

    it(`rejects ${name} expense at submit`, async () => {
      const state = requestRepo(draftRequest({ lines: [lineRecord({ linkedExpenseId: 'exp-1' })] }));
      const uc = new SubmitReimbursementUseCase(state.repo, noopAudit, noopOutbox, evidenceService(null, record));
      await assert.rejects(() => uc.execute(requesterCtx(), 'rb-1'), /invalid_linked_expense/);
    });
  }

  it('validates attachment and expense ids supplied by PATCH', async () => {
    const state = requestRepo(draftRequest());
    const updateAttachment = new UpdateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(null));
    await assert.rejects(
      () => updateAttachment.execute(requesterCtx(), 'rb-1', { lines: [inputLine({ attachmentId: 'missing' })] }),
      /invalid_primary_attachment/,
    );
    const updateExpense = new UpdateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(null, null));
    await assert.rejects(
      () => updateExpense.execute(requesterCtx(), 'rb-1', { lines: [inputLine({ linkedExpenseId: 'missing' })] }),
      /invalid_linked_expense/,
    );
  });

  it('passes create to submit with a valid active attachment and returns its file name on the line', async () => {
    const state = requestRepo();
    const evidence = evidenceService(attachment());
    const create = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidence);
    const created = await create.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ attachmentId: 'att-1' })] });
    const events: any[] = [];
    const outbox = { append: async (...args: any[]) => { events.push(args); } } as any;
    const submit = new SubmitReimbursementUseCase(state.repo, noopAudit, outbox, evidence);
    const detail = await submit.execute(requesterCtx(), created.id);
    assert.equal(detail.status, 'PENDING_APPROVAL');
    assert.equal(detail.lines[0]?.attachmentFileName, 'receipt.pdf');
    // The reimbursement_pending_approval workflow template's default condition
    // matches on requestId in the event data — without it, enabled rules never fire.
    const submitted = events.find((e) => e[0] === 'reimbursement.request_submitted');
    assert.equal(submitted?.[3].data.requestId, created.id);
  });

  it('finance submits on the requester\'s behalf with the REQUESTER\'s attachment', async () => {
    const state = requestRepo();
    const evidence = evidenceService(attachment()); // uploadedByUserId: staff-1 = requester
    const create = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidence);
    const created = await create.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ attachmentId: 'att-1' })] });
    const financeCtx = ctx({ userId: 'finance-1', roles: ['FINANCE'], permissions: ['reimbursement.submit', 'reimbursement.finance_review'] });
    const submit = new SubmitReimbursementUseCase(state.repo, noopAudit, noopOutbox, evidence);
    const detail = await submit.execute(financeCtx, created.id);
    assert.equal(detail.status, 'PENDING_APPROVAL');
  });

  it('rejects a PATCH attaching evidence the requester does not own, even by finance', async () => {
    const state = requestRepo();
    const create = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(attachment()));
    const created = await create.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ attachmentId: 'att-1' })] });
    const financeCtx = ctx({ userId: 'finance-1', roles: ['FINANCE'], permissions: ['reimbursement.finance_review'] });
    const update = new UpdateReimbursementDraftUseCase(state.repo, noopAudit, evidenceService(attachment({ uploadedByUserId: 'finance-1' })));
    await assert.rejects(
      () => update.execute(financeCtx, created.id, { lines: [inputLine({ attachmentId: 'att-2' })] }),
      /invalid_primary_attachment/,
    );
  });

  it('rejects submit after PATCH clears the only receipt evidence under requireReceipt', async () => {
    const state = requestRepo();
    const evidence = evidenceService(attachment());
    const create = new CreateReimbursementDraftUseCase(state.repo, noopAudit, evidence);
    const created = await create.execute(requesterCtx(), { ...requestInput, lines: [inputLine({ attachmentId: 'att-1' })] });
    const update = new UpdateReimbursementDraftUseCase(state.repo, noopAudit, evidence);
    await update.execute(requesterCtx(), created.id, { lines: [inputLine({ attachmentId: null })] });
    const submit = new SubmitReimbursementUseCase(state.repo, noopAudit, noopOutbox, evidence);
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
    );
    return { uc, entries };
  }

  it('lets an owner approve their own claim without the policy being opened', async () => {
    const { uc } = auditingUC(baseRequest({ requesterUserId: 'approver-1' }));
    const result = await uc.execute(ctx({ roles: ['OWNER'] }), 'rb-1');
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
      const result = await uc.execute(ctx({ roles: [role] }), 'rb-1');
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

    await uc.execute(ctx({ roles: ['OWNER', 'ACCOUNTANT'] }), 'rb-1');

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
    await uc.execute(ctx({ roles: ['OWNER'] }), 'rb-1');
    assert.equal(auditOf(entries).metadataJson.selfApproval, undefined);
  });
});

describe('ListApprovalQueueUseCase self-approval (audit H-18)', () => {
  function queueRepo(request: any, policy: any = null) {
    return {
      findPolicy: async () => policy,
      listRequests: async () => [request],
      findActiveApproverUserIds: async (_c: string, ids: string[]) => new Set(ids),
    } as any;
  }

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
