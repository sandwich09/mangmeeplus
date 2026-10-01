import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { isExpenseVoidReason, type RequestContext } from '@watchdog-bms/contracts';
import { isSerializationFailure, uniqueConstraintFields } from '../../../../common/database/prisma-error';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { VoidExpenseUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { effectivePolicy, effectivePolicyForRequest } from '../../domain/reimbursement.constants';
import { claimApproverUserId, pendingProjectionIntent, type PendingProjectionIntent } from '../../domain/logic/reimbursement.logic';
import type { ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { ReimbursementProjectionOrchestratorService } from './reimbursement-projection-orchestrator.service';
import { ListReimbursementApproverOptionsUseCase } from '../use-cases/reimbursement-policy.use-case';

export type ReimbursementReconcileResult = {
  /** Claims this run moved on (a decision carried out, or a cancellation finished). */
  completed: string[];
  failed: Array<{ requestId: string; error: string }>;
  /** Cancellations left for a person: what stands in their way has to be put right first. */
  blocked: string[];
};

type ProjectionIntent = PendingProjectionIntent & { request: ReimbursementRequestRecord };
type CancellationIntent = { request: ReimbursementRequestRecord; actorUserId: string; reason: string };

/**
 * A stable code for the log line: the refusal's own code or message when it is one, never free text,
 * which can carry internals. The rule of the ledger auto-post log (`postingFailureCode`), which sits
 * on the other side of the module dependency.
 */
function failureCode(error: unknown): string {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  const candidates = typeof response === 'string' ? [response]
    : [(response as { code?: unknown } | null)?.code, (response as { message?: unknown } | null)?.message, (error as { code?: unknown } | null)?.code];
  return candidates.find((value): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{2,120}$/.test(value)) ?? 'RECONCILE_FAILED';
}

/** What the expense void and the expense confirmation answer when the record changed between their read and their write. */
const RECORD_CHANGED_MEANWHILE = new Set(['expense_changed', 'posting_state_changed', 'expense_confirmation_source_version_changed']);

/**
 * A failure that means another party was writing the same claim's expense records at the same
 * moment: PostgreSQL rolled this attempt back (a serialization conflict), two writers reserved the
 * same number or wrote the one row a record may have in the same instant (a unique conflict), or the
 * record changed between this attempt's read and its write. Nothing of the attempt was kept, and the
 * other party's work stands.
 */
export function lostWriteRace(error: unknown): boolean {
  return isSerializationFailure(error) || !!uniqueConstraintFields(error) || RECORD_CHANGED_MEANWHILE.has(failureCode(error));
}

/**
 * Finishes what a two-phase reimbursement decision left undone: a decision (approval, finance
 * approval, a claim that needed no approval) whose expense records are not built yet, and a
 * cancellation whose expense records are not all voided yet. Runs on a schedule (the workers'
 * reimbursement-reconcile scan), and for one claim when a person presses "ดำเนินการต่อ".
 *
 * Every step it takes is the one the live path takes, under the same locks and compare-and-swap,
 * so a run that meets a person finishing the same claim ends in one result, not two.
 */
@Injectable()
export class ReimbursementProjectionReconcilerService {
  private readonly logger = new Logger(ReimbursementProjectionReconcilerService.name);

  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly projections: ReimbursementProjectionOrchestratorService,
    private readonly audit: AuditService,
    private readonly voidExpense: VoidExpenseUseCase,
    private readonly prisma: PrismaService,
    private readonly approverRoutes: ListReimbursementApproverOptionsUseCase,
  ) {}

  /**
   * Freeze in place (owner decision 2026-08-04). The intent queries are cross-tenant and this
   * service runs under a synthetic system context with no permissions, so it never meets the
   * resolver chokepoint that delivers the freeze everywhere else. A frozen company's intents are
   * left exactly as they are — pending — so a re-enable resumes them where they stopped.
   *
   * The canonical evaluator, so an unconfigured (zero-row) company still fails OPEN and its partial
   * projections are not stranded by a company-status filter this service cannot see.
   */
  private async frozen(companyId: string): Promise<boolean> {
    const entitled = await loadEntitledFeatureKeys(this.prisma, companyId);
    // `expenses` counts too: the orchestrator materializes and confirms ExpenseRecord rows for every
    // claim line, so a frozen expenses family must stop this drain — the same rationale as
    // AUTO_POST_REQUIRED_FEATURES. Both keys are read from THIS ONE entitlement query because the
    // contracts forbid a reimbursement ⇒ expenses dependency edge (declaring one would cascade
    // `reimbursement` off and restamp its activation cutoff on the re-enable).
    return entitled !== null && (!entitled.has('reimbursement') || !entitled.has('expenses'));
  }

  /**
   * One bounded pass over every company: at most `limit` pending decisions and `limit` pending
   * cancellations, the most recent first. Each claim is tried on its own: whatever goes wrong with
   * one (its company's entitlement read included) is recorded for that claim and the pass goes on.
   */
  async execute(limit = 100): Promise<ReimbursementReconcileResult> {
    const result: ReimbursementReconcileResult = { completed: [], failed: [], blocked: [] };
    // One entitlement read per company per pass.
    const frozen = new Map<string, Promise<boolean>>();
    const isFrozen = (companyId: string) => {
      if (!frozen.has(companyId)) frozen.set(companyId, this.frozen(companyId));
      return frozen.get(companyId)!;
    };
    for (const intent of await this.repo.listPendingProjectionIntents(limit)) {
      await this.attempt(result, intent.request, intent.kind, isFrozen, async () => { await this.completeProjection(intent); return 'completed'; });
    }
    for (const intent of await this.repo.listPendingCancellationIntents(limit)) {
      await this.attempt(result, intent.request, 'CANCELLATION', isFrozen, () => this.completeCancellation(intent));
    }
    return result;
  }

  /**
   * Carries out one claim's pending decision now: exactly what the scheduled pass does for it, for the
   * person who presses "ดำเนินการต่อ" (the caller has checked that they may). Throws what stopped it,
   * so the person reads why. False: nothing was pending any more, or someone else carried it out
   * meanwhile.
   */
  async repair(companyId: string, requestId: string): Promise<boolean> {
    const request = await this.repo.findRequestById(companyId, requestId, true);
    const intent = request ? pendingProjectionIntent(request) : undefined;
    if (!request || !intent) return false;
    // Frozen claims stay exactly as they are, for a person as for the scheduled pass.
    if (await this.frozen(companyId)) throw new ConflictException('reimbursement_resume_unavailable');
    try {
      await this.completeProjection({ request, ...intent });
    } catch (error) {
      if (await this.settledElsewhere(request, intent.kind).catch(() => false)) return false;
      // The scheduled pass (or a second press) is carrying out the same decision right now.
      if (lostWriteRace(error)) throw new ConflictException('reimbursement_resume_in_progress');
      throw error;
    }
    this.logger.log({ msg: 'reimbursement.reconcile.repaired', companyId, requestId, kind: intent.kind, by: 'person' });
    return true;
  }

  private async attempt(
    result: ReimbursementReconcileResult,
    request: ReimbursementRequestRecord,
    kind: PendingProjectionIntent['kind'] | 'CANCELLATION',
    isFrozen: (companyId: string) => Promise<boolean>,
    work: () => Promise<'completed' | 'blocked'>,
  ): Promise<void> {
    const claim = { companyId: request.companyId, requestId: request.id, kind };
    try {
      if (await isFrozen(request.companyId)) return;
      if (await work() === 'blocked') {
        result.blocked.push(request.id);
        return;
      }
      result.completed.push(request.id);
      this.logger.log({ msg: 'reimbursement.reconcile.repaired', ...claim });
    } catch (error) {
      // Someone else finished the same claim meanwhile (a person pressing ดำเนินการต่อ, another pass), or its
      // cancellation was started or withdrawn: there is nothing left for this pass, and nothing failed.
      if (await this.settledElsewhere(request, kind).catch(() => false)) return;
      // Someone else is writing the same claim right now: their work stands, and whatever is left is
      // taken up by the next pass. Said on its own line, so one that repeats on every pass is seen.
      if (lostWriteRace(error)) {
        this.logger.log({ msg: 'reimbursement.reconcile.busy', ...claim, code: failureCode(error) });
        return;
      }
      result.failed.push({ requestId: request.id, error: error instanceof Error ? error.message : String(error) });
      this.logger.warn({ msg: 'reimbursement.reconcile.failed', ...claim, code: failureCode(error) });
    }
  }

  /** Whether the claim no longer waits for what this pass tried to do. */
  private async settledElsewhere(request: ReimbursementRequestRecord, kind: PendingProjectionIntent['kind'] | 'CANCELLATION'): Promise<boolean> {
    const latest = await this.repo.findRequestById(request.companyId, request.id, true);
    if (!latest) return true;
    if (kind === 'CANCELLATION') return latest.status === 'CANCELLED' || !latest.cancellationPendingAt;
    return !pendingProjectionIntent(latest);
  }

  private systemContext(request: ReimbursementRequestRecord, actorUserId: string, requestId: string): RequestContext {
    return {
      requestId,
      authSubject: 'system:reimbursement-projection-reconciler',
      userId: actorUserId,
      companyId: request.companyId,
      membershipId: 'system',
      roles: [],
      permissions: [],
      scopes: {},
      authProvider: 'system',
    };
  }

  private async completeProjection(intent: ProjectionIntent): Promise<void> {
    const requestId = `system:reimbursement-projection:${intent.request.id}`;
    const ctx = this.systemContext(intent.request, intent.actorUserId, requestId);
    const currentPolicy = effectivePolicy(await this.repo.findPolicy(intent.request.companyId, null));
    const policy = effectivePolicyForRequest(intent.request, currentPolicy);
    // The same field the live submit writes for a claim that needed no approval, so a replayed
    // ready-to-pay event asks the same people first (owner rule 2026-10-01).
    // And for a claim finance passed, its own approver, exactly as the live finance review writes it.
    const financePathApprover = intent.kind === 'FINANCE' ? claimApproverUserId(intent.request) : undefined;
    const approverRecipientUserIds = intent.kind === 'POLICY'
      ? await this.approverRoutes.resolveWouldBeApproverUserIds(intent.request.companyId, currentPolicy, intent.request).catch(() => [])
      : financePathApprover ? [financePathApprover] : [];
    await this.projections.execute(ctx, intent.request, {
      kind: intent.kind,
      actorUserId: intent.actorUserId,
      approvalStepId: intent.approvalStepId,
      allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      systemReconcile: true,
    });
    const completedAt = new Date();
    const onReadyPersisted = async (tx: any) => {
      await this.audit.log({
        companyId: intent.request.companyId,
        actorType: 'SYSTEM',
        actorRefId: 'reimbursement-projection-reconciler',
        action: intent.kind === 'MANAGER'
          ? 'reimbursement.approval.approve'
          : intent.kind === 'FINANCE'
            ? 'reimbursement.finance_review.update'
            : 'reimbursement.approval.auto_by_policy',
        targetType: 'reimbursement_request',
        targetId: intent.request.id,
        requestId,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: {
          projectionReady: true,
          systemReconcile: true,
          originalDecisionActorUserId: intent.actorUserId,
        },
      }, tx);
      const eventTypes = intent.kind === 'MANAGER'
        ? ['reimbursement.approved', 'reimbursement.ready_for_payment']
        : intent.kind === 'FINANCE'
          ? ['reimbursement.finance_review_updated', 'reimbursement.ready_for_payment']
          : ['reimbursement.approved', 'reimbursement.ready_for_payment'];
      for (const eventType of eventTypes) {
        const decisionId = intent.approvalStepId
          ?? intent.request.submittedAt?.toISOString()
          ?? intent.actorUserId;
        await tx.outboxEvent.createMany({
          data: [{
            companyId: intent.request.companyId,
            eventType,
            aggregateType: 'reimbursement_request',
            aggregateId: intent.request.id,
            eventKey: `${eventType}:reimbursement_request:${intent.request.id}:${decisionId}`,
            payloadJson: {
              companyId: intent.request.companyId,
              actorUserId: intent.actorUserId,
              requestId,
              aggregateType: 'reimbursement_request',
              aggregateId: intent.request.id,
              occurredAt: completedAt.toISOString(),
              data: {
                requestId: intent.request.id,
                requestNo: intent.request.requestNo,
                requesterUserId: intent.request.requesterUserId,
                status: 'READY_FOR_PAYMENT',
                decision: 'APPROVED',
                amount: intent.request.amount,
                currency: intent.request.currency,
                ...(approverRecipientUserIds.length > 0 && { approverRecipientUserIds }),
              },
            },
            priority: 'NORMAL',
            status: 'PENDING',
          }],
          skipDuplicates: true,
        });
      }
    };
    if (intent.kind === 'MANAGER') {
      await this.repo.completeApprovalProjectionAtomic({
        companyId: intent.request.companyId,
        requestId: intent.request.id,
        decisionActorUserId: intent.actorUserId,
        approvalStepId: intent.approvalStepId!,
        scopes: {},
        systemReconcile: true,
        expectedBranchId: intent.request.branchId,
        completedAt,
        onReadyPersisted,
      });
    } else if (intent.kind === 'FINANCE') {
      await this.repo.completeFinanceProjectionAtomic({
        companyId: intent.request.companyId,
        requestId: intent.request.id,
        decisionActorUserId: intent.actorUserId,
        scopes: {},
        systemReconcile: true,
        expectedBranchId: intent.request.branchId,
        completedAt,
        onReadyPersisted,
      });
    } else {
      await this.repo.completePolicyProjectionAtomic({
        companyId: intent.request.companyId,
        requestId: intent.request.id,
        actorUserId: intent.actorUserId,
        scopes: {},
        systemReconcile: true,
        expectedBranchId: intent.request.branchId,
        completedAt,
        onReadyPersisted,
      });
    }
  }

  private async completeCancellation(intent: CancellationIntent): Promise<'completed' | 'blocked'> {
    // A cancellation a person has to unblock is left to them (audit B3): its reason is one the expense
    // void refuses, or a record it must void sits in a closed period. Replaying it would fail the same
    // way on every pass, and each failed void of a posted record burns a journal number. The claim
    // page says what stands in the way and who can put it right.
    if (!isExpenseVoidReason(intent.reason) || await this.repo.findCancellationBlocker(intent.request)) return 'blocked';
    const requestId = `system:reimbursement-cancellation:${intent.request.id}`;
    const ctx = this.systemContext(intent.request, intent.actorUserId, requestId);
    const projections = await this.repo.listClaimProjections(intent.request.companyId, intent.request.id);
    for (const projection of projections) {
      await this.voidExpense.executeForReimbursement(ctx, projection.id, intent.reason, {
        reimbursementRequestId: intent.request.id,
        reimbursementLineId: projection.sourceReimbursementLineId,
        branchId: intent.request.branchId,
        systemReconcile: true,
        // Each void goes ahead only while the claim still holds its cancellation (it may be withdrawn meanwhile).
        beforeVoid: (tx) => this.repo.assertCancellationPending(tx, intent.request.companyId, intent.request.id),
      });
    }
    const completedAt = new Date();
    await this.repo.completeCancellationAtomic({
      companyId: intent.request.companyId,
      requestId: intent.request.id,
      actorUserId: intent.actorUserId,
      scopes: {},
      systemReconcile: true,
      expectedBranchId: intent.request.branchId,
      completedAt,
      onCancelledPersisted: async (tx) => {
        await this.audit.log({
          companyId: intent.request.companyId,
          actorType: 'SYSTEM',
          actorRefId: 'reimbursement-projection-reconciler',
          action: 'reimbursement.request.cancel',
          targetType: 'reimbursement_request',
          targetId: intent.request.id,
          requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            reason: intent.reason,
            projectionCount: projections.length,
            systemReconcile: true,
            originalDecisionActorUserId: intent.actorUserId,
          },
        }, tx);
        await tx.outboxEvent.createMany({
          data: [{
            companyId: intent.request.companyId,
            eventType: 'reimbursement.cancelled',
            aggregateType: 'reimbursement_request',
            aggregateId: intent.request.id,
            eventKey: `reimbursement.cancelled:reimbursement_request:${intent.request.id}`,
            payloadJson: {
              companyId: intent.request.companyId,
              actorUserId: intent.actorUserId,
              requestId,
              aggregateType: 'reimbursement_request',
              aggregateId: intent.request.id,
              occurredAt: completedAt.toISOString(),
              data: { requestId: intent.request.id, status: 'CANCELLED' },
            },
            priority: 'NORMAL',
            status: 'PENDING',
          }],
          skipDuplicates: true,
        });
      },
    });
    return 'completed';
  }
}
