import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineCaptureResultNotifierUseCase, LINE_CAPTURE_READ_FINISHED_EVENT_TYPE } from './line-capture-result-notifier.use-case';
import { hashMessagePreview } from '../../domain/logic/line-ai-classifier.logic';

const LINE_USER = 'Ufake-line-user';
const CHAT_HASH = hashMessagePreview(LINE_USER);

type Scenario = {
  jobs?: Array<{ id: string; status: string; pausedReason?: string | null }>;
  intakeChannel?: string;
  linked?: boolean;
  permissions?: string[];
  userStatus?: string;
  lineChatKeyHash?: string | null;
  linePushTargetId?: string | null;
  payload?: Record<string, unknown>;
  pushResult?: string;
  companyId?: string;
  /** §3.2: what `AutoHandoffSingleDocumentCaptureUseCase` answers for this group. */
  autoHandoff?: 'expense' | 'skipped' | 'throws';
  /** How many events the drain claims — two rows means the same result delivered twice. */
  events?: number;
  /** Appendix §25 expense lane: `null` models a record the push may not read. */
  expenseSnapshot?: null;
  captureSource?: string;
};

function makeNotifier(scenario: Scenario = {}) {
  const published: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const pushes: Array<{ to: string; messages: any[]; key?: string }> = [];
  const attemptUpdates: any[] = [];
  const closes: Array<{ groupId: string; reason: string }> = [];
  const handoffCalls: string[] = [];
  const expenses: string[] = [];
  const draftDeletes: any[] = [];
  const events = Array.from({ length: scenario.events ?? 1 }, (_value, index) => ({
    id: `outbox-${index + 1}`, companyId: scenario.companyId ?? 'company-1',
    eventType: LINE_CAPTURE_READ_FINISHED_EVENT_TYPE,
    claimToken: `token-${index + 1}`,
    payloadJson: scenario.payload && 'ownerType' in scenario.payload
      ? { ...scenario.payload }
      : { groupId: 'group-1', ...(scenario.payload ?? {}) },
  }));

  const prisma = {
    client: {
      user: { findUnique: async () => (scenario.linked === false ? null : { status: scenario.userStatus ?? 'ACTIVE', aiAssistantOptOutAt: null }) },
      externalIdentity: { findFirst: async () => (scenario.linked === false ? null : { providerUserId: LINE_USER }) },
      companyFeatureEntitlement: { findMany: async () => [] },
      lineIntakeAttempt: { findMany: async () => [{ id: 'attempt-1' }] },
      expenseRecord: {
        deleteMany: async (input: any) => { draftDeletes.push(input.where); return { count: 1 }; },
        findFirst: async () => ({
          vendorNameSnapshot: 'ร้านค้าดี', grandTotalAmount: '250.0000', currency: 'THB',
          sourceDocumentType: 'RECEIPT', expenseDate: new Date('2026-07-25T00:00:00.000Z'),
        }),
      },
    },
  } as any;

  const notifier = new LineCaptureResultNotifierUseCase(
    prisma,
    { webBaseUrl: 'https://app.example.com' } as any,
    { resolveAccess: async () => ({ membershipId: 'm1', roles: ['STAFF'], permissions: scenario.permissions ?? ['expense.receipt.line_upload'], scopes: {} }) } as any,
    {
      readFinishedSnapshot: async (_companyId: string, groupId: string) => ({
        group: { id: groupId, status: 'OPEN', intakeChannel: scenario.intakeChannel ?? 'LINE',
          createdByUserId: 'user-1', lineChatKeyHash: scenario.lineChatKeyHash === undefined ? CHAT_HASH : scenario.lineChatKeyHash,
          linePushTargetId: scenario.linePushTargetId ?? null, branchId: null },
        jobs: scenario.jobs ?? [{ id: 'job-1', status: 'DONE', pausedReason: null, lastErrorCode: null }],
        observations: 1,
        webPath: `/companies/company-1/expenses/capture/${groupId}`,
      }),
      closeMergedGroup: async (_ctx: any, groupId: string, reason: string) => { closes.push({ groupId, reason }); return true; },
      // Appendix §25: the live lane. `expenseSnapshot: null` models a record this company cannot see.
      readFinishedExpenseSnapshot: async (_companyId: string, expenseId: string) => (
        scenario.expenseSnapshot === null ? null : {
          expense: {
            id: expenseId, status: 'NEEDS_REVIEW', captureSource: scenario.captureSource ?? 'LINE_UPLOAD',
            createdByUserId: 'user-1',
            lineChatKeyHash: scenario.lineChatKeyHash === undefined ? CHAT_HASH : scenario.lineChatKeyHash,
            linePushTargetId: scenario.linePushTargetId ?? null,
            vendorNameSnapshot: 'ร้านค้าดี', grandTotalAmount: '250.0000', currency: 'THB',
            sourceDocumentType: 'RECEIPT', expenseDate: new Date('2026-07-25T00:00:00.000Z'),
            primaryAttachmentId: 'att-1',
          },
          jobs: scenario.jobs ?? [{ id: 'job-1', status: 'DONE', pausedReason: null, lastErrorCode: null }],
        }),
    } as any,
    { updateLineIntakeAttemptOutcome: async (input: any) => { attemptUpdates.push(input); return true; } } as any,
    {
      buildTextMessage: (text: string) => ({ type: 'text', text }),
      sendPush: async (to: string, messages: any[], key?: string) => { pushes.push({ to, messages, key }); return scenario.pushResult ?? 'ok'; },
    } as any,
    {
      claimBatch: async () => events,
      markPublished: async (input: any) => { published.push(input.id); return true; },
      markFailed: async (input: any) => { failed.push({ id: input.id, error: input.error }); return true; },
    } as any,
    {
      // The real use case refuses a group it has already handed off (`handoff_exists`), so a second
      // delivery of the same event cannot make a second expense — the fake does exactly that.
      execute: async (_ctx: any, groupId: string) => {
        handoffCalls.push(groupId);
        if (scenario.autoHandoff === 'throws') throw new Error('handoff_exploded');
        if (scenario.autoHandoff !== 'expense') return { skipped: 'not_single_document' };
        if (expenses.length > 0) return { skipped: 'handoff_exists' };
        expenses.push('expense-9');
        return { expenseId: 'expense-9' };
      },
    } as any,
  );
  return { notifier, published, failed, pushes, attemptUpdates, closes, handoffCalls, expenses, draftDeletes };
}

const pushedText = (h: ReturnType<typeof makeNotifier>): string => h.pushes[0]?.messages[0]?.text ?? '';

/** The retired AI-money wording, assembled at runtime: spelled out here it would trip the repo-wide
 *  guard that exists to keep it out of source (spec §3, W-01). */
const retiredAiMoneyWords = ['\u0e07\u0e1a', '\u0e42\u0e04\u0e27\u0e15\u0e32'].map((word) => `${word} AI`);
const usesRetiredAiMoneyWording = (text: string): boolean => retiredAiMoneyWords.some((word) => text.includes(word));


describe('LINE capture result push (appendix §3)', () => {
  it('DONE pushes the summary with the expense-list link and settles the outbox row once', async () => {
    const h = makeNotifier({ payload: { status: 'DONE', issuerName: 'ร้านค้าดี', documentTotal: '250.00', documentCount: 1 } });
    const result = await h.notifier.execute();
    assert.deepEqual(result, { claimed: 1, pushed: 1, skipped: 0, parked: 0 });
    assert.equal(h.pushes.length, 1);
    assert.equal(h.pushes[0].to, LINE_USER);
    assert.match(pushedText(h), /อ่านเอกสารแล้วค่ะ พบ ร้านค้าดี ยอด 250\.00/);
    assert.match(pushedText(h), /companies\/company-1\/expenses$|companies\/company-1\/expenses[^/]/m, 'appendix §25: the withdrawn group page is replaced by the expense list');
    assert.ok(h.pushes[0].messages[0].quickReply, 'the completion menu rides the push');
    assert.deepEqual(h.published, ['outbox-1']);
    assert.equal(h.failed.length, 0);
  });

  it('multi-document DONE asks for the grouping to be checked instead of naming one issuer', async () => {
    const h = makeNotifier({ payload: { status: 'DONE', documentCount: 3 } });
    await h.notifier.execute();
    assert.match(pushedText(h), /พบ 3 ฉบับ กรุณาตรวจการจัดกลุ่มในเว็บ/);
  });

  for (const [status, pattern] of [
    ['FAILED', /อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว/],
    ['PARTIAL', /อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว/],
  ] as const) {
    it(`${status} sends §17.6's own sentence with the web link`, async () => {
      const h = makeNotifier({ jobs: [{ id: 'job-1', status }], payload: { status } });
      await h.notifier.execute();
      assert.match(pushedText(h), pattern);
      assert.match(pushedText(h), /companies\/company-1\/expenses$|companies\/company-1\/expenses[^/]/m, 'appendix §25: the withdrawn group page is replaced by the expense list');
      assert.ok(!/อ่านซ้ำ|ลองอ่านใหม่/.test(pushedText(h)), '§17.6 offers no re-read');
    });
  }

  it('PAUSED names the real reason, in the wave-2 credit wording', async () => {
    const h = makeNotifier({ jobs: [{ id: 'job-1', status: 'PAUSED', pausedReason: 'ai_credit' }], payload: { status: 'PAUSED' } });
    await h.notifier.execute();
    assert.match(pushedText(h), /ยังอ่านข้อมูลไม่ครบ \(เครดิตสำหรับการอ่านเอกสารไม่พอ\)/);
    assert.ok(!usesRetiredAiMoneyWording(pushedText(h)));
  });

  it('§18.4: a classified non-receipt keeps its own sentence, and NR07 closes the group', async () => {
    const label = makeNotifier({ payload: { status: 'DONE', classification: { contentKind: 'DOCUMENT', documentKind: 'DELIVERY_NOTE', missingRequiredSignals: ['PARCEL_LABEL_SIGNAL'] } } });
    await label.notifier.execute();
    assert.match(pushedText(label), /ใบนี้เป็นใบปะหน้าพัสดุค่ะ/);
    assert.match(pushedText(label), /กรอกข้อมูลต่อได้ที่นี่: /);
    assert.equal(label.closes.length, 0);

    const nonBusiness = makeNotifier({ payload: { status: 'DONE', classification: { contentKind: 'NON_DOCUMENT_IMAGE', documentKind: 'NON_FINANCIAL_IMAGE' } } });
    await nonBusiness.notifier.execute();
    assert.match(pushedText(nonBusiness), /ภาพนี้ไม่ใช่เอกสารค่าใช้จ่ายค่ะ/);
    assert.ok(!/กรอกข้อมูลต่อ/.test(pushedText(nonBusiness)), 'NR07 never offers a link to work it closed');
    assert.deepEqual(nonBusiness.closes, [{ groupId: 'group-1', reason: 'NON_BUSINESS_IMAGE' }]);
  });

  it('a WEB group is never pushed — its result belongs to the page already open', async () => {
    const h = makeNotifier({ intakeChannel: 'WEB' });
    const result = await h.notifier.execute();
    assert.equal(h.pushes.length, 0);
    assert.deepEqual(result, { claimed: 1, pushed: 0, skipped: 1, parked: 0 });
    assert.deepEqual(h.published, ['outbox-1'], 'the row is still settled, not retried forever');
  });

  for (const [name, scenario] of [
    ['an unlinked user', { linked: false }],
    ['a user who lost capture permission', { permissions: ['expense.read'] }],
    ['a chat the recorded hash matches neither way', { lineChatKeyHash: 'some-other-chat-hash' }],
    ['a stored push target that does not match the recorded chat', { linePushTargetId: 'Cnot-this-chat' }],
  ] as const) {
    it(`${name} gets no push, and the attempt records the result as undelivered`, async () => {
      const h = makeNotifier(scenario as Scenario);
      const result = await h.notifier.execute();
      assert.equal(h.pushes.length, 0);
      assert.equal(result.pushed, 0);
      // UXE-25: the attempt carries the undelivered outcome so §17.5 can answer honestly later.
      assert.equal(h.attemptUpdates.length, 1);
      assert.equal(h.attemptUpdates[0].reasonCode, 'LINE_DELIVERY_FAILED');
      assert.equal(h.attemptUpdates[0].outcome, 'STORED_READ_DONE');
    });
  }

  it('a push LINE refuses is recorded as undelivered, not as a delivered result', async () => {
    const h = makeNotifier({ pushResult: 'failed_other' });
    const result = await h.notifier.execute();
    assert.equal(h.pushes.length, 1);
    assert.equal(result.pushed, 0);
    assert.equal(h.attemptUpdates[0].reasonCode, 'LINE_DELIVERY_FAILED');
  });

  it('a delivered result records it as delivered', async () => {
    const h = makeNotifier();
    await h.notifier.execute();
    assert.equal(h.attemptUpdates[0].reasonCode, 'result_delivered');
  });

  it('§3.2: an eligible single document becomes one expense, and the push carries ITS summary', async () => {
    const h = makeNotifier({ autoHandoff: 'expense', payload: { status: 'DONE', issuerName: 'ร้านค้าดี', documentCount: 1 } });
    const result = await h.notifier.execute();
    assert.deepEqual(h.handoffCalls, ['group-1']);
    assert.deepEqual(h.expenses, ['expense-9']);
    assert.equal(result.pushed, 1);
    // The receipt card's own rows, off the derived source — not the group summary.
    assert.match(pushedText(h), /ร้าน: ร้านค้าดี/);
    assert.match(pushedText(h), /ยอดในใบเสร็จ: 250\.00 บาท/);
    assert.match(pushedText(h), /ประเภทเอกสาร: ใบเสร็จรับเงิน/);
    assert.match(pushedText(h), /วันที่: /);
    assert.match(pushedText(h), /ยังไม่ยืนยันรายการ/);
    assert.match(pushedText(h), /ตรวจสอบและยืนยันในเว็บแอป/);
    assert.match(pushedText(h), /\/companies\/company-1\/expenses\/expense-9/);
    assert.ok(!/expenses\/capture\//.test(pushedText(h)), 'the expense replaces the withdrawn group page');
    // §17.5 must point a later "ไฟล์เมื่อกี้…" at the record, not at the work it closed.
    assert.equal(h.attemptUpdates[0].targetType, 'expense');
    assert.equal(h.attemptUpdates[0].targetId, 'expense-9');
    assert.equal(h.attemptUpdates[0].outcome, 'STORED_READ_DONE');
  });

  for (const [name, scenario] of [
    ['the use case refuses it', { autoHandoff: 'skipped' }],
    ['the use case throws', { autoHandoff: 'throws' }],
  ] as const) {
    it(`keeps the list link when ${name}`, async () => {
      const h = makeNotifier({ ...(scenario as Scenario), payload: { status: 'DONE', issuerName: 'ร้านค้าดี', documentTotal: '250.00', documentCount: 1 } });
      const result = await h.notifier.execute();
      assert.equal(result.pushed, 1);
      assert.match(pushedText(h), /อ่านเอกสารแล้วค่ะ พบ ร้านค้าดี/);
      assert.match(pushedText(h), /companies\/company-1\/expenses$|companies\/company-1\/expenses[^/]/m, 'appendix §25: the withdrawn group page is replaced by the expense list');
      assert.equal(h.expenses.length, 0);
      assert.equal(h.attemptUpdates[0].targetType, undefined, 'the attempt still points at the group');
    });
  }

  for (const [name, payload] of [
    ['a multi-document read', { status: 'DONE', documentCount: 3 }],
    ['a classified non-receipt (NR)', { status: 'DONE', classification: { contentKind: 'DOCUMENT', documentKind: 'QUOTATION' } }],
  ] as const) {
    it(`never auto-hands off ${name}`, async () => {
      const h = makeNotifier({ autoHandoff: 'expense', payload: payload as Record<string, unknown> });
      await h.notifier.execute();
      assert.equal(h.expenses.length, 0, 'no expense is created');
      assert.ok(!/expenses\/expense-9/.test(pushedText(h)));
    });
  }

  it('§3.2 is idempotent: a replayed event makes no second expense', async () => {
    const h = makeNotifier({ autoHandoff: 'expense', events: 2, payload: { status: 'DONE', documentCount: 1 } });
    await h.notifier.execute();
    assert.deepEqual(h.handoffCalls, ['group-1', 'group-1'], 'both deliveries ask');
    assert.deepEqual(h.expenses, ['expense-9'], 'only the first one creates');
    assert.deepEqual(h.published, ['outbox-1', 'outbox-2']);
    assert.match(pushedText(h), /ตรวจสอบและยืนยันในเว็บแอป/);
    assert.match(h.pushes[1]?.messages[0]?.text ?? '', /companies\/company-1\/expenses/, 'appendix §25: the withdrawn group page is replaced by the expense list');
  });

  it('a group chat is answered IN the group chat it arrived from', async () => {
    const groupChat = 'Cgroup-chat-id';
    const h = makeNotifier({ linePushTargetId: groupChat, lineChatKeyHash: hashMessagePreview(groupChat) });
    const result = await h.notifier.execute();
    assert.equal(result.pushed, 1);
    assert.equal(h.pushes[0].to, groupChat, 'W02-LINE deviation 2 is closed: not only 1:1 chats');
    assert.equal(h.attemptUpdates[0].reasonCode, 'result_delivered');
  });

  it('a 1:1 capture with no stored target still reaches the sender', async () => {
    const h = makeNotifier();
    await h.notifier.execute();
    assert.equal(h.pushes[0].to, LINE_USER);
  });

  it('an event with no group id settles without pushing anything', async () => {
    const noGroup = makeNotifier({ payload: { groupId: undefined as any } });
    // The payload spread above leaves `groupId` undefined, which is the malformed-event case.
    const result = await noGroup.notifier.execute();
    assert.equal(noGroup.pushes.length, 0);
    assert.equal(result.skipped, 1);
  });
});

/**
 * Appendix §25 (owner decision 2026-09-19): the LIVE lane. A LINE document is an ordinary expense
 * draft from intake, so the push is about a RECORD — today's receipt card for one document, the
 * split list for several, the §17.6 sentences with the EXPENSE link when the read did not finish,
 * and truthful NR copy over a draft that exists.
 */
describe('LINE capture result push — the expense lane (appendix §25)', () => {
  const expensePayload = (over: Record<string, unknown> = {}) => ({
    ownerType: 'EXPENSE', expenseId: 'expense-1', status: 'DONE', ...over,
  });

  it('one document pushes the receipt card, read off the draft, with the expense link', async () => {
    const h = makeNotifier({ payload: expensePayload({ documentCount: 1 }) });
    const result = await h.notifier.execute();
    assert.deepEqual(result, { claimed: 1, pushed: 1, skipped: 0, parked: 0 });
    assert.match(pushedText(h), /ร้าน: ร้านค้าดี/);
    assert.match(pushedText(h), /ยอดในใบเสร็จ: 250\.00 บาท/);
    assert.match(pushedText(h), /ประเภทเอกสาร: ใบเสร็จรับเงิน/);
    assert.match(pushedText(h), /ยังไม่ยืนยันรายการ/);
    assert.match(pushedText(h), /\/companies\/company-1\/expenses\/expense-1/);
    assert.ok(!/expenses\/capture\//.test(pushedText(h)), 'never a group link');
    // No handoff use case is reached: the draft IS the expense.
    assert.deepEqual(h.handoffCalls, []);
    assert.equal(h.attemptUpdates[0].outcome, 'STORED_READ_DONE');
    assert.equal(h.attemptUpdates[0].reasonCode, 'result_delivered');
    assert.deepEqual(h.published, ['outbox-1']);
  });

  it('several documents name the count and link every draft the split created', async () => {
    const h = makeNotifier({
      payload: expensePayload({ documentCount: 3, splitExpenseIds: ['expense-2', 'expense-3'] }),
    });
    await h.notifier.execute();
    assert.match(pushedText(h), /พบเอกสาร 3 ใบ สร้างรายการให้แล้ว/);
    assert.match(pushedText(h), /1\) https:\/\/app\.example\.com\/companies\/company-1\/expenses\/expense-1/);
    assert.match(pushedText(h), /2\) https:\/\/app\.example\.com\/companies\/company-1\/expenses\/expense-2/);
    assert.match(pushedText(h), /3\) https:\/\/app\.example\.com\/companies\/company-1\/expenses\/expense-3/);
    assert.ok(!/กรุณาตรวจการจัดกลุ่ม/.test(pushedText(h)), 'there is no grouping left to check');
  });

  for (const [status, pattern] of [
    ['FAILED', /อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว/],
    ['PARTIAL', /อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว/],
  ] as const) {
    it(`${status} sends §17.6's own sentence with the EXPENSE link and no re-read`, async () => {
      const h = makeNotifier({ jobs: [{ id: 'job-1', status }], payload: expensePayload({ status }) });
      await h.notifier.execute();
      assert.match(pushedText(h), pattern);
      assert.match(pushedText(h), /\/companies\/company-1\/expenses\/expense-1/);
      assert.ok(!/อ่านซ้ำ|ลองอ่านใหม่/.test(pushedText(h)), '§17.6 offers no re-read');
      assert.equal(h.attemptUpdates[0].outcome, status === 'FAILED' ? 'STORED_READ_FAILED' : 'STORED_READ_PARTIAL');
    });
  }

  it('PAUSED names the Thai reason the wave-2 credit wording uses', async () => {
    const h = makeNotifier({
      jobs: [{ id: 'job-1', status: 'PAUSED', pausedReason: 'ai_credit' }],
      payload: expensePayload({ status: 'PAUSED', pausedReason: 'ai_credit' }),
    });
    await h.notifier.execute();
    assert.match(pushedText(h), /เก็บไฟล์ไว้แล้วค่ะ แต่ยังอ่านข้อมูลไม่ครบ \(เครดิตสำหรับการอ่านเอกสารไม่พอ\)/);
    assert.equal(usesRetiredAiMoneyWording(pushedText(h)), false);
  });

  it('an NR case says the draft exists instead of claiming nothing was created', async () => {
    const h = makeNotifier({
      payload: expensePayload({ classification: { contentKind: 'DOCUMENT', documentKind: 'QUOTATION' } }),
    });
    await h.notifier.execute();
    assert.match(pushedText(h), /ใบนี้เป็นใบเสนอราคาค่ะ/);
    assert.match(pushedText(h), /เก็บไฟล์ไว้ในรายการร่างแล้ว ยังไม่ยืนยัน/);
    assert.match(pushedText(h), /\/companies\/company-1\/expenses\/expense-1/);
    assert.ok(!/ยังไม่ได้สร้างรายการ/.test(pushedText(h)), 'a draft exists, so that sentence would be false');
    assert.equal(h.draftDeletes.length, 0, 'an NR that keeps the bytes keeps the draft');
  });

  it('NR07 removes the empty draft and says no record was created', async () => {
    const h = makeNotifier({
      payload: expensePayload({ classification: { contentKind: 'DOCUMENT', documentKind: 'NON_FINANCIAL_IMAGE' } }),
    });
    await h.notifier.execute();
    assert.match(pushedText(h), /ภาพนี้ไม่ใช่เอกสารค่าใช้จ่ายค่ะ จึงไม่ได้สร้างรายการ/);
    assert.ok(!/companies\/company-1\/expenses\/expense-1/.test(pushedText(h)), 'no link to a record that is gone');
    assert.equal(h.draftDeletes.length, 1);
    // Only an EMPTY draft is removed: anything with money, a payment or a posting is left alone.
    assert.deepEqual(h.draftDeletes[0], {
      companyId: 'company-1', id: 'expense-1', status: { in: ['DRAFT', 'NEEDS_REVIEW'] },
      grandTotalAmount: 0, paidAmount: 0, postingStatus: 'not_required', sourceReimbursementRequestId: null,
    });
  });

  it("a WEB upload's result is not pushed: the page the customer is on already has it", async () => {
    const h = makeNotifier({ captureSource: 'WEB_UPLOAD', payload: expensePayload({ documentCount: 1 }) });
    const result = await h.notifier.execute();
    assert.deepEqual(result, { claimed: 1, pushed: 0, skipped: 1, parked: 0 });
    assert.equal(h.pushes.length, 0);
  });

  it('a record the push may no longer read is parked as undelivered, never guessed at', async () => {
    const h = makeNotifier({ linked: false, payload: expensePayload({ documentCount: 1 }) });
    const result = await h.notifier.execute();
    assert.deepEqual(result, { claimed: 1, pushed: 0, skipped: 1, parked: 0 });
    assert.equal(h.pushes.length, 0);
    assert.equal(h.attemptUpdates[0].reasonCode, 'LINE_DELIVERY_FAILED');
  });
});
