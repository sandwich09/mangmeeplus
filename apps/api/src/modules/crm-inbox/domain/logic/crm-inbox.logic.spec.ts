import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  credentialLast4,
  validateChannelCredentialInput,
  normalizeConnectInput,
  shouldReopenConversation,
  previewText,
  mapLineMessageType,
  inboundProviderMessageId,
  pdpaLineIdentifierLookupCandidates,
  pseudonymizePdpaLineIdentifier,
  lineReplyRetryKeyForMessage,
  isSupportedInboundEvent,
  validateOutboundText,
  statusAfterStaffReply,
  isConversationOverdue,
  inboxSeesAllConversations,
  conversationInScope,
  conversationWriteInScope,
  normalizeConversationTags,
  parseBusinessHours,
  effectiveInboxPolicy,
  validateInboxPolicyInput,
  computeFirstResponseDueAt,
  isRetryableLineError,
  computeReplySendBackoffAt,
  resolveReplySendOutcome,
  isTerminalMediaError,
} from './crm-inbox.logic';
import { MESSAGE_PREVIEW_MAX_LENGTH, OUTBOUND_TEXT_MAX_LENGTH, REPLY_SEND_MAX_ATTEMPTS } from '../crm-inbox.constants';

describe('credentialLast4', () => {
  it('returns the trailing 4 characters', () => {
    assert.equal(credentialLast4('abcdefgh1234'), '1234');
  });
});

describe('validateChannelCredentialInput', () => {
  it('accepts a valid connect input', () => {
    assert.equal(
      validateChannelCredentialInput({
        displayName: 'ร้านของฉัน',
        lineChannelId: '1234567890',
        channelSecret: 'secret-secret',
        accessToken: 'token-token-token',
      }),
      null,
    );
  });

  it('rejects a non-numeric channel id', () => {
    assert.match(
      validateChannelCredentialInput({
        displayName: 'x', lineChannelId: 'abc', channelSecret: 'secret-secret', accessToken: 'token-token',
      }) ?? '',
      /lineChannelId/,
    );
  });

  it('rejects short secrets and tokens', () => {
    assert.match(
      validateChannelCredentialInput({ channelSecret: 'short', accessToken: 'token-token' }) ?? '',
      /channelSecret/,
    );
    assert.match(
      validateChannelCredentialInput({ channelSecret: 'secret-secret', accessToken: 'short' }) ?? '',
      /accessToken/,
    );
  });

  it('rotate-style input (no displayName/channelId) validates secrets only', () => {
    assert.equal(validateChannelCredentialInput({ channelSecret: 'secret-secret', accessToken: 'token-token' }), null);
  });
});

describe('normalizeConnectInput', () => {
  it('trims every field', () => {
    const out = normalizeConnectInput({
      displayName: ' ร้าน ', lineChannelId: ' 123456 ', channelSecret: ' s3cr3t-s3cr3t ', accessToken: ' tok tok ',
    });
    assert.deepEqual(out, {
      displayName: 'ร้าน', lineChannelId: '123456', channelSecret: 's3cr3t-s3cr3t', accessToken: 'tok tok',
    });
  });
});

describe('shouldReopenConversation', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  it('reopens within the 7-day window', () => {
    assert.equal(shouldReopenConversation(new Date('2026-07-01T12:00:00Z'), now), true);
    assert.equal(shouldReopenConversation(new Date('2026-06-28T12:00:00Z'), now), true); // exactly 7 days
  });
  it('starts a new conversation after the window', () => {
    assert.equal(shouldReopenConversation(new Date('2026-06-28T11:59:59Z'), now), false);
  });
});

describe('previewText', () => {
  it('collapses whitespace and bounds length', () => {
    assert.equal(previewText('  สวัสดี\nครับ  '), 'สวัสดี ครับ');
    const long = 'a'.repeat(MESSAGE_PREVIEW_MAX_LENGTH + 50);
    const preview = previewText(long)!;
    assert.equal(preview.length, MESSAGE_PREVIEW_MAX_LENGTH);
    assert.ok(preview.endsWith('…'));
  });
  it('returns null for empty input', () => {
    assert.equal(previewText(''), null);
    assert.equal(previewText('   '), null);
    assert.equal(previewText(null), null);
  });
});

describe('mapLineMessageType', () => {
  it('maps LINE types onto CRM enum values', () => {
    assert.equal(mapLineMessageType('text'), 'TEXT');
    assert.equal(mapLineMessageType('image'), 'IMAGE');
    assert.equal(mapLineMessageType('sticker'), 'STICKER');
    assert.equal(mapLineMessageType('video'), 'FILE');
    assert.equal(mapLineMessageType('location'), 'LOCATION');
    assert.equal(mapLineMessageType('unknown-kind'), 'SYSTEM');
    assert.equal(mapLineMessageType(undefined), 'SYSTEM');
  });
});

describe('inboundProviderMessageId', () => {
  it('prefers the LINE message id, falls back to the webhook event id', () => {
    assert.equal(inboundProviderMessageId({ type: 'message', message: { id: 'm1' }, webhookEventId: 'w1' }), 'm1');
    assert.equal(inboundProviderMessageId({ type: 'message', webhookEventId: 'w1' }), 'w1');
    assert.equal(inboundProviderMessageId({ type: 'message' }), null);
  });
});

describe('pseudonymizePdpaLineIdentifier', () => {
  it('uses a deterministic domain-separated v2 key and preserves pseudonymized values', () => {
    const key = Buffer.alloc(32, 7);
    const user = pseudonymizePdpaLineIdentifier('provider-user', 'channel-1', 'U-raw', key);

    assert.match(user, /^pdpa-hmac-v2:[0-9a-f]{16}:[0-9a-f]{64}$/);
    assert.equal(user.includes('U-raw'), false);
    assert.equal(pseudonymizePdpaLineIdentifier('provider-user', 'channel-1', 'U-raw', key), user);
    assert.equal(pseudonymizePdpaLineIdentifier('provider-user', 'channel-1', user, key), user);
    assert.notEqual(pseudonymizePdpaLineIdentifier('provider-user', 'channel-2', 'U-raw', key), user);
    assert.notEqual(pseudonymizePdpaLineIdentifier('provider-message', 'channel-1', 'U-raw', key), user);
    assert.throws(
      () => pseudonymizePdpaLineIdentifier('provider-user', 'channel-1', 'U-raw', Buffer.alloc(31)),
      /must be 32 bytes/,
    );
  });

  it('returns current, previous, and exact legacy v1 lookup candidates during rotation', () => {
    const current = Buffer.alloc(32, 7);
    const previous = Buffer.alloc(32, 8);
    const candidates = pdpaLineIdentifierLookupCandidates(
      'provider-user',
      'channel-1',
      'U-raw',
      { current, previous: [previous, current] },
    );
    const legacy = (key: Buffer) => `pdpa-hmac-v1:${createHmac('sha256', key)
      .update('crm-pdpa-line\0provider-user\0channel-1\0U-raw')
      .digest('hex')}`;

    assert.equal(candidates[0], pseudonymizePdpaLineIdentifier('provider-user', 'channel-1', 'U-raw', current));
    assert.equal(candidates.includes(pseudonymizePdpaLineIdentifier('provider-user', 'channel-1', 'U-raw', previous)), true);
    assert.equal(candidates.includes(legacy(current)), true);
    assert.equal(candidates.includes(legacy(previous)), true);
    assert.equal(candidates.length, 4);
    assert.deepEqual(pdpaLineIdentifierLookupCandidates('provider-user', 'channel-1', candidates[0], { current }), [candidates[0]]);
  });
});

describe('lineReplyRetryKeyForMessage', () => {
  it('derives a stable UUID-shaped retry key from the persisted message id', () => {
    const first = lineReplyRetryKeyForMessage('msg_01jzq3w37b8s0kfc8mkf4wvh2a');
    const second = lineReplyRetryKeyForMessage('msg_01jzq3w37b8s0kfc8mkf4wvh2a');
    const other = lineReplyRetryKeyForMessage('msg_01jzq3w37b8s0kfc8mkf4wvh2b');

    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('isSupportedInboundEvent', () => {
  it('accepts message/follow/unfollow with a userId and rejects the rest', () => {
    assert.equal(isSupportedInboundEvent({ type: 'message', source: { userId: 'U1' } }), true);
    assert.equal(isSupportedInboundEvent({ type: 'follow', source: { userId: 'U1' } }), true);
    assert.equal(isSupportedInboundEvent({ type: 'unfollow', source: { userId: 'U1' } }), true);
    assert.equal(isSupportedInboundEvent({ type: 'message', source: {} }), false);
    assert.equal(isSupportedInboundEvent({ type: 'join' }), false);
  });
});

describe('validateOutboundText', () => {
  it('rejects empty/whitespace and over-limit text, accepts normal text', () => {
    assert.equal(validateOutboundText(''), 'text_required');
    assert.equal(validateOutboundText('   '), 'text_required');
    assert.equal(validateOutboundText('x'.repeat(OUTBOUND_TEXT_MAX_LENGTH + 1)), 'text_too_long');
    assert.equal(validateOutboundText('สวัสดีค่ะ'), null);
    assert.equal(validateOutboundText('x'.repeat(OUTBOUND_TEXT_MAX_LENGTH)), null);
  });
});

describe('statusAfterStaffReply', () => {
  it('advances active statuses to WAITING_CUSTOMER (ส่งข้อความ → รอลูกค้า)', () => {
    assert.equal(statusAfterStaffReply('NEW'), 'WAITING_CUSTOMER');
    assert.equal(statusAfterStaffReply('OPEN'), 'WAITING_CUSTOMER');
    assert.equal(statusAfterStaffReply('WAITING_INTERNAL'), 'WAITING_CUSTOMER');
    assert.equal(statusAfterStaffReply('WAITING_CUSTOMER'), 'WAITING_CUSTOMER');
    assert.equal(statusAfterStaffReply('FOLLOW_UP'), 'WAITING_CUSTOMER');
  });
  it('never advances terminal statuses', () => {
    assert.equal(statusAfterStaffReply('RESOLVED'), 'RESOLVED');
    assert.equal(statusAfterStaffReply('SPAM'), 'SPAM');
  });
});

describe('assignment ABAC scope (own/assigned + unassigned pickup)', () => {
  it('read-all roles see the whole inbox', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'FINANCE', 'ACCOUNTANT', 'AUDITOR_READONLY', 'MARKETING', 'COMPANY_VIEW']) {
      assert.equal(inboxSeesAllConversations([role]), true, role);
    }
  });
  it('sales/support/staff are read-scoped', () => {
    assert.equal(inboxSeesAllConversations(['SALES']), false);
    assert.equal(inboxSeesAllConversations(['STAFF']), false);
    assert.equal(inboxSeesAllConversations([]), false);
    assert.equal(inboxSeesAllConversations(['SALES', 'MANAGER']), true); // any broad role wins
  });
  it('read-scoped users see own/assigned and unassigned conversations only', () => {
    assert.equal(conversationInScope(['SALES'], 'u1', 'u1'), true);
    assert.equal(conversationInScope(['SALES'], 'u1', null), true);
    assert.equal(conversationInScope(['SALES'], 'u1', 'u2'), false);
    assert.equal(conversationInScope(['ADMIN'], 'u1', 'u2'), true);
  });
  it('write-all is limited to owner, admin, and manager', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER']) {
      assert.equal(conversationWriteInScope([role], 'u1', 'u2'), true, role);
    }
    for (const role of ['FINANCE', 'ACCOUNTANT', 'AUDITOR_READONLY', 'MARKETING', 'COMPANY_VIEW']) {
      assert.equal(conversationWriteInScope([role], 'u1', 'u2'), false, role);
    }
  });
  it('read-all does not grant write-all while assigned-to-self writes remain allowed', () => {
    assert.equal(conversationInScope(['COMPANY_VIEW', 'SALES'], 'u1', 'u2'), true);
    assert.equal(conversationWriteInScope(['COMPANY_VIEW', 'SALES'], 'u1', 'u2'), false);
    assert.equal(conversationWriteInScope(['SALES'], 'u1', 'u1'), true);
  });
});

describe('isConversationOverdue', () => {
  const now = new Date('2026-07-06T12:00:00Z');
  const past = new Date('2026-07-06T11:00:00Z');
  const future = new Date('2026-07-06T13:00:00Z');
  it('is overdue only when the first reply is missing past its due time', () => {
    assert.equal(isConversationOverdue({ status: 'NEW', firstRespondedAt: null, firstResponseDueAt: past }, now), true);
    assert.equal(isConversationOverdue({ status: 'OPEN', firstRespondedAt: null, firstResponseDueAt: future }, now), false);
    assert.equal(isConversationOverdue({ status: 'OPEN', firstRespondedAt: past, firstResponseDueAt: past }, now), false);
    assert.equal(isConversationOverdue({ status: 'NEW', firstRespondedAt: null, firstResponseDueAt: null }, now), false);
  });
  it('resolved/spam conversations are never overdue', () => {
    assert.equal(isConversationOverdue({ status: 'RESOLVED', firstRespondedAt: null, firstResponseDueAt: past }, now), false);
    assert.equal(isConversationOverdue({ status: 'SPAM', firstRespondedAt: null, firstResponseDueAt: past }, now), false);
  });
});

describe('normalizeConversationTags', () => {
  it('trims, drops empties, dedupes case-insensitively keeping first casing', () => {
    assert.deepEqual(normalizeConversationTags([' VIP ', 'vip', '', '  ', 'สนใจสินค้า']), { tags: ['VIP', 'สนใจสินค้า'] });
    assert.deepEqual(normalizeConversationTags([]), { tags: [] });
  });
  it('rejects non-arrays, non-string entries, long tags, and too many tags', () => {
    assert.deepEqual(normalizeConversationTags('VIP'), { error: 'tags_must_be_array' });
    assert.deepEqual(normalizeConversationTags([1]), { error: 'tags_must_be_strings' });
    assert.deepEqual(normalizeConversationTags(['x'.repeat(41)]), { error: 'tag_too_long' });
    assert.deepEqual(
      normalizeConversationTags(Array.from({ length: 11 }, (_, i) => `t${i}`)),
      { error: 'too_many_tags' },
    );
  });
  it('accepts exactly the boundary sizes', () => {
    assert.deepEqual(normalizeConversationTags(['x'.repeat(40)]), { tags: ['x'.repeat(40)] });
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    assert.deepEqual(normalizeConversationTags(ten), { tags: ten });
  });
});

describe('parseBusinessHours', () => {
  it('accepts the valid shape and rejects everything malformed', () => {
    assert.deepEqual(
      parseBusinessHours({ start: '09:00', end: '18:00', timezone: 'Asia/Bangkok' }),
      { start: '09:00', end: '18:00', timezone: 'Asia/Bangkok' },
    );
    assert.equal(parseBusinessHours(null), null);
    assert.equal(parseBusinessHours('9-18'), null);
    assert.equal(parseBusinessHours({ start: '9:00', end: '18:00', timezone: 'Asia/Bangkok' }), null);
    assert.equal(parseBusinessHours({ start: '18:00', end: '09:00', timezone: 'Asia/Bangkok' }), null);
    assert.equal(parseBusinessHours({ start: '09:00', end: '18:00' }), null);
  });
});

describe('effectiveInboxPolicy', () => {
  it('no row = spec defaults (30 min within 09:00-18:00 Asia/Bangkok)', () => {
    assert.deepEqual(effectiveInboxPolicy(null), {
      firstResponseMinutes: 30,
      businessHours: { start: '09:00', end: '18:00', timezone: 'Asia/Bangkok' },
    });
  });
  it('a saved row with null hours means a 24/7 clock', () => {
    assert.deepEqual(effectiveInboxPolicy({ firstResponseMinutes: 60, businessHoursJson: null }), {
      firstResponseMinutes: 60,
      businessHours: null,
    });
  });
});

describe('validateInboxPolicyInput', () => {
  const hours = { start: '09:00', end: '18:00', timezone: 'Asia/Bangkok' };
  it('accepts valid inputs with and without business hours', () => {
    assert.equal(validateInboxPolicyInput({ firstResponseMinutes: 30, businessHours: hours }), null);
    assert.equal(validateInboxPolicyInput({ firstResponseMinutes: 1440, businessHours: null }), null);
  });
  it('rejects out-of-range or non-integer minutes', () => {
    assert.equal(validateInboxPolicyInput({ firstResponseMinutes: 0, businessHours: null }), 'minutes_out_of_range');
    assert.equal(validateInboxPolicyInput({ firstResponseMinutes: 1441, businessHours: null }), 'minutes_out_of_range');
    assert.equal(validateInboxPolicyInput({ firstResponseMinutes: 7.5, businessHours: null }), 'minutes_out_of_range');
    assert.equal(validateInboxPolicyInput({ firstResponseMinutes: '30', businessHours: null }), 'minutes_out_of_range');
  });
  it('rejects malformed business hours with stable codes', () => {
    assert.equal(validateInboxPolicyInput({ firstResponseMinutes: 30, businessHours: 'x' }), 'invalid_business_hours');
    assert.equal(validateInboxPolicyInput({ firstResponseMinutes: 30, businessHours: { ...hours, start: '25:00' } }), 'invalid_business_hours');
    assert.equal(validateInboxPolicyInput({ firstResponseMinutes: 30, businessHours: { ...hours, end: '08:00' } }), 'business_hours_end_before_start');
    assert.equal(validateInboxPolicyInput({ firstResponseMinutes: 30, businessHours: { ...hours, timezone: 'Not/AZone' } }), 'invalid_timezone');
  });
});

describe('computeFirstResponseDueAt', () => {
  // Asia/Bangkok is UTC+7: 09:00 BKK = 02:00Z, 18:00 BKK = 11:00Z.
  const BKK = { start: '09:00', end: '18:00', timezone: 'Asia/Bangkok' };
  const iso = (d: Date) => d.toISOString();

  it('null business hours = flat wall-clock add', () => {
    assert.equal(iso(computeFirstResponseDueAt(new Date('2026-07-06T13:00:00Z'), 30, null)), '2026-07-06T13:30:00.000Z');
  });
  it('inside the window stays in the same day', () => {
    assert.equal(iso(computeFirstResponseDueAt(new Date('2026-07-06T03:00:00Z'), 30, BKK)), '2026-07-06T03:30:00.000Z');
  });
  it('before opening starts the clock at 09:00', () => {
    assert.equal(iso(computeFirstResponseDueAt(new Date('2026-07-05T23:00:00Z'), 30, BKK)), '2026-07-06T02:30:00.000Z');
  });
  it('after closing rolls to the next morning', () => {
    assert.equal(iso(computeFirstResponseDueAt(new Date('2026-07-06T13:00:00Z'), 30, BKK)), '2026-07-07T02:30:00.000Z');
  });
  it('splits the SLA across the close into the next day', () => {
    // 17:45 BKK: 15 min today + 15 min tomorrow morning.
    assert.equal(iso(computeFirstResponseDueAt(new Date('2026-07-06T10:45:00Z'), 30, BKK)), '2026-07-07T02:15:00.000Z');
  });
  it('spans multiple days for long SLAs', () => {
    // 9h window/day: 1200 min from 09:00 BKK = 540 + 540 + 120 -> 11:00 BKK two days later.
    assert.equal(iso(computeFirstResponseDueAt(new Date('2026-07-06T02:00:00Z'), 1200, BKK)), '2026-07-08T04:00:00.000Z');
  });
  it('an unknown timezone degrades to the flat add (ingestion must never crash)', () => {
    assert.equal(iso(computeFirstResponseDueAt(new Date('2026-07-06T13:00:00Z'), 30, { ...BKK, timezone: 'Not/AZone' })), '2026-07-06T13:30:00.000Z');
  });
});

describe('reply-send retry classification (A5)', () => {
  it('retries transient LINE errors, not auth/limit-type terminal ones', () => {
    assert.equal(isRetryableLineError('line_api_429'), true);
    assert.equal(isRetryableLineError('line_api_500'), true);
    assert.equal(isRetryableLineError('line_api_503'), true);
    assert.equal(isRetryableLineError('line_api_unreachable'), true);
    assert.equal(isRetryableLineError('invalid_access_token'), false); // 401 — bad token
    assert.equal(isRetryableLineError('line_api_400'), false);
    assert.equal(isRetryableLineError('line_api_403'), false);
    assert.equal(isRetryableLineError(undefined), false);
    assert.equal(isRetryableLineError(null), false);
  });

  it('backoff grows exponentially from 30s and caps at 1h', () => {
    const from = new Date('2026-07-09T00:00:00.000Z');
    assert.equal(computeReplySendBackoffAt(0, from).getTime() - from.getTime(), 30_000);
    assert.equal(computeReplySendBackoffAt(2, from).getTime() - from.getTime(), 120_000);
    assert.equal(computeReplySendBackoffAt(20, from).getTime() - from.getTime(), 3_600_000);
  });

  it('resolveReplySendOutcome: success is SENT', () => {
    assert.deepEqual(resolveReplySendOutcome({ ok: true, attemptCountAfter: 1, maxAttempts: REPLY_SEND_MAX_ATTEMPTS, now: new Date() }), { status: 'SENT' });
  });

  it('resolveReplySendOutcome: retryable failure with attempts left → PENDING + backoff', () => {
    const now = new Date('2026-07-09T00:00:00.000Z');
    const out = resolveReplySendOutcome({ ok: false, error: 'line_api_429', attemptCountAfter: 1, maxAttempts: 5, now });
    assert.equal(out.status, 'PENDING');
    assert.equal(out.nextAttemptAt?.getTime(), computeReplySendBackoffAt(1, now).getTime());
  });

  it('resolveReplySendOutcome: 429 Retry-After overrides exponential backoff', () => {
    const now = new Date('2026-07-09T00:00:00.000Z');
    const out = resolveReplySendOutcome({ ok: false, error: 'line_api_429', retryAfterSeconds: 75, attemptCountAfter: 1, maxAttempts: 5, now });
    assert.equal(out.status, 'PENDING');
    assert.equal(out.nextAttemptAt?.toISOString(), '2026-07-09T00:01:15.000Z');
  });

  it('resolveReplySendOutcome: terminal error → FAILED even with attempts left', () => {
    assert.deepEqual(resolveReplySendOutcome({ ok: false, error: 'invalid_access_token', attemptCountAfter: 1, maxAttempts: 5, now: new Date() }), { status: 'FAILED' });
  });

  it('resolveReplySendOutcome: exhausted retries → FAILED', () => {
    assert.deepEqual(resolveReplySendOutcome({ ok: false, error: 'line_api_429', attemptCountAfter: 5, maxAttempts: 5, now: new Date() }), { status: 'FAILED' });
  });

  it('isTerminalMediaError retries scanner outages but not rejected content', () => {
    assert.equal(isTerminalMediaError('content_too_large'), true);
    assert.equal(isTerminalMediaError('media_type_unsupported'), true);
    assert.equal(isTerminalMediaError('media_security_rejected'), true);
    assert.equal(isTerminalMediaError('media_scan_failed'), false);
    assert.equal(isTerminalMediaError('line_api_429'), false);
    assert.equal(isTerminalMediaError(null), false);
  });
});
