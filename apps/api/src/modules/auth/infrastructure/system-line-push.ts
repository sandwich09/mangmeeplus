import { isVirtualDemoTarget, withLineExternalBrowserLinks } from '@watchdog-bms/contracts';

/**
 * What one push attempt did. `retryAfterSeconds` is LINE's own answer to "when may I try again",
 * and it is the only honest schedule for a 429 — a fixed backoff either wastes the window or
 * hammers it (review G-07).
 */
export type LinePushOutcome = { ok: true } | { ok: false; error: string; retryAfterSeconds?: number };

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_PUSH_TIMEOUT_MS = 5_000;

/**
 * The longest deferral we will honour. LINE's monthly-quota 429 can name a retry-after measured in
 * weeks; obeying it literally parks "ร้านของคุณพร้อมใช้แล้ว" until the quota resets, which is not a
 * schedule anyone chose. Six hours keeps the row alive and re-checking while an operator acts.
 */
export const LINE_RETRY_AFTER_MAX_SECONDS = 6 * 60 * 60;

/** LINE sends whole seconds; anything else is a header we do not understand and must not act on. */
export function parseLineRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(seconds, LINE_RETRY_AFTER_MAX_SECONDS);
}

/**
 * The one place this codebase talks to LINE's push endpoint.
 *
 * Never throws. A 429 comes back with LINE's `retry-after`, and a 409 carrying
 * `x-line-accepted-request-id` is a SUCCESS — it means an earlier attempt with the same retry key
 * already landed, so treating it as a failure would send the message twice.
 */
export async function pushLineMessages(input: {
  token: string;
  channelId?: string;
  isDemo?: boolean;
  lineUserId: string;
  messages: unknown[];
  /** Same key on every retry of one logical message; LINE dedupes on it. */
  retryKey?: string;
  url?: string;
  timeoutMs?: number;
  /** R-B1 is for OUR app's links. `false` = a shop talking to its own customers (CRM), sent as written. */
  externalBrowser?: boolean;
}): Promise<LinePushOutcome> {
  if (input.isDemo || isVirtualDemoTarget(input.lineUserId, input.channelId)) {
    console.info('[system-line-push] demo outbound suppressed');
    return { ok: true };
  }
  try {
    const res = await fetch(input.url ?? LINE_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.token}`,
        ...(input.retryKey ? { 'X-Line-Retry-Key': input.retryKey } : {}),
      },
      // R-B1: exit-side rewrite; `input.retryKey` was computed by the caller from its own payload.
      body: JSON.stringify({
        to: input.lineUserId,
        messages: input.externalBrowser === false ? input.messages : withLineExternalBrowserLinks(input.messages),
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? LINE_PUSH_TIMEOUT_MS),
    });
    if (res.ok || (res.status === 409 && Boolean(res.headers.get('x-line-accepted-request-id')))) {
      return { ok: true };
    }
    const retryAfterSeconds = res.status === 429
      ? parseLineRetryAfterSeconds(res.headers.get('retry-after'))
      : undefined;
    return {
      ok: false,
      error: res.status === 401 ? 'invalid_access_token' : `line_api_${res.status}`,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  } catch {
    return { ok: false, error: 'line_api_unreachable' };
  }
}

/** Push messages through the system LINE OA (same channel the internal
 *  notification rail uses). Best-effort: never throws, and never logs message
 *  content or the recipient — callers pass temporary passwords and reset
 *  notices through here. Failures are logged status-only so a dead OA is not
 *  silently read as "employee has no LINE linked". */
export async function pushSystemLineMessages(token: string, lineUserId: string, messages: unknown[]): Promise<boolean> {
  const outcome = await pushLineMessages({ token, lineUserId, messages });
  if (!outcome.ok) console.warn('[system-line-push] LINE push failed', outcome.error);
  return outcome.ok;
}

export async function pushSystemLineMessage(token: string, lineUserId: string, text: string): Promise<boolean> {
  return pushSystemLineMessages(token, lineUserId, [{ type: 'text', text }]);
}

/**
 * Temporary-password card (Owner 2026-08-27): the code rides in a one-tap
 * "คัดลอกรหัส" clipboard button instead of being retyped from a plain text
 * bubble. The altText deliberately OMITS the password so it never appears in a
 * lock-screen notification preview — an improvement over the old text push,
 * which leaked the code into the preview. The code stays visible in the body
 * as the retype fallback for LINE clients too old for clipboard actions
 * (flex text is not long-press copyable, so the button is the copy path).
 */
export function buildTemporaryPasswordFlexMessage(temporaryPassword: string, infoLines: string[]): unknown {
  return {
    type: 'flex',
    altText: '🔐 รหัสผ่านชั่วคราวมาแล้ว เปิดดูในแชทนะคะ',
    contents: {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
        { type: 'text', text: '🔐 รหัสผ่านชั่วคราว', weight: 'bold', size: 'md', color: '#101828' },
        { type: 'text', text: temporaryPassword, weight: 'bold', size: 'xl', color: '#16A34A', wrap: true },
        ...infoLines.map((line) => ({ type: 'text', text: line, size: 'xs', color: '#667085', wrap: true })),
      ] },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'clipboard', label: 'คัดลอกรหัส', clipboardText: temporaryPassword } },
      ] },
    },
  };
}
