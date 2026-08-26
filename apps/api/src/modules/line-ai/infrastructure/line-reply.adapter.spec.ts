import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineReplyAdapter } from './line-reply.adapter';
import { buildPendingApprovalCard, buildStaffMainMenu } from '../domain/logic/line-staff-menu.logic';

describe('LineReplyAdapter rich payload delivery', () => {
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
      const adapter = new LineReplyAdapter({ lineMessagingChannelAccessToken: 'secret' } as any);
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
      const adapter = new LineReplyAdapter({ lineMessagingChannelAccessToken: 'secret' } as any);
      return kind === 'reply' ? adapter.sendReply('reply-token', messages) : adapter.sendPush('U1', messages);
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
    assert.equal(await post('push', [FLEX], 400, BAD_FLEX), 'failed_other', 'push 400 stays failed_other');
    assert.equal(await post('reply', [FLEX], 500, ''), 'failed_other', 'only 400 is a body rejection');
  });
});
