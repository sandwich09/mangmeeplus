import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DisabledProvider } from './disabled.provider';

describe('DisabledProvider', () => {
  it('returns ok=false with PROVIDER_DISABLED', async () => {
    const provider = new DisabledProvider();
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'hello' }] });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'PROVIDER_DISABLED');
      assert.equal(result.error.retryable, false);
    }
  });

  it('is not retryable', async () => {
    const provider = new DisabledProvider();
    const result = await provider.generateText({ messages: [] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.retryable, false);
  });
});

describe('DisabledProvider.generateWithTools (item 10F)', () => {
  it('fails typed with PROVIDER_DISABLED so the orchestrator falls back', async () => {
    const provider = new DisabledProvider();
    const result = await provider.generateWithTools!({ messages: [{ role: 'user', text: 'q' }], tools: [] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PROVIDER_DISABLED');
  });
});

it('B1 refuses outputSchema with the contract error while disabled', async () => {
  const result = await new DisabledProvider().generateText({ messages: [], outputSchema: { name: 'classifier', schema: { type: 'object' } } } as any);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'PROVIDER_CONTRACT_UNSUPPORTED');
});
