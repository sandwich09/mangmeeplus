import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isThaiMobile,
  offerLimitsLabel,
  SELECTABLE_OFFER_KEY,
  SIGNUP_CONSENT_VERSION,
  SIGNUP_OFFERS,
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

  it('checks the tax id only when it is VAT-registered and filled', () => {
    assert.equal(validateSignupForm({ ...validForm, vatRegistered: true, taxId: '' }).taxId, undefined);
    assert.equal(validateSignupForm({ ...validForm, vatRegistered: false, taxId: '123' }).taxId, undefined);
    assert.ok(validateSignupForm({ ...validForm, vatRegistered: true, taxId: '123' }).taxId);
    assert.equal(validateSignupForm({ ...validForm, vatRegistered: true, taxId: '0105561000000' }).taxId, undefined);
  });
});

describe('offer catalog', () => {
  // Spec §3A: all four tiers are shown so the applicant sees the real journey, but the server
  // allowlist accepts PRO_TRIAL only — a second selectable card would submit a rejected key.
  it('shows four tiers with exactly one selectable, the PRO trial', () => {
    assert.equal(SIGNUP_OFFERS.length, 4);
    const selectable = SIGNUP_OFFERS.filter((offer) => offer.selectable);
    assert.equal(selectable.length, 1);
    assert.equal(selectable[0]!.offerKey, SELECTABLE_OFFER_KEY);
    assert.equal(selectable[0]!.tierKey, 'PRO_999');
  });

  it('gives every unavailable card a reason assistive technology can read', () => {
    for (const offer of SIGNUP_OFFERS.filter((card) => !card.selectable)) {
      assert.ok(offer.unavailableReason, `${offer.tierKey} has no reason`);
      assert.match(offer.unavailableReason!, /เร็ว ๆ นี้/);
    }
  });

  it('quotes the quota from the shared tier presets rather than restating numbers', () => {
    const pro = SIGNUP_OFFERS.find((offer) => offer.tierKey === 'PRO_999')!;
    assert.match(offerLimitsLabel(pro), /5 สาขา · 10 คน · อ่านสลิป 100 ใบ\/เดือน/);
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

  it('never renders a "+" in owner-facing copy', () => {
    for (const status of ['CHECKING', 'PENDING_REVIEW', 'AWAITING_CLAIM', 'READY', 'REJECTED', 'EXPIRED'] as const) {
      const copy = signupStatusCopy(status);
      assert.doesNotMatch(`${copy.title} ${copy.body}`, /\+/, status);
    }
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
