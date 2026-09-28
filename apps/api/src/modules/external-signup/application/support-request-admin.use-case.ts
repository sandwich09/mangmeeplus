import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
import {
  ConflictException, Injectable, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  type SupportReplyDeliveryStatus,
  type SupportRequestActionDto,
  type SupportRequestClosedReason,
  type SupportRequestCountDto,
  type SupportRequestItemDto,
  type SupportRequestMediaError,
  type SupportRequestMessageDto,
  type SupportRequestQueueDto,
  type SupportRequestReplyResultDto,
  type SupportRequestStatus,
  type SupportRequestThreadDto,
} from '@watchdog-bms/contracts';
import { Prisma, type LineSupportRequest } from '../../../generated/prisma/client';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { pushLineMessages } from '../../auth/infrastructure/system-line-push';
import { canonicalAttachmentExtension } from '../../data-model-core/domain/logic/attachment.logic';
import {
  checkShopMessage, shopMessageAllowedHosts, shopMessageBodyTh,
} from '../../system-partner-management/domain/logic/partner-line-message.logic';
import { supportAskerLabelTh } from './line-signup-notify.service';
import {
  SUPPORT_REQUEST_ANSWERED_ACTION,
  SUPPORT_REQUEST_CLAIM_ACTION,
  SUPPORT_REQUEST_PAUSE_ACTION,
  SUPPORT_REQUEST_RELEASE_ACTION,
  SUPPORT_REQUEST_REPLY_ACTION,
  SUPPORT_REQUEST_RESOLVE_ACTION,
  SUPPORT_REQUEST_RESUME_ACTION,
  SUPPORT_ASSISTANT_PAUSE_MS,
} from '../domain/support-request.constants';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const LINE_RETRY_KEY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SUPPORT_RESOLUTION_NOTE_MAX_LENGTH = 500;
/**
 * สัญญา v3 ข้อ 11. A support thread is a conversation, not a log: five hundred bubbles is more than
 * any case has needed. ponytail: a hard cap, oldest first; add a cursor when a thread ever hits it.
 */
const THREAD_MAX_MESSAGES = 500;

/** PR E (R-E5): same 8-char suffix formatting as `billingSupportReference` (apps/web/.../billing-display.ts)
 *  — `referenceId` here is always a raw UUID, so the short-form (invoice-number) branch never applies. */
function supportRequestReferenceLabel(id: string): string {
  const tail = id.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-8);
  return `${tail.slice(0, 4)}-${tail.slice(4)}`;
}

/** What the thread read selects: never `lineMessageId`, `operationId` or `senderUserId` (§3). */
const SUPPORT_MESSAGE_SELECT = {
  id: true, direction: true, kind: true, text: true, senderName: true,
  mediaMimeType: true, mediaByteSize: true, mediaFileName: true, mediaError: true,
  deliveryStatus: true, createdAt: true,
  // Presence only — the bytes stay in their own table until the content route asks for them.
  blob: { select: { messageId: true } },
} as const;

type SupportMessageRow = {
  id: string; direction: string; kind: string; text: string | null; senderName: string | null;
  mediaMimeType: string | null; mediaByteSize: number | null; mediaFileName: string | null;
  mediaError: string | null; deliveryStatus: string | null; createdAt: Date;
  blob: { messageId: string } | null;
};

export type SupportRequestListOptions = {
  status?: SupportRequestStatus;
  cursor?: string;
  limit?: number;
};

/** `notifiedAt` separates "not tried" from "every notification rail failed". */
export function supportNotifyState(
  row: { notifiedAt: Date | null; lineNotifiedCount: number; emailSent: boolean },
): SupportRequestItemDto['notifyState'] {
  if (!row.notifiedAt) return 'queued';
  return row.lineNotifiedCount > 0 || row.emailSent ? 'notified' : 'unreachable';
}

export function encodeSupportQueueCursor(lastMessageAt: Date, id: string): string {
  return Buffer.from(`${lastMessageAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeSupportQueueCursor(cursor: string | undefined): { lastMessageAt: Date; id: string } | null {
  if (!cursor) return null;
  const [at, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const id = rest.join('|');
  const lastMessageAt = at ? new Date(at) : new Date(NaN);
  return id && !Number.isNaN(lastMessageAt.getTime()) ? { lastMessageAt, id } : null;
}

function keysetAfter(after: { lastMessageAt: Date; id: string }) {
  return {
    OR: [
      { lastMessageAt: { gt: after.lastMessageAt } },
      { lastMessageAt: after.lastMessageAt, id: { gt: after.id } },
    ],
  };
}

function deliveryStatus(value: string | null): SupportReplyDeliveryStatus | undefined {
  return value === 'PENDING' || value === 'SENT' || value === 'FAILED' ? value : undefined;
}

/** Only the bounded codes reach the UI; an unknown stored reason reads as the generic one. */
function mediaError(value: string | null): SupportRequestMediaError | undefined {
  if (!value) return undefined;
  return value === 'media_security_rejected' || value === 'media_scan_failed' || value === 'media_limit_reached'
    ? value : 'media_fetch_failed';
}

/** One bubble. Exported so a spec can check the §3 boundary on the exact shape the page renders. */
export function toSupportMessageDto(row: SupportMessageRow): SupportRequestMessageDto {
  const error = mediaError(row.mediaError);
  const status = deliveryStatus(row.deliveryStatus);
  return {
    id: row.id,
    direction: row.direction === 'STAFF' ? 'STAFF' : 'CUSTOMER',
    kind: row.kind === 'IMAGE' || row.kind === 'FILE' ? row.kind : 'TEXT',
    ...(row.text ? { text: row.text } : {}),
    ...(row.senderName ? { senderName: row.senderName } : {}),
    hasContent: Boolean(row.blob),
    ...(row.mediaFileName ? { fileName: row.mediaFileName } : {}),
    ...(row.mediaMimeType ? { mimeType: row.mediaMimeType } : {}),
    ...(row.mediaByteSize ? { byteSize: row.mediaByteSize } : {}),
    ...(error ? { mediaError: error } : {}),
    ...(status ? { deliveryStatus: status } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Only bounded provider codes reach storage/UI; response bodies, tokens and recipient ids never do. */
export function supportReplyErrorCode(value: string): string {
  return /^[a-z0-9_]{1,64}$/.test(value) ? value : 'line_delivery_failed';
}

function textHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validRetryKey(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

@Injectable()
export class SupportRequestAdminUseCase {
  constructor(private readonly lineCredentials: LineMessagingCredentialsService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async openCount(): Promise<SupportRequestCountDto> {
    return { open: await this.prisma.client.lineSupportRequest.count({ where: { status: 'OPEN' } }) };
  }

  async list(adminUserId: string, options: SupportRequestListOptions = {}): Promise<SupportRequestQueueDto> {
    const pageSize = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    const baseWhere = options.status ? { status: options.status } : {};
    const after = decodeSupportQueueCursor(options.cursor);
    if (options.cursor && !after) throw new UnprocessableEntityException('support_queue_cursor_invalid');
    const where = after ? { AND: [baseWhere, keysetAfter(after)] } : baseWhere;
    const [found, openCount, totalCount] = await Promise.all([
      this.prisma.client.lineSupportRequest.findMany({
        where,
        // Oldest customer message first: this is a work queue, and new activity must not bury the
        // person who has already waited the longest. The id makes the cursor deterministic.
        orderBy: [{ lastMessageAt: 'asc' }, { id: 'asc' }],
        take: pageSize + 1,
      }),
      this.prisma.client.lineSupportRequest.count({ where: { status: 'OPEN' } }),
      this.prisma.client.lineSupportRequest.count({ where: baseWhere }),
    ]);
    const rows = found.slice(0, pageSize);
    const last = rows[rows.length - 1];
    const nextCursor = found.length > pageSize && last
      ? encodeSupportQueueCursor(last.lastMessageAt, last.id)
      : null;
    if (rows.length === 0) return { items: [], openCount, totalCount, nextCursor: null };
    return { openCount, totalCount, nextCursor, items: await this.toItems(rows, adminUserId) };
  }

  /**
   * สัญญา v3 ข้อ 11: the request AND everything said on it, in one read. The row rides along so the
   * chat window can poll a single endpoint and never show a status the inbox has already moved past.
   * CLOSED cases are readable until the 90-day purge takes them — that is what the ปิดแล้ว tab is for.
   */
  async thread(id: string, adminUserId: string): Promise<SupportRequestThreadDto> {
    const [row, rows] = await Promise.all([
      this.prisma.client.lineSupportRequest.findUnique({ where: { id } }),
      this.prisma.client.lineSupportMessage.findMany({
        where: { requestId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: THREAD_MAX_MESSAGES,
        select: SUPPORT_MESSAGE_SELECT,
      }),
    ]);
    if (!row) throw new NotFoundException(`Support request "${id}" not found.`);
    const [request] = await this.toItems([row], adminUserId);
    return { request: request!, messages: rows.map(toSupportMessageDto) };
  }

  /** The stored bytes of one customer photo/file, scoped to its request so an id from another case 404s. */
  async messageContent(id: string, messageId: string): Promise<{ data: Buffer; mimeType: string; fileName: string }> {
    const stored = await this.prisma.client.lineSupportMessageBlob.findFirst({
      where: { messageId, message: { requestId: id } },
      include: { message: { select: { mediaMimeType: true, mediaFileName: true } } },
    });
    if (!stored) throw new NotFoundException('Support message content not found.');
    const mimeType = stored.message.mediaMimeType ?? 'application/octet-stream';
    return {
      data: Buffer.from(stored.data),
      mimeType,
      // A photo arrives without a name; ours carries our own id and an extension the browser can use.
      fileName: stored.message.mediaFileName ?? `support-${messageId}.${canonicalAttachmentExtension(mimeType) ?? 'bin'}`,
    };
  }

  /** Row → DTO, with every name the rows point at looked up once per page. Shared by `list` and `thread`. */
  private async toItems(rows: LineSupportRequest[], adminUserId: string): Promise<SupportRequestItemDto[]> {
    const companyIds = [...new Set(rows.map((row) => row.companyId).filter((id): id is string => !!id))];
    const signupIds = [...new Set(rows.map((row) => row.signupRequestId).filter((id): id is string => !!id))];
    const userIds = [...new Set(rows.flatMap((row) => [
      row.answeredByUserId, row.assignedToUserId, row.resolvedByUserId,
    ]).filter((id): id is string => !!id))];
    const lineUserIds = [...new Set(rows.filter((row) => !!row.companyId).map((row) => row.lineUserId))];
    const [companies, signups, users, lineContexts] = await Promise.all([
      companyIds.length
        ? this.prisma.client.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      signupIds.length
        ? this.prisma.client.companySignupRequest.findMany({
          where: { id: { in: signupIds } },
          select: { id: true, companyName: true, reviewResolution: true, resolutionNote: true },
        })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } })
        : Promise.resolve([]),
      lineUserIds.length
        ? this.prisma.client.lineCompanyContext.findMany({
          where: { lineUserId: { in: lineUserIds } }, select: { lineUserId: true, aiPausedUntil: true },
        })
        : Promise.resolve([]),
    ]);
    const companyName = new Map(companies.map((row) => [row.id, row.name]));
    const appliedName = new Map(signups.map((row) => [row.id, row.companyName]));
    const requestedInformation = new Map(signups.flatMap((row) =>
      row.reviewResolution === 'REQUEST_INFO' && row.resolutionNote
        ? [[row.id, row.resolutionNote] as const]
        : []));
    const userName = new Map(users.map((row) => [row.id, row.displayName]));
    const pausedUntil = new Map(lineContexts.map((row) => [row.lineUserId, row.aiPausedUntil]));
    const now = Date.now();
    const assistantIsActive = (lineUserId: string) => {
      const until = pausedUntil.get(lineUserId);
      return !until || until.getTime() <= now;
    };

    return rows.map((row): SupportRequestItemDto => ({
        id: row.id,
        status: row.status,
        askerLabel: supportAskerLabelTh(
          (row.companyId && companyName.get(row.companyId)) || null,
          (row.signupRequestId && appliedName.get(row.signupRequestId)) || null,
        ),
        askerRef: row.lineUserIdHash.slice(-6),
        ...(row.companyId ? { companyId: row.companyId } : {}),
        ...(row.signupRequestId ? { signupRequestId: row.signupRequestId } : {}),
        ...(row.signupRequestId && requestedInformation.get(row.signupRequestId)
          ? { requestedInformation: requestedInformation.get(row.signupRequestId)! }
          : {}),
        requestedAt: row.requestedAt.toISOString(),
        ...(row.requestText ? { requestText: row.requestText } : {}),
        ...(row.lastMessageText ? { lastMessageText: row.lastMessageText } : {}),
        lastMessageAt: row.lastMessageAt.toISOString(),
        ...(row.lastMediaAt ? { lastMediaAt: row.lastMediaAt.toISOString() } : {}),
        reopenedCount: row.reopenedCount,
        lineNotifiedCount: row.lineNotifiedCount,
        emailSent: row.emailSent,
        notifyState: supportNotifyState(row),
        ...(row.answeredAt ? { answeredAt: row.answeredAt.toISOString() } : {}),
        ...(row.answeredByUserId && userName.get(row.answeredByUserId)
          ? { answeredByDisplayName: userName.get(row.answeredByUserId)! }
          : {}),
        ...(row.assignedAt ? { assignedAt: row.assignedAt.toISOString() } : {}),
        ...(row.assignedToUserId
          ? { assigneeDisplayName: userName.get(row.assignedToUserId) ?? 'บัญชีทีมงานที่ไม่ใช้งาน' }
          : {}),
        assignedToMe: row.assignedToUserId === adminUserId,
        ...(row.companyId && pausedUntil.has(row.lineUserId)
          ? { assistantActive: assistantIsActive(row.lineUserId) }
          : {}),
        ...(row.assignmentNote ? { assignmentNote: row.assignmentNote } : {}),
        ...(row.replyOperationId ? { replyOperationId: row.replyOperationId } : {}),
        ...(row.replyFirstAttemptAt ? { replyFirstAttemptAt: row.replyFirstAttemptAt.toISOString() } : {}),
        ...(row.lastReplyText ? { lastReplyText: row.lastReplyText } : {}),
        ...(row.lastReplySenderName ? { lastReplyByDisplayName: row.lastReplySenderName } : {}),
        ...(deliveryStatus(row.lastReplyDeliveryStatus)
          ? { lastReplyDeliveryStatus: deliveryStatus(row.lastReplyDeliveryStatus)! }
          : {}),
        ...(row.lastReplyError ? { lastReplyError: supportReplyErrorCode(row.lastReplyError) } : {}),
        ...(row.closedAt ? { closedAt: row.closedAt.toISOString() } : {}),
        ...(row.closedReason ? { closedReason: row.closedReason as SupportRequestClosedReason } : {}),
        ...(row.resolvedByUserId && userName.get(row.resolvedByUserId)
          ? { resolvedByDisplayName: userName.get(row.resolvedByUserId)! }
          : {}),
        ...(row.resolutionNote ? { resolutionNote: row.resolutionNote } : {}),
        ...(row.referenceKind === 'attempt' || row.referenceKind === 'invoice' ? { referenceKind: row.referenceKind } : {}),
        ...(row.referenceId ? { referenceId: row.referenceId, referenceLabel: supportRequestReferenceLabel(row.referenceId) } : {}),
    }));
  }

  async claim(id: string, adminUserId: string, requestId: string): Promise<SupportRequestActionDto> {
    const request = await this.require(id);
    if (request.status === 'CLOSED') throw new NotFoundException(`Support request "${id}" not found.`);
    if (request.assignedToUserId === adminUserId) {
      return { id, status: request.status, assignedToMe: true, assigneeDisplayName: await this.userName(adminUserId) };
    }
    const claimed = await this.prisma.client.$transaction(async (tx) => {
      const moved = await tx.lineSupportRequest.updateMany({
        where: { id, status: { not: 'CLOSED' }, assignedToUserId: null },
        data: { assignedToUserId: adminUserId, assignedAt: new Date(), assignmentNote: null },
      });
      if (moved.count === 0) return false;
      await this.audit(SUPPORT_REQUEST_CLAIM_ACTION, id, request.companyId, adminUserId, requestId, {}, 'SUCCESS', tx);
      return true;
    });
    if (!claimed) await this.throwOwnershipConflict(id, adminUserId);
    return { id, status: request.status, assignedToMe: true, assigneeDisplayName: await this.userName(adminUserId) };
  }

  async release(id: string, adminUserId: string, requestId: string): Promise<SupportRequestActionDto> {
    const request = await this.require(id);
    if (request.status === 'CLOSED') throw new NotFoundException(`Support request "${id}" not found.`);
    if (!request.assignedToUserId) return { id, status: request.status, assignedToMe: false };
    if (request.assignedToUserId !== adminUserId) await this.throwOwnershipConflict(id, adminUserId);
    const released = await this.prisma.client.$transaction(async (tx) => {
      const moved = await tx.lineSupportRequest.updateMany({
        where: { id, status: { not: 'CLOSED' }, assignedToUserId: adminUserId },
        data: { assignedToUserId: null, assignedAt: null, assignmentNote: null },
      });
      if (moved.count === 0) return false;
      await this.audit(SUPPORT_REQUEST_RELEASE_ACTION, id, request.companyId, adminUserId, requestId, {}, 'SUCCESS', tx);
      return true;
    });
    if (!released) await this.throwOwnershipConflict(id, adminUserId);
    return { id, status: request.status, assignedToMe: false };
  }

  /** Explicit, version-checked handoff when the previous operator cannot release the case. */
  async reclaim(
    id: string,
    expectedAssignedAt: string,
    reason: string,
    adminUserId: string,
    requestId: string,
  ): Promise<SupportRequestActionDto> {
    const assignedAt = new Date(expectedAssignedAt);
    const assignmentNote = reason.trim();
    if (Number.isNaN(assignedAt.getTime()) || !assignmentNote || assignmentNote.length > SUPPORT_RESOLUTION_NOTE_MAX_LENGTH) {
      throw new UnprocessableEntityException('support_reclaim_input_invalid');
    }
    const request = await this.require(id);
    if (request.status === 'CLOSED') throw new NotFoundException(`Support request "${id}" not found.`);
    if (!request.assignedToUserId) {
      throw new ConflictException({ code: 'support_request_changed', message: 'Support request is no longer assigned.' });
    }
    if (request.assignedToUserId === adminUserId) {
      return { id, status: request.status, assignedToMe: true, assigneeDisplayName: await this.userName(adminUserId) };
    }
    const previousAssignee = request.assignedToUserId;
    const reclaimed = await this.prisma.client.$transaction(async (tx) => {
      const moved = await tx.lineSupportRequest.updateMany({
        where: {
          id,
          status: { not: 'CLOSED' },
          assignedToUserId: previousAssignee,
          assignedAt,
        },
        data: { assignedToUserId: adminUserId, assignedAt: new Date(), assignmentNote },
      });
      if (moved.count === 0) return false;
      await this.audit(SUPPORT_REQUEST_CLAIM_ACTION, id, request.companyId, adminUserId, requestId, {
        takeover: true, previousAssigneeUserId: previousAssignee, reasonRecorded: true,
      }, 'SUCCESS', tx);
      return true;
    });
    if (!reclaimed) await this.throwOwnershipConflict(id, adminUserId);
    return { id, status: request.status, assignedToMe: true, assigneeDisplayName: await this.userName(adminUserId) };
  }

  /** Request-bound reply for every support case, including an applicant with no company. */
  async reply(
    id: string,
    text: string,
    operationId: string,
    previousReplyOperationId: string | null | undefined,
    adminUserId: string,
    requestId: string,
  ): Promise<SupportRequestReplyResultDto> {
    if (!validRetryKey(operationId)) {
      throw new UnprocessableEntityException('support_reply_operation_id_invalid');
    }
    if (previousReplyOperationId === undefined
      || (previousReplyOperationId !== null && !validRetryKey(previousReplyOperationId))) {
      throw new UnprocessableEntityException('support_reply_previous_operation_id_invalid');
    }
    const request = await this.requireOwnedLive(id, adminUserId);
    const check = checkShopMessage(text, shopMessageAllowedHosts(this.config.sesWebBaseUrl));
    if (!check.ok) {
      if (check.reason === 'empty') throw new UnprocessableEntityException('partner_line_message_empty');
      if (check.reason === 'too_long') throw new UnprocessableEntityException('partner_line_message_too_long');
      throw new UnprocessableEntityException('partner_line_message_external_link');
    }
    const token = (await this.lineCredentials.get()).accessToken;
    if (!token) throw new UnprocessableEntityException('line_messaging_channel_not_configured');
    const now = new Date();
    const senderName = request.replyOperationId === operationId && request.lastReplySenderName
      ? request.lastReplySenderName
      : await this.userName(adminUserId);
    const body = shopMessageBodyTh(senderName, check.text);
    const hash = textHash(check.text);
    const replay = request.replyOperationId === operationId;
    if (!replay && request.replyOperationId !== previousReplyOperationId) {
      throw new ConflictException({ code: 'support_request_changed', message: 'Support request changed. Reload and retry.' });
    }
    if (replay && request.replyTextHash !== hash) {
      throw new ConflictException({
        code: 'support_reply_operation_payload_changed',
        message: 'Retry the same reply operation with the same text.',
      });
    }
    if (replay && request.lastReplyDeliveryStatus === 'SENT') {
      return { id, status: request.status, deliveryStatus: 'SENT' };
    }
    if (
      replay
      && request.replyFirstAttemptAt
      && now.getTime() - request.replyFirstAttemptAt.getTime() >= LINE_RETRY_KEY_WINDOW_MS
    ) {
      return {
        id,
        status: request.status,
        deliveryStatus: 'FAILED',
        errorCode: 'support_reply_retry_window_expired',
      };
    }
    if (
      !replay
      && request.lastReplyDeliveryStatus === 'PENDING'
      && (!request.replyFirstAttemptAt
        || now.getTime() - request.replyFirstAttemptAt.getTime() < LINE_RETRY_KEY_WINDOW_MS)
    ) {
      throw new ConflictException({ code: 'support_reply_in_progress', message: 'A support reply is already in progress.' });
    }
    if (
      !replay
      && request.lastReplyDeliveryStatus === 'FAILED'
      && request.replyFirstAttemptAt
      && now.getTime() - request.replyFirstAttemptAt.getTime() < LINE_RETRY_KEY_WINDOW_MS
    ) {
      throw new ConflictException({
        code: 'support_reply_retry_same_operation',
        message: 'Retry the previous reply operation before starting another.',
      });
    }

    if (replay) {
      // The first-attempt stamp never moves: LINE only dedupes this UUID for 24 hours from its
      // first use, so extending our own clock would promise safety the provider no longer offers.
      const prepared = await this.prisma.client.lineSupportRequest.updateMany({
        where: {
          id,
          status: request.status,
          assignedToUserId: adminUserId,
          lastMessageAt: request.lastMessageAt,
          replyOperationId: operationId,
          replyTextHash: hash,
          lastReplyDeliveryStatus: { in: ['PENDING', 'FAILED'] },
        },
        data: { lastReplyDeliveryStatus: 'PENDING', lastReplyError: null },
      });
      if (prepared.count === 0) {
        const current = await this.require(id);
        if (current.replyOperationId === operationId && current.lastReplyDeliveryStatus === 'SENT') {
          return { id, status: current.status, deliveryStatus: 'SENT' };
        }
        throw new ConflictException({ code: 'support_request_changed', message: 'Support request changed. Reload and retry.' });
      }
      await this.recordStaffMessage(id, operationId, check.text, senderName, adminUserId);
    } else {
      const prepared = await this.prisma.client.lineSupportRequest.updateMany({
        where: {
          id,
          status: request.status,
          assignedToUserId: adminUserId,
          lastMessageAt: request.lastMessageAt,
          replyOperationId: request.replyOperationId,
          lastReplyDeliveryStatus: request.lastReplyDeliveryStatus,
        },
        data: {
          replyOperationId: operationId,
          replyTextHash: hash,
          replyFirstAttemptAt: now,
          lastReplyText: check.text,
          lastReplySenderName: senderName,
          lastReplyDeliveryStatus: 'PENDING',
          lastReplyError: null,
        },
      });
      if (prepared.count === 0) {
        throw new ConflictException({ code: 'support_request_changed', message: 'Support request changed. Reload and retry.' });
      }
      await this.recordStaffMessage(id, operationId, check.text, senderName, adminUserId);
    }

    const outcome = await pushLineMessages({
      token,
      lineUserId: request.lineUserId,
      messages: [{ type: 'text', text: body }],
      retryKey: operationId,
    });
    if (!outcome.ok) {
      const errorCode = supportReplyErrorCode(outcome.error);
      const failed = await this.prisma.client.$transaction(async (tx) => {
        await tx.lineSupportRequest.updateMany({
          where: { id, replyOperationId: operationId, lastReplyDeliveryStatus: 'PENDING' },
          data: { lastReplyDeliveryStatus: 'FAILED', lastReplyError: errorCode },
        });
        const current = await tx.lineSupportRequest.findUnique({
          where: { id }, select: { status: true, replyOperationId: true, lastReplyDeliveryStatus: true },
        });
        if (!current) throw new NotFoundException(`Support request "${id}" not found.`);
        // Another retry of this SAME operation may have succeeded first. SENT is monotonic and wins;
        // a late failing HTTP call cannot turn an accepted reply back into FAILED.
        if (current.replyOperationId === operationId && current.lastReplyDeliveryStatus === 'SENT') {
          return { status: current.status, sent: true };
        }
        // The bubble follows the row: SENT is monotonic there too.
        await tx.lineSupportMessage.updateMany({
          where: { requestId: id, operationId, deliveryStatus: { not: 'SENT' } },
          data: { deliveryStatus: 'FAILED' },
        });
        await this.audit(SUPPORT_REQUEST_REPLY_ACTION, id, request.companyId, adminUserId, requestId, {
          deliveryStatus: 'FAILED', errorCode, operationId,
        }, 'FAILED', tx);
        return { status: current.status, sent: false };
      });
      return failed.sent
        ? { id, status: failed.status, deliveryStatus: 'SENT' }
        : { id, status: failed.status, deliveryStatus: 'FAILED', errorCode };
    }

    // Provider-result state, the answer decision, and its audit commit together. If audit storage
    // fails, the provider may already have accepted the push; the row remains retryable and LINE's
    // same operation UUID repairs it without duplicating the message.
    const persisted = await this.prisma.client.$transaction(async (tx) => {
      // SENT is monotonic for one operation. This also repairs FAILED when two same-key retries race.
      await tx.lineSupportRequest.updateMany({
        where: {
          id,
          replyOperationId: operationId,
          lastReplyDeliveryStatus: { in: ['PENDING', 'FAILED'] },
        },
        data: { lastReplyDeliveryStatus: 'SENT', lastReplyError: null },
      });
      await tx.lineSupportMessage.updateMany({
        where: { requestId: id, operationId },
        data: { deliveryStatus: 'SENT' },
      });
      // The customer may write while LINE accepts this push. Only the unchanged request becomes
      // ANSWERED; otherwise the newer customer message stays in the queue.
      const answered = await tx.lineSupportRequest.updateMany({
        where: {
          id,
          assignedToUserId: adminUserId,
          status: request.status,
          lastMessageAt: request.lastMessageAt,
          answeredAt: request.answeredAt,
          replyOperationId: operationId,
          lastReplyDeliveryStatus: 'SENT',
        },
        data: { status: 'ANSWERED', answeredAt: now, answeredByUserId: adminUserId },
      });
      const current = await tx.lineSupportRequest.findUnique({
        where: { id }, select: { status: true, lastMessageAt: true },
      });
      if (!current) throw new NotFoundException(`Support request "${id}" not found.`);
      const newerCustomerMessage = current.lastMessageAt.getTime() !== request.lastMessageAt.getTime();
      await this.audit(SUPPORT_REQUEST_REPLY_ACTION, id, request.companyId, adminUserId, requestId, {
        deliveryStatus: 'SENT', operationId, newerCustomerMessage,
      }, 'SUCCESS', tx);
      return { status: current.status, newerCustomerMessage, answered: answered.count > 0 };
    });
    return {
      id,
      status: persisted.status,
      deliveryStatus: 'SENT',
      ...(!persisted.answered && persisted.newerCustomerMessage ? { newerCustomerMessage: true } : {}),
    };
  }

  /** Manual acknowledgement remains compatible, but it is not resolution. */
  async markAnswered(id: string, adminUserId: string, requestId: string): Promise<SupportRequestActionDto> {
    const request = await this.requireOwnedLive(id, adminUserId);
    if (request.status === 'ANSWERED') return { id, status: 'ANSWERED', assignedToMe: true };
    const answered = await this.prisma.client.lineSupportRequest.updateMany({
      where: { id, status: 'OPEN', assignedToUserId: adminUserId, lastMessageAt: request.lastMessageAt },
      data: { status: 'ANSWERED', answeredAt: new Date(), answeredByUserId: adminUserId },
    });
    if (answered.count === 0) {
      throw new ConflictException({ code: 'support_request_changed', message: 'Support request changed. Reload and retry.' });
    }
    await this.audit(SUPPORT_REQUEST_ANSWERED_ACTION, id, request.companyId, adminUserId, requestId, {
      previousStatus: request.status,
    });
    return { id, status: 'ANSWERED', assignedToMe: true };
  }

  /** Clearing the bot pause changes no support outcome. */
  async resumeAssistant(id: string, adminUserId: string, requestId: string): Promise<SupportRequestActionDto> {
    const request = await this.requireOwnedLive(id, adminUserId);
    if (!request.companyId) throw new UnprocessableEntityException('support_request_assistant_unavailable');
    const context = await this.prisma.client.lineCompanyContext.findUnique({
      where: { lineUserId: request.lineUserId }, select: { lineUserId: true },
    });
    if (!context) throw new UnprocessableEntityException('support_request_assistant_unavailable');
    const cleared = await this.prisma.client.lineCompanyContext.updateMany({
      where: { lineUserId: request.lineUserId, aiPausedUntil: { not: null } },
      data: { aiPausedUntil: null },
    });
    await this.audit(SUPPORT_REQUEST_RESUME_ACTION, id, request.companyId, adminUserId, requestId, {
      status: request.status,
      pauseCleared: cleared.count > 0,
    });
    return {
      id, status: request.status, assignedToMe: true,
      pauseCleared: cleared.count > 0, assistantActive: true,
    };
  }

  /** Pausing the assistant changes no support outcome and is idempotent for the current LINE user. */
  async pauseAssistant(id: string, adminUserId: string, requestId: string): Promise<SupportRequestActionDto> {
    const request = await this.requireOwnedLive(id, adminUserId);
    if (!request.companyId) throw new UnprocessableEntityException('support_request_assistant_unavailable');
    const aiPausedUntil = new Date(Date.now() + SUPPORT_ASSISTANT_PAUSE_MS);
    const paused = await this.prisma.client.lineCompanyContext.updateMany({
      where: { lineUserId: request.lineUserId },
      data: { aiPausedUntil },
    });
    if (paused.count === 0) throw new UnprocessableEntityException('support_request_assistant_unavailable');
    await this.audit(SUPPORT_REQUEST_PAUSE_ACTION, id, request.companyId, adminUserId, requestId, {
      status: request.status,
    });
    return { id, status: request.status, assignedToMe: true, assistantActive: false };
  }

  async resolve(
    id: string,
    note: string,
    adminUserId: string,
    requestId: string,
  ): Promise<SupportRequestActionDto> {
    const resolutionNote = note.trim();
    if (!resolutionNote || resolutionNote.length > SUPPORT_RESOLUTION_NOTE_MAX_LENGTH) {
      throw new UnprocessableEntityException('support_resolution_note_invalid');
    }
    const request = await this.require(id);
    if (request.status === 'CLOSED') {
      return { id, status: 'CLOSED', assignedToMe: request.assignedToUserId === adminUserId };
    }
    this.assertOwned(request, adminUserId);
    const resolved = await this.prisma.client.$transaction(async (tx) => {
      const moved = await tx.lineSupportRequest.updateMany({
        where: { id, status: request.status, assignedToUserId: adminUserId, lastMessageAt: request.lastMessageAt },
        data: {
          status: 'CLOSED', closedAt: new Date(), closedReason: 'resolved',
          resolvedByUserId: adminUserId, resolutionNote,
        },
      });
      if (moved.count === 0) return false;
      await this.audit(SUPPORT_REQUEST_RESOLVE_ACTION, id, request.companyId, adminUserId, requestId, {
        previousStatus: request.status,
        resolutionRecorded: true,
      }, 'SUCCESS', tx);
      return true;
    });
    if (!resolved) {
      throw new ConflictException({ code: 'support_request_changed', message: 'Support request changed. Reload and retry.' });
    }
    return { id, status: 'CLOSED', assignedToMe: true };
  }

  /**
   * สัญญา v3 ข้อ 9: the bubble for this reply, keyed by its operation so a same-key retry updates it
   * instead of adding one. Written AFTER the row accepted the operation and BEFORE the push, so a
   * PENDING bubble exists for exactly as long as the row says a send is in flight.
   */
  private async recordStaffMessage(
    requestId: string, operationId: string, text: string, senderName: string, senderUserId: string,
  ): Promise<void> {
    await this.prisma.client.lineSupportMessage.upsert({
      where: { requestId_operationId: { requestId, operationId } },
      create: {
        requestId, direction: 'STAFF', kind: 'TEXT', text, senderName, senderUserId, operationId,
        deliveryStatus: 'PENDING',
      },
      update: { deliveryStatus: 'PENDING' },
    });
  }

  private async require(id: string) {
    const request = await this.prisma.client.lineSupportRequest.findUnique({
      where: { id },
      select: {
        id: true, status: true, companyId: true, lineUserId: true, lastMessageAt: true,
        assignedToUserId: true, assignedAt: true, answeredAt: true,
        replyOperationId: true, replyTextHash: true, replyFirstAttemptAt: true,
        lastReplyText: true, lastReplySenderName: true, lastReplyDeliveryStatus: true,
      },
    });
    if (!request) throw new NotFoundException(`Support request "${id}" not found.`);
    return request;
  }

  private async requireOwnedLive(id: string, adminUserId: string) {
    const request = await this.require(id);
    if (request.status === 'CLOSED') throw new NotFoundException(`Support request "${id}" not found.`);
    this.assertOwned(request, adminUserId);
    return request;
  }

  private assertOwned(request: { assignedToUserId: string | null }, adminUserId: string): void {
    if (request.assignedToUserId === adminUserId) return;
    if (!request.assignedToUserId) {
      throw new ConflictException({ code: 'support_request_not_claimed', message: 'Claim this support request first.' });
    }
    throw new ConflictException({ code: 'support_request_owned_by_other', message: 'Another operator owns this support request.' });
  }

  private async throwOwnershipConflict(id: string, adminUserId: string): Promise<never> {
    const current = await this.require(id);
    if (current.status === 'CLOSED') throw new NotFoundException(`Support request "${id}" not found.`);
    if (!current.assignedToUserId || current.assignedToUserId === adminUserId) {
      throw new ConflictException({ code: 'support_request_changed', message: 'Support request changed. Reload and retry.' });
    }
    throw new ConflictException({
      code: 'support_request_owned_by_other',
      message: 'Another operator owns this support request.',
      assigneeDisplayName: await this.userName(current.assignedToUserId),
    });
  }

  private async userName(userId: string): Promise<string> {
    return (await this.prisma.client.user.findUnique({
      where: { id: userId }, select: { displayName: true },
    }))?.displayName ?? 'ทีมงาน';
  }

  private async audit(
    action: string,
    id: string,
    companyId: string | null,
    adminUserId: string,
    requestId: string,
    metadataJson: Prisma.InputJsonValue,
    result: 'SUCCESS' | 'FAILED' = 'SUCCESS',
    tx?: { auditLog: { create(args: unknown): Promise<unknown> } },
  ): Promise<void> {
    await (tx ?? this.prisma.client).auditLog.create({
      data: {
        ...(companyId ? { companyId } : {}),
        actorUserId: adminUserId,
        action,
        targetType: 'line_support_request',
        targetId: id,
        requestId,
        result,
        riskLevel: 'HIGH',
        metadataJson,
      },
    });
  }
}
