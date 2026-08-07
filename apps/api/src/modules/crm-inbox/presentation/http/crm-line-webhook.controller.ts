import { Controller, HttpCode, Logger, NotFoundException, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { Public } from '../../../../common/security/public.decorator';
import { verifyLineWebhookSignature } from '../../../auth/infrastructure/line-webhook-verifier';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { ProcessInboundLineMessageUseCase } from '../../application/use-cases/process-inbound-line-message.use-case';
import { MessagingChannelSecretsService } from '../../application/use-cases/messaging-channel.use-case';
import type { LineInboundEvent } from '../../domain/models/crm-inbox.model';

type RawLineRequest = Request & { rawBody?: Buffer };

// Company LINE OA webhook (Item 15A). END-CUSTOMER channel — a deliberately
// separate endpoint and code path from the shared WatchDog OA webhook
// (auth/presentation/line-webhook.controller.ts, internal users). Here the
// company IS resolved from the channel record: each company registers its own
// OA credentials, so channel → company is safe on this path only.
@Controller()
export class CrmLineWebhookController {
  private readonly logger = new Logger(CrmLineWebhookController.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly processInbound: ProcessInboundLineMessageUseCase,
  ) {}

  @Public()
  @Post('crm/line/webhook/:webhookKey')
  @HttpCode(200)
  @ApiOperation({ summary: 'Company LINE OA webhook receiver (per-channel key)' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  @ApiResponse({ status: 404, description: 'Unknown webhook key' })
  async receive(@Param('webhookKey') webhookKey: string, @Req() req: RawLineRequest): Promise<Record<string, never>> {
    const channel = await this.repo.findChannelByWebhookKey(webhookKey);
    if (!channel) throw new NotFoundException(); // generic — no existence detail

    // Signature FIRST (spec 9.2 order). Without it the disabled-drop 200 would
    // hand unauthenticated callers a channel-state oracle (200 vs 401).
    const signature = req.headers['x-line-signature'] as string | undefined;
    if (!signature) throw new UnauthorizedException('Missing x-line-signature header.');
    if (!req.rawBody) throw new UnauthorizedException('Raw body unavailable.');

    let channelSecret: string;
    try {
      channelSecret = this.secrets.decrypt(channel).channelSecret;
    } catch {
      // L-14: dotted event name — an English sentence cannot be an alarm key.
      this.logger.error({ msg: 'line.webhook.channel_secret_unavailable', channelId: channel.id });
      throw new UnauthorizedException('Channel credential unavailable.');
    }

    if (!verifyLineWebhookSignature(req.rawBody, signature, channelSecret)) {
      emitSecurityEvent(this.logger, SECURITY_EVENT.lineWebhookSignatureInvalid, 'HIGH', {
        channelId: channel.id,
        requestId: req.headers['x-request-id'],
      });
      throw new UnauthorizedException('Invalid LINE webhook signature.');
    }

    if (channel.status === 'DISABLED') {
      // Signed traffic for a disabled channel: 200 so LINE stops retrying.
      this.logger.warn({ msg: 'line.webhook.channel_disabled', channelId: channel.id });
      return {};
    }

    const payload = req.body as { events?: LineInboundEvent[] };
    const receivedAt = Date.now();
    const events = (payload.events ?? []).map((event) => ({
      ...event,
      replyToken: typeof event.replyToken === 'string' ? event.replyToken : undefined,
      receivedAt,
    }));
    const hasCustomerMessage = events.some((e) => e.type === 'message');
    await this.repo.touchChannelWebhook(channel.id, new Date(), hasCustomerMessage);

    // processInbound isolates per-event failures and logs them.
    await this.processInbound.execute(
      hasCustomerMessage && channel.status === 'CONNECTED' ? { ...channel, status: 'ACTIVE' } : channel,
      events,
    );

    return {};
  }
}
