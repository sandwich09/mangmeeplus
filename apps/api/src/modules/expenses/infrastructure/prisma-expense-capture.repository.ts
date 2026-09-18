import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { branchScopeWhere, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';

export type CaptureDb = Prisma.TransactionClient | PrismaService['client'];

/** §9: the statuses a derived source may still be released from — nothing downstream has used it. */
const CAPTURE_UNCONSUMED_STATUSES = ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] as const;

export type CaptureGroupRow = {
  id: string;
  companyId: string;
  branchId: string | null;
  createdByUserId: string;
  intakeChannel: 'WEB' | 'LINE';
  status: 'OPEN' | 'HANDED_OFF' | 'CLOSED_NO_HANDOFF' | 'CANCELLED';
  revision: number;
  businessUse: 'UNKNOWN' | 'ALL_COMPANY' | 'MIXED';
  fundingRoute: 'UNKNOWN' | 'COMPANY' | 'EMPLOYEE';
  payerUserId: string | null;
  /** `{ [scopeKey]: { vatMode, inputVatClaimStatus, taxEvidenceStatus, reviewedByUserId, reviewedAt } }`. */
  taxReviewJson: unknown;
  /** `{ [scopeKey]: 'payment' | 'document' | 'order' | { date } }` — the reviewed date per scope. */
  expenseDateSourceJson: unknown;
  handoffState: 'NONE' | 'ACTIVE' | 'RELEASED';
  /** `<groupId>:<allocationId>`, or `<groupId>:auto` for the §3.2 LINE auto handoff. */
  handoffBatchKey: string | null;
  acceptedAllocationId: string | null;
  lineChatKeyHash: string | null;
  note: string | null;
  closedReason: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Data access for the capture aggregate. Every method takes the caller's client, because the
 * transaction, the §2.4 lock order, the permission checks and the audit row all belong to the
 * use case — a repository that opened its own transaction would sit outside the lock the caller
 * already holds.
 */
@Injectable()
export class PrismaExpenseCaptureRepository {
  constructor(private readonly prisma: PrismaService) {}

  get client(): PrismaService['client'] {
    return this.prisma.client;
  }

  transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(run);
  }

  /**
   * The capture link in the canonical chain (appendix §2.4):
   * `duplicate-reconciliation` → `reimbursement-evidence:*` → THIS → `substitute-receipt`
   * → `ai-budget:<company>:<month>`. Callers take the earlier keys first or they deadlock.
   */
  async lockGroup(db: CaptureDb, companyId: string, groupId: string): Promise<void> {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:expense-capture:${groupId}`}))`;
  }

  findGroup(db: CaptureDb, companyId: string, groupId: string): Promise<CaptureGroupRow | null> {
    return db.expenseCaptureGroup.findFirst({ where: { companyId, id: groupId } }) as Promise<CaptureGroupRow | null>;
  }

  async listGroups(
    db: CaptureDb,
    input: { companyId: string; status?: string; createdByUserId?: string; scopes?: BranchScopes; page: number; pageSize: number },
  ): Promise<{ rows: CaptureGroupRow[]; total: number }> {
    const where = {
      companyId: input.companyId,
      ...(input.status ? { status: input.status as CaptureGroupRow['status'] } : {}),
      ...(input.createdByUserId ? { createdByUserId: input.createdByUserId } : {}),
      ...(input.scopes ? branchScopeWhere(input.scopes) : {}),
    };
    const [rows, total] = await Promise.all([
      db.expenseCaptureGroup.findMany({
        where, orderBy: { updatedAt: 'desc' },
        skip: (input.page - 1) * input.pageSize, take: input.pageSize,
      }),
      db.expenseCaptureGroup.count({ where }),
    ]);
    return { rows: rows as CaptureGroupRow[], total };
  }

  createGroup(db: CaptureDb, input: {
    companyId: string; branchId: string | null; createdByUserId: string;
    intakeChannel: 'WEB' | 'LINE'; note?: string | null; lineChatKeyHash?: string | null;
  }): Promise<CaptureGroupRow> {
    return db.expenseCaptureGroup.create({
      data: {
        companyId: input.companyId, branchId: input.branchId, createdByUserId: input.createdByUserId,
        intakeChannel: input.intakeChannel, note: input.note ?? null,
        lineChatKeyHash: input.lineChatKeyHash ?? null,
      },
    }) as Promise<CaptureGroupRow>;
  }

  /**
   * Compare-and-set on `revision`. Returns the new revision, or null when another writer got
   * there first — the caller answers `expense_capture_group_revision_conflict` rather than
   * overwriting a decision it never saw.
   */
  async bumpRevision(db: CaptureDb, input: {
    companyId: string; groupId: string; expectedRevision: number;
    data?: Record<string, unknown>;
  }): Promise<number | null> {
    const changed = await db.expenseCaptureGroup.updateMany({
      where: { companyId: input.companyId, id: input.groupId, revision: input.expectedRevision },
      data: { ...(input.data ?? {}), revision: input.expectedRevision + 1 },
    });
    return changed.count === 1 ? input.expectedRevision + 1 : null;
  }

  /** One query for a page of groups: the list must not fan out into two reads per row. */
  /**
   * The bump for an effect that ALREADY happened. Completing an upload puts verified bytes in
   * storage, which no rollback here can undo, so the group has to record the file it now holds
   * even if another mutation moved the revision in between; `expectedRevision` is checked before
   * that storage call and is not a second gate afterwards. Runs under the group lock.
   */
  async bumpRevisionForCommittedEffect(db: CaptureDb, input: {
    companyId: string; groupId: string; data?: Record<string, unknown>;
  }): Promise<number> {
    const row = await db.expenseCaptureGroup.update({
      where: { companyId_id: { companyId: input.companyId, id: input.groupId } },
      data: { ...(input.data ?? {}), revision: { increment: 1 } },
      select: { revision: true },
    });
    return row.revision;
  }

  /** Quarantined or deleted bytes: the slot is spent, and the customer must send the file again. */
  async markFileRejected(db: CaptureDb, input: { companyId: string; fileId: string }): Promise<boolean> {
    const changed = await db.expenseCaptureFile.updateMany({
      where: { companyId: input.companyId, id: input.fileId, uploadState: 'PENDING_UPLOAD' },
      data: { uploadState: 'REJECTED' },
    });
    return changed.count === 1;
  }

  listFileStatesForGroups(db: CaptureDb, companyId: string, groupIds: readonly string[]) {
    if (groupIds.length === 0) return Promise.resolve([] as Array<{ groupId: string; uploadState: string }>);
    return db.expenseCaptureFile.findMany({
      where: { companyId, groupId: { in: [...groupIds] } },
      select: { groupId: true, uploadState: true },
    }) as Promise<Array<{ groupId: string; uploadState: string }>>;
  }

  listJobStatesForGroups(db: CaptureDb, companyId: string, groupIds: readonly string[]) {
    if (groupIds.length === 0) return Promise.resolve([] as Array<{ groupId: string | null; status: string }>);
    return db.expenseCaptureReadJob.findMany({
      where: { companyId, groupId: { in: [...groupIds] } },
      select: { groupId: true, status: true },
    }) as Promise<Array<{ groupId: string | null; status: string }>>;
  }

  listFiles(db: CaptureDb, companyId: string, groupId: string) {
    return db.expenseCaptureFile.findMany({
      where: { companyId, groupId },
      orderBy: { position: 'asc' },
    });
  }

  findFile(db: CaptureDb, companyId: string, groupId: string, fileId: string) {
    return db.expenseCaptureFile.findFirst({ where: { companyId, groupId, id: fileId } });
  }

  async nextFilePosition(db: CaptureDb, companyId: string, groupId: string): Promise<number> {
    const last = await db.expenseCaptureFile.findFirst({
      where: { companyId, groupId }, orderBy: { position: 'desc' }, select: { position: true },
    });
    return (last?.position ?? 0) + 1;
  }

  createFile(db: CaptureDb, input: {
    companyId: string; groupId: string; attachmentId: string; position: number;
    originalFileName: string; mimeType: string; byteSize: number; addedByUserId: string;
    lineMessageId?: string | null; uploadState?: 'PENDING_UPLOAD' | 'STORED';
    checksumSha256?: string | null;
  }) {
    return db.expenseCaptureFile.create({
      data: {
        companyId: input.companyId, groupId: input.groupId, attachmentId: input.attachmentId,
        position: input.position, originalFileName: input.originalFileName, mimeType: input.mimeType,
        byteSize: input.byteSize, addedByUserId: input.addedByUserId,
        lineMessageId: input.lineMessageId ?? null,
        ...(input.uploadState ? { uploadState: input.uploadState } : {}),
        ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
      },
    });
  }

  /**
   * PENDING_UPLOAD → STORED, fenced on the state we read. Two concurrent completes of the same
   * file therefore produce exactly one winner, and the loser replays the stored file's job.
   */
  async markFileStored(db: CaptureDb, input: {
    companyId: string; fileId: string; checksumSha256: string | null; byteSize: number;
    lineMessageId?: string | null;
  }): Promise<boolean> {
    const changed = await db.expenseCaptureFile.updateMany({
      where: { companyId: input.companyId, id: input.fileId, uploadState: 'PENDING_UPLOAD' },
      data: {
        uploadState: 'STORED', checksumSha256: input.checksumSha256, byteSize: input.byteSize,
        ...(input.lineMessageId ? { lineMessageId: input.lineMessageId } : {}),
      },
    });
    return changed.count === 1;
  }

  async markFileDetached(db: CaptureDb, input: {
    companyId: string; fileId: string; reason: string;
  }): Promise<boolean> {
    const changed = await db.expenseCaptureFile.updateMany({
      where: { companyId: input.companyId, id: input.fileId, uploadState: { not: 'DETACHED' } },
      data: { uploadState: 'DETACHED', detachedAt: new Date(), detachedReason: input.reason },
    });
    return changed.count === 1;
  }

  createReadJob(db: CaptureDb, input: {
    companyId: string; ownerType: 'CAPTURE_GROUP' | 'EXPENSE'; groupId?: string | null;
    expenseId?: string | null; fileId?: string | null; attachmentId: string;
    attachmentChecksum: string; objectVersionId?: string | null; ocrAdmissionRequestId: string;
    manifestJson: unknown;
  }) {
    return db.expenseCaptureReadJob.create({
      data: {
        companyId: input.companyId, ownerType: input.ownerType, groupId: input.groupId ?? null,
        expenseId: input.expenseId ?? null, fileId: input.fileId ?? null,
        attachmentId: input.attachmentId, attachmentChecksum: input.attachmentChecksum,
        objectVersionId: input.objectVersionId ?? null,
        ocrAdmissionRequestId: input.ocrAdmissionRequestId,
        manifestJson: input.manifestJson as Prisma.InputJsonValue,
      },
    });
  }

  findJobByFile(db: CaptureDb, companyId: string, fileId: string) {
    return db.expenseCaptureReadJob.findFirst({
      where: { companyId, fileId }, orderBy: { createdAt: 'desc' },
    });
  }

  listJobsByGroup(db: CaptureDb, companyId: string, groupId: string) {
    return db.expenseCaptureReadJob.findMany({ where: { companyId, groupId } });
  }

  /** A detached or replaced file's read must not come back and apply to the group (§4.5). */
  async cancelJobsForFile(db: CaptureDb, companyId: string, fileId: string): Promise<number> {
    const changed = await db.expenseCaptureReadJob.updateMany({
      where: { companyId, fileId, status: { notIn: ['DONE', 'CANCELLED'] } },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    return changed.count;
  }

  createObservation(db: CaptureDb, input: {
    companyId: string; groupId?: string | null; expenseId?: string | null; fileId?: string | null;
    jobId?: string | null; version: number; source: 'AI' | 'HUMAN' | 'EXPENSE_FACTS';
    payloadJson: unknown; createdByUserId?: string | null;
  }) {
    return db.expenseCaptureObservation.create({
      data: {
        companyId: input.companyId, groupId: input.groupId ?? null, expenseId: input.expenseId ?? null,
        fileId: input.fileId ?? null, jobId: input.jobId ?? null, version: input.version,
        source: input.source, payloadJson: input.payloadJson as Prisma.InputJsonValue,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  listObservations(db: CaptureDb, companyId: string, groupId: string) {
    return db.expenseCaptureObservation.findMany({
      where: { companyId, groupId, stale: false }, orderBy: [{ createdAt: 'asc' }],
    });
  }

  findGroupAllocation(db: CaptureDb, companyId: string, groupId: string) {
    return db.expenseCaptureAllocation.findFirst({
      where: { companyId, groupId, status: { in: ['ACCEPTED', 'PREVIEW'] } },
      orderBy: [{ status: 'asc' }, { computedAt: 'desc' }],
    });
  }

  // ─── W04a: human facts, allocations, payer (appendix §9) ────────────────────

  /**
   * The next version for one file's facts. `@@unique([companyId, fileId, version])` is the real
   * fence — this only picks the number, and a loser retries against a conflict rather than
   * overwriting the version somebody else just wrote.
   */
  async nextObservationVersion(db: CaptureDb, companyId: string, key: { fileId?: string | null; expenseId?: string | null }): Promise<number> {
    const last = await db.expenseCaptureObservation.findFirst({
      where: {
        companyId,
        ...(key.fileId ? { fileId: key.fileId } : { fileId: null, ...(key.expenseId ? { expenseId: key.expenseId } : {}) }),
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (last?.version ?? 0) + 1;
  }

  createAllocation(db: CaptureDb, input: {
    companyId: string; groupId: string; groupRevision: number; policyVersion: string;
    selectionJson: unknown; inputJson: unknown; resultJson: unknown;
    fundingRoute: CaptureGroupRow['fundingRoute']; payerUserId: string | null; computedByUserId: string;
  }) {
    return db.expenseCaptureAllocation.create({
      data: {
        companyId: input.companyId, groupId: input.groupId, groupRevision: input.groupRevision,
        policyVersion: input.policyVersion,
        selectionJson: input.selectionJson as Prisma.InputJsonValue,
        inputJson: input.inputJson as Prisma.InputJsonValue,
        resultJson: input.resultJson as Prisma.InputJsonValue,
        fundingRoute: input.fundingRoute, payerUserId: input.payerUserId,
        computedByUserId: input.computedByUserId,
      },
    });
  }

  findAllocation(db: CaptureDb, companyId: string, groupId: string, allocationId: string) {
    return db.expenseCaptureAllocation.findFirst({ where: { companyId, groupId, id: allocationId } });
  }

  /**
   * Retire the allocations a change has overtaken. `INVALIDATED` says the facts moved under it,
   * `SUPERSEDED` that a newer snapshot replaced it — both keep the row, because the snapshot is
   * the evidence of what somebody approved (spec §5).
   */
  async retireAllocations(db: CaptureDb, input: {
    companyId: string; groupId: string; from: ReadonlyArray<'PREVIEW' | 'ACCEPTED'>;
    to: 'SUPERSEDED' | 'INVALIDATED'; reason?: string; exceptId?: string;
  }): Promise<number> {
    const changed = await db.expenseCaptureAllocation.updateMany({
      where: {
        companyId: input.companyId, groupId: input.groupId, status: { in: [...input.from] },
        ...(input.exceptId ? { id: { not: input.exceptId } } : {}),
      },
      data: { status: input.to, ...(input.reason ? { invalidatedReason: input.reason } : {}) },
    });
    return changed.count;
  }

  /** Fenced on PREVIEW: two reviewers accepting at once produce one ACCEPTED, not two. */
  async acceptAllocation(db: CaptureDb, input: {
    companyId: string; allocationId: string; acceptedByUserId: string;
  }): Promise<boolean> {
    const changed = await db.expenseCaptureAllocation.updateMany({
      where: { companyId: input.companyId, id: input.allocationId, status: 'PREVIEW' },
      data: { status: 'ACCEPTED', acceptedByUserId: input.acceptedByUserId, acceptedAt: new Date() },
    });
    return changed.count === 1;
  }

  /**
   * Is this person a payer the company can actually repay? The same membership/branch-scope test
   * the reimbursement picker uses (`listReimbursementRequesters`), so a payer the group records
   * is one the claim will still recognise (§5, A32).
   */
  async isActiveCompanyMember(db: CaptureDb, input: { companyId: string; userId: string; branchId: string | null }): Promise<boolean> {
    const member = await db.companyMembership.findFirst({
      where: {
        companyId: input.companyId, userId: input.userId, status: 'ACTIVE', user: { status: 'ACTIVE' },
        ...(input.branchId
          ? {
            OR: [
              { branchScopeMode: 'ALL_BRANCHES' as const },
              { branchScopeMode: 'DEFAULT_BRANCH_ONLY' as const, defaultBranchId: input.branchId },
              { branchScopeMode: 'SELECTED_BRANCHES' as const, branchScopes: { some: { branchId: input.branchId } } },
            ],
          }
          : {}),
      },
      select: { id: true },
    });
    return member !== null;
  }

  /** Derived sources are ordinary expenses; the group only ever reports their lineage. */
  listDerivedSources(db: CaptureDb, companyId: string, groupId: string) {
    return db.expenseRecord.findMany({
      where: { companyId, captureGroupId: groupId },
      select: { id: true, captureScopeKey: true, status: true, grandTotalAmount: true, payerUserId: true },
      orderBy: { id: 'asc' },
    });
  }

  // ─── W05: handoff, regenerate and the single-use fence (appendix §9) ─────────

  /** Everything a regenerate has to judge before it may delete or rewrite a derived source. */
  listDerivedSourceStates(db: CaptureDb, companyId: string, groupId: string) {
    return db.expenseRecord.findMany({
      where: { companyId, captureGroupId: groupId },
      select: {
        id: true, captureScopeKey: true, captureAllocationId: true, status: true, updatedAt: true,
        paidAmount: true, paymentStatus: true, postingStatus: true, journalEntryId: true,
        sourceReimbursementRequestId: true, grandTotalAmount: true, netPayableAmount: true,
        primaryAttachmentId: true, createdByUserId: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * §9 regenerate: which derived sources are already USED, and by what. A source that reached any
   * of these has consequences outside the group — money, a claim, a signature, a ledger entry — and
   * releasing it would move a decision somebody else already made (A44/A11). Returns one reason per
   * expense, the first that applies, so the message can name the thing to go and look at.
   */
  async findHandoffConsumers(db: CaptureDb, companyId: string, groupId: string): Promise<Array<{ expenseId: string; reason: string }>> {
    const rows = await this.listDerivedSourceStates(db, companyId, groupId);
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [claims, certificates] = await Promise.all([
      db.reimbursementLine.findMany({
        where: {
          companyId, linkedExpenseId: { in: ids },
          request: { status: { notIn: ['REJECTED', 'CANCELLED', 'VOIDED'] } },
        },
        select: { linkedExpenseId: true },
      }),
      db.expenseSubstituteReceiptEvidence.findMany({
        where: { companyId, expenseId: { in: ids }, status: { in: ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED'] } },
        select: { expenseId: true },
      }),
    ]);
    const claimed = new Set(claims.map((row) => row.linkedExpenseId));
    const certified = new Set(certificates.map((row) => row.expenseId));

    const consumers: Array<{ expenseId: string; reason: string }> = [];
    for (const row of rows) {
      const reason = !(CAPTURE_UNCONSUMED_STATUSES as readonly string[]).includes(row.status) ? 'status'
        : row.paymentStatus !== 'UNPAID' || Number(row.paidAmount ?? 0) > 0 ? 'paid'
          : row.postingStatus !== 'not_required' || row.journalEntryId ? 'posted'
            : row.sourceReimbursementRequestId ? 'claim_projection'
              : claimed.has(row.id) ? 'claim'
                : certified.has(row.id) ? 'certificate'
                  : null;
      if (reason) consumers.push({ expenseId: row.id, reason });
    }
    return consumers;
  }

  /**
   * Drop a derived source the group is rebuilding. Its `AttachmentLink` rows go; the attachment
   * OBJECTS stay, because the group still claims the same bytes (§2.3 — the delete use case marks
   * them deleted, which is exactly the difference between deleting an expense and releasing one).
   * `ExpenseLine`, `ReceiptExtraction` and the duplicate-candidate rows cascade with the record.
   */
  async deleteDerivedSource(db: CaptureDb, companyId: string, expenseId: string, expectedUpdatedAt: Date): Promise<boolean> {
    await db.attachmentLink.deleteMany({ where: { companyId, targetType: 'expense.record', targetId: expenseId } });
    const deleted = await db.expenseRecord.deleteMany({ where: { companyId, id: expenseId, updatedAt: expectedUpdatedAt } });
    return deleted.count === 1;
  }

  /**
   * §9 regenerate + §3.2: may a handed-off group be reviewed and accepted again? Only when it
   * actually produced derived sources and NONE of them has been used — a group whose expense is
   * already in a claim, paid or certified is corrected at that expense, never by re-dividing the
   * purchase behind it (A11/A44). A handed-off group with no derived source at all stays refused:
   * there is nothing to rewrite, so reopening it would orphan a batch key.
   */
  async isReopenableAfterHandoff(db: CaptureDb, companyId: string, groupId: string): Promise<boolean> {
    const rows = await this.listDerivedSourceStates(db, companyId, groupId);
    if (rows.length === 0) return false;
    return (await this.findHandoffConsumers(db, companyId, groupId)).length === 0;
  }

  /** The accepted allocation a handoff is allowed to use, read under the group lock. */
  findAcceptedAllocation(db: CaptureDb, companyId: string, groupId: string, allocationId: string) {
    return db.expenseCaptureAllocation.findFirst({
      where: { companyId, groupId, id: allocationId, status: 'ACCEPTED' },
    });
  }

  /** STORED files in manifest order — the evidence a derived source links as its receipt. */
  listStoredFiles(db: CaptureDb, companyId: string, groupId: string) {
    return db.expenseCaptureFile.findMany({
      where: { companyId, groupId, uploadState: 'STORED' },
      orderBy: { position: 'asc' },
      select: { id: true, attachmentId: true, position: true },
    });
  }

  // ─── LINE intake attempts (§17.5 diagnostic; no raw payload, no secret) ──────

  recordLineIntakeAttempt(input: {
    companyId?: string | null; lineUserIdHash: string; chatKeyHash?: string | null;
    webhookEventId?: string | null; lineMessageId?: string | null; messageType: 'image' | 'file';
    fileNameSanitized?: string | null; declaredFileSize?: number | null; measuredByteSize?: number | null;
    capabilityJson: unknown; stage: 'DOWNLOAD' | 'SECURITY' | 'PERSIST' | 'READ' | 'ROUTE';
    reasonCode: string; outcome?: 'REJECTED' | 'STORED' | 'STORED_READING' | 'STORED_READ_FAILED'
      | 'STORED_READ_PARTIAL' | 'STORED_READ_DONE' | 'UNKNOWN';
    targetType?: string | null; targetId?: string | null;
  }, db: CaptureDb = this.prisma.client) {
    return db.lineIntakeAttempt.create({
      data: {
        companyId: input.companyId ?? null, lineUserIdHash: input.lineUserIdHash,
        chatKeyHash: input.chatKeyHash ?? null, webhookEventId: input.webhookEventId ?? null,
        lineMessageId: input.lineMessageId ?? null, messageType: input.messageType,
        // Never the raw name: a customer file name can carry a path or 300 characters of noise.
        fileNameSanitized: sanitizeAttemptFileName(input.fileNameSanitized),
        declaredFileSize: input.declaredFileSize ?? null,
        measuredByteSize: input.measuredByteSize ?? null,
        capabilityJson: input.capabilityJson as Prisma.InputJsonValue,
        stage: input.stage, reasonCode: input.reasonCode,
        ...(input.outcome ? { outcome: input.outcome } : {}),
        targetType: input.targetType ?? null, targetId: input.targetId ?? null,
      },
    });
  }

  async updateLineIntakeAttemptOutcome(input: {
    id: string; outcome: 'REJECTED' | 'STORED' | 'STORED_READING' | 'STORED_READ_FAILED'
      | 'STORED_READ_PARTIAL' | 'STORED_READ_DONE' | 'UNKNOWN';
    stage?: 'DOWNLOAD' | 'SECURITY' | 'PERSIST' | 'READ' | 'ROUTE';
    reasonCode?: string; targetType?: string | null; targetId?: string | null;
    measuredByteSize?: number | null;
  }, db: CaptureDb = this.prisma.client): Promise<boolean> {
    const changed = await db.lineIntakeAttempt.updateMany({
      where: { id: input.id },
      data: {
        outcome: input.outcome,
        ...(input.stage ? { stage: input.stage } : {}),
        ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
        ...(input.targetType !== undefined ? { targetType: input.targetType } : {}),
        ...(input.targetId !== undefined ? { targetId: input.targetId } : {}),
        ...(input.measuredByteSize !== undefined ? { measuredByteSize: input.measuredByteSize } : {}),
      },
    });
    return changed.count === 1;
  }

  /** What "ไฟล์เมื่อกี้ส่งไม่ได้เพราะอะไร" reads: this actor's own attempts, newest first. */
  listLineIntakeAttempts(input: {
    companyId?: string | null; lineUserIdHash: string; chatKeyHash?: string | null;
    since?: Date; take?: number;
  }, db: CaptureDb = this.prisma.client) {
    return db.lineIntakeAttempt.findMany({
      where: {
        lineUserIdHash: input.lineUserIdHash,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.chatKeyHash ? { chatKeyHash: input.chatKeyHash } : {}),
        ...(input.since ? { createdAt: { gte: input.since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(input.take ?? 5, 20),
    });
  }

}

const ATTEMPT_FILE_NAME_MAX = 80;

/** Path segments dropped, control characters dropped, length capped — a label, not a file name. */
export function sanitizeAttemptFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const base = fileName.split(/[\\/]/).pop() ?? '';
  // Code points, not a character-class regex: a control character written literally into a source
  // file is exactly the kind of thing a reviewer cannot see.
  const safe = [...base]
    .filter((char) => { const code = char.codePointAt(0) ?? 0; return code >= 0x20 && code !== 0x7f; })
    .join('')
    .trim();
  return safe ? safe.slice(0, ATTEMPT_FILE_NAME_MAX) : null;
}
