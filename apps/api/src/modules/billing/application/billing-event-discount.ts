import type { BillingEventDiscountTicket, BillingEventDiscountView, BillingPurchaseSource } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import { salesEventTicketDisplayState } from '../../sales-console/domain/sales-event-claim.logic';
import { packageMenuPurchaseSource } from './billing-purchase-source';

/** Newest first; a person collects one ticket per batch, so this is many events' worth. */
const HOLDER_TICKET_LIMIT = 50;

/** Sales-event spec §4.1: a shop that starts a package gets the first-bill discount, a paying shop credit. */
export function eventDiscountPath(source: BillingPurchaseSource): BillingEventDiscountView['path'] {
  if (packageMenuPurchaseSource(source)) return 'DISCOUNT';
  return source === 'PAID_CURRENT_MODE' ? 'CREDIT' : null;
}

/**
 * The tickets held by the LINE accounts linked to this login (spec §2 "ผู้ถือ"). Matched on the
 * ACTIVE identity only, so unlinking LINE hides them, and nothing identifies the LINE account in the
 * answer. Another plan manager of the same shop sees their own tickets, never these (§3.4).
 */
export async function holderEventDiscountTickets(
  db: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<BillingEventDiscountTicket[]> {
  const identities = await db.externalIdentity.findMany({
    where: { userId, provider: 'LINE', status: 'ACTIVE' },
    select: { providerChannelId: true, providerUserId: true },
  });
  if (identities.length === 0) return [];
  const tickets = await db.salesEventTicket.findMany({
    where: { holderProvider: 'LINE', OR: identities.map((identity) => ({
      holderChannelId: identity.providerChannelId, holderProviderUserId: identity.providerUserId,
    })) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: HOLDER_TICKET_LIMIT,
    select: {
      serial: true, state: true, expiresAt: true, discountSatang: true, rewardChatCreditUnits: true, rewardReceiptImageUnits: true,
      batch: { select: { eventName: true, state: true } },
    },
  });
  return tickets.map((ticket) => ({
    serial: ticket.serial,
    eventName: ticket.batch.eventName,
    discountSatang: ticket.discountSatang,
    chatCreditUnits: ticket.rewardChatCreditUnits,
    receiptImageUnits: ticket.rewardReceiptImageUnits,
    expiresAt: ticket.expiresAt.toISOString(),
    state: salesEventTicketDisplayState(ticket, now),
    batchSuspended: ticket.batch.state === 'SUSPENDED',
  }));
}
