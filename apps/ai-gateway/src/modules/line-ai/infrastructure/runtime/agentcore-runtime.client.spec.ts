import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AgentCoreRuntimeClient } from './agentcore-runtime.client';

// Stub AWS creds so BedrockRuntimeClient credential chain resolves without network
const SAVED_KEY = process.env['AWS_ACCESS_KEY_ID'];
const SAVED_SECRET = process.env['AWS_SECRET_ACCESS_KEY'];
const SAVED_TOKEN = process.env['AWS_SESSION_TOKEN'];

before(() => {
  process.env['AWS_ACCESS_KEY_ID'] = 'TESTKEY';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'TESTSECRET';
  delete process.env['AWS_SESSION_TOKEN'];
});

after(() => {
  process.env['AWS_ACCESS_KEY_ID'] = SAVED_KEY;
  process.env['AWS_SECRET_ACCESS_KEY'] = SAVED_SECRET;
  process.env['AWS_SESSION_TOKEN'] = SAVED_TOKEN;
});

function makeConfig(arn = 'arn:aws:bedrock-agentcore:ap-southeast-1:123:runtime/test-runtime') {
  return {
    agentcoreRegion: 'ap-southeast-1',
    agentcoreRuntimeArn: arn,
    agentcoreRuntimeQualifier: 'DEFAULT',
    agentcoreInvokeTimeoutMs: 5000,
    bedrockRegion: 'ap-southeast-1',
  } as any;
}

const validInput = {
  turnId: 'turn-1',
  companyId: 'co-1',
  userId: 'u-1',
  membershipId: 'mem-1',
  branchIds: ['branch-1'],
  locationIds: ['location-1'],
  roles: ['owner'],
  messageText: 'สรุปสต็อก',
  locale: 'th-TH',
  permissions: ['inventory.read'],
  actorDelegations: { 'inventory.list_low_stock': ['signed-delegation'] },
};

const validResult = {
  turnId: 'turn-1',
  replyText: 'สต็อกปัจจุบัน 100 ชิ้น',
  plan: { status: 'ROUTABLE', intents: [] },
  durationMs: 500,
  refused: false,
  sourceRefs: [],
  webLinks: [],
  toolsInvoked: [],
  presentation: { kind: 'answer_cards', cards: [{ text: 'สต็อกปัจจุบัน 100 ชิ้น' }] },
};

describe('AgentCoreRuntimeClient', () => {
  it('throws RUNTIME_NOT_CONFIGURED when ARN is empty', async () => {
    const client = new AgentCoreRuntimeClient(makeConfig(''));
    await assert.rejects(
      () => client.invoke(validInput),
      (err: any) => err.code === 'RUNTIME_NOT_CONFIGURED',
    );
  });

  it('returns parsed result on 200 with valid JSON', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(validResult), { status: 200 }) as any;
    try {
      const client = new AgentCoreRuntimeClient(makeConfig());
      const result = await client.invoke(validInput);
      assert.equal(result.turnId, 'turn-1');
      assert.equal(result.refused, false);
      assert.equal(typeof result.replyText, 'string');
      assert.deepEqual(result.presentation, validResult.presentation);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('serializes authoritative scope fields into the invocation payload', async () => {
    const orig = globalThis.fetch;
    let body = '';
    globalThis.fetch = async (_url: any, init?: RequestInit) => {
      body = String(init?.body ?? '');
      return new Response(JSON.stringify(validResult), { status: 200 }) as any;
    };
    try {
      const client = new AgentCoreRuntimeClient(makeConfig());
      await client.invoke(validInput);
      const payload = JSON.parse(body) as Record<string, unknown>;
      assert.equal(payload['membershipId'], 'mem-1');
      assert.deepEqual(payload['branchIds'], ['branch-1']);
      assert.deepEqual(payload['locationIds'], ['location-1']);
      assert.deepEqual(payload['roles'], ['owner']);
      assert.deepEqual(payload['actorDelegations'], { 'inventory.list_low_stock': ['signed-delegation'] });
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('throws RUNTIME_NOT_FOUND on 404', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response('not found', { status: 404 }) as any;
    try {
      const client = new AgentCoreRuntimeClient(makeConfig());
      await assert.rejects(
        () => client.invoke(validInput),
        (err: any) => err.code === 'RUNTIME_NOT_FOUND',
      );
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('throws THROTTLED on 429', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response('throttled', { status: 429 }) as any;
    try {
      const client = new AgentCoreRuntimeClient(makeConfig());
      await assert.rejects(
        () => client.invoke(validInput),
        (err: any) => err.code === 'THROTTLED',
      );
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('throws INVALID_PAYLOAD on 400', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response('reflected signed-delegation', { status: 400 }) as any;
    try {
      const client = new AgentCoreRuntimeClient(makeConfig());
      await assert.rejects(
        () => client.invoke(validInput),
        (err: any) => err.code === 'INVALID_PAYLOAD' && !err.message.includes('signed-delegation'),
      );
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('throws MALFORMED_RESPONSE when response JSON is missing required fields', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) as any;
    try {
      const client = new AgentCoreRuntimeClient(makeConfig());
      await assert.rejects(
        () => client.invoke(validInput),
        (err: any) => err.code === 'MALFORMED_RESPONSE',
      );
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('throws MALFORMED_RESPONSE for malformed optional presentation', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ...validResult, presentation: { kind: 'answer_cards', cards: [{ title: 'missing text' }] } }), { status: 200 }) as any;
    try {
      const client = new AgentCoreRuntimeClient(makeConfig());
      await assert.rejects(
        () => client.invoke(validInput),
        (err: any) => err.code === 'MALFORMED_RESPONSE',
      );
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('keeps well-formed usage entries and drops malformed ones', async () => {
    const orig = globalThis.fetch;
    const valid = {
      tag: 'line.loop',
      modelId: 'apac.anthropic.claude-sonnet-4-5',
      ok: true,
      inputTokens: 2627,
      outputTokens: 374,
      cacheReadInputTokens: 2210,
      cacheWriteInputTokens: 0,
      durationMs: 1841,
    };
    globalThis.fetch = async () => new Response(JSON.stringify({
      ...validResult,
      usage: [
        valid,
        { ...valid, inputTokens: 'lots' },   // non-numeric counter
        { ...valid, ok: 'yes' },             // non-boolean ok
        { ...valid, durationMs: Number.NaN },// NaN survives typeof 'number'
        null,
        'not-an-entry',
        { ...valid, tag: 'extra', junk: 'dropped' },
      ],
    }), { status: 200 }) as any;
    try {
      const client = new AgentCoreRuntimeClient(makeConfig());
      const result = await client.invoke(validInput);
      assert.equal(result.usage?.length, 2);
      assert.deepEqual(result.usage?.[0], valid);
      // Only contract fields cross the boundary.
      assert.deepEqual(Object.keys(result.usage![1]!).sort(), Object.keys(valid).sort());
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('leaves usage absent when the artifact reports none, or reports a non-array', async () => {
    const orig = globalThis.fetch;
    try {
      for (const body of [validResult, { ...validResult, usage: { tag: 'x' } }]) {
        globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 }) as any;
        const result = await new AgentCoreRuntimeClient(makeConfig()).invoke(validInput);
        assert.ok(!('usage' in result), 'an older artifact must degrade to no rows, never to junk');
        assert.equal(result.replyText, validResult.replyText);
      }
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('keeps bounded runtime evidence and drops malformed optional evidence', async () => {
    const orig = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(JSON.stringify({
        ...validResult,
        refusalReason: 'mutation_blocked',
        errorCode: 'SAFE_ERROR',
        runtimeIdentity: {
          sourceCommit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64),
          serviceVersion: 'candidate-a', contractVersion: 1,
        },
        stageDurationsMs: { bodyReadMs: 1, orchestrationMs: 12, runtimeTotalMs: 14, rawPrompt: 'must-drop' },
        modelCallCount: 2,
      }), { status: 200 }) as any;
      const result = await new AgentCoreRuntimeClient(makeConfig()).invoke(validInput);
      assert.equal(result.runtimeIdentity?.artifactSha256, 'b'.repeat(64));
      assert.equal(result.runtimeBinding?.qualifier, 'DEFAULT');
      assert.match(result.runtimeBinding?.runtimeArnHash ?? '', /^[0-9a-f]{16}$/);
      assert.equal(result.stageDurationsMs?.orchestrationMs, 12);
      assert.ok(!('rawPrompt' in (result.stageDurationsMs as any)));
      assert.equal(result.modelCallCount, 2);
      assert.equal(result.refusalReason, 'mutation_blocked');
      assert.equal(result.errorCode, 'SAFE_ERROR');

      globalThis.fetch = async () => new Response(JSON.stringify({
        ...validResult,
        runtimeIdentity: { sourceCommit: 'not-a-sha', artifactSha256: 'secret' },
        stageDurationsMs: { orchestrationMs: -1 },
        modelCallCount: 1000,
        refusalReason: 'invented_reason',
        errorCode: 'unsafe error text',
      }), { status: 200 }) as any;
      const malformed = await new AgentCoreRuntimeClient(makeConfig()).invoke(validInput);
      assert.equal(malformed.runtimeIdentity, undefined);
      assert.equal(malformed.stageDurationsMs?.orchestrationMs, undefined);
      assert.equal(malformed.modelCallCount, undefined);
      assert.equal(malformed.refusalReason, undefined);
      assert.equal(malformed.errorCode, undefined);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('aborts the in-flight HTTP request and carries binding evidence on timeout', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async (_url: any, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    try {
      const config = { ...makeConfig(), agentcoreInvokeTimeoutMs: 10 };
      await assert.rejects(
        () => new AgentCoreRuntimeClient(config).invoke(validInput),
        (err: any) => err.code === 'TIMEOUT'
          && err.runtimeBinding?.qualifier === 'DEFAULT'
          && typeof err.stageDurationsMs?.agentcoreHttpMs === 'number',
      );
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('extracts runtime id from ARN correctly (last path segment)', async () => {
    const orig = globalThis.fetch;
    let capturedUrl = '';
    globalThis.fetch = async (url: any) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(validResult), { status: 200 }) as any;
    };
    try {
      const client = new AgentCoreRuntimeClient(makeConfig('arn:aws:bedrock-agentcore:ap-southeast-1:123:runtime/my-runtime-id'));
      await client.invoke(validInput);
      assert.ok(capturedUrl.includes('my-runtime-id'), `URL should contain runtime id, got: ${capturedUrl}`);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
