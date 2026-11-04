import { parseLineFixedReadControl } from '../../line-ai/domain/logic/line-staff-menu.logic';
import { LINE_WORKFLOW_IDS } from '@watchdog-bms/contracts';
import { parseLineWorkflowControl } from '../../line-ai/domain/logic/line-reimbursement-approval-control.logic';
import { lineControlLanguage } from '../../line-ai/domain/logic/line-language.logic';
import { parseCounterpartyControl } from '../../line-ai/application/line-counterparty.service';
import { parsePackagePurchaseControl } from '../../line-ai/application/line-package-purchase.service';
import { parseExpenseActionControl } from '../../line-ai/application/line-expense-action.service';
import { parseLineReimbursementDraftControl, parseLineReimbursementChoiceControl } from '../../line-ai/application/line-reimbursement-draft.service';
import { parseLineAnswerDeliveryControl } from '../../line-ai/domain/logic/line-delivery-plan.logic';
import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
import { Controller, HttpCode, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/security/public.decorator';
import { AppConfigService } from '../../../common/config/app-config.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../common/logger/security-event';
import { verifyLineWebhookSignature } from '../infrastructure/line-webhook-verifier';
import { LineMessageBufferService } from '../../line-ai/application/line-message-buffer.service';
import { LINE_FOLLOW_EVENT_TEXT, lineDraftUpdatePostbackPreviewId, linePostbackCommandText } from '../../line-ai/domain/logic/line-staff-menu.logic';

type LineMessageEvent = {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  timestamp?: number;
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
  message?: { quotedMessageId?: string; id?: string; type?: string; text?: string; fileName?: string; fileSize?: number };
  postback?: { data?: string };
};

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
      if (!event.replyToken || !event.source?.userId) continue;
      const lineUserId = event.source.userId;
      const chatId = event.source.groupId ?? event.source.roomId ?? lineUserId;
      const channelKind = event.source.type === 'group' ? 'GROUP' as const : event.source.type === 'room' ? 'ROOM' as const : 'USER' as const;
      const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
      try {
        const controlLanguage = lineControlLanguage(event.type === 'postback' ? event.postback?.data : undefined);
        const postbackData = controlLanguage.data;
        // P10-L G-03: adding the friend has a reply token and used to match no arm at all, so with
        // the OA's own Greeting switched off a new customer got silence. A synthetic item carries
        // it into the same lane a typed message uses, where §3.1 decides door card or status card.
        const params = new URLSearchParams(postbackData);
        const exactId = [...params.keys()].length === 2 && params.getAll('action').length === 1 && params.getAll('id').length === 1;
        const workflowControl = event.type === 'postback' ? parseLineWorkflowControl(postbackData) : null;
        const workflowStart = event.type === 'postback' && exactId && params.get('action') === 'chat-action'
          ? LINE_WORKFLOW_IDS.find(id => id === params.get('id')) : undefined;
        const fixedReadControl = event.type === 'postback' ? parseLineFixedReadControl(postbackData) : null;
        if (event.type === 'postback' && (['wf_open', 'wf_choice'].includes(params.get('action') ?? '') && !workflowControl
          || params.get('action') === 'fixed-read' && !fixedReadControl
          || params.get('action') === 'chat-action' && LINE_WORKFLOW_IDS.some(id => id === params.get('id')) && !exactId)) continue;
        const counterpartyControl = event.type === 'postback' ? parseCounterpartyControl(postbackData) : null;
        const packagePurchaseControl = event.type === 'postback' ? parsePackagePurchaseControl(postbackData) : null;
        const expenseActionControl = event.type === 'postback' ? parseExpenseActionControl(postbackData) : null;
        const reimbursementChoiceControl = event.type === 'postback' ? parseLineReimbursementChoiceControl(postbackData) : null;
        const reimbursementDraftControl = event.type === 'postback' ? parseLineReimbursementDraftControl(postbackData) : null;
        const answerDeliveryControl = event.type === 'postback' ? parseLineAnswerDeliveryControl(postbackData) : null;
        const synthetic = workflowControl ? 'เลือกงานจากการ์ด' : workflowStart ? linePostbackCommandText(postbackData, this.config.lineAiDraftEditEnabled) ?? 'เริ่มงานจากเมนู' : fixedReadControl ? 'ดูค่าใช้จ่ายเดือนนี้' : reimbursementChoiceControl ? reimbursementChoiceControl.choice === 'photo' ? 'ส่งรูปใบเสร็จสำหรับใบเบิกนี้' : reimbursementChoiceControl.choice === 'no-receipt' ? 'ไม่มีใบเสร็จ ขอเบิกรายการใหม่นี้' : 'เลือกหมวดค่าใช้จ่ายสำหรับใบเบิกนี้' : counterpartyControl ? 'ตรวจข้อมูลคู่ค้า' : packagePurchaseControl ? 'ตรวจลิงก์จ่ายแพ็กเกจ' : expenseActionControl ? 'ตรวจผลรายการค่าใช้จ่าย' : reimbursementDraftControl ? 'ตรวจผลร่างใบเบิก' : answerDeliveryControl ? answerDeliveryControl.action === 'continue' ? 'อ่านคำตอบต่อ' : 'ยกเลิกการส่งคำตอบ' : event.type === 'follow'
          ? LINE_FOLLOW_EVENT_TEXT
          : event.type === 'postback'
            ? linePostbackCommandText(postbackData, this.config.lineAiDraftEditEnabled)
            : null;
        const draftUpdatePreviewId = event.type === 'postback'
          ? lineDraftUpdatePostbackPreviewId(postbackData, synthetic)
          : undefined;
        if (synthetic) {
          await this.messageBuffer.enqueue({
            chatId,
            channelKind,
            lineUserId,
            messagingChannelId,
            item: {
              kind: 'text',
              webhookEventId: event.webhookEventId ?? `${lineUserId}-${Date.now()}`,
              replyToken: event.replyToken,
              text: synthetic,
              ...(controlLanguage.language ? { language: controlLanguage.language } : {}),
              ...(workflowControl ? { workflowControl } : {}),
              ...(workflowStart ? { workflowStart } : {}),
              ...(fixedReadControl ? { fixedReadControl } : {}),
              ...(counterpartyControl ? { counterpartyControl } : {}),
              ...(expenseActionControl ? { expenseActionControl } : {}),
              ...(packagePurchaseControl ? { packagePurchaseControl } : {}),
              ...(draftUpdatePreviewId ? { draftUpdatePreviewId } : {}),
              ...(answerDeliveryControl ? { answerDeliveryControl } : {}),
              ...(reimbursementDraftControl ? { reimbursementDraftControl } : {}),
              ...(reimbursementChoiceControl ? { reimbursementChoiceControl } : {}),
              timestamp,
            },
          });
        } else if (event.type === 'message' && event.message?.type === 'text' && event.message.text) {
          await this.messageBuffer.enqueue({
            chatId,
            channelKind,
            lineUserId,
            messagingChannelId,
            item: {
              kind: 'text',
              webhookEventId: event.webhookEventId ?? `${lineUserId}-${Date.now()}`,
              replyToken: event.replyToken,
              text: event.message.text,
              quotedMessageId: typeof event.message.quotedMessageId === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(event.message.quotedMessageId) ? event.message.quotedMessageId : undefined,
              lineMessageId: event.message.id,
              timestamp,
            },
          });
        } else if (event.type === 'message' && (event.message?.type === 'image' || event.message?.type === 'file') && event.message.id) {
          await this.messageBuffer.enqueue({
            chatId,
            channelKind,
            lineUserId,
            messagingChannelId,
            item: {
              kind: 'media',
              webhookEventId: event.webhookEventId ?? `${lineUserId}-${event.message.id}`,
              replyToken: event.replyToken,
              lineMessageId: event.message.id,
              messageType: event.message.type,
              fileName: event.message.fileName,
              fileSize: event.message.fileSize,
              timestamp,
            },
          });
        }
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
