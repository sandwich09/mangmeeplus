/**
 * Drains the LINE AI turn ledger (item 10F): XAUTOCLAIMs open entries past the min-idle
 * window, re-resolves identity/permissions AT EXECUTION TIME (a stored entry is never
 * permission truth), re-runs the entry as a scoped read-only follow-up turn, pushes the
 * answer into the source chat, and acks. waiting_user entries only expire here (the user
 * answers them on the live turn path); a delivery count past the cap parks the entry to
 * audit instead of looping (poison protection).
 *
 * At-least-once by construction: a crash between push and ack redelivers — safe because the
 * whole LINE channel is read-only/draft-only and capture drafts dedupe on LINE message ids.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LineAiTurnRequest, LineUserContext } from '@watchdog-bms/contracts';
import { LINE_AI_CONTEXT_WINDOW_MINUTES, LINE_AI_ERROR_CODES } from '@watchdog-bms/contracts';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { AiGatewayClient } from '../../infrastructure/ai-gateway.client';
import { LineReplyAdapter } from '../../infrastructure/line-reply.adapter';
import { buildLineBusinessAnswerMessage } from '../../domain/logic/line-business-card.logic';
import { LineAiLedgerService, type LedgerEntry } from '../line-ai-ledger.service';
import { formatLineReply, lineAssistantDisabled } from './process-line-webhook.use-case';
import { formatRefusal } from '../../domain/logic/line-ai-formatter.logic';
import { resolveCompanyAiModelPolicy } from '../company-ai-model-policy';
import { emitLineAiTerminalOutcome, terminalStatusForLineTurn } from '../../domain/logic/line-ai-terminal-outcome.logic';

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

@Injectable()
export class DrainLineLedgerUseCase {
  private readonly logger = new Logger(DrainLineLedgerUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly ledger: LineAiLedgerService,
    private readonly aiGateway: AiGatewayClient,
    private readonly lineReply: LineReplyAdapter,
    private readonly shadow: LaunchShadowProbe,
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
        throw new Error('waiting_user entry still inside the clarify window');
      }
      await this.ledger.ack(entry, 'clarify_expired');
      return 'expired';
    }

    if (deliveryCount > this.config.lineAiLedgerDeliveryCap) {
      await this.finalizeSourceEvent(entry, 'failed_terminal', 'LINE_LEDGER_DELIVERY_CAP_EXCEEDED');
      await this.ledger.ack(entry, 'parked', { deliveryCount });
      return 'parked';
    }

    // Freeze in place (owner decision 2026-08-04): the family may have been switched off while this
    // entry sat in the ledger. Terminal ack, not a retry — a re-enable must not revive a turn from
    // before the cutoff.
    if (await lineAssistantDisabled(this.prisma, entry.companyId)) {
      // The claim delay is min-idle (seconds), NOT the 15-minute context window — a queued `turn`
      // is usually still inside it, with a real user waiting on an answer. Dropping it silently
      // looks like the assistant hung, so send the SAME Thai refusal the synchronous webhook sends,
      // through this drain's own push seam. Out-of-window turns and sub_requests stay silent:
      // nobody is waiting on those.
      if (entry.kind === 'turn' && this.inContextWindow(entry, now)) {
        const delivery = await this.lineReply.sendPush(entry.chatKey, [
          this.lineReply.buildTextMessage(formatRefusal('feature_disabled')),
        ]);
        if (delivery !== 'ok') throw new Error(`LINE_PUSH_${delivery.toUpperCase()}`);
        await this.finalizeSourceEvent(entry, 'feature_disabled', LINE_AI_ERROR_CODES.UNSUPPORTED_MODULE);
      } else if (entry.kind === 'turn') {
        await this.finalizeSourceEvent(entry, 'failed_terminal', 'LINE_LEDGER_CONTEXT_EXPIRED');
      }
      await this.ledger.ack(entry, 'refused', { reason: 'feature_disabled' });
      return 'refused';
    }

    // Re-resolve identity + permissions at execution time — revoked access refuses safely.
    const userContext = await this.resolveUserContext(entry);
    if (!userContext) {
      if (entry.kind === 'turn' && this.inContextWindow(entry, now)) {
        const delivery = await this.lineReply.sendPush(entry.chatKey, [
          this.lineReply.buildTextMessage(formatRefusal('forbidden')),
        ]);
        if (delivery !== 'ok') throw new Error(`LINE_PUSH_${delivery.toUpperCase()}`);
        await this.finalizeSourceEvent(entry, 'forbidden', LINE_AI_ERROR_CODES.FORBIDDEN);
      } else if (entry.kind === 'turn') {
        await this.finalizeSourceEvent(entry, 'failed_terminal', 'LINE_LEDGER_PERMISSION_REVOKED_AFTER_CONTEXT');
      }
      await this.ledger.ack(entry, 'refused', { reason: 'identity_or_permission_revoked' });
      return 'refused';
    }

    const modelPolicy = await resolveCompanyAiModelPolicy(this.prisma, entry.companyId, this.config.approvedAiModelIds);
    const turnRequest: LineAiTurnRequest = {
      requestId: randomUUID(),
      webhookEventId: entry.webhookEventId || entry.id,
      userContext,
      ...(modelPolicy && { modelPolicy }),
      messageText: entry.text,
      messagePreviewHash: entry.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'ledger',
      ...(entry.valueCandidates ? { valueCandidates: entry.valueCandidates } : {}),
    };
    const response = await this.aiGateway.requestLineTurn(turnRequest);

    const text = formatLineReply(response, this.config.webBaseUrl);
    const delivery = await this.lineReply.sendPush(entry.chatKey, [
      buildLineBusinessAnswerMessage(response, text, this.config.webBaseUrl, entry.companyId),
    ]);
    if (delivery !== 'ok') throw new Error(`LINE_PUSH_${delivery.toUpperCase()}`);
    if (entry.kind === 'turn' && entry.webhookEventId) {
      const [, eventUpdate] = await Promise.all([
        this.prisma.client.aiTurn.updateMany({
          where: {
            companyId: entry.companyId,
            webhookEventId: entry.webhookEventId,
            status: { in: ['PROCESSING', 'ERROR'] },
          },
          data: {
            status: response.refused ? 'REFUSED' : 'COMPLETED',
            errorCode: response.errorCode ?? null,
            replyPreview: response.replyText.slice(0, 240),
          },
        }),
        this.prisma.client.lineWebhookEventLog.updateMany({
          where: {
            webhookEventId: entry.webhookEventId,
            status: { in: ['processing', 'response_ready', 'delivery_pending'] },
          },
          // The push landed, so this row owes nothing and must stop carrying the replay payload.
          data: {
            status: terminalStatusForLineTurn(response),
            errorCode: response.errorCode ?? null,
            processedAt: new Date(),
            payloadJson: Prisma.DbNull,
          },
        }),
      ]);
      if (eventUpdate.count === 1) {
        emitLineAiTerminalOutcome(this.logger, {
          webhookEventId: entry.webhookEventId,
          companyId: entry.companyId,
          status: terminalStatusForLineTurn(response),
          errorCode: response.errorCode,
        });
      }
    }
    await this.ledger.ack(entry, 'followed_up', {
      deliveryCount,
      refused: response.refused,
      toolCount: response.toolsInvoked.length,
    });
    return 'followedUp';
  }

  private async finalizeSourceEvent(entry: LedgerEntry, status: string, errorCode: string): Promise<void> {
    if (entry.kind !== 'turn' || !entry.webhookEventId) return;
    const updated = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: {
        webhookEventId: entry.webhookEventId,
        status: { in: ['processing', 'response_ready', 'delivery_pending'] },
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
    const user = await this.prisma.client.user.findUnique({ where: { id: entry.userId }, select: { status: true } });
    if (!user || user.status !== 'ACTIVE') return null;
    try {
      const access = await this.permissionResolver.resolveAccess(entry.userId, entry.companyId);
      if (!access.permissions.includes('line.ai.query')) return null;
      return {
        lineUserId: '[REDACTED]',
        internalUserId: entry.userId,
        companyId: entry.companyId,
        membershipId: access.membershipId,
        permissions: access.permissions,
        roles: access.roles,
        branchIds: access.scopes.branchIds,
        locale: 'th-TH',
      };
    } catch {
      return null;
    }
  }
}
