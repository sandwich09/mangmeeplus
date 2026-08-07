import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validBuyerSnapshotV1, type BuyerSnapshotV1 } from './buyer-snapshot-v1.js';
import { COMPANY_TAX_IDENTITY_ERROR_CODES } from './company-tax-identity.js';

const registered: BuyerSnapshotV1 = {
  snapshotSchemaVersion: 1,
  id: 'cp_1',
  displayName: 'บริษัท ทดสอบ จำกัด',
  legalName: 'บริษัท ทดสอบ จำกัด',
  taxId: '0105556000001',
  buyerEntityKind: 'JURISTIC',
  buyerVatStatus: 'VAT_REGISTERED',
  isForeign: false,
  country: null,
  addressText: '99/1 ถนนสุขุมวิท คลองเตย กรุงเทพฯ 10110',
  branchCode: '00000',
};

const notRegistered: BuyerSnapshotV1 = {
  ...registered,
  buyerEntityKind: 'INDIVIDUAL',
  buyerVatStatus: 'NOT_REGISTERED',
  taxId: null,
  branchCode: null,
};

describe('validBuyerSnapshotV1', () => {
  it('accepts a complete registered and a complete non-registered snapshot', () => {
    assert.equal(validBuyerSnapshotV1(registered), true);
    assert.equal(validBuyerSnapshotV1(notRegistered), true);
  });

  // The reason report 6 has anything to report: pre-feature snapshots are four keys and no
  // schema version, so they fail without a backfill flag telling us which ones are old.
  it('rejects the legacy four-key snapshot frozen before this feature', () => {
    assert.equal(
      validBuyerSnapshotV1({ id: 'cp_1', displayName: 'x', taxId: null, legalName: null }),
      false,
    );
  });

  it('rejects a missing key rather than treating it as null', () => {
    const { branchCode: _dropped, ...withoutBranchCode } = notRegistered;
    assert.equal(validBuyerSnapshotV1(withoutBranchCode), false);
  });

  it('rejects an unknown key instead of ignoring it', () => {
    assert.equal(validBuyerSnapshotV1({ ...registered, buyerNickname: 'x' }), false);
  });

  // ประกาศ 199 covers every registered operator: a foreign buyer holding a Thai VAT
  // registration still needs the 13-digit id and the 5-digit establishment code.
  it('requires Thai tax id and branch code whenever VAT-registered, foreign included', () => {
    assert.equal(validBuyerSnapshotV1({ ...registered, isForeign: true, country: 'JP' }), true);
    assert.equal(validBuyerSnapshotV1({ ...registered, taxId: null }), false);
    assert.equal(validBuyerSnapshotV1({ ...registered, branchCode: null }), false);
    assert.equal(validBuyerSnapshotV1({ ...registered, taxId: '01055560000' }), false);
    assert.equal(validBuyerSnapshotV1({ ...registered, branchCode: '0' }), false);
  });

  it('allows null tax fields when not registered but still rejects malformed ones', () => {
    assert.equal(validBuyerSnapshotV1({ ...notRegistered, taxId: '0105556000001', branchCode: '00000' }), true);
    assert.equal(validBuyerSnapshotV1({ ...notRegistered, taxId: '123' }), false);
    assert.equal(validBuyerSnapshotV1({ ...notRegistered, branchCode: 'HQ' }), false);
  });

  it('requires a country for a foreign buyer', () => {
    assert.equal(validBuyerSnapshotV1({ ...notRegistered, isForeign: true, country: null }), false);
    assert.equal(validBuyerSnapshotV1({ ...notRegistered, isForeign: true, country: '  ' }), false);
    assert.equal(validBuyerSnapshotV1({ ...notRegistered, isForeign: true, country: 'JP' }), true);
  });

  it('requires a printable name and address', () => {
    assert.equal(validBuyerSnapshotV1({ ...registered, displayName: '' }), false);
    assert.equal(validBuyerSnapshotV1({ ...registered, addressText: '   ' }), false);
  });

  it('rejects UNKNOWN, a wrong schema version, and non-objects', () => {
    assert.equal(validBuyerSnapshotV1({ ...registered, buyerVatStatus: 'UNKNOWN' }), false);
    assert.equal(validBuyerSnapshotV1({ ...registered, snapshotSchemaVersion: 2 }), false);
    for (const bad of [null, undefined, 'x', 42, [registered]]) {
      assert.equal(validBuyerSnapshotV1(bad), false, JSON.stringify(bad));
    }
  });
});

describe('company tax identity error codes', () => {
  // Spec §13 fixes the count at 15. A sixteenth code means a screen with no Thai copy.
  it('is exactly the 15 codes the spec lists, with no duplicates', () => {
    assert.equal(COMPANY_TAX_IDENTITY_ERROR_CODES.length, 15);
    assert.equal(new Set(COMPANY_TAX_IDENTITY_ERROR_CODES).size, 15);
    assert.ok(!COMPANY_TAX_IDENTITY_ERROR_CODES.includes('counterparty_anchor_mismatch' as never));
  });
});
