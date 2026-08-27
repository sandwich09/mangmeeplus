import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateReimbursementDraftUseCase,
  CancelReimbursementUseCase,
  ReopenRejectedReimbursementUseCase,
  UpdateReimbursementDraftUseCase,
  SubmitReimbursementUseCase,
  reimbursementPeriodKey,
} from './reimbursement-request.use-case';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { ROLE_GRANTS } from '../../../auth/permission-registry';
import { compileRole } from '../../../employee-access/domain/logic/capability.logic';
import { filterPermissionsByEntitlement } from '../../../employee-access/domain/logic/feature-gate.logic';
import {
  approverModeForRole,
  buildReimbursementApproverRoleOptions,
  GetReimbursementPolicyUseCase,
  UpdateReimbursementPolicyUseCase,
  type ApproverRoleCandidate,
} from './reimbursement-policy.use-case';

// Lane C: one claim, many lines. The header total, category and date are a
// server-side rollup of the lines — a client never sends them.

const noopAudit = { log: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;
const readyApproverRoutes = {
  resolveNamedSubmissionRoute: async () => null,
  resolveSubmissionRoute: async ({ roleKey }: any) => ({
    responsibilityRole: roleKey, effectiveTaskRole: roleKey,
    recipientUserIds: ['approver-1'], ownerRecipientUserIds: ['owner-1'], ownerFallbackUsed: false,
  }),
} as any;
const noopProjections = { execute: async () => undefined } as any;

function submitUseCase(repo: any, audit: any, outbox: any, evidence: any) {
  return new SubmitReimbursementUseCase(repo, audit, outbox, evidence, readyApproverRoutes, noopProjections);
}

describe('reimbursementPeriodKey', () => {
  it('rolls the month at Bangkok midnight rather than UTC midnight', () => {
    assert.equal(reimbursementPeriodKey(new Date('2026-07-31T16:59:59.999Z')), '2026-07');
    assert.equal(reimbursementPeriodKey(new Date('2026-07-31T17:00:00.000Z')), '2026-08');
  });
});

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'staff-1', companyId: 'co-1',
    membershipId: 'm', roles: ['STAFF'],
    permissions: ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.read_own'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function inputLine(overrides: Partial<any> = {}): any {
  return {
    lineNo: 1, incurredDate: '2026-01-05T00:00:00.000Z', description: 'แท็กซี่ไปหาลูกค้า',
    categoryKey: 'travel', categoryLabel: 'เดินทาง', amount: '100.00', ...overrides,
  };
}

function evidenceService() {
  const attachment = { id: 'att-1', companyId: 'co-1', branchId: 'branch-1', originalFileName: 'receipt.pdf', status: 'ACTIVE', uploadedByUserId: 'staff-1' };
  return new ReimbursementEvidenceService(
    {
      findById: async ({ id }: any) => ({ ...attachment, id }),
      findManyByIds: async ({ ids }: any) => ids.map((id: string) => ({ ...attachment, id })),
    } as any,
    { findById: async (_c: string, id: string) => ({ id, companyId: 'co-1', branchId: 'branch-1', createdByUserId: 'staff-1' }) } as any,
  );
}

type RepoOptions = {
  policy?: Record<string, unknown> | null;
  claimedElsewhere?: { lineNo: number; attachmentId?: string; linkedExpenseId?: string; requestNo?: string }[];
  duplicateCandidates?: any[];
  status?: string;
  submitError?: Error;
  documentNumberReused?: boolean;
  supersededDuplicateCandidateCount?: number;
  supersededApprovalStepCount?: number;
  /** Expense projections a cancellation has to void before the claim may close. */
  claimProjections?: Array<{ id: string; sourceReimbursementLineId: string; status?: string }>;
};

/** Captures the outbox rows a two-phase repository method writes inside its transaction. */
function fakeTx(rows: any[]) {
  return { outboxEvent: { createMany: async ({ data }: any) => { rows.push(...data); return { count: data.length }; } } };
}

function fakeRepo(options: RepoOptions = {}) {
  let request: any = null;
  const projections = (options.claimProjections ?? []).map((projection) => ({ status: 'CONFIRMED', ...projection }));
  const calls = {
    claimQueries: [] as any[], duplicates: [] as any[], audits: [] as any[], outbox: [] as any[],
    approvalSteps: [] as any[], voided: [] as string[], projections: [] as any[],
  };
  const repo = {
    resolveCreateBranchId: async () => 'branch-1',
    findPolicy: async () => options.policy ?? null,
    getUserDisplayName: async () => 'Somchai',
    // Lane D: the detail path resolves approver/reviewer/payer names in one batch.
    getUserDisplayNames: async () => ({}),
    // Lane F: the detail path also lists uploaded scans of the signed claim form.
    listSignedClaimFormCopies: async () => [],
    createRequest: async (data: any) => {
      request = {
        id: 'rb-1', status: options.status ?? 'DRAFT', requesterUserId: data.requesterUserId,
        paymentTotalAmount: '0.0000', outstandingAmount: data.amount, duplicateStatus: 'NOT_CHECKED',
        financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID', postingStatus: 'not_required',
        createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...data,
        lines: data.lines.map((line: any, index: number) => ({ ...line, id: `rbl-${index + 1}`, companyId: data.companyId, reimbursementRequestId: 'rb-1' })),
      };
      return request;
    },
    updateDraftRequest: async (companyId: string, id: string, expectedUpdatedAt: Date, data: any, lines?: any[]) => {
      assert.equal(expectedUpdatedAt, request.updatedAt);
      Object.assign(request, data, { updatedAt: new Date(request.updatedAt.getTime() + 1) });
      if (lines) request.lines = lines.map((line: any, index: number) => ({
        ...line, id: `rbl-${index + 1}`, companyId, reimbursementRequestId: id,
      }));
      return request;
    },
    findRequestById: async (companyId: string, id: string, withRelations?: boolean) => request?.companyId !== companyId || request?.id !== id
      ? null : withRelations ? { ...request, approvalSteps: [], payments: [], duplicateCandidates: [] } : request,
    updateRequest: async (_companyId: string, _id: string, data: any) => { Object.assign(request, data); return request; },
    reopenRejectedRequest: async (_companyId: string, _id: string, expectedUpdatedAt: Date, actorUserId: string) => {
      assert.equal(expectedUpdatedAt, request.updatedAt);
      if (request.status !== 'REJECTED') throw new Error('reimbursement_changed');
      Object.assign(request, {
        status: 'DRAFT', rejectedAt: null, rejectionReason: null, approvalSnapshotHash: null,
        updatedByUserId: actorUserId, updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      return request;
    },
    // Cancellation is two-phase since d1d3b23e: the intent commits first, every claim expense
    // projection is voided outside the transaction, and only a claim with no live projection may
    // close. Both fakes keep the repository's guards so the spec still proves that order.
    listClaimProjections: async () => projections,
    beginCancellationAtomic: async (data: any) => {
      assert.equal(data.expectedStatus, request.status);
      assert.equal(data.expectedUpdatedAt, request.updatedAt);
      if (request.cancellationPendingAt) return { request, resumed: true };
      if (request.paymentStatus === 'PAID' || request.paymentStatus === 'PARTIALLY_PAID') {
        throw new Error('reimbursement_cancellation_has_payment');
      }
      Object.assign(request, {
        cancellationPendingAt: data.startedAt,
        cancellationPendingByUserId: data.actorUserId,
        cancellationPendingReason: data.reason,
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await data.onIntentPersisted(fakeTx(calls.outbox));
      return { request, resumed: false };
    },
    completeCancellationAtomic: async (data: any) => {
      if (!request.cancellationPendingAt || request.cancellationPendingByUserId !== data.actorUserId) {
        throw new Error('reimbursement_cancellation_intent_changed');
      }
      if (projections.some((projection) => projection.status !== 'VOIDED')) {
        throw new Error('reimbursement_cancellation_projection_live');
      }
      Object.assign(request, {
        status: 'CANCELLED',
        cancelledAt: data.completedAt,
        rejectionReason: request.cancellationPendingReason,
        paymentStatus: 'NOT_PAYABLE',
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await data.onCancelledPersisted(fakeTx(calls.outbox));
      return request;
    },
    findLinesClaimedElsewhere: async (companyId: string, excludeId: string, attachmentIds: string[], expenseIds: string[]) => {
      calls.claimQueries.push({ companyId, excludeId, attachmentIds, expenseIds });
      return options.claimedElsewhere ?? [];
    },
    findDuplicateCandidates: async () => options.duplicateCandidates ?? [],
    createDuplicateCandidate: async (data: any) => { calls.duplicates.push(data); },
    createApprovalStep: async () => ({ id: 'step-1' }),
    submitDraftAtomic: async ({ expectedUpdatedAt, request: data, duplicateCandidates, approvalStep, onSubmittedPersisted }: any) => {
      if (options.submitError) throw options.submitError;
      assert.equal(expectedUpdatedAt, request.updatedAt);
      const step = approvalStep ? {
        id: 'step-1', ...approvalStep,
        assignedApproverUserIds: approvalStep.assignedApproverUserIdsJson,
      } : undefined;
      if (step) calls.approvalSteps.push(step);
      calls.duplicates.push(...duplicateCandidates);
      const documentNumber = { id: 'num-1', documentNumber: 'RB-202601-000001' };
      Object.assign(request, data, {
        requestNo: documentNumber.documentNumber,
        currentApprovalStepId: step?.id ?? null,
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await onSubmittedPersisted(fakeTx(calls.outbox), {
        step, documentNumber, documentNumberReused: options.documentNumberReused ?? false,
        supersededDuplicateCandidateCount: options.supersededDuplicateCandidateCount ?? 0,
        supersededApprovalStepCount: options.supersededApprovalStepCount ?? 0,
      });
      return {
        step,
        documentNumber,
        documentNumberReused: options.documentNumberReused ?? false,
        supersededDuplicateCandidateCount: options.supersededDuplicateCandidateCount ?? 0,
        supersededApprovalStepCount: options.supersededApprovalStepCount ?? 0,
      };
    },
    completePolicyProjectionAtomic: async (data: any) => {
      Object.assign(request, {
        status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID',
        postingStatus: 'pending', currentApprovalStepId: null, currentApproverUserId: null,
      });
      await data.onReadyPersisted(fakeTx(calls.outbox));
      return request;
    },
  } as any;
  // Voiding a projection is what makes it safe to close the claim, so the fake really flips it.
  const voidExpense = {
    executeForReimbursement: async (_ctx: any, expenseId: string) => {
      calls.voided.push(expenseId);
      const projection = projections.find((row) => row.id === expenseId);
      if (projection) projection.status = 'VOIDED';
    },
  } as any;
  return { repo, calls, voidExpense, projections, get request() { return request; } };
}

function useCases(state: { repo: any; calls?: { audits: any[] } }) {
  const evidence = evidenceService();
  const audit = state.calls
    ? { log: async (data: any) => { state.calls!.audits.push(data); } } as any
    : noopAudit;
  return {
    create: new CreateReimbursementDraftUseCase(state.repo, audit, evidence),
    update: new UpdateReimbursementDraftUseCase(state.repo, audit, evidence),
    submit: new SubmitReimbursementUseCase(
      state.repo, audit, noopOutbox, evidence, readyApproverRoutes,
      { execute: async (...args: any[]) => { (state.calls as any)?.projections?.push(args); } } as any,
    ),
  };
}

describe('every company role own reimbursement journey', () => {
  const roles = { ...ROLE_GRANTS, CUSTOM_READONLY: compileRole({ entitledFeatureKeys: null }).permissionKeys };
  for (const [role, permissions] of Object.entries(roles).filter(([key]) => key !== 'SYSTEM_ADMIN')) {
    it(`${role} creates, attaches evidence, updates and submits its own draft`, async () => {
      const state = fakeRepo();
      const cases = useCases(state);
      const caller = ctx({ roles: [role], permissions });
      assert.ok(permissions.includes('attachment.create'));
      assert.ok(permissions.includes('company.branch.read'));
      const created = await cases.create.execute(caller, { reason: 'เดินทาง', branchId: 'branch-1', lines: [inputLine()] } as any);
      assert.equal(created.requesterUserId, caller.userId);
      await cases.update.execute(caller, created.id, { lines: [inputLine({ attachmentId: 'att-1' })] });
      const submitted = await cases.submit.execute(caller, created.id);
      assert.equal(submitted.status, 'PENDING_APPROVAL');
      assert.equal(state.request.submittedByUserId, caller.userId);
      assert.equal(state.calls.approvalSteps[0].assignedApproverUserIds.includes(caller.userId), false);
    });
  }

  it('keeps custom self service own-only, branch scoped and feature gated at create and submit', async () => {
    const state = fakeRepo();
    const cases = useCases(state);
    const own = ctx({ roles: ['CUSTOM_READONLY'], permissions: roles.CUSTOM_READONLY, scopes: { branchIds: ['branch-1'] } });
    const created = await cases.create.execute(own, { branchId: 'branch-1', reason: 'เดินทาง', lines: [inputLine({ attachmentId: 'att-1' })] } as any);
    const other = { ...own, userId: 'other-user' };
    await assert.rejects(() => cases.update.execute(other, created.id, { reason: 'not mine' }), /Cannot update/);
    await assert.rejects(() => cases.submit.execute(other, created.id), /Only the requester/);
    await assert.rejects(() => cases.submit.execute({ ...own, companyId: 'co-2' }, created.id), /not found/);
    await assert.rejects(() => cases.submit.execute({ ...own, scopes: { branchIds: ['branch-2'] } }, created.id), /branch/i);
    const off = { ...own, permissions: filterPermissionsByEntitlement(own.permissions, new Set()) };
    await assert.rejects(() => cases.create.execute(off, { reason: 'เดินทาง', lines: [inputLine()] } as any), /Missing permission/);
    await assert.rejects(() => cases.submit.execute(off, created.id), /Missing permission/);
    assert.equal(state.request.status, 'DRAFT');
    assert.equal(state.calls.approvalSteps.length, 0);
  });
});

describe('CreateReimbursementDraftUseCase (multi-line)', () => {
  it('rolls the header up from the lines instead of trusting the client', async () => {
    const state = fakeRepo();
    const created = await useCases(state).create.execute(ctx(), {
      reason: 'ไปพบลูกค้า 2 วัน',
      lines: [
        inputLine({ lineNo: 1, amount: '100.50', incurredDate: '2026-01-05T00:00:00.000Z' }),
        inputLine({ lineNo: 2, amount: '249.50', incurredDate: '2026-01-03T00:00:00.000Z', description: 'ที่พัก', categoryKey: 'accommodation', categoryLabel: 'ที่พัก' }),
      ],
    } as any);

    assert.equal(created.amount, '350.0000');
    assert.equal(created.lineCount, 2);
    // Mixed categories: line 1's key, and a label naming the row count.
    assert.equal(created.categoryKey, 'travel');
    assert.equal(created.categoryLabelSnapshot, 'หลายหมวด (2 รายการ)');
    // Earliest line date wins for the header.
    assert.equal(created.incurredDate, '2026-01-03T00:00:00.000Z');
    assert.equal(state.request.outstandingAmount, '350.0000');
  });

  it('keeps the single-category label when every line shares a category', async () => {
    const state = fakeRepo();
    const created = await useCases(state).create.execute(ctx(), {
      reason: 'เดินทาง',
      lines: [inputLine({ lineNo: 1, amount: '10' }), inputLine({ lineNo: 2, amount: '20' })],
    } as any);
    assert.equal(created.categoryLabelSnapshot, 'เดินทาง');
    assert.equal(created.amount, '30.0000');
  });

  it('normalizes line money to satang before storing the line and header', async () => {
    const state = fakeRepo();
    const created = await useCases(state).create.execute(ctx(), {
      reason: 'ปัดเศษตามเอกสาร',
      lines: [inputLine({ amount: '10.0050' })],
    } as any);
    assert.equal(created.amount, '10.0100');
    assert.equal(state.request.lines[0].amount, '10.0100');
  });

  it('rejects a value that rounds to zero or exceeds Decimal(18,4)', async () => {
    for (const [amount, code] of [
      ['0.0049', 'line_amount_must_be_positive'],
      ['99999999999999.9999', 'amount_exceeds_limit'],
    ]) {
      const state = fakeRepo();
      await assert.rejects(
        () => useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine({ amount })] } as any),
        new RegExp(code),
      );
    }
  });

  it('rejects a claim with no lines', async () => {
    const state = fakeRepo();
    await assert.rejects(
      () => useCases(state).create.execute(ctx(), { reason: 'r', lines: [] } as any),
      /lines_required/,
    );
  });

  it('rejects a claim whose lines exceed the 50-row cap', async () => {
    const state = fakeRepo();
    const lines = Array.from({ length: 51 }, (_v, i) => inputLine({ lineNo: i + 1 }));
    await assert.rejects(
      () => useCases(state).create.execute(ctx(), { reason: 'r', lines } as any),
      /too_many_lines/,
    );
  });

  it('rejects a claim without the create permission', async () => {
    const state = fakeRepo();
    await assert.rejects(
      () => useCases(state).create.execute(ctx({ permissions: [] }), { reason: 'r', lines: [inputLine()] } as any),
      /permission/i,
    );
  });
});

describe('UpdateReimbursementDraftUseCase (multi-line)', () => {
  it('replaces the lines wholesale and recomputes the rollup', async () => {
    const state = fakeRepo();
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine({ amount: '100' }), inputLine({ lineNo: 2, amount: '100' })] } as any);
    const updated = await uc.update.execute(ctx(), 'rb-1', { lines: [inputLine({ amount: '75.25' })] } as any);

    assert.equal(updated.amount, '75.2500');
    assert.equal(state.request.lines.length, 1);
    assert.equal(state.request.outstandingAmount, '75.2500');
  });

  it('rejects an update that empties the lines', async () => {
    const state = fakeRepo();
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    await assert.rejects(() => uc.update.execute(ctx(), 'rb-1', { lines: [] } as any), /lines_required/);
  });

  it('leaves the lines untouched when the body omits them', async () => {
    const state = fakeRepo();
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine({ amount: '42' })] } as any);
    const updated = await uc.update.execute(ctx(), 'rb-1', { title: 'ใบเบิกเดือนมกราคม' } as any);
    assert.equal(updated.amount, '42.0000');
    assert.equal(state.request.lines.length, 1);
  });
});

describe('CancelReimbursementUseCase', () => {
  it('passes the observed status and version to the atomic cancellation transition', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense);
    const result = await cancel.execute(ctx({ permissions: ['reimbursement.cancel_own'] }), 'rb-1', 'ไม่ใช้แล้ว');
    assert.equal(result.status, 'CANCELLED');
    assert.equal(state.request.rejectionReason, 'ไม่ใช้แล้ว');
    assert.equal(state.request.paymentStatus, 'NOT_PAYABLE');
    // Both phases are durable: intent first, cancellation only after the projections are gone.
    assert.deepEqual(state.calls.outbox.map((row: any) => row.eventType), [
      'reimbursement.cancellation_started', 'reimbursement.cancelled',
    ]);
  });

  it('voids every claim expense projection before the claim closes', async () => {
    const state = fakeRepo({ claimProjections: [
      { id: 'exp-1', sourceReimbursementLineId: 'rbl-1' },
      { id: 'exp-2', sourceReimbursementLineId: 'rbl-2' },
    ] });
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense);
    const result = await cancel.execute(ctx({ permissions: ['reimbursement.cancel_own'] }), 'rb-1', 'ไม่ใช้แล้ว');
    assert.equal(result.status, 'CANCELLED');
    assert.deepEqual(state.calls.voided, ['exp-1', 'exp-2']);
  });

  it('allows an authorized finance reviewer to cancel a non-owned request', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense);
    const result = await cancel.execute(ctx({ userId: 'finance-1', permissions: ['reimbursement.finance_review'] }), 'rb-1', 'ยกเลิกหลังกลับรายการจ่าย');
    assert.equal(result.status, 'CANCELLED');
    assert.equal(state.request.rejectionReason, 'ยกเลิกหลังกลับรายการจ่าย');
  });

  it('refuses to close the claim when a projection survives the void', async () => {
    const state = fakeRepo({ claimProjections: [{ id: 'exp-1', sourceReimbursementLineId: 'rbl-1' }] });
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    // A void that silently no-ops must not let an expense outlive its cancelled claim.
    const brokenVoid = { executeForReimbursement: async () => undefined } as any;
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, brokenVoid);
    await assert.rejects(
      () => cancel.execute(ctx({ permissions: ['reimbursement.cancel_own'] }), 'rb-1', 'ไม่ใช้แล้ว'),
      /reimbursement_cancellation_projection_live/,
    );
    assert.notEqual(state.request.status, 'CANCELLED');
    assert.ok(state.request.cancellationPendingAt, 'the intent stays pending so a retry can finish it');
  });
});

describe('ReopenRejectedReimbursementUseCase', () => {
  it('reopens a rejected claim as a draft and clears the request-level rejection fields', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    Object.assign(state.request, { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: 'ยอดไม่ตรงกับใบเสร็จ', requestNo: 'RB-202601-000001' });
    const reopen = new ReopenRejectedReimbursementUseCase(state.repo, noopAudit);
    const result = await reopen.execute(ctx(), 'rb-1');
    assert.equal(result.status, 'DRAFT');
    assert.equal(state.request.rejectionReason, null);
    assert.equal(state.request.rejectedAt, null);
    // The document number survives the reopen so resubmission reuses it.
    assert.equal(state.request.requestNo, 'RB-202601-000001');
  });

  it('refuses reopen for non-requesters without finance review and for non-rejected claims', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const reopen = new ReopenRejectedReimbursementUseCase(state.repo, noopAudit);
    await assert.rejects(() => reopen.execute(ctx(), 'rb-1'), /Cannot reopen from status DRAFT/);
    Object.assign(state.request, { status: 'REJECTED' });
    await assert.rejects(
      () => reopen.execute(ctx({ userId: 'someone-else', permissions: ['reimbursement.update_own_draft'] }), 'rb-1'),
      /Cannot reopen this reimbursement/,
    );
  });
});

describe('SubmitReimbursementUseCase (multi-line)', () => {
  // Policy rows always carry these columns; the fakes mirror that.
  const basePolicy = {
    id: 'policy-1', updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    currency: 'THB', approvalRequiredFromAmount: '1.00', approverMode: 'MANAGER_ROLE',
    defaultApproverRole: 'MANAGER', allowSelfApproval: false, duplicatePolicy: 'WARN',
    financeReviewRequired: true, status: 'ACTIVE',
  };
  const requireReceipt = { ...basePolicy, requireReceipt: true, allowMissingReceiptWithReason: true } as any;
  const noReceiptNeeded = { ...basePolicy, requireReceipt: false, allowMissingReceiptWithReason: false } as any;
  // Receipt-less rows may be submitted only with the claim-level reason: the expense projection
  // created at อนุมัติจ่าย confirms on an attachment or that reason, whatever the claim policy says.
  const withReason = { missingReceiptReason: 'ใบเสร็จหาย' };

  async function draftWith(state: any, lines: any[], extra: Record<string, unknown> = {}) {
    await useCases(state).create.execute(ctx(), { reason: 'r', lines, ...extra } as any);
  }

  it('freezes exact approver recipients on a human approval step', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine({ amount: '1.00' })], withReason);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'PENDING_APPROVAL');
    assert.deepEqual(state.calls.approvalSteps[0]?.assignedApproverUserIdsJson, ['approver-1']);
  });

  it('skips human approval below threshold and enters finance review when configured', async () => {
    const state = fakeRepo({ policy: { ...noReceiptNeeded, approvalRequiredFromAmount: '100.00' } });
    await draftWith(state, [inputLine({ amount: '99.99' })], withReason);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'FINANCE_REVIEW');
    assert.equal(state.request.financeReviewStatus, 'PENDING');
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.ok(state.calls.outbox.some((event: any) => event.eventType === 'reimbursement.approval_not_required'));
    assert.ok(state.calls.outbox.some((event: any) => event.eventType === 'reimbursement.finance_review_requested'));
  });

  it('reaches ready-for-payment through POLICY projection below threshold when finance is off', async () => {
    const state = fakeRepo({ policy: {
      ...noReceiptNeeded, approvalRequiredFromAmount: '100.00', financeReviewRequired: false,
    } });
    await draftWith(state, [inputLine({ amount: '99.99' })], withReason);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'READY_FOR_PAYMENT');
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.equal(state.calls.projections[0]?.[2]?.kind, 'POLICY');
    assert.ok(state.calls.outbox.some((event: any) => event.eventType === 'reimbursement.ready_for_payment'));
  });

  it('blocks INACTIVE policy before submit mutation', async () => {
    const state = fakeRepo({ policy: { ...noReceiptNeeded, status: 'INACTIVE' } });
    await draftWith(state, [inputLine()], withReason);

    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /reimbursement_policy_inactive/);
    assert.equal(state.request.status, 'DRAFT');
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.equal(state.calls.outbox.length, 0);
  });

  it('freezes the outstanding amount to the line rollup', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine({ amount: '120' }), inputLine({ lineNo: 2, amount: '80' })], withReason);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(detail.status, 'PENDING_APPROVAL');
    assert.equal(detail.amount, '200.0000');
    assert.equal(state.request.outstandingAmount, '200.0000');
    assert.equal(detail.lines.length, 2);
  });

  it('clears the prior finance correction decision when the corrected draft is resubmitted', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine()], withReason);
    Object.assign(state.request, {
      financeReviewStatus: 'NEEDS_INFO',
      financeReviewedByUserId: 'finance-1',
      financeReviewedAt: new Date('2026-01-02T00:00:00.000Z'),
      financeReviewNote: 'แก้ยอด',
      approvedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.financeReviewStatus, 'NOT_REQUIRED');
    assert.equal(state.request.financeReviewedByUserId, null);
    assert.equal(state.request.financeReviewedAt, null);
    assert.equal(state.request.financeReviewNote, null);
    assert.equal(state.request.approvedAt, null);
  });

  it('emits document-number audits only after the atomic submit succeeds', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    state.calls.audits.length = 0;
    await uc.submit.execute(ctx(), 'rb-1');
    assert.deepEqual(
      state.calls.audits
        .map((entry: any) => entry.action)
        .filter((action: string) => action.startsWith('document.number.')),
      ['document.number.reserve', 'document.number.commit'],
    );

    const failed = fakeRepo({ policy: noReceiptNeeded, submitError: new Error('transaction_failed') });
    const failedUc = useCases(failed);
    await failedUc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    failed.calls.audits.length = 0;
    await assert.rejects(() => failedUc.submit.execute(ctx(), 'rb-1'), /transaction_failed/);
    assert.equal(failed.calls.audits.some((entry: any) => entry.action.startsWith('document.number.')), false);

    const reused = fakeRepo({ policy: noReceiptNeeded, documentNumberReused: true });
    const reusedUc = useCases(reused);
    await reusedUc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    reused.calls.audits.length = 0;
    await reusedUc.submit.execute(ctx(), 'rb-1');
    assert.equal(reused.calls.audits.some((entry: any) => entry.action.startsWith('document.number.')), false);

    const healed = fakeRepo({
      policy: noReceiptNeeded,
      documentNumberReused: true,
      supersededDuplicateCandidateCount: 2,
      supersededApprovalStepCount: 1,
    });
    const healedUc = useCases(healed);
    await healedUc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    healed.calls.audits.length = 0;
    await healedUc.submit.execute(ctx(), 'rb-1');
    const submitAudit = healed.calls.audits.find((entry: any) => entry.action === 'reimbursement.request.submit');
    assert.deepEqual(submitAudit.metadataJson.legacyRecovery, {
      documentNumberReused: true,
      supersededDuplicateCandidateCount: 2,
      supersededApprovalStepCount: 1,
    });
  });

  it('blocks submit when one line of several has no receipt', async () => {
    const state = fakeRepo({ policy: requireReceipt });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2 })]);
    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /missing_receipt/);
  });

  // BUG-7: without the reason the claim's expense projection can never be confirmed, and the
  // finance approval that materializes it is already durable when that fails — the claim would
  // sit at FINANCE_REVIEW forever. A waive policy does not exempt it.
  it('blocks submit when a line carries no receipt and the claim carries no reason', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2 })]);
    await assert.rejects(
      () => useCases(state).submit.execute(ctx(), 'rb-1'),
      /missing_receipt_reason_required/,
    );
    assert.equal(state.request.status, 'DRAFT', 'the claim stays a draft the requester can fix');
  });

  it('submits the same receipt-less claim once the reason is filled in', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine(), inputLine({ lineNo: 2 })], withReason);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');
    assert.equal(detail.status, 'PENDING_APPROVAL');
    assert.equal(detail.receiptRequirementStatus, 'WAIVED_BY_POLICY');
    assert.equal(detail.missingReceiptReason, 'ใบเสร็จหาย');
  });

  it('accepts a claim-level reason covering several missing receipts', async () => {
    const state = fakeRepo({ policy: requireReceipt });
    await draftWith(state, [inputLine(), inputLine({ lineNo: 2 })], { missingReceiptReason: 'ใบเสร็จหาย' });
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');
    assert.equal(detail.receiptRequirementStatus, 'MISSING_WITH_REASON');
  });

  it('marks the claim ATTACHED when every line is evidenced by receipt or linked expense', async () => {
    const state = fakeRepo({ policy: requireReceipt });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2, linkedExpenseId: 'exp-1' })]);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');
    assert.equal(detail.receiptRequirementStatus, 'ATTACHED');
  });

  it('rejects an expense already claimed by another live claim', async () => {
    const state = fakeRepo({ claimedElsewhere: [{ lineNo: 1, linkedExpenseId: 'exp-1', requestNo: 'RB-202601-000009' }] });
    await draftWith(state, [inputLine({ linkedExpenseId: 'exp-1' })]);
    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /expense_already_claimed/);
  });

  it('rejects an attachment already claimed by another live claim', async () => {
    const state = fakeRepo({ claimedElsewhere: [{ lineNo: 2, attachmentId: 'att-1', requestNo: 'RB-202601-000009' }] });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' })]);
    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /attachment_already_claimed/);
  });

  it('asks only about this claim\'s evidence, excluding itself', async () => {
    const state = fakeRepo();
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2, linkedExpenseId: 'exp-2' })]);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.deepEqual(state.calls.claimQueries, [{
      companyId: 'co-1', excludeId: 'rb-1', attachmentIds: ['att-1'], expenseIds: ['exp-2'],
    }]);
  });

  it('records a duplicate candidate naming the line that shares a receipt', async () => {
    const state = fakeRepo({
      duplicateCandidates: [{
        id: 'rb-9', requestNo: 'RB-202601-000009', requesterUserId: 'staff-1', amount: '100.0000', currency: 'THB',
        incurredDate: new Date('2026-01-05T00:00:00.000Z'), categoryKey: 'travel', reason: 'r',
        lines: [{ lineNo: 1, attachmentId: 'att-1' }],
      }],
    });
    await draftWith(state, [inputLine({ attachmentId: 'att-2' }), inputLine({ lineNo: 2, attachmentId: 'att-1' })]);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(detail.duplicateStatus, 'POSSIBLE_DUPLICATE');
    assert.equal(state.calls.duplicates.length, 1);
    assert.equal(state.calls.duplicates[0].candidateType, 'ATTACHMENT_CHECKSUM');
    assert.equal(state.calls.duplicates[0].candidateAttachmentId, 'att-1');
    assert.match(state.calls.duplicates[0].reason, /line 2/);
  });
});

const approverPermissions = ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'];
const approverBranches = [{ id: 'b1', name: 'สำนักงานใหญ่' }, { id: 'b2', name: 'สาขาสอง' }];
const approverHolder = (branchIds: string[]): ApproverRoleCandidate['holders'][number] => ({
  branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: null, branchIds,
});
const approverRole = (
  overrides: Partial<ApproverRoleCandidate> & Pick<ApproverRoleCandidate, 'key' | 'name'>,
): ApproverRoleCandidate => ({
  status: 'ACTIVE', permissionKeys: approverPermissions, holders: [], ...overrides,
});

describe('reimbursement approver role options', () => {
  it('returns only executable routes as selectable and uses OWNER for safe branch recovery', () => {
    const options = buildReimbursementApproverRoleOptions([
      approverRole({ key: 'OWNER', name: 'Owner', holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'MANAGER', name: 'Manager', holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'ACCOUNTANT', name: 'Accountant', holders: [approverHolder(['b1'])] }),
      approverRole({ key: 'FINANCE', name: 'Finance', holders: [] }),
      approverRole({ key: 'STAFF', name: 'Staff', permissionKeys: ['reimbursement.read'], holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'SYSTEM_ADMIN', name: 'System Admin', holders: [approverHolder(['b1', 'b2'])] }),
    ], approverBranches);

    assert.equal(options.find((item) => item.key === 'MANAGER')?.coverage, 'COMPLETE');
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, true);
    assert.deepEqual(options.find((item) => item.key === 'ACCOUNTANT')?.uncoveredBranchNames, ['สาขาสอง']);
    assert.equal(options.find((item) => item.key === 'ACCOUNTANT')?.coverage, 'PARTIAL');
    assert.equal(options.find((item) => item.key === 'ACCOUNTANT')?.selectable, true);
    assert.equal(options.find((item) => item.key === 'FINANCE')?.unavailableReason, 'NO_ACTIVE_HOLDERS');
    assert.equal(options.find((item) => item.key === 'STAFF')?.unavailableReason, 'MISSING_CAPABILITY');
    assert.equal(options.some((item) => item.key === 'SYSTEM_ADMIN'), false);
  });

  it('blocks partial coverage when OWNER cannot recover the uncovered branch', () => {
    const options = buildReimbursementApproverRoleOptions([
      approverRole({ key: 'OWNER', name: 'Owner', holders: [approverHolder(['b1'])] }),
      approverRole({ key: 'MANAGER', name: 'Manager', holders: [approverHolder(['b1'])] }),
    ], approverBranches);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, false);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.unavailableReason, 'OWNER_RECOVERY_NOT_READY');
  });

  it('does not use OWNER as recovery when the role lacks approval capability', () => {
    const options = buildReimbursementApproverRoleOptions([
      approverRole({ key: 'OWNER', name: 'Owner', permissionKeys: ['reimbursement.read'], holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'MANAGER', name: 'Manager', holders: [approverHolder(['b1'])] }),
    ], approverBranches);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, false);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.unavailableReason, 'OWNER_RECOVERY_NOT_READY');
  });

  it('maps the selected role to the server-owned routing mode', () => {
    assert.equal(approverModeForRole('MANAGER'), 'MANAGER_ROLE');
    assert.equal(approverModeForRole('OWNER'), 'OWNER_ROLE');
    assert.equal(approverModeForRole('ACCOUNTANT'), 'CUSTOM_ROLE');
  });
});

describe('reimbursement policy role save', () => {
  const policyCtx = {
    companyId: 'co-1', userId: 'user-1', requestId: 'req-1',
    permissions: ['reimbursement.policy.manage'],
  } as any;
  const option = {
    key: 'ACCOUNTANT', name: 'Accountant', optionLabel: 'Accountant',
    eligibleApproverCount: 1, coverage: 'COMPLETE' as const, uncoveredBranchNames: [], selectable: true,
  };
  const policy = (data: Record<string, unknown>) => ({
    id: 'policy-1', companyId: 'co-1', currency: 'THB', approvalThresholdAmount: '1.00',
    approvalRequiredFromAmount: '1.00', approverMode: 'CUSTOM_ROLE', defaultApproverRole: 'ACCOUNTANT',
    allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false,
    duplicatePolicy: 'WARN', financeReviewRequired: true, status: 'ACTIVE', createdByUserId: 'user-1',
    createdAt: new Date('2026-08-21T00:00:00.000Z'), updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    ...data,
  });

  it('lets policy managers read the form they are allowed to save', async () => {
    const useCase = new GetReimbursementPolicyUseCase({ findPolicy: async () => policy({}) } as any);
    const result = await useCase.execute(policyCtx);
    assert.equal(result.id, 'policy-1');
  });

  it('revalidates and canonicalizes an explicit role edit before writing', async () => {
    let written: Record<string, unknown> | undefined;
    const repo = {
      findPolicy: async () => null,
      upsertPolicy: async (_companyId: string, _branchId: null, data: Record<string, unknown>) => {
        written = data;
        return policy(data);
      },
    };
    const useCase = new UpdateReimbursementPolicyUseCase(
      repo as any, { log: async () => undefined } as any,
      { load: async () => [option] } as any,
    );

    await useCase.execute(policyCtx, { defaultApproverRole: ' ACCOUNTANT ' });
    assert.deepEqual(written, {
      defaultApproverRole: 'ACCOUNTANT', approverMode: 'CUSTOM_ROLE', defaultApproverUserId: null,
    });
  });

  it('rejects a stale or ineligible role without writing the policy', async () => {
    let wrote = false;
    const useCase = new UpdateReimbursementPolicyUseCase(
      { findPolicy: async () => null, upsertPolicy: async () => { wrote = true; return policy({}); } } as any,
      { log: async () => undefined } as any,
      { load: async () => [{ ...option, selectable: false }] } as any,
    );

    await assert.rejects(useCase.execute(policyCtx, { defaultApproverRole: 'ACCOUNTANT' }), /approver_role_not_eligible/);
    assert.equal(wrote, false);
  });

  it('persists audit and policy-updated outbox facts in the policy transaction', async () => {
    const outboxRows: any[] = [];
    const audits: any[] = [];
    const saved = policy({});
    const repo = {
      findPolicy: async () => null,
      upsertPolicy: async (
        _companyId: string, _branchId: null, _data: Record<string, unknown>, _userId: string,
        _expectedUpdatedAt: Date | undefined, onPersisted: (tx: any, before: null, after: any) => Promise<void>,
      ) => {
        await onPersisted({ outboxEvent: { createMany: async ({ data }: any) => { outboxRows.push(...data); } } }, null, saved);
        return saved;
      },
    };
    const useCase = new UpdateReimbursementPolicyUseCase(
      repo as any,
      { log: async (entry: any, tx: any) => { assert.ok(tx); audits.push(entry); } } as any,
      { load: async () => [option] } as any,
    );

    await useCase.execute(policyCtx, { defaultApproverRole: 'ACCOUNTANT' });
    assert.equal(audits[0]?.action, 'reimbursement.policy.update');
    assert.equal(outboxRows[0]?.eventType, 'reimbursement.policy_updated');
    assert.equal(outboxRows[0]?.aggregateId, 'policy-1');
  });
});
