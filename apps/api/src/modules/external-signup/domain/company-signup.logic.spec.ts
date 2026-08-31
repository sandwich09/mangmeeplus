import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
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

  it('accepts only the sellable offer key and never falls back silently', () => {
    assert.equal(normalizeCompanySignupInput({ ...VALID, requestedOfferKey: 'PRO_TRIAL' }).requestedOfferKey, 'PRO_TRIAL');
    // A tier that exists in the catalog but is not sellable yet is still refused (spec §3A).
    assert.throws(() => normalizeCompanySignupInput({ ...VALID, requestedOfferKey: 'PRO_999' }), /offer_not_available/);
    assert.throws(() => normalizeCompanySignupInput({ ...VALID, requestedOfferKey: 'FREE_FOREVER' }), /offer_not_available/);
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
