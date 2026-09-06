import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  SupportRequestActionDto, SupportRequestClosedReason, SupportRequestCountDto,
  SupportRequestItemDto, SupportRequestQueueDto, SupportRequestStatus,
} from '@watchdog-bms/contracts';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { supportAskerLabelTh } from './line-signup-notify.service';
import {
  SUPPORT_REQUEST_ANSWERED_ACTION, SUPPORT_REQUEST_RESUME_ACTION,
} from '../domain/support-request.constants';

/** Bounded like the signup queue (`take: 200`): an operator scrolls, a page never streams a table. */
const QUEUE_LIMIT = 200;

/**
 * `notifiedAt` is the whole point of the distinction: before the drain runs, the two counters hold
 * their DEFAULTS, which look exactly like "every channel failed". Derived rather than stored,
 * because a stored third state could disagree with the counters it summarises.
 */
export function supportNotifyState(
  row: { notifiedAt: Date | null; lineNotifiedCount: number; emailSent: boolean },
): SupportRequestItemDto['notifyState'] {
  if (!row.notifiedAt) return 'queued';
  return row.lineNotifiedCount > 0 || row.emailSent ? 'notified' : 'unreachable';
}

/**
 * line-support-request-spec-th §2.3 — the operator's inbox for "ติดต่อเจ้าหน้าที่".
 *
 * Owner 2026-09-05 made this the PRIMARY channel: no operator has LINE linked, so this page, not a
 * push, is how anyone learns a customer is waiting. That is why `openCount` is returned on every
 * read whatever `status` filters the list — the system nav badge is fed from it.
 *
 * The reply itself is NOT here. Operators answer from the partner page's existing message box,
 * which pushes to the CUSTOMER's LINE over the OA token and needs no LINE account of its own; this
 * class only moves the request's own state and records who moved it.
 */
@Injectable()
export class SupportRequestAdminUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The badge number on its own. The system header asks on every navigation, and answering that
   * with the 200-row queue read was a page of rows nobody renders.
   */
  async openCount(): Promise<SupportRequestCountDto> {
    return { open: await this.prisma.client.lineSupportRequest.count({ where: { status: 'OPEN' } }) };
  }

  async list(status?: SupportRequestStatus): Promise<SupportRequestQueueDto> {
    const [rows, openCount] = await Promise.all([
      this.prisma.client.lineSupportRequest.findMany({
        ...(status ? { where: { status } } : {}),
        // OPEN first, then the newest CUSTOMER message: `status` sorts OPEN < ANSWERED < CLOSED as
        // declared in the enum, which is the order an operator works in. Ordering by `requestedAt`
        // buried a request the customer had just written to under every newer ask (UAT 2026-09-06).
        orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
        take: QUEUE_LIMIT,
      }),
      this.prisma.client.lineSupportRequest.count({ where: { status: 'OPEN' } }),
    ]);
    if (rows.length === 0) return { items: [], openCount };

    // Three batched lookups rather than per-row queries, the same shape the signup queue uses.
    const companyIds = [...new Set(rows.map((row) => row.companyId).filter((id): id is string => !!id))];
    const signupIds = [...new Set(rows.map((row) => row.signupRequestId).filter((id): id is string => !!id))];
    const answeredBy = [...new Set(rows.map((row) => row.answeredByUserId).filter((id): id is string => !!id))];
    const [companies, signups, answerers] = await Promise.all([
      companyIds.length
        ? this.prisma.client.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      signupIds.length
        ? this.prisma.client.companySignupRequest.findMany({
          where: { id: { in: signupIds } }, select: { id: true, companyName: true },
        })
        : Promise.resolve([]),
      answeredBy.length
        ? this.prisma.client.user.findMany({ where: { id: { in: answeredBy } }, select: { id: true, displayName: true } })
        : Promise.resolve([]),
    ]);
    const companyName = new Map(companies.map((row) => [row.id, row.name]));
    const appliedName = new Map(signups.map((row) => [row.id, row.companyName]));
    const answererName = new Map(answerers.map((row) => [row.id, row.displayName]));

    return {
      openCount,
      items: rows.map((row): SupportRequestItemDto => ({
        id: row.id,
        status: row.status,
        askerLabel: supportAskerLabelTh(
          (row.companyId && companyName.get(row.companyId)) || null,
          (row.signupRequestId && appliedName.get(row.signupRequestId)) || null,
        ),
        // §3 PDPA: a fragment of the hash, never the LINE id and never the LINE display name.
        askerRef: row.lineUserIdHash.slice(-6),
        ...(row.companyId ? { companyId: row.companyId } : {}),
        ...(row.signupRequestId ? { signupRequestId: row.signupRequestId } : {}),
        requestedAt: row.requestedAt.toISOString(),
        // Two different questions, and the inbox shows both: what they ASKED (immutable) and where
        // the thread has got to. A photo is a marker beside them, never a replacement (§3).
        ...(row.requestText ? { requestText: row.requestText } : {}),
        ...(row.lastMessageText ? { lastMessageText: row.lastMessageText } : {}),
        lastMessageAt: row.lastMessageAt.toISOString(),
        ...(row.lastMediaAt ? { lastMediaAt: row.lastMediaAt.toISOString() } : {}),
        reopenedCount: row.reopenedCount,
        lineNotifiedCount: row.lineNotifiedCount,
        emailSent: row.emailSent,
        notifyState: supportNotifyState(row),
        ...(row.answeredAt ? { answeredAt: row.answeredAt.toISOString() } : {}),
        ...(row.answeredByUserId && answererName.get(row.answeredByUserId)
          ? { answeredByDisplayName: answererName.get(row.answeredByUserId)! }
          : {}),
        ...(row.closedAt ? { closedAt: row.closedAt.toISOString() } : {}),
        ...(row.closedReason ? { closedReason: row.closedReason as SupportRequestClosedReason } : {}),
      })),
    };
  }

  /**
   * "ตอบแล้ว". Idempotent: pressing it twice keeps the first operator's name and timestamp, because
   * the second press is a click, not a second answer.
   */
  async markAnswered(id: string, adminUserId: string, requestId: string): Promise<SupportRequestActionDto> {
    const request = await this.require(id);
    if (request.status === 'ANSWERED') return { id, status: 'ANSWERED' };
    await this.prisma.client.lineSupportRequest.update({
      where: { id },
      data: { status: 'ANSWERED', answeredAt: new Date(), answeredByUserId: adminUserId },
    });
    await this.audit(SUPPORT_REQUEST_ANSWERED_ACTION, id, request.companyId, adminUserId, requestId, {
      previousStatus: request.status,
    });
    return { id, status: 'ANSWERED' };
  }

  /**
   * "ให้ AI ทำงานต่อ". Lifting the pause is the point — the request row is bookkeeping, the silent
   * assistant is what the customer is living with — so the clear runs first and unconditionally.
   */
  async resumeAssistant(id: string, adminUserId: string, requestId: string): Promise<SupportRequestActionDto> {
    const request = await this.require(id);
    const cleared = await this.prisma.client.lineCompanyContext.updateMany({
      where: { lineUserId: request.lineUserId, aiPausedUntil: { not: null } },
      data: { aiPausedUntil: null },
    });
    if (request.status !== 'CLOSED') {
      await this.prisma.client.lineSupportRequest.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date(), closedReason: 'admin' },
      });
    }
    await this.audit(SUPPORT_REQUEST_RESUME_ACTION, id, request.companyId, adminUserId, requestId, {
      previousStatus: request.status,
      pauseCleared: cleared.count > 0,
    });
    return { id, status: 'CLOSED', pauseCleared: cleared.count > 0 };
  }

  private async require(id: string) {
    const request = await this.prisma.client.lineSupportRequest.findUnique({
      where: { id },
      select: { id: true, status: true, companyId: true, lineUserId: true },
    });
    if (!request) throw new NotFoundException(`Support request "${id}" not found.`);
    return request;
  }

  /** Both buttons are HIGH: they change what a waiting customer experiences in their own chat. */
  private async audit(
    action: string,
    id: string,
    companyId: string | null,
    adminUserId: string,
    requestId: string,
    metadataJson: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        ...(companyId ? { companyId } : {}),
        actorUserId: adminUserId,
        action,
        targetType: 'line_support_request',
        targetId: id,
        requestId,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson,
      },
    });
  }
}
