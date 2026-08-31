import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { CompanySignupCoreService } from './company-signup-core.service';
import {
  parseSnsEnvelope,
  snsHttpsUrl,
  verifySnsSignature,
  type CertificateFetcher,
  type SnsEnvelope,
} from '../infrastructure/sns-signature';

/** Injection token for the outbound GET used by the certificate fetch and the subscribe confirm. */
export const SNS_HTTP_GET_TOKEN = 'SNS_HTTP_GET_TOKEN';

const SERVICE_ACTOR = 'ses-event-consumer';
const MAX_DIAGNOSTIC_CHARS = 200;

export type SesEventResult = Readonly<{ handled: 'confirmed' | 'failed' | 'ignored' }>;

/**
 * Expected SNS topic. **Fail closed:** with the variable unset the endpoint refuses everything, so
 * an environment that was never wired cannot be subscribed to by a stranger's topic.
 * Environment-read for the same reason as `SES_CONFIGURATION_SET` — a per-environment operational
 * name, not part of the shared config schema.
 */
export function expectedSesEventsTopicArn(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SES_EVENTS_TOPIC_ARN?.trim() || undefined;
}

/**
 * Consumes SES delivery/bounce/complaint events published to SNS (spec §4D): a hard bounce or a
 * complaint on the one claim email moves the request to `EMAIL_FAILED`, which flags it in the admin
 * queue and re-opens both resend paths. Without this, a mistyped address is silently "sent".
 */
@Injectable()
export class SesEventsUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CompanySignupCoreService,
    @Inject(SNS_HTTP_GET_TOKEN) private readonly httpGet: CertificateFetcher,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  async handle(body: unknown, correlationRequestId: string): Promise<SesEventResult> {
    const envelope = parseSnsEnvelope(body);
    if (!envelope) throw new BadRequestException('sns_envelope_invalid');

    const expectedTopicArn = expectedSesEventsTopicArn();
    if (!expectedTopicArn) throw new ForbiddenException('ses_events_topic_not_configured');
    // Checked *before* the signature so certificate fetching is bounded to messages that at least
    // claim to come from our own topic.
    if (envelope.TopicArn !== expectedTopicArn) throw new ForbiddenException('sns_topic_not_allowed');

    if (!await verifySnsSignature(envelope, this.httpGet)) {
      this.logger.warn({
        event: 'ses.sns.signature_invalid', riskLevel: 'HIGH', snsMessageId: envelope.MessageId,
      }, 'ses.sns.signature_invalid');
      throw new ForbiddenException('sns_signature_invalid');
    }

    if (envelope.Type === 'SubscriptionConfirmation') return this.confirmSubscription(envelope);
    if (envelope.Type !== 'Notification') {
      this.logger.warn({ event: 'ses.sns.unhandled_type', snsType: envelope.Type }, 'ses.sns.unhandled_type');
      return { handled: 'ignored' };
    }
    return this.handleSesEvent(envelope, correlationRequestId);
  }

  /** Auto-confirm, so the operator only has to create the subscription (runbook step). */
  private async confirmSubscription(envelope: SnsEnvelope): Promise<SesEventResult> {
    const subscribeUrl = envelope.SubscribeURL ? snsHttpsUrl(envelope.SubscribeURL) : null;
    if (!subscribeUrl) throw new ForbiddenException('sns_subscribe_url_not_allowed');
    await this.httpGet(subscribeUrl.toString());
    this.logger.info({ event: 'ses.sns.subscription_confirmed', topicArn: envelope.TopicArn }, 'ses.sns.subscription_confirmed');
    return { handled: 'confirmed' };
  }

  private async handleSesEvent(envelope: SnsEnvelope, correlationRequestId: string): Promise<SesEventResult> {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(envelope.Message) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('ses_event_invalid');
    }
    // Configuration-set event publishing uses `eventType`; the older identity-level notification
    // format uses `notificationType`. Same payload otherwise, so accept either.
    const kind = str(message.eventType) ?? str(message.notificationType);
    const sesMessageId = str((message.mail as Record<string, unknown> | undefined)?.messageId);

    if (kind === 'Bounce') {
      const bounce = (message.bounce ?? {}) as Record<string, unknown>;
      const bounceType = str(bounce.bounceType);
      if (bounceType !== 'Permanent') {
        // Transient/Undetermined: SES retries by itself, and the applicant may still receive it.
        this.logger.info({ event: 'ses.bounce.transient', bounceType, sesMessageId }, 'ses.bounce.transient');
        return { handled: 'ignored' };
      }
      return this.failRequest(sesMessageId, correlationRequestId, {
        failureCode: 'email_bounce_permanent',
        auditAction: 'signup.claim_email.bounced',
        detail: {
          bounceType, bounceSubType: str(bounce.bounceSubType) ?? null,
          ...recipientDetail(bounce.bouncedRecipients),
        },
      });
    }

    if (kind === 'Complaint') {
      const complaint = (message.complaint ?? {}) as Record<string, unknown>;
      return this.failRequest(sesMessageId, correlationRequestId, {
        failureCode: 'email_complaint',
        auditAction: 'signup.claim_email.complaint',
        detail: {
          complaintFeedbackType: str(complaint.complaintFeedbackType) ?? null,
          ...recipientDetail(complaint.complainedRecipients),
        },
      });
    }

    // Delivery is the happy path and arrives for every send; nothing to record.
    this.logger.debug({ event: 'ses.event.ignored', sesEventType: kind, sesMessageId }, 'ses.event.ignored');
    return { handled: 'ignored' };
  }

  private async failRequest(
    sesMessageId: string | undefined,
    correlationRequestId: string,
    input: { failureCode: string; auditAction: string; detail: Record<string, unknown> },
  ): Promise<SesEventResult> {
    if (!sesMessageId) return { handled: 'ignored' };
    const request = await this.prisma.client.companySignupRequest.findUnique({
      where: { claimEmailSesMessageId: sesMessageId },
      select: { id: true, state: true },
    });
    // An event for a message this product did not send, or for one whose row is long gone.
    if (!request) {
      this.logger.warn({ event: 'ses.event.unknown_message', sesMessageId }, 'ses.event.unknown_message');
      return { handled: 'ignored' };
    }
    // Idempotent by state: a redelivered event, or a row already claimed/expired/failed, is left
    // exactly as it is. Only the request still waiting on that email can be failed by it.
    if (request.state !== 'EMAIL_PENDING') {
      this.logger.info({
        event: 'ses.event.state_not_pending', signupRequestId: request.id, state: request.state,
      }, 'ses.event.state_not_pending');
      return { handled: 'ignored' };
    }

    await this.core.advance(request.id, 'EMAIL_FAILED', correlationRequestId, input.failureCode);
    await this.prisma.client.auditLog.create({
      data: {
        actorType: 'SERVICE', actorRefId: SERVICE_ACTOR,
        action: input.auditAction,
        targetType: 'company_signup_request', targetId: request.id, requestId: correlationRequestId,
        result: 'FAILED', riskLevel: 'HIGH',
        metadataJson: { ...input.detail, sesMessageId, failureCode: input.failureCode },
      },
    });
    return { handled: 'failed' };
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** First recipient plus its diagnostic code — the two things an admin needs before calling back. */
function recipientDetail(recipients: unknown): Record<string, unknown> {
  const first = Array.isArray(recipients) ? recipients[0] as Record<string, unknown> | undefined : undefined;
  return {
    bouncedRecipient: str(first?.emailAddress) ?? null,
    diagnosticCode: str(first?.diagnosticCode)?.slice(0, MAX_DIAGNOSTIC_CHARS) ?? null,
  };
}
