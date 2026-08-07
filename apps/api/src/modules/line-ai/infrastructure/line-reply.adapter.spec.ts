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
      const context = { displayName: 'พิม', roleLabel: 'แอดมิน', branchScopeLabel: 'ทุกสาขา', companyId: 'company-1', webBaseUrl: 'https://app.example.com', permissions: [] };
      assert.equal(await adapter.sendReply('reply-token', [buildStaffMainMenu(context), buildPendingApprovalCard(context)]), 'ok');
      assert.ok(signal instanceof AbortSignal, 'LINE delivery must be time-bounded');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
