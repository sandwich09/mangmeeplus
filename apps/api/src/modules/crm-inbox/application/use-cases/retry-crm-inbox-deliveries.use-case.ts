import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { PrismaCrmRepository } from '../../../crm/infrastructure/prisma-crm.repository';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { LineMessagingAdapter } from '../../infrastructure/line-messaging.adapter';
import { MessagingChannelSecretsService } from './messaging-channel.use-case';
import { isTerminalMediaError, lineReplyRetryKeyForMessage, previewText, resolveReplySendOutcome, statusAfterStaffReply } from '../../domain/logic/crm-inbox.logic';
import { evaluateCrmAutonomousOutboundPolicy } from '../../domain/logic/crm-auto-reply.logic';
import {
  CUSTOMER_PLACEHOLDER_NAME,
  MEDIA_FETCH_GRACE_MS,
  MEDIA_FETCH_MAX_AGE_MS,
  PROFILE_ENRICH_MAX_AGE_MS,
  REPLY_SEND_MAX_ATTEMPTS,
  REPLY_SEND_MAX_AGE_MS,
  REPLY_SEND_ORPHAN_GRACE_MS,
  RETRY_SCAN_LIMIT,
} from '../../domain/crm-inbox.constants';
import {
  canonicalAttachmentExtension,
  inspectAttachmentBytes,
  normalizeAttachmentMimeType,
  validateAttachmentFileName,
  validateAttachmentMeta,
} from '../../../data-model-core/domain/logic/attachment.logic';
import { AttachmentMalwareScanner } from '../../../data-model-core/infrastructure/attachment-malware-scanner';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';

const SYSTEM_ACTOR = 'system';
const NOOP_SHADOW = {
  startSweep: () => ({ record: async () => undefined, flush: async () => ({}) }),
} as unknown as LaunchShadowProbe;

/**
 * Durable CRM-inbox delivery retries (A5). Worker-triggered, cross-company. The API has
 * no BullMQ producer, so — consistent with the SLA/delivery scanners — durability is
 * DB-state + a worker sweep: the send/ingest paths persist retry state, this use-case
 * re-drives it. Covers three things the inline background paths could drop on an API
 * restart or transient LINE error:
 *   1. reply-send retry (429/5xx/network; 401/4xx terminal)
 *   2. inbound media re-fetch (orphaned pending / transient failure; size/type terminal)
 *   3. LINE profile re-enrichment (customers still on the placeholder name)
 * Each item is best-effort; one failure never aborts the sweep.
 */
@Injectable()
export class RetryCrmInboxDeliveriesUseCase {
  private readonly logger = new Logger(RetryCrmInboxDeliveriesUseCase.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly crmRepo: PrismaCrmRepository,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly line: LineMessagingAdapter,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly config: AppConfigService,
    @Optional() private readonly malwareScanner?: AttachmentMalwareScanner,
    private readonly shadow: LaunchShadowProbe = NOOP_SHADOW,
  ) {}

  async execute(limit = RETRY_SCAN_LIMIT): Promise<{ repliesRetried: number; mediaFetched: number; profilesEnriched: number }> {
    const [repliesRetried, mediaFetched, profilesEnriched] = await Promise.all([
      this.retryReplies(limit),
      this.retryMedia(limit),
      this.enrichProfiles(limit),
    ]);
    return { repliesRetried, mediaFetched, profilesEnriched };
  }

  /** Re-push PENDING outbound replies whose backoff elapsed (or crash-orphaned). */
  async retryReplies(limit: number): Promise<number> {
    const shadow = this.shadow.startSweep(SHADOW_SURFACES.crmInboxRetry);
    try {
      const now = new Date();
      const candidates = await this.repo.findRetryableReplies(now, REPLY_SEND_ORPHAN_GRACE_MS, REPLY_SEND_MAX_AGE_MS, limit);
      let sent = 0;
      for (const msg of candidates) {
        await shadow.record(msg.companyId, 'crm');
        try {
        const attempt = await this.repo.processPendingReplyAttempt(
          {
            companyId: msg.companyId,
            customerId: msg.customerId,
            conversationId: msg.conversationId,
            messageId: msg.id,
            expectedAttemptCount: msg.deliveryAttemptCount,
          },
          async ({ channel, identity, conversation, message, consentStatus }, attemptCountAfter) => {
            const outboundPolicy = message.authorType === 'AI' && message.contentText
              ? evaluateCrmAutonomousOutboundPolicy({
                draftText: message.contentText,
                allowedDomains: this.config.crmAiOutboundAllowedDomains,
              })
              : { action: 'allow' as const };
            const terminalError = !channel || channel.status === 'DISABLED'
              ? 'channel_disabled'
              : !identity || identity.status === 'UNFOLLOWED'
                ? 'customer_unfollowed'
                : !message.contentText
                  ? 'empty_text'
                  : (message.authorType === 'AI' || message.authorType === 'SYSTEM') && consentStatus === 'REVOKED'
                    ? 'consent_revoked'
                    : outboundPolicy.action === 'review'
                      ? `outbound_policy_${outboundPolicy.reason}`
                      : null;
            if (terminalError) {
              return {
                result: {
                  sent: false,
                  denialReason: terminalError === 'consent_revoked' || terminalError.startsWith('outbound_policy_')
                    ? terminalError
                    : null,
                  contentText: message.contentText,
                  conversation,
                },
                messageUpdate: { deliveryStatus: 'FAILED', deliveryError: terminalError, deliveryNextAttemptAt: null },
              };
            }

            const push = await this.line.pushTextMessage(
              this.secrets.decrypt(channel!).accessToken,
              identity!.providerUserId,
              message.contentText!,
              lineReplyRetryKeyForMessage(message.id),
            );
            const outcome = resolveReplySendOutcome({
              ok: push.ok,
              error: push.ok ? undefined : push.error,
              retryAfterSeconds: push.ok ? undefined : push.retryAfterSeconds,
              attemptCountAfter,
              maxAttempts: REPLY_SEND_MAX_ATTEMPTS,
              now,
            });
            return {
              result: { sent: push.ok, denialReason: null, contentText: message.contentText, conversation },
              messageUpdate: {
                deliveryStatus: outcome.status,
                deliveryNextAttemptAt: outcome.nextAttemptAt ?? null,
                ...(push.ok ? { sentAt: now, deliveryError: null } : { deliveryError: push.error }),
              },
            };
          },
        );
        if (!attempt) continue;
        if (attempt.result.sent && attempt.result.contentText) {
          sent += 1;
          await this.repo.updateConversation(msg.companyId, msg.conversationId, {
            status: statusAfterStaffReply(attempt.result.conversation.status),
            lastMessageAt: now,
            lastOutboundAt: now,
            lastMessagePreview: previewText(attempt.result.contentText),
            ...(attempt.result.conversation.firstRespondedAt ? {} : { firstRespondedAt: now }),
          });
          void this.outbox.append('crm.conversation.message_sent', 'crm_conversation', msg.conversationId, {
            companyId: msg.companyId, actorUserId: SYSTEM_ACTOR, aggregateType: 'crm_conversation', aggregateId: msg.conversationId,
            occurredAt: now.toISOString(), data: { messageId: msg.id, retried: true },
          });
          // CUST-11: FK-safe typed-actor audit is awaited so a write failure surfaces (logged) instead of becoming an unhandled rejection.
          await this.audit.log({ companyId: msg.companyId, actorType: 'SYSTEM', actorRefId: 'crm-retry-sweep', action: 'crm.inbox.reply_retry', targetType: 'crm_conversation', targetId: msg.conversationId, requestId: `reply-retry-${msg.id}`, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { messageId: msg.id, attempt: attempt.attemptCountAfter } });
        } else if (attempt.result.denialReason) {
          await this.audit.log({
            companyId: msg.companyId,
            actorType: 'SYSTEM',
            actorRefId: 'crm-retry-sweep',
            action: 'crm.inbox.reply_retry',
            targetType: 'crm_conversation',
            targetId: msg.conversationId,
            requestId: `reply-retry-${msg.id}`,
            result: 'DENIED',
            riskLevel: attempt.result.denialReason.startsWith('outbound_policy_') ? 'HIGH' : 'MEDIUM',
            metadataJson: { messageId: msg.id, attempt: attempt.attemptCountAfter, reason: attempt.result.denialReason },
          });
        }
        } catch (error) {
          this.logger.warn({ msg: 'reply retry failed', messageId: msg.id, error: (error as Error).message });
        }
      }
      return sent;
    } finally {
      await shadow.flush();
    }
  }

  /** Re-fetch inbound media the inline background path never stored (skips terminal errors). */
  async retryMedia(limit: number): Promise<number> {
    const shadow = this.shadow.startSweep(SHADOW_SURFACES.crmInboxRetry);
    try {
      const now = new Date();
      const candidates = await this.repo.findMediaFetchCandidates(now, MEDIA_FETCH_GRACE_MS, MEDIA_FETCH_MAX_AGE_MS, limit);
      let fetched = 0;
      for (const msg of candidates) {
        await shadow.record(msg.companyId, 'crm');
        const meta = (msg.contentJson ?? {}) as Record<string, unknown>;
        if (isTerminalMediaError(typeof meta['mediaError'] === 'string' ? (meta['mediaError'] as string) : null)) continue;
        if (!msg.providerMessageId) continue;
        try {
        const channel = await this.repo.findChannelById(msg.companyId, msg.channelId);
        if (!channel || channel.status === 'DISABLED') continue;
        const result = await this.repo.withLiveCustomerLock(
          {
            companyId: msg.companyId,
            customerId: msg.customerId,
            conversationId: msg.conversationId,
            channelIdentityId: msg.channelIdentityId,
          },
          async () => this.line.getMessageContent(
            this.secrets.decrypt(channel).accessToken,
            msg.providerMessageId!,
            this.config.uploadMaxBytes,
          ),
        );
        if (!result) continue;
        if (!result.ok) {
          // Persist the failure marker so terminal errors are skipped next pass.
          await this.repo.updateMessageContentJson(msg.id, { ...meta, mediaError: result.error });
          continue;
        }
        const mimeType = normalizeAttachmentMimeType(result.mimeType, result.data);
        const extension = canonicalAttachmentExtension(mimeType);
        const fileName = typeof meta['fileName'] === 'string'
          ? (meta['fileName'] as string)
          : `media-${msg.providerMessageId}.${extension ?? 'bin'}`;
        let rejectionReason = validateAttachmentMeta(mimeType, result.data.byteLength, this.config.uploadMaxBytes)
          ? 'METADATA_REJECTED'
          : validateAttachmentFileName(fileName, mimeType)
            ? 'EXTENSION_MIME_MISMATCH'
            : meta['lineType'] === 'image' && mimeType !== 'image/jpeg' && mimeType !== 'image/png'
              ? 'MESSAGE_TYPE_MISMATCH'
              : inspectAttachmentBytes(mimeType, result.data)
                ? 'CONTENT_REJECTED'
                : null;
        if (!rejectionReason) {
          if (!this.malwareScanner) {
            rejectionReason = 'MALWARE_SCAN_FAILED';
          } else {
            try {
              await this.malwareScanner.assertClean(result.data);
            } catch (error) {
              rejectionReason = (error as Error).message === 'MALWARE_DETECTED' ? 'MALWARE_DETECTED' : 'MALWARE_SCAN_FAILED';
            }
          }
        }
        if (rejectionReason) {
          const mediaError = rejectionReason === 'MALWARE_SCAN_FAILED' ? 'media_scan_failed' : 'media_security_rejected';
          await this.repo.updateMessageContentJson(msg.id, { ...meta, mediaError });
          await this.audit.log({
            companyId: msg.companyId,
            actorType: 'SYSTEM',
            actorRefId: 'crm-retry-sweep',
            action: 'attachment.upload.rejected',
            targetType: 'crm_message',
            targetId: msg.id,
            requestId: `media-retry-${msg.id}`,
            result: 'DENIED',
            riskLevel: 'HIGH',
            metadataJson: { source: 'CRM_LINE_RETRY', reason: rejectionReason, mimeType, byteSize: result.data.byteLength },
          });
          emitSecurityEvent(this.logger, SECURITY_EVENT.attachmentUploadRejected, 'HIGH', {
            companyId: msg.companyId,
            source: 'CRM_LINE_RETRY',
            reason: rejectionReason,
            messageId: msg.id,
          });
          continue;
        }
        const stored = await this.repo.storeInboundMediaAttachment({
          attachmentId: randomUUID(),
          companyId: msg.companyId,
          messageId: msg.id,
          originalFileName: fileName,
          mimeType,
          data: result.data,
          checksumSha256: createHash('sha256').update(result.data).digest('hex'),
        });
        if (stored) fetched += 1;
        } catch (error) {
          this.logger.warn({ msg: 'media retry failed', messageId: msg.id, error: (error as Error).message });
        }
      }
      return fetched;
    } finally {
      await shadow.flush();
    }
  }

  /** Re-enrich LINE profiles for customers still on the placeholder name. */
  async enrichProfiles(limit: number): Promise<number> {
    const shadow = this.shadow.startSweep(SHADOW_SURFACES.crmInboxRetry);
    try {
      const now = new Date();
      const candidates = await this.repo.findProfileEnrichCandidates(now, PROFILE_ENRICH_MAX_AGE_MS, CUSTOMER_PLACEHOLDER_NAME, limit);
      let enriched = 0;
      for (const ident of candidates) {
        await shadow.record(ident.companyId, 'crm');
        try {
        const channel = await this.repo.findChannelById(ident.companyId, ident.channelId);
        if (!channel || channel.status === 'DISABLED') continue;
        const profile = await this.repo.withLiveCustomerLock(
          { companyId: ident.companyId, customerId: ident.customerId, channelIdentityId: ident.id },
          async (liveIdentity) => this.line.getProfile(
            this.secrets.decrypt(channel).accessToken,
            liveIdentity.providerUserId,
          ),
        );
        if (!profile?.displayName && !profile?.pictureUrl) continue;
        const saved = await this.repo.updateIdentityProfileUnlessErased({
          companyId: ident.companyId,
          identityId: ident.id,
          expectedCustomerId: ident.customerId,
          displayName: profile.displayName ?? null,
          pictureUrl: profile.pictureUrl ?? null,
          placeholderName: CUSTOMER_PLACEHOLDER_NAME,
          updatedByUserId: SYSTEM_ACTOR,
        });
        if (saved) enriched += 1;
        } catch (error) {
          this.logger.warn({ msg: 'profile enrich retry failed', identityId: ident.id, error: (error as Error).message });
        }
      }
      return enriched;
    } finally {
      await shadow.flush();
    }
  }
}
