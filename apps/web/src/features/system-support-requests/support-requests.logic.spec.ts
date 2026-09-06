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
  supportReopenedChip,
  supportStatusChip,
  waitedForTh,
  waitedLabelTh,
  type Chip,
} from './support-requests.logic';

const item = (over: Record<string, unknown> = {}) => {
  const requestedAt = (over.requestedAt as string) ?? '2026-09-05T02:00:00.000Z';
  return {
    id: 'sr-1',
    status: 'OPEN' as const,
    askerLabel: 'ร้านนิด',
    askerRef: 'edface',
    requestedAt,
    // Equal to `requestedAt` until the customer writes again, which is what the API sends.
    lastMessageAt: requestedAt,
    reopenedCount: 0,
    lineNotifiedCount: 0,
    emailSent: true,
    notifyState: 'notified' as const,
    ...over,
  } as any;
};

describe('the support inbox reads waiting time in the largest honest unit', () => {
  const now = new Date('2026-09-05T02:00:00.000Z');
  const at = (ms: number) => waitedForTh(item({ requestedAt: new Date(now.getTime() - ms).toISOString() }), now);

  it('says minutes for the first hour, because "0 ชั่วโมง" reads as "just now"', () => {
    assert.equal(at(20_000), 'เมื่อสักครู่');
    assert.equal(at(60_000), '1 นาที');
    assert.equal(at(50 * 60_000), '50 นาที');
    assert.equal(at(60 * 60_000), '1 ชั่วโมง');
    assert.equal(at(23 * 3_600_000), '23 ชั่วโมง');
    assert.equal(at(25 * 3_600_000), '1 วัน');
  });

  it('refuses to invent a duration from a clock it cannot read', () => {
    assert.equal(waitedForTh(item({ requestedAt: 'not-a-date' }), now), '—');
    assert.equal(waitedForTh(item({ requestedAt: '2026-09-06T00:00:00.000Z' }), now), '—',
      'a future stamp is not "-1 นาที"');
  });

  // A settled row that keeps counting reads as a customer still waiting — the one thing this
  // column exists to say, said wrongly.
  it('stops the clock when the request was answered or closed, and renames the column', () => {
    const answered = item({
      status: 'ANSWERED',
      requestedAt: '2026-09-05T00:00:00.000Z',
      answeredAt: '2026-09-05T00:30:00.000Z',
    });
    const muchLater = new Date('2026-09-09T00:00:00.000Z');
    assert.equal(waitedForTh(answered, muchLater), '30 นาที', 'not four days');
    assert.equal(waitedLabelTh(answered), 'ใช้เวลา');

    const closed = item({
      status: 'CLOSED',
      requestedAt: '2026-09-05T00:00:00.000Z',
      closedAt: '2026-09-05T02:00:00.000Z',
    });
    assert.equal(waitedForTh(closed, muchLater), '2 ชั่วโมง');
    assert.equal(waitedLabelTh(closed), 'ใช้เวลา');

    assert.equal(waitedLabelTh(item()), 'รอมานาน', 'an open request is still waiting');
  });

  // Answering is when the waiting ended; the close that follows it is bookkeeping.
  it('prefers answeredAt over closedAt when a request has both', () => {
    const both = item({
      status: 'CLOSED',
      requestedAt: '2026-09-05T00:00:00.000Z',
      answeredAt: '2026-09-05T00:10:00.000Z',
      closedAt: '2026-09-05T06:00:00.000Z',
    });
    assert.equal(waitedForTh(both, now), '10 นาที');
  });

  /**
   * UAT 2026-09-06. The customer answered the answer, so the row is OPEN again with `answeredAt`
   * still on it — and both halves of the old rule were then wrong: the clock stopped at an answer
   * nobody is waiting on any more, and it would have counted from an ask two days older than the
   * message actually sitting unanswered.
   */
  it('restarts the clock at the newest customer message, and runs it again on a reopened row', () => {
    const reopened = item({
      status: 'OPEN',
      requestedAt: '2026-09-05T00:00:00.000Z',
      answeredAt: '2026-09-05T00:30:00.000Z',
      lastMessageAt: '2026-09-05T01:00:00.000Z',
      reopenedCount: 1,
    });
    assert.equal(waitedForTh(reopened, now), '1 ชั่วโมง', 'since THEY last wrote, not since they asked');
    assert.equal(waitedLabelTh(reopened), 'รอมานาน', 'somebody is waiting again');
  });

  it('still counts a plain open request from the ask, because that is its newest message', () => {
    const fresh = item({ requestedAt: '2026-09-05T01:00:00.000Z' });
    assert.equal(waitedForTh(fresh, now), '1 ชั่วโมง');
  });

  /**
   * Review 2026-09-06 (F5). A row that was answered, written back to, then closed had its end
   * (`answeredAt`) BEFORE its start (`lastMessageAt`) — a negative duration, printed as "ใช้เวลา —"
   * over a conversation that plainly took some time. The end is whichever settling stamp is not
   * older than the start.
   */
  it('reads a reopened-then-closed row from the reopen, not from the answer before it', () => {
    const reopenedThenClosed = item({
      status: 'CLOSED',
      requestedAt: '2026-09-05T00:00:00.000Z',
      answeredAt: '2026-09-05T00:30:00.000Z',
      lastMessageAt: '2026-09-05T01:00:00.000Z',
      reopenedCount: 1,
      closedAt: '2026-09-05T02:00:00.000Z',
    });
    assert.equal(waitedForTh(reopenedThenClosed, now), '1 ชั่วโมง', 'not "—"');
    assert.equal(waitedLabelTh(reopenedThenClosed), 'ใช้เวลา');
  });

  it('reads a reopened-then-answered-again row from the second answer', () => {
    const answeredTwice = item({
      status: 'ANSWERED',
      requestedAt: '2026-09-05T00:00:00.000Z',
      lastMessageAt: '2026-09-05T01:00:00.000Z',
      answeredAt: '2026-09-05T01:20:00.000Z',
      reopenedCount: 1,
    });
    assert.equal(waitedForTh(answeredTwice, now), '20 นาที', 'this round trip, not the whole thread');
    assert.equal(waitedLabelTh(answeredTwice), 'ใช้เวลา');
  });

  it('never prints a negative wait, whatever order the stamps arrive in', () => {
    const impossible = item({
      status: 'CLOSED',
      requestedAt: '2026-09-05T00:00:00.000Z',
      lastMessageAt: '2026-09-05T03:00:00.000Z',
      answeredAt: '2026-09-05T00:30:00.000Z',
      closedAt: '2026-09-05T01:00:00.000Z',
    });
    assert.equal(waitedForTh(impossible, new Date('2026-09-05T04:00:00.000Z')), '1 ชั่วโมง',
      'the clock falls back to running, rather than counting backwards');
    assert.equal(waitedLabelTh(impossible), 'รอมานาน');
  });
});

// The row has to say "answered, and they came back" without the operator opening anything — an
// answered-then-reopened request otherwise looks exactly like a brand new one.
describe('the chip a reopened request carries', () => {
  it('counts the answers a customer has written back to', () => {
    const chip = supportReopenedChip(item({ answeredAt: '2026-09-05T00:30:00.000Z', reopenedCount: 1 }));
    assert.equal(chip!.tone, 'info');
    assert.equal(chip!.label, 'ตอบแล้ว 1 ครั้ง · ลูกค้าตอบกลับ');
    assert.equal(supportReopenedChip(item({ answeredAt: '2026-09-05T00:30:00.000Z', reopenedCount: 3 }))!.label,
      'ตอบแล้ว 3 ครั้ง · ลูกค้าตอบกลับ');
  });

  it('says nothing on a request nobody has answered, or that is not waiting', () => {
    assert.equal(supportReopenedChip(item()), null, 'never answered');
    assert.equal(supportReopenedChip(item({ status: 'ANSWERED', answeredAt: '2026-09-05T00:30:00.000Z' })), null,
      'answered and quiet is not a reopen');
    assert.equal(supportReopenedChip(item({
      status: 'CLOSED', answeredAt: '2026-09-05T00:30:00.000Z', reopenedCount: 2,
    })), null, 'a closed matter is not waiting on anybody');
  });

  /**
   * Review 2026-09-06. The label floored the count at 1, so a row carrying an `answeredAt` and a
   * `reopenedCount` of 0 — an answer recorded without a reopen — claimed "ตอบแล้ว 1 ครั้ง ·
   * ลูกค้าตอบกลับ" about a customer who had not written back. The count is the whole claim.
   */
  it('never invents a reopen the count does not show', () => {
    assert.equal(supportReopenedChip(item({ answeredAt: '2026-09-05T00:30:00.000Z', reopenedCount: 0 })), null);
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
    const chip = notifiedSummary(item({ notifyState: 'unreachable', lineNotifiedCount: 0, emailSent: false }));
    assert.equal(chip.tone, 'danger');
    assert.match(chip.label, /เห็นที่หน้านี้เท่านั้น/, 'and says where the request still is');
  });

  // The counters hold their defaults until the outbox drain runs, so 0/false on a fresh row is
  // "not yet", not "failed" — and the red chip flashing for the seconds in between would teach an
  // operator that the red chip means nothing.
  it('says "กำลังแจ้ง" while the drain has not run, whatever the counters read', () => {
    const chip: Chip = notifiedSummary(item({ notifyState: 'queued', lineNotifiedCount: 0, emailSent: false }));
    assert.equal(chip.tone, 'info', 'not danger — the drain simply has not run');
    assert.match(chip.label, /กำลังแจ้ง/);
  });
});

describe('where an operator goes to answer', () => {
  /**
   * Review 2026-09-06 (F4). The message box on the partner page addressed the shop's OWNERs, so a
   * request an EMPLOYEE raised was answered into a chat they cannot see. The link now says WHICH
   * request is being answered, which is what lets the box add that one person — and only them.
   * `askerRef` rides along so the box can name them the way this page does (§3: a hash, never a
   * LINE id and never a LINE display name).
   */
  it('sends a shop to its message box and an applicant to the queue', () => {
    const shop = item({ companyId: 'co-1' });
    assert.equal(supportAnswerHref(shop), '/system/partners/co-1?support=sr-1&asker=edface');
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
