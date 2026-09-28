import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LineAiTurnResponse } from '@watchdog-bms/contracts';
import {
  buildExpenseDraftCardMessage,
  buildAiBudgetExceededMessage,
  buildLineAssistantTextCardMessage,
  buildLineBusinessAnswerMessage,
  buildReceiptQuotaExceededMessage,
  buildReimbursementHandoffMessage,
  buildReimbursementPayerClarificationMessage,
} from './line-business-card.logic';

const response = (cards?: NonNullable<LineAiTurnResponse['presentation']>['cards']): LineAiTurnResponse => ({
  requestId: 'r1', replyText: cards?.map(card => card.text).join('\n\n') ?? 'fallback', sourceRefs: [], sourceLabels: [], webLinks: [],
  intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: ['company.get_current_context'], durationMs: 1,
  ...(cards ? { presentation: { kind: 'answer_cards', cards } } : {}),
});

describe('LINE business answer card renderer', () => {
  it('returns a fallback card when presentation is absent', () => {
    const message = buildLineBusinessAnswerMessage({ ...response(), toolsInvoked: ['expense.list_recent'] }, 'plain fallback', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'flex');
    assert.match(JSON.stringify(message), /fallback/);
    assert.doesNotMatch(JSON.stringify(message), /plain fallback/);
    assert.equal((message.contents as any).header.contents[0].text, 'น้องมั่งมีสรุปค่าใช้จ่ายให้นะคะ');
  });

  it('keeps full cardless reply, source basis and only a safe tenant link', () => {
    const message = buildLineBusinessAnswerMessage({
      ...response(), replyText: 'ยอด 500 บาท\nยังไม่รวมรายการที่รอตรวจสอบ', sourceLabels: ['ค่าใช้จ่าย'],
      webLinks: [
        { label: 'เปิดค่าใช้จ่าย', path: '/companies/c1/expenses' },
        { label: 'ห้ามเปิด', path: '/companies/c2/expenses' },
      ],
    }, 'ignored fallback', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'flex');
    assert.match(message.canonicalText ?? '', /ยังไม่รวมรายการที่รอตรวจสอบ/);
    assert.match(message.canonicalText ?? '', /แหล่งข้อมูล: ค่าใช้จ่าย/);
    assert.match(message.canonicalText ?? '', /https:\/\/app\.example\.com\/companies\/c1\/expenses/);
    assert.doesNotMatch(message.canonicalText ?? '', /companies\/c2/);
  });

  it('uses trusted contextual headings and preserves explicit titles', () => {
    for (const [tools, expected] of [
      [['expense.list_recent'], 'น้องมั่งมีสรุปค่าใช้จ่ายให้นะคะ'],
      [['expense.list_recent', 'expense.get_detail'], 'น้องมั่งมีสรุปค่าใช้จ่ายให้นะคะ'],
      [['sales.get_sales_summary'], 'น้องมั่งมีสรุปยอดขายให้นะคะ'],
      [['expense.list_recent', 'sales.get_sales_summary'], 'น้องมั่งมีสรุปให้นะคะ'],
      [['unknown.read'], 'น้องมั่งมีสรุปให้นะคะ'],
      [[], 'น้องมั่งมีสรุปให้นะคะ'],
    ] as const) {
      const result = buildLineBusinessAnswerMessage({ ...response([{ text: 'ข้อมูล 7 รายการ', title: '  ' }]), toolsInvoked: [...tools] }, 'fallback', undefined, 'c1');
      assert.equal(result.type, 'flex');
      assert.equal((result.contents as any).header.contents[0].text, expected);
    }
    const explicit = buildLineBusinessAnswerMessage(response([{ title: 'สรุปปิดร้าน', text: 'ข้อมูล' }]), 'fallback', undefined, 'c1');
    assert.equal(explicit.type, 'flex');
    assert.equal((explicit.contents as any).header.contents[0].text, 'สรุปปิดร้าน');
  });

  it('fails closed to a trusted fallback card when a refused response unexpectedly carries cards', () => {
    const refused = { ...response([{ text: 'ข้อมูลที่ห้ามแสดง' }]), replyText: 'ไม่มีสิทธิ์', refused: true };
    const message = buildLineBusinessAnswerMessage(refused, 'ไม่มีสิทธิ์', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'flex');
    assert.match(JSON.stringify(message), /ไม่มีสิทธิ์/);
    assert.doesNotMatch(JSON.stringify(message), /ข้อมูลที่ห้ามแสดง/);
    assert.equal((message.contents as any).header.contents[0].text, 'น้องมั่งมีแจ้งให้ทราบนะคะ');
  });

  it('does not infer capture success from intent when no tool or a failed tool produced no presentation', () => {
    const errorReply = '⏳ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ';
    const capture: LineAiTurnResponse = { ...response(), intent: 'capture_accounting_evidence', refused: false, toolsInvoked: [], replyText: errorReply };
    const failed: LineAiTurnResponse = { ...capture, toolsInvoked: ['accounting.capture_receipt_evidence'], toolCalls: [{ name: 'accounting.capture_receipt_evidence', status: 'error', durationMs: 1, errorCode: 'TOOL_TIMEOUT' }] };
    for (const result of [capture, failed]) {
      const message = buildLineBusinessAnswerMessage(result, errorReply, undefined, 'c1');
      assert.equal(message.type, 'flex');
      assert.equal((message.contents as any).header.contents[0].text, 'น้องมั่งมีตอบให้นะคะ');
      assert.equal((message.contents as any).body.contents[0].text, errorReply);
      assert.doesNotMatch((message.contents as any).header.contents[0].text, /รับข้อมูลแล้ว|บันทึก.*แล้ว|สำเร็จ/);
    }
    const explicit = buildLineBusinessAnswerMessage({ ...failed, presentation: { kind: 'answer_cards', cards: [{ title: 'กรุณาตรวจสอบข้อมูล', text: errorReply }] } }, errorReply, undefined, 'c1');
    assert.equal(explicit.type, 'flex');
    assert.equal((explicit.contents as any).header.contents[0].text, 'กรุณาตรวจสอบข้อมูล');
    assert.equal((explicit.contents as any).body.contents[0].text, errorReply);
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
    assert.match(json, /#15803D/);
    assert.match(json, /#1A2E22/);
    assert.match(json, /https:\/\/app\.example\.com\/companies\/c1\/expenses\?month=2026-07/);
    assert.match(json, /แหล่งข้อมูล: ค่าใช้จ่าย/);
    assert.equal(message.type === 'flex' && message.canonicalText,
      'ยังไม่มีค่าใช้จ่าย รวม 0.00 บาท\n\nค่าใช้จ่ายเดือนนี้\n\nแหล่งข้อมูล: ค่าใช้จ่าย\n\nเปิดดู: เปิดค่าใช้จ่าย https://app.example.com/companies/c1/expenses?month=2026-07');
  });

  it('uses complete text when a carousel would omit the thirteenth card', () => {
    const cards = Array.from({ length: 14 }, (_, index) => ({ title: `คำตอบ ${index + 1}`, text: `ข้อมูล ${index + 1}` }));
    const message = buildLineBusinessAnswerMessage(response(cards), 'fallback', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'text');
    assert.match(message.text, /คำตอบ 14/);
    assert.match(message.text, /ข้อมูล 14/);
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
      assert.doesNotMatch(JSON.stringify(message), /evil\.example|companies\/c2|%2f|\.\.\//i, path);
    }
  });

  it('uses complete text rather than hiding card body overflow', () => {
    const message = buildLineBusinessAnswerMessage(response([{ title: 'หัวข้อ', text: '🌱'.repeat(2_000) }]), 'fallback', undefined, 'c1');
    assert.equal(message.type, 'text');
    assert.equal(Array.from(message.text.match(/🌱/gu) ?? []).length, 2_000);
  });

  it('falls back to complete text when reply caveats are absent from the cards', () => {
    const message = buildLineBusinessAnswerMessage({
      ...response([{ title: 'ค่าใช้จ่ายเดือนนี้', text: 'รวม 500 บาท' }]),
      replyText: 'รวม 500 บาท\nยังไม่รวมรายการที่รอตรวจสอบ',
    }, 'fallback', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'text');
    assert.match(message.text, /ยังไม่รวมรายการที่รอตรวจสอบ/);
    assert.match(message.text, /ค่าใช้จ่ายเดือนนี้/);
  });

  it('deduplicates only exact blocks so a short distinct card fact is retained', () => {
    const message = buildLineBusinessAnswerMessage({
      ...response([{ title: 'ยอด', text: '500 บาท' }]),
      replyText: 'ยอดรวม 1,500 บาท',
    }, 'fallback', undefined, 'c1');
    assert.equal(message.type, 'text');
    assert.match(message.text, /ยอดรวม 1,500 บาท\n\nยอด\n\n500 บาท/);
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

describe('receipt quota card (P10-L §3.7/§7)', () => {
  it('sends the two §7 buttons as chat commands, not links out of the conversation', () => {
    const message = buildReceiptQuotaExceededMessage('ช่วงทดลองให้ AI อ่านรูปได้ 15 ครั้ง ตอนนี้ครบแล้วค่ะ (ใบเสร็จ 1 ใบ = 1 ครั้ง) ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย');
    assert.equal(message.type, 'flex');
    const bubble = message.contents as any;
    assert.deepEqual(bubble.footer.contents.map((button: any) => button.action), [
      // `โปรโมชั่น` is the command the webhook already answers with the promotion card (pull, §3.7).
      { type: 'message', label: 'ดูแพ็กเกจ', text: 'โปรโมชั่น' },
      { type: 'message', label: 'ขอเปลี่ยนแพ็กเกจ', text: 'ขอเปลี่ยนแพ็กเกจ' },
    ]);
  });

  it('keeps the spoken sentence as altText, so the chat preview reads as the same words', () => {
    const text = 'ช่วงทดลองให้ AI อ่านรูปได้ 10 ครั้ง ตอนนี้ครบแล้วค่ะ (ใบเสร็จ 1 ใบ = 1 ครั้ง) ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย';
    const message = buildReceiptQuotaExceededMessage(text);
    assert.equal(message.type, 'flex');
    assert.equal((message as { altText: string }).altText, text);
    assert.equal((message as { contents: any }).contents.body.contents[1].text, text);
  });
});

describe('CHAT budget refusal card', () => {
  it('does not suggest a package change as a same-month chat-credit refill', () => {
    for (const budgetErrorCode of ['AI_MONTHLY_BUDGET_EXCEEDED', 'AI_BUDGET_INSUFFICIENT']) {
      const message = buildAiBudgetExceededMessage(false, { budgetErrorCode, budgetScope: 'CHAT' });
      const rendered = JSON.stringify(message);
      assert.match(rendered, /เครดิต AI ส่วนแชต/);
      assert.match(rendered, /ไม่เติมเครดิตแชตในเดือนนี้/);
      assert.match(rendered, /ติดต่อเจ้าหน้าที่/);
      assert.doesNotMatch(rendered, /ดูแพ็กเกจ|ขอเปลี่ยนแพ็กเกจ|โปรโมชั่น/);
      assert.deepEqual(((message as any).contents).footer.contents.map((item: any) => item.action), [
        { type: 'message', label: 'ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' },
      ]);
    }
  });

  it('keeps the existing package actions for a TOTAL refusal', () => {
    const rendered = JSON.stringify(buildAiBudgetExceededMessage(false,
      { budgetErrorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' }));
    assert.match(rendered, /ขอเปลี่ยนแพ็กเกจ/);
    assert.match(rendered, /"label":"ดูแพ็กเกจ"/);
  });
});
