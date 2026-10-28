import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { expenseDateIsReadable, emptyExpenseCaptureReadManifest, type RequestContext } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import {
  EXPENSE_CAPTURE_EVIDENCE_PURPOSE,
  EXPENSE_CAPTURE_GROUP_TARGET_TYPE,
} from '../../../data-model-core/domain/logic/attachment.logic';
import { expenseCaptureWebPath } from '../../domain/logic/expense-capture.logic';
import { PrismaExpenseCaptureRepository } from '../../infrastructure/prisma-expense-capture.repository';
import { lockFundingEvidence } from '../../infrastructure/substitute-funding.guard';
import { ExpenseCaptureReadRunnerService } from '../services/expense-capture-read-runner.service';

/** How far back a second LINE file may still be asking about the SAME work (appendix §3, A45). */
export const LINE_CAPTURE_SAME_WORK_WINDOW_MS = 30 * 60 * 1000;

/** The group note is a caption the customer typed — bounded, never a document. */
export const LINE_CAPTURE_NOTE_MAX_CHARS = 500;

export type LineCaptureGroupSummary = {
  groupId: string;
  status: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  webPath: string;
  firstFileName: string | null;
};

/**
 * The LINE-only primitives of the capture aggregate (appendix §3 LINE column).
 *
 * It exists as its own use case rather than more methods on `expense-capture-group.use-case.ts`
 * because everything here is answering a QUESTION THE CHAT ASKED — which group a second file
 * belongs to, whether an already-failed read should ever be retried, which group this
 * `lineMessageId` already produced. The web lane has none of those questions, and the group
 * aggregate should not grow a LINE vocabulary to serve them.
 *
 * Every write reuses W01's repository and its §2.4 lock order; nothing here bypasses a permission
 * check, because the caller (`AddExpenseCaptureFileUseCase` / `CompleteExpenseCaptureFileUseCase`
 * / this file's own `ctx` guards) has already made them.
 */
@Injectable()
export class ExpenseCaptureLineUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly runner?: ExpenseCaptureReadRunnerService,
  ) {}

  /**
   * Appendix §25: the LINE `file` lane owns an ORDINARY expense now, so its read is an
   * `ownerType EXPENSE` job — the same job the web PDF lane queues, which is what makes the
   * auto-split and the §17.6 copy identical on both lanes.
   *
   * Idempotent on (expense, attachment, bytes), like `queueCaptureRead` on the web side: a
   * redelivered LINE message must never buy a second read of the same document.
   */
  async queueExpenseRead(input: {
    companyId: string;
    expenseId: string;
    attachmentId: string;
    attachmentChecksum?: string | null;
    objectVersionId?: string | null;
    expectedSourceUpdatedAt?: Date | null;
  }): Promise<string> {
    const existing = await this.capture.findLiveJobForAttachment(this.capture.client, {
      companyId: input.companyId, expenseId: input.expenseId,
      attachmentId: input.attachmentId, attachmentChecksum: input.attachmentChecksum ?? '',
    });
    const job = existing ?? await this.capture.createReadJob(this.capture.client, {
      companyId: input.companyId, ownerType: 'EXPENSE', expenseId: input.expenseId,
      attachmentId: input.attachmentId, attachmentChecksum: input.attachmentChecksum ?? '',
      objectVersionId: input.objectVersionId ?? null,
      ocrAdmissionRequestId: randomUUID(),
      manifestJson: emptyExpenseCaptureReadManifest(),
      ...(input.expectedSourceUpdatedAt ? { expectedSourceUpdatedAt: input.expectedSourceUpdatedAt } : {}),
    });
    // Fire-and-forget: the reply already says "เก็บไฟล์แล้ว กำลังอ่านเอกสาร", and the scan worker
    // picks the job up anyway if this process never gets to it.
    this.runner?.kick(job.id);
    return job.id;
  }

  /**
   * What the LINE result push needs about a finished EXPENSE-owned read (appendix §25). The CALLER
   * re-checks access before it speaks; this only reports what the record holds.
   */
  /** Recipient metadata only: the notifier must establish a private chat before reading results. */
  async readLineDeliveryOwner(companyId: string, owner: { expenseId?: string; groupId?: string }): Promise<{ createdByUserId: string; lineChatKeyHash: string | null; linePushTargetId: string | null; sourceIsLine: boolean; branchId?: string | null; ownerBinding?: { conversationId: string; membershipId: string; channelId: string; ownerEpoch: number } } | null> {
    if (owner.expenseId) {
      const row = await this.prisma.client.expenseRecord.findFirst({ where: { companyId, id: owner.expenseId }, select: { createdByUserId: true, branchId: true, captureSource: true, sourceChannelMetadataJson: true } });
      if (!row) return null;
      const channel = row.sourceChannelMetadataJson as { chatKeyHash?: string; pushTargetId?: string; ownerBinding?: { conversationId: string; membershipId: string; channelId: string; ownerEpoch: number } } | null;
      return { createdByUserId: row.createdByUserId, branchId: row.branchId, ...(channel?.ownerBinding ? { ownerBinding: channel.ownerBinding } : {}), lineChatKeyHash: channel?.chatKeyHash ?? null, linePushTargetId: channel?.pushTargetId ?? null, sourceIsLine: row.captureSource === 'LINE_UPLOAD' };
    }
    if (!owner.groupId) return null;
    const row = await this.prisma.client.expenseCaptureGroup.findFirst({ where: { companyId, id: owner.groupId }, select: { createdByUserId: true, branchId: true, lineChatKeyHash: true, linePushTargetId: true, intakeChannel: true } });
    return row ? { ...row, sourceIsLine: row.intakeChannel === 'LINE' } : null;
  }

  /** Immutable notification proof projection; this method never hands off, deletes, or reruns OCR. */
  async readFinishedDeliveryProof(ctx: RequestContext, expenseId: string, jobId: string, recordIds: string[]) {
    if (!recordIds.length || recordIds.length > 5 || new Set(recordIds).size !== recordIds.length || !recordIds.includes(expenseId)) return null;
    const records = await this.prisma.client.expenseRecord.findMany({ where: { companyId: ctx.companyId, id: { in: recordIds }, createdByUserId: ctx.userId },
      select: { id: true, branchId: true, status: true, updatedAt: true, createdAt: true, grandTotalAmount: true, currency: true, vendorNameSnapshot: true, expenseDate: true, sourceDocumentType: true, sourceChannelMetadataJson: true, voidReason: true, voidedAt: true } });
    if (records.length !== recordIds.length || records.some(record => !isBranchInScope(ctx.scopes ?? {}, record.branchId))) return null;
    const job = await this.prisma.client.expenseCaptureReadJob.findFirst({ where: { id: jobId, companyId: ctx.companyId, expenseId, status: { in: ['DONE', 'PARTIAL', 'FAILED', 'PAUSED'] } },
      select: { id: true, status: true, updatedAt: true, manifestJson: true, lastErrorCode: true, pausedReason: true } });
    if (!job) return null;
    return { records: recordIds.map(id => records.find(record => record.id === id)!), job };
  }

  async readFinishedExpenseSnapshot(companyId: string, expenseId: string): Promise<{
    expense: {
      id: string; status: string; captureSource: string; createdByUserId: string; branchId: string | null;
      lineChatKeyHash: string | null; linePushTargetId: string | null; language?: 'th' | 'en';
      vendorNameSnapshot: string | null; grandTotalAmount: string | null; currency: string | null;
      sourceDocumentType: string | null; expenseDate: Date | null; primaryAttachmentId: string | null;
      vendorDocumentNumber: string | null; categoryName: string | null; vatAmount: string | null; vatMode: string;
    };
    jobs: Array<{ id: string; status: string; pausedReason: string | null; lastErrorCode: string | null }>;
  } | null> {
    const expense = await this.prisma.client.expenseRecord.findFirst({
      where: { companyId, id: expenseId },
      select: {
        id: true, status: true, captureSource: true, createdByUserId: true, branchId: true,
        sourceChannelMetadataJson: true, vendorNameSnapshot: true, grandTotalAmount: true,
        currency: true, sourceDocumentType: true, expenseDate: true, aiVerificationSummaryJson: true, primaryAttachmentId: true,
        vendorDocumentNumber: true, expenseCategory: { select: { name: true } }, vatAmount: true, vatMode: true,
      },
    });
    if (!expense) return null;
    const channel = (expense.sourceChannelMetadataJson ?? null) as { chatKeyHash?: string; pushTargetId?: string; language?: 'th' | 'en' } | null;
    const jobs = await this.prisma.client.expenseCaptureReadJob.findMany({
      where: { companyId, expenseId },
      orderBy: { createdAt: 'desc' }, take: 3,
      select: { id: true, status: true, pausedReason: true, lastErrorCode: true },
    });
    return {
      expense: {
        id: expense.id, status: expense.status, captureSource: expense.captureSource,
        createdByUserId: expense.createdByUserId, branchId: expense.branchId,
        ...(channel?.language === 'th' || channel?.language === 'en' ? { language: channel.language } : {}),
        lineChatKeyHash: channel?.chatKeyHash ?? null,
        linePushTargetId: channel?.pushTargetId ?? null,
        vendorNameSnapshot: expense.vendorNameSnapshot,
        grandTotalAmount: expense.grandTotalAmount === null ? null : String(expense.grandTotalAmount),
        currency: expense.currency, sourceDocumentType: expense.sourceDocumentType,
        expenseDate: expenseDateIsReadable(expense.aiVerificationSummaryJson as Record<string, unknown> | null) ? expense.expenseDate : null, primaryAttachmentId: expense.primaryAttachmentId,
        vendorDocumentNumber: expense.vendorDocumentNumber, categoryName: expense.expenseCategory?.name ?? null,
        vatAmount: expense.vatAmount === null ? null : String(expense.vatAmount), vatMode: expense.vatMode,
      },
      jobs,
    };
  }

  /**
   * The redelivery answer. `(companyId, lineMessageId)` is unique on `ExpenseCaptureFile` (W01), so
   * one LINE message can only ever have produced one group — a second delivery of the same message
   * reuses it instead of storing the bytes twice.
   */
  async findGroupByLineMessageId(companyId: string, lineMessageId: string): Promise<
    (LineCaptureGroupSummary & { fileId: string; attachmentId: string; uploadState: string }) | null
  > {
    const file = await this.prisma.client.expenseCaptureFile.findFirst({
      where: { companyId, lineMessageId },
    });
    if (!file) return null;
    const group = await this.capture.findGroup(this.capture.client, companyId, file.groupId);
    if (!group) return null;
    return {
      groupId: group.id, status: group.status, note: group.note,
      createdAt: group.createdAt, updatedAt: group.updatedAt,
      webPath: expenseCaptureWebPath(companyId, group.id),
      firstFileName: file.originalFileName,
      fileId: file.id, attachmentId: file.attachmentId, uploadState: file.uploadState,
    };
  }

  /**
   * A45: the OPEN LINE groups this user already has in THIS chat inside the same-work window.
   * Time alone never merges anything (appendix §3) — this only decides whether a question is owed.
   */
  async listOpenSameWorkGroups(input: {
    companyId: string; userId: string; lineChatKeyHash: string; now?: Date; take?: number;
    /** §17.5 asks over a longer window than A45's merge question; A45 omits it. */
    windowMs?: number;
  }): Promise<LineCaptureGroupSummary[]> {
    const since = new Date((input.now?.getTime() ?? Date.now()) - (input.windowMs ?? LINE_CAPTURE_SAME_WORK_WINDOW_MS));
    const groups = await this.prisma.client.expenseCaptureGroup.findMany({
      where: {
        companyId: input.companyId, createdByUserId: input.userId, intakeChannel: 'LINE',
        lineChatKeyHash: input.lineChatKeyHash, status: 'OPEN', updatedAt: { gte: since },
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(input.take ?? 3, 10),
    });
    const names = await this.prisma.client.expenseCaptureFile.findMany({
      where: { companyId: input.companyId, groupId: { in: groups.map((row) => row.id) } },
      orderBy: { position: 'asc' },
      select: { groupId: true, originalFileName: true },
    });
    const firstName = new Map<string, string>();
    for (const row of names) if (!firstName.has(row.groupId)) firstName.set(row.groupId, row.originalFileName);
    return groups.map((group) => ({
      groupId: group.id, status: group.status, note: group.note,
      createdAt: group.createdAt, updatedAt: group.updatedAt,
      webPath: expenseCaptureWebPath(input.companyId, group.id),
      firstFileName: firstName.get(group.id) ?? null,
    }));
  }

  /**
   * §17.5 "ไฟล์เมื่อกี้…" for work that is still work: the OPEN groups of THIS chat, newest first,
   * with the one thing the answer needs — whether the reader is still running.
   *
   * A group that already became an expense is `HANDED_OFF` and therefore absent: the expense list
   * answers for it, and answering twice is how a customer is told a record does not exist.
   */
  async listOpenChatGroupProgress(input: {
    companyId: string; userId: string; lineChatKeyHash: string; windowMs: number; take?: number;
  }): Promise<Array<{ groupId: string; webPath: string; reading: boolean }>> {
    const groups = await this.listOpenSameWorkGroups({ ...input, take: input.take ?? 2 });
    if (groups.length === 0) return [];
    const jobs = await this.prisma.client.expenseCaptureReadJob.findMany({
      where: { companyId: input.companyId, groupId: { in: groups.map((group) => group.groupId) } },
      select: { groupId: true, status: true },
    });
    return groups.map((group) => ({
      groupId: group.groupId,
      webPath: group.webPath,
      reading: jobs.some((job) => job.groupId === group.groupId
        && !['DONE', 'FAILED', 'CANCELLED', 'PAUSED'].includes(job.status)),
    }));
  }

  /**
   * A45 "งานเดิม": the same attachment object, re-targeted — never a copy and never a delete.
   *
   * The bytes are already stored and already linked to the source group, so this moves the link,
   * re-parents the file row and re-parents its read job. A job that has already started reading
   * is re-queued instead (its checkpoint belongs to a group it is no longer in), and a terminal
   * job is left alone — its result is already the file's answer.
   */
  async moveFileToGroup(ctx: RequestContext, input: {
    fileId: string; fromGroupId: string; toGroupId: string;
  }): Promise<{ fileId: string; groupId: string; requeuedJob: boolean }> {
    return this.capture.transaction(async (tx) => {
      const file = await this.capture.findFile(tx, ctx.companyId, input.fromGroupId, input.fileId);
      if (!file) throw new NotFoundException('Capture file not found');
      const [first, second] = [input.fromGroupId, input.toGroupId].sort();
      // Two groups, one canonical order: sorted, so two chats merging in opposite directions at
      // the same moment cannot deadlock on each other's group lock.
      await lockFundingEvidence(tx, ctx.companyId, { attachmentIds: [file.attachmentId], expenseIds: [] });
      await this.capture.lockGroup(tx, ctx.companyId, first);
      if (second !== first) await this.capture.lockGroup(tx, ctx.companyId, second);

      const target = await this.capture.findGroup(tx, ctx.companyId, input.toGroupId);
      if (!target) throw new NotFoundException('Capture group not found');
      if (target.status !== 'OPEN') {
        throw new ConflictException({
          code: 'expense_capture_group_closed',
          message: 'งานรับหลักฐานนี้ปิดแล้ว กรุณาเริ่มงานใหม่เพื่อแนบไฟล์',
        });
      }

      const position = await this.capture.nextFilePosition(tx, ctx.companyId, input.toGroupId);
      await tx.expenseCaptureFile.update({
        where: { id: input.fileId },
        data: { groupId: input.toGroupId, position },
      });
      // The attachment link is what the group's evidence view reads, so it moves with the row.
      await tx.attachmentLink.updateMany({
        where: {
          companyId: ctx.companyId, attachmentId: file.attachmentId,
          targetType: EXPENSE_CAPTURE_GROUP_TARGET_TYPE, targetId: input.fromGroupId,
          purpose: EXPENSE_CAPTURE_EVIDENCE_PURPOSE,
        },
        data: { targetId: input.toGroupId },
      });

      const job = await this.capture.findJobByFile(tx, ctx.companyId, input.fileId);
      let requeuedJob = false;
      if (job && !['DONE', 'CANCELLED', 'FAILED'].includes(job.status)) {
        const started = job.status !== 'QUEUED';
        await tx.expenseCaptureReadJob.updateMany({
          where: { id: job.id, companyId: ctx.companyId },
          data: {
            groupId: input.toGroupId,
            // A reader mid-file has checkpoints keyed to the old group: start it over rather than
            // let a half-read result land in a group it never belonged to.
            ...(started ? { status: 'QUEUED', leaseOwner: null, leasedUntil: null, checkpointJson: {} } : {}),
          },
        });
        requeuedJob = started;
      } else if (job) {
        await tx.expenseCaptureReadJob.updateMany({
          where: { id: job.id, companyId: ctx.companyId }, data: { groupId: input.toGroupId },
        });
      }

      // Both groups changed, and both effects are already committed to storage.
      await this.capture.bumpRevisionForCommittedEffect(tx, { companyId: ctx.companyId, groupId: input.fromGroupId });
      await this.capture.bumpRevisionForCommittedEffect(tx, { companyId: ctx.companyId, groupId: input.toGroupId });
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: AuditAction.EXPENSE_CAPTURE_GROUP_FILE_ADD,
        targetType: 'expense_capture_group', targetId: input.toGroupId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { fileId: input.fileId, movedFromGroupId: input.fromGroupId, requeuedJob, channel: 'line' },
      }, tx);
      return { fileId: input.fileId, groupId: input.toGroupId, requeuedJob };
    });
  }

  /**
   * §17.6: the image lane already READ this file and the read failed, so the group must not hand
   * the same bytes to the reader a second time. The job is closed FAILED with the reason the OCR
   * hop reported, and the manifest keeps it — "ไม่เสนออ่านซ้ำ" is the whole point of §17.6.
   */
  async markReadFailed(companyId: string, jobId: string, errorCode: string): Promise<boolean> {
    const changed = await this.prisma.client.expenseCaptureReadJob.updateMany({
      where: { id: jobId, companyId, status: { notIn: ['DONE', 'CANCELLED', 'FAILED'] } },
      data: {
        status: 'FAILED', lastErrorCode: errorCode, lastErrorAt: new Date(), completedAt: new Date(),
        manifestJson: { pageCount: 0, pages: [], chunks: [], windows: [], errorCode,
          electronicVerification: { status: 'NOT_CHECKED' } },
      },
    });
    return changed.count === 1;
  }

  /** A45 "ใบใหม่" is the no-op; the CANCELLED close is only for the merge's emptied group. */
  async closeMergedGroup(ctx: RequestContext, groupId: string, reason: string): Promise<boolean> {
    const changed = await this.prisma.client.expenseCaptureGroup.updateMany({
      where: { companyId: ctx.companyId, id: groupId, status: 'OPEN' },
      data: { status: 'CANCELLED', closedReason: reason, closedAt: new Date(), revision: { increment: 1 } },
    });
    if (changed.count !== 1) return false;
    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: AuditAction.EXPENSE_CAPTURE_GROUP_CLOSE,
      targetType: 'expense_capture_group', targetId: groupId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { reason, channel: 'line' },
    });
    return true;
  }

  /**
   * §17.5 for the LLM path: the attempts of THIS chat that provably belong to THIS user.
   *
   * The read tool knows the chat (`chatKeyHash`) but not the raw LINE user id, and a group chat has
   * several senders — so a chat-wide read would show one member another member's file names. The
   * user is identified indirectly instead: a row whose target group/expense this user created pins
   * their `lineUserIdHash` in this chat, and only rows carrying that hash are returned. A user with
   * no persisted target in the window sees nothing, which is the safe direction to be wrong in.
   */
  async listChatIntakeAttempts(input: {
    companyId: string; userId: string; chatKeyHash: string; since: Date; take?: number;
  }) {
    const rows = await this.prisma.client.lineIntakeAttempt.findMany({
      where: { companyId: input.companyId, chatKeyHash: input.chatKeyHash, createdAt: { gte: input.since } },
      orderBy: { createdAt: 'desc' },
      take: Math.min((input.take ?? 5) * 4, 40),
    });
    const groupIds = [...new Set(rows.filter((row) => row.targetType === 'capture_group' && row.targetId).map((row) => row.targetId!))];
    const mine = new Set(
      (await this.prisma.client.expenseCaptureGroup.findMany({
        where: { companyId: input.companyId, id: { in: groupIds }, createdByUserId: input.userId },
        select: { id: true },
      })).map((group) => group.id),
    );
    const ownHashes = new Set(rows.filter((row) => row.targetId && mine.has(row.targetId)).map((row) => row.lineUserIdHash));
    if (ownHashes.size === 0) return [];
    return rows.filter((row) => ownHashes.has(row.lineUserIdHash)).slice(0, input.take ?? 5);
  }

  /**
   * What the LINE result push needs to know about a finished read, in one permission-free read.
   * The CALLER re-checks access before it speaks — this only reports what the group holds.
   */
  async readFinishedSnapshot(companyId: string, groupId: string): Promise<{
    group: { id: string; status: string; intakeChannel: string; createdByUserId: string; lineChatKeyHash: string | null; linePushTargetId: string | null; branchId: string | null };
    jobs: Array<{ id: string; status: string; pausedReason: string | null; lastErrorCode: string | null }>;
    observations: number;
    webPath: string;
  } | null> {
    const group = await this.prisma.client.expenseCaptureGroup.findFirst({ where: { companyId, id: groupId } });
    if (!group) return null;
    const [jobs, observations] = await Promise.all([
      this.capture.listJobsByGroup(this.capture.client, companyId, groupId),
      this.capture.listObservations(this.capture.client, companyId, groupId),
    ]);
    return {
      group: {
        id: group.id, status: group.status, intakeChannel: group.intakeChannel,
        createdByUserId: group.createdByUserId, lineChatKeyHash: group.lineChatKeyHash,
        linePushTargetId: group.linePushTargetId, branchId: group.branchId,
      },
      jobs: jobs.map((job) => ({
        id: job.id, status: job.status, pausedReason: job.pausedReason, lastErrorCode: job.lastErrorCode,
      })),
      observations: observations.length,
      webPath: expenseCaptureWebPath(companyId, groupId),
    };
  }
}
