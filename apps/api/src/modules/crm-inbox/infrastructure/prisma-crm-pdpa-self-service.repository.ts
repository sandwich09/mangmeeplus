import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';

export type CrmCustomerDataExport = {
  customer: {
    id: string;
    displayName: string;
    consentStatus: 'UNKNOWN' | 'GRANTED' | 'REVOKED' | 'NOT_REQUIRED';
    consentUpdatedAt: Date | null;
    createdAt: Date;
  };
  conversations: Array<{ id: string; channelId: string; status: string; createdAt: Date; lastMessageAt: Date | null }>;
  messages: Array<{ id: string; conversationId: string; direction: string; contentText: string | null; createdAt: Date }>;
  bookings: Array<{ id: string; serviceName: string; status: string; startAt: Date; endAt: Date; createdAt: Date }>;
  pagination: {
    conversations: ExportPageMetadata;
    messages: ExportPageMetadata;
    bookings: ExportPageMetadata;
  };
  inventory: {
    included: string[];
    excluded: string[];
  };
};

export type CrmCustomerDataExportPage = {
  conversationCursor?: string;
  messageCursor?: string;
  bookingCursor?: string;
  limit?: number;
};

type ExportPageMetadata = {
  total: number;
  returned: number;
  limit: number;
  truncated: boolean;
  nextCursor: string | null;
};

export type CrmErasureCase = {
  id: string;
  companyId: string;
  customerId: string;
  status: string;
  requestedAt: Date;
  dueAt: Date;
  attemptCount: number;
  notificationStatus: string;
};

const EXPORT_DEFAULT_LIMIT = 250;
const EXPORT_MAX_LIMIT = 500;
const ERASURE_SLA_MS = 30 * 24 * 60 * 60 * 1000;

function pageLimit(input?: number): number {
  if (!Number.isInteger(input)) return EXPORT_DEFAULT_LIMIT;
  return Math.min(EXPORT_MAX_LIMIT, Math.max(1, input!));
}

function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}\n${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string): { at: Date; id: string } | undefined {
  if (!cursor || cursor.length > 512) return undefined;
  try {
    const [rawAt, id, ...extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('\n');
    const at = new Date(rawAt ?? '');
    if (!id || extra.length > 0 || Number.isNaN(at.getTime())) return undefined;
    return { at, id };
  } catch {
    return undefined;
  }
}

function cursorWhere(cursor: { at: Date; id: string } | undefined, dateField: string): Record<string, unknown> {
  return cursor
    ? { OR: [{ [dateField]: { gt: cursor.at } }, { [dateField]: cursor.at, id: { gt: cursor.id } }] }
    : {};
}

function pageMetadata<T>(
  rows: T[],
  total: number,
  limit: number,
  cursorOf: (row: T) => string,
): { items: T[]; metadata: ExportPageMetadata } {
  const truncated = rows.length > limit;
  const items = rows.slice(0, limit);
  return {
    items,
    metadata: {
      total,
      returned: items.length,
      limit,
      truncated,
      nextCursor: truncated && items.length > 0 ? cursorOf(items.at(-1)!) : null,
    },
  };
}

/**
 * Customer self-service PDPA data access (CUST-08). Owns the consent-withdrawal
 * write and the bounded export reads for a verified customer. Kept out of the
 * autonomy-owned prisma-crm-inbox repository so the customer-facing surface stays
 * independently deployable.
 */
@Injectable()
export class PrismaCrmPdpaSelfServiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * Customer-initiated consent withdrawal. Tenant + customer scoped; skips
   * already-erased rows. Advisory-locked to serialize against identity merges,
   * mirroring the CRM customer-write convention (see CrmAiContextRepository).
   * The live-consent fence in crm-ai-auto-reply already DENYs any reply once
   * REVOKED lands, so no reply can leak while a queued autonomy job drains.
   */
  async revokeConsent(companyId: string, customerId: string, now: Date, note: string): Promise<{ updated: boolean }> {
    return this.db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-identity-graph:' || ${companyId}))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${companyId} || ':' || ${customerId}))::text`;
      const res = await tx.crmCustomer.updateMany({
        where: { id: customerId, companyId, personalDataErasedAt: null },
        data: { consentStatus: 'REVOKED', consentUpdatedAt: now, consentNote: note },
      });
      return { updated: res.count === 1 };
    });
  }

  /**
   * Bounded, tenant + customer scoped self-service export. Returns only
   * customer-visible fields: NEVER other customers (every query filters companyId
   * + customerId), NEVER staff-internal notes (messages filter visibility
   * CUSTOMER, excluding INTERNAL_NOTE), NEVER finance rows or internal scores (no
   * amounts / notes / lead-trust fields selected). Read-only.
   */
  async exportCustomerData(
    companyId: string,
    customerId: string,
    page: CrmCustomerDataExportPage = {},
  ): Promise<CrmCustomerDataExport | null> {
    const customer = await this.db.crmCustomer.findFirst({
      where: { id: customerId, companyId, personalDataErasedAt: null },
      select: { id: true, displayName: true, consentStatus: true, consentUpdatedAt: true, createdAt: true },
    });
    if (!customer) return null;

    const limit = pageLimit(page.limit);
    const conversationCursor = decodeCursor(page.conversationCursor);
    const messageCursor = decodeCursor(page.messageCursor);
    const bookingCursor = decodeCursor(page.bookingCursor);
    const conversationWhere = { companyId, customerId, ...cursorWhere(conversationCursor, 'createdAt') };
    const messageWhere: Prisma.CrmMessageWhereInput = {
      companyId,
      visibility: 'CUSTOMER',
      conversation: { companyId, customerId },
      ...cursorWhere(messageCursor, 'createdAt'),
    };
    const bookingWhere = { companyId, customerId, ...cursorWhere(bookingCursor, 'startAt') };

    const [conversationTotal, messageTotal, bookingTotal] = await Promise.all([
      this.db.crmConversation.count({ where: { companyId, customerId } }),
      this.db.crmMessage.count({ where: { companyId, visibility: 'CUSTOMER', conversation: { companyId, customerId } } }),
      this.db.crmBooking.count({ where: { companyId, customerId } }),
    ]);

    const conversationRows = await this.db.crmConversation.findMany({
      where: conversationWhere,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: { id: true, channelId: true, status: true, createdAt: true, lastMessageAt: true },
    });

    const messageRows = await this.db.crmMessage.findMany({
      where: messageWhere,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: { id: true, conversationId: true, direction: true, contentText: true, createdAt: true },
    });

    const bookingRows = await this.db.crmBooking.findMany({
      where: bookingWhere,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: { id: true, serviceName: true, status: true, startAt: true, endAt: true, createdAt: true },
    });

    const conversations = pageMetadata(conversationRows, conversationTotal, limit, (row) => encodeCursor(row.createdAt, row.id));
    const messages = pageMetadata(messageRows, messageTotal, limit, (row) => encodeCursor(row.createdAt, row.id));
    const bookings = pageMetadata(bookingRows, bookingTotal, limit, (row) => encodeCursor(row.startAt, row.id));
    return {
      customer,
      conversations: conversations.items,
      messages: messages.items,
      bookings: bookings.items,
      pagination: {
        conversations: conversations.metadata,
        messages: messages.metadata,
        bookings: bookings.metadata,
      },
      inventory: {
        included: ['customer profile', 'customer-visible conversations', 'customer-visible messages', 'bookings'],
        excluded: ['staff internal notes', 'finance records under legal retention', 'internal lead/trust scores'],
      },
    };
  }

  async createOrGetErasureCase(
    companyId: string,
    customerId: string,
    reasonProvided: boolean,
    now: Date,
  ): Promise<CrmErasureCase> {
    return this.db.crmDataSubjectRequest.upsert({
      where: { requestKey: `${companyId}:${customerId}:ERASURE` },
      update: {},
      create: {
        requestKey: `${companyId}:${customerId}:ERASURE`,
        companyId,
        customerId,
        reasonProvided,
        requestedAt: now,
        dueAt: new Date(now.getTime() + ERASURE_SLA_MS),
      },
      select: {
        id: true, companyId: true, customerId: true, status: true, requestedAt: true,
        dueAt: true, attemptCount: true, notificationStatus: true,
      },
    });
  }

  async findErasureCase(companyId: string, customerId: string, caseId: string): Promise<CrmErasureCase | null> {
    return this.db.crmDataSubjectRequest.findFirst({
      where: { id: caseId, companyId, customerId, requestType: 'ERASURE' },
      select: {
        id: true, companyId: true, customerId: true, status: true, requestedAt: true,
        dueAt: true, attemptCount: true, notificationStatus: true,
      },
    });
  }

  async claimNextErasureCase(now: Date): Promise<CrmErasureCase | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = await this.db.crmDataSubjectRequest.findFirst({
        where: {
          OR: [
            { status: 'RECEIVED' },
            { status: 'FAILED_RETRYABLE', nextAttemptAt: { lte: now } },
          ],
        },
        orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
      });
      if (!candidate) return null;
      const claimed = await this.db.crmDataSubjectRequest.updateMany({
        where: { id: candidate.id, status: candidate.status },
        data: { status: 'PROCESSING', startedAt: candidate.startedAt ?? now, attemptCount: { increment: 1 }, nextAttemptAt: null, lastErrorCode: null },
      });
      if (claimed.count === 1) return this.findErasureCase(candidate.companyId, candidate.customerId, candidate.id);
    }
    return null;
  }

  async completeErasureCase(
    caseId: string,
    status: 'COMPLETED' | 'COMPLETED_WITH_EXCEPTION',
    resultJson: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    await this.db.crmDataSubjectRequest.update({
      where: { id: caseId },
      data: {
        status,
        completedAt: now,
        nextAttemptAt: null,
        lastErrorCode: null,
        resultJson: resultJson as Prisma.InputJsonValue,
        notificationStatus: 'QUEUED',
      },
    });
  }

  async requeueCompletedErasureCasesBefore(restoredSnapshotAt: Date, now: Date): Promise<number> {
    const result = await this.db.crmDataSubjectRequest.updateMany({
      where: {
        requestType: 'ERASURE',
        status: { in: ['COMPLETED', 'COMPLETED_WITH_EXCEPTION'] },
        completedAt: { lte: restoredSnapshotAt },
      },
      data: {
        status: 'FAILED_RETRYABLE',
        nextAttemptAt: now,
        completedAt: null,
        lastErrorCode: 'POST_RESTORE_REERASURE_REQUIRED',
        notificationStatus: 'PENDING',
      },
    });
    return result.count;
  }

  async failErasureCase(caseId: string, attemptCount: number, errorCode: string, now: Date): Promise<void> {
    const terminal = attemptCount >= 5;
    await this.db.crmDataSubjectRequest.update({
      where: { id: caseId },
      data: {
        status: terminal ? 'FAILED' : 'FAILED_RETRYABLE',
        nextAttemptAt: terminal ? null : new Date(now.getTime() + Math.min(24, 2 ** attemptCount) * 60 * 60 * 1000),
        lastErrorCode: errorCode.slice(0, 120),
        notificationStatus: terminal ? 'QUEUED' : 'PENDING',
      },
    });
  }
}
