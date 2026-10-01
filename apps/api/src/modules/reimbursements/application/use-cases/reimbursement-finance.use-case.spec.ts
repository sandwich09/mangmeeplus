import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  RecordReimbursementPaymentUseCase, FinanceReviewReimbursementUseCase, ExportReimbursementEvidenceUseCase, VoidReimbursementPaymentUseCase,
} from './reimbursement-finance.use-case';
import {
  AttachPaymentSlipUseCase, CompletePaymentSlipUploadUseCase, InitPaymentSlipUploadUseCase,
} from './reimbursement-payment-slip.use-case';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { ReimbursementController } from '../../presentation/http/reimbursement.controller';
import { detailWithFileNames } from '../dto/reimbursement.mapper';
import { RecordReimbursementPaymentDto } from '../../presentation/http/reimbursement.dtos';

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
  /** The company's stored policy row; null = defaults (finance review OFF since 2026-09-21). */
  policy?: Record<string, unknown> | null;
  /** The repository's slip proof verdict; it throws for a file that is not this claim's slip. */
  slipError?: Error;
  /** How the repository says the slip came to be one (default: the payer's own upload). */
  slipSource?: 'UPLOAD' | 'PREVIOUS_SLIP' | 'SIGNED_COPY';
} = {}) {
  const payments: any[] = [];
  const outboxRows = opts.outboxRows ?? [];
  /** Slip links per payment: what the claim page, the export and the print all read. */
  const slips: Record<string, { attachmentId: string; attachedAt: Date }[]> = {};
  const linkSlip = (paymentId: string, attachmentId: string, actorUserId: string) => {
    (slips[paymentId] ??= []).push({ attachmentId, attachedAt: new Date('2026-02-01T00:00:00.000Z') });
    return { attachmentId, source: opts.slipSource ?? 'UPLOAD', uploadedByUserId: actorUserId, declarationWithdrawn: opts.slipSource === 'SIGNED_COPY' };
  };
  const repo = {
    lastPayment: undefined as any,
    lastResolve: undefined as any,
    slipChecks: [] as any[],
    slips,
    payments,
    assertPaymentSlipUsable: async (input: any) => {
      repo.slipChecks.push(input);
      if (opts.slipError) throw opts.slipError;
    },
    listPaymentSlips: async (_c: string, ids: string[]) => Object.fromEntries(ids.filter((id) => slips[id]).map((id) => [id, slips[id]])),
    findPaymentById: async (_c: string, id: string) => payments.find((payment) => payment.id === id) ?? null,
    // The real void reverses the journal too; here only what the claim shows afterwards matters.
    voidPaymentTrueReversal: async (_c: string, _requestId: string, paymentId: string, actorUserId: string, reason: string) => {
      const payment = payments.find((row) => row.id === paymentId);
      Object.assign(payment, { status: 'VOIDED', voidedAt: new Date('2026-02-02T00:00:00.000Z'), voidReason: reason, voidedByUserId: actorUserId });
      Object.assign(req, { status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', paymentTotalAmount: '0.0000', outstandingAmount: req.amount });
      return { request: { ...req, approvalSteps: [], payments, duplicateCandidates: [] }, payment, reversalEntryId: null };
    },
    attachPaymentSlipAtomic: async (data: any) => {
      if (opts.slipError) throw opts.slipError;
      if ((slips[data.paymentId] ?? []).some((slip) => slip.attachmentId === data.attachmentId)) return { created: false };
      return { created: true, slip: linkSlip(data.paymentId, data.attachmentId, data.actorUserId) };
    },
    findRequestById: async (_c: string, _id: string, withRel?: boolean) => (withRel ? { ...req, approvalSteps: [], payments, duplicateCandidates: [] } : req),
    findPolicy: async () => opts.policy ?? null,
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
      const id = `pay-${payments.length + 1}`;
      const payment = {
        id, ...data,
        sourcePaymentRef: JSON.stringify({ sourceType: 'REIMBURSEMENT_PAYMENT', sourceId: id, direction: 'PAID' }),
        status: 'RECORDED', postingStatus: 'pending', createdAt: new Date(), updatedAt: new Date(),
      };
      repo.lastPayment = payment;
      payments.push(payment);
      Object.assign(req, { status: 'PAID', paymentStatus: 'PAID', paymentTotalAmount: data.paidAmount, outstandingAmount: '0.0000' });
      return {
        request: { ...req, approvalSteps: [], payments, duplicateCandidates: [] },
        payment,
        created: true,
        ...(data.slipAttachmentId && { slip: linkSlip(id, data.slipAttachmentId, data.paidByUserId) }),
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
    // Finance review is OFF by default since the step-journey change, so this company turns it on.
    const uc = new RecordReimbursementPaymentUseCase(fakeRepo(req, { policy: { financeReviewRequired: true } }), noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any);
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

// Owner decisions 2026-10-01: a slip is required to record a bank transfer and optional for every
// other method, the API enforces it, a replay compares the slip, and voiding keeps it as history.
describe('payment slip at the payment step', () => {
  const perms = ['reimbursement.payment.record'];
  const paidAt = '2026-02-01T00:00:00.000Z';
  const transfer = { paidAmount: '500.0000', paymentMethod: 'BANK_TRANSFER' as const, paidAt, paymentReference: 'TXN-1' };
  const recordUC = (repo: any, audit: any = noopAudit, outbox: any = noopOutbox) =>
    new RecordReimbursementPaymentUseCase(repo, audit, outbox, reserve, commit, fakeDetailEvidence as any);
  /** Document numbering that remembers what it committed, as a replay finds it. */
  function replayableUC(repo: any) {
    const reservations = new Map<string, any>();
    const reserving = { execute: async (input: any) => {
      const reservation = reservations.get(input.idempotencyKey)
        ?? { id: `seq-${reservations.size + 1}`, documentNumber: `RBPAY-202602-00000${reservations.size + 1}`, status: 'RESERVED' };
      reservations.set(input.idempotencyKey, reservation);
      return { ...reservation };
    } } as any;
    const committing = { execute: async (input: any) => {
      const reservation = [...reservations.values()].find((row) => row.id === input.id);
      Object.assign(reservation, { status: 'COMMITTED', ownerType: input.ownerType, ownerId: input.ownerId });
    } } as any;
    return new RecordReimbursementPaymentUseCase(repo, noopAudit, noopOutbox, reserving, committing, fakeDetailEvidence as any);
  }

  // The web form refuses this too, but the rule is the API's: this is the request a script or an
  // old browser tab would send, through the same validation pipe and controller a real call takes.
  it('refuses a transfer posted straight to the API without a slip', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req);
    const controller: ReimbursementController = Object.assign(Object.create(ReimbursementController.prototype), {
      recordPayment: recordUC(repo), evidence: fakeDetailEvidence,
    });
    const body = await new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS).transform(
      { ...transfer, idempotencyKey: 'form-1' }, { type: 'body', metatype: RecordReimbursementPaymentDto },
    );

    await assert.rejects(
      () => controller.createPayment(ctx(perms), 'rb-1', body),
      (error: any) => error.getStatus() === 422 && error.message === 'payment_slip_required',
    );
    assert.equal(repo.lastPayment, undefined, 'nothing is recorded');
    assert.equal(req.status, 'READY_FOR_PAYMENT');
    assert.equal(req.outstandingAmount, '500.0000');

    // The same request with its slip is recorded, and the answer already tells the payer they may open it.
    const withSlip = await new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS).transform(
      { ...transfer, idempotencyKey: 'form-1', slipAttachmentId: 'att-slip-1' }, { type: 'body', metatype: RecordReimbursementPaymentDto },
    );
    const paid = await controller.createPayment(ctx(perms), 'rb-1', withSlip);
    assert.equal(paid.status, 'PAID');
    assert.deepEqual(paid.payments.map((row: any) => [row.slips.map((slip: any) => slip.attachmentId), row.viewerCanOpenSlips]), [[['att-slip-1'], true]]);
  });

  it('answers every action with the slip verdict of the person who acted, not of the claim', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req);
    const controller: ReimbursementController = Object.assign(Object.create(ReimbursementController.prototype), {
      recordPayment: recordUC(repo), voidPayment: new VoidReimbursementPaymentUseCase(repo, fakeDetailEvidence as any), evidence: fakeDetailEvidence,
    });
    await controller.createPayment(ctx(perms), 'rb-1', { ...transfer, slipAttachmentId: 'att-slip-1' } as any);
    // Voiding is its own right: someone who holds only that one is not among the slip's readers.
    const voidOnly = { ...ctx(['reimbursement.payment.void']), userId: 'voider-1' };
    const voided = await controller.voidRequestPayment(voidOnly, 'rb-1', 'pay-1', { reason: 'บันทึกเลขอ้างอิงผิด' });
    // They are told a slip exists, and are not handed the file's id.
    assert.deepEqual(voided.payments.map((row: any) => [row.status, row.slipCount, row.slips, row.viewerCanOpenSlips]), [['VOIDED', 1, [], false]]);
    assert.doesNotMatch(JSON.stringify(voided), /att-slip-1/);
    // The requester voiding nothing, just reading the same claim: theirs is true, with the file named.
    const asRequester = await detailWithFileNames(repo, fakeDetailEvidence as any, 'co-1', await repo.findRequestById('co-1', 'rb-1', true), { userId: 'staff-1', permissions: [] });
    assert.deepEqual(asRequester.payments.map((row) => [row.slipCount, row.slips.map((slip) => slip.attachmentId), row.viewerCanOpenSlips]), [[1, ['att-slip-1'], true]]);
  });

  it('records a transfer with its slip, and the claim shows the slip on that payment', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req);
    const audits: any[] = [];
    const events: any[] = [];
    const detail = await recordUC(repo, { log: async (entry: any) => { audits.push(entry); } }, { append: async (...args: any[]) => { events.push(args); } })
      .execute(ctx(perms), 'rb-1', { ...transfer, slipAttachmentId: 'att-slip-1' });

    assert.deepEqual(repo.slipChecks, [{ companyId: 'co-1', requestId: 'rb-1', attachmentId: 'att-slip-1', actorUserId: 'fin-1' }]);
    assert.equal(repo.lastPayment.slipAttachmentId, 'att-slip-1');
    assert.equal(detail.status, 'PAID');
    // Method, date, reference, amount and the slip all come from the one payment record.
    assert.deepEqual(
      detail.payments.map((row) => [row.paymentMethod, row.paidAt, row.paymentReference, row.paidAmount, row.slips.map((slip) => slip.attachmentId)]),
      [['BANK_TRANSFER', paidAt, 'TXN-1', '500.0000', ['att-slip-1']]],
    );
    const recorded = audits.find((entry) => entry.action === 'reimbursement.payment.record');
    assert.deepEqual(recorded.metadataJson, {
      paymentNo: 'RBPAY-202601-000001', paidAmount: '500.0000', paymentMethod: 'BANK_TRANSFER', requestId: 'rb-1',
      slipAttachmentId: 'att-slip-1', slipSource: 'UPLOAD',
    });
    // Nothing that opens or locates the file leaves through the audit row or the notification payload.
    assert.doesNotMatch(JSON.stringify([audits, events]), /https?:|objectKey|bucket|fileName/i);
    assert.equal(JSON.stringify(events).includes('att-slip-1'), false, 'the event payload carries no slip file id');
  });

  it('asks no slip of cash, cheque or another method, and still takes one when given', async () => {
    for (const [paymentMethod, paymentReference] of [['CASH', undefined], ['CHEQUE', 'CHQ-9'], ['OTHER', undefined]] as const) {
      const bare = financeReviewedRequest();
      const bareRepo = fakeRepo(bare);
      const withoutSlip = await recordUC(bareRepo).execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod, paidAt, paymentReference });
      assert.equal(bare.status, 'PAID', `${paymentMethod} without a slip`);
      assert.deepEqual(withoutSlip.payments[0]!.slips, [], `${paymentMethod}: no slip is reported`);
      assert.deepEqual(bareRepo.slipChecks, []);

      const evidenced = financeReviewedRequest();
      const evidencedRepo = fakeRepo(evidenced);
      const withSlip = await recordUC(evidencedRepo).execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod, paidAt, paymentReference, slipAttachmentId: 'att-proof' });
      assert.deepEqual(withSlip.payments[0]!.slips.map((slip) => slip.attachmentId), ['att-proof'], `${paymentMethod} with a slip`);
      assert.equal(evidencedRepo.slipChecks.length, 1, 'an optional slip is proven like a required one');
    }
  });

  it('refuses a file that is not this claim\'s slip before a payment number is reserved', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req, { slipError: Object.assign(new Error('payment_slip_invalid'), { code: 'payment_slip_invalid' }) });
    let reservations = 0;
    const countingReserve = { execute: async () => { reservations += 1; return { id: 'seq-1', documentNumber: 'RBPAY-202601-000001' }; } } as any;
    const uc = new RecordReimbursementPaymentUseCase(repo, noopAudit, noopOutbox, countingReserve, commit, fakeDetailEvidence as any);
    for (const paymentMethod of ['BANK_TRANSFER', 'CASH'] as const) {
      await assert.rejects(
        () => uc.execute(ctx(perms), 'rb-1', { ...transfer, paymentMethod, slipAttachmentId: 'att-of-another-claim' }),
        /payment_slip_invalid/,
      );
    }
    // A transfer with no slip at all is refused at the same point: no number is burnt on a refusal.
    await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', transfer), /payment_slip_required/);
    assert.equal(reservations, 0);
    assert.equal(repo.lastPayment, undefined);
    assert.equal(req.status, 'READY_FOR_PAYMENT');
  });

  // Claims approved before the slip existed stay payable, under the same rule.
  it('pays a claim approved before the feature: a transfer with its slip, cash without one', async () => {
    const legacy = () => financeReviewedRequest({
      approvedAt: new Date('2026-09-20T03:00:00.000Z'), financeReviewStatus: 'NOT_REQUIRED', approvalPolicySnapshotJson: undefined,
    });
    await assert.rejects(() => recordUC(fakeRepo(legacy())).execute(ctx(perms), 'rb-1', transfer), /payment_slip_required/);

    const byTransfer = legacy();
    await recordUC(fakeRepo(byTransfer)).execute(ctx(perms), 'rb-1', { ...transfer, slipAttachmentId: 'att-slip-1' });
    assert.equal(byTransfer.status, 'PAID');

    const byCash = legacy();
    await recordUC(fakeRepo(byCash)).execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt });
    assert.equal(byCash.status, 'PAID');
  });

  it('replays the same payment as itself, and refuses one that differs in the slip', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req);
    const uc = replayableUC(repo);
    const input = { ...transfer, slipAttachmentId: 'att-slip-1', idempotencyKey: 'form-1' };
    await uc.execute(ctx(perms), 'rb-1', input);

    const replayed = await uc.execute(ctx(perms), 'rb-1', input);
    assert.equal(replayed.status, 'PAID');
    assert.equal(repo.payments.length, 1, 'no second payment');
    assert.deepEqual(replayed.payments[0]!.slips.map((slip) => slip.attachmentId), ['att-slip-1']);

    for (const slipAttachmentId of ['att-slip-2', undefined]) {
      await assert.rejects(
        () => uc.execute(ctx(perms), 'rb-1', { ...input, slipAttachmentId }),
        (error: any) => error.getStatus() === 409 && error.message === 'reimbursement_payment_already_recorded',
        `a replay with ${slipAttachmentId ?? 'no slip'} is never a success`,
      );
    }
    // A cash payment replayed with a slip it never had is refused the same way.
    const cash = financeReviewedRequest();
    const cashUC = replayableUC(fakeRepo(cash));
    const cashInput = { paidAmount: '500.0000', paymentMethod: 'CASH' as const, paidAt };
    await cashUC.execute(ctx(perms), 'rb-1', cashInput);
    await assert.rejects(() => cashUC.execute(ctx(perms), 'rb-1', { ...cashInput, slipAttachmentId: 'att-late' }), /reimbursement_payment_already_recorded/);
    assert.equal(repo.payments.length, 1);
  });

  it('keeps the slip with a voided payment, and a new payment needs a slip of its own', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req);
    const voidUC = new VoidReimbursementPaymentUseCase(repo, fakeDetailEvidence as any);
    await recordUC(repo).execute(ctx(perms), 'rb-1', { ...transfer, slipAttachmentId: 'att-slip-1', idempotencyKey: 'form-1' });

    const voided = await voidUC.execute(ctx(['reimbursement.payment.void']), 'rb-1', 'pay-1', { reason: 'บันทึกเลขอ้างอิงผิด' });
    // The claim is payable again, and the record that was voided still shows what it was paid with.
    // (Whoever voids with only the void right sees that the slip is there, not which file it is.)
    assert.deepEqual([voided.status, voided.paymentStatus, voided.outstandingAmount, voided.paymentTotalAmount], ['READY_FOR_PAYMENT', 'UNPAID', '500.0000', '0.0000']);
    assert.deepEqual(voided.payments.map((row) => [row.id, row.status, row.paymentMethod, row.paymentReference, row.slipCount]),
      [['pay-1', 'VOIDED', 'BANK_TRANSFER', 'TXN-1', 1]]);

    // The old slip does not carry over on its own: the new transfer is refused until it names a slip.
    await assert.rejects(() => recordUC(repo).execute(ctx(perms), 'rb-1', { ...transfer, paymentReference: 'TXN-2', idempotencyKey: 'form-2' }), /payment_slip_required/);
    assert.equal(req.status, 'READY_FOR_PAYMENT');

    const repaid = await recordUC(repo).execute(ctx(perms), 'rb-1', { ...transfer, paymentReference: 'TXN-2', slipAttachmentId: 'att-slip-2', idempotencyKey: 'form-2' });
    assert.deepEqual([repaid.status, repaid.paymentStatus, repaid.outstandingAmount, repaid.paymentTotalAmount], ['PAID', 'PAID', '0.0000', '500.0000']);
    assert.deepEqual(repaid.payments.map((row) => [row.id, row.status, row.paymentReference, row.slips.map((slip) => slip.attachmentId)]), [
      ['pay-1', 'VOIDED', 'TXN-1', ['att-slip-1']],
      ['pay-2', 'RECORDED', 'TXN-2', ['att-slip-2']],
    ]);
    // Replaying the voided payment's own request is not a way back to "paid".
    await assert.rejects(
      () => recordUC(repo).execute(ctx(perms), 'rb-1', { ...transfer, slipAttachmentId: 'att-slip-1', idempotencyKey: 'form-1' }),
      /reimbursement_payment_already_recorded/,
    );
  });

  it('exports each payment with its reference and how many slips it carries, never which files', async () => {
    const req = financeReviewedRequest({ lines: [] });
    const repo = fakeRepo(req);
    await recordUC(repo).execute(ctx(perms), 'rb-1', { ...transfer, slipAttachmentId: 'att-slip-1' });
    const out: any = await new ExportReimbursementEvidenceUseCase(repo, noopAudit).execute(ctx(['reimbursement.export']), 'rb-1');
    assert.deepEqual(out.payments, [{
      paymentNo: 'RBPAY-202601-000001', paidAmount: '500.0000', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
      paidAt, paymentReference: 'TXN-1', status: 'RECORDED', slipCount: 1,
    }]);
    assert.equal(JSON.stringify(out).includes('att-slip-1'), false);
  });
});

describe('payment slip upload and later attachment', () => {
  const perms = ['reimbursement.payment.record'];
  const slipFile = { originalFileName: 'slip.jpg', mimeType: 'image/jpeg', byteSize: 250_000 };

  it('tags a slip upload with its claim, in the claim\'s branch, and borrows the upload grant', async () => {
    const calls: any[] = [];
    const createUpload = { execute: async (uploadCtx: any, command: any) => { calls.push([uploadCtx, command]); return { attachmentId: 'att-new' }; } } as any;
    const result = await new InitPaymentSlipUploadUseCase(fakeRepo(financeReviewedRequest()), createUpload).execute(ctx(perms), 'rb-1', slipFile);

    assert.deepEqual(result, { attachmentId: 'att-new' });
    assert.deepEqual(calls[0][1], {
      ...slipFile, visibility: 'INTERNAL', branchId: 'branch-1',
      metadataJson: { generatedFor: 'reimbursement_payment_slip', requestId: 'rb-1' },
    });
    assert.ok(calls[0][0].permissions.includes('attachment.create'));
  });

  it('accepts PDF, JPG and PNG up to 10 MB and refuses everything else with one stable code', async () => {
    const createUpload = { execute: async () => ({ attachmentId: 'att-new' }) } as any;
    const uc = new InitPaymentSlipUploadUseCase(fakeRepo(financeReviewedRequest()), createUpload);
    for (const mimeType of ['application/pdf', 'image/png', 'image/jpeg']) {
      await uc.execute(ctx(perms), 'rb-1', { ...slipFile, mimeType, byteSize: 10 * 1024 * 1024 });
    }
    for (const bad of [
      { mimeType: 'image/heic' }, { mimeType: 'text/html' }, { byteSize: 10 * 1024 * 1024 + 1 }, { byteSize: 0 }, { byteSize: 1.5 },
    ]) {
      await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', { ...slipFile, ...bad }), /payment_slip_invalid/, JSON.stringify(bad));
    }
  });

  it('leaves slip uploads to payment-record holders inside the claim\'s branch', async () => {
    const createUpload = { execute: async () => assert.fail('a refused upload must not start') } as any;
    const uc = new InitPaymentSlipUploadUseCase(fakeRepo(financeReviewedRequest()), createUpload);
    await assert.rejects(() => uc.execute(ctx(['reimbursement.finance_review']), 'rb-1', slipFile), /Missing permission: reimbursement\.payment\.record/);
    await assert.rejects(() => uc.execute({ ...ctx(perms), scopes: { branchIds: ['branch-9'] } }, 'rb-1', slipFile), /outside your assigned branch scope/);
  });

  it('completes only the payer\'s own pending slip upload for this claim', async () => {
    const completed: any[] = [];
    const completeUpload = { execute: async (_ctx: any, command: any) => { completed.push(command); return { id: command.attachmentId, objectKey: 'evidence/co-1/x' }; } } as any;
    const lookups: any[] = [];
    const repoWith = (upload: any) => Object.assign(fakeRepo(financeReviewedRequest()), {
      findPaymentSlipUpload: async (...args: any[]) => { lookups.push(args); return upload; },
    });

    const done = await new CompletePaymentSlipUploadUseCase(repoWith({ id: 'att-new', status: 'PENDING_UPLOAD' }), completeUpload)
      .execute(ctx(perms), 'rb-1', 'att-new', { byteSize: 250_000 });
    assert.deepEqual(done, { attachmentId: 'att-new' }, 'only the id comes back, never the storage record');
    assert.deepEqual(lookups[0], ['co-1', 'att-new', 'fin-1', 'rb-1']);
    assert.deepEqual(completed, [{ attachmentId: 'att-new', byteSize: 250_000 }]);

    for (const upload of [null, { id: 'att-new', status: 'ACTIVE' }]) {
      await assert.rejects(
        () => new CompletePaymentSlipUploadUseCase(repoWith(upload), completeUpload).execute(ctx(perms), 'rb-1', 'att-new', {}),
        /payment_slip_invalid/,
      );
    }
    assert.equal(completed.length, 1);
  });

  it('attaches a slip to a recorded payment and audits a moved signed copy with what was withdrawn', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req, { slipSource: 'SIGNED_COPY' });
    await new RecordReimbursementPaymentUseCase(repo, noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any)
      .execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' });
    const audits: any[] = [];
    const uc = new AttachPaymentSlipUseCase(repo, { log: async (entry: any) => { audits.push(entry); } } as any, fakeDetailEvidence as any);

    const detail = await uc.execute(ctx(perms), 'rb-1', 'pay-1', { attachmentId: 'att-misfiled' });
    assert.deepEqual(detail.payments[0]!.slips.map((slip) => slip.attachmentId), ['att-misfiled']);
    assert.deepEqual(audits.map((entry) => [entry.action, entry.targetId, entry.riskLevel, entry.metadataJson]), [[
      'reimbursement.payment.slip.attach', 'pay-1', 'HIGH',
      { requestId: 'rb-1', slipAttachmentId: 'att-misfiled', slipSource: 'SIGNED_COPY',
        movedFromPurpose: 'reimbursement.claim_form.signed', originalUploaderUserId: 'fin-1', paperDeclarationWithdrawn: true },
    ]]);

    // The same file again changes nothing and writes no second audit row.
    await uc.execute(ctx(perms), 'rb-1', 'pay-1', { attachmentId: 'att-misfiled' });
    assert.equal(repo.slips['pay-1'].length, 1);
    assert.equal(audits.length, 1);
  });

  it('refuses to attach a slip without the payment-record right, outside the branch, or to another claim\'s payment', async () => {
    const req = financeReviewedRequest();
    const repo = fakeRepo(req);
    await new RecordReimbursementPaymentUseCase(repo, noopAudit, noopOutbox, reserve, commit, fakeDetailEvidence as any)
      .execute(ctx(perms), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' });
    const uc = new AttachPaymentSlipUseCase(repo, noopAudit, fakeDetailEvidence as any);
    await assert.rejects(() => uc.execute(ctx(['reimbursement.finance_review']), 'rb-1', 'pay-1', { attachmentId: 'att-1' }), /Missing permission: reimbursement\.payment\.record/);
    await assert.rejects(() => uc.execute({ ...ctx(perms), scopes: { branchIds: ['branch-9'] } }, 'rb-1', 'pay-1', { attachmentId: 'att-1' }), /outside your assigned branch scope/);
    await assert.rejects(() => uc.execute(ctx(perms), 'rb-1', 'pay-of-another-claim', { attachmentId: 'att-1' }), /Payment not found/);
    assert.deepEqual(repo.slips, {});
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

  it('lets the approver who records payment clear a payment-step duplicate block (owner: requester + approver only)', async () => {
    const req = financeReviewedRequest({ status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED' });
    const repo = fakeRepo(req);
    await financeUC(repo).execute(ctx(['reimbursement.payment.record']), 'rb-1', { resolveDuplicate: true, duplicateResolutionReason: 'ใบเสร็จคนละใบ' });
    await assert.rejects(
      () => financeUC(repo).execute(ctx(['reimbursement.payment.record']), 'rb-1', { decision: 'APPROVED_FOR_PAYMENT' }),
      /Missing permission: reimbursement\.finance_review/,
    );
  });

  it('keeps the clear on payment.record or duplicate.resolve with a reason, and every decision on finance_review', async () => {
    const req = financeReviewedRequest({ status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED' });
    const repo = fakeRepo(req);
    await assert.rejects(
      () => financeUC(repo).execute(ctx(['reimbursement.finance_review']), 'rb-1', { resolveDuplicate: true, duplicateResolutionReason: 'ไม่ซ้ำ' }),
      /Missing permission: reimbursement\.payment\.record or reimbursement\.duplicate\.resolve/,
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
    // The repository runs the callback inside its transaction; this stands in for that.
    const rows: any[] = [];
    const repo = fakeRepo(req);
    const record = repo.recordPaymentAtomic.bind(repo);
    repo.recordPaymentAtomic = async (data: any) => {
      const result = await record(data);
      await data.onPaymentPersisted(fakeTx(rows), result.payment, result.request.paymentStatus);
      return result;
    };
    const afterCommit: any[] = [];
    const outbox = { append: async (...args: any[]) => { afterCommit.push(args); } } as any;
    const uc = new RecordReimbursementPaymentUseCase(repo, noopAudit, outbox, reserve, commit, fakeDetailEvidence as any);
    await uc.execute(ctx(['reimbursement.payment.record']), 'rb-1', { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' });

    const paid = rows.find((row) => row.eventType === 'reimbursement.payment_recorded');
    assert.equal(paid?.payloadJson.data.requestId, 'rb-1');
    assert.equal(paid?.payloadJson.data.requestNo, 'RB-202601-000001');
    assert.equal(paid?.payloadJson.data.requesterUserId, 'staff-1');
    assert.equal(paid?.payloadJson.data.paymentStatus, 'PAID');
    // The source of the notice stays the payment row, one event per payment.
    assert.deepEqual([paid?.aggregateType, paid?.aggregateId, paid?.eventKey], [
      'reimbursement_payment', 'pay-1', 'reimbursement.payment_recorded:reimbursement_payment:pay-1',
    ]);
    // Audit B10: nothing is appended after the commit any more; that append was the one that got lost.
    assert.equal(rows.length, 1);
    assert.deepEqual(afterCommit, []);
  });

  // Audit B10: the event used to be appended after the commit and not awaited, so a failure there
  // lost the requester's "paid" notice with no retry. It now commits or rolls back with the payment.
  it('is written inside the payment transaction: a failed event write takes the payment back with it', async () => {
    const h = atomicPaymentHarness();
    await assert.rejects(
      () => h.repo.recordPaymentAtomic({ ...atomicPaymentInput, onPaymentPersisted: async () => { throw new Error('event_write_failed'); } }),
      /event_write_failed/,
    );
    assert.equal(h.state().payments.length, 0);
    assert.notEqual(h.state().request.status, 'PAID');

    // The retry of the same attempt then records the payment and its event together.
    const seen: any[] = [];
    const retried = await h.repo.recordPaymentAtomic({
      ...atomicPaymentInput,
      onPaymentPersisted: async (_tx: any, payment: any, paymentStatus: string) => { seen.push([payment.id, payment.status, paymentStatus]); },
    });
    assert.equal(retried.created, true);
    assert.deepEqual(seen, [[retried.payment.id, 'RECORDED', 'PAID']]);
    assert.equal(h.state().request.status, 'PAID');
  });

  it('writes one event per payment and none for an idempotent replay', async () => {
    const h = atomicPaymentHarness();
    let events = 0;
    const input = { ...atomicPaymentInput, onPaymentPersisted: async () => { events += 1; } };

    assert.equal((await h.repo.recordPaymentAtomic(input)).created, true);
    assert.equal((await h.repo.recordPaymentAtomic(input)).created, false);

    assert.equal(events, 1);
    assert.equal(h.state().payments.length, 1);
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
  const outbox: any[] = [];
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
    outboxEvent: { create: async ({ data }: any) => { outbox.push(data); return data; } },
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
    outbox,
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
    // Audit B8: going back to draft is an event now, so the workflow module can close the approval task.
    assert.deepEqual(h.outbox.map((row) => [row.eventType, row.aggregateType, row.aggregateId, row.payloadJson.data]), [
      ['reimbursement.reopened', 'reimbursement_request', 'rb-1', { requestId: 'rb-1', status: 'DRAFT', previousStatus: 'REJECTED' }],
    ]);
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
    // Audit B8: written in the same transaction as the withdrawal, keyed by the claim's new version
    // so a second withdrawal of the same claim is a second event.
    assert.equal(h.outbox.length, 1);
    assert.equal(h.outbox[0].eventType, 'reimbursement.reopened');
    assert.equal(h.outbox[0].payloadJson.actorUserId, 'staff-1');
    assert.equal(h.outbox[0].payloadJson.data.previousStatus, 'PENDING_APPROVAL');
    assert.equal(h.outbox[0].eventKey, `reimbursement.reopened:reimbursement_request:rb-1:${h.request.updatedAt.toISOString()}`);
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
    assert.equal(h.outbox.length, 0, 'a refused withdrawal announces nothing');
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

type AtomicFault = 'create' | 'source-ref' | 'cas' | 'cas-conflict' | 'readback' | 'slip-link'
  // PostgreSQL rolling the transaction back for a serialization conflict, as each layer reports it.
  | 'serialization-row-lock' | 'serialization-commit';

/** A raw statement that lost a serialization conflict, as Prisma's pg driver adapter reports it. */
const rawSerializationFailure = () => Object.assign(new Error('Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`'), {
  code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40001', kind: 'postgres' } } },
});
/** The same conflict from a model query or at commit. */
const transactionConflict = () => Object.assign(new Error('Transaction failed due to a write conflict or a deadlock. Please retry your transaction'), { code: 'P2034' });

/** Enough of a Prisma `where` for the slip queries: equality, `{ in: [...] }` and `OR`. */
function rowMatches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((alternative: any) => rowMatches(row, alternative));
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}

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
  // Attachment rows and their links: what a slip is proven against and written to.
  let files: any[] = [];
  let links: any[] = [];
  // Claim lines of the company that name a file as their receipt (this claim's own line has none).
  const receiptLines: any[] = [];
  let fault = initialFault;
  let timeoutPending = ambiguousTimeout;
  let transactionTail = Promise.resolve();
  const writes = { paymentCreates: 0, requestUpdates: 0, locks: 0, lockKeys: [] as string[], isolationLevels: [] as string[] };

  const tx: any = {
    // Tagged-template call: the interpolated value is the advisory-lock key.
    $executeRaw: async (sql: TemplateStringsArray, ...values: string[]) => {
      if (fault === 'serialization-row-lock' && sql.join('').includes('FOR UPDATE')) throw rawSerializationFailure();
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
    attachmentObject: {
      findFirst: async ({ where }: any) => files.find((file) => rowMatches(file, where)) ?? null,
      update: async ({ where, data }: any) => Object.assign(files.find((file) => file.id === where.id)!, data),
    },
    reimbursementLine: { count: async ({ where }: any) => receiptLines.filter((line) => rowMatches(line, where)).length },
    attachmentLink: {
      findMany: async ({ where }: any) => links.filter((link) => rowMatches(link, where)),
      create: async ({ data }: any) => {
        if (fault === 'slip-link') throw new Error('fault:slip-link');
        const link = { id: `link-${links.length + 1}-${data.purpose}`, createdAt: new Date('2026-02-01T00:00:00.000Z'), ...data };
        links.push(link);
        return link;
      },
      deleteMany: async ({ where }: any) => {
        const kept = links.filter((link) => !rowMatches(link, where));
        const count = links.length - kept.length;
        links = kept;
        return { count };
      },
    },
    reimbursementPayment: {
      findFirst: async ({ where }: any) => payments.find((payment) => rowMatches(payment, where)) ?? null,
      count: async ({ where }: any) => payments.filter((payment) => rowMatches(payment, where)).length,
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
    // The slip preflight reads outside a transaction, from the same rows.
    attachmentObject: tx.attachmentObject, attachmentLink: tx.attachmentLink, reimbursementPayment: tx.reimbursementPayment,
    reimbursementLine: tx.reimbursementLine,
    $transaction: async (work: (transaction: any) => Promise<any>, options: any) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      writes.isolationLevels.push(options?.isolationLevel);
      const requestBefore = structuredClone(request);
      const paymentsBefore = structuredClone(payments);
      const filesBefore = structuredClone(files);
      const linksBefore = structuredClone(links);
      let committed = false;
      try {
        const result = await work(tx);
        if (fault === 'serialization-commit') throw transactionConflict();
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
          files = filesBefore;
          links = linksBefore;
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
    state: () => ({ request, payments, files, links }),
    addFile: (file: any) => { files.push(file); return file; },
    addLink: (link: any) => { links.push({ companyId: 'co-1', createdAt: new Date('2026-01-20T00:00:00.000Z'), ...link }); },
    addPayment: (payment: any) => { payments.push(payment); },
    addReceiptLine: (line: any) => { receiptLines.push({ companyId: 'co-1', ...line }); },
  };
}

/** The payer's own slip upload for rb-1, as the slip upload endpoint leaves it once completed. */
function slipUpload(overrides: Partial<any> = {}) {
  return {
    id: 'att-slip-1', companyId: 'co-1', status: 'ACTIVE', mimeType: 'image/jpeg', byteSize: 250_000,
    checksumSha256: 'a'.repeat(64), uploadedByUserId: 'fin-1',
    metadataJson: { generatedFor: 'reimbursement_payment_slip', requestId: 'rb-1' },
    ...overrides,
  };
}

/** A file attached through the "ใบเบิกที่เซ็นแล้ว" uploader with the paper declaration: the misfiled slip. */
function misfiledSignedCopy(h: ReturnType<typeof atomicPaymentHarness>, declared = true, id = 'att-misfiled') {
  h.addLink({ id: 'link-copy', attachmentId: id, targetType: 'reimbursement_request', targetId: 'rb-1', purpose: 'reimbursement.claim_form.signed', linkedByUserId: 'staff-1' });
  return h.addFile({
    id, companyId: 'co-1', status: 'ACTIVE', mimeType: 'application/pdf', byteSize: 12_000_000,
    checksumSha256: 'c'.repeat(64), uploadedByUserId: 'staff-1',
    metadataJson: { source: 'web', ...(declared && { reimbursementSignedCopyAck: { requestId: 'rb-1', requestNo: 'RB-202601-000001', acknowledgedByUserId: 'staff-1', acknowledgedAt: '2026-01-20T00:00:00.000Z', checksumSha256: 'c'.repeat(64), linkId: 'link-copy' } }) },
  });
}

const slipLinksOf = (h: ReturnType<typeof atomicPaymentHarness>) => h.state().links
  .filter((link) => link.purpose === 'reimbursement.payment.slip')
  .map((link) => [link.attachmentId, link.targetType, link.targetId, link.linkedByUserId]);

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

const atomicTransferInput = { ...atomicPaymentInput, paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-1' };

describe('PrismaReimbursementRepository payment slips', () => {
  it('refuses a transfer without a slip under the payment lock, whatever the caller checked', async () => {
    const h = atomicPaymentHarness();
    await assert.rejects(
      () => h.repo.recordPaymentAtomic(atomicTransferInput),
      (error: any) => error.getStatus() === 422 && error.message === 'payment_slip_required',
    );
    assert.equal(h.state().payments.length, 0);
    assert.equal(h.state().request.paymentStatus, 'UNPAID');
  });

  it('writes the payment and its slip link together, with the checksum the slip had', async () => {
    const h = atomicPaymentHarness();
    h.addFile(slipUpload());
    const result = await h.repo.recordPaymentAtomic({ ...atomicTransferInput, slipAttachmentId: 'att-slip-1' });

    assert.equal(result.created, true);
    assert.deepEqual(result.slip, { attachmentId: 'att-slip-1', source: 'UPLOAD', uploadedByUserId: 'fin-1', declarationWithdrawn: false });
    assert.deepEqual(
      [result.payment.slipAttachmentId, result.payment.slipChecksumSha256, result.payment.paymentMethod, result.payment.paymentReference],
      ['att-slip-1', 'a'.repeat(64), 'BANK_TRANSFER', 'TXN-1'],
    );
    assert.deepEqual(slipLinksOf(h), [['att-slip-1', 'reimbursement_payment', 'pay-1', 'fin-1']]);
    // After the two payment locks: the key generic deletion takes before it looks for holds, then the
    // file's own row (its id is that statement's first value), so a delete can race neither way.
    assert.deepEqual(h.writes.lockKeys, ['co-1:rb-1:reimbursement-payment', 'co-1:rb-1:reimbursement-request', 'co-1:att-slip-1:attachment-retention', 'att-slip-1']);
  });

  it('rolls the payment back when the slip link cannot be written, and the retry writes both once', async () => {
    const h = atomicPaymentHarness('slip-link');
    h.addFile(slipUpload());
    const input = { ...atomicTransferInput, slipAttachmentId: 'att-slip-1' };
    await assert.rejects(() => h.repo.recordPaymentAtomic(input), /fault:slip-link/);
    assert.equal(h.state().payments.length, 0, 'no payment without its slip');
    assert.equal(h.state().request.paymentStatus, 'UNPAID');
    assert.deepEqual(slipLinksOf(h), []);

    h.setFault();
    assert.equal((await h.repo.recordPaymentAtomic(input)).created, true);
    assert.equal(h.state().payments.length, 1);
    assert.equal(slipLinksOf(h).length, 1);
  });

  it('gives two racing requests one payment and one slip link', async () => {
    const h = atomicPaymentHarness();
    h.addFile(slipUpload());
    const input = { ...atomicTransferInput, slipAttachmentId: 'att-slip-1' };
    const results = await Promise.all([h.repo.recordPaymentAtomic(input), h.repo.recordPaymentAtomic(input)]);
    assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
    assert.equal(h.state().payments.length, 1);
    assert.equal(slipLinksOf(h).length, 1);
  });

  it('refuses a replayed key that names a different slip, no slip, or a payment since voided', async () => {
    const h = atomicPaymentHarness();
    h.addFile(slipUpload());
    h.addFile(slipUpload({ id: 'att-slip-2' }));
    const input = { ...atomicTransferInput, slipAttachmentId: 'att-slip-1' };
    await h.repo.recordPaymentAtomic(input);
    for (const slipAttachmentId of ['att-slip-2', undefined]) {
      await assert.rejects(
        () => h.repo.recordPaymentAtomic({ ...input, slipAttachmentId }),
        (error: any) => error.getStatus() === 409 && error.message === 'reimbursement_payment_idempotency_conflict',
      );
    }
    assert.equal(h.state().payments.length, 1);
    assert.equal(slipLinksOf(h).length, 1);

    // Voided: the same key and the same facts no longer describe a payment that stands.
    Object.assign(h.state().payments[0], { status: 'VOIDED' });
    await assert.rejects(() => h.repo.recordPaymentAtomic(input), /reimbursement_payment_idempotency_conflict/);
  });

  it('accepts only this claim\'s own slip: the payer\'s upload, an attached signed copy, or an earlier slip of the claim', async () => {
    const refused: [string, (h: ReturnType<typeof atomicPaymentHarness>) => void][] = [
      ['no such file', () => undefined],
      ['an upload still pending', (h) => h.addFile(slipUpload({ status: 'PENDING_UPLOAD' }))],
      ['a deleted file', (h) => h.addFile(slipUpload({ status: 'DELETED' }))],
      ['another company\'s file', (h) => h.addFile(slipUpload({ companyId: 'co-2' }))],
      ['a slip uploaded for another claim', (h) => h.addFile(slipUpload({ metadataJson: { generatedFor: 'reimbursement_payment_slip', requestId: 'rb-2' } }))],
      ['another person\'s slip upload', (h) => h.addFile(slipUpload({ uploadedByUserId: 'someone-else' }))],
      ['a file type that is not PDF, JPG or PNG', (h) => h.addFile(slipUpload({ mimeType: 'text/html' }))],
      ['a slip upload over 10 MB', (h) => h.addFile(slipUpload({ byteSize: 10 * 1024 * 1024 + 1 }))],
      ['an ordinary upload, such as a receipt', (h) => h.addFile(slipUpload({ metadataJson: null }))],
      ['a signed copy of another claim', (h) => {
        h.addFile(slipUpload({ metadataJson: null }));
        h.addLink({ id: 'link-other', attachmentId: 'att-slip-1', targetType: 'reimbursement_request', targetId: 'rb-2', purpose: 'reimbursement.claim_form.signed' });
      }],
      ['the slip of another claim\'s payment', (h) => {
        h.addFile(slipUpload());
        h.addLink({ id: 'link-other', attachmentId: 'att-slip-1', targetType: 'reimbursement_payment', targetId: 'pay-of-rb-2', purpose: 'reimbursement.payment.slip' });
      }],
      // A slip is exclusive: the generic file paths stop serving it, so it cannot also be anything else's evidence.
      ['a slip upload that is also an expense receipt', (h) => {
        h.addFile(slipUpload());
        h.addLink({ id: 'link-receipt', attachmentId: 'att-slip-1', targetType: 'expense.record', targetId: 'exp-9', purpose: 'expense.receipt.primary' });
      }],
      ['a slip upload that a claim line names as its receipt', (h) => {
        h.addFile(slipUpload());
        h.addReceiptLine({ id: 'rbl-9', reimbursementRequestId: 'rb-9', attachmentId: 'att-slip-1' });
      }],
      ['this claim\'s signed copy that is also a signed copy of another claim', (h) => {
        misfiledSignedCopy(h, false, 'att-slip-1');
        h.addLink({ id: 'link-other', attachmentId: 'att-slip-1', targetType: 'reimbursement_request', targetId: 'rb-2', purpose: 'reimbursement.claim_form.signed' });
      }],
      ['this claim\'s signed copy that is also an expense receipt', (h) => {
        misfiledSignedCopy(h, false, 'att-slip-1');
        h.addLink({ id: 'link-receipt', attachmentId: 'att-slip-1', targetType: 'expense.record', targetId: 'exp-9', purpose: 'expense.receipt.supporting' });
      }],
      ['this claim\'s signed copy that is also the receipt of one of its own lines', (h) => {
        misfiledSignedCopy(h, false, 'att-slip-1');
        h.addReceiptLine({ id: 'rbl-1', reimbursementRequestId: 'rb-1', attachmentId: 'att-slip-1' });
      }],
      ['an earlier slip of this claim that has since been linked to something else', (h) => {
        h.addFile(slipUpload({ uploadedByUserId: 'another-payer' }));
        h.addPayment({ id: 'pay-old', companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'old', status: 'VOIDED', slipAttachmentId: 'att-slip-1' });
        h.addLink({ id: 'link-old', attachmentId: 'att-slip-1', targetType: 'reimbursement_payment', targetId: 'pay-old', purpose: 'reimbursement.payment.slip' });
        h.addLink({ id: 'link-receipt', attachmentId: 'att-slip-1', targetType: 'expense.record', targetId: 'exp-9', purpose: 'expense.receipt.primary' });
      }],
    ];
    for (const [label, arrange] of refused) {
      const h = atomicPaymentHarness();
      arrange(h);
      await assert.rejects(
        () => h.repo.recordPaymentAtomic({ ...atomicTransferInput, slipAttachmentId: 'att-slip-1' }),
        (error: any) => error.getStatus() === 422 && error.message === 'payment_slip_invalid',
        label,
      );
      assert.equal(h.state().payments.filter((payment) => payment.status !== 'VOIDED').length, 0, label);
      assert.deepEqual(h.state().links.filter((link) => link.id.startsWith('link-') && link.id.endsWith('reimbursement.payment.slip')), [], `${label}: no slip link written`);
      // The friendly preflight gives the same verdict as the check under the lock.
      await assert.rejects(() => h.repo.assertPaymentSlipUsable({ companyId: 'co-1', requestId: 'rb-1', attachmentId: 'att-slip-1', actorUserId: 'fin-1' }), /payment_slip_invalid/, label);
    }

    // A slip of an earlier, voided payment of this claim serves the new payment: each record has its own link.
    const reuse = atomicPaymentHarness();
    reuse.addFile(slipUpload({ uploadedByUserId: 'another-payer' }));
    reuse.addPayment({ id: 'pay-old', companyId: 'co-1', reimbursementRequestId: 'rb-1', idempotencyKey: 'old', status: 'VOIDED', slipAttachmentId: 'att-slip-1' });
    reuse.addLink({ id: 'link-old', attachmentId: 'att-slip-1', targetType: 'reimbursement_payment', targetId: 'pay-old', purpose: 'reimbursement.payment.slip', linkedByUserId: 'another-payer' });
    const repaid = await reuse.repo.recordPaymentAtomic({ ...atomicTransferInput, slipAttachmentId: 'att-slip-1' });
    assert.equal(repaid.slip?.source, 'PREVIOUS_SLIP');
    assert.deepEqual(slipLinksOf(reuse).map(([, , paymentId]) => paymentId), ['pay-old', repaid.payment.id], 'the voided record keeps its slip');
  });

  it('moves a misfiled signed copy to be the slip: the copy link and its paper declaration go, the file stays', async () => {
    const h = atomicPaymentHarness();
    misfiledSignedCopy(h);
    const result = await h.repo.recordPaymentAtomic({ ...atomicTransferInput, slipAttachmentId: 'att-misfiled' });

    // No size limit on a file already stored: the 10 MB cap is on new slip uploads.
    assert.deepEqual(result.slip, { attachmentId: 'att-misfiled', source: 'SIGNED_COPY', uploadedByUserId: 'staff-1', declarationWithdrawn: true });
    assert.deepEqual(h.state().links.map((link) => [link.attachmentId, link.purpose, link.targetId]), [['att-misfiled', 'reimbursement.payment.slip', 'pay-1']]);
    const file = h.state().files[0];
    assert.equal(file.status, 'ACTIVE');
    assert.deepEqual(file.metadataJson, { source: 'web' }, 'the stored declaration is removed, other metadata kept');
  });

  it('attaches the misfiled copy to a payment already recorded, and an undeclared copy withdraws nothing', async () => {
    for (const declared of [true, false]) {
      const h = atomicPaymentHarness();
      await h.repo.recordPaymentAtomic(atomicPaymentInput); // cash, recorded before the slip existed
      misfiledSignedCopy(h, declared);
      const attached = await h.repo.attachPaymentSlipAtomic({ companyId: 'co-1', requestId: 'rb-1', paymentId: 'pay-1', attachmentId: 'att-misfiled', actorUserId: 'fin-1' });
      assert.deepEqual(attached, { created: true, slip: { attachmentId: 'att-misfiled', source: 'SIGNED_COPY', uploadedByUserId: 'staff-1', declarationWithdrawn: declared } });
      assert.deepEqual(h.state().links.map((link) => [link.purpose, link.targetId, link.linkedByUserId]), [['reimbursement.payment.slip', 'pay-1', 'fin-1']]);
      assert.deepEqual(h.state().files[0].metadataJson, { source: 'web' });
      // The payment row is history: attaching later never rewrites what it was recorded with.
      assert.equal(h.state().payments[0].slipAttachmentId, undefined);

      // Again: nothing changes.
      assert.deepEqual(await h.repo.attachPaymentSlipAtomic({ companyId: 'co-1', requestId: 'rb-1', paymentId: 'pay-1', attachmentId: 'att-misfiled', actorUserId: 'fin-1' }), { created: false });
      assert.equal(h.state().links.length, 1);
    }
  });

  it('withdraws only the declaration made with the copy it removes: one bound to another link is left alone', async () => {
    const h = atomicPaymentHarness();
    const file = misfiledSignedCopy(h);
    // The stored declaration names a link that is not this claim's copy (pre-filled at upload, or left by a link since replaced).
    const elsewhere = { ...file.metadataJson.reimbursementSignedCopyAck, linkId: 'link-of-something-else' };
    file.metadataJson = { source: 'web', reimbursementSignedCopyAck: elsewhere };

    const result = await h.repo.recordPaymentAtomic({ ...atomicTransferInput, slipAttachmentId: 'att-misfiled' });
    assert.deepEqual(result.slip, { attachmentId: 'att-misfiled', source: 'SIGNED_COPY', uploadedByUserId: 'staff-1', declarationWithdrawn: false });
    assert.deepEqual(h.state().files[0].metadataJson, { source: 'web', reimbursementSignedCopyAck: elsewhere }, 'not this claim\'s declaration to strip');
    // The copy link itself is gone all the same: the file is the slip now, and only the slip.
    assert.deepEqual(h.state().links.map((link) => link.purpose), ['reimbursement.payment.slip']);
  });

  it('answers a serialization conflict as "the payment changed, reload and retry", never a server error', async () => {
    for (const boundary of ['serialization-row-lock', 'serialization-commit'] as AtomicFault[]) {
      const pay = atomicPaymentHarness(boundary);
      pay.addFile(slipUpload());
      await assert.rejects(
        () => pay.repo.recordPaymentAtomic({ ...atomicTransferInput, slipAttachmentId: 'att-slip-1' }),
        (error: any) => error.getStatus() === 409 && error.message === 'reimbursement_payment_state_changed',
        boundary,
      );
      assert.equal(pay.state().payments.length, 0, `${boundary}: nothing was written`);
      assert.deepEqual(slipLinksOf(pay), [], boundary);
      // The retry the message asks for goes through.
      pay.setFault();
      assert.equal((await pay.repo.recordPaymentAtomic({ ...atomicTransferInput, slipAttachmentId: 'att-slip-1' })).created, true, boundary);

      const attach = atomicPaymentHarness();
      await attach.repo.recordPaymentAtomic(atomicPaymentInput);
      attach.addFile(slipUpload());
      attach.setFault(boundary);
      await assert.rejects(
        () => attach.repo.attachPaymentSlipAtomic({ companyId: 'co-1', requestId: 'rb-1', paymentId: 'pay-1', attachmentId: 'att-slip-1', actorUserId: 'fin-1' }),
        (error: any) => error.getStatus() === 409 && error.message === 'reimbursement_payment_state_changed',
        boundary,
      );
      assert.deepEqual(slipLinksOf(attach), [], boundary);
    }
    // Any other failure stays what it was: this is not a net for every error.
    const other = atomicPaymentHarness('create');
    await assert.rejects(() => other.repo.recordPaymentAtomic(atomicPaymentInput), /fault:create/);
  });

  it('adds slips to a recorded payment only: five at most, none to a voided or foreign payment', async () => {
    const h = atomicPaymentHarness();
    await h.repo.recordPaymentAtomic(atomicPaymentInput);
    const attach = (attachmentId: string, paymentId = 'pay-1') => h.repo.attachPaymentSlipAtomic({ companyId: 'co-1', requestId: 'rb-1', paymentId, attachmentId, actorUserId: 'fin-1' });
    for (let index = 1; index <= 6; index += 1) h.addFile(slipUpload({ id: `att-slip-${index}` }));
    for (let index = 1; index <= 5; index += 1) assert.equal((await attach(`att-slip-${index}`)).created, true);
    await assert.rejects(() => attach('att-slip-6'), (error: any) => error.getStatus() === 422 && error.message === 'payment_slip_limit_reached');
    assert.equal(slipLinksOf(h).length, 5);

    await assert.rejects(() => attach('att-slip-6', 'pay-of-another-claim'), /Payment not found/);
    Object.assign(h.state().payments[0], { status: 'VOIDED' });
    await assert.rejects(() => attach('att-slip-6'), (error: any) => error.getResponse().code === 'reimbursement_payment_changed');
    assert.equal(slipLinksOf(h).length, 5, 'a voided payment keeps its slips and takes no more');
  });

  it('lists slips per payment from the links, oldest first, on live files only', async () => {
    let where: any;
    let orderBy: any;
    const client = { attachmentLink: { findMany: async (args: any) => {
      where = args.where; orderBy = args.orderBy;
      return [
        { attachmentId: 'att-a', targetId: 'pay-1', createdAt: new Date('2026-02-01T00:00:00.000Z') },
        { attachmentId: 'att-b', targetId: 'pay-2', createdAt: new Date('2026-02-02T00:00:00.000Z') },
        { attachmentId: 'att-c', targetId: 'pay-1', createdAt: new Date('2026-02-03T00:00:00.000Z') },
      ];
    } } };
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    const slips = await repo.listPaymentSlips('co-1', ['pay-1', 'pay-2']);
    assert.deepEqual(Object.fromEntries(Object.entries(slips).map(([id, rows]) => [id, rows.map((row) => row.attachmentId)])), { 'pay-1': ['att-a', 'att-c'], 'pay-2': ['att-b'] });
    assert.deepEqual(where, {
      companyId: 'co-1', targetType: 'reimbursement_payment', targetId: { in: ['pay-1', 'pay-2'] },
      purpose: 'reimbursement.payment.slip', attachment: { status: 'ACTIVE' },
    });
    assert.deepEqual(orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
    assert.deepEqual(await new PrismaReimbursementRepository({ client: {} } as any, {} as any).listPaymentSlips('co-1', []), {}, 'no payment, no query');
  });
});
