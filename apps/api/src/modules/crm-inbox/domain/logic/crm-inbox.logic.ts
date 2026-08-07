// Pure Item 15A inbox/channel logic. No I/O, no Nest imports — unit-tested.

import { createHash, createHmac } from 'node:crypto';
import type { ConnectMessagingChannelInput, CrmBusinessHours, CrmConversationStatus, CrmMessageType } from '@watchdog-bms/contracts';
import type { LineInboundEvent } from '../models/crm-inbox.model';
import {
  CONVERSATION_MAX_TAGS,
  CONVERSATION_REOPEN_WINDOW_DAYS,
  CONVERSATION_TAG_MAX_LENGTH,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_FIRST_RESPONSE_MINUTES,
  MAX_FIRST_RESPONSE_MINUTES,
  MESSAGE_PREVIEW_MAX_LENGTH,
  OUTBOUND_TEXT_MAX_LENGTH,
  REPLY_SEND_BACKOFF_BASE_MS,
  REPLY_SEND_BACKOFF_MAX_MS,
  TERMINAL_MEDIA_ERROR_CODES,
} from '../crm-inbox.constants';
import type { ConsentUnsubscribePolicy } from '@watchdog-bms/contracts';

/** Exact, Unicode-normalized command matching; never substring-match ordinary chat. */
export function matchesUnsubscribeKeyword(text: string | null, policy: ConsentUnsubscribePolicy): boolean {
  if (!text) return false;
  const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('th-TH');
  const candidate = normalize(text);
  return candidate.length > 0 && policy.unsubscribeKeywords.some((keyword) => normalize(keyword) === candidate);
}

/** Last 4 characters of the access token, for masked display. */
export function credentialLast4(accessToken: string): string {
  return accessToken.slice(-4);
}

/** Human-readable validation for the connect/rotate inputs. Returns null when valid. */
export function validateChannelCredentialInput(input: {
  displayName?: string;
  lineChannelId?: string;
  channelSecret: string;
  accessToken: string;
}): string | null {
  if (input.displayName !== undefined && input.displayName.trim().length === 0) {
    return 'displayName is required';
  }
  if (input.lineChannelId !== undefined && !/^\d{4,}$/.test(input.lineChannelId.trim())) {
    return 'lineChannelId must be the numeric LINE channel ID';
  }
  if (input.channelSecret.trim().length < 8) return 'channelSecret looks too short';
  if (input.accessToken.trim().length < 8) return 'accessToken looks too short';
  return null;
}

export function normalizeConnectInput(input: ConnectMessagingChannelInput): ConnectMessagingChannelInput {
  return {
    displayName: input.displayName.trim(),
    lineChannelId: input.lineChannelId.trim(),
    channelSecret: input.channelSecret.trim(),
    accessToken: input.accessToken.trim(),
  };
}

/** A resolved conversation accepts a customer reply as a reopen within the window. */
export function shouldReopenConversation(resolvedAt: Date, now: Date): boolean {
  const windowMs = CONVERSATION_REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() - resolvedAt.getTime() <= windowMs;
}

/** Bounded single-line preview for the conversation list. */
export function previewText(text: string | null | undefined): string | null {
  if (!text) return null;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return null;
  return oneLine.length > MESSAGE_PREVIEW_MAX_LENGTH ? `${oneLine.slice(0, MESSAGE_PREVIEW_MAX_LENGTH - 1)}…` : oneLine;
}

/** Map a LINE message event type onto the CRM message type enum. */
export function mapLineMessageType(lineType: string | undefined): CrmMessageType {
  switch (lineType) {
    case 'text': return 'TEXT';
    case 'image': return 'IMAGE';
    case 'sticker': return 'STICKER';
    case 'file': return 'FILE';
    case 'video': return 'FILE';
    case 'audio': return 'FILE';
    case 'location': return 'LOCATION';
    default: return 'SYSTEM';
  }
}

/** LINE message types whose binary content we fetch and store. */
export function isDownloadableLineMedia(lineType: string | undefined): boolean {
  return lineType === 'image' || lineType === 'file';
}

/**
 * Owner decision 2026-07-06: video/audio are explicitly unsupported — the
 * message row lands with a fail marker (no download, no player). Future
 * direction is voice-to-text first, not an inline player.
 */
export function isUnsupportedLineMedia(lineType: string | undefined): boolean {
  return lineType === 'video' || lineType === 'audio';
}

/**
 * Stable idempotency key for an inbound event. LINE message ids are globally
 * unique and survive webhook redelivery; fall back to the webhook event id.
 */
export function inboundProviderMessageId(event: LineInboundEvent): string | null {
  return event.message?.id ?? event.webhookEventId ?? null;
}

const PDPA_LINE_IDENTIFIER_V1_PREFIX = 'pdpa-hmac-v1:';
const PDPA_LINE_IDENTIFIER_V2_PREFIX = 'pdpa-hmac-v2:';
const PDPA_LINE_KEY_CONTEXT = 'watchdog-bms\0crm-pdpa-line\0pseudonymization-key\0v2';
const PDPA_LINE_IDENTIFIER_PATTERN = /^(?:pdpa-hmac-v1:[0-9a-f]{64}|pdpa-hmac-v2:[0-9a-f]{16}:[0-9a-f]{64})$/;

export type PdpaLineIdentifierKind = 'provider-user' | 'provider-message' | 'webhook-event';

export type PdpaPseudonymizationKeyRing = Readonly<{
  current: Buffer;
  previous?: readonly Buffer[];
}>;

function assertPdpaRootKey(rootKey: Buffer): void {
  if (rootKey.length !== 32) throw new Error('PDPA pseudonymization root key must be 32 bytes');
}

function pdpaLineIdentifierV1(
  kind: PdpaLineIdentifierKind,
  scope: string,
  raw: string,
  rootKey: Buffer,
): string {
  assertPdpaRootKey(rootKey);
  const digest = createHmac('sha256', rootKey)
    .update(`crm-pdpa-line\0${kind}\0${scope}\0${raw}`)
    .digest('hex');
  return `${PDPA_LINE_IDENTIFIER_V1_PREFIX}${digest}`;
}

function pdpaLineIdentifierV2(
  kind: PdpaLineIdentifierKind,
  scope: string,
  raw: string,
  rootKey: Buffer,
): string {
  assertPdpaRootKey(rootKey);
  const derivedKey = createHmac('sha256', rootKey).update(PDPA_LINE_KEY_CONTEXT).digest();
  const keyId = createHash('sha256').update(derivedKey).digest('hex').slice(0, 16);
  const digest = createHmac('sha256', derivedKey)
    .update(`crm-pdpa-line-v2\0${kind}\0${scope}\0${raw}`)
    .digest('hex');
  return `${PDPA_LINE_IDENTIFIER_V2_PREFIX}${keyId}:${digest}`;
}

/**
 * Irreversible, deterministic replacement for a raw LINE identifier. The
 * domain and tenant/channel scope prevent correlation between identifier
 * kinds and companies while preserving erased-user suppression/redelivery
 * idempotency. Passing an already-pseudonymized value is deliberately stable
 * so a later erasure request cannot break those guarantees.
 */
export function pseudonymizePdpaLineIdentifier(
  kind: PdpaLineIdentifierKind,
  scope: string,
  raw: string,
  rootKey: Buffer,
): string {
  if (PDPA_LINE_IDENTIFIER_PATTERN.test(raw)) return raw;
  return pdpaLineIdentifierV2(kind, scope, raw, rootKey);
}

/** Current and historical values that may identify the same erased LINE id. */
export function pdpaLineIdentifierLookupCandidates(
  kind: PdpaLineIdentifierKind,
  scope: string,
  raw: string,
  keyRing: PdpaPseudonymizationKeyRing,
): string[] {
  if (PDPA_LINE_IDENTIFIER_PATTERN.test(raw)) return [raw];
  const rootKeys = [keyRing.current, ...(keyRing.previous ?? [])];
  return [...new Set([
    ...rootKeys.map((key) => pdpaLineIdentifierV2(kind, scope, raw, key)),
    ...rootKeys.map((key) => pdpaLineIdentifierV1(kind, scope, raw, key)),
  ])];
}

/** Deterministic LINE retry key: stable persisted message id -> UUID-shaped key. */
export function lineReplyRetryKeyForMessage(messageId: string): string {
  const hex = createHash('sha256').update(messageId).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Events the ingestion pipeline handles. */
export function isSupportedInboundEvent(event: LineInboundEvent): boolean {
  if (event.type === 'follow' || event.type === 'unfollow') return Boolean(event.source?.userId);
  return event.type === 'message' && Boolean(event.source?.userId);
}

// ---- Phase 2 triage ----

/** Human error (Thai UI maps it) for an outbound text; null when sendable. */
export function validateOutboundText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'text_required';
  if (trimmed.length > OUTBOUND_TEXT_MAX_LENGTH) return 'text_too_long';
  return null;
}

/**
 * Normalizes a full tag replacement: trim, drop empties, dedupe
 * (case-insensitive, first casing wins). Error codes map to Thai in the UI.
 */
export function normalizeConversationTags(input: unknown): { tags: string[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'tags_must_be_array' };
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') return { error: 'tags_must_be_strings' };
    const tag = raw.trim();
    if (tag.length === 0) continue;
    if (tag.length > CONVERSATION_TAG_MAX_LENGTH) return { error: 'tag_too_long' };
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > CONVERSATION_MAX_TAGS) return { error: 'too_many_tags' };
  return { tags };
}

/**
 * Status auto-advance on a staff reply (มั่งมี Flow A: ส่งข้อความ → รอลูกค้า).
 * Internal notes never change status; terminal states stay put.
 */
export function statusAfterStaffReply(current: CrmConversationStatus): CrmConversationStatus {
  if (current === 'RESOLVED' || current === 'SPAM') return current;
  return 'WAITING_CUSTOMER';
}

/**
 * First-response SLA overdue (chip "เกิน 30 นาที"): the customer is still
 * waiting for the very first staff reply past the due time.
 */
export function isConversationOverdue(
  c: { status: CrmConversationStatus; firstRespondedAt: Date | null; firstResponseDueAt: Date | null },
  now: Date,
): boolean {
  if (c.status === 'RESOLVED' || c.status === 'SPAM') return false;
  if (c.firstRespondedAt) return false;
  return Boolean(c.firstResponseDueAt && c.firstResponseDueAt.getTime() < now.getTime());
}

// ---- Phase 2 assignment ABAC (own/assigned + unassigned pickup, spec §13/§19) ----

/**
 * Roles that see the whole company inbox; mirrors item 15's CRM read-all list.
 * Everyone else (SALES/SUPPORT/STAFF) is scoped to own/assigned conversations
 * plus the unassigned pickup queue.
 */
const INBOX_READ_ALL_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'FINANCE', 'ACCOUNTANT', 'AUDITOR_READONLY', 'MARKETING', 'COMPANY_VIEW'];
const INBOX_WRITE_ALL_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];

export function inboxSeesAllConversations(roles: string[]): boolean {
  return roles.some((r) => INBOX_READ_ALL_ROLES.includes(r));
}

export function inboxWritesAllConversations(roles: string[]): boolean {
  return roles.some((r) => INBOX_WRITE_ALL_ROLES.includes(r));
}

/** Read-scoped users may access a conversation only when it is theirs or unassigned. */
export function conversationInScope(roles: string[], userId: string, assignedToUserId: string | null): boolean {
  if (inboxSeesAllConversations(roles)) return true;
  return assignedToUserId === null || assignedToUserId === userId;
}

export function conversationWriteInScope(roles: string[], userId: string, assignedToUserId: string | null): boolean {
  if (inboxWritesAllConversations(roles)) return true;
  return assignedToUserId === null || assignedToUserId === userId;
}

// ---- Phase 2 inbox policy (first-response SLA clock) ----

/** Validated businessHoursJson shape; anything malformed degrades to null (24/7 clock). */
export function parseBusinessHours(value: unknown): CrmBusinessHours | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v['start'] !== 'string' || typeof v['end'] !== 'string' || typeof v['timezone'] !== 'string') return null;
  const start = parseHm(v['start']);
  const end = parseHm(v['end']);
  if (start === null || end === null || end <= start) return null;
  return { start: v['start'], end: v['end'], timezone: v['timezone'] };
}

/** Effective SLA settings: no saved row = spec §22 defaults (30 min within 09:00–18:00 Asia/Bangkok). */
export function effectiveInboxPolicy(
  row: { firstResponseMinutes: number; businessHoursJson: unknown } | null,
): { firstResponseMinutes: number; businessHours: CrmBusinessHours | null } {
  if (!row) return { firstResponseMinutes: DEFAULT_FIRST_RESPONSE_MINUTES, businessHours: { ...DEFAULT_BUSINESS_HOURS } };
  return { firstResponseMinutes: row.firstResponseMinutes, businessHours: parseBusinessHours(row.businessHoursJson) };
}

/** Stable error code for a policy update; null when valid. Thai mapping lives in the UI. */
export function validateInboxPolicyInput(input: {
  firstResponseMinutes: unknown;
  businessHours: unknown;
}): string | null {
  const minutes = input.firstResponseMinutes;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_FIRST_RESPONSE_MINUTES) {
    return 'minutes_out_of_range';
  }
  if (input.businessHours === null) return null;
  const v = input.businessHours;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'invalid_business_hours';
  const h = v as Record<string, unknown>;
  if (typeof h['start'] !== 'string' || typeof h['end'] !== 'string') return 'invalid_business_hours';
  const start = parseHm(h['start']);
  const end = parseHm(h['end']);
  if (start === null || end === null) return 'invalid_business_hours';
  if (end <= start) return 'business_hours_end_before_start';
  if (typeof h['timezone'] !== 'string' || !isValidTimezone(h['timezone'])) return 'invalid_timezone';
  return null;
}

/**
 * First-response due time: `minutes` of SLA clock consumed only inside the
 * business-hours window (daily, every day — no weekday config yet). Null
 * business hours = flat wall-clock add. Any timezone/format failure degrades
 * to the flat add so webhook ingestion can never crash on a bad policy row.
 */
export function computeFirstResponseDueAt(receivedAt: Date, minutes: number, hours: CrmBusinessHours | null): Date {
  const flat = new Date(receivedAt.getTime() + minutes * 60_000);
  if (!hours) return flat;
  const start = parseHm(hours.start);
  const end = parseHm(hours.end);
  if (start === null || end === null || end <= start) return flat;
  try {
    let cursor = receivedAt.getTime();
    let remaining = minutes;
    // Bounded walk: minutes ≤ MAX_FIRST_RESPONSE_MINUTES and window ≥ 1 min
    // keeps this far under the cap; cap exists so a pathological clock can
    // never loop forever.
    for (let i = 0; i < 400; i += 1) {
      const local = minutesOfDayInTz(new Date(cursor), hours.timezone);
      if (local < start) {
        cursor += (start - local) * 60_000;
        continue;
      }
      if (local >= end) {
        cursor += (1440 - local + start) * 60_000;
        continue;
      }
      const available = end - local;
      if (remaining <= available) return new Date(cursor + remaining * 60_000);
      remaining -= available;
      cursor += (1440 - local + start) * 60_000;
    }
    return new Date(cursor);
  } catch {
    return flat;
  }
}

function parseHm(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function minutesOfDayInTz(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

// ---- A5: delivery / media retry classification ----

/**
 * Whether a LINE adapter error is transient and worth another attempt. Matches the
 * adapter's error strings: `line_api_unreachable` (network) and `line_api_429` /
 * `line_api_5xx` retry; `invalid_access_token` (401) and other 4xx are terminal.
 */
export function isRetryableLineError(error: string | null | undefined): boolean {
  if (!error) return false;
  if (error === 'line_api_unreachable') return true;
  const m = /^line_api_(\d{3})$/.exec(error);
  if (m) {
    const status = Number(m[1]);
    return status === 429 || status >= 500;
  }
  return false; // invalid_access_token, content_too_large, etc.
}

/** Exponential backoff (base 30s ×2ⁿ, cap 1h) for the next reply-send retry. */
export function computeReplySendBackoffAt(attemptCount: number, from: Date): Date {
  const backoffMs = Math.min(REPLY_SEND_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attemptCount)), REPLY_SEND_BACKOFF_MAX_MS);
  return new Date(from.getTime() + backoffMs);
}

/**
 * Decide the persisted outcome of a reply push (A5): success → SENT; retryable failure
 * with attempts left → PENDING + backoff nextAttemptAt; else terminal FAILED.
 */
export function resolveReplySendOutcome(input: {
  ok: boolean;
  error?: string | null;
  retryAfterSeconds?: number | null;
  attemptCountAfter: number;
  maxAttempts: number;
  now: Date;
}): { status: 'SENT' | 'PENDING' | 'FAILED'; nextAttemptAt?: Date } {
  if (input.ok) return { status: 'SENT' };
  const canRetry = isRetryableLineError(input.error) && input.attemptCountAfter < input.maxAttempts;
  if (!canRetry) return { status: 'FAILED' };
  if (input.retryAfterSeconds != null && Number.isFinite(input.retryAfterSeconds) && input.retryAfterSeconds > 0) {
    return { status: 'PENDING', nextAttemptAt: new Date(input.now.getTime() + input.retryAfterSeconds * 1000) };
  }
  return { status: 'PENDING', nextAttemptAt: computeReplySendBackoffAt(input.attemptCountAfter, input.now) };
}

/** A media fetch error the retry scanner must NOT re-attempt (size/type limits). */
export function isTerminalMediaError(mediaError: string | null | undefined): boolean {
  return mediaError != null && TERMINAL_MEDIA_ERROR_CODES.includes(mediaError);
}
