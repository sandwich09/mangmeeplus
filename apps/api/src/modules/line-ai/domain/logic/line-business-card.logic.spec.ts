import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LineAiTurnResponse } from '@watchdog-bms/contracts';
import { buildLineAssistantTextCardMessage, buildLineBusinessAnswerMessage } from './line-business-card.logic';

const response = (cards?: NonNullable<LineAiTurnResponse['presentation']>['cards']): LineAiTurnResponse => ({
  requestId: 'r1', replyText: 'fallback', sourceRefs: [], sourceLabels: [], webLinks: [],
  intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: ['company.get_current_context'], durationMs: 1,
  ...(cards ? { presentation: { kind: 'answer_cards', cards } } : {}),
});

describe('LINE business answer card renderer', () => {
  it('returns a fallback card when presentation is absent', () => {
    const message = buildLineBusinessAnswerMessage(response(), 'plain fallback', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'flex');
    assert.match(JSON.stringify(message), /plain fallback/);
  });

  it('fails closed to a trusted fallback card when a refused response unexpectedly carries cards', () => {
    const refused = { ...response([{ text: 'ข้อมูลที่ห้ามแสดง' }]), refused: true };
    const message = buildLineBusinessAnswerMessage(refused, 'ไม่มีสิทธิ์', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'flex');
    assert.match(JSON.stringify(message), /ไม่มีสิทธิ์/);
    assert.doesNotMatch(JSON.stringify(message), /ข้อมูลที่ห้ามแสดง/);
  });

  it('moves safe tenant URLs from deterministic reply text into Flex buttons', () => {
    const message = buildLineAssistantTextCardMessage(
      'บันทึกข้อมูลแล้ว\nตรวจสอบในเว็บ:\nhttps://app.example.com/companies/c1/expenses/e1',
      'https://app.example.com',
      'c1',
    );
    assert.equal(message.type, 'flex');
    const bubble = message.contents as any;
    assert.doesNotMatch(bubble.body.contents[0].text, /https?:\/\//);
    // The label line names the link, so it becomes the button and stops being stranded body text.
    assert.equal(bubble.body.contents[0].text, 'บันทึกข้อมูลแล้ว');
    assert.deepEqual(bubble.footer.contents[0].action, {
      type: 'uri', label: 'ตรวจสอบในเว็บ', uri: 'https://app.example.com/companies/c1/expenses/e1',
    });
  });

  it('never promotes cross-origin or cross-tenant text URLs to buttons', () => {
    for (const url of [
      'https://evil.example/companies/c1/expenses/e1',
      'https://app.example.com/companies/c2/expenses/e1',
    ]) {
      const message = buildLineAssistantTextCardMessage(`ตรวจสอบ ${url}`, 'https://app.example.com', 'c1');
      assert.equal(message.type, 'flex');
      assert.equal((message.contents as any).footer, undefined);
      assert.match((message.contents as any).body.contents[0].text, /https?:\/\//);
    }
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

const token = 'A'.repeat(43);

describe('spec §13 — the state badge row', () => {
  it('renders the badge as its own row above the body, and nothing at all without one', () => {
    const withBadge = buildLineAssistantTextCardMessage('ยอด 50.00 THB', 'https://app.example.com', 'c1', '✅ ออกเอกสารแล้ว');
    const withoutBadge = buildLineAssistantTextCardMessage('ยอด 50.00 THB', 'https://app.example.com', 'c1');

    const rows = (withBadge as any).contents.body.contents;
    assert.equal(rows[0].text, '✅ ออกเอกสารแล้ว');
    assert.equal(rows[0].weight, 'bold');
    assert.equal(rows[1].text, 'ยอด 50.00 THB');
    assert.equal((withoutBadge as any).contents.body.contents[0].text, 'ยอด 50.00 THB');
  });

  it('bounds a badge the same way every other card string is bounded', () => {
    const message = buildLineAssistantTextCardMessage('ข้อมูล', undefined, 'c1', '🌱'.repeat(80));
    assert.equal(Array.from((message as any).contents.body.contents[0].text as string).length, 40);
  });
});

describe('spec §12.5 — the one /d/{token} allowance in safeTenantLink', () => {
  it('promotes an exact-shape delivery link on the configured origin, outside the tenant path', () => {
    const message = buildLineAssistantTextCardMessage(
      `ดาวน์โหลดเอกสาร (ลิงก์หมดอายุใน 3 วัน): https://app.example.com/d/${token}`,
      'https://app.example.com',
      'c1',
    );
    assert.deepEqual((message as any).contents.footer.contents[0].action, {
      type: 'uri', label: 'ดาวน์โหลดเอกสาร (ลิงก์หมดอายุใน 3 วัน)', uri: `https://app.example.com/d/${token}`,
    });
  });

  it('still rejects everything that is not exactly that shape', () => {
    const rejected = [
      `https://evil.example/d/${token}`,                     // another origin
      `https://app.example.com/d/${'A'.repeat(42)}`,         // one char short
      `https://app.example.com/d/${'A'.repeat(44)}`,         // one char long
      `https://app.example.com/d/${'A'.repeat(42)}$`,        // outside the base64url alphabet
      `https://app.example.com/d/${token}/extra`,            // a deeper path
      `https://app.example.com/d/${token}?next=/companies`,  // a query
      `https://app.example.com/d/${token}#f`,                // a fragment
      'https://app.example.com/d/',                          // no token
      'https://app.example.com/d',                           // the bare segment
      `https://app.example.com/dd/${token}`,                 // a sibling segment
      `https://app.example.com/x/d/${token}`,                // nested under something else
      `https://app.example.com/D/${token}`,                  // a different case
    ];
    for (const url of rejected) {
      const message = buildLineAssistantTextCardMessage(`ตรวจสอบ ${url}`, 'https://app.example.com', 'c1');
      assert.equal((message as any).contents.footer, undefined, url);
      assert.match((message as any).contents.body.contents[0].text, /https?:\/\//, url);
    }
  });

  it('keeps the delivery allowance out of the gateway card path unless the path is exact', () => {
    for (const path of [`/d/${token}`, `/d/${'A'.repeat(42)}`, `/companies/c2/expenses`]) {
      const message = buildLineBusinessAnswerMessage(response([{
        text: 'ข้อมูล', webLink: { label: 'เปิด', path },
      }]), 'fallback', 'https://app.example.com', 'c1');
      const promoted = JSON.stringify(message).includes('"type":"button"');
      assert.equal(promoted, path === `/d/${token}`, path);
    }
  });
});

describe('FIX-5 — a link label becomes its button, never a dangling colon line', () => {
  const web = 'https://app.example.com/companies/c1/expenses/substitute-receipts/e1';
  const delivery = `https://app.example.com/d/${token}`;

  function card(text: string) {
    const message = buildLineAssistantTextCardMessage(text, 'https://app.example.com', 'c1');
    const contents = (message as any).contents;
    return {
      body: contents.body.contents[contents.body.contents.length - 1].text as string,
      buttons: (contents.footer?.contents ?? []).map((button: any) => ({
        label: button.action.label as string, uri: button.action.uri as string,
      })),
    };
  }

  it('labels a single link from the line it sits on and drops that line from the body', () => {
    const { body, buttons } = card(`สรุปงาน\nเปิดตรวจสอบในเว็บ: ${web}`);
    assert.deepEqual(buttons, [{ label: 'เปิดตรวจสอบในเว็บ', uri: web }]);
    assert.equal(body, 'สรุปงาน');
  });

  it('falls back to the generic label when nothing names the link', () => {
    const { body, buttons } = card(`สรุปงาน ${web} จบ`);
    assert.deepEqual(buttons, [{ label: 'เปิดดูในเว็บแอป', uri: web }]);
    assert.equal(body, 'สรุปงาน  จบ');
  });

  it('labels two links independently instead of numbering them เปิดลิงก์ 1/2', () => {
    const { body, buttons } = card([
      '✅ ออกเอกสารแล้ว — เลขที่ SUB-202608-00007',
      `ดาวน์โหลดเอกสาร (ลิงก์หมดอายุใน 3 วัน): ${delivery}`,
      `เปิดในเว็บ: ${web}`,
    ].join('\n'));

    assert.deepEqual(buttons, [
      { label: 'ดาวน์โหลดเอกสาร (ลิงก์หมดอายุใน 3 วัน)', uri: delivery },
      { label: 'เปิดในเว็บ', uri: web },
    ]);
    assert.equal(body, '✅ ออกเอกสารแล้ว — เลขที่ SUB-202608-00007');
    assert.doesNotMatch(body, /:\s*$/m, 'no colon line is left behind');
  });

  it('numbers only the link that has no label of its own', () => {
    const { buttons } = card(`ดูรายละเอียด ${web} ก่อน\nดาวน์โหลดเอกสาร: ${delivery}`);
    assert.deepEqual(buttons, [
      { label: 'เปิดลิงก์ 1', uri: web },
      { label: 'ดาวน์โหลดเอกสาร', uri: delivery },
    ]);
  });

  it('never mistakes a long sentence ending in a colon for a button label', () => {
    const sentence = 'ก'.repeat(41);
    const { body, buttons } = card(`${sentence}: ${web}`);
    assert.deepEqual(buttons, [{ label: 'เปิดดูในเว็บแอป', uri: web }]);
    assert.match(body, new RegExp(sentence));
  });

  it('leaves two links on one line to the generic numbering', () => {
    const { buttons } = card(`ลิงก์: ${web} ${delivery}`);
    assert.deepEqual(buttons.map((button: any) => button.label), ['เปิดลิงก์ 1', 'เปิดลิงก์ 2']);
  });

  it('keeps a rejected URL and its label in the body untouched', () => {
    const { body, buttons } = card('ดาวน์โหลด: https://evil.example/d/abc');
    assert.deepEqual(buttons, []);
    assert.equal(body, 'ดาวน์โหลด: https://evil.example/d/abc');
  });
});
