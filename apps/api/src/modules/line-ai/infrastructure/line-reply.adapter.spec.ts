import { lineMessagingCredentialsFixture } from '../../../common/config/line-messaging-credentials.fixture';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineReplyAdapter, linePushRetryKey, parseOutcomeMessages, repairLegacyOutcomePreview } from './line-reply.adapter';
import { buildLineAssistantTextCardMessage } from '../domain/logic/line-business-card.logic';
import { lineMessagePreview } from '../domain/logic/line-message-preview.logic';
import { buildPendingApprovalCard, buildStaffMainMenu } from '../domain/logic/line-staff-menu.logic';

describe('LineReplyAdapter rich payload delivery', () => {
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

  it('never narrows a non-Flex or non-reply failure — failed_flex refines failed_token only', async () => {
    assert.equal(await post('reply', [TEXT], 400, BAD_FLEX), 'failed_token', 'no Flex in the payload');
    assert.equal(await post('push', [FLEX], 400, BAD_FLEX), 'failed_permanent', 'push body rejection needs a reviewed payload');
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
