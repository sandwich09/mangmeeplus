import type { CrmBookingProposalStatus } from '../logic/crm-booking-proposal.logic';

export type CrmBookingProposalRecord = {
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

export type CreateCrmBookingProposalInput = {
  companyId: string;
  conversationId: string;
  customerId: string;
  serviceItemId?: string | null;
  serviceName?: string | null;
  staffUserId?: string | null;
  branchId?: string | null;
  slotStart: Date;
  slotEnd: Date;
  sourceMessageId?: string | null;
  expiresAt: Date;
  /** Collapses retried proposals to one row (unique). */
  idempotencyKey: string;
  status?: CrmBookingProposalStatus;
};

export interface ICrmBookingProposalRepository {
  /** Create-once by idempotencyKey; returns the existing row on retry. */
  create(input: CreateCrmBookingProposalInput): Promise<CrmBookingProposalRecord>;
  findById(companyId: string, id: string): Promise<CrmBookingProposalRecord | null>;
  /** The newest non-terminal proposal on a conversation, if any. */
  findActiveByConversation(companyId: string, conversationId: string): Promise<CrmBookingProposalRecord | null>;
  /**
   * Insert-or-resolve a proposal by its slot fingerprint and, only when `fresh`,
   * supersede (CANCEL) any earlier pre-confirmation proposal on the conversation —
   * atomically under a per-conversation advisory lock so concurrent evaluations
   * cannot race create against supersede. `fresh` is decided by actual insertion,
   * not the returned row's status: a genuinely new row, an existing PROPOSED-but-
   * undelivered ask (its expiry/source refreshed), or a re-request whose only prior
   * row is terminal (the terminal row's fingerprint rotated aside) all count as
   * fresh; an open AWAITING/CONFIRMED/COMMITTING row collapses to itself (fresh=false).
   */
  createSuperseding(input: CreateCrmBookingProposalInput): Promise<{ proposal: CrmBookingProposalRecord; fresh: boolean }>;
  /**
   * Run `fn` while holding a per-conversation "ask lock". `fn` receives the lock
   * transaction: the ask path ignores it (its pre-stamp runs on the outer client), while
   * the confirm path claims the proposal ON it so a holder death rolls the claim back.
   */
  withAskLock<T>(companyId: string, conversationId: string, fn: (tx: unknown) => Promise<T>): Promise<T>;
  /**
   * Compare-and-set the status. Returns true only for the single caller who
   * still observed `from`, so concurrent confirmations have one winner. `extra`
   * atomically records booking/confirmation evidence on the winning hop. Pass `client`
   * to run the CAS on a transaction (e.g. the ask-lock tx) so it rolls back with it.
   */
  markStatus(
    companyId: string,
    id: string,
    from: CrmBookingProposalStatus,
    to: CrmBookingProposalStatus,
    extra?: { bookingId?: string; confirmMessageId?: string },
    client?: any,
  ): Promise<boolean>;
  /**
   * Finalize COMMITTING→BOOKED inside the caller's booking transaction; throws on
   * a lost race (rowcount !== 1) so the booking rolls back rather than double-book.
   */
  finalizeBookedWithinTx(tx: any, companyId: string, proposalId: string, bookingId: string): Promise<void>;
  /** Bulk-expire stale pre-confirmation proposals; returns the count moved to EXPIRED. */
  expireStale(companyId: string, now: Date): Promise<number>;
  /** Record (DB clock) that a proposal's confirm question became potentially visible (no status change). */
  recordQuestionSent(companyId: string, id: string): Promise<void>;
  /** H1: restore an explicit questionSentAt — reverts an undelivered re-ask's pre-stamp (no status change). */
  restoreQuestionSentAt(companyId: string, id: string, at: Date | null): Promise<void>;
  /** H2: liveness probe for the ask-lock holder tx — throws before a send if the holder tx already died. */
  assertAskLockAlive(tx: unknown): Promise<void>;
  /** The newest question-visibility timestamp among a conversation's OTHER proposals, if any. Optional `client` reads it on a tx. */
  findLatestQuestionSentAt(companyId: string, conversationId: string, excludeId: string, client?: any): Promise<Date | null>;
  /** Distinct companyIds with an expirable-past or stuck-finalizing proposal, for the per-company sweep. */
  findCompanyIdsWithSweepableProposals(now: Date, finalizingBefore: Date): Promise<string[]>;
  /** Crash recovery: move CONFIRMED/COMMITTING rows older than `olderThan` to HANDED_TO_STAFF; returns the count. */
  sweepStuckCommitting(companyId: string, olderThan: Date): Promise<number>;
}
