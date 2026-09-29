import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessLineWebhookUseCase } from '../line-ai/application/use-cases/process-line-webhook.use-case';

const buttonOf = (card: any) => card.contents.footer.contents[0].action;

function harness(input: { selected?: string; owned?: string[]; mode?: string; handoffLinks?: unknown; pushTargetId?: string } = {}) {
  const replies: string[] = [], cards: any[] = [], logs: any[] = [], requests: any[] = [];
  let query: any;
  const context: any = { prisma: { client: {
    lineCompanyContext: { findUnique: async () => input.selected ? { companyId: input.selected } : null },
    companyMembership: { findMany: async (args: any) => { query = args; return (input.owned ?? ['company-a']).map(companyId => ({ companyId, company: { name: companyId, planTerm: { tierKey: 'FREE_TRIAL_15' } } })); } },
  } }, config: { billingMode: input.mode ?? 'test', webBaseUrl: 'https://app.example.test' },
    packageChange: { create: async (data: unknown) => requests.push(data) },
    deliverReply: async (_: unknown, text: string) => replies.push(text), deliverRequiredMessages: async (_: unknown, items: any[]) => cards.push(...items),
    updateEventLog: async (...args: any[]) => logs.push(args),
    handoffLinks: input.handoffLinks, oneTapPackageUrl: (ProcessLineWebhookUseCase.prototype as any).oneTapPackageUrl,
  };
  const event: any = { webhookEventId: 'synthetic-event', lineUserId: 'synthetic-line', ...(input.pushTargetId ? { pushTargetId: input.pushTargetId } : {}) };
  const execute = () => (ProcessLineWebhookUseCase.prototype as any).handlePackageChangeRequest.call(context, event, 'owner', 'request');
  return { execute, event, replies, cards, logs, requests, query: () => query };
}
test('old LINE package/rich-menu command opens the selected owner billing review and never creates a manual upgrade', async () => {
  const h = harness(); await h.execute();
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.event.handoff, { userId: 'owner', companyId: 'company-a' });
  // Review 2026-09-29: the link is ONE "เลือกแพ็กเกจ" button, never a raw URL in the chat.
  assert.deepEqual(h.replies, []);
  assert.deepEqual(buttonOf(h.cards[0]), { type: 'uri', label: 'เลือกแพ็กเกจ', uri: 'https://app.example.test/companies/company-a/billing?channel=line' });
  assert.doesNotMatch(JSON.stringify(h.cards[0]), /ชำระแล้ว|ซื้อใบเพิ่ม|ปลดล็อกแล้ว/);
  // R-C11: the web's predicate — an ACTIVE role holding `company.plan.manage` — not the OWNER key.
  assert.deepEqual(h.query().where.roles, { some: { role: { status: 'ACTIVE', permissions: { some: { permission: { key: 'company.plan.manage' } } } } } });
});
test('R-B2 (b): the reply carries the one-tap link minted in the lane, never in a group chat', async () => {
  const minted: any[] = [];
  const handoffLinks = { linkFor: async (ctx: any, path: string) => { minted.push({ ctx, path }); return 'https://app.example.test/l/tok'; } };
  const h = harness({ handoffLinks }); await h.execute();
  assert.equal(buttonOf(h.cards[0]).uri, 'https://app.example.test/l/tok');
  assert.match(JSON.stringify(h.cards[0]), /เปิดในเบราว์เซอร์ให้อัตโนมัติ/);
  assert.deepEqual(minted, [{ ctx: { userId: 'owner', companyId: 'company-a', lineUserId: 'synthetic-line', surface: 'package_change_reply' },
    path: '/companies/company-a/billing?channel=line' }]);
  const group = harness({ handoffLinks, pushTargetId: `C${'0'.repeat(32)}` }); await group.execute();
  assert.doesNotMatch(JSON.stringify(group.cards[0]), /\/l\//);
  assert.equal(buttonOf(group.cards[0]).uri, 'https://app.example.test/companies/company-a/billing?channel=line');
  assert.equal(minted.length, 1, 'no token for a room full of people');
});
test('nonowner and ambiguous/stale selected company cannot get a different shop billing link', async () => {
  for (const input of [{ owned: [] }, { owned: ['a', 'b'] }, { selected: 'foreign' }]) {
    const h = harness(input); await h.execute();
    assert.equal(h.event.handoff, undefined); assert.equal(h.requests.length, 0);
    assert.doesNotMatch(h.replies.join('\n') + JSON.stringify(h.cards), /https:/);
  }
});
test('disabled billing retains the existing manual support path', async () => {
  const h = harness({ mode: 'disabled' }); await h.execute();
  assert.equal(h.requests.length, 1); assert.equal(h.event.handoff, undefined);
});
