import { createHash } from 'node:crypto';
import { parseAiBudgetGrantV2, parseLineAiInputEvidence, type LineAiTurnRequest } from '@watchdog-bms/contracts';
import { lineConversationId } from './line-conversation-context.service';
import { deliveryHash } from '../domain/logic/line-delivery-plan.logic';

export type AcceptedLedgerRequestInput = { request: LineAiTurnRequest; ownerEpoch: number; conversationId: string; accessFingerprint: string };
export type AcceptedLedgerRequest = AcceptedLedgerRequestInput & { version: 2; deliveryId: string; chatKeyHash: string; channelId: string; digest: string };
export type AcceptedLedgerScope = { companyId: string; userId: string; webhookEventId: string; turnId: string; chatKey: string; messagingChannelId: string };
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Persisted before Redis enqueue. This is evidence, never permission or delegation authority. */
export function freezeAcceptedLedgerRequest(input: AcceptedLedgerRequestInput, scope: AcceptedLedgerScope): AcceptedLedgerRequest {
  const request = JSON.parse(JSON.stringify(input.request)) as LineAiTurnRequest;
  delete request.actorDelegations;
  request.userContext.lineUserId = '[REDACTED]';
  const evidence = parseLineAiInputEvidence(request.inputEvidence, request.messageText);
  const grant = parseAiBudgetGrantV2(request.budgetGrantV2);
  if (!evidence || evidence.parts.some(part => sha256(part.rawText) !== part.rawSha256) || sha256(evidence.parts.map(part => part.rawText).join('\n')) !== evidence.joinedSha256 || !grant
    || grant.turnKey !== evidence.turnKey || grant.payerCompanyId !== scope.companyId
    || request.userContext.companyId !== scope.companyId || request.userContext.internalUserId !== scope.userId
    || request.webhookEventId !== scope.webhookEventId || request.requestId !== scope.turnId
    || !request.userContext.membershipId || !Number.isSafeInteger(input.ownerEpoch) || input.ownerEpoch < 0
    || typeof input.accessFingerprint !== 'string' || !input.accessFingerprint || input.accessFingerprint.length > 32768) throw new Error('LINE_LEDGER_INVALID_ACCEPTED_REQUEST');
  const chatKeyHash = sha256(scope.chatKey).slice(0, 16);
  const conversationId = lineConversationId({ companyId: scope.companyId, userId: scope.userId, membershipId: request.userContext.membershipId,
    channel: 'line', channelKind: 'USER', messagingChannelId: scope.messagingChannelId, chatKeyHash });
  if (conversationId !== input.conversationId) throw new Error('LINE_LEDGER_INVALID_ACCEPTED_OWNER');
  const deliveryId = deliveryHash(['line-ledger-v2', scope.companyId, scope.userId, scope.messagingChannelId, chatKeyHash, scope.webhookEventId, scope.turnId]);
  const frozen = { version: 2 as const, request, ownerEpoch: input.ownerEpoch, conversationId, accessFingerprint: input.accessFingerprint,
    deliveryId, chatKeyHash, channelId: scope.messagingChannelId };
  if (Buffer.byteLength(JSON.stringify(frozen), 'utf8') > 128 * 1024) throw new Error('LINE_LEDGER_ACCEPTED_REQUEST_TOO_LARGE');
  return { ...frozen, digest: deliveryHash(frozen) };
}

export function parseAcceptedLedgerRequest(value: unknown, scope: AcceptedLedgerScope): AcceptedLedgerRequest | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as AcceptedLedgerRequest;
    if (raw.version !== 2 || raw.request?.actorDelegations) return null;
    const frozen = freezeAcceptedLedgerRequest(raw, scope);
    return frozen.digest === raw.digest && frozen.deliveryId === raw.deliveryId && frozen.channelId === raw.channelId && frozen.chatKeyHash === raw.chatKeyHash ? frozen : null;
  } catch { return null; }
}
