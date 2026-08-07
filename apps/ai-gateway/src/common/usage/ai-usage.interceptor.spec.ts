import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom } from 'rxjs';
import type { AiUsageEntry } from '@watchdog-bms/contracts';
import { AiUsageInterceptor } from './ai-usage.interceptor';
import { appendUsage, currentUsageCompanyId } from './usage-context';

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

function context(body: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ body }) }) } as unknown as ExecutionContext;
}

/** Nest's real CallHandler is lazy — the route handler runs on subscribe, not on handle(). `defer`
 *  reproduces that, which is what makes this a genuine test of the ALS wiring. */
function handler(run: () => Promise<unknown>): CallHandler {
  return { handle: () => defer(run) } as CallHandler;
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function intercept(body: unknown, run: () => Promise<unknown>): Promise<unknown> {
  return firstValueFrom(new AiUsageInterceptor().intercept(context(body), handler(run)));
}

describe('AiUsageInterceptor', () => {
  it('attaches what the providers appended, seeded with the body companyId', async () => {
    let seen: string | undefined;
    const result = await intercept({ requestId: 'r-1', companyId: 'co-1' }, async () => {
      seen = currentUsageCompanyId();
      appendUsage(entry('crm.reply-draft'));
      return { requestId: 'r-1', status: 'ok' };
    });

    assert.equal(seen, 'co-1', 'the handler runs inside the collector, not beside it');
    const usage = (result as { usage?: AiUsageEntry[] }).usage;
    assert.deepEqual(usage?.map((e) => e.tag), ['crm.reply-draft']);
    assert.equal((result as { status: string }).status, 'ok');
  });

  it('falls back to userContext.companyId (the LINE turn shape)', async () => {
    let seen: string | undefined;
    await intercept({ requestId: 'r-2', userContext: { companyId: 'co-2' } }, async () => {
      seen = currentUsageCompanyId();
      return {};
    });
    assert.equal(seen, 'co-2');
  });

  it('leaves a response with no model call exactly as the handler returned it', async () => {
    const result = await intercept({ companyId: 'co-1' }, async () => ({ status: 'not_configured', errorCode: 'PROVIDER_CONFIG_MISSING' }));
    assert.deepEqual(result, { status: 'not_configured', errorCode: 'PROVIDER_CONFIG_MISSING' });
    assert.ok(!('usage' in (result as object)), 'no entries means no field, so old responses stay byte-identical');
  });

  it('does not mix entries between two concurrent invocations', async () => {
    const [first, second] = await Promise.all([
      intercept({ companyId: 'co-a' }, async () => {
        appendUsage(entry('a1'));
        await tick(5);
        appendUsage(entry('a2'));
        return { who: 'a' };
      }),
      intercept({ companyId: 'co-b' }, async () => {
        await tick(1);
        appendUsage(entry('b1'));
        await tick(8);
        return { who: 'b' };
      }),
    ]);

    assert.deepEqual((first as { usage: AiUsageEntry[] }).usage.map((e) => e.tag), ['a1', 'a2']);
    assert.deepEqual((second as { usage: AiUsageEntry[] }).usage.map((e) => e.tag), ['b1']);
  });

  it('keeps usage the handler already reported (AgentCore passthrough) instead of erasing it', async () => {
    const remote = entry('agentcore.remote');
    const result = await intercept({ userContext: { companyId: 'co-1' } }, async () => ({ replyText: 'ok', usage: [remote] }));
    assert.deepEqual((result as { usage: AiUsageEntry[] }).usage, [remote]);
  });

  it('lets a failing handler fail unchanged', async () => {
    await assert.rejects(
      () => intercept({ companyId: 'co-1' }, async () => { throw new Error('handler exploded'); }),
      (err: Error) => err.message === 'handler exploded',
    );
  });
});
