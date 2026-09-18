/**
 * Capture group — handoff: an accepted allocation becomes ordinary expenses (appendix §9, W05).
 *
 * This is the one place in the feature where the capture aggregate turns into documents the rest
 * of the product treats as money. Four properties hold it together:
 *
 *  1. ONE BATCH. `handoffBatchKey = <groupId>:<allocationId>` is unique company-wide, and
 *     `(companyId, captureGroupId, captureScopeKey)` is unique per scope. Two tabs, two users or a
 *     lost response therefore produce one batch and one set of expenses (A10) — the group lock
 *     serialises the normal case, the indexes are what make the claim true.
 *  2. SINGLE USE. A handoff may only rewrite or release sources nothing has used: no payment, no
 *     posting, no live claim, no certificate ≥ PREPARED, and a status still in the open three.
 *     Anything else answers 409 `expense_capture_handoff_consumed` and names the expense to go and
 *     correct (A11/A44).
 *  3. NO INVENTED MONEY. Every amount is copied from the accepted snapshot, and the totals identity
 *     is re-proved on the rows about to be written before a single one is (§5.1).
 *  4. LOCK ORDER (§2.4): `reimbursement-evidence:*` (every file and every expense that shares one)
 *     → `expense-capture:<group>` → each expense's own `substitute-receipt` key, taken by
 *     `updateExpense`/`upsertLines`. Reversing the first two is the deadlock the pg spec exists for.
 */
import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  EXPENSE_CAPTURE_ALLOCATION_POLICY,
  EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION,
  type CaptureAllocationResult,
  type CaptureAllocationScope,
  type CaptureFactsView,
  type CaptureHandoffExpenseDto,
  type CaptureHandoffResultDto,
  type RequestContext,
} from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { computeCaptureAllocation } from '../../domain/logic/expense-capture-allocation.logic';
import { assembleCaptureFacts } from '../../domain/logic/expense-capture-facts.logic';
import {
  CaptureHandoffError,
  buildDerivedSourceDraft,
  captureAutoHandoffBatchKey,
  captureAutoHandoffEligibility,
  captureHandoffBatchKey,
  expenseWebPath,
  scopeDocuments,
  type CaptureAutoHandoffSkip,
  type CaptureHandoffContext,
  type DerivedSourceDraft,
} from '../../domain/logic/expense-capture-handoff.logic';
import { PrismaExpenseCaptureRepository, type CaptureDb, type CaptureGroupRow } from '../../infrastructure/prisma-expense-capture.repository';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { lockFundingEvidence } from '../../infrastructure/substitute-funding.guard';
import { ExpenseCaptureAccessService } from './expense-capture-group.use-case';

const conflict = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ code, message, ...extra });

const revisionConflict = () => conflict(
  'expense_capture_group_revision_conflict',
  'งานรับหลักฐานนี้เปลี่ยนไปแล้ว กรุณาเปิดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง',
);

const notCurrent = () => conflict(
  'expense_capture_allocation_not_current',
  'การจัดส่วนนี้ไม่ใช่ฉบับที่ยอมรับไว้แล้ว กรุณาตรวจส่วนของบริษัทอีกครั้ง',
);

/** §6: bringing evidence in, or reviewing it. A handoff performs no financial finalisation. */
const HANDOFF_CREATE_PERMISSIONS = ['expense.create', 'expense.receipt.upload'];

type DerivedRow = Awaited<ReturnType<PrismaExpenseCaptureRepository['listDerivedSourceStates']>>[number];
type StoredFile = Awaited<ReturnType<PrismaExpenseCaptureRepository['listStoredFiles']>>[number];

type BatchWrite = {
  revision: number;
  expenses: CaptureHandoffExpenseDto[];
  releasedExpenseIds: string[];
  rewrittenExpenseIds: string[];
};

@Injectable()
export class HandoffExpenseCaptureGroupUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly expenses: PrismaExpenseRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  /**
   * `POST /v1/companies/{c}/expenses/capture-groups/{g}/handoff`.
   *
   * `idempotencyKey` is accepted and shape-checked but not stored: the batch key already IS the
   * identity of this intent. Two calls naming the same `(group, allocation)` are the same handoff
   * whatever key they carry, and a call naming a DIFFERENT allocation is a regenerate, which has
   * its own rules. Appendix §18 records the equivalence, which is why no column was added.
   */
  async execute(ctx: RequestContext, groupId: string, cmd: {
    allocationId: string; expectedRevision: number; idempotencyKey?: string;
  }): Promise<CaptureHandoffResultDto> {
    if (!Number.isSafeInteger(cmd.expectedRevision) || cmd.expectedRevision < 1) {
      throw new BadRequestException('expectedRevision must be the revision you last read.');
    }
    const group = await this.access.load(ctx, groupId);
    if (!this.canHandoff(ctx, group)) throw new ForbiddenException('Missing permission: expense.create');

    type Outcome = { replay: CaptureHandoffResultDto } | { created: CaptureHandoffResultDto };
    const outcome = await this.capture.transaction<Outcome>(async (tx) => {
      const files = await this.capture.listStoredFiles(tx, ctx.companyId, groupId);
      // Read before locking only to know WHICH keys to take; the authoritative state is re-read
      // under the lock below. The expansion inside `lockFundingEvidence` also pulls in every
      // expense outside this group that shares one of these files (A09/A16).
      const seen = await this.capture.listDerivedSourceStates(tx, ctx.companyId, groupId);
      await lockFundingEvidence(tx, ctx.companyId, {
        attachmentIds: files.map((file) => file.attachmentId),
        expenseIds: seen.map((row) => row.id),
      });
      await this.capture.lockGroup(tx, ctx.companyId, groupId);

      const current = await this.capture.findGroup(tx, ctx.companyId, groupId);
      if (!current) throw new NotFoundException('Capture group not found');
      const batchKey = captureHandoffBatchKey(groupId, cmd.allocationId);
      const existing = await this.capture.listDerivedSourceStates(tx, ctx.companyId, groupId);

      // A10/A84: the lost response. The winner already wrote this exact batch, so answer with it
      // instead of a conflict — the caller cannot tell the two attempts apart, and neither should.
      if (current.handoffBatchKey === batchKey && current.handoffState === 'ACTIVE') {
        return { replay: this.replay(ctx, current, batchKey, existing) };
      }
      if (current.status === 'CLOSED_NO_HANDOFF' || current.status === 'CANCELLED') {
        throw conflict('expense_capture_group_closed', 'งานรับหลักฐานนี้ปิดแล้ว ไม่สามารถสร้างรายการค่าใช้จ่ายได้');
      }
      if (current.revision !== cmd.expectedRevision) throw revisionConflict();

      const allocation = await this.capture.findAcceptedAllocation(tx, ctx.companyId, groupId, cmd.allocationId);
      if (!allocation || current.acceptedAllocationId !== cmd.allocationId) throw notCurrent();
      // Accepting bumps the revision the allocation was computed against, so "nothing has happened
      // since the acceptance" is exactly one step. A file added or detached afterwards moves it
      // further, and the group has to be reviewed again against the evidence it now holds.
      if (current.revision !== allocation.groupRevision + 1) {
        throw conflict('expense_capture_allocation_stale', 'ข้อมูลของงานนี้เปลี่ยนหลังยอมรับการจัดส่วน กรุณาตรวจส่วนของบริษัทอีกครั้ง');
      }
      const result = allocation.resultJson as CaptureAllocationResult | null;
      if (result?.outcome !== 'READY') this.refuseOutcome(result);

      // Everything this group already produced — a §3.1 converted expense or a previous batch —
      // is about to be rewritten or released, so all of it must still be unused (§9, A11/A44).
      if (existing.length > 0) await this.assertReleasable(tx, ctx, groupId);

      const facts = assembleCaptureFacts(await this.capture.listObservations(tx, ctx.companyId, groupId));
      const written = await this.writeBatch(tx, ctx, current, {
        companyId: ctx.companyId, branchId: current.branchId, groupId,
        allocationId: cmd.allocationId, intakeChannel: current.intakeChannel,
        lineChatKeyHash: current.lineChatKeyHash,
        fundingRoute: allocation.fundingRoute, payerUserId: allocation.payerUserId,
        actorUserId: ctx.userId, policyVersion: allocation.policyVersion, summary: result.summary,
      }, result.scopes, facts, existing, files, batchKey);

      const regenerated = current.handoffState !== 'NONE';
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: regenerated ? AuditAction.EXPENSE_CAPTURE_HANDOFF_REGENERATE : AuditAction.EXPENSE_CAPTURE_HANDOFF_CREATE,
        targetType: 'expense_capture_group', targetId: groupId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          handoffBatchKey: batchKey, allocationId: cmd.allocationId, revision: written.revision,
          fundingRoute: allocation.fundingRoute, payerUserId: allocation.payerUserId,
          expenseIds: written.expenses.map((expense) => expense.expenseId),
          scopeKeys: written.expenses.map((expense) => expense.scopeKey),
          // Strings: an audit row is read by a person, and a float would re-round the satang.
          companyAmount: result.summary.companyAmount, personalAmount: result.summary.personalAmount,
          paidTotal: result.summary.paidTotal,
          releasedExpenseIds: written.releasedExpenseIds, rewrittenExpenseIds: written.rewrittenExpenseIds,
        },
      }, tx);

      return {
        created: {
          handoffBatchKey: batchKey, groupStatus: 'HANDED_OFF' as const, revision: written.revision,
          regenerated, replayed: false, expenses: written.expenses,
        },
      };
    });

    if ('replay' in outcome) return outcome.replay;
    // After the commit: `OutboxAppendService` writes on its own client, so appending inside the
    // transaction would publish an event for work that could still roll back. Ids only.
    void this.outbox.append('expense.capture_handoff.created', 'expense_capture_group', groupId, {
      companyId: ctx.companyId, aggregateType: 'expense_capture_group', aggregateId: groupId,
      requestId: outcome.created.handoffBatchKey, occurredAt: new Date().toISOString(), actorUserId: ctx.userId,
      data: {
        captureGroupId: groupId, allocationId: cmd.allocationId,
        handoffBatchKey: outcome.created.handoffBatchKey,
        expenseIds: outcome.created.expenses.map((expense) => expense.expenseId),
      },
    });
    return outcome.created;
  }

  private refuseOutcome(result: CaptureAllocationResult | null): never {
    // A41: "there is no company portion" is an answer, and `accept` already closed the group on it.
    // Reaching handoff with one means the client is asking for a zero-money expense.
    if (result?.outcome === 'NO_COMPANY_PORTION') {
      throw conflict(
        'expense_capture_no_company_portion',
        'การจัดส่วนนี้สรุปว่าไม่มีส่วนของบริษัท จึงไม่มีรายการค่าใช้จ่ายให้สร้าง',
      );
    }
    throw conflict(
      'expense_capture_allocation_blocked',
      'ยังมีรายการที่ต้องตรวจก่อน จึงจะสร้างรายการค่าใช้จ่ายได้',
      { blockers: (result?.blockers ?? []).map((entry) => entry.code) },
    );
  }

  /** §6: the creator who may bring evidence in, or anybody who may review it. */
  private canHandoff(ctx: RequestContext, group: CaptureGroupRow): boolean {
    if (ctx.permissions.includes('expense.review')) return true;
    return HANDOFF_CREATE_PERMISSIONS.some((key) => ctx.permissions.includes(key))
      && group.createdByUserId === ctx.userId;
  }

  private replay(
    ctx: RequestContext,
    group: CaptureGroupRow,
    batchKey: string,
    rows: readonly DerivedRow[],
  ): CaptureHandoffResultDto {
    return {
      handoffBatchKey: batchKey, groupStatus: 'HANDED_OFF', revision: group.revision,
      regenerated: false, replayed: true,
      expenses: rows.map((row) => ({
        expenseId: row.id,
        scopeKey: row.captureScopeKey ?? '',
        grandTotalAmount: row.grandTotalAmount.toString(),
        netPayableAmount: row.netPayableAmount.toString(),
        // A replay describes rows that already exist, and whether a claim may cite one is the
        // resolver's answer against the row as it is NOW — not a promise this response can repeat.
        claimReady: false,
        webPath: expenseWebPath(ctx.companyId, row.id),
      })),
    };
  }

  /** §9: every derived source still unconsumed, or 409 naming the ones that are not. */
  private async assertReleasable(tx: CaptureDb, ctx: RequestContext, groupId: string): Promise<void> {
    const consumers = await this.capture.findHandoffConsumers(tx, ctx.companyId, groupId);
    if (consumers.length === 0) return;
    throw conflict(
      'expense_capture_handoff_consumed',
      'รายการค่าใช้จ่ายที่สร้างจากงานนี้ถูกนำไปใช้แล้ว กรุณาแก้ไขที่รายการค่าใช้จ่ายนั้นแทน',
      { expenseIds: consumers.map((row) => row.expenseId), consumers },
    );
  }

  /**
   * The batch itself: rewrite the scopes that already have an expense (the §3.1 converted one, or
   * the previous batch's), create the rest, release what the new allocation no longer describes,
   * and stamp the group. Runs inside the caller's transaction, under its locks.
   */
  private async writeBatch(
    tx: CaptureDb,
    ctx: RequestContext,
    group: CaptureGroupRow,
    handoffCtx: CaptureHandoffContext,
    scopes: readonly CaptureAllocationScope[],
    facts: CaptureFactsView,
    existing: readonly DerivedRow[],
    files: readonly StoredFile[],
    batchKey: string,
  ): Promise<BatchWrite> {
    const attachmentByFile = new Map(files.map((file) => [file.id, file.attachmentId]));
    const byScope = new Map(existing.map((row) => [row.captureScopeKey ?? '', row]));
    const kept = new Set(scopes.map((scope) => scope.scopeKey));

    // A scope the new allocation no longer describes leaves behind an expense for a purchase
    // nobody is claiming. It is deleted, not zeroed: a 0-baht row is a money row (A41).
    const releasedExpenseIds: string[] = [];
    for (const row of existing) {
      if (kept.has(row.captureScopeKey ?? '')) continue;
      if (!await this.capture.deleteDerivedSource(tx, ctx.companyId, row.id, row.updatedAt)) {
        throw conflict('EXPENSE_UPDATE_CONFLICT', 'รายการค่าใช้จ่ายที่สร้างจากงานนี้เปลี่ยนไประหว่างทำรายการ กรุณาเปิดข้อมูลล่าสุดแล้วลองใหม่');
      }
      releasedExpenseIds.push(row.id);
    }

    const expenses: CaptureHandoffExpenseDto[] = [];
    const rewrittenExpenseIds: string[] = [];
    for (const scope of scopes) {
      const draft = this.draft(scope, facts, handoffCtx);
      const attachmentIds = draft.fileIds
        .map((fileId) => attachmentByFile.get(fileId))
        .filter((id): id is string => Boolean(id));
      const previous = byScope.get(scope.scopeKey);
      const expenseId = previous
        ? await this.rewrite(tx, ctx, previous, draft, attachmentIds)
        : await this.create(tx, ctx, draft, attachmentIds);
      if (previous) rewrittenExpenseIds.push(expenseId);
      expenses.push({
        expenseId, scopeKey: scope.scopeKey,
        grandTotalAmount: scope.totals.grandTotal, netPayableAmount: scope.totals.netPayable,
        claimReady: scope.claimReady, webPath: expenseWebPath(ctx.companyId, expenseId),
      });
    }

    const revision = await this.capture.bumpRevision(tx, {
      companyId: ctx.companyId, groupId: group.id, expectedRevision: group.revision,
      data: { status: 'HANDED_OFF', handoffState: 'ACTIVE', handoffBatchKey: batchKey },
    });
    if (revision === null) throw revisionConflict();
    return { revision, expenses, releasedExpenseIds, rewrittenExpenseIds };
  }

  private draft(scope: CaptureAllocationScope, facts: CaptureFactsView, handoffCtx: CaptureHandoffContext): DerivedSourceDraft {
    try {
      return buildDerivedSourceDraft(scope, scopeDocuments(scope, facts), handoffCtx);
    } catch (error) {
      if (error instanceof CaptureHandoffError) {
        throw new UnprocessableEntityException({ code: error.code, message: error.messageTh });
      }
      throw error;
    }
  }

  private async create(tx: CaptureDb, ctx: RequestContext, draft: DerivedSourceDraft, attachmentIds: readonly string[]): Promise<string> {
    const expense = await this.expenses.createExpense(draft.create, undefined, tx as never);
    await this.writeLines(tx, ctx, expense.id, draft);
    await this.linkEvidence(tx, ctx, expense.id, attachmentIds);
    return expense.id;
  }

  /**
   * §3.1: a converted expense — or one this group already handed off — KEEPS its id, and with it
   * its deep link, its `ReceiptExtraction` rows and whatever a person already wrote on it. Only the
   * header, the lines and the lineage are rewritten to the company portion. The CAS on
   * `updatedAt` is what makes a concurrent edit a 409 instead of a silent overwrite.
   */
  private async rewrite(
    tx: CaptureDb,
    ctx: RequestContext,
    previous: DerivedRow,
    draft: DerivedSourceDraft,
    attachmentIds: readonly string[],
  ): Promise<string> {
    const { create } = draft;
    await this.expenses.updateExpense({
      id: previous.id, companyId: ctx.companyId, updatedByUserId: ctx.userId,
      expectedUpdatedAt: previous.updatedAt,
      status: create.status,
      expenseDate: create.expenseDate,
      currency: create.currency,
      vatMode: create.vatMode,
      inputVatClaimStatus: create.inputVatClaimStatus,
      taxEvidenceStatus: create.taxEvidenceStatus,
      ...(create.sourceDocumentType ? { sourceDocumentType: create.sourceDocumentType } : {}),
      ...(create.vendorNameSnapshot ? { vendorNameSnapshot: create.vendorNameSnapshot } : {}),
      ...(create.vendorTaxIdSnapshot ? { vendorTaxIdSnapshot: create.vendorTaxIdSnapshot } : {}),
      ...(create.vendorBranchCodeSnapshot ? { vendorBranchCodeSnapshot: create.vendorBranchCodeSnapshot } : {}),
      ...(create.vendorDocumentNumber ? { vendorDocumentNumber: create.vendorDocumentNumber } : {}),
      subtotalAmount: create.subtotalAmount, discountAmount: create.discountAmount,
      taxableAmount: create.taxableAmount, vatAmount: create.vatAmount, whtAmount: create.whtAmount,
      grandTotalAmount: create.grandTotalAmount, netPayableAmount: create.netPayableAmount,
      outstandingAmount: create.outstandingAmount,
      aiVerificationStatus: create.aiVerificationStatus,
      ...(create.aiVerificationSummaryJson ? { aiVerificationSummaryJson: create.aiVerificationSummaryJson } : {}),
      ...(create.sourceChannelMetadataJson ? { sourceChannelMetadataJson: create.sourceChannelMetadataJson } : {}),
    }, undefined, tx);
    await this.writeLines(tx, ctx, previous.id, draft);
    // The lineage columns are INSERT-only through `updateExpense` (`UpdateExpenseRecordInput` omits
    // them on purpose), so they are written here — same transaction, same locks. `captureGroupId`
    // is a WHERE, never a SET: a handoff may not move an expense into another group.
    await tx.expenseRecord.updateMany({
      where: { companyId: ctx.companyId, id: previous.id, captureGroupId: create.captureGroupId },
      data: {
        captureAllocationId: create.captureAllocationId, captureScopeKey: create.captureScopeKey,
        payerUserId: create.payerUserId,
      },
    });
    await this.linkEvidence(tx, ctx, previous.id, attachmentIds);
    return previous.id;
  }

  private writeLines(tx: CaptureDb, ctx: RequestContext, expenseId: string, draft: DerivedSourceDraft): Promise<void> {
    return this.expenses.upsertLines(
      ctx.companyId, expenseId,
      draft.lines.map((line) => ({ ...line, expenseId, companyId: ctx.companyId })),
      tx,
    );
  }

  /**
   * The scope's files become this expense's receipt: the first in manifest order is the primary,
   * the rest supporting. The group keeps its own `expense.capture.evidence` links, so the bytes are
   * claimed by both on purpose — that shared claim is what the resolver's sibling rule reads (§5).
   */
  private async linkEvidence(tx: CaptureDb, ctx: RequestContext, expenseId: string, attachmentIds: readonly string[]): Promise<void> {
    for (const [index, attachmentId] of attachmentIds.entries()) {
      await this.expenses.linkAttachmentToTarget(
        attachmentId, 'expense.record', expenseId,
        index === 0 ? 'expense.receipt.primary' : 'expense.receipt.supporting',
        ctx.companyId, ctx.userId, tx,
      );
    }
    if (!attachmentIds[0]) return;
    await tx.expenseRecord.updateMany({
      where: { companyId: ctx.companyId, id: expenseId },
      data: { primaryAttachmentId: attachmentIds[0] },
    });
  }
}

/**
 * §3.2 — the LINE lane's single-document group hands itself off with no allocation at all: one
 * file, one document, one issuer, everything readable. The result is the same NEEDS_REVIEW draft a
 * LINE photo produces today, so the person reviews it on the web exactly as before; "มีของส่วนตัวด้วย"
 * later reopens the SAME group for a real allocation (`isReopenableAfterHandoff`), and that handoff
 * rewrites this expense in place — it is `captureGroupId`-bound, like a converted one.
 *
 * No HTTP route and no caller yet: the LINE wave wires it to the read job's completion.
 */
@Injectable()
export class AutoHandoffSingleDocumentCaptureUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly expenses: PrismaExpenseRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, groupId: string): Promise<{ expenseId: string } | { skipped: CaptureAutoHandoffSkip | 'not_found' }> {
    const group = await this.capture.findGroup(this.capture.client, ctx.companyId, groupId);
    if (!group) return { skipped: 'not_found' };

    return this.capture.transaction(async (tx) => {
      const files = await this.capture.listFiles(tx, ctx.companyId, groupId);
      const stored = files.filter((file) => file.uploadState === 'STORED');
      await lockFundingEvidence(tx, ctx.companyId, {
        attachmentIds: stored.map((file) => file.attachmentId), expenseIds: [],
      });
      await this.capture.lockGroup(tx, ctx.companyId, groupId);

      const current = await this.capture.findGroup(tx, ctx.companyId, groupId);
      if (!current) return { skipped: 'not_found' as const };
      const jobs = await this.capture.listJobsByGroup(tx, ctx.companyId, groupId);
      const jobByFile = new Map(jobs.map((job) => [job.fileId, job.status as string]));
      const observations = await this.capture.listObservations(tx, ctx.companyId, groupId);
      const facts = observations.length > 0 ? assembleCaptureFacts(observations) : null;

      // ALL_COMPANY with no funding route is exactly what a LINE receipt is today: the whole
      // document is the company's until somebody says otherwise, and nobody has said who paid.
      // Reusing the allocation engine is what makes the discount/shipping/identity rules the same
      // ones a reviewed group gets — only the snapshot ROW is skipped, never the maths.
      const allocation = facts ? computeCaptureAllocation({
        facts, businessUse: 'ALL_COMPANY', selection: {}, fundingRoute: 'UNKNOWN', payerUserId: null,
        taxReview: {}, expenseDateChoice: {}, policy: EXPENSE_CAPTURE_ALLOCATION_POLICY,
        todayIso: new Date().toISOString(),
      }) : null;

      const eligible = captureAutoHandoffEligibility({
        status: current.status, handoffState: current.handoffState, intakeChannel: current.intakeChannel,
        files: files.map((file) => ({ uploadState: file.uploadState, readStatus: jobByFile.get(file.id) ?? null })),
        facts, allocation,
      });
      if (!eligible.ok) return { skipped: eligible.skipped };

      const batchKey = captureAutoHandoffBatchKey(groupId);
      const draft = buildDerivedSourceDraft(eligible.scope, scopeDocuments(eligible.scope, facts!), {
        companyId: ctx.companyId, branchId: current.branchId, groupId, allocationId: null,
        intakeChannel: current.intakeChannel, lineChatKeyHash: current.lineChatKeyHash,
        // No reviewed route and no payer: this is the whole document, not a division of it, and
        // `payerUserId` stays null until a person says who paid (§5/A32).
        fundingRoute: 'UNKNOWN', payerUserId: null, actorUserId: current.createdByUserId,
        policyVersion: EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION, summary: allocation!.summary,
      });

      const expense = await this.expenses.createExpense(draft.create, undefined, tx as never);
      await this.expenses.upsertLines(
        ctx.companyId, expense.id,
        draft.lines.map((line) => ({ ...line, expenseId: expense.id, companyId: ctx.companyId })),
        tx,
      );
      const attachmentIds = stored.filter((file) => draft.fileIds.includes(file.id)).map((file) => file.attachmentId);
      for (const [index, attachmentId] of attachmentIds.entries()) {
        await this.expenses.linkAttachmentToTarget(
          attachmentId, 'expense.record', expense.id,
          index === 0 ? 'expense.receipt.primary' : 'expense.receipt.supporting',
          ctx.companyId, current.createdByUserId, tx,
        );
      }
      if (attachmentIds[0]) {
        await tx.expenseRecord.updateMany({
          where: { companyId: ctx.companyId, id: expense.id },
          data: { primaryAttachmentId: attachmentIds[0] },
        });
      }

      const revision = await this.capture.bumpRevision(tx, {
        companyId: ctx.companyId, groupId, expectedRevision: current.revision,
        data: { status: 'HANDED_OFF', handoffState: 'ACTIVE', handoffBatchKey: batchKey, acceptedAllocationId: null },
      });
      if (revision === null) throw revisionConflict();

      await this.audit.log({
        companyId: ctx.companyId, actorUserId: current.createdByUserId,
        action: AuditAction.EXPENSE_CAPTURE_HANDOFF_CREATE,
        targetType: 'expense_capture_group', targetId: groupId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          handoffBatchKey: batchKey, rule: 'auto_single_document', allocationId: null, revision,
          expenseIds: [expense.id], scopeKeys: [eligible.scope.scopeKey],
          companyAmount: eligible.scope.companyAmount, paidTotal: eligible.scope.paidTotal,
        },
      }, tx);

      return { expenseId: expense.id };
    });
  }
}
