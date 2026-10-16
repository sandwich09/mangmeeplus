import type { LinePaymentEvidenceResult } from '../../../expenses/application/use-cases/link-line-payment-evidence.use-case';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { scrubRecordIdentifier } from '@watchdog-bms/contracts';

const CONTROL_PREFIX = '__line_payment_evidence__:';
type EvidenceControl = { operation: 'link' | 'new' | 'undo' | 'page'; page?: string; slipId: string; receiptId?: string; operationId?: string };

export function parseLinePaymentEvidenceControl(text: string): EvidenceControl | null {
  if (!text.startsWith(CONTROL_PREFIX) || text.length > 600) return null;
  const params = new URLSearchParams(text.slice(CONTROL_PREFIX.length));
  if (params.get('action') !== 'payment-evidence') return null;
  const operation = params.get('operation'), slipId = params.get('slipId');
  const keys = operation === 'link' ? ['action', 'operation', 'slipId', 'receiptId']
    : operation === 'undo' ? ['action', 'operation', 'slipId', 'operationId']
      : operation === 'page' ? ['action', 'operation', 'slipId', 'page'] : ['action', 'operation', 'slipId'];
  if (!['link', 'new', 'undo', 'page'].includes(operation ?? '') || [...params.keys()].length !== keys.length
    || keys.some(key => params.getAll(key).length !== 1) || !slipId
    || operation === 'page' && !/^\d{1,4}$/u.test(params.get('page') ?? '')
    || keys.filter(key => key.endsWith('Id')).some(key => !/^[\w-]{1,200}$/u.test(params.get(key) ?? ''))) return null;
  return { operation: operation as EvidenceControl['operation'], slipId,
    ...(operation === 'link' ? { receiptId: params.get('receiptId')! } : {}),
    ...(operation === 'undo' ? { operationId: params.get('operationId')! } : {}),
    ...(operation === 'page' ? { page: params.get('page')! } : {}) };
}

export function linePaymentEvidencePostbackCommand(data: string | undefined): string | null {
  const text = CONTROL_PREFIX + (data ?? '');
  return parseLinePaymentEvidenceControl(text) ? text : null;
}

function action(label: string, control: EvidenceControl) {
  return { type: 'postback' as const, label, displayText: label,
    data: new URLSearchParams({ action: 'payment-evidence', ...control }).toString() };
}

export function linePaymentEvidenceReply(result: LinePaymentEvidenceResult, requestedPage = 0): LineReplyMessage | null {
  if (result.kind === 'NONE') return null;
  if (result.kind === 'LINKED') return { type: 'text', text: 'แนบสลิปเป็นหลักฐานการจ่ายของใบเสร็จแล้วค่ะ',
    quickReply: { items: [{ type: 'action', action: action('แยกเป็นรายการใหม่', { operation: 'undo', slipId: result.slipId, operationId: result.operationId }) }] } };
  const question = 'สลิปนี้เป็นหลักฐานการจ่ายของรายการไหนคะ';
  const page = paymentEvidencePage(result, requestedPage);
  const buttons = result.candidates.slice(page * 4, page * 4 + 4).map(candidate => {
    const day = candidate.documentDay ? candidate.documentDay.split('-').reverse().join('/') : 'ไม่ทราบวันที่';
    const vendor = (scrubRecordIdentifier(candidate.vendorName ?? 'ไม่ทราบร้าน') ?? 'ไม่ทราบร้าน').slice(0, 12);
    const label = `${vendor} ${candidate.amount.replace(/(\.\d{2})0+$/u, '$1')} ${day}`;
    return { type: 'button', style: 'secondary', height: 'sm', action: action(label.slice(0, 40), { operation: 'link', slipId: result.slipId, receiptId: candidate.id }) };
  });
  buttons.push({ type: 'button', style: 'secondary', height: 'sm', action: action('เป็นรายการใหม่', { operation: 'new', slipId: result.slipId }) });
  for (const [label, target] of [['รายการก่อนหน้า', page - 1], ['รายการถัดไป', page + 1]] as const) {
    if (target >= 0 && target * 4 < result.candidates.length) buttons.push({ type: 'button', style: 'secondary', height: 'sm',
      action: action(label, { operation: 'page', slipId: result.slipId, page: String(target) }) });
  }
  const bubbles = [];
  for (let index = 0; index < buttons.length; index += 12) bubbles.push({ type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'sm',
    contents: [{ type: 'text', text: question, wrap: true }, ...buttons.slice(index, index + 12)] } });
  const text = [question, ...buttons.map(button => button.action.label)].join('\n');
  return { type: 'flex', altText: question, canonicalText: text, contents: bubbles.length === 1 ? bubbles[0]! : { type: 'carousel', contents: bubbles } };
}

export function paymentEvidencePage(result: Extract<LinePaymentEvidenceResult, { kind: 'ASK' }>, requested: number): number {
  return Math.max(0, Math.min(Math.floor(Number.isFinite(requested) ? requested : 0), Math.ceil(result.candidates.length / 4) - 1));
}
