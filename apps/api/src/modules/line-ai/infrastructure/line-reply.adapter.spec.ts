import { lineMessagingCredentialsFixture } from '../../../common/config/line-messaging-credentials.fixture';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineReplyAdapter, linePushRetryKey, parseOutcomeMessages, repairLegacyOutcomePreview } from './line-reply.adapter';
import { buildLineAssistantTextCardMessage } from '../domain/logic/line-business-card.logic';
import { lineMessagePreview } from '../domain/logic/line-message-preview.logic';
import { buildCompanyPickerMessage, buildPendingApprovalCard, buildStaffMainMenu } from '../domain/logic/line-staff-menu.logic';

describe('LineReplyAdapter rich payload delivery', () => {
  it('sends real company IDs unchanged in picker actions on reply and push', async () => {
    const originalFetch = globalThis.fetch;
    const ids = ['cmvc8kuzi05m0uqk1sw21svk5', '550e8400-e29b-41d4-a716-446655440000'];
    const picker = buildCompanyPickerMessage(ids.map(companyId => ({ companyId, companyName: 'ร้านทดสอบ', stateLabel: 'หมดอายุ' })));
    const bodies: any[] = [];
    try {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('', { status: 200 });
      }) as typeof fetch;
      const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'synthetic' } as any), {} as any);
      assert.equal(await adapter.sendReply('token', [picker]), 'ok');
      assert.equal(await adapter.sendPush('synthetic-user', [picker], 'picker-retry'), 'ok');
      assert.equal(bodies.length, 2);
      for (const body of bodies) {
        assert.deepEqual(body.messages[0].contents.contents.map((bubble: any) => [bubble.footer.contents[0].action.data, bubble.footer.contents[0].action.displayText]),
          ids.map((id, index) => [`action=company-select&companyId=${id}`, `บริษัท ${index + 1} · ร้านทดสอบ`]));
      }
    } finally { globalThis.fetch = originalFetch; }
  });

  it('keeps an HTTPS image in the saved outcome and the LINE reply', async () => {
    const image = { type: 'image' as const, originalContentUrl: 'https://app.example.test/welcome.png', previewImageUrl: 'https://app.example.test/welcome.png' };
    assert.deepEqual(parseOutcomeMessages([image]), [image]);
    assert.equal(parseOutcomeMessages([{ ...image, previewImageUrl: 'http://app.example.test/welcome.png' }]), null);
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        assert.deepEqual(JSON.parse(String(init?.body)).messages, [image]);
        return new Response('', { status: 200 });
      }) as typeof fetch;
      const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'synthetic' } as any), {} as any);
      assert.equal(await adapter.sendReply('reply-token', [image]), 'ok');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('accepts Thai receipt previews with emoji without losing the full card or splitting a surrogate', () => {
    for (const text of ['🧾📋' + 'ก'.repeat(398), 'ก'.repeat(398) + '🧾ต่อท้าย', 'ข้อมูล'.repeat(120) + ' 2,409.70 บาท']) {
      const card = buildLineAssistantTextCardMessage(text, 'https://app.example.test', 'c1');
      assert.equal(card.type, 'flex');
      if (card.type !== 'flex') throw new Error('expected card');
      assert.ok(card.altText.length <= 400);
      assert.equal(card.altText, lineMessagePreview(text));
      assert.doesNotMatch(card.altText, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
      assert.ok(JSON.stringify(card.contents).includes(text), 'full visible receipt detail remains');
      assert.ok(parseOutcomeMessages(JSON.parse(JSON.stringify([card]))));
    }
  });

  it('repairs only the historical preview overflow and keeps strict parsing fail-closed', () => {
    const full = '🧾📋' + 'ก'.repeat(398);
    assert.equal(Array.from(full).length, 400);
    assert.equal(full.length, 402);
    const message = { type: 'flex', altText: full, canonicalText: full + ' รายละเอียดครบ', contents: { type: 'bubble' } };
    assert.equal(parseOutcomeMessages([message]), null);
    const repaired = repairLegacyOutcomePreview([message]);
    assert.deepEqual(repaired, [{ ...message, altText: lineMessagePreview(full) }]);
    assert.equal(message.altText, full, 'do not mutate stored input before CAS');
    for (const invalid of [{ ...message, altText: 'ก'.repeat(401) }, { ...message, canonicalText: 3 }, { ...message, contents: [] }]) {
      assert.equal(repairLegacyOutcomePreview([invalid]), null);
    }
  });
  it('keeps complete fallback text in durable replay but strips it from reply and push provider payloads', async () => {
    const originalFetch = globalThis.fetch;
    const canonicalText = 'รายละเอียด'.repeat(80) + ' เปิดดูรายการ https://app.example.test/companies/c/expenses/e';
    const message = { type: 'flex' as const, altText: 'สรุป', canonicalText, contents: { type: 'bubble' } };
    const bodies: any[] = [];
    try {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body))); return new Response('', { status: 200 });
      }) as typeof fetch;
      assert.deepEqual(parseOutcomeMessages(JSON.parse(JSON.stringify([message]))), [message]);
      const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'synthetic' } as any), { lineMessagingChannelAccessToken: 'synthetic' } as any);
      await adapter.sendReply('token', [message]);
      await adapter.sendPush('U-test', [message], 'operation');
      assert.ok(bodies.every((body) => !Object.hasOwn(body.messages[0], 'canonicalText')));
      assert.equal(message.canonicalText, canonicalText);
      assert.equal(parseOutcomeMessages([{ ...message, canonicalText: 3 }]), null);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('sends Quick Reply and Flex messages without flattening the LINE payload', async () => {
    const originalFetch = globalThis.fetch;
    let signal: AbortSignal | null | undefined;
    try {
      globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
        signal = init?.signal;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.replyToken, 'reply-token');
        assert.equal(body.messages[0].type, 'flex');
        assert.equal(body.messages[0].quickReply.items[0].action.type, 'message');
        assert.equal(body.messages[1].type, 'flex');
        return new Response('', { status: 200 });
      }) as typeof fetch;
      const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'secret' } as any), { lineMessagingChannelAccessToken: 'secret' } as any);
      const context = { displayName: 'พิม', roleLabel: 'แอดมิน', branchScopeLabel: 'ทุกสาขา', companyId: 'company-1', webBaseUrl: 'https://app.example.com', permissions: [], entitledFeatureKeys: null };
      assert.equal(await adapter.sendReply('reply-token', [buildStaffMainMenu(context), buildPendingApprovalCard(context)]), 'ok');
      assert.ok(signal instanceof AbortSignal, 'LINE delivery must be time-bounded');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('LineReplyAdapter 400 discrimination (§14.3 Flex failure fallback)', () => {
  const FLEX = { type: 'flex' as const, altText: 'ยอดขายเดือนนี้ 125,000 บาท', contents: { type: 'bubble' } };
  const TEXT = { type: 'text' as const, text: 'ยอดขายเดือนนี้ 125,000 บาท' };
  const INVALID_TOKEN = JSON.stringify({ message: 'Invalid reply token' });
  const BAD_FLEX = JSON.stringify({
    message: 'The request body has 1 error(s)',
    details: [{ message: 'may not be empty', property: '/messages/0/contents/body/contents' }],
  });

  async function post(kind: 'reply' | 'push', messages: any[], status: number, body: string) {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
      const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'secret' } as any), { lineMessagingChannelAccessToken: 'secret' } as any);
      return await (kind === 'reply' ? adapter.sendReply('reply-token', messages) : adapter.sendPush('U1', messages));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it('reports a rejected Flex BODY as failed_flex, so the retry can change the payload', async () => {
    assert.equal(await post('reply', [FLEX], 400, BAD_FLEX), 'failed_flex');
    // Mixed payloads count: one unrenderable card fails the whole reply.
    assert.equal(await post('reply', [TEXT, FLEX], 400, BAD_FLEX), 'failed_flex');
  });

  it('keeps an expired reply token as failed_token even when the payload carries Flex', async () => {
    // The push fallback is the RIGHT recovery here — the card is fine, the token is stale. Downgrading
    // this to text would cost a card for no reason.
    assert.equal(await post('reply', [FLEX], 400, INVALID_TOKEN), 'failed_token');
  });

  it('reports push Flex body rejection, including a mixed payload, as failed_flex', async () => {
    assert.equal(await post('push', [FLEX], 400, BAD_FLEX), 'failed_flex');
    assert.equal(await post('push', [TEXT, FLEX], 400, BAD_FLEX), 'failed_flex');
  });

  it('keeps other reply and push failures unchanged', async () => {
    assert.equal(await post('reply', [TEXT], 400, BAD_FLEX), 'failed_token', 'no Flex in the payload');
    assert.equal(await post('push', [TEXT], 400, BAD_FLEX), 'failed_permanent', 'no Flex in the payload');
    assert.equal(await post('push', [FLEX], 400, INVALID_TOKEN), 'failed_permanent', 'not a message body rejection');
    assert.equal(await post('push', [FLEX], 403, BAD_FLEX), 'failed_permanent', 'only 400 is a body rejection');
    assert.equal(await post('push', [FLEX], 429, BAD_FLEX), 'failed_other');
    assert.equal(await post('push', [FLEX], 500, BAD_FLEX), 'failed_other');
    assert.equal(await post('reply', [FLEX], 500, ''), 'failed_other', 'only 400 is a body rejection');
  });
});

describe('LINE push delivery retry identity', () => {
  it('reuses the first push key and exact bytes after accepted response loss, treating 409 as accepted', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; headers: Headers; body: string }> = [];
    try {
      globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body) });
        if (calls.length === 1) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
        return new Response('', { status: 409, headers: { 'x-line-accepted-request-id': 'accepted-original' } });
      }) as typeof fetch;
      const messages = [{ type: 'text' as const, text: 'เก็บรูปและร่างแล้ว ยังไม่ยืนยันรายการ' }];
      const first = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'secret' } as any), { lineMessagingChannelAccessToken: 'secret' } as any);
      assert.equal(await first.sendPush('U-recipient', messages, 'receipt-event'), 'failed_other');
      const afterRestart = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'secret' } as any), { lineMessagingChannelAccessToken: 'secret' } as any);
      assert.equal(await afterRestart.sendPush('U-recipient', messages, 'receipt-event'), 'ok');
      const key = calls[0]!.headers.get('X-Line-Retry-Key');
      assert.match(key!, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      assert.equal(calls[1]!.headers.get('X-Line-Retry-Key'), key);
      assert.equal(calls[1]!.body, calls[0]!.body);
      await afterRestart.sendReply('token', messages);
      assert.equal(calls[2]!.headers.has('X-Line-Retry-Key'), false, 'reply does not support retry headers');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('sends every web link outside LINE while the retry key and the caller payload keep the plain bytes (R-B1)', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ key: string | null; body: string }> = [];
    try {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        calls.push({ key: new Headers(init?.headers).get('X-Line-Retry-Key'), body: String(init?.body) });
        return new Response('', { status: 200 });
      }) as typeof fetch;
      const messages = [
        { type: 'text' as const, text: 'ดูแพ็กเกจ https://app.example.test/companies/c/billing' },
        { type: 'flex' as const, altText: 'การ์ด', canonicalText: 'ดู https://app.example.test/companies/c/billing', contents: { type: 'bubble', footer: { type: 'box', contents: [
          { type: 'button', action: { type: 'uri', label: 'เปิด', uri: 'https://app.example.test/companies/c/billing?channel=line' } },
        ] } } },
        { type: 'image' as const, originalContentUrl: 'https://app.example.test/a.png', previewImageUrl: 'https://app.example.test/a.png' },
      ];
      const snapshot = structuredClone(messages);
      const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'secret' } as any), {} as any);
      await adapter.sendPush('U-recipient', messages, 'op-1');
      await adapter.sendPush('U-recipient', messages, 'op-1');
      assert.deepEqual(messages, snapshot);
      assert.equal(calls[0]!.key, linePushRetryKey('op-1', 'U-recipient', snapshot));
      assert.equal(calls[1]!.body, calls[0]!.body);
      const wire = JSON.parse(calls[0]!.body).messages;
      assert.equal(wire[0].text, 'ดูแพ็กเกจ https://app.example.test/companies/c/billing?openExternalBrowser=1');
      assert.equal(Object.hasOwn(wire[1], 'canonicalText'), false);
      assert.equal(wire[1].contents.footer.contents[0].action.uri, 'https://app.example.test/companies/c/billing?channel=line&openExternalBrowser=1');
      assert.deepEqual(wire[2], snapshot[2]);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('keeps its identity across JSONB key ordering but separates other recipients and changed payloads', () => {
    const original = [{ type: 'flex' as const, altText: 'saved', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } } }];
    const fromJsonb = [{ contents: { body: { contents: [], layout: 'vertical', type: 'box' }, type: 'bubble' }, altText: 'saved', type: 'flex' as const }];
    assert.equal(linePushRetryKey('operation', 'U1', original), linePushRetryKey('operation', 'U1', fromJsonb));
    assert.notEqual(linePushRetryKey('operation', 'U1', original), linePushRetryKey('operation', 'U2', original));
    assert.notEqual(linePushRetryKey('operation', 'U1', original), linePushRetryKey('operation', 'U1', [{ type: 'text', text: 'other facts' }]));
  });

  it('keeps transient/unknown acceptance distinct from permanent refusal and logs no raw bodies', async () => {
    const originalFetch = globalThis.fetch;
    const entries: unknown[] = [];
    try {
      const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'secret' } as any), { lineMessagingChannelAccessToken: 'secret' } as any);
      (adapter as any).logger = { warn: (entry: unknown) => entries.push(entry), error: (entry: unknown) => entries.push(entry) };
      for (const status of [408, 429, 500, 503]) {
        globalThis.fetch = (async () => new Response('raw-receipt private-token', { status })) as typeof fetch;
        assert.equal(await adapter.sendPush('U1', [{ type: 'text', text: 'ok' }], 'event'), 'failed_other');
      }
      for (const status of [400, 401, 403, 404, 409]) {
        globalThis.fetch = (async () => new Response('raw-receipt private-token', { status })) as typeof fetch;
        assert.equal(await adapter.sendPush('U1', [{ type: 'text', text: 'ok' }], 'event'), 'failed_permanent');
      }
      globalThis.fetch = (async () => { throw Object.assign(new Error('Prisma raw receipt secret'), { code: 'P2002', cause: { code: 'ECONNRESET' } }); }) as typeof fetch;
      await adapter.sendPush('U1', [{ type: 'text', text: 'ok' }], 'event');
      assert.doesNotMatch(JSON.stringify(entries), /raw-receipt|private-token|Prisma raw receipt/);
      assert.match(JSON.stringify(entries), /ECONNRESET/);
    } finally { globalThis.fetch = originalFetch; }
  });
});

describe('v2 exact frozen delivery', () => {
  it('retries a real HTTP lost response with identical wire and key; accepts only a recognized duplicate', async () => {
    const { createServer } = await import('node:http');
    const bodies: string[] = [], keys: string[] = [];
    const server = createServer(async (request, response) => {
      let body = ''; for await (const chunk of request) body += chunk;
      bodies.push(body); keys.push(String(request.headers['x-line-retry-key']));
      if (bodies.length === 1) { response.destroy(); return; }
      response.writeHead(409, { 'x-line-accepted-request-id': 'accepted-original-request' }); response.end('{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'synthetic' } as any), {} as any);
      (adapter as any).LINE_PUSH_URL = `http://127.0.0.1:${address.port}/push`;
      const frozen = { transport: 'PUSH' as const, target: 'U-test', messages: [{ type: 'text' as const, text: 'ข้อหนึ่ง\nห้ามแก้ยอด 9007199254740993.01' }], pushRetryKey: 'f7265b4a-c1ef-4522-81f3-c50d14cba431', timeoutMs: 1000 };
      assert.equal((await adapter.sendFrozenV2(frozen)).kind, 'unknown');
      assert.deepEqual(await adapter.sendFrozenV2(frozen), { kind: 'accepted', code: 'API_ACCEPTED', requestId: 'accepted-original-request' });
      assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]); assert.equal(keys[0], keys[1]);
      assert.equal(JSON.parse(bodies[0]!).messages[0].text, frozen.messages[0]!.text);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  it('puts the frozen v2 wire on LINE untouched; only the legacy push exit adds the escape (R-B1 exit 4 vs exit 1)', async () => {
    const originalFetch = globalThis.fetch;
    const bodies: string[] = [];
    try {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { bodies.push(String(init?.body)); return new Response('', { status: 200 }); }) as typeof fetch;
      const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'synthetic' } as any), {} as any);
      const messages = [{ type: 'text' as const, text: 'เปิด https://app.example.test/companies/c/billing' }];
      assert.equal((await adapter.sendFrozenV2({ transport: 'PUSH', target: 'U1', messages, pushRetryKey: 'f7265b4a-c1ef-4522-81f3-c50d14cba431', timeoutMs: 5_000 })).kind, 'accepted');
      assert.doesNotMatch(bodies[0]!, /openExternalBrowser/);
      assert.deepEqual(JSON.parse(bodies[0]!).messages, messages);
      await adapter.sendPush('U1', messages, 'op-legacy');
      assert.match(bodies[1]!, /companies\/c\/billing\?openExternalBrowser=1/);
    } finally { globalThis.fetch = originalFetch; }
  });
  it('keeps a stalled error body uncertain rather than treating headers as token rejection', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((_request, response) => { response.writeHead(400); response.write('{"message":"Invalid reply token'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'synthetic' } as any), {} as any);
      (adapter as any).LINE_REPLY_URL = `http://127.0.0.1:${address.port}/reply`;
      assert.equal((await adapter.sendFrozenV2({ transport: 'REPLY', target: 'token', messages: [{ type: 'text', text: 'complete' }], pushRetryKey: 'f7265b4a-c1ef-4522-81f3-c50d14cba431', timeoutMs: 500 })).kind, 'unknown');
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});

it('Round 7A captures only accepted LINE sent message IDs for reply, push and frozen delivery', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ sentMessages: [{ id: 'bot-message-1', quoteToken: 'never-store' }, { id: 7 }, { id: 'bad id' }] }), { status: 200 });
  try {
    const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'secret' } as any), {} as any);
    const stored: string[][] = [];
    assert.equal(await adapter.sendReply('token', [{ type: 'text', text: 'hello' }], async ids => { stored.push(ids); }), 'ok');
    assert.equal(await adapter.sendPush('user', [{ type: 'text', text: 'hello' }], 'operation', async ids => { stored.push(ids); }), 'ok');
    const result = await adapter.sendFrozenV2({ transport: 'REPLY', target: 'token', messages: [{ type: 'text', text: 'hello' }], pushRetryKey: '12345678-1234-1234-1234-123456789abc', timeoutMs: 500 });
    assert.equal(result.kind, 'accepted'); assert.deepEqual(result.sentMessageIds, ['bot-message-1']);
    assert.deepEqual(stored, [['bot-message-1'], ['bot-message-1']]); assert.equal(JSON.stringify(stored).includes('never-store'), false);
  } finally { globalThis.fetch = originalFetch; }
});


it('U5 legacy reply and push sanitize all visible plan wording while preserving signed controls', async () => {
  const original = globalThis.fetch, bodies: any[] = [];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response('', { status: 200 }); };
  try {
    const adapter = new LineReplyAdapter(lineMessagingCredentialsFixture({ lineMessagingChannelAccessToken: 'synthetic' } as any), {} as any);
    for (const code of ['STARTER', 'BASIC', 'PRO', 'ENTERPRISE']) {
      const text = `แพ็กเกจ (${code}) — ดูได้ค่ะ`, data = `action=package&code=${code}`;
      const message: any = { type: 'text', text, quickReply: { items: [{ type: 'action', action: { type: 'postback', label: text, displayText: text, data } }] } };
      assert.equal(await adapter.sendReply('reply', [message]), 'ok');
      assert.equal(await adapter.sendPush('user', [message]), 'ok');
      for (const body of bodies.splice(0)) {
        assert.equal(body.messages[0].quickReply.items[0].action.data, data);
        const visible = [body.messages[0].text, body.messages[0].quickReply.items[0].action.label, body.messages[0].quickReply.items[0].action.displayText].join(' ');
        assert.doesNotMatch(visible, /—|\b(?:STARTER|BASIC|PRO|ENTERPRISE)\b/);
      }
    }
  } finally { globalThis.fetch = original; }
});
