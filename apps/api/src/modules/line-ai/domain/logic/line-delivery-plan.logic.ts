import { createHash } from 'node:crypto';
import { parseOutcomeMessages, type LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { isCompleteLineBusinessAnswerPresentation } from './line-business-card.logic';

export const LINE_DELIVERY_PLAN_VERSION = 2;
export const LINE_DELIVERY_PLAN_SENTINEL = [{ type: 'text' as const, text: 'ผลลัพธ์นี้ใช้การส่งรุ่นใหม่' }];
export type LineDeliveryProducer = 'WEBHOOK' | 'LEDGER' | 'CAPTURE_OUTBOX';
export type DeliveryItem = { id: string; kind: 'answer' | 'source' | 'business_result' | 'decision_diff' | 'limitation'; text: string; sourceProofIds: string[]; required: boolean };
export type DeliveryAuthorizationV2 = {
  v: 2; kind: 'PRIVATE'; actor: { userId: string; companyId: string; membershipId: string; requestId: string; accessFingerprint: string; channelId: string; channel: 'line'; channelKind: 'USER'; recipientHash: string; chatKeyHash: string; conversationId: string; ownerEpoch: number };
  issuedAt: string; expiresAt: string; proofs: Array<{ id: string; kind: string; [key: string]: unknown }>;
} | {
  v: 2; kind: 'PUBLIC_GENERAL'; admissionOwner: { kind: 'WEBHOOK' | 'LEDGER'; id: string; revision: number };
  destination: { channelId: string; channel: 'line'; channelKind: 'USER' | 'GROUP' | 'ROOM'; lineTargetId: string; targetHash: string; chatKeyHash: string };
  actorUserId: string | null; initiatorHash: string; admissionPolicyDigest: string; sourceManifestDigest: string; approvedPublicSourceIds: string[]; issuedAt: string; expiresAt: string;
};
export type DeliveryControlV2 = { kind: 'EXPENSE_EDIT_CONFIRM'; previewId: string; previewRevision: string; expiresAt: string; requiredItemIds: string[] }
  | { kind: 'REIMBURSEMENT_DRAFT_CONFIRM'; actionId: string; previewRevision: number; confirmationDigest: string; expiresAt: string; requiredItemIds: string[] };
export type FrozenRepresentation = { messages: LineReplyMessage[]; wireHash: string; pushRetryKey: string };
export type DeliveryPlanV2 = {
  v: 2; planId: string; producerKind: LineDeliveryProducer; producerId: string; createdAt: string; expiresAt: string; readyAt: string; firstDispatchDeadlineAt: string;
  answer: { status: 'COMPLETE' | 'PARTIAL'; pendingSubrequestIds: string[]; items: DeliveryItem[] };
  businessResult: null | { kind: 'EXPENSE_CAPTURE' | 'EXPENSE_EDIT' | 'SUBSTITUTE_PREPARE' | 'REIMBURSEMENT_DRAFT'; operationKey: string; committedAt: string; recordIds: string[]; resultingRevisions: string[] };
  authorization: DeliveryAuthorizationV2; control: DeliveryControlV2 | null;
  batches: Array<{ id: string; index: number; spans: Array<{ itemId: string; start: number; end: number; messageIndex: number }>; primary: FrozenRepresentation; fallback: FrozenRepresentation | null }>;
};
export type DeliveryBatchState = {
  batchId: string; variant: 'primary' | 'fallback'; status: 'READY' | 'UNKNOWN' | 'ACCEPTED' | 'REFUSED' | 'CANCELLED'; transport: null | 'REPLY' | 'PUSH'; replyAttempted: boolean; pushAttempts: number;
  firstAttemptAt: string | null; lastAttemptAt: string | null; acceptedAt: string | null; providerRequestId: string | null; lastErrorCode: string | null;
};
export function canonicalDeliveryJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
export const deliveryHash = (value: unknown) => createHash('sha256').update(canonicalDeliveryJson(value)).digest('hex');
export const lineDeliveryPlanId = (kind: LineDeliveryProducer, id: string) => deliveryHash(['line-delivery-v2', kind, id]);
export function lineDeliveryWireMessages(messages: LineReplyMessage[]): LineReplyMessage[] {
  return messages.map(message => {
    if (message.type !== 'flex') return message;
    const { canonicalText: _internal, ...wire } = message;
    return wire;
  });
}
export function lineDeliveryRetryKey(planId: string, index: number, variant: 'primary' | 'fallback', wireHash: string): string {
  const bytes = createHash('sha256').update(canonicalDeliveryJson(['line-delivery-v2', planId, index, variant, wireHash])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function fail(code: string): never { throw new Error(code); }
function date(value: string): number { const n = Date.parse(value); return Number.isFinite(n) ? n : fail('PLAN_INVALID_DATE'); }
const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
/** Exact UTF-16 offsets; URLs and graphemes are indivisible. No normalization or truncation. */
export function splitLineDeliveryText(text: string, limit = 4_800): Array<{ text: string; start: number; end: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5_000) fail('PLAN_INVALID_TEXT_LIMIT');
  const urls = [...text.matchAll(/https?:\/\/[^\s]+/gu)].map(m => ({ start: m.index!, end: m.index! + m[0].length }));
  if (urls.some(u => u.end - u.start > limit)) fail('PLAN_INDIVISIBLE_TEXT_TOO_LARGE');
  const boundaries = [...segmenter.segment(text)].map(s => s.index + s.segment.length).filter(end => !urls.some(u => end > u.start && end < u.end));
  const parts: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  while (start < text.length) {
    const available = boundaries.filter(end => end > start && end <= start + limit);
    if (!available.length) fail('PLAN_INDIVISIBLE_TEXT_TOO_LARGE');
    let end = available[available.length - 1]!;
    if (end < text.length) {
      const newline = available.filter(n => n >= start + limit / 2 && text[n - 1] === '\n').at(-1);
      if (newline) end = newline;
    }
    parts.push({ text: text.slice(start, end), start, end }); start = end;
  }
  return parts;
}
function destination(auth: DeliveryAuthorizationV2): [string, string] {
  return auth.kind === 'PRIVATE' ? [auth.actor.channelId, auth.actor.recipientHash] : [auth.destination.channelId, auth.destination.targetHash];
}
function freeze(planId: string, index: number, messages: LineReplyMessage[], auth: DeliveryAuthorizationV2, variant: 'primary' | 'fallback'): FrozenRepresentation {
  const wire = lineDeliveryWireMessages(messages);
  if (!parseOutcomeMessages(wire)) fail('PLAN_INVALID_WIRE');
  const wireHash = deliveryHash([...destination(auth), wire]);
  return { messages: wire, wireHash, pushRetryKey: lineDeliveryRetryKey(planId, index, variant, wireHash) };
}
function controlActions(message: LineReplyMessage): Array<{ type: 'postback'; label: string; data: string }> {
  const found: Array<{ type: 'postback'; label: string; data: string }> = [];
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 20) return;
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    const raw = value as Record<string, unknown>;
    if (raw.type === 'postback' && typeof raw.label === 'string' && typeof raw.data === 'string') found.push({ type: 'postback', label: raw.label, data: raw.data });
    else for (const child of Object.values(raw)) visit(child, depth + 1);
  };
  visit(message, 0); return found;
}
function matchingControl(message: LineReplyMessage, control: DeliveryControlV2): boolean {
  return controlActions(message).some(action => {
    const p = new URLSearchParams(action.data);
    if (control.kind === 'EXPENSE_EDIT_CONFIRM') return p.get('action') === 'draft-update-confirm' && p.get('previewId') === control.previewId;
    return p.get('action') === 'reimbursement_draft_confirm' && p.get('actionId') === control.actionId
      && p.get('previewRevision') === String(control.previewRevision) && p.get('confirmationDigest') === control.confirmationDigest;
  });
}
export function buildLineDeliveryPlan(input: Omit<DeliveryPlanV2, 'v' | 'planId' | 'batches' | 'answer'> & {
  answer: Omit<DeliveryPlanV2['answer'], 'items'> & { items: Array<Omit<DeliveryItem, 'id'>> };
  preferredMessages?: Array<LineReplyMessage | null>;
  controlMessage?: LineReplyMessage;
}): DeliveryPlanV2 {
  const { controlMessage, preferredMessages, ...base } = input;
  const planId = lineDeliveryPlanId(input.producerKind, input.producerId);
  const items = input.answer.items.map((item, i) => ({ ...item, id: `${planId}:item:${i}` }));
  if (preferredMessages && preferredMessages.length !== items.length) fail('PLAN_INVALID_PRESENTATION');
  const all: Array<{ primary: LineReplyMessage; fallback?: LineReplyMessage; span?: DeliveryPlanV2['batches'][number]['spans'][number] }> = [];
  for (const [i, item] of items.entries()) {
    const parts = splitLineDeliveryText(item.text), preferred = preferredMessages?.[i] ?? null;
    const matches = preferred?.type === 'text' ? preferred.text === item.text : preferred?.type === 'flex' ? preferred.canonicalText === item.text : false;
    const quickReply = matches && preferred && controlActions(preferred).length === 0 ? preferred.quickReply : undefined;
    if (preferred?.type === 'flex' && matches && isCompleteLineBusinessAnswerPresentation(preferred)
      && parts.length === 1 && controlActions(preferred).length === 0
      && parseOutcomeMessages(lineDeliveryWireMessages([preferred]))) {
      const part = parts[0]!;
      all.push({ primary: preferred, fallback: { type: 'text', text: part.text, ...(quickReply ? { quickReply } : {}) },
        span: { itemId: item.id, start: part.start, end: part.end, messageIndex: 0 } });
      continue;
    }
    for (const [partIndex, part] of parts.entries()) all.push({
      primary: { type: 'text', text: part.text, ...(partIndex === parts.length - 1 && quickReply ? { quickReply } : {}) },
      span: { itemId: item.id, start: part.start, end: part.end, messageIndex: 0 },
    });
  }
  if (!!input.control !== !!controlMessage) fail('PLAN_CONTROL_MISSING');
  if (controlMessage) all.push({ primary: controlMessage, fallback: { type: 'text', text: 'ตรวจสอบรายละเอียดทั้งหมดด้านบนก่อนยืนยัน',
    quickReply: { items: controlActions(controlMessage).map(action => ({ type: 'action' as const, action })) } } });
  if (!all.length || all.length > 15) fail('PLAN_TOO_LARGE');
  const batches: DeliveryPlanV2['batches'] = [];
  for (let offset = 0; offset < all.length; offset += 5) {
    const index = batches.length, part = all.slice(offset, offset + 5);
    const messages = part.map(p => p.primary);
    const fallbackMessages = part.some(p => p.fallback) ? part.map(p => p.fallback ?? p.primary) : null;
    if (all.length > 10 && index === 1) {
      const quickReply = { items: [{ type: 'action' as const, action: { type: 'postback' as const, label: 'ยังมีคำตอบต่อ · อ่านต่อ', data: `action=line_answer_continue&plan=${planId}&next=2` } }] };
      messages[messages.length - 1] = { ...messages[messages.length - 1]!, quickReply };
      if (fallbackMessages) fallbackMessages[fallbackMessages.length - 1] = { ...fallbackMessages[fallbackMessages.length - 1]!, quickReply };
    }
    batches.push({ id: `${planId}:batch:${index}`, index, spans: part.flatMap((p, messageIndex) => p.span ? [{ ...p.span, messageIndex }] : []), primary: freeze(planId, index, messages, input.authorization, 'primary'), fallback: fallbackMessages ? freeze(planId, index, fallbackMessages, input.authorization, 'fallback') : null });
  }
  const plan: DeliveryPlanV2 = { ...base, v: 2, planId, answer: { ...input.answer, items }, batches };
  validateLineDeliveryPlan(plan);
  return plan;
}
export function validateLineDeliveryPlan(plan: DeliveryPlanV2): void {
  if (!plan || plan.v !== 2 || !['WEBHOOK', 'LEDGER', 'CAPTURE_OUTBOX'].includes(plan.producerKind) || typeof plan.producerId !== 'string' || !plan.producerId.length || plan.producerId.length > 200 || plan.planId !== lineDeliveryPlanId(plan.producerKind, plan.producerId)) fail('PLAN_INVALID_ID');
  const created = date(plan.createdAt), expiry = date(plan.expiresAt), ready = date(plan.readyAt), deadline = date(plan.firstDispatchDeadlineAt);
  if (expiry <= created || ready < created || deadline < ready || expiry > date(plan.authorization.expiresAt) || expiry > created + (plan.producerKind === 'LEDGER' ? 15 : 60) * 60_000) fail('PLAN_INVALID_LIFETIME');
  if (plan.authorization.v !== 2 || !['PRIVATE', 'PUBLIC_GENERAL'].includes(plan.authorization.kind)) fail('PLAN_INVALID_AUTH');
  if (plan.authorization.kind === 'PRIVATE') {
    const a = plan.authorization.actor;
    if (a.channel !== 'line' || a.channelKind !== 'USER' || !Number.isSafeInteger(a.ownerEpoch) || a.ownerEpoch < 0 || !a.conversationId.startsWith('line-v2:') || !a.membershipId || !a.channelId || !a.userId || !a.companyId || !a.chatKeyHash || !a.recipientHash || a.accessFingerprint.length > 32768 || plan.authorization.proofs.length > 16) fail('PLAN_INVALID_AUTH');
  } else {
    const a = plan.authorization;
    if (plan.control || plan.businessResult || plan.producerKind === 'CAPTURE_OUTBOX' || a.admissionOwner.id !== plan.producerId || a.admissionOwner.kind !== plan.producerKind || a.destination.channel !== 'line' || !a.destination.channelId || !a.destination.lineTargetId || !a.destination.targetHash || !a.destination.chatKeyHash || a.approvedPublicSourceIds.length > 64) fail('PLAN_PUBLIC_PRIVATE_MIX');
  }
  if (!Array.isArray(plan.answer.items) || !plan.answer.items.length || plan.answer.items.length > 64 || plan.answer.items.reduce((n, x) => n + x.text.length, 0) > 60_000) fail('PLAN_TOO_LARGE');
  if (!['COMPLETE', 'PARTIAL'].includes(plan.answer.status) || (plan.answer.status === 'PARTIAL' && (!plan.answer.pendingSubrequestIds.length || !plan.answer.items.some(x => x.kind === 'limitation' && x.text.length)))) fail('PLAN_INCOMPLETE_COVERAGE');
  if (!plan.batches.length || plan.batches.length > 3) fail('PLAN_TOO_LARGE');
  const covered = new Map<string, string>();
  const proofIds = new Set(plan.authorization.kind === 'PRIVATE' ? plan.authorization.proofs.map(p => p.id) : plan.authorization.approvedPublicSourceIds);
  if (proofIds.size > 64) fail('PLAN_TOO_LARGE');
  for (const [i, item] of plan.answer.items.entries()) {
    if (item.id !== `${plan.planId}:item:${i}` || !item.text.length || !['answer', 'source', 'business_result', 'decision_diff', 'limitation'].includes(item.kind) || item.sourceProofIds.some(id => !proofIds.has(id))) fail('PLAN_INVALID_ITEM');
    covered.set(item.id, '');
  }
  for (const [i, batch] of plan.batches.entries()) {
    if (batch.index !== i || batch.id !== `${plan.planId}:batch:${i}`) fail('PLAN_INVALID_BATCH');
    for (const variant of ['primary', 'fallback'] as const) {
      const frozen = batch[variant]; if (!frozen) continue;
      if (!parseOutcomeMessages(frozen.messages) || frozen.messages.some(m => m.type === 'flex' && m.canonicalText !== undefined) || frozen.wireHash !== deliveryHash([...destination(plan.authorization), frozen.messages]) || frozen.pushRetryKey !== lineDeliveryRetryKey(plan.planId, i, variant, frozen.wireHash)) fail('PLAN_INVALID_WIRE');
      if (variant === 'fallback' && frozen.messages.length !== batch.primary.messages.length) fail('PLAN_INVALID_FALLBACK');
    }
    for (const span of batch.spans) {
      const item = plan.answer.items.find(x => x.id === span.itemId), prior = covered.get(span.itemId);
      if (!item || prior === undefined || span.start !== prior.length || !Number.isSafeInteger(span.end) || span.end <= span.start || span.end > item.text.length) fail('PLAN_INCOMPLETE_COVERAGE');
      const expected = item.text.slice(span.start, span.end), message = batch.primary.messages[span.messageIndex], fallback = batch.fallback?.messages[span.messageIndex];
      if (!message || message.type === 'image' || (message.type === 'text' ? message.text !== expected : fallback?.type !== 'text' || fallback.text !== expected)
        || ![...segmenter.segment(item.text)].some(s => s.index + s.segment.length === span.end)) fail('PLAN_INCOMPLETE_COVERAGE');
      if (batch.fallback && (fallback?.type !== 'text' || fallback.text !== expected)) fail('PLAN_INVALID_FALLBACK');
      covered.set(item.id, prior + expected);
    }
  }
  if (plan.answer.items.some(item => covered.get(item.id) !== item.text)) fail('PLAN_INCOMPLETE_COVERAGE');
  if (plan.control && (date(plan.control.expiresAt) < ready || !plan.control.requiredItemIds.length || new Set(plan.control.requiredItemIds).size !== plan.control.requiredItemIds.length
    || plan.control.requiredItemIds.some(id => !covered.has(id)) || plan.answer.items.some(item => item.required && !plan.control!.requiredItemIds.includes(item.id)))) fail('PLAN_INVALID_CONTROL');
  const lastBatch = plan.batches.at(-1)!;
  for (const batch of plan.batches) {
    const spanIndexes = new Set(batch.spans.map(span => span.messageIndex));
    if (spanIndexes.size !== batch.spans.length) fail('PLAN_DUPLICATE_MESSAGE_COVERAGE');
    for (let j = 0; j < batch.primary.messages.length; j++) {
      const terminalControl = !!plan.control && batch === lastBatch && j === batch.primary.messages.length - 1;
      if (terminalControl) {
        if (spanIndexes.has(j) || !matchingControl(batch.primary.messages[j]!, plan.control!) || (batch.fallback && !matchingControl(batch.fallback.messages[j]!, plan.control!))) fail('PLAN_INVALID_CONTROL');
      } else if (!spanIndexes.has(j) || (plan.control && matchingControl(batch.primary.messages[j]!, plan.control))) fail('PLAN_UNCOVERED_MESSAGE');
    }
  }
  if (plan.control?.kind === 'REIMBURSEMENT_DRAFT_CONFIRM' && (plan.batches.length !== 1 || plan.batches[0]!.primary.messages.some(m => m.type === 'text' && m.text.length > 4500))) fail('PLAN_PREVIEW_REQUIRES_WEB');
  if (Buffer.byteLength(canonicalDeliveryJson(plan), 'utf8') > 256 * 1024) fail('PLAN_TOO_LARGE');
}
export function parseLineDeliveryPlan(value: unknown): DeliveryPlanV2 | null {
  try { validateLineDeliveryPlan(value as DeliveryPlanV2); return value as DeliveryPlanV2; } catch { return null; }
}
export function initialDeliveryBatchStates(plan: DeliveryPlanV2): DeliveryBatchState[] {
  return plan.batches.map(b => ({ batchId: b.id, variant: 'primary', status: 'READY', transport: null, replyAttempted: false, pushAttempts: 0, firstAttemptAt: null, lastAttemptAt: null, acceptedAt: null, providerRequestId: null, lastErrorCode: null }));
}
export function parseDeliveryBatchStates(value: unknown, plan: DeliveryPlanV2): DeliveryBatchState[] | null {
  if (!Array.isArray(value) || value.length !== plan.batches.length) return null;
  let unaccepted = false;
  for (const [i, s] of value.entries()) {
    if (!s || s.batchId !== plan.batches[i]?.id || !['primary', 'fallback'].includes(s.variant) || (s.variant === 'fallback' && !plan.batches[i]?.fallback) || !['READY', 'UNKNOWN', 'ACCEPTED', 'REFUSED', 'CANCELLED'].includes(s.status) || ![null, 'REPLY', 'PUSH'].includes(s.transport) || typeof s.replyAttempted !== 'boolean' || !Number.isInteger(s.pushAttempts) || s.pushAttempts < 0 || s.pushAttempts > 5) return null;
    if (s.status === 'ACCEPTED' && unaccepted) return null;
    if (s.status !== 'ACCEPTED') unaccepted = true;
    if (s.status === 'ACCEPTED' && !Number.isFinite(Date.parse(s.acceptedAt))) return null;
  }
  return value as DeliveryBatchState[];
}

export type LineAnswerDeliveryControl = { action: 'continue'; planId: string; next: 2 } | { action: 'cancel'; planId: string };
export function parseLineAnswerDeliveryControl(data: string | undefined): LineAnswerDeliveryControl | null {
  if (!data || data.length > 180) return null;
  const params = new URLSearchParams(data), action = params.get('action'), planId = params.get('plan');
  if (!planId || !/^[0-9a-f]{64}$/.test(planId) || [...params.keys()].some(k => !['action', 'plan', 'next'].includes(k)) || ['action', 'plan', 'next'].some(k => params.getAll(k).length > 1)) return null;
  if (action === 'line_answer_continue' && params.get('next') === '2') return { action: 'continue', planId, next: 2 };
  if (action === 'line_answer_cancel' && !params.has('next')) return { action: 'cancel', planId };
  return null;
}
