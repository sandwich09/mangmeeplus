import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateConnectForm,
  channelStatusLabel,
  channelErrorMessage,
  webhookDisplayUrl,
  conversationIsOverdue,
  relativeTimeTh,
  avatarInitial,
  avatarColor,
  sendErrorMessage,
  messageContentUrl,
  paymentProofContentUrl,
  stickerImageUrl,
  locationMapUrl,
  mediaErrorMessage,
  quickReplyQuery,
  filterTemplates,
  CONVERSATION_PRIORITY_META,
  INBOX_PRIORITY_ORDER,
  addConversationTag,
  slaCountdown,
  validateInboxPolicyForm,
} from './crm-inbox.logic';

const validForm = {
  displayName: 'ร้านของฉัน',
  lineChannelId: '1234567890',
  channelSecret: 'secret-secret',
  accessToken: 'token-token-1234',
};

describe('validateConnectForm', () => {
  it('accepts a valid form', () => {
    assert.equal(validateConnectForm(validForm), null);
  });
  it('rejects missing name, bad channel id, short secret/token with Thai messages', () => {
    assert.match(validateConnectForm({ ...validForm, displayName: ' ' }) ?? '', /ชื่อ/);
    assert.match(validateConnectForm({ ...validForm, lineChannelId: 'abc' }) ?? '', /Channel ID/);
    assert.match(validateConnectForm({ ...validForm, channelSecret: 'x' }) ?? '', /Channel Secret/);
    assert.match(validateConnectForm({ ...validForm, accessToken: 'x' }) ?? '', /Token/);
  });
});

describe('channelStatusLabel', () => {
  it('maps every status to a label and tone', () => {
    assert.equal(channelStatusLabel('ACTIVE').tone, 'green');
    assert.equal(channelStatusLabel('CONNECTED').tone, 'amber');
    assert.equal(channelStatusLabel('ERROR').tone, 'red');
    assert.equal(channelStatusLabel('DISABLED').tone, 'gray');
    assert.equal(channelStatusLabel('PENDING_SETUP').tone, 'gray');
  });
});

describe('channelErrorMessage', () => {
  it('translates known codes and passes through unknown ones', () => {
    assert.match(channelErrorMessage('invalid_access_token') ?? '', /Token/);
    assert.match(channelErrorMessage('line_api_503') ?? '', /line_api_503/);
    assert.equal(channelErrorMessage(undefined), null);
  });
});

describe('webhookDisplayUrl', () => {
  it('prefers the absolute URL, falls back to the path, then null', () => {
    assert.equal(
      webhookDisplayUrl({ webhookUrl: 'https://api.x/v1/crm/line/webhook/k', webhookPath: '/v1/crm/line/webhook/k' }),
      'https://api.x/v1/crm/line/webhook/k',
    );
    assert.equal(webhookDisplayUrl({ webhookPath: '/v1/crm/line/webhook/k' }), '/v1/crm/line/webhook/k');
    assert.equal(webhookDisplayUrl({}), null);
  });
});

describe('conversationIsOverdue', () => {
  const now = new Date('2026-07-06T12:00:00Z');
  const base = { status: 'NEW' as const, firstRespondedAt: undefined, firstResponseDueAt: '2026-07-06T11:00:00Z' };
  it('flags unanswered conversations past their first-response due time', () => {
    assert.equal(conversationIsOverdue(base, now), true);
    assert.equal(conversationIsOverdue({ ...base, firstResponseDueAt: '2026-07-06T13:00:00Z' }, now), false);
    assert.equal(conversationIsOverdue({ ...base, firstRespondedAt: '2026-07-06T11:30:00Z' }, now), false);
    assert.equal(conversationIsOverdue({ ...base, status: 'RESOLVED' }, now), false);
  });
});

describe('relativeTimeTh', () => {
  const now = new Date('2026-07-06T12:00:00Z');
  it('formats minutes/hours/days in Thai', () => {
    assert.equal(relativeTimeTh('2026-07-06T11:55:00Z', now), '5 นาที');
    assert.equal(relativeTimeTh('2026-07-06T09:00:00Z', now), '3 ชม.');
    assert.equal(relativeTimeTh('2026-07-04T12:00:00Z', now), '2 วัน');
    assert.equal(relativeTimeTh('2026-07-06T11:59:40Z', now), 'เมื่อครู่');
    assert.equal(relativeTimeTh(undefined, now), '');
  });
});

describe('avatarInitial / avatarColor', () => {
  it('takes the first character, skipping the คุณ honorific', () => {
    assert.equal(avatarInitial('คุณฝ้าย รักดี'), 'ฝ');
    assert.equal(avatarInitial('Nice'), 'N');
    assert.equal(avatarInitial('  '), '?');
    assert.equal(avatarInitial(undefined), '?');
  });
  it('is stable per customer id', () => {
    assert.equal(avatarColor('cust-1'), avatarColor('cust-1'));
    assert.match(avatarColor('cust-1'), /^#[0-9A-F]{6}$/i);
  });
});

describe('sendErrorMessage', () => {
  it('maps API send errors to plain Thai', () => {
    assert.match(sendErrorMessage('400 channel_disabled'), /ปิดใช้งาน/);
    assert.match(sendErrorMessage('customer_unfollowed'), /เลิกติดตาม/);
    assert.match(sendErrorMessage('text_too_long'), /ยาวเกินไป/);
    assert.match(sendErrorMessage('boom'), /ไม่สำเร็จ/);
  });
});

describe('media helpers', () => {
  it('builds the same-origin content URL the API serves', () => {
    assert.equal(
      messageContentUrl('co-1', 'conv-2', 'msg-3'),
      '/api/v1/companies/co-1/crm/conversations/conv-2/messages/msg-3/content',
    );
  });
  it('builds the finance-only purpose-checked payment proof URL', () => {
    assert.equal(
      paymentProofContentUrl('co-1', 'conv-2', 'msg-3'),
      '/api/v1/companies/co-1/crm/payment-proofs/conv-2/messages/msg-3/content',
    );
  });
  it('builds the LINE sticker CDN URL', () => {
    assert.equal(
      stickerImageUrl('52002734'),
      'https://stickershop.line-scdn.net/stickershop/v1/sticker/52002734/android/sticker.png',
    );
  });
  it('builds a map link from coordinates', () => {
    assert.equal(locationMapUrl(13.75, 100.5), 'https://www.google.com/maps?q=13.75,100.5');
  });
  it('explains media errors in plain Thai', () => {
    assert.match(mediaErrorMessage('content_too_large'), /ใหญ่เกิน/);
    assert.match(mediaErrorMessage('media_type_unsupported'), /ยังไม่รองรับ/);
    assert.match(mediaErrorMessage('line_api_404'), /หมดอายุ/);
  });
});

describe('quick replies', () => {
  const templates = [
    { title: 'ทักทาย', bodyText: 'สวัสดีค่ะ', category: 'ทั่วไป' },
    { title: 'ปิดการขาย', bodyText: 'ขอบคุณที่อุดหนุนค่ะ' },
    { title: 'ที่อยู่ร้าน', bodyText: 'ร้านอยู่ที่สยาม', category: 'ข้อมูล' },
  ];

  it('activates only on a leading slash with a single line', () => {
    assert.equal(quickReplyQuery('/'), '');
    assert.equal(quickReplyQuery('/ทัก'), 'ทัก');
    assert.equal(quickReplyQuery('สวัสดี'), null);
    assert.equal(quickReplyQuery('/ทัก\nสองบรรทัด'), null);
  });

  it('filters by title, category, and body — case-insensitive', () => {
    assert.deepEqual(filterTemplates(templates, 'ทัก').map((t) => t.title), ['ทักทาย']);
    assert.deepEqual(filterTemplates(templates, 'ข้อมูล').map((t) => t.title), ['ที่อยู่ร้าน']);
    assert.deepEqual(filterTemplates(templates, 'ขอบคุณ').map((t) => t.title), ['ปิดการขาย']);
    assert.equal(filterTemplates(templates, '').length, 3);
    assert.equal(filterTemplates(templates, 'ไม่มีทางเจอ').length, 0);
  });
});

describe('priority + tags helpers', () => {
  it('has Thai meta for every priority in menu order', () => {
    assert.deepEqual(INBOX_PRIORITY_ORDER, ['LOW', 'NORMAL', 'HIGH', 'URGENT']);
    for (const p of INBOX_PRIORITY_ORDER) {
      assert.ok(CONVERSATION_PRIORITY_META[p].label.length > 0);
      assert.match(CONVERSATION_PRIORITY_META[p].color, /^#/);
    }
    assert.equal(CONVERSATION_PRIORITY_META.URGENT.label, 'ด่วน');
  });

  it('addConversationTag trims, blocks dupes case-insensitively, and bounds size/count', () => {
    assert.deepEqual(addConversationTag([], ' VIP '), ['VIP']);
    assert.deepEqual(addConversationTag(['VIP'], 'สนใจสินค้า'), ['VIP', 'สนใจสินค้า']);
    assert.equal(addConversationTag(['VIP'], 'vip'), null);
    assert.equal(addConversationTag([], '   '), null);
    assert.equal(addConversationTag([], 'x'.repeat(41)), null);
    assert.equal(addConversationTag(Array.from({ length: 10 }, (_, i) => `t${i}`), 'ใหม่'), null);
  });
});

describe('slaCountdown', () => {
  const now = new Date('2026-07-06T12:00:00Z');
  const base = { status: 'NEW' as const, firstRespondedAt: undefined, firstResponseDueAt: '2026-07-06T13:00:00Z' };

  it('is hidden once answered, resolved/spam, or without a due time', () => {
    assert.equal(slaCountdown({ ...base, firstRespondedAt: '2026-07-06T11:30:00Z' }, now), null);
    assert.equal(slaCountdown({ ...base, status: 'RESOLVED' }, now), null);
    assert.equal(slaCountdown({ ...base, status: 'SPAM' }, now), null);
    assert.equal(slaCountdown({ ...base, firstResponseDueAt: undefined }, now), null);
  });

  it('walks green → amber (≤15 นาที) → red with Thai labels', () => {
    assert.deepEqual(slaCountdown(base, now), { state: 'ok', label: 'เหลือ 1 ชม.' });
    assert.deepEqual(slaCountdown({ ...base, firstResponseDueAt: '2026-07-06T12:45:00Z' }, now), { state: 'ok', label: 'เหลือ 45 นาที' });
    assert.deepEqual(slaCountdown({ ...base, firstResponseDueAt: '2026-07-06T12:10:00Z' }, now), { state: 'warning', label: 'เหลือ 10 นาที' });
    assert.deepEqual(slaCountdown({ ...base, firstResponseDueAt: '2026-07-06T11:40:00Z' }, now), { state: 'overdue', label: 'เกิน 20 นาที' });
    assert.deepEqual(slaCountdown({ ...base, firstResponseDueAt: '2026-07-06T09:00:00Z' }, now), { state: 'overdue', label: 'เกิน 3 ชม.' });
  });
});

describe('validateInboxPolicyForm', () => {
  const valid = { firstResponseMinutes: '30', businessHoursEnabled: true, start: '09:00', end: '18:00' };
  it('accepts valid forms with and without business hours', () => {
    assert.equal(validateInboxPolicyForm(valid), null);
    assert.equal(validateInboxPolicyForm({ ...valid, businessHoursEnabled: false, start: '', end: '' }), null);
  });
  it('rejects bad minutes and inverted/invalid hours in Thai', () => {
    assert.match(validateInboxPolicyForm({ ...valid, firstResponseMinutes: '0' }) ?? '', /นาที/);
    assert.match(validateInboxPolicyForm({ ...valid, firstResponseMinutes: 'x' }) ?? '', /นาที/);
    assert.match(validateInboxPolicyForm({ ...valid, start: '9:00' }) ?? '', /HH:MM/);
    assert.match(validateInboxPolicyForm({ ...valid, end: '08:00' }) ?? '', /หลังเวลาเปิด/);
  });
});
