/**
 * DB-backed neutral intake state (uat-correctness-latency spec §8.3).
 *
 * Availability contract — the EXACT OPPOSITE of `LineAiLedgerService`. The Redis ledger fails OPEN
 * on purpose: a Redis outage degrades to "no open question" and the turn proceeds. That is the
 * right trade for conversational context and the wrong one for money, because "no open question"
 * and "an open question I cannot read" are indistinguishable to the caller — and the second one
 * must never let a follow-up amount be merged or written. So every operation here fails CLOSED:
 * a store error returns `{ ok: false, reason: 'unavailable' }` and the caller performs ZERO domain
 * writes. Nothing in this file swallows an error into a success.
 *
 * Owner binding is the full triple (companyId, userId, chatKeyHash) and it is part of the WHERE
 * clause of every read and of the resolve UPDATE — never a post-hoc comparison. A different member,
 * a different chat or a different company therefore selects no row at all, so it cannot consume
 * someone else's open clarification even when it quotes the right state id.
 *
 * Merge rules (§8.3) this enforces mechanically:
 *  - rule 1/2: `acceptedHints` are carried on the row and only ever widened by the caller; this
 *    layer never silently drops an accepted field.
 *  - rule 5: consume is a single conditional UPDATE (CAS on `version`), so it is atomic on its own
 *    and idempotent under replay — a second attempt matches zero rows.
 *  - rule 6: a turn that resolves nothing simply never calls `resolveState`, so the row stays OPEN.
 *
 * Rows are DATA, never instructions (prompt-injection rule): the hints stored here are re-checked
 * by the capture use case at execution time and are never permission or authorization truth.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';

/** Who a state belongs to. All three parts, always — two out of three is a different owner. */
export type LineIntakeStateOwner = {
  companyId: string;
  userId: string;
  chatKeyHash: string;
};

export type LineIntakeStateRow = {
  id: string;
  companyId: string;
  userId: string;
  chatKeyHash: string;
  targetIntent: string;
  semanticOutcome: string | null;
  acceptedHintsJson: unknown;
  missingFields: string[];
  conflictingFields: string[];
  provenanceJson: unknown;
  sourceEventHash: string;
  version: number;
  expiresAt: Date;
  status: 'OPEN' | 'RESOLVED' | 'SUPERSEDED' | 'EXPIRED';
};

export type LineIntakeStateOpenInput = LineIntakeStateOwner & {
  targetIntent: string;
  semanticOutcome?: string | null;
  acceptedHints?: unknown;
  missingFields: string[];
  conflictingFields?: string[];
  provenance?: unknown;
  sourceEventHash: string;
  ttlMinutes: number;
};

/**
 * Why a state was NOT usable. Every member means the same thing to a caller — do not write — but
 * they are kept distinct because they are different operational stories and the four §8.3
 * zero-write cases are asserted against them by name.
 */
export type LineIntakeStateRefusal =
  /** The store errored (down, timeout, constraint we did not model). Fail CLOSED. */
  | 'unavailable'
  /** No OPEN row for this owner — including "the row exists but belongs to someone else". */
  | 'not_found'
  /** An OPEN row exists but its TTL has passed. Refused, never merged. */
  | 'expired'
  /** CAS lost: the row was already consumed, superseded, expired, or the version moved. */
  | 'stale';

export type LineIntakeStateResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: LineIntakeStateRefusal };

const refuse = (reason: LineIntakeStateRefusal): { ok: false; reason: LineIntakeStateRefusal } => ({ ok: false, reason });

/** Postgres unique-violation — here, the partial unique index on one OPEN row per owner. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

@Injectable()
export class LineIntakeStateRepository {
  private readonly logger = new Logger(LineIntakeStateRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  private get table() {
    return (this.prisma.client as unknown as { lineIntakeState: any }).lineIntakeState;
  }

  /** One log shape for every refusal, with NO financial values and no raw conversation. */
  private refused(operation: string, owner: LineIntakeStateOwner, reason: LineIntakeStateRefusal, error?: unknown) {
    this.logger.warn(JSON.stringify({
      event: 'line_ai_intake_state_refused',
      operation,
      reason,
      companyId: owner.companyId,
      // chatKeyHash is already a hash; userId is an internal id, never the LINE id.
      chatKeyHash: owner.chatKeyHash,
      ...(error ? { errorName: (error as Error)?.name ?? 'Error' } : {}),
    }));
    return refuse(reason);
  }

  /**
   * Open a clarification, superseding whatever this owner had open. Both statements run in ONE
   * transaction so there is no window in which the owner has two open rows or none: the partial
   * unique index would reject the second row anyway, and doing it in two round trips would let a
   * crash between them lose the question entirely.
   *
   * Supersede-then-create (rather than update-in-place) keeps the previous question as history with
   * its own version, so an answer that arrives late for the OLD question still fails CAS instead of
   * landing on the new one.
   */
  async openState(input: LineIntakeStateOpenInput): Promise<LineIntakeStateResult<LineIntakeStateRow>> {
    const owner = { companyId: input.companyId, userId: input.userId, chatKeyHash: input.chatKeyHash };
    try {
      return {
        ok: true,
        value: await this.prisma.client.$transaction(async (tx: any) => {
          await tx.lineIntakeState.updateMany({
            where: { ...owner, status: 'OPEN' },
            data: { status: 'SUPERSEDED' },
          });
          return tx.lineIntakeState.create({
            data: {
              ...owner,
              targetIntent: input.targetIntent,
              semanticOutcome: input.semanticOutcome ?? null,
              acceptedHintsJson: (input.acceptedHints ?? null) as Prisma.InputJsonValue,
              missingFields: input.missingFields,
              conflictingFields: input.conflictingFields ?? [],
              provenanceJson: (input.provenance ?? null) as Prisma.InputJsonValue,
              sourceEventHash: input.sourceEventHash,
              expiresAt: new Date(Date.now() + input.ttlMinutes * 60_000),
            },
          });
        }),
      };
    } catch (error) {
      // A unique violation means a CONCURRENT open won the race for this owner. That is not an
      // outage, but it is still not our row: the caller must not act as if it opened the state.
      return this.refused('open', owner, isUniqueViolation(error) ? 'stale' : 'unavailable', error);
    }
  }

  /**
   * The owner's open, unexpired state. Expiry is judged here rather than by the caller so every
   * call site gets the same answer: an expired row is a REFUSAL (`expired`), never a row the caller
   * might merge "just this once".
   */
  async readOpenState(owner: LineIntakeStateOwner): Promise<LineIntakeStateResult<LineIntakeStateRow>> {
    let row: LineIntakeStateRow | null;
    try {
      row = await this.table.findFirst({
        where: { ...owner, status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      return this.refused('read', owner, 'unavailable', error);
    }
    if (!row) return this.refused('read', owner, 'not_found');
    if (row.expiresAt.getTime() <= Date.now()) return this.refused('read', owner, 'expired');
    return { ok: true, value: row };
  }

  /**
   * CAS consume: OPEN + this exact version + not yet expired -> RESOLVED, in ONE conditional
   * UPDATE. §8.3 rule 5 wants the consume and the source write to be atomic together or replay-safe
   * by a unique key; this is the replay-safe half, and it is deliberately called BEFORE the source
   * write so a lost race can still produce zero writes. Two concurrent turns both holding version N
   * therefore cannot both proceed: the first moves the row to version N+1 and the second matches
   * zero rows and gets `stale`.
   *
   * The owner triple is in the WHERE clause, so quoting a valid state id from another chat, company
   * or member updates nothing and refuses.
   */
  async resolveState(
    owner: LineIntakeStateOwner,
    expected: { id: string; version: number },
  ): Promise<LineIntakeStateResult<{ id: string; version: number }>> {
    let updated: { count: number };
    try {
      updated = await this.table.updateMany({
        where: {
          ...owner,
          id: expected.id,
          version: expected.version,
          status: 'OPEN',
          expiresAt: { gt: new Date() },
        },
        data: { status: 'RESOLVED', version: expected.version + 1 },
      });
    } catch (error) {
      return this.refused('resolve', owner, 'unavailable', error);
    }
    // Zero rows collapses every losing case — wrong owner, wrong version, already consumed,
    // expired — into one refusal, which is exactly what the caller does with all of them.
    if (updated.count === 0) return this.refused('resolve', owner, 'stale');
    return { ok: true, value: { id: expected.id, version: expected.version + 1 } };
  }

  /**
   * Close the owner's open state without consuming it — an explicit abandon (the user asked
   * something else, or the turn refused). Separate from `resolveState` so the audit trail can tell
   * "answered" from "dropped", and so it can never be mistaken for a consume.
   */
  async supersedeOpenState(owner: LineIntakeStateOwner): Promise<LineIntakeStateResult<number>> {
    return this.transition(owner, { ...owner, status: 'OPEN' }, 'SUPERSEDED', 'supersede');
  }

  /** Sweep this owner's timed-out rows into EXPIRED so the history reads honestly. */
  async expireOpenState(owner: LineIntakeStateOwner): Promise<LineIntakeStateResult<number>> {
    return this.transition(owner, { ...owner, status: 'OPEN', expiresAt: { lte: new Date() } }, 'EXPIRED', 'expire');
  }

  private async transition(
    owner: LineIntakeStateOwner,
    where: Record<string, unknown>,
    status: 'SUPERSEDED' | 'EXPIRED',
    operation: string,
  ): Promise<LineIntakeStateResult<number>> {
    try {
      const { count } = await this.table.updateMany({ where, data: { status } });
      return { ok: true, value: count };
    } catch (error) {
      return this.refused(operation, owner, 'unavailable', error);
    }
  }
}
