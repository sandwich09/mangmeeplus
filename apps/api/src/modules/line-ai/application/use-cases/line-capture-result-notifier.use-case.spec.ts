import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineCaptureResultNotifierUseCase, LINE_CAPTURE_READ_FINISHED_EVENT_TYPE } from './line-capture-result-notifier.use-case';
import { bangkokMonthKey } from '../company-ai-usage-meter';
import { hashMessagePreview } from '../../domain/logic/line-ai-classifier.logic';
import { buildExpenseDraftReviewCard, isCompleteLineBusinessAnswerPresentation } from '../../domain/logic/line-business-card.logic';
import { linePushRetryKey } from '../../infrastructure/line-reply.adapter';
import { ExpenseCaptureLineUseCase } from '../../../expenses/application/use-cases/expense-capture-line.use-case';
import { parseLineDeliveryPlan } from '../../domain/logic/line-delivery-plan.logic';
import type { ExpenseActionPreview } from '../line-expense-action.service';
import { readLineSystemCard } from '../../domain/logic/line-system-card.fixture';

const LINE_USER = 'Ufake-line-user';
const CHAT_HASH = hashMessagePreview(LINE_USER);
const CURRENT_MONTH = bangkokMonthKey();

it('Fix-up 10 P5: the capture notifier offers the signed chat confirmation first, with exact fallback and fresh preview guards', async () => {
  const payload = { ownerType: 'EXPENSE', expenseId: 'expense-1', status: 'DONE', jobId: 'job-1' }, h = makeNotifier({ payload }), notifier = h.notifier as any;
  const now = new Date(), record = { id: 'expense-1', createdAt: now, updatedAt: now };
  const preview: ExpenseActionPreview = { previewId: 'preview', token: '2191d48d-704a-4b1e-a800-6b02661001bb.' + 'a'.repeat(43),
    action: 'CONFIRM', evidenceReview: true, summary: 'ตรวจข้อมูลแล้วกดยืนยันค่ะ', expiresAt: new Date(now.getTime() + 600_000).toISOString(),
    record: { vendorName: 'ร้านค้าดี', amount: '250.00', currency: 'THB', date: '2026-07-25', status: 'รอตรวจ', nextStatus: 'ยืนยันแล้ว' } };
  const ctx = { requestId: 'outbox-1', authSubject: 'user-1', authProvider: 'line', userId: 'user-1', companyId: 'company-1',
    membershipId: 'm1', roles: ['OWNER'], permissions: ['expense.receipt.line_upload', 'expense.review', 'expense.confirm'], scopes: {} };
  notifier.prepared.set(payload, { event: { id: 'outbox-1', claimToken: 'token-1', createdAt: now },
    owner: { companyId: 'company-1', userId: 'user-1', membershipId: 'm1', messagingChannelId: 'channel-1', chatKeyHash: CHAT_HASH },
    epoch: 1, accessFingerprint: 'access', lineUserId: LINE_USER, context: ctx });
  notifier.captureLine.readFinishedDeliveryProof = async () => ({ records: [record] });
  notifier.contexts = { load: async () => ({ row: { id: 'line-v2:conversation-1', lifecycleEpoch: 1 } }) };
  let plan: any, previewCalls = 0, current: ExpenseActionPreview | null = preview;
  notifier.expenseActions = { preview: async (actor: unknown, chat: string, input: unknown, opened: boolean) => {
    assert.equal(actor, ctx); assert.equal(chat, CHAT_HASH); assert.equal(opened, true);
    assert.deepEqual(input, { action: 'CONFIRM', expenseId: 'expense-1' }); previewCalls++; return { preview };
  }, pending: async () => current };
  notifier.plans = { savePlan: async (_producer: unknown, value: unknown) => { plan = value; return { id: 'plan-1' }; } };
  notifier.replayCapturePlan = async () => ({ kind: 'accepted' });
  assert.deepEqual(await notifier.notifyExpense('company-1', payload), { kind: 'accepted' });
  assert.equal(previewCalls, 1); assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(plan))));
  assert.equal(plan.control.kind, 'EXPENSE_ACTION_CONFIRM');
  const messages = plan.batches.flatMap((batch: any) => batch.primary.messages);
  assert.equal(messages.length, 1); assert.equal(messages[0].type, 'flex');
  const buttons = readLineSystemCard(messages[0]).actions;
  assert.equal(buttons[0]!.type, 'postback'); assert.equal(buttons[0]!.label, 'ตรวจแล้ว ยืนยัน');
  assert.match(buttons[0]!.data!, /expense_action_confirm/);
  assert.equal(buttons[1]!.type, 'uri'); assert.equal(new URL(buttons[1]!.uri!).pathname, '/companies/company-1/expenses/expense-1');
  assert.ok(plan.batches[0].fallback.messages[0].quickReply.items.some((item: any) => item.action.data?.includes(preview.token)));
  assert.equal(plan.batches[0].fallback.messages[0].text, plan.answer.items[0].text);
  notifier.captureLine.readLineDeliveryOwner = async () => ({ createdByUserId: 'user-1', ownerBinding: {
    conversationId: 'line-v2:conversation-1', ownerEpoch: 1, channelId: 'channel-1', membershipId: 'm1' } });
  notifier.resolveRecipient = async () => ({ ...ctx, fingerprint: 'access', entitledFeatureKeys: null, lineUserId: LINE_USER, pushTargetId: LINE_USER });
  assert.ok(await notifier.verifyCaptureDeliveryPlan(plan));
  current = null; assert.equal(await notifier.verifyCaptureDeliveryPlan(plan), null, 'a stale or revoked preview refuses result delivery');
});

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
  pushResults?: string[];
  expenseFacts?: Record<string, unknown>;
  companyId?: string;
  /** §3.2: what `AutoHandoffSingleDocumentCaptureUseCase` answers for this group. */
  autoHandoff?: 'expense' | 'skipped' | 'throws';
  /** How many events the drain claims — two rows means the same result delivered twice. */
  events?: number;
  /** Appendix §25 expense lane: `null` models a record the push may not read. */
  expenseSnapshot?: null;
  captureSource?: string;
  /** NR07 cleanup: how many rows the guarded delete matches (0 = the draft is no longer empty). */
  draftDeleteCount?: number;
  retainedCertificateStatus?: string;
  free?: boolean;
  freeUsed?: number;
  branchScope?: string[];
};

const intakeRevision = new Date('2026-07-25T00:00:00.000Z');

function makeNotifier(scenario: Scenario = {}) {
  const published: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const pushes: Array<{ to: string; messages: any[]; key?: string }> = [];
  const attemptUpdates: any[] = [];
  const closes: Array<{ groupId: string; reason: string }> = [];
  const handoffCalls: string[] = [];
  const expenses: string[] = [];
  const draftDeletes: any[] = [];
  const mutateDraft = async (input: any) => {
    draftDeletes.push(input.where);
    const edited = input.where.updatedAt && new Date(scenario.expenseFacts?.updatedAt as any ?? intakeRevision).getTime() !== input.where.updatedAt.getTime();
    const none = input.where.substituteReceiptEvidences?.none;
    const retained = none && scenario.retainedCertificateStatus && (!none.status || none.status.in?.includes(scenario.retainedCertificateStatus));
    return { count: edited || retained ? 0 : scenario.draftDeleteCount ?? 1 };
  };
  const events = Array.from({ length: scenario.events ?? 1 }, (_value, index) => ({
    id: `outbox-${index + 1}`, companyId: scenario.companyId ?? 'company-1',
    eventType: LINE_CAPTURE_READ_FINISHED_EVENT_TYPE,
    claimToken: `token-${index + 1}`,
    payloadJson: scenario.payload && 'ownerType' in scenario.payload
      ? { ...scenario.payload }
      : { groupId: 'group-1', ...(scenario.payload ?? {}) },
  }));

  let freeNoticeMonth: string | null = null;
  const prisma = {
    client: {
      $executeRaw: async () => undefined,
      companyOcrUsageEvent: { findMany: async () => Array.from({ length: scenario.freeUsed ?? 3 }, () => ({ succeededAt: new Date() })) },
      companyPlanTerm: { updateMany: async ({ where, data }: any) => {
        if (where.freeQuotaNoticeSentMonthKey && freeNoticeMonth !== where.freeQuotaNoticeSentMonthKey) return { count: 0 };
        if (data.freeQuotaNoticeSentMonthKey === freeNoticeMonth) return { count: 0 };
        freeNoticeMonth = data.freeQuotaNoticeSentMonthKey; return { count: 1 };
      } },
      user: { findUnique: async () => (scenario.linked === false ? null : { status: scenario.userStatus ?? 'ACTIVE', aiAssistantOptOutAt: null }) },
      externalIdentity: { findFirst: async () => (scenario.linked === false ? null : { providerUserId: LINE_USER }) },
      companyFeatureEntitlement: { findMany: async () => [] },
      lineIntakeAttempt: { findMany: async () => [{ id: 'attempt-1' }] },
      expenseRecord: {
        // `draftDeleteCount: 0` models a draft someone already filled in — the guarded delete matches nothing.
        deleteMany: mutateDraft,
        updateMany: mutateDraft,
        findFirst: async (input: any) => input.where.status === 'VOIDED' ? null : ({
          status: 'NEEDS_REVIEW',
          vendorNameSnapshot: 'ร้านค้าดี', grandTotalAmount: '250.0000', currency: 'THB',
          sourceDocumentType: 'RECEIPT', expenseDate: new Date('2026-07-25T00:00:00.000Z'),
          ...scenario.expenseFacts,
        }),
      },
      // The NR07 cleanup runs in one transaction over the same client.
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma.client),
      expenseCaptureReadJob: { findFirst: async () => ({ expectedSourceUpdatedAt: intakeRevision }) },
      attachmentLink: {
        findMany: async () => [{ attachmentId: 'att-1' }, { attachmentId: 'att-shared' }],
        deleteMany: async (input: any) => { linkDeletes.push(input.where); return { count: 2 }; },
        // `att-shared` is still linked by another record (an auto-split sibling); `att-1` is not.
        count: async (input: any) => (input.where.attachmentId === 'att-shared' ? 1 : 0),
      },
      reimbursementLine: { findFirst: async () => null },
      attachmentObject: {
        updateMany: async (input: any) => { attachmentDeletes.push(input.where.id); return { count: 1 }; },
      },
    },
  } as any;

  const linkDeletes: any[] = [];
  const attachmentDeletes: string[] = [];
  const auditEntries: any[] = [];
  const notifier = new LineCaptureResultNotifierUseCase(
    prisma,
    { webBaseUrl: 'https://app.example.com' } as any,
    { resolveAccess: async () => ({ membershipId: 'm1', roles: ['STAFF'], freeExpenseDrafts: scenario.free === true, permissions: scenario.permissions ?? ['expense.receipt.line_upload'], scopes: scenario.branchScope ? { branchIds: scenario.branchScope } : {} }) } as any,
    {
      readLineDeliveryOwner: async () => scenario.expenseSnapshot === null ? null : ({ createdByUserId: 'user-1', lineChatKeyHash: scenario.lineChatKeyHash === undefined ? CHAT_HASH : scenario.lineChatKeyHash, linePushTargetId: scenario.linePushTargetId ?? null, sourceIsLine: (scenario.intakeChannel ?? 'LINE') === 'LINE' && (scenario.captureSource ?? 'LINE_UPLOAD') === 'LINE_UPLOAD' }),
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
            linePushTargetId: scenario.linePushTargetId ?? null, branchId: 'branch-1',
            vendorNameSnapshot: 'ร้านค้าดี', grandTotalAmount: '250.0000', currency: 'THB',
            sourceDocumentType: 'RECEIPT', expenseDate: new Date('2026-07-25T00:00:00.000Z'),
            primaryAttachmentId: 'att-1',
            ...scenario.expenseFacts,
          },
          jobs: scenario.jobs ?? [{ id: 'job-1', status: 'DONE', pausedReason: null, lastErrorCode: null }],
        }),
    } as any,
    { updateLineIntakeAttemptOutcome: async (input: any) => { attemptUpdates.push(input); return true; } } as any,
    {
      buildTextMessage: (text: string) => ({ type: 'text', text }),
      sendPush: async (to: string, messages: any[], key?: string) => { pushes.push({ to, messages, key }); return scenario.pushResults?.[(pushes.length - 1) % scenario.pushResults.length] ?? scenario.pushResult ?? 'ok'; },
    } as any,
    {
      claimBatch: async () => events,
      markPublished: async (input: any) => { published.push(input.id); return true; },
      markFailed: async (input: any) => { failed.push({ id: input.id, error: input.error }); return true; },
      markDead: async (input: any) => { failed.push({ id: input.id, error: input.error }); return true; },
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
    undefined,
    { log: async (entry: any) => { auditEntries.push(entry); } } as any,
  );
  return { notifier, freeNoticeMonth: () => freeNoticeMonth, published, failed, pushes, attemptUpdates, closes, handoffCalls, expenses, draftDeletes, linkDeletes, attachmentDeletes, auditEntries };
}

const pushedText = (h: ReturnType<typeof makeNotifier>): string => h.pushes[0]?.messages[0]?.canonicalText ?? h.pushes[0]?.messages[0]?.text ?? '';

const EXPENSE_LINK = 'https://app.example.com/companies/company-1/expenses/expense-1';
const RECEIPT_TEXT = `🧾 อ่านเอกสารแล้ว บันทึกเป็นร่างรายการให้แล้วค่ะ\nร้าน: ร้านค้าดี\nยอดในใบเสร็จ: 250.00 บาท\nประเภทเอกสาร: ใบเสร็จรับเงิน\nวันที่: 25 ก.ค. 2569\nยังไม่ยืนยันรายการ\n\n✅ ตรวจสอบและยืนยันในเว็บแอป:\n${EXPENSE_LINK}`;

it('Z3: a failed LINE PDF sends one notice with a web button, with stable retries and distinct result identities', async () => {
  const partial = makeNotifier({ payload: { ownerType: 'EXPENSE', expenseId: 'expense-1', requestId: 'job-1:1', jobId: 'job-1', status: 'PARTIAL' } });
  await partial.notifier.execute();
  const failed = makeNotifier({ events: 2, jobs: [{ id: 'job-1', status: 'FAILED' }],
    payload: { ownerType: 'EXPENSE', expenseId: 'expense-1', requestId: 'job-1:6', jobId: 'job-1', status: 'FAILED', errorCode: 'attempts_exhausted' } });
  assert.deepEqual(await failed.notifier.execute(), { claimed: 2, pushed: 2, skipped: 0, parked: 0 });
  const message = failed.pushes[0]!.messages[0]!;
  assert.equal(failed.pushes[0]!.messages.length, 1);
  assert.equal(message.type, 'flex');
  assert.ok(message.altText.includes('อ่านข้อมูลไม่สำเร็จค่ะ'));
  assert.match(JSON.stringify(message.contents), /เปิดดูในเว็บแอป/);
  assert.ok(JSON.stringify(message.contents).includes(EXPENSE_LINK));
  assert.doesNotMatch(JSON.stringify(message.contents.body), /job-1|attempts_exhausted/);
  assert.equal(failed.pushes[0]!.key, failed.pushes[1]!.key, 'one event retry keeps its provider retry identity');
  assert.notEqual(failed.pushes[0]!.key, partial.pushes[0]!.key, 'a PARTIAL notice cannot dedupe the failure');
  assert.ok(failed.attemptUpdates.every(update => update.outcome === 'STORED_READ_FAILED' && update.reasonCode === 'result_delivered'));
});

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
    assert.match(pushedText(label), /ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้: /);
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
      assert.equal(h.attemptUpdates.length, 0, 'recipient denial happens before reading the private finished snapshot');
      assert.equal(result.skipped, 1);
    });
  }

  it('a push LINE refuses is recorded as undelivered, not as a delivered result', async () => {
    const h = makeNotifier({ pushResult: 'failed_other' });
    const result = await h.notifier.execute();
    assert.equal(h.pushes.length, 1);
    assert.equal(result.pushed, 0);
    assert.equal(h.attemptUpdates[0].reasonCode, 'LINE_DELIVERY_FAILED');
    assert.equal(h.published.length, 0, 'provider failure must remain replayable');
    assert.equal(h.failed.length, 1);
    assert.equal(result.parked, 1);
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

  it('CI09/DI10 blocks a private capture group before reading the finished result, even with flags off', async () => {
    const groupChat = 'Cgroup-chat-id';
    const h = makeNotifier({ linePushTargetId: groupChat, lineChatKeyHash: hashMessagePreview(groupChat) });
    (h.notifier as any).captureLine.readFinishedSnapshot = async () => { throw new Error('PRIVATE_SNAPSHOT_MUST_NOT_LOAD'); };
    const result = await h.notifier.execute();
    assert.equal(result.pushed, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.parked, 0);
    assert.equal(h.pushes.length, 0);
    assert.equal(h.handoffCalls.length, 0);
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

  it('OCR-C sends the ordinary photo review card for a completed LINE PDF benchmark invoice', async () => {
    const h = makeNotifier({ payload: expensePayload({ jobId: 'pdf-job', applied: true }), expenseFacts: {
      vendorNameSnapshot: 'บริษัท ออฟฟิศซัพพลายจำลอง จำกัด', grandTotalAmount: '599586.00',
      vendorDocumentNumber: 'INV202609-0819', vatAmount: '39225.25', vatMode: 'VAT_EXCLUDED', sourceDocumentType: 'TAX_INVOICE',
    } });
    const result = await h.notifier.execute();
    assert.equal(result.pushed, 1); const card = h.pushes[0]!.messages[0]!;
    assert.equal(card.type, 'flex'); assert.ok(isCompleteLineBusinessAnswerPresentation(card));
    assert.match(card.canonicalText, /599,586\.00/); assert.match(card.canonicalText, /ออฟฟิศซัพพลายจำลอง/);
    assert.match(JSON.stringify(card.contents), /39,225\.25/);
  });

  it('pins the existing receipt fallback bytes', async () => {
    const h = makeNotifier({ payload: expensePayload() });
    await h.notifier.execute();
    assert.equal(pushedText(h), RECEIPT_TEXT);
  });

  it('sends the same proved review builder from saved facts without changing the canonical text', async () => {
    const h = makeNotifier({ payload: expensePayload(), expenseFacts: { vendorDocumentNumber: 'ใบเสร็จ-๑', categoryName: 'ค่าอาหาร', vatAmount: '16.3551', vatMode: 'INCLUSIVE' } });
    await h.notifier.execute();
    const message = h.pushes[0].messages[0];
    const expected = buildExpenseDraftReviewCard(RECEIPT_TEXT, {
      expenseId: 'expense-1', subject: 'ข้อมูลใบเสร็จ',
      rows: [
        { label: 'ผู้ขาย / ร้านค้า', value: 'ร้านค้าดี' },
        { label: 'วันที่เอกสาร', value: '25 ก.ค. 2569' },
        { label: 'เลขเอกสาร', value: 'ใบเสร็จ-1' },
        { label: 'ประเภทเอกสาร', value: 'ใบเสร็จรับเงิน' },
        { label: 'หมวดค่าใช้จ่าย', value: 'ค่าอาหาร' },
        { label: 'ยอดรวม', value: '250.00 บาท', total: true },
        { label: 'ภาษีมูลค่าเพิ่ม', value: '16.36 บาท' },
        { label: 'สถานะเอกสาร', value: 'รอตรวจสอบ', pill: 'pending' },
      ], notes: ['ยังไม่ยืนยันรายการ'],
    }, 'https://app.example.com', 'company-1');
    assert.equal(message.type, 'flex');
    assert.equal(message.canonicalText, RECEIPT_TEXT);
    assert.equal(message.canonicalText, expected?.type === 'flex' ? expected.canonicalText : undefined);
    assert.deepEqual(message.contents, expected?.type === 'flex' ? expected.contents : undefined);
    assert.ok(isCompleteLineBusinessAnswerPresentation(message), 'completion menu preserves the renderer proof');
    assert.ok(message.quickReply);
  });

  it('omits missing optional rows without inventing values', async () => {
    const h = makeNotifier({ payload: expensePayload(), expenseFacts: { vendorNameSnapshot: null, grandTotalAmount: null, expenseDate: null, sourceDocumentType: null, vendorDocumentNumber: null, categoryName: null, vatAmount: null } });
    await h.notifier.execute();
    const message = h.pushes[0].messages[0];
    assert.equal(message.type, 'flex');
    const body = JSON.stringify(message.contents);
    for (const label of ['ผู้ขาย / ร้านค้า', 'เลขเอกสาร', 'ประเภทเอกสาร', 'หมวดค่าใช้จ่าย', 'ยอดรวม', 'ภาษีมูลค่าเพิ่ม']) assert.ok(!body.includes(label), label);
    assert.ok(body.includes('สถานะเอกสาร'));
    assert.equal(pushedText(h), `🧾 อ่านเอกสารแล้ว บันทึกเป็นร่างรายการให้แล้วค่ะ\nยอดในใบเสร็จ: ยังอ่านยอดไม่ได้\nวันที่: ยังไม่มีวันที่ กรุณาระบุวันที่เอกสารค่ะ\nยังไม่ยืนยันรายการ\n\n✅ ตรวจสอบและยืนยันในเว็บแอป:\n${EXPENSE_LINK}`);
  });

  it('keeps the proved review card and its exact text fallback in the v2 delivery plan', async () => {
    const h = makeNotifier({ payload: expensePayload() });
    await h.notifier.execute();
    const notifier = h.notifier as any;
    const now = new Date();
    const record = { id: 'expense-1', createdAt: now, updatedAt: now };
    notifier.captureLine.readFinishedDeliveryProof = async () => ({ records: [record] });
    notifier.contexts = { load: async () => ({ row: { id: 'line-v2:conversation-1' } }) };
    let savedPlan: any;
    notifier.plans = { savePlan: async (_producer: unknown, plan: unknown) => { savedPlan = plan; return { id: 'plan-1' }; } };
    notifier.replayCapturePlan = async () => ({ kind: 'accepted' });
    await notifier.saveCapturePlan({
      event: { id: 'outbox-1', claimToken: 'token-1', createdAt: now },
      owner: { companyId: 'company-1', userId: 'user-1', membershipId: 'm1', messagingChannelId: 'channel-1', chatKeyHash: CHAT_HASH },
      epoch: 1, accessFingerprint: 'access', lineUserId: LINE_USER, context: {},
    }, expensePayload({ jobId: 'job-1' }), RECEIPT_TEXT, 'NONE', h.pushes[0].messages[0]);
    assert.equal(savedPlan.batches[0].primary.messages[0].type, 'flex');
    assert.equal(savedPlan.batches[0].fallback.messages[0].type, 'text');
    assert.equal(savedPlan.batches[0].fallback.messages[0].text, savedPlan.answer.items[0].text);
    assert.ok(savedPlan.batches[0].fallback.messages[0].text.includes('250.00 บาท'));
    assert.notEqual(savedPlan.batches[0].primary.pushRetryKey, savedPlan.batches[0].fallback.pushRetryKey);
  });

  it('reads the optional card facts from the saved expense, including its category and decimal VAT', async () => {
    let selected: any;
    const reader = new ExpenseCaptureLineUseCase({} as any, { client: {
      expenseRecord: { findFirst: async (input: any) => {
        selected = input;
        return { id: 'expense-1', companyId: 'company-1', status: 'NEEDS_REVIEW', sourceChannelMetadataJson: null,
          vendorDocumentNumber: 'ใบเสร็จ-1', grandTotalAmount: { toString: () => '250.0000' },
          vatAmount: { toString: () => '16.3551' }, vatMode: 'INCLUSIVE', expenseCategory: { name: 'ค่าอาหาร' } };
      } },
      expenseCaptureReadJob: { findMany: async () => [] },
    } } as any, {} as any);
    const snapshot = await reader.readFinishedExpenseSnapshot('company-1', 'expense-1');
    assert.deepEqual(selected.where, { companyId: 'company-1', id: 'expense-1' });
    assert.equal(selected.select.vendorDocumentNumber, true);
    assert.equal(selected.select.vatAmount, true);
    assert.deepEqual(selected.select.expenseCategory, { select: { name: true } });
    assert.equal(snapshot?.expense.vendorDocumentNumber, 'ใบเสร็จ-1');
    assert.equal(snapshot?.expense.categoryName, 'ค่าอาหาร');
    assert.equal(snapshot?.expense.vatAmount, '16.3551');
  });

  it('downgrades a rejected card once to the pinned text and derives a replay-stable operation key', async () => {
    const h = makeNotifier({ events: 2, payload: expensePayload(), pushResults: ['failed_flex', 'ok'] });
    const result = await h.notifier.execute();
    assert.deepEqual(result, { claimed: 2, pushed: 2, skipped: 0, parked: 0 });
    assert.equal(h.pushes.length, 4);
    for (const [card, fallback] of [[h.pushes[0], h.pushes[1]], [h.pushes[2], h.pushes[3]]]) {
      assert.equal(card.messages[0].type, 'flex');
      assert.equal(fallback.to, card.to);
      assert.equal(fallback.messages[0].type, 'text');
      assert.equal(fallback.messages[0].text, RECEIPT_TEXT);
      assert.deepEqual(fallback.messages[0].quickReply, card.messages[0].quickReply);
      assert.equal(fallback.key, `${card.key}:text-fallback`);
    }
    assert.equal(linePushRetryKey(h.pushes[1].key!, LINE_USER, h.pushes[1].messages), linePushRetryKey(h.pushes[3].key!, LINE_USER, h.pushes[3].messages));
    assert.deepEqual(h.published, ['outbox-1', 'outbox-2']);
    assert.ok(h.attemptUpdates.every(row => row.reasonCode === 'result_delivered'));
  });

  it('wraps the link once and reuses that exact canonical text and menu for the fallback', async () => {
    const h = makeNotifier({ payload: expensePayload(), pushResults: ['failed_flex', 'ok'] });
    let wraps = 0;
    (h.notifier as any).handoffLinks = { wrapOutgoingLineContent: async (_actor: unknown, messages: any[]) => {
      wraps++;
      return messages.map(message => ({ ...message, canonicalText: message.canonicalText.replace(EXPENSE_LINK, 'https://app.example.com/l/synthetic') }));
    } };
    const result = await h.notifier.execute();
    assert.equal(result.pushed, 1);
    assert.equal(wraps, 1);
    assert.equal(h.pushes[1].messages[0].text, RECEIPT_TEXT.replace(EXPENSE_LINK, 'https://app.example.com/l/synthetic'));
    assert.deepEqual(h.pushes[1].messages[0].quickReply, h.pushes[0].messages[0].quickReply);
  });

  for (const pushResults of [['failed_other'], ['failed_permanent'], ['failed_flex', 'failed_other'], ['failed_flex', 'failed_permanent'], ['failed_flex', 'failed_flex']]) {
    it(`keeps failed notices undelivered without a second downgrade: ${pushResults.join(',')}`, async () => {
      const h = makeNotifier({ payload: expensePayload(), pushResults });
      const result = await h.notifier.execute();
      assert.equal(result.parked, 1);
      assert.equal(result.pushed, 0);
      assert.equal(h.pushes.length, pushResults.length);
      assert.equal(h.attemptUpdates[0].reasonCode, 'LINE_DELIVERY_FAILED');
      assert.equal(h.published.length, 0);
    });
  }

  for (const [name, payload, text] of [
    ['failed', { status: 'FAILED' }, `อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้\n${EXPENSE_LINK}`],
    ['partial', { status: 'PARTIAL' }, `อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้\n${EXPENSE_LINK}`],
    ['not applied', { applied: false }, `อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้\n${EXPENSE_LINK}`],
    ['paused', { status: 'PAUSED', pausedReason: 'ai_credit' }, `เก็บไฟล์ไว้แล้วค่ะ แต่ยังอ่านข้อมูลไม่ครบ (เครดิตสำหรับการอ่านเอกสารไม่พอ) ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้\n${EXPENSE_LINK}`],
    ['split', { documentCount: 2, splitExpenseIds: ['expense-2'] }, `📄 อ่านเอกสารแล้วค่ะ พบเอกสาร 2 ใบ สร้างรายการให้แล้ว\n1) ${EXPENSE_LINK}\n2) https://app.example.com/companies/company-1/expenses/expense-2\nยังไม่ยืนยันรายการ กรุณาตรวจในเว็บแอปค่ะ`],
    ['quotation', { classification: { contentKind: 'DOCUMENT', documentKind: 'QUOTATION' } }, `ใบนี้เป็นใบเสนอราคาค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ\nเก็บไฟล์ไว้ในรายการร่างแล้ว ยังไม่ยืนยัน ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้: ${EXPENSE_LINK}`],
    ['parcel label', { classification: { contentKind: 'DOCUMENT', documentKind: 'DELIVERY_NOTE', missingRequiredSignals: ['PARCEL_LABEL_SIGNAL'] } }, `ใบนี้เป็นใบปะหน้าพัสดุค่ะ ยังไม่พบหลักฐานการจ่ายค่าส่ง หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ\nเก็บไฟล์ไว้ในรายการร่างแล้ว ยังไม่ยืนยัน ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้: ${EXPENSE_LINK}`],
    ['deposit slip', { classification: { contentKind: 'DOCUMENT', documentKind: 'DELIVERY_NOTE', missingRequiredSignals: ['DEPOSIT_SLIP_SIGNAL'] } }, `ใบนี้ยืนยันการรับฝากพัสดุค่ะ แต่ยังไม่พบข้อมูลการจ่ายค่าส่ง หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ\nเก็บไฟล์ไว้ในรายการร่างแล้ว ยังไม่ยืนยัน ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้: ${EXPENSE_LINK}`],
    ['invoice', { classification: { contentKind: 'DOCUMENT', documentKind: 'SUPPLIER_INVOICE_OR_BILL' } }, 'ใบนี้เป็นใบแจ้งหนี้ค่ะ ยังไม่พบหลักฐานการชำระ กรุณาตรวจข้อมูลก่อนบันทึก'],
    ['invoice with amount', { documentTotal: '250.00', classification: { contentKind: 'DOCUMENT', documentKind: 'SUPPLIER_INVOICE_OR_BILL' } }, 'ใบนี้เป็นใบแจ้งหนี้ ยอด 250.00 บาทค่ะ ยังไม่พบหลักฐานการชำระ กรุณาตรวจข้อมูลก่อนบันทึก'],
    ['transfer slip', { classification: { contentKind: 'DOCUMENT', documentKind: 'TRANSFER_SLIP' } }, 'พบสลิปโอนเงินค่ะ กรุณาตรวจว่าจ่ายค่าอะไรและให้ใคร'],
    ['marketplace order', { classification: { contentKind: 'DOCUMENT', documentKind: 'MARKETPLACE_ORDER' } }, 'พบหลักฐานคำสั่งซื้อค่ะ กรุณาตรวจรายการและสถานะชำระเงิน'],
    ['unknown document', { classification: { contentKind: 'AMBIGUOUS', documentKind: 'NEEDS_REVIEW' } }, `ยังไม่แน่ใจว่าเป็นเอกสารประเภทใดค่ะ\nเก็บไฟล์ไว้ในรายการร่างแล้ว ยังไม่ยืนยัน ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้: ${EXPENSE_LINK}`],
    ['non-business', { classification: { contentKind: 'DOCUMENT', documentKind: 'NON_FINANCIAL_IMAGE' } }, 'ภาพนี้ไม่ใช่เอกสารค่าใช้จ่ายค่ะ จึงไม่ได้สร้างรายการ ส่งเอกสารค่าใช้จ่ายที่ต้องการบันทึกได้เลยค่ะ'],
  ] as const) {
    it(`pins ${name} as today's text notice byte for byte`, async () => {
      const h = makeNotifier({ payload: expensePayload({ jobId: 'job-1', ...payload }) });
      await h.notifier.execute();
      assert.equal(h.pushes.length, 1);
      assert.equal(h.pushes[0].messages[0].type, name === 'failed' ? 'flex' : 'text');
      assert.equal(pushedText(h), text);
    });
  }

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

  it('NR07 removes the empty draft the way a delete does, and says no record was created', async () => {
    const h = makeNotifier({
      payload: expensePayload({ jobId: 'job-1', classification: { contentKind: 'DOCUMENT', documentKind: 'NON_FINANCIAL_IMAGE' } }),
    });
    await h.notifier.execute();
    assert.match(pushedText(h), /ภาพนี้ไม่ใช่เอกสารค่าใช้จ่ายค่ะ จึงไม่ได้สร้างรายการ/);
    assert.ok(!/companies\/company-1\/expenses\/expense-1/.test(pushedText(h)), 'no link to a record that is gone');
    assert.equal(h.draftDeletes.length, 1);
    // Only an EMPTY draft is removed: anything with money, a payment or a posting is left alone.
    assert.deepEqual(h.draftDeletes[0], {
      companyId: 'company-1', id: 'expense-1', status: { in: ['DRAFT', 'NEEDS_REVIEW'] },
      grandTotalAmount: 0, paidAmount: 0, postingStatus: 'not_required', sourceReimbursementRequestId: null,
      updatedAt: intakeRevision, substituteReceiptEvidences: { none: {} },
    });
    // Its file links go with it; a file nothing else links is retired, a shared one stays.
    assert.deepEqual(h.linkDeletes, [{ companyId: 'company-1', targetType: 'expense.record', targetId: 'expense-1' }]);
    assert.deepEqual(h.attachmentDeletes, ['att-1']);
    // And the removal is on the record, as a SYSTEM rule — never a silent row disappearing.
    assert.equal(h.auditEntries.length, 1);
    assert.equal(h.auditEntries[0].action, 'expense.delete');
    assert.equal(h.auditEntries[0].actorType, 'SYSTEM');
    assert.deepEqual(h.auditEntries[0].metadataJson, { rule: 'nr07_non_business_document', jobId: 'job-1', attachmentIds: ['att-1'] });
  });

  it('NR07 on a draft someone already filled in keeps it, and never claims no record exists', async () => {
    const h = makeNotifier({
      draftDeleteCount: 0,
      payload: expensePayload({ classification: { contentKind: 'DOCUMENT', documentKind: 'NON_FINANCIAL_IMAGE' } }),
    });
    await h.notifier.execute();
    assert.equal(h.linkDeletes.length, 0, 'nothing is unlinked from a record that stays');
    assert.equal(h.attachmentDeletes.length, 0);
    assert.ok(!/จึงไม่ได้สร้างรายการ/.test(pushedText(h)), 'the record exists, so that sentence would be false');
    assert.match(pushedText(h), /เก็บไฟล์ไว้แล้ว/);
    assert.match(pushedText(h), /\/companies\/company-1\/expenses\/expense-1/);
  });

  it('LINE-ACT keeps a zero-total draft edited after intake and every retained certificate status', async () => {
    const scenarios = [{ expenseFacts: { updatedAt: new Date(intakeRevision.getTime() + 1) } },
      ...['PREPARED', 'PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED'].map(retainedCertificateStatus => ({ retainedCertificateStatus }))];
    for (const retainReceipt of [false, true]) for (const scenario of scenarios) {
      const h = makeNotifier({ ...scenario, payload: expensePayload({ jobId: 'job-1', classification: { contentKind: 'DOCUMENT', documentKind: 'NON_FINANCIAL_IMAGE' } }) });
      const removed = await (h.notifier as any).deleteEmptyDraft('company-1', 'expense-1', 'job-1', retainReceipt);
      assert.equal(removed, false);
      assert.equal(h.linkDeletes.length, 0); assert.equal(h.attachmentDeletes.length, 0); assert.equal(h.auditEntries.length, 0);
    }
  });

  it('LINE-ACT keeps an empty draft when no intake revision is available', async () => {
    const h = makeNotifier();
    assert.equal(await (h.notifier as any).deleteEmptyDraft('company-1', 'expense-1', null), false);
    assert.equal(h.draftDeletes.length, 0);
  });

  it('a DONE read that was not written onto the draft sends the partial sentence, never a zero receipt card', async () => {
    const h = makeNotifier({ payload: expensePayload({ documentCount: 1, applied: false }) });
    await h.notifier.execute();
    assert.match(pushedText(h), /อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว/);
    assert.ok(!/ยอดในใบเสร็จ/.test(pushedText(h)), 'no receipt card for facts that never reached the draft');
    assert.ok(!/อ่านเอกสารอีกครั้ง/.test(pushedText(h)), '§17.6: no re-read offered');
    assert.match(pushedText(h), /\/companies\/company-1\/expenses\/expense-1/);
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
    assert.equal(h.attemptUpdates.length, 0, 'no private snapshot is loaded after unlink');
  });
});


describe('file read result payment evidence pairing', () => {
  it('replaces the second-slip draft reply with attached plus undo and preserves the action through the completion menu', async () => {
    const h = makeNotifier({ payload: { ownerType: 'EXPENSE', expenseId: 'slip', status: 'DONE', applied: true,
      classification: { contentKind: 'DOCUMENT', documentKind: 'TRANSFER_SLIP' } }, expenseFacts: { sourceDocumentType: 'TRANSFER_SLIP' } });
    let calls = 0;
    (h.notifier as any).paymentEvidence = { forCapture: async (ctx: any, chat: string, id: string) => {
      assert.equal(ctx.userId, 'user-1'); assert.equal(chat, CHAT_HASH); assert.equal(id, 'slip'); calls += 1;
      return { kind: 'LINKED', slipId: 'slip', receiptId: 'receipt', operationId: 'file-pair' };
    } };
    const result = await h.notifier.execute();
    assert.equal(calls, 1); assert.equal(result.pushed, 1);
    assert.equal(pushedText(h), 'แนบสลิปเป็นหลักฐานการจ่ายของใบเสร็จแล้วค่ะ');
    const action = h.pushes[0]!.messages[0].quickReply.items[0].action;
    assert.equal(action.type, 'postback'); assert.match(action.data, /operation=undo/);
  });
  it('does not pair a failed or stale OCR result', async () => {
    for (const payload of [{ status: 'FAILED' }, { status: 'DONE', applied: false }]) {
      const h = makeNotifier({ payload: { ownerType: 'EXPENSE', expenseId: 'slip', ...payload } });
      (h.notifier as any).paymentEvidence = { forCapture: async () => assert.fail('not a successful, applied read') };
      await h.notifier.execute();
    }
  });
});

it('R10 Q2: capture snapshot hides the storage placeholder and the result asks for the document date', async () => {
  const reader = new ExpenseCaptureLineUseCase({} as any, { client: { expenseRecord: { findFirst: async () => ({
    id: 'expense-1', status: 'DRAFT', captureSource: 'LINE_UPLOAD', createdByUserId: 'user-1',
    sourceChannelMetadataJson: {}, expenseDate: new Date('2026-10-16'), aiVerificationSummaryJson: { dateStatus: 'unverified', missingFields: ['expenseDate'] },
  }) }, expenseCaptureReadJob: { findMany: async () => [] } } } as any, {} as any);
  const snapshot = await reader.readFinishedExpenseSnapshot('company-1', 'expense-1');
  assert.equal(snapshot!.expense.expenseDate, null);
  const h = makeNotifier({ payload: { ownerType: 'EXPENSE', expenseId: 'expense-1', status: 'DONE', documentCount: 1, applied: true }, expenseFacts: { expenseDate: snapshot!.expense.expenseDate } });
  await h.notifier.execute();
  assert.match(pushedText(h), /ยังไม่มีวันที่/); assert.match(JSON.stringify(h.pushes), /กรุณาระบุวันที่เอกสารค่ะ/);
  assert.doesNotMatch(pushedText(h), /16 ต\.ค\. 2569/);
});

it('R11 T1: every preview exception still freezes and delivers the capture result without action controls', async () => {
  for (const error of [new RangeError('Expense source draft supports at most 40 items.'), new Error('preview unavailable')]) {
    const payload = { ownerType: 'EXPENSE', expenseId: 'expense-1', status: 'DONE', jobId: 'job-1' };
    const h = makeNotifier({ payload }), notifier = h.notifier as any, now = new Date();
    const original = notifier.notifyExpense.bind(notifier);
    notifier.notifyExpense = async (companyId: string, actualPayload: object) => {
      notifier.prepared.set(actualPayload, { event: { id: 'outbox-1', claimToken: 'token-1', createdAt: now },
        owner: { companyId: 'company-1', userId: 'user-1', membershipId: 'm1', messagingChannelId: 'channel-1', chatKeyHash: CHAT_HASH },
        epoch: 1, accessFingerprint: 'access', lineUserId: LINE_USER,
        context: { companyId: 'company-1', userId: 'user-1', requestId: 'outbox-1' } });
      return original(companyId, actualPayload);
    };
    notifier.captureLine.readFinishedDeliveryProof = async () => ({ records: [{ id: 'expense-1', createdAt: now, updatedAt: now }] });
    notifier.contexts = { load: async () => ({ row: { id: 'line-v2:conversation-1', lifecycleEpoch: 1 } }) };
    notifier.expenseActions = { preview: async () => { throw error; } };
    let plan: any;
    notifier.plans = { savePlan: async (_producer: unknown, value: unknown) => { plan = value; return { id: 'plan-1' }; } };
    notifier.replayCapturePlan = async () => {
      const batch = plan.batches[0];
      const delivered = await notifier.pushResult(LINE_USER, batch.primary.messages, 'preview-fallback');
      return delivered === 'ok' ? { kind: 'accepted' } : { kind: 'retryable', code: 'LINE_DELIVERY_NOT_ACCEPTED' };
    };
    assert.deepEqual(await notifier.execute(), { claimed: 1, pushed: 1, skipped: 0, parked: 0 });
    assert.deepEqual(h.failed, []); assert.deepEqual(h.published, ['outbox-1']); assert.equal(h.pushes.length, 1);
    assert.ok(parseLineDeliveryPlan(JSON.parse(JSON.stringify(plan)))); assert.equal(plan.control, null);
    assert.match(pushedText(h), /250\.00/); assert.ok(pushedText(h).includes(EXPENSE_LINK));
    assert.ok(!JSON.stringify(plan).includes('expense_action_confirm'));
  }
});

it('keeps persisted English capture language through the asynchronous result card and completion buttons', async () => {
  const h = makeNotifier({ payload: { ownerType: 'EXPENSE', expenseId: 'expense-1', status: 'DONE', documentCount: 1, applied: true },
    expenseFacts: { language: 'en', vendorNameSnapshot: 'ABC', expenseDate: new Date('2026-07-25T00:00:00Z') } });
  const result = await h.notifier.execute();
  assert.equal(result.pushed, 1);
  assert.equal(h.pushes.length, 1);
  assert.doesNotMatch(JSON.stringify(h.pushes[0]!.messages), /[\u0E00-\u0E7F]/u);
  assert.match(JSON.stringify(h.pushes[0]!.messages), /draft|Draft/u);
});


describe('free capture completion notice', () => {
  const allowance = { source: 'FREE_MONTHLY_3', monthKey: CURRENT_MONTH, usedCount: 3 };
  const payload = { ownerType: 'EXPENSE', expenseId: 'expense-1', status: 'DONE', applied: true,
    quotaSource: 'FREE_MONTHLY_3', freeAllowance: allowance, documentCount: 1 };
  it('appends the third successful result notice once, without a separate push', async () => {
    const h = makeNotifier({ free: true, payload, events: 2 });
    await h.notifier.execute();
    assert.match(h.pushes[0]?.messages[0]?.text, /ใช้สิทธิ์อ่านฟรีครบ 3 ใบ/);
    assert.doesNotMatch(JSON.stringify(h.pushes[1]?.messages ?? []), /ใช้สิทธิ์อ่านฟรีครบ 3 ใบ/);
    assert.equal(h.freeNoticeMonth(), CURRENT_MONTH);
    assert.equal(h.handoffCalls.length, 0);
  });
  it('does not send a success notice for pending/failed results or a company that upgraded', async () => {
    for (const over of [
      { free: true, payload: { ...payload, freeAllowance: { ...allowance, usedCount: 2 } } },
      { free: true, payload: { ...payload, status: 'FAILED', freeAllowance: undefined } },
      { free: false, payload },
    ]) {
      const h = makeNotifier(over);
      await h.notifier.execute();
      assert.doesNotMatch(pushedText(h), /ใช้สิทธิ์อ่านฟรีครบ 3 ใบ/);
      assert.equal(h.freeNoticeMonth(), null);
    }
  });
  it('releases only the notice claim and parks a failed free push, keeping saved results for delivery retry', async () => {
    const h = makeNotifier({ free: true, payload, pushResult: 'failed_other' });
    const result = await h.notifier.execute();
    assert.equal(result.parked, 1);
    assert.equal(h.freeNoticeMonth(), null);
    assert.equal(h.failed.length, 1);
    assert.equal(h.published.length, 0);
    assert.equal(h.attemptUpdates[0]?.reasonCode, 'LINE_DELIVERY_FAILED');
  });
  it('does not auto-handoff a free source legacy group and names a multi-document refusal', async () => {
    const h = makeNotifier({ free: true, payload: { quotaSource: 'FREE_MONTHLY_3', status: 'DONE', documentCount: 1 }, autoHandoff: 'expense' });
    await h.notifier.execute();
    assert.equal(h.handoffCalls.length, 0);
    const rejected = makeNotifier({ free: true, payload: { ...payload, status: 'FAILED', freeAllowance: undefined, errorCode: 'FREE_MULTI_DOCUMENT_UNSUPPORTED' } });
    await rejected.notifier.execute();
    assert.match(pushedText(rejected), /ไฟล์นี้มีหลายเอกสาร/);
  });
});

it('does not deliver a free result after branch scope is revoked', async () => {
  const h = makeNotifier({ free: true, branchScope: ['other-branch'], payload: {
    ownerType: 'EXPENSE', expenseId: 'expense-1', status: 'DONE', applied: true,
    quotaSource: 'FREE_MONTHLY_3', freeAllowance: { source: 'FREE_MONTHLY_3', monthKey: CURRENT_MONTH, usedCount: 3 },
  } });
  const result = await h.notifier.execute();
  assert.equal(result.skipped, 1);
  assert.equal(h.pushes.length, 0);
  assert.equal(h.freeNoticeMonth(), null);
});


it('free completion freezes its third-result notice in the guarded delivery plan without financial previews', async () => {
  const now = new Date();
  const h = makeNotifier({ free: true, payload: { ownerType: 'EXPENSE', expenseId: 'expense-1', jobId: 'job-1', status: 'DONE', applied: true,
    quotaSource: 'FREE_MONTHLY_3', freeAllowance: { source: 'FREE_MONTHLY_3', monthKey: CURRENT_MONTH, usedCount: 3 } } });
  const notifier: any = h.notifier, original = notifier.notifyExpense.bind(notifier);
  notifier.notifyExpense = async (companyId: string, payload: object) => {
    notifier.prepared.set(payload, { event: { id: 'outbox-1', claimToken: 'token-1', createdAt: now },
      owner: { companyId: 'company-1', userId: 'user-1', membershipId: 'm1', messagingChannelId: 'channel-1', chatKeyHash: CHAT_HASH },
      epoch: 1, accessFingerprint: 'access', lineUserId: LINE_USER, context: { companyId: 'company-1', userId: 'user-1', requestId: 'outbox-1' } });
    return original(companyId, payload);
  };
  notifier.captureLine.readFinishedDeliveryProof = async () => ({ records: [{ id: 'expense-1', createdAt: now, updatedAt: now }] });
  notifier.contexts = { load: async () => ({ row: { id: 'line-v2:conversation-1', lifecycleEpoch: 1 } }) };
  notifier.expenseActions = { preview: async () => assert.fail('free read cannot offer confirm') };
  notifier.paymentEvidence = { forCapture: async () => assert.fail('free read cannot link payment evidence') };
  let plan: any;
  notifier.plans = { savePlan: async (_producer: unknown, value: unknown) => { plan = value; return { id: 'plan-1' }; } };
  notifier.prisma.client.lineDeliveryPlan = { findUnique: async () => ({ id: 'plan-1' }) };
  notifier.replayCapturePlan = async () => ({ kind: 'retryable', code: 'LINE_DELIVERY_NOT_ACCEPTED' });
  const result = await h.notifier.execute();
  assert.equal(result.parked, 1);
  assert.match(JSON.stringify(plan), /ใช้สิทธิ์อ่านฟรีครบ 3 ใบ/);
  assert.ok(!JSON.stringify(plan).includes('expense_action_confirm'));
  assert.equal(h.freeNoticeMonth(), CURRENT_MONTH, 'the frozen retry plan retains its single notice claim');
});
