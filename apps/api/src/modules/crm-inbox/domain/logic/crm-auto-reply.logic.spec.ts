import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchStandaloneGreeting,
  evaluateCrmAutonomousOutboundPolicy,
  formatGreetingReply,
  extractBookingContactReply,
  formatBookingContactQuestion,
  formatBookingConfirm,
  formatBookingReviewQuestion,
  formatSlotProposal,
  missingBookingContactFields,
  normalizeLinePlainText,
  PER_CONVERSATION_AUTO_REPLY_DAILY_CAP,
  resolveConversationAutoReplyCount,
  resolvePublishedService,
  resolveRequestedBookingWindow,
  withinCap,
} from './crm-auto-reply.logic';

describe('crm-auto-reply.logic', () => {
  it('enforces the deterministic outbound adversarial corpus', () => {
    const cases = [
      { text: 'ดูรายละเอียดที่ https://evil.example/phish', reason: 'unapproved_url' },
      { text: 'เปิด hxxps://evil.example เพื่อยืนยันตัวตน', reason: 'unapproved_url' },
      { text: 'กรุณาโอนเงินเข้าบัญชีที่แจ้งไว้', reason: 'payment' },
      { text: 'รับประกันว่าจะคืนเงินให้แน่นอนค่ะ', reason: 'commitment' },
      { text: 'ส่ง OTP และรหัสผ่านกลับมาได้เลยค่ะ', reason: 'pii' },
      { text: 'ติดต่อเราได้ที่ 0812345678', reason: 'pii' },
    ] as const;

    for (const testCase of cases) {
      assert.deepEqual(
        evaluateCrmAutonomousOutboundPolicy({ draftText: testCase.text }),
        { action: 'review', reason: testCase.reason },
      );
    }
    assert.deepEqual(
      evaluateCrmAutonomousOutboundPolicy({ draftText: 'ข้อความปลอดภัย', modelNeedsHuman: true }),
      { action: 'review', reason: 'model_human_signal' },
    );
  });

  it('allows safe text and only explicitly allowlisted HTTPS domains', () => {
    assert.deepEqual(
      evaluateCrmAutonomousOutboundPolicy({ draftText: 'เปิดทุกวัน 09:00-18:00 ราคา 500 บาทค่ะ' }),
      { action: 'allow' },
    );
    assert.deepEqual(
      evaluateCrmAutonomousOutboundPolicy({
        draftText: 'ดูข้อมูลที่ https://shop.example.com/products/1',
        allowedDomains: ['shop.example.com'],
      }),
      { action: 'allow' },
    );
    assert.deepEqual(
      evaluateCrmAutonomousOutboundPolicy({
        draftText: 'ดูข้อมูลที่ https://cdn.example.com/file',
        allowedDomains: ['*.example.com'],
      }),
      { action: 'allow' },
    );
    assert.deepEqual(
      evaluateCrmAutonomousOutboundPolicy({
        draftText: 'ดูข้อมูลที่ http://shop.example.com',
        allowedDomains: ['shop.example.com'],
      }),
      { action: 'review', reason: 'unapproved_url' },
    );
  });

  it('resets the conversation counter when checkedAt is before today in Bangkok', () => {
    const out = resolveConversationAutoReplyCount(
      { autoReplyCount: 4, autoReplyCheckedAt: new Date('2026-07-09T16:59:59.999Z') },
      new Date('2026-07-10T00:00:00.000Z'),
    );

    assert.deepEqual(out, { countToday: 0, isNewWindow: true });
  });

  it('keeps the conversation counter when checkedAt is today in Bangkok', () => {
    const out = resolveConversationAutoReplyCount(
      { autoReplyCount: 3, autoReplyCheckedAt: new Date('2026-07-09T17:00:00.000Z') },
      new Date('2026-07-10T00:00:00.000Z'),
    );

    assert.deepEqual(out, { countToday: 3, isNewWindow: false });
  });

  it('treats null checkedAt as a new window', () => {
    const out = resolveConversationAutoReplyCount(
      { autoReplyCount: 3, autoReplyCheckedAt: null },
      new Date('2026-07-10T00:00:00.000Z'),
    );

    assert.deepEqual(out, { countToday: 0, isNewWindow: true });
  });

  it('matches a standalone greeting but never one carrying real content', () => {
    // Standalone greetings (with politeness / emoji) → deterministic reply.
    assert.equal(matchStandaloneGreeting('สวัสดี'), 'th');
    assert.equal(matchStandaloneGreeting('สวัสดีคับ'), 'th');
    assert.equal(matchStandaloneGreeting('หวัดดีค่ะ'), 'th');
    assert.equal(matchStandaloneGreeting('hello!'), 'en');
    assert.equal(matchStandaloneGreeting('hi 👋'), 'en');
    assert.equal(matchStandaloneGreeting('Good morning'), 'en');
    // A greeting wrapped around a real question is NOT a greeting — the question
    // must reach the AI.
    assert.equal(matchStandaloneGreeting('สวัสดี อยากถามราคา'), null);
    assert.equal(matchStandaloneGreeting('hello, are you open?'), null);
    assert.equal(matchStandaloneGreeting('สินค้าชื่อ Hello'), null);
    // Bare politeness / affirmation is not a greeting (no greeting core).
    assert.equal(matchStandaloneGreeting('ครับ'), null);
    assert.equal(matchStandaloneGreeting('ค่ะ'), null);
    assert.equal(matchStandaloneGreeting('โอเค'), null);
    assert.equal(matchStandaloneGreeting(''), null);
  });

  it('greeting reply is a fixed template per language', () => {
    assert.match(formatGreetingReply('th'), /สวัสดีค่ะ/);
    assert.match(formatGreetingReply('en'), /Hello/);
  });

  it('revalidates an AI-selected service id against the published service catalog', () => {
    const catalog = [
      { id: 'svc-1', sku: 'S1', name: 'นวดไทย', kind: 'SERVICE' as const, unit: 'ครั้ง', bookingDurationMinutes: 90 },
      { id: 'product-1', sku: 'P1', name: 'แชมพู', kind: 'STOCKABLE' as const, unit: 'ขวด' },
    ];
    assert.equal(resolvePublishedService(catalog, 'svc-1')?.name, 'นวดไทย');
    assert.equal(resolvePublishedService(catalog, 'product-1'), undefined);
    assert.equal(resolvePublishedService(catalog, 'invented-id'), undefined);
  });

  it('blocks at the per-conversation cap boundary', () => {
    assert.equal(withinCap(PER_CONVERSATION_AUTO_REPLY_DAILY_CAP - 1, PER_CONVERSATION_AUTO_REPLY_DAILY_CAP), true);
    assert.equal(withinCap(PER_CONVERSATION_AUTO_REPLY_DAILY_CAP, PER_CONVERSATION_AUTO_REPLY_DAILY_CAP), false);
  });

  it('resolves extracted date+time to a Bangkok booking window on the 30-minute grid', () => {
    const out = resolveRequestedBookingWindow(
      { date: '2099-07-10', timeHHmm: '14:30' },
      new Date('2099-07-09T00:00:00.000Z'),
      90,
    );

    assert.equal(out.kind, 'window');
    if (out.kind !== 'window') return;
    assert.equal(out.startAt.toISOString(), '2099-07-10T07:30:00.000Z');
    assert.equal(out.endAt.toISOString(), '2099-07-10T09:00:00.000Z');
  });

  it('uses the explicit catalog booking duration', () => {
    const out = resolveRequestedBookingWindow(
      { date: '2099-07-10', timeHHmm: '14:00' },
      new Date('2099-07-09T00:00:00.000Z'),
      60,
    );

    assert.equal(out.kind, 'window');
    if (out.kind !== 'window') return;
    assert.equal(out.endAt.getTime() - out.startAt.getTime(), 60 * 60_000);
  });

  it('asks for time when extraction has a date but no time', () => {
    assert.deepEqual(
      resolveRequestedBookingWindow({ date: '2099-07-10' }, new Date('2099-07-09T00:00:00.000Z'), 60),
      { kind: 'needs_time' },
    );
  });

  it('rejects past and outside-hours extracted windows', () => {
    assert.deepEqual(
      resolveRequestedBookingWindow({ date: '2026-07-09', timeHHmm: '14:00' }, new Date('2026-07-10T00:00:00.000Z'), 60),
      { kind: 'invalid' },
    );
    assert.deepEqual(
      resolveRequestedBookingWindow({ date: '2099-07-10', timeHHmm: '20:00' }, new Date('2099-07-09T00:00:00.000Z'), 60),
      { kind: 'invalid' },
    );
  });

  it('requires the catalog-duration window to end by 20:00 Bangkok', () => {
    assert.equal(
      resolveRequestedBookingWindow(
        { date: '2099-07-10', timeHHmm: '18:00' },
        new Date('2099-07-09T00:00:00.000Z'),
        120,
      ).kind,
      'window',
    );
    assert.deepEqual(
      resolveRequestedBookingWindow(
        { date: '2099-07-10', timeHHmm: '18:30' },
        new Date('2099-07-09T00:00:00.000Z'),
        120,
      ),
      { kind: 'invalid' },
    );
  });

  it('formats deterministic booking confirmation and slot proposal text', () => {
    const confirm = formatBookingConfirm(
      'ตัดผม',
      new Date('2099-07-10T07:00:00.000Z'),
      new Date('2099-07-10T08:00:00.000Z'),
      'Head Office',
    );
    assert.match(confirm, /ยืนยันการจองสำเร็จ/);
    assert.match(confirm, /ตัดผม/);
    assert.match(confirm, /14:00-15:00/);
    assert.match(confirm, /Head Office/);
    assert.match(confirm, /สถานะ: ยืนยันแล้ว/);

    const proposal = formatSlotProposal(
      ['2099-07-10T02:00:00.000Z', '2099-07-10T02:30:00.000Z', '2099-07-10T03:00:00.000Z'],
      new Date('2099-07-09T00:00:00.000Z'),
    );
    assert.match(proposal, /เวลาว่างที่จองได้/);
    assert.match(proposal, /09:00/);
    assert.doesNotMatch(proposal, /ยังไม่ว่าง/);
    assert.match(formatSlotProposal([], new Date('2099-07-09T00:00:00.000Z')), /วันอื่น/);
  });

  it('collects only missing booking contact and renders a complete double-confirm review', () => {
    assert.deepEqual(missingBookingContactFields({
      displayName: 'คุณลูกค้า',
      source: 'LINE',
      originSource: 'LINE',
      createdByType: 'SYSTEM',
    }), ['name', 'phone']);
    assert.deepEqual(missingBookingContactFields({
      displayName: 'Sunday',
      primaryPhone: '0625598598',
      source: 'LINE',
      originSource: 'LINE',
      createdByType: 'SYSTEM',
    }), []);
    assert.deepEqual(missingBookingContactFields({
      displayName: 'ชื่อที่พนักงานบันทึก',
      source: 'LINE',
      originSource: 'LINE',
      createdByType: 'SYSTEM',
      updatedByUserId: 'staff-1',
    }), ['phone']);
    assert.match(formatBookingContactQuestion(['name', 'phone']), /ชื่อผู้จองและเบอร์โทร/);
    assert.deepEqual(
      extractBookingContactReply('ชื่อ Sunday เบอร์ 0625598598', ['name', 'phone']),
      { displayName: 'Sunday', primaryPhone: '0625598598' },
    );
    assert.deepEqual(extractBookingContactReply('ขายอะไรบ้าง', ['name', 'phone']), {});
    assert.deepEqual(extractBookingContactReply('ยืนยัน', ['name', 'phone']), {});

    const review = formatBookingReviewQuestion(
      'Court Pink',
      new Date('2099-07-10T07:00:00.000Z'),
      new Date('2099-07-10T08:00:00.000Z'),
      'Head Office',
      'Sunday',
      '0625598598',
    );
    for (const expected of ['Court Pink', 'วันที่:', '14:00-15:00', 'Head Office', 'Sunday', '0625598598', 'ยืนยัน', 'ยกเลิก']) {
      assert.match(review, new RegExp(expected));
    }
  });

  it('labels a truncated availability list and emits LINE-safe plain text', () => {
    const slots = Array.from({ length: 7 }, (_, index) => new Date(
      Date.parse('2099-07-10T02:00:00.000Z') + index * 30 * 60_000,
    ).toISOString());
    const proposal = formatSlotProposal(slots, new Date('2099-07-09T00:00:00.000Z'));
    assert.match(proposal, /5 ช่วงแรกจาก 7 ช่วง/);
    assert.equal(normalizeLinePlainText('**Court Pink** ราคา `750` บาท'), 'Court Pink ราคา 750 บาท');
  });
});
