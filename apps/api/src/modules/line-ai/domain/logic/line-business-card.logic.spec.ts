import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LineAiTurnResponse } from '@watchdog-bms/contracts';
import {
  buildExpenseDraftCardMessage,
  buildLineAssistantTextCardMessage,
  buildLineBusinessAnswerMessage,
  buildReimbursementHandoffMessage,
  buildReimbursementPayerClarificationMessage,
} from './line-business-card.logic';

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

describe('FIX-5 — a link label becomes its button, never a dangling colon line', () => {
  const web = 'https://app.example.com/companies/c1/expenses/substitute-receipts/e1';
  const web2 = 'https://app.example.com/companies/c1/expenses/e2';

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
      '🔵 รอยืนยัน — เลขที่ SUB-202608-00007',
      `ดูเอกสาร: ${web2}`,
      `เปิดในเว็บ: ${web}`,
    ].join('\n'));

    assert.deepEqual(buttons, [
      { label: 'ดูเอกสาร', uri: web2 },
      { label: 'เปิดในเว็บ', uri: web },
    ]);
    assert.equal(body, '🔵 รอยืนยัน — เลขที่ SUB-202608-00007');
    assert.doesNotMatch(body, /:\s*$/m, 'no colon line is left behind');
  });

  it('numbers only the link that has no label of its own', () => {
    const { buttons } = card(`ดูรายละเอียด ${web} ก่อน\nดูเอกสาร: ${web2}`);
    assert.deepEqual(buttons, [
      { label: 'เปิดลิงก์ 1', uri: web },
      { label: 'ดูเอกสาร', uri: web2 },
    ]);
  });

  it('M7: marks a truncated alt text instead of cutting it mid-word', () => {
    const long = 'ใบรับรองแทนใบเสร็จรับเงินของรายการนี้ '.repeat(40);
    const message = buildLineAssistantTextCardMessage(long, undefined, 'c1');
    assert.equal(message.type, 'flex');
    const alt = Array.from(message.type === 'flex' ? message.altText : '');

    assert.equal(alt.length, 400, 'the ellipsis is counted inside the limit');
    assert.equal(alt[alt.length - 1], '\u2026', 'a chat-list preview that stops mid-syllable reads as a broken message');
  });

  it('M7: leaves a short alt text exactly as written', () => {
    const message = buildLineAssistantTextCardMessage('สรุปยอดวันนี้ 200.00 บาท', undefined, 'c1');
    assert.equal(message.type === 'flex' && message.altText, 'สรุปยอดวันนี้ 200.00 บาท');
  });

  it('never mistakes a long sentence ending in a colon for a button label', () => {
    const sentence = 'ก'.repeat(41);
    const { body, buttons } = card(`${sentence}: ${web}`);
    assert.deepEqual(buttons, [{ label: 'เปิดดูในเว็บแอป', uri: web }]);
    assert.match(body, new RegExp(sentence));
  });

  it('leaves two links on one line to the generic numbering', () => {
    const { buttons } = card(`ลิงก์: ${web} ${web2}`);
    assert.deepEqual(buttons.map((button: any) => button.label), ['เปิดลิงก์ 1', 'เปิดลิงก์ 2']);
  });

  it('keeps a rejected URL and its label in the body untouched', () => {
    const { body, buttons } = card('ดาวน์โหลด: https://evil.example/d/abc');
    assert.deepEqual(buttons, []);
    assert.equal(body, 'ดาวน์โหลด: https://evil.example/d/abc');
  });
});

// ── §10.1 expense draft card: a dedicated ร่างค่าใช้จ่าย card with one row per grounded fact, instead
//    of the generic card wrapping a canonical reply its 1,200-character body would silently cut. ──
describe('expense draft card (§10.1)', () => {
  const WEB = 'https://app.example.com';
  const CANONICAL = '🧾 บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว (รอตรวจสอบ)\n• ยอดรวม – 1,250.00';
  const FULL = { expenseId: 'exp-1', amount: '1,250.00 บาท', item: 'ร้านกาแฟบ้านไร่', category: 'ค่าเดินทาง', status: 'ร่าง – รอตรวจสอบ' };
  const rowsOf = (message: { type: string }) => ((message as any).contents.body.contents as any[])
    .filter((entry) => entry.type === 'box')
    .map((box) => [box.contents[0].text, box.contents[1].text]);

  it('draws one row per fact, in a fixed order, with plain-Thai labels and no prose row', () => {
    const message = buildExpenseDraftCardMessage(CANONICAL, FULL, WEB, 'c1');
    assert.equal(message.type, 'flex');
    const contents = (message as any).contents;
    assert.equal(contents.header.contents[0].text, 'ร่างค่าใช้จ่าย');
    assert.deepEqual(rowsOf(message), [
      ['ยอดรวม', '1,250.00 บาท'],
      ['รายการ', 'ร้านกาแฟบ้านไร่'],
      ['หมวดหมู่', 'ค่าเดินทาง'],
      ['สถานะ', 'ร่าง – รอตรวจสอบ'],
    ]);
    // No wrapped-paragraph row survives beside the structured ones (§10.2).
    assert.deepEqual(contents.body.contents.filter((entry: any) => entry.type === 'text'), []);
  });

  it('omits every row the capture did not ground, and never substitutes a placeholder', () => {
    const message = buildExpenseDraftCardMessage(CANONICAL, { expenseId: 'exp-1', category: 'ค่าเดินทาง' }, WEB, 'c1');
    assert.deepEqual(rowsOf(message), [['หมวดหมู่', 'ค่าเดินทาง']]);
    assert.doesNotMatch(JSON.stringify((message as any).contents), /ยังไม่ระบุ|undefined|null/u);
    // Blank-but-present values are the same as absent: an empty Flex text element is not sent.
    assert.deepEqual(
      rowsOf(buildExpenseDraftCardMessage(CANONICAL, { expenseId: 'exp-1', amount: '  ', item: '', category: 'ค่าเดินทาง' }, WEB, 'c1')),
      [['หมวดหมู่', 'ค่าเดินทาง']],
    );
  });

  it('degrades to the generic text card when nothing at all is grounded', () => {
    const message = buildExpenseDraftCardMessage(CANONICAL, { expenseId: 'exp-1' }, WEB, 'c1');
    assert.equal(message.type, 'flex');
    assert.equal((message as any).contents.header.contents[0].text, 'ข้อมูลจากน้องมั่งมี');
    assert.match(JSON.stringify(message.contents), /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/u);
  });

  it('carries the CANONICAL reply as altText — the words the text reply and the Flex→text fallback use', () => {
    const message = buildExpenseDraftCardMessage(CANONICAL, FULL, WEB, 'c1');
    assert.equal(message.type === 'flex' && message.altText, CANONICAL);
    // Longer than the shared 400-character preview ceiling: VISIBLY marked, never silently cut.
    const long = `${'ก'.repeat(500)}`;
    const marked = buildExpenseDraftCardMessage(long, FULL, WEB, 'c1');
    assert.equal(marked.type === 'flex' && Array.from(marked.altText).length, 400);
    assert.ok(marked.type === 'flex' && marked.altText.endsWith('…'));
  });

  it('opens exactly the tenant expense record — no query, no hash, no financial parameter', () => {
    const action = (buildExpenseDraftCardMessage(CANONICAL, FULL, WEB, 'c1') as any).contents.footer.contents[0].action;
    assert.equal(action.type, 'uri');
    assert.equal(action.uri, 'https://app.example.com/companies/c1/expenses/exp-1');
    assert.equal(new URL(action.uri).search, '');
    assert.equal(new URL(action.uri).hash, '');
    // An untrusted base, or an id that cannot form a tenant path, loses the BUTTON — never the card.
    for (const [base, companyId, expenseId] of [
      [undefined, 'c1', 'exp-1'], ['javascript:alert(1)', 'c1', 'exp-1'], [WEB, '..', 'exp-1'], [WEB, 'c1', '../../c2/expenses/e9'],
    ] as Array<[string | undefined, string, string]>) {
      const card = (buildExpenseDraftCardMessage(CANONICAL, { ...FULL, expenseId }, base, companyId) as any).contents;
      const uri = card.footer?.contents[0]?.action?.uri;
      assert.ok(uri === undefined || uri === `${WEB}/companies/${encodeURIComponent(companyId)}/expenses/${encodeURIComponent(expenseId)}`, String(uri));
      assert.ok(card.body.contents.length > 0, 'the rows survive whatever happens to the link');
    }
  });

  it('passes Thai NFC text through byte-identically, in the rows and in the altText', () => {
    // NFC: base + tone/vowel marks as their own code points — normalising to NFKC would rewrite them.
    const item = 'ค่าน้ำมันรถ'.normalize('NFC');
    const message = buildExpenseDraftCardMessage(item, { ...FULL, item }, WEB, 'c1');
    assert.equal(rowsOf(message)[1]![1], item);
    assert.equal(message.type === 'flex' && message.altText, item);
    assert.equal(JSON.parse(JSON.stringify(message)).altText, item);
  });
});

describe('reimbursement intake cards — server-owned, never rendered from model text', () => {
  const BADGE = '📝 ยังไม่ได้สร้างรายการ';
  const bubbleOf = (message: { type: string }) => (message as any).contents;

  it('asks exactly who paid — personal pay to claim back, or the company — with no link and no amounts', () => {
    const message = buildReimbursementPayerClarificationMessage();
    assert.equal(message.type, 'flex');
    assert.ok(message.type === 'flex' && message.altText.length > 0);
    const contents = bubbleOf(message);
    assert.equal(contents.footer, undefined);
    assert.doesNotMatch(JSON.stringify(message), /"type":"uri"|https?:\/\//u);
    assert.equal(contents.body.contents.length, 1, 'one body row: no badge, no sources');
    const body = contents.body.contents[0].text as string;
    assert.match(body, /จ่ายเงินส่วนตัว.*เบิกคืน/u, 'option one: paid personally, wants it back');
    assert.match(body, /บริษัท.*จ่ายเอง/u, 'option two: the company paid');
    assert.doesNotMatch(body, /\d|บาท|THB/u, 'no financial fields');
  });

  it('hands off to the exact new-reimbursement page on the trusted origin and says no record exists yet', () => {
    const message = buildReimbursementHandoffMessage('https://app.example.com/base', 'c1');
    assert.equal(message.type, 'flex');
    const contents = bubbleOf(message);
    assert.equal(contents.body.contents[0].text, BADGE);
    assert.match(contents.body.contents[1].text, /ตรวจสอบ.*กรอก/u, 'the body sends the user to review and fill in the web');
    assert.equal(contents.footer.contents.length, 1);
    const action = contents.footer.contents[0].action;
    assert.equal(action.type, 'uri');
    assert.equal(action.uri, 'https://app.example.com/companies/c1/reimbursements/new');
    const uri = new URL(action.uri);
    assert.equal(uri.origin, 'https://app.example.com');
    assert.equal(uri.search, '', 'no query prefill');
    assert.equal(uri.hash, '', 'no hash');
  });

  it('keeps the card but drops the button when the web base is missing or untrusted', () => {
    for (const base of [undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://app.example.com']) {
      const message = buildReimbursementHandoffMessage(base, 'c1');
      assert.equal(message.type, 'flex', String(base));
      const contents = bubbleOf(message);
      assert.equal(contents.footer, undefined, String(base));
      assert.equal(contents.body.contents[0].text, BADGE, String(base));
      assert.doesNotMatch(JSON.stringify(message), /"type":"uri"/u, String(base));
    }
  });

  it('cannot be steered to another tenant or another page by the company id', () => {
    const hostile = ['c1/../c2', '..', '.', 'c1/reimbursements/../../c2', 'c1\\..\\c2', 'c1%2F..%2Fc2', 'c1?x=1', 'c1#frag', 'c 1'];
    for (const companyId of hostile) {
      const action = bubbleOf(buildReimbursementHandoffMessage('https://app.example.com', companyId)).footer?.contents[0]?.action;
      if (!action) continue;
      assert.equal(action.uri, `https://app.example.com/companies/${encodeURIComponent(companyId)}/reimbursements/new`, companyId);
      assert.equal(new URL(action.uri).search, '', companyId);
      assert.equal(new URL(action.uri).hash, '', companyId);
    }
    // Traversal never gets a button at all; an odd-but-honest id gets exactly its encoded tenant path.
    for (const traversing of ['c1/../c2', '..', '.', 'c1\\..\\c2']) {
      assert.equal(bubbleOf(buildReimbursementHandoffMessage('https://app.example.com', traversing)).footer, undefined, traversing);
    }
    const spaced = bubbleOf(buildReimbursementHandoffMessage('https://app.example.com', 'c 1')).footer.contents[0].action.uri;
    assert.equal(spaced, 'https://app.example.com/companies/c%201/reimbursements/new');
  });
});
