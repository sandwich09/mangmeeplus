import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessLineWebhookUseCase } from '../line-ai/application/use-cases/process-line-webhook.use-case';

function harness(input: { selected?: string; owned?: string[]; mode?: string } = {}) {
  const replies: string[] = [], cards: any[] = [], logs: any[] = [], requests: any[] = [];
  let query: any;
  const context: any = { prisma: { client: {
    lineCompanyContext: { findUnique: async () => input.selected ? { companyId: input.selected } : null },
    companyMembership: { findMany: async (args: any) => { query = args; return (input.owned ?? ['company-a']).map(companyId => ({ companyId, company: { name: companyId, planTerm: { tierKey: 'FREE_TRIAL_15' } } })); } },
  } }, config: { billingMode: input.mode ?? 'test', webBaseUrl: 'https://app.example.test' },
    packageChange: { create: async (data: unknown) => requests.push(data) },
    deliverReply: async (_: unknown, text: string) => replies.push(text), deliverRequiredMessages: async (_: unknown, items: any[]) => cards.push(...items),
    updateEventLog: async (...args: any[]) => logs.push(args),
  };
  const event: any = { webhookEventId: 'synthetic-event', lineUserId: 'synthetic-line' };
  const execute = () => (ProcessLineWebhookUseCase.prototype as any).handlePackageChangeRequest.call(context, event, 'owner', 'request');
  return { execute, event, replies, cards, logs, requests, query: () => query };
}
test('old LINE package/rich-menu command opens the selected owner billing review and never creates a manual upgrade', async () => {
  const h = harness(); await h.execute();
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.event.handoff, { userId: 'owner', companyId: 'company-a' });
  assert.match(h.replies[0]!, /companies\/company-a\/billing\?channel=line/);
  assert.doesNotMatch(h.replies[0]!, /ชำระแล้ว|ซื้อใบเพิ่ม|ปลดล็อกแล้ว/);
  assert.deepEqual(h.query().where.roles, { some: { role: { key: 'OWNER', status: 'ACTIVE' } } });
});
test('nonowner and ambiguous/stale selected company cannot get a different shop billing link', async () => {
  for (const input of [{ owned: [] }, { owned: ['a', 'b'] }, { selected: 'foreign' }]) {
    const h = harness(input); await h.execute();
    assert.equal(h.event.handoff, undefined); assert.equal(h.requests.length, 0);
    assert.doesNotMatch(h.replies.join('\n'), /https:/);
  }
});
test('disabled billing retains the existing manual support path', async () => {
  const h = harness({ mode: 'disabled' }); await h.execute();
  assert.equal(h.requests.length, 1); assert.equal(h.event.handoff, undefined);
});
