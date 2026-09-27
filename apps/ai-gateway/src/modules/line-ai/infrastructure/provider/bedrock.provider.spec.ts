import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BedrockProvider, CACHE_MIN_CHARS, TIMEOUT_INPUT_TOKEN_CEILING } from './bedrock.provider';
import { drainUsage, runWithUsageContext } from '../../../../common/usage/usage-context';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { createProvider } from './provider.factory';
import {
  AI_BUDGET_STEP_ATTEMPTS, AI_BUDGET_STEP_BOUNDS, aiBudgetInvocationKey, parseAiBudgetEnvelope,
} from '@watchdog-bms/contracts';

function makeProvider(timeoutMs = 10000) {
  return new BedrockProvider({ region: 'ap-southeast-1', modelId: 'test-model', timeoutMs });
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

  it('meters an aborted timeout at the conservative ceiling instead of zero', async () => {
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
    assert.equal(entries[0]!.inputTokens, TIMEOUT_INPUT_TOKEN_CEILING);
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

  it('estimates at the envelope declared input bound, never the 200k model-context ceiling', async () => {
    const entry = await timeoutEntry({ status: 'active', envelope, sourceRoute: 'receipt-ocr', calls: 1 });

    assert.equal(entry.inputTokens, AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxInputTokens);
    assert.ok(entry.inputTokens < TIMEOUT_INPUT_TOKEN_CEILING, 'a SPLIT timeout must settle inside its hold');
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

  it('keeps the legacy ceiling for a request with no envelope — every company today', async () => {
    const entry = await timeoutEntry();

    assert.equal(entry.inputTokens, TIMEOUT_INPUT_TOKEN_CEILING);
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
