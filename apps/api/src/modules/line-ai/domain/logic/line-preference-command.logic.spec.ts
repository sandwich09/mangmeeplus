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
