import type { BillingEventDiscountTicket, BillingEventDiscountView, BillingOffer, BillingPolicy, BillingPurchaseSource, BillingStatus } from '@watchdog-bms/contracts';
import { Prisma } from '../../../generated/prisma/client';
import { DEAL_KIND } from '../../sales-console/domain/sales-deal.logic';
import { salesEventTicketDisplayState } from '../../sales-console/domain/sales-event-claim.logic';
import { pickEventDiscount, type EventDiscountSnapshot } from '../domain/billing-event-discount.logic';
import { packageMenuPurchaseSource } from './billing-purchase-source';

/**
 * Sales-event first-bill discount, database side (docs/specs/sales-event-discounts-spec-th.md §4.2, §4.3, §6.3, §6.4).
 * Every write runs inside the caller's transaction, after its company lock: Company → BillingAccount → ticket.
 */
type Tx = Prisma.TransactionClient;
const TAKEN = ['RESERVED', 'USED'];

/** Spec §2 ผู้ถือ: the ACTIVE LINE identities of this user, matched the way `ExternalIdentity` stores them. */
async function holders(tx: Tx, userId: string) {
  const rows = await tx.externalIdentity.findMany({ where: { userId, provider: 'LINE', status: 'ACTIVE' }, select: { providerChannelId: true, providerUserId: true } });
  return rows.map(row => ({ holderProvider: 'LINE', holderChannelId: row.providerChannelId, holderProviderUserId: row.providerUserId }));
}

/** Spec §4.2 and SD-O5: why this shop takes no first-bill discount right now, if it cannot. */
export async function eventDiscountBlock(tx: Tx, companyId: string, now: Date): Promise<'DEAL_ACTIVE' | 'COMPANY_ALREADY_USED' | null> {
  if (await tx.salesEventTicket.findFirst({ where: { companyId, redeemedAs: 'DISCOUNT', state: { in: TAKEN } }, select: { id: true } })) return 'COMPANY_ALREADY_USED';
  if (await tx.packageChangeRequest.findFirst({ where: { companyId, kind: DEAL_KIND,
    OR: [{ status: 'APPROVED', offerExpiresAt: { gt: now } }, { status: 'PAID' }] }, select: { id: true } })) return 'DEAL_ACTIVE';
  return null;
}

/** The holder's tickets this shop could use: ISSUED, unexpired, a discount, batch not suspended, batch not yet used here (SD-Q8). */
async function usableTickets(tx: Tx, userId: string, companyId: string, now: Date) {
  const own = await holders(tx, userId);
  if (!own.length) return [];
  return tx.salesEventTicket.findMany({ where: { OR: own, state: 'ISSUED', expiresAt: { gt: now }, discountSatang: { gt: 0 },
    batch: { state: { not: 'SUSPENDED' }, tickets: { none: { companyId, state: { in: TAKEN } } } } },
    include: { batch: { select: { eventName: true } } }, orderBy: { id: 'asc' }, take: 50 });
}

/** The ticket and amounts a quote for this card would carry, or null (same helper as the page, SED-14). */
export async function eventDiscountOffer(tx: Tx, input: { userId: string; companyId: string; offer: BillingOffer; tax: BillingPolicy['taxTreatment']; now: Date }) {
  const tickets = await usableTickets(tx, input.userId, input.companyId, input.now);
  if (!tickets.length || await eventDiscountBlock(tx, input.companyId, input.now)) return null;
  return pickEventDiscount(tickets, input.offer, input.tax);
}

/** The package page's view (spec §3.4 ก, §8): the holder's best ticket and the cards it lowers, or why this shop cannot use it. */
export async function eventDiscountView(tx: Tx, input: { userId: string; companyId: string; offers: BillingOffer[]; tax: BillingPolicy['taxTreatment']; now: Date }): Promise<BillingStatus['eventDiscount']> {
  const tickets = await usableTickets(tx, input.userId, input.companyId, input.now);
  if (!tickets.length) return undefined;
  const reason = await eventDiscountBlock(tx, input.companyId, input.now);
  const best = [...tickets].sort((a, b) => b.discountSatang - a.discountSatang || a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id))[0]!;
  return { ticketSerial: best.serial, eventName: best.batch.eventName, discountSatang: best.discountSatang, expiresAt: best.expiresAt.toISOString(), reason,
    offers: reason ? [] : input.offers.flatMap(offer => {
      const pick = pickEventDiscount(tickets, offer, input.tax);
      return pick ? [{ offerKey: offer.offerKey, interval: offer.interval, eventName: pick.ticket.batch.eventName, shownDiscountSatang: pick.amounts.shownDiscountSatang }] : [];
    }) };
}

/**
 * Checkout (spec §6.4), after the attempt row and `activeAttemptId`: ISSUED → RESERVED for this attempt. The row's own
 * version and state fence the write; false = the quoted ticket changed, was taken, or this shop may no longer use it.
 */
export async function reserveEventDiscount(tx: Tx, discount: Extract<EventDiscountSnapshot, { choice: 'USE' }>,
  input: { userId: string; companyId: string; attemptId: string; now: Date }): Promise<boolean> {
  const own = await holders(tx, input.userId);
  const ticket = own.length ? await tx.salesEventTicket.findFirst({ where: { id: discount.ticketId, OR: own }, include: { batch: { select: { state: true } } } }) : null;
  if (!ticket || ticket.state !== 'ISSUED' || ticket.version !== discount.ticketVersion || ticket.expiresAt <= input.now || ticket.batch.state === 'SUSPENDED' ||
      ticket.discountSatang !== discount.discountSatang || await eventDiscountBlock(tx, input.companyId, input.now) ||
      await tx.salesEventTicket.findFirst({ where: { batchId: ticket.batchId, companyId: input.companyId, state: { in: TAKEN } }, select: { id: true } })) return false;
  try {
    const changed = await tx.salesEventTicket.updateMany({ where: { id: ticket.id, state: 'ISSUED', version: discount.ticketVersion },
      data: { state: 'RESERVED', redeemedAs: 'DISCOUNT', companyId: input.companyId, attemptId: input.attemptId,
        appliedDiscountSatang: discount.shownDiscountSatang, reservedAt: input.now, version: { increment: 1 } } });
    return changed.count === 1;
  } catch (error) {
    // A partial unique (one discount per shop, one ticket per shop per batch) lost a race: the quote is stale.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
    throw error;
  }
}

/** Paid (spec §6.3): RESERVED → USED on the verified invoice, before any HELD exit. False = not reserved for this attempt. */
export async function useEventDiscount(tx: Tx, input: { attemptId: string; invoiceId: string; companyId: string; now: Date }): Promise<boolean> {
  const changed = await tx.salesEventTicket.updateMany({ where: { attemptId: input.attemptId, companyId: input.companyId, state: 'RESERVED', redeemedAs: 'DISCOUNT' },
    data: { state: 'USED', invoiceId: input.invoiceId, usedAt: input.now, version: { increment: 1 } } });
  return changed.count === 1 || !!await tx.salesEventTicket.findFirst({ where: { attemptId: input.attemptId, companyId: input.companyId,
    invoiceId: input.invoiceId, state: 'USED' }, select: { id: true } });
}

/** An attempt that ended without money (failed, refused, expired, cancelled) gives its ticket back, every link cleared. */
export async function releaseEventDiscount(tx: Tx, attemptId: string): Promise<void> {
  await tx.salesEventTicket.updateMany({ where: { attemptId, state: 'RESERVED' }, data: { state: 'ISSUED', redeemedAs: null, companyId: null,
    attemptId: null, appliedDiscountSatang: null, reservedAt: null, version: { increment: 1 } } });
}

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
