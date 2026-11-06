import { REIMBURSEMENT_SEQUENCE_KEYS, type RequestContext, type ReimbursementPolicySnapshotV1 } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';
import type { PrismaService } from '../../../../common/database/prisma.service';
import type { AuditService } from '../../../audit/application/audit.service';
import { PrismaDocumentSequenceRepository } from '../../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import type { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { MaterializeClaimExpensesService } from '../../../reimbursements/application/services/materialize-claim-expenses.service';
import { claimSnapshotFields, computeSnapshotHash } from '../../../reimbursements/domain/logic/reimbursement.logic';
import { CASH_PAYOUT_FINGERPRINT } from '../../../reimbursements/domain/logic/payout-destination.logic';
import { PrismaReimbursementRepository } from '../../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { confirmDemoExpense, demoId, documentDate, type DemoCategory, type DemoInput, type DemoRows } from './expense-writes';

export async function writeDemoClaims(
  tx: Prisma.TransactionClient,
  service: PrismaService,
  expenses: PrismaExpenseRepository,
  audit: AuditService,
  ctx: RequestContext,
  input: DemoInput,
  rows: DemoRows,
  categories: Map<string, DemoCategory>,
): Promise<void> {
  const numbers = new PrismaDocumentSequenceRepository(service);
  const repo = new PrismaReimbursementRepository(service, numbers);
  const requesterUserId = demoId(input.companyId, 'user-STAFF');
  // No receipt image is supplied for these claims. The real waiver policy keeps their
  // approval and payment journeys usable, including the pending claim the visitor can approve.
  const policy = await tx.reimbursementPolicy.create({ data: {
    companyId: input.companyId, approverMode: 'OWNER_ROLE', defaultApproverUserId: input.ownerUserId,
    defaultApproverRole: 'OWNER', defaultApproverRoles: ['OWNER'],
    requireReceipt: false, allowMissingReceiptWithReason: true, createdByUserId: input.ownerUserId,
  } });
  const policySnapshot: ReimbursementPolicySnapshotV1 = {
    schemaVersion: 1, policyId: policy.id, policyVersion: policy.updatedAt.toISOString(),
    approvalRequiredFromAmount: '1.00', requiresApproval: true,
    route: { mode: 'OWNER_ROLE', roleKey: 'OWNER', effectiveTaskRole: 'OWNER', ownerFallbackUsedAtSubmission: false },
    allowSelfApproval: false, requireReceipt: false, allowMissingReceiptWithReason: true,
    duplicatePolicy: 'BLOCK_PAYMENT', financeReviewRequired: false,
  };
  await audit.log({ companyId: input.companyId, actorUserId: input.ownerUserId,
    action: 'reimbursement.policy.update', targetType: 'reimbursement_policy', targetId: policy.id,
    requestId: ctx.requestId, result: 'SUCCESS', metadataJson: { reason: 'demo_seed' },
  }, tx);

  for (const claim of rows.claims) {
    const requestId = demoId(input.companyId, claim.key);
    const stepId = demoId(input.companyId, `${claim.key}-step`);
    const category = categories.get(claim.accountHintKey)!;
    const date = documentDate(claim.date);
    const reserved = await numbers.reserveNumberInTransaction(tx, {
      companyId: input.companyId, branchId: input.branchId, documentType: REIMBURSEMENT_SEQUENCE_KEYS.REQUEST,
      periodKey: date.toISOString().slice(0, 7), idempotencyKey: `reimb-submit:${requestId}`, reservedByUserId: input.ownerUserId,
    });
    await tx.reimbursementRequest.create({ data: {
      id: requestId, companyId: input.companyId, branchId: input.branchId, requestNo: reserved.documentNumber,
      requesterUserId, requesterDisplayNameSnapshot: 'คุณต้น (พนักงาน)', title: claim.title, reason: claim.title,
      categoryKey: claim.accountHintKey, categoryLabelSnapshot: category.name,
      amount: claim.amount, currency: 'THB', incurredDate: date,
      submittedAt: claim.date, submittedByUserId: input.ownerUserId,
      currentApproverUserId: input.ownerUserId, currentApprovalStepId: stepId,
      status: 'PENDING_APPROVAL', paymentStatus: 'NOT_PAYABLE', duplicateStatus: 'NO_MATCH',
      receiptRequirementStatus: 'WAIVED_BY_POLICY', missingReceiptReason: 'รายการเบิกเงินตัวอย่าง',
      approvalPolicySnapshotJson: policySnapshot as unknown as Prisma.InputJsonObject,
      payoutMethod: 'CASH', payoutFingerprint: CASH_PAYOUT_FINGERPRINT,
      outstandingAmount: claim.amount, createdByUserId: input.ownerUserId, createdAt: claim.date,
      // The single line comes from the ReimbursementRequest_fallback_line trigger, which copies these fields.
    } });
    await numbers.commitNumberInTransaction(tx, {
      id: reserved.id, companyId: input.companyId, ownerType: 'reimbursement_request', ownerId: requestId,
    });
    const request = (await repo.findRequestById(input.companyId, requestId))!;
    const snapshotHash = computeSnapshotHash(claimSnapshotFields(request, policySnapshot));
    await tx.reimbursementRequest.update({ where: { id: requestId }, data: { approvalSnapshotHash: snapshotHash } });
    const approved = claim.status !== 'PENDING_APPROVAL';
    await tx.reimbursementApprovalStep.create({ data: {
      id: stepId, companyId: input.companyId, reimbursementRequestId: requestId,
      sequenceNo: 1, approverUserId: input.ownerUserId, approverRoleSnapshot: 'OWNER',
      assignedApproverUserIdsJson: [input.ownerUserId], assignedAt: claim.date,
      status: approved ? 'APPROVED' : 'PENDING',
      decidedAt: approved ? claim.date : null, decisionByUserId: approved ? input.ownerUserId : null,
      requestSnapshotHash: snapshotHash, comment: approved ? 'demo_seed' : null,
    } });
    for (const action of ['reimbursement.request.create', 'reimbursement.request.submit', ...(approved ? ['reimbursement.approval.approve'] : [])]) {
      await audit.log({ companyId: input.companyId, actorUserId: input.ownerUserId, action,
        targetType: 'reimbursement_request', targetId: requestId, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { reason: 'demo_seed', amount: claim.amount },
      }, tx);
    }
    for (const action of ['document.number.reserve', 'document.number.commit']) {
      await audit.log({ companyId: input.companyId, actorUserId: input.ownerUserId, action,
        targetType: 'document_number', targetId: reserved.id, requestId: ctx.requestId, result: 'SUCCESS',
      }, tx);
    }
    await appendClaimEvent(tx, ctx, input, requestId, 'reimbursement.request_submitted', claim.date, {
      requestId, requestNo: reserved.documentNumber, requesterUserId, amount: claim.amount, currency: 'THB', status: 'PENDING_APPROVAL',
    });
    if (!approved) continue;

    const decided = (await repo.findRequestById(input.companyId, requestId))!;
    const projections = await repo.prepareClaimProjections({
      companyId: input.companyId, requestId, decisionKind: 'MANAGER', decisionActorUserId: input.ownerUserId,
      approvalStepId: stepId, scopes: {}, expectedBranchId: input.branchId,
      items: new MaterializeClaimExpensesService().buildItems(decided),
    });
    for (const projection of projections) {
      // Manual claims have no expense category until review. The demo's owner reviews it here.
      await tx.expenseRecord.update({ where: { id: projection.expenseId }, data: {
        expenseCategoryId: category.id, accountHintKey: claim.accountHintKey, duplicateStatus: 'NO_MATCH',
        reviewedAt: claim.date, reviewedByUserId: input.ownerUserId,
      } });
      await tx.expenseLine.updateMany({ where: { companyId: input.companyId, expenseId: projection.expenseId }, data: {
        expenseCategoryId: category.id, accountHintKey: claim.accountHintKey, reviewStatus: 'REVIEWED',
      } });
      await confirmDemoExpense(tx, expenses, input, projection.expenseId);
    }
    await audit.log({ companyId: input.companyId, actorUserId: input.ownerUserId,
      action: 'reimbursement.claim_expense.materialize', targetType: 'reimbursement_request', targetId: requestId,
      requestId: ctx.requestId, result: 'SUCCESS', metadataJson: { createdCount: projections.length },
    }, tx);
    await repo.completeApprovalProjectionAtomic({
      companyId: input.companyId, requestId, decisionActorUserId: input.ownerUserId, approvalStepId: stepId,
      scopes: {}, expectedBranchId: input.branchId, completedAt: claim.date,
      onReadyPersisted: async () => {
        for (const event of ['reimbursement.approved', 'reimbursement.ready_for_payment']) {
          await appendClaimEvent(tx, ctx, input, requestId, event, claim.date, {
            requestId, requestNo: reserved.documentNumber, requesterUserId, status: 'READY_FOR_PAYMENT', decision: 'APPROVED',
          });
        }
      },
    });
    if (claim.status !== 'PAID') continue;
    const paymentNumber = await numbers.reserveNumberInTransaction(tx, {
      companyId: input.companyId, documentType: REIMBURSEMENT_SEQUENCE_KEYS.PAYMENT,
      periodKey: date.toISOString().slice(0, 7), idempotencyKey: `reimb-pay:${requestId}`, reservedByUserId: input.ownerUserId,
    });
    const result = await repo.recordPaymentAtomic({
      companyId: input.companyId, reimbursementRequestId: requestId, idempotencyKey: `demo-pay:${requestId}`,
      paymentNo: paymentNumber.documentNumber, paidAmount: claim.amount, currency: 'THB',
      paymentMethod: 'CASH', paidAt: claim.date, paidByUserId: input.ownerUserId,
      onPaymentPersisted: async (_db, payment, paymentStatus) => {
        await appendClaimEvent(tx, ctx, input, payment.id, 'reimbursement.payment_recorded', claim.date, {
          requestId, requestNo: reserved.documentNumber, requesterUserId, paymentNo: payment.paymentNo ?? null,
          paidAmount: claim.amount, currency: 'THB', sourceType: 'REIMBURSEMENT_PAYMENT', paymentStatus,
        }, 'reimbursement_payment');
      },
    });
    await numbers.commitNumberInTransaction(tx, {
      id: paymentNumber.id, companyId: input.companyId, ownerType: 'reimbursement_payment', ownerId: result.payment.id,
    });
    for (const action of ['document.number.reserve', 'document.number.commit']) {
      await audit.log({ companyId: input.companyId, actorUserId: input.ownerUserId, action,
        targetType: 'document_number', targetId: paymentNumber.id, requestId: ctx.requestId, result: 'SUCCESS',
      }, tx);
    }
    await audit.log({ companyId: input.companyId, actorUserId: input.ownerUserId,
      action: 'reimbursement.payment.record', targetType: 'reimbursement_payment', targetId: result.payment.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { paidAmount: claim.amount, paymentMethod: 'CASH', requestId },
    }, tx);
  }
}

async function appendClaimEvent(
  tx: Prisma.TransactionClient, ctx: RequestContext, input: DemoInput,
  aggregateId: string, eventType: string, occurredAt: Date, data: Prisma.InputJsonObject,
  aggregateType = 'reimbursement_request',
): Promise<void> {
  await tx.outboxEvent.create({ data: {
    companyId: input.companyId, aggregateId, aggregateType, eventType,
    eventKey: `${eventType}:${aggregateType}:${aggregateId}:demo_seed`,
    payloadJson: { companyId: input.companyId, actorUserId: input.ownerUserId, requestId: ctx.requestId,
      aggregateId, aggregateType, occurredAt: occurredAt.toISOString(), data },
    priority: 'NORMAL', status: 'PENDING',
  } });
}
