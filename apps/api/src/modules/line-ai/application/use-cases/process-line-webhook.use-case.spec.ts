import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_AI_CONTEXT_MAX_TURNS } from '@watchdog-bms/contracts';
import { branchScopeFallbackLabel, ProcessLineWebhookUseCase, readResponseBodyLimited, toAiTurnIntent } from './process-line-webhook.use-case';
import { ReceiptOcrApplyService } from '../../../expenses/application/services/receipt-ocr-apply.service';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const CLEAN_SCANNER = { assertClean: async () => undefined } as any;

/**
 * Shadow probe double (piece 5). The employee LINE webhook records one `ai_line_assistant`
 * observation per resolved turn, UPSTREAM of the `lineAssistantDisabled` refusal. Recording into a
 * module-level array and asserting on the DELTA keeps every existing test untouched.
 */
const shadowRecords: Array<{ surface: string; companyId: string | null; featureKey: string | null }> = [];
const shadowFlushes: string[] = [];
const shadowProbe = {
  startSweep: (surface: string) => ({
    record: async (companyId: string | null, featureKey: string | null) => {
      shadowRecords.push({ surface, companyId, featureKey });
      return { wouldBlock: false, reason: 'available' as const };
    },
    flush: async () => { shadowFlushes.push(surface); return {}; },
  }),
} as any;
const acceptedLegal = { isRequired: async () => false } as any;

describe('readResponseBodyLimited', () => {
  it('combines a chunked response within the hard byte cap', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2]));
        controller.enqueue(Uint8Array.from([3]));
        controller.close();
      },
    }));

    assert.deepEqual(await readResponseBodyLimited(response, 3), Buffer.from([1, 2, 3]));
  });

  it('cancels a chunked response as soon as its running total exceeds the cap', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2]));
        controller.enqueue(Uint8Array.from([3, 4]));
      },
      cancel() { cancelled = true; },
    }));

    assert.equal(await readResponseBodyLimited(response, 3), null);
    assert.equal(cancelled, true);
  });
});

const ROUTED_EXPENSE_DOCUMENT = {
  status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.98,
} as const;

function receiptClassification(amount: string) {
  return {
    contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.98, evidenceSignals: ['ใบเสร็จ'], amountSignals: [amount], settlementSignals: ['ชำระแล้ว'],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  };
}

// Builds a minimal prisma mock with controllable memberships + lineCompanyContext
function makePrisma(opts: {
	  identityUserId?: string | null;
	  displayName?: string;
	  /** Channel the stored identity was linked on; the lookup is channel-scoped first. */
	  identityChannelId?: string;
	  aiAssistantOptOutAt?: Date | null;
	  memberships?: Array<{ companyId: string; company?: { name: string; brandName?: string | null }; roles?: Array<{ role: { key: string } }> }>;
	  lineCompanyContext?: { companyId: string } | null;
	  previousEventLog?: { webhookEventId: string; status: string; createdAt: Date } | null;
	  recentTurns?: any[];
	  entitlements?: Array<{ featureKey: string; enabled: boolean }>;
	  branches?: Array<{ name: string }>;
	  branchFindManyFn?: (args: any) => Promise<Array<{ name: string }>>;
	} = {}) {
	  const { identityUserId = 'user-1', displayName = 'พิม', identityChannelId = 'msg-channel-1', aiAssistantOptOutAt = null, memberships = [{ companyId: 'company-1' }], lineCompanyContext = null, previousEventLog = null, recentTurns = [], entitlements = [], branches = [], branchFindManyFn } = opts;
  const identityQueries: any[] = [];
  const createdLogs: unknown[] = [];
  const updates: unknown[] = [];
  const upserts: unknown[] = [];
  const aiTurns: unknown[] = [];
  const aiTurnUpdates: unknown[] = [];
  const toolInvocations: any[] = [];
  const membershipRows = memberships.map((membership) => ({
    company: { name: membership.companyId, brandName: null, ...membership.company },
    roles: membership.roles ?? [{ role: { key: 'OWNER' } }],
    ...membership,
  }));
  const markerWrites: any[] = [];
  const branchFindManyCalls: any[] = [];
  const prisma = {
    client: {
      // Consumption markers commit with the terminal outcome; the fake runs the callback inline.
      $transaction: async (work: (tx: any) => Promise<unknown>) => work({
        outboxEvent: {
          create: async ({ data }: any) => { markerWrites.push(data); },
          findMany: async () => [],
        },
      }),
      lineWebhookEventLog: {
        findUnique: async () => null,
        findFirst: async () => previousEventLog,
        create: async (args: unknown) => { createdLogs.push(args); return args; },
        updateMany: async (args: unknown) => { updates.push(args); return { count: 1 }; },
      },
      externalIdentity: {
        findFirst: async (args: any) => {
          identityQueries.push(args?.where);
          if (!identityUserId) return null;
          const scopedTo = args?.where?.providerChannelId;
          if (scopedTo && scopedTo !== identityChannelId) return null;
          return { userId: identityUserId, user: { status: 'ACTIVE', displayName, aiAssistantOptOutAt } };
        },
      },
      companyMembership: {
        findMany: async () => membershipRows,
      },
      lineCompanyContext: {
        findUnique: async () => lineCompanyContext,
        upsert: async (args: unknown) => { upserts.push(args); return args; },
      },
      companyFeatureEntitlement: {
        findMany: async () => entitlements,
      },
      branch: {
        findMany: async (args: any) => {
          branchFindManyCalls.push(args);
          return branchFindManyFn ? branchFindManyFn(args) : branches;
        },
      },
      expenseRecord: {
        update: async (args: unknown) => args,
      },
      attachmentLink: {
        findFirst: async () => null,
      },
      aiConversation: {
        upsert: async (args: any) => ({ id: args.where.id }),
      },
	      aiTurn: {
	        findMany: async (args: any) => {
	          const since = args.where?.createdAt?.gte as Date | undefined;
	          return recentTurns
	            .filter((turn) => !since || turn.createdAt >= since)
	            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
	            .slice(0, args.take ?? recentTurns.length);
	        },
	        create: async (args: unknown) => { aiTurns.push(args); return { id: 'turn-1', ...(args as object) }; },
          update: async (args: unknown) => { aiTurnUpdates.push(args); return args; },
	      },
      aiToolInvocation: {
        createMany: async (args: any) => { toolInvocations.push(...args.data); return { count: args.data.length }; },
      },
      lineIntakePendingMedia: {
        findFirst: async () => null,
        findUnique: async () => null,
        create: async (args: unknown) => args,
        update: async (args: unknown) => args,
      },
    },
  } as any;
  return { prisma, createdLogs, updates, upserts, aiTurns, aiTurnUpdates, toolInvocations, markerWrites, branchFindManyCalls, identityQueries };
}

function makeUseCase(
  prisma: any,
	  opts: {
	    permissions?: string[];
	    roles?: string[];
	    branchIds?: string[];
	    aiGatewayFn?: (req?: any) => any;
	    intakeRouteFn?: (req?: any) => any;
	    sendReplyFn?: (token: string, messages: any[]) => Promise<any>;
      sendPushFn?: (to: string, messages: any[]) => Promise<any>;
      malwareScanFn?: (bytes: Buffer) => Promise<void>;
      initReceiptUpload?: any;
      completeReceiptUpload?: any;
      legalAcceptanceRequired?: boolean;
	  } = {},
	) {
  const replies: string[] = [];
  const sentMessages: any[] = [];
  const pushes: Array<{ to: string; text: string; message: any }> = [];
  const auditEvents: any[] = [];
	  const legalChecks: Array<{ userId: string; companyId: string; membershipId: string }> = [];
	  const { permissions = ['dashboard.read'], roles = ['STAFF'], branchIds, aiGatewayFn, intakeRouteFn, sendReplyFn, sendPushFn } = opts;
	  let aiGatewayCalled = false;
	  const aiGatewayRequests: any[] = [];
	  const intakeRequests: any[] = [];

  const useCase = new ProcessLineWebhookUseCase(
    prisma,
    { webBaseUrl: 'https://app.example.com' } as any,
    { resolveAccess: async () => ({ membershipId: 'mem-1', roles, permissions, scopes: branchIds === undefined ? {} : { branchIds } }) } as any,
    { log: async (entry: any) => { auditEvents.push(entry); } } as any,
    {
	      requestLineTurn: async (req: any) => {
	        aiGatewayCalled = true;
	        aiGatewayRequests.push(req);
	        if (aiGatewayFn) return aiGatewayFn(req);
	        throw new Error('AI Gateway not expected');
	      },
	      requestLineIntakeRoute: async (req: any) => {
	        intakeRequests.push(req);
	        if (intakeRouteFn) return intakeRouteFn(req);
	        throw new Error('LINE intake router not expected');
	      },
	    } as any,
    {
      buildTextMessage: (text: string) => ({ type: 'text', text }),
      sendReply: async (token: string, messages: any[]) => {
        if (sendReplyFn) return sendReplyFn(token, messages);
        sentMessages.push(messages[0]);
        replies.push(messages[0]?.text ?? messages[0]?.altText ?? '');
        return 'ok';
      },
      sendPush: async (to: string, messages: any[]) => {
        if (sendPushFn) return sendPushFn(to, messages);
        pushes.push({ to, text: messages[0]?.text ?? messages[0]?.altText ?? '', message: messages[0] });
        return 'ok';
      },
    } as any,
    { apply: async () => ({ candidatesCreated: 0 }) } as any,
    { assertClean: opts.malwareScanFn ?? CLEAN_SCANNER.assertClean } as any,
    { isRequired: async (input: { userId: string; companyId: string; membershipId: string }) => {
      legalChecks.push(input);
      return opts.legalAcceptanceRequired ?? false;
    } } as any,
    shadowProbe,
    opts.initReceiptUpload,
    opts.completeReceiptUpload,
  );

	  return { useCase, replies, sentMessages, pushes, aiGatewayRequests, intakeRequests, auditEvents, legalChecks, getAiGatewayCalled: () => aiGatewayCalled };
	}

const BASE_EVENT = {
  webhookEventId: 'evt-1',
  lineUserId: 'line-user-secret',
  replyToken: 'reply-1',
  messageText: 'ดู dashboard',
  messagingChannelId: 'msg-channel-1',
};

describe('toAiTurnIntent (free-form model intent → AiTurn enum)', () => {
  it('passes through valid enum values (case-insensitive)', () => {
    assert.equal(toAiTurnIntent('read_detail'), 'READ_DETAIL');
    assert.equal(toAiTurnIntent('READ_SUMMARY'), 'READ_SUMMARY');
  });
  it('maps free-form/model intents to UNKNOWN so persistence never rejects', () => {
    assert.equal(toAiTurnIntent('list_all_products'), 'UNKNOWN');
    assert.equal(toAiTurnIntent('สรุปสินค้าใกล้หมดสต็อก'), 'UNKNOWN');
  });
  it('falls back via the refusal reason', () => {
    assert.equal(toAiTurnIntent('transfer_funds', 'mutation_blocked'), 'MUTATION_REQUEST');
    assert.equal(toAiTurnIntent('weather', 'feature_disabled'), 'UNSUPPORTED_MODULE');
    assert.equal(toAiTurnIntent('x', 'forbidden_permission'), 'FORBIDDEN');
  });
});

describe('ProcessLineWebhookUseCase', () => {
  // A LINE userId only means anything within one messaging channel, so an unscoped lookup could
  // answer a webhook from one OA with an identity linked on another.
  it('resolves the identity on the webhook channel', async () => {
    const { prisma, identityQueries } = makePrisma();
    const { useCase } = makeUseCase(prisma, { permissions: ['dashboard.read'] });

    await useCase.execute(BASE_EVENT);

    assert.equal(identityQueries.length, 1);
    assert.equal(identityQueries[0].providerChannelId, 'msg-channel-1');
    assert.equal(identityQueries[0].providerUserId, 'line-user-secret');
  });

  it('still reports unlinked when neither the scoped nor the fallback lookup finds an identity', async () => {
    const { prisma, updates, identityQueries } = makePrisma({ identityUserId: null });
    const { useCase, replies } = makeUseCase(prisma, { permissions: ['line.ai.query'] });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-unlinked' });

    assert.equal(identityQueries.length, 2);
    assert.match(replies[0] ?? '', /กรุณาเชื่อมต่อบัญชี/);
    assert.equal((updates.at(-1) as any).data.status, 'unlinked');
  });

  // Identities linked before providerChannelId was recorded must keep working without relinking.
  it('falls back to a channel-agnostic identity for legacy links', async () => {
    const { prisma, updates, identityQueries } = makePrisma({ identityChannelId: 'legacy-channel' });
    const { useCase, replies } = makeUseCase(prisma, { permissions: ['dashboard.read'] });

    await useCase.execute(BASE_EVENT);

    assert.equal(identityQueries.length, 2);
    assert.equal(identityQueries[1].providerChannelId, undefined);
    // Identity resolved, so the turn reaches the permission gate instead of the unlinked reply.
    assert.match(replies[0] ?? '', /ไม่มีสิทธิ์/);
    assert.equal((updates[0] as any).data.status, 'forbidden');
  });

  it('preflights legal acceptance with the server-resolved company and membership only', async () => {
    const { prisma, identityQueries } = makePrisma();
    const { useCase, legalChecks } = makeUseCase(prisma, { legalAcceptanceRequired: true });

    const result = await useCase.preflightLegalAcceptance({
      lineUserId: 'line-user-secret',
      messagingChannelId: 'msg-channel-1',
    });

    assert.deepEqual(result, { status: 'required', companyId: 'company-1' });
    assert.deepEqual(legalChecks, [{ userId: 'user-1', companyId: 'company-1', membershipId: 'mem-1' }]);
    assert.equal(identityQueries.length, 1);
    assert.equal(identityQueries[0].providerChannelId, 'msg-channel-1');
  });

  it('preflight does not invent a company for an unlinked or unresolved multi-company user', async () => {
    const unlinked = makePrisma({ identityUserId: null });
    const unlinkedUseCase = makeUseCase(unlinked.prisma, { legalAcceptanceRequired: true });
    assert.deepEqual(
      await unlinkedUseCase.useCase.preflightLegalAcceptance({ lineUserId: 'unknown', messagingChannelId: 'msg-channel-1' }),
      { status: 'continue' },
    );
    assert.equal(unlinkedUseCase.legalChecks.length, 0);

    const multi = makePrisma({
      memberships: [{ companyId: 'company-1' }, { companyId: 'company-2' }],
      lineCompanyContext: null,
    });
    const multiUseCase = makeUseCase(multi.prisma, { legalAcceptanceRequired: true });
    assert.deepEqual(
      await multiUseCase.useCase.preflightLegalAcceptance({ lineUserId: 'line-user-secret', messagingChannelId: 'msg-channel-1' }),
      { status: 'continue' },
    );
    assert.equal(multiUseCase.legalChecks.length, 0);
  });

  it('preflight honors the explicitly selected company for a multi-company owner', async () => {
    const { prisma } = makePrisma({
      memberships: [{ companyId: 'company-1' }, { companyId: 'company-2' }],
      lineCompanyContext: { companyId: 'company-2' },
    });
    const { useCase, legalChecks } = makeUseCase(prisma, { legalAcceptanceRequired: true });

    const result = await useCase.preflightLegalAcceptance({
      lineUserId: 'line-user-secret',
      messagingChannelId: 'msg-channel-1',
    });

    assert.deepEqual(result, { status: 'required', companyId: 'company-2' });
    assert.equal(legalChecks[0]?.companyId, 'company-2');
  });

  // PDPA objection route (M-05 register §3.1): an opted-out user's turn must stop before
  // any model/gateway involvement, on both the text and the media entry paths.
  it('refuses text turns for an opted-out user before any gateway involvement', async () => {
    const { prisma, updates } = makePrisma({ aiAssistantOptOutAt: new Date('2026-07-28T00:00:00Z') });
    const { useCase, replies, getAiGatewayCalled } = makeUseCase(prisma, { permissions: ['line.ai.query'] });

    await useCase.execute(BASE_EVENT);

    assert.equal(getAiGatewayCalled(), false);
    assert.match(replies[0] ?? '', /ปิดการใช้งานผู้ช่วย AI/);
    assert.equal((updates.at(-1) as any).data.status, 'ai_opt_out');
  });

  it('refuses media turns for an opted-out user before any intake routing', async () => {
    const { prisma, updates } = makePrisma({ aiAssistantOptOutAt: new Date('2026-07-28T00:00:00Z') });
    const { useCase, replies, intakeRequests, getAiGatewayCalled } = makeUseCase(prisma, {
      permissions: ['expense.receipt.line_upload'],
    });

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-optout-img',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-optout-img',
      lineMessageId: 'line-msg-optout',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    });

    assert.equal(getAiGatewayCalled(), false);
    assert.equal(intakeRequests.length, 0);
    assert.match(replies[0] ?? '', /ปิดการใช้งานผู้ช่วย AI/);
    assert.equal((updates.at(-1) as any).data.status, 'ai_opt_out');
  });

  it('refuses employee text before model routing while legal acceptance is pending', async () => {
    const { prisma, updates } = makePrisma();
    const { useCase, replies, intakeRequests, getAiGatewayCalled } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      legalAcceptanceRequired: true,
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-legal-text' });

    assert.equal(getAiGatewayCalled(), false);
    assert.equal(intakeRequests.length, 0);
    assert.match(replies[0] ?? '', /ยอมรับข้อกำหนดการใช้งาน/);
    assert.equal((updates.at(-1) as any).data.status, 'legal_acceptance_required');
  });

  it('refuses employee media before download, OCR, routing, or storage while acceptance is pending', async () => {
    const { prisma, updates } = makePrisma();
    const { useCase, replies, intakeRequests, getAiGatewayCalled } = makeUseCase(prisma, {
      permissions: ['expense.receipt.line_upload', 'expense.receipt.upload'],
      legalAcceptanceRequired: true,
    });
    let mediaDownloads = 0;
    (useCase as any).downloadLineMedia = async () => {
      mediaDownloads += 1;
      throw new Error('must not download before legal acceptance');
    };

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-legal-media',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-legal-media',
      lineMessageId: 'line-msg-legal-media',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    });

    assert.equal(mediaDownloads, 0);
    assert.equal(getAiGatewayCalled(), false);
    assert.equal(intakeRequests.length, 0);
    assert.match(replies[0] ?? '', /รับทราบนโยบายความเป็นส่วนตัว/);
    assert.equal((updates.at(-1) as any).data.status, 'legal_acceptance_required');
  });

  it('denies linked users without line.ai.query and does not call AI Gateway', async () => {
    const { prisma, updates } = makePrisma();
    const { useCase, replies, getAiGatewayCalled } = makeUseCase(prisma, { permissions: ['dashboard.read'] });

    await useCase.execute(BASE_EVENT);

    assert.equal(getAiGatewayCalled(), false);
    assert.match(replies[0] ?? '', /ไม่มีสิทธิ์/);
    assert.equal((updates[0] as any).data.status, 'forbidden');
  });

  it('denies the whole turn when ai_line_assistant entitlement is toggled off', async () => {
    const { prisma, updates } = makePrisma({ entitlements: [{ featureKey: 'ai_line_assistant', enabled: false }] });
    const { useCase, replies, getAiGatewayCalled } = makeUseCase(prisma, { permissions: ['line.ai.query'] });

    await useCase.execute(BASE_EVENT);

    assert.equal(getAiGatewayCalled(), false);
    assert.match(replies[0] ?? '', /ยังไม่ได้เปิดใช้งาน/);
    assert.equal((updates[0] as any).data.status, 'feature_disabled');
  });

  it('denies when entitlements are configured but ai_line_assistant has no row (deny-by-default once configured)', async () => {
    const { prisma, updates } = makePrisma({ entitlements: [{ featureKey: 'expenses', enabled: true }] });
    const { useCase, getAiGatewayCalled } = makeUseCase(prisma, { permissions: ['line.ai.query'] });

    await useCase.execute(BASE_EVENT);

    assert.equal(getAiGatewayCalled(), false);
    assert.equal((updates[0] as any).data.status, 'feature_disabled');
  });

  it('allows the turn when ai_line_assistant entitlement is enabled', async () => {
    const { prisma, updates } = makePrisma({ entitlements: [{ featureKey: 'ai_line_assistant', enabled: true }] });
    const { useCase, getAiGatewayCalled } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        requestId: 'req-ai',
        replyText: 'สรุปแดชบอร์ดวันนี้',
        sourceRefs: [],
        sourceLabels: [],
        webLinks: [],
        intent: 'read_summary',
        agent: 'general',
        refused: false,
        toolsInvoked: [],
        durationMs: 1,
      }),
    });

    await useCase.execute(BASE_EVENT);

    assert.equal(getAiGatewayCalled(), true);
    assert.equal((updates.at(-1) as any).data.status, 'completed');
  });

  it('delivers a successful business query as one themed Flex answer card', async () => {
    const { prisma } = makePrisma();
    const { useCase, sentMessages } = makeUseCase(prisma, {
      permissions: ['line.ai.query', 'expense.read'],
      aiGatewayFn: () => ({
        requestId: 'req-card', replyText: 'เดือนนี้ยังไม่มีค่าใช้จ่าย รวม 0.00 บาท',
        sourceRefs: [], sourceLabels: ['ค่าใช้จ่าย'], webLinks: [], intent: 'read_summary', agent: 'accounting',
        refused: false, toolsInvoked: ['expense.get_breakdown'], durationMs: 1,
        presentation: { kind: 'answer_cards', cards: [{
          title: 'ค่าใช้จ่ายเดือนนี้', text: 'เดือนนี้ยังไม่มีค่าใช้จ่าย รวม 0.00 บาท', sourceLabels: ['ค่าใช้จ่าย'],
          webLink: { label: 'ดูค่าใช้จ่าย', path: '/companies/company-1/expenses' },
        }] },
      }),
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-answer-card', messageText: 'ดูค่าใช้จ่ายเดือนนี้' });

    assert.equal(sentMessages[0]?.type, 'flex');
    assert.match(JSON.stringify(sentMessages[0]), /เดือนนี้ยังไม่มีค่าใช้จ่าย/);
    assert.match(JSON.stringify(sentMessages[0]), /#22C55E/);
    assert.deepEqual(sentMessages[0]?.quickReply?.items.map((item: any) => item.action.label), ['ค่าใช้จ่ายเดือนนี้', '📊 ถามข้อมูล']);
  });

  it('keeps a refused response in a trusted fallback card even if a malformed gateway response carries presentation', async () => {
    const { prisma } = makePrisma();
    const { useCase, sentMessages } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        requestId: 'req-refused-card', replyText: '🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้',
        sourceRefs: [], sourceLabels: [], webLinks: [], intent: 'forbidden', agent: 'general',
        refused: true, refusalReason: 'forbidden', toolsInvoked: [], durationMs: 1,
        presentation: { kind: 'answer_cards', cards: [{ text: 'ข้อมูลลับ' }] },
      }),
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-refused-card' });

    assert.equal(sentMessages[0]?.type, 'flex');
    assert.match(JSON.stringify(sentMessages[0]), /คุณไม่มีสิทธิ์/);
    assert.doesNotMatch(JSON.stringify(sentMessages[0]), /ข้อมูลลับ/);
  });

  it('keeps a clarification focused and does not attach the completion menu', async () => {
    const { prisma } = makePrisma();
    const { useCase, sentMessages, getAiGatewayCalled } = makeUseCase(prisma, {
      permissions: ['line.ai.query', 'expense.receipt.line_upload'],
      intakeRouteFn: () => ({
        status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0.9,
        clarifyQuestion: 'กรุณาระบุวันที่เอกสารค่ะ',
      }),
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-clarify-no-menu', messageText: 'บันทึกใบเสร็จ' });

    assert.equal(getAiGatewayCalled(), false);
    assert.equal(sentMessages[0]?.type, 'text');
    assert.equal(sentMessages[0]?.quickReply, undefined);
  });

  it('preserves the same Flex payload for expired-token push fallback', async () => {
    const { prisma } = makePrisma();
    const { useCase, pushes } = makeUseCase(prisma, {
      permissions: ['line.ai.query', 'dashboard.read'],
      sendReplyFn: async () => 'failed_token' as any,
      aiGatewayFn: () => ({
        requestId: 'req-push-card', replyText: 'ยอดขายวันนี้ 0.00 บาท', sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'sales', refused: false, toolsInvoked: ['sales.get_sales_summary'], durationMs: 1,
        presentation: { kind: 'answer_cards', cards: [{ text: 'ยอดขายวันนี้ 0.00 บาท' }] },
      }),
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-push-card', pushTargetId: 'group-1' });

    assert.equal(pushes[0]?.to, 'group-1');
    assert.equal(pushes[0]?.message.type, 'flex');
  });

  it('routes text-only receipt/tax invoice note to AI Gateway instead of local text capture', async () => {
    const { prisma, updates } = makePrisma();
    const { useCase, replies, aiGatewayRequests, getAiGatewayCalled } = makeUseCase(prisma, {
      permissions: ['line.ai.query', 'expense.receipt.line_upload', 'expense.read_own'],
      aiGatewayFn: () => ({
        requestId: 'req-ai',
        replyText: '📋 ฟีเจอร์นี้ยังไม่ได้เปิดใช้งานหรือยังไม่พร้อมใช้งานในระบบนี้',
        sourceRefs: [],
        sourceLabels: [],
        webLinks: [],
        intent: 'unsupported_module',
        agent: 'general',
        refused: true,
        refusalReason: 'feature_disabled',
        toolsInvoked: [],
        durationMs: 1,
      }),
    });

    await useCase.execute({
      ...BASE_EVENT,
      webhookEventId: 'evt-tax-text-1',
      messageText: 'ใบกำกับภาษี ร้านทดสอบ ยอด 1,234.50 บาท',
    });

    assert.equal(getAiGatewayCalled(), true);
    assert.equal(aiGatewayRequests[0]?.messageText, 'ใบกำกับภาษี ร้านทดสอบ ยอด 1,234.50 บาท');
    assert.match(replies[0] ?? '', /ฟีเจอร์นี้ยังไม่ได้เปิดใช้งาน/);
    assert.equal((updates.at(-1) as any).data.status, 'completed');
  });

	  it('keeps a failed LINE delivery retryable and never records a false completed turn', async () => {
	    const { prisma, updates, aiTurns, aiTurnUpdates } = makePrisma();
    const { useCase } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        requestId: 'req-ai',
        replyText: '• สินค้าใกล้หมด: 2 รายการ',
        sourceRefs: [],
        sourceLabels: [],
        webLinks: [],
        intent: 'read_detail',
        agent: 'inventory',
        refused: false,
        toolsInvoked: ['inventory.list_low_stock'],
        durationMs: 5,
      }),
      sendReplyFn: async () => { throw new Error('LINE 400: Invalid reply token'); },
    });

    // Delivery throws, but execute resolves with persisted retry state.
    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-delivery-fail-1', messageText: 'มีสินค้าใกล้หมดไหม' });

	    assert.equal(aiTurns.length, 1, 'turn persisted despite delivery failure');
      assert.equal((aiTurns[0] as any).data.status, 'PROCESSING');
      assert.equal((aiTurnUpdates.at(-1) as any).data.status, 'ERROR');
	    assert.equal((updates.at(-1) as any).data.status, 'delivery_pending');
	  });

  it('does not mark an employee answer completed when reply token and push both fail', async () => {
    const { prisma, updates, aiTurnUpdates } = makePrisma();
    const { useCase } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        requestId: 'req-ai',
        replyText: 'ยอดขายวันนี้ 10,000 บาท',
        sourceRefs: [],
        sourceLabels: [],
        webLinks: [],
        intent: 'read_summary',
        agent: 'sales',
        refused: false,
        toolsInvoked: ['sales.get_summary'],
        durationMs: 5,
      }),
      sendReplyFn: async () => 'failed_token',
      sendPushFn: async () => 'failed_other',
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-delivery-fail-2', messageText: 'ยอดขายวันนี้เท่าไร' });

    assert.equal((aiTurnUpdates.at(-1) as any).data.status, 'ERROR');
    assert.match((aiTurnUpdates.at(-1) as any).data.errorCode, /LINE_DELIVERY_FAILED_OTHER/);
    assert.equal((updates.at(-1) as any).data.status, 'delivery_pending');
  });

  it('keeps a failed deterministic rich reply in delivery_pending', async () => {
    const { prisma, updates } = makePrisma();
    const { useCase } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      sendReplyFn: async () => 'failed_other',
    });

    await assert.rejects(
      () => useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-menu-fail', messageText: 'เมนูหลัก' }),
      /LINE_DELIVERY_FAILED_OTHER/,
    );

    assert.equal((updates.at(-1) as any).data.status, 'delivery_pending');
  });

	  it('passes at most LINE_AI_CONTEXT_MAX_TURNS recent turns from the active 15-minute window to intake router and AI Gateway', async () => {
	    assert.equal(LINE_AI_CONTEXT_MAX_TURNS, 15, 'the owner-selected history bound is exactly 15 turns');
	    const now = Date.now();
	    const inWindow = LINE_AI_CONTEXT_MAX_TURNS + 1; // one more than the cap
	    const recentTurns = [
	      { createdAt: new Date(now - 16 * 60_000), userMessagePreview: 'old gap', replyPreview: 'old reply', intent: 'READ_SUMMARY', agent: 'general', refused: false },
	      ...Array.from({ length: inWindow }, (_, i) => ({
	        createdAt: new Date(now - (inWindow - i) * 1000),
	        userMessagePreview: `user-${i + 1}`,
	        replyPreview: `reply-${i + 1}`,
	        intent: 'READ_DETAIL',
	        agent: 'inventory',
	        refused: false,
	      })),
	    ];
	    const { prisma } = makePrisma({ recentTurns });
	    const { useCase, aiGatewayRequests, intakeRequests } = makeUseCase(prisma, {
	      permissions: ['line.ai.query'],
	      intakeRouteFn: () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 }),
	      aiGatewayFn: () => ({
	        requestId: 'req-ai',
	        replyText: 'ตอบต่อเนื่อง',
	        sourceRefs: [],
	        sourceLabels: [],
	        webLinks: [],
	        intent: 'read_detail',
	        agent: 'inventory',
	        refused: false,
	        toolsInvoked: [],
	        durationMs: 5,
	      }),
	    });

	    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-context-15', messageText: 'อันนั้นเป็นยังไงต่อ' });

	    const intakeContext = intakeRequests[0]?.conversationContext;
	    const turnContext = aiGatewayRequests[0]?.conversationContext;
	    assert.equal(intakeContext?.windowMinutes, 15);
	    assert.equal(intakeContext?.maxTurns, LINE_AI_CONTEXT_MAX_TURNS);
	    assert.equal(intakeContext?.recentTurns.length, LINE_AI_CONTEXT_MAX_TURNS);
	    assert.equal(intakeContext?.recentTurns[0]?.userMessagePreview, 'user-2');
	    assert.equal(intakeContext?.recentTurns.at(-1)?.userMessagePreview, `user-${LINE_AI_CONTEXT_MAX_TURNS + 1}`);
	    assert.deepEqual(turnContext, intakeContext);
	  });

	  it('does not send conversation context after a 15-minute inactivity gap', async () => {
	    const { prisma } = makePrisma({
	      recentTurns: [{ createdAt: new Date(Date.now() - 16 * 60_000), userMessagePreview: 'old', replyPreview: 'old', intent: 'READ_SUMMARY', agent: 'general', refused: false }],
	    });
	    const { useCase, aiGatewayRequests, intakeRequests } = makeUseCase(prisma, {
	      permissions: ['line.ai.query'],
	      intakeRouteFn: () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 }),
	      aiGatewayFn: () => ({
	        requestId: 'req-ai',
	        replyText: 'เริ่มบริบทใหม่',
	        sourceRefs: [],
	        sourceLabels: [],
	        webLinks: [],
	        intent: 'read_summary',
	        agent: 'general',
	        refused: false,
	        toolsInvoked: [],
	        durationMs: 5,
	      }),
	    });

	    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-context-gap', messageText: 'ต่อจากเมื่อกี้' });

	    assert.equal(intakeRequests[0]?.conversationContext, undefined);
	    assert.equal(aiGatewayRequests[0]?.conversationContext, undefined);
	  });

	  it('omits assistant reply previews when current permissions no longer cover previous tools', async () => {
	    const { prisma } = makePrisma({
	      recentTurns: [{
	        createdAt: new Date(Date.now() - 1000),
	        userMessagePreview: 'ดูสินค้าใกล้หมด',
	        replyPreview: 'สินค้าใกล้หมด 9 รายการ',
	        intent: 'READ_DETAIL',
	        agent: 'inventory',
	        refused: false,
	        toolInvocations: [{ toolName: 'inventory.list_low_stock' }],
	      }],
	    });
	    const { useCase, aiGatewayRequests } = makeUseCase(prisma, {
	      permissions: ['line.ai.query'],
	      intakeRouteFn: () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 }),
	      aiGatewayFn: () => ({
	        requestId: 'req-ai',
	        replyText: 'ไม่มีข้อมูลตามสิทธิ์ปัจจุบัน',
	        sourceRefs: [],
	        sourceLabels: [],
	        webLinks: [],
	        intent: 'read_summary',
	        agent: 'general',
	        refused: false,
	        toolsInvoked: [],
	        durationMs: 5,
	      }),
	    });

	    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-context-permission', messageText: 'อันนั้นล่ะ' });

	    const turn = aiGatewayRequests[0]?.conversationContext?.recentTurns[0];
	    assert.equal(turn?.userMessagePreview, 'ดูสินค้าใกล้หมด');
	    assert.equal(turn?.assistantReplyPreview, undefined);
	  });

	  it('rejects text-only receipt note through normal LINE AI permission when user lacks line.ai.query', async () => {
    const { prisma, updates } = makePrisma();
    const { useCase, replies, getAiGatewayCalled } = makeUseCase(prisma, {
      permissions: ['expense.receipt.line_upload'],
    });

    await useCase.execute({
      ...BASE_EVENT,
      webhookEventId: 'evt-tax-text-denied',
      messageText: 'ใบกำกับภาษี ยอด 500 บาท',
    });

    assert.equal(getAiGatewayCalled(), false);
    assert.match(replies[0] ?? '', /ไม่มีสิทธิ์ใช้งาน LINE AI/);
    assert.equal((updates.at(-1) as any).data.status, 'forbidden');
  });

  it('sends UNLINKED reply when ExternalIdentity not found', async () => {
    const { prisma } = makePrisma({ identityUserId: null });
    const { useCase, replies } = makeUseCase(prisma);

    await useCase.execute(BASE_EVENT);

    assert.match(replies[0] ?? '', /เชื่อมต่อ/);
  });

  it('sends UNLINKED reply when user has no active company memberships', async () => {
    const { prisma } = makePrisma({ memberships: [] });
    const { useCase, replies } = makeUseCase(prisma);

    await useCase.execute(BASE_EVENT);

    assert.match(replies[0] ?? '', /เชื่อมต่อ/);
  });

  it('sends company-selector reply when multi-company user has no LineCompanyContext', async () => {
    const { prisma } = makePrisma({ memberships: [{ companyId: 'co-1', company: { name: 'บริษัทหนึ่ง' } }, { companyId: 'co-2', company: { name: 'บริษัทสอง' } }], lineCompanyContext: null });
    const { useCase, sentMessages } = makeUseCase(prisma);

    await useCase.execute(BASE_EVENT);

    assert.equal(sentMessages[0]?.type, 'flex');
    assert.match(JSON.stringify(sentMessages[0]), /บริษัทหนึ่ง/);
    assert.match(JSON.stringify(sentMessages[0]), /\/company co-2/);
  });

  it('lists owner companies through explicit LINE control command without AI Gateway', async () => {
    const { prisma } = makePrisma({
      memberships: [
        { companyId: 'co-1', company: { name: 'บริษัทหนึ่ง' } },
        { companyId: 'co-2', company: { name: 'บริษัทสอง' } },
      ],
      lineCompanyContext: { companyId: 'co-2' },
    });
    const { useCase, sentMessages, getAiGatewayCalled } = makeUseCase(prisma, { permissions: ['line.ai.query'] });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-companies', messageText: '/companies' });

    assert.equal(getAiGatewayCalled(), false);
    assert.equal(sentMessages[0]?.type, 'flex');
    assert.match(JSON.stringify(sentMessages[0]), /บริษัทหนึ่ง/);
    assert.match(JSON.stringify(sentMessages[0]), /บริษัทสอง/);
    assert.match(JSON.stringify(sentMessages[0]), /ใช้งานอยู่/);
  });

  it('wires the owner role into the บริษัทของฉัน Quick Reply', async () => {
    const { prisma } = makePrisma();
    const { useCase, sentMessages, getAiGatewayCalled } = makeUseCase(prisma, {
      roles: ['OWNER'], permissions: ['line.ai.query'],
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-owner-menu', messageText: 'เมนูหลัก' });

    assert.equal(getAiGatewayCalled(), false);
    const actions = sentMessages[0]?.quickReply?.items.map((item: any) => item.action);
    assert.ok(actions.some((action: any) => action.label === '🏢 บริษัทของฉัน' && action.text === '/companies'));
  });

  it('delivers the main menu as a Flex greeting that names the user', async () => {
    const { prisma } = makePrisma({ displayName: 'พิมพ์ชนก' });
    const { useCase, sentMessages } = makeUseCase(prisma, { permissions: ['line.ai.query'] });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-main-menu-flex', messageText: 'เมนูหลัก' });

    assert.equal(sentMessages[0]?.type, 'flex');
    assert.match(sentMessages[0]?.altText ?? '', /พิมพ์ชนก/);
  });

  it('delivers the receipt prompt as a Flex card', async () => {
    const { prisma } = makePrisma();
    const { useCase, sentMessages } = makeUseCase(prisma, { permissions: ['expense.receipt.line_upload'] });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-receipt-menu-flex', messageText: 'ถ่ายใบเสร็จ' });

    assert.equal(sentMessages[0]?.type, 'flex');
  });

  it('renders real tenant-scoped branch names and degrades to the resolved count', async () => {
    const twoBranchPrisma = makePrisma({ branches: [{ name: 'สาขาสีลม' }, { name: 'สาขาอารีย์' }] });
    const restricted = makeUseCase(twoBranchPrisma.prisma, { permissions: ['line.ai.query'], branchIds: ['branch-1', 'branch-2'] });
    await restricted.useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-menu-two-branches', messageText: 'เมนูหลัก' });
    assert.match(restricted.sentMessages[0]?.altText ?? '', /สาขาสีลม · สาขาอารีย์/);
    assert.deepEqual(twoBranchPrisma.branchFindManyCalls[0], {
      where: { companyId: 'company-1', id: { in: ['branch-1', 'branch-2'] } },
      select: { name: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    const fiveBranchPrisma = makePrisma({ branches: [
      { name: 'สาขาหนึ่ง' }, { name: 'สาขาสอง' }, { name: 'สาขาสาม' }, { name: 'สาขาสี่' }, { name: 'สาขาห้า' },
    ] });
    const fiveBranches = makeUseCase(fiveBranchPrisma.prisma, { permissions: ['line.ai.query'], branchIds: ['b1', 'b2', 'b3', 'b4', 'b5'] });
    await fiveBranches.useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-menu-five-branches', messageText: 'เมนูหลัก' });
    assert.match(fiveBranches.sentMessages[0]?.altText ?? '', /สาขาหนึ่ง · สาขาสอง และอีก 3 สาขา/);

    const unrestrictedPrisma = makePrisma();
    const unrestricted = makeUseCase(unrestrictedPrisma.prisma, { permissions: ['line.ai.query'] });
    await unrestricted.useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-menu-all-branches', messageText: 'เมนูหลัก' });
    assert.match(unrestricted.sentMessages[0]?.altText ?? '', /ทุกสาขา/);
    assert.equal(unrestrictedPrisma.branchFindManyCalls.length, 0);

    const failedLookupPrisma = makePrisma({ branchFindManyFn: async () => { throw new Error('database unavailable'); } });
    const failedLookup = makeUseCase(failedLookupPrisma.prisma, { permissions: ['line.ai.query'], branchIds: ['b1', 'b2'] });
    await failedLookup.useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-menu-branch-lookup-failed', messageText: 'เมนูหลัก' });
    assert.match(failedLookup.sentMessages[0]?.altText ?? '', /ดูข้อมูลได้ 2 สาขา/);
  });

  it('uses a truthful fallback scope without querying branch names for non-main menu commands', async () => {
    const harness = makePrisma({ branches: [{ name: 'สาขาสีลม' }] });
    const { useCase } = makeUseCase(harness.prisma, {
      permissions: ['line.ai.query', 'expense.receipt.line_upload'],
      branchIds: ['branch-1'],
    });

    // Non-main builders do not render branchScopeLabel, so cover their shared context helper directly.
    assert.equal(branchScopeFallbackLabel(['branch-1']), '1 สาขา');
    assert.notEqual(branchScopeFallbackLabel(['branch-1']), 'ทุกสาขา');

    for (const [webhookEventId, messageText] of [
      ['evt-query-menu-no-branch-query', 'ถามข้อมูล'],
      ['evt-approval-menu-no-branch-query', 'รายการรออนุมัติ'],
      ['evt-receipt-menu-no-branch-query', 'ถ่ายใบเสร็จ'],
    ]) {
      await useCase.execute({ ...BASE_EVENT, webhookEventId, messageText });
    }

    assert.equal(harness.branchFindManyCalls.length, 0);
  });

  it('switches owner selected company through explicit LINE control command', async () => {
    const { prisma, upserts, updates } = makePrisma({
      memberships: [
        { companyId: 'co-1', company: { name: 'บริษัทหนึ่ง' } },
        { companyId: 'co-2', company: { name: 'บริษัทสอง' } },
      ],
      lineCompanyContext: { companyId: 'co-1' },
    });
    const { useCase, replies, getAiGatewayCalled } = makeUseCase(prisma, { permissions: ['line.ai.query'] });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-company-switch', messageText: '/company 2' });

    assert.equal(getAiGatewayCalled(), false);
    assert.equal((upserts[0] as any).update.companyId, 'co-2');
    assert.match(replies[0] ?? '', /เปลี่ยนบริษัทเป็น บริษัทสอง/);
    assert.equal((updates.at(-1) as any).data.companyId, 'co-2');
  });

  it('switches company from a bare number only while the immediately previous turn is a pending picker', async () => {
    const { prisma, upserts } = makePrisma({
      memberships: [
        { companyId: 'co-1', company: { name: 'บริษัทหนึ่ง' } },
        { companyId: 'co-2', company: { name: 'บริษัทสอง' } },
      ],
      lineCompanyContext: { companyId: 'co-1' },
      previousEventLog: {
        webhookEventId: 'evt-company-list',
        status: 'company_context_listed',
        createdAt: new Date(),
      },
    });
    const { useCase, replies, getAiGatewayCalled } = makeUseCase(prisma, { permissions: ['line.ai.query'] });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-company-bare-number', messageText: '๒' });

    assert.equal(getAiGatewayCalled(), false);
    assert.equal((upserts[0] as any).update.companyId, 'co-2');
    assert.match(replies[0] ?? '', /เปลี่ยนบริษัทเป็น บริษัทสอง/);
  });

  it('keeps a bare number as ordinary AI conversation when no company picker is pending', async () => {
    const { prisma, upserts } = makePrisma({
      memberships: [
        { companyId: 'co-1', company: { name: 'บริษัทหนึ่ง' } },
        { companyId: 'co-2', company: { name: 'บริษัทสอง' } },
      ],
      lineCompanyContext: { companyId: 'co-1' },
    });
    const { useCase, getAiGatewayCalled } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      intakeRouteFn: () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 }),
      aiGatewayFn: () => ({
        requestId: 'req-bare-number', replyText: 'รับทราบว่าเป็นข้อ 2', sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: [], durationMs: 5,
      }),
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-company-number-without-picker', messageText: '2' });

    assert.equal(getAiGatewayCalled(), true);
    assert.equal(upserts.length, 0);
  });

  it('blocks non-owner multi-company LINE context selection', async () => {
    const { prisma } = makePrisma({
      memberships: [
        { companyId: 'co-1', roles: [{ role: { key: 'STAFF' } }] },
        { companyId: 'co-2', roles: [{ role: { key: 'STAFF' } }] },
      ],
    });
    const { useCase, replies, getAiGatewayCalled } = makeUseCase(prisma, { permissions: ['line.ai.query'] });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-company-non-owner', messageText: '/companies' });

    assert.equal(getAiGatewayCalled(), false);
    assert.match(replies[0] ?? '', /OWNER/);
  });

  it('auto-resolves single-company user without LineCompanyContext', async () => {
    const { prisma } = makePrisma({ memberships: [{ companyId: 'co-1' }] });
    const { useCase, replies } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        replyText: 'ตอบแล้ว', sourceLabels: [], webLinks: [], sourceRefs: [], toolsInvoked: [],
        refused: false, refusalReason: null, intent: 'READ', agent: 'default', durationMs: 100, errorCode: null,
      }),
    });

    // Because persistTurn also calls prisma, we need to extend the mock
    (prisma.client as any).aiConversation = { upsert: async () => ({ id: 'conv-1' }) };
	    (prisma.client as any).aiTurn = {
        findMany: async () => [],
        create: async () => ({ id: 'turn-1' }),
        update: async (args: any) => args,
      };
    (prisma.client as any).aiToolInvocation = { createMany: async () => ({ count: 0 }) };

    await useCase.execute(BASE_EVENT);

    assert.match(replies[0] ?? '', /ตอบแล้ว/);
  });

  it('does not expose raw lineUserId — event log stores hash', async () => {
    const { prisma, createdLogs } = makePrisma({ memberships: [] }); // triggers early return after log
    const { useCase } = makeUseCase(prisma);

    await useCase.execute({ ...BASE_EVENT, lineUserId: 'SENSITIVE_LINE_ID' });

    const log = (createdLogs[0] as any)?.data;
    assert.notEqual(log?.lineUserIdHash, 'SENSITIVE_LINE_ID');
    assert.ok(log?.lineUserIdHash && log.lineUserIdHash.length > 0);
  });

  it('resolves multi-company user who has selected LineCompanyContext', async () => {
    const { prisma } = makePrisma({
      memberships: [{ companyId: 'co-1' }, { companyId: 'co-2' }],
      lineCompanyContext: { companyId: 'co-2' },
    });
    const { useCase, replies } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        replyText: 'company-2 data', sourceLabels: [], webLinks: [], sourceRefs: [], toolsInvoked: [],
        refused: false, refusalReason: null, intent: 'READ', agent: 'default', durationMs: 50, errorCode: null,
      }),
    });

    (prisma.client as any).aiConversation = { upsert: async () => ({ id: 'conv-2' }) };
	    (prisma.client as any).aiTurn = {
        findMany: async () => [],
        create: async () => ({ id: 'turn-2' }),
        update: async (args: any) => args,
      };
    (prisma.client as any).aiToolInvocation = { createMany: async () => ({ count: 0 }) };

    await useCase.execute(BASE_EVENT);

    assert.match(replies[0] ?? '', /company-2 data/);
  });

  it('rejects invalid LINE bytes before malware scan, intake routing, OCR, or upload intent', async () => {
    const { prisma, updates } = makePrisma();
    let scans = 0;
    let uploadIntents = 0;
    const { useCase, replies, intakeRequests, aiGatewayRequests, auditEvents } = makeUseCase(prisma, {
      permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'attachment.create'],
      intakeRouteFn: () => ROUTED_EXPENSE_DOCUMENT,
      malwareScanFn: async () => { scans += 1; },
      initReceiptUpload: { execute: async () => { uploadIntents += 1; } },
      completeReceiptUpload: { execute: async () => undefined },
    });
    (useCase as any).downloadLineMedia = async () => ({
      fileName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      byteSize: 12,
      checksumSha256: 'hash',
      contentBase64: Buffer.from('not-a-jpeg').toString('base64'),
      bytes: Buffer.from('not-a-jpeg'),
    });

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-img-invalid',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-img-invalid',
      lineMessageId: 'line-msg-invalid',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    });

    assert.equal(scans, 0);
    assert.equal(intakeRequests.length, 0);
    assert.equal(aiGatewayRequests.length, 0);
    assert.equal(uploadIntents, 0);
    assert.match(replies[0] ?? '', /ตรวจสอบความปลอดภัย/);
    assert.equal(auditEvents[0]?.action, 'attachment.upload.rejected');
    assert.equal(auditEvents[0]?.metadataJson.reason, 'CONTENT_REJECTED');
    assert.equal((updates.at(-1) as any).data.status, 'media_security_rejected');
  });

  it('fails closed when LINE malware scanning rejects otherwise valid bytes', async () => {
    const { prisma } = makePrisma();
    let uploadIntents = 0;
    const { useCase, intakeRequests, auditEvents } = makeUseCase(prisma, {
      permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'attachment.create'],
      intakeRouteFn: () => ROUTED_EXPENSE_DOCUMENT,
      malwareScanFn: async () => { throw new Error('MALWARE_DETECTED'); },
      initReceiptUpload: { execute: async () => { uploadIntents += 1; } },
      completeReceiptUpload: { execute: async () => undefined },
    });
    (useCase as any).downloadLineMedia = async () => ({
      fileName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      byteSize: JPEG_BYTES.byteLength,
      checksumSha256: 'hash',
      contentBase64: JPEG_BYTES.toString('base64'),
      bytes: JPEG_BYTES,
    });

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-img-malware',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-img-malware',
      lineMessageId: 'line-msg-malware',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    });

    assert.equal(intakeRequests.length, 0);
    assert.equal(uploadIntents, 0);
    assert.equal(auditEvents[0]?.metadataJson.reason, 'MALWARE_DETECTED');
  });

  it('receipt upload errors reply and mark webhook instead of hanging received', async () => {
    const { prisma, updates } = makePrisma();
    const replies: string[] = [];
    const useCase = new ProcessLineWebhookUseCase(
      prisma,
      { webBaseUrl: 'https://app.example.com', lineMessagingChannelAccessToken: 'line-token' } as any,
      {
        resolveAccess: async () => ({
          membershipId: 'mem-1',
          roles: ['OWNER'],
          permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'attachment.create', 'expense.create'],
          scopes: {},
        }),
      } as any,
      { log: async () => undefined } as any,
      {
        requestLineTurn: async () => { throw new Error('not expected'); },
        requestLineIntakeRoute: async () => ROUTED_EXPENSE_DOCUMENT,
        requestReceiptOcr: async () => ({
          status: 'ok', classification: receiptClassification('120.00'), fields: { grandTotalAmount: '120.00' },
        }),
      } as any,
      {
        buildTextMessage: (text: string) => ({ type: 'text', text }),
        sendReply: async (_token: string, messages: Array<{ text: string }>) => {
          replies.push(messages[0]?.text ?? '');
          return 'ok';
        },
      } as any,
      { apply: async () => ({ candidatesCreated: 0 }) } as any,
      CLEAN_SCANNER,
    acceptedLegal,
    shadowProbe,
      { execute: async () => { throw new Error('expense table missing'); } } as any,
      { execute: async () => undefined } as any,
    );
    (useCase as any).downloadLineMedia = async () => ({
      fileName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      byteSize: JPEG_BYTES.byteLength,
      checksumSha256: 'hash',
      contentBase64: JPEG_BYTES.toString('base64'),
      bytes: JPEG_BYTES,
    });

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-img-1',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-img-1',
      lineMessageId: 'line-msg-1',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    });

    assert.match(replies[0] ?? '', /เกิดข้อผิดพลาด/);
    assert.equal((updates.at(-1) as any).data.status, undefined);
    assert.equal((updates.at(-1) as any).data.processedAt, null);
    assert.equal((updates.at(-1) as any).data.errorCode, 'RETRYABLE_RECEIPT_UPLOAD_ERROR');
  });

  it('creates LINE upload expense draft with line_upload permission only', async () => {
    const { prisma, updates } = makePrisma();
    const replies: any[] = [];
    const initInputs: any[] = [];
    const completeInputs: any[] = [];
    const useCase = new ProcessLineWebhookUseCase(
      prisma,
      { webBaseUrl: 'https://app.example.com', lineMessagingChannelAccessToken: 'line-token' } as any,
      {
        resolveAccess: async () => ({
          membershipId: 'mem-1',
          roles: ['STAFF'],
          permissions: ['expense.receipt.line_upload', 'attachment.create'],
          scopes: {},
        }),
      } as any,
      { log: async () => undefined } as any,
      {
        requestLineTurn: async () => { throw new Error('not expected'); },
        requestLineIntakeRoute: async () => ROUTED_EXPENSE_DOCUMENT,
        requestReceiptOcr: async () => ({
          status: 'ok', classification: receiptClassification('120.00'), fields: { grandTotalAmount: '120.00' },
        }),
      } as any,
      {
        buildTextMessage: (text: string) => ({ type: 'text', text }),
        sendReply: async (_token: string, messages: any[]) => {
          replies.push(messages[0]);
          return 'ok';
        },
      } as any,
      { apply: async () => ({ candidatesCreated: 0 }) } as any,
      CLEAN_SCANNER,
    acceptedLegal,
    shadowProbe,
      {
        execute: async (_ctx: any, input: any) => {
          initInputs.push(input);
          return { expenseId: 'expense-line-1', attachmentId: 'att-line-1', uploadUrl: 'https://storage.example.com/upload', uploadMethod: 'PUT' };
        },
      } as any,
      {
        execute: async (_ctx: any, input: any) => {
          completeInputs.push(input);
          return { id: 'expense-line-1' };
        },
      } as any,
    );
    (useCase as any).downloadLineMedia = async () => ({
      fileName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      byteSize: JPEG_BYTES.byteLength,
      checksumSha256: 'hash',
      contentBase64: JPEG_BYTES.toString('base64'),
      bytes: JPEG_BYTES,
    });
    (useCase as any).uploadLineMedia = async () => undefined;

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-img-line-only',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-img-line-only',
      lineMessageId: 'line-msg-line-only',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    });

    assert.equal(initInputs[0].captureSource, 'LINE_UPLOAD');
    assert.equal(completeInputs[0].expenseId, 'expense-line-1');
    assert.equal(replies[0]?.type, 'flex');
    assert.match(JSON.stringify(replies[0]), /ตรวจสอบและยืนยันในเว็บแอป/);
    assert.doesNotMatch(replies[0]?.contents?.body?.contents?.[0]?.text ?? '', /https?:\/\//);
    assert.equal(replies[0]?.contents?.footer?.contents?.[0]?.action?.uri, 'https://app.example.com/companies/company-1/expenses/expense-line-1');
    assert.ok(replies[0]?.quickReply?.items.some((item: any) => item.action.label === '📷 ถ่ายใบเสร็จ'));
    assert.equal((updates.at(-1) as any).data.status, 'completed');
  });

  it('applies OCR fields from AI Gateway to LINE receipt draft', async () => {
    const { prisma } = makePrisma();
    const replies: any[] = [];
    const receiptOcrRequests: any[] = [];
    const recordUpdates: any[] = [];
    const lineCreates: any[] = [];
    (prisma.client as any).$transaction = async (fn: (tx: any) => Promise<void>) => fn({
      expenseRecord: {
        findFirst: async () => ({ expenseCategoryId: null, expenseCategory: null }),
        update: async (args: any) => { recordUpdates.push(args); return args; },
      },
      expenseCategory: {
        findFirst: async () => ({ id: 'cat-meals', name: 'ค่าอาหาร', companyId: 'company-1' }),
      },
      expenseLine: {
        deleteMany: async () => undefined,
        create: async (args: any) => { lineCreates.push(args); return args; },
      },
    });
    const useCase = new ProcessLineWebhookUseCase(
      prisma,
      { webBaseUrl: 'https://app.example.com', lineMessagingChannelAccessToken: 'line-token' } as any,
      {
        resolveAccess: async () => ({
          membershipId: 'mem-1',
          roles: ['STAFF'],
          permissions: ['expense.receipt.line_upload', 'attachment.create'],
          scopes: {},
        }),
      } as any,
      { log: async () => undefined } as any,
      {
        requestLineTurn: async () => { throw new Error('not expected'); },
        requestLineIntakeRoute: async () => ROUTED_EXPENSE_DOCUMENT,
        requestReceiptOcr: async (input: any) => {
          receiptOcrRequests.push(input);
          return {
          status: 'ok',
          classification: receiptClassification('11875'),
          fields: {
            vendorName: 'บริษัท โฟลว์แอคเคาท์ ทดสอบ จำกัด',
            documentNumber: 'CA2025020012',
            expenseDate: '2025-02-27',
            description: 'เมล็ดกาแฟคั่วเข้ม',
            quantity: '50',
            unitPrice: '11875',
            subtotalAmount: '12500',
            discountAmount: '625',
            taxableAmount: '11098.13',
            vatAmount: '776.87',
            grandTotalAmount: '11875',
            vatMode: 'VAT_INCLUDED',
            categorySuggestion: {
              expenseCategoryId: 'cat-meals',
              confidence: 0.9,
              evidenceSignals: ['เมล็ดกาแฟ'],
            },
            confidence: 0.86,
          },
          };
        },
      } as any,
      {
        buildTextMessage: (text: string) => ({ type: 'text', text }),
        sendReply: async (_token: string, messages: any[]) => {
          replies.push(messages[0]);
          return 'ok';
        },
      } as any,
      new ReceiptOcrApplyService(prisma, {
        runDuplicateCheck: async (_input: any, detectWithinTx: (tx: any) => Promise<string[]>) => {
          const matched = await detectWithinTx({ marker: 'tx' });
          return { openCandidates: matched.length, duplicateStatus: matched.length > 0 ? 'POSSIBLE_DUPLICATE' : 'NO_MATCH' };
        },
        findByIdWithRelations: async () => ({
          id: 'expense-ocr-1',
          primaryAttachmentId: null,
          attachments: [],
          vendorDocumentNumber: 'CA2025020012',
          vendorTaxIdSnapshot: null,
          expenseDate: new Date('2025-02-27T00:00:00.000Z'),
          grandTotalAmount: '11875',
          vendorCounterpartyId: null,
        }),
        findNearDuplicates: async () => [],
        findExpenseIdsByAttachmentChecksum: async () => [],
        createDuplicateCandidate: async () => undefined,
        updateExpense: async (input: any) => input,
      } as any),
      CLEAN_SCANNER,
    acceptedLegal,
    shadowProbe,
      { execute: async () => ({ expenseId: 'expense-ocr-1', attachmentId: 'att-ocr-1', uploadUrl: 'https://storage.example.com/upload', uploadMethod: 'PUT' }) } as any,
      { execute: async () => ({ id: 'expense-ocr-1' }) } as any,
      undefined,
      undefined,
      undefined,
      {
        listCategories: async () => [{ id: 'cat-meals', name: 'ค่าอาหาร' }],
        findByLineMessageId: async () => null,
        findNearDuplicates: async () => [],
        findExpenseIdsByAttachmentChecksum: async () => [],
      } as any,
    );
    (useCase as any).downloadLineMedia = async () => ({
      fileName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      byteSize: JPEG_BYTES.byteLength,
      checksumSha256: 'hash',
      contentBase64: JPEG_BYTES.toString('base64'),
      bytes: JPEG_BYTES,
    });
    (useCase as any).uploadLineMedia = async () => undefined;

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-img-ocr',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-img-ocr',
      lineMessageId: 'line-msg-ocr',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    });

    const data = recordUpdates[0].data;
    assert.equal(data.vendorDocumentNumber, 'CA2025020012');
    assert.equal(data.grandTotalAmount, '11875.0000');
    assert.equal(data.expenseCategoryId, 'cat-meals');
    assert.equal(lineCreates[0].data.description, 'เมล็ดกาแฟคั่วเข้ม');
    assert.equal(lineCreates[0].data.unitPrice, '250.0000');
    assert.equal(lineCreates[0].data.expenseCategoryId, 'cat-meals');
    assert.deepEqual(receiptOcrRequests[0].activeCategories, [{ id: 'cat-meals', name: 'ค่าอาหาร' }]);
    assert.equal(replies[0]?.type, 'flex');
    assert.match(JSON.stringify(replies[0]), /11,875.00/);
    assert.match(JSON.stringify(replies[0]), /CA2025020012/);
    assert.match(JSON.stringify(replies[0]), /ค่าอาหาร/);
  });
});

describe('message buffering interplay (dedup relaxation + push fallback)', () => {
  const TURN_RESPONSE = {
    requestId: 'r', replyText: 'turn-answer', sourceRefs: [], sourceLabels: [], webLinks: [],
    intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: [], durationMs: 1,
  };
  const ROUTE_UNAVAILABLE = { status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0, errorCode: 'PROVIDER_DISABLED' };

  it('a received row (created by the buffer at enqueue) does not block the turn', async () => {
    const { prisma } = makePrisma();
    prisma.client.lineWebhookEventLog.findUnique = async () => ({ webhookEventId: 'evt-received', status: 'received', createdAt: new Date() });
    const h = makeUseCase(prisma, { permissions: ['line.ai.query'], aiGatewayFn: () => TURN_RESPONSE, intakeRouteFn: () => ROUTE_UNAVAILABLE });
    await h.useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-received' });
    assert.equal(h.getAiGatewayCalled(), true);
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });

  it('a terminal row still dedups the event', async () => {
    const { prisma } = makePrisma();
    prisma.client.lineWebhookEventLog.findUnique = async () => ({ webhookEventId: 'evt-done', status: 'completed', createdAt: new Date() });
    const h = makeUseCase(prisma, { permissions: ['line.ai.query'], aiGatewayFn: () => TURN_RESPONSE, intakeRouteFn: () => ROUTE_UNAVAILABLE });
    await h.useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-done' });
    assert.equal(h.getAiGatewayCalled(), false);
    assert.equal(h.replies.length, 0);
  });

  it('expired reply token falls back to push into the source chat', async () => {
    const { prisma } = makePrisma();
    const h = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => TURN_RESPONSE,
      intakeRouteFn: () => ROUTE_UNAVAILABLE,
      sendReplyFn: (async () => 'failed_token') as any,
    });
    await h.useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-push-1', pushTargetId: 'group-42' });
    assert.equal(h.pushes.length, 1);
    assert.equal(h.pushes[0].to, 'group-42');
    assert.match(h.pushes[0].text, /turn-answer/);
  });

  it('push fallback targets the 1:1 user when no chat target is set', async () => {
    const { prisma } = makePrisma();
    const h = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => TURN_RESPONSE,
      intakeRouteFn: () => ROUTE_UNAVAILABLE,
      sendReplyFn: (async () => 'failed_token') as any,
    });
    await h.useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-push-2' });
    assert.equal(h.pushes.length, 1);
    assert.equal(h.pushes[0].to, BASE_EVENT.lineUserId);
  });
});

// ── Item 10F: value candidates computed once per turn, riding both payloads ──

describe('ProcessLineWebhookUseCase – value candidate wiring (item 10F)', () => {
  const TURN_RESPONSE = {
    requestId: 'req-ai', replyText: 'ok', sourceRefs: [], sourceLabels: [], webLinks: [],
    intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: [], durationMs: 1,
  };

  it('attaches the same deterministic candidates to the intake route and the turn request', async () => {
    const { prisma } = makePrisma();
    const { useCase, aiGatewayRequests, intakeRequests } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      intakeRouteFn: () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 }),
      aiGatewayFn: () => TURN_RESPONSE,
    });

    await useCase.execute({
      ...BASE_EVENT,
      webhookEventId: 'evt-vc-1',
      messageText: 'บันทึกบิล 9/12/2537 หกสิบบาท แล้วยอดขายวันนี้เท่าไหร่',
    });

    const candidates = intakeRequests[0]?.valueCandidates;
    assert.ok(candidates, 'intake route carries candidates');
    assert.ok(candidates.amounts.some((a: any) => a.value === '60' && a.span === 'หกสิบ'));
    assert.ok(candidates.dates.some((d: any) => d.isoDate === '1994-12-09' && d.yearBe === 2537));
    assert.deepEqual(aiGatewayRequests[0]?.valueCandidates, candidates, 'turn request carries the SAME candidates (computed once)');
  });

  it('omits valueCandidates for value-free messages so payloads stay unchanged', async () => {
    const { prisma } = makePrisma();
    const { useCase, aiGatewayRequests, intakeRequests } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      intakeRouteFn: () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 }),
      aiGatewayFn: () => TURN_RESPONSE,
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-vc-2', messageText: 'ดูแดชบอร์ดหน่อย' });

    assert.equal(intakeRequests[0]?.valueCandidates, undefined);
    assert.equal(aiGatewayRequests[0]?.valueCandidates, undefined);
  });
});

// ── Item 10F: turn ledger wiring (append → gateway → ack; coverage → sub_requests) ──

import { LineAiLedgerService } from '../line-ai-ledger.service';

function makeLedgerUseCase(prisma: any, opts: {
  permissions?: string[];
  aiGatewayFn?: (req?: any) => any;
  intakeRouteFn?: (req?: any) => any;
  openWaiting?: any[];
  deliveryResult?: 'ok' | 'failed_token' | 'failed_other' | 'skipped';
} = {}) {
  const events: string[] = [];
  const ledgerCalls = { turns: [] as any[], subs: [] as any[], acks: [] as Array<{ id: string; outcome: string }> };
  const realLedger = new LineAiLedgerService(
    { lineAiLedgerEnabled: false } as any,
    { log: async () => undefined } as any,
    { client: { outboxEvent: { findMany: async () => [], create: async () => undefined } } } as any,
  );
  const ledger = {
    enabled: true,
    openWaitingUser: async () => opts.openWaiting ?? [],
    appendTurn: async (input: any) => { events.push('appendTurn'); ledgerCalls.turns.push(input); return '10-0'; },
    appendSubRequests: async (input: any) => { events.push('appendSubRequests'); ledgerCalls.subs.push(input); },
    coverageToSubRequests: realLedger.coverageToSubRequests.bind(realLedger),
    ack: async (entry: any, outcome: string) => { events.push(`ack:${outcome}`); ledgerCalls.acks.push({ id: entry.id, outcome }); },
  } as any;
  const aiGatewayRequests: any[] = [];
  const intakeRequests: any[] = [];
  const useCase = new ProcessLineWebhookUseCase(
    prisma,
    { webBaseUrl: 'https://app.example.com' } as any,
    { resolveAccess: async () => ({ membershipId: 'mem-1', roles: ['STAFF'], permissions: opts.permissions ?? ['line.ai.query'], scopes: {} }) } as any,
    { log: async () => undefined } as any,
    {
      requestLineTurn: async (req: any) => {
        events.push('gateway');
        aiGatewayRequests.push(req);
        if (opts.aiGatewayFn) return opts.aiGatewayFn(req);
        throw new Error('AI Gateway not expected');
      },
      requestLineIntakeRoute: async (req: any) => {
        intakeRequests.push(req);
        if (opts.intakeRouteFn) return opts.intakeRouteFn(req);
        return { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 };
      },
    } as any,
    {
      buildTextMessage: (text: string) => ({ type: 'text', text }),
      sendReply: async () => { events.push('delivery'); return opts.deliveryResult ?? 'ok'; },
      sendPush: async () => 'ok',
    } as any,
    { apply: async () => ({ candidatesCreated: 0 }) } as any,
    CLEAN_SCANNER,
    acceptedLegal,
    shadowProbe,
    undefined, undefined, undefined, undefined, undefined, undefined,
    ledger,
  );
  return { useCase, events, ledgerCalls, aiGatewayRequests, intakeRequests };
}

const LEDGER_TURN_RESPONSE = {
  requestId: 'req-ai', replyText: 'ตอบแล้ว', sourceRefs: [], sourceLabels: [], webLinks: [],
  intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: [], durationMs: 1,
};

describe('ProcessLineWebhookUseCase – ledger wiring (item 10F)', () => {
  it('appends before the gateway and acknowledges only after confirmed delivery', async () => {
    const { prisma } = makePrisma();
    const { useCase, events, ledgerCalls } = makeLedgerUseCase(prisma, {
      aiGatewayFn: () => ({
        ...LEDGER_TURN_RESPONSE,
        coverage: [
          { request: 'ยอดขายวันนี้', verdict: 'covered' },
          { request: 'วันที่บิล', subject: 'expense', verdict: 'needs_user', question: 'ปีไหน?' },
          { request: 'ยอดค้างซัพพลายเออร์', verdict: 'uncovered', reason: 'budget' },
        ],
      }),
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-ledger-1', messageText: 'สามคำถามรวด' });

    assert.ok(events.indexOf('appendTurn') < events.indexOf('gateway'), 'turn entry is durable before the gateway call');
    assert.ok(events.indexOf('gateway') < events.indexOf('delivery'), 'delivery follows business computation');
    assert.ok(events.indexOf('delivery') < events.indexOf('ack:acked'), 'ledger closes only after LINE accepts the response');
    assert.equal(ledgerCalls.turns[0]?.text, 'สามคำถามรวด');
    assert.deepEqual(ledgerCalls.subs[0]?.items, [
      { text: 'วันที่บิล', subject: 'expense', state: 'waiting_user', clarifyQuestion: 'ปีไหน?' },
      { text: 'ยอดค้างซัพพลายเออร์', state: 'pending' },
    ]);
    assert.ok(ledgerCalls.acks.some((a) => a.id === '10-0' && a.outcome === 'acked'), 'turn entry acked on confirmed outcome');
  });

  it('keeps the computed employee turn open when LINE delivery is not confirmed', async () => {
    const { prisma } = makePrisma();
    const { useCase, ledgerCalls } = makeLedgerUseCase(prisma, {
      aiGatewayFn: () => LEDGER_TURN_RESPONSE,
      deliveryResult: 'failed_other',
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-ledger-delivery-fail' });

    assert.equal(ledgerCalls.turns.length, 1);
    assert.equal(ledgerCalls.acks.length, 0, 'the worker may reclaim and retry this turn');
  });

  it('leaves the turn entry unacked when the gateway throws (reclaim re-runs it)', async () => {
    const { prisma } = makePrisma();
    const { useCase, ledgerCalls } = makeLedgerUseCase(prisma, {
      aiGatewayFn: () => { throw new Error('gateway down'); },
    });
    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-ledger-2' });
    assert.equal(ledgerCalls.turns.length, 1);
    assert.equal(ledgerCalls.acks.length, 0, 'no ack without a confirmed outcome');
  });

  it('attaches open clarifications to the turn request and consumes only the ones this turn answered', async () => {
    const { prisma } = makePrisma();
    const entryOf = (id: string, userId = 'user-1') => ({ id, key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 't0', kind: 'sub_request', userId });
    const { useCase, ledgerCalls, aiGatewayRequests, intakeRequests } = makeLedgerUseCase(prisma, {
      aiGatewayFn: () => LEDGER_TURN_RESPONSE,
      // The router names what the message answered; the other entry is still waiting.
      intakeRouteFn: () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9, resolvedClarificationIds: ['7-0'] }),
      openWaiting: [
        {
          id: '7-0', question: 'ปีไหน?', text: 'บันทึกบิล 9/11/37', subject: 'expense',
          askedAt: '2026-07-07T09:59:00.000Z', entry: entryOf('7-0'),
          pendingMedia: { pendingMediaId: 'pm-7', attachmentId: 'att-7', mimeType: 'image/jpeg' },
        },
        { id: '8-0', question: 'สาขาไหน?', text: 'ยอดขายสาขา', askedAt: '2026-07-07T09:59:30.000Z', entry: entryOf('8-0') },
      ],
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-ledger-3', messageText: '2537' });

    assert.equal(aiGatewayRequests[0]?.openClarifications?.length, 2);
    assert.equal(aiGatewayRequests[0]?.openClarifications?.[0]?.question, 'ปีไหน?');
    assert.equal(aiGatewayRequests[0]?.openClarifications?.[0]?.subject, 'expense');
    assert.deepEqual(aiGatewayRequests[0]?.openClarifications?.[0]?.pendingMedia, {
      pendingMediaId: 'pm-7', attachmentId: 'att-7', mimeType: 'image/jpeg',
    });
    assert.deepEqual(intakeRequests[0]?.openClarifications?.[0]?.pendingMedia,
      aiGatewayRequests[0]?.openClarifications?.[0]?.pendingMedia,
      'the same opaque stored-media handle reaches intake and turn requests');
    assert.ok(ledgerCalls.acks.some((a) => a.id === '7-0' && a.outcome === 'acked'), 'the answered entry is done waiting');
    assert.equal(ledgerCalls.acks.some((a) => a.id === '8-0'), false, 'an unanswered question must stay open');
  });

  it('intake CLARIFY appends a waiting_user entry carrying the question', async () => {
    const { prisma } = makePrisma();
    const { useCase, ledgerCalls, events } = makeLedgerUseCase(prisma, {
      permissions: ['line.ai.query', 'expense.receipt.line_upload'],
      intakeRouteFn: () => ({ status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0.9, clarifyQuestion: 'วันที่ "9/11/37" หมายถึง 9 พ.ย. 2537 หรือ 9 พ.ย. 2580?' }),
    });
    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-ledger-4', messageText: 'บันทึกบิล 9/11/37 หกสิบบาท' });
    assert.ok(!events.includes('gateway'), 'clarify ends the turn before the gateway');
    const item = ledgerCalls.subs[0]?.items?.[0];
    assert.equal(item?.state, 'waiting_user');
    assert.ok(item?.clarifyQuestion?.includes('2537'));
    assert.equal(item?.text, 'บันทึกบิล 9/11/37 หกสิบบาท');
  });
});

// ── M-02: real per-tool AiToolInvocation rows + requestId reconstruction drill ──

const TOOL_TURN_RESPONSE = {
  requestId: 'req-gw',
  replyText: 'สรุปแล้ว',
  sourceRefs: [
    { module: 'accounting-documents', entityType: 'Receipt', entityId: 'rc-1', label: 'ใบเสร็จ' },
    { module: 'inventory', entityType: 'Product', entityId: 'p-1', label: 'สินค้า' },
  ],
  sourceLabels: [], webLinks: [], intent: 'read_summary', agent: 'general', refused: false,
  toolsInvoked: ['sales.get_sales_summary', 'inventory.list_low_stock'],
  durationMs: 900,
};

describe('ProcessLineWebhookUseCase – per-tool invocation records (M-02)', () => {
  it('persists the real per-tool status, duration and errorCode reported by the gateway', async () => {
    const { prisma, toolInvocations } = makePrisma();
    const { useCase } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        ...TOOL_TURN_RESPONSE,
        toolCalls: [
          { name: 'sales.get_sales_summary', status: 'ok', durationMs: 120 },
          { name: 'inventory.list_low_stock', status: 'forbidden', durationMs: 7, errorCode: 'ERP_PERMISSION_DENIED' },
        ],
      }),
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-tool-calls' });

    assert.deepEqual(
      toolInvocations.map((row) => [row.toolName, row.status, row.durationMs, row.errorCode]),
      [
        ['sales.get_sales_summary', 'ok', 120, null],
        ['inventory.list_low_stock', 'forbidden', 7, 'ERP_PERMISSION_DENIED'],
      ],
    );
    // Category and source filtering still come from the registry, never from the wire.
    assert.deepEqual(toolInvocations.map((row) => row.toolCategory), ['report', 'read_summary']);
    assert.deepEqual(toolInvocations[0].sourceRefsJson.map((source: any) => source.module), ['accounting-documents']);
    assert.deepEqual(toolInvocations[1].sourceRefsJson.map((source: any) => source.module), ['inventory']);
    assert.ok(toolInvocations.every((row) => row.inputHash && row.inputHash.length > 0));
  });

  it('falls back to the turn-level derivation when the gateway reports no toolCalls', async () => {
    for (const toolCalls of [undefined, []]) {
      const { prisma, toolInvocations } = makePrisma();
      const { useCase } = makeUseCase(prisma, {
        permissions: ['line.ai.query'],
        aiGatewayFn: () => ({ ...TOOL_TURN_RESPONSE, errorCode: 'AI_TOOL_TIMEOUT', ...(toolCalls ? { toolCalls } : {}) }),
      });

      await useCase.execute({ ...BASE_EVENT, webhookEventId: `evt-tool-fallback-${toolCalls ? 'empty' : 'absent'}` });

      assert.deepEqual(toolInvocations.map((row) => row.toolName), ['sales.get_sales_summary', 'inventory.list_low_stock']);
      assert.deepEqual(toolInvocations.map((row) => row.status), ['error', 'error']);
      assert.deepEqual(toolInvocations.map((row) => row.durationMs), [900, 900]);
      assert.deepEqual(toolInvocations.map((row) => row.errorCode), ['AI_TOOL_TIMEOUT', 'AI_TOOL_TIMEOUT']);
    }
  });

  it('reconstruction drill: one requestId pivots from the audit row to the turn and its per-tool rows', async () => {
    const { prisma, aiTurns, toolInvocations } = makePrisma();
    const { useCase, auditEvents, aiGatewayRequests } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        ...TOOL_TURN_RESPONSE,
        refused: true,
        refusalReason: 'mutation_blocked',
        runtimeIdentity: { sourceCommit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64), serviceVersion: 'candidate-a', contractVersion: 1 },
        expectedRuntimeIdentity: { sourceCommit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64), contractVersion: 1 },
        runtimeBinding: { runtimeArnHash: 'c'.repeat(16), qualifier: 'candidate-1' },
        stageDurationsMs: { orchestrationMs: 700, runtimeTotalMs: 710, agentcoreHttpMs: 850 },
        modelCallCount: 2,
        toolCalls: [
          { name: 'sales.get_sales_summary', status: 'ok', durationMs: 11 },
          { name: 'inventory.list_low_stock', status: 'error', durationMs: 233, errorCode: 'TOOL_EXECUTION_ERROR' },
        ],
      }),
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-drill' });

    const requestId = aiGatewayRequests[0]?.requestId;
    assert.ok(requestId, 'the turn request carries the correlation id');
    const auditRow = auditEvents.find((entry) => entry.action === 'ai.line.mutation_blocked');
    assert.equal(auditRow?.requestId, requestId);
    assert.equal(auditRow?.targetId, 'evt-drill');
    // AiTurn/AiToolInvocation have no requestId column, so the durable pivot chain an
    // investigator walks is requestId → webhookEventId → turnId.
    assert.equal((aiTurns[0] as any).data.webhookEventId, 'evt-drill');
    assert.deepEqual(toolInvocations.map((row) => row.turnId), ['turn-1', 'turn-1']);
    // Each row carries its own measured duration, not the whole-turn duration.
    assert.deepEqual(toolInvocations.map((row) => row.durationMs), [11, 233]);
    assert.equal((aiTurns[0] as any).data.durationMs, 900);
    assert.deepEqual((aiTurns[0] as any).data.observabilityJson, {
      runtimeIdentity: { sourceCommit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64), serviceVersion: 'candidate-a', contractVersion: 1 },
      expectedRuntimeIdentity: { sourceCommit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64), contractVersion: 1 },
      runtimeBinding: { runtimeArnHash: 'c'.repeat(16), qualifier: 'candidate-1' },
      stageDurationsMs: { orchestrationMs: 700, runtimeTotalMs: 710, agentcoreHttpMs: 850 },
      modelCallCount: 2,
    });
    assert.deepEqual(toolInvocations.map((row) => row.status), ['ok', 'error']);
    assert.deepEqual(toolInvocations.map((row) => row.errorCode), [null, 'TOOL_EXECUTION_ERROR']);
  });
});

/**
 * Shadow coverage for the employee LINE OA webhook (piece 5).
 *
 * The critical property is WHERE the observation is taken. `lineAssistantDisabled` already refuses
 * a disabled tenant, so a probe placed inside the surviving branch could only ever record
 * `available` and R1's "0 would_block" would be satisfied by a measurement that could not have
 * failed. These tests pin the probe UPSTREAM of that refusal, on both entry paths.
 */
describe('LINE webhook shadow coverage (piece 5)', () => {
  const takeNewRecords = () => {
    const from = shadowRecords.length;
    return () => shadowRecords.slice(from);
  };

  it('records the turn for an ENTITLED company and lets the turn proceed', async () => {
    const { prisma } = makePrisma({ entitlements: [{ featureKey: 'ai_line_assistant', enabled: true }] });
    const { useCase, getAiGatewayCalled } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        requestId: 'req-1', replyText: 'ok', sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'accounting', refused: false, toolsInvoked: [], durationMs: 1,
      }),
    });
    const since = takeNewRecords();

    await useCase.execute(BASE_EVENT);

    assert.deepEqual(since(), [
      { surface: 'line.webhook.employee', companyId: 'company-1', featureKey: 'ai_line_assistant' },
    ]);
    assert.equal(getAiGatewayCalled(), true);
  });

  it('records the turn for a DISABLED company too — the measurement precedes the refusal', async () => {
    const { prisma, updates } = makePrisma({ entitlements: [{ featureKey: 'ai_line_assistant', enabled: false }] });
    const { useCase } = makeUseCase(prisma, { permissions: ['line.ai.query'] });
    const since = takeNewRecords();

    await useCase.execute(BASE_EVENT);

    // Mutation guard for the Group-E trap: move `recordShadowTurn` below the
    // `lineAssistantDisabled` branch and this is [] — the family's would_block counter would then
    // be structurally incapable of ever being non-zero.
    assert.deepEqual(since(), [
      { surface: 'line.webhook.employee', companyId: 'company-1', featureKey: 'ai_line_assistant' },
    ]);
    // SHADOW ONLY: the existing refusal is untouched.
    assert.equal((updates[0] as any).data.status, 'feature_disabled');
  });

  it('records the receipt-capture entry path as well as the AI-query one', async () => {
    const { prisma } = makePrisma({ entitlements: [{ featureKey: 'ai_line_assistant', enabled: false }] });
    const { useCase } = makeUseCase(prisma, { permissions: ['expense.receipt.line_upload'] });
    const since = takeNewRecords();

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-shadow-img',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-shadow-img',
      lineMessageId: 'line-msg-shadow',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    });

    // The webhook has TWO company-resolving entry paths; instrumenting only the one a ticket names
    // would leave the sibling permanently unmeasured.
    assert.deepEqual(since(), [
      { surface: 'line.webhook.employee', companyId: 'company-1', featureKey: 'ai_line_assistant' },
    ]);
  });

  it('records nothing when no company could be resolved', async () => {
    const { prisma } = makePrisma({ memberships: [] });
    const { useCase } = makeUseCase(prisma, { permissions: ['line.ai.query'] });
    const since = takeNewRecords();

    await useCase.execute(BASE_EVENT);

    // No company means no entitlement question to ask; a fabricated observation would be worse
    // than none.
    assert.deepEqual(since(), []);
  });
});
