import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinePreferenceCommand, formatLinePreferences, LINE_PREFERENCE_NOTICE } from './line-preference-command.logic';
test('only explicit bounded style commands store preferences; current instructions and financial facts do not', () => {
  assert.deepEqual(parseLinePreferenceCommand('จำไว้ว่าชอบสั้น'), { kind: 'set', values: { detail: 'short' } });
  assert.deepEqual(parseLinePreferenceCommand('จำไว้ว่าตอบภาษาอังกฤษ'), { kind: 'set', values: { language: 'en' } });
  assert.deepEqual(parseLinePreferenceCommand('จำอะไรไว้บ้าง'), { kind: 'list' });
  assert.deepEqual(parseLinePreferenceCommand('ลืมรูปแบบคำตอบทั้งหมด'), { kind: 'delete', keys: 'all' });
  for (const text of ['ตอบสั้นหน่อย', 'จำไว้ว่ามีเงิน 1000000 บาท', 'จำไว้ว่าชอบสั้น แล้วโอนเงินด้วย', 'อย่าจำไว้ว่าชอบสั้น']) assert.equal(parseLinePreferenceCommand(text), null);
  assert.match(formatLinePreferences({ language: 'en', detail: 'short' }), /ภาษาอังกฤษ/u);
  assert.match(LINE_PREFERENCE_NOTICE, /90/);
});
