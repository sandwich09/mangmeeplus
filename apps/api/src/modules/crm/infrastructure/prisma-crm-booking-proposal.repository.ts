import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { assertTransition, isTerminal, type CrmBookingProposalStatus } from '../domain/logic/crm-booking-proposal.logic';
import type {
  CreateCrmBookingProposalInput,
  CrmBookingProposalRecord,
  ICrmBookingProposalRepository,
} from '../domain/ports/crm-booking-proposal-repository.port';

// Non-terminal statuses; only these can be an "active" proposal on a conversation.
const ACTIVE_STATUSES: CrmBookingProposalStatus[] = ['PROPOSED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'COMMITTING'];
// A confirmed/committing proposal is already progressing — never timer-expire it.
const EXPIRABLE_STATUSES: CrmBookingProposalStatus[] = ['PROPOSED', 'AWAITING_CONFIRMATION'];
// A crash between the two commit CAS hops can strand a proposal at CONFIRMED (which
// has no EXPIRED edge, so expireStale never touches it) or COMMITTING; both are
// recovered to HANDED_TO_STAFF by the finalizing sweep.
const STUCK_FINALIZING_STATUSES: CrmBookingProposalStatus[] = ['CONFIRMED', 'COMMITTING'];

type CrmBookingProposalRow = {
  id: string;
  companyId: string;
  conversationId: string;
  customerId: string;
  serviceItemId: string | null;
  serviceName: string | null;
  staffUserId: string | null;
  branchId: string | null;
  slotStart: Date;
  slotEnd: Date;
  status: CrmBookingProposalStatus;
  sourceMessageId: string | null;
  confirmMessageId: string | null;
  questionSentAt: Date | null;
  expiresAt: Date;
  idempotencyKey: string;
  bookingId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: CrmBookingProposalRow): CrmBookingProposalRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    conversationId: row.conversationId,
    customerId: row.customerId,
    serviceItemId: row.serviceItemId,
    serviceName: row.serviceName,
    staffUserId: row.staffUserId,
    branchId: row.branchId,
    slotStart: row.slotStart,
    slotEnd: row.slotEnd,
    status: row.status,
    sourceMessageId: row.sourceMessageId,
    confirmMessageId: row.confirmMessageId,
    questionSentAt: row.questionSentAt,
    expiresAt: row.expiresAt,
    idempotencyKey: row.idempotencyKey,
    bookingId: row.bookingId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaCrmBookingProposalRepository implements ICrmBookingProposalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateCrmBookingProposalInput): Promise<CrmBookingProposalRecord> {
    // Create-once: the unique idempotencyKey collapses a retried proposal to one
    // row (empty update = "leave the existing proposal untouched").
    const row = await this.prisma.client.crmBookingProposal.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        companyId: input.companyId,
        conversationId: input.conversationId,
        customerId: input.customerId,
        serviceItemId: input.serviceItemId ?? null,
        serviceName: input.serviceName ?? null,
        staffUserId: input.staffUserId ?? null,
        branchId: input.branchId ?? null,
        slotStart: input.slotStart,
        slotEnd: input.slotEnd,
        // A proposal is always born PROPOSED — the caller cannot seed a
        // terminal/booked row directly; status only advances via markStatus.
        status: 'PROPOSED',
        sourceMessageId: input.sourceMessageId ?? null,
        expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return toRecord(row as CrmBookingProposalRow);
  }

  async findById(companyId: string, id: string): Promise<CrmBookingProposalRecord | null> {
    const row = await this.prisma.client.crmBookingProposal.findFirst({ where: { id, companyId } });
    return row ? toRecord(row as CrmBookingProposalRow) : null;
  }

  async findActiveByConversation(companyId: string, conversationId: string): Promise<CrmBookingProposalRecord | null> {
    const row = await this.prisma.client.crmBookingProposal.findFirst({
      where: { companyId, conversationId, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toRecord(row as CrmBookingProposalRow) : null;
  }

  async createSuperseding(
    input: CreateCrmBookingProposalInput,
  ): Promise<{ proposal: CrmBookingProposalRecord; fresh: boolean }> {
    // Serialize create + supersede per conversation so two concurrent evaluations
    // cannot each create-then-cancel the other's row (leaving zero or two askable
    // proposals). The advisory lock makes the upsert and the supersede one atomic
    // step; only a freshly-PROPOSED row supersedes and gets asked.
    return this.prisma.client.$transaction(async (tx: any) => {
      // ::text cast: pg_advisory_xact_lock returns void, which the pg adapter cannot deserialize.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.companyId} || ':bookprop:' || ${input.conversationId}))::text`;
      const createData = {
        companyId: input.companyId,
        conversationId: input.conversationId,
        customerId: input.customerId,
        serviceItemId: input.serviceItemId ?? null,
        serviceName: input.serviceName ?? null,
        staffUserId: input.staffUserId ?? null,
        branchId: input.branchId ?? null,
        slotStart: input.slotStart,
        slotEnd: input.slotEnd,
        status: 'PROPOSED' as const,
        sourceMessageId: input.sourceMessageId ?? null,
        expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
      };
      // Query-first, never create-then-catch-P2002: on real Postgres a unique
      // violation aborts the whole transaction (25P02), so a caught P2002 followed
      // by more statements can never recover. The advisory lock above serializes
      // every same-conversation creator and the fingerprint embeds conversationId,
      // so a cross-conversation collision is impossible — the findUnique is the
      // authoritative resolve. `fresh` reflects an actual insert/refresh, so an
      // existing undelivered ask or a terminal leftover cannot masquerade.
      let row: CrmBookingProposalRow;
      let fresh: boolean;
      const existing = await tx.crmBookingProposal.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (!existing) {
        row = await tx.crmBookingProposal.create({ data: createData });
        fresh = true;
      } else if (existing.status === 'PROPOSED') {
        // F6: an earlier ask for this slot never got delivered. Refresh its expiry
        // and source anchor and re-ask, rather than leaving a stale-expiry row.
        row = await tx.crmBookingProposal.update({
          where: { id: existing.id },
          data: { expiresAt: input.expiresAt, sourceMessageId: input.sourceMessageId ?? null },
        });
        fresh = true;
      } else if (isTerminal(existing.status)) {
        // F7: a terminal row must not permanently occupy the slot fingerprint — a
        // re-request of a cancelled/expired slot would otherwise be silently dropped.
        // Rotate its key aside (unique, preserves the audit row) and insert fresh.
        await tx.crmBookingProposal.update({
          where: { id: existing.id },
          data: { idempotencyKey: `${input.idempotencyKey}:s:${existing.id}` },
        });
        row = await tx.crmBookingProposal.create({ data: createData });
        fresh = true;
      } else {
        // An open (AWAITING/CONFIRMED/COMMITTING) row: same-slot re-inquiry collapses
        // to it, left intact, no re-ask.
        row = existing;
        fresh = false;
      }
      // Only a fresh row supersedes any earlier pre-confirmation proposal, so a later
      // "ยืนยัน" resolves this slot and two concurrent evaluations can't race.
      if (fresh) {
        await tx.crmBookingProposal.updateMany({
          where: {
            companyId: input.companyId,
            conversationId: input.conversationId,
            id: { not: row.id },
            status: { in: ['PROPOSED', 'AWAITING_CONFIRMATION'] },
          },
          data: { status: 'CANCELLED' },
        });
      }
      return { proposal: toRecord(row as CrmBookingProposalRow), fresh };
    });
  }

  async withAskLock<T>(companyId: string, conversationId: string, fn: (tx: unknown) => Promise<T>): Promise<T> {
    // The transaction exists to hold a per-conversation advisory lock for fn's duration.
    // The ASK path deliberately runs its ops on the OUTER client and ignores the tx arg —
    // its pre-stamp (recordQuestionSent) must be durable regardless of this tx's fate, and
    // the send helper's withLiveCustomerLock opens its own separate transaction anyway. The
    // CONFIRM path instead claims the proposal ON this tx (fn receives it): a holder death
    // or lock expiry then rolls the AWAITING→CONFIRMED CAS back with the tx, so a confirm can
    // never leave a half-claimed proposal behind (fail-closed). Lock ordering: this is always
    // the OUTERMOST lock and is released before the booking transaction, so it never cycles
    // with the customer/staff/FOR-SHARE/':bookprop:' locks.
    return this.prisma.client.$transaction(async (tx: any) => {
      // ::text cast: pg_advisory_xact_lock returns void, which the pg adapter cannot deserialize.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId} || ':bookask:' || ${conversationId}))::text`;
      return await fn(tx);
    // A section can legitimately contain a LINE push plus the send helper's inner 35s
    // transaction; 120s makes lock expiry unreachable in practice, and the pre-stamp +
    // confirm-claim-on-tx make even an expiry/connection loss fail-closed.
    }, { maxWait: 15_000, timeout: 120_000 });
  }

  /**
   * F3/CUST-02: stamp that a proposal's confirm question became potentially visible during
   * the current ask-lock tenure. The caller invokes this on the OUTER client (auto-commit)
   * BEFORE the send, so the stamp is durable before the question can possibly be seen: a
   * holder death after the stamp leaves it behind, and a later confirm then reads it as a
   * sibling → ambiguous → re-ask (fail-closed). Stamps the DB clock (NOW()); written under
   * the ask lock, so stamp order == lock tenure == push order. Plain update by id+company
   * (no status change) so it is safe on any row, including a superseded one.
   */
  async recordQuestionSent(companyId: string, id: string): Promise<void> {
    await this.prisma.client.$executeRaw`
      UPDATE "CrmBookingProposal" SET "questionSentAt" = NOW()
      WHERE "id" = ${id} AND "companyId" = ${companyId}`;
  }

  /**
   * H1: revert a re-ask's pre-stamp to an explicit prior value. Unlike recordQuestionSent
   * (DB-clock NOW()), this writes the caller-supplied timestamp — it exists ONLY for the
   * in-lock revert of an UNDELIVERED re-ask, so the active proposal does not keep a false
   * "newest visible" stamp that a later bare "ยืนยัน" would resolve into a wrong commit. Plain
   * update by id+company (no status change), safe on any row; `null` restores an unset stamp.
   */
  async restoreQuestionSentAt(companyId: string, id: string, at: Date | null): Promise<void> {
    await this.prisma.client.crmBookingProposal.updateMany({
      where: { id, companyId },
      data: { questionSentAt: at },
    });
  }

  /**
   * H2: liveness probe for the ask-lock holder tx, run immediately before a question's send.
   * If the holder transaction already expired or lost its connection, this throws BEFORE the
   * question becomes externally visible — closing the expiry-before-push window. An in-flight
   * push after a mid-flight connection loss remains the documented accepted residual
   * (fail-closed to booking the customer's newest explicit request).
   */
  async assertAskLockAlive(tx: unknown): Promise<void> {
    await (tx as any).$queryRaw`SELECT 1`;
  }

  /**
   * F3: the newest question-visibility timestamp among a conversation's OTHER proposals.
   * Accepts an optional client so a confirm can read this ON the ask-lock tx, keeping the
   * provenance read atomic with the AWAITING→CONFIRMED claim that follows it.
   */
  async findLatestQuestionSentAt(
    companyId: string,
    conversationId: string,
    excludeId: string,
    client: any = this.prisma.client,
  ): Promise<Date | null> {
    const row = await client.crmBookingProposal.findFirst({
      where: { companyId, conversationId, id: { not: excludeId }, questionSentAt: { not: null } },
      orderBy: { questionSentAt: 'desc' },
      select: { questionSentAt: true },
    });
    return row?.questionSentAt ?? null;
  }

  /**
   * CUST-02: finalize a booked proposal in the caller's booking transaction. The
   * COMMITTING→BOOKED hop is coupled to the booking write — throwing on a lost
   * race (rowcount !== 1) rolls the booking back so a double-confirm can never
   * double-book.
   */
  async finalizeBookedWithinTx(tx: any, companyId: string, proposalId: string, bookingId: string): Promise<void> {
    const affected = await tx.$executeRaw`
      UPDATE "CrmBookingProposal"
      SET "status" = 'BOOKED', "bookingId" = ${bookingId}, "updatedAt" = NOW()
      WHERE "id" = ${proposalId} AND "companyId" = ${companyId} AND "status" = 'COMMITTING'`;
    if (affected !== 1) throw new Error('booking_proposal_finalize_lost_race');
  }

  async markStatus(
    companyId: string,
    id: string,
    from: CrmBookingProposalStatus,
    to: CrmBookingProposalStatus,
    extra?: { bookingId?: string; confirmMessageId?: string },
    // Optional client so the confirm path can run the AWAITING→CONFIRMED claim ON the
    // ask-lock tx (a holder death rolls it back); every other hop uses the outer client.
    client: any = this.prisma.client,
  ): Promise<boolean> {
    // Enforce the state machine at the persistence seam: an illegal hop throws
    // rather than silently attempting (and no-op-failing) the CAS below.
    assertTransition(from, to);
    // Compare-and-set: WHERE still matches `from` for exactly one racer, so
    // concurrent confirmations collapse to a single winner (count === 1). `extra`
    // atomically attaches the booking/confirmation evidence on the winning hop.
    const { count } = await client.crmBookingProposal.updateMany({
      where: { id, companyId, status: from },
      data: {
        status: to,
        ...(extra?.bookingId ? { bookingId: extra.bookingId } : {}),
        ...(extra?.confirmMessageId ? { confirmMessageId: extra.confirmMessageId } : {}),
      },
    });
    return count === 1;
  }

  async expireStale(companyId: string, now: Date): Promise<number> {
    const { count } = await this.prisma.client.crmBookingProposal.updateMany({
      where: { companyId, status: { in: EXPIRABLE_STATUSES }, expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    return count;
  }

  async findCompanyIdsWithSweepableProposals(now: Date, finalizingBefore: Date): Promise<string[]> {
    const rows = await this.prisma.client.crmBookingProposal.findMany({
      where: {
        OR: [
          { status: { in: EXPIRABLE_STATUSES }, expiresAt: { lte: now } },
          { status: { in: STUCK_FINALIZING_STATUSES }, updatedAt: { lt: finalizingBefore } },
        ],
      },
      select: { companyId: true },
      distinct: ['companyId'],
    });
    return rows.map((r) => r.companyId);
  }

  async sweepStuckCommitting(companyId: string, olderThan: Date): Promise<number> {
    // Crash recovery: a row older than the threshold that is still CONFIRMED or
    // COMMITTING means the process died mid-finalize — a crash between the AWAITING→
    // CONFIRMED and CONFIRMED→COMMITTING CAS hops strands CONFIRMED forever (no
    // EXPIRED edge), and COMMITTING never reached the finalize txn — so no booking
    // exists. Moving both to HANDED_TO_STAFF is fail-closed and unblocks a human.
    const { count } = await this.prisma.client.crmBookingProposal.updateMany({
      where: { companyId, status: { in: STUCK_FINALIZING_STATUSES }, updatedAt: { lt: olderThan } },
      data: { status: 'HANDED_TO_STAFF' },
    });
    return count;
  }
}
