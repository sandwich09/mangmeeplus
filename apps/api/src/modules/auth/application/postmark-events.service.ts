import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { EmailDeliveryService, POSTMARK_EVENT_TYPE } from './email-delivery.service';
import { validPostmarkMessageId } from '../infrastructure/postmark.client';

export type PostmarkEvent = {
  kind: 'Delivery' | 'Bounce' | 'SpamComplaint'; serverId: number; stream: string;
  messageId: string; recipient: string; occurredAt: string; eventId: string | null;
  attemptId: string | null; suppress: boolean;
};

export function parsePostmarkEvent(value: unknown): PostmarkEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid Postmark event');
  const body = value as Record<string, any>;
  const kind = body.RecordType;
  const recipient = kind === 'Delivery' ? body.Recipient : body.Email;
  const at = kind === 'Delivery' ? body.DeliveredAt : body.BouncedAt;
  if (!['Delivery', 'Bounce', 'SpamComplaint'].includes(kind) || !Number.isSafeInteger(body.ServerID) || body.ServerID <= 0 ||
      typeof body.MessageStream !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.MessageStream) ||
      !validPostmarkMessageId(body.MessageID) || typeof recipient !== 'string' ||
      recipient.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ||
      typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new BadRequestException('Invalid Postmark event');
  return { kind, serverId: body.ServerID, stream: body.MessageStream, messageId: body.MessageID,
    recipient: recipient.trim().toLowerCase(), occurredAt: new Date(at).toISOString(),
    eventId: Number.isSafeInteger(body.ID) && body.ID >= 0 ? String(body.ID) : null,
    attemptId: validPostmarkMessageId(body.Metadata?.sendAttemptId) ? body.Metadata.sendAttemptId : null,
    suppress: kind === 'SpamComplaint' || body.Inactive === true || body.Type === 'HardBounce' || body.TypeCode === 1,
  };
}

export function postmarkEventKey(event: PostmarkEvent): string {
  const key = event.kind !== 'Delivery' && event.eventId
    ? [event.kind, event.serverId, event.stream, event.eventId]
    : [event.kind, event.serverId, event.stream, event.messageId, event.recipient, event.occurredAt];
  return `postmark:${createHash('sha256').update(JSON.stringify(key)).digest('hex')}`;
}

@Injectable()
export class PostmarkEventsService {
  constructor(private readonly config: AppConfigService, private readonly prisma: PrismaService, private readonly delivery: EmailDeliveryService) {}

  async receive(authorization: string | undefined, body: unknown): Promise<{ accepted: true }> {
    const username = this.config.postmarkWebhookUsername;
    const password = this.config.postmarkWebhookPassword;
    if (!username || !password || !authorization || authorization.length > 2048) throw new UnauthorizedException();
    const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const digest = (v: string) => createHash('sha256').update(v).digest();
    if (!timingSafeEqual(digest(expected), digest(authorization))) throw new UnauthorizedException();
    const event = parsePostmarkEvent(body);
    // Postmark verifies endpoints with reserved sample identities, not the configured server.
    // Acknowledge authenticated probes only; never enqueue their synthetic bounce/suppression.
    if (event.messageId === '00000000-0000-0000-0000-000000000000' && event.recipient === 'john@example.com' &&
        event.stream === 'outbound' && event.stream === this.config.postmarkMessageStream && event.attemptId === null &&
        event.serverId === (event.kind === 'Delivery' ? 23 : 1234)) return { accepted: true };
    if (event.serverId !== this.config.postmarkServerId || event.stream !== this.config.postmarkMessageStream) throw new BadRequestException('Postmark environment mismatch');
    const eventKey = postmarkEventKey(event);
    // Persist only sanitized facts, never Content/Details/Subject or authentication headers.
    try {
      await this.prisma.client.outboxEvent.upsert({ where: { eventKey }, update: {}, create: {
        eventKey, eventType: POSTMARK_EVENT_TYPE, aggregateType: 'EmailSendAttempt', aggregateId: event.attemptId ?? event.messageId,
        payloadJson: { ...event },
      } });
    } catch { throw new ServiceUnavailableException('Email event persistence unavailable'); }
    return { accepted: true };
  }

  async apply(event: PostmarkEvent): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const candidate = event.attemptId
        ? await tx.emailSendAttempt.findUnique({ where: { id: event.attemptId } })
        : await tx.emailSendAttempt.findUnique({ where: { provider_providerServerId_providerMessageId: {
          provider: 'postmark', providerServerId: event.serverId, providerMessageId: event.messageId,
        } } });
      if (!candidate) throw new Error('postmark.unmapped_event');
      await tx.$queryRaw`SELECT id FROM "EmailSendAttempt" WHERE id = ${candidate.id} FOR UPDATE`;
      const attempt = await tx.emailSendAttempt.findUniqueOrThrow({ where: { id: candidate.id } });
      if (attempt.provider !== 'postmark' || attempt.providerServerId !== event.serverId || attempt.stream !== event.stream ||
          !attempt.dispatchStartedAt || attempt.recipient !== event.recipient ||
          (attempt.providerMessageId && attempt.providerMessageId !== event.messageId)) {
        throw new Error('postmark.event_binding_mismatch');
      }
      if (event.suppress) {
        await this.delivery.suppress(tx, attempt, event.kind);
        await tx.emailSendAttempt.update({ where: { id: attempt.id }, data: {
          providerMessageId: event.messageId, status: 'SUPPRESSED', suppressedAt: new Date(event.occurredAt), nextRecoveryAt: null,
        } });
        if (attempt.signupRequestId) {
          const changed = await tx.companySignupRequest.updateMany({
            where: { id: attempt.signupRequestId, latestClaimEmailAttemptId: attempt.id, state: 'EMAIL_PENDING' },
            data: { state: 'EMAIL_FAILED', failureCode: 'email_delivery_failed', version: { increment: 1 } },
          });
          if (changed.count) await tx.auditLog.create({ data: {
            action: 'email.claim.delivery_failed', targetType: 'CompanySignupRequest', targetId: attempt.signupRequestId,
            requestId: postmarkEventKey(event), result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { attemptId: attempt.id, kind: event.kind },
          } });
        }
      } else if (event.kind === 'Delivery') {
        await tx.emailSendAttempt.updateMany({ where: { id: attempt.id, suppressedAt: null, status: { not: 'SUPPRESSED' } }, data: {
          providerMessageId: event.messageId, deliveredAt: new Date(event.occurredAt), status: 'ACCEPTED', nextRecoveryAt: null,
        } });
      }
    });
  }
}
