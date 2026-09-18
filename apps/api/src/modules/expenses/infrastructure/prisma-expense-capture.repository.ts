import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { branchScopeWhere, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';

export type CaptureDb = Prisma.TransactionClient | PrismaService['client'];

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

  /** Same retention window and batch size as the webhook-log purge it runs beside. */
  async purgeLineIntakeAttempts(cutoff: Date, batchSize = 500, db: CaptureDb = this.prisma.client): Promise<number> {
    const stale = await db.lineIntakeAttempt.findMany({
      where: { createdAt: { lt: cutoff } }, select: { id: true }, take: batchSize,
    });
    if (stale.length === 0) return 0;
    const deleted = await db.lineIntakeAttempt.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    return deleted.count;
  }
}

const ATTEMPT_FILE_NAME_MAX = 80;

/** Path segments dropped, control characters dropped, length capped — a label, not a file name. */
export function sanitizeAttemptFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const base = fileName.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const safe = base.replace(/[ -]/g, '').trim();
  return safe ? safe.slice(0, ATTEMPT_FILE_NAME_MAX) : null;
}
