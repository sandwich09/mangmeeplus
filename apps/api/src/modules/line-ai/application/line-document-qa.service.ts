import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { Prisma } from '../../../generated/prisma/client';
import { LineAiBudgetAuthorityService, documentQaAuthorityInputDigest } from './line-ai-budget-authority.service';
import { PrismaAttachmentRepository } from '../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { lockFundingEvidence } from '../../expenses/infrastructure/substitute-funding.guard';
import { lineConversationId } from './line-conversation-context.service';
import {
  LINE_DOCUMENT_QA_LIMITS,
  LINE_DOCUMENT_QA_READER_VERSION,
  LINE_DOCUMENT_QA_TARGET_TYPE,
  createLineAiInputEvidence,
  lineDocumentQaInputEvidenceText,
  validateLineDocumentQaAttachmentMeta,
  parseLineDocumentQaResult,
  type LineDocumentQaAttachment,
  type LineDocumentQaAdmission,
  parseLineDocumentQaQuestions,
  lineDocumentQaQuestionsCovered,
  type LineDocumentQaQuestion,
  type LineDocumentQaJobStatus,
  type LineDocumentQaResult,
  type AiBudgetGrantV2,
} from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort, type StoredObject } from '../../data-model-core/domain/ports/attachment-storage.port';
import { inspectAttachmentBytes, attachmentInspectionFailureCode } from '../../data-model-core/domain/logic/attachment.logic';

export const LINE_DOCUMENT_QA_FOREGROUND_MS = 40_000;
export const LINE_DOCUMENT_QA_JOB_MS = 15 * 60_000;
export const LINE_DOCUMENT_QA_LEASE_MS = 120_000;
export const LINE_DOCUMENT_QA_RESULT_RETENTION_MS = 24 * 60 * 60_000;
export const LINE_DOCUMENT_QA_RAW_CLEANUP_EVENT = 'line.document_qa.raw_cleanup_requested';

export type LineDocumentQaOwner = {
  companyId: string;
  userId: string;
  membershipId: string;
  ownerEpoch: number;
  channelKind: 'USER';
  messagingChannelId: string;
  chatKeyHash: string;
};

export type LineDocumentQaAdmissionInput = LineDocumentQaOwner & {
  requestId: string;
  turnId: string;
  question: string;
  questions?: LineDocumentQaQuestion[];
  originalBudgetGrantV2: AiBudgetGrantV2;
  originalInputDigest: string;
  attachments: Array<{
    attachmentId: string;
    requestedPages: number[];
  }>;
};

export type LineDocumentQaJobRow = {
  id: string;
  companyId: string;
  userId: string;
  ownerMembershipId: string;
  ownerEpoch: number;
  ownerDigest: string;
  channelKind: string;
  messagingChannelId: string;
  chatKeyHash: string;
  turnId: string;
  attachmentsJson: unknown;
  questionText: string;
  questionsJson?: unknown;
  admittedAt: Date;
  inputDigest: string;
  inputSetHash: string;
  questionDigest: string;
  readerVersion: string;
  status: LineDocumentQaJobStatus;
  revision: number;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  leaseFence: number;
  foregroundDeadlineAt: Date;
  jobDeadlineAt: Date;
  budgetAuthorityJson: unknown;
  budgetAuthorityRevision: number;
  resultJson: unknown;
  resultHash: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  purgeAt: Date;
};

export class LineDocumentQaError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'LineDocumentQaError';
  }
}

const hexHash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
const jsonHash = (value: unknown): string => hexHash(canonical(value));

function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

function isImageMime(mimeType: string): boolean {
  return mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp';
}

@Injectable()
export class LineDocumentQaService {
  @Inject(PrismaAttachmentRepository) private readonly attachmentRepository!: PrismaAttachmentRepository;
  @Inject(PrismaOutboxRepository) private readonly outbox!: PrismaOutboxRepository;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly authority: LineAiBudgetAuthorityService,
  ) {}

  async admit(input: LineDocumentQaAdmissionInput, now = new Date()): Promise<LineDocumentQaAdmission> {
    if (!this.config.lineAiDocumentQaEnabled) throw new LineDocumentQaError('QA_FEATURE_DISABLED');
    this.validateAdmissionShape(input);
    const authenticated = await this.authority.resolveDocumentQaAdmissionOwner(input.originalBudgetGrantV2, input.originalInputDigest);
    if (!authenticated || authenticated.epoch !== input.ownerEpoch || authenticated.owner.companyId !== input.companyId
      || authenticated.owner.userId !== input.userId || authenticated.owner.membershipId !== input.membershipId
      || authenticated.owner.channelKind !== input.channelKind || authenticated.owner.messagingChannelId !== input.messagingChannelId
      || authenticated.owner.chatKeyHash !== input.chatKeyHash) throw new LineDocumentQaError('QA_TURN_AUTHORITY_INVALID');
    if (input.originalBudgetGrantV2.authorityKind !== 'webhook_event' || input.turnId !== input.originalBudgetGrantV2.turnKey) throw new LineDocumentQaError('QA_TURN_AUTHORITY_INVALID');
    if (!await this.ownerCurrent(input)) throw new LineDocumentQaError('QA_OWNER_INVALID');

    const attachments: LineDocumentQaAttachment[] = [];
    for (const requested of input.attachments) {
      const row = await (this.prisma.client as any).attachmentObject.findFirst({
        where: { id: requested.attachmentId, companyId: input.companyId, uploadedByUserId: input.userId, status: 'ACTIVE' },
      });
      if (!row || !row.checksumSha256) throw new LineDocumentQaError('QA_ATTACHMENT_UNAVAILABLE');
      const metadataError = validateLineDocumentQaAttachmentMeta({ mimeType: row.mimeType, byteSize: row.byteSize, requestedPages: requested.requestedPages });
      if (metadataError) throw new LineDocumentQaError(metadataError);
      const object = await this.readVerifiedObject(row);
      const pageCount = await this.validateBytes(row.mimeType, object.bytes);
      if (row.mimeType === 'application/pdf' && requested.requestedPages.some((page) => page > pageCount)) {
        throw new LineDocumentQaError('QA_PAGE_OUT_OF_RANGE');
      }
      if (row.mimeType !== 'application/pdf' && pageCount !== 1) throw new LineDocumentQaError('QA_IMAGE_DECODE_FAILED');
      attachments.push({ attachmentId: row.id, contentHash: row.checksumSha256, mimeType: row.mimeType, byteSize: row.byteSize, requestedPages: [...requested.requestedPages] });
    }

    const ownerDigest = hexHash(canonical({ companyId: input.companyId, userId: input.userId, membershipId: input.membershipId,
      ownerEpoch: input.ownerEpoch, channelKind: input.channelKind, messagingChannelId: input.messagingChannelId, chatKeyHash: input.chatKeyHash }));
    const inputSetHash = hexHash(canonical({ ownerDigest, turnId: input.turnId, readerVersion: LINE_DOCUMENT_QA_READER_VERSION,
      attachments: attachments.map(({ attachmentId, contentHash, requestedPages }) => ({ attachmentId, contentHash, requestedPages })) }));
    const questionDigest = hexHash(canonical({ ownerDigest, turnId: input.turnId, readerVersion: LINE_DOCUMENT_QA_READER_VERSION, question: input.question, ...(input.questions ? { questions: input.questions } : {}) }));
    const inputDigest = documentQaAuthorityInputDigest({ questionText: input.question, attachmentsJson: attachments, questionsJson: input.questions });
    if (!inputDigest) throw new LineDocumentQaError('QA_INPUT_INVALID');
    // The complete question and page manifest must survive the existing v2 wire without clipping.
    const evidenceText = lineDocumentQaInputEvidenceText(input.question, attachments.flatMap(attachment => attachment.requestedPages.map(page => ({
      attachmentId: attachment.attachmentId, page, sourceMimeType: attachment.mimeType, contentHash: attachment.contentHash,
    }))), input.questions);
    if (!await createLineAiInputEvidence({ turnKey: input.turnId, parts: [{ partId: 'qa:manifest', eventIdHash: hexHash(input.requestId),
      acceptedAtMs: input.originalBudgetGrantV2.admittedAtMs, rawText: evidenceText }] })) {
      throw new LineDocumentQaError('QA_INPUT_TOO_LARGE');
    }
    const existing = await (this.prisma.client as any).lineDocumentQaJob.findFirst({ where: {
      ownerDigest, turnId: input.turnId, inputSetHash, questionDigest, readerVersion: LINE_DOCUMENT_QA_READER_VERSION,
    } });
    if (existing) {
      return this.admitSaved(existing, input.originalBudgetGrantV2, inputDigest);
    }

    const admittedAt = new Date(input.originalBudgetGrantV2.admittedAtMs);
    const foregroundDeadlineAt = new Date(admittedAt.getTime() + LINE_DOCUMENT_QA_FOREGROUND_MS);
    const jobDeadlineAt = new Date(admittedAt.getTime() + LINE_DOCUMENT_QA_JOB_MS);
    const purgeAt = new Date(admittedAt.getTime() + LINE_DOCUMENT_QA_RESULT_RETENTION_MS);
    let job: LineDocumentQaJobRow;
    try {
      job = await (this.prisma.client as any).$transaction(async (tx: any) => {
        const raced = await tx.lineDocumentQaJob.findFirst({ where: {
          ownerDigest, turnId: input.turnId, inputSetHash, questionDigest, readerVersion: LINE_DOCUMENT_QA_READER_VERSION,
        } });
        if (raced) return raced;
        const created = await tx.lineDocumentQaJob.create({ data: {
          companyId: input.companyId, userId: input.userId, ownerMembershipId: input.membershipId, ownerEpoch: input.ownerEpoch,
          ownerDigest, channelKind: input.channelKind, messagingChannelId: input.messagingChannelId, chatKeyHash: input.chatKeyHash,
          turnId: input.turnId, questionText: input.question, ...(input.questions ? { questionsJson: input.questions } : {}), admittedAt, attachmentsJson: attachments, inputDigest, inputSetHash, questionDigest,
          readerVersion: LINE_DOCUMENT_QA_READER_VERSION, status: 'QUEUED', revision: 1,
          foregroundDeadlineAt, jobDeadlineAt, expiresAt: jobDeadlineAt,
          purgeAt,
        } });
        // This target is intentionally not readable through generic attachment routes. QA delivery
        // rechecks the full owner and current attachment state before using it.
        for (const attachment of attachments) await tx.attachmentLink.create({ data: {
          companyId: input.companyId, attachmentId: attachment.attachmentId, targetType: LINE_DOCUMENT_QA_TARGET_TYPE,
          targetId: created.id, purpose: 'question-only', linkedByUserId: input.userId,
        } });
        return created;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const raced = await (this.prisma.client as any).lineDocumentQaJob.findFirst({ where: {
          ownerDigest, turnId: input.turnId, inputSetHash, questionDigest, readerVersion: LINE_DOCUMENT_QA_READER_VERSION,
        } });
        if (raced) return this.admitSaved(raced, input.originalBudgetGrantV2, inputDigest);
      }
      throw error;
    }

    return this.admitSaved(job, input.originalBudgetGrantV2, inputDigest);
  }

  private async admitSaved(job: LineDocumentQaJobRow, grant: AiBudgetGrantV2, inputDigest: string): Promise<LineDocumentQaAdmission> {
    if (!job.budgetAuthorityJson && !await this.authority.transferToDocumentQa(grant, job.id, inputDigest)) {
      // Do not claim a queued job whose authority was never durably accepted.
      throw new LineDocumentQaError('QA_BUDGET_UNAVAILABLE');
    }
    return this.toAdmission(await this.getById(job.id));
  }

  async claimNext(leaseOwner: string, batchSize = 1, now = new Date()): Promise<LineDocumentQaJobRow[]> {
    const claimed: LineDocumentQaJobRow[] = [];
    for (let count = 0; count < Math.max(1, Math.min(batchSize, 2)); count += 1) {
      const rows = await (this.prisma.client as any).$queryRaw`
        WITH candidate AS (
          SELECT "id" FROM "LineDocumentQaJob"
          WHERE "status" IN ('QUEUED', 'READING')
            AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${now})
            AND "budgetAuthorityJson" IS NOT NULL
            AND "jobDeadlineAt" > ${now}
          ORDER BY "createdAt", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "LineDocumentQaJob" AS job
        SET "status" = 'READING', "leaseOwner" = ${leaseOwner}, "leaseUntil" = ${new Date(now.getTime() + LINE_DOCUMENT_QA_LEASE_MS)},
            "leaseFence" = job."leaseFence" + 1, "updatedAt" = CURRENT_TIMESTAMP
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING job.*`;
      if (!rows[0]) break;
      claimed.push(rows[0] as LineDocumentQaJobRow);
    }
    return claimed;
  }

  async claim(jobId: string, leaseOwner: string, now = new Date()): Promise<LineDocumentQaJobRow | null> {
    const rows = await (this.prisma.client as any).$queryRaw`
      UPDATE "LineDocumentQaJob"
      SET "status" = 'READING', "leaseOwner" = ${leaseOwner}, "leaseUntil" = ${new Date(now.getTime() + LINE_DOCUMENT_QA_LEASE_MS)},
          "leaseFence" = "leaseFence" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${jobId} AND "status" IN ('QUEUED', 'READING')
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${now}) AND "budgetAuthorityJson" IS NOT NULL AND "jobDeadlineAt" > ${now}
      RETURNING *`;
    return (rows[0] as LineDocumentQaJobRow | undefined) ?? null;
  }

  async renew(job: LineDocumentQaJobRow, leaseOwner: string): Promise<boolean> {
    return (await (this.prisma.client as any).lineDocumentQaJob.updateMany({ where: {
      id: job.id, status: 'READING', leaseOwner, leaseFence: job.leaseFence, leaseUntil: { gt: new Date() }, jobDeadlineAt: { gt: new Date() },
    }, data: { leaseUntil: new Date(Date.now() + LINE_DOCUMENT_QA_LEASE_MS) } })).count === 1;
  }

  /** Rechecks the full private owner and every source byte before a provider call. */
  async canRun(job: LineDocumentQaJobRow): Promise<boolean> {
    const live = await this.prisma.client.lineDocumentQaJob.findFirst({ where: { id: job.id, status: 'READING', leaseOwner: job.leaseOwner,
      leaseFence: job.leaseFence, revision: job.revision, leaseUntil: { gt: new Date() }, jobDeadlineAt: { gt: new Date() } }, select: { id: true } });
    return !!live && await this.ownerCurrent(job) && await this.attachmentsCurrent(job);
  }

  async readJobAttachment(job: LineDocumentQaJobRow, attachmentId: string, contentHash: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const row = await (this.prisma.client as any).attachmentObject.findFirst({ where: {
      id: attachmentId, companyId: job.companyId, uploadedByUserId: job.userId, status: 'ACTIVE', checksumSha256: contentHash,
    }, select: { id: true, companyId: true, storageProvider: true, bucket: true, objectKey: true, objectVersionId: true, byteSize: true, checksumSha256: true, mimeType: true } });
    if (!row) throw new LineDocumentQaError('QA_SOURCE_CHANGED');
    const object = await this.readVerifiedObject(row);
    return { bytes: object.bytes, mimeType: row.mimeType };
  }

  async markAnswerReady(job: LineDocumentQaJobRow, leaseOwner: string, result: LineDocumentQaResult): Promise<boolean> {
    const now = new Date();
    const parsed = parseLineDocumentQaResult(result);
    const questions = job.questionsJson == null ? undefined : parseLineDocumentQaQuestions(job.questionsJson, job.questionText);
    if (!parsed || job.questionsJson != null && !questions || !lineDocumentQaQuestionsCovered(parsed, questions) || !(await this.ownerCurrent(job)) || !(await this.attachmentsCurrent(job))) return false;
    const requested = new Set((job.attachmentsJson as LineDocumentQaAttachment[]).flatMap((attachment) => attachment.requestedPages.map((page) => `${attachment.attachmentId}:${page}`)));
    const coverage = parsed.coverage;
    const read = new Set(coverage.read.map((item) => `${item.attachmentId}:${item.page}`));
    const failed = new Set(coverage.failed.map((item) => `${item.attachmentId}:${item.page}`));
    if (coverage.requested.length !== requested.size || coverage.requested.some((item) => !requested.has(`${item.attachmentId}:${item.page}`))
      || read.size + failed.size !== requested.size || [...read].some((key) => failed.has(key))
      || [...read, ...failed].some((key) => !requested.has(key)) || new TextEncoder().encode(JSON.stringify(parsed)).byteLength > LINE_DOCUMENT_QA_LIMITS.maxResultBytes) return false;
    const resultHash = jsonHash(parsed);
    return (await (this.prisma.client as any).lineDocumentQaJob.updateMany({ where: {
      id: job.id, status: 'READING', leaseOwner, leaseFence: job.leaseFence, revision: job.revision, leaseUntil: { gt: now }, jobDeadlineAt: { gt: now },
    }, data: { status: 'ANSWER_READY', resultJson: parsed, resultHash, revision: { increment: 1 }, leaseOwner: null, leaseUntil: null, errorCode: null } })).count === 1;
  }

  async markFailed(job: LineDocumentQaJobRow, leaseOwner: string, errorCode: string): Promise<boolean> {
    return (await (this.prisma.client as any).lineDocumentQaJob.updateMany({ where: {
      id: job.id, status: 'READING', leaseOwner, leaseFence: job.leaseFence, revision: job.revision, leaseUntil: { gt: new Date() },
    }, data: { status: 'FAILED', errorCode: errorCode.slice(0, 128), revision: { increment: 1 }, leaseOwner: null, leaseUntil: null } })).count === 1;
  }

  async cancel(jobId: string, owner: LineDocumentQaOwner, reason = 'CANCELED'): Promise<boolean> {
    return (await (this.prisma.client as any).lineDocumentQaJob.updateMany({ where: {
      id: jobId, companyId: owner.companyId, userId: owner.userId, ownerMembershipId: owner.membershipId, ownerEpoch: owner.ownerEpoch,
      channelKind: owner.channelKind, messagingChannelId: owner.messagingChannelId, chatKeyHash: owner.chatKeyHash,
      status: { in: ['QUEUED', 'READING'] },
    }, data: { status: 'CANCELED', errorCode: reason.slice(0, 128), revision: { increment: 1 }, leaseOwner: null, leaseUntil: null } })).count === 1;
  }

  async expireDue(now = new Date()): Promise<number> {
    const updated = await (this.prisma.client as any).lineDocumentQaJob.updateMany({ where: {
      status: { in: ['QUEUED', 'READING'] }, jobDeadlineAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    }, data: { status: 'EXPIRED', errorCode: 'QA_JOB_DEADLINE', revision: { increment: 1 }, leaseOwner: null, leaseUntil: null } });
    return updated.count;
  }

  async getForDelivery(jobId: string, owner: LineDocumentQaOwner): Promise<LineDocumentQaJobRow | null> {
    const job = await this.getById(jobId);
    if (!job || documentQaAuthorityInputDigest(job) !== job.inputDigest || job.status !== 'ANSWER_READY' || job.purgeAt <= new Date() || !parseLineDocumentQaResult(job.resultJson)
      || job.resultHash !== jsonHash(job.resultJson) || job.companyId !== owner.companyId || job.userId !== owner.userId
      || job.ownerMembershipId !== owner.membershipId || job.ownerEpoch !== owner.ownerEpoch || job.channelKind !== owner.channelKind
      || job.messagingChannelId !== owner.messagingChannelId || job.chatKeyHash !== owner.chatKeyHash
      || !await this.ownerCurrent(owner) || !await this.attachmentsCurrent(job)) return null;
    return job;
  }

  buildDeliveryProof(job: LineDocumentQaJobRow): Record<string, unknown> {
    const result = parseLineDocumentQaResult(job.resultJson);
    if (job.status !== 'ANSWER_READY' || !result || job.resultHash !== jsonHash(result)) throw new LineDocumentQaError('QA_RESULT_INVALID');
    return { kind: 'LINE_DOCUMENT_QA', jobId: job.id, jobRevision: job.revision, inputSetHash: job.inputSetHash,
      resultHash: job.resultHash, attachments: job.attachmentsJson, pageCoverage: result.coverage };
  }

  async verifyDeliveryProof(proof: Record<string, unknown>, owner: LineDocumentQaOwner): Promise<boolean> {
    if (proof.kind !== 'LINE_DOCUMENT_QA' || typeof proof.jobId !== 'string') return false;
    try {
      const job = await this.getForDelivery(proof.jobId, owner);
      if (!job || canonical(proof) !== canonical(this.buildDeliveryProof(job))) return false;
      const selected = (job.attachmentsJson as LineDocumentQaAttachment[]).map(item => item.attachmentId);
      const pending = await this.prisma.client.lineIntakePendingMedia.findMany({ where: {
        readJobId: job.id, companyId: owner.companyId, userId: owner.userId, membershipId: owner.membershipId,
        lifecycleEpoch: owner.ownerEpoch, channelKind: owner.channelKind, messagingChannelId: owner.messagingChannelId,
        chatKeyHash: owner.chatKeyHash, status: { in: ['PENDING', 'RESOLVED_RECEIPT'] }, attachmentId: { in: selected },
      }, select: { attachmentId: true } });
      const current = new Set(pending.map(row => row.attachmentId));
      return selected.length > 0 && selected.every(id => current.has(id));
    } catch { return false; }
  }

  async purgeExpired(now = new Date()): Promise<number> {
    // Clear raw material for failures too: they may never have a resultJson.
    const rows = await this.prisma.client.lineDocumentQaJob.findMany({ where: { purgeAt: { lte: now },
      status: { in: ['ANSWER_READY', 'FAILED', 'EXPIRED', 'CANCELED'] }, questionText: { not: '' } }, select: { id: true, companyId: true } });
    const purged = !rows.length ? 0 : await this.prisma.client.$transaction(async tx => {
      for (const row of rows) await tx.attachmentLink.deleteMany({ where: { companyId: row.companyId, targetType: LINE_DOCUMENT_QA_TARGET_TYPE, targetId: row.id } });
      const changed = await tx.lineDocumentQaJob.updateMany({ where: { id: { in: rows.map(row => row.id) }, purgeAt: { lte: now } },
        data: { resultJson: Prisma.DbNull, questionText: '', questionsJson: Prisma.DbNull, attachmentsJson: [] } });
      await tx.lineIntakePendingMedia.updateMany({ where: { readJobId: { in: rows.map(row => row.id) } },
        data: { caption: null, askedQuestionJson: Prisma.DbNull, status: 'EXPIRED', expiresAt: now, revision: { increment: 1 } } });
      return changed.count;
    });
    await this.purgeQaOnlyOrphans(now);
    await this.drainRawCleanup();
    return purged;
  }

  private async purgeQaOnlyOrphans(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - LINE_DOCUMENT_QA_RESULT_RETENTION_MS);
    const candidates = await this.prisma.client.attachmentObject.findMany({ where: { createdAt: { lte: cutoff },
      // Only files created for QA are ours to purge. Borrowed files keep domain retention.
      metadataJson: { path: ['lineDocumentQaOnly'], equals: true },
      links: { none: {} }, status: { in: ['ACTIVE', 'DELETED'] } }, take: 50 });
    for (const row of candidates) {
      if (row.storageProvider !== 'db' && !row.objectVersionId) continue;
      try {
        await this.prisma.client.$transaction(async tx => {
          await lockFundingEvidence(tx, row.companyId, { attachmentIds: [row.id], expenseIds: [] });
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${row.companyId}:${row.id}:attachment-retention`}))`;
          // FOR UPDATE conflicts with FK inserts. A concurrent new domain link either commits
          // before the checks below or fails after deletion; it cannot reference a purged blob.
          const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
            SELECT "id", "status" FROM "AttachmentObject" WHERE "id" = ${row.id}
              AND "companyId" = ${row.companyId} FOR UPDATE`;
          if (!locked[0] || !['ACTIVE', 'DELETED'].includes(locked[0].status)) return;
          if (await tx.attachmentLink.count({ where: { attachmentId: row.id } })
            || await tx.expenseCaptureFile.count({ where: { attachmentId: row.id } })
            || await tx.reimbursementLine.count({ where: { attachmentId: row.id } })
            || await tx.companyTaxCodeProfile.count({ where: { sourceAttachmentId: row.id } })) return;
          if (locked[0].status !== 'DELETED') await this.attachmentRepository.markDeleted({ id: row.id, companyId: row.companyId }, tx);
          else if (await this.attachmentRepository.findSubstituteEvidenceRetentionHold({ id: row.id, companyId: row.companyId }, tx)) return;
          if (row.storageProvider !== 'db') await this.outbox.append({ companyId: row.companyId,
            eventType: LINE_DOCUMENT_QA_RAW_CLEANUP_EVENT, aggregateType: 'LineDocumentQaAttachment', aggregateId: row.id,
            eventKey: `${LINE_DOCUMENT_QA_RAW_CLEANUP_EVENT}:${row.id}`,
            payloadJson: { companyId: row.companyId, attachmentId: row.id, bucket: row.bucket, path: row.objectKey,
              version: row.objectVersionId, storageProvider: row.storageProvider },
          }, tx);
          // New FK references cannot race this deletion. DB bytes cascade atomically; other
          // storage is deleted only after the durable outbox and orphan removal both commit.
          await tx.attachmentObject.delete({ where: { id: row.id } });
        });
      } catch { /* A new reference/retention hold or a DB race rolls back; retry next tick. */ }
    }
  }

  private async drainRawCleanup(): Promise<void> {
    const events = await this.outbox.claimBatch({ batchSize: 10, claimedBy: 'line-document-qa-retention', eventTypes: [LINE_DOCUMENT_QA_RAW_CLEANUP_EVENT] });
    for (const event of events) {
      const payload = event.payloadJson;
      const fence = { id: event.id, claimToken: event.claimToken ?? null, expectedEventType: LINE_DOCUMENT_QA_RAW_CLEANUP_EVENT };
      try {
        if (payload.companyId !== event.companyId || payload.attachmentId !== event.aggregateId
          || payload.storageProvider !== (this.config.s3Bucket ? 's3' : 'local') || typeof payload.bucket !== 'string'
          || this.config.s3Bucket && payload.bucket !== this.config.s3Bucket
          || typeof payload.path !== 'string' || typeof payload.version !== 'string' || !payload.version
          || await this.prisma.client.attachmentObject.count({ where: { bucket: payload.bucket, objectKey: payload.path } })) {
          throw new Error('QA_RAW_CLEANUP_REFERENCE_INVALID');
        }
        const location = { bucket: payload.bucket, objectKey: payload.path, objectVersionId: payload.version };
        // Storage implementations pin reads/deletes to this original version; never delete a
        // later replacement or reinterpret a failed request as a completed purge.
        const metadata = await this.storage.getObjectMetadata(location);
        if (metadata.exists) {
          if (metadata.objectVersionId !== payload.version) throw new Error('QA_RAW_CLEANUP_VERSION_CHANGED');
          await this.storage.deleteObject(location);
        }
        await this.outbox.markPublished(fence);
      } catch {
        await this.outbox.markFailed({ ...fence, error: 'QA_RAW_CLEANUP_FAILED' });
      }
    }
  }

  async getById(jobId: string): Promise<LineDocumentQaJobRow> {
    const row = await (this.prisma.client as any).lineDocumentQaJob.findUnique({ where: { id: jobId } });
    if (!row) throw new LineDocumentQaError('QA_JOB_NOT_FOUND');
    return row as LineDocumentQaJobRow;
  }

  private validateAdmissionShape(input: LineDocumentQaAdmissionInput): void {
    if (input.questions !== undefined && !parseLineDocumentQaQuestions(input.questions, input.question)) throw new LineDocumentQaError('QA_QUESTIONS_INVALID');
    if (!input.turnId || !input.requestId || !input.companyId || !input.userId || !input.membershipId || !input.messagingChannelId || !input.chatKeyHash
      || !Number.isSafeInteger(input.ownerEpoch) || input.ownerEpoch < 0) throw new LineDocumentQaError('QA_ADMISSION_INVALID');
    if (input.channelKind !== 'USER' || !/^[0-9a-f]{64}$/.test(input.originalInputDigest) || typeof input.question !== 'string'
      || input.question.length > 12000 || !input.question.trim() || new TextEncoder().encode(input.question).byteLength > LINE_DOCUMENT_QA_LIMITS.maxQuestionBytes) throw new LineDocumentQaError('QA_QUESTION_INVALID');
    if (!Array.isArray(input.attachments) || input.attachments.length < 1 || input.attachments.length > LINE_DOCUMENT_QA_LIMITS.maxAttachments) throw new LineDocumentQaError('QA_ATTACHMENT_COUNT');
    let pages = 0;
    const ids = new Set<string>();
    for (const attachment of input.attachments) {
      if (!attachment || typeof attachment.attachmentId !== 'string' || !Array.isArray(attachment.requestedPages)) throw new LineDocumentQaError('QA_ATTACHMENT_INVALID');
      if (ids.has(attachment.attachmentId)) throw new LineDocumentQaError('QA_DUPLICATE_ATTACHMENT');
      ids.add(attachment.attachmentId);
      pages += attachment.requestedPages.length;
      if (pages > LINE_DOCUMENT_QA_LIMITS.maxSelectedPages) throw new LineDocumentQaError('QA_PAGE_COUNT');
    }
  }

  private async readVerifiedObject(row: any): Promise<StoredObject> {
    const stored = row.storageProvider === 'db'
      ? await this.prisma.client.attachmentBlob.findFirst({ where: { attachmentId: row.id, companyId: row.companyId }, select: { data: true } }) : null;
    const object = row.storageProvider === 'db' ? stored ? { bytes: Buffer.from(stored.data) } : null
      : await this.storage.getObject({ bucket: row.bucket, objectKey: row.objectKey, ...(row.objectVersionId ? { objectVersionId: row.objectVersionId } : {}) });
    if (!object) throw new LineDocumentQaError('QA_SOURCE_UNAVAILABLE');
    if (object.bytes.byteLength !== row.byteSize || hexHash(object.bytes) !== row.checksumSha256) throw new LineDocumentQaError('QA_SOURCE_CHANGED');
    return object;
  }

  private async validateBytes(mimeType: string, bytes: Buffer): Promise<number> {
    if (isImageMime(mimeType)) {
      if (mimeType === 'image/webp' ? !isWebp(bytes) : inspectAttachmentBytes(mimeType, bytes)) throw new LineDocumentQaError('QA_MAGIC_INVALID');
      try {
        const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
        if (!metadata.width || !metadata.height) throw new Error('decode');
      } catch {
        throw new LineDocumentQaError('QA_IMAGE_DECODE_FAILED');
      }
      return 1;
    }
    const inspectionError = inspectAttachmentBytes(mimeType, bytes);
    if (inspectionError) throw new LineDocumentQaError(attachmentInspectionFailureCode(inspectionError) === 'EMBEDDED_FILE_REJECTED' ? 'EMBEDDED_FILE_REJECTED' : 'QA_MAGIC_INVALID');
    try {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
      const pages = pdf.getPageCount();
      if (pages < 1 || pages > LINE_DOCUMENT_QA_LIMITS.maxPagesPerPdf) throw new LineDocumentQaError('QA_PAGE_COUNT');
      return pages;
    } catch (error) {
      if (error instanceof LineDocumentQaError) throw error;
      throw new LineDocumentQaError(/encrypt/i.test(String(error)) ? 'QA_PASSWORD_PDF' : 'QA_PDF_UNAVAILABLE');
    }
  }

  private async ownerCurrent(input: LineDocumentQaOwner | LineDocumentQaJobRow): Promise<boolean> {
    const companyId = input.companyId, userId = input.userId, membershipId = 'membershipId' in input ? input.membershipId : input.ownerMembershipId;
    const epoch = input.ownerEpoch;
    const channelId = input.messagingChannelId;
    const channel = channelId === this.config.lineMessagingChannelId || await (this.prisma.client as any).lineChannelBinding.findFirst({ where: { companyId, messagingChannelId: channelId, status: 'ACTIVE', company: { status: 'ACTIVE' } }, select: { id: true } });
    if (!channel) return false;
    const member = await (this.prisma.client as any).companyMembership.findFirst({ where: { id: membershipId, companyId, userId, status: 'ACTIVE', user: { status: 'ACTIVE', aiAssistantOptOutAt: null }, company: { status: 'ACTIVE' } }, select: { id: true } });
    if (!member) return false;
    const conversationId = lineConversationId({ companyId, userId, membershipId, channel: 'line', channelKind: 'USER', messagingChannelId: channelId, chatKeyHash: input.chatKeyHash });
    const conversation = await (this.prisma.client as any).aiConversation.findFirst({ where: { id: conversationId, companyId, userId, membershipId, channel: 'line', channelKind: 'USER', messagingChannelId: channelId, chatKeyHash: input.chatKeyHash, lifecycleEpoch: epoch }, select: { id: true } });
    return Boolean(conversation);
  }

  private async attachmentsCurrent(job: LineDocumentQaJobRow): Promise<boolean> {
    const attachments = Array.isArray(job.attachmentsJson) ? job.attachmentsJson as LineDocumentQaAttachment[] : [];
    if (!attachments.length) return false;
    for (const attachment of attachments) {
      const row = await (this.prisma.client as any).attachmentObject.findFirst({ where: { id: attachment.attachmentId, companyId: job.companyId, uploadedByUserId: job.userId, status: 'ACTIVE', checksumSha256: attachment.contentHash }, select: { id: true, companyId: true, storageProvider: true, bucket: true, objectKey: true, objectVersionId: true, byteSize: true, checksumSha256: true } });
      if (!row) return false;
      const link = await (this.prisma.client as any).attachmentLink.findFirst({ where: { companyId: job.companyId, attachmentId: attachment.attachmentId,
        targetType: LINE_DOCUMENT_QA_TARGET_TYPE, targetId: job.id, purpose: 'question-only', linkedByUserId: job.userId }, select: { id: true } });
      if (!link) return false;
      try { await this.readVerifiedObject(row); } catch { return false; }
    }
    return true;
  }

  private toAdmission(job: LineDocumentQaJobRow): LineDocumentQaAdmission {
    return { kind: 'QUESTION_ONLY', jobId: job.id, jobRevision: job.revision, turnId: job.turnId, inputSetHash: job.inputSetHash,
      questionDigest: job.questionDigest, foregroundDeadlineAt: job.foregroundDeadlineAt.toISOString(), jobDeadlineAt: job.jobDeadlineAt.toISOString(), status: job.status };
  }
}
