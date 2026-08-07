import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasRecordedTax, showsTaxCapture } from './expense-capture-policy';

describe('showsTaxCapture', () => {
  it('shows tax capture only on FULL', () => {
    assert.equal(showsTaxCapture('FULL'), true);
    assert.equal(showsTaxCapture('SIMPLE'), false);
  });

  // Defaulting LOADING to either answer flashes the wrong form at somebody: FULL flashes the Tax
  // Code card at the users this exists to spare, SIMPLE flashes a missing field at a registered one.
  it('renders nothing while the answer is in flight', () => {
    assert.equal(showsTaxCapture('LOADING'), false);
    assert.equal(showsTaxCapture('LOADING', true), false);
  });

  // Spec §7.5. Hiding is presentation, never deletion.
  it('still shows an expense that already records tax inside a SIMPLE workspace', () => {
    assert.equal(showsTaxCapture('SIMPLE', true), true);
  });
});

describe('hasRecordedTax', () => {
  it('detects VAT, a Tax Code id, and an external code', () => {
    assert.equal(hasRecordedTax([{ vatAmount: '37.94' }]), true);
    assert.equal(hasRecordedTax([{ taxCodeDefinitionId: 'tax-o7' }]), true);
    assert.equal(hasRecordedTax([{ externalTaxCode: 'O7' }]), true);
    assert.equal(hasRecordedTax([{ vatAmount: '0' }, { vatAmount: '0.00' }]), false);
    assert.equal(hasRecordedTax([]), false);
  });

  // A credit-note line carries negative VAT; it is still recorded tax.
  it('treats a negative VAT amount as recorded tax', () => {
    assert.equal(hasRecordedTax([{ vatAmount: '-37.94' }]), true);
  });

  it('is not confused by null and undefined fields', () => {
    assert.equal(hasRecordedTax([{ vatAmount: null, taxCodeDefinitionId: null, externalTaxCode: null }]), false);
    assert.equal(hasRecordedTax([{}]), false);
  });
});
