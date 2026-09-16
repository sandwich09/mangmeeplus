import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PostmarkClient, PostmarkSendError, postmarkFailure } from './postmark.client';
import { parsePostmarkEvent, postmarkEventKey } from '../application/postmark-events.service';

const id = '22222222-2222-4222-8222-222222222222';
const config = { postmarkServerToken: 'POSTMARK_API_TEST', isLocal: true } as any;

describe('Postmark cloud environment isolation before dispatch', () => {
  const cloudConfig = (stage = 'uat') => ({
    isLocal: false, emailProvider: 'postmark', deploymentIdentity: { targetEnvironment: stage },
    postmarkServerToken: 'SYNTHETIC_SERVER_TOKEN', postmarkServerId: stage === 'uat' ? 123 : 456,
    postmarkMessageStream: 'outbound', postmarkFromName: 'Mangmee Plus',
    postmarkFromAddress: stage === 'uat' ? 'developer@mangmeeplus.com' : 'contact@mangmeeplus.com',
    sesWebBaseUrl: stage === 'uat' ? 'https://uat.mangmeeplus.com' : 'https://mangmeeplus.com',
    postmarkUatAllowedRecipients: ['tester@example.test'],
  });
  const message = (c: ReturnType<typeof cloudConfig>) => ({
    From: `${c.postmarkFromName} <${c.postmarkFromAddress}>`, To: 'tester@example.test',
    MessageStream: 'outbound', Subject: 'Verify account',
  });
  function fixture(c = cloudConfig(), server: object = { ID: c.postmarkServerId, DeliveryType: 'Live' }, stream: object = {
    ID: 'outbound', ServerID: c.postmarkServerId, MessageStreamType: 'Transactional', ArchivedAt: null,
  }) {
    const calls: { method: string; path: string; body?: any }[] = [];
    const client = new PostmarkClient(c as any, (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({ method: init.method!, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(path === '/server' ? server : path.startsWith('/message-streams/') ? stream :
        { ErrorCode: 0, MessageID: id, SubmittedAt: '2026-09-15T00:00:00Z' }));
    }) as any);
    return { client, calls };
  }
  it('checks exact live server and active transactional stream before every UAT/Production POST', async () => {
    for (const stage of ['uat', 'production']) {
      const c = cloudConfig(stage), body = message(c), { client, calls } = fixture(c);
      await client.send(body);
      await client.send(body);
      assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
        'GET /server', 'GET /message-streams/outbound', 'POST /email',
        'GET /server', 'GET /message-streams/outbound', 'POST /email',
      ]);
      assert.equal(calls[2].body.Subject, stage === 'uat' ? '[UAT] Verify account' : 'Verify account');
      assert.equal(calls[2].body.To, 'tester@example.test');
      assert.equal(body.Subject, 'Verify account');
    }
  });
  it('refuses wrong deployment, provider, sender, origin, stream or recipient before any provider request', async () => {
    const mutations = [
      (c: any, b: any) => { c.emailProvider = 'disabled'; },
      (c: any, b: any) => { c.deploymentIdentity = undefined; },
      (c: any, b: any) => { c.deploymentIdentity.targetEnvironment = 'local'; },
      (c: any, b: any) => { c.postmarkFromAddress = 'contact@mangmeeplus.com'; b.From = `Mangmee Plus <${c.postmarkFromAddress}>`; },
      (c: any, b: any) => { b.From = 'Other <developer@mangmeeplus.com>'; },
      (c: any, b: any) => { b.MessageStream = 'another'; },
      ...['https://mangmeeplus.com', 'http://uat.mangmeeplus.com', 'https://uat.mangmeeplus.com.evil.test',
        'https://uat.mangmeeplus.com/path', 'https://uat.mangmeeplus.com/?x=1', 'https://user@uat.mangmeeplus.com', 'invalid'].map(origin =>
        (c: any, b: any) => { c.sesWebBaseUrl = origin; }),
      ...['customer@example.test', 'tester@example.test.evil', 'Tester <tester@example.test>',
        'tester@example.test,customer@example.test', 'tester@example.test;customer@example.test'].map(to =>
        (c: any, b: any) => { b.To = to; }),
      (c: any, b: any) => { c.postmarkUatAllowedRecipients = []; },
      (c: any, b: any) => { b.Cc = 'tester@example.test'; },
      (c: any, b: any) => { b.Bcc = 'tester@example.test'; },
    ];
    for (const mutate of mutations) {
      const c = cloudConfig(), body = message(c); mutate(c, body);
      const { client, calls } = fixture(c);
      await assert.rejects(client.send(body), (error: any) => ['CONFIG', 'PERMANENT'].includes(error.kind));
      assert.equal(calls.length, 0);
    }
  });
  it('normalizes an exact UAT recipient without rewriting it, and does not apply that list to Production', async () => {
    const c = cloudConfig(), { client, calls } = fixture(c);
    await client.send({ ...message(c), To: 'Tester@Example.Test' });
    assert.equal(calls[2].body.To, 'Tester@Example.Test');
    const prod = cloudConfig('production'), other = fixture(prod);
    await other.client.send({ ...message(prod), To: 'customer@example.test' });
    assert.equal(other.calls[2].body.To, 'customer@example.test');
  });
  it('unknown, foreign, sandbox, archived and non-transactional native facts never allow POST', async () => {
    for (const server of [{ ID: 456, DeliveryType: 'Live' }, { ID: 123 }, { ID: 123, DeliveryType: 'Sandbox' }]) {
      const { client, calls } = fixture(cloudConfig(), server);
      await assert.rejects(client.send(message(cloudConfig())), (error: any) => error.kind === 'CONFIG');
      assert.ok(calls.every(call => call.method === 'GET'));
    }
    for (const change of [{ ID: 'other' }, { ServerID: 456 }, { MessageStreamType: 'Broadcasts' },
      { ArchivedAt: '2026-09-15T00:00:00Z' }, { ArchivedAt: undefined }, { MessageStreamType: undefined }]) {
      const { client, calls } = fixture(cloudConfig(), { ID: 123, DeliveryType: 'Live' }, {
        ID: 'outbound', ServerID: 123, MessageStreamType: 'Transactional', ArchivedAt: null, ...change,
      });
      await assert.rejects(client.send(message(cloudConfig())), (error: any) => error.kind === 'CONFIG');
      assert.ok(calls.every(call => call.method === 'GET'));
    }
  });
  it('readiness network failure stays a sanitized config failure without an uncertain email POST', async () => {
    const methods: string[] = [];
    const client = new PostmarkClient(cloudConfig() as any, (async (_: string, init: RequestInit) => {
      methods.push(init.method!); throw Error('SYNTHETIC_SERVER_TOKEN recipient private');
    }) as any);
    await assert.rejects(client.send(message(cloudConfig())), (error: any) => error.kind === 'CONFIG' && error.message === 'postmark.readiness_unavailable');
    assert.deepEqual(methods, ['GET']);
  });
});
describe('Postmark transport and callback contract', () => {
  it('inspects only the configured server and stream through GET without returning native secrets', async () => {
    const calls: string[] = [];
    const client = new PostmarkClient({ ...config, postmarkServerId: 123, postmarkMessageStream: 'outbound' }, (async (url: string, init: RequestInit) => {
      calls.push(url); assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
      return new Response(JSON.stringify(url.endsWith('/server')
        ? { ID: 123, DeliveryType: 'Sandbox', ApiTokens: ['PRIVATE_TOKEN'] }
        : { ID: 'outbound', ServerID: 123, MessageStreamType: 'Transactional', ArchivedAt: null, Name: 'PRIVATE_NAME' }));
    }) as any);
    assert.deepEqual(await client.inspectConfiguration(), { server: 'MATCHED', stream: 'MATCHED', mode: 'SANDBOX', transactional: true, archived: false });
    assert.deepEqual(calls, ['https://api.postmarkapp.com/server', 'https://api.postmarkapp.com/message-streams/outbound']);
  });
  it('stops native inspection at missing configuration or a foreign server and keeps failures sanitized', async () => {
    let calls = 0;
    const client = new PostmarkClient({ ...config, postmarkServerId: 123, postmarkMessageStream: 'outbound' }, (async () => {
      calls++; return new Response(JSON.stringify({ ID: 456, DeliveryType: 'Live', ApiTokens: ['PRIVATE_TOKEN'] }));
    }) as any);
    assert.deepEqual(await client.inspectConfiguration(), { server: 'MISMATCH', stream: 'UNKNOWN', mode: 'UNKNOWN', transactional: null, archived: null });
    assert.equal(calls, 1);
    await assert.rejects(new PostmarkClient(config, (async () => assert.fail('No native call without server/stream')) as any).inspectConfiguration(), (error: any) => error.kind === 'CONFIG');
    const unavailable = new PostmarkClient({ ...config, postmarkServerId: 123, postmarkMessageStream: 'outbound' }, (async () => {
      throw Error('PRIVATE_TOKEN');
    }) as any);
    await assert.rejects(unavailable.inspectConfiguration(), (error: any) => error.message === 'postmark.transport_unknown');
  });
  it('uses the fixed API with redirect refusal, timeout and explicit authentication; validates accepted response', async () => {
    const calls: any[] = [];
    const client = new PostmarkClient(config, (async (...args: any[]) => {
      calls.push(args); return new Response(JSON.stringify({ ErrorCode: 0, MessageID: id, SubmittedAt: '2026-09-12T00:00:00Z' }));
    }) as any);
    assert.equal((await client.send({ MessageStream: 'outbound' })).messageId, id);
    assert.equal(calls[0][0], 'https://api.postmarkapp.com/email');
    assert.equal(calls[0][1].redirect, 'error');
    assert.equal(calls[0][1].headers['X-Postmark-Server-Token'], 'POSTMARK_API_TEST');
  });
  for (const body of [{}, { ErrorCode: 0, MessageID: id }, { ErrorCode: 0, MessageID: 'x', SubmittedAt: 'today' }]) {
    it(`keeps malformed success UNKNOWN (${JSON.stringify(body)})`, async () => {
      const client = new PostmarkClient(config, (async () => new Response(JSON.stringify(body))) as any);
      await assert.rejects(client.send({}), (e: any) => e instanceof PostmarkSendError && e.kind === 'UNKNOWN');
    });
  }
  it('does not expose provider body or tokens on transport failure', async () => {
    const client = new PostmarkClient(config, (async () => { throw new Error('secret credential and body'); }) as any);
    await assert.rejects(client.send({}), (e: any) => e.message === 'postmark.transport_unknown');
  });
  it('rejects the provider validation token outside local execution', async () => {
    const client = new PostmarkClient({ ...config, isLocal: false }, (async () => { assert.fail('No network'); }) as any);
    await assert.rejects(client.send({}), (e: any) => e.kind === 'CONFIG');
  });
  for (const [status, code, kind] of [[401, 10, 'CONFIG'], [422, 406, 'SUPPRESSED'], [422, 413, 'CONFIG'], [413, 0, 'PERMANENT'], [429, 0, 'RETRY'], [503, 0, 'UNKNOWN']]) {
    it(`classifies HTTP ${status} / ErrorCode ${code}`, () => assert.equal(postmarkFailure(status as number, code as number, null).kind, kind));
  }
  it('honors a bounded Retry-After without inventing a header', () => {
    assert.equal(postmarkFailure(429, 0, '600').retryAfterSeconds, 600);
    assert.equal(postmarkFailure(429, 0, 'invalid').retryAfterSeconds, 60);
  });
  for (const [status, kind] of [[401, 'CONFIG'], [413, 'PERMANENT'], [429, 'RETRY'], [502, 'UNKNOWN']] as const) {
    it(`classifies HTTP ${status} even when a proxy returns HTML`, async () => {
      const client = new PostmarkClient(config, (async () => new Response('<html>upstream error</html>', { status })) as any);
      await assert.rejects(client.send({}), (error: any) => error.kind === kind && !error.message.includes('html'));
    });
  }
  it('cannot treat an incomplete or malformed lookup as evidence of non-delivery', async () => {
    for (const body of [{ TotalCount: 1, Messages: [] }, { TotalCount: -1, Messages: [] }, { TotalCount: 0.5, Messages: [] },
      { TotalCount: 101, Messages: [] }, { Messages: [] }]) {
      const client = new PostmarkClient(config, (async () => new Response(JSON.stringify(body))) as any);
      await assert.rejects(client.findAttempt(id, 'outbound'), (error: any) => error.kind === 'UNKNOWN' && error.code === 'lookup_incomplete');
    }
  });
  it('sanitizes callbacks and keeps delivery distinct from a complaint for the same message', () => {
    const base = { RecordType: 'Delivery', ServerID: 42, MessageStream: 'outbound', MessageID: id,
      Recipient: 'Owner@example.test', DeliveredAt: '2026-09-12T00:00:00Z', Content: 'private token', Subject: 'private' };
    const delivery = parsePostmarkEvent(base);
    assert.equal(delivery.recipient, 'owner@example.test');
    assert.doesNotMatch(JSON.stringify(delivery), /private|Content|Subject/);
    const complaint = parsePostmarkEvent({ ...base, RecordType: 'SpamComplaint', Email: base.Recipient, BouncedAt: base.DeliveredAt, ID: 3 });
    assert.equal(complaint.suppress, true);
    assert.notEqual(postmarkEventKey(delivery), postmarkEventKey(complaint));
    assert.equal(postmarkEventKey(delivery), postmarkEventKey(parsePostmarkEvent(base)));
  });
  it('refuses wrong record types and malformed provider identities', () => {
    for (const value of [null, [], { RecordType: 'Open' }, { RecordType: 'Delivery', ServerID: '42' }]) assert.throws(() => parsePostmarkEvent(value));
  });
});
