/**
 * LINE reply adapter – sends reply/push messages via Messaging API.
 * Does not log access tokens or authorization headers.
 */
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';

type LineMessageAction = { type: 'message'; label: string; text: string };
type LineCameraAction = { type: 'camera' | 'cameraRoll'; label: string };
export type LineQuickReplyItem = { type: 'action'; action: LineMessageAction | LineCameraAction };
export type LineReplyMessage = {
  quickReply?: { items: LineQuickReplyItem[] };
} & (
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: Record<string, unknown> }
);

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
export type LineDeliveryResult = 'ok' | 'failed_token' | 'failed_flex' | 'failed_other' | 'skipped';

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
    return this.postMessage(this.LINE_REPLY_URL, { replyToken, messages }, 'reply', messages);
  }

  /** Push delivery consumes the OA monthly message quota (replies are free).
   *  Used for expired-token fallback, slow-turn feedback, and receipt acknowledgement (spec §10). */
  async sendPush(to: string, messages: LineReplyMessage[]): Promise<LineDeliveryResult> {
    return this.postMessage(this.LINE_PUSH_URL, { to, messages }, 'push');
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
      this.logger.debug?.({ msg: 'LINE loading animation failed', error: (err as Error).message });
      return false;
    }
  }

  private async postMessage(
    url: string,
    body: Record<string, unknown>,
    kind: 'reply' | 'push',
    messages?: LineReplyMessage[],
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
          // Token sent in header, not logged
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(LINE_MESSAGE_TIMEOUT_MS),
      });
    } catch (err) {
      // Log error without leaking the token
      this.logger.error({ msg: `LINE ${kind} network error`, error: (err as Error).message });
      return 'failed_other';
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      // Truncate to avoid leaking response details
      this.logger.warn({ msg: `LINE ${kind} failed`, status: response.status, body: errText.slice(0, 200) });
      if (kind !== 'reply' || response.status !== 400) return 'failed_other';
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
