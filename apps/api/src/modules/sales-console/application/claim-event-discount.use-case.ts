import { Injectable } from '@nestjs/common';
import type { SalesEventClaimResult } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuthRateLimitService } from '../../auth/application/auth-rate-limit.service';
import { LineIdTokenService } from '../../auth/application/line-id-token.service';
import {
  hashSalesEventQrToken,
  newSalesEventTicketSerial,
  salesEventClaimRefusal,
  salesEventTicketExpiresAt,
  type SalesEventClaimRefusal,
} from '../domain/sales-event-claim.logic';
import { PLATFORM_TENANT_ID, salesError, salesForbidden } from './sales-context';

export type ClaimEventDiscountCommand = {
  idToken: string;
  qrToken: string;
  /** Stored on a new ticket for tracing. Idempotency itself is the one-ticket-per-holder-per-batch rule. */
  requestKey: string;
  requestId: string;
};

/** Spec §7.3 wording. The LIFF page shows its own copy for each code; this is the API's message. */
const REFUSAL_TH: Record<SalesEventClaimRefusal, string> = {
  SALES_EVENT_QR_EXPIRED: 'QR นี้หมดอายุแล้ว ขอให้ผู้แจกสร้าง QR ใหม่',
  SALES_EVENT_CLAIM_CLOSED: 'งานนี้ปิดรับส่วนลดแล้ว',
  SALES_EVENT_AGENT_INACTIVE: 'QR นี้ใช้ไม่ได้แล้ว ขอให้ผู้แจกสร้าง QR ใหม่',
  SALES_EVENT_ISSUE_FULL: 'ส่วนลดของงานนี้ถูกแจกครบแล้ว',
};

const TICKET_SELECT = {
  id: true, serial: true, discountSatang: true, rewardChatCreditUnits: true, rewardReceiptImageUnits: true, expiresAt: true,
  batch: { select: { eventName: true } },
} as const;

/**
 * Sales-event discounts, SD-B (spec §3.3, §6.4): a scan of a เซลล์'s QR through LINE issues one
 * ticket bound to the scanning LINE identity — not to a shop; the shop is chosen when it is used.
 *
 * The verified ID token is the only identity input. Issuing happens in one transaction under the
 * batch row lock: replay, refusal checks, insert with the batch's values frozen, `issuedCount + 1`
 * and the audit row. The batch `version` is the console's edit fence and is never touched here.
 */
@Injectable()
export class ClaimEventDiscountUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lineIdToken: LineIdTokenService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  async execute(cmd: ClaimEventDiscountCommand, now = new Date()): Promise<SalesEventClaimResult> {
    const verified = await this.lineIdToken.verify(cmd.idToken);
    await this.rateLimit.assertSalesEventClaimAllowed(verified.providerUserId);

    const identity = await this.prisma.client.externalIdentity.findUnique({
      where: { provider_providerChannelId_providerUserId: {
        provider: 'LINE', providerChannelId: verified.channelId, providerUserId: verified.providerUserId,
      } },
      select: { userId: true, status: true, user: { select: { status: true } } },
    });
    const linked = identity?.status === 'ACTIVE' && identity.user.status === 'ACTIVE';
    // SD-Q3: an account in the platform tenant (the sales team, the Owner) cannot collect a discount.
    if (identity?.status === 'ACTIVE' && await this.prisma.client.companyMembership.findFirst({
      where: { userId: identity.userId, companyId: PLATFORM_TENANT_ID, status: 'ACTIVE' }, select: { id: true },
    })) throw salesForbidden('SALES_EVENT_SELF_CLAIM', 'บัญชีทีมขายรับส่วนลดนี้ไม่ได้');

    const qr = await this.prisma.client.salesEventQrToken.findUnique({
      where: { tokenHash: hashSalesEventQrToken(cmd.qrToken) },
      select: { batchId: true, salesUserId: true, expiresAt: true },
    });
    if (!qr) throw salesError('SALES_EVENT_QR_EXPIRED', REFUSAL_TH.SALES_EVENT_QR_EXPIRED);
    const holder = { batchId: qr.batchId, holderChannelId: verified.channelId, holderProviderUserId: verified.providerUserId };

    const { ticket, replay } = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SalesEventBatch" WHERE "id" = ${qr.batchId} FOR UPDATE`;
      // Replay before any refusal, under the lock: scanning again, or retrying an answer that was
      // lost after the QR ran out, returns the ticket already held (spec §3.3 step 3). The lock also
      // makes a second concurrent scan by the same person land here instead of on the unique index.
      const held = await tx.salesEventTicket.findUnique({
        where: { batchId_holderChannelId_holderProviderUserId: holder }, select: TICKET_SELECT,
      });
      if (held) return { ticket: held, replay: true };

      const batch = await tx.salesEventBatch.findUniqueOrThrow({ where: { id: qr.batchId } });
      const distributor = await tx.salesEventBatchAgent.findUnique({
        where: { batchId_salesUserId: { batchId: qr.batchId, salesUserId: qr.salesUserId } }, select: { active: true },
      });
      const profile = distributor?.active
        ? await tx.salesAgentProfile.findUnique({ where: { userId: qr.salesUserId }, select: { status: true } })
        : null;
      const refusal = salesEventClaimRefusal({ now, qrExpiresAt: qr.expiresAt, batch, distributorActive: profile?.status === 'ACTIVE' });
      if (refusal) throw salesError(refusal, REFUSAL_TH[refusal]);

      // ponytail: a serial collision (32^8 space) fails this claim with a 500; the page's retry draws a new one.
      const created = await tx.salesEventTicket.create({
        data: {
          ...holder,
          serial: newSalesEventTicketSerial(),
          batchRevision: batch.revision,
          salesUserId: qr.salesUserId,
          holderProvider: 'LINE',
          discountSatang: batch.discountSatang,
          rewardChatCreditUnits: batch.rewardChatCreditUnits,
          rewardReceiptImageUnits: batch.rewardReceiptImageUnits,
          scopeJson: batch.scopeJson as Prisma.InputJsonValue,
          expiresAt: salesEventTicketExpiresAt(batch.claimEndsAt),
          claimRequestKey: cmd.requestKey,
        },
        select: TICKET_SELECT,
      });
      await tx.salesEventBatch.update({ where: { id: batch.id }, data: { issuedCount: { increment: 1 } } });
      await tx.auditLog.create({
        data: {
          actorType: 'SERVICE',
          actorRefId: 'sales-event-claim',
          action: 'sales.event.ticket_claimed',
          targetType: 'SalesEventTicket',
          targetId: created.id,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'MEDIUM',
          // No LINE identity: it is kept on the ticket for matching and never leaves the API.
          metadataJson: { batchId: batch.id, batchRevision: batch.revision, salesUserId: qr.salesUserId,
            serial: created.serial, linkedAccount: linked },
        },
      });
      return { ticket: created, replay: false };
    });

    return {
      ticket: {
        serial: ticket.serial,
        eventName: ticket.batch.eventName,
        discountSatang: ticket.discountSatang,
        chatCreditUnits: ticket.rewardChatCreditUnits,
        receiptImageUnits: ticket.rewardReceiptImageUnits,
        expiresAt: ticket.expiresAt.toISOString(),
      },
      replay,
      next: linked ? 'OPEN_PACKAGE' : 'SIGN_UP',
    };
  }
}
