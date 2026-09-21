import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecordReimbursementPaymentUseCase, FinanceReviewReimbursementUseCase, ExportReimbursementEvidenceUseCase } from './reimbursement-finance.use-case';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';

// Evidence fake for detailWithFileNames — decision endpoints now return the same hydrated
// detail as a GET (names + file names), so their specs feed the assembler harmless lookups.
const fakeDetailEvidence = { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) };


const noopAudit = { log: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;
const reserve = { execute: async () => ({ id: 'seq-1', documentNumber: 'RBPAY-202601-000001' }) } as any;
const commit = { execute: async () => undefined } as any;

function ctx(perms: string[]) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'fin-1', companyId: 'co-1',
    membershipId: 'm', roles: ['FINANCE'], permissions: perms, scopes: {}, authProvider: 'dev',
  } as any;
}

function financeReviewedRequest(overrides: Partial<any> = {}): any {
  return {
    id: 'rb-1', companyId: 'co-1', branchId: 'branch-1', requestNo: 'RB-202601-000001', requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'Somchai',
    amount: '500.0000', currency: 'THB', categoryKey: 'travel', reason: 'Taxi', status: 'READY_FOR_PAYMENT',
    financeReviewStatus: 'APPROVED_FOR_PAYMENT', paymentStatus: 'UNPAID',
    paymentTotalAmount: '0.0000', outstandingAmount: '500.0000', duplicateStatus: 'NO_MATCH',
    incurredDate: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** Captures what a two-phase repository method writes inside its transaction, so the outbox
 *  events the use case now appends via `tx` stay asserted instead of disappearing with the
 *  injected outbox service they replaced. */
function fakeTx(outboxRows: any[]) {
  return {
    outboxEvent: { createMany: async ({ data }: any) => { outboxRows.push(...data); return { count: data.length }; } },
  };
}

function fakeRepo(req: any, opts: {
  openDuplicates?: number;
  signedCopies?: { attachmentId: string; fileName: string; uploadedAt: Date }[];
  /** Repository preflight verdict — `assertClaimPaymentReady` throws for real when the claim
   *  has a cancellation in flight or its expense projections are not posted yet. */
  paymentReadyError?: Error;
  outboxRows?: any[];
} = {}) {
  const payments: any[] = [];
  const outboxRows = opts.outboxRows ?? [];
  const repo = {
    lastPayment: undefined as any,
    lastResolve: undefined as any,
    findRequestById: async (_c: string, _id: string, withRel?: boolean) => (withRel ? { ...req, approvalSteps: [], payments, duplicateCandidates: [] } : req),
    findPolicy: async () => null,
    getUserDisplayNames: async () => ({}),
    // Preflight the use case runs before reserving a payment number (the repository repeats it
    // under the payment lock). Default: ready.
    assertClaimPaymentReady: async () => {
      if (opts.paymentReadyError) throw opts.paymentReadyError;
    },
    // Phase 1 of finance approval: the decision is durable, the request stays FINANCE_REVIEW
    // until projections land. Mirrors the repository's guards so the spec still fails if the
    // use case stops respecting them.
    beginFinanceApprovalAtomic: async (data: any) => {
      if (req.status !== 'FINANCE_REVIEW') throw new Error(`Cannot finance-review from status ${req.status}`);
      if (req.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw new Error('stale_finance_review_snapshot');
      // Already decided: the repository resumes the saga (skipping the decision write) only for
      // the actor whose decision is on the row — anyone else gets a conflict.
      if (req.financeReviewStatus === 'APPROVED_FOR_PAYMENT') {
        if (req.financeReviewedByUserId !== data.actorUserId || !req.financeReviewedAt) {
          throw new Error('finance_approval_already_decided');
        }
        return { request: req, resumed: true };
      }
      Object.assign(req, {
        financeReviewStatus: 'APPROVED_FOR_PAYMENT',
        financeReviewedByUserId: data.actorUserId,
        financeReviewedAt: data.reviewedAt,
        financeReviewNote: data.note,
        ...(data.resolveRequestDuplicates && { duplicateStatus: 'OVERRIDDEN' }),
        updatedAt: new Date(req.updatedAt.getTime() + 1),
      });
      await data.onDecisionPersisted(fakeTx(outboxRows));
      return { request: req, resumed: false };
    },
    // Phase 2: projections are in, so the claim becomes payable.
    completeFinanceProjectionAtomic: async (data: any) => {
      if (req.status === 'READY_FOR_PAYMENT') return req;
      if (req.financeReviewStatus !== 'APPROVED_FOR_PAYMENT'
        || req.financeReviewedByUserId !== data.decisionActorUserId) throw new Error('reimbursement_projection_decision_changed');
      Object.assign(req, { status: 'READY_FOR_PAYMENT', updatedAt: data.completedAt });
      await data.onReadyPersisted(fakeTx(outboxRows));
      return req;
    },
    recordFinanceReviewAtomic: async (data: any) => {
      Object.assign(req, {
        status: data.decision === 'NEEDS_INFO' ? 'DRAFT' : req.status,
        financeReviewStatus: data.decision,
        financeReviewedByUserId: data.actorUserId,
        financeReviewedAt: data.reviewedAt,
        financeReviewNote: data.note,
        ...(data.decision === 'NEEDS_INFO' ? {
          approvedAt: undefined,
          approvalSnapshotHash: undefined,
          paymentStatus: 'NOT_PAYABLE',
          duplicateStatus: 'NOT_CHECKED',
          postingStatus: 'not_required',
        } : {}),
        updatedAt: new Date(req.updatedAt.getTime() + 1),
      });
      await data.onDecisionPersisted(fakeTx(outboxRows));
      return req;
    },
    // Lane F: the evidence export lists the uploaded signed-copy scans by id.
    listSignedClaimFormCopies: async () => (opts.signedCopies ?? []),
    listOpenDuplicateCandidates: async () => (opts.openDuplicates ? Array.from({ length: opts.openDuplicates }, (_v, i) => ({ id: `d${i}` })) : []),
    recordPaymentAtomic: async (data: any) => {
      const payment = {
        id: 'pay-1', ...data,
        sourcePaymentRef: JSON.stringify({ sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: 'pay-1', direction: 'PAID' }),
        status: 'RECORDED', postingStatus: 'pending', createdAt: new Date(), updatedAt: new Date(),
      };
      repo.lastPayment = payment;
      payments.push(payment);
      Object.assign(req, { status: 'PAID', paymentStatus: 'PAID', paymentTotalAmount: data.paidAmount, outstandingAmount: '0.0000' });
      return {
        request: { ...req, approvalSteps: [], payments, duplicateCandidates: [] },
        payment,
        created: true,
      };
    },
    updateRequest: async (_c: string, _id: string, data: any) => { Object.assign(req, data); return req; },
    resolveDuplicateCandidates: async () => undefined,
    // The payment-step duplicate clear; mirrors the repository's status and version guards.
    resolvePaymentDuplicatesAtomic: async (data: any) => {
      repo.lastResolve = data;
      if (!['APPROVED', 'READY_FOR_PAYMENT'].includes(req.status)) throw new Error(`Cannot resolve duplicates from status ${req.status}`);
      if (req.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw new Error('reimbursement_changed');
      Object.assign(req, { updatedAt: new Date(req.updatedAt.getTime() + 1) });
      await data.onResolvedPersisted(fakeTx(outboxRows));
      return req;
    },
  };
  return repo as any;
}

describe('RecordReimbursementPaymentUseCase (MVP full-payment)', () => {
  const perms = ['reimbursement.payment.record'];

  it('records a full payment and marks the request PAID', async () => {
    const req = financeReviewedRequest();
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req), noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
    const detail = await uc.execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' });
    assert.equal(req.status, 'PAID');
    assert.equal(req.paymentStatus, 'PAID');
    assert.equal(req.outstandingAmount, '0.0000');
    assert.ok(detail);
  });

  it('reserves the payment number in the Bangkok month of the payment instant', async () => {
    const req = financeReviewedRequest();
    let reservedPeriod: string | undefined;
    const capturingReserve = { execute: async (input: any) => {
      reservedPeriod = input.periodKey;
      return { id: 'seq-1', documentNumber: 'RBPAY-202609-000001' };
    } } as any;
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req), noopAudit, noopOutbox, capturingReserve, commit, fakeDetailEvidence as any);

    await uc.execute(ctx(perms), 'rb-1', {
      paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-08-31T19:00:00.000Z',
    });

    assert.equal(reservedPeriod, '2026-09');
  });

  it('stores a source ref carrying the real payment id for item 13', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req);
    const uc = new RecordReimbursementPaymentUseCase(repo, noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
    await uc.execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' });
    const parsed = JSON.parse(repo.lastPayment.sourcePaymentRef);
    assert.equal(parsed.sourceType, 'REIMBURSEMENT_PAYMENT');
    assert.equal(parsed.sourceId, 'pay-1');
    assert.equal(parsed.direction, 'PAID');
  });

  it('rejects underpayment (partial not allowed)', async () => {
    const req = financeReviewedRequest();
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req), noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
    await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', { paidAmount: '250.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' }), /partial_payment_not_allowed/);
  });

  it('rejects overpayment', async () => {
    const req = financeReviewedRequest();
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req), noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
    await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', { paidAmount: '600.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' }), /payment_over_approved_amount/);
  });

  it('rejects payment before finance review', async () => {
    const req = financeReviewedRequest({ status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' });
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req), noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
    await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' }), /finance_review_required/);
  });

  it('rejects payment for a rejected request', async () => {
    const req = financeReviewedRequest({ status: 'REJECTED' });
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req), noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
    await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' }), /invalid_status_transition/);
  });

  it('blocks payment when duplicates are unresolved and policy blocks payment', async () => {
    const req = financeReviewedRequest();
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req, { openDuplicates: 1 }), noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
    await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' }), /duplicate_unresolved/);
  });

  it('requires reference for bank transfer', async () => {
    const req = financeReviewedRequest();
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req), noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
    await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'BANK_TRANSFER', paidAt: '2026-02-01T00:00:00.000Z' }), /payment_reference_required/);
  });

  it('reuses the server attempt key after a transaction fault and commits once on retry', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req);
    const record = repo.recordPaymentAtomic.bind(repo);
    let failOnce = true;
    repo.recordPaymentAtomic = async (data: any) => {
      if (failOnce) { failOnce = false; throw new Error('transaction_fault'); }
      return record(data);
    };
    const reservationKeys: string[] = [];
    const reserveOnce = { execute: async (input: any) => {
      reservationKeys.push(input.idempotencyKey);
      return { id: 'seq-1', documentNumber: 'RBPAY-202602-000001', status: 'RESERVED' };
    } } as any;
    let commits = 0;
    const commitOnce = { execute: async () => { commits += 1; } } as any;
    const uc = new RecordReimbursementPaymentUseCase(repo, noopAudit, noopOutbox, reserveOnce, commitOnce, fakeDetailEvidence as any);
    const input = { paidAmount: '500.0000', paymentMethod: 'CASH' as const, paidAt: '2026-02-01T00:00:00.000Z' };

    await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', input), /transaction_fault/);
    await uc.execute(ctx(perms), 'rb-1', input);

    assert.equal(reservationKeys[0], reservationKeys[1]);
    assert.equal(commits, 1);
    assert.equal(repo.lastPayment.id, 'pay-1');
  });

  it('returns the committed payment after a document-number commit timeout', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req);
    let reservation = { id: 'seq-1', documentNumber: 'RBPAY-202602-000001', status: 'RESERVED', ownerType: undefined as string | undefined, ownerId: undefined as string | undefined };
    const retryingReserve = { execute: async () => ({ ...reservation }) } as any;
    let commits = 0;
    const timeoutCommit = { execute: async (input: any) => {
      commits += 1;
      reservation = { ...reservation, status: 'COMMITTED', ownerType: input.ownerType, ownerId: input.ownerId };
      throw new Error('commit_timeout');
    } } as any;
    const uc = new RecordReimbursementPaymentUseCase(repo, noopAudit, noopOutbox, retryingReserve, timeoutCommit, fakeDetailEvidence as any);
    const input = { paidAmount: '500.0000', paymentMethod: 'CASH' as const, paidAt: '2026-02-01T00:00:00.000Z' };

    await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', input), /commit_timeout/);
    const retried = await uc.execute(ctx(perms), 'rb-1', input);

    assert.equal(retried.paymentStatus, 'PAID');
    assert.equal(commits, 1);
    assert.equal(req.paymentTotalAmount, '500.0000');
  });

  it('rejects without permission', async () => {
    const req = financeReviewedRequest();
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req), noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
    await assert.rejects(() => uc.execute(ctx([]), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' }), /permission/i);
  });
});

describe('FinanceReviewReimbursementUseCase', () => {
  /** Approval is two-phase since d1d3b23e: the decision commits first, expense projections run
   *  outside the transaction, and only then does the claim become payable. */
  function financeUC(repo: any, projectionCalls: any[] = [], projectionError?: Error) {
    const projections = { execute: async (...args: any[]) => {
      projectionCalls.push(args);
      if (projectionError) throw projectionError;
    } } as any;
    return new FinanceReviewReimbursementUseCase(repo, noopAudit, projections, fakeDetailEvidence as any);
  }

  it('approves for payment and moves to READY_FOR_PAYMENT', async () => {
    const req = financeReviewedRequest({ status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' });
    const calls: any[] = [];
    const detail = await financeUC(fakeRepo(req), calls).execute(ctx(['reimbursement.finance_review']), 'rb-1', { decision: 'APPROVED_FOR_PAYMENT' });
    assert.equal(req.status, 'READY_FOR_PAYMENT');
    assert.equal((req as any).financeReviewStatus, 'APPROVED_FOR_PAYMENT');
    assert.equal(calls.length, 1, 'projections run once, between the two phases');
    assert.equal(calls[0][2].kind, 'FINANCE');
    assert.ok(detail);
  });

  it('leaves the claim unpayable when projection fails between the two phases', async () => {
    const req = financeReviewedRequest({ status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' });
    const uc = financeUC(fakeRepo(req), [], new Error('projection failed'));
    await assert.rejects(() => uc.execute(ctx(['reimbursement.finance_review']), 'rb-1', { decision: 'APPROVED_FOR_PAYMENT' }), /projection failed/);
    // The decision is durable, but nothing may be paid until the expenses exist.
    assert.equal((req as any).financeReviewStatus, 'APPROVED_FOR_PAYMENT');
    assert.equal(req.status, 'FINANCE_REVIEW');
  });

  // BUG-7 recovery lever: the "ดำเนินการต่อ" button posts the same decision again.
  it('resumes a claim stranded with a durable approval and no projections', async () => {
    const req = financeReviewedRequest({
      status: 'FINANCE_REVIEW',
      financeReviewStatus: 'APPROVED_FOR_PAYMENT',
      financeReviewedByUserId: 'fin-1',
      financeReviewedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const calls: any[] = [];
    const audits: any[] = [];
    const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
    const projections = { execute: async (...args: any[]) => { calls.push(args); } } as any;
    const uc = new FinanceReviewReimbursementUseCase(fakeRepo(req), audit, projections, fakeDetailEvidence as any);

    await uc.execute(ctx(['reimbursement.finance_review']), 'rb-1', { decision: 'APPROVED_FOR_PAYMENT' });

    assert.equal(req.status, 'READY_FOR_PAYMENT');
    assert.equal(calls.length, 1, 'the projection phase runs again');
    // The decision is not written twice, so the retry needs its own audit trail.
    assert.equal(audits.some((entry) => entry.action === 'reimbursement.finance_review.decision_durable'), false);
    const retry = audits.find((entry) => entry.action === 'reimbursement.finance_review.projection_retry');
    assert.equal(retry?.riskLevel, 'HIGH');
    assert.equal(retry?.metadataJson.retry, true);
  });

  it('emits a ready_for_payment payload the notification template can render and deep-link', async () => {
    const req = financeReviewedRequest({ status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' });
    const outboxRows: any[] = [];
    const uc = financeUC(fakeRepo(req, { outboxRows }));
    await uc.execute(ctx(['reimbursement.finance_review']), 'rb-1', { decision: 'APPROVED_FOR_PAYMENT' });

    // The event is written inside the completing transaction now, not through an outbox service.
    const ready = outboxRows.find((row) => row.eventType === 'reimbursement.ready_for_payment');
    assert.deepEqual(ready?.payloadJson.data, {
      requestId: 'rb-1', requestNo: 'RB-202601-000001', requesterUserId: 'staff-1',
      status: 'READY_FOR_PAYMENT', decision: 'APPROVED_FOR_PAYMENT', amount: '500.0000', currency: 'THB',
    });
    assert.ok(
      outboxRows.some((row) => row.eventType === 'reimbursement.finance_projection_started'),
      'phase 1 records that projections are pending, so a crash between phases is recoverable',
    );
  });

  it('requires a reason before returning a claim for correction', async () => {
    const req = financeReviewedRequest({ status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' });
    await assert.rejects(
      () => financeUC(fakeRepo(req)).execute(ctx(['reimbursement.finance_review']), 'rb-1', { decision: 'NEEDS_INFO', note: '   ' }),
      /finance_correction_reason_required/,
    );
    assert.equal(req.status, 'FINANCE_REVIEW');
  });

  it('returns NEEDS_INFO to an editable draft and emits a requester correction event', async () => {
    const req = financeReviewedRequest({
      status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING', approvalSnapshotHash: 'old-hash', approvedAt: new Date(),
    });
    const outboxRows: any[] = [];
    await financeUC(fakeRepo(req, { outboxRows })).execute(
      ctx(['reimbursement.finance_review']), 'rb-1', { decision: 'NEEDS_INFO', note: ' ยอดไม่ตรงกับใบเสร็จ ' },
    );

    assert.equal(req.status, 'DRAFT');
    assert.equal(req.financeReviewStatus, 'NEEDS_INFO');
    assert.equal(req.financeReviewNote, 'ยอดไม่ตรงกับใบเสร็จ');
    assert.equal(req.paymentStatus, 'NOT_PAYABLE');
    const correction = outboxRows.find(row => row.eventType === 'reimbursement.correction_requested');
    assert.equal(correction?.payloadJson.data.requesterUserId, 'staff-1');
    assert.equal(correction?.payloadJson.data.status, 'DRAFT');
  });

  // Finance review off (the default): no finance decision ever comes to carry the override, so a
  // BLOCK_PAYMENT duplicate would strand the claim at the payment step.
  it('clears a payment-step duplicate block for a duplicate.resolve holder, without finance review', async () => {
    for (const status of ['READY_FOR_PAYMENT', 'APPROVED']) {
      const req = financeReviewedRequest({ status, financeReviewStatus: 'NOT_REQUIRED' });
      const repo = fakeRepo(req);
      const audits: any[] = [];
      const projectionCalls: any[] = [];
      const uc = new FinanceReviewReimbursementUseCase(repo, { log: async (entry: any) => { audits.push(entry); } } as any,
        { execute: async (...args: any[]) => { projectionCalls.push(args); } } as any, fakeDetailEvidence as any);

      await uc.execute(ctx(['reimbursement.duplicate.resolve']), 'rb-1', { resolveDuplicate: true, duplicateResolutionReason: ' ใบเสร็จคนละใบกัน ' });

      assert.equal(repo.lastResolve.reason, 'ใบเสร็จคนละใบกัน');
      assert.equal(repo.lastResolve.expectedUpdatedAt.toISOString(), '2026-01-01T00:00:00.000Z', 'CAS on the version read');
      assert.equal(req.status, status, 'no transition: the claim stays at the payment step');
      assert.equal(req.financeReviewStatus, 'NOT_REQUIRED', 'no finance decision is recorded');
      assert.equal(projectionCalls.length, 0);
      const entry = audits.find((row) => row.action === 'reimbursement.duplicate.resolve');
      assert.equal(entry?.riskLevel, 'HIGH');
      assert.deepEqual(entry?.metadataJson, { requestDuplicateOverride: true, duplicateResolutionReason: 'ใบเสร็จคนละใบกัน', status });
    }
  });

  it('keeps the clear on duplicate.resolve with a reason, and every decision on finance_review', async () => {
    const req = financeReviewedRequest({ status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED' });
    const repo = fakeRepo(req);
    await assert.rejects(
      () => financeUC(repo).execute(ctx(['reimbursement.finance_review']), 'rb-1', { resolveDuplicate: true, duplicateResolutionReason: 'ไม่ซ้ำ' }),
      /Missing permission: reimbursement\.duplicate\.resolve/,
    );
    await assert.rejects(
      () => financeUC(repo).execute(ctx(['reimbursement.duplicate.resolve']), 'rb-1', { resolveDuplicate: true, duplicateResolutionReason: '   ' }),
      /duplicate_resolution_reason_required/,
    );
    await assert.rejects(
      () => financeUC(repo).execute(ctx(['reimbursement.duplicate.resolve']), 'rb-1', { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: true, duplicateResolutionReason: 'ไม่ซ้ำ' }),
      /Missing permission: reimbursement\.finance_review/,
    );
    await assert.rejects(
      () => financeUC(repo).execute({ ...ctx(['reimbursement.duplicate.resolve']), scopes: { branchIds: ['branch-9'] } }, 'rb-1', { resolveDuplicate: true, duplicateResolutionReason: 'ไม่ซ้ำ' }),
      /outside your assigned branch scope/,
    );
    assert.equal(repo.lastResolve, undefined, 'no refused call reaches the write');
    // Before the payment step the clear is refused; finance review keeps its own path.
    const review = financeReviewedRequest({ status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' });
    await assert.rejects(
      () => financeUC(fakeRepo(review)).execute(ctx(['reimbursement.duplicate.resolve']), 'rb-1', { resolveDuplicate: true, duplicateResolutionReason: 'ไม่ซ้ำ' }),
      /Cannot resolve duplicates from status FINANCE_REVIEW/,
    );
  });
});

describe('reimbursement.payment_recorded event payload', () => {
  it('carries requestNo + requesterUserId (so the requester is notified) and survives redaction', async () => {
    const req = financeReviewedRequest();
    const events: any[] = [];
    const outbox = { append: async (...args: any[]) => { events.push(args); } } as any;
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req), noopAudit, outbox, reserve, commit, fakeDetailEvidence as any);
    await uc.execute(ctx(['reimbursement.payment.record']), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' });

    const paid = events.find((e) => e[0] === 'reimbursement.payment_recorded');
    assert.equal(paid?.[3].data.requestId, 'rb-1');
    assert.equal(paid?.[3].data.requestNo, 'RB-202601-000001');
    assert.equal(paid?.[3].data.requesterUserId, 'staff-1');
  });
});

describe('ExportReimbursementEvidenceUseCase (multi-line)', () => {
  function exportedLine(overrides: Partial<any> = {}) {
    return {
      id: 'rbl-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', lineNo: 1,
      incurredDate: new Date('2026-01-05T00:00:00.000Z'), description: 'แท็กซี่',
      categoryKey: 'travel', amount: '300.0000', attachmentId: 'att-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('exports every line with its evidence ids (the header carries none since lane C)', async () => {
    const req = financeReviewedRequest({
      primaryAttachmentId: undefined,
      linkedExpenseId: undefined,
      lines: [
        exportedLine(),
        exportedLine({ id: 'rbl-2', lineNo: 2, description: 'ที่พัก', purpose: 'พบลูกค้า', categoryKey: 'accommodation', amount: '200.0000', attachmentId: undefined, linkedExpenseId: 'exp-1' }),
      ],
    });
    const uc = new ExportReimbursementEvidenceUseCase(fakeRepo(req), noopAudit);
    const out: any = await uc.execute(ctx(['reimbursement.export']), 'rb-1');

    assert.equal(out.lines.length, 2);
    assert.deepEqual(out.lines.map((line: any) => [line.lineNo, line.amount, line.attachmentId, line.linkedExpenseId]), [
      [1, '300.0000', 'att-1', undefined],
      [2, '200.0000', undefined, 'exp-1'],
    ]);
    assert.equal(out.lines[1].purpose, 'พบลูกค้า');
    assert.equal(out.lines[0].incurredDate, '2026-01-05T00:00:00.000Z');
    // The audit surface must still be able to trace the money: header total = the lines.
    assert.equal(out.request.amount, '500.0000');
  });

  it('keeps the redaction discipline: ids only, no storage handles', async () => {
    const req = financeReviewedRequest({
      lines: [exportedLine({
        // Storage internals never leave the module, even if a line record carries them.
        objectKey: 'co-1/receipts/att-1.pdf', signedUrl: 'https://s3/att-1?sig=x', ocrRawText: 'ร้านค้า...',
      })],
    });
    const uc = new ExportReimbursementEvidenceUseCase(fakeRepo(req), noopAudit);
    const out: any = await uc.execute(ctx(['reimbursement.export']), 'rb-1');

    assert.deepEqual(Object.keys(out.lines[0]).sort(), [
      'amount', 'attachmentId', 'categoryKey', 'description', 'incurredDate', 'lineNo', 'linkedExpenseId', 'purpose',
    ]);
    assert.equal(JSON.stringify(out).includes('signedUrl'), false);
    assert.equal(JSON.stringify(out).includes('objectKey'), false);
    assert.equal(JSON.stringify(out).includes('ocrRawText'), false);
  });

  it('rejects an export without the export permission', async () => {
    const uc = new ExportReimbursementEvidenceUseCase(fakeRepo(financeReviewedRequest({ lines: [] })), noopAudit);
    await assert.rejects(() => uc.execute(ctx([]), 'rb-1'), /permission/i);
  });

  it('carries the signed-copy attachment ids, and only the ids (lane F)', async () => {
    const repo = fakeRepo(financeReviewedRequest({ lines: [exportedLine()] }), {
      signedCopies: [
        { attachmentId: 'att-signed-2', fileName: 'ใบเบิกเซ็นแล้ว.pdf', uploadedAt: new Date('2026-07-26T10:00:00.000Z') },
        { attachmentId: 'att-signed-1', fileName: 'scan.jpg', uploadedAt: new Date('2026-07-25T10:00:00.000Z') },
      ],
    });
    const out: any = await new ExportReimbursementEvidenceUseCase(repo, noopAudit).execute(ctx(['reimbursement.export']), 'rb-1');

    assert.deepEqual(out.signedCopyAttachmentIds, ['att-signed-2', 'att-signed-1']);
    assert.equal(JSON.stringify(out).includes('ใบเบิกเซ็นแล้ว.pdf'), false, 'file names are not part of the evidence export');
  });
});

function correctionRepositoryHarness(input: {
  status?: string; recordedPayments?: number; liveProjections?: number; stepStatus?: string; candidates?: any[];
} = {}) {
  const expectedUpdatedAt = new Date('2026-01-03T00:00:00.000Z');
  const request = financeReviewedRequest({
    status: input.status ?? 'FINANCE_REVIEW',
    financeReviewStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    duplicateStatus: 'NO_MATCH',
    postingStatus: 'posted',
    approvedAt: new Date('2026-01-02T00:00:00.000Z'),
    currentApproverUserId: 'mgr-1',
    currentApprovalStepId: 'step-1',
    approvalSnapshotHash: 'old-hash',
    updatedAt: expectedUpdatedAt,
    lines: [],
  });
  const deleted = { signatures: 0, signedCopies: 0 };
  const steps: any[] = [{ id: 'step-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', status: input.stepStatus ?? 'PENDING' }];
  const candidates: any[] = input.candidates ?? [];
  const updateWhere = (rows: any[]) => async ({ where, data }: any) => {
    const hits = rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    hits.forEach((row) => Object.assign(row, data));
    return { count: hits.length };
  };
  const tx: any = {
    $executeRaw: async () => 1,
    reimbursementApprovalStep: { updateMany: updateWhere(steps) },
    reimbursementDuplicateCandidate: { updateMany: updateWhere(candidates) },
    reimbursementPayment: { count: async () => input.recordedPayments ?? 0 },
    expenseRecord: { count: async () => input.liveProjections ?? 0 },
    reimbursementClaimSignature: { deleteMany: async () => { deleted.signatures += 1; return { count: 1 }; } },
    attachmentLink: { deleteMany: async () => { deleted.signedCopies += 1; return { count: 1 }; } },
    reimbursementRequest: {
      findFirst: async ({ where }: any) => (request.id === where.id && request.companyId === where.companyId ? request : null),
      updateMany: async ({ where, data }: any) => {
        if (request.id !== where.id || request.companyId !== where.companyId || request.status !== where.status
          || request.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        Object.assign(request, data);
        return { count: 1 };
      },
      findFirstOrThrow: async () => ({ ...request, _count: { lines: 0 } }),
    },
  };
  const client = { $transaction: async (work: (inner: any) => Promise<any>) => work(tx) };
  return {
    repo: new PrismaReimbursementRepository({ client } as any, {} as any),
    request,
    expectedUpdatedAt,
    deleted,
    steps,
    candidates,
  };
}

describe('PrismaReimbursementRepository correction transitions', () => {
  it('returns finance NEEDS_INFO to DRAFT and invalidates current-form artifacts atomically', async () => {
    const h = correctionRepositoryHarness();
    await h.repo.recordFinanceReviewAtomic({
      companyId: 'co-1', requestId: 'rb-1', expectedUpdatedAt: h.expectedUpdatedAt,
      actorUserId: 'fin-1', scopes: {}, reviewedAt: new Date('2026-01-04T00:00:00.000Z'),
      decision: 'NEEDS_INFO', note: 'แก้ยอด', onDecisionPersisted: async () => undefined,
    });

    assert.equal(h.request.status, 'DRAFT');
    assert.equal(h.request.submittedAt, null);
    assert.equal(h.request.submittedByUserId, null);
    assert.equal(h.request.approvedAt, null);
    assert.equal(h.request.currentApprovalStepId, null);
    assert.equal(h.request.approvalSnapshotHash, null);
    assert.equal(h.request.paymentStatus, 'NOT_PAYABLE');
    assert.equal(h.request.duplicateStatus, 'NOT_CHECKED');
    assert.deepEqual(h.deleted, { signatures: 1, signedCopies: 1 });
  });

  it('refuses correction after payment or a live expense projection without invalidating artifacts', async () => {
    for (const [options, code] of [
      [{ recordedPayments: 1 }, 'reimbursement_correction_has_payment'],
      [{ liveProjections: 1 }, 'reimbursement_correction_has_projection'],
    ] as const) {
      const h = correctionRepositoryHarness(options);
      await assert.rejects(() => h.repo.recordFinanceReviewAtomic({
        companyId: 'co-1', requestId: 'rb-1', expectedUpdatedAt: h.expectedUpdatedAt,
        actorUserId: 'fin-1', scopes: {}, reviewedAt: new Date('2026-01-04T00:00:00.000Z'),
        decision: 'NEEDS_INFO', note: 'แก้ยอด', onDecisionPersisted: async () => undefined,
      }), new RegExp(code));
      assert.equal(h.request.status, 'FINANCE_REVIEW');
      assert.deepEqual(h.deleted, { signatures: 0, signedCopies: 0 });
    }
  });

  it('reopens a rejected request under the same number and invalidates current-form artifacts', async () => {
    const h = correctionRepositoryHarness({ status: 'REJECTED' });
    const requestNo = h.request.requestNo;
    await h.repo.reopenRejectedRequest('co-1', 'rb-1', h.expectedUpdatedAt, 'staff-1');

    assert.equal(h.request.status, 'DRAFT');
    assert.equal(h.request.submittedAt, null);
    assert.equal(h.request.submittedByUserId, null);
    assert.equal(h.request.requestNo, requestNo);
    assert.equal(h.request.financeReviewStatus, 'NOT_REQUIRED');
    assert.equal(h.request.approvalSnapshotHash, null);
    assert.deepEqual(h.deleted, { signatures: 1, signedCopies: 1 });
    assert.equal(h.steps[0].status, 'PENDING', 'reopening a refusal runs no approval-step write');
  });

  it('withdraws an undecided claim to a draft under the same number and cancels its pending step', async () => {
    const h = correctionRepositoryHarness({ status: 'PENDING_APPROVAL' });
    const requestNo = h.request.requestNo;
    await h.repo.reopenRejectedRequest('co-1', 'rb-1', h.expectedUpdatedAt, 'staff-1', 'PENDING_APPROVAL');

    assert.equal(h.request.status, 'DRAFT');
    assert.equal(h.request.requestNo, requestNo);
    assert.equal(h.request.submittedAt, null);
    assert.equal(h.request.currentApprovalStepId, null);
    assert.equal(h.request.approvalSnapshotHash, null);
    assert.equal(h.request.approvalPolicySnapshotJson, null, 'the resubmission freezes the policy of its own day');
    // Invalidated like a cancellation does it: no live step is left for a resubmission to inherit.
    assert.equal(h.steps[0].status, 'CANCELLED');
    assert.equal(h.steps[0].invalidatedReason, 'withdrawn_by_requester');
    assert.ok(h.steps[0].invalidatedAt instanceof Date);
    assert.deepEqual(h.deleted, { signatures: 1, signedCopies: 1 });
  });

  it('refuses to withdraw once an approver has decided, and leaves the claim as it was', async () => {
    const h = correctionRepositoryHarness({ status: 'PENDING_APPROVAL', stepStatus: 'APPROVED' });
    await assert.rejects(
      () => h.repo.reopenRejectedRequest('co-1', 'rb-1', h.expectedUpdatedAt, 'staff-1', 'PENDING_APPROVAL'),
      (error: any) => error.getResponse().code === 'reimbursement_changed',
    );
    assert.equal(h.request.status, 'PENDING_APPROVAL');
    assert.equal(h.steps[0].status, 'APPROVED');
    assert.deepEqual(h.deleted, { signatures: 0, signedCopies: 0 });
  });

  it('clears open duplicate candidates at the payment step under the request lock and version check', async () => {
    const h = correctionRepositoryHarness({ status: 'READY_FOR_PAYMENT', candidates: [
      { id: 'd1', companyId: 'co-1', reimbursementRequestId: 'rb-1', status: 'OPEN', reason: 'line 1 shares a receipt with RB-9' },
      { id: 'd2', companyId: 'co-1', reimbursementRequestId: 'rb-1', status: 'DISMISSED' },
    ] });
    let auditTx: unknown;
    await h.repo.resolvePaymentDuplicatesAtomic({
      companyId: 'co-1', requestId: 'rb-1', expectedUpdatedAt: h.expectedUpdatedAt, actorUserId: 'owner-1', scopes: {},
      resolvedAt: new Date('2026-01-04T00:00:00.000Z'), reason: 'ใบเสร็จคนละใบกัน', onResolvedPersisted: async (tx) => { auditTx = tx; },
    });

    assert.deepEqual(h.candidates.map((row) => [row.id, row.status, row.resolvedByUserId, row.reason]), [
      ['d1', 'OVERRIDDEN', 'owner-1', 'ใบเสร็จคนละใบกัน'],
      ['d2', 'DISMISSED', undefined, undefined],
    ]);
    assert.equal(h.request.status, 'READY_FOR_PAYMENT');
    assert.equal(h.request.duplicateStatus, 'NO_MATCH', 'the expense-level status set at projection is left alone');
    assert.ok(h.request.updatedAt.getTime() > h.expectedUpdatedAt.getTime(), 'a new version, so a racing clear or payment conflicts');
    assert.ok(auditTx, 'the audit row is written in the same transaction');
  });

  it('refuses the payment-step clear at another status, on a stale version, or outside branch scope', async () => {
    const open = () => [{ id: 'd1', companyId: 'co-1', reimbursementRequestId: 'rb-1', status: 'OPEN' }];
    const attempt = (h: ReturnType<typeof correctionRepositoryHarness>, overrides: Record<string, unknown> = {}) => h.repo.resolvePaymentDuplicatesAtomic({
      companyId: 'co-1', requestId: 'rb-1', expectedUpdatedAt: h.expectedUpdatedAt, actorUserId: 'owner-1', scopes: {},
      resolvedAt: new Date(), reason: 'ไม่ซ้ำ', onResolvedPersisted: async () => undefined, ...overrides,
    });
    const review = correctionRepositoryHarness({ status: 'FINANCE_REVIEW', candidates: open() });
    await assert.rejects(() => attempt(review), /Cannot resolve duplicates from status FINANCE_REVIEW/);
    const stale = correctionRepositoryHarness({ status: 'READY_FOR_PAYMENT', candidates: open() });
    await assert.rejects(() => attempt(stale, { expectedUpdatedAt: new Date('2026-01-02T00:00:00.000Z') }),
      (error: any) => error.getResponse().code === 'reimbursement_changed');
    const scoped = correctionRepositoryHarness({ status: 'READY_FOR_PAYMENT', candidates: open() });
    await assert.rejects(() => attempt(scoped, { scopes: { branchIds: ['branch-9'] } }), /outside your assigned branch scope/);
    for (const h of [review, stale, scoped]) assert.equal(h.candidates[0].status, 'OPEN');
  });
});

type AtomicFault = 'create' | 'source-ref' | 'cas' | 'cas-conflict' | 'readback';

/** Since d1d3b23e a claim may only be paid once every line has a confirmed expense projection —
 *  the repository proves that under the payment lock. The harness therefore needs a line and its
 *  projection; `projections: []` exercises the refusal. */
function claimLine(overrides: Partial<any> = {}) {
  return {
    id: 'rbl-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', lineNo: 1,
    incurredDate: new Date('2026-01-01T00:00:00.000Z'), description: 'Taxi', categoryKey: 'travel',
    amount: '500.0000', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function claimProjection(overrides: Partial<any> = {}) {
  return {
    id: 'exp-1', companyId: 'co-1', sourceReimbursementRequestId: 'rb-1', sourceReimbursementLineId: 'rbl-1',
    branchId: 'branch-1', grandTotalAmount: '500.0000', status: 'CONFIRMED',
    postingStatus: 'posted', duplicateStatus: 'NO_MATCH',
    ...overrides,
  };
}

function atomicPaymentHarness(initialFault?: AtomicFault, ambiguousTimeout = false, projections: any[] = [claimProjection()]) {
  let request = financeReviewedRequest({ lines: [claimLine()] });
  let payments: any[] = [];
  let fault = initialFault;
  let timeoutPending = ambiguousTimeout;
  let transactionTail = Promise.resolve();
  const writes = { paymentCreates: 0, requestUpdates: 0, locks: 0, lockKeys: [] as string[], isolationLevels: [] as string[] };

  const tx: any = {
    // Tagged-template call: the interpolated value is the advisory-lock key.
    $executeRaw: async (_sql: TemplateStringsArray, ...values: string[]) => {
      writes.locks += 1;
      if (values[0]) writes.lockKeys.push(values[0]);
    },
    reimbursementPolicy: { findFirst: async () => null },
    reimbursementDuplicateCandidate: { count: async () => 0 },
    expenseRecord: {
      findMany: async ({ where }: any) => projections.filter((row) => row.companyId === where.companyId
        && row.sourceReimbursementRequestId === where.sourceReimbursementRequestId
        && (where.sourceReimbursementLineId?.in ?? []).includes(row.sourceReimbursementLineId)),
    },
    reimbursementPayment: {
      findFirst: async ({ where }: any) => payments.find((payment) => payment.companyId === where.companyId && payment.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        writes.paymentCreates += 1;
        if (fault === 'create') throw new Error('fault:create');
        const payment = {
          id: `pay-${writes.paymentCreates}`,
          ...data,
          status: 'RECORDED',
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
          updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        };
        payments.push(payment);
        return payment;
      },
      update: async ({ where, data }: any) => {
        if (fault === 'source-ref') throw new Error('fault:source-ref');
        const payment = payments.find((row) => row.id === where.id)!;
        Object.assign(payment, data);
        return payment;
      },
    },
    reimbursementRequest: {
      findFirst: async ({ where }: any) => request.id === where.id && request.companyId === where.companyId ? request : null,
      updateMany: async ({ where, data }: any) => {
        if (fault === 'cas') throw new Error('fault:cas');
        if (fault === 'cas-conflict' || request.updatedAt.getTime() !== where.updatedAt.getTime() || request.status !== where.status) return { count: 0 };
        writes.requestUpdates += 1;
        Object.assign(request, data, { updatedAt: new Date(request.updatedAt.getTime() + 1) });
        return { count: 1 };
      },
      findFirstOrThrow: async ({ where }: any) => {
        if (fault === 'readback') throw new Error('fault:readback');
        if (request.id !== where.id || request.companyId !== where.companyId) throw new Error('not found');
        return { ...request, approvalSteps: [], payments, duplicateCandidates: [] };
      },
    },
  };

  const client: any = {
    $transaction: async (work: (transaction: any) => Promise<any>, options: any) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      writes.isolationLevels.push(options?.isolationLevel);
      const requestBefore = structuredClone(request);
      const paymentsBefore = structuredClone(payments);
      let committed = false;
      try {
        const result = await work(tx);
        committed = true;
        if (timeoutPending) {
          timeoutPending = false;
          throw new Error('commit_timeout');
        }
        return result;
      } catch (error) {
        if (!committed) {
          request = requestBefore;
          payments = paymentsBefore;
        }
        throw error;
      } finally {
        release();
      }
    },
  };

  return {
    repo: new PrismaReimbursementRepository({ client } as any, {} as any),
    writes,
    setFault: (next?: AtomicFault) => { fault = next; },
    state: () => ({ request, payments }),
  };
}

const atomicPaymentInput = {
  companyId: 'co-1',
  reimbursementRequestId: 'rb-1',
  idempotencyKey: 'server-attempt-1',
  paymentNo: 'RBPAY-202602-000001',
  paidAmount: '500.0000',
  currency: 'THB',
  paymentMethod: 'CASH',
  paidAt: new Date('2026-02-01T00:00:00.000Z'),
  paidByUserId: 'fin-1',
};

describe('PrismaReimbursementRepository.recordPaymentAtomic (H-06)', () => {
  it('serializes a deterministic two-request race and creates one payment', async () => {
    const h = atomicPaymentHarness();
    const results = await Promise.all([
      h.repo.recordPaymentAtomic(atomicPaymentInput),
      h.repo.recordPaymentAtomic(atomicPaymentInput),
    ]);

    assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
    assert.equal(h.state().payments.length, 1);
    assert.equal(h.state().request.paymentTotalAmount, '500.0000');
    assert.equal(h.state().request.outstandingAmount, '0.0000');
    assert.equal(h.state().request.paymentStatus, 'PAID');
    // Each attempt takes BOTH advisory locks: the payment key serializes concurrent payments,
    // the request key serializes against approval/cancellation transitions.
    assert.equal(h.writes.locks, 4);
    assert.deepEqual(h.writes.lockKeys, [
      'co-1:rb-1:reimbursement-payment', 'co-1:rb-1:reimbursement-request',
      'co-1:rb-1:reimbursement-payment', 'co-1:rb-1:reimbursement-request',
    ]);
    assert.deepEqual(h.writes.isolationLevels, ['Serializable', 'Serializable']);
  });

  it('rolls back every write boundary/CAS failure and each retry creates exactly once', async () => {
    for (const boundary of ['create', 'source-ref', 'cas', 'cas-conflict', 'readback'] as AtomicFault[]) {
      const h = atomicPaymentHarness(boundary);
      await assert.rejects(() => h.repo.recordPaymentAtomic(atomicPaymentInput));
      assert.equal(h.state().payments.length, 0, `${boundary}: payment must roll back`);
      assert.equal(h.state().request.paymentStatus, 'UNPAID', `${boundary}: request must roll back`);

      h.setFault();
      const retried = await h.repo.recordPaymentAtomic(atomicPaymentInput);
      assert.equal(retried.created, true, `${boundary}: retry must create`);
      assert.equal(h.state().payments.length, 1, `${boundary}: retry must create once`);
    }
  });

  it('returns the committed payment when the first response times out ambiguously', async () => {
    const h = atomicPaymentHarness(undefined, true);
    await assert.rejects(() => h.repo.recordPaymentAtomic(atomicPaymentInput), /commit_timeout/);

    const retried = await h.repo.recordPaymentAtomic(atomicPaymentInput);
    assert.equal(retried.created, false);
    assert.equal(h.state().payments.length, 1);
    assert.equal(h.writes.paymentCreates, 1);
  });

  it('refuses to pay a claim whose expense projection is missing or unconfirmed', async () => {
    const missing = atomicPaymentHarness(undefined, false, []);
    await assert.rejects(() => missing.repo.recordPaymentAtomic(atomicPaymentInput), /reimbursement_projection_not_ready/);
    assert.equal(missing.state().payments.length, 0);

    const unconfirmed = atomicPaymentHarness(undefined, false, [claimProjection({ status: 'DRAFT' })]);
    await assert.rejects(() => unconfirmed.repo.recordPaymentAtomic(atomicPaymentInput), /reimbursement_projection_not_ready/);
    assert.equal(unconfirmed.state().payments.length, 0);
  });
});
