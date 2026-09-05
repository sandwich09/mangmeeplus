import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANY_SIGNUP_STATES,
  SIGNUP_SOURCE_LINE_OA,
  canTransitionCompanySignup,
  companySignupPayloadHash,
  normalizeCompanySignupInput,
  type CompanySignupInput,
} from './company-signup.logic';

const VALID: CompanySignupInput = {
  externalSignupId: '0f9b1d2e-3c4a-4b5c-8d7e-1f2a3b4c5d6e',
  companyName: 'ร้านมั่งมี',
  ownerFirstName: 'สมชาย',
  ownerLastName: 'ใจดี',
  contactEmail: 'Somchai@Example.com',
  consentVersion: 'v1',
};

describe('Flow B transition map', () => {
  it('routes VALIDATED through the admin gate and nowhere else', () => {
    assert.equal(canTransitionCompanySignup('VALIDATED', 'PENDING_REVIEW'), true);
    // The whole point of Flow B: approval cannot be skipped on the way to the claim email.
    assert.equal(canTransitionCompanySignup('VALIDATED', 'EMAIL_PENDING'), false);
    assert.equal(canTransitionCompanySignup('RECEIVED', 'PENDING_REVIEW'), false);
  });

  it('lets review approve or reject, and nothing else', () => {
    assert.equal(canTransitionCompanySignup('PENDING_REVIEW', 'EMAIL_PENDING'), true);
    assert.equal(canTransitionCompanySignup('PENDING_REVIEW', 'REJECTED'), true);
    assert.equal(canTransitionCompanySignup('PENDING_REVIEW', 'EMAIL_VERIFIED'), false);
    assert.equal(canTransitionCompanySignup('PENDING_REVIEW', 'PROVISIONING'), false);
  });

  it('keeps one way back from EXPIRED so an approval never dead-ends', () => {
    assert.equal(canTransitionCompanySignup('EXPIRED', 'EMAIL_PENDING'), true);
    assert.equal(canTransitionCompanySignup('EMAIL_FAILED', 'EMAIL_PENDING'), true);
    // But an expired application cannot skip back into the middle of the flow.
    assert.equal(canTransitionCompanySignup('EXPIRED', 'EMAIL_VERIFIED'), false);
    assert.equal(canTransitionCompanySignup('EXPIRED', 'PENDING_REVIEW'), false);
  });

  it('treats REJECTED as terminal', () => {
    assert.equal(canTransitionCompanySignup('REJECTED', 'EMAIL_PENDING'), false);
    assert.equal(canTransitionCompanySignup('REJECTED', 'PENDING_REVIEW'), false);
  });

  it('leaves the provisioning half of the machine untouched', () => {
    assert.equal(canTransitionCompanySignup('EMAIL_VERIFIED', 'PROVISIONING'), true);
    assert.equal(canTransitionCompanySignup('PROVISIONING', 'READY'), true);
    assert.equal(canTransitionCompanySignup('READY', 'LINE_LINK_PENDING'), true);
    assert.equal(canTransitionCompanySignup('LINE_LINK_PENDING', 'COMPLETED'), true);
    assert.equal(canTransitionCompanySignup('COMPLETED', 'RECEIVED'), false);
  });
});

// P10-L §5. The two tables are separate on purpose: the guarantee is not "LINE has more moves",
// it is that neither source can borrow the other's.
describe('line-oa transition map', () => {
  const can = (from: any, to: any) => canTransitionCompanySignup(from, to, SIGNUP_SOURCE_LINE_OA);

  it('walks submit → review → provision → ready → completed', () => {
    assert.equal(can('RECEIVED', 'VALIDATED'), true);
    assert.equal(can('VALIDATED', 'PENDING_REVIEW'), true);
    assert.equal(can('PENDING_REVIEW', 'PROVISIONING'), true);
    assert.equal(can('PROVISIONING', 'READY'), true);
    // LINE_LINK_PENDING is skipped: the identity is linked inside the provisioning transaction.
    assert.equal(can('READY', 'COMPLETED'), true);
    assert.equal(can('READY', 'LINE_LINK_PENDING'), false);
  });

  it('lets AUTO_FREE skip the queue, which the web form may never do', () => {
    assert.equal(can('VALIDATED', 'PROVISIONING'), true);
    assert.equal(canTransitionCompanySignup('VALIDATED', 'PROVISIONING'), false, 'official-site');
  });

  it('has no EMAIL_* edge anywhere — there is no address to mail', () => {
    for (const to of ['EMAIL_PENDING', 'EMAIL_VERIFIED', 'EMAIL_FAILED'] as const) {
      for (const from of COMPANY_SIGNUP_STATES) {
        assert.equal(can(from, to), false, `${from} → ${to} must not exist for line-oa`);
      }
    }
    // And nothing leads out of an EMAIL_* state either, so a mis-tagged row is stuck, not loose.
    for (const from of ['EMAIL_PENDING', 'EMAIL_VERIFIED', 'EMAIL_FAILED'] as const) {
      for (const to of COMPANY_SIGNUP_STATES) assert.equal(can(from, to), false);
    }
  });

  it('keeps the recovery and stop edges', () => {
    assert.equal(can('PROVISIONING', 'PROVISIONING_FAILED'), true);
    assert.equal(can('PROVISIONING_FAILED', 'PROVISIONING'), true, 'an admin retry is idempotent');
    assert.equal(can('PENDING_REVIEW', 'REJECTED'), true);
    // §3.7: an auto-approved shop is stopped after the fact, so COMPLETED is not terminal here.
    assert.equal(can('COMPLETED', 'SUSPENDED'), true);
    assert.equal(canTransitionCompanySignup('COMPLETED', 'SUSPENDED'), false, 'official-site');
    assert.equal(can('SUSPENDED', 'PROVISIONING'), false);
  });

  it('falls back to the stricter web table for an unknown source', () => {
    assert.equal(canTransitionCompanySignup('VALIDATED', 'PROVISIONING', 'some-future-source'), false);
  });
});

describe('normalizeCompanySignupInput — Flow B fields', () => {
  it('normalises the new form fields and defaults them to null', () => {
    const bare = normalizeCompanySignupInput(VALID);
    assert.equal(bare.businessType, null);
    assert.equal(bare.phoneNumber, null);
    assert.equal(bare.vatRegistered, null);
    assert.equal(bare.contactEmail, 'somchai@example.com');

    const full = normalizeCompanySignupInput({
      ...VALID, businessType: '  ร้านค้าปลีก ', phoneNumber: ' 098-256-5628 ', vatRegistered: true,
    });
    assert.equal(full.businessType, 'ร้านค้าปลีก');
    assert.equal(full.phoneNumber, '098-256-5628');
    assert.equal(full.vatRegistered, true);
    // false is a real answer, not an absent one.
    assert.equal(normalizeCompanySignupInput({ ...VALID, vatRegistered: false }).vatRegistered, false);
  });

  it('rejects a phone number that is not a phone number', () => {
    assert.throws(() => normalizeCompanySignupInput({ ...VALID, phoneNumber: 'call me' }), /invalid_phoneNumber/);
    assert.throws(() => normalizeCompanySignupInput({ ...VALID, phoneNumber: '123' }), /invalid_phoneNumber/);
  });

  // Owner 2026-09-05 (R02): there is no package choice at signup any more — every self-signed-up
  // shop starts on the same free trial. The key survives as attribution evidence only, so an
  // in-flight client that still sends a catalog key must not have its application refused over a
  // label the server no longer reads.
  it('records the requested offer key as attribution and never refuses an application over it', () => {
    assert.equal(normalizeCompanySignupInput({ ...VALID, requestedOfferKey: 'PRO_TRIAL' }).requestedOfferKey, 'PRO_TRIAL');
    assert.equal(normalizeCompanySignupInput({ ...VALID, requestedOfferKey: 'PRO_999' }).requestedOfferKey, 'PRO_999');
    // Anything outside the catalog is dropped rather than stored — the operator's queue must never
    // render free text an applicant chose for this field.
    assert.equal(normalizeCompanySignupInput({ ...VALID, requestedOfferKey: 'FREE_FOREVER' }).requestedOfferKey, null);
    assert.equal(normalizeCompanySignupInput({ ...VALID, requestedOfferKey: '  ' }).requestedOfferKey, null);
  });

  it('folds the new fields into the idempotency hash', () => {
    const base = companySignupPayloadHash(normalizeCompanySignupInput(VALID));
    const withPhone = companySignupPayloadHash(
      normalizeCompanySignupInput({ ...VALID, phoneNumber: '0982565628' }),
    );
    // Same key with a changed payload must be detectable as a conflict, so the hash has to move.
    assert.notEqual(base, withPhone);
    // Whitespace and case are normalisation, not a different submission.
    assert.equal(
      companySignupPayloadHash(normalizeCompanySignupInput({ ...VALID, contactEmail: ' SOMCHAI@example.com ' })),
      base,
    );
  });
});
