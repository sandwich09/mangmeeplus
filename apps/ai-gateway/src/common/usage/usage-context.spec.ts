import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AiUsageEntry } from '@watchdog-bms/contracts';
import { appendUsage, currentUsageCompanyId, drainUsage, runWithUsageContext } from './usage-context';

function entry(tag: string): AiUsageEntry {
  return {
    tag,
    modelId: 'test-model',
    ok: true,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    durationMs: 1,
  };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('usage context', () => {
  it('keeps concurrent runs isolated across interleaved awaits', async () => {
    // Two gateway requests in flight at once is the normal case; a shared accumulator would bill
    // one company for the other's tokens.
    const [a, b] = await Promise.all([
      runWithUsageContext({ companyId: 'co-a' }, async () => {
        appendUsage(entry('a1'));
        await tick(5);
        appendUsage(entry('a2'));
        return { companyId: currentUsageCompanyId(), entries: drainUsage() };
      }),
      runWithUsageContext({ companyId: 'co-b' }, async () => {
        await tick(1);
        appendUsage(entry('b1'));
        await tick(8);
        return { companyId: currentUsageCompanyId(), entries: drainUsage() };
      }),
    ]);

    assert.deepEqual(a.entries.map((e) => e.tag), ['a1', 'a2']);
    assert.deepEqual(b.entries.map((e) => e.tag), ['b1']);
    assert.equal(a.companyId, 'co-a');
    assert.equal(b.companyId, 'co-b');
  });

  it('appends silently outside a context and never throws', () => {
    assert.doesNotThrow(() => appendUsage(entry('orphan')));
    assert.deepEqual(drainUsage(), []);
    assert.equal(currentUsageCompanyId(), undefined);
  });

  it('drains once: a second drain in the same context is empty', () => {
    runWithUsageContext({}, () => {
      appendUsage(entry('one'));
      assert.equal(drainUsage().length, 1);
      assert.deepEqual(drainUsage(), []);
    });
  });

  it('seeds without a companyId when the request carries none', () => {
    runWithUsageContext({}, () => {
      assert.equal(currentUsageCompanyId(), undefined);
    });
  });
});
