import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AiUsageEntry } from '@watchdog-bms/contracts';
import {
  appendUsage, claimBudgetCallOrdinal, currentBudgetEnvelope, currentBudgetState, currentUsageCompanyId,
  drainUsage, runWithUsageContext, tagUsageInvocation, usageEntryCount,
} from './usage-context';

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

/** ADR 0013 §6: the request's money state rides in the same store, for the same reason. */
describe('usage context budget state (E1c)', () => {
  const envelope = {
    attemptKey: 'line-image:abc',
    stepKind: 'receipt-ocr' as const,
    invocationKey: 'co-1#line-image:abc#receipt-ocr#0',
    bucket: 'OCR' as const,
    monthKey: '2026-09',
    modelId: 'test-model',
    bounds: { maxInputTokens: 30_000, maxOutputTokens: 8_192, maxCalls: 4 },
    maxCalls: 4,
  };
  const active = { status: 'active' as const, envelope, sourceRoute: 'receipt-ocr', calls: 0 };

  it('reports nothing for a request that carried no envelope — every company today', () => {
    runWithUsageContext({ companyId: 'co-1' }, () => {
      assert.equal(currentBudgetState(), undefined);
      assert.equal(currentBudgetEnvelope(), undefined);
      // Nothing to claim, so the ordinal helper is inert rather than a hidden counter.
      assert.equal(claimBudgetCallOrdinal(), 0);
      assert.equal(claimBudgetCallOrdinal(), 0);
    });
    assert.equal(currentBudgetState(), undefined);
  });

  it('keeps an invalid envelope distinguishable from an absent one', () => {
    runWithUsageContext({ companyId: 'co-1', budget: { status: 'invalid' } }, () => {
      assert.deepEqual(currentBudgetState(), { status: 'invalid' });
      // No bounds to read: a reader that only wants the envelope must NOT see one here.
      assert.equal(currentBudgetEnvelope(), undefined);
    });
  });

  it('hands out one ordinal sequence per request, across the providers a chain builds', async () => {
    // A receipt chain builds three separate providers; they must share one call index, and two
    // concurrent requests must never share theirs.
    const [first, second] = await Promise.all([
      runWithUsageContext({ companyId: 'co-1', budget: { ...active } }, async () => {
        const claims = [claimBudgetCallOrdinal()];
        await tick(4);
        claims.push(claimBudgetCallOrdinal(), claimBudgetCallOrdinal());
        return claims;
      }),
      runWithUsageContext({ companyId: 'co-2', budget: { ...active, calls: 0 } }, async () => {
        await tick(2);
        return [claimBudgetCallOrdinal()];
      }),
    ]);

    assert.deepEqual(first, [0, 1, 2]);
    assert.deepEqual(second, [0]);
  });

  it('stamps the invocation key on the rows the response will carry, and only those', () => {
    runWithUsageContext({ companyId: 'co-1', budget: { ...active } }, () => {
      appendUsage(entry('ocr.receipt.image-read'));
      const fromIndex = usageEntryCount();
      appendUsage(entry('ocr.receipt.extract'));
      const tagged = tagUsageInvocation(fromIndex, 'co-1#line-image:abc#receipt-ocr#1');

      assert.deepEqual(tagged.map((e) => e.tag), ['ocr.receipt.extract']);
      // The drained rows are the SAME objects, so the response carries the key the API settles by.
      assert.deepEqual(
        drainUsage().map((e) => [e.tag, e.invocationKey]),
        [['ocr.receipt.image-read', undefined], ['ocr.receipt.extract', 'co-1#line-image:abc#receipt-ocr#1']],
      );
    });
  });

  it('tags nothing outside a context and never throws', () => {
    assert.doesNotThrow(() => { assert.deepEqual(tagUsageInvocation(0, 'k'), []); });
    assert.equal(usageEntryCount(), 0);
  });
});
