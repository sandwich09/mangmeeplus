import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { branchScopeWhere, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';

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
  handoffState: 'NONE' | 'ACTIVE' | 'RELEASED';
  acceptedAllocationId: string | null;
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

  /** The next `version` for a file's observation chain (`@@unique([companyId, fileId, version])`). */
  async nextObservationVersion(db: CaptureDb, companyId: string, fileId: string | null, expenseId: string | null): Promise<number> {
    const last = await db.expenseCaptureObservation.findFirst({
      where: { companyId, ...(fileId ? { fileId } : { expenseId }) },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (last?.version ?? 0) + 1;
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

  /** Derived sources are ordinary expenses; the group only ever reports their lineage. */
  listDerivedSources(db: CaptureDb, companyId: string, groupId: string) {
    return db.expenseRecord.findMany({
      where: { companyId, captureGroupId: groupId },
      select: { id: true, captureScopeKey: true, status: true, grandTotalAmount: true, payerUserId: true },
      orderBy: { id: 'asc' },
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
