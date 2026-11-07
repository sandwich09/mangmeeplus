import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_CAPABILITY_REPLY_PREFIXES } from '@watchdog-bms/contracts';
import { CASUAL_CONVERSATION_SYSTEM_PROMPT, ResponseComposerAgent, buildCapabilityHelp, safeModelLineText, featureDisabledReply, isExplicitJokeAsk, isJokeRequest, isTeachingRequest } from './response-composer.agent';
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
    assert.equal(reply.split('\n').length, 3);
    assert.match(buildCapabilityHelp('th', { permissions: ['accounting.document.read', 'expense.read'] }), /อนุมัติใบเบิกหรือบันทึกจ่าย น้องจะเตรียมการ์ดให้กดยืนยันเองค่ะ/);
  });

  // UAT 2026-08-18: the answer listed every module the product has, so a company that never
  // switched sales/CRM/tax on was offered them and got "คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้" next turn.
  it('offers only the capabilities this member can actually reach', () => {
    const reply = agent.composeCapabilityHelp('ทำอะไรได้บ้าง', 'th', 'th-TH', { permissions: ['expense.read', 'expense.receipt.line_upload'] });
    assert.match(reply, /ค่าใช้จ่ายและใบเสร็จ/);
    assert.equal(reply.split('\n').length, 3);
    assert.match(buildCapabilityHelp('th', { permissions: ['expense.read', 'expense.receipt.line_upload'] }), /ส่งรูปใบเสร็จ/);
    assert.doesNotMatch(reply, /ยอดขาย/);
    assert.doesNotMatch(reply, /ภาษี/);
    assert.doesNotMatch(reply, /ลูกค้า/);
  });

  it('does not invent capabilities for a member whose permissions open nothing', () => {
    const reply = agent.composeCapabilityHelp('ทำอะไรได้บ้าง', 'th', 'th-TH', { permissions: [] });
    assert.match(reply, /ผู้มีสิทธิ์จัดการบทบาท/);
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
    assert.match(reply.replyText, /งานนี้ยังทำไม่ได้.*เมนูหลัก/);
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
    assert.match(reply.replyText, /งานนี้ยังทำไม่ได้.*เมนูหลัก/);
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

  it('treats an empty get_breakdown result (totalCount/byCategory/byBranch/byVendor) as explicit empty data', async () => {
    const data = [{ tool: 'expense.get_breakdown', data: { totalCount: 0, totalAmount: '0.00', byCategory: [], byBranch: [], byVendor: [] } }];
    const fallback = '• ไม่มีรายการค่าใช้จ่ายในช่วงนี้';
    // The model is given a hallucination to compose from; hasEmptyResults must force the fallback
    // regardless, proving totalCount/byCategory/byBranch/byVendor are recognized as empty markers.
    const out = await agent.composeAnswer('แยกค่าใช้จ่ายตามหมวดเดือนนี้', data, fallback, answerProvider('มีค่าใช้จ่ายหมวดอาหาร 500 บาทค่ะ'));
    assert.equal(out, fallback);
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
  const expenseMeta = {
    sourceRefs: [{ label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', permissionChecked: true as const, webPath: '/companies/company-1/expenses' }],
    asOf: '2026-09-17T10:00:00Z',
  };
  // C6 (batch 5c): the formatter no longer states "ที่มา:"/"Source:" (the API appends
  // "แหล่งข้อมูล:" from sourceRefs already), and the English period/as-of lines are now calendar
  // dates too, not the raw ISO strings.
  const expenseSummaryTh = 'ค่าใช้จ่าย: 85.00 บาท (7 รายการ)\nไม่รวมรายการที่ยกเลิกหรือถูกปฏิเสธ 1 รายการ\nช่วง: 1 สิงหาคม 2569 – 31 สิงหาคม 2569\nข้อมูล ณ 17 กันยายน 2569';
  const expenseSummaryEn = 'Expenses: 85.00 THB (7 records)\nExcludes 1 rejected or voided record\nPeriod: 1 Aug 2026 – 31 Aug 2026\nData as of 17 Sep 2026';

  it('returns total, count, effective period and source without model composition', async () => {
    let calls = 0;
    const output = await agent.composeAnswer('ดูค่าใช้จ่ายเดือนนี้', expenseData, expenseFallback, answerProvider(() => {
      calls += 1;
      return 'ค่าใช้จ่าย 999 บาท';
    }), expenseMeta);
    assert.equal(output, expenseSummaryTh);
    assert.equal(calls, 0, 'the source total is authoritative before the provider');
    assert.equal(await agent.composeAnswer('ยอดค่าใช้จ่ายเท่าไหร่', expenseData, expenseFallback, answerProvider('', false), expenseMeta), output);
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
      }), expenseMeta);
      assert.equal(calls, 0, 'money wording uses the canonical summary');
      assert.equal(output, /[ก-๙]/u.test(question) ? expenseSummaryTh : expenseSummaryEn);
      assert.doesNotMatch(output, /15\.00|Synthetic Vendor/);
      assert.equal(await agent.composeAnswer(question, expenseData, expenseFallback, answerProvider('', false), expenseMeta), output);
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
      }), { ...opts, ...expenseMeta });
      assert.equal(output, /[ก-๙]/u.test(question) ? expenseSummaryTh : expenseSummaryEn);
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

  it('keeps broad summaries honest for zero, missing count and invalid or partial totals', async () => {
    const provider = { generateText: async () => { throw new Error('summary must not call a model'); } };
    const summarize = (data: Record<string, unknown>) => agent.composeAnswer('ดูค่าใช้จ่ายเดือนนี้',
      [{ tool: 'expense.list_recent', data }], expenseFallback, provider, expenseMeta);
    const zero = await summarize({ ...expenseData[0]!.data, total: 0, items: [], summary: { totalAmount: 0, cancelledCount: 0 } });
    assert.match(zero, /^ค่าใช้จ่าย: 0\.00 บาท \(0 รายการ\)/);
    // C6 (batch 5c): no "ที่มา:" line anymore — see the expenseSummaryTh/En fixtures above.
    assert.match(zero, /ช่วง: 1 สิงหาคม 2569 – 31 สิงหาคม 2569\nข้อมูล ณ/);
    for (const total of [undefined, null, '7', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const reply = await summarize({ ...expenseData[0]!.data, total });
      assert.match(reply, /85\.00 บาท \(ยังยืนยันจำนวนรายการไม่ได้\)/);
      assert.doesNotMatch(reply, /\(7 รายการ\)|\(2 รายการ\)/);
    }
    for (const totalAmount of [undefined, null, NaN, Infinity, 'not money']) {
      const reply = await summarize({ ...expenseData[0]!.data, summary: { totalAmount } });
      assert.match(reply, /ยังไม่มีข้อมูลสรุปค่าใช้จ่ายที่ยืนยันได้/);
      assert.doesNotMatch(reply, /85|7|NaN|Infinity/);
    }
    assert.match(await summarize({ ...expenseData[0]!.data, partial: true }), /ยังไม่มีข้อมูลสรุปค่าใช้จ่ายที่ยืนยันได้/);
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
    isTeachingRequest(text) ? agent.composeCapabilityHelp(text, 'th', 'th-TH', { permissions, ...(entitledFeatureKeys && { entitledFeatureKeys }) })
      : buildCapabilityHelp(text === 'what can you do' ? 'en' : 'th', { permissions, ...(entitledFeatureKeys && { entitledFeatureKeys }) });

  it('mirrors reachable counterparties, team, sold tax documents, and package purchases in both languages', () => {
    const cases: Array<[string[], string[], RegExp, RegExp]> = [
      [['accounting.counterparty.read'], ['expenses'], /• คู่ค้าและผู้รับเงิน/, /• counterparties and payees/],
      [['access.employee.read'], [], /• ทีมงาน/, /• team members/],
      [['wht.certificate.read'], ['wht_50bis'], /• ใบสำคัญจ่ายและ 50 ทวิ/, /• payment vouchers and withholding certificates/],
      [['ai.tool.invoke', 'company.plan.manage'], ['expenses'], /ซื้อแพ็กเกจ/, /package purchases/],
    ];
    for (const [permissions, features, thaiLabel, englishLabel] of cases) {
      const thai = ask(permissions, features);
      const english = ask(permissions, features, 'what can you do');
      assert.match(thai, thaiLabel);
      assert.match(english, englishLabel);
      assert.equal(thai.split('\n').length, english.split('\n').length);
      assert.match(thai, /เตรียมการ์ดให้กดยืนยันเองค่ะ$/);
      assert.match(english, /prepare a card for you to confirm\.$/);
      assert.doesNotMatch(thai, /ยอดขาย|ต้องทำบนเว็บ/);
      assert.doesNotMatch(english, /sales and sales documents|stay in the web app/);
      const hidden = ask([], features);
      assert.doesNotMatch(hidden, thaiLabel);
      assert.doesNotMatch(hidden, /^•/mu);
    }
  });

  it('lists team/branch management and teaches confirmation only when its preview is reachable', () => {
    for (const permission of ['access.employee.create', 'access.employee.update', 'access.employee.disable', 'company.branch.manage']) {
      assert.match(ask([permission], []), /• จัดการทีมงานหรือสาขาตามสิทธิ์ผ่านการ์ดยืนยัน/u);
      assert.match(ask([permission], [], 'what can you do'), /manage team members or branches within your permissions/u);
      assert.match(ask([permission], [], 'สอนใช้งานหน่อย'), /อยากจัดการทีมงานหรือสาขาตามสิทธิ์/u);
    }
    for (const permissions of [[], ['access.employee.read'], ['company.branch.read'], ['access.role.read']]) {
      assert.doesNotMatch(ask(permissions, []), /จัดการทีมงานหรือสาขา/u);
      assert.doesNotMatch(ask(permissions, [], 'how do I start'), /manage team members or branches/u);
    }
  });

  it('X4: shows team once in help and teaching when both read and management are allowed', () => {
    for (const [help, teaching, word] of [['ทำอะไรได้บ้าง', 'สอนใช้งานหน่อย', 'ทีมงาน'], ['what can you do', 'how do I start', 'team members']]) {
      const permissions = ['access.employee.read', 'access.employee.update'];
      assert.equal(ask(permissions, [], help).split('\n').filter(line => line.startsWith('•') && line.includes(word!)).length, 1);
      assert.equal(ask(permissions, [], teaching).split('\n').filter(line => /^\d+\)/u.test(line) && line.includes(word!)).length, 1);
      assert.ok(ask(['access.employee.read'], [], help).includes(word!));
    }
  });

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
    assert.match(reply, /ผู้มีสิทธิ์จัดการบทบาท/);
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

  it('names the package line only for a caller who manages the package (advisor S2a, owner 2026-09-30)', () => {
    const manager = ask([...STAFF, 'ai.tool.invoke', 'company.plan.manage'], EXPENSES_ONLY);
    assert.match(manager, /• แพ็กเกจและใบเสร็จคงเหลือ/);
    assert.match(teach([...STAFF, 'ai.tool.invoke', 'company.plan.manage'], EXPENSES_ONLY), /อยากรู้ว่าแพ็กเกจพอไหม พิมพ์ว่า “แพ็กเกจนี้พอไหม”/);
    // Every assistant user can call the package tool (a non-manager gets its typed refusal), so the
    // tool alone must never light the line — and a caller with no known access is never told it either.
    assert.doesNotMatch(ask([...STAFF, 'ai.tool.invoke'], EXPENSES_ONLY), /แพ็กเกจ/);
    assert.doesNotMatch(agent.composeCapabilityHelp('ทำอะไรได้บ้าง', 'th', 'th-TH'), /แพ็กเกจ/);
  });

  // Owner 2026-09-30 (~16:00): the tool-less casual lane (also the public group lane) names no package price
  // and never a MangmeePlus cost; prices come only from billing.get_package_catalog in a business turn.
  it('keeps package prices and MangmeePlus costs out of the tool-less casual lane', () => {
    assert.match(CASUAL_CONVERSATION_SYSTEM_PROMPT, /Never state, estimate or hint at what anything costs to provide this service — AI or model cost, cost per receipt or per credit, margins, payment fees, exchange rates\./);
    assert.match(CASUAL_CONVERSATION_SYSTEM_PROMPT, /Never state or guess the price or contents of this service's packages in this lane/);
  });

  it('keeps the pre-entitlement full text when no caller context is supplied', () => {
    const reply = buildCapabilityHelp('th');
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
      '5) อยากดูข้อมูลคู่ค้า พิมพ์ว่า “ดูข้อมูลคู่ค้าให้หน่อย”',
      'อยากเห็นเมนูทั้งหมด กดปุ่ม “เมนูหลัก” ด้านล่างได้เลยค่ะ',
      'อนุมัติใบเบิกหรือบันทึกจ่าย น้องจะเตรียมการ์ดให้กดยืนยันเองค่ะ',
    ]);
    for (const hidden of ['ยอดขาย', 'ภาษี', 'สต็อก', 'นัดหมาย', 'ลูกค้า', 'จัดซื้อ', 'รายการรออนุมัติ']) {
      assert.doesNotMatch(reply, new RegExp(hidden), `must not teach ${hidden}`);
    }
  });

  it('drops the photo steps without an upload permission, and adds the approvals line only for an approver (AC-14)', () => {
    const noUpload = teach(['expense.read'], EXPENSES_ONLY);
    assert.doesNotMatch(noUpload, /ถ่ายรูปใบเสร็จ/);
    assert.match(noUpload, /^1\) อยากดูสรุปค่าใช้จ่าย/mu, 'numbering restarts from the first rendered step');
    const approver = teach(['expense.read', 'reimbursement.read', 'reimbursement.approve'], EXPENSES_ONLY);
    assert.equal(approver.split('\n').filter((line) => line.includes('รายการรออนุมัติ')).length, 1);
    assert.match(approver, /เตรียมการ์ดให้กดยืนยันค่ะ/);
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

  // Review finding F1, Owner 2026-09-06. These are the messages the API's own `isCapabilityQuestion`
  // lane used to answer with the unscoped six-function Flex card BEFORE it knew who was asking. It
  // now forwards them for a linked caller, so every one of them must land on the scoped rendering.
  it('scopes every short phrasing the API used to answer with the fixed card (F1)', () => {
    for (const text of ['ทำอะไรได้บ้าง', 'ช่วยอะไรได้บ้าง', 'มีฟีเจอร์อะไรบ้าง', 'มั่งมีใช้ยังไง', 'ระบบนี้ใช้ยังไง']) {
      const reply = agent.composeCapabilityHelp(text, 'th', 'th-TH', { permissions: STAFF, entitledFeatureKeys: EXPENSES_ONLY });
      assert.match(reply, /ค่าใช้จ่าย/, text);
      for (const hidden of ['ยอดขาย', 'ภาษี', 'สต็อก', 'นัดหมาย', 'ลูกค้า', 'จัดซื้อ', 'สรุปบัญชี']) {
        assert.doesNotMatch(reply, new RegExp(hidden), `"${text}" must not advertise ${hidden}`);
      }
    }
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
      'สอน', 'สอนหน่อย', 'ช่วยสอนใช้งานหน่อยค่ะ', 'อยากให้สอนหน่อย', 'รบกวนสอนที',
    ]) assert.equal(isTeachingRequest(text), true, text);
  });

  it('leaves the ordinary capability question, business questions and small talk alone', () => {
    for (const text of [
      'ทำอะไรได้บ้าง', 'ช่วยอะไรได้บ้าง', 'what can you do', 'ค่าใช้จ่ายเดือนนี้เท่าไหร่', 'สวัสดี', '',
      // Review 2026-09-06: สอน inside a business noun is not "teach me" — it is a fee, a tutor, a course.
      'ค่าสอนพิเศษเดือนนี้เท่าไหร่', 'ค่าจ้างครูสอนเดือนนี้จ่ายไปเท่าไหร่', 'รายได้จากการสอนเดือนนี้',
    ]) {
      assert.equal(isTeachingRequest(text), false, text);
    }
  });
});

// ── W-06: the grounded-breakdown guard (spec §6.1, owner decision 4) ───────────────────────────────
// A "แยกหมวด" question stays on the agentic path on purpose: the tool returns the facts, `compose()` is
// deterministic, and the model is only a language layer. What makes that safe is that EVERY number in
// the model's answer must already exist in the tool data, the question, the conversation or the value
// candidates — so a difference, a percentage, a partial sum or an average the MODEL computed is refused
// and the deterministic grounded text is returned instead. Fixture shape copied from the real
// `expense.get_breakdown` result (apps/api .../erp-business-tools.use-case.ts): the per-category and
// per-branch roll-ups the corpus task `text-read-expense-breakdown` actually receives. The figures are
// chosen so that no derived value collides with a grounded one: 8,000 − 3,250 = 4,750, 3,250 + 1,200 =
// 4,450, 8,000 / 12,450 = 64.3 %, 12,450 / 3 = 4,150 — none of them appear anywhere in the data.
describe('ResponseComposerAgent.composeAnswer – grounded breakdown guard (W-06)', () => {
  const agent = new ResponseComposerAgent();
  const QUESTION = 'ขอสรุปค่าใช้จ่ายเดือนนี้แยกตามหมวดหน่อยค่ะ';
  const BREAKDOWN = [{
    tool: 'expense.get_breakdown',
    data: {
      period: { fromDate: '2026-09-01', toDate: '2026-09-30', defaultedToCurrentMonth: true },
      totalCount: 9,
      totalAmount: '12450.0000',
      byCategory: [
        { category: 'ค่าวัตถุดิบ', count: 5, totalAmount: '8000.0000' },
        { category: 'ค่าขนส่ง', count: 3, totalAmount: '3250.0000' },
        { category: 'ค่าไฟฟ้า', count: 1, totalAmount: '1200.0000' },
      ],
      byBranch: [{ branch: 'ส่วนกลาง (ไม่ระบุสาขา)', count: 9, totalAmount: '12450.0000' }],
    },
  }];
  const GROUNDED_BREAKDOWN = '• ค่าใช้จ่าย: 9 รายการ รวม 12,450.00 บาท';
  const replies = (text: string): IModelProvider => ({ async generateText() { return { ok: true, text }; } });
  const compose = (answer: string) => agent.composeAnswer(QUESTION, BREAKDOWN, GROUNDED_BREAKDOWN, replies(answer));

  it('refuses every number the model computed itself and returns the deterministic grounded text', async () => {
    const computed: Array<[string, string]> = [
      ['a difference', 'ค่าวัตถุดิบ 8,000.00 บาท ค่าขนส่ง 3,250.00 บาท ต่างกัน 4,750.00 บาท'],
      ['a percentage', 'ค่าวัตถุดิบ 8,000.00 บาท คิดเป็น 64.3% ของ 12,450.00 บาท'],
      ['a partial sum the tool never totalled', 'ค่าขนส่ง 3,250.00 บาท และค่าไฟฟ้า 1,200.00 บาท รวม 4,450.00 บาท'],
      ['an average', 'ค่าใช้จ่ายเฉลี่ยต่อหมวด 4,150.00 บาท'],
      // Same invented difference written with thousands separators removed / added: the guard compares
      // numeric VALUES, so neither spelling gets through.
      ['a difference without separators', 'ค่าวัตถุดิบ 8000.00 บาท ค่าขนส่ง 3250.00 บาท ต่างกัน 4750 บาท'],
    ];
    for (const [label, answer] of computed) {
      assert.equal(await compose(answer), GROUNDED_BREAKDOWN, `${label} must not reach the customer`);
    }
  });

  it('reads Thai numerals as numbers, so a figure written ๑๒,๓๔๕ is checked like 12,345', async () => {
    // Before this guard normalised Thai digits, `\d` (ASCII-only) and `\p{L}` (letters only) BOTH missed
    // them, so a number in Thai numerals passed every check untested. These two answers are the same
    // sentence with the same word tokens — only the VALUE differs — so accept/refuse here is decided by
    // the numeric membership test alone.
    assert.notEqual(await compose('ค่าใช้จ่ายทั้งหมด ๑๒,๔๕๐ บาท ค่ะ'), GROUNDED_BREAKDOWN, 'a grounded total in Thai numerals is still grounded');
    assert.equal(await compose('ค่าใช้จ่ายทั้งหมด ๑๒,๓๔๕ บาท ค่ะ'), GROUNDED_BREAKDOWN, 'an invented total in Thai numerals is refused');
  });

  it('keeps the model wording when it adds no number of its own', async () => {
    // Owner decision 4: the model may phrase the answer and point the owner somewhere. Every number here
    // is the tool's; the sentence the tool did not contain carries no figure, so the wording survives.
    const answer = 'ค่าใช้จ่ายเดือนนี้รวม 12,450.00 บาท หมวดค่าวัตถุดิบ 8,000.00 บาท กรุณาใช้ข้อมูลในระบบตามรายการนี้ค่ะ';
    assert.equal(await compose(answer), answer);
    // …and the grounded per-category figures may be restated in full.
    const restated = 'ค่าใช้จ่ายเดือนนี้ 9 รายการ รวม 12,450.00 บาท ค่าวัตถุดิบ 8,000.00 บาท ค่าขนส่ง 3,250.00 บาท ค่าไฟฟ้า 1,200.00 บาท';
    assert.equal(await compose(restated), restated);
  });

  it('polishLanguage refuses an invented number in Thai numerals as well as in ASCII', async () => {
    const polished = (text: string): IModelProvider => ({ async generateText() { return { ok: true, text }; } });
    assert.equal(await agent.polishLanguage(GROUNDED, polished('• ยอดทั้งหมด: ๙๙,๙๙๙ บาท'), {}), GROUNDED);
    assert.equal(await agent.polishLanguage(GROUNDED, polished('• ยอดทั้งหมด: 99,999 บาท'), {}), GROUNDED);
    // The grounded amount itself, re-spelled in Thai numerals, is not an invented number.
    assert.notEqual(await agent.polishLanguage(GROUNDED, polished('ยอดทั้งหมด ๑๑,๘๗๕.๐๐ บาท ยังไม่จ่าย ๐'), {}), GROUNDED);
  });
});

it('sold feature help names an owner permission check without promising a shop feature switch', () => {
  const agent = new ResponseComposerAgent();
  const empty = agent.composeCapabilityHelp('ทำอะไรได้บ้าง', 'th', 'th-TH', { permissions: [] });
  assert.doesNotMatch(empty, /ผู้ดูแลระบบของบริษัท/);
  const reply = agent.compose({
    status: 'UNROUTABLE', language: 'th', intents: [], requiresHumanReview: false,
    refusals: [{ request: 'ค่าใช้จ่ายเดือนนี้', reason: 'feature_disabled' }],
  }, [], 'ค่าใช้จ่ายเดือนนี้', 'th-TH', { featureDisabledTools: ['expense.list_recent'] });
  assert.match(reply.replyText, /เริ่มต้น.*ตรวจราคาปัจจุบัน.*ค่ะ/);
  assert.doesNotMatch(reply.replyText, /เปิดฟีเจอร์ในเว็บแอป/);
});

it('curated LINE jokes use plain Thai words', () => {
  for (const joke of MANGMEE_JOKE_BANK) assert.doesNotMatch(joke.text, /\b(?:EP|center)\b/);
});

it('the shared specialist fallback describes unavailable data without guessing an endpoint failure', () => {
  const source = readFileSync(resolve(__dirname, 'accounting-summary.agent.ts'), 'utf8');
  assert.doesNotMatch(source, /ไม่พบข้อมูลบัญชี \(endpoint ยังไม่พร้อม\)/);
  assert.match(source, /ยังไม่มีข้อมูลที่พร้อมแสดงในขณะนี้/);
});


it('disabled dashboard guidance names หน้าแรก while English capability terminology stays intact', () => {
  assert.match(featureDisabledReply(['dashboard.get_business_health_summary'], 'th'), /เริ่มต้น.*ตรวจราคาปัจจุบัน/);
  assert.doesNotMatch(featureDisabledReply(['dashboard.get_business_health_summary'], 'th'), /แดชบอร์ด/);
  assert.match(featureDisabledReply(['dashboard.get_business_health_summary'], 'en'), /Starter.*current price/);

});
it('F3/F5: casual free compose cannot claim a write or leak Markdown', async () => {
  for (const text of ['บันทึกค่าใช้จ่ายแล้วค่ะ', '## สวัสดี\n**ยินดีค่ะ**']) {
    const result = await new ResponseComposerAgent().composeCasual('สวัสดี', {
      generateText: async () => ({ ok: true, text }),
    } as IModelProvider);
    assert.doesNotMatch(result, /บันทึกค่าใช้จ่ายแล้ว|[*#]/u);
  }
});


// Offline replays of six independent exam conversations; original input and router inventory are
// preserved, while a language-sensitive provider double exposes the language sent to composition.
describe('exam A: current-message language survives Thai account defaults', () => {
  const replays = [
  {
    "id": "C016-A",
    "messageText": "Are you a real person or a bot?",
    "semanticSubrequests": [
      {
        "index": 0,
        "kind": "general",
        "goal": "Answer identity question: real person or bot",
        "requiredEvidence": [],
        "requestedFilters": {},
        "dependsOn": [],
        "evidenceRefs": [
          {
            "partId": "part-0",
            "startUtf16": 0,
            "endUtf16": 31,
            "rawSha256": "1a2866590a068c84c452107e093d412b2ef89689e1f6167f2324134669fef485"
          }
        ]
      }
    ]
  },
  {
    "id": "C021-A",
    "messageText": "bye",
    "semanticSubrequests": [
      {
        "index": 0,
        "kind": "general",
        "goal": "Respond to farewell greeting",
        "requiredEvidence": [],
        "requestedFilters": {},
        "dependsOn": [],
        "evidenceRefs": [
          {
            "partId": "part-0",
            "startUtf16": 0,
            "endUtf16": 3,
            "rawSha256": "b49f425a7e1f9cff3856329ada223f2f9d368f15a00cf48df16ca95986137fe8"
          }
        ]
      }
    ]
  },
  {
    "id": "O002-A",
    "messageText": "What's the weather in Bangkok today?",
    "semanticSubrequests": [
      {
        "index": 0,
        "kind": "general",
        "goal": "Answer weather question for Bangkok today",
        "requiredEvidence": [],
        "requestedFilters": {},
        "dependsOn": [],
        "evidenceRefs": [
          {
            "partId": "part-0",
            "startUtf16": 0,
            "endUtf16": 36,
            "rawSha256": "783e1183dea735696cf9e4801a80fdadaada5bf2a4e495d672d6245b44f4325b"
          }
        ]
      }
    ]
  },
  {
    "id": "H031-A",
    "messageText": "What does \"needs review\" mean on my expense?",
    "semanticSubrequests": [
      {
        "index": 0,
        "kind": "help",
        "goal": "Explain what 'needs review' status means on an expense",
        "requiredEvidence": [],
        "requestedFilters": {},
        "dependsOn": [],
        "evidenceRefs": [
          {
            "partId": "part-0",
            "startUtf16": 0,
            "endUtf16": 44,
            "rawSha256": "903747b0c58f1b06167a1b0b60d1ef1b9e92244952ef975b426e5122adc17f87"
          }
        ]
      }
    ]
  },
  {
    "id": "H047-A",
    "messageText": "Can I give you my bank account number for my claim payout?",
    "semanticSubrequests": [
      {
        "index": 0,
        "kind": "help",
        "goal": "Set up personal payout bank account for claim reimbursement",
        "requiredEvidence": [],
        "requestedFilters": {},
        "dependsOn": [],
        "evidenceRefs": [
          {
            "partId": "part-0",
            "startUtf16": 0,
            "endUtf16": 58,
            "rawSha256": "07743a8cbbec0f2e010a1d20543d6f0fe8d1607f40785e370910b76a1e0ba66d"
          }
        ]
      }
    ]
  },
  {
    "id": "H050-A",
    "messageText": "How do I change who approves claims?",
    "semanticSubrequests": [
      {
        "index": 0,
        "kind": "help",
        "goal": "How to change who approves reimbursement claims",
        "requiredEvidence": [],
        "requestedFilters": {},
        "toolHint": "company.get_roles",
        "dependsOn": [],
        "evidenceRefs": [
          {
            "partId": "part-0",
            "startUtf16": 0,
            "endUtf16": 36,
            "rawSha256": "b7c7c99731dcb1081adad499939fc26b2a4c0917e2fdb97fb57cf8e512728ca7"
          }
        ]
      }
    ]
  }
] as const;
  for (const replay of replays) it(`replays ${replay.id} through the semantic composer`, async () => {
    const { runSemanticTurnV2 } = await import('./semantic-turn-v2');
    const { createLineAiInputEvidence } = await import('@watchdog-bms/contracts');
    const evidence = await createLineAiInputEvidence({ turnKey: replay.id, parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: 1, rawText: replay.messageText }] });
    const sent: any[] = [];
    const result = await runSemanticTurnV2({ req: { requestId: replay.id, webhookEventId: replay.id, messageText: replay.messageText,
      messagePreviewHash: 'a'.repeat(64), inputEvidence: evidence!.inputEvidence,
      userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'member', permissions: ['line.ai.query', 'ai.tool.invoke'], roles: ['OWNER'], locale: 'th-TH' },
      responsePreferences: { language: 'th', detail: 'normal', presentation: 'prose' }, semanticSubrequests: JSON.parse(JSON.stringify(replay.semanticSubrequests)) },
      provider: { async generateText(input: any) { const payload = JSON.parse(input.messages[0].text); sent.push(payload);
        return { ok: true, text: JSON.stringify({ answers: replay.semanticSubrequests.map(item => ({ index: item.index, status: 'handled', topic: 'social',
          text: payload.language === 'en' ? 'I can help with your shop questions.' : 'ช่วยเรื่องร้านได้ค่ะ', sourceRefIds: [] })) }) }; } },
      draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: true,
      invoke: async () => assert.fail('These replayed help/social questions must not mutate records.'),
    });
    assert.equal(result.plan.language, 'en');
    assert.doesNotMatch(result.replyText, /[\u0E00-\u0E7F]/u);
    for (const payload of sent) { assert.equal(payload.language, 'en'); if (payload.responsePreferences) assert.equal(payload.responsePreferences.language, 'en'); }
  });
  for (const [messageText, expected] of [['Could you explain VAT?', 'en'], ['VAT คืออะไรคะ', 'th'], ['ช่วย explain VAT ค่ะ', 'th']] as const) {
    it(`composes ${expected} despite opposite saved preferences: ${messageText}`, async () => {
      const { runSemanticTurnV2 } = await import('./semantic-turn-v2');
      const sent: any[] = [];
      const result = await runSemanticTurnV2({ req: { requestId: 'matrix', webhookEventId: 'matrix', messageText, messagePreviewHash: 'a'.repeat(64),
        userContext: { lineUserId: 'line-user', internalUserId: 'user', companyId: 'company', membershipId: 'member', permissions: [], roles: [], locale: 'th-TH' },
        responsePreferences: { language: expected === 'en' ? 'th' : 'en', detail: 'normal', presentation: 'prose' },
        semanticSubrequests: [{ index: 0, kind: 'general', goal: 'Explain VAT', requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }] },
        provider: { async generateText(input: any) { const payload = JSON.parse(input.messages[0].text); sent.push(payload); return { ok: true, text: JSON.stringify({ answers: [{ index: 0, status: 'handled', topic: 'business', text: payload.language === 'en' ? 'VAT is a tax on goods and services.' : 'VAT คือภาษีมูลค่าเพิ่มค่ะ' }] }) }; } },
        draftEditEnabled: false, reimbursementDraftEnabled: false, publicLookupEnabled: false, approvedKnowledgeEnabled: false, invoke: async () => assert.fail('No ERP read is needed.') });
      // Demo 2026-11-06: a reviewed explanation (VAT) is answered without composing; any compose still gets the message's language.
      assert.equal(result.plan.language, expected);
      for (const payload of sent) { assert.equal(payload.language, expected); assert.equal(payload.responsePreferences.language, expected); }
      if (expected === 'en') assert.doesNotMatch(result.replyText, /[\u0E00-\u0E7F]/u); else assert.match(result.replyText, /ค่ะ/u);
    });
  }
  it('keeps English status words and web-page references English during sanitization', async () => {
    const { safeModelLineText } = await import('./response-composer.agent');
    const reply = safeModelLineText('The expense is NEEDS_REVIEW; check /companies/company/expenses.', true);
    assert.match(reply, /needs review/u); assert.doesNotMatch(reply, /[\u0E00-\u0E7F]/u);
  });
});


it('U5 model formatter never delivers plan enums or em dashes in Thai or English', () => {
  for (const code of ['STARTER', 'BASIC', 'PRO', 'ENTERPRISE']) for (const text of [`แพ็กเกจ (${code}) — ดูได้ค่ะ`, `Your package is ${code} — check Packages.`]) {
    assert.doesNotMatch(safeModelLineText(text), /—|\b(?:STARTER|BASIC|PRO|ENTERPRISE)\b/);
  }
});


it('PWS-PLAIN-SPOKEN-LABELS / PWS-FIXED-D keeps grounded money and paper names with the plain persona and joke', async () => {
  const { MANGMEE_PERSONA_PROMPT } = await import('./mangmee-persona');
  assert.ok(MANGMEE_PERSONA_PROMPT.includes('ค่าใช้จ่าย and ใบเบิก'));
  assert.ok(JSON.stringify(MANGMEE_JOKE_BANK).includes('เก็บใบเสร็จครบเดือนเหมือนผ่านด่านจอมยุทธเลยค่ะ ⚔️'));
  const facts = 'หนังสือรับรอง 50 ทวิ หัก ณ ที่จ่าย 30.02 บาท ภ.ง.ด.53 VAT 70.00';
  assert.equal(safeModelLineText(facts), facts);
});

it('PWS-FIXED-D own payment says amount to pay and preserves paid and outstanding facts', async () => {
  const { formatPreparedSimpleRead } = await import('./prepared-simple-read-formatter');
  const sourceRef = { label: 'Expense', module: 'expenses', entityType: 'expense', entityId: 'expense', permissionChecked: true, webPath: '/companies/c1/expenses/expense' };
  const data = { expenseDate: '2026-10-01', grandTotalAmount: '1070.00', status: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID', vendorName: 'Seller',
    netPayableAmount: '1040.00', paidAmount: '400.00', outstandingAmount: '640.00', payments: { count: 1, lastPaidOn: '2026-10-02', methods: ['CASH'] } };
  const output: any = { agent: 'accounting', status: 'SUCCEEDED', summary: '', facts: [{ label: 'Expense', value: '1070.00', sourceRef }], suggestions: [],
    toolCalls: [{ name: 'expense.get_detail', status: 'ok', durationMs: 1 }], requiresHumanReview: false, toolData: [{ tool: 'expense.get_detail', data }], asOf: '2026-10-02T00:00:00Z' };
  const reply = formatPreparedSimpleRead('expense.get_detail::single_metric', output, { language: 'en', locale: 'en-US', messageText: 'Has this expense been paid?' });
  assert.equal(reply.kind, 'answer');
  if (reply.kind === 'answer') {
    assert.match(reply.replyText, /amount to pay 1,040.00 THB/); assert.match(reply.replyText, /Paid 400.00 THB · Outstanding 640.00 THB/);
    assert.doesNotMatch(reply.replyText, /net payable/);
  }
});
