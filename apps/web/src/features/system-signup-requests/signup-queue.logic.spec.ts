import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminSignupQueueItemDto } from '@watchdog-bms/contracts';
import {
  canApproveSignup,
  canReissueSignup,
  filterSignupQueue,
  isLineSignup,
  signupBusinessSummary,
  signupHintChips,
  signupIdleChip,
  signupStateChip,
} from './signup-queue.logic';

function item(overrides: Partial<AdminSignupQueueItemDto> = {}): AdminSignupQueueItemDto {
  return {
    requestId: 'req_1',
    state: 'PENDING_REVIEW',
    companyName: 'ร้านทดสอบ',
    ownerDisplayName: 'สมชาย',
    contactEmail: 'somchai@example.com',
    createdAt: '2026-08-30T03:00:00.000Z',
    emailMatchesExistingUser: false,
    emailDeliveryFailed: false,
    ...overrides,
  };
}

// P10-L: approving a LINE application opens the shop immediately and tells the customer in LINE.
// The page's confirm copy branches on this, because promising an email here promises nothing.
describe('isLineSignup', () => {
  it('is true only for the LINE source, and safe on a row from before the field existed', () => {
    assert.equal(isLineSignup(item({ source: 'line-oa' })), true);
    assert.equal(isLineSignup(item({ source: 'official-site' })), false);
    assert.equal(isLineSignup(item()), false);
  });
});

describe('signupStateChip', () => {
  it('tells the operator a failed provisioning can be retried from the queue', () => {
    // Review HIGH-2: the row is visible now, so it needs a label that says what to do with it.
    assert.match(signupStateChip('PROVISIONING_FAILED').label, /ลองใหม่/);
    assert.equal(signupStateChip('PROVISIONING_FAILED').tone, 'danger');
  });

  it('labels every state the queue acts on', () => {
    assert.equal(signupStateChip('PENDING_REVIEW').label, 'รออนุมัติ');
    assert.equal(signupStateChip('EMAIL_PENDING').label, 'ส่งเมลแล้ว รอตั้งรหัส');
    assert.equal(signupStateChip('EMAIL_FAILED').tone, 'danger');
    assert.equal(signupStateChip('EXPIRED').label, 'ลิงก์หมดอายุ');
  });

  it('renders an unknown state instead of blanking the cell', () => {
    assert.deepEqual(signupStateChip('PROVISIONING'), { label: 'PROVISIONING', tone: 'neutral' });
  });
});

describe('signupIdleChip', () => {
  it('stays silent until the third idle day', () => {
    assert.equal(signupIdleChip(item({ daysSinceApproval: 2 })), null);
    assert.equal(signupIdleChip(item()), null);
  });

  it('nudges the admin to call once the approval has sat unused', () => {
    assert.deepEqual(signupIdleChip(item({ daysSinceApproval: 5 })), {
      label: 'ยังไม่เริ่มใช้งาน 5 วัน',
      tone: 'warning',
    });
  });
});

describe('signupHintChips', () => {
  it('says what the system will do about a matching email, not what to decide', () => {
    const chips = signupHintChips(item({ emailMatchesExistingUser: true }));
    assert.equal(chips[0]!.label, 'อีเมลตรงกับบัญชีเดิม ระบบจะผูกให้ตอนยืนยัน');
  });

  it('names the company a tax id collides with', () => {
    const chips = signupHintChips(item({ taxIdMatchesCompanyName: 'ร้านเดิม' }));
    assert.equal(chips[0]!.label, 'เลขภาษีตรงกับ ร้านเดิม');
  });

  it('separates a failed MX check from an unknown one', () => {
    assert.equal(signupHintChips(item({ mxValid: true })).at(-1)!.label, 'โดเมนอีเมลตรวจแล้ว');
    assert.equal(signupHintChips(item({ mxValid: false })).at(-1)!.tone, 'danger');
    assert.deepEqual(signupHintChips(item()), []);
  });
});

describe('signupBusinessSummary', () => {
  it('joins only the fields the applicant filled in', () => {
    assert.equal(signupBusinessSummary(item({ businessType: 'ร้านอาหาร', vatRegistered: true, taxId: '0105500000000' })),
      'ร้านอาหาร · จด VAT · 0105500000000');
    assert.equal(signupBusinessSummary(item({ vatRegistered: false })), 'ไม่จด VAT');
    assert.equal(signupBusinessSummary(item()), '—');
  });
});

describe('queue actions', () => {
  it('offers approve only while the request waits for review', () => {
    assert.equal(canApproveSignup('PENDING_REVIEW'), true);
    assert.equal(canApproveSignup('EMAIL_PENDING'), false);
  });

  it('keeps reissue available for every post-approval dead end (spec §4D — no re-application)', () => {
    assert.equal(canReissueSignup('EMAIL_PENDING'), true);
    assert.equal(canReissueSignup('EMAIL_FAILED'), true);
    assert.equal(canReissueSignup('EXPIRED'), true);
    assert.equal(canReissueSignup('PENDING_REVIEW'), false);
  });
});

describe('filterSignupQueue', () => {
  const pending = item({ requestId: 'a', state: 'PENDING_REVIEW' });
  const awaiting = item({ requestId: 'b', state: 'EMAIL_PENDING' });
  const bounced = item({ requestId: 'c', state: 'EMAIL_FAILED', emailDeliveryFailed: true });
  const expired = item({ requestId: 'd', state: 'EXPIRED' });
  const all = [pending, awaiting, bounced, expired];

  it('keeps every row on the ALL tab', () => {
    assert.equal(filterSignupQueue(all, 'ALL').length, 4);
  });

  it('splits waiting-for-review from waiting-for-the-applicant', () => {
    assert.deepEqual(filterSignupQueue(all, 'PENDING_REVIEW').map((i) => i.requestId), ['a']);
    assert.deepEqual(filterSignupQueue(all, 'AWAITING_CLAIM').map((i) => i.requestId), ['b']);
  });

  it('groups bounced and expired requests as problems', () => {
    assert.deepEqual(filterSignupQueue(all, 'PROBLEM').map((i) => i.requestId), ['c', 'd']);
  });

  it('treats a bounce flag as a problem even before the state flips', () => {
    const flagged = item({ requestId: 'e', state: 'EMAIL_PENDING', emailDeliveryFailed: true });
    assert.deepEqual(filterSignupQueue([flagged], 'PROBLEM').map((i) => i.requestId), ['e']);
    assert.deepEqual(filterSignupQueue([flagged], 'AWAITING_CLAIM'), []);
  });
});
