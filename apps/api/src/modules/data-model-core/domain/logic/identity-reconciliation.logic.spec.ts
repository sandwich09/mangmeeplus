import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_HEAD_OFFICE_DISCRIMINATOR,
  compareTaxId,
  findBranchDuplicates,
  findVatHint,
  generateFindings,
  maskTaxId,
  type BranchRow,
  type GeneratorInput,
} from './identity-reconciliation.logic';

function branch(overrides: Partial<BranchRow> & Pick<BranchRow, 'id'>): BranchRow {
  return { type: 'BRANCH', status: 'ACTIVE', taxBranchCode: null, ...overrides };
}

function input(overrides: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    companyTaxId: null,
    profileTaxId: null,
    companyVatRegistered: false,
    profileVatRegistered: false,
    profileVatEffectiveDate: null,
    hasLiveVatFact: false,
    branches: [],
    ...overrides,
  };
}

describe('maskTaxId', () => {
  it('keeps only the last four digits', () => {
    assert.equal(maskTaxId('0105556000001'), '••••0001');
    assert.equal(maskTaxId(null), null);
    assert.equal(maskTaxId('12'), '12');
  });
});

describe('compareTaxId', () => {
  // An agreeing pair is not a finding. Writing a row per company per run would make the report
  // a scan of noise and make "PENDING = 0" impossible to reach.
  it('returns nothing when both sides agree, including both empty', () => {
    assert.equal(compareTaxId({ companyTaxId: null, profileTaxId: null }), null);
    assert.equal(compareTaxId({ companyTaxId: '0105556000001', profileTaxId: '0105556000001' }), null);
    assert.equal(compareTaxId({ companyTaxId: '', profileTaxId: null }), null);
  });

  it('separates one-sided from conflicting', () => {
    assert.equal(compareTaxId({ companyTaxId: '0105556000001', profileTaxId: null })?.sourceState, 'PENDING_ONE_SIDED');
    assert.equal(compareTaxId({ companyTaxId: null, profileTaxId: '0105556000001' })?.sourceState, 'PENDING_ONE_SIDED');
    assert.equal(
      compareTaxId({ companyTaxId: '0105556000001', profileTaxId: '0994000165676' })?.sourceState,
      'PENDING_CONFLICT',
    );
  });

  it('masks both sides in the stored payload', () => {
    const finding = compareTaxId({ companyTaxId: '0105556000001', profileTaxId: '0994000165676' });
    assert.deepEqual(finding?.payloadMaskedJson, { companyTaxIdLast4: '••••0001', profileTaxIdLast4: '••••5676' });
  });

  it('changes the fingerprint when either side moves', () => {
    const a = compareTaxId({ companyTaxId: '0105556000001', profileTaxId: null })!;
    const b = compareTaxId({ companyTaxId: '0105556000002', profileTaxId: null })!;
    assert.notEqual(a.sourceFingerprint, b.sourceFingerprint);
  });
});

describe('findBranchDuplicates', () => {
  it('reports a duplicated tax branch code among ACTIVE branches only', () => {
    const findings = findBranchDuplicates([
      branch({ id: 'b1', taxBranchCode: '00001' }),
      branch({ id: 'b2', taxBranchCode: '00001' }),
      branch({ id: 'b3', taxBranchCode: '00002' }),
      branch({ id: 'b4', taxBranchCode: '00002', status: 'ARCHIVED' }),
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].discriminator, '00001');
    assert.deepEqual(findings[0].payloadMaskedJson, { taxBranchCode: '00001', branchIds: ['b1', 'b2'] });
  });

  it('ignores branches with no tax branch code', () => {
    assert.deepEqual(findBranchDuplicates([branch({ id: 'b1' }), branch({ id: 'b2' })]), []);
  });

  // The B1 constraint refuses a second ACTIVE head office too, and an unregistered one has no
  // code to key the finding on.
  it('reports more than one ACTIVE head office under its own discriminator', () => {
    const findings = findBranchDuplicates([
      branch({ id: 'b1', type: 'HEAD_OFFICE' }),
      branch({ id: 'b2', type: 'HEAD_OFFICE' }),
      branch({ id: 'b3', type: 'HEAD_OFFICE', status: 'ARCHIVED' }),
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].discriminator, ACTIVE_HEAD_OFFICE_DISCRIMINATOR);
    assert.deepEqual((findings[0].payloadMaskedJson as any).branchIds, ['b1', 'b2']);
  });

  it('is stable in order and fingerprint regardless of input order', () => {
    const a = findBranchDuplicates([branch({ id: 'b2', taxBranchCode: '9' }), branch({ id: 'b1', taxBranchCode: '9' })]);
    const b = findBranchDuplicates([branch({ id: 'b1', taxBranchCode: '9' }), branch({ id: 'b2', taxBranchCode: '9' })]);
    assert.equal(a[0].sourceFingerprint, b[0].sourceFingerprint);
  });
});

describe('findVatHint', () => {
  // A ticked box with no date is somebody's memory, not a fact. Seeding it as one would put an
  // invented registration date on the company's tax record.
  it('flags a dateless legacy claim', () => {
    const finding = findVatHint({
      companyVatRegistered: false,
      profileVatRegistered: true,
      profileVatEffectiveDate: null,
      hasLiveVatFact: false,
    });
    assert.equal(finding?.sourceState, 'PENDING_ONE_SIDED');
    assert.deepEqual(finding?.payloadMaskedJson, { vatRegistered: true, vatEffectiveDate: null });
  });

  it('stops flagging once any live fact exists', () => {
    assert.equal(
      findVatHint({
        companyVatRegistered: true,
        profileVatRegistered: true,
        profileVatEffectiveDate: null,
        hasLiveVatFact: true,
      }),
      null,
    );
  });

  it('does not flag a company that never claimed registration', () => {
    assert.equal(
      findVatHint({
        companyVatRegistered: false,
        profileVatRegistered: false,
        profileVatEffectiveDate: null,
        hasLiveVatFact: false,
      }),
      null,
    );
  });
});

describe('generateFindings', () => {
  it('returns nothing for a clean company', () => {
    assert.deepEqual(generateFindings(input({ companyTaxId: '0105556000001', profileTaxId: '0105556000001' })), []);
  });

  it('collects every kind at once', () => {
    const findings = generateFindings(
      input({
        companyTaxId: '0105556000001',
        profileTaxId: null,
        profileVatRegistered: true,
        branches: [branch({ id: 'b1', taxBranchCode: '00001' }), branch({ id: 'b2', taxBranchCode: '00001' })],
      }),
    );
    assert.deepEqual(
      findings.map((f) => `${f.kind}:${f.discriminator}`),
      ['TAX_ID:TAX_ID', 'BRANCH_DUP:00001', 'VAT_HINT:VAT_HINT'],
    );
  });
});
