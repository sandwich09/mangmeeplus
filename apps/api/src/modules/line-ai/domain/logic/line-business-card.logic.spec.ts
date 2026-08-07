import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LineAiTurnResponse } from '@watchdog-bms/contracts';
import { buildLineBusinessAnswerMessage } from './line-business-card.logic';

const response = (cards?: NonNullable<LineAiTurnResponse['presentation']>['cards']): LineAiTurnResponse => ({
  requestId: 'r1', replyText: 'fallback', sourceRefs: [], sourceLabels: [], webLinks: [],
  intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: ['company.get_current_context'], durationMs: 1,
  ...(cards ? { presentation: { kind: 'answer_cards', cards } } : {}),
});

describe('LINE business answer card renderer', () => {
  it('returns text when presentation is absent', () => {
    assert.deepEqual(buildLineBusinessAnswerMessage(response(), 'plain fallback', 'https://app.example.com', 'c1'), {
      type: 'text', text: 'plain fallback',
    });
  });

  it('fails closed to text when a refused response unexpectedly carries cards', () => {
    const refused = { ...response([{ text: 'ข้อมูลที่ห้ามแสดง' }]), refused: true };
    assert.deepEqual(buildLineBusinessAnswerMessage(refused, 'ไม่มีสิทธิ์', 'https://app.example.com', 'c1'), {
      type: 'text', text: 'ไม่มีสิทธิ์',
    });
  });

  it('renders one answer as one Mangmee-themed bubble with a safe tenant link', () => {
    const message = buildLineBusinessAnswerMessage(response([{
      title: 'ค่าใช้จ่ายเดือนนี้', text: 'ยังไม่มีค่าใช้จ่าย รวม 0.00 บาท', sourceLabels: ['ค่าใช้จ่าย'],
      webLink: { label: 'เปิดค่าใช้จ่าย', path: '/companies/c1/expenses?month=2026-07' },
    }]), 'fallback', 'https://app.example.com/base', 'c1');
    assert.equal(message.type, 'flex');
    const json = JSON.stringify(message);
    assert.match(json, /"type":"bubble"/);
    assert.match(json, /#22C55E/);
    assert.match(json, /#1A2E22/);
    assert.match(json, /https:\/\/app\.example\.com\/companies\/c1\/expenses\?month=2026-07/);
    assert.match(json, /แหล่งข้อมูล: ค่าใช้จ่าย/);
  });

  it('renders many answers as a carousel capped at twelve cards', () => {
    const cards = Array.from({ length: 14 }, (_, index) => ({ title: `คำตอบ ${index + 1}`, text: `ข้อมูล ${index + 1}` }));
    const message = buildLineBusinessAnswerMessage(response(cards), 'fallback', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'flex');
    assert.equal((message.contents as any).type, 'carousel');
    assert.equal((message.contents as any).contents.length, 12);
  });

  it('omits absolute, cross-tenant, protocol-relative, and traversing links', () => {
    const unsafe = [
      'https://evil.example/companies/c1/expenses',
      '/companies/c2/expenses',
      '//evil.example/companies/c1/expenses',
      '/companies/c1/../c2/expenses',
      '/companies/c1/%2f..%2fc2/expenses',
    ];
    for (const path of unsafe) {
      const message = buildLineBusinessAnswerMessage(response([{
        text: 'ข้อมูล', webLink: { label: 'เปิด', path },
      }]), 'fallback', 'https://app.example.com', 'c1');
      assert.doesNotMatch(JSON.stringify(message), /"type":"button"/, path);
    }
  });

  it('bounds card text and alt text without splitting unicode code points', () => {
    const message = buildLineBusinessAnswerMessage(response([{ title: 'หัวข้อ', text: '🌱'.repeat(2_000) }]), 'fallback', undefined, 'c1');
    assert.equal(message.type, 'flex');
    assert.ok(Array.from(message.altText).length <= 400);
    const bodyText = ((message.contents as any).body.contents[0].text as string);
    assert.equal(Array.from(bodyText).length, 1_200);
    assert.equal(bodyText.endsWith('🌱'), true);
  });
});
