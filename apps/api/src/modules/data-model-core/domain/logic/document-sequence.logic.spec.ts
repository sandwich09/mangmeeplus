import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePrefixTemplate,
  formatDocumentNumber,
  buildPeriodKey,
  getDefaultDocumentSequenceConfig,
} from './document-sequence.logic';

describe('document-sequence.logic', () => {
  describe('validatePrefixTemplate', () => {
    it('accepts valid template with {SEQ}', () => assert.equal(validatePrefixTemplate('INV-{YYYY}{MM}-{SEQ}'), null));
    it('rejects template without {SEQ}', () => assert.notEqual(validatePrefixTemplate('INV-{YYYY}{MM}'), null));
    it('rejects unknown placeholder', () => assert.notEqual(validatePrefixTemplate('INV-{INVALID}-{SEQ}'), null));
    it('accepts all valid placeholders', () => {
      assert.equal(validatePrefixTemplate('{YYYY}{YY}{MM}{BRANCH}{DOC}{SEQ}'), null);
    });
  });

  describe('formatDocumentNumber', () => {
    const ctx = { year: 2026, month: 6, sequenceNumber: 1, padding: 5 };
    it('renders YYYY, MM, SEQ', () => {
      assert.equal(formatDocumentNumber('INV-{YYYY}{MM}-{SEQ}', ctx), 'INV-202606-00001');
    });
    it('renders YY', () => {
      assert.equal(formatDocumentNumber('{YY}{MM}-{SEQ}', ctx), '2606-00001');
    });
    it('renders BRANCH placeholder', () => {
      assert.equal(formatDocumentNumber('{BRANCH}-{SEQ}', { ...ctx, branchCode: 'HO' }), 'HO-00001');
    });
    it('pads sequence to padding length', () => {
      assert.equal(formatDocumentNumber('{SEQ}', { ...ctx, sequenceNumber: 42, padding: 3 }), '042');
    });
  });

  describe('buildPeriodKey', () => {
    const date = new Date('2026-06-24T00:00:00.000Z');
    it('returns ALL for NONE policy', () => assert.equal(buildPeriodKey('NONE', date), 'ALL'));
    it('returns year for YEARLY policy', () => assert.equal(buildPeriodKey('YEARLY', date), '2026'));
    it('returns YYYY-MM for MONTHLY policy', () => assert.equal(buildPeriodKey('MONTHLY', date), '2026-06'));
    it('uses the Bangkok month at the UTC month boundary', () => {
      assert.equal(buildPeriodKey('MONTHLY', new Date('2026-08-31T19:00:00.000Z')), '2026-09');
    });
  });

  describe('getDefaultDocumentSequenceConfig', () => {
    it('returns the system expense default without accepting unknown types', () => {
      assert.deepEqual(getDefaultDocumentSequenceConfig('expense.record'), {
        prefixTemplate: 'EXP-{YYYY}{MM}-{SEQ}',
        padding: 5,
        resetPolicy: 'MONTHLY',
      });
      assert.deepEqual(getDefaultDocumentSequenceConfig('expense.substitute_receipt'), {
        prefixTemplate: 'SRC-{YYYY}{MM}-{SEQ}',
        padding: 5,
        resetPolicy: 'MONTHLY',
      });
      assert.equal(getDefaultDocumentSequenceConfig('custom.unknown'), undefined);
    });
  });
});
