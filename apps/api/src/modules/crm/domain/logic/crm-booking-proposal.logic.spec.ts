import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  assertTransition,
  isTerminal,
  isExpired,
  classifyConfirmationReply,
  type CrmBookingProposalStatus,
} from './crm-booking-proposal.logic';

describe('booking proposal transition graph', () => {
  it('allows the full happy path one hop at a time', () => {
    const path: CrmBookingProposalStatus[] = ['PROPOSED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'COMMITTING', 'BOOKED'];
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(canTransition(path[i]!, path[i + 1]!), true, `${path[i]} -> ${path[i + 1]}`);
    }
  });

  it('rejects skipping a step or moving backwards', () => {
    assert.equal(canTransition('PROPOSED', 'CONFIRMED'), false);
    assert.equal(canTransition('CONFIRMED', 'PROPOSED'), false);
    assert.equal(canTransition('BOOKED', 'COMMITTING'), false);
  });

  it('allows aborts to terminals from the right stages only', () => {
    assert.equal(canTransition('AWAITING_CONFIRMATION', 'CANCELLED'), true);
    assert.equal(canTransition('AWAITING_CONFIRMATION', 'EXPIRED'), true);
    assert.equal(canTransition('COMMITTING', 'CONFLICTED'), true);
    // Conflict is only discovered at commit time; not before.
    assert.equal(canTransition('AWAITING_CONFIRMATION', 'CONFLICTED'), false);
    // A committed/confirmed proposal no longer expires on the timer.
    assert.equal(canTransition('CONFIRMED', 'EXPIRED'), false);
    assert.equal(canTransition('COMMITTING', 'EXPIRED'), false);
  });

  it('assertTransition throws a stable error on an illegal hop', () => {
    assert.throws(() => assertTransition('PROPOSED', 'BOOKED'), /illegal_booking_proposal_transition:PROPOSED->BOOKED/);
    assert.doesNotThrow(() => assertTransition('PROPOSED', 'AWAITING_CONFIRMATION'));
  });

  it('marks BOOKED and every abort as terminal, actives as non-terminal', () => {
    for (const s of ['BOOKED', 'EXPIRED', 'CANCELLED', 'CONFLICTED', 'HANDED_TO_STAFF'] as const) {
      assert.equal(isTerminal(s), true, s);
    }
    for (const s of ['PROPOSED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'COMMITTING'] as const) {
      assert.equal(isTerminal(s), false, s);
    }
  });
});

describe('isExpired', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  it('is true for an active proposal past its expiry', () => {
    assert.equal(isExpired({ status: 'PROPOSED', expiresAt: new Date('2026-07-12T11:59:59.000Z') }, now), true);
  });
  it('is false before expiry', () => {
    assert.equal(isExpired({ status: 'AWAITING_CONFIRMATION', expiresAt: new Date('2026-07-12T12:00:01.000Z') }, now), false);
  });
  it('never re-expires a terminal proposal', () => {
    assert.equal(isExpired({ status: 'BOOKED', expiresAt: new Date('2000-01-01T00:00:00.000Z') }, now), false);
    assert.equal(isExpired({ status: 'CANCELLED', expiresAt: new Date('2000-01-01T00:00:00.000Z') }, now), false);
  });
  it('never timer-expires a CONFIRMED/COMMITTING proposal (no EXPIRED edge)', () => {
    const past = new Date('2026-07-12T11:59:59.000Z');
    assert.equal(isExpired({ status: 'CONFIRMED', expiresAt: past }, now), false);
    assert.equal(isExpired({ status: 'COMMITTING', expiresAt: past }, now), false);
    // ...while an equally-expired PROPOSED proposal still expires.
    assert.equal(isExpired({ status: 'PROPOSED', expiresAt: past }, now), true);
  });
});

describe('classifyConfirmationReply', () => {
  it('reads explicit Thai and English confirmations', () => {
    for (const t of ['ยืนยันครับ', 'ตกลงค่ะ', 'โอเคเลย', 'ใช่', 'คอนเฟิร์ม', 'confirm', 'cf', 'ok', 'yes please']) {
      assert.equal(classifyConfirmationReply(t), 'CONFIRM', t);
    }
  });

  it('reads explicit Thai and English cancels', () => {
    for (const t of ['ยกเลิก', 'ขอยกเลิกนัด', 'ไม่เอาแล้ว', 'cancel', 'no thanks']) {
      assert.equal(classifyConfirmationReply(t), 'CANCEL', t);
    }
  });

  it('C2 acceptance: an availability question is UNCLEAR, not a confirmation', () => {
    assert.equal(classifyConfirmationReply('พรุ่งนี้บ่ายสองว่างไหม'), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('ว่างไหม'), 'UNCLEAR');
  });

  it('reads a question containing an affirmative token as UNCLEAR, not CONFIRM', () => {
    // ไหม / trailing ? mark an inquiry even with โอเค / ใช่ present.
    assert.equal(classifyConfirmationReply('โอเคไหม'), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('นัดพรุ่งนี้ใช่ไหม'), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('ok?'), 'UNCLEAR');
    // A bare affirmative (no question) still confirms.
    assert.equal(classifyConfirmationReply('ใช่'), 'CONFIRM');
    assert.equal(classifyConfirmationReply('ยืนยัน'), 'CONFIRM');
  });

  it('C2 acceptance: an explicit cancel request classifies as CANCEL', () => {
    assert.equal(classifyConfirmationReply('ขอยกเลิกนัด'), 'CANCEL');
    assert.equal(classifyConfirmationReply('ขอยกเลิกนัดพรุ่งนี้'), 'CANCEL');
  });

  it('a bare negation cancels but an embedded negation stays UNCLEAR (fail-closed)', () => {
    // Bare negation + politeness → CANCEL.
    assert.equal(classifyConfirmationReply('ไม่ค่ะ'), 'CANCEL');
    assert.equal(classifyConfirmationReply('no thanks'), 'CANCEL');
    // A negation buried in a real sentence must NOT cancel a live proposal —
    // these are questions/statements that merely contain ไม่ / no.
    assert.equal(classifyConfirmationReply('ไม่ทราบว่าราคาเท่าไหร่ครับ'), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('no idea, what is the price'), 'UNCLEAR');
  });

  it('treats empty and mixed signals as UNCLEAR (never auto-books)', () => {
    assert.equal(classifyConfirmationReply(''), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('   '), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('ไม่ยืนยัน'), 'UNCLEAR');
  });

  it('does not false-match English tokens inside larger words', () => {
    // "booking" contains the substring "ok"; "know" contains "no".
    assert.equal(classifyConfirmationReply('about the booking'), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('I know'), 'UNCLEAR');
  });

  it('is fail-closed: an affirmative token buried in a question or extra clause never confirms', () => {
    // Questions that happen to contain ตกลง / ใช่ / confirm / ok are inquiries,
    // not confirmations — booking them would violate the CUST-02 safety envelope.
    assert.equal(classifyConfirmationReply('ตกลงกี่โมงคะ'), 'UNCLEAR'); // "okay, what time?"
    assert.equal(classifyConfirmationReply('ใช่หรือเปล่า'), 'UNCLEAR'); // "is that right?"
    assert.equal(classifyConfirmationReply('can you confirm the time'), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('ok? please tell me'), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('โอเคแต่ขอเปลี่ยนเวลา'), 'UNCLEAR'); // "ok but change the time"
    assert.equal(classifyConfirmationReply('ตกลง 2 ที่นะคะ'), 'UNCLEAR'); // adds a quantity the proposal never offered
    // Emoji/symbols are substantive — a negation or doubt emoji must not collapse
    // to a bare affirmative (they are NOT stripped like whitespace/punctuation).
    assert.equal(classifyConfirmationReply('โอเค❌'), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('ตกลง🤔'), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('yes 👎'), 'UNCLEAR');
    assert.equal(classifyConfirmationReply('ok 🚫'), 'UNCLEAR');
  });

  it('still confirms a bare affirmative wrapped only in politeness', () => {
    for (const t of ['ยืนยันค่ะ', 'ยืนยันนะคะ', 'โอเคเลยค่ะ', 'ใช่ค่ะ', 'confirm ครับ', 'ok please']) {
      assert.equal(classifyConfirmationReply(t), 'CONFIRM', t);
    }
  });
});
