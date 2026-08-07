import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineMessagingAdapter } from './line-messaging.adapter';

describe('LineMessagingAdapter.pushTextMessage', () => {
  it('surfaces Retry-After seconds on HTTP 429 push failures', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('', { status: 429, headers: { 'retry-after': '45' } }) as any;
      const result = await new LineMessagingAdapter().pushTextMessage('token', 'U1', 'hello', '11111111-1111-5111-8111-111111111111');
      assert.deepEqual(result, { ok: false, error: 'line_api_429', retryAfterSeconds: 45 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps HTTP 401 push failures to a terminal token error', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('', { status: 401 }) as any;
      const result = await new LineMessagingAdapter().pushTextMessage('token', 'U1', 'hello', '11111111-1111-5111-8111-111111111111');
      assert.deepEqual(result, { ok: false, error: 'invalid_access_token' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('treats a 409 with LINE accepted-request evidence as already sent', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('', {
        status: 409,
        headers: { 'x-line-accepted-request-id': 'accepted-request-1' },
      }) as any;
      const result = await new LineMessagingAdapter().pushTextMessage('token', 'U1', 'hello', '11111111-1111-5111-8111-111111111111');
      assert.deepEqual(result, { ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps a bare 409 as a failure', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('', { status: 409 }) as any;
      const result = await new LineMessagingAdapter().pushTextMessage('token', 'U1', 'hello', '11111111-1111-5111-8111-111111111111');
      assert.deepEqual(result, { ok: false, error: 'line_api_409' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('LineMessagingAdapter.getProfile', () => {
  it('never writes the raw provider user id to failure logs', async () => {
    const originalFetch = globalThis.fetch;
    const warnings: unknown[] = [];
    try {
      globalThis.fetch = (async () => { throw new Error('network down'); }) as any;
      const adapter = new LineMessagingAdapter();
      (adapter as any).logger = { warn: (entry: unknown) => warnings.push(entry) };

      assert.equal(await adapter.getProfile('token', 'U-sensitive-provider-id'), null);
      assert.deepEqual(warnings, [{ msg: 'LINE profile fetch failed' }]);
      assert.equal(JSON.stringify(warnings).includes('U-sensitive-provider-id'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('LineMessagingAdapter.verifyChannelSecret', () => {
  it('returns true on 200 and revokes the probe token immediately', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: string }> = [];
    try {
      globalThis.fetch = (async (input: any, init: any) => {
        calls.push({ url: String(input), body: String(init?.body) });
        if (String(input).endsWith('/v2/oauth/accessToken')) {
          return new Response(JSON.stringify({ access_token: 'probe-token' }), { status: 200 });
        }
        return new Response('', { status: 200 });
      }) as any;
      assert.equal(await new LineMessagingAdapter().verifyChannelSecret('1234567890', 'secret'), true);
      assert.equal(calls.length, 2);
      assert.ok(calls[0].body.includes('grant_type=client_credentials'));
      assert.equal(calls[1].url, 'https://api.line.me/v2/oauth/revoke');
      assert.ok(calls[1].body.includes('probe-token'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns false only on LINE 400; null on 429, 5xx and network failure (fail-open signals)', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 400 })) as any;
      assert.equal(await new LineMessagingAdapter().verifyChannelSecret('1234567890', 'wrong'), false);
      // A rate limit is not a rejection of the pair — blocking a correct secret
      // here would fail a legitimate connect with "secret does not match".
      globalThis.fetch = (async () => new Response('', { status: 429 })) as any;
      assert.equal(await new LineMessagingAdapter().verifyChannelSecret('1234567890', 'secret'), null);
      globalThis.fetch = (async () => new Response('', { status: 500 })) as any;
      assert.equal(await new LineMessagingAdapter().verifyChannelSecret('1234567890', 'secret'), null);
      globalThis.fetch = (async () => { throw new Error('network down'); }) as any;
      assert.equal(await new LineMessagingAdapter().verifyChannelSecret('1234567890', 'secret'), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('LineMessagingAdapter.replyTextMessage', () => {
  it('posts the reply token and text to the LINE Reply API', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        assert.equal(input, 'https://api.line.me/v2/bot/message/reply');
        assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer token');
        assert.deepEqual(JSON.parse(String(init?.body)), {
          replyToken: 'reply-1',
          messages: [{ type: 'text', text: 'hello' }],
        });
        return new Response('', { status: 200 }) as any;
      };
      assert.deepEqual(await new LineMessagingAdapter().replyTextMessage('token', 'reply-1', 'hello'), { ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('classifies an HTTP 400 reply token as unusable', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('', { status: 400 }) as any;
      assert.deepEqual(
        await new LineMessagingAdapter().replyTextMessage('token', 'reply-1', 'hello'),
        { ok: false, error: 'token_unusable' },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps HTTP 401 as the terminal access-token error', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('', { status: 401 }) as any;
      assert.deepEqual(
        await new LineMessagingAdapter().replyTextMessage('token', 'reply-1', 'hello'),
        { ok: false, error: 'invalid_access_token' },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves retryable 429 and 5xx error shapes for caller fallback', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('', { status: 429, headers: { 'retry-after': '30' } }) as any;
      assert.deepEqual(
        await new LineMessagingAdapter().replyTextMessage('token', 'reply-1', 'hello'),
        { ok: false, error: 'line_api_429', retryAfterSeconds: 30 },
      );
      globalThis.fetch = async () => new Response('', { status: 503 }) as any;
      assert.deepEqual(
        await new LineMessagingAdapter().replyTextMessage('token', 'reply-2', 'hello'),
        { ok: false, error: 'line_api_503' },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
