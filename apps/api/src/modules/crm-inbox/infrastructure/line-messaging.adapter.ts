import { Injectable, Logger } from '@nestjs/common';
import { parseLineRetryAfterSeconds, pushLineMessages } from '../../auth/infrastructure/system-line-push';

// Single wrapper around the LINE Messaging API for company OA channels.
// All LINE HTTP calls in the crm-inbox module go through here; callers get
// typed results and never throw on provider/network failure.

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const LINE_CONTENT_API_BASE = 'https://api-data.line.me/v2/bot';
const REQUEST_TIMEOUT_MS = 5_000;
// Media bodies are much larger than JSON calls; give the transfer room.
const CONTENT_TIMEOUT_MS = 30_000;

export type LineBotInfoResult =
  | { ok: true; botDisplayName: string; basicId?: string }
  | { ok: false; error: string };

export type LineProfileResult = { displayName?: string; pictureUrl?: string } | null;

export type LinePushResult = { ok: true } | { ok: false; error: string; retryAfterSeconds?: number };

export type LineContentResult =
  | { ok: true; data: Buffer; mimeType: string }
  | { ok: false; error: string };

@Injectable()
export class LineMessagingAdapter {
  private readonly logger = new Logger(LineMessagingAdapter.name);

  /** Validates an access token by fetching bot info. */
  async getBotInfo(accessToken: string): Promise<LineBotInfoResult> {
    try {
      const res = await fetch(`${LINE_API_BASE}/info`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { ok: false, error: res.status === 401 ? 'invalid_access_token' : `line_api_${res.status}` };
      }
      const body = (await res.json()) as { displayName?: string; basicId?: string };
      return { ok: true, botDisplayName: body.displayName ?? 'LINE OA', basicId: body.basicId };
    } catch {
      return { ok: false, error: 'line_api_unreachable' };
    }
  }

  /**
   * Best-effort check that the access token belongs to the claimed channel id.
   * Returns the token's channel id when LINE exposes it, or null when the
   * verify endpoint does not support this token type — callers must fail open
   * on null (never block a legitimate connect on a missing capability).
   */
  async getTokenChannelId(accessToken: string): Promise<string | null> {
    try {
      const res = await fetch(
        `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { client_id?: string };
      return body.client_id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Best-effort check that the channel secret belongs to the channel: issues a
   * short-lived token via client_credentials (the only LINE call that
   * exercises the secret) and revokes it immediately so the probe never eats
   * one of the 30 short-lived token slots. Returns false only when LINE
   * explicitly rejects the pair (400 invalid_client); null when undeterminable
   * — callers must fail open on null (never block a legitimate connect on a
   * LINE outage or rate limit).
   */
  async verifyChannelSecret(channelId: string, channelSecret: string): Promise<boolean | null> {
    try {
      const res = await fetch('https://api.line.me/v2/oauth/accessToken', {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: channelId, client_secret: channelSecret }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = (await res.json()) as { access_token?: string };
        if (body.access_token) {
          await fetch('https://api.line.me/v2/oauth/revoke', {
            method: 'POST',
            body: new URLSearchParams({ access_token: body.access_token }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }).catch(() => undefined);
        }
        return true;
      }
      // 400 invalid_client is LINE's explicit "wrong pair"; 429 and everything
      // else are undeterminable and must fail open like any other outage.
      return res.status === 400 ? false : null;
    } catch {
      return null;
    }
  }

  /**
   * Pushes one text message to a LINE user. `retryKey` (UUID) makes network
   * retries idempotent on LINE's side — reuse the same key per logical message.
   */
  async pushTextMessage(
    accessToken: string,
    providerUserId: string,
    text: string,
    retryKey: string,
  ): Promise<LinePushResult> {
    // One push implementation for the whole codebase (G-07): 429 + retry-after and the 409
    // already-accepted arm both live in `pushLineMessages`, so this lane and the system rail can
    // never disagree about what LINE just said.
    return pushLineMessages({
      token: accessToken,
      lineUserId: providerUserId,
      messages: [{ type: 'text', text }],
      retryKey,
      url: `${LINE_API_BASE}/message/push`,
      timeoutMs: REQUEST_TIMEOUT_MS,
      // Campaigns, staff replies and reminders are the shop's words to its own customers: their
      // links are not our app, so R-B1's open-outside-LINE rewrite does not touch them.
      externalBrowser: false,
    });
  }

  /** Uses a single-use LINE webhook reply token for one text message. */
  async replyTextMessage(accessToken: string, replyToken: string, text: string): Promise<LinePushResult> {
    try {
      const res = await fetch(`${LINE_API_BASE}/message/reply`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const retryAfterSeconds = res.status === 429 ? parseLineRetryAfterSeconds(res.headers.get('retry-after')) : undefined;
        return {
          ok: false,
          error: res.status === 400
            ? 'token_unusable'
            : res.status === 401
              ? 'invalid_access_token'
              : `line_api_${res.status}`,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'line_api_unreachable' };
    }
  }

  /**
   * Downloads a message's binary content (image/video/audio/file). LINE keeps
   * content only for a limited retention window, so callers fetch at ingestion
   * time. maxBytes guards blob storage — oversized content is refused
   * (content_too_large), never truncated.
   */
  async getMessageContent(accessToken: string, lineMessageId: string, maxBytes: number): Promise<LineContentResult> {
    try {
      const res = await fetch(`${LINE_CONTENT_API_BASE}/message/${encodeURIComponent(lineMessageId)}/content`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(CONTENT_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { ok: false, error: res.status === 401 ? 'invalid_access_token' : `line_api_${res.status}` };
      }
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) return { ok: false, error: 'content_too_large' };
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > maxBytes) return { ok: false, error: 'content_too_large' };
      return { ok: true, data, mimeType: res.headers.get('content-type') ?? 'application/octet-stream' };
    } catch {
      return { ok: false, error: 'line_api_unreachable' };
    }
  }

  /** Best-effort profile fetch; null when the user blocks profile access or the call fails. */
  async getProfile(accessToken: string, providerUserId: string): Promise<LineProfileResult> {
    try {
      const res = await fetch(`${LINE_API_BASE}/profile/${encodeURIComponent(providerUserId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { displayName?: string; pictureUrl?: string };
      return { displayName: body.displayName, pictureUrl: body.pictureUrl };
    } catch {
      this.logger.warn({ msg: 'LINE profile fetch failed' });
      return null;
    }
  }
}


