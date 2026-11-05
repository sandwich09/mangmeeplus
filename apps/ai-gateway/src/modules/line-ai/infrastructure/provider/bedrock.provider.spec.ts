import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { conservativeTimeoutUsage } from './provider-usage-estimate';
import { BedrockProvider, CACHE_MIN_CHARS } from './bedrock.provider';
import { drainUsage, runWithUsageContext } from '../../../../common/usage/usage-context';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { createProvider } from './provider.factory';
import { AnthropicApiProvider, anthropicModelId } from './anthropic-api.provider';
import { providerInputTokenUpperBound, v2RenderedInput } from '../../../../common/usage/ai-budget-provider';
import {
  AI_BUDGET_IMAGE_TOKEN_CEILING, AI_BUDGET_STEP_ATTEMPTS, AI_BUDGET_STEP_BOUNDS, aiBudgetInvocationKey, parseAiBudgetEnvelope,
} from '@watchdog-bms/contracts';

function makeProvider(timeoutMs = 10000) {
  // item 5: a no-op sleep so every existing test that happens to throttle still runs instantly —
  // dedicated retry/backoff specs below pass their own `sleep` to observe the real behavior.
  return new BedrockProvider({ region: 'ap-southeast-1', modelId: 'test-model', timeoutMs, sleep: async () => {} });
}

/** Collects the provider's `ai.usage` lines without letting them reach the test output. */
function captureUsageLines() {
  const original = console.log;
  const lines: Array<Record<string, unknown>> = [];
  console.log = (...args: unknown[]) => {
    try {
      const parsed = JSON.parse(String(args[0])) as Record<string, unknown>;
      if (parsed['msg'] === 'ai.usage') lines.push(parsed);
    } catch {
      // not a usage line
    }
  };
  return { lines, restore: () => { console.log = original; } };
}

const CACHE_POINT = { cachePoint: { type: 'default' } };
// Derived from the real threshold so the boundary can't drift out of sync with the provider.
const LONG_PROMPT = 'p'.repeat(CACHE_MIN_CHARS);
const SHORT_PROMPT = 'p'.repeat(CACHE_MIN_CHARS - 1);
const LONG_CONTEXT = 'c'.repeat(CACHE_MIN_CHARS);
const SHORT_CONTEXT = 'c'.repeat(CACHE_MIN_CHARS - 1);

describe('LINE loop cache prefixes', () => {
  for (const transport of ['bedrock', 'anthropic'] as const) {
    it(`${transport}: separates the shared catalogue and per-turn prefix, preserving text and budget bounds`, async () => {
      const originalFetch = globalThis.fetch;
      const requests: any[] = [];
      const provider = transport === 'bedrock' ? makeProvider() : new AnthropicApiProvider({ apiKey: 'test', modelId: 'test', timeoutMs: 10000 });
      if (transport === 'bedrock') (provider as any).client = { send: async (cmd: any) => { requests.push(cmd.input); return { stopReason: 'end_turn', output: { message: { content: [{ text: 'ok' }] } } }; } };
      else globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }); };
      const catalogue = '{"tools":["' + LONG_CONTEXT + '"]';
      const input: import('./provider.port').ProviderInput = { systemPrompt: LONG_PROMPT, cacheableContext: catalogue + ',"evidence":"company-a"}',
        cacheableContextPrefixLength: catalogue.length, messages: [{ role: 'user', text: '{"previousToolResults":[]}' }], maxTokens: 2048 };
      const contents = (req: any) => req.messages[0].content.filter((b: any) => !b.cachePoint);
      const cached = (req: any, index: number) => transport === 'bedrock' ? !!req.messages[0].content[index * 2 + 1]?.cachePoint : !!contents(req)[index]?.cache_control;
      try {
        await provider.generateText(input);
        await provider.generateText({ ...input, messages: [{ role: 'user', text: '{"previousToolResults":["result"]}' }] });
        await provider.generateText({ ...input, cacheableContext: catalogue + ',"evidence":"company-b"}' });
        for (const req of requests) {
          assert.equal(cached(req, 0), true, 'catalogue is independently reusable next turn');
          assert.equal(cached(req, 1), true, 'the full per-turn prefix is cached');
        }
        assert.equal(JSON.stringify(contents(requests[0]).slice(0, 2)), JSON.stringify(contents(requests[1]).slice(0, 2)), 'follow-up prefix bytes match');
        assert.deepEqual(contents(requests[0])[0], contents(requests[2])[0], 'different company/turn retains only the shared catalogue prefix');
        assert.notDeepEqual(contents(requests[0])[1], contents(requests[2])[1]);
        assert.equal(contents(requests[0]).map((b: any) => b.text).join(''), input.cacheableContext! + input.messages[0]!.text, 'split does not rewrite any text');
        const unsplit = { ...input, cacheableContextPrefixLength: undefined };
        assert.deepEqual(v2RenderedInput(input), v2RenderedInput(unsplit), 'checkpoints never discount the reservation or alter content identity');
        assert.equal(providerInputTokenUpperBound(input), Buffer.byteLength(input.systemPrompt! + input.cacheableContext! + input.messages[0]!.text), 'all cached text remains fully bounded');
        await provider.generateWithTools({ ...input, tools: [{ name: 'read', description: LONG_CONTEXT, inputSchema: {} }], messages: [{ role: 'user', text: 'q' },
          { role: 'assistant', toolCalls: [{ toolUseId: 't1', name: 'read', input: {} }] }, { role: 'tool_results', results: [{ toolUseId: 't1', content: 'result' }] }] });
        const wire = JSON.stringify(requests[3]);
        assert.equal((wire.match(transport === 'bedrock' ? /"cachePoint":/g : /"cache_control":/g) ?? []).length, 4, 'split context leaves only one tool-loop message slot');
        await provider.generateText({ cacheableContext: 'short context', cacheableContextPrefixLength: 5, messages: [{ role: 'user', text: 'q' }] });
        assert.doesNotMatch(JSON.stringify(requests[4]), /cachePoint|cache_control/, 'a short split prefix is not checkpointed');
      } finally { globalThis.fetch = originalFetch; }
    });
    it(`${transport}: caches tools and the first/follow-up input prefixes without changing payload bytes`, async () => {
      const originalFetch = globalThis.fetch;
      const requests: any[] = [];
      const response = { stopReason: 'end_turn', output: { message: { content: [{ text: 'ok' }] } } };
      const provider = transport === 'bedrock' ? makeProvider() : new AnthropicApiProvider({ apiKey: 'test', modelId: 'test', timeoutMs: 10000 });
      if (transport === 'bedrock') (provider as any).client = { send: async (cmd: any) => { requests.push(cmd.input); return response; } };
      else globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }); };
      const tools = [{ name: 'read', description: LONG_CONTEXT, inputSchema: { type: 'object', properties: {} } }];
      const messages: import('./provider.port').ProviderToolMessage[] = [{ role: 'user', text: 'question' }];
      const pointCount = (value: any): number => Array.isArray(value) ? value.reduce((n, v) => n + pointCount(v), 0)
        : value && typeof value === 'object' ? Number('cachePoint' in value || 'cache_control' in value) + Object.values(value).reduce<number>((n, v) => n + pointCount(v), 0) : 0;
      const strip = (value: any): any => Array.isArray(value) ? value.filter(v => !v?.cachePoint).map(strip)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'cache_control').map(([key, v]) => [key, strip(v)])) : value;
      const cached = (message: any) => transport === 'bedrock' ? !!message.content.at(-1)?.cachePoint : !!message.content.at(-1)?.cache_control;
      try {
        await provider.generateWithTools({ tools, messages });
        messages.push({ role: 'assistant', toolCalls: [{ toolUseId: 't1', name: 'read', input: {} }] }, { role: 'tool_results', results: [{ toolUseId: 't1', content: 'result' }] });
        await provider.generateWithTools({ tools, messages });
        assert.equal(pointCount(transport === 'bedrock' ? requests[0].toolConfig : requests[0].tools), 1, 'standalone tool prefix');
        assert.equal(cached(requests[0].messages[0]), true, 'first loop input is written');
        assert.equal(cached(requests[1].messages[0]), true, 'follow-up retains the exact earlier breakpoint');
        assert.equal(cached(requests[1].messages[2]), true, 'tool result prefix is written for the next call');
        assert.equal(JSON.stringify(requests[1].messages[0]), JSON.stringify(requests[0].messages[0]));
        assert.deepEqual(strip(requests[1]).messages.slice(0, 1), strip(requests[0]).messages);
        assert.deepEqual(strip(transport === 'bedrock' ? requests[1].toolConfig : requests[1].tools), strip(transport === 'bedrock' ? requests[0].toolConfig : requests[0].tools));
        await provider.generateWithTools({ tools, messages, systemPrompt: LONG_PROMPT, cacheableContext: LONG_CONTEXT });
        assert.equal(pointCount(requests[2]), 4, 'system, context and two message points; system already covers tools');
        await provider.generateWithTools({ tools: [{ ...tools[0]!, description: 'short' }], messages: [{ role: 'user', text: 'short' }] });
        assert.equal(pointCount(requests[3]), 0, 'short prefixes are never checkpointed');
      } finally { globalThis.fetch = originalFetch; }
    });
  }
});

describe('BedrockProvider error mapping', () => {
  it('exposes max_tokens on text generation', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => ({ stopReason: 'max_tokens', output: { message: { content: [{ text: 'partial' }] } } }),
    };
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'hello' }] });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.stopReason, 'max_tokens');
  });

  it('maps ThrottlingException to PROVIDER_THROTTLED', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => {
        const e: any = new Error('Rate limit exceeded');
        e.name = 'ThrottlingException';
        throw e;
      },
    };
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'hello' }] });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'PROVIDER_THROTTLED');
      assert.equal(result.error.retryable, true);
    }
  });

  it('maps ValidationException with use case text to PROVIDER_ACCESS_NOT_READY', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => {
        const e: any = new Error('This model requires a use case approval');
        e.name = 'ValidationException';
        throw e;
      },
    };
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'hello' }] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PROVIDER_ACCESS_NOT_READY');
  });

  it('maps ValidationException with on-demand throughput to PROVIDER_ACCESS_NOT_READY', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => {
        const e: any = new Error('Unsupported on-demand throughput');
        e.name = 'ValidationException';
        throw e;
      },
    };
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'hello' }] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PROVIDER_ACCESS_NOT_READY');
  });

  it('maps timeout to PROVIDER_TIMEOUT (retryable)', async () => {
    const provider = makeProvider(1); // 1ms timeout
    let aborted = false;
    (provider as any).client = {
      send: (_command: unknown, options: { abortSignal: AbortSignal }) => new Promise((_resolve, reject) => {
        options.abortSignal.addEventListener('abort', () => {
          aborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    };
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'hello' }] });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'PROVIDER_TIMEOUT');
      assert.equal(result.error.retryable, true);
    }
    assert.equal(aborted, true, 'the timeout must cancel the underlying Bedrock SDK request');
  });

  it('maps AccessDeniedException to PROVIDER_ACCESS_NOT_READY', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => {
        const e: any = new Error('User is not authorized to perform bedrock:InvokeModel');
        e.name = 'AccessDeniedException';
        throw e;
      },
    };
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'hello' }] });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'PROVIDER_ACCESS_NOT_READY');
      assert.equal(result.error.retryable, false);
    }
  });

  it('maps unknown error to PROVIDER_UNKNOWN', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => { throw new Error('Unexpected Bedrock error'); },
    };
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'hello' }] });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'PROVIDER_UNKNOWN');
      assert.equal(result.error.retryable, false);
    }
  });

  it('maps PDF documents onto Converse document blocks on the last user turn', async () => {
    const provider = makeProvider();
    let captured: any;
    (provider as any).client = {
      send: async (cmd: any) => {
        captured = cmd.input;
        return { stopReason: 'end_turn', output: { message: { content: [{ text: '{"natural_text":"# ใบเสร็จ"}' }] } } };
      },
    };
    const result = await provider.generateText({
      systemPrompt: 'transcribe',
      messages: [{ role: 'user', text: 'Transcribe the attached document.' }],
      documents: [{ mimeType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.7').toString('base64') }],
    });

    const content = captured.messages[0].content;
    assert.equal(content[0].text, 'Transcribe the attached document.');
    assert.equal(content[1].document.format, 'pdf');
    // Converse rejects names outside this set, which surfaces as an opaque ValidationException.
    assert.match(content[1].document.name, /^[a-zA-Z0-9()[\]\s-]+$/);
    assert.equal(content[1].document.source.bytes.toString(), '%PDF-1.7');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, '{"natural_text":"# ใบเสร็จ"}');
  });

  it('returns ok=true with text on success', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => ({
        stopReason: 'end_turn',
        output: { message: { content: [{ text: 'ข้อมูลสต็อก: 5 รายการ' }] } },
      }),
    };
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'ดูสต็อก' }] });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, 'ข้อมูลสต็อก: 5 รายการ');
  });
});

// ── Item 5: bounded, jittered throttle retry (223-turn eval, 14 PROVIDER_THROTTLED turns) ────

/** A fake `client.send` that throttles the first `throttleCount` calls, then succeeds. */
function throttleThenSucceed(throttleCount: number) {
  let calls = 0;
  return {
    send: async () => {
      calls += 1;
      if (calls <= throttleCount) {
        const e: any = new Error('Rate limit exceeded');
        e.name = 'ThrottlingException';
        throw e;
      }
      return { stopReason: 'end_turn', output: { message: { content: [{ text: 'ok' }] } } };
    },
    get calls() { return calls; },
  };
}

/** A fake `client.send` that always throttles. */
function alwaysThrottle() {
  let calls = 0;
  return {
    send: async () => {
      calls += 1;
      const e: any = new Error('Rate limit exceeded');
      e.name = 'ThrottlingException';
      throw e;
    },
    get calls() { return calls; },
  };
}

/** Records every delay the provider asked to sleep, resolving instantly so specs never wait. */
function recordingSleep() {
  const delaysMs: number[] = [];
  return { delaysMs, sleep: async (ms: number) => { delaysMs.push(ms); } };
}

describe('BedrockProvider throttle retry (item 5)', () => {
  it('retries a throttled call up to 2 times with jittered 400-1200ms backoff, then succeeds', async () => {
    const { delaysMs, sleep } = recordingSleep();
    const provider = new BedrockProvider({ region: 'ap-southeast-1', modelId: 'test-model', timeoutMs: 10000, sleep });
    const fake = throttleThenSucceed(2);
    (provider as any).client = fake;
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'q' }] });
    assert.equal(result.ok, true);
    assert.equal(fake.calls, 3, 'the original attempt plus exactly 2 retries');
    assert.equal(delaysMs.length, 2);
    for (const ms of delaysMs) assert.ok(ms >= 400 && ms < 1200, `backoff ${ms}ms out of the 400-1200ms band`);
  });

  it('gives up after 2 retries and reports PROVIDER_THROTTLED, never an unbounded loop', async () => {
    const { sleep } = recordingSleep();
    const provider = new BedrockProvider({ region: 'ap-southeast-1', modelId: 'test-model', timeoutMs: 10000, sleep });
    const fake = alwaysThrottle();
    (provider as any).client = fake;
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'q' }] });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'PROVIDER_THROTTLED');
      assert.equal(result.error.retryable, true);
    }
    assert.equal(fake.calls, 3, 'the original attempt plus exactly 2 retries, never more');
  });

  it('never retries past this call\'s own deadline', async () => {
    const { delaysMs, sleep } = recordingSleep();
    const provider = new BedrockProvider({ region: 'ap-southeast-1', modelId: 'test-model', timeoutMs: 10000, sleep });
    const fake = alwaysThrottle();
    (provider as any).client = fake;
    // The shortest possible backoff (400ms) already cannot finish before this deadline, so the
    // very first throttle must fail closed instead of spending a retry it cannot use.
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'q' }], deadlineAt: Date.now() + 100 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PROVIDER_THROTTLED');
    assert.equal(fake.calls, 1, 'no time left for even one retry');
    assert.equal(delaysMs.length, 0);
  });

  it('only retries a genuine ThrottlingException, not another provider error', async () => {
    const { delaysMs, sleep } = recordingSleep();
    const provider = new BedrockProvider({ region: 'ap-southeast-1', modelId: 'test-model', timeoutMs: 10000, sleep });
    let calls = 0;
    (provider as any).client = { send: async () => {
      calls += 1;
      const e: any = new Error('denied');
      e.name = 'AccessDeniedException';
      throw e;
    } };
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'q' }] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PROVIDER_ACCESS_NOT_READY');
    assert.equal(calls, 1, 'a non-throttling error never retries');
    assert.equal(delaysMs.length, 0);
  });

  it('logs exactly one ai.usage line for the whole invocation, whatever the retry count', async () => {
    const { sleep } = recordingSleep();
    const provider = new BedrockProvider({ region: 'ap-southeast-1', modelId: 'test-model', timeoutMs: 10000, sleep });
    (provider as any).client = throttleThenSucceed(1);
    const capture = captureUsageLines();
    try {
      await provider.generateText({ messages: [{ role: 'user', text: 'q' }] });
    } finally {
      capture.restore();
    }
    // Item 5 root-cause note: the budget decorator settles `tagged[0]` of the usage rows this call
    // appends — a SECOND row per retry would make it settle the wrong (zero-usage, throttled)
    // attempt instead of the eventual success. Exactly one line keeps that positional attribution
    // sound, and still names the retry count for CloudWatch/ops visibility.
    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0]!['ok'], true);
    assert.equal(capture.lines[0]!['throttleRetryCount'], 1);
  });
});

// ── Item 10F: Converse toolConfig adapter ────────────────────────────────────

describe('BedrockProvider.generateWithTools', () => {
  it('maps tools/messages onto the Converse wire and parses parallel toolUse blocks', async () => {
    const provider = makeProvider();
    let captured: any;
    (provider as any).client = {
      send: async (cmd: any) => {
        captured = cmd.input;
        return {
          stopReason: 'tool_use',
          output: { message: { content: [
            { type: 'reasoningContent', reasoningContent: { text: 'hidden' } },
            { text: 'กำลังดึงข้อมูล' },
            { text: 'พร้อมอีกหนึ่งข้อมูล' },
            { toolUse: { toolUseId: 't1', name: 'sales__get_summary', input: { fromDate: '2026-07-01' } } },
            { toolUse: { toolUseId: 't2', name: 'inventory__list_low_stock', input: {} } },
          ] } },
        };
      },
    };
    const result = await provider.generateWithTools!({
      messages: [
        { role: 'user', text: 'ยอดขายกับของใกล้หมด' },
        { role: 'assistant', text: 'เช็คให้ครับ', toolCalls: [{ toolUseId: 't0', name: 'sales__get_summary', input: { x: 1 } }] },
        { role: 'tool_results', results: [{ toolUseId: 't0', content: '{"total":100}', isError: true }] },
      ],
      tools: [
        { name: 'sales__get_summary', description: 'read sales', inputSchema: { type: 'object', properties: {} } },
        { name: 'inventory__list_low_stock', inputSchema: { type: 'object', properties: {} } },
      ],
      systemPrompt: 'sys',
      maxTokens: 99,
    });

    assert.equal(captured.toolConfig.tools[0].toolSpec.name, 'sales__get_summary');
    assert.deepEqual(captured.toolConfig.tools[0].toolSpec.inputSchema.json, { type: 'object', properties: {} });
    assert.equal(captured.system[0].text, 'sys');
    assert.equal(captured.inferenceConfig.maxTokens, 99);
    // assistant turn carries text + toolUse; tool results ride as a user turn with status
    assert.equal(captured.messages[1].role, 'assistant');
    assert.equal(captured.messages[1].content[0].text, 'เช็คให้ครับ');
    assert.equal(captured.messages[1].content[1].toolUse.toolUseId, 't0');
    assert.equal(captured.messages[2].role, 'user');
    assert.equal(captured.messages[2].content[0].toolResult.toolUseId, 't0');
    assert.equal(captured.messages[2].content[0].toolResult.status, 'error');

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.stopReason, 'tool_use');
      assert.equal(result.text, 'กำลังดึงข้อมูล\nพร้อมอีกหนึ่งข้อมูล');
      assert.equal(result.toolCalls.length, 2, 'parallel toolUse blocks are all surfaced');
      assert.deepEqual(result.toolCalls[1], { toolUseId: 't2', name: 'inventory__list_low_stock', input: {} });
    }
  });

  it('maps end_turn with no tool calls', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => ({ stopReason: 'end_turn', output: { message: { content: [{ text: 'เรียบร้อย' }] } } }),
    };
    const result = await provider.generateWithTools!({ messages: [{ role: 'user', text: 'q' }], tools: [] });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.stopReason, 'end_turn');
      assert.equal(result.toolCalls.length, 0);
    }
  });

  it('maps provider errors with the same error mapper as generateText', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => {
        const e: any = new Error('Rate limit exceeded');
        e.name = 'ThrottlingException';
        throw e;
      },
    };
    const result = await provider.generateWithTools!({ messages: [{ role: 'user', text: 'q' }], tools: [] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PROVIDER_THROTTLED');
  });
});

// ── Prompt caching (Converse cachePoint) + per-call usage logging ─────────────

describe('BedrockProvider prompt caching', () => {
  it('checkpoints the system prompt only at or above the char threshold, on both entry points', async () => {
    for (const [prompt, blocks] of [[LONG_PROMPT, 2], [SHORT_PROMPT, 1]] as const) {
      for (const withTools of [false, true]) {
        const provider = makeProvider();
        let captured: any;
        (provider as any).client = {
          send: async (cmd: any) => {
            captured = cmd.input;
            return { stopReason: 'end_turn', output: { message: { content: [{ text: 'ok' }] } } };
          },
        };
        const label = `${prompt.length} chars, tools=${withTools}`;
        if (withTools) await provider.generateWithTools!({ messages: [{ role: 'user', text: 'q' }], tools: [], systemPrompt: prompt });
        else await provider.generateText({ systemPrompt: prompt, messages: [{ role: 'user', text: 'q' }] });

        assert.equal(captured.system.length, blocks, label);
        assert.equal(captured.system[0].text, prompt, label);
        if (blocks === 2) assert.deepEqual(captured.system[1], CACHE_POINT, label);
      }
    }
  });

  it('renders cacheableContext as the leading first-user block, checkpointed, without moving attachments', async () => {
    const provider = makeProvider();
    let captured: any;
    (provider as any).client = {
      send: async (cmd: any) => {
        captured = cmd.input;
        return { output: { message: { content: [{ text: 'ok' }] } } };
      },
    };
    await provider.generateText({
      cacheableContext: LONG_CONTEXT,
      messages: [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'mid' }, { role: 'user', text: 'last' }],
      images: [{ mimeType: 'image/png', contentBase64: Buffer.from('png-bytes').toString('base64') }],
    });

    // Deterministic order: context, checkpoint, then this turn's own text.
    assert.equal(captured.messages[0].content.length, 3);
    assert.equal(captured.messages[0].content[0].text, LONG_CONTEXT);
    assert.deepEqual(captured.messages[0].content[1], CACHE_POINT);
    assert.equal(captured.messages[0].content[2].text, 'first');
    assert.equal(captured.messages[1].content.length, 1, 'assistant turn is untouched');
    // Attachments still ride the LAST user message, after its text.
    assert.equal(captured.messages[2].content[0].text, 'last');
    assert.equal(captured.messages[2].content[1].image.format, 'png');
  });

  it('renders a sub-threshold cacheableContext with no checkpoint (write would bill 1.25x for nothing)', async () => {
    const provider = makeProvider();
    let captured: any;
    (provider as any).client = {
      send: async (cmd: any) => {
        captured = cmd.input;
        return { output: { message: { content: [{ text: 'ok' }] } } };
      },
    };
    await provider.generateText({ cacheableContext: SHORT_CONTEXT, messages: [{ role: 'user', text: 'q' }] });

    assert.equal(captured.messages[0].content.length, 2);
    assert.equal(captured.messages[0].content[0].text, SHORT_CONTEXT);
    assert.equal(captured.messages[0].content[1].text, 'q');
  });

  it('emits exactly one tagged ai.usage line with token and cache counts', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => ({
        stopReason: 'end_turn', output: { message: { content: [{ text: 'ok' }] } },
        usage: { inputTokens: 2627, outputTokens: 374, cacheReadInputTokens: 2210, cacheWriteInputTokens: 0 },
      }),
    };
    const capture = captureUsageLines();
    try {
      await provider.generateText({ messages: [{ role: 'user', text: 'q' }], usageTag: 'ocr.receipt.extract' });
    } finally {
      capture.restore();
    }

    assert.equal(capture.lines.length, 1);
    const line = capture.lines[0]!;
    assert.equal(line['tag'], 'ocr.receipt.extract');
    assert.equal(line['modelId'], 'test-model');
    assert.equal(line['ok'], true);
    assert.equal(line['inputTokens'], 2627);
    assert.equal(line['outputTokens'], 374);
    assert.equal(line['cacheReadInputTokens'], 2210);
    assert.equal(line['cacheWriteInputTokens'], 0);
    assert.equal(typeof line['durationMs'], 'number');
  });

  it('logs ok=false with the mapped errorCode and no token counts when the call fails', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => {
        const e: any = new Error('Rate limit exceeded');
        e.name = 'ThrottlingException';
        throw e;
      },
    };
    const capture = captureUsageLines();
    try {
      await provider.generateText({ messages: [{ role: 'user', text: 'q' }] });
    } finally {
      capture.restore();
    }

    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0]!['tag'], 'untagged', 'untagged call sites stay identifiable');
    assert.equal(capture.lines[0]!['ok'], false);
    assert.equal(capture.lines[0]!['errorCode'], 'PROVIDER_THROTTLED');
    assert.equal(capture.lines[0]!['inputTokens'], undefined);
  });

  it('estimates an aborted timeout from the rendered request instead of the model context', async () => {
    const provider = makeProvider(1);
    (provider as any).client = {
      send: (_command: unknown, options: { abortSignal: AbortSignal }) => new Promise((_resolve, reject) => {
        options.abortSignal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    };
    const capture = captureUsageLines();
    const entries = await runWithUsageContext({ companyId: 'company-1' }, async () => {
      try {
        await provider.generateText({ messages: [{ role: 'user', text: 'q' }], maxTokens: 17 });
      } finally {
        capture.restore();
      }
      return drainUsage();
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.ok, false);
    assert.ok(entries[0]!.inputTokens > 0 && entries[0]!.inputTokens < 100, 'estimate follows the short rendered request');
    assert.equal(entries[0]!.outputTokens, 17);
    assert.equal(capture.lines[0]!['errorCode'], 'PROVIDER_TIMEOUT');
    assert.equal(capture.lines[0]!['usageEstimated'], true);
    // F-11: the ceiling estimate must reach the API labelled as an estimate, not as measured tokens.
    assert.equal(entries[0]!.usageBasis, 'CONSERVATIVE_ESTIMATE');
  });

  it('leaves the basis absent when a non-timeout error supplied no counters at all', async () => {
    const provider = makeProvider();
    (provider as any).client = { send: async () => { throw Object.assign(new Error('boom'), { name: 'ThrottlingException' }); } };
    const capture = captureUsageLines();
    const entries = await runWithUsageContext({ companyId: 'company-1' }, async () => {
      try {
        await provider.generateText({ messages: [{ role: 'user', text: 'q' }] });
      } finally {
        capture.restore();
      }
      return drainUsage();
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.ok, false);
    assert.equal(entries[0]!.usageBasis, undefined, 'never guess a basis the provider did not supply');
  });

  it('renders cacheableContext as the leading block in generateWithTools too', async () => {
    const provider = makeProvider();
    let captured: any;
    (provider as any).client = {
      send: async (cmd: any) => {
        captured = cmd.input;
        return { stopReason: 'end_turn', output: { message: { content: [{ text: 'ok' }] } } };
      },
    };
    await provider.generateWithTools!({
      messages: [
        { role: 'user', text: 'q' },
        { role: 'assistant', toolCalls: [{ toolUseId: 't1', name: 'x', input: {} }] },
        { role: 'tool_results', results: [{ toolUseId: 't1', content: '{}' }] },
      ],
      tools: [],
      cacheableContext: LONG_CONTEXT,
    });

    assert.equal(captured.messages[0].content[0].text, LONG_CONTEXT);
    assert.deepEqual(captured.messages[0].content[1], CACHE_POINT);
    assert.equal(captured.messages[0].content[2].text, 'q');
    // Later loop turns are untouched: one checkpoint, on the first user turn only.
    assert.equal(captured.messages[1].content[0].toolUse.toolUseId, 't1');
    assert.equal(captured.messages[2].content[0].toolResult.toolUseId, 't1');
  });

  it('renders cacheableContext on the first message when no turn has role user', async () => {
    const provider = makeProvider();
    let captured: any;
    (provider as any).client = {
      send: async (cmd: any) => {
        captured = cmd.input;
        return { output: { message: { content: [{ text: 'ok' }] } } };
      },
    };
    // Contract is "always rendered" — a message list with no user turn must not silently drop it.
    await provider.generateText({ cacheableContext: LONG_CONTEXT, messages: [{ role: 'assistant', text: 'a' }] });

    assert.equal(captured.messages[0].content[0].text, LONG_CONTEXT);
    assert.deepEqual(captured.messages[0].content[1], CACHE_POINT);
    assert.equal(captured.messages[0].content[2].text, 'a');
  });

  it('contains a malformed response as a mapped error with exactly one usage line', async () => {
    const provider = makeProvider();
    // `content` as a non-array breaks block parsing: that must map to a ProviderError (the
    // orchestrator's JSON-loop fallback signal), never escape as a throw.
    (provider as any).client = {
      send: async () => ({ stopReason: 'end_turn', output: { message: { content: 'not-an-array' } }, usage: { inputTokens: 9, outputTokens: 1 } }),
    };
    const capture = captureUsageLines();
    let result: Awaited<ReturnType<NonNullable<typeof provider.generateWithTools>>>;
    try {
      result = await provider.generateWithTools!({ messages: [{ role: 'user', text: 'q' }], tools: [], usageTag: 'line.loop' });
    } finally {
      capture.restore();
    }

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PROVIDER_OUTPUT_INCOMPLETE');
    assert.equal(capture.lines.length, 1, 'a parse failure must not double-log');
    assert.equal(capture.lines[0]!['ok'], false);
    assert.equal(capture.lines[0]!['errorCode'], 'PROVIDER_OUTPUT_INCOMPLETE');
    assert.equal(capture.lines[0]!['inputTokens'], 9, 'real provider usage survives a parse failure');
    assert.equal(capture.lines[0]!['outputTokens'], 1);
  });

  it('still returns the response when logging itself throws', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => ({ stopReason: 'end_turn', output: { message: { content: [{ text: 'ok' }] } }, usage: { inputTokens: 1, outputTokens: 1 } }),
    };
    const original = console.log;
    console.log = () => { throw new Error('stdout is gone'); };
    let result: Awaited<ReturnType<typeof provider.generateText>>;
    try {
      result = await provider.generateText({ messages: [{ role: 'user', text: 'q' }] });
    } finally {
      console.log = original;
    }

    // Logging is observability: it must never flip a real success into a provider error.
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, 'ok');
  });

  it('appends exactly one usage entry per call to the request collector', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => ({
        stopReason: 'end_turn', output: { message: { content: [{ text: 'ok' }] } },
        usage: { inputTokens: 2627, outputTokens: 374, cacheReadInputTokens: 2210, cacheWriteInputTokens: 12 },
      }),
    };
    const capture = captureUsageLines();
    const entries = await runWithUsageContext({ companyId: 'company-1' }, async () => {
      try {
        await provider.generateText({ messages: [{ role: 'user', text: 'q' }], usageTag: 'ocr.receipt.extract' });
      } finally {
        capture.restore();
      }
      return drainUsage();
    });

    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0], {
      tag: 'ocr.receipt.extract',
      modelId: 'test-model',
      ok: true,
      inputTokens: 2627,
      outputTokens: 374,
      cacheReadInputTokens: 2210,
      cacheWriteInputTokens: 12,
      durationMs: entries[0]!.durationMs,
      // Counters came out of the Converse response, so the console may show them as measured.
      usageBasis: 'PROVIDER_REPORTED',
    });
    assert.equal(typeof entries[0]!.durationMs, 'number');
    // The stdout line still fires exactly once, now carrying the tenant the collector knows.
    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0]!['companyId'], 'company-1');
  });

  it('appends an ok=false entry with zero counts for a mapped error', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => {
        const e: any = new Error('Rate limit exceeded');
        e.name = 'ThrottlingException';
        throw e;
      },
    };
    const capture = captureUsageLines();
    const entries = await runWithUsageContext({ companyId: 'company-1' }, async () => {
      try {
        await provider.generateWithTools!({ messages: [{ role: 'user', text: 'q' }], tools: [] });
      } finally {
        capture.restore();
      }
      return drainUsage();
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.ok, false);
    assert.equal(entries[0]!.tag, 'untagged');
    assert.equal(entries[0]!.inputTokens, 0);
    assert.equal(entries[0]!.outputTokens, 0);
    assert.equal(capture.lines.length, 1, 'the failed call still logs its one line');
    assert.equal(capture.lines[0]!['errorCode'], 'PROVIDER_THROTTLED');
  });

  it('omits companyId from the line when no collector context is open', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => ({ output: { message: { content: [{ text: 'ok' }] } }, usage: { inputTokens: 1, outputTokens: 1 } }),
    };
    const capture = captureUsageLines();
    try {
      await provider.generateText({ messages: [{ role: 'user', text: 'q' }] });
    } finally {
      capture.restore();
    }

    assert.equal(capture.lines.length, 1);
    assert.ok(!('companyId' in capture.lines[0]!), 'shape is otherwise unchanged for unattributed calls');
  });

  it('logs usage for generateWithTools too', async () => {
    const provider = makeProvider();
    (provider as any).client = {
      send: async () => ({
        stopReason: 'end_turn',
        output: { message: { content: [{ text: 'ok' }] } },
        usage: { inputTokens: 4100, outputTokens: 12, cacheWriteInputTokens: 4000 },
      }),
    };
    const capture = captureUsageLines();
    try {
      await provider.generateWithTools!({ messages: [{ role: 'user', text: 'q' }], tools: [], systemPrompt: LONG_PROMPT, usageTag: 'line.loop' });
    } finally {
      capture.restore();
    }

    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0]!['tag'], 'line.loop');
    assert.equal(capture.lines[0]!['cacheWriteInputTokens'], 4000);
    assert.equal(capture.lines[0]!['cacheReadInputTokens'], 0);
  });
});

/**
 * Phase E1c closes the E1b blocker recorded in ADR 0013 §12: the legacy 200,000-token timeout
 * ceiling is ABOVE every declared input bound, so a SPLIT timeout would settle above its hold and
 * trip the invariant-breach path — closing a company's admission over a call that never exceeded
 * anything. Under an envelope the estimate becomes the declared bound instead.
 */
describe('BedrockProvider conservative timeout under a budget envelope (E1c)', () => {
  const envelope = parseAiBudgetEnvelope({
    attemptKey: 'line-image:abc',
    stepKind: 'receipt-ocr',
    invocationKey: aiBudgetInvocationKey('co-1', 'line-image:abc', 'receipt-ocr', 0),
    bucket: 'OCR',
    monthKey: '2026-09',
    modelId: 'test-model',
    bounds: { ...AI_BUDGET_STEP_BOUNDS['receipt-ocr'] },
    maxCalls: AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls,
  }, 'co-1')!;

  function abortingProvider() {
    const provider = makeProvider(1);
    (provider as any).client = {
      send: (_command: unknown, options: { abortSignal: AbortSignal }) => new Promise((_resolve, reject) => {
        options.abortSignal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    };
    return provider;
  }

  async function timeoutEntry(budget?: { status: 'active'; envelope: typeof envelope; sourceRoute: string; calls: number }) {
    const provider = abortingProvider();
    const capture = captureUsageLines();
    return runWithUsageContext({ companyId: 'co-1', ...(budget ? { budget } : {}) }, async () => {
      try {
        await provider.generateText({ messages: [{ role: 'user', text: 'q' }], maxTokens: 4096 });
      } finally {
        capture.restore();
      }
      return drainUsage()[0]!;
    });
  }

  it('uses the rendered request estimate inside the envelope bound', async () => {
    const entry = await timeoutEntry({ status: 'active', envelope, sourceRoute: 'receipt-ocr', calls: 1 });

    assert.ok(entry.inputTokens > 0 && entry.inputTokens < 100);
    assert.ok(entry.inputTokens <= envelope.bounds.maxInputTokens, 'a SPLIT timeout must settle inside its hold');
    assert.equal(entry.outputTokens, 4096);
    // Still an estimate, never zero and never "measured" (spec §11.2).
    assert.equal(entry.usageBasis, 'CONSERVATIVE_ESTIMATE');
    assert.equal(entry.ok, false);
  });

  it('clamps a requested output above the declared bound to that bound', async () => {
    const provider = abortingProvider();
    const capture = captureUsageLines();
    const entry = await runWithUsageContext(
      { companyId: 'co-1', budget: { status: 'active', envelope, sourceRoute: 'receipt-ocr', calls: 1 } },
      async () => {
        try {
          // The decorator refuses this before the provider in production; the estimate must be
          // inside the hold even if some future caller reaches here another way.
          await provider.generateText({ messages: [{ role: 'user', text: 'q' }] });
        } finally {
          capture.restore();
        }
        return drainUsage()[0]!;
      },
    );

    assert.equal(entry.outputTokens, Math.min(2048, AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxOutputTokens));
  });

  it('uses the same realistic estimate for a SHARED request without an envelope', async () => {
    const entry = await timeoutEntry();

    assert.ok(entry.inputTokens > 0 && entry.inputTokens < 100);
    assert.equal(entry.outputTokens, 4096);
  });

  it('pins the SDK to one attempt only under an envelope (ADR 0013 §6 step 3)', async () => {
    // The reservation prices exactly one attempt, so a silent SDK retry would spend a second
    // invocation's money against one hold. The SDK default is 3.
    const resolve = (provider: unknown) => (provider as any).client.config.maxAttempts();
    assert.equal(await resolve(new BedrockProvider({
      region: 'ap-southeast-1', modelId: 'test-model', timeoutMs: 1, maxAttempts: AI_BUDGET_STEP_ATTEMPTS,
    })), 1);
    assert.equal(await resolve(makeProvider()), 3, 'without an envelope the SDK default is untouched');
  });

  it('wires the money decorator from the factory, and only when an envelope is present', async () => {
    const config = {
      modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', bedrockModelId: 'test-model',
      aiToolTimeoutMs: 1000, erpCoreInternalUrl: 'http://api.test/v1', aiGatewayInternalSecret: 's',
    } as any;
    const budget = { status: 'active' as const, envelope, sourceRoute: 'receipt-ocr', calls: 0 };

    // The guard is a Proxy over the real provider, so what the factory configured is still
    // readable: the attempt pin is decided from the request context, not from a caller flag.
    assert.equal((createProvider(config) as any).cfg.maxAttempts, undefined);
    assert.equal(runWithUsageContext({ companyId: 'co-1', budget },
      () => (createProvider(config) as any).cfg.maxAttempts), AI_BUDGET_STEP_ATTEMPTS);

    // Under an envelope the factory's provider refuses a request outside the declared bounds
    // BEFORE any SDK call — which is only possible if `createProvider` applied the decorator.
    const refused = await runWithUsageContext({ companyId: 'co-1', budget }, () =>
      createProvider(config).generateText({
        messages: [{ role: 'user', text: 'q' }], maxTokens: 999_999, usageTag: 'ocr.receipt.extract',
      }));
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false ? refused.error.budgetCode : undefined, 'AI_BUDGET_UNAVAILABLE');
    assert.equal(refused.ok === false ? refused.error.budgetScope : undefined, 'OCR');

    // The SAME request with no envelope reaches the SDK, exactly as today — no bound, no refusal.
    const originalSend = BedrockRuntimeClient.prototype.send;
    let sent = 0;
    (BedrockRuntimeClient.prototype as any).send = async () => {
      sent += 1;
      return { output: { message: { content: [{ text: 'ok' }] } }, stopReason: 'end_turn' };
    };
    const capture = captureUsageLines();
    try {
      const allowed = await runWithUsageContext({ companyId: 'co-1' }, () =>
        createProvider(config).generateText({
          messages: [{ role: 'user', text: 'q' }], maxTokens: 999_999, usageTag: 'ocr.receipt.extract',
        }));
      assert.equal(allowed.ok, true);
      assert.equal(sent, 1);
    } finally {
      capture.restore();
      (BedrockRuntimeClient.prototype as any).send = originalSend;
    }
  });

});

// Local Messages API transport shares the Bedrock contract and this already-registered test file.
describe('AnthropicApiProvider (local eval)', () => {
  const modelId = 'global.anthropic.claude-sonnet-4-6';
  const key = 'test-key-never-log';
  const originalFetch = globalThis.fetch;
  let capture: ReturnType<typeof captureUsageLines>;
  const tools = [{ name: 'expense_summary', description: 'Read expenses', inputSchema: {
    type: 'object', properties: { month: { type: 'string' } }, required: ['month'], additionalProperties: false,
  } }];
  const call = { toolUseId: 'toolu_1', name: 'expense_summary', input: { month: '2026-10' } };
  const apiCall = { type: 'tool_use', id: call.toolUseId, name: call.name, input: call.input };
  const textInput = { messages: [{ role: 'user' as const, text: 'summary' }] };

  function provider(timeoutMs = 10000, sleep = async (_ms: number) => {}) {
    return new AnthropicApiProvider({ apiKey: key, modelId, timeoutMs, sleep });
  }
  function response(body: Record<string, unknown> = {}, status = 200) {
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'answer' }],
      usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 }, ...body }), { status });
  }
  function stub(...responses: Response[]) {
    const requests: Array<{ url: string; init: RequestInit; body: any }> = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init: init!, body: JSON.parse(String(init?.body)) });
      const next = responses.shift();
      assert.ok(next, 'unexpected extra fetch');
      return next;
    };
    return requests;
  }
  beforeEach(() => {
    // Never fall through to network, including on an unexpectedly missing stub.
    globalThis.fetch = async () => { throw new Error('fetch must be stubbed'); };
    capture = captureUsageLines();
  });
  afterEach(() => { globalThis.fetch = originalFetch; capture.restore(); });

  it('maps every geographic profile and strips only the leading vendor and trailing version', () => {
    for (const prefix of ['global.', 'apac.', 'us.', 'eu.', 'jp.', 'au.', '']) {
      assert.equal(anthropicModelId(`${prefix}anthropic.claude-sonnet-4-6`), 'claude-sonnet-4-6');
      assert.equal(anthropicModelId(`${prefix}anthropic.claude-haiku-4-5-20251001-v1:0`), 'claude-haiku-4-5-20251001');
    }
    assert.equal(anthropicModelId('claude-haiku-v12:34'), 'claude-haiku');
    assert.equal(anthropicModelId('claude-sonnet-4-6'), 'claude-sonnet-4-6');
    assert.equal(anthropicModelId('other.global.anthropic.model-v1:0-suffix'), 'other.global.anthropic.model-v1:0-suffix');
  });

  it('posts text, base64 images and PDF on the last user message with identical cache boundaries', async () => {
    const requests = stub(response());
    const image = { mimeType: 'image/png' as const, contentBase64: Buffer.from('png').toString('base64') };
    const pdf = { mimeType: 'application/pdf' as const, contentBase64: Buffer.from('%PDF').toString('base64') };
    assert.equal((await provider().generateText({ systemPrompt: LONG_PROMPT, cacheableContext: LONG_CONTEXT,
      messages: [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'earlier' }, { role: 'user', text: 'read' }, { role: 'assistant', text: 'later' }],
      images: [image, { ...image, mimeType: 'image/jpeg' }], documents: [pdf], maxTokens: 99,
    })).ok, true);
    const req = requests[0]!;
    assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(req.init.method, 'POST');
    assert.deepEqual(req.init.headers, { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
    assert.equal(req.body.model, 'claude-sonnet-4-6');
    assert.equal(req.body.max_tokens, 99);
    assert.deepEqual(req.body.system, [{ type: 'text', text: LONG_PROMPT, cache_control: { type: 'ephemeral' } }]);
    assert.deepEqual(req.body.messages, [
      { role: 'user', content: [{ type: 'text', text: LONG_CONTEXT, cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'first' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'earlier' }] },
      { role: 'user', content: [{ type: 'text', text: 'read' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.contentBase64 } },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.contentBase64 } },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.contentBase64 } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'later' }] },
    ]);
    assert.ok(!JSON.stringify(capture.lines).includes(key));
    assert.ok(!JSON.stringify(capture.lines).includes(LONG_CONTEXT));
  });

  it('renders short context/system without caching and defaults text output to 2048', async () => {
    const requests = stub(response());
    await provider().generateText({ ...textInput, systemPrompt: SHORT_PROMPT, cacheableContext: SHORT_CONTEXT });
    assert.deepEqual(requests[0]!.body.system, [{ type: 'text', text: SHORT_PROMPT }]);
    assert.deepEqual(requests[0]!.body.messages[0].content, [{ type: 'text', text: SHORT_CONTEXT }, { type: 'text', text: 'summary' }]);
    assert.equal(requests[0]!.body.max_tokens, 2048);
  });

  it('preserves cacheable context on the first message when no user turn exists', async () => {
    const requests = stub(response(), response());
    await provider().generateText({ messages: [{ role: 'assistant', text: 'earlier' }], cacheableContext: LONG_CONTEXT });
    await provider().generateWithTools({ messages: [{ role: 'tool_results', results: [{ toolUseId: 'old', content: 'data' }] }], tools, cacheableContext: LONG_CONTEXT });
    for (const req of requests) assert.deepEqual(req.body.messages[0].content[0], { type: 'text', text: LONG_CONTEXT, cache_control: { type: 'ephemeral' } });
    assert.equal(requests[1]!.body.messages[0].content[1].type, 'tool_result');
  });

  it('round trips native tool calls, assistant text, and normal/error tool results', async () => {
    const secondCall = { ...call, toolUseId: 'toolu_2' };
    const secondApiCall = { ...apiCall, id: secondCall.toolUseId };
    const requests = stub(response({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'checking' }, apiCall, secondApiCall] }), response());
    const p = provider();
    const first = await p.generateWithTools({ ...textInput, tools, systemPrompt: LONG_PROMPT, cacheableContext: LONG_CONTEXT });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.stopReason, 'tool_use');
    assert.deepEqual(first.toolCalls, [call, secondCall]);
    assert.deepEqual(requests[0]!.body.tools, [{ name: tools[0]!.name, description: tools[0]!.description, input_schema: tools[0]!.inputSchema }]);
    assert.equal(requests[0]!.body.max_tokens, 1024);
    assert.deepEqual(requests[0]!.body.system[0].cache_control, { type: 'ephemeral' });
    assert.deepEqual(requests[0]!.body.messages[0].content[0].cache_control, { type: 'ephemeral' });
    const second = await p.generateWithTools({ tools, messages: [...textInput.messages,
      { role: 'assistant', text: first.text, toolCalls: first.toolCalls },
      { role: 'tool_results', results: [{ toolUseId: call.toolUseId, content: 'failed', isError: true }, { toolUseId: 'toolu_2', content: 'ok' }] },
    ] });
    assert.equal(second.ok, true);
    if (second.ok) { assert.equal(second.stopReason, 'end_turn'); assert.deepEqual(second.toolCalls, []); }
    assert.deepEqual(requests[1]!.body.messages.slice(1), [
      { role: 'assistant', content: [{ type: 'text', text: 'checking' }, apiCall, secondApiCall] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.toolUseId, content: 'failed', is_error: true }, { type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }] },
    ]);
  });

  it('rejects the entire tool batch for unknown tools, invalid arguments, missing ids or missing calls', async () => {
    for (const bad of [{ ...apiCall, name: 'unknown' }, { ...apiCall, input: { month: 10 } }, { ...apiCall, id: '' }, { ...apiCall, input: undefined }, null]) {
      stub(response({ stop_reason: 'tool_use', content: bad ? [apiCall, bad] : [] }));
      const result = await provider().generateWithTools({ ...textInput, tools });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, 'PROVIDER_TOOL_ARGUMENT_INVALID');
    }
  });

  it('returns max_tokens for text and drops partial tool calls at the output limit', async () => {
    stub(response({ stop_reason: 'max_tokens' }), response({ stop_reason: 'max_tokens', content: [apiCall] }));
    const text = await provider().generateText(textInput);
    const tool = await provider().generateWithTools({ ...textInput, tools });
    for (const result of [text, tool]) {
      assert.equal(result.ok, true);
      if (result.ok) { assert.equal(result.completion, 'output_limit'); assert.equal(result.stopReason, 'max_tokens'); }
    }
    if (tool.ok) assert.deepEqual(tool.toolCalls, []);
  });

  it('appends exactly one Bedrock-shaped usage entry with all four token counters and the original model ID', async () => {
    stub(response());
    const entries = await runWithUsageContext({ companyId: 'local-co' }, async () => {
      await provider().generateText({ ...textInput, usageTag: 'eval.test' });
      return drainUsage();
    });
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0], { tag: 'eval.test', modelId, ok: true, inputTokens: 11, outputTokens: 7,
      cacheReadInputTokens: 20, cacheWriteInputTokens: 30, durationMs: entries[0]!.durationMs, usageBasis: 'PROVIDER_REPORTED' });
    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0]!['companyId'], 'local-co');
  });

  it('retries HTTP 429 then succeeds, with one usage entry and a bounded backoff', async () => {
    const requests = stub(response({}, 429), response());
    const waits: number[] = [];
    const entries = await runWithUsageContext({ companyId: 'local-co' }, async () => {
      assert.equal((await provider(10000, async (ms) => { waits.push(ms); }).generateText(textInput)).ok, true);
      return drainUsage();
    });
    assert.equal(requests.length, 2);
    assert.equal(waits.length, 1);
    assert.ok(waits[0]! >= 400 && waits[0]! <= 1200);
    assert.equal(entries.length, 1);
    assert.equal(capture.lines[0]!['throttleRetryCount'], 1);
  });

  it('caps both HTTP 429 and 529 retries at the same bound as Bedrock', async () => {
    for (const status of [429, 529]) {
      const requests = stub(response({}, status), response({}, status), response({}, status));
      const result = await provider().generateText(textInput);
      assert.equal(requests.length, 3);
      assert.equal(result.ok, false);
      if (!result.ok) { assert.equal(result.error.code, 'PROVIDER_THROTTLED'); assert.equal(result.error.retryable, true); }
    }
  });

  it('does not retry beyond either the caller deadline or its configured timeout', async () => {
    for (const withDeadline of [true, false]) {
      const requests = stub(response({}, 429));
      let sleeps = 0;
      const result = await provider(withDeadline ? 10000 : 100, async () => { sleeps += 1; }).generateText({ ...textInput, ...(withDeadline ? { deadlineAt: Date.now() + 100 } : {}) });
      assert.equal(result.ok, false);
      assert.equal(requests.length, 1);
      assert.equal(sleeps, 0);
    }
  });

  it('refuses pre-aborted or expired work before fetch and emits no usage', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return response(); };
    for (const cancellation of [{ signal: AbortSignal.abort() }, { deadlineAt: Date.now() - 1 }]) {
      for (const result of [await provider().generateText({ ...textInput, ...cancellation }), await provider().generateWithTools({ ...textInput, tools, ...cancellation })]) {
        assert.equal(result.ok, false);
        if (!result.ok) { assert.equal(result.error.code, 'PROVIDER_TIMEOUT'); assert.equal(result.error.retryable, false); }
      }
    }
    assert.equal(calls, 0);
    assert.equal(capture.lines.length, 0);
  });

  it('aborts an in-flight fetch and estimates only the rendered request', async () => {
    let aborted = false;
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
    });
    const entries = await runWithUsageContext({ companyId: 'local-co' }, async () => {
      const result = await provider(1).generateText({ ...textInput, maxTokens: 17 });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, 'PROVIDER_TIMEOUT');
      return drainUsage();
    });
    assert.equal(aborted, true);
    assert.equal(entries.length, 1);
    assert.ok(entries[0]!.inputTokens > 0 && entries[0]!.inputTokens < 100, 'estimate follows the short rendered request');
    assert.equal(entries[0]!.outputTokens, 17);
    assert.equal(entries[0]!.usageBasis, 'CONSERVATIVE_ESTIMATE');
    assert.equal(capture.lines[0]!['usageEstimated'], true);
  });

  it('propagates caller cancellation and caps the internal estimate at the envelope bounds', async () => {
    const envelope = parseAiBudgetEnvelope({ attemptKey: 'line-image:local', stepKind: 'receipt-ocr',
      invocationKey: aiBudgetInvocationKey('co-1', 'line-image:local', 'receipt-ocr', 0), bucket: 'OCR', monthKey: '2026-10', modelId,
      bounds: { ...AI_BUDGET_STEP_BOUNDS['receipt-ocr'] }, maxCalls: AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls,
    }, 'co-1')!;
    assert.ok(envelope);
    const controller = new AbortController();
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      controller.abort();
    });
    const entry = await runWithUsageContext({ companyId: 'co-1', budget: { status: 'active', envelope, sourceRoute: 'receipt-ocr', calls: 1 } }, async () => {
      const result = await provider().generateWithTools({ ...textInput, tools, maxTokens: 999999, signal: controller.signal });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, 'PROVIDER_TIMEOUT');
      return drainUsage()[0]!;
    });
    assert.ok(entry.inputTokens > 0 && entry.inputTokens < 100);
    assert.equal(entry.outputTokens, envelope.bounds.maxOutputTokens);
    assert.equal(entry.usageBasis, 'CONSERVATIVE_ESTIMATE');
  });

  it('does not dispatch again when cancelled during throttle backoff', async () => {
    const requests = stub(response({}, 429));
    const controller = new AbortController();
    const result = await provider(10000, async () => { controller.abort(); }).generateText({ ...textInput, signal: controller.signal });
    assert.equal(requests.length, 1);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PROVIDER_TIMEOUT');
  });

  it('maps refusal to PROVIDER_BLOCKED on both paths and retains reported usage', async () => {
    stub(response({ stop_reason: 'refusal' }), response({ stop_reason: 'refusal', content: undefined }));
    const entries = await runWithUsageContext({ companyId: 'local-co' }, async () => {
      for (const result of [await provider().generateText(textInput), await provider().generateWithTools({ ...textInput, tools })]) {
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.error.code, 'PROVIDER_BLOCKED');
      }
      return drainUsage();
    });
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.ok, false);
    assert.equal(entries[0]!.inputTokens, 11);
  });

  it('maps unknown stops, empty/malformed content, and invalid JSON to PROVIDER_OUTPUT_INCOMPLETE', async () => {
    for (const body of [{ stop_reason: 'pause_turn' }, { stop_reason: 'tool_use' }, { content: [] }, { content: null }, { content: [null] }]) {
      stub(response(body));
      const result = await provider().generateText(textInput);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, 'PROVIDER_OUTPUT_INCOMPLETE');
    }
    stub(new Response('not-json'));
    const result = await provider().generateText(textInput);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PROVIDER_OUTPUT_INCOMPLETE');
  });

  it('maps other non-2xx responses to PROVIDER_UNKNOWN without exposing the response body or key', async () => {
    stub(response({ error: { message: `sensitive-body ${key}` } }, 401));
    const result = await provider().generateText(textInput);
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.error.code, 'PROVIDER_UNKNOWN'); assert.equal(result.error.retryable, false); }
    assert.ok(!JSON.stringify([result, capture.lines]).includes(key));
    assert.ok(!JSON.stringify([result, capture.lines]).includes('sensitive-body'));
    assert.equal(capture.lines[0]!['inputTokens'], undefined);
  });

  it('factory selects Anthropic only for local Bedrock workloads with a key, after approval, with budget guards', async () => {
    const config = { appEnv: 'local', modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', bedrockModelId: modelId,
      aiToolTimeoutMs: 1000, erpCoreInternalUrl: 'http://api.test/v1', aiGatewayInternalSecret: 's',
      approvedAiProviders: ['bedrock'], approvedAiModelIds: [modelId], approvedAiRegions: ['ap-southeast-1'],
    } as any;
    assert.ok(createProvider(config) instanceof BedrockProvider);
    assert.ok(createProvider({ ...config, anthropicApiKey: key }) instanceof AnthropicApiProvider);
    assert.ok(!(createProvider({ ...config, anthropicApiKey: key, modelProvider: 'disabled' }) instanceof AnthropicApiProvider));
    assert.throws(() => createProvider({ ...config, appEnv: 'production', anthropicApiKey: key }), /local only/);
    assert.throws(() => createProvider({ ...config, appEnv: undefined, anthropicApiKey: key }), /local only/);
    assert.throws(() => createProvider({ ...config, anthropicApiKey: key, approvedAiModelIds: [] }), /AI_MODEL_NOT_APPROVED/);
    assert.throws(() => createProvider({ ...config, anthropicApiKey: key, approvedAiProviders: [] }), /AI_PROVIDER_NOT_APPROVED/);
    assert.throws(() => createProvider({ ...config, anthropicApiKey: key, approvedAiRegions: [] }), /AI_REGION_NOT_APPROVED/);
    const envelope = parseAiBudgetEnvelope({ attemptKey: 'line-image:factory', stepKind: 'receipt-ocr',
      invocationKey: aiBudgetInvocationKey('co-1', 'line-image:factory', 'receipt-ocr', 0), bucket: 'OCR', monthKey: '2026-10', modelId,
      bounds: { ...AI_BUDGET_STEP_BOUNDS['receipt-ocr'] }, maxCalls: AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls,
    }, 'co-1')!;
    const requests = stub();
    const result = await runWithUsageContext({ companyId: 'co-1', budget: { status: 'active', envelope, sourceRoute: 'receipt-ocr', calls: 0 } }, () => {
      const selected = createProvider({ ...config, anthropicApiKey: key });
      assert.equal((selected as any).cfg.maxAttempts, AI_BUDGET_STEP_ATTEMPTS);
      return selected.generateText({ ...textInput, maxTokens: 999999, usageTag: 'ocr.receipt.extract' });
    });
    assert.equal(requests.length, 0);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.budgetCode, 'AI_BUDGET_UNAVAILABLE');
  });

  it('launcher selects key files or AWS, trims keys, refuses missing credentials, and never prints keys (spawn stubbed)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anthropic-eval-launch-'));
    const launcher = resolve(__dirname, '../../../../../../../scripts/line-ai-expense-advisor/launch-gateway.mjs');
    const secretsPath = join(dir, 'secrets.json');
    const keyPath = join(dir, 'key');
    // An isolated process imports the real launcher with spawn replaced before ESM imports bind.
    // It cannot launch a gateway, contact AWS, or read the owner's default key file.
    const runner = `
      import assert from 'node:assert/strict';
      import { createRequire, syncBuiltinESMExports } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const require = createRequire(import.meta.url);
      const [launcher, expectedKey, homeDir] = process.argv.slice(1);
      require('node:os').homedir = () => homeDir;
      require('node:child_process').spawn = (_command, _args, options) => {
        assert.equal(options.env.ANTHROPIC_API_KEY, expectedKey || undefined);
        assert.equal(options.env.APP_ENV, 'local');
        assert.equal(options.env.MODEL_PROVIDER, 'bedrock');
        return { on: (_event, callback) => callback(0) };
      };
      syncBuiltinESMExports();
      await import(pathToFileURL(launcher).href);
    `;
    try {
      writeFileSync(secretsPath, JSON.stringify({ databaseUrl: 'postgresql://local:local@127.0.0.1:1/test', gatewaySecret: 'test', delegationSigningKey: 'test' }));
      mkdirSync(join(dir, '.config/mangmee'), { recursive: true });
      writeFileSync(join(dir, '.config/mangmee/anthropic-api-key'), ` ${key}\n`);
      for (const testCase of [
        { profile: '', file: keyPath, contents: ` ${key}\n`, expected: key },
        { profile: 'test-profile', file: keyPath, contents: key, expected: key },
        { profile: '', file: undefined, expected: key },
        { profile: 'test-profile', file: join(dir, 'absent'), expected: '' },
        { profile: 'test-profile', file: dir, expected: '' },
        { profile: '', file: keyPath, contents: ' \n', expected: '', refused: true },
        { profile: '', file: join(dir, 'absent'), expected: '', refused: true },
        { profile: '', file: dir, expected: '', refused: true, unreadable: true },
      ]) {
        if (testCase.contents !== undefined) writeFileSync(keyPath, testCase.contents);
        const child = spawnSync(process.execPath, ['--input-type=module', '--eval', runner, launcher, testCase.expected, dir], {
          encoding: 'utf8', env: { ...process.env, AWS_PROFILE: testCase.profile, ANTHROPIC_API_KEY: 'ambient-key-must-be-ignored',
            MANGMEE_EVAL_ANTHROPIC_KEY_FILE: testCase.file, MANGMEE_EVAL_SECRETS_PATH: secretsPath,
            // M1c: the launcher records its transport provenance here and refuses to start without it.
            MANGMEE_EVAL_OUTPUT_DIR: join(dir, 'eval-out') },
        });
        assert.equal(child.status, testCase.refused ? 1 : 0, child.stderr);
        assert.ok(!`${child.stdout}${child.stderr}`.includes(key));
        assert.ok(!`${child.stdout}${child.stderr}`.includes('ambient-key-must-be-ignored'));
        const line = JSON.parse((testCase.refused ? child.stderr : child.stdout).trim());
        assert.equal(line.event, testCase.refused ? 'gateway_launch_refused' : 'gateway_launch');
        if (testCase.refused) assert.equal(line.reason, testCase.unreadable ? 'ANTHROPIC_KEY_FILE_UNREADABLE' : 'AWS_PROFILE_OR_ANTHROPIC_KEY_FILE_REQUIRED');
        else assert.equal(line.transport, testCase.expected ? 'anthropic-api' : 'bedrock');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});


describe('internal timeout cost estimates (owner no-charge rule)', () => {
  const width = 777, height = 513;
  const png = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(png);
  png.writeUInt32BE(width, 16); png.writeUInt32BE(height, 20);
  png[24] = 8; png[25] = 2;
  const gif = (version: string) => {
    const bytes = Buffer.alloc(13);
    bytes.write(version); bytes.writeUInt16LE(width, 6); bytes.writeUInt16LE(height, 8);
    return bytes;
  };
  const segment = (marker: number, payload: Buffer) => {
    const header = Buffer.from([0xff, marker, 0, 0]);
    header.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([header, payload]);
  };
  const jpeg = (marker: number, prefix = Buffer.alloc(0)) => {
    const frame = Buffer.from([8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
    frame.writeUInt16BE(height, 1); frame.writeUInt16BE(width, 3);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), prefix, segment(marker, frame)]);
  };
  const chunk = (kind: string, payload: Buffer) => {
    const header = Buffer.alloc(8);
    header.write(kind); header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload, Buffer.alloc(payload.length % 2)]);
  };
  const webp = (...chunks: Buffer[]) => {
    const header = Buffer.from('RIFF\0\0\0\0WEBP', 'ascii');
    header.writeUInt32LE(4 + chunks.reduce((sum, part) => sum + part.length, 0), 4);
    return Buffer.concat([header, ...chunks]);
  };
  const vp8 = Buffer.from([0x10, 0, 0, 0x9d, 0x01, 0x2a, 0, 0, 0, 0]);
  vp8.writeUInt16LE(width | 0xc000, 6); vp8.writeUInt16LE(height | 0x8000, 8);
  const vp8l = Buffer.alloc(5); vp8l[0] = 0x2f;
  vp8l.writeUInt32LE((width - 1) | ((height - 1) << 14) | (1 << 28), 1);
  const vp8x = Buffer.alloc(10);
  vp8x.writeUIntLE(width - 1, 4, 3); vp8x.writeUIntLE(height - 1, 7, 3);
  const headers = [
    { name: 'PNG IHDR', bytes: png },
    ...[0xc0, 0xc1, 0xc2].map((marker) => ({ name: `JPEG SOF${marker - 0xc0}`, bytes: jpeg(marker) })),
    { name: 'JPEG skips APP0 and EXIF with misleading SOF bytes', bytes: jpeg(0xc2, Buffer.concat([
      segment(0xe0, Buffer.from('JFIF\0')), segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), jpeg(0xc0)])),
    ])) },
    { name: 'JPEG fill and standalone markers', bytes: jpeg(0xc0, Buffer.from([0xff, 0xff, 0x01, 0xff, 0xd0])) },
    { name: 'GIF87a', bytes: gif('GIF87a') }, { name: 'GIF89a', bytes: gif('GIF89a') },
    { name: 'WebP VP8 scale bits', bytes: webp(chunk('VP8 ', vp8)) },
    { name: 'WebP VP8L alpha bit', bytes: webp(chunk('VP8L', vp8l)) },
    { name: 'WebP VP8X', bytes: webp(chunk('VP8X', vp8x)) },
    { name: 'WebP skips odd padded metadata', bytes: webp(chunk('JUNK', Buffer.from([1])), chunk('VP8 ', vp8)) },
  ];
  const imageUsage = (bytes: Buffer) => conservativeTimeoutUsage({ messages: [],
    images: [{ mimeType: 'image/png', contentBase64: bytes.toString('base64') }] });
  for (const { name, bytes } of headers) {
    it(`reads synthetic ${name} dimensions without decoding pixels`, async () => {
      const text = await conservativeTimeoutUsage({ messages: [] });
      assert.equal((await imageUsage(bytes)).inputTokens, text.inputTokens! + Math.ceil(width * height / 750));
    });
    it(`uses the ceiling for every truncated ${name} header`, async () => {
      const text = await conservativeTimeoutUsage({ messages: [] });
      for (let length = 0; length < bytes.length; length++) {
        assert.equal((await imageUsage(bytes.subarray(0, length))).inputTokens,
          text.inputTokens! + AI_BUDGET_IMAGE_TOKEN_CEILING, `truncated at ${length}`);
      }
    });
  }
  const changed = (bytes: Buffer, offset: number, value: number) => {
    const copy = Buffer.from(bytes); copy[offset] = value; return copy;
  };
  for (const { name, bytes } of [
    { name: 'unknown format', bytes: Buffer.from('<svg width="777" height="513"/>') },
    { name: 'bad PNG signature', bytes: changed(png, 0, 0) },
    { name: 'bad PNG IHDR length', bytes: changed(png, 11, 12) },
    { name: 'missing PNG IHDR', bytes: changed(png, 12, 0) },
    { name: 'zero PNG width', bytes: Buffer.concat([png.subarray(0, 16), Buffer.alloc(4), png.subarray(20)]) },
    { name: 'oversized PNG dimension', bytes: changed(png, 16, 0x80) },
    { name: 'zero GIF height', bytes: Buffer.concat([gif('GIF89a').subarray(0, 8), Buffer.alloc(5)]) },
    { name: 'bad GIF version', bytes: gif('GIF90a') },
    ...[0, 1, 0xffff].map((length) => ({ name: `JPEG bad segment length ${length}`,
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe1, length >>> 8, length & 0xff]) })),
    { name: 'JPEG wrong component count', bytes: changed(jpeg(0xc0), 11, 2) },
    { name: 'JPEG zero height', bytes: changed(changed(jpeg(0xc0), 7, 0), 8, 0) },
    { name: 'JPEG unsupported SOF', bytes: jpeg(0xc3) },
    ...[0x00, 0xd8, 0xd9, 0xda].map((marker) => ({ name: `JPEG stops at ${marker}`,
      bytes: jpeg(0xc0, Buffer.from([0xff, marker])) })),
    { name: 'JPEG unmarked bytes', bytes: jpeg(0xc0, Buffer.from([1, 2])) },
    { name: 'JPEG bounded fill traversal', bytes: jpeg(0xc0, Buffer.alloc(2048, 0xff)) },
    { name: 'JPEG bounded segment traversal', bytes: jpeg(0xc0, Buffer.concat(Array.from({ length: 1024 }, () => segment(0xe1, Buffer.alloc(0))))) },
    { name: 'WebP oversized RIFF', bytes: changed(webp(chunk('VP8X', vp8x)), 7, 0x7f) },
    { name: 'WebP undersized RIFF', bytes: changed(webp(chunk('VP8X', vp8x)), 4, 0) },
    { name: 'WebP oversized chunk', bytes: webp(changed(chunk('VP8X', vp8x), 4, 100)) },
    { name: 'WebP unknown chunk', bytes: webp(chunk('JUNK', Buffer.alloc(0))) },
    { name: 'WebP short VP8', bytes: webp(chunk('VP8 ', vp8.subarray(0, 9))) },
    { name: 'WebP interframe VP8', bytes: webp(chunk('VP8 ', changed(vp8, 0, 1))) },
    { name: 'WebP bad VP8 signature', bytes: webp(chunk('VP8 ', changed(vp8, 3, 0))) },
    { name: 'WebP zero VP8 width', bytes: webp(chunk('VP8 ', Buffer.concat([vp8.subarray(0, 6), Buffer.alloc(2), vp8.subarray(8)]))) },
    { name: 'WebP bad VP8L signature', bytes: webp(chunk('VP8L', changed(vp8l, 0, 0))) },
    { name: 'WebP bad VP8L version', bytes: webp(chunk('VP8L', changed(vp8l, 4, 0xe0))) },
    { name: 'WebP wrong VP8X length', bytes: webp(chunk('VP8X', vp8x.subarray(0, 9))) },
    { name: 'WebP reserved VP8X flag', bytes: webp(chunk('VP8X', changed(vp8x, 0, 1))) },
    { name: 'WebP reserved VP8X byte', bytes: webp(chunk('VP8X', changed(vp8x, 1, 1))) },
    { name: 'WebP bounded chunk traversal', bytes: webp(...Array.from({ length: 1024 }, () => chunk('JUNK', Buffer.alloc(0))), chunk('VP8 ', vp8)) },
  ]) {
    it(`uses the ceiling for ${name} without throwing`, async () => {
      const text = await conservativeTimeoutUsage({ messages: [] });
      assert.equal((await imageUsage(bytes)).inputTokens, text.inputTokens! + AI_BUDGET_IMAGE_TOKEN_CEILING);
    });
  }

  for (const format of ['png', 'jpeg', 'webp', 'gif'] as const) {
    it(`matches previous sharp metadata estimates for generated ${format} fixtures`, async () => {
      const bytes = await sharp({ create: { width, height, channels: 3, background: 'white' } }).toFormat(format).toBuffer();
      const metadata = await sharp(bytes).metadata();
      const text = await conservativeTimeoutUsage({ messages: [] });
      assert.equal((await imageUsage(bytes)).inputTokens, text.inputTokens! + Math.ceil(metadata.width! * metadata.height! / 750));
    });
  }
  it('matches raw sharp metadata for EXIF-oriented JPEG and lossless/extended WebP', async () => {
    for (const bytes of await Promise.all([
      sharp({ create: { width, height, channels: 3, background: 'white' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer(),
      sharp({ create: { width, height, channels: 3, background: 'white' } }).webp({ lossless: true }).toBuffer(),
      sharp({ create: { width, height, channels: 4, background: '#ffffff80' } }).withMetadata().webp().toBuffer(),
    ])) {
      const metadata = await sharp(bytes).metadata();
      const text = await conservativeTimeoutUsage({ messages: [] });
      assert.equal((await imageUsage(bytes)).inputTokens, text.inputTokens! + Math.ceil(metadata.width! * metadata.height! / 750));
    }
  });
  it('estimates image usage when loading sharp is forbidden', () => {
    const runner = `
      const assert = require('node:assert/strict');
      const Module = require('node:module'), load = Module._load;
      Module._load = function (name, ...args) {
        assert.ok(!name.includes('sharp'), 'native sharp must not be loaded');
        return load.call(this, name, ...args);
      };
      const { conservativeTimeoutUsage } = require(process.argv[1]);
      (async () => {
        const text = await conservativeTimeoutUsage({ messages: [] });
        const media = await conservativeTimeoutUsage({ messages: [], images: [{ mimeType: 'image/png', contentBase64: process.argv[2] }] });
        assert.equal(media.inputTokens - text.inputTokens, ${Math.ceil(width * height / 750)});
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--eval', runner,
      resolve(__dirname, 'provider-usage-estimate.ts'), png.toString('base64')], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  });

  it('counts rendered UTF-8 system, context, messages and tool schemas without changing input', async () => {
    const input = { systemPrompt: 'อ่านเอกสารค่ะ', cacheableContext: 'บริบท',
      messages: [{ role: 'user' as const, text: 'ช่วยตรวจยอด' }],
      tools: [{ name: 'read', description: 'ข้อมูล', inputSchema: { type: 'object' } }], maxTokens: 73 };
    const before = JSON.stringify(input);
    const expected = Math.ceil(Buffer.byteLength(JSON.stringify({ systemPrompt: input.systemPrompt,
      cacheableContext: input.cacheableContext, messages: input.messages, tools: input.tools }), 'utf8') / 3.14);
    const result = await conservativeTimeoutUsage(input);
    assert.equal(result.inputTokens, expected);
    assert.equal(result.outputTokens, 73);
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(await conservativeTimeoutUsage(input, { maxInputTokens: 5, maxOutputTokens: 7 }),
      { inputTokens: 5, outputTokens: 7, totalTokens: 12, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 });
  });

  it('counts the actual image dimensions after resize and PDF page evidence, excluding base64 text', async () => {
    const image = await sharp({ create: { width: 1500, height: 2000, channels: 3, background: 'white' } })
      .resize(750, 1000).png().toBuffer();
    const input = { messages: [{ role: 'user' as const, text: 'read' }], maxTokens: 17 };
    const text = await conservativeTimeoutUsage(input);
    const media = await conservativeTimeoutUsage({ ...input,
      images: [{ mimeType: 'image/png', contentBase64: image.toString('base64') }],
      documents: [{ mimeType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4 /Type /Pages /Count 2 /Type /Page /Type /Page').toString('base64') }] });
    assert.equal(media.inputTokens, text.inputTokens! + 1000 + 2 * 3000);
    assert.equal(media.outputTokens, 17);
  });
});


it('Exam D: a zero-token provider failure logs its exception class and HTTP status without private error text', async () => {
  const provider = makeProvider(), captured = captureUsageLines();
  (provider as any).client = { send: async () => { throw Object.assign(new Error('private user text'), {
    name: 'ServiceUnavailableException', $metadata: { httpStatusCode: 503 } }); } };
  try {
    const result = await provider.generateText({ messages: [{ role: 'user', text: 'ดูค่าใช้จ่าย' }], usageTag: 'line.intake-route' });
    assert.equal(result.ok, false);
    assert.equal(captured.lines.length, 1);
    assert.equal(captured.lines[0].providerStatus, 503);
    assert.equal(captured.lines[0].providerErrorClass, 'ServiceUnavailableException');
    assert.doesNotMatch(JSON.stringify(captured.lines), /private user text/);
  } finally { captured.restore(); }
});

describe('B1 provider output schema', () => {
  const outputSchema = { name: 'workflow_classifier', schema: { type: 'object', additionalProperties: false,
    required: ['label'], properties: { label: { type: 'string', enum: ['read'] } } } };

  it('renders the exact Bedrock output format and preserves the request without a schema', async () => {
    const provider = makeProvider();
    const requests: any[] = [];
    (provider as any).client = { send: async (command: any) => { requests.push(command.input); return {
      stopReason: 'end_turn', output: { message: { content: [{ text: '{"label":"read"}' }] } },
    }; } };
    const input = { systemPrompt: 'Classify.', messages: [{ role: 'user' as const, text: 'ส่งใบเบิกของฉันให้อนุมัติหน่อย' }], maxTokens: 256 };
    const plain = await provider.generateText(input);
    const structured = await provider.generateText({ ...input, outputSchema } as any);
    assert.deepEqual(requests[0], { modelId: 'test-model', messages: [{ role: 'user', content: [{ text: input.messages[0].text }] }],
      system: [{ text: 'Classify.' }], inferenceConfig: { maxTokens: 256 } });
    const { outputConfig, ...withoutSchema } = requests[1];
    assert.equal(JSON.stringify(withoutSchema), JSON.stringify(requests[0]));
    assert.deepEqual(outputConfig, { textFormat: { type: 'json_schema', structure: { jsonSchema: {
      name: outputSchema.name, schema: JSON.stringify(outputSchema.schema),
    } } } });
    assert.equal(structured.ok, true);
    if (structured.ok) assert.equal((structured as any).schemaEnforcement, 'output_config');
    assert.equal('schemaEnforcement' in plain, false);
  });

  it('maps a refusal invalid JSON missing required fields and incomplete output to failed output', async () => {
    for (const [stopReason, text] of [['guardrail_intervened', 'refused'], ['end_turn', 'ไม่ใช่เจสัน'], ['end_turn', '{}'], ['max_tokens', '{"label":"read"}']]) {
      const provider = makeProvider();
      (provider as any).client = { send: async () => ({ stopReason, output: { message: { content: [{ text }] } } }) };
      const result = await provider.generateText({ messages: [{ role: 'user', text: 'ทดสอบ' }], outputSchema } as any);
      assert.equal(result.ok, false, `${stopReason}: ${text}`);
      if (!result.ok) assert.ok(['PROVIDER_BLOCKED', 'PROVIDER_OUTPUT_INCOMPLETE'].includes(result.error.code));
    }
  });

  it('renders strict tools and reports strict_tool only for a strict returned call', async () => {
    const provider = makeProvider();
    let request: any;
    (provider as any).client = { send: async (command: any) => { request = command.input; return {
      stopReason: 'tool_use', output: { message: { content: [{ toolUse: { toolUseId: 't1', name: outputSchema.name, input: { label: 'read' } } }] } },
    }; } };
    const input = { messages: [{ role: 'user' as const, text: 'ทดสอบ' }], tools: [{ name: outputSchema.name, inputSchema: outputSchema.schema, strict: true }] };
    const result = await provider.generateWithTools(input);
    assert.equal(request.toolConfig.tools[0].toolSpec.strict, true);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal((result as any).schemaEnforcement, 'strict_tool');
    const ordinary = await provider.generateWithTools({ ...input, tools: [{ name: outputSchema.name, inputSchema: outputSchema.schema }] });
    assert.equal('strict' in request.toolConfig.tools[0].toolSpec, false);
    assert.equal('schemaEnforcement' in ordinary, false);
  });

  it('refuses Anthropic output schemas when this checkout has no structured-output SDK contract', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { assert.fail('unsupported structured output must fail before dispatch'); };
    try {
      const result = await new AnthropicApiProvider({ apiKey: 'test', modelId: 'test', timeoutMs: 10000 }).generateText({ messages: [], outputSchema } as any);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, 'PROVIDER_CONTRACT_UNSUPPORTED');
    } finally { globalThis.fetch = original; }
  });
});
