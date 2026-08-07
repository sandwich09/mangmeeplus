import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TyphoonOcrClient } from './typhoon-ocr.client';

const INPUT = { mimeType: 'image/jpeg' as const, contentBase64: 'aW1nLWJ5dGVz', prompt: 'Return the markdown representation.' };

async function withFetch(mock: unknown, run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe('TyphoonOcrClient', () => {
  it('sends the official request shape: auth bearer, typhoon-ocr model, low-temperature sampling, image data URI', async () => {
    let requestedUrl = '';
    let authHeader = '';
    let sentBody: Record<string, unknown> = {};
    await withFetch(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      requestedUrl = String(url);
      authHeader = init.headers['Authorization'];
      sentBody = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"natural_text":"# ok"}' } }] }) };
    }, async () => {
      const client = new TyphoonOcrClient({ apiKey: 'typhoon-key', timeoutMs: 1000 });
      const result = await client.extract(INPUT);

      assert.ok(result.ok);
      if (result.ok) assert.equal(result.text, '{"natural_text":"# ok"}');
      assert.equal(requestedUrl, 'https://api.opentyphoon.ai/v1/chat/completions');
      assert.equal(authHeader, 'Bearer typhoon-key');
      assert.equal(sentBody['model'], 'typhoon-ocr');
      // Official Typhoon OCR guidance: temperature 0.1, top_p 0.6, repetition_penalty 1.2.
      assert.equal(sentBody['temperature'], 0.1);
      assert.equal(sentBody['top_p'], 0.6);
      assert.equal(sentBody['repetition_penalty'], 1.2);
      const messages = sentBody['messages'] as Array<{ content: Array<Record<string, unknown>> }>;
      assert.equal((messages[0]?.content[0] as { text?: string }).text, INPUT.prompt);
      assert.equal(
        (messages[0]?.content[1] as { image_url?: { url?: string } }).image_url?.url,
        `data:image/jpeg;base64,${INPUT.contentBase64}`,
      );
    });
  });

  it('maps 401/403 to PROVIDER_ACCESS_NOT_READY without leaking key or image bytes', async () => {
    await withFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }), async () => {
      const client = new TyphoonOcrClient({ apiKey: 'typhoon-key', timeoutMs: 1000 });
      const result = await client.extract(INPUT);
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error.code, 'PROVIDER_ACCESS_NOT_READY');
        assert.equal(result.error.retryable, false);
        assert.ok(!result.error.message.includes('typhoon-key'));
        assert.ok(!result.error.message.includes(INPUT.contentBase64));
      }
    });
  });

  it('maps 429 to retryable PROVIDER_THROTTLED', async () => {
    await withFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }), async () => {
      const client = new TyphoonOcrClient({ apiKey: 'typhoon-key', timeoutMs: 1000 });
      const result = await client.extract(INPUT);
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error.code, 'PROVIDER_THROTTLED');
        assert.equal(result.error.retryable, true);
      }
    });
  });

  it('maps 5xx to retryable PROVIDER_UNKNOWN', async () => {
    await withFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }), async () => {
      const client = new TyphoonOcrClient({ apiKey: 'typhoon-key', timeoutMs: 1000 });
      const result = await client.extract(INPUT);
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error.code, 'PROVIDER_UNKNOWN');
        assert.equal(result.error.retryable, true);
      }
    });
  });

  it('maps timeout abort to retryable PROVIDER_TIMEOUT', async () => {
    await withFetch(async () => {
      const err = new Error('aborted');
      err.name = 'TimeoutError';
      throw err;
    }, async () => {
      const client = new TyphoonOcrClient({ apiKey: 'typhoon-key', timeoutMs: 1000 });
      const result = await client.extract(INPUT);
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error.code, 'PROVIDER_TIMEOUT');
        assert.equal(result.error.retryable, true);
      }
    });
  });

  it('treats empty assistant output as PROVIDER_UNKNOWN failure', async () => {
    await withFetch(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '   ' } }] }) }), async () => {
      const client = new TyphoonOcrClient({ apiKey: 'typhoon-key', timeoutMs: 1000 });
      const result = await client.extract(INPUT);
      assert.ok(!result.ok);
      if (!result.ok) assert.equal(result.error.code, 'PROVIDER_UNKNOWN');
    });
  });
});
