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
  payload?: Record<string, unknown>;
  pushResult?: string;
  companyId?: string;
};

function makeNotifier(scenario: Scenario = {}) {
  const published: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const pushes: Array<{ to: string; messages: any[]; key?: string }> = [];
  const attemptUpdates: any[] = [];
  const closes: Array<{ groupId: string; reason: string }> = [];
  const events = [{
    id: 'outbox-1', companyId: scenario.companyId ?? 'company-1', eventType: LINE_CAPTURE_READ_FINISHED_EVENT_TYPE,
    claimToken: 'token-1', payloadJson: { groupId: 'group-1', ...(scenario.payload ?? {}) },
  }];

  const prisma = {
    client: {
      user: { findUnique: async () => (scenario.linked === false ? null : { status: scenario.userStatus ?? 'ACTIVE', aiAssistantOptOutAt: null }) },
      externalIdentity: { findFirst: async () => (scenario.linked === false ? null : { providerUserId: LINE_USER }) },
      companyFeatureEntitlement: { findMany: async () => [] },
      lineIntakeAttempt: { findMany: async () => [{ id: 'attempt-1' }] },
    },
  } as any;

  const notifier = new LineCaptureResultNotifierUseCase(
    prisma,
    { webBaseUrl: 'https://app.example.com' } as any,
    { resolveAccess: async () => ({ membershipId: 'm1', roles: ['STAFF'], permissions: scenario.permissions ?? ['expense.receipt.line_upload'], scopes: {} }) } as any,
    {
      readFinishedSnapshot: async (_companyId: string, groupId: string) => ({
        group: { id: groupId, status: 'OPEN', intakeChannel: scenario.intakeChannel ?? 'LINE',
          createdByUserId: 'user-1', lineChatKeyHash: scenario.lineChatKeyHash === undefined ? CHAT_HASH : scenario.lineChatKeyHash, branchId: null },
        jobs: scenario.jobs ?? [{ id: 'job-1', status: 'DONE', pausedReason: null, lastErrorCode: null }],
        observations: 1,
        webPath: `/companies/company-1/expenses/capture/${groupId}`,
      }),
      closeMergedGroup: async (_ctx: any, groupId: string, reason: string) => { closes.push({ groupId, reason }); return true; },
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
  );
  return { notifier, published, failed, pushes, attemptUpdates, closes };
}

const pushedText = (h: ReturnType<typeof makeNotifier>): string => h.pushes[0]?.messages[0]?.text ?? '';

describe('LINE capture result push (appendix §3)', () => {
  it('DONE pushes the summary with the group link and settles the outbox row once', async () => {
    const h = makeNotifier({ payload: { status: 'DONE', issuerName: 'ร้านค้าดี', documentTotal: '250.00', documentCount: 1 } });
    const result = await h.notifier.execute();
    assert.deepEqual(result, { claimed: 1, pushed: 1, skipped: 0, parked: 0 });
    assert.equal(h.pushes.length, 1);
    assert.equal(h.pushes[0].to, LINE_USER);
    assert.match(pushedText(h), /อ่านเอกสารแล้วค่ะ พบ ร้านค้าดี ยอด 250\.00/);
    assert.match(pushedText(h), /expenses\/capture\/group-1/);
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
      assert.match(pushedText(h), /expenses\/capture\/group-1/);
      assert.ok(!/อ่านซ้ำ|ลองอ่านใหม่/.test(pushedText(h)), '§17.6 offers no re-read');
    });
  }

  it('PAUSED names the real reason, in the wave-2 credit wording', async () => {
    const h = makeNotifier({ jobs: [{ id: 'job-1', status: 'PAUSED', pausedReason: 'ai_credit' }], payload: { status: 'PAUSED' } });
    await h.notifier.execute();
    assert.match(pushedText(h), /ยังอ่านข้อมูลไม่ครบ \(เครดิตสำหรับการอ่านเอกสารไม่พอ\)/);
    assert.ok(!/งบ AI|โควตา AI/.test(pushedText(h)));
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
    ['a group chat whose id cannot be recovered from its hash', { lineChatKeyHash: 'some-other-chat-hash' }],
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

  it('an event with no group id settles without pushing anything', async () => {
    const noGroup = makeNotifier({ payload: { groupId: undefined as any } });
    // The payload spread above leaves `groupId` undefined, which is the malformed-event case.
    const result = await noGroup.notifier.execute();
    assert.equal(noGroup.pushes.length, 0);
    assert.equal(result.skipped, 1);
  });
});
