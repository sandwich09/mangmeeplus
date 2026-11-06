import 'reflect-metadata';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { LineReplyAdapter, type LineReplyMessage } from './line-reply.adapter';

it('virtual reply, push, frozen wire and loading never read credentials or fetch; real targets still fetch', async () => {
  const original = globalThis.fetch;
  let fetches = 0, credentials = 0;
  const stored: any[] = [];
  const db: any = { company: { findUnique: async () => ({ reportClassification: 'DEMO' }) }, demoChatMessage: {
    findUnique: async ({ where }: any) => where.replyToken === 'vreply:known' ? { companyId: 'one', chatId: 'Vdemoone', webhookEventId: 'event' } : null,
    upsert: async (query: any) => { stored.push(query.create); return query.create; },
  } };
  const adapter = new LineReplyAdapter({ get: async () => { credentials++; return { accessToken: 'test', channelId: 'real' }; } } as any, {} as any, { client: db } as any);
  const messages: LineReplyMessage[] = [{ type: 'flex', altText: 'ทดสอบ', canonicalText: 'internal', contents: { type: 'bubble', footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: 'เปิด', uri: 'https://example.test/companies/one' } }] } },
    quickReply: { items: [{ type: 'action', action: { type: 'uri', label: 'เปิด', uri: 'https://example.test/' } }] } }];
  try {
    globalThis.fetch = async () => { fetches++; return new Response('{}', { status: 200 }); };
    assert.equal(await adapter.sendReply('vreply:known', messages), 'ok');
    assert.equal(await adapter.sendPush('Vdemoone', messages, 'operation'), 'ok');
    const wire = { transport: 'REPLY' as const, target: 'vreply:known', channelId: 'demo-web', messages: [{ type: 'text' as const, text: 'hello' }], pushRetryKey: '00000000-0000-4000-8000-000000000001', timeoutMs: 5000 };
    assert.equal((await adapter.sendFrozenV2(wire)).kind, 'accepted');
    assert.equal(await adapter.startLoadingAnimation('Vdemoone'), true);
    assert.equal((await adapter.sendFrozenV2({ ...wire, target: 'unknown' })).kind, 'unknown');
    assert.equal(await adapter.sendReply('vreply:unknown', messages), 'failed_other');
    assert.equal(fetches, 0); assert.equal(credentials, 0); assert.equal(stored.length, 3);
    assert.ok(stored.every(row => row.companyId === 'one' && row.chatId === 'Vdemoone' && row.direction === 'out'));
    assert.equal(stored[0].webhookEventId, 'event');
    assert.equal(stored[0].messagesJson[0].canonicalText, undefined);
    assert.match(stored[0].messagesJson[0].contents.footer.contents[0].action.uri, /openExternalBrowser=1/);
    db.company.findUnique = async () => ({ reportClassification: 'CUSTOMER' });
    assert.equal(await adapter.sendPush('Vdemocustomer', messages), 'failed_other');
    assert.equal(fetches, 0);
    assert.equal(await adapter.sendReply('real-token', [{ type: 'text', text: 'real' }]), 'ok');
    assert.equal(await adapter.sendPush('U-real', [{ type: 'text', text: 'real' }]), 'ok');
    assert.equal((await adapter.sendFrozenV2({ ...wire, channelId: 'real', target: 'real-token' })).kind, 'accepted');
    assert.equal(fetches, 3); assert.equal(credentials, 3);
  } finally { globalThis.fetch = original; }
});
