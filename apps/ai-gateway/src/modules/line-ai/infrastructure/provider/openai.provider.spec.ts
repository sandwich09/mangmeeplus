import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiProvider } from './openai.provider';
import { drainUsage, runWithUsageContext } from '../../../../common/usage/usage-context';

function jsonResponse(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status }); }

function makeProvider(timeoutMs = 10000) {
  return new OpenAiProvider({ apiKey: 'test-key', model: 'gpt-4.1-mini', timeoutMs });
}

describe('OpenAiProvider', () => {
  it('exposes max_tokens on incomplete text generation', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: 'partial',
    }), { status: 200 }) as any;
    try {
      const result = await makeProvider().generateText({ messages: [{ role: 'user', text: 'hello' }] });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.stopReason, 'max_tokens');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns ok=true with output_text', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'completed', output_text: 'ตอบไทย OK' }), { status: 200 }) as any;
    try {
      const result = await makeProvider().generateText({ messages: [{ role: 'user', text: 'hello' }] });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.text, 'ตอบไทย OK');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps 429 to PROVIDER_THROTTLED', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 }) as any;
    try {
      const result = await makeProvider().generateText({ messages: [{ role: 'user', text: 'hello' }] });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, 'PROVIDER_THROTTLED');
        assert.equal(result.error.retryable, true);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps auth errors to PROVIDER_ACCESS_NOT_READY', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad api key' } }), { status: 401 }) as any;
    try {
      const result = await makeProvider().generateText({ messages: [{ role: 'user', text: 'hello' }] });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, 'PROVIDER_ACCESS_NOT_READY');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── Item 10F: Responses API function-calling adapter ─────────────────────────

describe('OpenAiProvider.generateWithTools', () => {
  const originalFetch = globalThis.fetch;
  it('rejects a response batch with malformed or unregistered function arguments before any call is usable', async () => {
    const provider = new OpenAiProvider({ apiKey: 'k', model: 'gpt-test', timeoutMs: 5000 });
    let captured: any;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({
          status: 'completed',
          output: [
            { type: 'function_call', call_id: 'c1', name: 'sales__get_summary', arguments: '{"fromDate":"2026-07-01"}' },
            { type: 'function_call', call_id: 'c2', name: 'inventory__list_low_stock', arguments: 'not-json' },
            { type: 'message', content: [{ type: 'output_text', text: 'checking' }] },
          ],
        });
    }) as typeof fetch;
    try {
      const result = await provider.generateWithTools!({
        messages: [
          { role: 'user', text: 'q' },
          { role: 'assistant', text: 'prev', toolCalls: [{ toolUseId: 'c0', name: 'sales__get_summary', input: { a: 1 } }] },
          { role: 'tool_results', results: [{ toolUseId: 'c0', content: '{"ok":true}' }] },
        ],
        tools: [{ name: 'sales__get_summary', description: 'read sales', inputSchema: { type: 'object' } }],
        systemPrompt: 'sys',
        maxTokens: 88,
      });

      assert.equal(captured.tools[0].type, 'function');
      assert.equal(captured.tools[0].name, 'sales__get_summary');
      assert.equal(captured.instructions, 'sys');
      assert.equal(captured.max_output_tokens, 88);
      const kinds = captured.input.map((i: any) => i.type ?? i.role);
      assert.deepEqual(kinds, ['user', 'assistant', 'function_call', 'function_call_output']);
      assert.equal(captured.input[3].call_id, 'c0');

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, 'PROVIDER_TOOL_ARGUMENT_INVALID');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps end_turn and HTTP errors', async () => {
    const provider = new OpenAiProvider({ apiKey: 'k', model: 'gpt-test', timeoutMs: 5000 });
    globalThis.fetch = (async () => jsonResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }] })) as typeof fetch;
    try {
      const done = await provider.generateWithTools!({ messages: [{ role: 'user', text: 'q' }], tools: [] });
      assert.equal(done.ok, true);
      if (done.ok) assert.equal(done.stopReason, 'end_turn');

      globalThis.fetch = (async () => jsonResponse({ error: { message: 'rate' } }, 429)) as typeof fetch;
      const throttled = await provider.generateWithTools!({ messages: [{ role: 'user', text: 'q' }], tools: [] });
      assert.equal(throttled.ok, false);
      if (!throttled.ok) assert.equal(throttled.error.code, 'PROVIDER_THROTTLED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── cacheableContext parity: same model-visible content, no OpenAI caching ────

describe('OpenAiProvider cacheableContext', () => {
  it('prepends cacheableContext to the first user text only', async () => {
    const originalFetch = globalThis.fetch;
    let sent: any;
    globalThis.fetch = (async (_url: any, init: any) => {
      sent = JSON.parse(init.body as string);
      return jsonResponse({ status: 'completed', output_text: 'ok' });
    }) as typeof fetch;
    try {
      const result = await makeProvider().generateText({
        cacheableContext: 'CATALOG',
        messages: [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'mid' }, { role: 'user', text: 'second' }],
      });
      assert.equal(result.ok, true);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(sent.input[0].content[0].text, 'CATALOG\nfirst');
    assert.equal(sent.input[1].content[0].text, 'mid');
    assert.equal(sent.input[2].content[0].text, 'second');
  });

  it('leaves the message text untouched when no cacheableContext is passed', async () => {
    const originalFetch = globalThis.fetch;
    let sent: any;
    globalThis.fetch = (async (_url: any, init: any) => {
      sent = JSON.parse(init.body as string);
      return jsonResponse({ status: 'completed', output_text: 'ok' });
    }) as typeof fetch;
    try {
      await makeProvider().generateText({ messages: [{ role: 'user', text: 'first' }] });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(sent.input[0].content[0].text, 'first');
  });
});

// ── ai.usage logging ─────────────────────────────────────────────────────────

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

const USAGE_BODY = {
  status: 'completed',
  output_text: 'ok',
  usage: { input_tokens: 3012, output_tokens: 88, input_tokens_details: { cached_tokens: 2816 } },
};

describe('OpenAiProvider ai.usage logging', () => {
  it('logs one tagged line with the fields the Responses API exposes', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse(USAGE_BODY)) as typeof fetch;
    const capture = captureUsageLines();
    try {
      await makeProvider().generateText({ messages: [{ role: 'user', text: 'q' }], usageTag: 'line.plan-route' });
    } finally {
      capture.restore();
      globalThis.fetch = originalFetch;
    }

    assert.equal(capture.lines.length, 1);
    const line = capture.lines[0]!;
    assert.equal(line['tag'], 'line.plan-route');
    assert.equal(line['modelId'], 'gpt-4.1-mini');
    assert.equal(line['ok'], true);
    assert.equal(line['inputTokens'], 196);
    assert.equal(line['outputTokens'], 88);
    assert.equal(line['cacheReadInputTokens'], 2816);
    assert.equal(typeof line['durationMs'], 'number');
  });

  it('retains provider-reported usage when an HTTP error body includes counters', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse({ error: { message: 'rate' }, usage: USAGE_BODY.usage }, 429)) as typeof fetch;
    const capture = captureUsageLines();
    try {
      const result = await makeProvider().generateText({ messages: [{ role: 'user', text: 'q' }], usageTag: 'line.plan-route' });
      assert.equal(result.ok, false);
    } finally {
      capture.restore();
      globalThis.fetch = originalFetch;
    }

    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0]!['ok'], false);
    assert.equal(capture.lines[0]!['inputTokens'], 196);
  });

  it('skips silently when the response carries no usage block', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse({ status: 'completed', output_text: 'ok' })) as typeof fetch;
    const capture = captureUsageLines();
    try {
      await makeProvider().generateText({ messages: [{ role: 'user', text: 'q' }] });
    } finally {
      capture.restore();
      globalThis.fetch = originalFetch;
    }

    assert.equal(capture.lines.length, 0);
  });

  it('carries companyId on the line when a collector context is open', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse(USAGE_BODY)) as typeof fetch;
    const capture = captureUsageLines();
    try {
      await runWithUsageContext({ companyId: 'company-1' }, () =>
        makeProvider().generateText({ messages: [{ role: 'user', text: 'q' }], usageTag: 'line.plan-route' }));
    } finally {
      capture.restore();
      globalThis.fetch = originalFetch;
    }

    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0]!['companyId'], 'company-1');
  });
});

// ── Collector parity with the Bedrock provider (metering §7.2) ────────────────

describe('OpenAiProvider usage collection', () => {
  it('appends exactly one entry per successful call', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse(USAGE_BODY)) as typeof fetch;
    const capture = captureUsageLines();
    const entries = await runWithUsageContext({ companyId: 'company-1' }, async () => {
      try {
        await makeProvider().generateText({ messages: [{ role: 'user', text: 'q' }], usageTag: 'line.plan-route' });
      } finally {
        capture.restore();
        globalThis.fetch = originalFetch;
      }
      return drainUsage();
    });

    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0], {
      tag: 'line.plan-route',
      modelId: 'gpt-4.1-mini',
      ok: true,
      inputTokens: 196,
      outputTokens: 88,
      cacheReadInputTokens: 2816,
      // The Responses API has no cache-write counter.
      cacheWriteInputTokens: 0,
      durationMs: entries[0]!.durationMs,
      usageBasis: 'PROVIDER_REPORTED',
    });
  });

  it('appends an ok=false entry with provider-reported counters for a mapped error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse({ error: { message: 'rate' }, usage: USAGE_BODY.usage }, 429)) as typeof fetch;
    const capture = captureUsageLines();
    const entries = await runWithUsageContext({ companyId: 'company-1' }, async () => {
      try {
        await makeProvider().generateWithTools!({ messages: [{ role: 'user', text: 'q' }], tools: [], usageTag: 'line.loop' });
      } finally {
        capture.restore();
        globalThis.fetch = originalFetch;
      }
      return drainUsage();
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.ok, false);
    assert.equal(entries[0]!.inputTokens, 196);
    assert.equal(entries[0]!.cacheReadInputTokens, 2816);
    assert.equal(entries[0]!.usageBasis, 'PROVIDER_REPORTED');
    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0]!['ok'], false);
  });

  it('appends an entry even when the successful response carries no usage block', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse({ status: 'completed', output_text: 'ok' })) as typeof fetch;
    const capture = captureUsageLines();
    const entries = await runWithUsageContext({}, async () => {
      try {
        await makeProvider().generateText({ messages: [{ role: 'user', text: 'q' }] });
      } finally {
        capture.restore();
        globalThis.fetch = originalFetch;
      }
      return drainUsage();
    });

    assert.equal(entries.length, 1, 'one call, one row — the meter counts calls, not log lines');
    assert.equal(entries[0]!.inputTokens, 0);
    assert.equal(capture.lines.length, 0);
  });
});


describe('OpenAI no-result accounting', () => {
  it('records a realistic timeout estimate for both text and tool calls on SHARED', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const capture = captureUsageLines();
    try {
      for (const tools of [false, true]) {
        const entries = await runWithUsageContext({ companyId: 'shared' }, async () => {
          const input = { messages: [{ role: 'user' as const, text: 'คำถาม' }], maxTokens: 17 };
          const result = tools ? await makeProvider(1).generateWithTools({ ...input, tools: [] }) : await makeProvider(1).generateText(input);
          assert.equal(result.ok, false);
          if (!result.ok) assert.equal(result.error.code, 'PROVIDER_TIMEOUT');
          return drainUsage();
        });
        assert.equal(entries.length, 1);
        assert.equal(entries[0]!.ok, false);
        assert.equal(entries[0]!.errorCode, 'PROVIDER_TIMEOUT');
        assert.equal(entries[0]!.usageBasis, 'CONSERVATIVE_ESTIMATE');
        assert.ok(entries[0]!.inputTokens > 0 && entries[0]!.inputTokens < 100);
        assert.equal(entries[0]!.outputTokens, 17);
      }
    } finally { globalThis.fetch = originalFetch; capture.restore(); }
  });

  it('preserves an output-limit result for repair while marking its usage unusable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
      output_text: 'partial', usage: USAGE_BODY.usage });
    const capture = captureUsageLines();
    try {
      await runWithUsageContext({}, async () => {
        const result = await makeProvider().generateText({ messages: [{ role: 'user', text: 'q' }] });
        assert.deepEqual(result, { ok: true, text: 'partial', completion: 'output_limit', providerStopReason: 'max_output_tokens', stopReason: 'max_tokens' });
        const [entry] = drainUsage();
        assert.equal(entry!.ok, false);
        assert.equal(entry!.errorCode, 'PROVIDER_OUTPUT_INCOMPLETE');
        assert.equal(entry!.usageBasis, 'PROVIDER_REPORTED');
      });
    } finally { globalThis.fetch = originalFetch; capture.restore(); }
  });
});

it('B1 refuses outputSchema before OpenAI dispatch', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail('unsupported schema must never reach OpenAI'); };
  try {
    const result = await makeProvider().generateText({ messages: [], outputSchema: { name: 'classifier', schema: { type: 'object' } } } as any);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PROVIDER_CONTRACT_UNSUPPORTED');
  } finally { globalThis.fetch = original; }
});
