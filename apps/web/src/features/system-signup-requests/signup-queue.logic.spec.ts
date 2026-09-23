import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNUP_DISCOVERY_SOURCE_OPTIONS, signupDiscoveryLabel, type AdminSignupQueueItemDto } from '@watchdog-bms/contracts';
import {
  approveLabel,
  canApproveSignup,
  canRejectSignup,
  canReissueSignup,
  canRetrySignupIntake,
  canSuspendSignup,
  suspendLeavesShopRunning,
  isFinishingStrandedRow,
  isLineSignup,
  signupBusinessSummary,
  signupFailureChip,
  signupHintChips,
  signupIdleChip,
  signupStateChip,
  rejectNotifyDefault,
  rejectNotifyLabel,
  queueEmptyForReal,
  tabLoadsOwnList,
  SIGNUP_QUEUE_TABS,
} from './signup-queue.logic';

function item(overrides: Partial<AdminSignupQueueItemDto> = {}): AdminSignupQueueItemDto {
  return {
    requestId: 'req_1',
    version: 1,
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

it('uses identical discovery labels for the queue and company details, including legacy rows', () => {
  assert.equal(signupDiscoveryLabel(), 'ไม่ระบุ');
  for (const { value, label } of SIGNUP_DISCOVERY_SOURCE_OPTIONS) {
    assert.equal(signupDiscoveryLabel(value), label);
  }
  assert.equal(signupDiscoveryLabel('OTHER', 'เพื่อนแนะนำ'), 'อื่น ๆ — เพื่อนแนะนำ');
  assert.equal(signupDiscoveryLabel('TIKTOK', 'old text'), 'TikTok');
});

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

  it('offers approve as the retry for a failed provisioning, whatever the source', () => {
    assert.equal(canApproveSignup('PROVISIONING_FAILED', failed()), true);
    // Review HIGH-1: READY is the other recovery — the shop exists, the last step did not land.
    assert.equal(canApproveSignup('READY', ready()), true);
    // Review F2: a Flow B row that failed provisioning has a spent token and no other way back,
    // so the retry is offered here too. Its READY close-out is still the applicant's own page.
    assert.equal(canApproveSignup('PROVISIONING_FAILED', failed('official-site')), true);
    assert.equal(canApproveSignup('READY', ready('official-site')), false);
    assert.equal(canApproveSignup('PROVISIONING_FAILED'), true, 'the state alone is enough now');
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
    assert.equal(approveLabel('PENDING_REVIEW', item({ source: 'line-oa' })), 'เลือกผลคำขอ');
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

  // Review MEDIUM-2: SUSPENDED is terminal, so suspending mid-provisioning strands a shop that may
  // already exist but whose trial guards never ran — an unlimited shop with its application shut.
  it('never offers ระงับ while a provisioning run is in flight, at either freshness', () => {
    // A LIVE run, at either company state: work is still in flight.
    assert.equal(canSuspendSignup(item({ state: 'PROVISIONING', source: 'line-oa' })), false, 'fresh');
    assert.equal(
      canSuspendSignup(item({ state: 'PROVISIONING', source: 'line-oa', companyId: 'co-1' })),
      false,
      'fresh, with a shop already stamped',
    );
    // B-2. An ABANDONED attempt that DID build a shop must not be stopped either — that would
    // strand an ACTIVE company with its application shut behind it.
    assert.equal(
      canSuspendSignup(item({
        state: 'PROVISIONING', source: 'line-oa', staleProvisioning: true, companyId: 'co-1',
      })),
      false,
      'abandoned, but a shop exists',
    );
    // …and the one case the API allows under its lock: given up on, and nothing built.
    assert.equal(
      canSuspendSignup(item({ state: 'PROVISIONING', source: 'line-oa', staleProvisioning: true })),
      true,
      'abandoned with no shop is the one suspendable in-flight row',
    );
    // HIGH-2: READY joins it. The shop EXISTS and the application has not closed, so suspending
    // strands an ACTIVE company and frees the LINE account to apply again. The API refuses it under
    // its own lock; the page must not offer a button that 409s.
    assert.equal(canSuspendSignup(item({ state: 'READY', source: 'line-oa' })), false);
    // The settled rows still offer it.
    assert.equal(canSuspendSignup(failed()), true);
    assert.equal(canSuspendSignup(item({ state: 'COMPLETED', source: 'line-oa' })), true);
  });

  it('says the shop keeps running when suspending only settles the application', () => {
    for (const state of ['PROVISIONING_FAILED', 'COMPLETED']) {
      assert.equal(suspendLeavesShopRunning(state), true, state);
    }
    assert.equal(suspendLeavesShopRunning('PENDING_REVIEW'), false);
    // READY is no longer suspendable at all, so it needs no copy about what suspending leaves.
    assert.equal(canSuspendSignup(item({ state: 'READY', source: 'line-oa' })), false);
  });

  it('offers suspend on a LINE row and nowhere else', () => {
    assert.equal(canSuspendSignup(failed()), true);
    assert.equal(canSuspendSignup(item({ state: 'COMPLETED', source: 'line-oa' })), true);
    assert.equal(canSuspendSignup(item({ state: 'PENDING_REVIEW' })), false, 'web form');
    assert.equal(canSuspendSignup(item({ state: 'SUSPENDED', source: 'line-oa' })), false, 'already stopped');
  });
});

describe('saved LINE intake recovery', () => {
  it('offers retry only before review, and labels both states in Thai', () => {
    assert.equal(canRetrySignupIntake(item({ source: 'line-oa', state: 'RECEIVED' })), true);
    assert.equal(canRetrySignupIntake(item({ source: 'line-oa', state: 'VALIDATED' })), true);
    assert.equal(canRetrySignupIntake(item({ source: 'line-oa', state: 'PENDING_REVIEW' })), false);
    assert.equal(canRetrySignupIntake(item({ source: 'official-site', state: 'RECEIVED' })), false);
    assert.match(signupStateChip('RECEIVED').label, /ทำขั้นตอนรับต่อ/);
    assert.match(signupStateChip('VALIDATED').label, /ทำขั้นตอนรับต่อ/);
  });

  it('shows explicit non-provisioning resolutions', () => {
    assert.ok(signupHintChips(item({ reviewResolution: 'PLAN_REVIEW' })).some((chip) => chip.label.includes('ยังไม่เปิดร้าน')));
    assert.ok(signupHintChips(item({ reviewResolution: 'REQUEST_INFO' })).some((chip) => chip.label === 'รอข้อมูลจากลูกค้า'));
    assert.ok(signupHintChips(item({ reviewResolution: 'RETURN_EXISTING' })).some((chip) => chip.label.includes('ไม่สร้างร้านใหม่')));
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
  it('keeps the account-attachment hint for the verified web-email flow', () => {
    const chips = signupHintChips(item({ source: 'official-site', emailMatchesExistingUser: true }));
    assert.equal(chips[0]!.label, 'อีเมลตรงกับบัญชีเดิม ระบบจะผูกให้ตอนยืนยัน');
  });

  it('does not treat an unverified LINE shop-contact email as account identity', () => {
    const chips = signupHintChips(item({ source: 'line-oa', emailMatchesExistingUser: true }));
    assert.equal(chips.some((chip) => chip.label.includes('อีเมลตรงกับบัญชีเดิม')), false);
  });

  it('tells the reviewer to check a previously used email without claiming an identity match', () => {
    const chips = signupHintChips(item({
      source: 'line-oa',
      emailMatchesExistingUser: true,
      emailPreviouslyUsed: true,
    }));
    assert.ok(chips.some((chip) => chip.label === 'อีเมลเคยใช้แล้ว — ตรวจร้านเดิมก่อนอนุมัติ'));
    assert.equal(chips.some((chip) => chip.label.includes('ระบบจะผูก')), false);
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

// Review A-01. The commonest duplicate is a customer an admin opened a shop for by hand, who then
// applies from LINE as if they were new — approving that gives one person two shops.
describe('signupHintChips — the phone duplicate hint', () => {
  it('names the shop the number already reaches', () => {
    const chips = signupHintChips(item({ phoneMatchesCompanyName: 'ร้านเดิมของนิด' }));
    assert.ok(chips.some((chip) => chip.label === 'อาจซ้ำกับร้าน ร้านเดิมของนิด'));
    assert.equal(chips.find((chip) => chip.label.startsWith('อาจซ้ำ'))!.tone, 'warning');
  });

  it('says nothing when no shop matches', () => {
    assert.equal(signupHintChips(item()).some((chip) => chip.label.startsWith('อาจซ้ำ')), false);
  });

  // Decided at submit from the verified ID token, so by the time it is read this is a fact about
  // what approving WILL do — not something the operator is being asked to choose.
  it('says when approving adds a second shop to an account that already exists', () => {
    const chips = signupHintChips(item({ source: 'line-oa', attachesToExistingAccount: true }));
    assert.ok(chips.some((chip) => chip.label === 'LINE นี้มีบัญชีอยู่แล้ว จะเพิ่มเป็นร้านที่ 2'));
    assert.equal(signupHintChips(item({ source: 'line-oa' })).length, 0);
  });
});

// Owner 2026-09-05. A closed shop plus a fresh signup is a REPEAT free trial, and the operator has
// to see which shop before the approve button rather than after the second one exists.
describe('signupHintChips — the repeat-trial hint', () => {
  const repeat = (priorCompanyState?: string) =>
    signupHintChips(item({ source: 'line-oa', priorCompanyName: 'ร้านเก่า', priorCompanyState }));

  it('names the shop and how it stands today', () => {
    assert.ok(repeat('CLOSED').some((c) => c.label === 'LINE นี้เคยมีร้าน: ร้านเก่า (ปิดอยู่)'));
    assert.ok(repeat('EXPIRED').some((c) => c.label === 'LINE นี้เคยมีร้าน: ร้านเก่า (หมดอายุ)'));
    assert.ok(repeat('ACTIVE').some((c) => c.label === 'LINE นี้เคยมีร้าน: ร้านเก่า (ใช้งานอยู่)'));
    assert.equal(repeat('CLOSED').find((c) => c.label.startsWith('LINE นี้เคยมีร้าน'))!.tone, 'warning');
  });

  it('still names the shop when the API sends a state this build does not know', () => {
    assert.ok(repeat('SOMETHING_NEW').some((c) => c.label === 'LINE นี้เคยมีร้าน: ร้านเก่า (ไม่ทราบสถานะ)'));
  });

  it('says nothing for a first-time applicant', () => {
    assert.deepEqual(signupHintChips(item({ source: 'line-oa' })), []);
  });
});

/**
 * The failure code the queue now carries. PROVISIONING_FAILED reads the same for a database outage
 * and for a LINE account that belongs to somebody else — only one of which an admin can fix.
 */
describe('signupFailureChip', () => {
  it('says what to fix for the two LINE identity refusals', () => {
    assert.equal(
      signupFailureChip(item({ failureCode: 'line_identity_already_linked' }))!.label,
      'LINE นี้ผูกกับบัญชีอื่นอยู่ ต้องปลดการเชื่อมก่อนจึงเปิดร้านได้',
    );
    assert.equal(signupFailureChip(item({ failureCode: 'line_identity_disabled' }))!.tone, 'danger');
  });

  it('stays silent rather than putting a machine string in front of an operator', () => {
    assert.equal(signupFailureChip(item({ failureCode: 'connection_reset' })), null);
    assert.equal(signupFailureChip(item()), null);
  });

});

// §8 vs §4D: the default follows the rail, because the two rails fail in opposite directions.
describe('rejectNotifyDefault', () => {
  it('is ON for a LINE application: the chat is the applicant own, and silence is a shop wondering', () => {
    assert.equal(rejectNotifyDefault(item({ source: 'line-oa' })), true);
    assert.equal(rejectNotifyLabel(item({ source: 'line-oa' })), 'แจ้งทางไลน์');
  });

  it('is OFF for the web form: the mailbox is unproven and the notice would be unsolicited', () => {
    assert.equal(rejectNotifyDefault(item({ source: 'official-site' })), false);
    assert.equal(rejectNotifyDefault(item()), false);
    assert.equal(rejectNotifyLabel(item()), 'ส่งอีเมลแจ้งผู้สมัคร');
  });
});

describe('queue tabs', () => {
  it('offers the two P10-L tabs, and marks the ones that read their own endpoint', () => {
    const keys = SIGNUP_QUEUE_TABS.map((tab) => tab.key);
    assert.ok(keys.includes('AUTO_APPROVED'));
    assert.ok(keys.includes('PACKAGE_CHANGE'));
    // R13: a rejected or suspended application appeared on no list at all, so "where did that
    // application go" had no answer anywhere in the console.
    assert.ok(keys.includes('ARCHIVED'));
    assert.equal(SIGNUP_QUEUE_TABS.find((tab) => tab.key === 'AUTO_APPROVED')!.label, 'เปิดให้อัตโนมัติ (ย้อนหลัง 14 วัน)');

    assert.equal(tabLoadsOwnList('AUTO_APPROVED'), true);
    assert.equal(tabLoadsOwnList('PACKAGE_CHANGE'), true);
    for (const key of ['ALL', 'PENDING_REVIEW', 'AWAITING_CLAIM', 'PROBLEM'] as const) {
      assert.equal(tabLoadsOwnList(key), false, `${key} filters the queue already in memory`);
    }
  });

  // The auto-approved rows are COMPLETED line-oa applications, and ระงับ is the one action §3.7
  // gives an operator over a shop the machine let through.
  it('leaves ระงับ as the only action on an auto-approved row', () => {
    const row = item({ source: 'line-oa', state: 'COMPLETED', autoApproved: true });
    assert.equal(canSuspendSignup(row), true);
    assert.equal(canApproveSignup(row.state, row), false);
    assert.equal(canRejectSignup(row.state), false);
    assert.equal(canReissueSignup(row.state), false);
  });

  // F4: "ไม่มีคำขอในกลุ่มนี้" is a claim about the DATABASE. Saying it because the page happens to
  // hold nothing is exactly the lie R13 existed to remove — a failed load and a genuinely empty
  // tab look identical on screen but mean opposite things.
  it('only calls a tab empty when the server counted zero', () => {
    const row = item();
    assert.equal(queueEmptyForReal([], { PENDING_REVIEW: 0 }, 'PENDING_REVIEW'), true);
    // Counted rows but none on screen: the load failed, or a page is still coming.
    assert.equal(queueEmptyForReal([], { PENDING_REVIEW: 240 }, 'PENDING_REVIEW'), false);
    // No counts at all (the request failed) is never proof of emptiness.
    assert.equal(queueEmptyForReal([], null, 'PENDING_REVIEW'), false);
    // A tab the server did not count is not proof either.
    assert.equal(queueEmptyForReal([], { ALL: 0 }, 'PROBLEM'), false);
    // Rows on screen are never "empty", whatever the count says.
    assert.equal(queueEmptyForReal([row], { ALL: 0 }, 'ALL'), false);
  });

});

it('email OTP recovery closes existing provisioning and never promises legacy account attachment', () => {
  for (const state of ['READY', 'PROVISIONING_FAILED', 'PROVISIONING']) assert.equal(canApproveSignup(state, item({ source: 'email-otp', state, staleProvisioning: true })), true);
  const hints = signupHintChips(item({ source: 'email-otp', emailMatchesExistingUser: true, contactEmailConflict: true }));
  assert.ok(hints.some(h => h.label.includes('ยืนยันอีเมลแล้ว')));
  assert.ok(hints.some(h => h.label.includes('คำขอเดิม')));
  assert.ok(hints.every(h => !h.label.includes('ระบบจะผูกให้')));
});
