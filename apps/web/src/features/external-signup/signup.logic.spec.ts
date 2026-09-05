import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_TIER_PRESETS, PUBLIC_SIGNUP_STATUS_KEYS, SIGNUP_TRIAL_TIER_KEY, SIGNUP_TRIAL_WARMUP_SLIPS,
} from '@watchdog-bms/contracts';
import {
  clampMobileInput,
  firstSignupErrorField,
  isTransientLoadFailure,
  isThaiMobile,
  MOBILE_DIGITS,
  offerLimitsLabel,
  offerWarmupNote,
  rotateSignupKeyAfter,
  SELECTABLE_OFFER_KEY,
  SIGNUP_CONSENT_VERSION,
  SIGNUP_OFFERS,
  signupFieldRejection,
  signupStatusCopy,
  signupSubmitErrorMessage,
  validateClaimPassword,
  validateSignupForm,
  type SignupFormValues,
} from './signup.logic';

const validForm: SignupFormValues = {
  companyName: 'ร้านสมชายค้าส่ง',
  ownerFirstName: 'สมชาย',
  ownerLastName: 'ใจดี',
  contactEmail: 'somchai@gmail.com',
  phoneNumber: '0812345678',
  businessType: 'ร้านขายของชำ',
  vatRegistered: false,
  taxId: '',
};

describe('signup form validation', () => {
  it('accepts a complete form', () => {
    assert.deepEqual(validateSignupForm(validForm), {});
  });

  it('names every required field in Thai', () => {
    const errors = validateSignupForm({
      ...validForm,
      companyName: '   ',
      ownerFirstName: '',
      ownerLastName: '  ',
      contactEmail: '',
      phoneNumber: '',
    });
    assert.match(errors.companyName!, /ชื่อร้าน/);
    assert.match(errors.ownerFirstName!, /ชื่อ/);
    assert.match(errors.ownerLastName!, /นามสกุล/);
    assert.match(errors.contactEmail!, /อีเมล/);
    assert.match(errors.phoneNumber!, /เบอร์โทร/);
  });

  // The MX check is the server's job (422): a local rule that guesses would reject addresses the
  // server would have accepted. Only a shape that cannot be an address is refused here.
  it('rejects a malformed address but leaves real-domain judgement to the server', () => {
    assert.ok(validateSignupForm({ ...validForm, contactEmail: 'somchai.gmail.com' }).contactEmail);
    assert.equal(validateSignupForm({ ...validForm, contactEmail: 'somchai@gmial.com' }).contactEmail, undefined);
    assert.equal(validateSignupForm({ ...validForm, contactEmail: 'a@b.co.th' }).contactEmail, undefined);
  });

  it('accepts a Thai mobile however it is spaced or dashed, and rejects other shapes', () => {
    assert.equal(validateSignupForm({ ...validForm, phoneNumber: '081-234-5678' }).phoneNumber, undefined);
    assert.equal(validateSignupForm({ ...validForm, phoneNumber: '081 234 5678' }).phoneNumber, undefined);
    assert.ok(validateSignupForm({ ...validForm, phoneNumber: '0812345' }).phoneNumber);
    assert.ok(validateSignupForm({ ...validForm, phoneNumber: '12345678901' }).phoneNumber);
    assert.equal(isThaiMobile('0912345678'), true);
    assert.equal(isThaiMobile('1912345678'), false);
  });

  // Owner UAT 2026-08-31: the field took an 11th digit and only complained at submit.
  it('caps what the phone field can hold at ten digits, whatever is typed or pasted', () => {
    assert.equal(clampMobileInput('0812345678'), '0812345678');
    assert.equal(clampMobileInput('08123456789'), '0812345678');
    assert.equal(clampMobileInput('081-234-5678'), '0812345678');
    // Separators must not eat into the cap: a dashed number still yields all ten digits.
    assert.equal(clampMobileInput('081 234 5678').length, MOBILE_DIGITS);
    assert.equal(clampMobileInput('+66812345678'), '6681234567');
    assert.equal(clampMobileInput(''), '');
    // Whatever survives the clamp is exactly what the submit-time rule accepts.
    assert.equal(isThaiMobile(clampMobileInput('08123456789')), true);
  });

  it('checks the tax id only when it is VAT-registered and filled', () => {
    assert.equal(validateSignupForm({ ...validForm, vatRegistered: true, taxId: '' }).taxId, undefined);
    assert.equal(validateSignupForm({ ...validForm, vatRegistered: false, taxId: '123' }).taxId, undefined);
    assert.ok(validateSignupForm({ ...validForm, vatRegistered: true, taxId: '123' }).taxId);
    assert.equal(validateSignupForm({ ...validForm, vatRegistered: true, taxId: '0105561000000' }).taxId, undefined);
  });
});

describe('offer catalog', () => {
  // Spec §3A: all four tiers are shown so the applicant sees the real journey, but exactly one is
  // selectable — a second selectable card would submit a key the server does not treat as an offer.
  it('shows four tiers with exactly one selectable, the free trial', () => {
    assert.equal(SIGNUP_OFFERS.length, 4);
    const selectable = SIGNUP_OFFERS.filter((offer) => offer.selectable);
    assert.equal(selectable.length, 1);
    assert.equal(selectable[0]!.offerKey, SELECTABLE_OFFER_KEY);
    assert.equal(selectable[0]!.tierKey, SIGNUP_TRIAL_TIER_KEY);
  });

  // Owner 2026-09-05: no package is chosen at signup any more, so what the form submits must name
  // the offer the applicant actually gets. Sending PRO_TRIAL recorded a request for a package that
  // was never shown and is never provisioned.
  it('submits the free-trial offer key, not the retired PRO trial', () => {
    assert.equal(SELECTABLE_OFFER_KEY, 'FREE_TRIAL');
  });

  /**
   * F1. The page promised PRO limits — 5 branches, 10 staff, 100 receipts, ฿999 — while
   * provisioning writes FREE_TRIAL_15: 1 branch, 2 staff, 15 receipts, plus a first-week ceiling.
   * The numbers on the card have to be the numbers the shop gets.
   */
  it('offers the tier that is actually provisioned, with its real limits', () => {
    const selectable = SIGNUP_OFFERS.find((offer) => offer.selectable)!;

    assert.equal(selectable.tierKey, SIGNUP_TRIAL_TIER_KEY);
    const preset = PLAN_TIER_PRESETS[SIGNUP_TRIAL_TIER_KEY];
    assert.match(offerLimitsLabel(selectable), new RegExp(`${preset.branchLimit} สาขา`));
    assert.match(offerLimitsLabel(selectable), new RegExp(`${preset.employeeLimit} คน`));
    assert.match(offerLimitsLabel(selectable), new RegExp(`${preset.monthlySlipLimit} ใบ/เดือน`));
  });

  /**
   * Review F17. P10-L §9 caps a brand-new trial shop harder for its first week than its tier
   * allows. Discovering that on day one reads as a broken app, so the card says it in advance.
   */
  it('says what the first week actually allows, from the shared constant', () => {
    const selectable = SIGNUP_OFFERS.find((offer) => offer.selectable)!;
    const note = offerWarmupNote(selectable);

    assert.ok(note, 'the trial card must state its first-week ceiling');
    assert.match(note!, new RegExp(`สัปดาห์แรกอ่านได้ ${SIGNUP_TRIAL_WARMUP_SLIPS} ใบ`));
    // Owner copy rule: no plus sign anywhere in user-facing text.
    assert.equal(note!.includes('+'), false);
    // The number is the warm-up ceiling, not the monthly quota — they differ, and saying the
    // monthly one here would promise 15 receipts in a week that allows 10.
    assert.notEqual(SIGNUP_TRIAL_WARMUP_SLIPS, PLAN_TIER_PRESETS[SIGNUP_TRIAL_TIER_KEY].monthlySlipLimit);
  });

  it('puts the warm-up note on the trial card only', () => {
    for (const paid of SIGNUP_OFFERS.filter((offer) => !offer.selectable)) {
      assert.equal(offerWarmupNote(paid), undefined, `${paid.tierKey} has no warm-up`);
    }
  });

  it('names no PRO package and quotes no price on the offer the applicant takes', () => {
    const selectable = SIGNUP_OFFERS.find((offer) => offer.selectable)!;
    const shown = `${selectable.nameTh} ${selectable.priceLabel} ${selectable.badge ?? ''}`;

    assert.equal(/PRO|มืออาชีพ/i.test(shown), false, `the trial card still sells PRO: ${shown}`);
    assert.equal(/999/.test(shown), false, `the trial card still quotes a price: ${shown}`);
    // And no card anywhere still carries the retired offer or the PRO tier.
    assert.deepEqual(SIGNUP_OFFERS.filter((o) => o.tierKey === 'PRO_999' || o.offerKey === 'PRO_TRIAL'), []);
  });

  it('gives every unavailable card a reason assistive technology can read', () => {
    for (const offer of SIGNUP_OFFERS.filter((card) => !card.selectable)) {
      assert.ok(offer.unavailableReason, `${offer.tierKey} has no reason`);
      assert.match(offer.unavailableReason!, /เร็ว ๆ นี้/);
    }
  });

  it('quotes the quota from the shared tier presets rather than restating numbers', () => {
    const paid = SIGNUP_OFFERS.find((offer) => offer.tierKey === 'BASIC_499')!;
    assert.match(offerLimitsLabel(paid), /2 สาขา · 5 คน · อ่านสลิป 50 ใบ\/เดือน/);
  });

  it('pins the consent version to the current legal artifacts', () => {
    assert.match(SIGNUP_CONSENT_VERSION, /^terms-v\d+-privacy-v\d+$/);
    assert.ok(SIGNUP_CONSENT_VERSION.length <= 64);
  });
});

describe('public status copy', () => {
  it('has plain Thai for every coarse state and never claims the company exists before it does', () => {
    for (const status of ['CHECKING', 'PENDING_REVIEW', 'AWAITING_CLAIM', 'REJECTED', 'EXPIRED'] as const) {
      const copy = signupStatusCopy(status);
      assert.ok(copy.title && copy.body, status);
      assert.doesNotMatch(copy.body, /สร้างบริษัทแล้ว|เปิดร้านให้แล้ว/, status);
    }
    assert.match(signupStatusCopy('READY').title, /เปิดใช้งานแล้ว/);
    assert.match(signupStatusCopy('EXPIRED').body, /ขอลิงก์ใหม่/);
  });

  it('stops promising a self-serve link once the 30-day sweep parked the request', () => {
    // Spec §4D ④: the approval survives and an admin can always reissue, so this points at the
    // phone and the mailbox — it never tells the applicant to start over.
    const copy = signupStatusCopy('EXPIRED', false);
    assert.match(copy.body, /คำขอหมดอายุ/);
    assert.match(copy.body, /098-256-5628/);
    assert.match(copy.body, /contact@mangmeeplus\.com/);
    assert.doesNotMatch(copy.body, /ขอลิงก์ใหม่|สมัครใหม่/);
    assert.doesNotMatch(`${copy.title} ${copy.body}`, /\+/);
    // The resendable case is unchanged.
    assert.match(signupStatusCopy('EXPIRED', true).body, /ขอลิงก์ใหม่/);
  });

  it('never renders a "+" in owner-facing copy, for every key the contract declares', () => {
    for (const status of PUBLIC_SIGNUP_STATUS_KEYS) {
      const copy = signupStatusCopy(status);
      assert.ok(copy.title && copy.body, status);
      assert.doesNotMatch(`${copy.title} ${copy.body}`, /\+/, status);
    }
  });

  // R11: three states answered with copy about something that had not happened — a shop that did
  // not exist, a rescue nothing was running, and an email that had bounced.
  it('separates being prepared, a stalled preparation and a bounced email from READY', () => {
    const preparing = signupStatusCopy('PREPARING');
    assert.doesNotMatch(preparing.body, /พร้อมใช้งาน|เข้าสู่ระบบ/);

    // Nothing retries by itself, so "ยังไม่ต้องทำอะไรเพิ่ม" left the applicant waiting on nobody.
    const failed = signupStatusCopy('PREPARING_FAILED');
    assert.doesNotMatch(failed.body, /ยังไม่ต้องทำอะไร/);
    assert.match(failed.body, /098-256-5628/);

    const bounced = signupStatusCopy('EMAIL_FAILED');
    assert.match(bounced.title, /ส่งอีเมลไม่สำเร็จ/);
    assert.doesNotMatch(bounced.body, /ไปให้แล้ว/);
    assert.match(bounced.body, /ขอส่งใหม่/);

    // The one state that may promise a login is still the one where the shop exists.
    assert.match(signupStatusCopy('READY').body, /เข้าสู่ระบบ/);
  });

  it('tells a transient load failure apart from a request that really is not there', () => {
    // An outage on the way to the status/claim page must not be reported as a dead link.
    assert.equal(isTransientLoadFailure(Object.assign(new Error('x'), { status: 503 })), true);
    assert.equal(isTransientLoadFailure(Object.assign(new Error('x'), { status: 500 })), true);
    assert.equal(isTransientLoadFailure(Object.assign(new Error('x'), { status: 429 })), true);
    assert.equal(isTransientLoadFailure(new Error('Network request failed.')), true);
    assert.equal(isTransientLoadFailure(Object.assign(new Error('x'), { status: 404 })), false);
    assert.equal(isTransientLoadFailure(Object.assign(new Error('x'), { status: 400 })), false);
  });
});

describe('submit error copy', () => {
  // The whole point of the server-side MX check: it names the domain the applicant mistyped. The
  // shared translator has no mapping for that sentence, so without this rule the 422 status
  // fallback ("reload the page") replaced the only message that could fix the typo.
  it('shows the server sentence when the server already wrote Thai', () => {
    const mxRejection = Object.assign(new Error('ตรวจไม่พบโดเมนอีเมลนี้ (gmial.com) กรุณาตรวจตัวสะกดอีกครั้ง'), { status: 422 });
    assert.match(signupSubmitErrorMessage(mxRejection), /gmial\.com/);
  });

  it('never shows English operator text, falling back to reviewed copy', () => {
    const message = signupSubmitErrorMessage(Object.assign(new Error('Validation failed.'), { status: 422 }));
    assert.doesNotMatch(message, /Validation failed/);
    assert.match(message, /[฀-๿]/);
  });

  it('still prefers a mapped code over any sentence', () => {
    const rateLimited = Object.assign(new Error('Too many requests'), { status: 429 });
    assert.match(signupSubmitErrorMessage(rateLimited), /ถี่เกินไป/);
  });

  // Owner UAT 2026-08-31: an applicant whose email already had an account filled the claim form and
  // got the generic 409 line — a wrong cause and no way forward. Both claim-page conflicts name
  // themselves now, and neither may fall back to the concurrency copy.
  it('names the two claim conflicts instead of blaming a concurrent edit', () => {
    const duplicateEmail = Object.assign(new Error('email_already_registered_use_existing_account'), { status: 409 });
    assert.match(signupSubmitErrorMessage(duplicateEmail), /อีเมลนี้มีบัญชีมั่งมีพลัสอยู่แล้ว/);
    assert.match(signupSubmitErrorMessage(duplicateEmail), /เข้าสู่ระบบด้วยบัญชีเดิม/);
    assert.doesNotMatch(signupSubmitErrorMessage(duplicateEmail), /ข้อมูลถูกเปลี่ยนแปลงระหว่างทำรายการ/);

    const takenUsername = Object.assign(new Error('username_taken'), { status: 409 });
    assert.match(signupSubmitErrorMessage(takenUsername), /ชื่อผู้ใช้นี้ถูกใช้แล้ว/);
    assert.doesNotMatch(signupSubmitErrorMessage(takenUsername), /ข้อมูลถูกเปลี่ยนแปลงระหว่างทำรายการ/);

    // Unrelated 409s keep the reviewed generic copy — this is a mapping, not a relabelling.
    assert.match(
      signupSubmitErrorMessage(Object.assign(new Error('Conflict'), { status: 409 })),
      /ข้อมูลถูกเปลี่ยนแปลงระหว่างทำรายการ/,
    );
  });
});

// R07. `submit-company-signup.use-case.ts` durably RECEIVES the payload before it looks up MX, so a
// 422 leaves a row keyed by this idempotency key carrying the OLD address's payload hash. Sending
// the corrected form under the same key answers `external_signup_payload_conflict` — the applicant
// who mistyped their address cannot get past the form at all.
describe('recovering from a rejected submit', () => {
  it('rotates the idempotency key only after a definite validation rejection', () => {
    assert.equal(rotateSignupKeyAfter(Object.assign(new Error('email_domain_has_no_mx'), { status: 422 })), true);
    assert.equal(rotateSignupKeyAfter(Object.assign(new Error('Validation failed.'), { status: 400 })), true);
    // Unknown outcomes keep the key: a retry after a timeout must not open a second application.
    for (const status of [429, 500, 502, 503]) {
      assert.equal(rotateSignupKeyAfter(Object.assign(new Error('x'), { status })), false, String(status));
    }
    assert.equal(rotateSignupKeyAfter(new Error('Network request failed.')), false);
    assert.equal(rotateSignupKeyAfter(null), false);
  });

  it('puts the MX rejection under the email field in Thai instead of "reload the page"', () => {
    const rejection = signupFieldRejection(Object.assign(new Error('email_domain_has_no_mx'), { status: 422 }));
    assert.equal(rejection?.field, 'contactEmail');
    assert.match(rejection!.message, /ไม่พบโดเมนอีเมลนี้/);
    assert.doesNotMatch(rejection!.message, /โหลดหน้าใหม่/);
    assert.doesNotMatch(rejection!.message, /\+/);
    // The API answers with the code in `message`; the BFF shape carries it in `code`. Both count.
    assert.equal(signupFieldRejection({ code: 'email_domain_has_no_mx', status: 422 })?.field, 'contactEmail');
    // Anything that does not name a field stays a form-level message.
    assert.equal(signupFieldRejection(Object.assign(new Error('Conflict'), { status: 409 })), null);
    assert.equal(signupFieldRejection(null), null);
  });

  it('names the first error in submit order, so focus lands where the applicant reads', () => {
    assert.equal(firstSignupErrorField({ phoneNumber: 'x', companyName: 'y' }), 'companyName');
    assert.equal(firstSignupErrorField({ taxId: 'x', contactEmail: 'y' }), 'contactEmail');
    assert.equal(firstSignupErrorField({}), null);
  });
});

describe('claim password rules', () => {
  it('requires 8 characters with both letters and digits', () => {
    assert.ok(validateClaimPassword('somchai', 'abc12', 'abc12').password);
    assert.ok(validateClaimPassword('somchai', 'abcdefgh', 'abcdefgh').password);
    assert.ok(validateClaimPassword('somchai', '12345678', '12345678').password);
    assert.equal(validateClaimPassword('somchai', 'abcd1234', 'abcd1234').password, undefined);
  });

  it('catches a mismatched or missing confirmation, and a blank username', () => {
    assert.ok(validateClaimPassword('somchai', 'abcd1234', '').confirmPassword);
    assert.ok(validateClaimPassword('somchai', 'abcd1234', 'abcd12345').confirmPassword);
    assert.ok(validateClaimPassword('  ', 'abcd1234', 'abcd1234').username);
    assert.deepEqual(validateClaimPassword('somchai', 'abcd1234', 'abcd1234'), {});
  });
});
