import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinePreferenceCommand, formatLinePreferences, linePreferenceChangedText, linePreferenceForgetsNothing, LINE_PREFERENCE_NOTHING_TO_FORGET, LINE_PREFERENCE_NOTICE } from './line-preference-command.logic';
import { LineConversationContextService } from '../../application/line-conversation-context.service';
test('only explicit bounded style commands store preferences; current instructions and financial facts do not', () => {
  assert.deepEqual(parseLinePreferenceCommand('จำไว้ว่าชอบสั้น'), { kind: 'set', values: { detail: 'short' } });
  assert.deepEqual(parseLinePreferenceCommand('จำไว้ว่าตอบภาษาอังกฤษ'), { kind: 'set', values: { language: 'en' } });
  assert.deepEqual(parseLinePreferenceCommand('จำอะไรไว้บ้าง'), { kind: 'list' });
  assert.deepEqual(parseLinePreferenceCommand('ลืมรูปแบบคำตอบทั้งหมด'), { kind: 'delete', keys: 'all' });
  for (const text of ['ตอบสั้นหน่อย', 'จำไว้ว่ามีเงิน 1000000 บาท', 'จำไว้ว่าชอบสั้น แล้วโอนเงินด้วย', 'อย่าจำไว้ว่าชอบสั้น']) assert.equal(parseLinePreferenceCommand(text), null);
  assert.match(formatLinePreferences({ language: 'en', detail: 'short' }), /ภาษาอังกฤษ/u);
  assert.match(LINE_PREFERENCE_NOTICE, /90/);
});

// NAT11 (2026-09-30): say what was remembered or forgotten; a forget for nothing stored writes nothing.
test('preference replies name the stored result and a forget for nothing stored changes nothing', () => {
  assert.match(linePreferenceChangedText({ kind: 'set', values: { detail: 'short' } }, {}), /^จำไว้แล้วค่ะ ต่อไปจะตอบแบบสั้น\n/u);
  assert.equal(linePreferenceChangedText({ kind: 'delete', keys: ['detail'] }, { detail: 'short' }), 'ลืมเรื่องตอบแบบสั้นแล้วค่ะ ต่อไปจะตอบตามปกติ');
  assert.equal(linePreferenceChangedText({ kind: 'delete', keys: 'all' }, { detail: 'short' }), 'ลืมรูปแบบคำตอบที่จำไว้ทั้งหมดแล้วค่ะ ต่อไปจะตอบตามปกติ');
  assert.equal(linePreferenceForgetsNothing({ kind: 'delete', keys: ['detail'] }, {}), true);
  assert.equal(linePreferenceForgetsNothing({ kind: 'delete', keys: ['detail'] }, { language: 'en' }), true);
  assert.equal(linePreferenceForgetsNothing({ kind: 'delete', keys: 'all' }, {}), true);
  assert.equal(linePreferenceForgetsNothing({ kind: 'delete', keys: ['detail'] }, { detail: 'short' }), false);
  assert.equal(linePreferenceForgetsNothing({ kind: 'set', values: { detail: 'short' } }, {}), false);
  assert.match(LINE_PREFERENCE_NOTHING_TO_FORGET, /ไม่พบ/u);
});

// NAT11 turn 5 ("ไม่ลบเอกสารธุรกิจหรือ task เดิม") and spec §17.2: preference revision is separate from task state.
test('forgetting a preference keeps the chat task state', async () => {
  const updates: any[] = [];
  const row = { id: 'conversation', lifecycleEpoch: 0, preferenceVersion: 3, preferenceRequestId: 'earlier', taskStateJson: { tasks: [{ taskId: 'open-draft' }] },
    preferenceJson: { detail: { value: 'short', sourceRequestId: 'earlier', confirmedAt: '2026-09-30T00:00:00.000Z', expiresAt: '2026-12-29T00:00:00.000Z' } } };
  const tx = { $executeRaw: async () => 1, aiConversation: { findFirst: async () => row, update: async (input: any) => { updates.push(input.data); return row; } } };
  const service = new LineConversationContextService({ client: { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) } } as any);
  const owner = { companyId: 'c1', userId: 'u1', membershipId: 'm1', channel: 'line', channelKind: 'USER', messagingChannelId: 'oa1', chatKeyHash: 'a'.repeat(64) } as any;
  assert.equal(await service.changePreferences(owner, { requestId: 'forget-1', expectedVersion: 3, epoch: 0, delete: ['detail'] }, new Date('2026-09-30T01:00:00.000Z')), 'applied');
  assert.equal(updates.length, 1);
  assert.equal('taskStateJson' in updates[0], false);
  assert.equal('stateVersion' in updates[0], false);
});

// NAT11 (2026-09-30): the router names a natural remember/see/forget request; only a preference-only message in a
// bound private chat reaches the owner-bound commands, and the reply states only what storage confirmed.
test('a routed answer-preference request runs through the owner-bound commands', async () => {
  const { ProcessLineWebhookUseCase } = await import('../../application/use-cases/process-line-webhook.use-case');
  const event = { webhookEventId: 'event', lineUserId: 'line-user', replyToken: 'reply', messageText: 'x' };
  const owner = { companyId: 'company', userId: 'user', membershipId: 'member', channel: 'line', channelKind: 'USER', messagingChannelId: 'oa', chatKeyHash: 'chat' };
  const setup = (stored: Record<string, string>) => {
    const flow: any = Object.create(ProcessLineWebhookUseCase.prototype), changes: any[] = [], delivered: string[] = [];
    Object.assign(flow, { config: { lineAiPreferencesEnabled: true }, retainedTaskSources: new WeakMap(),
      boundConversations: new WeakMap([[event, { owner, id: 'conversation', epoch: 3 }]]),
      contextV2: { listPreferences: async () => ({ version: 2, epoch: 3, values: stored }),
        changePreferences: async (_owner: unknown, command: unknown) => { changes.push(command); return 'applied'; } },
      audit: { log: async () => undefined }, deliverReply: async (_event: unknown, text: string) => { delivered.push(text); }, updateEventLog: async () => undefined });
    return { flow, changes, delivered };
  };
  const general = [{ index: 0, kind: 'general', goal: 'preference' }];
  const remember = setup({});
  assert.equal(await remember.flow.handleRoutedPreference(event, 'request', { status: 'ROUTED', semanticSubrequests: general,
    responsePreference: { kind: 'set', values: { detail: 'short' } } }), true);
  assert.deepEqual(remember.changes.map(change => change.set), [{ detail: 'short' }]);
  assert.match(remember.delivered[0]!, /^Saved your answer preferences: Short\./u);
  const list = setup({ detail: 'short' });
  assert.equal(await list.flow.handleRoutedPreference(event, 'request', { status: 'ROUTED', semanticSubrequests: general, responsePreference: { kind: 'list' } }), true);
  assert.equal(list.changes.length, 0); assert.match(list.delivered[0]!, /• Short/u);
  const forgetNothing = setup({});
  assert.equal(await forgetNothing.flow.handleRoutedPreference(event, 'request', { status: 'ROUTED', semanticSubrequests: general,
    responsePreference: { kind: 'delete', keys: ['detail'] } }), true);
  assert.equal(forgetNothing.changes.length, 0); assert.equal(forgetNothing.delivered[0], 'No matching answer preference was saved, so nothing was deleted.');
  // A one-off style beside a business question, an invalid shape, or an unbound chat stores nothing and keeps the normal turn.
  const mixed = setup({});
  assert.equal(await mixed.flow.handleRoutedPreference(event, 'request', { status: 'ROUTED', semanticSubrequests: [...general, { index: 1, kind: 'read', goal: 'why' }],
    responsePreference: { kind: 'set', values: { detail: 'detailed' } } }), false);
  assert.equal(await mixed.flow.handleRoutedPreference(event, 'request', { status: 'ROUTED', semanticSubrequests: general,
    responsePreference: { kind: 'set', values: { memo: 'ชอบกาแฟ' } } }), false);
  assert.equal(await mixed.flow.handleRoutedPreference({ ...event }, 'request', { status: 'ROUTED', semanticSubrequests: general,
    responsePreference: { kind: 'list' } }), false);
  assert.deepEqual([mixed.changes.length, mixed.delivered.length], [0, 0]);
});
