import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CASUAL_CONVERSATION_SYSTEM_PROMPT, ResponseComposerAgent } from './response-composer.agent';
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
    const reply = agent.composeCapabilityHelp('ทำอะไรได้บ้าง');
    assert.match(reply, /ยอดขาย/);
    assert.match(reply, /ขึ้นกับสิทธิ์และฟีเจอร์/);
    assert.match(reply, /ต้องทำบนเว็บ/);
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
    const data = [{ tool: 'expense.list_recent', data: { summary: { totalAmount: '85.0000' } } }];
    const provider = answerProvider('ยอดค่าใช้จ่ายรวม 85 บาท');
    const out = await agent.composeAnswer('ค่าใช้จ่ายเท่าไหร่', data, FALLBACK, provider);
    assert.equal(out, 'ยอดค่าใช้จ่ายรวม 85 บาท');
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
      'รวมกับเมื่อกี้เป็นเท่าไหร่',
      [{ tool: 'expense.list_recent', data: { summary: { totalAmount: '65' } } }],
      FALLBACK,
      provider('เมื่อกี้ 150 บาท รอบนี้ 65 บาทค่ะ'),
      { conversationContext: context },
    );
    assert.equal(out, 'เมื่อกี้ 150 บาท รอบนี้ 65 บาทค่ะ');
  });

  it('still rejects numbers absent from tool data, question, and context', async () => {
    const out = await agent.composeAnswer(
      'รวมกับเมื่อกี้เป็นเท่าไหร่',
      [{ tool: 'expense.list_recent', data: { summary: { totalAmount: '65' } } }],
      FALLBACK,
      provider('รวมทั้งหมด 999 บาทค่ะ'),
      { conversationContext: context },
    );
    assert.equal(out, FALLBACK);
  });

  it('does not treat context timestamps as allowed numbers', async () => {
    const out = await agent.composeAnswer(
      'ยอดเท่าไหร่',
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
});
