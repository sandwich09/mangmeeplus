import { Injectable, ForbiddenException, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  CreateReimbursementRequestInput,
  UpdateReimbursementDraftInput,
  ListReimbursementsFilter,
  ReimbursementLineInput,
  ReimbursementHubSummary,
  PaginatedReimbursements,
  ReimbursementRequestSummary,
  ReimbursementRequestDetail,
  ReimbursementInternalNote,
  ReimbursementPolicySnapshotV1,
  ReimbursementSourceSnapshot,
} from '@watchdog-bms/contracts';
import { REIMBURSEMENT_SEQUENCE_KEYS } from '@watchdog-bms/contracts';
import { PrismaReimbursementRepository, hubBucketOfStatus, type ReimbursementRequestGroup } from '../../infrastructure/prisma-reimbursement.repository';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { VoidExpenseUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { assertReimbursementBranchInScope } from './reimbursement-branch-scope';
import type {
  ReimbursementDuplicateCandidateWriteData,
  ReimbursementLineRecord,
  ReimbursementLineWriteData,
  ReimbursementRequestRecord,
} from '../../domain/models/reimbursement.model';
import { toRequestSummary, toRequestDetail, detailUserIds, toSignedCopySummaries, detailWithFileNames } from '../dto/reimbursement.mapper';
import { effectivePolicy, effectivePolicyForRequest } from '../../domain/reimbursement.constants';
import { approverModeForRole, ListReimbursementApproverOptionsUseCase } from './reimbursement-policy.use-case';
import { approvalDecisionActions } from './reimbursement-approval.use-case';
import { ReimbursementProjectionOrchestratorService } from '../services/reimbursement-projection-orchestrator.service';
import {
  validateRequestFields,
  validateLines,
  requiresApproval,
  computeReceiptRequirement,
  isLineEvidenced,
  computeSnapshotHash,
  canTransition,
  deriveHeaderFromLines,
  byLineNo,
  scoreDuplicate,
  normalizeReason,
  normalizeReimbursementAmount,
  PAYMENT_RECORDING_STATUSES,
  d,
  decStr,
} from '../../domain/logic/reimbursement.logic';

export async function loadReimbursementPolicy(repo: PrismaReimbursementRepository, companyId: string) {
  return effectivePolicy(await repo.findPolicy(companyId, null));
}

async function appendSubmitOutbox(tx: any, input: {
  companyId: string;
  eventType: string;
  requestId: string;
  actorUserId: string;
  traceRequestId: string;
  occurredAt: Date;
  data: Record<string, unknown>;
  eventKeySuffix: string;
}): Promise<void> {
  await tx.outboxEvent.createMany({
    data: [{
      companyId: input.companyId,
      eventType: input.eventType,
      aggregateType: 'reimbursement_request',
      aggregateId: input.requestId,
      eventKey: `${input.eventType}:reimbursement_request:${input.requestId}:${input.eventKeySuffix}`,
      payloadJson: {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        requestId: input.traceRequestId,
        aggregateType: 'reimbursement_request',
        aggregateId: input.requestId,
        occurredAt: input.occurredAt.toISOString(),
        data: input.data,
      },
      priority: 'NORMAL',
      status: 'PENDING',
    }],
    skipDuplicates: true,
  });
}

export function prepareReimbursementLineWrites(lines: Array<ReimbursementLineInput & { sourceExpenseSnapshot?: ReimbursementSourceSnapshot; attachmentSnapshot?: import('../../domain/models/reimbursement.model').ReimbursementAttachmentSnapshot }>): ReimbursementLineWriteData[] {
  return byLineNo(lines).map((line) => ({
    lineNo: line.lineNo,
    incurredDate: new Date(line.incurredDate),
    description: line.description.trim(),
    purpose: line.purpose?.trim() || null,
    categoryKey: line.categoryKey,
    categoryLabelSnapshot: line.categoryLabel ?? null,
    amount: normalizeReimbursementAmount(line.amount),
    attachmentId: line.attachmentId ?? null,
    linkedExpenseId: line.linkedExpenseId ?? null,
    sourceExpenseSnapshot: line.sourceExpenseSnapshot,
    attachmentSnapshot: line.attachmentSnapshot,
  }));
}

/** Reimbursement numbers follow the Thai business month, independent of the host time zone. */
export function reimbursementPeriodKey(now: Date = new Date()): string {
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${bangkok.getUTCFullYear()}-${String(bangkok.getUTCMonth() + 1).padStart(2, '0')}`;
}

// detailWithFileNames moved to ../dto/reimbursement.mapper so the approval and finance
// decision endpoints can return the same fully-hydrated detail without an import cycle.

@Injectable()
export class CreateReimbursementDraftUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, input: CreateReimbursementRequestInput): Promise<ReimbursementRequestSummary> {
    if (!ctx.permissions.includes('reimbursement.create')) throw new ForbiddenException('Missing permission: reimbursement.create');
    // The same source-branch rule as receipt upload; never default to the first of many branches.
    assertReimbursementBranchInScope(ctx, input.branchId);
    const branchId = await this.repo.resolveCreateBranchId(ctx.companyId, ctx.scopes ?? {}, input.branchId);

    const errors = validateRequestFields(input);
    if (errors.length > 0) throw new BadRequestException(errors.join(','));
    const requesterUserId = input.requesterUserId ?? ctx.userId;
    if (requesterUserId !== ctx.userId && !ctx.permissions.includes('reimbursement.finance_review')) throw new ForbiddenException('Cannot prepare a reimbursement for another member');
    const member = await this.repo.assertReimbursementRequester(ctx.companyId, branchId, requesterUserId);
    const policy = await loadReimbursementPolicy(this.repo, ctx.companyId);
    const resolvedLines = await this.repo.resolveSourceLines(ctx.companyId, requesterUserId, branchId, input.currency ?? policy.currency, input.lines);
    await this.evidence.validate(ctx, requesterUserId, resolvedLines, branchId);
    const displayName = member.displayName;
    const receipt = computeReceiptRequirement({
      requireReceipt: policy.requireReceipt,
      allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      lines: resolvedLines,
      missingReceiptReason: input.missingReceiptReason,
    });
    // Header amount/category/date are the rollup of the lines — never client input.
    const header = deriveHeaderFromLines(resolvedLines);

    const created = await this.repo.createRequest({
      companyId: ctx.companyId,
      branchId: branchId ?? undefined,
      requesterUserId,
      requesterDisplayNameSnapshot: displayName,
      title: input.title,
      reason: input.reason,
      categoryKey: header.categoryKey,
      categoryLabelSnapshot: header.categoryLabelSnapshot,
      amount: header.amount,
      currency: input.currency ?? policy.currency,
      incurredDate: header.incurredDate,
      missingReceiptReason: input.missingReceiptReason,
      // Draft records the requirement status but does not block until submit.
      receiptRequirementStatus: receipt.status === 'REQUIRED' ? 'REQUIRED' : receipt.status,
      createdByUserId: ctx.userId,
      lines: prepareReimbursementLineWrites(resolvedLines),
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.create',
      targetType: 'reimbursement_request', targetId: created.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { amount: created.amount, currency: created.currency, categoryKey: created.categoryKey, lineCount: input.lines.length },
    });
    return toRequestSummary(created, { allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason });
  }
}

@Injectable()
export class UpdateReimbursementDraftUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, id: string, input: UpdateReimbursementDraftInput): Promise<ReimbursementRequestSummary> {
    const req = await this.repo.findRequestById(ctx.companyId, id);
    if (!req) throw new NotFoundException('Reimbursement request not found');

    const isOwner = req.requesterUserId === ctx.userId;
    const canUpdate = (isOwner && ctx.permissions.includes('reimbursement.update_own_draft')) || ctx.permissions.includes('reimbursement.finance_review');
    if (!canUpdate) throw new ForbiddenException('Cannot update this reimbursement');
    // The owner path is self-limiting, but finance_review reaches any claim by id — including the
    // lines, which are the amount.
    assertReimbursementBranchInScope(ctx, req.branchId);
    if (req.status !== 'DRAFT') throw new UnprocessableEntityException('Only draft requests can be edited');

    const policy = await loadReimbursementPolicy(this.repo, ctx.companyId);
    const data: Record<string, unknown> = { updatedByUserId: ctx.userId };
    if (input.title !== undefined) data.title = input.title;
    if (input.reason !== undefined) data.reason = input.reason;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.missingReceiptReason !== undefined) data.missingReceiptReason = input.missingReceiptReason;

    // Lines are replaced wholesale; the header rollup follows them. The
    // repository compares the version read above under the same lock as submit.
    let lines: ReimbursementLineWriteData[] | undefined;
    if (input.lines !== undefined) {
      const errors = validateLines(input.lines);
      if (errors.length > 0) throw new BadRequestException(errors.join(','));
      const resolvedLines = await this.repo.resolveSourceLines(ctx.companyId, req.requesterUserId, req.branchId!, input.currency ?? req.currency, input.lines);
      await this.evidence.validate(ctx, req.requesterUserId, resolvedLines, req.branchId, new Map((req.lines ?? []).flatMap(line => line.attachmentSnapshot ? [[line.attachmentSnapshot.id, line.attachmentSnapshot.uploadedByUserId] as const] : [])));
      const header = deriveHeaderFromLines(resolvedLines);
      data.amount = header.amount;
      data.categoryKey = header.categoryKey;
      data.categoryLabelSnapshot = header.categoryLabelSnapshot ?? null;
      data.incurredDate = header.incurredDate;
      data.outstandingAmount = header.amount;
      lines = prepareReimbursementLineWrites(resolvedLines);
    }
    const receipt = computeReceiptRequirement({
      requireReceipt: policy.requireReceipt,
      allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      lines: input.lines ?? req.lines ?? [],
      missingReceiptReason: input.missingReceiptReason ?? req.missingReceiptReason,
    });
    data.receiptRequirementStatus = receipt.status;
    const updated = await this.repo.updateDraftRequest(ctx.companyId, id, req.updatedAt, data, lines);
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.update_draft',
      targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });
    return toRequestSummary(updated, { allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason });
  }
}

/**
 * REJECTED is not a dead end: the requester reopens the claim as a DRAFT, fixes it with the
 * normal draft edit, and resubmits under the same request number (the in-app guide promises
 * exactly this journey). Rejection history stays on the approval step. The same reopen withdraws
 * a claim still waiting for approval (spec §6 step 2), while no approver has decided it.
 */
@Injectable()
export class ReopenRejectedReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<ReimbursementRequestSummary> {
    const req = await this.repo.findRequestById(ctx.companyId, id);
    if (!req) throw new NotFoundException('Reimbursement request not found');

    const isOwner = req.requesterUserId === ctx.userId;
    const withdraw = req.status === 'PENDING_APPROVAL';
    // Withdrawing is the requester's own act; finance's wider reach covers reopening a refusal only.
    const canReopen = (isOwner && ctx.permissions.includes('reimbursement.update_own_draft'))
      || (!withdraw && ctx.permissions.includes('reimbursement.finance_review'));
    if (!canReopen) throw new ForbiddenException('Cannot reopen this reimbursement');
    assertReimbursementBranchInScope(ctx, req.branchId);
    if ((req.status !== 'REJECTED' && !withdraw) || !canTransition(req.status, 'DRAFT')) {
      throw new UnprocessableEntityException(`Cannot reopen from status ${req.status}`);
    }

    const updated = await this.repo.reopenRejectedRequest(ctx.companyId, id, req.updatedAt, ctx.userId, withdraw ? 'PENDING_APPROVAL' : 'REJECTED');
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: withdraw ? 'reimbursement.request.withdraw' : 'reimbursement.request.reopen',
      targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: withdraw
        ? { requestNo: req.requestNo, previousStatus: 'PENDING_APPROVAL' }
        : { requestNo: req.requestNo, previousRejectionReason: req.rejectionReason },
    });
    return toRequestSummary(updated);
  }
}

@Injectable()
export class GetReimbursementDetailUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<ReimbursementRequestDetail> {
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    const approvalActions = await assertCanReadRequestOrAssignment(ctx, req, this.repo);
    const notes = await this.repo.listInternalNotes(ctx.companyId, id);
    const names = await this.repo.getUserDisplayNames(ctx.companyId, notes.map(note => note.authorUserId));
    const detail = await detailWithFileNames(this.repo, this.evidence, ctx.companyId, req, ctx, approvalActions);
    // Who can record the payment (spec §18.3): read only while the claim waits there and the endpoint would
    // take a payment at all. A claim with no branch, or in a status it refuses (PARTIALLY_PAID), is refused
    // for everyone, so nobody is named and the page prints the pool label. Only on this read: the page
    // re-reads the claim after every action, like `approvalActions`.
    const payers = detail.currentDesk?.kind === 'PAYMENT' && req.branchId && PAYMENT_RECORDING_STATUSES.includes(req.status)
      ? await this.repo.listPaymentRecorderNames(ctx.companyId, req.branchId) : undefined;
    return {
      ...detail,
      approvalActions,
      ...(payers && { paymentDesk: { names: payers.slice(0, 5), moreCount: Math.max(payers.length - 5, 0) } }),
      internalNotes: notes.map(note => ({
        id: note.id,
        authorUserId: note.authorUserId,
        authorName: names[note.authorUserId] ?? 'สมาชิกบริษัท',
        body: note.body,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      })),
    };
  }
}

export async function assertCanReadRequestOrAssignment(ctx: RequestContext, req: ReimbursementRequestRecord, repo: PrismaReimbursementRepository) {
  const approvalActions = await approvalDecisionActions(ctx, req, repo);
  try {
    await assertCanReadRequest(ctx, req, repo);
  } catch (error) {
    // A frozen assignment permits this exact claim even after a role change.
    if (!(error instanceof ForbiddenException)
      || (!approvalActions.canApprove && !approvalActions.canReject)) throw error;
  }
  return approvalActions;
}

@Injectable()
export class ReimbursementInternalNotesUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly audit: AuditService) {}

  private async assertAccess(ctx: RequestContext, requestId: string) {
    const req = await this.repo.findRequestById(ctx.companyId, requestId, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    await assertCanReadRequestOrAssignment(ctx, req, this.repo);
  }

  private body(value: string): string {
    const body = value.trim();
    if (!body || body.length > 2000) throw new BadRequestException('internal_note_body_invalid');
    return body;
  }

  async create(ctx: RequestContext, requestId: string, body: string): Promise<ReimbursementInternalNote> {
    await this.assertAccess(ctx, requestId);
    const note = await this.repo.createInternalNote(ctx.companyId, requestId, ctx.userId, this.body(body));
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'reimbursement.internal_note.create', targetType: 'reimbursement_request', targetId: requestId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { noteId: note.id } });
    const names = await this.repo.getUserDisplayNames(ctx.companyId, [ctx.userId]);
    return { id: note.id, authorUserId: note.authorUserId, authorName: names[ctx.userId] ?? 'สมาชิกบริษัท',
      body: note.body, createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() };
  }

  async update(ctx: RequestContext, requestId: string, noteId: string, body: string): Promise<void> {
    await this.assertAccess(ctx, requestId);
    const note = await this.repo.findInternalNote(ctx.companyId, requestId, noteId);
    if (!note) throw new NotFoundException('Internal note not found');
    if (note.authorUserId !== ctx.userId && !ctx.roles.includes('OWNER')) throw new ForbiddenException('Cannot edit this internal note');
    await this.repo.updateInternalNote(ctx.companyId, requestId, noteId, this.body(body));
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'reimbursement.internal_note.update', targetType: 'reimbursement_request', targetId: requestId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { noteId } });
  }

  async delete(ctx: RequestContext, requestId: string, noteId: string): Promise<void> {
    await this.assertAccess(ctx, requestId);
    const note = await this.repo.findInternalNote(ctx.companyId, requestId, noteId);
    if (!note) throw new NotFoundException('Internal note not found');
    if (note.authorUserId !== ctx.userId && !ctx.roles.includes('OWNER')) throw new ForbiddenException('Cannot delete this internal note');
    await this.repo.deleteInternalNote(ctx.companyId, requestId, noteId);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'reimbursement.internal_note.delete', targetType: 'reimbursement_request', targetId: requestId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { noteId } });
  }
}

/** The scope's groups folded into what the hub's cards and chips print. Every claim is counted in exactly one bucket. */
export function hubSummary(groups: readonly ReimbursementRequestGroup[]): ReimbursementHubSummary {
  const counts = { all: 0, draft: 0, review: 0, payment: 0, paid: 0, closed: 0 };
  let totalAmount = d('0');
  let blockedDraftCount = 0;
  for (const group of groups) {
    counts.all += group.count;
    counts[hubBucketOfStatus(group.status, group.financeReviewStatus)] += group.count;
    totalAmount = totalAmount.add(d(group.amount));
    // The gate a list row shows on its ส่งอนุมัติ button: a draft that still owes its receipt.
    if (group.status === 'DRAFT' && group.receiptRequirementStatus === 'REQUIRED') blockedDraftCount += group.count;
  }
  return { counts, totalAmount: decStr(totalAmount), blockedDraftCount };
}

/** A page number or size from the query string: a whole number from 1 up, and small enough to be an OFFSET. */
const wholeFrom1 = (value: number | undefined, fallback: number) =>
  (value !== undefined && Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), 1_000_000) : fallback);

@Injectable()
export class ListReimbursementsUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository) {}

  async execute(ctx: RequestContext, filter: ListReimbursementsFilter): Promise<PaginatedReimbursements> {
    const canReadAll = ctx.permissions.includes('reimbursement.read');
    const canReadOwn = ctx.permissions.includes('reimbursement.read_own');
    const canReadRelated = ctx.permissions.includes('reimbursement.read_related');
    if (!canReadAll && !canReadOwn && !canReadRelated) throw new ForbiddenException('Missing permission to read reimbursements');

    let requesterUserId: string | undefined;
    let relatedUserId: string | undefined;
    if (filter.scope === 'own') {
      requesterUserId = ctx.userId;
    } else if (filter.scope === 'related') {
      if (!canReadRelated) throw new ForbiddenException('Missing permission: reimbursement.read_related');
      relatedUserId = ctx.userId;
    } else if (canReadAll) {
      requesterUserId = filter.requesterUserId;
    } else if (canReadRelated) {
      relatedUserId = ctx.userId;
      requesterUserId = filter.requesterUserId;
    } else {
      requesterUserId = ctx.userId;
    }

    const page = wholeFrom1(filter.page, 1);
    const pageSize = Math.min(wholeFrom1(filter.pageSize, 20), 100);
    // The database pages. Before, every call loaded the whole scope and sliced it here, so walking a
    // list of N claims read N rows per page: N²/100 rows for all of it.
    const [{ rows: items, groups }, policy] = await Promise.all([this.repo.listRequestPage({
      companyId: ctx.companyId,
      requesterUserId,
      relatedUserId,
      scopes: ctx.scopes ?? {},
      status: filter.status,
      paymentStatus: filter.paymentStatus,
      bucket: filter.bucket,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }), loadReimbursementPolicy(this.repo, ctx.companyId)]);
    // The total is read off the same groups the cards print, so a card can never count a different list.
    const hub = hubSummary(groups);
    // "อยู่ที่ …" needs the pending step and its assignees only where a claim is actually waiting
    // on a person. Two batched lookups for the page — and neither runs when the page has no
    // PENDING_APPROVAL row (both helpers return empty on an empty id list).
    const pendingSteps = await this.repo.findPendingApprovalSteps(
      ctx.companyId,
      items.filter((row) => row.status === 'PENDING_APPROVAL').map((row) => row.id),
    );
    const approverNames = await this.repo.getUserDisplayNames(
      ctx.companyId,
      pendingSteps.flatMap((step) => [...(step.assignedApproverUserIds ?? []), ...(step.approverUserId ? [step.approverUserId] : [])]),
    );
    return {
      items: items.map((row) => toRequestSummary(
        { ...row, approvalSteps: pendingSteps.filter((step) => step.reimbursementRequestId === row.id) },
        { allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason, approverNames },
      )),
      total: filter.bucket === undefined ? hub.counts.all : hub.counts[filter.bucket] ?? 0,
      page,
      pageSize,
      hub,
    };
  }
}

@Injectable()
export class SubmitReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly evidence: ReimbursementEvidenceService,
    private readonly approverRoutes: ListReimbursementApproverOptionsUseCase,
    private readonly projections: ReimbursementProjectionOrchestratorService,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<ReimbursementRequestDetail> {
    if (!ctx.permissions.includes('reimbursement.submit')) throw new ForbiddenException('Missing permission: reimbursement.submit');

    const req = await this.repo.findRequestById(ctx.companyId, id);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    if (req.requesterUserId !== ctx.userId && !ctx.permissions.includes('reimbursement.finance_review')) {
      throw new ForbiddenException('Only the requester can submit this request');
    }
    // Same finance_review reach as the draft edit above: submitting starts the approval chain and
    // is what puts the claim in front of another branch's approvers.
    assertReimbursementBranchInScope(ctx, req.branchId);
    if (req.status !== 'DRAFT') throw new UnprocessableEntityException(`Cannot submit from status ${req.status}`);

    const lines = req.lines ?? [];
    const lineErrors = validateLines(lines);
    if (lineErrors.length > 0) throw new UnprocessableEntityException(lineErrors.join(','));
    await this.evidence.validate(ctx, req.requesterUserId, lines, req.branchId, new Map(lines.flatMap(line => line.attachmentSnapshot ? [[line.attachmentSnapshot.id, line.attachmentSnapshot.uploadedByUserId] as const] : [])));
    if (lines.some(line => line.linkedExpenseId && !line.sourceExpenseSnapshot)) throw new UnprocessableEntityException({ code: 'reimbursement_source_review_required' });

    const policyRecord = await this.repo.findPolicy(ctx.companyId, null);
    const policy = effectivePolicy(policyRecord);
    if (policy.status !== 'ACTIVE') throw new UnprocessableEntityException('reimbursement_policy_inactive');

    // Receipt gate at submit: every line evidenced, or one claim-level reason.
    const receipt = computeReceiptRequirement({
      requireReceipt: policy.requireReceipt,
      allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      lines,
      missingReceiptReason: req.missingReceiptReason,
    });
    if (receipt.error) throw new UnprocessableEntityException(receipt.error);
    // A receipt-less line is materialized into an employee-payable expense at อนุมัติจ่าย, and
    // that expense confirms only with an attachment or a missing-receipt reason. The claim's
    // waive policy does not travel to the expense, so a claim submitted with neither strands the
    // finance saga after its decision is already durable (BUG-7). Ask for the reason here, where
    // the claim is still a draft the requester can fix.
    if (!req.missingReceiptReason?.trim() && lines.some((line) => !isLineEvidenced(line))) {
      throw new BadRequestException('missing_receipt_reason_required');
    }

    // Double-claim guard: no receipt/expense may be claimed on two live claims.
    await this.assertEvidenceNotClaimedElsewhere(ctx.companyId, id, lines);

    // Duplicate detection (warn on submit; blocking only if policy = BLOCK_SUBMIT).
    const dupResult = await this.detectDuplicates(ctx.companyId, req);
    if (dupResult.blocking && policy.duplicatePolicy === 'BLOCK_SUBMIT') {
      throw new UnprocessableEntityException('duplicate_unresolved');
    }

    const now = new Date();
    const humanApprovalRequired = requiresApproval(req.amount, policy.approvalRequiredFromAmount);
    const roleKey = policy.defaultApproverRole ?? 'MANAGER';
    let approverUserId: string | undefined;
    let submissionRoute: Awaited<ReturnType<ListReimbursementApproverOptionsUseCase['resolveSubmissionRoute']>> | undefined;
    if (humanApprovalRequired) {
      if (policy.approverMode === 'CUSTOM_USER' && policy.defaultApproverUserId) {
        submissionRoute = await this.approverRoutes.resolveNamedSubmissionRoute({
          companyId: ctx.companyId,
          userId: policy.defaultApproverUserId,
          branchId: req.branchId,
          requesterUserId: req.requesterUserId,
          allowSelfApproval: policy.allowSelfApproval,
          fallbackRole: roleKey,
        }) ?? undefined;
        if (submissionRoute) approverUserId = policy.defaultApproverUserId;
      }
      submissionRoute ??= await this.approverRoutes.resolveSubmissionRoute({
        companyId: ctx.companyId,
        roleKey,
        roleKeys: policy.defaultApproverRoles,
        branchId: req.branchId,
        requesterUserId: req.requesterUserId,
        allowSelfApproval: policy.allowSelfApproval,
      });
    }
    const policySnapshot: ReimbursementPolicySnapshotV1 = {
      schemaVersion: 1,
      policyId: policyRecord?.id ?? 'default',
      policyVersion: policyRecord?.updatedAt.toISOString() ?? 'default:v1',
      approvalRequiredFromAmount: policy.approvalRequiredFromAmount,
      requiresApproval: humanApprovalRequired,
      route: submissionRoute ? {
        mode: approverModeForRole(submissionRoute.responsibilityRole),
        roleKey: submissionRoute.responsibilityRole,
        effectiveTaskRole: submissionRoute.effectiveTaskRole,
        ownerFallbackUsedAtSubmission: submissionRoute.ownerFallbackUsed,
        // Owner order 2026-09-21: nobody but the requester could approve, so the step below is
        // assigned to them. Frozen with the route — part of the approval hash — so a later role
        // change cannot re-decide it; the approval audit reads it as the reason.
        ...(submissionRoute.soloSelfApproval && { soloSelfApprovalAtSubmission: true }),
      } : null,
      allowSelfApproval: policy.allowSelfApproval,
      requireReceipt: policy.requireReceipt,
      allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      duplicatePolicy: policy.duplicatePolicy,
      financeReviewRequired: policy.financeReviewRequired,
      ...(policy.slaHours !== undefined && { slaHours: policy.slaHours }),
    };
    const snapshotHash = computeSnapshotHash({
      amount: req.amount,
      currency: req.currency,
      categoryKey: req.categoryKey,
      incurredDate: req.incurredDate.toISOString(),
      reason: req.reason,
      primaryAttachmentId: req.primaryAttachmentId,
      lines,
      approvalPolicySnapshotJson: policySnapshot,
    });

    const periodKey = reimbursementPeriodKey(now);
    // A corrected request may be submitted again under the same unchanged policy and even with
    // identical business fields. The submission timestamp is the durable epoch that keeps its
    // outbox keys idempotent within one submit without suppressing later resubmission events.
    const submissionEventKey = `${policySnapshot.policyVersion}:${now.toISOString()}`;

    const initialStatus = humanApprovalRequired
      ? 'PENDING_APPROVAL'
      : policy.financeReviewRequired ? 'FINANCE_REVIEW' : 'APPROVED';
    // Optional step, policy snapshot, number, status, audit and outbox facts commit together.
    const {
      documentNumber,
    } = await this.repo.submitDraftAtomic({
      companyId: ctx.companyId,
      requestId: id,
      expectedUpdatedAt: req.updatedAt,
      duplicateCandidates: dupResult.candidates,
      evidence: {
        attachmentIds: lines.map((line) => line.attachmentId).filter((value): value is string => !!value),
        expenseIds: lines.map((line) => line.linkedExpenseId).filter((value): value is string => !!value),
      },
      documentNumber: {
        branchId: req.branchId,
        documentType: REIMBURSEMENT_SEQUENCE_KEYS.REQUEST,
        periodKey,
        reservedByUserId: ctx.userId,
        idempotencyKey: `reimb-submit:${id}`,
      },
      ...(humanApprovalRequired && { approvalStep: {
        sequenceNo: 1,
        approverUserId,
        approverRoleSnapshot: submissionRoute!.responsibilityRole,
        assignedApproverUserIdsJson: submissionRoute!.recipientUserIds,
        requestSnapshotHash: snapshotHash,
      } }),
      request: {
        status: initialStatus,
        submittedAt: now,
        submittedByUserId: ctx.userId,
        currentApproverUserId: humanApprovalRequired ? approverUserId : null,
        approvalSnapshotHash: snapshotHash,
        approvalPolicySnapshotJson: policySnapshot,
        // A corrected draft may carry NEEDS_INFO while the requester works. Once it is
        // resubmitted, that decision is historical; finance starts again only after the new approval.
        financeReviewStatus: !humanApprovalRequired && policy.financeReviewRequired ? 'PENDING' : 'NOT_REQUIRED',
        financeReviewedByUserId: null,
        financeReviewedAt: null,
        financeReviewNote: null,
        approvedAt: humanApprovalRequired ? null : now,
        receiptRequirementStatus: receipt.status,
        duplicateStatus: dupResult.status,
        // Freeze the outstanding amount to the observed submitted amount.
        outstandingAmount: req.amount,
        updatedByUserId: ctx.userId,
      },
      onSubmittedPersisted: async (tx, persisted) => {
        if (!persisted.documentNumberReused) {
          for (const action of ['document.number.reserve', 'document.number.commit'] as const) {
            await this.audit.log({
              companyId: ctx.companyId, actorUserId: ctx.userId, action,
              targetType: 'document_number', targetId: persisted.documentNumber.id,
              requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
              metadataJson: { documentType: REIMBURSEMENT_SEQUENCE_KEYS.REQUEST, ownerId: id },
            }, tx);
          }
        }
        await this.audit.log({
          companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.submit',
          targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId,
          result: 'SUCCESS', riskLevel: 'MEDIUM',
          metadataJson: {
            requestNo: persisted.documentNumber.documentNumber,
            amount: req.amount, currency: req.currency, lineCount: lines.length,
            policyId: policySnapshot.policyId, policyVersion: policySnapshot.policyVersion,
            requiresApproval: humanApprovalRequired,
            selectedRole: submissionRoute?.responsibilityRole,
            effectiveTaskRole: submissionRoute?.effectiveTaskRole,
            approverRecipientCount: submissionRoute?.recipientUserIds.length ?? 0,
            ownerFallbackUsed: submissionRoute?.ownerFallbackUsed ?? false,
            soloSelfApproval: submissionRoute?.soloSelfApproval ?? false,
            branchId: req.branchId,
            legacyRecovery: {
              documentNumberReused: persisted.documentNumberReused,
              supersededDuplicateCandidateCount: persisted.supersededDuplicateCandidateCount,
              supersededApprovalStepCount: persisted.supersededApprovalStepCount,
            },
          },
        }, tx);
        if (!humanApprovalRequired) {
          await this.audit.log({
            companyId: ctx.companyId, actorType: 'SYSTEM', actorRefId: 'reimbursement-policy',
            action: 'reimbursement.approval.auto_by_policy', targetType: 'reimbursement_request',
            targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
            metadataJson: { reason: 'BELOW_APPROVAL_THRESHOLD', policyVersion: policySnapshot.policyVersion },
          }, tx);
        }
        const baseData = {
          requestId: id,
          status: initialStatus,
          requestNo: persisted.documentNumber.documentNumber,
          requesterUserId: req.requesterUserId,
          amount: req.amount,
          currency: req.currency,
          policySnapshotVersion: policySnapshot.schemaVersion,
        };
        await appendSubmitOutbox(tx, {
          companyId: ctx.companyId, eventType: 'reimbursement.request_submitted', requestId: id,
          actorUserId: ctx.userId, traceRequestId: ctx.requestId, occurredAt: now,
          eventKeySuffix: submissionEventKey,
          data: humanApprovalRequired ? {
            ...baseData,
            approverRole: submissionRoute!.responsibilityRole,
            approverRecipientUserIds: submissionRoute!.recipientUserIds,
            approverTaskUserId: submissionRoute!.recipientUserIds[0],
            approverTaskRole: submissionRoute!.effectiveTaskRole,
            approverFallbackToOwner: submissionRoute!.ownerFallbackUsed,
          } : baseData,
        });
        if (humanApprovalRequired) {
          await appendSubmitOutbox(tx, {
            companyId: ctx.companyId, eventType: 'reimbursement.approval_assigned', requestId: id,
            actorUserId: ctx.userId, traceRequestId: ctx.requestId, occurredAt: now,
            eventKeySuffix: persisted.step!.id,
            data: {
              ...baseData, stepId: persisted.step!.id, approverUserId,
              approverRole: submissionRoute!.responsibilityRole,
              approverRecipientUserIds: submissionRoute!.recipientUserIds,
              approverTaskUserId: submissionRoute!.recipientUserIds[0],
              approverTaskRole: submissionRoute!.effectiveTaskRole,
              approverFallbackToOwner: submissionRoute!.ownerFallbackUsed,
            },
          });
        } else {
          await appendSubmitOutbox(tx, {
            companyId: ctx.companyId, eventType: 'reimbursement.approval_not_required', requestId: id,
            actorUserId: ctx.userId, traceRequestId: ctx.requestId, occurredAt: now,
            eventKeySuffix: submissionEventKey,
            data: { ...baseData, decision: 'BELOW_APPROVAL_THRESHOLD' },
          });
          await appendSubmitOutbox(tx, {
            companyId: ctx.companyId,
            eventType: policy.financeReviewRequired
              ? 'reimbursement.finance_review_requested'
              : 'reimbursement.policy_projection_started',
            requestId: id, actorUserId: ctx.userId, traceRequestId: ctx.requestId, occurredAt: now,
            eventKeySuffix: submissionEventKey,
            data: baseData,
          });
        }
      },
    });
    const requestNo = documentNumber.documentNumber;

    if (!humanApprovalRequired && !policy.financeReviewRequired) {
      const submitted = await this.repo.findRequestById(ctx.companyId, id, true);
      await this.projections.execute(ctx, submitted!, {
        kind: 'POLICY', actorUserId: req.requesterUserId,
        allowMissingReceiptWithReason: policySnapshot.allowMissingReceiptWithReason,
      });
      // Nobody had to approve this claim, so the people who would have are the ones the ready-to-pay
      // notice asks first (owner rule 2026-10-01). Best effort: a notice never fails a submission.
      let approverRecipientUserIds: string[] = [];
      try {
        approverRecipientUserIds = await this.approverRoutes.resolveWouldBeApproverUserIds(ctx.companyId, policy, req);
      } catch { /* the notice then goes to everyone able to record the payment */ }
      const readyAt = new Date();
      await this.repo.completePolicyProjectionAtomic({
        companyId: ctx.companyId, requestId: id, actorUserId: req.requesterUserId,
        scopes: ctx.scopes ?? {}, completedAt: readyAt,
        onReadyPersisted: async (tx) => {
          for (const eventType of ['reimbursement.approved', 'reimbursement.ready_for_payment']) {
            await appendSubmitOutbox(tx, {
              companyId: ctx.companyId, eventType, requestId: id, actorUserId: ctx.userId,
              traceRequestId: ctx.requestId, occurredAt: readyAt,
              eventKeySuffix: submissionEventKey,
              data: {
                requestId: id, requestNo, requesterUserId: req.requesterUserId,
                status: 'READY_FOR_PAYMENT', decision: 'BELOW_APPROVAL_THRESHOLD',
                amount: req.amount, currency: req.currency,
                ...(approverRecipientUserIds.length > 0 && { approverRecipientUserIds }),
              },
            });
          }
        },
      });
    }

    const detail = await this.repo.findRequestById(ctx.companyId, id, true);
    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, detail!, ctx);
  }

  /**
   * The same receipt or LINE-captured expense may back only one live claim.
   * Rejected/cancelled/voided claims release their evidence, so re-submitting a
   * corrected claim with the same receipt is allowed.
   */
  private async assertEvidenceNotClaimedElsewhere(companyId: string, requestId: string, lines: ReimbursementLineRecord[]): Promise<void> {
    const attachmentIds = lines.map((line) => line.attachmentId).filter((v): v is string => !!v);
    const expenseIds = lines.map((line) => line.linkedExpenseId).filter((v): v is string => !!v);
    const claimed = await this.repo.findLinesClaimedElsewhere(companyId, requestId, attachmentIds, expenseIds);
    const hit = claimed[0];
    if (!hit) return;
    throw new UnprocessableEntityException(
      hit.attachmentId && attachmentIds.includes(hit.attachmentId) ? 'attachment_already_claimed' : 'expense_already_claimed',
    );
  }

  private async detectDuplicates(companyId: string, req: { id: string; requesterUserId: string; amount: string; currency: string; incurredDate: Date; categoryKey: string; reason: string; lines?: ReimbursementLineRecord[] }) {
    const candidates = await this.repo.findDuplicateCandidates(companyId, req.requesterUserId, req.id);
    const a = {
      requesterUserId: req.requesterUserId, amount: req.amount, currency: req.currency,
      incurredDate: req.incurredDate.toISOString(), categoryKey: req.categoryKey,
      normalizedReason: normalizeReason(req.reason), lines: req.lines ?? [],
    };
    let best = 0;
    const duplicateCandidates: ReimbursementDuplicateCandidateWriteData[] = [];
    for (const c of candidates) {
      const match = scoreDuplicate(a, {
        requesterUserId: c.requesterUserId, amount: c.amount, currency: c.currency,
        incurredDate: c.incurredDate.toISOString(), categoryKey: c.categoryKey,
        normalizedReason: normalizeReason(c.reason), lines: c.lines ?? [],
      });
      if (match.score >= 60) {
        duplicateCandidates.push({
          candidateType: match.sharedType === 'ATTACHMENT' ? 'ATTACHMENT_CHECKSUM' : match.sharedType === 'EXPENSE' ? 'EXPENSE_LINK' : 'AMOUNT_DATE_VENDOR',
          candidateRequestId: c.id,
          candidateAttachmentId: match.sharedAttachmentId,
          candidateExpenseId: match.sharedExpenseId,
          score: match.score,
          reason: match.sharedLineNo !== undefined
            ? `line ${match.sharedLineNo} shares ${match.sharedType === 'EXPENSE' ? 'a linked expense' : 'a receipt'} with ${c.requestNo ?? c.id}`
            : undefined,
        });
        best = Math.max(best, match.score);
      }
    }
    if (best >= 80) return { status: 'POSSIBLE_DUPLICATE' as const, blocking: true, candidates: duplicateCandidates };
    if (best >= 60) return { status: 'POSSIBLE_DUPLICATE' as const, blocking: false, candidates: duplicateCandidates };
    return { status: 'NO_MATCH' as const, blocking: false, candidates: duplicateCandidates };
  }
}

@Injectable()
export class CancelReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly voidExpense: VoidExpenseUseCase,
  ) {}

  async execute(ctx: RequestContext, id: string, reason?: string): Promise<ReimbursementRequestSummary> {
    const req = await this.repo.findRequestById(ctx.companyId, id);
    if (!req) throw new NotFoundException('Reimbursement request not found');

    const isOwner = req.requesterUserId === ctx.userId;
    const canCancel = (isOwner && ctx.permissions.includes('reimbursement.cancel_own')) || ctx.permissions.includes('reimbursement.finance_review');
    if (!canCancel) throw new ForbiddenException('Cannot cancel this reimbursement');
    if (!canTransition(req.status, 'CANCELLED')) throw new UnprocessableEntityException(`Cannot cancel from status ${req.status}`);
    assertReimbursementBranchInScope(ctx, req.branchId);

    const cancellationReason = reason?.trim() || 'ยกเลิกคำขอเบิกค่าใช้จ่าย';
    const startedAt = new Date();
    const intent = await this.repo.beginCancellationAtomic({
      companyId: ctx.companyId,
      requestId: id,
      expectedStatus: req.status,
      expectedUpdatedAt: req.updatedAt,
      actorUserId: ctx.userId,
      scopes: ctx.scopes ?? {},
      reason: cancellationReason,
      startedAt,
      onIntentPersisted: async (tx) => {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'reimbursement.request.cancellation_intent',
          targetType: 'reimbursement_request',
          targetId: id,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { reason: cancellationReason, projectionCleanupPending: true },
        }, tx);
        await tx.outboxEvent.createMany({
          data: [{
            companyId: ctx.companyId,
            eventType: 'reimbursement.cancellation_started',
            aggregateType: 'reimbursement_request',
            aggregateId: id,
            eventKey: `reimbursement.cancellation_started:reimbursement_request:${id}`,
            payloadJson: {
              companyId: ctx.companyId,
              actorUserId: ctx.userId,
              requestId: ctx.requestId,
              aggregateType: 'reimbursement_request',
              aggregateId: id,
              occurredAt: startedAt.toISOString(),
              data: { requestId: id, status: req.status, cancellation: 'PROJECTION_CLEANUP_PENDING' },
            },
            priority: 'NORMAL',
            status: 'PENDING',
          }],
          skipDuplicates: true,
        });
      },
    });

    const projections = await this.repo.listClaimProjections(ctx.companyId, id);
    for (const projection of projections) {
      await this.voidExpense.executeForReimbursement(ctx, projection.id, cancellationReason, {
        reimbursementRequestId: id,
        reimbursementLineId: projection.sourceReimbursementLineId,
        branchId: intent.request.branchId,
      });
    }

    const completedAt = new Date();
    const updated = await this.repo.completeCancellationAtomic({
      companyId: ctx.companyId,
      requestId: id,
      actorUserId: ctx.userId,
      scopes: ctx.scopes ?? {},
      completedAt,
      onCancelledPersisted: async (tx) => {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'reimbursement.request.cancel',
          targetType: 'reimbursement_request',
          targetId: id,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { reason: cancellationReason, projectionCount: projections.length },
        }, tx);
        await tx.outboxEvent.createMany({
          data: [{
            companyId: ctx.companyId,
            eventType: 'reimbursement.cancelled',
            aggregateType: 'reimbursement_request',
            aggregateId: id,
            eventKey: `reimbursement.cancelled:reimbursement_request:${id}`,
            payloadJson: {
              companyId: ctx.companyId,
              actorUserId: ctx.userId,
              requestId: ctx.requestId,
              aggregateType: 'reimbursement_request',
              aggregateId: id,
              occurredAt: completedAt.toISOString(),
              data: { requestId: id, status: 'CANCELLED' },
            },
            priority: 'NORMAL',
            status: 'PENDING',
          }],
          skipDuplicates: true,
        });
      },
    });
    return toRequestSummary(updated);
  }
}

export async function assertCanReadRequest(
  ctx: RequestContext,
  request: Pick<ReimbursementRequestRecord, 'id' | 'branchId' | 'requesterUserId'>,
  repo: PrismaReimbursementRepository,
): Promise<void> {
  assertReimbursementBranchInScope(ctx, request.branchId);
  if (ctx.permissions.includes('reimbursement.read')) return;
  if (ctx.permissions.includes('reimbursement.read_own') && request.requesterUserId === ctx.userId) return;
  if (ctx.permissions.includes('reimbursement.read_related')
    && await repo.isUserRelatedToRequest(ctx.companyId, request.id, ctx.userId, ctx.scopes ?? {})) return;
  throw new ForbiddenException('Cannot read this reimbursement');
}

// claimSignatureAckHash moved to ../../domain/logic/reimbursement.logic (pure record hash).

@Injectable()
export class ListReimbursementSourcesUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository) {}
  async execute(ctx: RequestContext, branchId?: string, requesterUserId = ctx.userId, search = '', expenseId?: string) {
    if (!ctx.permissions.some(permission => ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.finance_review'].includes(permission))) throw new ForbiddenException('Cannot select reimbursement sources');
    if (requesterUserId !== ctx.userId && !ctx.permissions.includes('reimbursement.finance_review')) throw new ForbiddenException('Cannot select sources for another member');
    assertReimbursementBranchInScope(ctx, branchId);
    const resolvedBranch = await this.repo.resolveCreateBranchId(ctx.companyId, ctx.scopes ?? {}, branchId);
    await this.repo.assertReimbursementRequester(ctx.companyId, resolvedBranch, requesterUserId);
    return {
      requesters: await this.repo.listReimbursementRequesters(ctx.companyId, resolvedBranch, ctx.permissions.includes('reimbursement.finance_review') ? undefined : ctx.userId),
      items: await this.repo.listReimbursementSources(ctx.companyId, resolvedBranch, requesterUserId, search.trim().slice(0, 100), expenseId),
    };
  }
}
