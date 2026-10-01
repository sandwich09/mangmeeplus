import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ReimbursementPayoutInput, ReimbursementRequestDetail, RequestContext, SubmitReimbursementPayoutCorrectionInput } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import type { ReimbursementApprovalStepRecord, ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';
import { effectivePolicy, effectivePolicyForRequest } from '../../domain/reimbursement.constants';
import { payoutCorrectionPhase, payoutCorrectionSourceStep } from '../../domain/logic/reimbursement.logic';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { detailWithFileNames } from '../dto/reimbursement.mapper';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { sendBackForPayoutCorrection } from './reimbursement-approval.use-case';
import { MemberPayoutAccountUseCase } from './reimbursement-payout.use-case';
import { ListReimbursementApproverOptionsUseCase } from './reimbursement-policy.use-case';
import { assertCanReadRequestOrAssignment, mayGivePayoutAccount, payoutCorrectionSender } from './reimbursement-request.use-case';

/** A cancellation that was started and has not completed. A cancelled claim keeps the columns of its own, and is refused for what it is. */
function beingCancelled(req: ReimbursementRequestRecord): boolean {
  return !!req.cancellationPendingAt && req.status !== 'CANCELLED' && req.status !== 'VOIDED';
}

/**
 * `POST :requestId/payout-correction` (payout spec §14.3): sends a claim that waits for payment back
 * to have its payout account corrected, on the same claim and number. For whoever may record its
 * payment, the approver the claim stands on, or its requester. While the account it was given waits
 * for approval, the same call from whoever decides that step sends it back again.
 */
@Injectable()
export class RequestPayoutCorrectionUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, id: string, input: { reasonCode?: unknown; note?: unknown }): Promise<ReimbursementRequestDetail> {
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    // The gate of the claim detail: nobody sends back a claim they could not open.
    const approvalActions = await assertCanReadRequestOrAssignment(ctx, req, this.repo);
    if (beingCancelled(req)) throw new ConflictException('reimbursement_cancellation_pending');
    const phase = payoutCorrectionPhase(req);
    // Already with its requester: whoever asks again has an old page.
    if (phase === 'AWAITING_REQUESTER') throw new ConflictException('payout_correction_in_progress');
    const sender = phase === 'AWAITING_APPROVAL' ? (approvalActions.canReject ? 'STEP_APPROVER' as const : null) : payoutCorrectionSender(ctx, req);
    if (!sender) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payout_correction.request',
        targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH',
      });
      throw new ForbiddenException('payout_correction_denied');
    }
    // A paid claim has its payment voided first; any other status has no pay step to come back from.
    if (!phase && (req.status !== 'READY_FOR_PAYMENT' || (req.payments ?? []).some((payment) => payment.status === 'RECORDED'))) {
      throw new ConflictException('payout_correction_not_allowed');
    }
    return sendBackForPayoutCorrection({ repo: this.repo, audit: this.audit, evidence: this.evidence }, ctx, req, sender, input ?? {});
  }
}

/**
 * `PUT :requestId/payout-destination` (payout spec §14.5): the account a claim in a round is to be
 * paid into, given by its requester, or by a finance reviewer on their behalf, with the three choices
 * a draft has. The account is frozen as a new version of the claim and, where the claim had
 * approvers, waits for the same people; a claim nobody had to approve is ready for payment at once.
 * It may be given again while it still waits.
 */
@Injectable()
export class SubmitPayoutCorrectionUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly evidence: ReimbursementEvidenceService,
    private readonly payouts: MemberPayoutAccountUseCase,
    private readonly approverRoutes: ListReimbursementApproverOptionsUseCase,
  ) {}

  async execute(ctx: RequestContext, id: string, input: SubmitReimbursementPayoutCorrectionInput): Promise<ReimbursementRequestDetail> {
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    await assertCanReadRequestOrAssignment(ctx, req, this.repo);
    if (!mayGivePayoutAccount(ctx, req)) {
      // An attempt to say where someone else's money goes is on record, refused or not.
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payout_correction.submit',
        targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH',
      });
      throw new ForbiddenException('payout_correction_denied');
    }
    if (beingCancelled(req)) throw new ConflictException('reimbursement_cancellation_pending');
    if (!payoutCorrectionPhase(req)) throw new ConflictException('payout_correction_not_requested');

    // The same seam as a draft's receiving choice: the account is sealed here, "save as my default" sets
    // the REQUESTER's default in the same transaction, and an account typed by someone else tells the
    // requester in that transaction too.
    const { defaultToken, ...payout } = input as SubmitReimbursementPayoutCorrectionInput & { defaultToken?: unknown };
    const change = await this.payouts.draftPayoutChange(ctx, req.requesterUserId, payout as ReimbursementPayoutInput);
    const policy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
    const source = payoutCorrectionSourceStep(req);
    // Whom the event names: the approvers of the new step, or, for a claim nobody approves, the people
    // who would have, whom the ready-to-pay notice asks first (owner rule 2026-10-01). Best effort both.
    const approverRecipientUserIds = source
      ? await this.stepApprovers(req, source, effectivePolicyForRequest(req, policy).allowSelfApproval)
      : await this.approverRoutes.resolveWouldBeApproverUserIds(ctx.companyId, policy, req).catch(() => []);

    const submittedAt = new Date();
    await this.repo.submitPayoutCorrectionAtomic({
      companyId: ctx.companyId,
      requestId: id,
      expectedUpdatedAt: req.updatedAt,
      actorUserId: ctx.userId,
      scopes: ctx.scopes ?? {},
      submittedAt,
      payout: change,
      seenDefaultToken: defaultToken,
      defaultSetInThisTransaction: change.audit.savedAsDefault === true,
      onPersisted: async (tx, result) => {
        await this.audit.log({
          companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payout_correction.submit',
          targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
          // The choice, who made it and which version it froze. Nothing of the account itself.
          metadataJson: {
            requestNo: req.requestNo, payout: { ...change.audit, method: result.columns.payoutMethod, version: result.columns.payoutDestinationVersion },
            onBehalfOfRequester: ctx.userId !== req.requesterUserId, previousVersion: req.payoutDestinationVersion ?? null,
            approvalStepId: result.step?.id ?? null, replacedStepId: result.replacedStepId ?? null, readyForPayment: result.readyForPayment,
          },
        }, tx);
        const eventType = result.readyForPayment ? 'reimbursement.ready_for_payment' : 'reimbursement.payout_correction_submitted';
        await tx.outboxEvent.createMany({
          data: [{
            companyId: ctx.companyId,
            eventType,
            aggregateType: 'reimbursement_request',
            aggregateId: id,
            eventKey: `${eventType}:reimbursement_request:${id}:${result.step?.id ?? `payout-correction:${submittedAt.toISOString()}`}`,
            payloadJson: {
              companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
              aggregateType: 'reimbursement_request', aggregateId: id, occurredAt: submittedAt.toISOString(),
              data: {
                requestId: id, requestNo: req.requestNo, requesterUserId: req.requesterUserId,
                amount: req.amount, currency: req.currency,
                ...(result.readyForPayment
                  ? { status: 'READY_FOR_PAYMENT', decision: 'BELOW_APPROVAL_THRESHOLD' }
                  : { status: 'PENDING_APPROVAL', stepId: result.step!.id }),
                ...(approverRecipientUserIds.length > 0 && { approverRecipientUserIds }),
              },
            },
            priority: 'NORMAL',
            status: 'PENDING',
          }],
          skipDuplicates: true,
        });
      },
    });
    const detail = await this.repo.findRequestById(ctx.companyId, id, true);
    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, detail!, ctx);
  }

  /**
   * Who the new step waits for: the people the claim's step named who can still act; when none of
   * them can, whoever the step's recorded role, or the owner, reaches (the rule that lets them decide it).
   */
  private async stepApprovers(req: ReimbursementRequestRecord, step: ReimbursementApprovalStepRecord, allowSelfApproval: boolean): Promise<string[]> {
    const named = step.assignedApproverUserIds ?? (step.approverUserId ? [step.approverUserId] : []);
    const active = await this.repo.findActiveApproverUserIds(req.companyId, named, req.branchId);
    const able = named.filter((userId) => active.has(userId));
    if (able.length > 0) return able;
    const [route] = await this.approverRoutes.resolveSubmissionRoutesBestEffort(req.companyId, [{
      roleKey: step.approverRoleSnapshot ?? 'MANAGER', ...(req.branchId && { branchId: req.branchId }),
      requesterUserId: req.requesterUserId, allowSelfApproval,
    }]).catch(() => []);
    return route?.recipientUserIds ?? [];
  }
}
