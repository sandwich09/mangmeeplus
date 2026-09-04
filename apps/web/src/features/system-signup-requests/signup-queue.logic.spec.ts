import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminSignupQueueItemDto } from '@watchdog-bms/contracts';
import {
  approveLabel,
  canApproveSignup,
  canRejectSignup,
  canReissueSignup,
  canSuspendSignup,
  filterSignupQueue,
  isFinishingStrandedRow,
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

// Review HIGH-B: the chip told the operator to press approve, the button was not rendered, and
// the "มีปัญหา" tab did not list the row. Three halves of one feature that never met.
describe('a failed provisioning is actionable, not just labelled', () => {
  const failed = (source = 'line-oa') => item({ state: 'PROVISIONING_FAILED', source });

  const ready = (source = 'line-oa') => item({ state: 'READY', source });

  it('offers approve as the retry, but only for the source whose API accepts it', () => {
    assert.equal(canApproveSignup('PROVISIONING_FAILED', failed()), true);
    // Review HIGH-1: READY is the other recovery — the shop exists, the last step did not land.
    assert.equal(canApproveSignup('READY', ready()), true);
    // Flow B has no retry an admin could reach — approve, reject and reissue all 409.
    assert.equal(canApproveSignup('PROVISIONING_FAILED', failed('official-site')), false);
    assert.equal(canApproveSignup('READY', ready('official-site')), false);
    assert.equal(canApproveSignup('PROVISIONING_FAILED'), false, 'no item, no claim');
    assert.equal(canApproveSignup('PENDING_REVIEW'), true, 'the ordinary case is unchanged');
  });

  // Review MEDIUM-1: the reject button used to render inside the approve block, so it appeared on
  // exactly the rows where `decide(REJECT)` answers 409.
  it('offers reject only before a decision has been made', () => {
    assert.equal(canRejectSignup('PENDING_REVIEW'), true);
    for (const state of ['PROVISIONING_FAILED', 'READY', 'COMPLETED', 'EMAIL_PENDING']) {
      assert.equal(canRejectSignup(state), false, state);
    }
  });

  it('says what the approve button will actually do', () => {
    assert.equal(approveLabel('PENDING_REVIEW'), 'อนุมัติ');
    assert.equal(approveLabel('PROVISIONING_FAILED'), 'ลองเปิดร้านอีกครั้ง');
    assert.equal(approveLabel('READY'), 'ปิดงาน');
    assert.equal(approveLabel('PROVISIONING'), 'ปิดงาน');
  });

  // Review HIGH-1 (fourth pass): an abandoned run is the third recovery; a live one is not, and
  // offering the button for it would repeat the READY mistake in a new place.
  it('offers the button for an abandoned provisioning run and not a live one', () => {
    const stale = item({ state: 'PROVISIONING', source: 'line-oa', staleProvisioning: true });
    const live = item({ state: 'PROVISIONING', source: 'line-oa' });
    assert.equal(canApproveSignup('PROVISIONING', stale), true);
    assert.equal(canApproveSignup('PROVISIONING', live), false);
    // And the chip says which is which, so the operator is not left guessing.
    assert.match(signupStateChip('PROVISIONING', stale).label, /ปิดงาน/);
    assert.equal(signupStateChip('PROVISIONING', live).label, 'กำลังเปิดร้าน');
    assert.equal(signupStateChip('PROVISIONING', live).tone, 'info');
  });

  // Review LOW-2: the dialog said "open the shop" for rows whose shop already exists.
  it('knows when approving closes an existing shop rather than deciding a new one', () => {
    for (const state of ['PROVISIONING_FAILED', 'READY', 'PROVISIONING']) {
      assert.equal(isFinishingStrandedRow(state), true, state);
    }
    assert.equal(isFinishingStrandedRow('PENDING_REVIEW'), false);
  });

  it('lists both recoverable rows under the problem tab, where an operator would look', () => {
    const items = [failed(), ready(), item({ state: 'PENDING_REVIEW' })];
    assert.deepEqual(
      filterSignupQueue(items, 'PROBLEM').map((i) => i.state),
      ['PROVISIONING_FAILED', 'READY'],
    );
  });

  it('offers suspend on a LINE row and nowhere else', () => {
    assert.equal(canSuspendSignup(failed()), true);
    assert.equal(canSuspendSignup(item({ state: 'COMPLETED', source: 'line-oa' })), true);
    assert.equal(canSuspendSignup(item({ state: 'PENDING_REVIEW' })), false, 'web form');
    assert.equal(canSuspendSignup(item({ state: 'SUSPENDED', source: 'line-oa' })), false, 'already stopped');
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
    // PROVISIONING used to stand in for "unknown" here; it has meaning now, so this needs a state
    // the queue genuinely does not know about.
    assert.deepEqual(signupStateChip('SOME_FUTURE_STATE'), { label: 'SOME_FUTURE_STATE', tone: 'neutral' });
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
