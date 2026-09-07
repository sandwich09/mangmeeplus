/**
 * LINE reply adapter – sends reply/push messages via Messaging API.
 * Does not log access tokens or authorization headers.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../common/config/app-config.service';

type LineMessageAction = { type: 'message'; label: string; text: string };
type LineCameraAction = { type: 'camera' | 'cameraRoll'; label: string };
export type LineQuickReplyItem = { type: 'action'; action: LineMessageAction | LineCameraAction };
export type LineReplyMessage = {
  quickReply?: { items: LineQuickReplyItem[] };
} & (
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; canonicalText?: string; contents: Record<string, unknown> }
);

/** Internal recovery text stays in the durable outcome, never in the LINE wire schema. */
function providerMessages(messages: LineReplyMessage[]): LineReplyMessage[] {
  return messages.map((message) => {
    if (message.type !== 'flex') return message;
    const { canonicalText: _canonicalText, ...providerMessage } = message;
    return providerMessage;
  });
}

/** `failed_token` = LINE rejected the request (400): expired/used reply token
 *  or malformed message — the only class where a push fallback can still
 *  deliver. Other failures would fail the push the same way.
 *
 *  `failed_flex` is a strict REFINEMENT of `failed_token`, never of anything
 *  else: the same 400, on the same reply call, narrowed to "LINE rejected the
 *  message BODY and that body contained a Flex message". Pushing the identical
 *  payload cannot fix a payload LINE refused to render, but re-sending it as
 *  the Flex message's own `altText` can. Because it only ever appears where
 *  `failed_token` used to, a caller that does not know the value behaves
 *  exactly as before by treating it as `failed_token`. */
export type LineDeliveryResult = 'ok' | 'failed_token' | 'failed_flex' | 'failed_other' | 'failed_permanent' | 'skipped';

/** Own data again, but a row rewritten by hand must not take the sweep down — and it must never be
 *  pushed half-formed, because these bytes go straight to a person's chat. */
export function parseOutcomeMessages(value: unknown): LineReplyMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return null;
  const messages = value as Array<Partial<LineReplyMessage>>;
  const valid = messages.every((message) => (message?.type === 'text' && typeof (message as { text?: unknown }).text === 'string'
    && (message as { text: string }).text.length > 0 && (message as { text: string }).text.length <= 5000)
    || (message?.type === 'flex' && typeof (message as { altText?: unknown }).altText === 'string'
      && (message as { altText: string }).altText.length > 0 && (message as { altText: string }).altText.length <= 400
      && ((message as { canonicalText?: unknown }).canonicalText === undefined
        || (typeof (message as { canonicalText?: unknown }).canonicalText === 'string'
          && (message as { canonicalText: string }).canonicalText.length > 0
          && (message as { canonicalText: string }).canonicalText.length <= 5000))
      && !!(message as { contents?: unknown }).contents
      && typeof (message as { contents?: unknown }).contents === 'object'));
  return valid ? (value as LineReplyMessage[]) : null;
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
  };
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

  constructor(private readonly config: AppConfigService) {}

  async sendReply(replyToken: string, messages: LineReplyMessage[]): Promise<LineDeliveryResult> {
    return this.postMessage(this.LINE_REPLY_URL, { replyToken, messages: providerMessages(messages) }, 'reply', messages);
  }

  /** Push delivery consumes the OA monthly message quota (replies are free).
   *  Used for expired-token fallback, slow-turn feedback, and receipt acknowledgement (spec §10). */
  async sendPush(to: string, messages: LineReplyMessage[], operationId: string = randomUUID()): Promise<LineDeliveryResult> {
    return this.postMessage(this.LINE_PUSH_URL, { to, messages: providerMessages(messages) }, 'push', messages, linePushRetryKey(operationId, to, messages));
  }

  /** Best-effort typing indicator. One-on-one chats only; LINE dismisses it
   *  automatically when the reply arrives or after loadingSeconds. Returns whether LINE accepted
   *  the request (its successful HTTP response) so the caller can record `loading_accepted`
   *  server-side (latency/autonomy §12); device-visible render timing stays UAT-only. */
  async startLoadingAnimation(chatId: string): Promise<boolean> {
    const accessToken = this.config.lineMessagingChannelAccessToken;
    if (!accessToken) return false;
    try {
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

  private async postMessage(
    url: string,
    body: Record<string, unknown>,
    kind: 'reply' | 'push',
    messages?: LineReplyMessage[],
    retryKey?: string,
  ): Promise<LineDeliveryResult> {
    const accessToken = this.config.lineMessagingChannelAccessToken;
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
      if (kind !== 'reply' || response.status !== 400) {
        return response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 408 ? 'failed_permanent' : 'failed_other';
      }
      const flexRejected = errText.includes(LINE_MESSAGE_BODY_REJECTION)
        && (messages ?? []).some((message) => message.type === 'flex');
      return flexRejected ? 'failed_flex' : 'failed_token';
    }
    return 'ok';
  }

  buildTextMessage(text: string): LineReplyMessage {
    return { type: 'text', text: text.slice(0, 5000) };
  }
}
