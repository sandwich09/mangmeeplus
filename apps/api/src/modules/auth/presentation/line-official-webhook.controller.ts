import { BadGatewayException, Controller, HttpCode, Logger, NotFoundException, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../../common/config/app-config.service';
import { Public } from '../../../common/security/public.decorator';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../common/logger/security-event';
import { officialOaReplyForText } from '../domain/logic/line-official-menu.logic';
import { verifyLineWebhookSignature } from '../infrastructure/line-webhook-verifier';

type OfficialEvent = {
  type?: string;
  replyToken?: string;
  source?: { type?: string };
  message?: { type?: string; text?: string };
};
type OfficialRequest = Request & { rawBody?: Buffer };

@Controller('line/official')
export class LineOfficialWebhookController {
  private readonly logger = new Logger(LineOfficialWebhookController.name);
  constructor(private readonly config: AppConfigService) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: OfficialRequest): Promise<Record<string, never>> {
    if (!this.config.lineOfficialReplyEnabled) throw new NotFoundException();
    const signature = req.headers['x-line-signature'];
    const secret = this.config.lineOfficialChannelSecret;
    const token = this.config.lineOfficialChannelAccessToken;
    if (typeof signature !== 'string' || !req.rawBody || !secret || !token ||
      !verifyLineWebhookSignature(req.rawBody, signature, secret)) {
      emitSecurityEvent(this.logger, SECURITY_EVENT.lineWebhookSignatureInvalid, 'HIGH', { channel: 'official' });
      throw new UnauthorizedException('Invalid LINE webhook signature.');
    }
    const events = (req.body as { events?: unknown })?.events;
    if (!Array.isArray(events)) return {};
    for (const event of events as OfficialEvent[]) {
      if (event?.type !== 'message' || event.source?.type !== 'user' ||
        event.message?.type !== 'text' || typeof event.message.text !== 'string' ||
        typeof event.replyToken !== 'string' || !event.replyToken) continue;
      const reply = officialOaReplyForText(event.message.text, this.config.webBaseUrl!);
      if (!reply) continue;
      try {
        // ponytail: single-use LINE reply tokens provide delivery idempotency; no ERP/AI state.
        const response = await fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ replyToken: event.replyToken, messages: [reply] }),
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) continue;
        if (response.status === 400 && /invalid reply token/i.test(await response.text())) continue;
        this.logger.error({ msg: 'line.official.reply_rejected', status: response.status });
      } catch {
        this.logger.error({ msg: 'line.official.reply_unavailable' });
      }
      throw new BadGatewayException('Official OA reply unavailable.');
    }
    return {};
  }
}
