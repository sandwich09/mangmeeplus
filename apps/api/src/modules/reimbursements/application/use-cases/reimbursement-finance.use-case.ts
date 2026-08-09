import { createHash } from 'node:crypto';
import { Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  FinanceReviewReimbursementInput,
  RecordReimbursementPaymentInput,
  VoidReimbursementPaymentInput,
  ReimbursementFinanceQueueItem,
  ReimbursementRequestDetail,
} from '@watchdog-bms/contracts';
import { civilDate, civilPeriodKey, REIMBURSEMENT_SEQUENCE_KEYS, LEDGER_SEQUENCE_KEY, todayCivilDate } from '@watchdog-bms/contracts';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { CancelDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/cancel-document-number.use-case';
import { toRequestSummary, toRequestDetail } from '../dto/reimbursement.mapper';
import { effectivePolicy } from '../../domain/reimbursement.constants';
import { ReimbursementProjectionOrchestratorService } from '../services/reimbursement-projection-orchestrator.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import {
  validatePaymentRecording,
  ageHours,
  d,
  redactPayload,
} from '../../domain/logic/reimbursement.logic';

async function appendReimbursementOutboxWithinTx(tx: any, input: {
  companyId: string;
  eventType: string;
  aggregateId: string;
  eventKey: string;
  payloadJson: Record<string, unknown>;
}): Promise<void> {
  await tx.outboxEvent.createMany({
    data: [{
      companyId: input.companyId,
      eventType: input.eventType,
      aggregateType: 'reimbursement_request',
      aggregateId: input.aggregateId,
      eventKey: input.eventKey,
      payloadJson: input.payloadJson,
      priority: 'NORMAL',
      status: 'PENDING',
    }],
    skipDuplicates: true,
  });
}

@Injectable()
export class ListFinanceQueueUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository) {}

  async execute(ctx: RequestContext): Promise<ReimbursementFinanceQueueItem[]> {
    if (!ctx.permissions.includes('reimbursement.finance_review')) throw new ForbiddenException('Missing permission: reimbursement.finance_review');
    const rows = await this.repo.listRequests({
      companyId: ctx.companyId,
      statuses: ['FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID'],
      scopes: ctx.scopes ?? {},
    });
    const now = new Date();
    return rows.map((r) => ({
      ...toRequestSummary(r),
      ageHours: r.approvedAt ? ageHours(r.approvedAt, now) : 0,
      hasDuplicateBlocker: r.duplicateStatus === 'POSSIBLE_DUPLICATE' || r.duplicateStatus === 'CONFIRMED_DUPLICATE',
    }));
  }
}

@Injectable()
export class FinanceReviewReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly projections: ReimbursementProjectionOrchestratorService,
  ) {}

  async execute(ctx: RequestContext, id: string, input: FinanceReviewReimbursementInput): Promise<ReimbursementRequestDetail> {
    if (!ctx.permissions.includes('reimbursement.finance_review')) throw new ForbiddenException('Missing permission: reimbursement.finance_review');

    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    if (req.status !== 'FINANCE_REVIEW') {
      throw new UnprocessableEntityException(`Cannot finance-review from status ${req.status}`);
    }
    if (!isBranchInScope(ctx.scopes ?? {}, req.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');

    const now = new Date();
    if (input.resolveDuplicate) {
      if (!ctx.permissions.includes('reimbursement.duplicate.resolve')) throw new ForbiddenException('Missing permission: reimbursement.duplicate.resolve');
      if (!input.duplicateResolutionReason?.trim()) throw new BadRequestException('duplicate_resolution_reason_required');
    }

    if (input.decision === 'APPROVED_FOR_PAYMENT') {
      const decision = await this.repo.beginFinanceApprovalAtomic({
        companyId: ctx.companyId,
        requestId: id,
        expectedUpdatedAt: req.updatedAt,
        actorUserId: ctx.userId,
        scopes: ctx.scopes ?? {},
        reviewedAt: now,
        note: input.note,
        resolveRequestDuplicates: input.resolveDuplicate,
        duplicateResolutionReason: input.duplicateResolutionReason,
        onDecisionPersisted: async (tx) => {
          await this.audit.log({
            companyId: ctx.companyId,
            actorUserId: ctx.userId,
            action: 'reimbursement.finance_review.decision_durable',
            targetType: 'reimbursement_request',
            targetId: id,
            requestId: ctx.requestId,
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            metadataJson: {
              decision: input.decision,
              projectionPending: true,
              requestDuplicateOverride: Boolean(input.resolveDuplicate),
              duplicateResolutionReason: input.duplicateResolutionReason,
            },
          }, tx);
          await appendReimbursementOutboxWithinTx(tx, {
            companyId: ctx.companyId,
            eventType: 'reimbursement.finance_projection_started',
            aggregateId: id,
            eventKey: `reimbursement.finance_projection_started:reimbursement_request:${id}:${ctx.userId}`,
            payloadJson: {
              companyId: ctx.companyId,
              actorUserId: ctx.userId,
              requestId: ctx.requestId,
              aggregateType: 'reimbursement_request',
              aggregateId: id,
              occurredAt: now.toISOString(),
              data: { requestId: id, decision: 'PROJECTION_PENDING', originalDecision: input.decision },
            },
          });
        },
      });
      // `resumed` means the decision was already durable and this call is the recovery lever
      // ("ดำเนินการต่อ") for a claim stranded at FINANCE_REVIEW/APPROVED_FOR_PAYMENT: the
      // decision write is skipped, the projection phase runs again. The retry gets its own
      // audit row so the second attempt is not invisible.
      if (decision.resumed) {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'reimbursement.finance_review.projection_retry',
          targetType: 'reimbursement_request',
          targetId: id,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { decision: input.decision, retry: true, projectionPending: true },
        });
      }
      const policy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
      await this.projections.execute(ctx, decision.request, {
        kind: 'FINANCE',
        actorUserId: ctx.userId,
        allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      });
      const readyAt = new Date();
      await this.repo.completeFinanceProjectionAtomic({
        companyId: ctx.companyId,
        requestId: id,
        decisionActorUserId: ctx.userId,
        scopes: ctx.scopes ?? {},
        completedAt: readyAt,
        onReadyPersisted: async (tx) => {
          await this.audit.log({
            companyId: ctx.companyId,
            actorUserId: ctx.userId,
            action: 'reimbursement.finance_review.update',
            targetType: 'reimbursement_request',
            targetId: id,
            requestId: ctx.requestId,
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            metadataJson: { decision: input.decision, projectionReady: true },
          }, tx);
          for (const eventType of ['reimbursement.finance_review_updated', 'reimbursement.ready_for_payment']) {
            await appendReimbursementOutboxWithinTx(tx, {
              companyId: ctx.companyId,
              eventType,
              aggregateId: id,
              eventKey: `${eventType}:reimbursement_request:${id}:${ctx.userId}`,
              payloadJson: {
                companyId: ctx.companyId,
                actorUserId: ctx.userId,
                requestId: ctx.requestId,
                aggregateType: 'reimbursement_request',
                aggregateId: id,
                occurredAt: readyAt.toISOString(),
                data: {
                  requestId: id,
                  requestNo: req.requestNo,
                  requesterUserId: req.requesterUserId,
                  status: 'READY_FOR_PAYMENT',
                  decision: input.decision,
                  amount: req.amount,
                  currency: req.currency,
                },
              },
            });
          }
        },
      });
    } else if (input.decision === 'NEEDS_INFO') {
      await this.recordNonApproval(ctx, req, input, now, 'NEEDS_INFO');
    } else if (input.decision === 'BLOCKED') {
      await this.recordNonApproval(ctx, req, input, now, 'BLOCKED');
    } else {
      throw new BadRequestException('invalid_finance_decision');
    }

    const detail = await this.repo.findRequestById(ctx.companyId, id, true);
    return toRequestDetail(detail!);
  }

  private async recordNonApproval(
    ctx: RequestContext,
    request: Awaited<ReturnType<PrismaReimbursementRepository['findRequestById']>> & {},
    input: FinanceReviewReimbursementInput,
    reviewedAt: Date,
    decision: 'NEEDS_INFO' | 'BLOCKED',
  ): Promise<void> {
    await this.repo.recordFinanceReviewAtomic({
      companyId: ctx.companyId,
      requestId: request.id,
      expectedUpdatedAt: request.updatedAt,
      actorUserId: ctx.userId,
      scopes: ctx.scopes ?? {},
      reviewedAt,
      decision,
      note: input.note,
      onDecisionPersisted: async (tx) => {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'reimbursement.finance_review.update',
          targetType: 'reimbursement_request',
          targetId: request.id,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { decision },
        }, tx);
        await appendReimbursementOutboxWithinTx(tx, {
          companyId: ctx.companyId,
          eventType: 'reimbursement.finance_review_updated',
          aggregateId: request.id,
          eventKey: `reimbursement.finance_review_updated:reimbursement_request:${request.id}:${request.updatedAt.toISOString()}`,
          payloadJson: {
            companyId: ctx.companyId,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
            aggregateType: 'reimbursement_request',
            aggregateId: request.id,
            occurredAt: reviewedAt.toISOString(),
            // Same shape as the APPROVED_FOR_PAYMENT branch above: the finance-review workflow
            // template matches on requestId and renders {{requestNo}}/{{amount}}, so a
            // decision-only payload would match nothing and notify with an empty subject.
            data: {
              requestId: request.id,
              requestNo: request.requestNo,
              requesterUserId: request.requesterUserId,
              decision,
              amount: request.amount,
              currency: request.currency,
            },
          },
        });
      },
    });
  }
}

@Injectable()
export class RecordReimbursementPaymentUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, id: string, input: RecordReimbursementPaymentInput): Promise<ReimbursementRequestDetail> {
    if (!ctx.permissions.includes('reimbursement.payment.record')) throw new ForbiddenException('Missing permission: reimbursement.payment.record');

    const paidAt = new Date(input.paidAt);
    if (Number.isNaN(paidAt.getTime())) throw new BadRequestException('payment_date_invalid');
    const clientKey = input.idempotencyKey?.trim();
    if (input.idempotencyKey !== undefined && (!clientKey || clientKey.length > 128)) {
      throw new BadRequestException('payment_idempotency_key_invalid');
    }

    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');

    const recorded = req.payments?.find((payment) => payment.status === 'RECORDED');
    if (req.paymentStatus === 'PAID' && recorded) {
      const samePayment = d(recorded.paidAmount).eq(d(input.paidAmount))
        && recorded.currency === (input.currency ?? req.currency)
        && recorded.paymentMethod === input.paymentMethod
        && recorded.paidAt.getTime() === paidAt.getTime()
        && recorded.paymentReference === input.paymentReference
        && recorded.bankAccountId === input.bankAccountId;
      if (!samePayment) throw new ConflictException('reimbursement_payment_already_recorded');
      if (!recorded.idempotencyKey.startsWith('legacy:')) {
        await this.ensurePaymentNumber(ctx, paidAt, recorded.idempotencyKey, recorded.id, recorded.paymentNo);
      }
      return toRequestDetail(req);
    }

    // Friendly preflight before reserving a payment number; the repository
    // repeats the same proof under the payment lock to close the race.
    await this.repo.assertClaimPaymentReady(ctx.companyId, id);

    const policy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
    const openDuplicates = await this.repo.listOpenDuplicateCandidates(ctx.companyId, id);
    const duplicateBlocking = policy.duplicatePolicy === 'BLOCK_PAYMENT' && openDuplicates.length > 0;

    const error = validatePaymentRecording({
      status: req.status,
      financeReviewRequired: policy.financeReviewRequired,
      financeReviewApproved: req.financeReviewStatus === 'APPROVED_FOR_PAYMENT' || !policy.financeReviewRequired,
      duplicateBlocking,
      approvedAmount: req.amount,
      outstandingAmount: req.outstandingAmount,
      paidAmount: input.paidAmount,
      paymentMethod: input.paymentMethod,
      paymentReference: input.paymentReference,
    });
    if (error) throw new UnprocessableEntityException(error);

    const paymentAttemptKey = createHash('sha256')
      .update([ctx.companyId, id, clientKey ?? req.updatedAt.toISOString()].join(':'))
      .digest('hex');
    const reservation = await this.reservePaymentNumber(ctx, paidAt, paymentAttemptKey);
    const now = new Date();
    const result = await this.repo.recordPaymentAtomic({
      companyId: ctx.companyId,
      reimbursementRequestId: id,
      idempotencyKey: paymentAttemptKey,
      paymentNo: reservation.paymentNo,
      paidAmount: input.paidAmount,
      currency: input.currency ?? req.currency,
      paymentMethod: input.paymentMethod,
      paidAt,
      paymentReference: input.paymentReference,
      bankAccountId: input.bankAccountId,
      paidByUserId: ctx.userId,
    });
    if (result.created) await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payment.record',
      targetType: 'reimbursement_payment', targetId: result.payment.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { paymentNo: reservation.paymentNo, paidAmount: input.paidAmount, paymentMethod: input.paymentMethod, requestId: id },
    });
    if (result.created) void this.outbox.append('reimbursement.payment_recorded', 'reimbursement_payment', result.payment.id, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'reimbursement_payment', aggregateId: result.payment.id, occurredAt: now.toISOString(),
      data: redactPayload({ requestId: id, requestNo: req.requestNo, requesterUserId: req.requesterUserId, paymentNo: reservation.paymentNo, paidAmount: input.paidAmount, currency: input.currency ?? req.currency, sourceType: 'REIMBURSEMENT_PAYMENT', paymentStatus: result.request.paymentStatus }),
    });
    if (result.created && reservation.reservedId) {
      await this.commitNumber.execute({
        id: reservation.reservedId,
        companyId: ctx.companyId,
        ownerType: 'reimbursement_payment',
        ownerId: result.payment.id,
      }, ctx.userId);
    }

    return toRequestDetail(result.request);
  }

  private async reservePaymentNumber(
    ctx: RequestContext,
    paidAt: Date,
    paymentAttemptKey: string,
  ): Promise<{ paymentNo: string; reservedId?: string; status?: string; ownerType?: string; ownerId?: string }> {
    const periodKey = civilPeriodKey(civilDate(paidAt));
    try {
      const reserved = await this.reserveNumber.execute({
        companyId: ctx.companyId,
        documentType: REIMBURSEMENT_SEQUENCE_KEYS.PAYMENT,
        periodKey,
        reservedByUserId: ctx.userId,
        idempotencyKey: `reimb-pay:${paymentAttemptKey}`,
      });
      return {
        paymentNo: reserved.documentNumber,
        reservedId: reserved.id,
        status: reserved.status,
        ownerType: reserved.ownerType,
        ownerId: reserved.ownerId,
      };
    } catch (error) {
      if (!(error instanceof UnprocessableEntityException)) throw error;
      return { paymentNo: `RBPAY-${periodKey.replace('-', '')}-${paymentAttemptKey.slice(0, 8).toUpperCase()}` };
    }
  }

  private async ensurePaymentNumber(
    ctx: RequestContext,
    paidAt: Date,
    paymentAttemptKey: string,
    paymentId: string,
    expectedPaymentNo?: string,
  ): Promise<void> {
    const reserved = await this.reservePaymentNumber(ctx, paidAt, paymentAttemptKey);
    if (!reserved.reservedId) return;
    if (expectedPaymentNo && reserved.paymentNo !== expectedPaymentNo) {
      throw new ConflictException('reimbursement_payment_number_conflict');
    }
    if (reserved.status === 'RESERVED') {
      await this.commitNumber.execute({
        id: reserved.reservedId,
        companyId: ctx.companyId,
        ownerType: 'reimbursement_payment',
        ownerId: paymentId,
      }, ctx.userId);
      return;
    }
    if (reserved.status !== 'COMMITTED' || reserved.ownerType !== 'reimbursement_payment' || reserved.ownerId !== paymentId) {
      throw new ConflictException('reimbursement_payment_number_conflict');
    }
  }
}

@Injectable()
export class VoidReimbursementPaymentUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly cancelNumber: CancelDocumentNumberUseCase,
  ) {}

  // GAP-02: void is now a true reversal, mirroring VoidExpenseUseCase (H-04).
  // If the settlement journal was posted, the void reserves a reversal number
  // outside the transaction and commits it only when a reversal is created;
  // if the payment was never posted, no number is reserved and postingStatus
  // resolves to 'not_required'. The reversal itself is a ledger-side concern
  // done inside the repo transaction (importing only the pure buildReversalLines
  // function), so reimbursements never imports LedgerModule — no dependency cycle.
  async execute(ctx: RequestContext, requestId: string, paymentId: string, input: VoidReimbursementPaymentInput): Promise<ReimbursementRequestDetail> {
    if (!ctx.permissions.includes('reimbursement.payment.void')) throw new ForbiddenException('Missing permission: reimbursement.payment.void');
    if (!input.reason || input.reason.trim() === '') throw new BadRequestException('void_reason_required');

    const req = await this.repo.findRequestById(ctx.companyId, requestId);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    const payment = await this.repo.findPaymentById(ctx.companyId, paymentId);
    if (!payment || payment.reimbursementRequestId !== requestId) throw new NotFoundException('Payment not found');
    if (payment.status !== 'RECORDED') throw new UnprocessableEntityException('Payment is already voided');

    const now = new Date();
    // The ledger journal table is the source of truth for whether a reversing
    // entry is needed — the payment's postingStatus can lag and must not gate it.
    const postedJournalId = await this.repo.findPostedGeneratedJournalId(ctx.companyId, paymentId);
    const reserved = postedJournalId
      ? await this.reserveNumber.execute({
          companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY,
          periodKey: civilPeriodKey(todayCivilDate()),
          // Date.now() is deliberate: reserveNumber returns a matching-key row
          // regardless of its status, so a deterministic key would hand a
          // retried void the CANCELLED reservation from the failed attempt.
          idempotencyKey: `void-reversal:reimbursement.payment:${paymentId}:${Date.now()}`,
          reservedByUserId: ctx.userId,
        })
      : null;

    let result: { request: Awaited<ReturnType<PrismaReimbursementRepository['findRequestById']>>; payment: typeof payment; reversalEntryId: string | null };
    try {
      result = await this.repo.voidPaymentTrueReversal(ctx.companyId, requestId, paymentId, ctx.userId, input.reason, reserved?.documentNumber) as any;
    } catch (err) {
      // The reservation is still RESERVED here (commit happens only after a
      // successful reversal), so it must be cancelled.
      if (reserved) await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      throw err;
    }
    if (reserved) {
      if (result.reversalEntryId) {
        await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'journal_entry', ownerId: result.reversalEntryId }, ctx.userId);
      } else {
        await this.cancelNumber.execute({ id: reserved.id, companyId: ctx.companyId }, ctx.userId);
      }
    }

    const paymentStatus = result.request!.paymentStatus;
    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payment.void',
      targetType: 'reimbursement_payment', targetId: paymentId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL',
      metadataJson: { reason: input.reason, requestId, reversalEntryId: result.reversalEntryId },
    });
    void this.outbox.append('reimbursement.payment_voided', 'reimbursement_payment', paymentId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'reimbursement_payment', aggregateId: paymentId, occurredAt: now.toISOString(),
      data: { requestId, paymentStatus, reversalEntryId: result.reversalEntryId },
    });

    return toRequestDetail(result.request!);
  }
}

@Injectable()
export class ListUnpostedReimbursementPaymentsUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository) {}

  // GAP-02: recorded-but-unposted settlement payments finance still needs to
  // post via POST /companies/:companyId/posting/generate (sourceType
  // 'reimbursement.payment', sourceId = paymentId). Gated by finance_review,
  // matching the finance-queue worklist actor.
  async execute(ctx: RequestContext): Promise<Awaited<ReturnType<PrismaReimbursementRepository['listUnpostedReimbursementPayments']>>> {
    if (!ctx.permissions.includes('reimbursement.finance_review')) throw new ForbiddenException('Missing permission: reimbursement.finance_review');
    return this.repo.listUnpostedReimbursementPayments(ctx.companyId);
  }
}

@Injectable()
export class ExportReimbursementEvidenceUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string): Promise<Record<string, unknown>> {
    if (!ctx.permissions.includes('reimbursement.export')) throw new ForbiddenException('Missing permission: reimbursement.export');
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    const signedCopies = await this.repo.listSignedClaimFormCopies(ctx.companyId, id);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.export',
      targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
    });

    // Bounded, redacted JSON evidence — no signed URLs, object keys, or raw payloads.
    return redactPayload({
      format: 'json',
      generatedAt: new Date().toISOString(),
      request: {
        id: req.id,
        requestNo: req.requestNo,
        requester: req.requesterDisplayNameSnapshot,
        amount: req.amount,
        currency: req.currency,
        categoryKey: req.categoryKey,
        incurredDate: req.incurredDate.toISOString(),
        status: req.status,
        paymentStatus: req.paymentStatus,
        approvalSnapshotHash: req.approvalSnapshotHash,
      },
      // Evidence lives on the lines: since lane C the header attachment/expense ids
      // are null for new claims, so a header-only export would carry no evidence at all.
      lines: (req.lines ?? []).map((l) => ({
        lineNo: l.lineNo,
        description: l.description,
        purpose: l.purpose,
        categoryKey: l.categoryKey,
        amount: l.amount,
        incurredDate: l.incurredDate.toISOString(),
        attachmentId: l.attachmentId,
        linkedExpenseId: l.linkedExpenseId,
      })),
      // Scans of the wet-ink signed form: ids only, same redaction discipline as the lines.
      signedCopyAttachmentIds: signedCopies.map((copy) => copy.attachmentId),
      approvals: (req.approvalSteps ?? []).map((s) => ({ sequenceNo: s.sequenceNo, status: s.status, decidedAt: s.decidedAt?.toISOString(), comment: s.comment, rejectionReason: s.rejectionReason })),
      payments: (req.payments ?? []).map((p) => ({ paymentNo: p.paymentNo, paidAmount: p.paidAmount, currency: p.currency, paymentMethod: p.paymentMethod, paidAt: p.paidAt.toISOString(), status: p.status })),
    });
  }
}
