import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactOutboxPayload, validateOutboxPayload } from './outbox.logic';

describe('outbox.logic', () => {
  describe('redactOutboxPayload', () => {
    it('redacts token field', () => {
      const out = redactOutboxPayload({ token: 'abc123', name: 'test' });
      assert.equal(out['token'], '[REDACTED]');
      assert.equal(out['name'], 'test');
    });
    it('redacts nested secret', () => {
      const out = redactOutboxPayload({ meta: { secretKey: 'value', id: '1' } });
      assert.equal((out['meta'] as Record<string, unknown>)['secretKey'], '[REDACTED]');
      assert.equal((out['meta'] as Record<string, unknown>)['id'], '1');
    });
    it('passes through non-secret fields', () => {
      const out = redactOutboxPayload({ aggregateId: 'x', amount: 100 });
      assert.deepEqual(out, { aggregateId: 'x', amount: 100 });
    });
  });

  describe('validateOutboxPayload', () => {
    it('accepts small payload', () => {
      assert.equal(validateOutboxPayload({ id: '1' }), null);
    });
    it('rejects payload > 64KB', () => {
      const big: Record<string, unknown> = { data: 'x'.repeat(65_000) };
      assert.notEqual(validateOutboxPayload(big), null);
    });
  });
});
