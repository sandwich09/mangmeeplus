import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { branchScopeWhere, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';
import type { ExpenseCaptureDerivedCertificateDto } from '@watchdog-bms/contracts';

export type CaptureDb = Prisma.TransactionClient | PrismaService['client'];

/** The drain DTO caps at 5; this is the hard ceiling the repository will honour either way. */
export const MAX_CAPTURE_CLAIM_BATCH = 5;

/** The columns `claimReadJobs` returns — the row as stored, not a DTO. */
export type CaptureReadJobRow = {
  id: string;
  companyId: string;
  ownerType: 'CAPTURE_GROUP' | 'EXPENSE';
  groupId: string | null;
  expenseId: string | null;
  fileId: string | null;
  attachmentId: string;
  attachmentChecksum: string;
  objectVersionId: string | null;
  status: 'QUEUED' | 'PREPARING' | 'READING' | 'PARTIAL' | 'PAUSED' | 'FAILED' | 'DONE' | 'CANCELLED';
  ocrAdmissionRequestId: string;
  manifestJson: unknown;
  checkpointJson: unknown;
  attempts: number;
  leaseOwner: string | null;
  leasedUntil: Date | null;
  pausedReason: string | null;
  lastErrorCode: string | null;
  providerCallCount: number;
  expectedSourceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};
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
    manifestJson: unknown; expectedSourceUpdatedAt?: Date;
  }) {
    return db.expenseCaptureReadJob.create({
      data: {
        companyId: input.companyId, ownerType: input.ownerType, groupId: input.groupId ?? null,
        expenseId: input.expenseId ?? null, fileId: input.fileId ?? null,
        attachmentId: input.attachmentId, attachmentChecksum: input.attachmentChecksum,
        objectVersionId: input.objectVersionId ?? null,
        ocrAdmissionRequestId: input.ocrAdmissionRequestId,
        manifestJson: input.manifestJson as Prisma.InputJsonValue,
        // The `receipt-ocr-apply` fence for `ownerType EXPENSE` (§4.5): the draft version read
        // BEFORE the job started, so a correction made while it runs is never overwritten.
        ...(input.expectedSourceUpdatedAt ? { expectedSourceUpdatedAt: input.expectedSourceUpdatedAt } : {}),
      },
    });
  }

  findJobByFile(db: CaptureDb, companyId: string, fileId: string) {
    return db.expenseCaptureReadJob.findFirst({
      where: { companyId, fileId }, orderBy: { createdAt: 'desc' },
    });
  }

  findJobById(db: CaptureDb, jobId: string) {
    return db.expenseCaptureReadJob.findUnique({ where: { id: jobId } });
  }

  /** The newest non-terminal job for one expense — what `read-status` polls and W03 resumes. */
  findJobByExpense(db: CaptureDb, companyId: string, expenseId: string) {
    return db.expenseCaptureReadJob.findFirst({
      where: { companyId, expenseId }, orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Idempotency for the expense lane (§3): the same expense + attachment + bytes reuses the job
   * that is already running instead of buying a second OCR admission for one upload.
   */
  findLiveJobForAttachment(db: CaptureDb, input: {
    companyId: string; expenseId: string; attachmentId: string; attachmentChecksum: string;
  }) {
    return db.expenseCaptureReadJob.findFirst({
      where: {
        companyId: input.companyId, expenseId: input.expenseId, attachmentId: input.attachmentId,
        attachmentChecksum: input.attachmentChecksum,
        status: { notIn: ['DONE', 'FAILED', 'CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * One-statement claim in the `prisma-outbox.repository.ts` shape: `FOR UPDATE SKIP LOCKED` picks
   * rows no other runner holds, and the same statement stamps the lease that fences every later
   * write. Concurrent runners therefore get DISJOINT jobs without a lock table of our own.
   *
   * `QUEUED|READING|PARTIAL` with an expired or absent lease is the resume set: a runner that died
   * mid-file leaves READING rows whose checkpoint the next claimer continues from.
   */
  async claimReadJobs(input: {
    batchSize: number; leaseOwner: string; leaseMs: number; db?: CaptureDb;
  }): Promise<CaptureReadJobRow[]> {
    const batchSize = Math.max(1, Math.min(Math.trunc(input.batchSize) || 1, MAX_CAPTURE_CLAIM_BATCH));
    const claimed: CaptureReadJobRow[] = [];
    // One statement per job, not one per batch: the per-COMPANY ceiling of §4.5 is expressed as
    // "no live lease for this company", and inside a single multi-row UPDATE the subquery sees the
    // pre-update snapshot — five queued jobs of one shop would all pass it at once. Claiming them
    // one at a time makes the second claim see the first one's lease. The batch is at most 5.
    for (let index = 0; index < batchSize; index += 1) {
      const row = await this.claimNextReadJob(input);
      if (!row) break;
      claimed.push(row);
    }
    return claimed;
  }

  /** The claim statement itself: one job, skipping rows and companies another runner holds. */
  async claimNextReadJob(input: { leaseOwner: string; leaseMs: number; db?: CaptureDb }): Promise<CaptureReadJobRow | null> {
    const db = input.db ?? this.prisma.client;
    const rows = await db.$queryRaw<CaptureReadJobRow[]>(Prisma.sql`
      UPDATE "ExpenseCaptureReadJob" j
      SET status = 'READING', "leaseOwner" = ${input.leaseOwner},
          "leasedUntil" = now() + make_interval(secs => ${input.leaseMs / 1000}),
          attempts = j.attempts + 1, "updatedAt" = now()
      WHERE j.id = (
        SELECT id FROM "ExpenseCaptureReadJob"
        WHERE status IN ('QUEUED', 'READING', 'PARTIAL')
          AND ("leasedUntil" IS NULL OR "leasedUntil" < now())
          AND "companyId" NOT IN (
            SELECT "companyId" FROM "ExpenseCaptureReadJob"
            WHERE status IN ('PREPARING', 'READING') AND "leasedUntil" >= now()
          )
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING j.*
    `);
    return rows[0] ?? null;
  }

  /** Claim ONE job by id for the in-process kick, under the same lease rules as the drain. */
  async claimReadJob(input: { jobId: string; leaseOwner: string; leaseMs: number; db?: CaptureDb }): Promise<CaptureReadJobRow | null> {
    const db = input.db ?? this.prisma.client;
    const rows = await db.$queryRaw<CaptureReadJobRow[]>(Prisma.sql`
      UPDATE "ExpenseCaptureReadJob" j
      SET status = 'READING', "leaseOwner" = ${input.leaseOwner},
          "leasedUntil" = now() + make_interval(secs => ${input.leaseMs / 1000}),
          attempts = j.attempts + 1, "updatedAt" = now()
      WHERE j.id = ${input.jobId}
        AND j.status IN ('QUEUED', 'READING', 'PARTIAL')
        AND (j."leasedUntil" IS NULL OR j."leasedUntil" < now())
      RETURNING j.*
    `);
    return rows[0] ?? null;
  }

  /**
   * EVERY write after a claim goes through here. The `leaseOwner` predicate is the fence: a runner
   * whose lease expired and was reclaimed elsewhere matches zero rows and stops silently, instead
   * of overwriting the checkpoint the new owner is building (§4.5).
   */
  async updateJobFenced(input: {
    jobId: string; leaseOwner: string; data: Record<string, unknown>; db?: CaptureDb;
  }): Promise<boolean> {
    const db = input.db ?? this.prisma.client;
    const changed = await db.expenseCaptureReadJob.updateMany({
      where: { id: input.jobId, leaseOwner: input.leaseOwner },
      data: input.data as never,
    });
    return changed.count === 1;
  }

  /** Extend the lease between chunks; a lost lease answers false and the runner stops. */
  renewJobLease(input: { jobId: string; leaseOwner: string; leaseMs: number; db?: CaptureDb }): Promise<boolean> {
    return this.updateJobFenced({
      ...input,
      data: { leasedUntil: new Date(Date.now() + input.leaseMs) },
    });
  }

  /** The page count the group list shows beside "อ่านแล้ว n จาก m หน้า". */
  async setFilePageCount(db: CaptureDb, input: { companyId: string; fileId: string; pageCount: number }): Promise<void> {
    await db.expenseCaptureFile.updateMany({
      where: { companyId: input.companyId, id: input.fileId },
      data: { pageCount: input.pageCount },
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
      select: {
        id: true, captureScopeKey: true, captureAllocationId: true, status: true,
        grandTotalAmount: true, payerUserId: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * W06 §12/A40: the certificate each derived source currently has, so the group can say which shop
   * is issued and which is still waiting. Superseded versions are history, not the current state.
   */
  async listDerivedCertificates(db: CaptureDb, companyId: string, expenseIds: string[]) {
    if (expenseIds.length === 0) return new Map<string, ExpenseCaptureDerivedCertificateDto>();
    const rows = await db.expenseSubstituteReceiptEvidence.findMany({
      where: { companyId, expenseId: { in: expenseIds }, status: { not: 'SUPERSEDED' } },
      select: { id: true, expenseId: true, status: true, signatureMode: true, fundingSource: true, documentNumber: true, version: true },
      orderBy: { version: 'asc' },
    });
    return new Map(rows.map((row) => [row.expenseId, {
      evidenceId: row.id,
      status: row.status as ExpenseCaptureDerivedCertificateDto['status'],
      signatureMode: row.signatureMode as ExpenseCaptureDerivedCertificateDto['signatureMode'],
      fundingSource: row.fundingSource as ExpenseCaptureDerivedCertificateDto['fundingSource'],
      documentNumber: row.documentNumber,
    }]));
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
