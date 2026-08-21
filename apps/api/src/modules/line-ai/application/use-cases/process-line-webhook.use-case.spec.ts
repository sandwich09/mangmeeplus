import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_AI_CONTEXT_MAX_TURNS, parseLineAiPreparedPlan } from '@watchdog-bms/contracts';
import { branchScopeFallbackLabel, chatKeyHashOf, classifyPendingMediaReply, formatGroundedReceiptFollowUp, isAffirmativeText, isGroundedReceiptFollowUp, ProcessLineWebhookUseCase, readResponseBodyLimited, toAiTurnIntent } from './process-line-webhook.use-case';
import { ReceiptOcrApplyService } from '../../../expenses/application/services/receipt-ocr-apply.service';
import { absoluteWebLink, webBaseUrlFromEnv, webLink } from '../../../../common/http/web-link';
import { LineSubstituteReceiptContinuationUseCase } from '../../../expenses/application/use-cases/line-substitute-receipt-continuation.use-case';

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
	    entitlementDeniedPermissions?: Record<string, string>;
	    entitledFeatureKeys?: string[] | null;
	    roles?: string[];
	    branchIds?: string[];
	    aiGatewayFn?: (req?: any) => any;
	    intakeRouteFn?: (req?: any) => any;
	    sendReplyFn?: (token: string, messages: any[]) => Promise<any>;
      sendPushFn?: (to: string, messages: any[]) => Promise<any>;
      malwareScanFn?: (bytes: Buffer) => Promise<void>;
      initReceiptUpload?: any;
      completeReceiptUpload?: any;
      initSignatureUpload?: any;
      createSignatureAsset?: any;
      receiptOcrFn?: (req?: any) => any;
      substituteReceiptContinuation?: any;
      createUploadIntent?: any;
      completeAttachmentUpload?: any;
      legalAcceptanceRequired?: boolean;
      approvalQueues?: { reimbursement?: any; purchaseRequests?: any; purchaseOrders?: any };
      config?: Record<string, unknown>;
      substituteContinuation?: any;
      substituteLedger?: any;
      expenseDraftConversation?: any;
      openWaiting?: any[];
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
    { webBaseUrl: 'https://app.example.com', ...(opts.config ?? {}) } as any,
    { resolveAccess: async () => ({
      membershipId: 'mem-1', roles, permissions,
      entitlementDeniedPermissions: opts.entitlementDeniedPermissions,
      entitledFeatureKeys: opts.entitledFeatureKeys,
      scopes: branchIds === undefined ? {} : { branchIds },
    }) } as any,
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
	      requestReceiptOcr: async (req: any) => {
	        if (opts.receiptOcrFn) return opts.receiptOcrFn(req);
	        throw new Error('receipt OCR not expected');
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
    // Positional @Optional deps, in constructor order: captureExpenseNote, initSignatureUpload,
    // createSignatureAsset, expenseRepo, ledger, createUploadIntent, completeAttachmentUpload,
    // correctExpense, substituteReceiptContinuation, expenseDraftConversation. Develop's signature/upload
    // tests and our substitute/ledger/draft tests each set their own opts; position 11 accepts either
    // substitute-continuation opt name.
    undefined,
    opts.initSignatureUpload,
    opts.createSignatureAsset,
    undefined,
    opts.substituteLedger,
    opts.createUploadIntent,
    opts.completeAttachmentUpload,
    undefined,
    opts.substituteReceiptContinuation ?? opts.substituteContinuation,
    opts.expenseDraftConversation,
    opts.approvalQueues?.reimbursement,
    opts.approvalQueues?.purchaseRequests,
    opts.approvalQueues?.purchaseOrders,
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
  it('settles waiting feedback before sending the final LINE reply', async () => {
    const { prisma } = makePrisma({ identityUserId: null });
    const { useCase, replies } = makeUseCase(prisma);
    let settled = false;

    await useCase.execute({
      ...BASE_EVENT,
      webhookEventId: 'evt-wait-settle',
      beforeReply: async () => { settled = true; },
    });

    assert.equal(settled, true);
    assert.match(replies[0] ?? '', /เชื่อมต่อบัญชี/);
  });

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
    const { useCase, getAiGatewayCalled, aiGatewayRequests } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      entitlementDeniedPermissions: { 'inventory.report.read': 'inventory' },
      entitledFeatureKeys: ['ai_line_assistant', 'product_catalog'],
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
    assert.deepEqual(aiGatewayRequests[0]?.userContext.entitlementDeniedPermissions, { 'inventory.report.read': 'inventory' });
    assert.deepEqual(aiGatewayRequests[0]?.userContext.entitledFeatureKeys, ['ai_line_assistant', 'product_catalog']);
    assert.equal((updates.at(-1) as any).data.status, 'completed');
  });

  it('sends the company entitlement set with the turn so the assistant can describe itself honestly', async () => {
    const { prisma } = makePrisma({
      entitlements: [
        { featureKey: 'ai_line_assistant', enabled: true },
        { featureKey: 'expenses', enabled: true },
        { featureKey: 'sales_documents', enabled: false },
      ],
    });
    const { useCase, aiGatewayRequests } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        requestId: 'req-ai', replyText: 'ok', sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: [], durationMs: 1,
      }),
    });

    await useCase.execute(BASE_EVENT);

    const sent: string[] = aiGatewayRequests[0]?.entitledFeatureKeys ?? [];
    assert.ok(sent.includes('expenses'));
    assert.ok(!sent.includes('sales_documents'), 'a switched-off feature must not travel as entitled');
  });

  it('omits the entitlement set for a legacy company with no rows (fail-open)', async () => {
    const { prisma } = makePrisma();
    const { useCase, aiGatewayRequests } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      aiGatewayFn: () => ({
        requestId: 'req-ai', replyText: 'ok', sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: [], durationMs: 1,
      }),
    });

    await useCase.execute(BASE_EVENT);

    assert.equal(aiGatewayRequests[0]?.entitledFeatureKeys, undefined);
  });

  it('reports an expenses feature switch instead of blaming the member permission', async () => {
    const { prisma, updates } = makePrisma({ entitlements: [
      { featureKey: 'ai_line_assistant', enabled: true },
      { featureKey: 'expenses', enabled: false },
    ] });
    const { useCase, replies, getAiGatewayCalled } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      entitlementDeniedPermissions: {
        'expense.receipt.line_upload': 'expenses.upload',
        'expense.receipt.upload': 'expenses.upload',
        'expense.create': 'expenses',
      },
      entitledFeatureKeys: ['ai_line_assistant'],
      intakeRouteFn: () => ROUTED_EXPENSE_DOCUMENT,
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-expense-off', messageText: 'ค่ากาแฟ 65 บาท' });

    assert.equal(getAiGatewayCalled(), false);
    assert.match(replies[0] ?? '', /ระบบค่าใช้จ่ายและเอกสาร/);
    assert.equal((replies[0] ?? '').includes('ไม่มีสิทธิ์'), false);
    assert.equal((updates.at(-1) as any).data.status, 'feature_disabled');
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
    assert.equal((updates.at(-1) as any).data.status, 'feature_disabled');
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
    const logs: any[] = [];
    (useCase as any).logger = {
      log: (entry: unknown) => logs.push(entry),
      warn: () => undefined,
      error: () => undefined,
    };

    // Delivery throws, but execute resolves with persisted retry state.
    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-delivery-fail-1', messageText: 'มีสินค้าใกล้หมดไหม' });

    assert.equal(aiTurns.length, 1, 'turn persisted despite delivery failure');
    assert.equal((aiTurns[0] as any).data.status, 'PROCESSING');
    assert.equal((aiTurnUpdates.at(-1) as any).data.status, 'ERROR');
    assert.equal((updates.at(-1) as any).data.status, 'delivery_pending');
    assert.deepEqual(
      logs.filter((entry) => entry.msg === 'line.ai.terminal').map((entry) => entry.terminalClass),
      ['delivery_pending'],
      'a failed delivery must never emit the delivered terminal metric',
    );
  });

  it('emits Phase-0 distinct stage durations and a correlated turn summary for a business-read turn', async () => {
    const { prisma } = makePrisma();
    const { useCase } = makeUseCase(prisma, {
      permissions: ['line.ai.query'],
      intakeRouteFn: () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 }),
      aiGatewayFn: () => ({
        requestId: 'req-ai',
        replyText: 'ยอดขายวันนี้ 1,000 บาท',
        sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'sales', refused: false,
        toolsInvoked: ['sales.get_sales_summary'],
        toolCalls: [{ name: 'sales.get_sales_summary', status: 'ok', durationMs: 12 }],
        modelCallCount: 3,
        modelLineage: [{ provider: 'bedrock', modelId: 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0', region: 'ap-southeast-1', purpose: 'employee_line_assistant' }],
        usage: [{ tag: 't', modelId: 'apac.anthropic.claude-3-haiku-20240307-v1:0', ok: true, inputTokens: 100, outputTokens: 40, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 5 }],
        durationMs: 20,
      }),
    });
    const logs: any[] = [];
    (useCase as any).logger = { log: (entry: any) => logs.push(entry), warn: () => undefined, error: () => undefined };

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-trace-1', messageText: 'ยอดขายวันนี้เท่าไหร่' });

    // Distinct stage durations for the seams THIS API process observes — not lumped into dispatch.
    const stages = logs.filter((entry) => entry.msg === 'line.ai.stage');
    for (const stage of ['intake_route', 'gateway_turn', 'render', 'persistence', 'line_delivery']) {
      const event = stages.find((entry) => entry.stage === stage);
      assert.ok(event, `stage ${stage} emitted`);
      assert.equal(event.webhookEventId, 'evt-trace-1');
      assert.ok(Number.isInteger(event.durationMs) && event.durationMs >= 0, `${stage} has a numeric duration`);
    }
    // A business-read turn runs no capture and this release creates no reimbursement, so neither
    // may report a duration for work that never happened.
    assert.equal(stages.some((entry) => entry.stage === 'capture_execute' || entry.stage === 'reimbursement_execute'), false);

    // One correlated turn summary; every field is the ACTUAL value or an explicit null (nothing invented).
    const summary = logs.find((entry) => entry.msg === 'line.ai.turn_summary');
    assert.ok(summary, 'turn summary emitted');
    assert.equal(summary.webhookEventId, 'evt-trace-1');
    assert.ok(typeof summary.requestId === 'string' && summary.requestId.length > 0);
    assert.equal(summary.preparedPlanVersion, null, 'Phase 2: no producer, so null (not invented)');
    assert.equal(summary.lane, null, 'lane is null because the gateway RESPONSE does not expose which internal lane served the turn (the prepared lane is live but default-off/evidence-gated) — not because lanes are unimplemented');
    assert.equal(summary.intent, 'read_summary');
    assert.equal(summary.refused, false);
    assert.equal(summary.modelCallCount, 3);
    assert.equal(summary.toolCallCount, 1);
    assert.equal(summary.deliveryResult, 'ok');
    assert.equal(summary.usageInputTokens, 100);
    assert.equal(summary.usageOutputTokens, 40);
    assert.equal(summary.costSatang, null, 'cost is metered elsewhere → null here, not invented');
    // Actual model identity derived from lineage + usage (deduped), not invented.
    assert.equal(summary.modelProvider, 'bedrock');
    assert.deepEqual([...summary.modelIds].sort(), ['apac.anthropic.claude-3-5-sonnet-20241022-v2:0', 'apac.anthropic.claude-3-haiku-20240307-v1:0']);
    // fallback is a distinct field, always null here (not observable), never conflated with refusal/error.
    assert.equal(summary.fallbackReason, null);

    // No raw message text or LINE user id in any trace event.
    for (const event of [...stages, summary]) {
      const keys = Object.keys(event);
      assert.ok(!keys.includes('lineUserId') && !keys.includes('messageText') && !keys.includes('text'), 'no raw identifiers/text');
    }
  });

  it('forwards the intake prepared plan into the turn only when a downstream lane flag is on (Phase 3/4 independent, default off)', async () => {
    const prepared = parseLineAiPreparedPlan({
      version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape: 'single_metric',
      intentPlan: {
        status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
        intents: [{ intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] }],
      },
      proposedCalls: [{ toolName: 'sales.get_sales_summary', input: {} }],
    });
    assert.ok(prepared, 'prepared-plan fixture parses');
    const route = () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9, preparedPlan: prepared });
    const turn = () => ({
      requestId: 'req-ai', replyText: 'ยอดขายวันนี้ 1,000 บาท', sourceRefs: [], sourceLabels: [], webLinks: [],
      intent: 'read_summary', agent: 'sales', refused: false, toolsInvoked: [], toolCalls: [],
      modelCallCount: 1, modelLineage: [], usage: [], durationMs: 10,
    });
    const silent = (useCase: unknown) => { (useCase as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined }; };

    // Default (both lane flags off): the prepared plan is NOT carried into the turn request.
    {
      const { prisma } = makePrisma();
      const { useCase, aiGatewayRequests } = makeUseCase(prisma, { permissions: ['line.ai.query'], intakeRouteFn: route, aiGatewayFn: turn });
      silent(useCase);
      await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-fwd-off', messageText: 'ยอดขายวันนี้เท่าไหร่' });
      assert.equal(aiGatewayRequests[0]?.preparedPlan, undefined, 'default off → prepared plan not forwarded');
      assert.equal(aiGatewayRequests[0]?.intakeIntent, undefined, 'default off → no provenance bound');
    }

    // Phase 4 alone (prepared-simple-read on, shadow OFF): forwarded — the two lanes are independent.
    // The API binds the TRUSTED outer route intent as separate provenance (never from the wrapper).
    {
      const { prisma } = makePrisma();
      const { useCase, aiGatewayRequests } = makeUseCase(prisma, { permissions: ['line.ai.query'], config: { lineAiPreparedSimpleReadEnabled: true }, intakeRouteFn: route, aiGatewayFn: turn });
      silent(useCase);
      await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-fwd-p4', messageText: 'ยอดขายวันนี้เท่าไหร่' });
      assert.ok(aiGatewayRequests[0]?.preparedPlan, 'prepared-simple-read on → forwarded even with shadow off');
      assert.equal(aiGatewayRequests[0].preparedPlan.version, 1);
      assert.equal(aiGatewayRequests[0].intakeIntent, 'BUSINESS_READ_QUESTION', 'trusted outer intent bound from the route');
    }

    // Phase 3 alone (shadow on, prepared-simple-read OFF): also forwarded, for the shadow comparison.
    {
      const { prisma } = makePrisma();
      const { useCase, aiGatewayRequests } = makeUseCase(prisma, { permissions: ['line.ai.query'], config: { lineAiFusedPlanShadowEnabled: true }, intakeRouteFn: route, aiGatewayFn: turn });
      silent(useCase);
      await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-fwd-p3', messageText: 'ยอดขายวันนี้เท่าไหร่' });
      assert.ok(aiGatewayRequests[0]?.preparedPlan, 'shadow on → forwarded for comparison');
    }
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

  // UAT 2026-08-18: รายการรออนุมัติ only linked out, so an approver could not tell from LINE
  // whether anything was waiting.
  it('counts the pending approval queues the member can act on', async () => {
    const { prisma } = makePrisma();
    const { useCase, sentMessages } = makeUseCase(prisma, {
      permissions: ['line.ai.query', 'reimbursement.approve', 'procurement.purchase_request.approve'],
      approvalQueues: {
        reimbursement: { execute: async () => [
          { requestNo: 'RB-0007', requesterDisplayNameSnapshot: 'สมชาย', amount: '1130' },
          { requestNo: 'RB-0008', requesterDisplayNameSnapshot: 'มานี', amount: '250.5' },
        ] },
        // An approver without the matching read permission: the queue is left out, never zeroed.
        purchaseRequests: { execute: async () => { throw new Error('Forbidden'); } },
      },
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-approval-counts', messageText: 'รายการรออนุมัติ' });

    const lines = (sentMessages[0]?.contents.body.contents as any[]).map((line) => line.text);
    assert.equal(sentMessages[0]?.altText, 'รายการรออนุมัติ 2 รายการ');
    assert.deepEqual(lines, [
      '✅ รายการรออนุมัติ',
      'มี 2 รายการรอคุณอนุมัติ',
      'คำขอเบิกเงิน (2)',
      '• RB-0007 · สมชาย · 1,130.00 บาท',
      '• RB-0008 · มานี · 250.50 บาท',
      'เปิดในเว็บเพื่อดูรายละเอียดและยืนยันอย่างปลอดภัย',
    ]);
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

  // The queue use cases receive server-derived identity and scope, never anything read off the
  // LINE message, so the card can only ever count rows this member could open on the web.
  it('reads the approval queues with the caller RequestContext, not with anything from the message', async () => {
    const { prisma } = makePrisma();
    const approvalCalls: any[] = [];
    const purchaseOrderCalls: any[] = [];
    const { useCase } = makeUseCase(prisma, {
      permissions: ['line.ai.query', 'reimbursement.approve', 'procurement.purchase_order.approve'],
      branchIds: ['branch-1'],
      approvalQueues: {
        reimbursement: { execute: async (ctx: any) => { approvalCalls.push(ctx); return []; } },
        purchaseOrders: { execute: async (_ctx: any, filter: any) => { purchaseOrderCalls.push(filter); return { data: [], total: 0 }; } },
      },
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-approval-queue', messageText: 'รายการรออนุมัติ' });

    assert.equal(approvalCalls.length, 1);
    assert.deepEqual(
      { companyId: approvalCalls[0].companyId, userId: approvalCalls[0].userId, scopes: approvalCalls[0].scopes, authProvider: approvalCalls[0].authProvider },
      { companyId: 'company-1', userId: 'user-1', scopes: { branchIds: ['branch-1'] }, authProvider: 'line' },
    );
    assert.deepEqual(purchaseOrderCalls, [{ status: 'PENDING_APPROVAL', page: 1, pageSize: 5 }]);
  });

  it('keeps the approval card link-only when a queue read fails, instead of reporting it empty', async () => {
    const { prisma } = makePrisma();
    const { useCase, sentMessages } = makeUseCase(prisma, {
      permissions: ['line.ai.query', 'reimbursement.approve'],
      approvalQueues: { reimbursement: { execute: async () => { throw new Error('database unavailable'); } } },
    });

    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-approval-queue-failed', messageText: 'รายการรออนุมัติ' });

    const rendered = JSON.stringify(sentMessages[0]);
    assert.equal(rendered.includes('ไม่มีรายการ'), false);
    assert.ok(rendered.includes('reimbursements?tab=approvals'));
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

  // A4: the SIGNATURE_UPLOAD_TICKET route depends on an AI call that can come back UNAVAILABLE or
  // low-confidence. Every degraded turn used to send a signature photo down expense capture instead.
  it('creates the signature asset from an explicit caption even when the intake router is unavailable', async () => {
    const { prisma } = makePrisma();
    const created: any[] = [];
    const delivered: string[] = [];
    let receiptIntents = 0;
    const { useCase } = makeUseCase(prisma, {
      permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'attachment.create', 'expense.signature.manage'],
      intakeRouteFn: () => ({ status: 'UNAVAILABLE' }),
      // The ticket reply is delivered as several bubbles; the link is not in the first one.
      sendReplyFn: async (_token: string, messages: any[]) => { delivered.push(JSON.stringify(messages)); return 'ok'; },
      initReceiptUpload: { execute: async () => { receiptIntents += 1; return { expenseId: 'exp-1', attachmentId: 'att-1' }; } },
      completeReceiptUpload: { execute: async () => undefined },
      initSignatureUpload: { execute: async () => ({ attachmentId: 'att-sig', uploadUrl: 'https://upload', uploadMethod: 'PUT', uploadHeaders: {} }) },
      createSignatureAsset: { execute: async (_ctx: any, cmd: any) => { created.push(cmd); return { id: 'sig-9', status: 'ACTIVE' }; } },
    });
    (useCase as any).downloadLineMedia = async () => ({
      fileName: 'signature.jpg', mimeType: 'image/jpeg', byteSize: JPEG_BYTES.byteLength,
      checksumSha256: 'hash', contentBase64: JPEG_BYTES.toString('base64'), bytes: JPEG_BYTES,
    });
    (useCase as any).uploadLineMedia = async () => undefined;

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-sig-caption',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-sig-caption',
      lineMessageId: 'line-msg-sig',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    }, 'ลายเซ็นของผมครับ');

    assert.equal(created.length, 1);
    assert.equal(created[0].submittedFromChannel, 'LINE');
    assert.equal(created[0].lineMessageId, 'line-msg-sig');
    assert.equal(receiptIntents, 0, 'a signature must never be captured as an expense');
    // A2: the ticket link points at the un-parked screen, not the parked ?tab= query.
    assert.match(delivered.join('\n'), /expenses\/signatures\?signatureId=sig-9/);
  });

  // F8: the “ตอบ 1” steer used to fire only on the numbered pending-media route. A captioned photo
  // took the deterministic route and stranded a sender who was mid-issue-decision with no steer.
  it('steers the caption-route signature back to “ตอบ 1” only when the issue decision is pending (F8)', async () => {
    const runCaption = async (pendingIssueDecision: boolean) => {
      const { prisma } = makePrisma();
      const delivered: string[] = [];
      const { useCase } = makeUseCase(prisma, {
        permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'attachment.create', 'expense.signature.manage'],
        intakeRouteFn: () => ({ status: 'UNAVAILABLE' }),
        sendReplyFn: async (_t: string, messages: any[]) => { delivered.push(JSON.stringify(messages)); return 'ok'; },
        initReceiptUpload: { execute: async () => ({ expenseId: 'exp-1', attachmentId: 'att-1' }) },
        completeReceiptUpload: { execute: async () => undefined },
        initSignatureUpload: { execute: async () => ({ attachmentId: 'att-sig', uploadUrl: 'https://upload', uploadMethod: 'PUT', uploadHeaders: {} }) },
        createSignatureAsset: { execute: async () => ({ id: 'sig-9', status: 'ACTIVE' }) },
        substituteReceiptContinuation: { hasPendingIssueDecision: async () => pendingIssueDecision },
      });
      (useCase as any).downloadLineMedia = async () => ({
        fileName: 'signature.jpg', mimeType: 'image/jpeg', byteSize: JPEG_BYTES.byteLength,
        checksumSha256: 'hash', contentBase64: JPEG_BYTES.toString('base64'), bytes: JPEG_BYTES,
      });
      (useCase as any).uploadLineMedia = async () => undefined;
      await useCase.executeReceiptUpload({
        webhookEventId: `evt-sig-${pendingIssueDecision}`, lineUserId: 'line-user-secret',
        replyToken: 'reply-sig', lineMessageId: 'line-msg-sig', messageType: 'image', messagingChannelId: 'msg-channel-1',
      }, 'ลายเซ็นของผมครับ');
      return delivered.join('\n');
    };

    assert.match(await runCaption(true), /ตอบ 1 เพื่อออกเอกสาร/, 'steers when a decision is pending');
    assert.doesNotMatch(await runCaption(false), /ตอบ 1 เพื่อออกเอกสาร/, 'no steer when nothing is pending');
  });

  // F1: `ลายเซ็น` is a substring test, and plenty of real receipts mention it ("ค่าทำป้ายลายเซ็น").
  // Reading that as intent filed the receipt as the newest reusable signature for legal documents —
  // ACTIVE and signable on the spot — and lost the expense entirely. A router that saw both the
  // caption and the picture outranks a regex; the deterministic route is for when it said nothing.
  it('leaves a ROUTED expense capture alone even when its caption mentions ลายเซ็น', async () => {
    const { prisma } = makePrisma();
    const signatureCreated: any[] = [];
    let receiptIntents = 0;
    const { useCase } = makeUseCase(prisma, {
      permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'attachment.create', 'expense.signature.manage', 'expense.create'],
      intakeRouteFn: () => ROUTED_EXPENSE_DOCUMENT,
      receiptOcrFn: () => ({ status: 'ok', classification: receiptClassification('500.00'), fields: { grandTotalAmount: '500.00' } }),
      initReceiptUpload: { execute: async () => { receiptIntents += 1; return { expenseId: 'exp-1', attachmentId: 'att-1' }; } },
      completeReceiptUpload: { execute: async () => ({ id: 'exp-1', duplicateStatus: 'NONE' }) },
      initSignatureUpload: { execute: async () => ({ attachmentId: 'att-sig', uploadUrl: 'https://upload', uploadMethod: 'PUT', uploadHeaders: {} }) },
      createSignatureAsset: { execute: async (_ctx: any, cmd: any) => { signatureCreated.push(cmd); return { id: 'sig-9', status: 'ACTIVE' }; } },
    });
    (useCase as any).downloadLineMedia = async () => ({
      fileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: JPEG_BYTES.byteLength,
      checksumSha256: 'hash', contentBase64: JPEG_BYTES.toString('base64'), bytes: JPEG_BYTES,
    });
    (useCase as any).uploadLineMedia = async () => undefined;

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-sig-incidental',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-sig-incidental',
      lineMessageId: 'line-msg-incidental',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    }, 'ค่าทำป้ายลายเซ็น 500 บาท');

    assert.deepEqual(signatureCreated, [], 'a routed receipt must never become a signature asset');
    assert.equal(receiptIntents, 1, 'the expense capture the router asked for must still happen');
  });

  // A3 answer half + F9. Certification resolves signatures through a PNG/JPEG-only lookup, so a PDF
  // answered as "my signature" would become an ACTIVE asset that can never sign anything — a dead
  // end from the first turn, since nothing is held for review any more.
  it('turns the numbered signature answer into a usable asset that steers back to the decision, and refuses a PDF outright', async () => {
    const answerEvent = {
      webhookEventId: 'evt-sig-answer', lineUserId: 'line-user-secret', replyToken: 'reply-sig-answer',
      messageText: '1', messagingChannelId: 'msg-channel-1',
    } as any;
    const chatKeyHash = chatKeyHashOf(answerEvent);
    const asked = { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices: ['SIGNATURE', 'PAYMENT_EVIDENCE', 'SUPPORTING_EVIDENCE', 'NEW_EXPENSE', 'NO_RECORD'] };
    const access = { membershipId: 'mem-1', roles: ['STAFF'], permissions: [], scopes: {} } as any;

    const run = async (mimeType: string) => {
      const { prisma } = makePrisma();
      (prisma.client as any).lineIntakePendingMedia = { updateMany: async (args: any) => { resolved.push(args); return { count: 1 }; } };
      const resolved: any[] = [];
      const created: any[] = [];
      const { useCase, replies } = makeUseCase(prisma, {
        permissions: ['expense.receipt.upload', 'expense.signature.manage', 'attachment.create'],
        initSignatureUpload: { execute: async () => ({ attachmentId: 'att-sig' }) },
        createSignatureAsset: { execute: async (_c: any, cmd: any) => { created.push(cmd); return { id: 'sig-7', status: 'ACTIVE' }; } },
        substituteReceiptContinuation: {
          loadOpenMediaContext: async () => ({ expenseId: 'exp-1', awaitingScans: [], signatureRequested: true }),
          // F8: this chat is parked at the issue decision, so the signature answer steers to “ตอบ 1”.
          hasPendingIssueDecision: async () => true,
        },
      });
      const ctxForAnswer = {
        requestId: 'req-1', authSubject: 'u1', userId: 'u1', companyId: 'company-1', membershipId: 'mem-1',
        roles: [], permissions: ['expense.receipt.upload', 'expense.signature.manage'], scopes: {}, authProvider: 'line',
      } as any;
      const outcome = await (useCase as any).resolveSubstituteMediaAnswer(
        answerEvent, ctxForAnswer, access,
        { id: 'pending-1', attachmentId: 'att-parked', lineMessageId: 'line-msg-photo', mimeType, askedQuestionJson: asked },
        '1',
      );
      return { outcome, created, resolved, replies };
    };

    const image = await run('image/jpeg');
    assert.equal(image.outcome.outcome, 'handled');
    assert.equal(image.created.length, 1);
    // The IMAGE's id, so a redelivery of the photo collides with this asset rather than twinning it.
    assert.equal(image.created[0].lineMessageId, 'line-msg-photo');
    assert.equal(image.created[0].attachmentAlreadyActive, true);
    // F13: closed as a signature, not mislabelled as a receipt.
    assert.equal(image.resolved[0].data.status, 'RESOLVED_SIGNATURE');
    // Journey A: usable at once, and the sender is put back on the decision they were answering
    // rather than left at "saved!" one keystroke from the document.
    assert.match(image.replies.join('\n'), /ใช้ลงนามเอกสารได้ทันที ไม่ต้องรออนุมัติ/);
    assert.match(image.replies.join('\n'), /ตอบ 1 เพื่อออกเอกสารต่อได้เลยค่ะ/);

    const pdf = await run('application/pdf');
    assert.equal(pdf.created.length, 0, 'a PDF must never become a signature asset');
    assert.match(pdf.replies.join('\n'), /รูปลายเซ็น/);
  });

  // A4: the router asked a question about a photo and dropped the photo, so whatever the customer
  // answered had nothing left to act on.
  it('parks the bytes when the intake router routes a media turn to CLARIFY', async () => {
    const { prisma } = makePrisma();
    const pendingRows: any[] = [];
    (prisma.client as any).lineIntakePendingMedia = {
      findFirst: async () => null,
      findUnique: async () => pendingRows.at(-1) ?? null,
      create: async ({ data }: any) => { pendingRows.push({ id: 'pending-1', ...data }); return pendingRows.at(-1); },
      update: async (args: unknown) => args,
    };
    const { useCase, replies } = makeUseCase(prisma, {
      permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'attachment.create'],
      intakeRouteFn: () => ({ status: 'ROUTED', intent: 'CLARIFY', clarifyQuestion: 'รูปนี้คืออะไรคะ', confidence: 0.9 }),
      initReceiptUpload: { execute: async () => ({ expenseId: 'exp-1', attachmentId: 'att-1' }) },
      completeReceiptUpload: { execute: async () => undefined },
      createUploadIntent: { execute: async () => ({ attachmentId: 'att-parked' }) },
      completeAttachmentUpload: { execute: async () => undefined },
    });
    (useCase as any).downloadLineMedia = async () => ({
      fileName: 'photo.jpg', mimeType: 'image/jpeg', byteSize: JPEG_BYTES.byteLength,
      checksumSha256: 'hash', contentBase64: JPEG_BYTES.toString('base64'), bytes: JPEG_BYTES,
    });
    (useCase as any).uploadLineMedia = async () => undefined;

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-clarify-media',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-clarify-media',
      lineMessageId: 'line-msg-clarify',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    }, 'อันนี้คืออะไร');

    assert.equal(pendingRows.length, 1, 'the clarify question must not throw the photo away');
    assert.equal(pendingRows[0].attachmentId, 'att-parked');
    assert.match(replies[0] ?? '', /รูปนี้คืออะไรคะ/);
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

  it('audits a failed LINE receipt read with its gateway errorCode', async () => {
    // An unreadable image routes to `clarify` and returns before any expense exists, so this row is
    // the only record that the read was attempted at all. Without it every "อ่านไม่ออก" report is
    // invisible in the audit log and the failure cause is unattributable.
    const { prisma } = makePrisma();
    const audits: any[] = [];
    const useCase = new ProcessLineWebhookUseCase(
      prisma,
      { webBaseUrl: 'https://app.example.com', lineMessagingChannelAccessToken: 'line-token' } as any,
      {
        resolveAccess: async () => ({
          membershipId: 'mem-1',
          roles: ['STAFF'],
          permissions: ['expense.receipt.line_upload', 'attachment.create', 'expense.create'],
          scopes: {},
        }),
      } as any,
      { log: async (entry: any) => { audits.push(entry); } } as any,
      {
        requestLineTurn: async () => { throw new Error('not expected'); },
        requestLineIntakeRoute: async () => ROUTED_EXPENSE_DOCUMENT,
        requestReceiptOcr: async () => ({ status: 'failed', errorCode: 'OCR_EMPTY_OUTPUT' }),
      } as any,
      {
        buildTextMessage: (text: string) => ({ type: 'text', text }),
        sendReply: async () => 'ok',
      } as any,
      { apply: async () => ({ candidatesCreated: 0 }) } as any,
      CLEAN_SCANNER,
      acceptedLegal,
      shadowProbe,
      { execute: async () => { throw new Error('no expense expected on a failed read'); } } as any,
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
    // The clarify branch parks the media for a follow-up; that storage path is covered elsewhere.
    (useCase as any).ensurePendingMedia = async () => ({ created: true, pending: null });

    await useCase.executeReceiptUpload({
      webhookEventId: 'evt-unreadable-1',
      lineUserId: 'line-user-secret',
      replyToken: 'reply-unreadable-1',
      lineMessageId: 'line-msg-unreadable-1',
      messageType: 'image',
      messagingChannelId: 'msg-channel-1',
    });

    const ocrAudit = audits.find((entry) => entry.action === 'expense.ocr.request');
    assert.ok(ocrAudit, 'a failed read must still be audited');
    assert.equal(ocrAudit.result, 'FAILED');
    assert.equal(ocrAudit.targetId, 'evt-unreadable-1');
    assert.equal(ocrAudit.metadataJson.channel, 'line');
    assert.equal(ocrAudit.metadataJson.status, 'OCR_FAILED');
    assert.equal(ocrAudit.metadataJson.errorCode, 'OCR_EMPTY_OUTPUT');
    assert.equal(ocrAudit.metadataJson.recognizedFieldCount, 0);
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
  config?: Record<string, unknown>;
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
    { webBaseUrl: 'https://app.example.com', ...(opts.config ?? {}) } as any,
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

function expenseWithLines(lines: unknown[]) {
  return {
    id: 'expense-1', sourceDocumentType: 'RECEIPT', grandTotalAmount: '125.00', currency: 'THB',
    expenseCategoryId: null, accountHintKey: null, taxEvidenceStatus: 'NEEDS_REVIEW',
    aiVerificationSummaryJson: { recognizedFields: { lines }, missingFields: [] },
  } as any;
}

describe('LINE grounded receipt item follow-up', () => {
  it('recognizes low-tech references to the current bill as a document question', () => {
    for (const question of [
      'บิลนี้จ่ายค่าสินค้าอะไร', 'ใบนี้ซื้ออะไรบ้าง', 'เอกสารนี้มีรายการอะไร',
    ]) assert.equal(isGroundedReceiptFollowUp(question), true, question);
  });

  it('answers only the printed line items and links to the selected expense record', () => {
    const reply = formatGroundedReceiptFollowUp('https://app.test', 'company-1', expenseWithLines([
      { description: 'กระดาษ A4', quantity: '2', amount: '100.00', evidenceSignal: 'กระดาษ A4 2 100' },
      { description: 'ปากกา', quantity: '1', amount: '25.00', evidenceSignal: 'ปากกา 1 25' },
    ]), undefined, 'บิลนี้จ่ายค่าสินค้าอะไร');
    assert.match(reply, /กระดาษ A4 × 2 – 100\.00/);
    assert.match(reply, /ปากกา × 1 – 25\.00/);
    assert.match(reply, /\/companies\/company-1\/expenses\/expense-1/);
    assert.equal(reply.includes('สต็อก'), false, 'a bill item question is not inventory');
  });

  it('states honestly when no printed item rows were readable', () => {
    const reply = formatGroundedReceiptFollowUp(undefined, 'company-1', expenseWithLines([]), undefined, 'บิลนี้ซื้ออะไร');
    assert.match(reply, /ยังอ่านรายการสินค้า.*ไม่ได้ชัดเจน/);
  });
});

/**
 * The link helper used to live in this file and was copied twice more, each copy falling back to a
 * different environment's host. Registered here because this spec already runs in CI.
 */
describe('web link resolution', () => {
  const saved = { web: process.env['WEB_BASE_URL'], pub: process.env['PUBLIC_BASE_URL'] };
  const restore = () => {
    if (saved.web === undefined) delete process.env['WEB_BASE_URL']; else process.env['WEB_BASE_URL'] = saved.web;
    if (saved.pub === undefined) delete process.env['PUBLIC_BASE_URL']; else process.env['PUBLIC_BASE_URL'] = saved.pub;
  };

  it('joins a base and a path without doubling the slash', () => {
    assert.equal(absoluteWebLink('https://uat.mangmeeplus.com/', '/companies/c1/expenses/e1'), 'https://uat.mangmeeplus.com/companies/c1/expenses/e1');
    assert.equal(absoluteWebLink('https://uat.mangmeeplus.com', 'companies/c1'), 'https://uat.mangmeeplus.com/companies/c1');
  });

  it('leaves an already-absolute URL alone', () => {
    assert.equal(absoluteWebLink('https://uat.mangmeeplus.com', 'https://other.example/x'), 'https://other.example/x');
  });

  it('returns the bare path rather than inventing a host', () => {
    assert.equal(absoluteWebLink(undefined, '/companies/c1'), '/companies/c1');
    assert.equal(absoluteWebLink('', '/companies/c1'), '/companies/c1');
  });

  it('prefers WEB_BASE_URL, then PUBLIC_BASE_URL, and never a hard-coded host', () => {
    try {
      process.env['WEB_BASE_URL'] = 'https://uat.mangmeeplus.com';
      process.env['PUBLIC_BASE_URL'] = 'https://api.example';
      assert.equal(webBaseUrlFromEnv(), 'https://uat.mangmeeplus.com');
      assert.equal(webLink('/companies/c1'), 'https://uat.mangmeeplus.com/companies/c1');

      delete process.env['WEB_BASE_URL'];
      assert.equal(webBaseUrlFromEnv(), 'https://api.example');

      delete process.env['PUBLIC_BASE_URL'];
      assert.equal(webBaseUrlFromEnv(), undefined);
      assert.equal(webLink('/companies/c1'), '/companies/c1');
    } finally {
      restore();
    }
  });
});

/** B4: an open "รูปนี้เป็นอะไรคะ" used to swallow a substitute-receipt request, because every name of
 *  that document contains ‘ใบเสร็จ’ and the keyword scan read it as "yes, it's a receipt". A draft was
 *  then built from the PHOTO, the amount the sender had just typed was dropped, and the substitute
 *  request produced nothing at all. */
describe('B4 — the pending-media classifier never claims a substitute-receipt request', () => {
  const SUBSTITUTE_REQUESTS = [
    'ทำใบรับรองแทนใบเสร็จรับเงิน ค่าวินมอไซต์ไปพบลูกค้า 50 บาท',
    'ขอใบรับรองแทนใบเสร็จ',
    'ทำใบทดแทนใบเสร็จ ค่าแท็กซี่ 120 บาท',
    'ทำใบรับรองต่อ',
    'ขอใบแทนใบเสร็จหน่อยค่ะ',
  ];
  for (const text of SUBSTITUTE_REQUESTS) {
    it(`leaves the bytes pending for “${text.slice(0, 28)}”`, () => {
      assert.equal(classifyPendingMediaReply(text), 'ambiguous');
    });
  }

  const REAL_ANSWERS: Array<[string, string]> = [
    ['1', 'receipt'], ['ใบเสร็จ', 'receipt'], ['ใบเสร็จค่ะ', 'receipt'], ['บันทึกเลย', 'receipt'],
    ['ใบกำกับภาษี', 'receipt'], ['สลิป', 'receipt'],
    ['2', 'illustration'], ['ภาพประกอบ', 'illustration'], ['ไม่ต้องบันทึก', 'illustration'],
    ['3', 'multiple'], ['สรุปหลายรายการ', 'multiple'],
  ];
  for (const [text, expected] of REAL_ANSWERS) {
    it(`still answers the question it was asked with “${text}” → ${expected}`, () => {
      assert.equal(classifyPendingMediaReply(text), expected);
    });
  }
});

/** W1: the signature link is irreversible and the LINE delivery between it and the resolve can throw.
 *  With the resolve last, that throw left the pending row PENDING holding an attachment id that is
 *  ALREADY a company signature asset — and the next answer could file the same id as this expense's
 *  receipt or substitute evidence, producing an artifact that is both. */
describe('W1 — a failed delivery can never leave signed-away bytes reusable', () => {
  const answerEvent = {
    webhookEventId: 'evt-sig-throw', lineUserId: 'line-user-secret', replyToken: 'reply-sig-throw',
    messageText: '1', messagingChannelId: 'msg-channel-1',
  } as any;

  function run(deliver: () => Promise<void>) {
    const order: string[] = [];
    const { prisma } = makePrisma();
    (prisma.client as any).lineIntakePendingMedia = {
      updateMany: async (args: any) => { order.push(`resolve:${args.data.status}`); return { count: 1 }; },
    };
    const { useCase } = makeUseCase(prisma, {
      permissions: ['expense.receipt.upload', 'expense.signature.manage', 'attachment.create'],
      initSignatureUpload: { execute: async () => ({ attachmentId: 'att-sig' }) },
      createSignatureAsset: { execute: async () => { order.push('link'); return { id: 'sig-7', status: 'ACTIVE' }; } },
      substituteReceiptContinuation: {
        loadOpenMediaContext: async () => ({ expenseId: 'exp-1', awaitingScans: [], signatureRequested: true }),
        hasPendingIssueDecision: async () => false,
      },
    });
    (useCase as any).deliverCompletedReply = async () => { order.push('deliver'); await deliver(); };
    const chatKeyHash = chatKeyHashOf(answerEvent);
    const asked = { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices: ['SIGNATURE', 'PAYMENT_EVIDENCE', 'SUPPORTING_EVIDENCE', 'NEW_EXPENSE', 'NO_RECORD'] };
    const answerCtx = {
      requestId: 'req-1', authSubject: 'u1', userId: 'u1', companyId: 'company-1', membershipId: 'mem-1',
      roles: [], permissions: ['expense.receipt.upload', 'expense.signature.manage'], scopes: {}, authProvider: 'line',
    } as any;
    const call = (useCase as any).resolveSubstituteMediaAnswer(
      answerEvent, answerCtx, { membershipId: 'mem-1', roles: ['STAFF'], permissions: [], scopes: {} },
      { id: 'pending-1', attachmentId: 'att-parked', lineMessageId: 'line-msg-photo', mimeType: 'image/jpeg', askedQuestionJson: asked },
      '1',
    );
    return { call, order };
  }

  it('consumes the pending row before the attachment becomes a signature asset', async () => {
    const { call, order } = run(async () => undefined);
    await call;
    assert.deepEqual(order, ['resolve:RESOLVED_SIGNATURE', 'link', 'deliver']);
  });

  it('leaves the row consumed when the LINE delivery throws', async () => {
    const { call, order } = run(async () => { throw new Error('LINE reply failed'); });
    await assert.rejects(call, /LINE reply failed/);
    assert.deepEqual(
      order.filter((step) => step.startsWith('resolve')), ['resolve:RESOLVED_SIGNATURE'],
      'the same attachment id can never be answered again as expense evidence',
    );
  });
});

// ── Substitute semantic-routing dispatcher (executable write-behavior, not helper-only) ───────────
describe('ProcessLineWebhookUseCase – substitute semantic dispatcher', () => {
  const READ_ROUTE = () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 });
  const SUB_ROUTE = (over = {}) => ({ status: 'ROUTED', intent: 'SUBSTITUTE_RECEIPT_CONTINUATION', language: 'th', confidence: 0.9, ...over });
  const UNAVAIL_ROUTE = () => ({ status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0 });
  const aiTurn = () => ({ requestId: 'req-ai', replyText: 'ยอดขาย 1,000', sourceRefs: [], sourceLabels: [], webLinks: [], intent: 'read_summary', agent: 'sales', refused: false, toolsInvoked: [], toolCalls: [], modelCallCount: 1, modelLineage: [], usage: [], durationMs: 5 });

  function makeSub(result?: any, context?: any) {
    const executeCalls: any[] = [];
    return {
      executeCalls,
      useCase: {
        substituteContext: async () => ({ workflowState: 'none', hasPendingQuestion: false, preparedState: 'none', recentCandidateCount: 0, ...(context ?? {}) }),
        execute: async (_ctx: any, input: any) => { executeCalls.push(input); return result ?? { handled: true, status: 'BLOCKED', replyText: 'ระบุผู้จ่าย', acceptedFields: [], blockers: [], pendingQuestion: 'ระบุผู้จ่าย' }; },
      },
    };
  }
  function makeLedger(openWaiting: any[] = []) {
    const appended: any[] = [];
    return { appended, ledger: { openWaitingUser: async () => openWaiting, appendSubRequests: async (i: any) => { appended.push(i); }, ack: async () => undefined, appendTurn: async () => undefined, coverageToSubRequests: () => [] } };
  }
  const P = { permissions: ['line.ai.query', 'expense.review'] };

  it('PRIMARY: a semantic SUBSTITUTE route executes the continuation exactly once (fresh, no consume)', async () => {
    const { prisma } = makePrisma();
    const sub = makeSub();
    const { useCase } = makeUseCase(prisma, { ...P, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: sub.useCase, substituteLedger: makeLedger().ledger, intakeRouteFn: SUB_ROUTE, aiGatewayFn: aiTurn });
    (useCase as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-sub-1', messageText: 'ทำใบทดแทนของค่าวิน' });
    assert.equal(sub.executeCalls.length, 1, 'continuation executed once');
  });

  it('PRIMARY: a non-substitute route (side question) does NOT execute the continuation; substitute stays open', async () => {
    const { prisma } = makePrisma();
    const sub = makeSub();
    const led = makeLedger([{ id: 'w-1', text: 'ทำใบรับรองต่อ', clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', entry: { id: 'w-1' } }]);
    const { useCase } = makeUseCase(prisma, { ...P, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: sub.useCase, substituteLedger: led.ledger, intakeRouteFn: READ_ROUTE, aiGatewayFn: aiTurn });
    (useCase as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-sub-2', messageText: 'เดือนนี้ยอดขายเท่าไหร่' });
    assert.equal(sub.executeCalls.length, 0, 'a side question never dispatches the substitute continuation');
  });

  it('PRIMARY: UNAVAILABLE + canonical legal name uses the narrow fallback (execute once); a paraphrase does not', async () => {
    for (const [msg, expected] of [['ทำใบรับรองแทนใบเสร็จรับเงิน', 1], ['ทำใบทดแทนของค่าวิน', 0]] as const) {
      const { prisma } = makePrisma();
      const sub = makeSub();
      const { useCase } = makeUseCase(prisma, { ...P, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: sub.useCase, substituteLedger: makeLedger().ledger, intakeRouteFn: UNAVAIL_ROUTE, aiGatewayFn: aiTurn });
      (useCase as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
      await useCase.execute({ ...BASE_EVENT, webhookEventId: `evt-sub-unavail-${expected}`, messageText: msg });
      assert.equal(sub.executeCalls.length, expected, `${msg} → ${expected} execute`);
    }
  });

  it('PRIMARY UNAVAILABLE precedence: a canonical command with BOTH a substitute workflow and an OPEN expense draft dispatches the substitute AND interrupts the draft (P2-H)', async () => {
    const { prisma } = makePrisma();
    const sub = makeSub();
    const interruptCalls: any[] = [];
    // An OPEN expense draft is also live in this chat. The provider is UNAVAILABLE (router down).
    const draft = {
      routeContexts: async () => [{ status: 'OPEN', expenseId: 'draft-1' }],
      interruptOpen: async (...a: any[]) => { interruptCalls.push(a); return 'พักงานร่างค่าใช้จ่ายไว้ก่อนนะคะ'; },
      execute: async () => { throw new Error('draft.execute must not run — the substitute path wins this turn'); },
    };
    const { useCase, replies } = makeUseCase(prisma, {
      permissions: ['line.ai.query', 'expense.review', 'expense.create'],
      config: { lineAiSubstituteSemanticRoutingMode: 'primary', lineExpenseDraftConversationEnabled: true },
      substituteContinuation: sub.useCase, substituteLedger: makeLedger().ledger,
      expenseDraftConversation: draft, intakeRouteFn: UNAVAIL_ROUTE, aiGatewayFn: aiTurn,
    });
    (useCase as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-sub-unavail-draft', messageText: 'ทำใบรับรองแทนใบเสร็จรับเงิน' });
    // The canonical substitute fallback wins even with the router UNAVAILABLE, and the draft is PAUSED, not lost.
    assert.equal(sub.executeCalls.length, 1, 'the canonical substitute fallback dispatches despite the UNAVAILABLE router');
    assert.equal(interruptCalls.length, 1, 'the OPEN expense draft is interrupted (paused), never silently dropped');
    assert.ok(replies.some((r) => r.includes('พักงานร่างค่าใช้จ่ายไว้ก่อนนะคะ')), 'the interruption note reaches the user, appended to the substitute reply');
  });

  it('OFF (default): a legacy-positive starts DIRECTLY with confirmedStart=true (exact legacy, no confirm step)', async () => {
    const { prisma } = makePrisma();
    const sub = makeSub();
    // Mode defaults to off; the legacy regex path handles it before the router.
    const { useCase } = makeUseCase(prisma, { ...P, substituteContinuation: sub.useCase, substituteLedger: makeLedger().ledger, intakeRouteFn: READ_ROUTE, aiGatewayFn: aiTurn });
    (useCase as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-sub-off', messageText: 'ทำใบทดแทนใบเสร็จ' });
    assert.equal(sub.executeCalls.length, 1, 'legacy path executes');
    assert.equal(sub.executeCalls[0].confirmedStart, true, 'legacy-positive opens directly (no confirmation regression)');
  });

  it('SHADOW is an inert NO-GO: byte-identical to OFF — legacy path, no primary dispatch, no substitute capability/context', async () => {
    // A canonical command in SHADOW runs the EXACT legacy path (like off) — never the primary dispatcher.
    const { prisma } = makePrisma();
    const sub = makeSub();
    const { useCase } = makeUseCase(prisma, { ...P, config: { lineAiSubstituteSemanticRoutingMode: 'shadow' }, substituteContinuation: sub.useCase, substituteLedger: makeLedger().ledger, intakeRouteFn: READ_ROUTE, aiGatewayFn: aiTurn });
    (useCase as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-sub-shadow', messageText: 'ทำใบทดแทนใบเสร็จ' });
    assert.equal(sub.executeCalls.length, 1, 'shadow uses the legacy path exactly like off');
    assert.equal(sub.executeCalls[0].confirmedStart, true, 'legacy-positive still opens directly in shadow');

    // A non-substitute message reaches the router; shadow must NOT add substitute capability or context —
    // the intake request is byte-identical to off (the router is never even offered the semantic route).
    const { prisma: prisma2 } = makePrisma();
    const sub2 = makeSub();
    const { useCase: uc2, intakeRequests } = makeUseCase(prisma2, { ...P, config: { lineAiSubstituteSemanticRoutingMode: 'shadow' }, substituteContinuation: sub2.useCase, substituteLedger: makeLedger().ledger, intakeRouteFn: READ_ROUTE, aiGatewayFn: aiTurn });
    (uc2 as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    await uc2.execute({ ...BASE_EVENT, webhookEventId: 'evt-sub-shadow-2', messageText: 'ยอดขายวันนี้เท่าไหร่' });
    assert.equal(intakeRequests.length, 1, 'router was called for the non-substitute message');
    assert.equal(intakeRequests[0].substituteContext, undefined, 'shadow sends NO substituteContext (byte-equivalent to off)');
    assert.equal(intakeRequests[0].capabilities?.substituteSemantic, false, 'shadow grants NO substitute capability');
    assert.equal(sub2.executeCalls.length, 0, 'no substitute dispatch on a non-substitute message in shadow');
  });

  it('PRIMARY UAT paraphrase → confirm asks once (pinned to the exact expense) and persists ONLY a ledger clarification; the affirmative inherits and starts', async () => {
    // Turn 1: paraphrase → continuation returns a confirm pinned to expense-9 → ledger clarification appended
    // carrying candidateExpenseIds=[expense-9] (the exact selected target, P1-2).
    const { prisma } = makePrisma();
    const confirm = makeSub({ handled: true, status: 'TARGET_REQUIRED', replyText: 'ยืนยันไหมคะ', acceptedFields: [], blockers: [], pendingQuestion: 'ยืนยันไหมคะ', expenseId: 'expense-9', candidateExpenseIds: ['expense-9'] });
    const led1 = makeLedger();
    const { useCase: uc1 } = makeUseCase(prisma, { ...P, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: confirm.useCase, substituteLedger: led1.ledger, intakeRouteFn: SUB_ROUTE, aiGatewayFn: aiTurn });
    (uc1 as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    await uc1.execute({ ...BASE_EVENT, webhookEventId: 'evt-uat-1', messageText: 'ทำใบทดแทนของค่าวิน' });
    assert.equal(confirm.executeCalls.length, 1);
    assert.equal(confirm.executeCalls[0].confirmedStart, false, 'the first paraphrase never auto-confirms a start');
    assert.equal(led1.appended.length, 1, 'exactly one intake-ledger clarification persisted (no workflow row)');
    assert.equal(led1.appended[0].items[0].clarifyForIntent, 'SUBSTITUTE_RECEIPT_CONTINUATION');
    assert.deepEqual(led1.appended[0].items[0].candidateExpenseIds, ['expense-9'], 'the confirm clarification pins the exact target');

    // Turn 2: affirmative "ใช่" against the pinned start-confirm clarification the model RESOLVES → the start
    // confirms and binds to the SAME expense-9 (never re-derived from the recency window).
    const { prisma: prisma2 } = makePrisma();
    const start = makeSub();
    const led2 = makeLedger([{ id: 'w-confirm', text: 'ยืนยัน', clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', candidateExpenseIds: ['expense-9'], entry: { id: 'w-confirm' } }]);
    const { useCase: uc2 } = makeUseCase(prisma2, { ...P, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: start.useCase, substituteLedger: led2.ledger, intakeRouteFn: () => SUB_ROUTE({ resolvedClarificationIds: ['w-confirm'] }), aiGatewayFn: aiTurn });
    (uc2 as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    await uc2.execute({ ...BASE_EVENT, webhookEventId: 'evt-uat-2', messageText: 'ใช่' });
    assert.equal(start.executeCalls.length, 1);
    assert.equal(start.executeCalls[0].confirmedStart, true, 'the affirmative confirms the paraphrase start');
    assert.deepEqual(start.executeCalls[0].recentCandidates, [{ id: 'expense-9', label: 'expense-9' }], 'the confirmed start binds to the pinned expense, not the recency window');

    // DETERMINISTIC RECOVERY (repetitive-confirmation guard): when the provider routes substitute but OMITS
    // the clarification id, an affirmative to the ONE active single-candidate start-confirm clarification
    // still confirms — otherwise the user is re-asked forever. Bound to that exact expense.
    const { prisma: prisma3 } = makePrisma();
    const recovered = makeSub();
    const led3 = makeLedger([{ id: 'w-confirm', text: 'ยืนยัน', clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', candidateExpenseIds: ['expense-9'], entry: { id: 'w-confirm' } }]);
    const { useCase: uc3 } = makeUseCase(prisma3, { ...P, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: recovered.useCase, substituteLedger: led3.ledger, intakeRouteFn: () => SUB_ROUTE(), aiGatewayFn: aiTurn });
    (uc3 as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    await uc3.execute({ ...BASE_EVENT, webhookEventId: 'evt-uat-3', messageText: 'ใช่' });
    assert.equal(recovered.executeCalls[0].confirmedStart, true, 'a unique single start-confirm clarification is deterministically recovered when the model omits the id');
    assert.deepEqual(recovered.executeCalls[0].recentCandidates, [{ id: 'expense-9', label: 'expense-9' }], 'the recovered start binds to the pinned expense, not the recency window');
  });

  it('PRIMARY deterministic recovery — bind ONLY on a unique start-confirm; ambiguous (≥2) / missing (0) stay ZERO-WRITE', async () => {
    const run = async (webhookEventId: string, openWaiting: any[], messageText = 'ใช่') => {
      const { prisma } = makePrisma();
      const sub = makeSub();
      const consumed: string[][] = [];
      const { useCase } = makeUseCase(prisma, { ...P, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: sub.useCase, substituteLedger: makeLedger(openWaiting).ledger, intakeRouteFn: () => SUB_ROUTE(), aiGatewayFn: aiTurn });
      (useCase as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
      (useCase as any).consumeClarifications = async (_c: string, _k: string, _u: string, _o: any[], ids: string[] | undefined) => { consumed.push(ids ?? []); };
      await useCase.execute({ ...BASE_EVENT, webhookEventId, messageText });
      return { confirmedStart: sub.executeCalls[0]?.confirmedStart, consumed };
    };
    const clar = (id: string, candidateExpenseIds: string[]) => ({ id, text: 'ยืนยัน', clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', candidateExpenseIds, entry: { id } });

    // Unique single-candidate start-confirm → deterministic bind + that id is consumed (never re-asked).
    const unique = await run('evt-det-unique', [clar('w-a', ['exp-1'])]);
    assert.equal(unique.confirmedStart, true, 'exactly one single-candidate start-confirm → recovered');
    assert.deepEqual(unique.consumed, [['w-a']], 'the recovered start-confirm clarification is consumed');

    // Ambiguous: TWO active start-confirm clarifications → cannot pick → ZERO-write, nothing consumed.
    const ambiguous = await run('evt-det-ambiguous', [clar('w-a', ['exp-1']), clar('w-b', ['exp-2'])]);
    assert.equal(ambiguous.confirmedStart, false, 'two pending start-confirms are ambiguous → no auto-bind');
    assert.deepEqual(ambiguous.consumed, [], 'ambiguous state consumes nothing');

    // Missing a single-candidate start-confirm: only a MULTI-candidate target-selection is open → ZERO-write.
    const missing = await run('evt-det-missing', [clar('w-t', ['exp-1', 'exp-2'])]);
    assert.equal(missing.confirmedStart, false, 'a multi-candidate target-selection is not a start-confirm → no auto-bind');
    assert.deepEqual(missing.consumed, [], 'missing state consumes nothing');

    // A NON-affirmative message never triggers the recovery even with a unique start-confirm open.
    const notAffirmative = await run('evt-det-nonaffirm', [clar('w-a', ['exp-1'])], 'ค่ากาแฟ 65 บาท');
    assert.equal(notAffirmative.confirmedStart, false, 'a non-affirmative message never deterministically confirms');
  });

  it('PRIMARY: resolved-clarification consumption is restricted to the substitute-owned intersection', async () => {
    const { prisma } = makePrisma();
    const sub = makeSub({ handled: true, status: 'READY_FOR_WEB', replyText: 'พร้อม', acceptedFields: ['businessPurpose'], blockers: [] });
    // Two open clarifications; the model resolves one substitute-owned id and one foreign id.
    const led = makeLedger([
      { id: 'w-sub', text: 'ทำต่อ', clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', entry: { id: 'w-sub' } },
      { id: 'w-other', text: 'อื่น', clarifyForIntent: 'EXPENSE_CAPTURE_CORRECTION', entry: { id: 'w-other' } },
    ]);
    const consumed: string[][] = [];
    const { useCase } = makeUseCase(prisma, { ...P, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: sub.useCase, substituteLedger: led.ledger, intakeRouteFn: () => SUB_ROUTE({ resolvedClarificationIds: ['w-sub', 'w-other'] }), aiGatewayFn: aiTurn });
    (useCase as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    (useCase as any).consumeClarifications = async (_c: string, _k: string, _u: string, _o: any[], ids: string[] | undefined) => { consumed.push(ids ?? []); };
    await useCase.execute({ ...BASE_EVENT, webhookEventId: 'evt-sub-consume', messageText: 'จ่ายเอง' });
    assert.equal(sub.executeCalls.length, 1);
    assert.deepEqual(consumed, [['w-sub']], 'only the substitute-owned resolved id is consumed (never the foreign one)');
  });

  it('PRIMARY end-to-end (REAL use case): ≥2 candidates → target-selection → ordinal → confirm binds the EXACT id and saves EXACTLY once', async () => {
    // Drives the REAL continuation use case through the REAL webhook across three fresh webhook events,
    // threading the persisted ledger clarification between turns exactly as LINE delivers them. Proves the
    // selected expense id survives an ordinal + an affirmative and even a fully drained recency window —
    // the confirmation binds to the pinned id, never re-derived from recency (P1-2), and writes ONCE.
    const PC = { permissions: ['line.ai.query', 'expense.review', 'expense.create'] };
    const saves: any[] = [];
    const store = new Map<string, any>();
    const mkExpense = (id: string) => ({
      id, companyId: 'company-1', branchId: 'branch-1', expenseNumber: id, status: 'NEEDS_REVIEW',
      sourceDocumentType: 'EXPENSE_NOTE_TEXT', currency: 'THB', grandTotalAmount: '200.0000',
      expenseCategoryId: 'cat-travel', accountHintKey: null, taxEvidenceStatus: 'SUPPORTING_ONLY',
      aiVerificationSummaryJson: null, missingReceiptReason: null, note: null, vendorNameSnapshot: null,
      paymentMethod: null, paidAt: null,
      sourceChannelMetadataJson: { channel: 'LINE', kind: 'text_note', chatKeyHash: 'chat-hash' },
      substituteReceiptEvidence: null,
      lines: [{ description: 'ค่าเดินทาง', expenseCategoryId: 'cat-travel', accountHintKey: null }],
      attachments: [], updatedAt: new Date('2026-08-16T09:00:00.000Z'),
    });
    store.set('exp-1', mkExpense('exp-1'));
    store.set('exp-2', mkExpense('exp-2'));
    const repo = {
      listLineSubstituteContinuationRows: async () => [...store.values()]
        .filter((e) => e.sourceChannelMetadataJson?.lineSubstituteReceiptContinuation)
        .map((e) => ({ id: e.id, updatedAt: e.updatedAt, sourceChannelMetadataJson: e.sourceChannelMetadataJson })),
      findByIdWithRelations: async (_c: string, id: string) => store.get(id) ?? null,
      listCategories: async () => [{ id: 'cat-travel', name: 'ค่าเดินทาง' }],
      getSubstituteReceiptPolicy: async () => null,
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'user-1', displayName: 'เจ้าของ' }],
      findActiveMemberIdentity: async (_c: string, userId: string) => userId === 'user-1' ? { userId, displayName: 'เจ้าของ' } : null,
      saveLineSubstituteContinuation: async (input: any) => {
        const cur = store.get(input.expenseId);
        const now = new Date(cur.updatedAt.getTime() + 1000);
        const continuation = { ...input.continuation, targetRevision: now.toISOString(), lastActivityAt: now.toISOString() };
        store.set(input.expenseId, { ...cur, updatedAt: now, sourceChannelMetadataJson: { ...cur.sourceChannelMetadataJson, lineSubstituteReceiptContinuation: continuation } });
        saves.push({ ...input, continuation });
        return { updatedAt: now, continuation };
      },
    } as any;
    // Develop's constructor takes (repo, prepare, audit, storage); these paths (target-select → confirm →
    // start-save) never reach prepare/issue, so the extra three are inert stubs.
    const realSub = new LineSubstituteReceiptContinuationUseCase(repo, {} as any, { log: async () => undefined } as any, { getObject: async () => ({ bytes: Buffer.from([]), mimeType: 'application/pdf' }) } as any);
    const clarFrom = (item: any, id: string, at: string) => ({ id, text: item.text, question: item.clarifyQuestion, clarifyForIntent: item.clarifyForIntent, candidateExpenseIds: item.candidateExpenseIds, askedAt: at, entry: { id } });

    // Turn A — paraphrase, TWO candidates, no open workflow → target-selection pinned to both ids, no write.
    const ledA = makeLedger();
    const { useCase: ucA } = makeUseCase(makePrisma().prisma, { ...PC, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: realSub, substituteLedger: ledA.ledger, intakeRouteFn: SUB_ROUTE, aiGatewayFn: aiTurn });
    (ucA as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    (ucA as any).loadCorrectionCandidates = async () => [{ id: 'exp-1', label: 'ค่าวิน · 200' }, { id: 'exp-2', label: 'ค่ากาแฟ · 65' }];
    await ucA.execute({ ...BASE_EVENT, webhookEventId: 'evt-mc-a', messageText: 'ทำใบทดแทนของค่าใช้จ่าย' });
    assert.equal(saves.length, 0, 'target selection writes nothing');
    assert.deepEqual(ledA.appended[0].items[0].candidateExpenseIds, ['exp-1', 'exp-2'], 'the offered shortlist is pinned on the clarification');

    // Turn B — ordinal "1" resolves the target-selection; the RECENCY window is shuffled (exp-2 first) to
    // prove the ordinal binds against the FROZEN pinned shortlist, not recency → exp-1 → confirm, no write.
    const ledB = makeLedger([clarFrom(ledA.appended[0].items[0], 'clar-A', '2026-08-20T00:00:00.000Z')]);
    const { useCase: ucB } = makeUseCase(makePrisma().prisma, { ...PC, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: realSub, substituteLedger: ledB.ledger, intakeRouteFn: () => SUB_ROUTE({ resolvedClarificationIds: ['clar-A'] }), aiGatewayFn: aiTurn });
    (ucB as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    (ucB as any).loadCorrectionCandidates = async () => [{ id: 'exp-2', label: 'ค่ากาแฟ · 65' }, { id: 'exp-1', label: 'ค่าวิน · 200' }];
    await ucB.execute({ ...BASE_EVENT, webhookEventId: 'evt-mc-b', messageText: '1' });
    assert.equal(saves.length, 0, 'the ordinal selection still confirms first (no write)');
    assert.deepEqual(ledB.appended[0].items[0].candidateExpenseIds, ['exp-1'], 'ordinal "1" binds to the FIRST pinned id (exp-1), never the shuffled recency head (exp-2)');

    // Turn C — affirmative resolves the start-confirm; the recency window is now EMPTY, so only the pinned
    // id can carry the target. Confirmed start → EXACTLY one workflow save, for exp-1.
    const ledC = makeLedger([clarFrom(ledB.appended[0].items[0], 'clar-B', '2026-08-20T00:01:00.000Z')]);
    const { useCase: ucC } = makeUseCase(makePrisma().prisma, { ...PC, config: { lineAiSubstituteSemanticRoutingMode: 'primary' }, substituteContinuation: realSub, substituteLedger: ledC.ledger, intakeRouteFn: () => SUB_ROUTE({ resolvedClarificationIds: ['clar-B'] }), aiGatewayFn: aiTurn });
    (ucC as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    (ucC as any).loadCorrectionCandidates = async () => [];
    await ucC.execute({ ...BASE_EVENT, webhookEventId: 'evt-mc-c', messageText: 'ใช่' });
    assert.equal(saves.length, 1, 'exactly ONE workflow save for the confirmed candidate');
    assert.equal(saves[0].expenseId, 'exp-1', 'the save targets the EXACT confirmed expense, never exp-2');
  });

  it('OFF/legacy end-to-end (REAL use case): ≥2 candidates → reply "1" SAVES exactly once, advances the selected target, and does not re-ask the shortlist', async () => {
    // Push-blocker regression: the OFF/legacy path opens on selection (as parent develop did). An ordinal
    // "1" that selects a legacy candidate is a real start and MUST persist — our reject-before-save gate
    // must not turn it into a consume-and-re-ask loop. requireStartConfirmation is NOT set here (legacy),
    // so `startConfirmed` is true and the fresh OPEN is written once.
    const PC = { permissions: ['line.ai.query', 'expense.review', 'expense.create'] };
    const saves: any[] = [];
    const store = new Map<string, any>();
    const mkExpense = (id: string) => ({
      id, companyId: 'company-1', branchId: 'branch-1', expenseNumber: id, status: 'NEEDS_REVIEW',
      sourceDocumentType: 'EXPENSE_NOTE_TEXT', currency: 'THB', grandTotalAmount: '200.0000',
      expenseCategoryId: 'cat-travel', accountHintKey: null, taxEvidenceStatus: 'SUPPORTING_ONLY',
      aiVerificationSummaryJson: null, missingReceiptReason: null, note: null, vendorNameSnapshot: null,
      paymentMethod: null, paidAt: null,
      sourceChannelMetadataJson: { channel: 'LINE', kind: 'text_note', chatKeyHash: 'chat-hash' },
      substituteReceiptEvidence: null,
      lines: [{ description: 'ค่าเดินทาง', expenseCategoryId: 'cat-travel', accountHintKey: null }],
      attachments: [], updatedAt: new Date('2026-08-16T09:00:00.000Z'),
    });
    store.set('exp-1', mkExpense('exp-1'));
    store.set('exp-2', mkExpense('exp-2'));
    const repo = {
      listLineSubstituteContinuationRows: async () => [...store.values()]
        .filter((e) => e.sourceChannelMetadataJson?.lineSubstituteReceiptContinuation)
        .map((e) => ({ id: e.id, updatedAt: e.updatedAt, sourceChannelMetadataJson: e.sourceChannelMetadataJson })),
      findByIdWithRelations: async (_c: string, id: string) => store.get(id) ?? null,
      listCategories: async () => [{ id: 'cat-travel', name: 'ค่าเดินทาง' }],
      getSubstituteReceiptPolicy: async () => null,
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'user-1', displayName: 'เจ้าของ' }],
      findActiveMemberIdentity: async (_c: string, userId: string) => userId === 'user-1' ? { userId, displayName: 'เจ้าของ' } : null,
      saveLineSubstituteContinuation: async (input: any) => {
        const cur = store.get(input.expenseId);
        const now = new Date(cur.updatedAt.getTime() + 1000);
        const continuation = { ...input.continuation, targetRevision: now.toISOString(), lastActivityAt: now.toISOString() };
        store.set(input.expenseId, { ...cur, updatedAt: now, sourceChannelMetadataJson: { ...cur.sourceChannelMetadataJson, lineSubstituteReceiptContinuation: continuation } });
        saves.push({ ...input, continuation });
        return { updatedAt: now, continuation };
      },
    } as any;
    const realSub = new LineSubstituteReceiptContinuationUseCase(repo, {} as any, { log: async () => undefined } as any, { getObject: async () => ({ bytes: Buffer.from([]), mimeType: 'application/pdf' }) } as any);
    const clarFrom = (item: any, id: string, at: string) => ({ id, text: item.text, question: item.clarifyQuestion, clarifyForIntent: item.clarifyForIntent, candidateExpenseIds: item.candidateExpenseIds, askedAt: at, entry: { id } });
    const candidates = async () => [{ id: 'exp-1', label: 'ค่าวิน · 200' }, { id: 'exp-2', label: 'ค่ากาแฟ · 65' }];

    // Turn 1 — a broad-match substitute request with TWO candidates → target-selection, no write.
    const led1 = makeLedger();
    const { useCase: uc1 } = makeUseCase(makePrisma().prisma, { ...PC, substituteContinuation: realSub, substituteLedger: led1.ledger, intakeRouteFn: READ_ROUTE, aiGatewayFn: aiTurn });
    (uc1 as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    (uc1 as any).loadCorrectionCandidates = candidates;
    await uc1.execute({ ...BASE_EVENT, webhookEventId: 'evt-legacy-a', messageText: 'ทำใบทดแทนของค่าใช้จ่าย' });
    assert.equal(saves.length, 0, 'target selection writes nothing');
    assert.equal(led1.appended[0]?.items[0]?.clarifyForIntent, 'SUBSTITUTE_RECEIPT_CONTINUATION', 'a shortlist clarification is opened');

    // Turn 2 — reply "1": the OFF/legacy path opens the selected candidate and SAVES exactly once (the fix).
    const led2 = makeLedger([clarFrom(led1.appended[0].items[0], 'clar-A', '2026-08-20T00:00:00.000Z')]);
    const { useCase: uc2 } = makeUseCase(makePrisma().prisma, { ...PC, substituteContinuation: realSub, substituteLedger: led2.ledger, intakeRouteFn: READ_ROUTE, aiGatewayFn: aiTurn });
    (uc2 as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    (uc2 as any).loadCorrectionCandidates = candidates;
    await uc2.execute({ ...BASE_EVENT, webhookEventId: 'evt-legacy-b', messageText: '1' });
    assert.equal(saves.length, 1, 'reply "1" opens the selected workflow EXACTLY once (no reject-before-save loop)');
    assert.equal(saves[0].expenseId, 'exp-1', 'it advances the exact selected target (candidate 1 → exp-1)');
    assert.equal(store.get('exp-1').sourceChannelMetadataJson.lineSubstituteReceiptContinuation.status, 'OPEN', 'the OPEN workflow is persisted');

    // Turn 3 — the taught resume phrase finds the now-OPEN workflow and continues IT; it is NOT re-asked as
    // a fresh shortlist, and exp-2 is never opened. (Continuing an existing OPEN workflow needs no new save.)
    const led3 = makeLedger([clarFrom(led2.appended[0].items[0], 'clar-B', '2026-08-20T00:01:00.000Z')]);
    const { useCase: uc3 } = makeUseCase(makePrisma().prisma, { ...PC, substituteContinuation: realSub, substituteLedger: led3.ledger, intakeRouteFn: READ_ROUTE, aiGatewayFn: aiTurn });
    (uc3 as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    (uc3 as any).loadCorrectionCandidates = candidates;
    await uc3.execute({ ...BASE_EVENT, webhookEventId: 'evt-legacy-c', messageText: 'ทำใบรับรองต่อ' });
    const openWorkflows = [...store.values()].filter((e) => e.sourceChannelMetadataJson?.lineSubstituteReceiptContinuation?.status === 'OPEN');
    assert.equal(openWorkflows.length, 1, 'still exactly one OPEN workflow — the "1" turn was not looped back into the shortlist');
    assert.equal(store.get('exp-2').sourceChannelMetadataJson.lineSubstituteReceiptContinuation, undefined, 'exp-2 was never opened');
    assert.equal(saves.length, 1, 'the resume continued the OPEN workflow without a redundant write');
  });
});

// ── Spec §10.1: a completed multi-part reply ends in the same Flex card as a single completed reply.
//    Behind LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED — default-off is the legacy all-text shape, proven
//    in line-intake-dispatch.use-case.spec.ts ("multi-part terminal Flex"). ──
describe('ProcessLineWebhookUseCase – completed multi-part replies end in a Flex card', () => {
  async function run(replyTexts: string[]) {
    const { prisma } = makePrisma();
    const delivered: any[][] = [];
    const draft = {
      routeContexts: async () => [{ status: 'OPEN', expenseId: 'draft-1' }],
      execute: async () => ({ handled: true, status: 'UPDATED', replyTexts, acceptedFields: [] }),
    };
    const { useCase } = makeUseCase(prisma, {
      permissions: ['line.ai.query', 'expense.create'],
      config: { lineExpenseDraftConversationEnabled: true, lineAiMultipartTerminalFlexEnabled: true },
      expenseDraftConversation: draft,
      sendReplyFn: async (_token: string, messages: any[]) => { delivered.push(messages); return 'ok'; },
    });
    await useCase.execute({ ...BASE_EVENT, webhookEventId: `evt-draft-parts-${replyTexts.length}`, messageText: 'D-PURPOSE ค่าเดินทางไปหาลูกค้า' });
    assert.equal(delivered.length, 1, 'one reply-token call carries every part');
    return delivered[0]!;
  }

  it('renders a single completed part as the Flex card with the completion menu, not plain text', async () => {
    const messages = await run(['บันทึกวัตถุประสงค์แล้วค่ะ']);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'flex');
    assert.match(JSON.stringify(messages[0].contents), /บันทึกวัตถุประสงค์แล้วค่ะ/);
    assert.ok(messages[0].quickReply?.items.length > 0, 'completion menu stays on the terminal card');
  });

  it('keeps earlier parts as lossless text and renders only the terminal part as the Flex card', async () => {
    const parts = ['ส่วนที่ 1\nรายละเอียดยาว', 'ส่วนที่ 2', 'สรุปร่างค่าใช้จ่าย'];
    const messages = await run(parts);
    assert.equal(messages.length, parts.length, 'part count is unchanged (≤ 5)');
    assert.deepEqual(
      messages.slice(0, -1).map((message: any) => [message.type, message.text, message.quickReply]),
      [['text', parts[0], undefined], ['text', parts[1], undefined]],
    );
    const terminal = messages[messages.length - 1];
    assert.equal(terminal.type, 'flex');
    assert.match(JSON.stringify(terminal.contents), /สรุปร่างค่าใช้จ่าย/);
    assert.ok(terminal.quickReply?.items.length > 0, 'completion menu stays on the terminal card only');
  });
});

describe('isAffirmativeText – bounded confirmation forms with a negative guard first', () => {
  it('accepts natural Thai/English affirmatives (incl. the broadened forms)', () => {
    for (const s of ['ใช่', 'ใช่ค่ะ', 'ใช่จ้า', 'ทำเลย', 'เริ่มเลย', 'ได้เลย', 'ตกลง', 'ยืนยัน', 'โอเค', 'ok', 'yes']) {
      assert.equal(isAffirmativeText(s), true, s);
    }
  });
  it('the negative guard runs first: any negation/cancel token vetoes', () => {
    for (const s of ['ไม่ใช่', 'ยังไม่เอา', 'ไม่ทำ', 'ไม่เอา', 'ยกเลิก', 'ไม่ใช่ค่ะ']) {
      assert.equal(isAffirmativeText(s), false, s);
    }
  });
  it('is anchored: a longer sentence merely CONTAINING an affirmative is not a bare confirmation', () => {
    for (const s of ['ใช่แต่ขอแก้ยอด', 'ทำใบทดแทนของค่าวิน', 'เอากาแฟแก้วนึง']) {
      assert.equal(isAffirmativeText(s), false, s);
    }
  });
});
