import { randomUUID } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import {
  EXPENSE_CAPTURE_CLOSE_REASONS,
  emptyExpenseCaptureReadManifest,
  expenseCapturePagesRead,
  type ExpenseCaptureAllocationDto,
  type ExpenseCaptureCapabilityDto,
  type ExpenseCaptureCloseReason,
  type ExpenseCaptureFileDto,
  type ExpenseCaptureGroupDetailDto,
  type ExpenseCaptureGroupDto,
  type CaptureAllocationResult,
  type ExpenseCaptureGroupListItemDto,
  type ExpenseCaptureReadManifest,
  type RequestContext,
} from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  EXPENSE_CAPTURE_EVIDENCE_PURPOSE,
  EXPENSE_CAPTURE_GROUP_TARGET_TYPE,
} from '../../../data-model-core/domain/logic/attachment.logic';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { FEATURE_TEMPORARILY_UNAVAILABLE } from '../../../employee-access/application/entitlement.helper';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { assembleCaptureFacts } from '../../domain/logic/expense-capture-facts.logic';
import { captureCertificateGate, captureDerivedNextAction } from '../../domain/logic/expense-capture-certificate.logic';
import {
  buildExpenseFactsObservation,
  type ExpenseFactsInput,
  captureGroupAllowedActions,
  captureGroupBlockers,
  deriveCaptureScopeKey,
  expenseCaptureWebPath,
} from '../../domain/logic/expense-capture.logic';
import { PrismaExpenseCaptureRepository, type CaptureDb, type CaptureGroupRow } from '../../infrastructure/prisma-expense-capture.repository';
import { ExpenseCaptureReadRunnerService } from '../services/expense-capture-read-runner.service';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { lockFundingEvidence } from '../../infrastructure/substitute-funding.guard';
import { EXPENSE_LAUNCH_ROUTE_CLOSED_MESSAGE, assertExpenseRootOpen } from '../expense-launch-gate';

/** Authority that may bring NEW evidence into the system (appendix §6). */
const CREATE_PERMISSIONS = ['expense.receipt.upload', 'expense.receipt.line_upload', 'expense.create'];

const conflict = (code: string, message: string) => new ConflictException({ code, message });

function assertRevision(expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new BadRequestException('expectedRevision must be the revision you last read.');
  }
}

const revisionConflict = () => conflict(
  'expense_capture_group_revision_conflict',
  'งานรับหลักฐานนี้เปลี่ยนไปแล้ว กรุณาเปิดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง',
);

const groupDto = (group: CaptureGroupRow): ExpenseCaptureGroupDto => ({
  groupId: group.id,
  companyId: group.companyId,
  branchId: group.branchId,
  intakeChannel: group.intakeChannel,
  status: group.status,
  revision: group.revision,
  businessUse: group.businessUse,
  fundingRoute: group.fundingRoute,
  payerUserId: group.payerUserId,
  handoffState: group.handoffState,
  acceptedAllocationId: group.acceptedAllocationId,
  note: group.note,
  closedReason: group.closedReason,
  closedAt: group.closedAt?.toISOString() ?? null,
  createdByUserId: group.createdByUserId,
  createdAt: group.createdAt.toISOString(),
  updatedAt: group.updatedAt.toISOString(),
});

/** Terminal read states: everything else means the reader still owes an answer. */
const TERMINAL_READ_STATUSES = new Set(['DONE', 'FAILED', 'CANCELLED', 'PAUSED']);

/**
 * Shared authority + tenancy checks. Written once because every endpoint of this aggregate needs
 * the same three answers — does this group exist for THIS company, is its branch in my scope, and
 * may I read or change it — and a per-endpoint copy is how one of them ends up missing.
 */
@Injectable()
export class ExpenseCaptureAccessService {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly config: AppConfigService,
  ) {}

  canRead(ctx: RequestContext, group: CaptureGroupRow): boolean {
    if (ctx.permissions.includes('expense.read') || ctx.permissions.includes('expense.review')) return true;
    return ctx.permissions.includes('expense.read_own') && group.createdByUserId === ctx.userId;
  }

  /** §6 "แก้ selection/businessUse/วันที่/ตัดไฟล์": the creator with `expense.update`, or a reviewer. */
  canMutate(ctx: RequestContext, group: CaptureGroupRow): boolean {
    if (ctx.permissions.includes('expense.review')) return true;
    return ctx.permissions.includes('expense.update') && group.createdByUserId === ctx.userId;
  }

  /** The upload authority of §6, plus ownership: a colleague's group is not yours to fill. */
  canAddFiles(ctx: RequestContext, group: CaptureGroupRow): boolean {
    if (ctx.permissions.includes('expense.review')) return true;
    return CREATE_PERMISSIONS.some((key) => ctx.permissions.includes(key))
      && group.createdByUserId === ctx.userId;
  }

  /**
   * A group of another company, or outside my branch scope, answers 404 — not 403. A 403 would
   * confirm the id exists, which is the cross-company probe of A15.
   */
  async load(ctx: RequestContext, groupId: string, db?: CaptureDb): Promise<CaptureGroupRow> {
    const group = await this.capture.findGroup(db ?? this.capture.client, ctx.companyId, groupId);
    if (!group || !isBranchInScope(ctx.scopes ?? {}, group.branchId)) {
      throw new NotFoundException('Capture group not found');
    }
    return group;
  }

  async loadReadable(ctx: RequestContext, groupId: string, db?: CaptureDb): Promise<CaptureGroupRow> {
    const group = await this.load(ctx, groupId, db);
    if (!this.canRead(ctx, group)) throw new ForbiddenException('Missing permission: expense.read');
    return group;
  }

  /**
   * The intake flag (§6). OFF refuses NEW evidence — a new group, a new file, a conversion — and
   * nothing else: reading, detaching, closing and finishing an upload already reserved all stay
   * open, and a queued read still completes (A47).
   */
  assertIntakeOpen(): void {
    if (this.config.expenseCaptureGroupIntakeEnabled) return;
    throw new ForbiddenException({
      code: FEATURE_TEMPORARILY_UNAVAILABLE,
      message: EXPENSE_LAUNCH_ROUTE_CLOSED_MESSAGE,
    });
  }

  capability(): ExpenseCaptureCapabilityDto {
    return {
      maxBytes: this.config.uploadMaxBytes,
      allowedMimeTypes: [...ALLOWED_ATTACHMENT_MIME_TYPES],
      pdfAutomaticRead: true,
      pdfMaxPagesAutomatic: this.config.expenseCapturePdfMaxPages,
    };
  }
}

@Injectable()
export class GetExpenseCaptureCapabilityUseCase {
  constructor(private readonly access: ExpenseCaptureAccessService) {}

  /** Limits only — no company data — so any authority that reaches an expense screen may read it. */
  async execute(ctx: RequestContext): Promise<ExpenseCaptureCapabilityDto> {
    const allowed = [...CREATE_PERMISSIONS, 'expense.read', 'expense.read_own', 'expense.read_related', 'expense.review'];
    if (!allowed.some((key) => ctx.permissions.includes(key))) {
      throw new ForbiddenException('Missing permission: expense.read');
    }
    return this.access.capability();
  }
}

@Injectable()
export class CreateExpenseCaptureGroupUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly expenses: PrismaExpenseRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly audit: AuditService,
    private readonly launchGate: LaunchGateGuardService,
  ) {}

  async execute(
    ctx: RequestContext,
    cmd: {
      branchId?: string; note?: string; intakeChannel?: 'WEB' | 'LINE'; lineChatKeyHash?: string;
      /** The chat id the LINE lane may push this group's result back into (§3, W07-int). */
      linePushTargetId?: string;
    },
  ): Promise<{ groupId: string; revision: number; webPath: string }> {
    if (!CREATE_PERMISSIONS.some((key) => ctx.permissions.includes(key))) {
      throw new ForbiddenException('Missing permission: expense.receipt.upload');
    }
    // The same root the manual draft and the receipt upload sit behind: a CLOSED expenses gate
    // refuses new work and leaves every existing record readable.
    await assertExpenseRootOpen(this.launchGate, this.audit, ctx, AuditAction.EXPENSE_CAPTURE_GROUP_CREATE);
    this.access.assertIntakeOpen();
    if (!isBranchInScope(ctx.scopes ?? {}, cmd.branchId)) {
      throw new ForbiddenException('Branch is outside your assigned branch scope.');
    }
    const branchId = await this.expenses.resolveCreateBranchId(ctx.companyId, ctx.scopes ?? {}, cmd.branchId);
    const intakeChannel = cmd.intakeChannel ?? (ctx.authProvider === 'line' ? 'LINE' : 'WEB');
    if (cmd.lineChatKeyHash && (intakeChannel !== 'LINE' || ctx.authProvider !== 'line')) {
      throw new BadRequestException('Invalid LINE capture identity.');
    }

    const group = await this.capture.transaction(async (tx) => {
      const created = await this.capture.createGroup(tx, {
        companyId: ctx.companyId, branchId: branchId ?? null, createdByUserId: ctx.userId,
        intakeChannel, note: cmd.note?.trim() ? cmd.note.trim() : null,
        lineChatKeyHash: cmd.lineChatKeyHash ?? null,
        // Only ever from the LINE lane's own event, and only alongside the hash it must match.
        linePushTargetId: cmd.lineChatKeyHash ? cmd.linePushTargetId ?? null : null,
      });
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: AuditAction.EXPENSE_CAPTURE_GROUP_CREATE,
        targetType: 'expense_capture_group', targetId: created.id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { intakeChannel, branchId: created.branchId },
      }, tx);
      return created;
    });

    return { groupId: group.id, revision: group.revision, webPath: expenseCaptureWebPath(ctx.companyId, group.id) };
  }
}

@Injectable()
export class ListExpenseCaptureGroupsUseCase {
  constructor(private readonly capture: PrismaExpenseCaptureRepository) {}

  async execute(
    ctx: RequestContext,
    query: { status?: string; page?: number; pageSize?: number },
  ): Promise<{ items: ExpenseCaptureGroupListItemDto[]; total: number; page: number; pageSize: number }> {
    const readsAll = ctx.permissions.includes('expense.read') || ctx.permissions.includes('expense.review');
    if (!readsAll && !ctx.permissions.includes('expense.read_own')) {
      throw new ForbiddenException('Missing permission: expense.read');
    }
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(Math.max(1, query.pageSize ?? 20), 100);
    const db = this.capture.client;
    // `expense.read_own` sees its own work only, and the branch scope applies either way.
    const { rows, total } = await this.capture.listGroups(db, {
      companyId: ctx.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(readsAll ? {} : { createdByUserId: ctx.userId }),
      scopes: ctx.scopes ?? {},
      page, pageSize,
    });

    // Two queries for the whole page, not two per row.
    const groupIds = rows.map((group) => group.id);
    const [files, jobs] = await Promise.all([
      this.capture.listFileStatesForGroups(db, ctx.companyId, groupIds),
      this.capture.listJobStatesForGroups(db, ctx.companyId, groupIds),
    ]);
    const tally = (source: Array<{ groupId: string | null }>, keep: (row: never) => boolean) => {
      const counts = new Map<string, number>();
      for (const row of source) {
        if (!row.groupId || !keep(row as never)) continue;
        counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + 1);
      }
      return counts;
    };
    const fileCounts = tally(files, (row: { uploadState: string }) => row.uploadState !== 'DETACHED');
    const readCounts = tally(jobs, (row: { status: string }) => row.status === 'DONE');

    const items: ExpenseCaptureGroupListItemDto[] = rows.map((group) => ({
      groupId: group.id,
      status: group.status,
      intakeChannel: group.intakeChannel,
      fileCount: fileCounts.get(group.id) ?? 0,
      filesRead: readCounts.get(group.id) ?? 0,
      createdByUserId: group.createdByUserId,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      webPath: expenseCaptureWebPath(ctx.companyId, group.id),
    }));
    return { items, total, page, pageSize };
  }
}

@Injectable()
export class GetExpenseCaptureGroupUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly config: AppConfigService,
  ) {}

  async execute(ctx: RequestContext, groupId: string): Promise<ExpenseCaptureGroupDetailDto> {
    const db = this.capture.client;
    const group = await this.access.loadReadable(ctx, groupId, db);
    const [files, jobs, observations, allocation, derived] = await Promise.all([
      this.capture.listFiles(db, ctx.companyId, groupId),
      this.capture.listJobsByGroup(db, ctx.companyId, groupId),
      this.capture.listObservations(db, ctx.companyId, groupId),
      this.capture.findGroupAllocation(db, ctx.companyId, groupId),
      this.capture.listDerivedSources(db, ctx.companyId, groupId),
    ]);
    // W06 §12/A40: one lookup per group, so a page can say "ร้าน A ออกแล้ว / ร้าน B รอลงนาม".
    const certificates = await this.capture.listDerivedCertificates(db, ctx.companyId, derived.map((row) => row.id));

    const jobByFile = new Map(jobs.map((job) => [job.fileId, job]));
    const fileDtos: ExpenseCaptureFileDto[] = files.map((file) => {
      const job = file.id ? jobByFile.get(file.id) : undefined;
      const manifest = (job?.manifestJson ?? null) as ExpenseCaptureReadManifest | null;
      return {
        fileId: file.id,
        attachmentId: file.attachmentId,
        position: file.position,
        uploadState: file.uploadState,
        originalFileName: file.originalFileName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        checksumSha256: file.checksumSha256,
        pageCount: file.pageCount ?? manifest?.pageCount ?? null,
        readStatus: job?.status ?? null,
        pagesRead: expenseCapturePagesRead(manifest),
        pausedReason: (job?.pausedReason ?? null) as ExpenseCaptureFileDto['pausedReason'],
        lastErrorCode: job?.lastErrorCode ?? null,
        electronicVerification: file.electronicVerificationJson as ExpenseCaptureFileDto['electronicVerification'],
        addedByUserId: file.addedByUserId,
        detachedReason: file.detachedReason,
        createdAt: file.createdAt.toISOString(),
        updatedAt: file.updatedAt.toISOString(),
      };
    });

    const stored = fileDtos.filter((file) => file.uploadState === 'STORED');
    // W05 §9: only asked once the batch exists, so an ordinary group costs no extra query.
    const reopenable = group.handoffState === 'ACTIVE'
      ? await this.capture.isReopenableAfterHandoff(db, ctx.companyId, groupId)
      : false;
    const state = {
      status: group.status,
      handoffState: group.handoffState,
      storedFiles: stored.length,
      readingFiles: stored.filter((file) => file.readStatus !== null && !TERMINAL_READ_STATUSES.has(file.readStatus)).length,
      hasFacts: observations.length > 0,
      intakeEnabled: this.config.expenseCaptureGroupIntakeEnabled,
      canMutate: this.access.canMutate(ctx, group),
      reopenable,
      // W04a: what the current allocation says decides the rest of the blockers and the actions.
      allocation: allocation ? {
        status: allocation.status,
        outcome: (allocation.resultJson as CaptureAllocationResult | null)?.outcome ?? 'BLOCKED',
        blockers: (allocation.resultJson as CaptureAllocationResult | null)?.blockers ?? [],
      } : null,
    };

    const facts = observations.length > 0 ? assembleCaptureFacts(observations) : null;
    return {
      ...groupDto(group),
      // W04a §4.4: one assembled view across every file, HUMAN over AI, nothing invented. It is
      // structurally an `ExpenseCaptureObservations` plus the per-document state and the summary.
      facts,
      files: fileDtos,
      allocation: allocation ? {
        allocationId: allocation.id,
        groupRevision: allocation.groupRevision,
        policyVersion: allocation.policyVersion,
        status: allocation.status,
        fundingRoute: allocation.fundingRoute,
        payerUserId: allocation.payerUserId,
        computedByUserId: allocation.computedByUserId,
        computedAt: allocation.computedAt.toISOString(),
        acceptedByUserId: allocation.acceptedByUserId,
        acceptedAt: allocation.acceptedAt?.toISOString() ?? null,
        invalidatedReason: allocation.invalidatedReason,
        result: allocation.resultJson,
      } satisfies ExpenseCaptureAllocationDto : null,
      derivedSources: derived.map((row) => {
        const certificate = certificates.get(row.id) ?? null;
        return {
          expenseId: row.id,
          scopeKey: row.captureScopeKey ?? '',
          status: row.status,
          grandTotalAmount: row.grandTotalAmount.toString(),
          payerUserId: row.payerUserId,
          certificate,
          nextAction: captureDerivedNextAction(captureCertificateGate({
            group, source: { captureAllocationId: row.captureAllocationId, captureScopeKey: row.captureScopeKey }, facts,
          }), certificate),
        };
      }),
      blockers: captureGroupBlockers(state),
      allowedActions: captureGroupAllowedActions(state),
      webPath: expenseCaptureWebPath(ctx.companyId, groupId),
      capability: this.access.capability(),
    };
  }
}

@Injectable()
export class AddExpenseCaptureFileUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly createIntent: CreateUploadIntentUseCase,
    private readonly audit: AuditService,
    private readonly launchGate: LaunchGateGuardService,
  ) {}

  async execute(ctx: RequestContext, groupId: string, cmd: {
    originalFileName: string; mimeType: string; byteSize: number; expectedRevision: number;
    lineMessageId?: string;
  }): Promise<{ fileId: string; attachmentId: string; revision: number; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string>; expiresAt: Date }> {
    assertRevision(cmd.expectedRevision);
    await assertExpenseRootOpen(this.launchGate, this.audit, ctx, AuditAction.EXPENSE_CAPTURE_GROUP_FILE_ADD);
    this.access.assertIntakeOpen();
    const group = await this.access.load(ctx, groupId);
    if (!this.access.canAddFiles(ctx, group)) throw new ForbiddenException('Missing permission: expense.receipt.upload');
    if (group.status !== 'OPEN') {
      throw conflict('expense_capture_group_closed', 'งานรับหลักฐานนี้ปิดแล้ว กรุณาเริ่มงานใหม่เพื่อแนบไฟล์');
    }
    // Read the revision BEFORE reserving storage: a stale tab should not consume the company's
    // pending-upload quota to find out it is stale. The transaction below still CASes.
    if (group.revision !== cmd.expectedRevision) throw revisionConflict();

    // Reuse of the shared intent is the whole point: metadata validation, the per-company
    // pending-bytes quota and the signed URL all stay in one place (`create-upload-intent`).
    const intent = await this.createIntent.execute(ctx, {
      originalFileName: cmd.originalFileName, mimeType: cmd.mimeType, byteSize: cmd.byteSize,
      visibility: 'INTERNAL',
      ...(group.branchId ? { branchId: group.branchId } : {}),
    }, { captureGroupId: groupId });

    const result = await this.capture.transaction(async (tx) => {
      await this.capture.lockGroup(tx, ctx.companyId, groupId);
      const position = await this.capture.nextFilePosition(tx, ctx.companyId, groupId);
      const revision = await this.capture.bumpRevision(tx, {
        companyId: ctx.companyId, groupId, expectedRevision: cmd.expectedRevision,
      });
      if (revision === null) throw revisionConflict();
      const file = await this.capture.createFile(tx, {
        companyId: ctx.companyId, groupId, attachmentId: intent.attachmentId, position,
        originalFileName: cmd.originalFileName, mimeType: cmd.mimeType, byteSize: cmd.byteSize,
        addedByUserId: ctx.userId, lineMessageId: cmd.lineMessageId ?? null,
      });
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: AuditAction.EXPENSE_CAPTURE_GROUP_FILE_ADD,
        targetType: 'expense_capture_group', targetId: groupId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { fileId: file.id, attachmentId: intent.attachmentId, mimeType: cmd.mimeType, position, revision },
      }, tx);
      return { fileId: file.id, revision };
    });

    return {
      fileId: result.fileId, revision: result.revision, attachmentId: intent.attachmentId,
      uploadUrl: intent.uploadUrl, uploadMethod: intent.uploadMethod,
      uploadHeaders: intent.uploadHeaders, expiresAt: intent.expiresAt,
    };
  }
}

@Injectable()
export class CompleteExpenseCaptureFileUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly expenses: PrismaExpenseRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly completeUpload: CompleteAttachmentUploadUseCase,
    private readonly attachments: PrismaAttachmentRepository,
    private readonly audit: AuditService,
    private readonly runner: ExpenseCaptureReadRunnerService,
  ) {}

  /**
   * Finishing an upload that was already reserved is RECOVERY, not new intake: it stays available
   * with the flag off (A47), and calling it twice answers the same file and the same job instead
   * of a second read (the client that lost the response of the first call is the normal case).
   *
   * The shared completion verifies and re-keys the bytes OUTSIDE this transaction, and that is
   * irreversible. So the retry path reads the attachment first: an already-ACTIVE object means a
   * previous attempt stored the bytes and lost its answer, and it is adopted instead of being
   * completed a second time (which `CompleteAttachmentUploadUseCase` refuses outright, stranding
   * the file forever). For the same reason the revision is bumped unconditionally below — once
   * the bytes exist, the group must record them; `expectedRevision` is the gate BEFORE storage.
   *
   * `readJobId` is null, never '', when a replay finds no job: an empty string is a value a caller
   * can pass on as if it identified something (`markReadFailed('')` matches no row and answers
   * false, which reads like "already terminal"). Absent is absent.
   */
  async execute(ctx: RequestContext, groupId: string, fileId: string, cmd: {
    byteSize?: number; checksumSha256?: string; expectedRevision: number; lineMessageId?: string;
  }): Promise<{ fileId: string; attachmentId: string; revision: number; readJobId: string | null; uploadState: string; replayed: boolean }> {
    assertRevision(cmd.expectedRevision);
    const group = await this.access.load(ctx, groupId);
    if (!this.access.canAddFiles(ctx, group)) throw new ForbiddenException('Missing permission: expense.receipt.upload');
    const existing = await this.capture.findFile(this.capture.client, ctx.companyId, groupId, fileId);
    if (!existing) throw new NotFoundException('Capture file not found');

    if (existing.uploadState === 'STORED') {
      const job = await this.capture.findJobByFile(this.capture.client, ctx.companyId, fileId);
      return {
        fileId, attachmentId: existing.attachmentId, revision: group.revision,
        readJobId: job?.id ?? null, uploadState: existing.uploadState, replayed: true,
      };
    }
    if (existing.uploadState !== 'PENDING_UPLOAD') {
      throw conflict('expense_capture_file_state_invalid', 'ไฟล์นี้ถูกตัดออกหรือถูกปฏิเสธแล้ว กรุณาแนบไฟล์ใหม่');
    }
    if (group.revision !== cmd.expectedRevision) throw revisionConflict();

    const reserved = await this.attachments.findById({ id: existing.attachmentId, companyId: ctx.companyId });
    if (!reserved) throw new NotFoundException('Attachment not found.');
    if (reserved.status === 'QUARANTINED' || reserved.status === 'DELETED') {
      // The bytes are gone or refused: nothing can complete this slot, so say so once and let the
      // customer send the file again rather than leaving a PENDING_UPLOAD row to retry forever.
      await this.capture.markFileRejected(this.capture.client, { companyId: ctx.companyId, fileId });
      throw conflict('expense_capture_file_state_invalid', 'ไฟล์นี้ถูกปฏิเสธจากการตรวจความปลอดภัย กรุณาแนบไฟล์ใหม่');
    }
    const resumed = reserved.status === 'ACTIVE';
    if (resumed && cmd.checksumSha256 && reserved.checksumSha256 !== cmd.checksumSha256) {
      throw new BadRequestException('Capture file checksum changed.');
    }

    // Storage verification, checksum, malware scan and the immutable re-key all belong to the
    // shared completion use case; this one only records what the group now holds.
    const attachment = resumed ? reserved : await this.completeUpload.execute(ctx, {
      attachmentId: existing.attachmentId,
      ...(cmd.checksumSha256 ? { checksumSha256: cmd.checksumSha256 } : {}),
      ...(cmd.byteSize !== undefined ? { byteSize: cmd.byteSize } : {}),
    }, { inspectionPolicy: 'RECEIPT' });

    return this.capture.transaction(async (tx) => {
      // §2.4 order: the evidence keys first (this attachment may already be a claim's evidence),
      // then the group. Reversing the two is the deadlock the pg spec exists to catch.
      await lockFundingEvidence(tx, ctx.companyId, { attachmentIds: [existing.attachmentId], expenseIds: [] });
      await this.capture.lockGroup(tx, ctx.companyId, groupId);

      const stored = await this.capture.markFileStored(tx, {
        companyId: ctx.companyId, fileId,
        checksumSha256: attachment.checksumSha256 ?? cmd.checksumSha256 ?? null,
        byteSize: attachment.byteSize ?? existing.byteSize,
        lineMessageId: cmd.lineMessageId ?? null,
      });
      if (!stored) {
        // A concurrent complete won. Answer with ITS result: one STORED file, one read job.
        const job = await this.capture.findJobByFile(tx, ctx.companyId, fileId);
        const current = await this.capture.findGroup(tx, ctx.companyId, groupId);
        return {
          fileId, attachmentId: existing.attachmentId, revision: current?.revision ?? group.revision,
          readJobId: job?.id ?? null, uploadState: 'STORED', replayed: true,
        };
      }

      await this.expenses.linkAttachmentToTarget(
        existing.attachmentId, EXPENSE_CAPTURE_GROUP_TARGET_TYPE, groupId,
        EXPENSE_CAPTURE_EVIDENCE_PURPOSE, ctx.companyId, ctx.userId, tx,
      );

      // One job per file with its own OCR admission fence: a retry of THIS job never consumes a
      // second read from the company's quota (§4.6). No runner in W01 — W03 claims it.
      const job = await this.capture.createReadJob(tx, {
        companyId: ctx.companyId, ownerType: 'CAPTURE_GROUP', groupId, fileId,
        attachmentId: existing.attachmentId,
        attachmentChecksum: attachment.checksumSha256 ?? cmd.checksumSha256 ?? '',
        objectVersionId: attachment.objectVersionId ?? null,
        ocrAdmissionRequestId: randomUUID(),
        manifestJson: emptyExpenseCaptureReadManifest(),
      });

      // Unconditional: the bytes are already stored and the file row is already STORED, so a
      // conflict answer here would strand exactly what the retry cannot repeat.
      const revision = await this.capture.bumpRevisionForCommittedEffect(tx, { companyId: ctx.companyId, groupId });

      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: AuditAction.EXPENSE_CAPTURE_GROUP_FILE_ADD,
        targetType: 'expense_capture_group', targetId: groupId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { fileId, attachmentId: existing.attachmentId, readJobId: job.id, uploadState: 'STORED', revision, resumed },
      }, tx);

      return { fileId, attachmentId: existing.attachmentId, revision, readJobId: job.id, uploadState: 'STORED', replayed: false };
    }).then((result) => {
      // Start the read in THIS process without making the upload wait for a provider (§4.5).
      // Fire-and-forget by contract: `kick` swallows its own errors, and the scan worker claims
      // the job anyway if this process dies before it gets there.
      if (!result.replayed && result.readJobId) this.runner.kick(result.readJobId);
      return result;
    });
  }
}

@Injectable()
export class DetachExpenseCaptureFileUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly attachments: PrismaAttachmentRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, groupId: string, fileId: string, cmd: {
    reason: string; expectedRevision: number;
  }): Promise<{ fileId: string; revision: number; cancelledJobs: number }> {
    assertRevision(cmd.expectedRevision);
    const reason = cmd.reason?.trim() ?? '';
    if (reason.length < 1 || reason.length > 500) {
      throw new BadRequestException('Detach reason must be between 1 and 500 characters.');
    }
    const group = await this.access.load(ctx, groupId);
    if (!this.access.canMutate(ctx, group)) throw new ForbiddenException('Missing permission: expense.update');
    if (group.status !== 'OPEN' && group.status !== 'HANDED_OFF') {
      throw conflict('expense_capture_group_closed', 'งานรับหลักฐานนี้ปิดแล้ว ไม่สามารถตัดไฟล์ออกได้');
    }

    return this.capture.transaction(async (tx) => {
      const file = await this.capture.findFile(tx, ctx.companyId, groupId, fileId);
      if (!file) throw new NotFoundException('Capture file not found');
      await lockFundingEvidence(tx, ctx.companyId, { attachmentIds: [file.attachmentId], expenseIds: [] });
      await this.capture.lockGroup(tx, ctx.companyId, groupId);
      if (file.uploadState === 'DETACHED') {
        throw conflict('expense_capture_file_state_invalid', 'ไฟล์นี้ถูกตัดออกไปแล้ว');
      }

      // A file a derived source already uses as its receipt, or one a certified substitute
      // receipt retains, is evidence of something that exists: the group may not pull it away.
      const primary = await tx.attachmentLink.findFirst({
        where: {
          companyId: ctx.companyId, attachmentId: file.attachmentId, targetType: 'expense.record',
          purpose: { in: ['expense.receipt.primary', 'expense.receipt.supporting'] },
        },
        select: { targetId: true, purpose: true },
      });
      const hold = await this.attachments.findSubstituteEvidenceRetentionHold({ id: file.attachmentId, companyId: ctx.companyId }, tx);
      if (primary || hold) {
        throw conflict(
          'expense_capture_file_detach_blocked',
          'ไฟล์นี้ถูกใช้เป็นหลักฐานของรายการค่าใช้จ่ายหรือใบรับรองแล้ว จึงตัดออกจากงานนี้ไม่ได้',
        );
      }

      const revision = await this.capture.bumpRevision(tx, {
        companyId: ctx.companyId, groupId, expectedRevision: cmd.expectedRevision,
      });
      if (revision === null) throw revisionConflict();
      const detached = await this.capture.markFileDetached(tx, { companyId: ctx.companyId, fileId, reason });
      if (!detached) throw conflict('expense_capture_file_state_invalid', 'ไฟล์นี้ถูกตัดออกไปแล้ว');
      // The group stops claiming the bytes; the object itself is left for the retention sweep,
      // never hard-deleted here.
      await tx.attachmentLink.deleteMany({
        where: {
          companyId: ctx.companyId, attachmentId: file.attachmentId,
          targetType: EXPENSE_CAPTURE_GROUP_TARGET_TYPE, targetId: groupId,
        },
      });
      // A read that comes back after this must not apply to the group (§4.5).
      const cancelledJobs = await this.capture.cancelJobsForFile(tx, ctx.companyId, fileId);

      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: AuditAction.EXPENSE_CAPTURE_GROUP_FILE_DETACH,
        targetType: 'expense_capture_group', targetId: groupId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { fileId, attachmentId: file.attachmentId, cancelledJobs, revision },
      }, tx);
      return { fileId, revision, cancelledJobs };
    });
  }
}

@Injectable()
export class CloseExpenseCaptureGroupUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, groupId: string, cmd: {
    reason: ExpenseCaptureCloseReason; expectedRevision: number;
  }): Promise<{ groupId: string; status: CaptureGroupRow['status']; revision: number }> {
    assertRevision(cmd.expectedRevision);
    if (!EXPENSE_CAPTURE_CLOSE_REASONS.includes(cmd.reason)) {
      throw new BadRequestException('Unsupported capture close reason.');
    }
    const group = await this.access.load(ctx, groupId);
    if (!this.access.canMutate(ctx, group)) throw new ForbiddenException('Missing permission: expense.update');
    if (group.status !== 'OPEN') {
      throw conflict('expense_capture_group_closed', 'งานรับหลักฐานนี้ปิดแล้ว');
    }
    // Derived sources already exist and are live documents; closing the group would orphan them.
    if (group.handoffState === 'ACTIVE') {
      throw conflict(
        'expense_capture_handoff_active',
        'งานนี้สร้างรายการค่าใช้จ่ายไปแล้ว กรุณาจัดการที่รายการค่าใช้จ่ายนั้น',
      );
    }

    const status = cmd.reason === 'NO_COMPANY_PORTION' ? 'CLOSED_NO_HANDOFF' as const : 'CANCELLED' as const;
    return this.capture.transaction(async (tx) => {
      await this.capture.lockGroup(tx, ctx.companyId, groupId);
      const revision = await this.capture.bumpRevision(tx, {
        companyId: ctx.companyId, groupId, expectedRevision: cmd.expectedRevision,
        data: { status, closedReason: cmd.reason, closedAt: new Date() },
      });
      if (revision === null) throw revisionConflict();
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: AuditAction.EXPENSE_CAPTURE_GROUP_CLOSE,
        targetType: 'expense_capture_group', targetId: groupId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { reason: cmd.reason, status, revision },
      }, tx);
      return { groupId, status, revision };
    });
  }
}

/** Statuses an expense may still be converted from (§3.1) — nothing downstream has used it yet. */
const CONVERTIBLE_EXPENSE_STATUSES = new Set(['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']);

@Injectable()
export class ConvertExpenseToCaptureGroupUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly expenses: PrismaExpenseRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly audit: AuditService,
    private readonly launchGate: LaunchGateGuardService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * "มีของส่วนตัวด้วย" / "แยกเป็นกลุ่มหลักฐาน" (§3.1). The expense KEEPS its id, its deep link
   * and every amount: it becomes the derived source of its own issuer scope inside a new group.
   * Nothing is re-totalled until an allocation is accepted (W04).
   */
  async execute(ctx: RequestContext, expenseId: string, cmd: { expectedUpdatedAt: string }): Promise<{
    groupId: string; revision: number; expenseId: string; captureScopeKey: string; adoptedFiles: number; webPath: string;
  }> {
    if (!CREATE_PERMISSIONS.some((key) => ctx.permissions.includes(key))) {
      throw new ForbiddenException('Missing permission: expense.receipt.upload');
    }
    await assertExpenseRootOpen(this.launchGate, this.audit, ctx, AuditAction.EXPENSE_CAPTURE_GROUP_CONVERT);
    this.access.assertIntakeOpen();

    const expense = await this.expenses.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found`);
    if (!isBranchInScope(ctx.scopes ?? {}, expense.branchId)) {
      throw new ForbiddenException('Branch is outside your assigned branch scope.');
    }
    const mayEdit = ctx.permissions.includes('expense.review')
      || (ctx.permissions.includes('expense.update') && expense.createdByUserId === ctx.userId);
    if (!mayEdit) throw new ForbiddenException('Missing permission: expense.update');
    if (!expense.updatedAt || expense.updatedAt.getTime() !== new Date(cmd.expectedUpdatedAt).getTime()) {
      throw conflict('EXPENSE_UPDATE_CONFLICT', 'รายการนี้เปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแยกเป็นกลุ่มหลักฐาน');
    }

    const ineligible = (message: string) => conflict('expense_capture_convert_ineligible', message);
    if (expense.captureGroupId) {
      throw conflict('expense_capture_group_exists', 'รายการนี้อยู่ในงานรับหลักฐานอยู่แล้ว');
    }
    if (!CONVERTIBLE_EXPENSE_STATUSES.has(expense.status)) {
      throw ineligible('แยกเป็นกลุ่มหลักฐานได้เฉพาะรายการที่ยังไม่ยืนยัน');
    }
    if (expense.paymentStatus !== 'UNPAID' || Number(expense.paidAmount ?? 0) > 0) {
      throw ineligible('รายการนี้มีการชำระเงินแล้ว จึงแยกเป็นกลุ่มหลักฐานไม่ได้');
    }
    if (expense.postingStatus !== 'not_required') {
      throw ineligible('รายการนี้บันทึกบัญชีแล้ว จึงแยกเป็นกลุ่มหลักฐานไม่ได้');
    }
    if (expense.sourceReimbursementRequestId) {
      throw ineligible('รายการนี้มาจากคำขอเบิก จึงแยกเป็นกลุ่มหลักฐานไม่ได้');
    }

    const db = this.prisma.client;
    const liveClaim = await db.reimbursementLine.findFirst({
      where: {
        companyId: ctx.companyId, linkedExpenseId: expenseId,
        request: { status: { notIn: ['REJECTED', 'CANCELLED', 'VOIDED'] } },
      },
      select: { id: true },
    });
    if (liveClaim) throw ineligible('รายการนี้อยู่ในคำขอเบิกแล้ว จึงแยกเป็นกลุ่มหลักฐานไม่ได้');
    const certificate = await db.expenseSubstituteReceiptEvidence.findFirst({
      where: { companyId: ctx.companyId, expenseId, status: { in: ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED'] } },
      select: { id: true },
    });
    if (certificate) throw ineligible('รายการนี้มีใบรับรองแทนใบเสร็จแล้ว จึงแยกเป็นกลุ่มหลักฐานไม่ได้');

    const detail = await this.expenses.findByIdWithRelations(ctx.companyId, expenseId);
    const captureScopeKey = deriveCaptureScopeKey(expense);

    return this.capture.transaction(async (tx) => {
      await lockFundingEvidence(tx, ctx.companyId, { expenseIds: [expenseId], attachmentIds: [] });
      const group = await this.capture.createGroup(tx, {
        companyId: ctx.companyId, branchId: expense.branchId ?? null, createdByUserId: ctx.userId,
        intakeChannel: ctx.authProvider === 'line' ? 'LINE' : 'WEB', note: null,
      });
      await this.capture.lockGroup(tx, ctx.companyId, group.id);

      // The expense's own receipt files enter the manifest; the expense keeps its receipt links,
      // so the same bytes are now claimed twice on purpose — that is what makes them shared.
      const links = await tx.attachmentLink.findMany({
        where: {
          companyId: ctx.companyId, targetType: 'expense.record', targetId: expenseId,
          purpose: { in: ['expense.receipt.primary', 'expense.receipt.supporting'] },
          attachment: { companyId: ctx.companyId, status: 'ACTIVE' },
        },
        include: { attachment: true },
        orderBy: { createdAt: 'asc' },
      });
      let position = 0;
      for (const link of links) {
        position += 1;
        await this.capture.createFile(tx, {
          companyId: ctx.companyId, groupId: group.id, attachmentId: link.attachmentId,
          position, originalFileName: link.attachment.originalFileName,
          mimeType: link.attachment.mimeType, byteSize: link.attachment.byteSize,
          addedByUserId: ctx.userId, uploadState: 'STORED',
          checksumSha256: link.attachment.checksumSha256,
        });
        await this.expenses.linkAttachmentToTarget(
          link.attachmentId, EXPENSE_CAPTURE_GROUP_TARGET_TYPE, group.id,
          EXPENSE_CAPTURE_EVIDENCE_PURPOSE, ctx.companyId, ctx.userId, tx,
        );
      }

      await this.capture.createObservation(tx, {
        companyId: ctx.companyId, groupId: group.id, expenseId, version: 1, source: 'EXPENSE_FACTS',
        payloadJson: buildExpenseFactsObservation({ ...expense, lines: detail?.lines ?? [] } as ExpenseFactsInput),
        createdByUserId: ctx.userId,
      });

      // CAS on the revision the caller read: amounts, status and dates are untouched.
      const changed = await tx.expenseRecord.updateMany({
        where: { companyId: ctx.companyId, id: expenseId, updatedAt: expense.updatedAt, captureGroupId: null },
        data: { captureGroupId: group.id, captureScopeKey, updatedByUserId: ctx.userId },
      });
      if (changed.count !== 1) {
        throw conflict('EXPENSE_UPDATE_CONFLICT', 'รายการนี้เปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแยกเป็นกลุ่มหลักฐาน');
      }

      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: AuditAction.EXPENSE_CAPTURE_GROUP_CONVERT,
        targetType: 'expense_capture_group', targetId: group.id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { expenseId, captureScopeKey, adoptedFiles: links.length, revision: group.revision },
      }, tx);

      return {
        groupId: group.id, revision: group.revision, expenseId, captureScopeKey,
        adoptedFiles: links.length, webPath: expenseCaptureWebPath(ctx.companyId, group.id),
      };
    });
  }
}
