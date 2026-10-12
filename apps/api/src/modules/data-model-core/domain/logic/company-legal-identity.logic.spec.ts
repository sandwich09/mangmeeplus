import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  allowedChangeKinds,
  changedIdentityFields,
  normalizeTaxId,
  rejectLegalIdentityChange,
  validateLegalAddress,
  type LegalIdentityChangeContext,
} from './company-legal-identity.logic';
import { thaiTaxIdChecksumValid } from '@watchdog-bms/contracts';

const TODAY = '2026-08-04';

function context(overrides: Partial<LegalIdentityChangeContext> = {}): LegalIdentityChangeContext {
  return {
    changedFields: ['registeredName'],
    captureWindowOpen: false,
    authoritativeLatched: false,
    fieldLatched: { registeredName: false, addressJson: false },
    lastLegalChangeEffectiveDate: null,
    today: TODAY,
    ...overrides,
  };
}

const ADDRESS = {
  line1: '99/1 ถนนสุขุมวิท',
  subdistrict: 'คลองเตย',
  district: 'คลองเตย',
  province: 'กรุงเทพมหานคร',
  postalCode: '10110',
};

describe('tax id normalization and checksum', () => {
  it('keeps digits only, so a number pasted off a ภ.พ.20 still matches', () => {
    assert.equal(normalizeTaxId('0-1055-56000-00-1'), '0105556000001');
    assert.equal(normalizeTaxId(' 0105556000001 '), '0105556000001');
  });

  // Public juristic vectors only — never a real individual's number.
  it('computes the mod-11 check digit', () => {
    assert.equal(thaiTaxIdChecksumValid('0994000165676'), true);
    assert.equal(thaiTaxIdChecksumValid('0994000165677'), false);
    assert.equal(thaiTaxIdChecksumValid('099400016567'), false);
  });
});

describe('validateLegalAddress', () => {
  it('accepts the closed shape and trims', () => {
    const result = validateLegalAddress({ ...ADDRESS, line1: '  99/1 ถนนสุขุมวิท  ' });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.line1, '99/1 ถนนสุขุมวิท');
    assert.equal(result.ok && result.value.line2, null);
  });

  // Dropping the key silently would tell the user their address was saved while the line it
  // was in never reaches the printed tax invoice.
  it('rejects an unknown key instead of dropping it', () => {
    const result = validateLegalAddress({ ...ADDRESS, village: 'หมู่บ้าน' });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((e) => e.includes('village')));
  });

  it('requires every field except line2 and a 5-digit postcode', () => {
    const missing = validateLegalAddress({ line1: 'x', subdistrict: '', district: 'd', province: 'p', postalCode: '101' });
    assert.equal(missing.ok, false);
    assert.ok(!missing.ok && missing.errors.some((e) => e.includes('subdistrict')));
    assert.ok(!missing.ok && missing.errors.some((e) => e.includes('postalCode')));
    assert.equal(validateLegalAddress('nope').ok, false);
  });
});

describe('allowedChangeKinds', () => {
  // The regression the capture window exists for: the wizard saves per step, so by step 2 the
  // version has already moved. Binding capture to version 0 would break the wizard's own flow.
  it('offers only INITIAL_CAPTURE while the window is open, at any version', () => {
    assert.deepEqual(allowedChangeKinds(context({ captureWindowOpen: true })), ['INITIAL_CAPTURE']);
    assert.deepEqual(
      allowedChangeKinds(context({ captureWindowOpen: true, authoritativeLatched: true, changedFields: ['taxId'] })),
      ['INITIAL_CAPTURE'],
    );
  });

  it('never offers CORRECTION for a tax id once the window is closed', () => {
    assert.deepEqual(allowedChangeKinds(context({ changedFields: ['taxId'] })), ['LEGAL_CHANGE']);
  });

  it('offers CORRECTION only while nothing is latched', () => {
    assert.deepEqual(allowedChangeKinds(context()), ['CORRECTION', 'LEGAL_CHANGE']);
    assert.deepEqual(allowedChangeKinds(context({ authoritativeLatched: true })), ['LEGAL_CHANGE']);
    assert.deepEqual(
      allowedChangeKinds(context({ fieldLatched: { registeredName: true, addressJson: false } })),
      ['LEGAL_CHANGE'],
    );
    // A latch on a field this edit does not touch does not restrict the edit.
    assert.deepEqual(
      allowedChangeKinds(context({ fieldLatched: { registeredName: false, addressJson: true } })),
      ['CORRECTION', 'LEGAL_CHANGE'],
    );
  });
});

describe('rejectLegalIdentityChange', () => {
  it('accepts an initial capture with no date and no reason', () => {
    assert.equal(rejectLegalIdentityChange({ changeKind: 'INITIAL_CAPTURE' }, context({ captureWindowOpen: true })), null);
  });

  it('names the kinds the UI should offer when the kind is wrong', () => {
    const rejection = rejectLegalIdentityChange(
      { changeKind: 'CORRECTION', correctionReason: 'TYPO', note: 'n' },
      context({ authoritativeLatched: true }),
    );
    assert.equal(rejection?.code, 'identity_change_kind_not_allowed');
    assert.deepEqual((rejection as any).allowedChangeKinds, ['LEGAL_CHANGE']);
  });

  it('rejects INITIAL_CAPTURE forever once the window has closed', () => {
    const rejection = rejectLegalIdentityChange({ changeKind: 'INITIAL_CAPTURE' }, context());
    assert.equal(rejection?.code, 'identity_change_kind_not_allowed');
  });

  it('requires a monotonic, non-future effectiveFrom on a legal change', () => {
    assert.equal(rejectLegalIdentityChange({ changeKind: 'LEGAL_CHANGE', effectiveFrom: TODAY }, context()), null);
    assert.match(
      rejectLegalIdentityChange({ changeKind: 'LEGAL_CHANGE' }, context())?.reason ?? '',
      /effectiveFrom/,
    );
    assert.match(
      rejectLegalIdentityChange(
        { changeKind: 'LEGAL_CHANGE', effectiveFrom: '2026-01-01' },
        context({ lastLegalChangeEffectiveDate: '2026-06-01' }),
      )?.reason ?? '',
      /must not precede/,
    );
    assert.match(
      rejectLegalIdentityChange({ changeKind: 'LEGAL_CHANGE', effectiveFrom: '2026-08-05' }, context())?.reason ?? '',
      /future/,
    );
    assert.match(
      rejectLegalIdentityChange({ changeKind: 'LEGAL_CHANGE', effectiveFrom: '2026-02-30' }, context())?.reason ?? '',
      /effectiveFrom/,
    );
  });

  it('requires a reason and a note on a correction, and no legal date', () => {
    assert.equal(
      rejectLegalIdentityChange({ changeKind: 'CORRECTION', correctionReason: 'TYPO', note: 'พิมพ์ผิด' }, context()),
      null,
    );
    assert.match(rejectLegalIdentityChange({ changeKind: 'CORRECTION', note: 'x' }, context())?.reason ?? '', /correctionReason/);
    assert.match(
      rejectLegalIdentityChange({ changeKind: 'CORRECTION', correctionReason: 'TYPO' }, context())?.reason ?? '',
      /note/,
    );
    assert.match(
      rejectLegalIdentityChange(
        { changeKind: 'CORRECTION', correctionReason: 'TYPO', note: 'x', effectiveFrom: TODAY },
        context(),
      )?.reason ?? '',
      /only valid for a legal change/,
    );
  });

  it('rejects a no-op and an unknown kind', () => {
    assert.match(
      rejectLegalIdentityChange({ changeKind: 'CORRECTION' }, context({ changedFields: [] }))?.reason ?? '',
      /no identity field/,
    );
    assert.match(
      rejectLegalIdentityChange({ changeKind: 'RECONCILIATION_CORRECTION' as never }, context())?.reason ?? '',
      /changeKind must be one of/,
    );
  });
});

describe('changedIdentityFields', () => {
  const current = { taxId: '0105556000001', registeredName: 'บริษัท ก จำกัด', addressJson: { ...ADDRESS, line2: null } };

  it('reports only fields whose normalized value actually moved', () => {
    assert.deepEqual(changedIdentityFields(current, {}), []);
    assert.deepEqual(changedIdentityFields(current, { registeredName: 'บริษัท ก จำกัด' }), []);
    assert.deepEqual(changedIdentityFields(current, { addressJson: { ...ADDRESS, line2: null } }), []);
    assert.deepEqual(changedIdentityFields(current, { registeredName: 'บริษัท ข จำกัด' }), ['registeredName']);
    assert.deepEqual(changedIdentityFields(current, { addressJson: { ...ADDRESS, postalCode: '10120' } }), ['addressJson']);
  });

  it('treats first capture on empty values as a change', () => {
    assert.deepEqual(
      changedIdentityFields({ taxId: null, registeredName: null, addressJson: null }, { taxId: '0105556000001' }),
      ['taxId'],
    );
  });
});
