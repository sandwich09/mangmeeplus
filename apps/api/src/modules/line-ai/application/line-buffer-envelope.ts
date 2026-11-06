import { parseLineFixedReadControl } from '../domain/logic/line-staff-menu.logic';
import { LINE_WORKFLOW_IDS } from '@watchdog-bms/contracts';
import { parseLineWorkflowControl } from '../domain/logic/line-reimbursement-approval-control.logic';
import { lineControlLanguage } from '../domain/logic/line-language.logic';
import { parseCounterpartyControl } from './line-counterparty.service';
import { parsePackagePurchaseControl } from './line-package-purchase.service';
import { parseExpenseActionControl } from './line-expense-action.service';
import { parseLineReimbursementDraftControl, parseLineReimbursementChoiceControl } from './line-reimbursement-draft.service';
import { parseLineAnswerDeliveryControl } from '../domain/logic/line-delivery-plan.logic';
import type { LineBufferEnvelope } from './line-message-buffer.service';
import { LINE_FOLLOW_EVENT_TEXT, lineDraftUpdatePostbackPreviewId, linePostbackCommandText } from '../domain/logic/line-staff-menu.logic';

export type LineMessageEvent = {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  timestamp?: number;
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
  message?: { quotedMessageId?: string; id?: string; type?: string; text?: string; fileName?: string; fileSize?: number };
  postback?: { data?: string };
};

/** Shared webhook and virtual-channel mapping; controls are parsed only here. */
export function buildLineBufferEnvelope(event: LineMessageEvent, messagingChannelId: string, draftEditEnabled: boolean): LineBufferEnvelope | null {
  if (!event.replyToken || !event.source?.userId) return null;
  const lineUserId = event.source.userId;
  const chatId = event.source.groupId ?? event.source.roomId ?? lineUserId;
  const channelKind = event.source.type === 'group' ? 'GROUP' as const : event.source.type === 'room' ? 'ROOM' as const : 'USER' as const;
  const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
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
    || params.get('action') === 'chat-action' && LINE_WORKFLOW_IDS.some(id => id === params.get('id')) && !exactId)) return null;
  const counterpartyControl = event.type === 'postback' ? parseCounterpartyControl(postbackData) : null;
  const packagePurchaseControl = event.type === 'postback' ? parsePackagePurchaseControl(postbackData) : null;
  const expenseActionControl = event.type === 'postback' ? parseExpenseActionControl(postbackData) : null;
  const reimbursementChoiceControl = event.type === 'postback' ? parseLineReimbursementChoiceControl(postbackData) : null;
  const reimbursementDraftControl = event.type === 'postback' ? parseLineReimbursementDraftControl(postbackData) : null;
  const answerDeliveryControl = event.type === 'postback' ? parseLineAnswerDeliveryControl(postbackData) : null;
  const synthetic = workflowControl ? 'เลือกงานจากการ์ด' : workflowStart ? linePostbackCommandText(postbackData, draftEditEnabled) ?? 'เริ่มงานจากเมนู' : fixedReadControl ? 'ดูค่าใช้จ่ายเดือนนี้' : reimbursementChoiceControl ? reimbursementChoiceControl.choice === 'photo' ? 'ส่งรูปใบเสร็จสำหรับใบเบิกนี้' : reimbursementChoiceControl.choice === 'no-receipt' ? 'ไม่มีใบเสร็จ ขอเบิกรายการใหม่นี้' : 'เลือกหมวดค่าใช้จ่ายสำหรับใบเบิกนี้' : counterpartyControl ? 'ตรวจข้อมูลคู่ค้า' : packagePurchaseControl ? 'ตรวจลิงก์จ่ายแพ็กเกจ' : expenseActionControl ? 'ตรวจผลรายการค่าใช้จ่าย' : reimbursementDraftControl ? 'ตรวจผลร่างใบเบิก' : answerDeliveryControl ? answerDeliveryControl.action === 'continue' ? 'อ่านคำตอบต่อ' : 'ยกเลิกการส่งคำตอบ' : event.type === 'follow'
    ? LINE_FOLLOW_EVENT_TEXT
    : event.type === 'postback'
      ? linePostbackCommandText(postbackData, draftEditEnabled)
      : null;
  const draftUpdatePreviewId = event.type === 'postback'
    ? lineDraftUpdatePostbackPreviewId(postbackData, synthetic)
    : undefined;
  if (synthetic) {
    return {
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
    };
  } else if (event.type === 'message' && event.message?.type === 'text' && event.message.text) {
    return {
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
    };
  } else if (event.type === 'message' && (event.message?.type === 'image' || event.message?.type === 'file') && event.message.id) {
    return {
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
    };
  }

  return null;
}
