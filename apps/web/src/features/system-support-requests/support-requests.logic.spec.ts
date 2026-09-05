import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORT_QUEUE_TABS,
  canMarkAnswered,
  canResumeAi,
  notifiedSummary,
  supportAnswerHref,
  supportAnswerLabel,
  supportClosedReasonTh,
  supportStatusChip,
  waitedForTh,
} from './support-requests.logic';

const item = (over: Record<string, unknown> = {}) => ({
  id: 'sr-1',
  status: 'OPEN' as const,
  askerLabel: 'ร้านนิด',
  askerRef: 'edface',
  requestedAt: '2026-09-05T02:00:00.000Z',
  lineNotifiedCount: 0,
  emailSent: true,
  ...over,
}) as any;

describe('the support inbox reads waiting time in the largest honest unit', () => {
  const now = new Date('2026-09-05T02:00:00.000Z');
  const at = (ms: number) => waitedForTh(new Date(now.getTime() - ms).toISOString(), now);

  it('says minutes for the first hour, because "0 ชั่วโมง" reads as "just now"', () => {
    assert.equal(at(20_000), 'เมื่อสักครู่');
    assert.equal(at(60_000), '1 นาที');
    assert.equal(at(50 * 60_000), '50 นาที');
    assert.equal(at(60 * 60_000), '1 ชั่วโมง');
    assert.equal(at(23 * 3_600_000), '23 ชั่วโมง');
    assert.equal(at(25 * 3_600_000), '1 วัน');
  });

  it('refuses to invent a duration from a clock it cannot read', () => {
    assert.equal(waitedForTh('not-a-date', now), '—');
    assert.equal(waitedForTh('2026-09-06T00:00:00.000Z', now), '—', 'a future stamp is not "-1 นาที"');
  });
});

describe('what the inbox says reached a person', () => {
  // Owner 2026-09-05: admins are not LINE-linked, so zero pushes is the NORMAL reading. Colouring
  // it as a fault would train operators to ignore the one colour that matters.
  it('treats the support letter alone as somebody having been told', () => {
    const chip = notifiedSummary(item({ lineNotifiedCount: 0, emailSent: true }));
    assert.equal(chip.tone, 'neutral');
    assert.match(chip.label, /อีเมลทีมงาน/);
    assert.equal(chip.label.includes('LINE'), false);
  });

  it('names both rails when both landed', () => {
    const chip = notifiedSummary(item({ lineNotifiedCount: 2, emailSent: true }));
    assert.match(chip.label, /อีเมลทีมงาน · LINE 2 คน/);
  });

  it('flags only the reading that means nobody was told', () => {
    const chip = notifiedSummary(item({ lineNotifiedCount: 0, emailSent: false }));
    assert.equal(chip.tone, 'danger');
    assert.match(chip.label, /เห็นที่หน้านี้เท่านั้น/, 'and says where the request still is');
  });
});

describe('where an operator goes to answer', () => {
  it('sends a shop to its message box and an applicant to the queue', () => {
    const shop = item({ companyId: 'co-1' });
    assert.equal(supportAnswerHref(shop), '/system/partners/co-1');
    assert.equal(supportAnswerLabel(shop), 'เปิดหน้าร้าน');

    const applicant = item({ signupRequestId: 'sr-signup-1' });
    assert.equal(supportAnswerHref(applicant), '/system/signup-requests');
    assert.equal(supportAnswerLabel(applicant), 'เปิดคิวสมัคร');
  });

  it('offers no link at all for someone with neither, rather than a dead end', () => {
    assert.equal(supportAnswerHref(item()), null);
  });
});

describe('which buttons a row may offer', () => {
  it('marks answered only while the request is still open, but resumes AI until it closes', () => {
    assert.equal(canMarkAnswered('OPEN'), true);
    assert.equal(canMarkAnswered('ANSWERED'), false);
    assert.equal(canResumeAi('ANSWERED'), true, 'answered still leaves the assistant paused');
    assert.equal(canResumeAi('CLOSED'), false);
  });

  it('names every status and every closing reason in Thai', () => {
    assert.deepEqual(SUPPORT_QUEUE_TABS.map((t) => t.key), ['OPEN', 'ANSWERED', 'CLOSED']);
    assert.equal(supportStatusChip('OPEN').tone, 'warning');
    assert.equal(supportStatusChip('ANSWERED').tone, 'success');
    assert.equal(supportClosedReasonTh('customer_resumed'), 'ลูกค้าเรียก AI กลับเอง');
    assert.equal(supportClosedReasonTh('expired'), 'ครบ 24 ชั่วโมง');
    assert.equal(supportClosedReasonTh(undefined), null);
  });
});
