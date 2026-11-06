import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
import { Controller, HttpCode, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/security/public.decorator';
import { AppConfigService } from '../../../common/config/app-config.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../common/logger/security-event';
import { verifyLineWebhookSignature } from '../infrastructure/line-webhook-verifier';
import { LineMessageBufferService } from '../../line-ai/application/line-message-buffer.service';
import { buildLineBufferEnvelope, type LineMessageEvent } from '../../line-ai/application/line-buffer-envelope';

type RawLineRequest = Request & { rawBody?: Buffer };

@Controller()
export class LineWebhookController {
  private readonly logger = new Logger(LineWebhookController.name);

  constructor(private readonly lineCredentials: LineMessagingCredentialsService,
    private readonly config: AppConfigService,
    private readonly messageBuffer: LineMessageBufferService,
  ) {}

  @Public()
  @Post('line/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'LINE Messaging API webhook receiver' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  async lineWebhook(@Req() req: RawLineRequest): Promise<Record<string, never>> {
    return this.handleLineWebhook(req);
  }

  @Public()
  @Post('webhooks/line')
  @HttpCode(200)
  @ApiOperation({ summary: 'LINE Messaging API webhook receiver (legacy path)' })
  async legacyLineWebhook(@Req() req: RawLineRequest): Promise<Record<string, never>> {
    return this.handleLineWebhook(req);
  }

  /** Verifies the signature, hands events to the message buffer, and acks 200
   *  immediately. AI turns and replies run asynchronously on the buffer's
   *  per-chat worker (docs/specs/line-ai-message-buffering-spec.md §4). */
  private async handleLineWebhook(req: RawLineRequest): Promise<Record<string, never>> {
    const sig = req.headers['x-line-signature'] as string | undefined;
    if (!sig) throw new UnauthorizedException('Missing x-line-signature header.');

    const credential = await this.lineCredentials.get(undefined, 'INBOUND');
    const secret = credential.channelSecret;
    if (!secret) throw new UnauthorizedException('LINE Messaging channel secret not configured.');

    if (!req.rawBody) throw new UnauthorizedException('LINE webhook raw body unavailable.');

    if (!verifyLineWebhookSignature(req.rawBody, sig, secret)) {
      // L-14: stable dotted name so a machine-speed forgery attempt is visible to the alarm.
      emitSecurityEvent(this.logger, SECURITY_EVENT.lineWebhookSignatureInvalid, 'HIGH');
      throw new UnauthorizedException('Invalid LINE webhook signature.');
    }

    await this.lineCredentials.observeSignature(credential);
    const payload = req.body as { destination?: string; events?: LineMessageEvent[] };
    const messagingChannelId = credential.channelId ?? '';
    this.logger.log({ msg: 'LINE webhook received', destination: payload.destination });

    for (const event of payload.events ?? []) {
      try {
        const envelope = buildLineBufferEnvelope(event, messagingChannelId, this.config.lineAiDraftEditEnabled);
        if (envelope) await this.messageBuffer.enqueue(envelope);
      } catch (err) {
        this.logger.error({ msg: 'LINE webhook enqueue error', error: (err as Error).message });
        // Do not acknowledge an event that never reached the buffer. A non-2xx
        // response asks LINE to redeliver instead of losing the message.
        throw err;
      }
    }

    return {};
  }
}
