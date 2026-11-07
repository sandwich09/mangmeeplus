import { LINE_DELIVERY_PLAN_SENTINEL } from '../domain/logic/line-delivery-plan.logic';
import { lineCustomerVisibleText } from '../domain/logic/line-language.logic';
import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
/**
 * LINE reply adapter – sends reply/push messages via Messaging API.
 * Does not log access tokens or authorization headers.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isVirtualDemoTarget, withLineExternalBrowserLinks } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { storeDemoReply } from '../../sales-demo/application/demo-chat-sink';
import { AppConfigService } from '../../../common/config/app-config.service';
import { LINE_FLEX_PREVIEW_LIMIT, lineMessagePreview } from '../domain/logic/line-message-preview.logic';

type LineMessageAction = { type: 'message'; label: string; text: string };
type LinePostbackAction = { type: 'postback'; label: string; data: string; displayText?: string };
type LineCameraAction = { type: 'camera' | 'cameraRoll'; label: string };
export type LineQuickReplyItem = { type: 'action'; action: LineMessageAction | LineCameraAction | LinePostbackAction | { type: 'uri'; label: string; uri: string } };
export type LineReplyMessage = {
  quickReply?: { items: LineQuickReplyItem[] };
} & (
  | { type: 'text'; text: string }
  | { type: 'image'; originalContentUrl: string; previewImageUrl: string }
  | { type: 'flex'; altText: string; canonicalText?: string; contents: Record<string, unknown> }
);

/** Internal recovery text stays in the durable outcome, never in the LINE wire schema — and every
 *  web link leaves LINE's in-app browser (spec R-B1, Owner D-PF-2). Applied HERE, after
 *  `linePushRetryKey` was computed from the caller's payload and after `recordTurnOutcome` stored
 *  it, so the retry identity, the stored outcome and an orphan replay all keep the plain bytes;
 *  the rewrite is deterministic and idempotent, so first send and replay put identical bytes on the wire. */
function providerMessages(messages: LineReplyMessage[]): LineReplyMessage[] {
  return withLineExternalBrowserLinks(lineCustomerVisibleText(messages.map((message) => {
    if (message.type !== 'flex') return message;
    const { canonicalText: _canonicalText, ...providerMessage } = message;
    return providerMessage;
  })));
}

/** `failed_token` = LINE rejected the request (400): expired/used reply token
 *  or malformed message — the only class where a push fallback can still
 *  deliver. Other failures would fail the push the same way.
 *
 *  `failed_flex` narrows a 400 message BODY rejection containing Flex: formerly
 *  `failed_token` for replies and `failed_permanent` for pushes. A caller may
 *  resend the card's canonical text once; callers without that fallback must
 *  retain the corresponding old failure behavior. */
export type LineDeliveryResultV2 = { kind: 'accepted' | 'rejected' | 'unknown'; code: string; requestId?: string; sentMessageIds?: string[]; rejection?: 'TOKEN' | 'FLEX' | 'PERMANENT' };

export type LineDeliveryResult = 'ok' | 'failed_token' | 'failed_flex' | 'failed_other' | 'failed_permanent' | 'skipped';

/** Own data again, but a row rewritten by hand must not take the sweep down — and it must never be
 *  pushed half-formed, because these bytes go straight to a person's chat. */
export function parseOutcomeMessages(value: unknown): LineReplyMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return null;
  const messages = value as Array<Partial<LineReplyMessage>>;
  const imageUrl = (url: unknown) => typeof url === 'string' && url.length <= 2000
    && URL.canParse(url) && new URL(url).protocol === 'https:';
  const valid = messages.every((message) => (message?.type === 'text' && typeof (message as { text?: unknown }).text === 'string'
    && (message as { text: string }).text.length > 0 && (message as { text: string }).text.length <= 5000)
    || (message?.type === 'image' && imageUrl((message as { originalContentUrl?: unknown }).originalContentUrl)
      && imageUrl((message as { previewImageUrl?: unknown }).previewImageUrl))
    || (message?.type === 'flex' && typeof (message as { altText?: unknown }).altText === 'string'
      && (message as { altText: string }).altText.length > 0 && (message as { altText: string }).altText.length <= LINE_FLEX_PREVIEW_LIMIT
      && ((message as { canonicalText?: unknown }).canonicalText === undefined
        || (typeof (message as { canonicalText?: unknown }).canonicalText === 'string'
          && (message as { canonicalText: string }).canonicalText.length > 0
          && (message as { canonicalText: string }).canonicalText.length <= 5000))
      && !!(message as { contents?: unknown }).contents
      && typeof (message as { contents?: unknown }).contents === 'object'
      && !Array.isArray((message as { contents?: unknown }).contents)));
  return valid ? (value as LineReplyMessage[]) : null;
}

/** Only repair the old code-point/UTF-16 mismatch; leave all other validation fail-closed.
 * The caller must persist this representation before sending. Full body/actions/canonical text stay intact. */
export function repairLegacyOutcomePreview(value: unknown): LineReplyMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return null;
  const repaired = value.map((message) => message?.type === 'flex'
    && typeof message.altText === 'string'
    && message.altText.length > LINE_FLEX_PREVIEW_LIMIT
    && Array.from(message.altText).length <= LINE_FLEX_PREVIEW_LIMIT
    ? { ...message, altText: lineMessagePreview(message.altText) }
    : message);
  return parseOutcomeMessages(repaired);
}

// PostgreSQL JSONB reorders object keys. Canonical bytes keep first-push and restart identities equal.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item);
}

/** Stable UUID for one logical push. Recipient and exact payload are part of its identity. */
export function linePushRetryKey(operationId: string, to: string, messages: LineReplyMessage[]): string {
  const bytes = createHash('sha256').update(canonicalJson([operationId, to, messages])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Never log exception messages: Prisma/provider messages can contain receipt rows or credentials. */
export function safeLineErrorDetails(error: unknown): Record<string, string | number> {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const cause = value.cause && typeof value.cause === 'object' ? value.cause as Record<string, unknown> : {};
  const safe = (v: unknown): string | undefined => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(v) ? v : undefined;
  return {
    errorClass: safe(value.name) ?? 'UnknownError',
    ...(safe(value.code) ? { errorCode: safe(value.code)! } : {}),
    ...(safe(cause.code) ? { causeCode: safe(cause.code)! } : {}),
    ...(typeof value.httpStatus === 'number' ? { providerStatus: value.httpStatus } : {}),
    // Our own refusals throw bare codes (`PLAN_INVALID_LIFETIME`, `LINE_PLAN_CANONICAL_TEXT_REQUIRED`).
    // A message that is exactly such a code carries no customer data, so it is kept; any other
    // message is still dropped. Without it a local delivery refusal logged only `errorClass: Error`.
    ...(typeof value.message === 'string' && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value.message) && value.message.length <= 80
      ? { errorMessageCode: value.message } : {}),
  };
}

/** Keep only provider message IDs; quote tokens and response text are never retained. */
export async function lineSentMessageIds(response: Response): Promise<string[]> {
  try {
    const body = await response.json() as { sentMessages?: Array<{ id?: unknown }> };
    return Array.isArray(body?.sentMessages) ? body.sentMessages.slice(0, 5).flatMap(row =>
      typeof row?.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(row.id) ? [row.id] : []) : [];
  } catch { return []; } // Successful transport remains accepted even if its optional ID response is lost.
}
const LINE_MESSAGE_TIMEOUT_MS = 5_000;

/** LINE reports message-body validation errors with a JSON-pointer `property` into the request:
 *  `{"details":[{"message":"...","property":"/messages/0/contents/body/..."}]}`. An expired or reused
 *  reply token instead answers `{"message":"Invalid reply token"}` with no such pointer — so this is
 *  what separates "your card is malformed" from "your token is stale", and the token case keeps its
 *  push fallback rather than being downgraded to a text card it did not need. */
const LINE_MESSAGE_BODY_REJECTION = '/messages/';

@Injectable()
export class LineReplyAdapter {
  private readonly logger = new Logger(LineReplyAdapter.name);
  private readonly LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
  private readonly LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
  private readonly LINE_LOADING_URL = 'https://api.line.me/v2/bot/chat/loading/start';

  constructor(private readonly lineCredentials: LineMessagingCredentialsService, private readonly config: AppConfigService, @Optional() private readonly prisma?: PrismaService) {}

  async sendReply(replyToken: string, messages: LineReplyMessage[], onSent?: (ids: string[]) => Promise<void>): Promise<LineDeliveryResult> {
    if (JSON.stringify(messages).includes(LINE_DELIVERY_PLAN_SENTINEL[0].text)) return 'failed_other';
    if (isVirtualDemoTarget(replyToken)) return this.sendVirtual(replyToken, messages);
    return this.postMessage(this.LINE_REPLY_URL, { replyToken, messages: providerMessages(messages) }, 'reply', messages, undefined, onSent);
  }

  /** Push delivery consumes the OA monthly message quota (replies are free).
   *  Used for expired-token fallback, slow-turn feedback, and receipt acknowledgement (spec §10). */
  async sendPush(to: string, messages: LineReplyMessage[], operationId: string = randomUUID(), onSent?: (ids: string[]) => Promise<void>): Promise<LineDeliveryResult> {
    if (JSON.stringify(messages).includes(LINE_DELIVERY_PLAN_SENTINEL[0].text)) return 'failed_other';
    if (isVirtualDemoTarget(to)) return this.sendVirtual(to, messages, operationId);
    return this.postMessage(this.LINE_PUSH_URL, { to, messages: providerMessages(messages) }, 'push', messages, linePushRetryKey(operationId, to, messages), onSent);
  }

  /** Exact frozen v2 wire. A thrown request/body read is uncertainty, never a token rejection. */
  async sendFrozenV2(input: { channelId?: string; transport: 'REPLY' | 'PUSH'; target: string; messages: LineReplyMessage[]; pushRetryKey: string; timeoutMs: number }): Promise<LineDeliveryResultV2> {
    if (JSON.stringify(input.messages).includes(LINE_DELIVERY_PLAN_SENTINEL[0].text)) return { kind: 'rejected', code: 'INVALID_FROZEN_WIRE', rejection: 'PERMANENT' };
    if (!parseOutcomeMessages(input.messages) || input.messages.some(m => m.type === 'flex' && m.canonicalText !== undefined)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.pushRetryKey)
      || !input.target || !Number.isFinite(input.timeoutMs) || input.timeoutMs < 500) return { kind: 'rejected', code: 'INVALID_FROZEN_WIRE', rejection: 'PERMANENT' };
    if (isVirtualDemoTarget(input.target, input.channelId)) {
      const result = await this.sendVirtual(input.target, input.messages, input.transport === 'PUSH' ? input.pushRetryKey : undefined);
      return result === 'ok' ? { kind: 'accepted', code: 'API_ACCEPTED' } : { kind: 'unknown', code: 'VIRTUAL_STORE_FAILED' };
    }
    try {
      const credentials = await this.lineCredentials.get();
      if (input.channelId !== undefined && input.channelId !== credentials.channelId) return { kind: 'rejected', code: 'CHANNEL_CHANGED', rejection: 'PERMANENT' };
      const accessToken = credentials.accessToken;
      if (!accessToken) return { kind: 'rejected', code: 'CHANNEL_UNAVAILABLE', rejection: 'PERMANENT' };
      const push = input.transport === 'PUSH';
      const response = await fetch(push ? this.LINE_PUSH_URL : this.LINE_REPLY_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...(push ? { 'X-Line-Retry-Key': input.pushRetryKey } : {}) },
        body: canonicalJson({ [push ? 'to' : 'replyToken']: input.target, messages: input.messages }),
        signal: AbortSignal.timeout(Math.min(push ? 5_000 : 8_000, Math.trunc(input.timeoutMs))),
      });
      const requestId = (response.headers.get('x-line-accepted-request-id') ?? response.headers.get('x-line-request-id'))?.slice(0, 200);
      if (response.ok || (push && response.status === 409 && response.headers.get('x-line-accepted-request-id'))) {
        const sentMessageIds = await lineSentMessageIds(response);
        return { kind: 'accepted', code: 'API_ACCEPTED', ...(requestId ? { requestId } : {}), ...(sentMessageIds.length ? { sentMessageIds } : {}) };
      }
      // Reading the response shares the abort signal from fetch. A lost body cannot prove rejection.
      const body = await response.text();
      if (!push && response.status === 400 && /invalid reply token/i.test(body)) return { kind: 'rejected', code: 'REPLY_TOKEN_REJECTED', rejection: 'TOKEN' };
      if (response.status === 400 && body.includes(LINE_MESSAGE_BODY_REJECTION) && input.messages.some(m => m.type === 'flex')) return { kind: 'rejected', code: 'FLEX_REJECTED', rejection: 'FLEX' };
      if (response.status === 429) return { kind: 'rejected', code: 'RATE_LIMITED' };
      if (response.status >= 400 && response.status < 500 && response.status !== 408) return { kind: 'rejected', code: 'PROVIDER_REJECTED', rejection: 'PERMANENT' };
      return { kind: 'unknown', code: 'PROVIDER_ACCEPTANCE_UNKNOWN' };
    } catch { return { kind: 'unknown', code: 'PROVIDER_ACCEPTANCE_UNKNOWN' }; }
  }

  /** Best-effort typing indicator. One-on-one chats only; LINE dismisses it
   *  automatically when the reply arrives or after loadingSeconds. Returns whether LINE accepted
   *  the request (its successful HTTP response) so the caller can record `loading_accepted`
   *  server-side (latency/autonomy §12); device-visible render timing stays UAT-only. */
  async startLoadingAnimation(chatId: string): Promise<boolean> {
    // The durable buffer/job rows drive web typing state, so there is no second flag to clear.
    if (isVirtualDemoTarget(chatId)) return true;
    try {
      const accessToken = (await this.lineCredentials.get()).accessToken;
      if (!accessToken) return false;
      const response = await fetch(this.LINE_LOADING_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ chatId, loadingSeconds: 60 }),
        // Cosmetic call — never let it hold up the turn.
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) {
        this.logger.debug?.({ msg: 'LINE loading animation rejected', status: response.status });
      }
      return response.ok;
    } catch (err) {
      this.logger.debug?.({ msg: 'LINE loading animation failed', ...safeLineErrorDetails(err) });
      return false;
    }
  }

  private async sendVirtual(target: string, messages: LineReplyMessage[], operationId?: string): Promise<LineDeliveryResult> {
    try {
      if (!this.prisma) return 'failed_other';
      await storeDemoReply(this.prisma.client, target, providerMessages(messages) as unknown as Prisma.InputJsonValue, operationId);
      return 'ok';
    } catch {
      this.logger.warn({ msg: 'demo.chat.delivery_failed' });
      return 'failed_other';
    }
  }

  private async postMessage(
    url: string,
    body: Record<string, unknown>,
    kind: 'reply' | 'push',
    messages?: LineReplyMessage[],
    retryKey?: string,
    onSent?: (ids: string[]) => Promise<void>,
  ): Promise<LineDeliveryResult> {
    let accessToken: string | undefined;
    try { accessToken = (await this.lineCredentials.get()).accessToken; } catch { return 'failed_other'; }
    if (!accessToken) {
      this.logger.warn({ msg: `LINE access token not configured; skipping ${kind}` });
      return 'skipped';
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(kind === 'push' && retryKey ? { 'X-Line-Retry-Key': retryKey } : {}),
          // Token sent in header, not logged
          Authorization: `Bearer ${accessToken}`,
        },
        body: kind === 'push' ? canonicalJson(body) : JSON.stringify(body),
        signal: AbortSignal.timeout(LINE_MESSAGE_TIMEOUT_MS),
      });
    } catch (err) {
      // Log error without leaking the token
      this.logger.error({ msg: `LINE ${kind} network error`, ...safeLineErrorDetails(err) });
      return 'failed_other';
    }

    // A retry-key conflict with an accepted request id proves API acceptance, not device delivery.
    if (kind === 'push' && response.status === 409 && response.headers.get('x-line-accepted-request-id')) return 'ok';
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      this.logger.warn({ msg: `LINE ${kind} failed`, status: response.status, requestId: response.headers.get('x-line-request-id')?.slice(0, 100) });
      const flexRejected = response.status === 400 && errText.includes(LINE_MESSAGE_BODY_REJECTION)
        && (messages ?? []).some((message) => message.type === 'flex');
      if (flexRejected) return 'failed_flex';
      if (kind !== 'reply' || response.status !== 400) {
        return response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 408 ? 'failed_permanent' : 'failed_other';
      }
      return 'failed_token';
    }
    if (onSent) await onSent(await lineSentMessageIds(response)).catch(() => undefined);
    return 'ok';
  }

  buildTextMessage(text: string): LineReplyMessage {
    return { type: 'text', text: text.slice(0, 5000) };
  }
}
