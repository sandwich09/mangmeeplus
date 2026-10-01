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
import { requireTransactionBranchId } from '../../../data-model-core/application/services/transaction-branch';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { CancelDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/cancel-document-number.use-case';
import { toRequestSummary, detailWithFileNames } from '../dto/reimbursement.mapper';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { effectivePolicy, effectivePolicyForRequest } from '../../domain/reimbursement.constants';
import { ReimbursementProjectionOrchestratorService } from '../services/reimbursement-projection-orchestrator.service';
import { assertReimbursementBranchInScope } from './reimbursement-branch-scope';
import {
  validatePaymentRecording,
  isSamePaymentRequest,
  ageHours,
  redactPayload,
} from '../../domain/logic/reimbursement.logic';
import { paymentSlipAuditMetadata } from './reimbursement-payment-slip.use-case';

async function appendReimbursementOutboxWithinTx(tx: any, input: {
  companyId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId: string;
  eventKey: string;
  payloadJson: Record<string, unknown>;
}): Promise<void> {
  await tx.outboxEvent.createMany({
    data: [{
      companyId: input.companyId,
      eventType: input.eventType,
      aggregateType: input.aggregateType ?? 'reimbursement_request',
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
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, id: string, input: FinanceReviewReimbursementInput): Promise<ReimbursementRequestDetail> {
    if (!input.decision && input.resolveDuplicate) return this.resolvePaymentDuplicates(ctx, id, input.duplicateResolutionReason);
    if (!ctx.permissions.includes('reimbursement.finance_review')) throw new ForbiddenException('Missing permission: reimbursement.finance_review');

    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    if (req.status !== 'FINANCE_REVIEW') {
      throw new UnprocessableEntityException(`Cannot finance-review from status ${req.status}`);
    }
    assertReimbursementBranchInScope(ctx, req.branchId);

    const now = new Date();
    const note = input.note?.trim();
    if (note && note.length > 500) throw new BadRequestException('finance_review_note_too_long');
    if (input.resolveDuplicate) {
      if (!ctx.permissions.includes('reimbursement.duplicate.resolve')) throw new ForbiddenException('Missing permission: reimbursement.duplicate.resolve');
      if (!input.duplicateResolutionReason?.trim()) throw new BadRequestException('duplicate_resolution_reason_required');
    }
    if (input.decision === 'NEEDS_INFO' && !note) {
      throw new BadRequestException('finance_correction_reason_required');
    }

    if (input.decision === 'APPROVED_FOR_PAYMENT') {
      const decision = await this.repo.beginFinanceApprovalAtomic({
        companyId: ctx.companyId,
        requestId: id,
        expectedUpdatedAt: req.updatedAt,
        actorUserId: ctx.userId,
        scopes: ctx.scopes ?? {},
        reviewedAt: now,
        note,
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
      const policy = effectivePolicyForRequest(decision.request, effectivePolicy(await this.repo.findPolicy(ctx.companyId, null)));
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
    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, detail!, ctx);
  }

  /**
   * The resolve-only call: under BLOCK_PAYMENT an open duplicate refuses payment, and with finance
   * review off (the default) no finance decision ever comes to carry the override. The same holders
   * clear it at the payment step instead — `duplicate.resolve` only, never widened (spec §6).
   */
  private async resolvePaymentDuplicates(ctx: RequestContext, id: string, reason?: string): Promise<ReimbursementRequestDetail> {
    // Owner 2026-09-21: a claim has only a requester and an approver, so the person who records the
    // payment clears the block themselves, with a reason and an audit row; duplicate.resolve holders
    // (owner, finance) still can. The finance-review decision path below is unchanged.
    if (!ctx.permissions.includes('reimbursement.payment.record') && !ctx.permissions.includes('reimbursement.duplicate.resolve')) {
      throw new ForbiddenException('Missing permission: reimbursement.payment.record or reimbursement.duplicate.resolve');
    }
    const duplicateResolutionReason = reason?.trim();
    if (!duplicateResolutionReason) throw new BadRequestException('duplicate_resolution_reason_required');

    const req = await this.repo.findRequestById(ctx.companyId, id);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    assertReimbursementBranchInScope(ctx, req.branchId);

    await this.repo.resolvePaymentDuplicatesAtomic({
      companyId: ctx.companyId,
      requestId: id,
      expectedUpdatedAt: req.updatedAt,
      actorUserId: ctx.userId,
      scopes: ctx.scopes ?? {},
      resolvedAt: new Date(),
      reason: duplicateResolutionReason,
      onResolvedPersisted: async (tx) => {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'reimbursement.duplicate.resolve',
          targetType: 'reimbursement_request',
          targetId: id,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { requestDuplicateOverride: true, duplicateResolutionReason, status: req.status },
        }, tx);
      },
    });

    const detail = await this.repo.findRequestById(ctx.companyId, id, true);
    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, detail!, ctx);
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
      note: input.note?.trim(),
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
        const eventTypes = decision === 'NEEDS_INFO'
          ? ['reimbursement.finance_review_updated', 'reimbursement.correction_requested']
          : ['reimbursement.finance_review_updated'];
        for (const eventType of eventTypes) {
          await appendReimbursementOutboxWithinTx(tx, {
            companyId: ctx.companyId,
            eventType,
            aggregateId: request.id,
            eventKey: `${eventType}:reimbursement_request:${request.id}:${request.updatedAt.toISOString()}`,
            payloadJson: {
              companyId: ctx.companyId,
              actorUserId: ctx.userId,
              requestId: ctx.requestId,
              aggregateType: 'reimbursement_request',
              aggregateId: request.id,
              occurredAt: reviewedAt.toISOString(),
              data: {
                requestId: request.id,
                requestNo: request.requestNo,
                requesterUserId: request.requesterUserId,
                status: decision === 'NEEDS_INFO' ? 'DRAFT' : request.status,
                decision,
                note: input.note?.trim(),
                amount: request.amount,
                currency: request.currency,
              },
            },
          });
        }
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
    private readonly evidence: ReimbursementEvidenceService,
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
    // Ahead of the idempotent-replay return below, so a caller outside the branch cannot even
    // learn that a payment exists by replaying one.
    assertReimbursementBranchInScope(ctx, req.branchId);

    // The request as the repository will compare it: one object for the replay check here and the write below.
    const payment = {
      paidAmount: input.paidAmount,
      currency: input.currency ?? req.currency,
      paymentMethod: input.paymentMethod,
      paidAt,
      paymentReference: input.paymentReference,
      bankAccountId: input.bankAccountId,
      slipAttachmentId: input.slipAttachmentId,
    };
    const recorded = req.payments?.find((row) => row.status === 'RECORDED');
    if (req.paymentStatus === 'PAID' && recorded) {
      // A replay is the same payment only if every fact matches, the slip included (spec §12.7).
      if (!isSamePaymentRequest(recorded, payment)) throw new ConflictException('reimbursement_payment_already_recorded');
      if (!recorded.idempotencyKey.startsWith('legacy:')) {
        await this.ensurePaymentNumber(ctx, paidAt, recorded.idempotencyKey, recorded.id, recorded.paymentNo);
      }
      return detailWithFileNames(this.repo, this.evidence, ctx.companyId, req, ctx);
    }

    // Friendly preflight before reserving a payment number; the repository
    // repeats the same proof under the payment lock to close the race.
    requireTransactionBranchId(req.branchId);
    await this.repo.assertClaimPaymentReady(ctx.companyId, id, paidAt);

    const policy = effectivePolicyForRequest(req, effectivePolicy(await this.repo.findPolicy(ctx.companyId, null)));
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
      hasSlip: Boolean(input.slipAttachmentId),
    });
    if (error) throw new UnprocessableEntityException(error);
    // Everything that can refuse the payment is checked before a payment number is reserved: a
    // refusal after that point would burn a number that only a retry with the same key reuses.
    // Phase 1 seam: the payer's confirmation of the payout account is validated here too.
    if (input.slipAttachmentId) {
      await this.repo.assertPaymentSlipUsable({
        companyId: ctx.companyId, requestId: id, attachmentId: input.slipAttachmentId, actorUserId: ctx.userId,
      });
    }

    const paymentAttemptKey = createHash('sha256')
      .update([ctx.companyId, id, clientKey ?? req.updatedAt.toISOString()].join(':'))
      .digest('hex');
    const reservation = await this.reservePaymentNumber(ctx, paidAt, paymentAttemptKey);
    const now = new Date();
    const result = await this.repo.recordPaymentAtomic({
      companyId: ctx.companyId,
      // Audit B10: written in the payment transaction, so the requester's "paid" notice cannot be
      // lost between the commit and a later append. One event per payment row.
      onPaymentPersisted: (tx, payment, paymentStatus) => appendReimbursementOutboxWithinTx(tx, {
        companyId: ctx.companyId, eventType: 'reimbursement.payment_recorded', aggregateType: 'reimbursement_payment',
        aggregateId: payment.id, eventKey: `reimbursement.payment_recorded:reimbursement_payment:${payment.id}`,
        payloadJson: {
          companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
          aggregateType: 'reimbursement_payment', aggregateId: payment.id, occurredAt: now.toISOString(),
          data: redactPayload({ requestId: id, requestNo: req.requestNo, requesterUserId: req.requesterUserId, paymentNo: reservation.paymentNo, paidAmount: input.paidAmount, currency: input.currency ?? req.currency, sourceType: 'REIMBURSEMENT_PAYMENT', paymentStatus }),
        },
      }),
      reimbursementRequestId: id,
      idempotencyKey: paymentAttemptKey,
      paymentNo: reservation.paymentNo,
      ...payment,
      paidByUserId: ctx.userId,
    });
    if (result.created) await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payment.record',
      targetType: 'reimbursement_payment', targetId: result.payment.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: {
        paymentNo: reservation.paymentNo, paidAmount: input.paidAmount, paymentMethod: input.paymentMethod, requestId: id,
        ...(result.slip && paymentSlipAuditMetadata(result.slip)),
      },
    });
    if (result.created && reservation.reservedId) {
      await this.commitNumber.execute({
        id: reservation.reservedId,
        companyId: ctx.companyId,
        ownerType: 'reimbursement_payment',
        ownerId: result.payment.id,
      }, ctx.userId);
    }

    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, result.request, ctx);
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
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly evidence: ReimbursementEvidenceService) {}

  // The aggregate owns the reversal, number, audit and outbox in a single transaction.
  async execute(ctx: RequestContext, requestId: string, paymentId: string, input: VoidReimbursementPaymentInput): Promise<ReimbursementRequestDetail> {
    if (!ctx.permissions.includes('reimbursement.payment.void')) throw new ForbiddenException('Missing permission: reimbursement.payment.void');
    if (!input.reason || input.reason.trim() === '') throw new BadRequestException('void_reason_required');

    const req = await this.repo.findRequestById(ctx.companyId, requestId);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    // Before the payment lookup and well before the ledger reversal: void is the most destructive
    // action in this module (audited CRITICAL) and it reverses a posted journal.
    assertReimbursementBranchInScope(ctx, req.branchId);
    const payment = await this.repo.findPaymentById(ctx.companyId, paymentId);
    if (!payment || payment.reimbursementRequestId !== requestId) throw new NotFoundException('Payment not found');
    if (payment.status === 'VOIDED') return detailWithFileNames(this.repo, this.evidence, ctx.companyId, (await this.repo.findRequestById(ctx.companyId, requestId)) ?? req, ctx);
    if (payment.status !== 'RECORDED') throw new UnprocessableEntityException('Payment cannot be voided');

    const result = await this.repo.voidPaymentTrueReversal(ctx.companyId, requestId, paymentId, ctx.userId, input.reason, undefined, ctx.requestId ?? `reimbursement-payment-void:${paymentId}`);

    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, result.request!, ctx);
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
    // Scoped like the finance queue beside it: this worklist is what finance posts from, so an
    // unscoped read hands a branch-restricted user another branch's payment ids to post.
    return this.repo.listUnpostedReimbursementPayments(ctx.companyId, ctx.scopes ?? {});
  }
}

@Injectable()
export class ExportReimbursementEvidenceUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string): Promise<Record<string, unknown>> {
    if (!ctx.permissions.includes('reimbursement.export')) throw new ForbiddenException('Missing permission: reimbursement.export');
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    // The export carries the whole claim — lines, approvals, payments, evidence ids — so it has to
    // obey the same scope as reading the claim it summarizes.
    assertReimbursementBranchInScope(ctx, req.branchId);
    const signedCopies = await this.repo.listSignedClaimFormCopies(ctx.companyId, id);
    const payments = req.payments ?? [];
    const paymentSlips = payments.length > 0 ? await this.repo.listPaymentSlips(ctx.companyId, payments.map((payment) => payment.id)) : {};

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
        ...(l.sourceExpenseSnapshot && { sourceExpenseSnapshot: l.sourceExpenseSnapshot }),
      })),
      // Scans of the wet-ink signed form: ids only, same redaction discipline as the lines.
      signedCopyAttachmentIds: signedCopies.map((copy) => copy.attachmentId),
      approvals: (req.approvalSteps ?? []).map((s) => ({ sequenceNo: s.sequenceNo, status: s.status, decidedAt: s.decidedAt?.toISOString(), comment: s.comment, rejectionReason: s.rejectionReason })),
      // The same facts the claim page shows for each payment. Slips are counted, never identified:
      // opening one is the slip endpoint's decision, not the export's.
      payments: payments.map((p) => ({
        paymentNo: p.paymentNo, paidAmount: p.paidAmount, currency: p.currency, paymentMethod: p.paymentMethod,
        paidAt: p.paidAt.toISOString(), paymentReference: p.paymentReference, status: p.status,
        slipCount: paymentSlips[p.id]?.length ?? 0,
      })),
    });
  }
}
