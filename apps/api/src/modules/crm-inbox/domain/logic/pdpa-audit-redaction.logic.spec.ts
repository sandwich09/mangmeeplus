import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PDPA_REDACTED_VALUE,
  PDPA_REDACTION_MARKER_KEY,
  isPersonalDataKey,
  redactPersonalData,
} from './pdpa-audit-redaction.logic';

const at = new Date('2026-07-28T04:00:00.000Z');

describe('isPersonalDataKey (L-11)', () => {
  it('matches every listed personal-data key', () => {
    for (const key of [
      'name', 'fullName', 'firstName', 'lastName', 'displayName', 'nickname',
      'phone', 'phoneNumber', 'mobile', 'email', 'lineUserId', 'lineDisplayName',
      'nationalId', 'taxId', 'idCardNumber', 'address', 'addressLine', 'postalCode',
      'birthDate', 'dob',
      'note', 'notes', 'remark', 'message', 'messageText', 'text', 'content', 'body',
    ]) {
      assert.equal(isPersonalDataKey(key), true, `${key} must be treated as personal data`);
    }
  });

  it('matches qualified and serialized variants of the same fields', () => {
    for (const key of [
      'customerName', 'contactName', 'primaryPhone', 'primaryPhoneNormalized',
      'rawEmail', 'rawEmailNormalized', 'taxIdNormalized', 'billingAddressLine1',
      'contentJson', 'internal_note',
    ]) {
      assert.equal(isPersonalDataKey(key), true, `${key} must be treated as personal data`);
    }
  });

  it('does not match non-personal forensic keys', () => {
    for (const key of [
      'amount', 'grandTotalAmount', 'netPaidAmount', 'messagesRedacted', 'conversations',
      'checksumSha256', 'sourceChecksum', 'id', 'targetId', 'auditLogId', 'aggregateId',
      'reason', 'reasonCode', 'reasonProvided', 'cancelReason', 'result', 'riskLevel',
      'status', 'entryNumber', 'documentNumber', 'periodKey', 'occurredAt', 'eventType',
      'companyId', 'taxContext', 'metadataJson', 'rawPayloadJson', 'tagsJson',
    ]) {
      assert.equal(isPersonalDataKey(key), false, `${key} must survive erasure`);
    }
  });
});

describe('redactPersonalData (L-11)', () => {
  it('removes personal data while preserving every non-personal key', () => {
    const metadata = {
      customerName: 'สมชาย ใจดี',
      primaryPhone: '0812345678',
      note: 'call back at 0898887777',
      grandTotalAmount: '1250.00',
      messagesRedacted: 5,
      checksumSha256: 'abc123',
      reason: 'customer request',
      reasonCode: 'PDPA_ERASURE',
      result: 'SUCCESS',
      reasonProvided: true,
      documentNumber: 'INV-2026-0001',
      nested: { lineUserId: 'U123', vatAmount: '87.50', deeper: { email: 'a@b.co', count: 2 } },
      lines: [{ description: 'service', amount: '10.00', remark: 'personal remark' }],
    };
    const before = structuredClone(metadata);

    const { value, redactedKeys } = redactPersonalData(metadata, at);
    const out = value as Record<string, any>;

    // Personal data is gone.
    assert.equal(out['customerName'], PDPA_REDACTED_VALUE);
    assert.equal(out['primaryPhone'], PDPA_REDACTED_VALUE);
    assert.equal(out['note'], PDPA_REDACTED_VALUE);
    assert.equal(out['nested'].lineUserId, PDPA_REDACTED_VALUE);
    assert.equal(out['nested'].deeper.email, PDPA_REDACTED_VALUE);
    assert.equal(out['lines'][0].remark, PDPA_REDACTED_VALUE);

    // Non-personal forensic content survives byte-for-byte. This is the finding.
    assert.equal(out['grandTotalAmount'], '1250.00');
    assert.equal(out['messagesRedacted'], 5);
    assert.equal(out['checksumSha256'], 'abc123');
    assert.equal(out['reason'], 'customer request');
    assert.equal(out['reasonCode'], 'PDPA_ERASURE');
    assert.equal(out['result'], 'SUCCESS');
    assert.equal(out['reasonProvided'], true);
    assert.equal(out['documentNumber'], 'INV-2026-0001');
    assert.equal(out['nested'].vatAmount, '87.50');
    assert.equal(out['nested'].deeper.count, 2);
    assert.deepEqual(out['lines'][0].description, 'service');
    assert.equal(out['lines'][0].amount, '10.00');

    assert.deepEqual(redactedKeys, ['customerName', 'email', 'lineUserId', 'note', 'primaryPhone', 'remark']);
    // Input untouched.
    assert.deepEqual(metadata, before);
  });

  it('records an in-row marker with the redaction time', () => {
    const { value } = redactPersonalData({ email: 'a@b.co', amount: '1.00' }, at);
    const marker = (value as Record<string, any>)[PDPA_REDACTION_MARKER_KEY];
    assert.deepEqual(marker, { redacted: true, at: '2026-07-28T04:00:00.000Z', keys: ['email'] });
  });

  it('is a no-op on already-redacted metadata (idempotent, timestamp is not moved)', () => {
    const first = redactPersonalData({ email: 'a@b.co', amount: '1.00' }, at).value;
    const second = redactPersonalData(first, new Date('2027-01-01T00:00:00.000Z'));

    assert.equal(second.value, first);
    assert.deepEqual(second.redactedKeys, []);
  });

  it('ignores a marker that does not have the shape this module writes', () => {
    // A bare `key in value` check let any top-level key of that name — whatever its value —
    // skip erasure for that row forever. Nothing can inject one today; validating closes it.
    for (const forged of [
      true,
      'redacted',
      null,
      {},
      { redacted: false, at: '2026-01-01T00:00:00.000Z', keys: [] },
      { redacted: true, keys: [] },
      { redacted: true, at: 1234567890, keys: [] },
      { redacted: true, at: '2026-01-01T00:00:00.000Z', keys: 'email' },
      { redacted: true, at: '2026-01-01T00:00:00.000Z', keys: [42] },
    ]) {
      const { value, redactedKeys } = redactPersonalData(
        { [PDPA_REDACTION_MARKER_KEY]: forged, email: 'a@b.co', amount: '1.00' },
        at,
      );
      const out = value as Record<string, any>;
      assert.equal(out['email'], PDPA_REDACTED_VALUE, `forged marker ${JSON.stringify(forged)} must not block erasure`);
      assert.equal(out['amount'], '1.00');
      assert.deepEqual(redactedKeys, ['email']);
      // The forged value is replaced by a real marker, so the next run is a no-op.
      assert.deepEqual(out[PDPA_REDACTION_MARKER_KEY], { redacted: true, at: at.toISOString(), keys: ['email'] });
      assert.deepEqual(redactPersonalData(value, new Date('2027-01-01T00:00:00.000Z')).redactedKeys, []);
    }
  });

  it('reports nothing to do when a row holds no personal data', () => {
    const metadata = { grandTotalAmount: '10.00', result: 'SUCCESS' };
    const { value, redactedKeys } = redactPersonalData(metadata, at);

    assert.equal(value, metadata);
    assert.deepEqual(redactedKeys, []);
  });

  it('handles non-object metadata without throwing', () => {
    assert.deepEqual(redactPersonalData(null, at), { value: null, redactedKeys: [] });
    assert.deepEqual(redactPersonalData('text', at), { value: 'text', redactedKeys: [] });
    assert.deepEqual(redactPersonalData([1, 2], at), { value: [1, 2], redactedKeys: [] });
  });

  it('fails closed past the depth cap and survives a cycle', () => {
    let deep: Record<string, unknown> = { email: 'deep@b.co' };
    for (let i = 0; i < 12; i += 1) deep = { level: deep };
    const cyclic: Record<string, unknown> = { email: 'a@b.co' };
    cyclic['self'] = cyclic;

    const deepResult = redactPersonalData({ ...deep, email: 'top@b.co' }, at);
    assert.equal(JSON.stringify(deepResult.value).includes('deep@b.co'), false);

    const cyclicResult = redactPersonalData(cyclic, at);
    assert.equal((cyclicResult.value as Record<string, any>)['email'], PDPA_REDACTED_VALUE);
    assert.equal((cyclicResult.value as Record<string, any>)['self'], '[PDPA_CYCLE]');
  });
});
