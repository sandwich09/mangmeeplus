/**
 * Drains the LINE AI turn ledger (item 10F): XAUTOCLAIMs open entries past the min-idle
 * window, re-resolves identity/permissions AT EXECUTION TIME (a stored entry is never
 * permission truth), re-runs the entry as a scoped read-only follow-up turn, pushes the
 * answer into the source chat, and acks. waiting_user entries only expire here (the user
 * answers them on the live turn path); a delivery count past the cap parks the entry to
 * audit instead of looping (poison protection).
 *
 * A saved response survives reclaim with the same payload/key. UNKNOWN never re-runs the model;
 * accepted output only reconciles bookkeeping. Source/actor proof is checked before each send.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LineReadEvidenceService } from '../line-read-evidence.service';
import { LineLedgerDeliveryService, lineLedgerDeliveryId, type LineLedgerClaim, type LineLedgerCompletion } from '../line-ledger-delivery.service';
import { randomUUID } from 'node:crypto';
import type { LineAiTurnRequest, LineUserContext } from '@watchdog-bms/contracts';
import { AI_BUDGET_REFUSAL_CODES, LINE_AI_CONTEXT_WINDOW_MINUTES, LINE_AI_ERROR_CODES, isAiBudgetPermanentRefusal, isAiBudgetRefusalCode, type AiBudgetRefusalCode } from '@watchdog-bms/contracts';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { AiGatewayClient } from '../../infrastructure/ai-gateway.client';
import { LineReplyAdapter, parseOutcomeMessages, type LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { buildLineBusinessAnswerMessage } from '../../domain/logic/line-business-card.logic';
import { LineAiLedgerService, type LedgerEntry } from '../line-ai-ledger.service';
import { formatLineReply, lineAssistantDisabledFor } from './process-line-webhook.use-case';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { formatAiBudgetRefusalNotice, formatRefusal } from '../../domain/logic/line-ai-formatter.logic';
import { resolveCompanyAiModelPolicy } from '../company-ai-model-policy';
import { emitLineAiTerminalOutcome, knownAiBudgetRefusal, terminalStatusForLineTurn } from '../../domain/logic/line-ai-terminal-outcome.logic';
import { LineHandoffLinkService } from '../line-handoff-link.service';
import { lineDeliveryAccessFingerprint, lineDeliveryRecipientHash } from '../line-delivery-access';

export type DrainLineLedgerResult = {
  skipped?: boolean;
  claimed: number;
  followedUp: number;
  expired: number;
  parked: number;
  refused: number;
};

const MAX_BATCH_SIZE = 50;

/**
 * F0 async inventory §5d: re-resolving permissions is NOT enough on its own here — the drain requires
 * `line.ai.query`, which lives in the ungated `pack.core.basics` (`feature-gate.logic.ts:35-36`), so
 * `ai_line_assistant = false` never strips it. Since the owner decision of 2026-08-04 the family can
 * really be switched off post-onboarding, so the entitlement is re-read AT EXECUTION TIME below with
 * the same predicate the synchronous webhook refuses on, and an in-flight turn is acked `refused`
 * instead of being answered and pushed after the cutoff.
 */
const LEDGER_FEATURE_KEY = 'ai_line_assistant';

/**
 * Not a failure: a `waiting_user` entry inside the clarify window is the DESIGNED hold — the live
 * turn path owns that answer, so the entry is deliberately left unacked in the PEL until it either
 * gets answered or ages out. It unwinds `processEntry` as a throw only because "leave it alone" has
 * no ack and no outcome counter; the drain loop below recognises it and stays quiet.
 *
 * Before this type it was reported as `ai.line.ledger.follow_up_failed` at level 40, so every drain
 * of a chat with one open question looked like a delivery incident (UAT 2026-09-05, 11:47:00Z).
 */
class LedgerEntryHeldError extends Error {}

/** A refusal this drain can compose itself, with no model call and no read evidence. */
type StaticRefusalReason = 'feature_disabled' | 'forbidden' | AiBudgetRefusalCode;

const isStaticRefusalReason = (value: unknown): value is StaticRefusalReason =>
  value === 'feature_disabled' || value === 'forbidden' || isAiBudgetRefusalCode(typeof value === 'string' ? value : undefined);

/** The ONE place that says what a stored static refusal must contain, so the producer above and the
 *  pre-send integrity check below can never disagree about its exact text. */
const staticRefusalText = (reason: StaticRefusalReason): string =>
  reason === 'feature_disabled' || reason === 'forbidden' ? formatRefusal(reason) : formatAiBudgetRefusalNotice(reason);

@Injectable()
export class DrainLineLedgerUseCase {
  private readonly logger = new Logger(DrainLineLedgerUseCase.name);
  @Inject(LineReadEvidenceService) private readonly readEvidence!: LineReadEvidenceService;
  @Inject(LineLedgerDeliveryService) private readonly deliveryStore!: LineLedgerDeliveryService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly ledger: LineAiLedgerService,
    private readonly aiGateway: AiGatewayClient,
    private readonly lineReply: LineReplyAdapter,
    private readonly shadow: LaunchShadowProbe,
    // P12-3b: the drain has its own send seam, so it needs its own wrap. `@Optional()` and inert
    // with the flag off, exactly like the webhook's.
    @Optional() private readonly handoffLinks?: LineHandoffLinkService,
  ) {}

  async execute(batchSize = 20, now: Date = new Date()): Promise<DrainLineLedgerResult> {
    const result: DrainLineLedgerResult = { claimed: 0, followedUp: 0, expired: 0, parked: 0, refused: 0 };
    if (!this.ledger.enabled) return { ...result, skipped: true };

    const bounded = Math.max(1, Math.min(MAX_BATCH_SIZE, batchSize));
    const claimed = await this.ledger.claimOpenEntries(bounded, this.config.lineAiLedgerClaimMinIdleMs);
    if (claimed.length === 0) return result;

    // Per-chat serialization within the batch: follow-ups for one chat run in order.
    const byChat = new Map<string, typeof claimed>();
    for (const item of claimed) {
      const list = byChat.get(item.entry.key) ?? [];
      list.push(item);
      byChat.set(item.entry.key, list);
    }

    // SHADOW ONLY (plan §3 F1): recorded, never enforced — the drain stays exactly as blind as it
    // is today, only now it is measured.
    const sweep = this.shadow.startSweep(SHADOW_SURFACES.aiLedgerDrain);
    try {
      for (const items of byChat.values()) {
        for (const { entry, deliveryCount } of items) {
          result.claimed += 1;
          await sweep.record(entry.companyId, LEDGER_FEATURE_KEY);
          try {
            const outcome = await this.processEntry(entry, deliveryCount, now);
            result[outcome] += 1;
          } catch (err) {
            // Expected hold, not an incident: stays in the PEL, says so at debug, counts nothing.
            if (err instanceof LedgerEntryHeldError) {
              this.logger.debug({ msg: 'ai.line.ledger.entry_held', entryId: entry.id, reason: err.message });
              continue;
            }
            // Leave unacked — the next reclaim retries; the delivery cap parks poison entries.
            this.logger.warn({ msg: 'ai.line.ledger.follow_up_failed', entryId: entry.id, error: (err as Error).message });
          }
        }
      }
    } finally {
      // `finally`, not a trailing await (piece 3 / codex r15 fix 11). The per-entry catch above
      // covers follow-up failures only; a throw from `sweep.record` or the ledger itself escapes it.
      await sweep.flush();
    }
    return result;
  }

  private async processEntry(entry: LedgerEntry, deliveryCount: number, now: Date): Promise<'followedUp' | 'expired' | 'parked' | 'refused'> {
    // waiting_user: the user answers on the live path; here it can only expire (silently, audited).
    if (entry.kind === 'sub_request' && entry.state === 'waiting_user') {
      if (this.inContextWindow(entry, now)) {
        // Still within the clarify window — leave it in the PEL untouched (not a delivery).
        throw new LedgerEntryHeldError('waiting_user entry still inside the clarify window');
      }
      await this.ledger.ack(entry, 'clarify_expired');
      return 'expired';
    }

    // The live webhook's durable outcome has its own exact-payload recovery owner. Never create
    // a second notification/key for that same answer after a lost Redis acknowledgement.
    const original = entry.kind === 'turn' && entry.webhookEventId
      ? await this.prisma.client.lineTurnOutcome.findUnique({ where: { webhookEventId: entry.webhookEventId }, select: { deliveredAt: true } }) : null;
    if (original) {
      await this.ledger.ack(entry, original.deliveredAt ? 'followed_up' : 'parked', { reason: 'original_outcome_owns_delivery' });
      return original.deliveredAt ? 'followedUp' : 'parked';
    }

    const claim = await this.deliveryStore.claim(entry, now);
    if (claim.kind === 'busy') throw new LedgerEntryHeldError('another producer owns this queued delivery');
    if (claim.kind === 'terminal') {
      if (claim.row.status === 'ACCEPTED') return this.completeSavedDelivery(entry, claim, deliveryCount);
      const parked = claim.row.status === 'PARKED';
      await this.finalizeSourceEvent(entry, parked ? 'failed_terminal' : 'forbidden', claim.row.errorCode ?? 'LINE_LEDGER_DELIVERY_REFUSED');
      await this.ledger.ack(entry, parked ? 'parked' : 'refused', { reason: claim.row.errorCode });
      return parked ? 'parked' : 'refused';
    }
    if (deliveryCount > this.config.lineAiLedgerDeliveryCap) {
      if (!await this.deliveryStore.finish(claim, 'PARKED', 'LINE_LEDGER_DELIVERY_CAP_EXCEEDED')) throw new LedgerEntryHeldError('queued delivery lease changed');
      await this.finalizeSourceEvent(entry, 'failed_terminal', 'LINE_LEDGER_DELIVERY_CAP_EXCEEDED');
      await this.ledger.ack(entry, 'parked', { deliveryCount });
      return 'parked';
    }

    if (!await this.canReceiveFollowup(entry)) return this.refuseChangedDelivery(entry, claim);
    if (claim.kind === 'deliver') return this.sendSavedDelivery(entry, claim, deliveryCount);

    // Freeze in place (owner decision 2026-08-04): the family may have been switched off while this
    // entry sat in the ledger. Terminal ack, not a retry — a re-enable must not revive a turn from
    // before the cutoff.
    const entitledFeatureKeys = await loadEntitledFeatureKeys(this.prisma, entry.companyId);
    if (lineAssistantDisabledFor(entitledFeatureKeys)) {
      // The claim delay is min-idle (seconds), NOT the 15-minute context window — a queued `turn`
      // is usually still inside it, with a real user waiting on an answer. Dropping it silently
      // looks like the assistant hung, so send the SAME Thai refusal the synchronous webhook sends,
      // through this drain's own push seam. Out-of-window turns and sub_requests stay silent:
      // nobody is waiting on those.
      if (entry.kind === 'turn' && this.inContextWindow(entry, now)) {
        return this.sendStaticRefusal(entry, claim, deliveryCount, 'feature_disabled');
      } else if (entry.kind === 'turn') {
        await this.finalizeSourceEvent(entry, 'failed_terminal', 'LINE_LEDGER_CONTEXT_EXPIRED');
      }
      if (!await this.deliveryStore.finish(claim, 'REFUSED', 'LINE_LEDGER_FEATURE_DISABLED')) throw new LedgerEntryHeldError('queued delivery lease changed');
      await this.ledger.ack(entry, 'refused', { reason: 'feature_disabled' });
      return 'refused';
    }

    // Re-resolve identity + permissions at execution time — revoked access refuses safely.
    const userContext = await this.resolveUserContext(entry);
    if (!userContext) {
      if (entry.kind === 'turn' && this.inContextWindow(entry, now)) {
        return this.sendStaticRefusal(entry, claim, deliveryCount, 'forbidden');
      } else if (entry.kind === 'turn') {
        await this.finalizeSourceEvent(entry, 'failed_terminal', 'LINE_LEDGER_PERMISSION_REVOKED_AFTER_CONTEXT');
      }
      if (!await this.deliveryStore.finish(claim, 'REFUSED', 'LINE_LEDGER_PERMISSION_REVOKED')) throw new LedgerEntryHeldError('queued delivery lease changed');
      await this.ledger.ack(entry, 'refused', { reason: 'identity_or_permission_revoked' });
      return 'refused';
    }

    const modelPolicy = await resolveCompanyAiModelPolicy(this.prisma, entry.companyId, this.config.approvedAiModelIds);
    const originalAccess = lineDeliveryAccessFingerprint(userContext, entitledFeatureKeys);
    const turnRequest: LineAiTurnRequest = {
      requestId: randomUUID(),
      webhookEventId: entry.webhookEventId || entry.id,
      userContext,
      ...(modelPolicy && { modelPolicy }),
      messageText: entry.text,
      messagePreviewHash: entry.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'ledger',
      ...(entry.valueCandidates ? { valueCandidates: entry.valueCandidates } : {}),
      // Same entitlement set the live webhook sends, so a drained turn cannot describe the
      // assistant's capabilities differently from a turn answered in the moment.
      ...(entitledFeatureKeys && { entitledFeatureKeys: [...entitledFeatureKeys] }),
      // ...and the same trusted intake provenance, for the same reason (spec §5.3): a reclaimed
      // business turn that lost it gets the "out of scope" answer the live turn would not have given.
      ...(entry.intakeIntent ? { intakeIntent: entry.intakeIntent } : {}),
    };
    let response: Awaited<ReturnType<AiGatewayClient['requestLineTurn']>>;
    try {
      // ADR 0013 §4: a reclaim is the SAME attempt (the original webhook event) at the NEXT retry
      // ordinal — never a fresh random identity, even though `requestId` above is one. The ordinal
      // is the existing `deliveryCount`, already bounded by `lineAiLedgerDeliveryCap`.
      response = await this.aiGateway.requestLineTurn(turnRequest, { retryOrdinal: deliveryCount });
    } catch (err) {
      // §9.4 / F-08: a PERMANENT money refusal is an answer, not a transient fault. It used to land
      // in `execute`'s generic catch, stay unacked, be reclaimed until `lineAiLedgerDeliveryCap` and
      // finish as LINE_LEDGER_DELIVERY_CAP_EXCEEDED / failed_terminal — a refusal retried as if
      // waiting could help, with its reason rewritten on the way out. Finish it here through the
      // SAME delivery owner every other terminal refusal uses. Busy/unavailable deliberately fall
      // through to the existing hold+reclaim, bounded by that same cap, keeping their own reason.
      const budget = knownAiBudgetRefusal(err);
      if (!budget || !isAiBudgetPermanentRefusal(budget.code)) throw err;
      const status = budget.code === AI_BUDGET_REFUSAL_CODES.insufficient ? 'ai_budget_insufficient' : 'ai_budget_exceeded';
      // A `turn` still inside the reply window has a real person waiting: tell them once. A stale
      // turn or a `sub_request` gets no unsolicited push — nobody is waiting on those.
      if (entry.kind === 'turn' && this.inContextWindow(entry, now)) {
        return this.sendStaticRefusal(entry, claim, deliveryCount, budget.code);
      }
      if (entry.kind === 'turn') await this.finalizeSourceEvent(entry, status, budget.code);
      if (!await this.deliveryStore.finish(claim, 'REFUSED', budget.code)) throw new LedgerEntryHeldError('queued delivery lease changed');
      // Terminal ack: topping the budget up or a new month must not revive this entry by itself.
      await this.ledger.ack(entry, 'refused', { reason: budget.code });
      return 'refused';
    }
    const sourceIds = await this.readEvidence.forTurn(turnRequest, response).catch(() => null);

    const text = formatLineReply(response, this.config.webBaseUrl);
    // P12-3b: the identity was just re-resolved above (`userContext`), so a drained answer carries
    // the same handoff a live reply would. `chatKey` is the LINE recipient this push targets.
    const answer = [buildLineBusinessAnswerMessage(response, text, this.config.webBaseUrl, entry.companyId)];
    const outgoing = this.handoffLinks
      ? await this.handoffLinks.wrapOutgoingLineContent(
        { userId: entry.userId, companyId: entry.companyId, lineUserId: entry.chatKey, surface: 'line_ai_ledger_drain' },
        answer,
      )
      : answer;
    const channelId = entry.messagingChannelId ?? this.config.lineMessagingChannelId ?? '';
    const authorization = { v: 1, producerId: claim.token, ...(sourceIds?.length ? { read: {
      userId: entry.userId, companyId: entry.companyId, fingerprint: originalAccess, requestId: turnRequest.requestId, ids: sourceIds,
      webhookEventId: entry.webhookEventId || entry.id, channelId,
      recipientHash: lineDeliveryRecipientHash(entry.chatKey, entry.chatKey, channelId),
    } } : {}) };
    const completion: LineLedgerCompletion = { status: terminalStatusForLineTurn(response), refused: response.refused,
      errorCode: response.errorCode ?? null, replyPreview: response.replyText.slice(0, 240), toolCount: response.toolsInvoked.length };
    if (!await this.saveDelivery(claim, outgoing, authorization, completion)) throw new LedgerEntryHeldError('queued outcome producer lease expired');
    // Model work and link preparation can outlive a role change, unlink or company switch.
    // Resolve again immediately before dispatch; old actor delegation is not send authority.
    if (sourceIds === null || (sourceIds.length && !await this.readEvidence.verify(entry.companyId, entry.userId, turnRequest.requestId, sourceIds).catch(() => false))) {
      return this.refuseSourceDelivery(entry, claim);
    }
    const currentEntitled = await loadEntitledFeatureKeys(this.prisma, entry.companyId);
    const currentUser = await this.resolveUserContext(entry);
    if (!currentUser || lineAssistantDisabledFor(currentEntitled)
      || originalAccess !== lineDeliveryAccessFingerprint(currentUser, currentEntitled)
      || !await this.canReceiveFollowup(entry)) {
      return this.refuseChangedDelivery(entry, claim);
    }
    return this.sendSavedDelivery(entry, claim, deliveryCount, true);
  }

  private async saveDelivery(claim: LineLedgerClaim, messages: LineReplyMessage[], authorization: Record<string, unknown>, completion: LineLedgerCompletion): Promise<boolean> {
    if (!await this.deliveryStore.save(claim, messages, authorization, completion)) return false;
    Object.assign(claim.row, { messagesJson: messages, authorizationJson: authorization, completionJson: completion });
    return true;
  }

  private async sendStaticRefusal(entry: LedgerEntry, claim: LineLedgerClaim, deliveryCount: number, reason: StaticRefusalReason): Promise<'followedUp' | 'refused' | 'parked'> {
    const text = staticRefusalText(reason);
    const budget = isAiBudgetRefusalCode(reason);
    const completion: LineLedgerCompletion = {
      status: budget
        ? (reason === AI_BUDGET_REFUSAL_CODES.insufficient ? 'ai_budget_insufficient' : 'ai_budget_exceeded')
        : reason,
      refused: true,
      // The money code IS the durable reason (spec §9.1); replaying this attempt must reuse it
      // rather than re-derive an answer from whatever the budget says later.
      errorCode: budget ? reason : reason === 'feature_disabled' ? LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE : LINE_AI_ERROR_CODES.FORBIDDEN,
      replyPreview: text.slice(0, 240), toolCount: 0, outcome: 'refused',
      reason: budget ? reason : reason === 'feature_disabled' ? reason : 'identity_or_permission_revoked',
    };
    if (!await this.saveDelivery(claim, [this.lineReply.buildTextMessage(text)], { v: 1, staticRefusal: reason }, completion)) throw new LedgerEntryHeldError('queued refusal producer lease expired');
    return this.sendSavedDelivery(entry, claim, deliveryCount);
  }

  private async sendSavedDelivery(entry: LedgerEntry, claim: LineLedgerClaim, deliveryCount: number, freshlyVerified = false): Promise<'followedUp' | 'refused' | 'parked'> {
    if (entry.kind === 'turn' && entry.webhookEventId && await this.prisma.client.lineTurnOutcome.findUnique({ where: { webhookEventId: entry.webhookEventId }, select: { id: true } })) {
      if (!await this.deliveryStore.finish(claim, 'REFUSED', 'LINE_ORIGINAL_OUTCOME_OWNS_DELIVERY')) throw new LedgerEntryHeldError('queued delivery lease changed');
      await this.ledger.ack(entry, 'parked', { reason: 'original_outcome_owns_delivery' });
      return 'parked';
    }
    const messages = parseOutcomeMessages(claim.row.messagesJson);
    const marker = (claim.row.authorizationJson as { staticRefusal?: string } | null)?.staticRefusal;
    const staticRefusal = isStaticRefusalReason(marker) && messages?.length === 1
      && messages[0].type === 'text' && messages[0].text === staticRefusalText(marker) && !messages[0].quickReply;
    const current = messages && (freshlyVerified || staticRefusal || await this.readEvidence.verifyDelivery(claim.row.authorizationJson, {
      webhookEventId: entry.webhookEventId || entry.id, lineUserId: entry.chatKey, chatId: entry.chatKey,
      channelId: entry.messagingChannelId ?? this.config.lineMessagingChannelId ?? '',
    }).catch(() => false)) && await this.canReceiveFollowup(entry);
    if (!current) {
      return this.refuseSourceDelivery(entry, claim);
    }
    if (!await this.deliveryStore.beginSend(claim)) throw new LedgerEntryHeldError('queued delivery lease expired');
    const delivery = await this.lineReply.sendPush(entry.chatKey, messages!, `ledger:${claim.row.id}`).catch(() => 'failed_other' as const);
    if (delivery !== 'ok') {
      await this.deliveryStore.finish(claim, delivery === 'failed_permanent' ? 'REFUSED' : 'UNKNOWN', `LINE_PUSH_${delivery.toUpperCase()}`);
      throw new Error(`LINE_PUSH_${delivery.toUpperCase()}`);
    }
    if (!await this.deliveryStore.finish(claim, 'ACCEPTED')) throw new LedgerEntryHeldError('queued acceptance needs reconciliation');
    return this.completeSavedDelivery(entry, claim, deliveryCount);
  }

  private async completeSavedDelivery(entry: LedgerEntry, claim: LineLedgerClaim, deliveryCount: number): Promise<'followedUp' | 'refused'> {
    const completion = claim.row.completionJson as LineLedgerCompletion | null;
    if (!completion || typeof completion.status !== 'string' || typeof completion.replyPreview !== 'string'
      || typeof completion.refused !== 'boolean' || !Number.isInteger(completion.toolCount)) throw new Error('LINE_LEDGER_COMPLETION_INVALID');
    if (entry.kind === 'turn' && entry.webhookEventId) {
      const [, eventUpdate] = await Promise.all([
        this.prisma.client.aiTurn.updateMany({
          where: {
            companyId: entry.companyId,
            webhookEventId: entry.webhookEventId,
            status: { in: ['PROCESSING', 'ERROR'] },
          },
          data: {
            status: completion.refused ? 'REFUSED' : 'COMPLETED',
            errorCode: completion.errorCode,
            replyPreview: completion.replyPreview,
          },
        }),
        this.prisma.client.lineWebhookEventLog.updateMany({
          where: {
            webhookEventId: entry.webhookEventId,
            companyId: entry.companyId,
            status: { in: ['processing', 'response_ready', 'delivery_pending', 'ai_error', 'provider_unavailable', 'rate_limited'] },
          },
          // The push landed, so this row owes nothing and must stop carrying the replay payload.
          data: {
            status: completion.status,
            errorCode: completion.errorCode,
            processedAt: new Date(),
            payloadJson: Prisma.DbNull,
          },
        }),
      ]);
      if (eventUpdate.count === 1) {
        emitLineAiTerminalOutcome(this.logger, {
          webhookEventId: entry.webhookEventId,
          companyId: entry.companyId,
          status: completion.status,
          errorCode: completion.errorCode,
        });
      }
    }
    await this.ledger.ack(entry, completion.outcome ?? 'followed_up', {
      deliveryCount,
      refused: completion.refused,
      toolCount: completion.toolCount,
      ...(completion.reason ? { reason: completion.reason } : {}),
    });
    return completion.outcome === 'refused' ? 'refused' : 'followedUp';
  }

  private async finalizeSourceEvent(entry: LedgerEntry, status: string, errorCode: string): Promise<void> {
    if (entry.kind !== 'turn' || !entry.webhookEventId) return;
    const updated = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: {
        webhookEventId: entry.webhookEventId,
        companyId: entry.companyId,
        OR: [{ deliveryOwnerId: `ledger:${lineLedgerDeliveryId(entry)}` }, { deliveryOwnerId: null, turnOutcome: { is: null } }],
        status: { in: ['processing', 'response_ready', 'delivery_pending', 'ai_error', 'provider_unavailable', 'rate_limited'] },
      },
      data: { status, errorCode, processedAt: new Date(), payloadJson: Prisma.DbNull },
    });
    if (updated.count === 1) {
      emitLineAiTerminalOutcome(this.logger, {
        webhookEventId: entry.webhookEventId,
        companyId: entry.companyId,
        status,
        errorCode,
      });
    }
  }

  /** The entry's LINE AI context window is still open, so the user is plausibly still waiting. */
  private inContextWindow(entry: LedgerEntry, now: Date): boolean {
    const created = Date.parse(entry.createdAt);
    return Number.isFinite(created)
      && now.getTime() - created <= LINE_AI_CONTEXT_WINDOW_MINUTES * 60 * 1000;
  }

  private async resolveUserContext(entry: LedgerEntry): Promise<LineUserContext | null> {
    const user = await this.prisma.client.user.findUnique({ where: { id: entry.userId }, select: { status: true, aiAssistantOptOutAt: true } });
    if (!user || user.status !== 'ACTIVE' || user.aiAssistantOptOutAt) return null;
    try {
      const access = await this.permissionResolver.resolveAccess(entry.userId, entry.companyId);
      if (!access.permissions.includes('line.ai.query')) return null;
      return {
        lineUserId: '[REDACTED]',
        internalUserId: entry.userId,
        companyId: entry.companyId,
        membershipId: access.membershipId,
        permissions: access.permissions,
        entitlementDeniedPermissions: access.entitlementDeniedPermissions,
        entitledFeatureKeys: access.entitledFeatureKeys,
        roles: access.roles,
        branchIds: access.scopes.branchIds,
        locationIds: access.scopes.locationIds,
        locale: 'th-TH',
      };
    } catch {
      return null;
    }
  }

  private async canReceiveFollowup(entry: LedgerEntry): Promise<boolean> {
    const channelId = entry.messagingChannelId ?? this.config.lineMessagingChannelId ?? '';
    if (entry.messagingChannelId && this.config.lineMessagingChannelId && entry.messagingChannelId !== this.config.lineMessagingChannelId) return false;
    // A group/room or another person's LINE id cannot inherit this actor's private data access.
    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: { provider: 'LINE', status: 'ACTIVE', userId: entry.userId, providerUserId: entry.chatKey,
        ...(channelId ? { providerChannelId: channelId } : {}),
        user: { status: 'ACTIVE', aiAssistantOptOutAt: null } },
      select: { id: true },
    });
    if (!identity) return false;
    const context = await this.prisma.client.lineCompanyContext.findUnique({
      where: { lineUserId: entry.chatKey }, select: { companyId: true, aiPausedUntil: true },
    });
    return (!context?.companyId || context.companyId === entry.companyId)
      && (!context?.aiPausedUntil || context.aiPausedUntil.getTime() <= Date.now());
  }

  private async refuseSourceDelivery(entry: LedgerEntry, claim: LineLedgerClaim): Promise<'refused'> {
    if (!await this.deliveryStore.finish(claim, 'REFUSED', 'LINE_DELIVERY_SOURCE_CHANGED')) throw new LedgerEntryHeldError('queued delivery lease changed');
    await this.finalizeSourceEvent(entry, 'forbidden', 'LINE_DELIVERY_SOURCE_CHANGED');
    await this.ledger.ack(entry, 'refused', { reason: 'delivery_source_changed' });
    if (await this.canReceiveFollowup(entry)) {
      const notice = this.lineReply.buildTextMessage('ยังยืนยันข้อมูลของคำตอบเดิมไม่ได้ กรุณาเปิดเว็บเพื่อตรวจรายการหรือถามใหม่ หากส่งรายการไว้แล้วให้ตรวจในเว็บก่อนส่งซ้ำค่ะ');
      await this.lineReply.sendPush(entry.chatKey, [notice], `ledger:${claim.row.id}:source-denied`).catch(() => 'failed_other');
    }
    return 'refused';
  }

  private async refuseChangedDelivery(entry: LedgerEntry, claim: LineLedgerClaim): Promise<'refused'> {
    if (!await this.deliveryStore.finish(claim, 'REFUSED', 'LINE_DELIVERY_ACCESS_CHANGED')) throw new LedgerEntryHeldError('queued delivery lease changed');
    await this.finalizeSourceEvent(entry, 'forbidden', 'LINE_DELIVERY_ACCESS_CHANGED');
    await this.ledger.ack(entry, 'refused', { reason: 'delivery_access_changed' });
    return 'refused';
  }
}
