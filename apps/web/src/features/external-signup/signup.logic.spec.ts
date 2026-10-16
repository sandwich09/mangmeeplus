import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_SIGNUP_STATUS_KEYS } from '@watchdog-bms/contracts';
import {
  clampMobileInput,
  firstSignupErrorField,
  isTransientLoadFailure,
  isThaiMobile,
  MOBILE_DIGITS,
  clampSalesCodeInput,
  rotateSignupKeyAfter,
  SELECTABLE_OFFER_KEY,
  SIGNUP_CONSENT_VERSION,
  SIGNUP_TRIAL_AFTER,
  SIGNUP_TRIAL_HEADLINE,
  showsTrialNotice,
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
  vatRegistered: false,
  taxId: '',
  discoverySource: '',
  discoverySourceOther: '',
  referralSalesCode: '',
};

describe('รู้จักเราทางไหน + รหัสเซลล์ (D6)', () => {
  it('leaves the question optional — nobody is stopped for skipping it', () => {
    assert.deepEqual(validateSignupForm(validForm), {});
    assert.deepEqual(validateSignupForm({ ...validForm, discoverySource: 'IG' }), {});
  });

  it('demands a well-formed code once the applicant says a เซลล์ sent them', () => {
    assert.match(validateSignupForm({ ...validForm, discoverySource: 'SALES' }).referralSalesCode ?? '', /กรอกรหัสเซลล์/);
    assert.ok(validateSignupForm({ ...validForm, discoverySource: 'SALES', referralSalesCode: 'AB' }).referralSalesCode);
    assert.deepEqual(validateSignupForm({ ...validForm, discoverySource: 'SALES', referralSalesCode: 'TON1' }), {});
  });

  it('normalises what the box may hold, so a lowercase or dashed code still reaches the server clean', () => {
    assert.equal(clampSalesCodeInput('ton-1'), 'TON1');
    assert.equal(clampSalesCodeInput('abcdefgh'), 'ABCDEF');
  });

  it('puts an unknown code under its own field, not in a banner above a long form', () => {
    const rejection = signupFieldRejection({ code: 'SALES_CODE_UNKNOWN' });
    assert.equal(rejection?.field, 'referralSalesCode');
    assert.match(rejection?.message ?? '', /ตรวจสอบกับเซลล์ของคุณ/);
  });

  it('caps the free-text "อื่น ๆ" answer at the contract length', () => {
    assert.ok(validateSignupForm({ ...validForm, discoverySource: 'OTHER', discoverySourceOther: 'x'.repeat(201) }).discoverySourceOther);
    assert.deepEqual(validateSignupForm({ ...validForm, discoverySource: 'OTHER', discoverySourceOther: 'เพื่อนแนะนำ' }), {});
  });
});

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
    assert.match(errors.phoneNumber!, /เบอร์มือถือ/);
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

  // §15.4.1 D: one rule, one sentence. "ขึ้นต้นด้วย 0" read to the Owner as "leave the 0 out", and
  // the profile page, this form and the API's invalid_phone_number each said it differently.
  it('states the mobile rule in the same plain sentence the rest of the product uses', () => {
    assert.equal(
      validateSignupForm({ ...validForm, phoneNumber: '0812345' }).phoneNumber,
      'เบอร์มือถือต้องมี 10 หลัก เช่น 0812345678',
    );
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

// Owner 2026-09-20 (spec R1): there is no free trial. Signing up opens the shop and nothing else,
// so the copy may not promise free days, a free allowance, or any usable capacity before payment.
describe('what signing up gets you', () => {
  it('promises an open shop and a package to choose, never free days', () => {
    assert.equal(SIGNUP_TRIAL_HEADLINE, 'เปิดร้านแล้วเลือกแพ็กเกจเพื่อเริ่มใช้งาน');
    for (const line of [SIGNUP_TRIAL_HEADLINE, SIGNUP_TRIAL_AFTER]) {
      assert.doesNotMatch(line, /ฟรี|ทดลอง/);
    }
  });

  it('says what it costs to start without implying an automatic charge', () => {
    assert.match(SIGNUP_TRIAL_AFTER, /249 บาทต่อเดือน/);
    assert.match(SIGNUP_TRIAL_AFTER, /ไม่มีการตัดเงินอัตโนมัติ/);
  });

  it('names no retired tier in either line', () => {
    const copy = `${SIGNUP_TRIAL_HEADLINE} ${SIGNUP_TRIAL_AFTER}`;
    assert.doesNotMatch(copy, /999|฿/);
    assert.doesNotMatch(copy, /\bPRO\b/);
    assert.doesNotMatch(copy, /\+/);
  });

  it('still sends the offer key the server allowlist accepts', () => {
    // The applicant is shown no choice, but the request still carries what the API expects and the
    // admin queue displays. R02 made that key name the trial that is actually provisioned.
    assert.equal(SELECTABLE_OFFER_KEY, 'FREE_TRIAL');
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

  // F8: the free-trial line is a promise about a shop that is coming. Next to "we rejected this",
  // "it stalled" or "this expired" it is an advert on a dead end.
  it('shows the free-trial promise only where a shop is still coming', () => {
    for (const key of ['CHECKING', 'PENDING_REVIEW', 'AWAITING_CLAIM', 'EMAIL_FAILED', 'PREPARING'] as const) {
      assert.equal(showsTrialNotice(key), true, key);
    }
    for (const key of ['REJECTED', 'PREPARING_FAILED', 'EXPIRED'] as const) {
      assert.equal(showsTrialNotice(key), false, key);
    }
  });

  // F9: nothing polls this page, so copy that says it will update on its own is a promise the
  // page does not keep — the applicant sits watching a screen that will never change.
  it('asks for a refresh rather than promising the page updates itself', () => {
    const preparing = signupStatusCopy('PREPARING');
    assert.match(preparing.body, /รีเฟรช/);
    assert.doesNotMatch(preparing.body, /หน้านี้จะบอก/);
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
      /ทำต่อไม่ได้ในสถานะปัจจุบัน/,
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

  // F6: a resolver that could not answer says nothing about the address. It must not accuse the
  // applicant of a typo, and it must not rotate the key — the submission has not been decided.
  it('keeps the key and blames nobody when the domain check could not run', () => {
    const outage = Object.assign(new Error('email_domain_check_unavailable'), { status: 503 });
    assert.equal(rotateSignupKeyAfter(outage), false);
    assert.equal(signupFieldRejection(outage), null);
    const message = signupSubmitErrorMessage(outage);
    assert.match(message, /ตรวจอีเมลไม่ได้ชั่วคราว/);
    assert.match(message, /กดส่งคำขอสมัครอีกครั้ง/);
    assert.doesNotMatch(message, /ตรวจตัวสะกด/);
    assert.doesNotMatch(message, /\+/);
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

  // The field used to accept anything non-empty, so a Thai or spaced username reached the claim
  // endpoint and came back as a 400 nobody could read — after a password had been typed twice.
  it('applies the same username rule the claim endpoint enforces', () => {
    const bad = (username: string) => validateClaimPassword(username, 'abcd1234', 'abcd1234').username;
    assert.ok(bad('ab'), 'shorter than 3');
    assert.ok(bad('a'.repeat(41)), 'longer than 40');
    assert.ok(bad('สมชาย'), 'Thai characters');
    assert.ok(bad('som chai'), 'a space');
    assert.ok(bad('som@chai'), 'a character outside [A-Za-z0-9._-]');
    assert.match(bad('ab')!, /3–40/);
    for (const ok of ['som', 'som.chai', 'som_chai-01', 'A'.repeat(40)]) {
      assert.equal(validateClaimPassword(ok, 'abcd1234', 'abcd1234').username, undefined, ok);
    }
  });

  it('catches a mismatched or missing confirmation, and a blank username', () => {
    assert.ok(validateClaimPassword('somchai', 'abcd1234', '').confirmPassword);
    assert.ok(validateClaimPassword('somchai', 'abcd1234', 'abcd12345').confirmPassword);
    assert.ok(validateClaimPassword('  ', 'abcd1234', 'abcd1234').username);
    assert.deepEqual(validateClaimPassword('somchai', 'abcd1234', 'abcd1234'), {});
  });
});
