import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  sellerIdentityComplete,
  sellerIdentityCompleteHO,
  taxInvoiceEligible,
  type ReadinessBranch,
  type ReadinessCompany,
} from './company-tax-readiness.logic';

const ADDRESS = {
  line1: '99/1 ถนนสุขุมวิท',
  subdistrict: 'คลองเตย',
  district: 'คลองเตย',
  province: 'กรุงเทพมหานคร',
  postalCode: '10110',
};

const COMPANY: ReadinessCompany = { taxId: '0105556000001', registeredName: 'บริษัท ก จำกัด', addressJson: ADDRESS };

function branch(overrides: Partial<ReadinessBranch> = {}): ReadinessBranch {
  return {
    id: 'b-ho',
    type: 'HEAD_OFFICE',
    status: 'ACTIVE',
    isVatEstablishment: true,
    taxBranchCode: '00000',
    addressJson: null,
    ...overrides,
  };
}

describe('sellerIdentityComplete', () => {
  it('is complete for a head office with a company address and an answered VAT prompt', () => {
    assert.deepEqual(sellerIdentityComplete(COMPANY, branch(), true), { complete: true, reasons: [] });
  });

  it('names every missing piece rather than just the first', () => {
    const result = sellerIdentityComplete(
      { taxId: null, registeredName: '  ', addressJson: null },
      branch({ isVatEstablishment: false, taxBranchCode: null }),
      false,
    );
    assert.equal(result.complete, false);
    assert.deepEqual(result.reasons, [
      'tax_id_missing',
      'registered_name_missing',
      'company_address_incomplete',
      'branch_not_tax_establishment',
      'vat_status_unanswered',
    ]);
  });

  it('separates a malformed tax id from a missing one', () => {
    assert.deepEqual(sellerIdentityComplete({ ...COMPANY, taxId: '12345' }, branch(), true).reasons, ['tax_id_invalid']);
  });

  it('treats line2 as optional and every other address field as required', () => {
    assert.equal(sellerIdentityComplete({ ...COMPANY, addressJson: { ...ADDRESS, line2: null } }, branch(), true).complete, true);
    const missing = { ...ADDRESS, district: '' };
    assert.deepEqual(sellerIdentityComplete({ ...COMPANY, addressJson: missing }, branch(), true).reasons, [
      'company_address_incomplete',
    ]);
  });

  // §6.2: only the head office may print the company address, because that is the one case
  // where the establishment and the registered office are the same place.
  it('requires a branch establishment to carry its own address', () => {
    assert.deepEqual(sellerIdentityComplete(COMPANY, branch({ type: 'BRANCH', taxBranchCode: '00001' }), true).reasons, [
      'branch_address_missing',
    ]);
    assert.equal(
      sellerIdentityComplete(COMPANY, branch({ type: 'BRANCH', taxBranchCode: '00001', addressJson: ADDRESS }), true)
        .complete,
      true,
    );
  });

  it('refuses a location that is not a registered establishment, whatever its type', () => {
    assert.deepEqual(
      sellerIdentityComplete(COMPANY, branch({ type: 'WAREHOUSE', isVatEstablishment: false, taxBranchCode: null }), true)
        .reasons,
      ['branch_not_tax_establishment'],
    );
    assert.deepEqual(sellerIdentityComplete(COMPANY, null, true).reasons, ['branch_not_tax_establishment']);
  });

  // An unanswered prompt is unfinished, not "complete but not registered".
  it('counts an unanswered VAT prompt as incomplete', () => {
    assert.deepEqual(sellerIdentityComplete(COMPANY, branch(), false).reasons, ['vat_status_unanswered']);
  });
});

describe('sellerIdentityCompleteHO', () => {
  // The capture window and the authoritative latch hang off this, so a branch cannot establish
  // an identity the head office has not.
  it('reads the ACTIVE head office and ignores other branches', () => {
    const branches = [
      branch({ id: 'b1', type: 'BRANCH', taxBranchCode: '00001', addressJson: ADDRESS }),
      branch({ id: 'b-ho' }),
    ];
    assert.equal(sellerIdentityCompleteHO(COMPANY, branches, true).complete, true);
  });

  it('is incomplete when the head office is archived, even with a complete branch', () => {
    const branches = [
      branch({ id: 'b-ho', status: 'ARCHIVED' }),
      branch({ id: 'b1', type: 'BRANCH', taxBranchCode: '00001', addressJson: ADDRESS }),
    ];
    assert.deepEqual(sellerIdentityCompleteHO(COMPANY, branches, true).reasons, ['branch_not_tax_establishment']);
  });
});

describe('taxInvoiceEligible', () => {
  it('is true only for REGISTERED', () => {
    assert.equal(taxInvoiceEligible('REGISTERED'), true);
    assert.equal(taxInvoiceEligible('NOT_REGISTERED'), false);
    assert.equal(taxInvoiceEligible('UNKNOWN'), false);
  });
});
