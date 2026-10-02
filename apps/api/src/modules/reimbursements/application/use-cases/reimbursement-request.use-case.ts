import { Injectable, ConflictException, ForbiddenException, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  CreateReimbursementRequestInput,
  UpdateReimbursementDraftInput,
  ListReimbursementsFilter,
  ReimbursementLineInput,
  ReimbursementHubBucket,
  ReimbursementHubSummary,
  PaginatedReimbursements,
  ReimbursementRequestSummary,
  ReimbursementRequestDetail,
  ReimbursementInternalNote,
  ReimbursementPendingCancellation,
  ReimbursementPayoutCorrectionActions,
  ReimbursementPayoutCorrectionEvent,
  ReimbursementPolicySnapshotV1,
  ReimbursementSourceSnapshot,
} from '@watchdog-bms/contracts';
import { REIMBURSEMENT_SEQUENCE_KEYS, isExpenseVoidReason, isReimbursementClaimApprover } from '@watchdog-bms/contracts';
import { PrismaReimbursementRepository, hubBucketOfStatus, type ReimbursementRequestGroup } from '../../infrastructure/prisma-reimbursement.repository';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { VoidExpenseUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import type { ExpenseVoidBlocker } from '../../../expenses/infrastructure/expense-void-blocker';
import { assertReimbursementBranchInScope } from './reimbursement-branch-scope';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type {
  ReimbursementDuplicateCandidateWriteData,
  ReimbursementLineRecord,
  ReimbursementLineWriteData,
  ReimbursementRequestRecord,
} from '../../domain/models/reimbursement.model';
import { toRequestSummary, toRequestDetail, detailUserIds, toSignedCopySummaries, detailWithFileNames, toPayoutSummary, toPayoutVersionSummary } from '../dto/reimbursement.mapper';
import { effectivePolicy, effectivePolicyForRequest } from '../../domain/reimbursement.constants';
import { approverModeForRole, ListReimbursementApproverOptionsUseCase } from './reimbursement-policy.use-case';
import { approvalDecisionActions, awaitingSystemOf } from './reimbursement-approval.use-case';
import { MemberPayoutAccountUseCase } from './reimbursement-payout.use-case';
import {
  defaultChangedSinceSubmit, hasPayoutSnapshot, mayTypePayoutAccountFor, payoutDefaultToken, payoutRevealGroup, payoutSubmitToken,
  type PayoutRevealGroup, type SubmitPayoutColumns,
} from '../../domain/logic/payout-destination.logic';
import { ReimbursementProjectionOrchestratorService } from '../services/reimbursement-projection-orchestrator.service';
import { lostWriteRace, ReimbursementProjectionReconcilerService } from '../services/reimbursement-projection-reconciler.service';
import {
  validateRequestFields,
  validateLines,
  requiresApproval,
  computeReceiptRequirement,
  isLineEvidenced,
  claimSnapshotFields,
  computeSnapshotHash,
  canTransition,
  deriveHeaderFromLines,
  byLineNo,
  scoreDuplicate,
  normalizeReason,
  normalizeReimbursementAmount,
  PAYMENT_RECORDING_STATUSES,
  paymentTurnUserIds,
  payoutCorrectionFacts,
  payoutCorrectionPhase,
  payoutCorrectionRoundStart,
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
    private readonly payouts: MemberPayoutAccountUseCase,
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
    // The account is the REQUESTER's, whoever prepares the claim. No choice sent = follow their default.
    const payout = input.payout ? await this.payouts.draftPayoutChange(ctx, requesterUserId, input.payout) : undefined;

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
    }, payout);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.create',
      targetType: 'reimbursement_request', targetId: created.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: {
        amount: created.amount, currency: created.currency, categoryKey: created.categoryKey, lineCount: input.lines.length,
        // The receiving choice and who typed an account. Nothing of the account itself.
        ...(payout && { payout: payout.audit }),
      },
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
    private readonly payouts: MemberPayoutAccountUseCase,
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
    const payout = input.payout ? await this.payouts.draftPayoutChange(ctx, req.requesterUserId, input.payout) : undefined;
    const updated = await this.repo.updateDraftRequest(ctx.companyId, id, req.updatedAt, data, lines, payout);
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.update_draft',
      targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
      // A change of where the money goes is on record: the choice and who typed an account, never the account.
      ...(payout && { metadataJson: { payout: payout.audit } }),
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
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    // The gate of the claim detail, ahead of every answer that depends on where the claim stands (final
    // review item 18): which refusal a finance reviewer got below said whether the claim waits for approval.
    await assertCanReadRequestOrAssignment(ctx, req, this.repo);

    const isOwner = req.requesterUserId === ctx.userId;
    const withdraw = req.status === 'PENDING_APPROVAL';
    // Withdrawing is the requester's own act; finance's wider reach covers reopening a refusal only.
    const canReopen = (isOwner && ctx.permissions.includes('reimbursement.update_own_draft'))
      || (!withdraw && ctx.permissions.includes('reimbursement.finance_review'));
    if (!canReopen) throw new ForbiddenException('Cannot reopen this reimbursement');
    if ((req.status !== 'REJECTED' && !withdraw) || !canTransition(req.status, 'DRAFT')) {
      throw new UnprocessableEntityException(`Cannot reopen from status ${req.status}`);
    }
    // A claim sent back to have its payout account corrected was approved and has its expense records:
    // only its account changes, so it never returns to a draft (payout spec §14.7). The repository
    // refuses the same under the claim's lock, and any claim whose expense records still stand.
    if (payoutCorrectionPhase(req)) throw new ConflictException('payout_correction_in_progress');

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
    // re-reads the claim after every action, like `approvalActions`. Whoever's turn it is to pay comes
    // first when they can (owner rule 2026-10-01), as the ready-to-pay notice went to them first.
    const payers = detail.currentDesk?.kind === 'PAYMENT' && req.branchId && PAYMENT_RECORDING_STATUSES.includes(req.status)
      ? await this.repo.listPaymentRecorderNames(ctx.companyId, req.branchId, paymentTurnUserIds(req)) : undefined;
    // A draft with no method of its own shows the requester's default account it would be sent with.
    // This read is the only one, and only for a draft: a sent claim shows its own frozen snapshot.
    const draftDefault = req.status === 'DRAFT' && !req.payoutMethod ? await this.repo.findDraftDefaultPayout(req) : undefined;
    const payout = detail.payout ?? toPayoutSummary(
      draftDefault,
      draftDefault?.enteredByUserId ? await this.repo.getUserDisplayNames(ctx.companyId, [draftDefault.enteredByUserId]) : {},
    );
    // What "ส่งอนุมัติ" would freeze right now. The page sends this back with the submit, and a
    // submit whose own answer differs is refused: nobody sends a claim to an account they did not see.
    const submitToken = req.status === 'DRAFT' ? payoutSubmitToken(req.id, await this.repo.planSubmitPayout(req)) : undefined;
    // Payout spec §22: the requester changed their default after sending this claim. The claim keeps
    // what it froze, and the requester alone is told, from fingerprints that stay on the server.
    const defaultAccountChanged = req.requesterUserId === ctx.userId && detail.payout?.source === 'DEFAULT_ACCOUNT'
      && defaultChangedSinceSubmit(req, detail.payout.source, await this.repo.findMemberPayoutAccount(ctx.companyId, req.requesterUserId));
    // Audit B3: a cancellation that was started and has not completed appeared in no response.
    const pendingCancellation = await pendingCancellationOf(ctx, req, this.repo);
    // Audit B4: a claim that was decided and has not moved on said nothing of it either.
    const awaitingSystem = await awaitingSystemOf(ctx, req, this.repo);
    // Spec §15: a legacy claim froze no account, so whoever may record its payment is shown the
    // requester's default account as it is now, with the token a confirmation of it sends back.
    // Present exactly when the reveal endpoint would answer this viewer for that account.
    const legacyPayoutDefault = await legacyPayoutPayer(ctx, req, this.repo) ? await this.repo.findLegacyPayoutDefault(req) : null;
    // Spec §17.2: the accounts this claim has been sent with, masked like the current one. Only a claim
    // that has a number was ever sent, so a first draft costs no read.
    const payoutVersions = req.requestNo ? await this.repo.listClaimPayoutVersions(req) : [];
    const payoutVersionNames = payoutVersions.length > 0 ? await this.repo.getUserDisplayNames(ctx.companyId,
      payoutVersions.flatMap((version) => [version.enteredByUserId ?? '', version.verifiedByUserId ?? ''])) : {};
    // Payout spec §14: whether this viewer may send the claim back for its account, or give that
    // account, as the two endpoints decide it; and what the claim's rounds were, for its timeline.
    const payoutCorrectionActions = await payoutCorrectionActionsOf(ctx, req, this.repo, approvalActions);
    const payoutCorrectionHistory = await payoutCorrectionHistoryOf(req, this.repo);
    return {
      ...detail,
      ...(pendingCancellation && { pendingCancellation }),
      ...(awaitingSystem && { awaitingSystem }),
      ...(payoutCorrectionActions && { payoutCorrectionActions }),
      ...(payoutCorrectionHistory && { payoutCorrectionHistory }),
      // The button is offered exactly when the reveal endpoint would answer.
      ...(payout && { payout: {
        ...payout, ...(submitToken && { submitToken }), ...(defaultAccountChanged && { defaultAccountChanged: true as const }),
        canRevealAccountNumber: await claimPayoutRevealGroup(ctx, req, this.repo, approvalActions) !== null,
      } }),
      ...(legacyPayoutDefault && { legacyPayoutDefault }),
      ...(payoutVersions.length > 0 && { payoutHistory: payoutVersions.map((version) => toPayoutVersionSummary(version, payoutVersionNames)) }),
      approvalActions,
      // Two names, then a count: the page says "อยู่ที่ … หรือ … และอีก N คน" in its header, its step note and its timeline.
      ...(payers && { paymentDesk: { names: payers.slice(0, 2), moreCount: Math.max(payers.length - 2, 0) } }),
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
    if (!(error instanceof ForbiddenException)) throw error;
    // A frozen assignment permits this exact claim even after a role change. It still does while the claim
    // is being cancelled: the step is theirs to read, though nothing can be decided on it meanwhile.
    const held = req.cancellationPendingAt
      ? await approvalDecisionActions(ctx, { ...req, cancellationPendingAt: undefined }, repo)
      : approvalActions;
    if (!held.canApprove && !held.canReject) throw error;
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

/** The hub's buckets by name. Typed over every bucket, so one added later has to be named here to be asked for. */
const HUB_BUCKETS: readonly string[] = Object.keys({ draft: true, review: true, payment: true, paid: true, closed: true } satisfies Record<ReimbursementHubBucket, true>);

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
    // Only a bucket the hub has. The name came straight from the query string: `all` answered no rows under the
    // whole scope's total, and a name every object carries (`constructor`) answered with no total at all.
    if (filter.bucket !== undefined && !HUB_BUCKETS.includes(filter.bucket)) throw new BadRequestException('reimbursement_list_bucket_invalid');

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
      // The hub's search box. The counts below are of the same searched list, so a card still counts its rows.
      search: filter.search?.trim().slice(0, 100) || undefined,
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
      total: hub.counts[filter.bucket ?? 'all'],
      page,
      pageSize,
      hub,
      // The one fact of the policy the hub needs from here: a finance reviewer who may not read the
      // policy (an accountant) named the third tab "คิวการเงิน" in a company with no finance step.
      financeReviewRequired: policy.financeReviewRequired,
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

  /** `payoutSubmitToken`: the `payout.submitToken` of the detail the submitter was looking at. */
  async execute(ctx: RequestContext, id: string, input?: { payoutSubmitToken?: unknown } | null): Promise<ReimbursementRequestDetail> {
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
    // Payout gate: a claim is sent with a receiving method, and a transfer with a complete account.
    // A draft that names none follows the requester's default; nothing is picked for a requester who
    // has not chosen, so a claim meant for a transfer is never sent as cash. All of it — what is
    // frozen, its fingerprint and version, and the hash that binds them — is decided inside the
    // submit transaction, which asks this for the hash once the payout columns are known.
    const snapshotHash = (payoutColumns: SubmitPayoutColumns) =>
      computeSnapshotHash(claimSnapshotFields({ ...req, lines, ...payoutColumns }, policySnapshot));

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
      } }),
      // The claim's own copy is frozen in this transaction; from here on nothing reads the default.
      payout: { actorUserId: ctx.userId, frozenAt: now, seenToken: input?.payoutSubmitToken, snapshotHash },
      request: {
        status: initialStatus,
        submittedAt: now,
        submittedByUserId: ctx.userId,
        currentApproverUserId: humanApprovalRequired ? approverUserId : null,
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
            // Which snapshot was frozen. Version and origin only: no account detail belongs here.
            payout: { method: persisted.payout!.plan.payoutMethod, version: persisted.payout!.columns.payoutDestinationVersion, followsDefault: persisted.payout!.plan.followsDefault },
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

/** The right to cancel this claim: its requester with the cancel right, or a finance reviewer. */
function holdsCancelRight(ctx: RequestContext, req: Pick<ReimbursementRequestRecord, 'requesterUserId'>): boolean {
  return (req.requesterUserId === ctx.userId && ctx.permissions.includes('reimbursement.cancel_own'))
    || ctx.permissions.includes('reimbursement.finance_review');
}

/**
 * Whether the cancel endpoints take this viewer for this claim. The claim detail reads the same
 * answer for its "ดำเนินการยกเลิกต่อ" and withdraw buttons, so a button is never offered to someone
 * the endpoint refuses.
 */
export function mayCancelReimbursement(ctx: RequestContext, req: Pick<ReimbursementRequestRecord, 'requesterUserId' | 'branchId' | 'status'>): boolean {
  return holdsCancelRight(ctx, req) && canTransition(req.status, 'CANCELLED') && isBranchInScope(ctx.scopes ?? {}, req.branchId);
}

/**
 * The reason a cancellation runs with. A started one keeps the reason on record, so a retry names
 * the same reason or none. Only when the stored reason is one the expense void refuses does the
 * retry carry the corrected reason (audit B3: such a claim could never be cancelled).
 */
function cancellationReasonFor(req: ReimbursementRequestRecord, supplied?: string): string {
  const given = supplied?.trim();
  if (req.cancellationPendingAt && isExpenseVoidReason(req.cancellationPendingReason)) {
    if (given && given !== req.cancellationPendingReason) throw new ConflictException('reimbursement_cancellation_already_pending');
    return req.cancellationPendingReason!;
  }
  const reason = given || (req.cancellationPendingAt ? '' : 'ยกเลิกคำขอเบิกค่าใช้จ่าย');
  // Voiding the claim's expense records takes this reason and refuses a short one. Asked before the
  // intent is written: a claim never holds a cancellation its own reason stops.
  if (!isExpenseVoidReason(reason)) throw new BadRequestException('cancellation_reason_too_short');
  return reason;
}

/** `code` or `code:periodKey`: the shape the web translates by its prefix, like the payment's closed period. */
function cancellationBlockedError(blocker: ExpenseVoidBlocker): ConflictException {
  return new ConflictException(`reimbursement_cancellation_${blocker.code}${'periodKey' in blocker ? `:${blocker.periodKey}` : ''}`);
}

/**
 * A cancellation that was started and has not completed, as the claim detail reports it: who
 * started it, when, why it has not completed and what this viewer may do about it. Computed on
 * every read, so it says what stands in the way now.
 */
export async function pendingCancellationOf(
  ctx: RequestContext,
  req: ReimbursementRequestRecord,
  repo: PrismaReimbursementRepository,
): Promise<ReimbursementPendingCancellation | undefined> {
  if (!req.cancellationPendingAt || req.status === 'CANCELLED' || req.status === 'VOIDED') return undefined;
  const reasonBlocks = !isExpenseVoidReason(req.cancellationPendingReason);
  const [blocker, projections, names] = await Promise.all([
    reasonBlocks ? null : repo.findCancellationBlocker(req),
    repo.listClaimProjections(req.companyId, req.id),
    repo.getUserDisplayNames(req.companyId, req.cancellationPendingByUserId ? [req.cancellationPendingByUserId] : []),
  ]);
  const mayCancel = mayCancelReimbursement(ctx, req);
  const startedByName = req.cancellationPendingByUserId ? names[req.cancellationPendingByUserId] : undefined;
  return {
    startedAt: req.cancellationPendingAt.toISOString(),
    ...(req.cancellationPendingByUserId && { startedByUserId: req.cancellationPendingByUserId }),
    ...(startedByName && { startedByName }),
    reason: req.cancellationPendingReason ?? '',
    ...(reasonBlocks ? { blocker: { code: 'reason_too_short' as const } } : blocker ? { blocker } : {}),
    canResume: mayCancel,
    // Once an expense record is voided the claim cannot go on as before; the cancellation is finished instead.
    canWithdraw: mayCancel && !projections.some((projection) => projection.status === 'VOIDED'),
  };
}

@Injectable()
export class CancelReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly voidExpense: VoidExpenseUseCase,
  ) {}

  /**
   * Cancels a claim, or continues a cancellation that was started and has not completed
   * ("ดำเนินการยกเลิกต่อ"), for whoever may cancel the claim. Two phases, because voiding the
   * claim's expense records cannot share a transaction with the claim: the intent is committed, the
   * records are voided, then the claim closes. Everything known to stop a void is asked before the
   * intent; what cannot be known then leaves a cancellation the claim detail shows and this same
   * call finishes.
   */
  async execute(ctx: RequestContext, id: string, reason?: string): Promise<ReimbursementRequestSummary> {
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    // The gate of the claim detail, ahead of every answer that depends on where the claim stands (final
    // review item 18): "Cannot cancel from status …" was said before the branch was looked at.
    await assertCanReadRequestOrAssignment(ctx, req, this.repo);

    if (!holdsCancelRight(ctx, req)) throw new ForbiddenException('Cannot cancel this reimbursement');
    if (!canTransition(req.status, 'CANCELLED')) throw new UnprocessableEntityException(`Cannot cancel from status ${req.status}`);

    const cancellationReason = cancellationReasonFor(req, reason);
    // A closed accounting period, a locked tax period, an expense record no void takes: refused here,
    // while nothing has been written. Asked again on a retry, so a blocked cancellation is not half voided.
    const blocker = await this.repo.findCancellationBlocker(req);
    if (blocker) throw cancellationBlockedError(blocker);

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
      onReasonCorrected: async (tx, previousReason) => {
        await this.audit.log({
          companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.cancellation_reason_corrected',
          targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
          metadataJson: { previousReason, reason: cancellationReason, startedByUserId: req.cancellationPendingByUserId },
        }, tx);
      },
    });
    if (intent.resumed) {
      // The retry gets its own audit row, so a second attempt (and who made it) is not invisible.
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.cancellation_retry',
        targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { startedByUserId: intent.request.cancellationPendingByUserId },
      });
    }

    try {
      return toRequestSummary(await this.voidAndClose(ctx, intent.request, cancellationReason));
    } catch (error) {
      const latest = await this.repo.findRequestById(ctx.companyId, id);
      // Someone else (a second press, another canceller, the scheduled reconciler) finished the same
      // cancellation meanwhile: the claim is cancelled, which is what was asked.
      if (latest?.status === 'CANCELLED') return toRequestSummary(latest);
      if (!lostWriteRace(error)) throw error;
      // This attempt lost to another party on the same cancellation, and nothing of it was kept: the
      // cancellation was withdrawn, or is being finished right now. Said as that, not as a server error.
      throw new ConflictException(latest?.cancellationPendingAt ? 'reimbursement_cancellation_in_progress' : 'reimbursement_cancellation_intent_changed');
    }
  }

  /** Voids every expense record of the claim, then closes the claim. Each step is a no-op when already done. */
  private async voidAndClose(ctx: RequestContext, request: ReimbursementRequestRecord, cancellationReason: string): Promise<ReimbursementRequestRecord> {
    const id = request.id;
    const projections = await this.repo.listClaimProjections(ctx.companyId, id);
    for (const projection of projections) {
      await this.voidExpense.executeForReimbursement(ctx, projection.id, cancellationReason, {
        reimbursementRequestId: id,
        reimbursementLineId: projection.sourceReimbursementLineId,
        branchId: request.branchId,
        // Each void goes ahead only while this claim still holds its cancellation (it may be withdrawn meanwhile).
        beforeVoid: (tx) => this.repo.assertCancellationPending(tx, ctx.companyId, id),
      });
    }

    const completedAt = new Date();
    return this.repo.completeCancellationAtomic({
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
          metadataJson: { reason: cancellationReason, projectionCount: projections.length, startedByUserId: request.cancellationPendingByUserId },
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
  }
}

/**
 * Takes back a cancellation that was started and has not completed, so the claim goes on as before:
 * for whoever may cancel the claim, and only while none of its expense records has been voided.
 */
@Injectable()
export class WithdrawReimbursementCancellationUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<ReimbursementRequestSummary> {
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    // The gate of the claim detail, branch scope included, ahead of everything else about the claim.
    await assertCanReadRequestOrAssignment(ctx, req, this.repo);
    if (!holdsCancelRight(ctx, req)) throw new ForbiddenException('Cannot cancel this reimbursement');

    const updated = await this.repo.withdrawCancellationAtomic({
      companyId: ctx.companyId,
      requestId: id,
      actorUserId: ctx.userId,
      scopes: ctx.scopes ?? {},
      onWithdrawnPersisted: async (tx, withdrawn) => {
        await this.audit.log({
          companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.cancellation_withdrawn',
          targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
          metadataJson: { reason: withdrawn.reason, startedByUserId: withdrawn.startedByUserId, startedAt: withdrawn.startedAt.toISOString(), status: req.status },
        }, tx);
      },
    });
    return toRequestSummary(updated);
  }
}

/**
 * "ดำเนินการต่อ" (audit B4): has the system carry out now the decision a claim already holds. Nothing
 * is decided here, so nothing is attested again, and what was approved is carried out only while
 * the claim is still what was approved. The scheduled run does the same for every such claim; this
 * is that step for one claim, asked for by a person the claim detail offered it to.
 */
@Injectable()
export class ResumeReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly reconciler: ReimbursementProjectionReconcilerService,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<ReimbursementRequestDetail> {
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    // The gate of the claim detail, ahead of every answer that depends on where the claim stands (final
    // review item 18): which refusal came back said whether a decision on the claim waits for the system.
    await assertCanReadRequestOrAssignment(ctx, req, this.repo);
    const waiting = await awaitingSystemOf(ctx, req, this.repo);
    if (!waiting) {
      // Nothing waits any more (pressed twice, or the scheduled run got there first). That is what
      // was asked for, so the answer is the claim as it stands.
      return detailWithFileNames(this.repo, this.evidence, ctx.companyId, req, ctx);
    }
    if (!waiting.canResume) throw new ForbiddenException('reimbursement_resume_not_allowed');
    if (await this.reconciler.repair(ctx.companyId, id)) {
      // The repair's own audit row is the system's; this one names the person who asked for it.
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.projection.resume',
        targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { requestNo: req.requestNo, waitingFor: waiting.kind },
      });
    }
    const latest = await this.repo.findRequestById(ctx.companyId, id, true);
    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, latest ?? req, ctx);
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

/**
 * Which reveal group this viewer is in for this claim, or null. Gathers the facts for
 * `payoutRevealGroup`; the detail's `canRevealAccountNumber` flag and the reveal endpoint both call this, so the
 * two can never disagree. Needs the claim loaded with its approval steps.
 */
export async function claimPayoutRevealGroup(
  ctx: RequestContext,
  request: ReimbursementRequestRecord,
  repo: PrismaReimbursementRepository,
  approvalActions?: { canApprove: boolean; canReject: boolean },
): Promise<PayoutRevealGroup | null> {
  const isRequester = request.requesterUserId === ctx.userId;
  const isDraft = request.status === 'DRAFT';
  // A draft's own account, or the snapshot a sent claim froze. A legacy claim has neither.
  const hasClaimAccount = request.payoutMethod === 'BANK_TRANSFER' && request.payoutDestinationVersion != null
    && (isDraft || hasPayoutSnapshot(request));
  if (!hasClaimAccount) return null;
  // The number is never easier to reach than the claim it belongs to: every group, the requester
  // included, passes the gate the claim detail itself has (`assertCanReadRequestOrAssignment`):
  // the claim's branch and a way to read it, or the pending step being theirs to decide. An approver
  // of the current round who has since lost every way to read the claim is refused the detail, the
  // slip and, here, the number.
  const actions = approvalActions ?? await approvalDecisionActions(ctx, request, repo);
  const canRead = await assertCanReadRequest(ctx, request, repo).then(() => true, () => false);
  if (!canRead && !actions.canApprove && !actions.canReject) return null;
  return payoutRevealGroup({
    hasClaimAccount, isDraft, isRequester,
    canRecordPayment: canRead && ctx.permissions.includes('reimbursement.payment.record'),
    // The approver this claim was sent to (pending step) or who approved it in this round — not
    // every holder of the approval permission. The same two facts, from the same resolver and the
    // same contracts rule, that `isReimbursementPayoutParty` reads for the payment slip: the reveal,
    // the detail's flag and the slip cannot name different people as the claim's approver.
    isClaimApprover: actions.canApprove || actions.canReject
      || isReimbursementClaimApprover(ctx.userId, { submittedAt: request.submittedAt, approvalSteps: request.approvalSteps }),
  });
}

// ---- Payout account correction round (payout spec §14): who may do what ----

/**
 * Who a viewer is to a claim that waits for payment, for sending it back (§14.3): whoever may record
 * its payment, the approver the claim stands on (also without the pay right), or its requester asking
 * for their own account to be changed. Nobody else. The claim's branch is theirs to act in, as for
 * every other decision on a claim.
 */
export function payoutCorrectionSender(ctx: RequestContext, req: ReimbursementRequestRecord): 'PAYER' | 'APPROVER' | 'REQUESTER' | null {
  if (!isBranchInScope(ctx.scopes ?? {}, req.branchId)) return null;
  if (ctx.permissions.includes('reimbursement.payment.record')) return 'PAYER';
  if (isReimbursementClaimApprover(ctx.userId, { submittedAt: req.submittedAt, approvalSteps: req.approvalSteps })) return 'APPROVER';
  return req.requesterUserId === ctx.userId && ctx.permissions.includes('reimbursement.update_own_draft') ? 'REQUESTER' : null;
}

/** Whether the viewer may give the account of a claim in a round (§14.5): its requester, or a finance reviewer on their behalf, as for a draft. */
export function mayGivePayoutAccount(ctx: RequestContext, req: ReimbursementRequestRecord): boolean {
  return isBranchInScope(ctx.scopes ?? {}, req.branchId)
    && ((req.requesterUserId === ctx.userId && ctx.permissions.includes('reimbursement.update_own_draft'))
      || ctx.permissions.includes('reimbursement.finance_review'));
}

/**
 * What this viewer may do about the payout account of an approved claim, as the claim detail reports
 * it. The two endpoints decide by the same functions, so a button is never offered to someone its
 * endpoint refuses, nor withheld from someone it takes. Needs the claim loaded with its approval steps
 * and payments, and the viewer's authority over the step it waits on.
 */
export async function payoutCorrectionActionsOf(
  ctx: RequestContext,
  req: ReimbursementRequestRecord,
  repo: PrismaReimbursementRepository,
  approvalActions: { canApprove: boolean; canReject: boolean },
): Promise<ReimbursementPayoutCorrectionActions | undefined> {
  const phase = payoutCorrectionPhase(req);
  // Nothing is decided on a claim being cancelled, and only a claim at the pay step or in a round has either action.
  if (req.cancellationPendingAt || (!phase && req.status !== 'READY_FOR_PAYMENT')) return undefined;
  const canRequest = phase === 'AWAITING_APPROVAL' ? approvalActions.canReject
    : !phase && !(req.payments ?? []).some((payment) => payment.status === 'RECORDED') && payoutCorrectionSender(ctx, req) !== null;
  const canSubmit = !!phase && mayGivePayoutAccount(ctx, req);
  if (!canRequest && !canSubmit) return undefined;
  // What "use the default account" would copy, for whoever fills the form: the requester's default as it is now.
  const account = canSubmit ? await repo.findMemberPayoutAccount(req.companyId, req.requesterUserId) : null;
  const token = payoutDefaultToken(req.id, account);
  // Typing an account for someone else needs a requester a notice can reach: the write's own rule
  // (`draftPayoutChange`), asked here so the form says it before anyone types.
  const typingRefused = canSubmit && req.requesterUserId !== ctx.userId
    && !mayTypePayoutAccountFor(await repo.findPayoutMember(req.companyId, req.requesterUserId));
  return {
    canRequest,
    canSubmit,
    ...(account && token && { requesterDefault: {
      payoutMethod: account.payoutMethod,
      ...(account.payoutKind && { payoutKind: account.payoutKind }),
      ...(account.bankName && { bankName: account.bankName }),
      ...(account.accountName && { accountName: account.accountName }),
      ...(account.accountLast4 && { accountLast4: account.accountLast4 }),
      token,
    } }),
    // The choices the account endpoint takes from this viewer, each by the rule that would refuse it there:
    // the default needs one to use, typing needs a requester who is told, and "the account the claim had"
    // needs the claim to have had one (`freezePayoutCorrection`). Cash is always taken.
    ...(canSubmit && {
      submitModes: [
        ...(account && token ? ['DEFAULT' as const] : []),
        ...(typingRefused ? [] : ['SPECIFIED' as const]),
        'CASH' as const,
        ...(payoutCorrectionRoundStart(req)?.payoutMethod ? ['PREVIOUS' as const] : []),
      ],
      ...(typingRefused && { specifiedRefusal: 'REQUESTER_NOT_ACTIVE' as const }),
    }),
  };
}

/** The claim's rounds as its timeline reads them (spec §17.2), oldest first, with the people named. Undefined: it was never in one. */
export async function payoutCorrectionHistoryOf(
  req: ReimbursementRequestRecord,
  repo: PrismaReimbursementRepository,
): Promise<ReimbursementPayoutCorrectionEvent[] | undefined> {
  const log = req.payoutCorrectionLog ?? [];
  if (log.length === 0) return undefined;
  const names = await repo.getUserDisplayNames(req.companyId, log.map((entry) => entry.byUserId));
  // What the words of each row are chosen from (payout spec §14.2): what the claim held at a send-back, what
  // an answer gave, and whether someone gave it on the requester's behalf. The one reading of the log, so a
  // row never reads its case off a reason code, nor says the requester did what someone else did for them.
  const facts = payoutCorrectionFacts(log, req.requesterUserId);
  // `approved` is what the round started from: the detail says it once, as `payoutCorrection.previous`. Whether
  // an answer was the same destination is in its `answer`.
  return log.map(({ approved: _approved, sameAsApproved: _same, ...entry }, index) => ({
    ...entry, ...facts[index], ...(names[entry.byUserId] && { byName: names[entry.byUserId] }),
  }));
}

/**
 * Whether this viewer is shown, and may reveal, the requester's CURRENT default account on a legacy
 * claim (payout spec §15). A claim sent before claims carried an account froze none, so the payer has
 * nothing else to transfer into. Only whoever the payment endpoint would accept the payment from,
 * and only while it would take one: the pay right, the claim's branch, a way to read the claim, and
 * a claim that can be paid. Nobody else has a use for a member's default on someone's claim. The
 * detail's `legacyPayoutDefault` block and the reveal endpoint both ask this, so they cannot disagree.
 */
export async function legacyPayoutPayer(
  ctx: RequestContext,
  request: ReimbursementRequestRecord,
  repo: PrismaReimbursementRepository,
): Promise<boolean> {
  return request.status !== 'DRAFT' && !hasPayoutSnapshot(request)
    && !!request.branchId && PAYMENT_RECORDING_STATUSES.includes(request.status)
    && ctx.permissions.includes('reimbursement.payment.record')
    && await assertCanReadRequest(ctx, request, repo).then(() => true, () => false);
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
