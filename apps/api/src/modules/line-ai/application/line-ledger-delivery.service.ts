import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { LINE_AI_CONTEXT_WINDOW_MINUTES, type AiBudgetScope } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma, type LineDeliveryPlan, type LineLedgerDelivery } from '../../../generated/prisma/client';
import type { LedgerEntry } from './line-ai-ledger.service';
import { parseAcceptedLedgerRequest } from './line-ledger-accepted-request';
import { parseOutcomeMessages, type LineDeliveryResultV2, type LineReplyMessage } from '../infrastructure/line-reply.adapter';

import { deliveryHash, initialDeliveryBatchStates, LINE_DELIVERY_PLAN_SENTINEL, parseDeliveryBatchStates, parseLineDeliveryPlan, validateLineDeliveryPlan, type DeliveryPlanV2, type DeliveryBatchState } from '../domain/logic/line-delivery-plan.logic';

export type LineDeliveryOwnerFence = { kind: 'WEBHOOK'; id: string } | { kind: 'LEDGER' | 'CAPTURE_OUTBOX'; id: string; token: string };
export type LinePlanClaim = { row: LineDeliveryPlan; plan: DeliveryPlanV2; states: DeliveryBatchState[]; token: string; fence: LineDeliveryOwnerFence };
const PLAN_TERMINAL = new Set(['ACCEPTED', 'CANCELLED', 'REFUSED', 'EXPIRED']);

const LEASE_MS = 3 * 60_000;
const TERMINAL = new Set(['ACCEPTED', 'REFUSED', 'PARKED']);
export type LineLedgerCompletion = { status: string; refused: boolean; errorCode: string | null; replyPreview: string; toolCount: number; outcome?: 'followed_up' | 'refused'; reason?: string; budgetScope?: AiBudgetScope; deliveryPlanVersion?: 2; deliveryPlanId?: string;
  /** Set once by `consumeReaskPass`: the re-ask this notice allowed past the AI credit cap was used. */
  reaskPassUsedAt?: string };
/** Owner 2026-09-30: how long after an "original answer unavailable" notice the person's re-ask may pass the cap. */
export const LINE_AI_REASK_PASS_MS = 30 * 60_000;
export type LineLedgerClaim = { kind: 'prepare' | 'deliver' | 'terminal' | 'busy'; row: LineLedgerDelivery; token: string };

export const lineLedgerDeliveryId = (entry: Pick<LedgerEntry, 'key' | 'id' | 'durableDeliveryId' | 'reliabilityVersion'>) =>
  entry.reliabilityVersion === 2 && entry.durableDeliveryId && /^[0-9a-f]{64}$/.test(entry.durableDeliveryId)
    ? entry.durableDeliveryId : createHash('sha256').update(JSON.stringify([entry.key, entry.id])).digest('hex');

@Injectable()
export class LineLedgerDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(entry: LedgerEntry, now = new Date()): Promise<LineLedgerClaim> {
    const id = lineLedgerDeliveryId(entry), token = randomUUID();
    const createdAt = Date.parse(entry.createdAt);
    if (!Number.isFinite(createdAt) || createdAt > now.getTime() + 30_000) throw new Error('LINE_LEDGER_INVALID_CREATED_AT');
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-ledger-delivery:${id}`}))`;
      let row = await tx.lineLedgerDelivery.findUnique({ where: { id } });
      if (entry.reliabilityVersion === 2 && entry.kind === 'turn') {
        const accepted = row && parseAcceptedLedgerRequest(row.acceptedRequestJson, { ...entry, messagingChannelId: entry.messagingChannelId ?? '' });
        if (!accepted || accepted.deliveryId !== id) throw new Error('LINE_LEDGER_ACCEPTED_REQUEST_MISSING_OR_CHANGED');
      }
      if (!row) row = await tx.lineLedgerDelivery.create({ data: {
        id, companyId: entry.companyId, userId: entry.userId, webhookEventId: entry.webhookEventId, entryId: entry.id, entryKind: entry.kind,
        expiresAt: new Date(createdAt + LINE_AI_CONTEXT_WINDOW_MINUTES * 60_000),
      } });
      if (row.companyId !== entry.companyId || row.userId !== entry.userId || row.webhookEventId !== entry.webhookEventId || row.entryKind !== entry.kind) throw new Error('LINE_LEDGER_DELIVERY_SCOPE_MISMATCH');
      if (TERMINAL.has(row.status)) return { kind: 'terminal', row, token };
      if (row.expiresAt <= now) {
        row = await tx.lineLedgerDelivery.update({ where: { id }, data: { status: 'PARKED', errorCode: 'LINE_LEDGER_CONTEXT_EXPIRED', leaseToken: null, leaseExpiresAt: null } });
        return { kind: 'terminal', row, token };
      }
      if (row.leaseExpiresAt && row.leaseExpiresAt > now) return { kind: 'busy', row, token };
      row = await tx.lineLedgerDelivery.update({ where: { id }, data: { leaseToken: token, leaseExpiresAt: new Date(Math.min(now.getTime() + LEASE_MS, row.expiresAt.getTime())) } });
      return { kind: row.status === 'PREPARING' ? 'prepare' : 'deliver', row, token };
    });
  }

  async save(claim: LineLedgerClaim, messages: LineReplyMessage[], authorization: Record<string, unknown>, completion: LineLedgerCompletion, now = new Date()): Promise<boolean> {
    if (!parseOutcomeMessages(messages) || Buffer.byteLength(JSON.stringify(messages), 'utf8') > 256 * 1024
      || completion.replyPreview.length > 240 || completion.status.length > 80 || completion.toolCount < 0 || completion.toolCount > 64) throw new Error('LINE_LEDGER_OUTCOME_INVALID');
    const saved = await this.prisma.client.lineLedgerDelivery.updateMany({
      where: { id: claim.row.id, leaseToken: claim.token, status: 'PREPARING', leaseExpiresAt: { gt: now }, expiresAt: { gt: now } },
      data: { status: 'READY', messagesJson: messages as unknown as Prisma.InputJsonValue,
        authorizationJson: authorization as Prisma.InputJsonValue, completionJson: completion as unknown as Prisma.InputJsonValue },
    });
    return saved.count === 1;
  }

  /** Stamp uncertainty before dispatch. A lost response can only retry this already saved payload. */
  async beginSend(claim: LineLedgerClaim, now = new Date()): Promise<boolean> {
    return this.prisma.client.$transaction(async tx => {
      const updated = await tx.lineLedgerDelivery.updateMany({
        where: { id: claim.row.id, leaseToken: claim.token, status: { in: ['READY', 'UNKNOWN'] }, leaseExpiresAt: { gt: now }, expiresAt: { gt: now } },
        data: { status: 'UNKNOWN', attempts: { increment: 1 }, errorCode: null },
      });
      if (updated.count !== 1) return false;
      if (claim.row.entryKind === 'turn' && claim.row.webhookEventId) {
        const owner = await tx.lineWebhookEventLog.updateMany({
          where: { webhookEventId: claim.row.webhookEventId, companyId: claim.row.companyId,
            OR: [{ deliveryOwnerId: `ledger:${claim.row.id}` }, { deliveryOwnerId: null, turnOutcome: { is: null } }] },
          data: { deliveryOwnerId: `ledger:${claim.row.id}` },
        });
        if (owner.count !== 1) {
          await tx.lineLedgerDelivery.update({ where: { id: claim.row.id }, data: { status: 'PARKED', errorCode: 'LINE_ORIGINAL_OUTCOME_OWNS_DELIVERY', leaseToken: null, leaseExpiresAt: null } });
          return false;
        }
      }
      return true;
    });
  }

  async finish(claim: LineLedgerClaim, status: 'ACCEPTED' | 'UNKNOWN' | 'REFUSED' | 'PARKED', errorCode: string | null = null): Promise<boolean> {
    const updated = await this.prisma.client.lineLedgerDelivery.updateMany({
      where: { id: claim.row.id, leaseToken: claim.token, status: status === 'ACCEPTED' ? 'UNKNOWN' : { in: ['PREPARING', 'READY', 'UNKNOWN'] } },
      data: { status, errorCode, ...(status === 'ACCEPTED' ? { acceptedAt: new Date() } : {}), leaseToken: null, leaseExpiresAt: null },
    });
    return updated.count === 1;
  }

  /**
   * Owner 2026-09-30 ("ทุกกรณีที่ระบบรับไว้ก่อน"): after this ledger told a person that their previous answer
   * did not complete (the v2 "original answer unavailable" notice), their next AI turn in the SAME private
   * chat within `LINE_AI_REASK_PASS_MS` may pass the AI credit cap once. The pass is that notice's own row,
   * matched on its frozen conversation id (company, person, membership, channel and chat) and spent by one
   * CAS, so it never serves a second turn, another chat or another person. Nothing else is authorized by it.
   */
  async consumeReaskPass(owner: { companyId: string; userId: string; conversationId: string }, now = new Date()): Promise<boolean> {
    const rows = await this.prisma.client.lineLedgerDelivery.findMany({
      where: { companyId: owner.companyId, userId: owner.userId, status: 'ACCEPTED', acceptedAt: { gt: new Date(now.getTime() - LINE_AI_REASK_PASS_MS) },
        authorizationJson: { path: ['staticRefusal'], equals: 'original_answer_unavailable' } },
      orderBy: { acceptedAt: 'desc' }, take: 5,
      select: { id: true, updatedAt: true, acceptedRequestJson: true, completionJson: true },
    });
    const pass = rows.find((row) => (row.acceptedRequestJson as { conversationId?: unknown } | null)?.conversationId === owner.conversationId
      && !(row.completionJson as LineLedgerCompletion | null)?.reaskPassUsedAt);
    if (!pass) return false;
    const spent = await this.prisma.client.lineLedgerDelivery.updateMany({
      where: { id: pass.id, updatedAt: pass.updatedAt },
      data: { completionJson: { ...(pass.completionJson as Record<string, unknown>), reaskPassUsedAt: now.toISOString() } as Prisma.InputJsonValue },
    });
    return spent.count === 1;
  }

  /** Producer fence is acquired before the child lock; network/authorization never runs here. */
  private async planOwnerCurrent(tx: Prisma.TransactionClient, fence: LineDeliveryOwnerFence, plan: DeliveryPlanV2, now: Date): Promise<boolean> {
    if (fence.kind !== plan.producerKind || fence.id !== plan.producerId) return false;
    const companyId = plan.authorization.kind === 'PRIVATE' ? plan.authorization.actor.companyId : null;
    const userId = plan.authorization.kind === 'PRIVATE' ? plan.authorization.actor.userId : null;
    if (fence.kind === 'LEDGER') {
      await tx.$queryRaw`SELECT id FROM "LineLedgerDelivery" WHERE id = ${fence.id} FOR UPDATE`;
      const owner = await tx.lineLedgerDelivery.findFirst({ where: { id: fence.id, leaseToken: fence.token, leaseExpiresAt: { gt: now }, expiresAt: { gt: now } } });
      return !!owner && (!companyId || (owner.companyId === companyId && owner.userId === userId));
    }
    if (fence.kind === 'CAPTURE_OUTBOX') {
      await tx.$queryRaw`SELECT id FROM "OutboxEvent" WHERE id = ${fence.id} FOR UPDATE`;
      const owner = await tx.outboxEvent.findFirst({ where: { id: fence.id, claimToken: fence.token, status: 'PROCESSING' } });
      return !!owner && companyId === owner.companyId;
    }
    await tx.$queryRaw`SELECT e.id FROM "LineWebhookEventLog" e JOIN "LineTurnOutcome" o ON o."webhookEventId" = e."webhookEventId" WHERE o.id = ${fence.id} FOR UPDATE OF e`;
    const owner = await tx.lineTurnOutcome.findUnique({ where: { id: fence.id }, include: { event: true } });
    return !!owner && owner.event.deliveryOwnerId === 'webhook' && (!companyId || owner.companyId === companyId);
  }

  async savePlan(fence: LineDeliveryOwnerFence, plan: DeliveryPlanV2, purgeAt: Date, now = new Date(), newWebhookEventId?: string,
    // Spec §4 R-M2, and the pre-existing deliveredExpenseSummary/expense-criterion-confirmation
    // proofs: the SAME LineTurnOutcome.authorizationJson shape the legacy recordTurnOutcome upsert
    // persists. Graduating to a delivery plan replaces messagesJson with a sentinel (the real
    // payload moves into planJson) — it must not ALSO silently drop this proof to JSON null, or a
    // future turn's loadConversationContext can never read expenseSummary/readMemory back for any
    // turn whose reply used the v2 path. Optional: an owner fence with nothing to prove (e.g. a
    // public/casual turn) omits it and keeps today's JSON-null behavior.
    authorizationJson?: Prisma.InputJsonValue,
  ): Promise<LineDeliveryPlan | null> {
    validateLineDeliveryPlan(plan);
    if (purgeAt < new Date(plan.createdAt)) throw new Error('LINE_PLAN_INVALID_RETENTION');
    return this.prisma.client.$transaction(async tx => {
      if (newWebhookEventId) {
        if (fence.kind !== 'WEBHOOK') throw new Error('LINE_PLAN_INVALID_OWNER');
        const owner = await tx.lineWebhookEventLog.updateMany({ where: { webhookEventId: newWebhookEventId, OR: [{ deliveryOwnerId: null }, { deliveryOwnerId: 'webhook' }] }, data: { deliveryOwnerId: 'webhook' } });
        if (owner.count !== 1) return null;
        const existing = await tx.lineTurnOutcome.findUnique({ where: { webhookEventId: newWebhookEventId } });
        if (existing && existing.id !== fence.id) return null;
        if (!existing) await tx.lineTurnOutcome.create({ data: { id: fence.id, webhookEventId: newWebhookEventId, companyId: plan.authorization.kind === 'PRIVATE' ? plan.authorization.actor.companyId : null, messagesJson: LINE_DELIVERY_PLAN_SENTINEL, presentationKind: 'delivery_plan_v2', authorizationJson: authorizationJson ?? Prisma.JsonNull } });
      }
      if (!await this.planOwnerCurrent(tx, fence, plan, now)) return null;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-delivery-plan:${plan.planId}`}))`;
      const existing = await tx.lineDeliveryPlan.findUnique({ where: { id: plan.planId } });
      if (existing) {
        if (existing.planHash !== deliveryHash(existing.planJson) || !parseLineDeliveryPlan(existing.planJson)) throw new Error('LINE_PLAN_CORRUPT');
        return existing; // First owner result wins. No re-render after a race or lost checkpoint.
      }
      const ownership = fence.kind === 'WEBHOOK' ? { outcomeId: fence.id } : fence.kind === 'LEDGER' ? { ledgerDeliveryId: fence.id } : { outboxEventId: fence.id };
      const row = await tx.lineDeliveryPlan.create({ data: { id: plan.planId, ...ownership,
        companyId: plan.authorization.kind === 'PRIVATE' ? plan.authorization.actor.companyId : null,
        userId: plan.authorization.kind === 'PRIVATE' ? plan.authorization.actor.userId : plan.authorization.actorUserId,
        planJson: plan as unknown as Prisma.InputJsonValue, planHash: deliveryHash(plan), batchStateJson: initialDeliveryBatchStates(plan) as unknown as Prisma.InputJsonValue,
        createdAt: new Date(plan.createdAt), nextAttemptAt: now, expiresAt: new Date(plan.expiresAt), purgeAt } });
      if (fence.kind === 'WEBHOOK') await tx.lineTurnOutcome.update({ where: { id: fence.id }, data: { messagesJson: LINE_DELIVERY_PLAN_SENTINEL, presentationKind: 'delivery_plan_v2', authorizationJson: authorizationJson ?? Prisma.JsonNull } });
      if (fence.kind === 'LEDGER') {
        const parent = await tx.lineLedgerDelivery.findUniqueOrThrow({ where: { id: fence.id } });
        await tx.lineLedgerDelivery.update({ where: { id: fence.id }, data: { status: 'READY', messagesJson: LINE_DELIVERY_PLAN_SENTINEL, authorizationJson: authorizationJson ?? Prisma.JsonNull,
          completionJson: { ...(parent.completionJson as Record<string, Prisma.InputJsonValue> ?? {}), deliveryPlanVersion: 2, deliveryPlanId: plan.planId } } });
      }
      if (fence.kind === 'CAPTURE_OUTBOX') {
        const parent = await tx.outboxEvent.findUniqueOrThrow({ where: { id: fence.id } });
        await tx.outboxEvent.update({ where: { id: fence.id }, data: { headersJson: { ...(parent.headersJson as Record<string, Prisma.InputJsonValue> ?? {}), lineDeliveryPlanVersion: 2, lineDeliveryPlanId: plan.planId } } });
      }
      return row;
    });
  }

  async claimPlan(id: string, fence: LineDeliveryOwnerFence, now = new Date()): Promise<LinePlanClaim | null> {
    return this.prisma.client.$transaction(async tx => {
      const initial = await tx.lineDeliveryPlan.findUnique({ where: { id } });
      if (!initial) throw new Error('LINE_OUTCOME_RECOVERY_REQUIRED');
      const plan = parseLineDeliveryPlan(initial.planJson);
      if (!plan || initial.planHash !== deliveryHash(plan)) throw new Error('LINE_PLAN_CORRUPT');
      if (!await this.planOwnerCurrent(tx, fence, plan, now)) return null;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-delivery-plan:${id}`}))`;
      const row = await tx.lineDeliveryPlan.findUniqueOrThrow({ where: { id } });
      const states = parseDeliveryBatchStates(row.batchStateJson, plan);
      if (!states) throw new Error('LINE_PLAN_CHECKPOINT_CORRUPT');
      if (PLAN_TERMINAL.has(row.status) || row.status === 'WAITING_CONTINUATION' || row.nextAttemptAt > now || (row.leaseExpiresAt && row.leaseExpiresAt > now)) return null;
      if (row.expiresAt <= now) { await tx.lineDeliveryPlan.update({ where: { id }, data: { status: 'EXPIRED', leaseToken: null, leaseExpiresAt: null } }); return null; }
      const token = randomUUID();
      const claimed = await tx.lineDeliveryPlan.update({ where: { id }, data: { leaseToken: token, leaseExpiresAt: new Date(Math.min(now.getTime() + LEASE_MS, row.expiresAt.getTime())) } });
      return { row: claimed, plan, states, token, fence };
    });
  }

  async beginPlanBatch(claim: LinePlanClaim, transport: 'REPLY' | 'PUSH', now = new Date()): Promise<{ index: number; timeoutMs: number } | null> {
    return this.prisma.client.$transaction(async tx => {
      if (!await this.planOwnerCurrent(tx, claim.fence, claim.plan, now)) return null;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-delivery-plan:${claim.row.id}`}))`;
      const row = await tx.lineDeliveryPlan.findFirst({ where: { id: claim.row.id, leaseToken: claim.token, leaseExpiresAt: { gt: now }, expiresAt: { gt: now }, status: { in: ['READY', 'UNKNOWN'] } } });
      if (!row) return null;
      const states = parseDeliveryBatchStates(row.batchStateJson, claim.plan);
      if (!states) throw new Error('LINE_PLAN_CHECKPOINT_CORRUPT');
      const index = states.findIndex(s => s.status !== 'ACCEPTED'), state = states[index];
      if (!state || state.status === 'REFUSED' || state.status === 'CANCELLED') return null;
      // UAT 2026-10-19 (silent reply): a rare duplicate if the reply actually landed beats silence;
      // the frozen push retry key dedupes every recovery of this uncertain batch.
      if (transport === 'REPLY' && (state.replyAttempted || index !== 0)) return null;
      if (transport === 'PUSH' && state.pushAttempts >= 5) {
        await tx.lineDeliveryPlan.update({ where: { id: row.id }, data: { status: 'REFUSED', cancelReason: 'ATTEMPTS_EXHAUSTED', leaseToken: null, leaseExpiresAt: null } }); return null;
      }
      const firstDispatch = !states.some(s => s.firstAttemptAt);
      const remaining = Math.min(row.expiresAt.getTime(), row.leaseExpiresAt!.getTime(), firstDispatch ? Date.parse(claim.plan.firstDispatchDeadlineAt) : Infinity) - now.getTime();
      if (remaining < 500) return null;
      const timeoutMs = Math.min(transport === 'REPLY' ? 8_000 : 5_000, remaining);
      states[index] = { ...state, status: 'UNKNOWN', transport, replyAttempted: state.replyAttempted || transport === 'REPLY', pushAttempts: state.pushAttempts + Number(transport === 'PUSH'), firstAttemptAt: state.firstAttemptAt ?? now.toISOString(), lastAttemptAt: now.toISOString(), lastErrorCode: null };
      await tx.lineDeliveryPlan.update({ where: { id: row.id }, data: { status: 'UNKNOWN', batchStateJson: states as unknown as Prisma.InputJsonValue } });
      claim.states = states;
      return { index, timeoutMs };
    });
  }

  async finishPlanBatch(claim: LinePlanClaim, index: number, result: LineDeliveryResultV2, now = new Date()): Promise<boolean> {
    return this.prisma.client.$transaction(async tx => {
      if (!await this.planOwnerCurrent(tx, claim.fence, claim.plan, now)) return false;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-delivery-plan:${claim.row.id}`}))`;
      const row = await tx.lineDeliveryPlan.findFirst({ where: { id: claim.row.id, leaseToken: claim.token, leaseExpiresAt: { gt: now } } });
      if (!row) return false;
      const states = parseDeliveryBatchStates(row.batchStateJson, claim.plan), state = states?.[index];
      if (!states || !state || state.status !== 'UNKNOWN') return false;
      const terminal = PLAN_TERMINAL.has(row.status);
      let status = row.status, reason: string | null = result.code;
      if (result.kind === 'accepted') {
        states[index] = { ...state, status: 'ACCEPTED', acceptedAt: now.toISOString(), providerRequestId: result.requestId ?? null, ...(result.sentMessageIds?.length ? { sentMessageIds: result.sentMessageIds } : {}), lastErrorCode: null };
        if (!terminal) status = states.every(s => s.status === 'ACCEPTED') ? 'ACCEPTED' : index === 1 && states.length === 3 ? 'WAITING_CONTINUATION' : 'READY';
        reason = null;
      } else if (result.kind === 'rejected') {
        if (result.rejection === 'TOKEN' && state.transport === 'REPLY') { states[index] = { ...state, status: 'READY', transport: null, lastErrorCode: result.code }; if (!terminal) status = 'READY'; }
        else if (result.rejection === 'FLEX' && claim.plan.batches[index]?.fallback && state.variant === 'primary' && state.pushAttempts <= 1) { states[index] = { ...state, status: 'READY', transport: null, variant: 'fallback', pushAttempts: 0, lastErrorCode: result.code }; if (!terminal) status = 'READY'; }
        else if (result.code === 'RATE_LIMITED') { states[index] = { ...state, status: 'READY', lastErrorCode: result.code }; if (!terminal) status = 'READY'; }
        else { states[index] = { ...state, status: 'REFUSED', lastErrorCode: result.code }; if (!terminal) status = 'REFUSED'; }
      } else { states[index] = { ...state, lastErrorCode: state.transport === 'REPLY' ? 'REPLY_ACCEPTANCE_UNKNOWN' : result.code }; }
      // A rejected reply token is not a transport fault to back off from: its push goes out now (E4).
      const tokenFallback = state.transport === 'REPLY' && (result.kind === 'unknown' || result.kind === 'rejected' && result.rejection === 'TOKEN');
      const delay = result.kind === 'accepted' || tokenFallback ? 0 : Math.min(30_000, 2_000 * 2 ** Math.max(0, state.pushAttempts - 1));
      await tx.lineDeliveryPlan.update({ where: { id: row.id }, data: { status, batchStateJson: states as unknown as Prisma.InputJsonValue,
        ...(status === 'ACCEPTED' ? { acceptedAt: now } : {}), cancelReason: reason, nextAttemptAt: new Date(now.getTime() + delay), leaseToken: null, leaseExpiresAt: null } });
      claim.states = states;
      return true;
    });
  }

  /** Caller has verified current actor/source; the immutable digest binds that decision to this row. */
  async continuePlan(id: string, expectedHash: string, nextIndex: number, now = new Date()): Promise<boolean> {
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-delivery-plan:${id}`}))`;
      const row = await tx.lineDeliveryPlan.findFirst({ where: { id, planHash: expectedHash, status: 'WAITING_CONTINUATION', expiresAt: { gt: now } } });
      if (!row || nextIndex !== 2) return false;
      const plan = parseLineDeliveryPlan(row.planJson), states = plan && parseDeliveryBatchStates(row.batchStateJson, plan);
      if (!plan || !states || states.findIndex(s => s.status !== 'ACCEPTED') !== nextIndex) return false;
      await tx.lineDeliveryPlan.update({ where: { id }, data: { status: 'READY', nextAttemptAt: now } });
      if (row.outboxEventId) await tx.outboxEvent.updateMany({ where: { id: row.outboxEventId, status: { in: ['PENDING', 'FAILED'] } }, data: { availableAt: now } });
      return true;
    });
  }

  async cancelPlan(id: string, expectedHash: string, now = new Date()): Promise<boolean> {
    return (await this.prisma.client.lineDeliveryPlan.updateMany({ where: { id, planHash: expectedHash, status: { in: ['READY', 'UNKNOWN', 'WAITING_CONTINUATION'] } }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: 'USER_CANCELLED' } })).count === 1;
  }

  async sweepPlans(now = new Date()): Promise<void> {
    await this.prisma.client.lineDeliveryPlan.updateMany({ where: { expiresAt: { lte: now }, status: { in: ['READY', 'UNKNOWN', 'WAITING_CONTINUATION'] } }, data: { status: 'EXPIRED', leaseToken: null, leaseExpiresAt: null } });
    const expired = await this.prisma.client.lineDeliveryPlan.findMany({ where: { purgeAt: { lte: now } }, take: 500, select: { id: true } });
    if (expired.length) await this.prisma.client.lineDeliveryPlan.deleteMany({ where: { id: { in: expired.map(r => r.id) } } });
  }

}
