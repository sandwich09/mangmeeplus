import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateReimbursementDraftUseCase,
  CancelReimbursementUseCase,
  UpdateReimbursementDraftUseCase,
  SubmitReimbursementUseCase,
  reimbursementPeriodKey,
} from './reimbursement-request.use-case';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';

// Lane C: one claim, many lines. The header total, category and date are a
// server-side rollup of the lines — a client never sends them.

const noopAudit = { log: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;

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
  const attachment = { id: 'att-1', companyId: 'co-1', originalFileName: 'receipt.pdf', status: 'ACTIVE', uploadedByUserId: 'staff-1' };
  return new ReimbursementEvidenceService(
    {
      findById: async ({ id }: any) => ({ ...attachment, id }),
      findManyByIds: async ({ ids }: any) => ids.map((id: string) => ({ ...attachment, id })),
    } as any,
    { findById: async (_c: string, id: string) => ({ id, companyId: 'co-1', createdByUserId: 'staff-1' }) } as any,
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
  const calls = { claimQueries: [] as any[], duplicates: [] as any[], audits: [] as any[], outbox: [] as any[], voided: [] as string[] };
  const repo = {
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
    findRequestById: async (_companyId: string, _id: string, withRelations?: boolean) => (withRelations
      ? { ...request, approvalSteps: [], payments: [], duplicateCandidates: [] }
      : request),
    updateRequest: async (_companyId: string, _id: string, data: any) => { Object.assign(request, data); return request; },
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
    submitDraftAtomic: async ({ expectedUpdatedAt, request: data, duplicateCandidates }: any) => {
      if (options.submitError) throw options.submitError;
      assert.equal(expectedUpdatedAt, request.updatedAt);
      const step = { id: 'step-1' };
      calls.duplicates.push(...duplicateCandidates);
      const documentNumber = { id: 'num-1', documentNumber: 'RB-202601-000001' };
      Object.assign(request, data, {
        requestNo: documentNumber.documentNumber,
        currentApprovalStepId: step.id,
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      return {
        step,
        documentNumber,
        documentNumberReused: options.documentNumberReused ?? false,
        supersededDuplicateCandidateCount: options.supersededDuplicateCandidateCount ?? 0,
        supersededApprovalStepCount: options.supersededApprovalStepCount ?? 0,
      };
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
    submit: new SubmitReimbursementUseCase(state.repo, audit, noopOutbox, evidence),
  };
}

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

describe('SubmitReimbursementUseCase (multi-line)', () => {
  // Policy rows always carry these columns; the fakes mirror that.
  const basePolicy = { currency: 'THB', approvalRequiredFromAmount: '1.00', approverMode: 'MANAGER_ROLE', defaultApproverRole: 'MANAGER', duplicatePolicy: 'WARN', financeReviewRequired: true };
  const requireReceipt = { ...basePolicy, requireReceipt: true, allowMissingReceiptWithReason: true } as any;
  const noReceiptNeeded = { ...basePolicy, requireReceipt: false, allowMissingReceiptWithReason: false } as any;
  // Receipt-less rows may be submitted only with the claim-level reason: the expense projection
  // created at อนุมัติจ่าย confirms on an attachment or that reason, whatever the claim policy says.
  const withReason = { missingReceiptReason: 'ใบเสร็จหาย' };

  async function draftWith(state: any, lines: any[], extra: Record<string, unknown> = {}) {
    await useCases(state).create.execute(ctx(), { reason: 'r', lines, ...extra } as any);
  }

  it('freezes the outstanding amount to the line rollup', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine({ amount: '120' }), inputLine({ lineNo: 2, amount: '80' })], withReason);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(detail.status, 'PENDING_APPROVAL');
    assert.equal(detail.amount, '200.0000');
    assert.equal(state.request.outstandingAmount, '200.0000');
    assert.equal(detail.lines.length, 2);
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
