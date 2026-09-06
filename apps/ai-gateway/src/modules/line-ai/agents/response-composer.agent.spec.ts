import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_CAPABILITY_REPLY_PREFIXES } from '@watchdog-bms/contracts';
import { CASUAL_CONVERSATION_SYSTEM_PROMPT, ResponseComposerAgent, isExplicitJokeAsk, isJokeRequest, isTeachingRequest } from './response-composer.agent';
import { MANGMEE_JOKE_BANK } from './mangmee-joke-bank';
import type { IModelProvider, ProviderOutput } from '../infrastructure/provider/provider.port';

// Stub provider: receives the JSON `{ language, reply }` the language layer sends and returns
// whatever ProviderOutput the test wants, so we can exercise the grounding guard directly.
function stubProvider(reply: (groundedReply: string, language: string) => ProviderOutput): IModelProvider {
  return {
    async generateText({ messages }) {
      const { reply: grounded, language } = JSON.parse(messages[0]!.text) as { reply: string; language: string };
      return reply(grounded, language);
    },
  };
}

const GROUNDED = '• ยอดทั้งหมด: 11,875.00\n• ยังไม่จ่าย: 0';

describe('ResponseComposerAgent – Nong Mangmee zero-tool replies', () => {
  const agent = new ResponseComposerAgent();

  it('describes capabilities without claiming that every feature is available', () => {
    const reply = agent.composeCapabilityHelp('ทำอะไรได้บ้าง', 'th', 'th-TH', { permissions: ['accounting.document.read', 'expense.read'] });
    assert.match(reply, /ยอดขาย/);
    assert.match(reply, /ขึ้นกับสิทธิ์และฟีเจอร์/);
    assert.match(reply, /ต้องทำบนเว็บ/);
  });

  // UAT 2026-08-18: the answer listed every module the product has, so a company that never
  // switched sales/CRM/tax on was offered them and got "คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้" next turn.
  it('offers only the capabilities this member can actually reach', () => {
    const reply = agent.composeCapabilityHelp('ทำอะไรได้บ้าง', 'th', 'th-TH', { permissions: ['expense.read', 'expense.receipt.line_upload'] });
    assert.match(reply, /ค่าใช้จ่ายและใบเสร็จ/);
    assert.match(reply, /ส่งรูปใบเสร็จ/);
    assert.doesNotMatch(reply, /ยอดขาย/);
    assert.doesNotMatch(reply, /ภาษี/);
    assert.doesNotMatch(reply, /ลูกค้า/);
  });

  it('does not invent capabilities for a member whose permissions open nothing', () => {
    const reply = agent.composeCapabilityHelp('ทำอะไรได้บ้าง', 'th', 'th-TH', { permissions: [] });
    assert.match(reply, /ติดต่อผู้ดูแลระบบของบริษัท/);
    assert.doesNotMatch(reply, /•/);
  });

  it('keeps the English answer permission-scoped too', () => {
    const reply = agent.composeCapabilityHelp('what can you do', 'en', 'en-US', { permissions: ['inventory.product.read', 'inventory.report.read'] });
    assert.match(reply, /products and stock/);
    assert.doesNotMatch(reply, /sales/);
  });

  it('names the disabled business capability without leaking keys, links, or permission wording', () => {
    const reply = agent.compose({
      status: 'UNROUTABLE', language: 'th', intents: [], requiresHumanReview: false,
      refusals: [{ request: 'ของอะไรใกล้หมด', reason: 'feature_disabled' }],
    }, [], 'ของอะไรใกล้หมด', 'th-TH', { featureDisabledTools: ['inventory.list_low_stock'] });
    assert.match(reply.replyText, /ระบบคลังสินค้า/);
    assert.equal(reply.replyText.includes('ไม่มีสิทธิ์'), false);
    assert.equal(reply.replyText.includes('inventory'), false);
    assert.deepEqual(reply.sourceRefs, []);
    assert.deepEqual(reply.webLinks, []);
  });

  it('keeps feature-disabled and genuine permission reasons distinct when both clauses are blocked', () => {
    const reply = agent.compose({
      status: 'UNROUTABLE', language: 'th', intents: [], requiresHumanReview: false,
      refusals: [
        { request: 'ของอะไรใกล้หมด', reason: 'feature_disabled' },
        { request: 'ขอดูข้อมูลลูกค้า', reason: 'forbidden' },
      ],
    }, [], 'ของอะไรใกล้หมด และขอดูข้อมูลลูกค้า', 'th-TH', { featureDisabledTools: ['inventory.list_low_stock'] });
    assert.match(reply.replyText, /ระบบคลังสินค้า/);
    assert.match(reply.replyText, /ไม่มีสิทธิ์/);
    assert.deepEqual(reply.sourceRefs, []);
    assert.deepEqual(reply.webLinks, []);
  });

  it('declines product recommendations instead of substituting stock or aggregate sales', () => {
    const reply = agent.compose({
      status: 'UNROUTABLE', language: 'th', intents: [], requiresHumanReview: false,
      refusals: [{ request: 'ช่วงนี้ควรขายอะไรดี', reason: 'unsupported_module' }],
    }, [], 'ช่วงนี้ควรขายอะไรดี');
    assert.match(reply.replyText, /ยอดขาย กำไร และสต็อก/);
    assert.deepEqual(reply.webLinks, []);
  });

  it('uses the warm female employee persona for pure casual conversation', async () => {
    let capturedSystemPrompt = '';
    let capturedPayload: any;
    const provider: IModelProvider = {
      async generateText(input) {
        capturedSystemPrompt = input.systemPrompt ?? '';
        capturedPayload = JSON.parse(input.messages[0]!.text);
        return { ok: true, text: 'เหนื่อยมานิดหน่อยสินะคะ พักหายใจแป๊บหนึ่งก็ได้นะคะ 😊' };
      },
    };
    const reply = await agent.composeCasual('วันนี้เหนื่อยจัง', provider, {
      conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [{ at: '2026-08-15T10:00:00.000Z', userMessagePreview: 'สวัสดี' }] },
    });
    assert.equal(reply, 'เหนื่อยมานิดหน่อยสินะคะ พักหายใจแป๊บหนึ่งก็ได้นะคะ 😊');
    assert.equal(capturedSystemPrompt, CASUAL_CONVERSATION_SYSTEM_PROMPT);
    assert.equal(capturedPayload.messageText, 'วันนี้เหนื่อยจัง');
    assert.equal(capturedPayload.conversationContext.recentTurns.length, 1);
  });

  it('falls back safely when casual generation is unavailable', async () => {
    const provider: IModelProvider = { generateText: async () => ({ ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'timeout', retryable: true } }) };
    assert.match(await agent.composeCasual('สวัสดี', provider), /น้องมั่งมี/);
  });

  it('drops an incomplete long tail instead of sending a sentence cut mid-word', async () => {
    const provider: IModelProvider = {
      generateText: async () => ({
        ok: true,
        text: `${'เข้าใจเลยค่ะ '.repeat(18)}\nช่วงนี้งานเยอะเป็นพิเศษ หรือรู้สึกหมดแรงมาสักพักแล้`,
      }),
    };
    const reply = await agent.composeCasual('ช่วงนี้หมดไฟ', provider);
    assert.ok(!reply.endsWith('แล้'));
    assert.ok(reply.length <= 320);
  });

  it('keeps only completed sentences when the provider stops at max tokens below the character cap', async () => {
    const provider: IModelProvider = {
      generateText: async () => ({
        ok: true,
        stopReason: 'max_tokens',
        text: 'ได้เลยค่ะ 😄 เรื่องคลาสสิกในออฟฟิศ: ใครเอาข้าวเพื่อนออกจากตู้เย็น แล้วไม่มีใครสารภาพสักคน ทั้งที่กล้องวงจรปิดก็อยู่ตรงนั้น! 🍱📹 บางทีความลับที่ลึกที่สุดคือ "ใครกินข้า',
      }),
    };
    const reply = await agent.composeCasual('ขอเรื่องเม้าท์ขำๆ แบบไม่พาดพิงใครหน่อย', provider);
    assert.equal(reply, 'ได้เลยค่ะ 😄 เรื่องคลาสสิกในออฟฟิศ: ใครเอาข้าวเพื่อนออกจากตู้เย็น แล้วไม่มีใครสารภาพสักคน ทั้งที่กล้องวงจรปิดก็อยู่ตรงนั้น!');
  });
});

// Owner 2026-08-30: jokes come from a curated bank first, so the model stops reaching for nerd
// humour. The bank is customer-facing copy — these invariants are what a future curator's new
// entry has to survive.
describe('MANGMEE_JOKE_BANK – curated Thai joke bank', () => {
  const CATEGORIES = ['กวน', 'ซีรีส์', 'วาย', 'ยุทธภพ', 'ไอดอล', 'กระแส'];

  it('is non-empty and every entry is well formed', () => {
    assert.ok(MANGMEE_JOKE_BANK.length > 0);
    for (const joke of MANGMEE_JOKE_BANK) {
      assert.ok(joke.id.trim().length > 0, `empty id: ${JSON.stringify(joke)}`);
      assert.ok(CATEGORIES.includes(joke.category), `bad category: ${joke.category}`);
      assert.ok(joke.text.trim().length > 0, `empty text: ${joke.id}`);
      assert.ok(joke.text.length <= 200, `${joke.id} is ${joke.text.length} chars, over the 200 cap`);
    }
  });

  it('has unique ids and no duplicated joke', () => {
    assert.equal(new Set(MANGMEE_JOKE_BANK.map((joke) => joke.id)).size, MANGMEE_JOKE_BANK.length);
    assert.equal(new Set(MANGMEE_JOKE_BANK.map((joke) => joke.text)).size, MANGMEE_JOKE_BANK.length);
  });

  // A category with one or two lines gets repetitive within a single conversation.
  it('carries at least 4 entries in every category except the deliberately empty กระแส', () => {
    for (const category of CATEGORIES.filter((c) => c !== 'กระแส')) {
      const count = MANGMEE_JOKE_BANK.filter((joke) => joke.category === category).length;
      assert.ok(count >= 4, `${category} has only ${count} entries`);
    }
  });
});

describe('isJokeRequest – gates the bank onto the prompt', () => {
  it('is true for a Thai or English ask for a joke', () => {
    for (const text of ['มีมุขอื่นอีกไหม', 'ขอมุกหน่อย', 'เล่าอะไรตลกให้ฟังหน่อย', 'เล่าอะไรฮา', 'ขอเรื่องขำๆ หน่อยค่ะ', 'tell me a joke']) {
      assert.equal(isJokeRequest(text), true, text);
    }
  });

  it('is false for ordinary chit-chat and business asks', () => {
    for (const text of ['สวัสดีค่ะ', 'ขอบคุณมากนะคะ', 'วันนี้เหนื่อยจัง', 'ค่าใช้จ่ายเดือนนี้เท่าไหร่', 'ยอดขายวันนี้', 'อยากกินชานมไข่มุก']) {
      assert.equal(isJokeRequest(text), false, text);
    }
  });

  // The strict form backs the orchestrator's refusal-rescue, where a false positive turns an honest
  // refusal into a punchline. Probe run 2026-08-31: the loose test reads all five "leak" lines below
  // as jokes; the strict one must not, while still catching every real ask the loose one catches.
  it('isExplicitJokeAsk catches every real joke ask', () => {
    for (const text of [
      'ขอมุขตลกหน่อย', 'เล่ามุขให้ฟังหน่อย', 'มีมุขตลกไหม', 'เล่นมุขหน่อย', 'อีกมุขนึง', 'ขอมุกหน่อย',
      'ขอเรื่องตลกหน่อย', 'เล่าอะไรตลกให้ฟังหน่อย', 'ขอเรื่องขำๆ', 'มีอะไรฮาไหม', 'tell me a joke',
    ]) {
      assert.equal(isExplicitJokeAsk(text), true, text);
    }
  });

  it('isExplicitJokeAsk refuses the Thai substring collisions the loose test leaks', () => {
    for (const text of [
      'ส่งของไปมุกดาหารกี่บาท', 'ลูกค้าที่มุกดาหารสั่งของ', 'ราคาฮาร์ดแวร์เท่าไหร่', 'ไปฮานอยยังไง',
      'พนักงานชื่อขำลาป่วย', 'ขายมุกประดับได้ไหม', 'ชานมไข่มุกเหลือกี่แก้ว',
      'ค่าใช้จ่ายเดือนนี้เท่าไหร่', 'สวัสดีครับ', 'อากาศวันนี้เป็นไง',
    ]) {
      assert.equal(isExplicitJokeAsk(text), false, text);
    }
  });

  it('appends the bank to the casual prompt ONLY when a joke is asked for', async () => {
    const agent = new ResponseComposerAgent();
    let seen = '';
    const provider: IModelProvider = {
      async generateText(input) {
        seen = input.systemPrompt ?? '';
        return { ok: true, text: 'ได้เลยค่ะ 😊' };
      },
    };
    await agent.composeCasual('ขอมุกหน่อย', provider);
    assert.match(seen, /Joke bank — hybrid/);
    // Owner 2026-08-31: composition from the moment is first-class, the bank is the quality bar.
    assert.match(seen, /COMPOSE a fresh joke/);
    assert.ok(seen.includes(MANGMEE_JOKE_BANK[0]!.text), 'bank entries ride the joke turn');
    await agent.composeCasual('วันนี้อากาศดีนะ', provider);
    assert.equal(seen, CASUAL_CONVERSATION_SYSTEM_PROMPT, 'ordinary casual turns must not pay for the bank');
  });
});

describe('ResponseComposerAgent.polishLanguage (grounded language layer)', () => {
  const agent = new ResponseComposerAgent();

  it('uses the model wording when it preserves the grounded numbers', async () => {
    const provider = stubProvider((grounded) => ({ ok: true, text: `สรุปค่าใช้จ่าย: ${grounded.replace(/•/g, '-')}` }));
    const out = await agent.polishLanguage(GROUNDED, provider, { messageText: 'ดูค่าใช้จ่าย' });
    assert.ok(out.startsWith('สรุปค่าใช้จ่าย:'), 'model wording is used');
    assert.ok(out.includes('11,875.00'), 'grounded amount is preserved');
  });

  it('falls back to grounded text when the model invents a number', async () => {
    const provider = stubProvider(() => ({ ok: true, text: '• ยอดทั้งหมด: 99,999.00' }));
    const out = await agent.polishLanguage(GROUNDED, provider, {});
    assert.equal(out, GROUNDED);
  });

  it('falls back to grounded text when the provider is unavailable', async () => {
    const provider = stubProvider(() => ({ ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'timeout', retryable: true } }));
    const out = await agent.polishLanguage(GROUNDED, provider, {});
    assert.equal(out, GROUNDED);
  });

  it('strips code fences/quotes from model output', async () => {
    const provider = stubProvider((grounded) => ({ ok: true, text: '```\n' + grounded + '\n```' }));
    const out = await agent.polishLanguage(GROUNDED, provider, {});
    assert.equal(out, GROUNDED);
  });

  it('does not call the model for an empty grounded reply', async () => {
    let called = false;
    const provider = stubProvider(() => { called = true; return { ok: true, text: 'x' }; });
    const out = await agent.polishLanguage('   ', provider, {});
    assert.equal(out, '   ');
    assert.equal(called, false, 'no model call for empty reply');
  });

  it('rejects a runaway/expanded reply', async () => {
    const provider = stubProvider((grounded) => ({ ok: true, text: grounded + ''.padEnd(2000, 'ก') }));
    const out = await agent.polishLanguage(GROUNDED, provider, {});
    assert.equal(out, GROUNDED);
  });

  it('falls back when wording inverts a nonnumeric payment status', async () => {
    const provider = stubProvider(() => ({ ok: true, text: '• ยอดทั้งหมด: 11,875.00\n• จ่ายแล้ว: 0' }));
    assert.equal(await agent.polishLanguage(GROUNDED, provider, {}), GROUNDED);
  });

  it('falls back when wording invents a nonnumeric entity name', async () => {
    const grounded = '• ลูกค้า: Alice\n• สถานะ: UNPAID';
    const provider = stubProvider(() => ({ ok: true, text: 'ลูกค้า Bob ยังไม่จ่าย' }));
    assert.equal(await agent.polishLanguage(grounded, provider, {}), grounded);
  });
});

// Owner decision 2026-07-03: text business-read answers are model-composed from raw tool data.
describe('ResponseComposerAgent.composeAnswer (model-composed grounded answer)', () => {
  const agent = new ResponseComposerAgent();
  const FALLBACK = '• สาขาทั้งหมด: 2 สาขา';
  const TOOL_DATA = [{
    tool: 'company.list_branches',
    data: { total: 2, branches: [{ code: 'HO', name: 'Head Office', type: 'HEAD_OFFICE' }, { code: 'BKK01', name: 'สาขาลาดพร้าว', type: 'BRANCH' }], scopedBranchNames: [] },
  }];

  function answerProvider(text: string | ((payload: { question: string; systemData: unknown }) => string), ok = true): IModelProvider {
    return {
      async generateText({ messages }) {
        if (!ok) return { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'timeout', retryable: true } };
        const payload = JSON.parse(messages[0]!.text) as { question: string; systemData: unknown };
        return { ok: true, text: typeof text === 'function' ? text(payload) : text };
      },
    };
  }

  it('uses the model answer when its numbers come from the tool data', async () => {
    const provider = answerProvider('บริษัทมีทั้งหมด 2 สาขา: Head Office และ สาขาลาดพร้าว');
    const out = await agent.composeAnswer('มีกี่สาขา', TOOL_DATA, FALLBACK, provider);
    assert.ok(out.includes('2 สาขา'));
    assert.ok(out.includes('สาขาลาดพร้าว'));
  });

  it('falls back when a count explicitly requested by the user is omitted', async () => {
    const data = [{ tool: 'sales.get_sales_summary', data: { totalSales: '125430.50', transactionCount: 7 } }];
    const fallback = '• ยอดรับเงินจริง: 125430.50 บาท\n• จำนวนรายการ: 7 รายการ';
    const out = await agent.composeAnswer(
      'ยอดขายเดือนนี้เท่าไหร่ มีกี่รายการ',
      data,
      fallback,
      answerProvider('ยอดรับเงินจริงเดือนนี้ 125430.50 บาทค่ะ'),
    );
    assert.equal(out, fallback);
  });

  it('accepts value-equal number reformatting (85 vs 85.0000)', async () => {
    const data = [{ tool: 'sales.get_sales_summary', data: { totalSales: '85.0000' } }];
    const provider = answerProvider('ยอดขายรวม 85 บาท');
    const out = await agent.composeAnswer('ยอดขายเท่าไหร่', data, FALLBACK, provider);
    assert.equal(out, 'ยอดขายรวม 85 บาท');
  });

  const expenseData = [{ tool: 'expense.list_recent', data: {
    total: 7,
    period: { fromDate: '2026-08-01', toDate: '2026-08-31' },
    summary: { countedItems: 7, cancelledCount: 1, totalAmount: '85.00', pendingAmount: '15.00' },
    items: [{ vendorNameSnapshot: 'Synthetic Vendor', grandTotalAmount: '40.00' }, { status: 'REJECTED', grandTotalAmount: '10.00' }],
  } }];
  const expenseFallback = '• ยอดทั้งหมด: 85.00 บาท\n• รอตรวจสอบ: 15.00 บาท\n• รายการค่าใช้จ่ายล่าสุด: Synthetic Vendor 40.00 บาท';

  it('keeps the canonical expense total concise without model composition', async () => {
    let calls = 0;
    const output = await agent.composeAnswer('ดูค่าใช้จ่ายเดือนนี้', expenseData, expenseFallback, answerProvider(() => {
      calls += 1;
      return 'ค่าใช้จ่าย 999 บาท';
    }));
    assert.equal(output, '• ยอดรวม: 85.00 บาท');
    assert.equal(calls, 0, 'the source total is authoritative before the provider');
    assert.equal(await agent.composeAnswer('ยอดค่าใช้จ่ายเท่าไหร่', expenseData, expenseFallback, answerProvider('', false)), output);
  });

  for (const question of [
    'ค่าใช้จ่ายเดือนนี้กี่บาท',
    'ค่าใช้จ่ายเดือนนี้กี่ บาท',
    'จำนวนเงินค่าใช้จ่ายเดือนนี้เท่าไหร่',
    'ค่าใช้จ่ายเดือนนี้มีจำนวน เงินเท่าไหร่',
    'what is the expense total this month?',
    'summarize expenses this month',
  ]) {
    it(`amount wording golden: ${question}`, async () => {
      let calls = 0;
      const output = await agent.composeAnswer(question, expenseData, expenseFallback, answerProvider(() => {
        calls += 1;
        return 'ยอดค่าใช้จ่ายรวม 85 บาท';
      }));
      assert.equal(calls, 0, 'money wording uses the canonical amount-only answer');
      assert.equal(output, '• ยอดรวม: 85.00 บาท', 'reuse the existing source line, including its currency and language');
      assert.doesNotMatch(output, /7|15|Synthetic Vendor|รายการ/);
      assert.equal(await agent.composeAnswer(question, expenseData, expenseFallback, answerProvider('', false)), '• ยอดรวม: 85.00 บาท');
    });
  }

  for (const { question, candidate, opts } of [
    { question: 'ค่าใช้จ่ายเดือน 8 ปี 2026 กี่บาท', candidate: 'ค่าใช้จ่ายทั้งหมด 2026 บาท', opts: {} },
    { question: 'what is the expense total for August 2026?', candidate: 'Expense total 2026', opts: {} },
    { question: 'ยอดค่าใช้จ่ายเดือนนี้เท่าไหร่', candidate: 'ค่าใช้จ่ายทั้งหมด 2026 บาท', opts: { currentDate: '2026-08-27' } },
    {
      question: 'ยอดค่าใช้จ่ายเดือนนี้เท่าไหร่', candidate: 'ค่าใช้จ่ายทั้งหมด 150 บาท',
      opts: { conversationContext: {
        windowMinutes: 15, maxTurns: 15,
        recentTurns: [{ at: '2026-08-27T10:00:00.000Z', userMessagePreview: 'ค่ากาแฟ 150 บาท', assistantReplyPreview: 'บันทึกแล้ว 150 บาท', refused: false }],
      } },
    },
    {
      question: 'หกสิบบาทคือยอดค่าใช้จ่ายเดือนนี้ไหม', candidate: 'ค่าใช้จ่ายทั้งหมด 60 บาท',
      opts: { valueCandidates: extractValueCandidates('หกสิบบาทคือยอดค่าใช้จ่ายเดือนนี้ไหม', '2026-08-27') },
    },
  ]) {
    it(`keeps the current expense total instead of a date/context/candidate amount: ${question} / ${candidate}`, async () => {
      let calls = 0;
      // Nonempty preview exposes the old numeric-role bug; the empty-data guard cannot mask it.
      const output = await agent.composeAnswer(question, expenseData, expenseFallback, answerProvider(() => {
        calls += 1;
        return candidate;
      }), opts);
      assert.equal(output, '• ยอดรวม: 85.00 บาท');
      assert.notEqual(output, candidate);
      assert.equal(calls, 0, 'an allowed number is not authority to replace the current monetary total');
    });
  }

  for (const question of [
    'ค่าใช้จ่ายเดือนนี้มีกี่ใบ',
    'ค่าใช้จ่ายเดือนนี้มีกี่รายการ',
    'ขอจำนวนค่าใช้จ่ายเดือนนี้',
    'how many expenses this month?',
    'count expenses this month',
    'ยอดค่าใช้จ่ายเดือนนี้เท่าไหร่ มีกี่ใบ',
    'ค่าใช้จ่ายเดือนนี้กี่บาท มีกี่ใบ',
    'ค่าใช้จ่ายเดือนนี้มีกี่ใบ จำนวนเงินเท่าไหร่',
  ]) {
    it(`count golden: ${question}`, async () => {
      const output = await agent.composeAnswer(question, expenseData, expenseFallback, {
        generateText: async () => { throw new Error('count labels must stay deterministic'); },
      });
      assert.match(output, /: 7 (?:รายการ|records)/, 'exact scoped total survives; preview contains only two rows');
      assert.ok(output.endsWith(expenseFallback));
      assert.match(output, /85\.00/);
    });
  }

  it('keeps the exact expense count without a model that could omit, invent, or use preview cardinality', async () => {
    for (const answer of ['ยอดค่าใช้จ่ายรวม 85 บาท', 'มีค่าใช้จ่าย 2 รายการ', 'มีค่าใช้จ่าย 999 รายการ']) {
      const output = await agent.composeAnswer('ค่าใช้จ่ายเดือนนี้มีกี่ใบ', expenseData, expenseFallback, answerProvider(answer));
      assert.match(output, /^• จำนวนค่าใช้จ่ายในระบบ \(ไม่รวมยกเลิกหรือถูกปฏิเสธ\): 7 รายการ/);
      assert.ok(output.endsWith(expenseFallback));
    }
  });

  for (const [question, candidate] of [
    ['ยอดค่าใช้จ่ายเท่าไหร่ มีกี่ใบ', 'มีค่าใช้จ่าย 85 ใบ จำนวน 7 บาท'],
    ['how many expenses and total amount?', '85 expenses total 7'],
    ['ค่าใช้จ่ายวันที่ 7 เดือนนี้มีกี่ใบ', 'วันที่ 7 ค่าใช้จ่าย 85 บาท'],
  ] as const) {
    it(`keeps canonical count/money roles: ${question}`, async () => {
      let calls = 0;
      // Nonempty preview avoids masking the old role-swap bug with the empty-data guard.
      const output = await agent.composeAnswer(question, expenseData, expenseFallback, answerProvider(() => {
        calls += 1;
        return candidate;
      }));
      assert.match(output, /: 7 (?:รายการ|records)/);
      assert.match(output, /ยอดทั้งหมด: 85\.00 บาท/);
      assert.notEqual(output, candidate);
      assert.equal(calls, 0, 'a count cannot be relabelled as money or a date by composition');
    });
  }

  for (const question of [
    'ค่าใช้จ่ายของร้านเรามีกี่ใบ',
    'ค่าใช้จ่ายร้านของเรามีกี่รายการ',
    'ค่าใช้จ่ายของบริษัทเรามีกี่ใบ',
    'ค่าใช้จ่ายร้านของฉันมีกี่ใบ',
    'เดือนนี้มีค่าใช้จ่ายกี่ใบ',
    'เดือนนี้มีค่าใช้จ่ายกี่ใบ ไม่รวมยกเลิกหรือถูกปฏิเสธ',
    'เดือนนี้มีค่าใช้จ่ายกี่ใบ ไม่รวมรายการที่ถูกปฏิเสธและยกเลิก',
    'how many expenses for our company, excluding rejected or voided records?',
  ]) {
    it(`supported count scope golden: ${question}`, async () => {
      let calls = 0;
      const output = await agent.composeAnswer(question, expenseData, expenseFallback, answerProvider(() => {
        calls += 1;
        return /[ก-๙]/u.test(question) ? 'มีค่าใช้จ่าย 7 ใบ' : '7 expenses';
      }));
      assert.equal(calls, 0, 'the source answers this count deterministically without refusal or model composition');
      assert.match(output, /7/);
      assert.doesNotMatch(output, /ยังยืนยันจำนวนแยก|unavailable/);
      const fallback = await agent.composeAnswer(question, expenseData, expenseFallback, answerProvider('', false));
      assert.match(fallback, /: 7 (?:รายการ|records)/);
      assert.doesNotMatch(fallback, /ยังยืนยันจำนวนแยก|unavailable/);
    });
  }

  it('preserves detail/vendor/status intent instead of reducing it to an amount', async () => {
    for (const question of ['เดือนนี้มีรายการอะไรบ้าง', 'ค่าใช้จ่ายร้านไหนบ้าง', 'ค่าใช้จ่ายผู้ขายรายไหน', 'ดูค่าใช้จ่ายล่าสุด', 'สถานะค่าใช้จ่าย จ่ายแล้วหรือยังไม่จ่าย', 'ดูค่าใช้จ่ายรออนุมัติ', 'ค่าใช้จ่ายที่ยกเลิก', 'list expenses by vendor and status']) {
      let captured: any;
      assert.equal(await agent.composeAnswer(question, expenseData, expenseFallback, answerProvider((payload) => {
        captured = payload;
        return 'invalid invented 999';
      })), expenseFallback);
      assert.deepEqual(captured.systemData[0].data, expenseData[0]!.data);
    }
  });

  it('does not substitute the overall expense count for unsupported distinct or subset counts', async () => {
    for (const question of ['เดือนนี้มีผู้ขายกี่ราย', 'เดือนนี้มีร้านกี่ราย', 'รายการรออนุมัติมีกี่ใบ', 'ค่าใช้จ่ายจ่ายแล้วกี่ใบ', 'ค่าใช้จ่ายจ่ายกี่ครั้ง', 'ค่าใช้จ่ายของร้านเรารออนุมัติมีกี่ใบ', 'ค่าใช้จ่ายกี่ใบ ไม่รวมยกเลิก', 'ค่าใช้จ่ายกี่ใบ ไม่รวมยกเลิกหรือถูกปฏิเสธ เฉพาะรออนุมัติ', 'how many vendors this month?', 'how many pending expenses?', 'count unpaid expenses', 'how many paid expenses excluding rejected or voided records?']) {
      for (const total of [0, 7]) {
        const data = [{ tool: 'expense.list_recent', data: { ...expenseData[0]!.data, total } }];
        const output = await agent.composeAnswer(question, data, expenseFallback, {
          generateText: async () => { throw new Error('unsupported count must not be inferred by the model'); },
        });
        assert.match(output, /ยังยืนยันจำนวนแยกตามที่ถามไม่ได้|requested breakdown count is unavailable/);
        assert.ok(output.endsWith(expenseFallback), 'trusted detail context is retained');
        assert.doesNotMatch(output, /: [027] (?:รายการ|records)/);
      }
    }
  });

  it('requires the canonical expense total even if a preview carries a different count key', async () => {
    const data = [{ tool: 'expense.list_recent', data: { ...expenseData[0]!.data, items: [{ count: 2 }] } }];
    const output = await agent.composeAnswer('ค่าใช้จ่ายมีกี่ใบ', data, expenseFallback, answerProvider('มีค่าใช้จ่าย 2 ใบ'));
    assert.match(output, /: 7 รายการ/);
    assert.ok(output.endsWith(expenseFallback));
  });

  it('keeps a real zero count distinct from missing data, including fallback', async () => {
    const data = [{ tool: 'expense.list_recent', data: { total: 0, summary: { totalAmount: '0.00', countedItems: 0 }, items: [] } }];
    for (const ok of [true, false]) {
      const output = await agent.composeAnswer('ค่าใช้จ่ายเดือนนี้มีกี่ใบ', data, '• ยอดทั้งหมด: 0.00 บาท', answerProvider('มี 0 ใบ', ok));
      assert.match(output, /: 0 รายการ/);
      assert.doesNotMatch(output, /ยังไม่มีข้อมูลจำนวน|ไม่ครบ/);
    }
  });

  it('never infers a missing or invalid expense count from preview rows or zero', async () => {
    for (const total of [undefined, null, '7', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      let called = false;
      const data = [{ tool: 'expense.list_recent', data: { ...expenseData[0]!.data, total } }];
      const output = await agent.composeAnswer('how many expenses?', data, expenseFallback, answerProvider(() => { called = true; return '2 expenses'; }));
      assert.equal(called, false);
      assert.match(output, /expense count is unavailable/);
      assert.doesNotMatch(output, /[027] records/);
    }
  });

  it('never projects an incomplete expense aggregate into an exact amount or count', async () => {
    for (const question of ['ค่าใช้จ่ายเดือนนี้เท่าไหร่', 'ค่าใช้จ่ายเดือนนี้มีกี่ใบ', 'how many expenses?']) {
      const output = await agent.composeAnswer(question, [{ tool: 'expense.list_recent', data: { ...expenseData[0]!.data, truncated: true } }], expenseFallback, {
        generateText: async () => { throw new Error('incomplete source must not reach model composition'); },
      });
      assert.match(output, /ไม่ครบ|incomplete/);
      assert.doesNotMatch(output, /85|7/);
    }
  });

  it('keeps multi-tool answers outside the expense-only deterministic path', async () => {
    let captured: any;
    const data = [...expenseData, { tool: 'company.get_current_context', data: { name: 'Synthetic Company' } }];
    assert.equal(await agent.composeAnswer('สรุปค่าใช้จ่ายและบริษัท', data, expenseFallback, answerProvider((payload) => {
      captured = payload;
      return 'invalid invented 999';
    })), expenseFallback);
    assert.deepEqual(captured.systemData[0].data, expenseData[0]!.data);
    assert.equal(captured.systemData.length, 2);
  });

  it('falls back when the model invents a number not in the tool data', async () => {
    const provider = answerProvider('บริษัทมีทั้งหมด 7 สาขา');
    const out = await agent.composeAnswer('มีกี่สาขา', TOOL_DATA, FALLBACK, provider);
    assert.equal(out, FALLBACK);
  });

  it('rejects semantic mutations of name, status, negation, and outcome', async () => {
    const data = [{
      tool: 'invoice.get',
      data: { customerName: 'Alice', status: 'UNPAID', outcome: 'NOT_APPROVED', amount: '85.0000' },
    }];
    const fallback = '• ลูกค้า: Alice\n• สถานะ: UNPAID\n• ผล: NOT_APPROVED\n• ยอด: 85.0000';
    for (const invented of [
      'ลูกค้า Bob ยังไม่จ่าย ยอด 85 บาท',
      'ลูกค้า Alice จ่ายแล้ว ยอด 85 บาท',
      'ลูกค้า Alice ได้รับอนุมัติแล้ว ยอด 85 บาท',
      'ลูกค้า Alice สถานะ UNPAID แต่ completed ยอด 85 บาท',
    ]) {
      assert.equal(
        await agent.composeAnswer('สถานะใบแจ้งหนี้ของ Alice', data, fallback, answerProvider(invented)),
        fallback,
        invented,
      );
    }
  });

  it('does not treat a negated textual status as support for its positive inverse', async () => {
    const data = [{
      tool: 'invoice.get',
      data: { customerName: 'Alice', paymentState: 'not paid', approvalState: 'not approved', amount: '85.0000' },
    }];
    const fallback = '• Alice ยังไม่ชำระ และยังไม่ได้รับอนุมัติ\n• ยอด: 85.0000';
    for (const invented of [
      'Alice paid ยอด 85 บาท',
      'Alice approved ยอด 85 บาท',
    ]) {
      assert.equal(
        await agent.composeAnswer('สถานะของ Alice', data, fallback, answerProvider(invented)),
        fallback,
        invented,
      );
    }
  });

  it('accepts a supported semantic paraphrase', async () => {
    const data = [{ tool: 'invoice.get', data: { customerName: 'Alice', status: 'UNPAID', amount: '85.0000' } }];
    const answer = 'ลูกค้า Alice ค้างชำระ ยอด 85 บาท';
    assert.equal(
      await agent.composeAnswer('สถานะใบแจ้งหนี้ของ Alice', data, '• ลูกค้า: Alice\n• สถานะ: UNPAID\n• ยอด: 85.0000', answerProvider(answer)),
      answer,
    );
  });

  it('allows counts equal to array lengths even without an explicit total field', async () => {
    const data = [{ tool: 'company.list_branches', data: { branches: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] } }];
    const provider = answerProvider('มี 3 สาขา');
    const out = await agent.composeAnswer('มีกี่สาขา', data, FALLBACK, provider);
    assert.equal(out, 'มี 3 สาขา');
  });

  it('falls back when the provider is unavailable', async () => {
    const out = await agent.composeAnswer('มีกี่สาขา', TOOL_DATA, FALLBACK, answerProvider('x', false));
    assert.equal(out, FALLBACK);
  });

  it('falls back for a runaway-long answer', async () => {
    const provider = answerProvider(''.padEnd(1500, 'ก'));
    const out = await agent.composeAnswer('มีกี่สาขา', TOOL_DATA, FALLBACK, provider);
    assert.equal(out, FALLBACK);
  });

  it('returns the fallback without a model call when there is no tool data', async () => {
    let called = false;
    const provider: IModelProvider = { async generateText() { called = true; return { ok: true, text: 'x' }; } };
    const out = await agent.composeAnswer('มีกี่สาขา', [], FALLBACK, provider);
    assert.equal(out, FALLBACK);
    assert.equal(called, false);
  });

  it('keeps daily-closing bucket semantics deterministic without a model rewrite', async () => {
    let called = false;
    const fallback = '• ถึงกำหนดวันนี้ (ไม่ได้แปลว่าอนุมัติให้จ่าย): 500.00 THB';
    const out = await agent.composeAnswer(
      'วันนี้ต้องจ่ายอะไรบ้าง',
      [{ tool: 'expense.get_daily_closing', data: { dueEndOfDay: { totals: [{ currency: 'THB', count: 1, total: '500' }] } } }],
      fallback,
      { async generateText() { called = true; return { ok: true, text: 'อนุมัติให้จ่ายแล้ว 500 บาท' }; } },
    );
    assert.equal(out, fallback);
    assert.equal(called, false);
  });
});

describe('ResponseComposerAgent.composeAnswer – multi-turn context grounding', () => {
  const agent = new ResponseComposerAgent();
  const FALLBACK = '• ยอด: 65 บาท';
  const provider = (text: string): IModelProvider => ({ async generateText() { return { ok: true, text }; } });
  const context = {
    windowMinutes: 15,
    maxTurns: 15,
    recentTurns: [{ at: '2026-07-05T10:00:00.000Z', userMessagePreview: 'ค่ากาแฟ 150 บาท', assistantReplyPreview: 'บันทึกแล้ว 150 บาท', refused: false }],
  };

  it('allows a follow-up answer to repeat a number from recent conversation previews', async () => {
    const out = await agent.composeAnswer(
      'สรุปรายการค่าใช้จ่ายล่าสุดกับเมื่อกี้',
      [{ tool: 'expense.list_recent', data: { summary: { totalAmount: '65' } } }],
      FALLBACK,
      provider('เมื่อกี้ 150 บาท รอบนี้ 65 บาทค่ะ'),
      { conversationContext: context },
    );
    assert.equal(out, 'เมื่อกี้ 150 บาท รอบนี้ 65 บาทค่ะ');
  });

  it('still rejects numbers absent from tool data, question, and context', async () => {
    const out = await agent.composeAnswer(
      'สรุปรายการค่าใช้จ่ายล่าสุดกับเมื่อกี้',
      [{ tool: 'expense.list_recent', data: { summary: { totalAmount: '65' } } }],
      FALLBACK,
      provider('รวมทั้งหมด 999 บาทค่ะ'),
      { conversationContext: context },
    );
    assert.equal(out, FALLBACK);
  });

  it('does not treat context timestamps as allowed numbers', async () => {
    const out = await agent.composeAnswer(
      'รายละเอียดรายการค่าใช้จ่ายล่าสุด',
      [{ tool: 'expense.list_recent', data: { summary: { totalAmount: '65' } } }],
      FALLBACK,
      provider('ยอด 2026 บาท'),
      { conversationContext: context },
    );
    assert.equal(out, FALLBACK);
  });
});

// ── Item 10F: user-written value tokens legitimize answer numbers via candidates ─

import { extractValueCandidates } from '@watchdog-bms/contracts';

describe('ResponseComposerAgent.composeAnswer – value candidates (item 10F)', () => {
  const agent = new ResponseComposerAgent();
  const answerProvider = (text: string): IModelProvider => ({ generateText: async () => ({ ok: true, text }) });
  const TOOL_DATA = [{ tool: 'sales.get_sales_summary', data: { totalSales: '12500' } }];
  const FALLBACK = 'fallback';

  it('allows a number the user wrote in Thai words (หกสิบ → 60) via candidates', async () => {
    const question = 'บันทึกหกสิบบาทแล้วยอดขายเท่าไหร่';
    const out = await agent.composeAnswer(question, TOOL_DATA, FALLBACK, answerProvider('รับทราบ 60 บาท ยอดขาย 12500'), {
      valueCandidates: extractValueCandidates(question, '2026-07-07'),
    });
    assert.equal(out, 'รับทราบ 60 บาท ยอดขาย 12500');
  });

  it('still falls back without candidates – 60 derives from nothing in toolData/question', async () => {
    const out = await agent.composeAnswer('บันทึกหกสิบบาทแล้วยอดขายเท่าไหร่', TOOL_DATA, FALLBACK, answerProvider('รับทราบ 60 บาท'), {});
    assert.equal(out, FALLBACK);
  });

  it('allows both Buddhist-era and CE year forms of a candidate date', async () => {
    const question = 'ค่าใช้จ่ายวันที่ 9/12/2537';
    const opts = { valueCandidates: extractValueCandidates(question, '2026-07-07') };
    const beAnswer = await agent.composeAnswer(question, TOOL_DATA, FALLBACK, answerProvider('ของวันที่ 9 ธ.ค. 2537 มียอด 12500'), opts);
    assert.ok(beAnswer.includes('2537'));
    const ceAnswer = await agent.composeAnswer(question, TOOL_DATA, FALLBACK, answerProvider('ของวันที่ 1994-12-09 มียอด 12500'), opts);
    assert.ok(ceAnswer.includes('1994'));
  });

  it('an invented figure still falls back even with candidates present', async () => {
    const question = 'บันทึกหกสิบบาท';
    const out = await agent.composeAnswer(question, TOOL_DATA, FALLBACK, answerProvider('รับทราบ 600 บาท'), {
      valueCandidates: extractValueCandidates(question, '2026-07-07'),
    });
    assert.equal(out, FALLBACK);
  });
});

// ── Capability help: entitlement + permission honesty ──────────────────────────────────────────
// spec: docs/specs/line-ai-capability-help-entitlement-spec.md
describe('ResponseComposerAgent – capability help', () => {
  const agent = new ResponseComposerAgent();
  const ALL_ON = [
    'sales_documents', 'expenses', 'expenses.list', 'expenses.upload', 'double_entry_ledger',
    'bank_reconciliation', 'reports', 'thai_tax', 'inventory', 'product_catalog', 'crm', 'crm.inbox',
    'crm.bookings', 'procurement', 'dashboard_notifications',
  ];
  const EXPENSES_ONLY = ['expenses', 'expenses.list', 'expenses.upload', 'dashboard_notifications'];
  const STAFF = ['expense.read', 'expense.receipt.line_upload', 'dashboard.read'];
  const ask = (permissions: string[], entitledFeatureKeys?: string[], text = 'ทำอะไรได้บ้าง') =>
    agent.composeCapabilityHelp(text, 'th', 'th-TH', { permissions, ...(entitledFeatureKeys && { entitledFeatureKeys }) });

  it('names only the enabled capabilities on an expenses-only company (AC-1)', () => {
    const reply = ask(STAFF, EXPENSES_ONLY);
    assert.match(reply, /ค่าใช้จ่ายและใบเสร็จ/);
    assert.match(reply, /งานค้างและการแจ้งเตือน/);
    for (const hidden of ['ยอดขาย', 'ภาษี', 'สต็อก', 'นัดหมาย', 'ลูกค้า', 'จัดซื้อ']) {
      assert.doesNotMatch(reply, new RegExp(hidden), `must not advertise ${hidden}`);
    }
  });

  it('drops the receipt sentence when expenses.upload is off, keeping expenses (AC-2)', () => {
    const reply = ask(STAFF, ['expenses', 'expenses.list', 'dashboard_notifications']);
    assert.match(reply, /ค่าใช้จ่ายและใบเสร็จ/);
    assert.doesNotMatch(reply, /ส่งรูปใบเสร็จ/);
  });

  it('drops the receipt sentence for a caller without any upload permission (AC-3)', () => {
    assert.doesNotMatch(ask(['expense.read'], EXPENSES_ONLY), /ส่งรูปใบเสร็จ/);
    assert.match(ask(STAFF, EXPENSES_ONLY), /ส่งรูปใบเสร็จ/);
  });

  it('is unchanged for a legacy company with no entitlement rows (AC-5)', () => {
    const owner = ['accounting.document.read', 'expense.read', 'crm.customer.read', 'dashboard.read'];
    assert.equal(ask(owner), ask(owner, ALL_ON));
  });

  it('hides sales on a crm-on / sales-off company (AC-6)', () => {
    // The permission that reaches sales.get_sales_summary is crm.report.read — permissions alone
    // cannot tell this company apart from one that bought sales.
    const reply = ask(['crm.report.read', 'crm.customer.read'], ['crm', 'crm.inbox', 'dashboard_notifications']);
    assert.doesNotMatch(reply, /ยอดขาย/);
    assert.match(reply, /ลูกค้าและงานติดตาม/);
  });

  it('falls back honestly when the caller can reach nothing (AC-7)', () => {
    const reply = ask([], ALL_ON);
    assert.doesNotMatch(reply, /^•/mu);
    assert.match(reply, /ติดต่อผู้ดูแลระบบของบริษัท/);
  });

  it('leaks no feature key, permission key, or tool name in either language (AC-8)', () => {
    for (const language of ['ทำอะไรได้บ้าง', 'what can you do']) {
      const reply = agent.composeCapabilityHelp(language, 'th', 'th-TH', { permissions: STAFF, entitledFeatureKeys: EXPENSES_ONLY });
      for (const leak of ['expenses.upload', 'dashboard_notifications', 'expense.read', 'expense.receipt', 'accounting.', 'sales_documents']) {
        assert.ok(!reply.includes(leak), `${leak} leaked into: ${reply}`);
      }
    }
  });

  it('suggests an example question only from a capability it just advertised (R2)', () => {
    const reply = ask(STAFF, EXPENSES_ONLY);
    assert.match(reply, /ค่าใช้จ่ายเดือนนี้เท่าไหร่/);
    assert.doesNotMatch(reply, /ของอะไรใกล้หมด/);
  });

  it('answers mixed Thai/English input fully in Thai, with the same groups as English (AC-12)', () => {
    const access = { permissions: STAFF, entitledFeatureKeys: EXPENSES_ONLY };
    const mixed = agent.composeCapabilityHelp('ช่วย summary sales ให้หน่อยว่าทำอะไรได้บ้าง', 'th', 'th-TH', access);
    assert.match(mixed, /^น้องมั่งมี/u);
    assert.doesNotMatch(mixed, /[A-Za-z]/u);
    const english = agent.composeCapabilityHelp('what can you do', 'th', 'th-TH', access);
    assert.equal(english.split('\n').length, mixed.split('\n').length);
    assert.match(english, /expenses and receipts/);
    assert.doesNotMatch(english, /sales and sales documents/);
  });

  it('keeps the pre-entitlement full text when no caller context is supplied', () => {
    const reply = agent.composeCapabilityHelp('ทำอะไรได้บ้าง', 'th', 'th-TH');
    assert.match(reply, /ยอดขายและเอกสารขาย/);
    assert.match(reply, /ส่งรูปใบเสร็จ/);
  });

  // ── Teaching mode (spec §8.1, UAT 2026-09-06): "สอนใช้งานหน่อย" gets a walkthrough over the SAME usable set ──
  const teach = (permissions: string[], entitledFeatureKeys?: string[], text = 'สอนใช้งานหน่อย มือใหม่') =>
    agent.composeCapabilityHelp(text, 'th', 'th-TH', { permissions, ...(entitledFeatureKeys && { entitledFeatureKeys }) });

  it('walks an expenses-only owner through photo → draft → summary → alerts, and nothing hidden (AC-13)', () => {
    const reply = teach(STAFF, EXPENSES_ONLY);
    assert.deepEqual(reply.split('\n'), [
      'น้องมั่งมีสอนใช้งานเบื้องต้นให้นะคะ ทำตามนี้ได้เลยค่ะ',
      '1) ถ่ายรูปใบเสร็จหรือสลิป แล้วส่งมาในแชทนี้ได้เลย',
      '2) น้องมั่งมีอ่านให้แล้วทำร่างค่าใช้จ่าย คุณแค่ตรวจยอดกับวันที่แล้วกดยืนยัน',
      '3) อยากดูสรุปค่าใช้จ่าย พิมพ์ว่า “ค่าใช้จ่ายเดือนนี้เท่าไหร่”',
      '4) อยากรู้ว่ามีงานค้างไหม พิมพ์ว่า “มีงานค้างอะไรบ้าง”',
      'อยากเห็นเมนูทั้งหมด กดปุ่ม “เมนูหลัก” ด้านล่างได้เลยค่ะ',
      'ความสามารถที่ใช้ได้ขึ้นกับสิทธิ์และฟีเจอร์ของบริษัท ส่วนการอนุมัติ จ่ายเงิน และลงบัญชีขั้นสุดท้ายต้องทำบนเว็บค่ะ',
    ]);
    for (const hidden of ['ยอดขาย', 'ภาษี', 'สต็อก', 'นัดหมาย', 'ลูกค้า', 'จัดซื้อ', 'รายการรออนุมัติ']) {
      assert.doesNotMatch(reply, new RegExp(hidden), `must not teach ${hidden}`);
    }
  });

  it('drops the photo steps without an upload permission, and adds the approvals line only for an approver (AC-14)', () => {
    const noUpload = teach(['expense.read'], EXPENSES_ONLY);
    assert.doesNotMatch(noUpload, /ถ่ายรูปใบเสร็จ/);
    assert.match(noUpload, /^1\) อยากดูสรุปค่าใช้จ่าย/mu, 'numbering restarts from the first rendered step');
    const approver = teach(['expense.read', 'reimbursement.approve'], EXPENSES_ONLY);
    assert.equal(approver.split('\n').filter((line) => line.includes('รายการรออนุมัติ')).length, 1);
    assert.match(approver, /กดอนุมัติจริงทำในเว็บค่ะ/);
    assert.doesNotMatch(teach(STAFF, EXPENSES_ONLY), /รายการรออนุมัติ/);
    // Registry-derived, so a crm-on / sales-off company teaches customers and never sales (AC-6 shape).
    const crmOnly = teach(['crm.report.read', 'crm.customer.read'], ['crm', 'crm.inbox', 'dashboard_notifications']);
    assert.doesNotMatch(crmOnly, /ยอดขาย/);
    assert.match(crmOnly, /ลูกค้าที่ต้องติดตามมีใครบ้าง/);
  });

  it('gives the R4 none reply to a zero-permission caller, mirrors Thai and English, and stays LINE-sized (AC-15)', () => {
    assert.equal(teach([], ALL_ON), ask([], ALL_ON));
    assert.doesNotMatch(teach([], ALL_ON), /^\d\) /mu);
    const access = { permissions: STAFF, entitledFeatureKeys: EXPENSES_ONLY };
    const card = agent.composeCapabilityHelp('what can you do', 'th', 'th-TH', access);
    const english = agent.composeCapabilityHelp('how do I start', 'th', 'th-TH', access);
    assert.match(card, /^Nong Mangmee can find and summarize work data/u);
    assert.match(english, /^Nong Mangmee will walk you through the basics/u);
    assert.equal(english.split('\n').length, teach(STAFF, EXPENSES_ONLY).split('\n').length, 'line-for-line mirror');
    assert.match(english, /What are this month’s expenses\?/);
    assert.doesNotMatch(english, /today’s sales/);
    // Legacy no-context caller: every group plus the photo steps, still inside the ≤ 15-line bound (T4).
    const everything = agent.composeCapabilityHelp('สอนใช้งานหน่อย', 'th', 'th-TH');
    assert.equal(everything.split('\n').length, 14);
    assert.ok(everything.split('\n').length + 1 <= 15, 'one approvals line on top still fits');
  });

  it('opens every rendering with a LINE_CAPABILITY_REPLY_PREFIXES entry, so the API recognises "ยังไง" after it (T6)', () => {
    for (const text of ['ทำอะไรได้บ้าง', 'what can you do', 'สอนใช้งานหน่อย', 'how do I start']) {
      const reply = agent.composeCapabilityHelp(text, 'th', 'th-TH', { permissions: STAFF, entitledFeatureKeys: EXPENSES_ONLY });
      assert.ok(LINE_CAPABILITY_REPLY_PREFIXES.some((prefix) => reply.startsWith(prefix)), reply.split('\n')[0]);
    }
  });
});

describe('isTeachingRequest – deterministic teaching trigger (capability-help spec §8.1)', () => {
  it('matches the UAT sentence and the literal phrasings, Thai and English, anywhere in the message', () => {
    for (const text of [
      'สอนฉันใช้งานเบื้องต้นแบบง่ายง่ายแบบมนุษย์แม่ป้าเข้าใจได้',
      'วิธีใช้ยังไงคะ', 'ใช้งานยังไง', 'ใช้ยังไง', 'เริ่มยังไงดี', 'เริ่มต้นใช้งานยังไง', 'มือใหม่ค่ะ ช่วยแนะนำการใช้หน่อย',
      'How do I use this?', 'how to start', 'Getting started please', 'Teach me the basics',
    ]) assert.equal(isTeachingRequest(text), true, text);
  });

  it('leaves the ordinary capability question, business questions and small talk alone', () => {
    for (const text of ['ทำอะไรได้บ้าง', 'ช่วยอะไรได้บ้าง', 'what can you do', 'ค่าใช้จ่ายเดือนนี้เท่าไหร่', 'สวัสดี', '']) {
      assert.equal(isTeachingRequest(text), false, text);
    }
  });
});
