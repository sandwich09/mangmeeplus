import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PartnerController } from './partner.controller';
import { GetPartnerTimelineUseCase } from '../../application/use-cases/get-partner-timeline.use-case';
import { SendPartnerLineMessageUseCase } from '../../application/use-cases/send-partner-line-message.use-case';
import { EndPlanTermWarmupUseCase } from '../../application/use-cases/company-plan-term.use-cases';

const REQ = { context: { userId: 'admin-1', requestId: 'req-1' } } as any;
const NOW = new Date('2026-09-20T03:00:00.000Z');

const originalFetch = globalThis.fetch;
let pushes: Array<{ to: string; text: string }> = [];

beforeEach(() => {
  pushes = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    pushes.push({ to: body.to, text: body.messages[0].text });
    return { ok: true, status: 200, headers: { get: () => null } };
  }) as any;
});
afterEach(() => { globalThis.fetch = originalFetch; });

type Options = {
  company?: any | null;
  signup?: any | null;
  webEntry?: any | null;
  ocrEvents?: any[];
  aiEvent?: any | null;
  packageChanges?: any[];
  planTerm?: any | null;
  ownerIdentities?: Array<{ providerUserId: string }>;
  ownerMemberships?: Array<{ userId: string }>;
  /** The `LineSupportRequest` a `supportRequestId` resolves to. `companyId`/`status` default to
   *  "this shop, still waiting", so a case only spells out the half it is about. */
  supportRequest?: { companyId?: string; status?: string; lineUserId: string } | null;
  memberIdentity?: any | null;
  ocrUsage?: { usedCount: number } | null;
  aiUsage?: { costSatang: number } | null;
  aiConfig?: { monthlyBudgetSatang: number | null } | null;
  token?: string | null;
  webBaseUrl?: string;
};

function harness(options: Options = {}) {
  const audits: any[] = [];
  const planTermUpdates: any[] = [];
  const supportAnswered: any[] = [];
  const supportLookups: any[] = [];
  let planTerm = options.planTerm === undefined ? null : options.planTerm;

  const prisma = {
    client: {
      company: {
        findUnique: async () => (options.company === undefined
          ? { id: 'co-1', name: 'ร้านนิด', status: 'ACTIVE', createdAt: new Date('2026-09-01T02:00:00.000Z') }
          : options.company),
      },
      companySignupRequest: { findFirst: async () => options.signup ?? null },
      auditLog: {
        findFirst: async () => options.webEntry ?? null,
        create: async (args: any) => { audits.push(args.data); return {}; },
      },
      companyOcrUsageEvent: {
        findFirst: async (args: any) => {
          const events = options.ocrEvents ?? [];
          if (events.length === 0) return null;
          return args.orderBy.createdAt === 'asc' ? events[0] : events[events.length - 1];
        },
      },
      aiUsageEvent: { findFirst: async () => options.aiEvent ?? null },
      packageChangeRequest: { findMany: async () => options.packageChanges ?? [] },
      companyPlanTerm: {
        findUnique: async () => planTerm,
        update: async (args: any) => {
          planTermUpdates.push(args);
          planTerm = { ...planTerm, ...args.data };
          return planTerm;
        },
      },
      externalIdentity: {
        findFirst: async () => (options.memberIdentity === undefined ? { id: 'ei-1' } : options.memberIdentity),
        findMany: async () => options.ownerIdentities ?? [{ providerUserId: 'Uowner-1' }],
      },
      companyMembership: { findMany: async () => options.ownerMemberships ?? [{ userId: 'owner-1' }] },
      companyOcrMonthlyUsage: { findUnique: async () => options.ocrUsage ?? null },
      companyAiMonthlyUsage: { findUnique: async () => options.aiUsage ?? null },
      companyAiConfiguration: { findUnique: async () => options.aiConfig ?? null },
      user: { findUnique: async () => ({ displayName: 'พี่แอดมิน' }) },
      // line-support-request-spec-th §2.3: answering the shop closes its OPEN request, so the
      // operator does not have to remember a second button.
      lineSupportRequest: {
        findUnique: async (args: any) => {
          supportLookups.push(args);
          if (options.supportRequest === undefined || options.supportRequest === null) {
            return options.supportRequest ?? null;
          }
          return { id: 'sr-9', companyId: 'co-1', status: 'OPEN', ...options.supportRequest };
        },
        updateMany: async (args: any) => { supportAnswered.push(args); return { count: 1 }; },
      },
      $transaction: async (fn: any) => fn(prisma.client),
    },
  } as any;

  const config = {
    aiMonthlyBudgetSatang: 8000,
    lineMessagingChannelAccessToken: options.token === undefined ? 'token-1' : options.token ?? undefined,
    sesWebBaseUrl: options.webBaseUrl ?? 'https://app.mangmeeplus.com',
  } as any;

  // Only the three P10-L tools are exercised here; every pre-existing dependency is covered by
  // partner.controller.spec.ts, so this builds the instance without inventing stand-ins for them —
  // a stand-in list would silently need updating every time that constructor grows.
  const controller = Object.create(PartnerController.prototype) as any;
  controller.endWarmup = new EndPlanTermWarmupUseCase(prisma);
  controller.timeline = new GetPartnerTimelineUseCase(prisma, config);
  controller.lineMessage = new SendPartnerLineMessageUseCase(prisma, config);

  return {
    controller: controller as PartnerController, audits, planTermUpdates, supportAnswered, supportLookups,
    planTerm: () => planTerm,
  };
}

describe('GET /system/partners/:id/timeline — §8', () => {
  it('tells the shop story in order, from rows that already exist', async () => {
    const h = harness({
      signup: {
        source: 'line-oa',
        createdAt: new Date('2026-09-01T02:00:00.000Z'),
        approvedAt: new Date('2026-09-01T03:00:00.000Z'),
        autoApproved: true,
        legalAcceptedAt: new Date('2026-09-01T02:00:05.000Z'),
        legalDocumentVersion: '2026-08-01',
        phoneNumber: '0982565628',
      },
      webEntry: { createdAt: new Date('2026-09-01T04:00:00.000Z') },
      ocrEvents: [
        { createdAt: new Date('2026-09-01T05:00:00.000Z'), sourceRoute: 'receipt-ocr-line' },
        { createdAt: new Date('2026-09-10T05:00:00.000Z') },
      ],
      packageChanges: [
        { requestedTierKey: 'PRO_999', status: 'OPEN', createdAt: new Date('2026-09-15T05:00:00.000Z') },
      ],
      planTerm: {
        tierKey: 'FREE_TRIAL_15', monthlySlipLimit: 15, warmupUntil: null,
        warmupSlipLimit: null, termEndsAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });

    const { entries } = await h.controller.partnerTimeline('co-1');
    const kinds = entries.map((entry) => entry.kind);

    assert.deepEqual(kinds, [
      'signup_submitted', 'legal_accepted', 'signup_approved',
      'first_web_entry', 'first_receipt', 'last_activity', 'package_change',
    ]);
    assert.equal(entries[0]!.label, 'สมัครจาก LINE');
    assert.equal(entries[2]!.label, 'อนุมัติอัตโนมัติ');
    assert.equal(entries[4]!.detail, 'ส่งมาทาง LINE');
    assert.match(entries[6]!.label, /ขอเปลี่ยนแพ็กเกจเป็น/);
    assert.equal(entries[6]!.detail, 'รอแอดมิน');
  });

  it('says the shop was opened by an admin when there is no application behind it', async () => {
    const h = harness({ signup: null });
    const { entries } = await h.controller.partnerTimeline('co-1');
    assert.equal(entries[0]!.label, 'แอดมินเปิดร้านให้');
  });

  it('404s for a company that does not exist', async () => {
    const h = harness({ company: null });
    await assert.rejects(() => h.controller.partnerTimeline('nope'), NotFoundException);
  });
});

describe('the timeline last line: why the assistant is refusing right now', () => {
  const refusalOf = async (options: Options) => {
    const { entries } = await harness(options).controller.partnerTimeline('co-1');
    return entries.find((entry) => entry.kind === 'ai_refusal')?.detail;
  };
  const liveTerm = {
    tierKey: 'FREE_TRIAL_15', monthlySlipLimit: 15, warmupUntil: null,
    warmupSlipLimit: null, termEndsAt: new Date('2026-10-01T00:00:00.000Z'),
  };

  it('is absent for a healthy shop', async () => {
    assert.equal(await refusalOf({ planTerm: liveTerm }), undefined);
  });

  it('names a disabled company first, because nothing else matters then', async () => {
    const detail = await refusalOf({
      company: { id: 'co-1', name: 'ร้านนิด', status: 'DISABLED', createdAt: NOW },
      planTerm: liveTerm,
    });
    assert.equal(detail, 'ร้านอยู่สถานะ DISABLED');
  });

  it('names an expired term', async () => {
    const detail = await refusalOf({
      planTerm: { ...liveTerm, termEndsAt: new Date('2026-09-01T00:00:00.000Z') },
    });
    assert.equal(detail, 'แพ็กเกจหมดอายุแล้ว');
  });

  it('names an unlinked shop', async () => {
    assert.equal(await refusalOf({ planTerm: liveTerm, memberIdentity: null }), 'ยังไม่มีสมาชิกคนไหนผูก LINE');
  });

  it('counts the warm-up ceiling, not the tier ceiling, while warm-up is on', async () => {
    const detail = await refusalOf({
      planTerm: { ...liveTerm, warmupUntil: new Date('2030-01-01T00:00:00.000Z'), warmupSlipLimit: 10 },
      ocrUsage: { usedCount: 10 },
    });
    assert.equal(detail, 'ให้ AI อ่านรูปครบ 10 ครั้งของเดือนนี้แล้ว');
  });

  it('names the AI budget, against the shop own override', async () => {
    assert.equal(
      await refusalOf({ planTerm: liveTerm, aiUsage: { costSatang: 8000 } }),
      'ใช้งบ AI ของเดือนนี้ครบแล้ว',
    );
    assert.equal(
      await refusalOf({
        planTerm: liveTerm,
        aiUsage: { costSatang: 8000 },
        aiConfig: { monthlyBudgetSatang: 20000 },
      }),
      undefined,
    );
  });
});

describe('POST /system/partners/:id/line-message — SEC-05', () => {
  it('pushes to the shop OWNERs, signed with the operator name, and audits the text', async () => {
    const h = harness();
    const result = await h.controller.sendLineMessage('co-1', { text: 'ได้รับเรื่องแล้วนะคะ' }, REQ);

    assert.deepEqual(result, { delivered: 1 });
    assert.equal(pushes[0]!.to, 'Uowner-1');
    assert.match(pushes[0]!.text, /พี่แอดมิน/);
    assert.match(pushes[0]!.text, /ได้รับเรื่องแล้วนะคะ/);
    assert.equal(h.audits[0].action, 'system.partner.line_message_sent');
    assert.equal(h.audits[0].metadataJson.text, 'ได้รับเรื่องแล้วนะคะ');
    assert.equal(h.audits[0].result, 'SUCCESS');
    // line-support-request-spec-th §2.3: the message IS the answer, so the request closes with it.
    assert.deepEqual(h.supportAnswered[0].where, { companyId: 'co-1', status: 'OPEN' });
    assert.equal(h.supportAnswered[0].data.answeredByUserId, 'admin-1');
  });

  it('leaves the request OPEN when the message reached nobody', async () => {
    const h = harness({ ownerIdentities: [] });
    const result = await h.controller.sendLineMessage('co-1', { text: 'ได้รับเรื่องแล้วนะคะ' }, REQ);

    assert.deepEqual(result, { delivered: 0 });
    assert.deepEqual(h.supportAnswered, [], 'a message nobody received has answered nobody');
  });

  /**
   * Review 2026-09-06 (F4). Pushing to every open requester of the shop handed one customer's
   * answer to every other customer waiting on it — two strangers reading each other's support
   * conversation. Without a named request this box is what it always was: a message to the shop.
   */
  it('never broadcasts an answer to everyone else waiting on the shop', async () => {
    const h = harness({ supportRequest: { lineUserId: 'Ustranger-1' } });
    const result = await h.controller.sendLineMessage('co-1', { text: 'ได้รับเรื่องแล้วนะคะ' }, REQ);

    assert.deepEqual(result, { delivered: 1 });
    assert.deepEqual(pushes.map((push) => push.to), ['Uowner-1'], 'the shop, and nobody else');
    assert.deepEqual(h.supportLookups, [], 'and no request is read at all when none was named');
  });

  /**
   * The person waiting may be an EMPLOYEE, whose reply went to a chat they cannot see (and, in a
   * shop with no LINE-linked owner, to nobody at all). The operator says WHICH request they are
   * answering — the link from the inbox carries it — and that one person is added.
   */
  it('reaches the one requester the operator named, alongside the shop OWNERs', async () => {
    const h = harness({ supportRequest: { lineUserId: 'Uemployee-1' } });
    const result = await h.controller.sendLineMessage(
      'co-1', { text: 'ได้รับเรื่องแล้วนะคะ', supportRequestId: 'sr-9' }, REQ,
    );

    assert.deepEqual(result, { delivered: 2 });
    assert.deepEqual(pushes.map((push) => push.to), ['Uowner-1', 'Uemployee-1']);
    assert.equal(h.supportLookups[0].where.id, 'sr-9');
    // §3: the audit counts recipients, it does not name them.
    const sent = h.audits.find((row: any) => row.action === 'system.partner.line_message_sent');
    assert.equal(sent.metadataJson.recipients, 2);
    assert.equal(JSON.stringify(h.audits).includes('Uemployee-1'), false);
  });

  it('sends one message, not two, when the OWNER is the person who asked', async () => {
    const h = harness({ supportRequest: { lineUserId: 'Uowner-1' } });
    const result = await h.controller.sendLineMessage(
      'co-1', { text: 'ได้รับเรื่องแล้วนะคะ', supportRequestId: 'sr-9' }, REQ,
    );

    assert.deepEqual(result, { delivered: 1 });
    assert.deepEqual(pushes.map((push) => push.to), ['Uowner-1']);
  });

  it('answers an employee-raised request even when no OWNER has LINE linked', async () => {
    const h = harness({
      ownerMemberships: [], ownerIdentities: [],
      supportRequest: { lineUserId: 'Uemployee-1' },
    });
    const result = await h.controller.sendLineMessage(
      'co-1', { text: 'ได้รับเรื่องแล้วนะคะ', supportRequestId: 'sr-9' }, REQ,
    );

    assert.deepEqual(result, { delivered: 1 }, 'the request would otherwise wait for ever');
    assert.equal(h.audits[0].result, 'SUCCESS');
  });

  /**
   * §2.3 says answering IS answering the request. Naming one makes that precise: only that request
   * moves, and it moves with the same audit the "ตอบแล้ว" button writes, so the operator does not
   * have to press it a second time and the two paths cannot tell different stories.
   */
  it('marks the named request answered, with the button\'s own audit', async () => {
    const h = harness({ supportRequest: { lineUserId: 'Uemployee-1' } });
    await h.controller.sendLineMessage(
      'co-1', { text: 'ได้รับเรื่องแล้วนะคะ', supportRequestId: 'sr-9' }, REQ,
    );

    assert.deepEqual(h.supportAnswered[0].where, { id: 'sr-9', status: 'OPEN' },
      'only the request this reply names, not every stranger on the same shop');
    assert.equal(h.supportAnswered[0].data.answeredByUserId, 'admin-1');
    const answered = h.audits.find((row: any) => row.action === 'system.support_request.answered');
    assert.ok(answered, 'the inbox has to be able to say who answered, and when');
    assert.equal(answered.targetType, 'line_support_request');
    assert.equal(answered.targetId, 'sr-9');
    assert.equal(answered.riskLevel, 'HIGH');
    assert.equal(answered.metadataJson.previousStatus, 'OPEN');
  });

  it('is idempotent on a request that was already answered', async () => {
    const h = harness({ supportRequest: { status: 'ANSWERED', lineUserId: 'Uemployee-1' } });
    await h.controller.sendLineMessage(
      'co-1', { text: 'อัปเดตให้ค่ะ', supportRequestId: 'sr-9' }, REQ,
    );

    assert.deepEqual(pushes.map((push) => push.to), ['Uowner-1', 'Uemployee-1'], 'a second reply still lands');
    assert.deepEqual(h.supportAnswered[0].where, { id: 'sr-9', status: 'OPEN' },
      'the guard is what makes it idempotent: nothing to move');
  });

  it('refuses a request belonging to another shop, rather than pushing across tenants', async () => {
    const h = harness({ supportRequest: { companyId: 'co-2', lineUserId: 'Ustranger-1' } });
    await assert.rejects(
      () => h.controller.sendLineMessage('co-1', { text: 'สวัสดีค่ะ', supportRequestId: 'sr-9' }, REQ),
      (error: Error) => error instanceof NotFoundException,
    );
    assert.deepEqual(pushes, []);
    assert.deepEqual(h.audits, []);
  });

  it('refuses a request that is already CLOSED, which nobody is waiting on', async () => {
    const h = harness({ supportRequest: { status: 'CLOSED', lineUserId: 'Uemployee-1' } });
    await assert.rejects(
      () => h.controller.sendLineMessage('co-1', { text: 'สวัสดีค่ะ', supportRequestId: 'sr-9' }, REQ),
      (error: Error) => error instanceof NotFoundException,
    );
    assert.deepEqual(pushes, []);
  });

  it('refuses a request id that does not exist', async () => {
    const h = harness({ supportRequest: null });
    await assert.rejects(
      () => h.controller.sendLineMessage('co-1', { text: 'สวัสดีค่ะ', supportRequestId: 'sr-gone' }, REQ),
      (error: Error) => error instanceof NotFoundException,
    );
  });

  it('refuses a message longer than the bound, before it reaches LINE', async () => {
    const h = harness();
    await assert.rejects(
      () => h.controller.sendLineMessage('co-1', { text: 'ก'.repeat(501) }, REQ),
      (error: Error) => error instanceof UnprocessableEntityException
        && /partner_line_message_too_long/.test(error.message),
    );
    assert.deepEqual(pushes, []);
    assert.deepEqual(h.audits, [], 'nothing was said, so nothing is recorded as said');
  });

  // B-1: the operator writes the whitespace, so "one token to the next space" was a rule they
  // controlled. Every one of these renders the second URL live in the customer's chat.
  it('refuses a second URL glued onto one of ours', async () => {
    // A Thai letter and a closing bracket are ordinary text, and neither can ever be on a list of
    // terminators — which is why the rule is that a token may not CONTAIN a second scheme.
    for (const glue of ['"', '<', '`', '\u200b', '\u0e04', ')', '\u3002', '']) {
      const h = harness();
      await assert.rejects(
        () => h.controller.sendLineMessage(
          'co-1',
          { text: `\u0e14\u0e39\u0e17\u0e35\u0e48 https://app.mangmeeplus.com/x${glue}https://evil.test/pay` },
          REQ,
        ),
        (error: Error) => /partner_line_message_external_link/.test(error.message),
      );
      assert.deepEqual(pushes, [], `glue ${JSON.stringify(glue)} must never reach LINE`);
      assert.deepEqual(h.audits, [], 'and nothing is recorded as said');
    }
  });

  it('refuses a link outside our own domains', async () => {
    const h = harness();
    await assert.rejects(
      () => h.controller.sendLineMessage('co-1', { text: 'โอนที่ https://evil.example.com ค่ะ' }, REQ),
      (error: Error) => /partner_line_message_external_link/.test(error.message),
    );
    assert.deepEqual(pushes, []);
  });

  it('sends to nobody, and records the failure, when no OWNER has LINE linked', async () => {
    // A shop whose only linked member is staff: the recipient set is OWNERs, not members.
    const h = harness({ ownerMemberships: [], ownerIdentities: [] });
    const result = await h.controller.sendLineMessage('co-1', { text: 'สวัสดีค่ะ' }, REQ);

    assert.deepEqual(result, { delivered: 0 });
    assert.deepEqual(pushes, []);
    assert.equal(h.audits[0].result, 'FAILED', 'an operator must not believe they answered');
  });

  it('404s for a company that does not exist', async () => {
    const h = harness({ company: null });
    await assert.rejects(() => h.controller.sendLineMessage('nope', { text: 'สวัสดีค่ะ' }, REQ), NotFoundException);
  });
});

describe('POST /system/partners/:id/plan-term/end-warmup — §9 "ตรวจแล้ว"', () => {
  const warmTerm = {
    companyId: 'co-1', tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2,
    monthlySlipLimit: 15, termStartAt: new Date('2026-09-01T00:00:00.000Z'),
    termEndsAt: new Date('2026-10-01T00:00:00.000Z'), warningDays: 7, renewCount: 0,
    lastRenewedAt: null, termDisabledAt: null,
    warmupUntil: new Date('2030-01-01T00:00:00.000Z'), warmupSlipLimit: 10,
  };

  it('moves the ceiling to now and records who lifted it', async () => {
    const h = harness({ planTerm: { ...warmTerm } });
    const { term } = await h.controller.endPlanTermWarmup('co-1', REQ);

    assert.ok(term);
    assert.ok(new Date(term!.warmupUntil!).getTime() <= Date.now(), 'the warm-up is over as of now');
    assert.equal(h.audits[0].action, 'system.company_plan_term.warmup_ended');
    assert.equal(h.audits[0].metadataJson.warmupSlipLimit, 10);
  });

  it('is a no-op on a warm-up that already ended', async () => {
    // Safely in the past whatever day this suite runs on: the use-case reads the real clock.
    const h = harness({ planTerm: { ...warmTerm, warmupUntil: new Date('2020-01-01T00:00:00.000Z') } });
    await h.controller.endPlanTermWarmup('co-1', REQ);
    assert.deepEqual(h.planTermUpdates, []);
    assert.deepEqual(h.audits, []);
  });

  it('is a no-op for a shop that never had a warm-up', async () => {
    const h = harness({ planTerm: { ...warmTerm, warmupUntil: null, warmupSlipLimit: null } });
    await h.controller.endPlanTermWarmup('co-1', REQ);
    assert.deepEqual(h.planTermUpdates, []);
  });

  it('404s for a grandfathered company with no term row', async () => {
    const h = harness({ planTerm: null });
    await assert.rejects(() => h.controller.endPlanTermWarmup('co-1', REQ), NotFoundException);
  });
});
