/**
 * Phase F — COMBINED regression for the LINE-AI remediation
 * (plan `line-ai-ledger-lifecycle-remediation-plan-th.md` §2 D2 last bullet + §3 "Combined" row).
 *
 * Phases A, B, C, D1 and E1a/b/c each have their own unit coverage. What none of them prove is that
 * the pieces hold TOGETHER on one turn: the ledger read, the money admission, the provider chain,
 * the receipt persistence, the usage ledger and the one reply the shop actually sees. Every `it`
 * below therefore asserts FIVE things from the SAME run:
 *
 *   1. the webhook event's terminal state and its terminal CLASS,
 *   2. what was persisted (expense draft / pending media / stored bytes — and HOW MANY),
 *   3. the usage events and the month + bucket aggregates,
 *   4. the reservation rows (status per invocation; no live hold left behind),
 *   5. the delivery (exactly one customer-visible reply, its typed copy, and no money figure).
 *
 * WHAT IS REAL HERE (the point of the file):
 *   - the real `ProcessLineWebhookUseCase`, driven through its two public entry points
 *     (`execute` for text, `executeReceiptUpload` for a picture);
 *   - the real `LineAiLedgerService` over the FAITHFUL `FakeRedis` of Phase A, which raises
 *     `NOGROUP` for an absent stream exactly as Redis does — not a stub ledger;
 *   - the real `AiGatewayClient`, the real `company-ai-usage-meter` admission and the real
 *     `company-ai-budget-reservation` engine over the SPLIT-capable in-memory client the gateway
 *     client's own spec uses (`company-ai-budget-prisma.fixture.ts`);
 *   - the real `company-ocr-governance` read-count admission, on the same client;
 *   - the real `InternalAiBudgetController` — so `budget-step` and `budget-settle` are the
 *     production seams, called in-process by the fake gateway instead of over HTTP.
 *
 * WHAT IS FAKED: `fetch`. One function stands in for the AI Gateway process and behaves the way
 * E1c made it behave — it reads `budgetEnvelope` off the body, wins its own invocation for every
 * call after the first through `budget-step`, posts each invocation's evidence to `budget-settle`,
 * and returns the usage rows stamped with their own `invocationKey`. Plus the usual tenant/expense
 * repository doubles, modelled on `process-line-webhook.use-case.spec.ts` and
 * `line-intake-dispatch.use-case.spec.ts`; the byte transfer and the LINE media download are the
 * same two methods every spec in this module patches.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AI_BUDGET_REFUSAL_CODES, AI_BUDGET_STEP_BOUNDS } from '@watchdog-bms/contracts';
import { lineMessagingCredentialsFixture } from '../../../../common/config/line-messaging-credentials.fixture';
import { ProcessLineWebhookUseCase, chatKeyHashOf } from './process-line-webhook.use-case';
import { LineAiLedgerService, ledgerKey } from '../line-ai-ledger.service';
import { AiGatewayClient } from '../../infrastructure/ai-gateway.client';
import { LineAiBudgetAuthorityService } from '../line-ai-budget-authority.service';
import { InternalAiBudgetController } from '../../presentation/http/internal-ai-budget.controller';
import { FakeRedis } from '../line-ai-ledger-redis.fixture';
import { splitPrisma, SPLIT_FIXTURE_MODEL_ID } from '../company-ai-budget-prisma.fixture';
import { __resetCompanyAiBudgetCache } from '../company-ai-usage-meter';
import { aiBudgetAttemptHash } from '../company-ai-budget-reservation';

const COMPANY = 'company-1';
const MODEL = SPLIT_FIXTURE_MODEL_ID;
const SECRET = 'workload-secret';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
/** Everything the image lane needs; the entry gate takes the first two, downstream also `expense.create`. */
const CAPTURE_PERMISSIONS = [
  'line.ai.query', 'expense.receipt.line_upload', 'expense.receipt.upload',
  'expense.create', 'expense.ocr.request', 'attachment.create',
];

/**
 * 10,000 input + 500 output tokens on this Haiku model at FX 33 is 10 satang:
 * (10000 × 0.25 + 500 × 1.25) × 33 × 100 / 1e6 = 10.3125 → 10 (half up). Small enough to sit well
 * inside every declared bound (the smallest here is `line-intake-text` at 26 satang), large enough
 * that a bucket aggregate visibly moves — a 1-token row would round to 0 and prove nothing.
 */
const CALL_TOKENS = { inputTokens: 10_000, outputTokens: 500, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
const COST_PER_CALL = 10;

const TEXT_EVENT = Object.freeze({
  webhookEventId: 'evt-text', lineUserId: 'line-user-secret', replyToken: 'reply-text',
  messageText: 'ยอดขายวันนี้เท่าไหร่', messagingChannelId: 'msg-channel-1',
});
const IMAGE_EVENT = Object.freeze({
  webhookEventId: 'evt-image', lineUserId: 'line-user-secret', replyToken: 'reply-image',
  lineMessageId: 'line-msg-1', messageType: 'image' as const, messagingChannelId: 'msg-channel-1',
});

// ── doubles ──────────────────────────────────────────────────────────────────

/**
 * The OCR READ-COUNT store. Deliberately SHARED between the tenant client and the money client:
 * `admitCompanyOcr` runs inside `AiGatewayClient` (money client) while the webhook's own `finally`
 * compensation calls `releaseCompanyOcrAdmission` on ITS prisma — in production both are the same
 * `PrismaService`, and a test with two separate stores could never see a refund land.
 */
function ocrGovernanceDelegates() {
  const readEvents: any[] = [];
  const monthly = new Map<string, { usedCount: number }>();
  let seq = 0;
  return {
    readEvents,
    monthly,
    delegates: {
      companyOcrUsageEvent: {
        findUnique: async ({ where }: any) => {
          const key = where.companyId_sourceRoute_requestId;
          return readEvents.find((row) => row.companyId === key.companyId
            && row.sourceRoute === key.sourceRoute && row.requestId === key.requestId) ?? null;
        },
        count: async ({ where }: any) => readEvents.filter((row) => row.companyId === where.companyId
          && (where.monthKey === undefined || row.monthKey === where.monthKey)).length,
        create: async ({ data }: any) => {
          const row = { id: `ocr-read-${++seq}`, createdAt: new Date(), billingReceiptGrantId: null, ...data };
          readEvents.push(row);
          return { id: row.id };
        },
        update: async ({ where, data }: any) => {
          const row = readEvents.find((candidate) => candidate.id === where.id);
          Object.assign(row, data);
          return { id: row.id };
        },
        delete: async ({ where }: any) => {
          const index = readEvents.findIndex((row) => row.id === where.id);
          if (index >= 0) readEvents.splice(index, 1);
          return {};
        },
      },
      companyOcrMonthlyUsage: {
        findUnique: async ({ where }: any) => monthly.get(where.companyId_monthKey.monthKey) ?? null,
        findUniqueOrThrow: async ({ where }: any) => {
          const row = monthly.get(where.companyId_monthKey.monthKey);
          if (!row) throw new Error('OCR_MONTH_ROW_MISSING');
          return row;
        },
        upsert: async ({ where }: any) => {
          const key = where.companyId_monthKey.monthKey;
          const row = monthly.get(key) ?? { usedCount: 0 };
          row.usedCount += 1;
          monthly.set(key, row);
          return { usedCount: row.usedCount };
        },
        updateMany: async ({ where }: any) => {
          const row = monthly.get(where.monthKey);
          if (!row || row.usedCount <= 0) return { count: 0 };
          row.usedCount -= 1;
          return { count: 1 };
        },
      },
      // Absent plan term = grandfathered unlimited (P29 rule 7), so the plan ceiling never fires.
      companyPlanTerm: { findUnique: async () => null, updateMany: async () => ({ count: 0 }) },
      company: { findUnique: async () => ({ status: 'ACTIVE' }) },
      billingReceiptGrant: { findUnique: async () => null, findMany: async () => [] },
      auditLog: { findFirst: async () => null, create: async () => ({}) },
      // Only the duplicate-replay branch reads these, and a just-created read event short-circuits
      // before it. Present so a shape change fails loudly instead of throwing inside a try/catch.
      expenseRecord: { findFirst: async () => null },
      lineWebhookEventLog: {
        findUnique: async () => null, findFirst: async () => null, updateMany: async () => ({ count: 0 }),
      },
    },
  };
}

/** Tenant-side prisma: identity, membership, the webhook event log and the pending-media store. */
function tenantPrisma(ocr: ReturnType<typeof ocrGovernanceDelegates>, aiConfiguration: unknown) {
  const eventLog = new Map<string, any>();
  const pendingMedia: any[] = [];
  const expenseUpdates: any[] = [];
  const aiTurns: any[] = [];
  const client: any = {
    // The OCR read-count tables first, so the tenant-authoritative delegates below win where the
    // two overlap (`expenseRecord`, `lineWebhookEventLog`).
    ...ocr.delegates,
    $executeRaw: async () => 0,
    // The real transaction is the whole client, like `line-intake-dispatch.use-case.spec.ts` does:
    // consumption markers, OCR compensation and the expense writes all run through it.
    $transaction: async (work: (tx: any) => Promise<unknown>) => work(client),
    outboxEvent: { create: async (args: any) => args.data, findMany: async () => [], findFirst: async () => null },
    // No application travelling, no human waiting, no support pause in these fixtures.
    companySignupRequest: { findFirst: async () => null },
    lineSupportRequest: { findFirst: async () => null },
    // STATEFUL on purpose: `claimWebhookEvent` refuses to re-run an event whose row already left
    // `received`, which is the production answer to a redelivered webhook (scenario 7).
    lineWebhookEventLog: {
      findUnique: async ({ where }: any) => eventLog.get(where.webhookEventId) ?? null,
      findFirst: async () => null,
      create: async ({ data }: any) => { eventLog.set(data.webhookEventId, { errorCode: null, companyId: null, ...data }); return data; },
      updateMany: async ({ where, data }: any) => {
        const row = eventLog.get(where.webhookEventId);
        if (!row) return { count: 0 };
        if (where.status !== undefined) {
          if (typeof where.status === 'string' ? row.status !== where.status : row.status === where.status.not) return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    lineTurnOutcome: {
      upsert: async ({ create }: any) => create,
      findUnique: async () => null,
      updateMany: async () => ({ count: 1 }),
    },
    externalIdentity: {
      findFirst: async ({ where }: any) => (where?.providerChannelId && where.providerChannelId !== 'msg-channel-1'
        ? null
        : { status: 'ACTIVE', userId: 'user-1', user: { status: 'ACTIVE', displayName: 'พิม', aiAssistantOptOutAt: null } }),
    },
    companyMembership: {
      findMany: async () => [{ companyId: COMPANY, company: { name: 'ร้านทดสอบ', brandName: null }, roles: [{ role: { key: 'OWNER' } }] }],
      findFirst: async () => null,
      findUnique: async () => null,
    },
    lineCompanyContext: { findUnique: async () => null, upsert: async (args: any) => args, updateMany: async () => ({ count: 0 }) },
    // No rows = legacy fail-open, so every entitlement gate (including `ai_line_assistant`) passes.
    companyFeatureEntitlement: { findMany: async () => [] },
    branch: { findMany: async () => [], findFirst: async () => null },
    attachmentLink: { findFirst: async () => null, findMany: async () => [] },
    attachmentObject: { findFirst: async ({ where }: any) => ({ id: where?.id, checksumSha256: 'hash' }) },
    aiConversation: { upsert: async ({ where }: any) => ({ id: where.id }) },
    aiTurn: {
      findMany: async () => [],
      create: async ({ data }: any) => { aiTurns.push(data); return { id: `turn-${aiTurns.length}` }; },
      update: async (args: any) => args,
    },
    aiToolInvocation: { createMany: async (args: any) => ({ count: args.data.length }) },
    lineIntakePendingMedia: {
      findUnique: async ({ where }: any) => {
        const { companyId, lineMessageId } = where.companyId_lineMessageId;
        return pendingMedia.find((row) => row.companyId === companyId && row.lineMessageId === lineMessageId) ?? null;
      },
      findFirst: async ({ where }: any) => pendingMedia.find((row) => row.companyId === where.companyId
        && row.userId === where.userId && row.status === where.status
        && (!where.expiresAt || row.expiresAt > where.expiresAt.gt)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `pending-${pendingMedia.length + 1}`, createdAt: new Date(), ...data };
        pendingMedia.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = pendingMedia.find((candidate) => candidate.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
      updateMany: async () => ({ count: 1 }),
    },
    expenseRecord: { findFirst: async () => null, update: async (args: any) => { expenseUpdates.push(args); return args; } },
    // The webhook resolves the tenant's approved model through ITS OWN prisma before building the
    // turn request, so the same configuration row has to be readable here — in production it is
    // one database. Without it a SPLIT turn reserves with an empty model and is refused
    // `model_unknown` (ADR 0013 §11.3).
    companyAiConfiguration: { findUnique: async () => aiConfiguration },
  };
  return { prisma: { client } as any, eventLog, pendingMedia, expenseUpdates, aiTurns };
}

/** A receipt classification `isExpenseExtractionEligible` accepts for the given total. */
function receiptClassification(amount: string) {
  return {
    contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.97, evidenceSignals: ['ใบเสร็จ'], amountSignals: [`รวม ${amount}`],
    settlementSignals: ['ชำระแล้ว'], missingRequiredSignals: [], contradictionSignals: [],
    requiresClarification: false,
  };
}

const ROUTED_CAPTURE = { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 } as const;
const ROUTED_READ = { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.92 } as const;
const TURN_ANSWER = {
  requestId: 'gw-turn', replyText: 'ยอดขายวันนี้ 1,200 บาทค่ะ', sourceRefs: [], sourceLabels: [], webLinks: [],
  intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: [], durationMs: 1,
};

// ── the harness ──────────────────────────────────────────────────────────────

type GatewayHandler = (body: any, chain: ProviderChain) => Promise<unknown> | unknown;

/** What the fake gateway can do with the envelope it received — the E1c rules, in-process. */
type ProviderChain = {
  /** Runs `count` provider calls: call 0 on the envelope's invocation, call n>=1 after winning its
   *  own `budget-step`, and posts every invocation's evidence to `budget-settle`. */
  run: (envelope: any, count: number, tag: string) => Promise<{ usage: any[]; refusal?: { errorCode: string; budgetScope?: string } }>;
};

function makeHarness(opts: {
  policy: { total: number; chat: number; ocr: number; spentChat?: number; spentOcr?: number };
  permissions?: string[];
  intake?: GatewayHandler;
  turn?: GatewayHandler;
  receipt?: GatewayHandler;
  /** SHARED keeps the legacy bounded-overshoot path — no reservations at all. */
  shared?: boolean;
}) {
  const ocr = ocrGovernanceDelegates();
  const money = splitPrisma(opts.policy, ocr.delegates);
  const sharedConfigRow = {
    modelId: MODEL, monthlyBudgetSatang: opts.policy.total, budgetMode: 'SHARED',
    chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: null,
    budgetConfigVersion: 0, pendingBudgetPolicy: null,
  };
  // Same delegate object the transaction sees, so both sides resolve the same policy.
  if (opts.shared) money.prisma.client.companyAiConfiguration.findUnique = async () => sharedConfigRow;
  // The tenant side only ever reads `modelId` off this row (`resolveCompanyAiModelPolicy`).
  const tenant = tenantPrisma(ocr, { modelId: MODEL });

  const config = {
    webBaseUrl: 'https://app.example.com',
    publicApiBaseUrl: 'https://api.example.com',
    lineMessagingChannelAccessToken: 'line-token',
    aiGatewayInternalUrl: 'http://ai-gateway.test/v1',
    aiGatewayInternalSecret: SECRET,
    aiThbPerUsd: 33,
    aiMonthlyBudgetSatang: opts.policy.total,
    approvedAiModelIds: [MODEL],
    // The in-process admission lease refuses outright when this is true (it is not a real lease).
    isProduction: false,
    receiptQuotaEnforced: false,
    uploadMaxBytes: 5_000_000,
    lineAiLedgerEnabled: true,
    redisUrl: 'redis://fake',
    lineAiLedgerMaxLen: 200,
    lineAiLedgerTtlSeconds: 3600,
    lineAiLedgerClaimMinIdleMs: 1000,
    lineAiLedgerDeliveryCap: 3,
  } as any;

  const budgetSeam = new InternalAiBudgetController(config, money.prisma);
  const chain: ProviderChain = {
    run: async (envelope: any, count: number, tag: string) => {
      const usage: any[] = [];
      for (let index = 0; index < count; index += 1) {
        let invocationKey = envelope.invocationKey;
        if (index > 0) {
          const step: any = await budgetSeam.budgetStep(SECRET, {
            companyId: COMPANY, attemptKey: envelope.attemptKey, stepKind: envelope.stepKind,
            ordinal: index, monthKey: envelope.monthKey,
          });
          if (!step.ok) return { usage, refusal: { errorCode: step.code, budgetScope: step.budgetScope } };
          invocationKey = step.envelope.invocationKey;
        }
        const entry = { modelId: envelope.modelId, tag, ok: true, ...CALL_TOKENS, usageBasis: 'PROVIDER_REPORTED' };
        // Evidence first, from the gateway itself — exactly what E1c does in its `finally`, so a
        // lost outer response can no longer turn real provider cost into zero.
        await budgetSeam.budgetSettle(SECRET, { invocationKey, sourceRoute: envelope.stepKind, usage: entry as any });
        usage.push({ ...entry, invocationKey });
      }
      return { usage };
    },
  };

  const calls: Array<{ path: string; body: any }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const path = String(url).replace(config.aiGatewayInternalUrl, '');
    const body = JSON.parse(String(init.body));
    calls.push({ path, body });
    const handler = path === '/internal/ai/line-intake-route' ? opts.intake
      : path === '/internal/ai/line-turn' ? opts.turn
      : path === '/internal/ai/receipt-ocr' ? opts.receipt
      : undefined;
    if (!handler) throw new Error(`unexpected AI Gateway path ${path}`);
    const result = await handler(body, chain);
    return { ok: true, status: 200, json: async () => result } as Response;
  }) as typeof fetch;

  const gateway = new AiGatewayClient(config, { issue: () => 'signed' } as any, undefined, money.prisma,
    new LineAiBudgetAuthorityService(money.prisma, config));
  const redis = new FakeRedis();
  const ledger = new LineAiLedgerService(config, { log: async () => undefined } as any, tenant.prisma);
  ledger.attachClient(redis);

  const replies: unknown[][] = [];
  const initCalls: any[] = [];
  const completeCalls: any[] = [];
  const uploadIntents: any[] = [];
  const attachmentCompletions: any[] = [];
  const byteUploads: any[] = [];
  const applied: any[] = [];
  const capturedExpenses = new Map<string, any>();
  const expenseRepo = {
    listCategories: async () => [{ id: 'cat-meals', name: 'ค่าอาหาร' }],
    findByLineMessageId: async (_companyId: string, lineMessageId: string) =>
      [...capturedExpenses.values()].find((row) => row.lineMessageId === lineMessageId) ?? null,
    findExpenseIdsByAttachmentChecksum: async () => [],
    findById: async (_companyId: string, id: string) => capturedExpenses.get(id) ?? null,
    findByIdWithRelations: async (_companyId: string, id: string) => capturedExpenses.get(id) ?? null,
    resolveCreateBranchId: async () => 'branch-1',
    findActiveAttachmentObject: async (_companyId: string, id: string) => ({ id, checksumSha256: 'hash' }),
    listRecentLineCaptures: async () => [],
    listLineSubstituteContinuationRows: async () => [],
    recordDeliveredLineReceiptContinuation: async () => undefined,
    findNearDuplicates: async () => [],
    runDuplicateCheck: async () => ({ openCandidates: 0, duplicateStatus: 'NO_MATCH' }),
    createDuplicateCandidate: async () => undefined,
    createExpense: async (input: any) => ({ id: 'expense-note-1', ...input }),
    linkAttachment: async () => undefined,
    updateExpense: async (input: any) => ({ id: input.id, ...input }),
  } as any;

  const useCase = new ProcessLineWebhookUseCase(
    lineMessagingCredentialsFixture(config),
    tenant.prisma,
    config,
    { resolveAccess: async () => ({ membershipId: 'mem-1', roles: ['OWNER'], permissions: opts.permissions ?? CAPTURE_PERMISSIONS, scopes: {} }) } as any,
    { log: async () => undefined } as any,
    gateway,
    {
      buildTextMessage: (text: string) => ({ type: 'text', text }),
      sendReply: async (_token: string, messages: unknown[]) => { replies.push(messages); return 'ok'; },
      sendPush: async (_to: string, messages: unknown[]) => { replies.push(messages); return 'ok'; },
    } as any,
    {
      apply: async (_ctx: any, expenseId: string, fields: any) => {
        applied.push({ expenseId, fields });
        const row = capturedExpenses.get(expenseId);
        if (row) Object.assign(row, { grandTotalAmount: fields?.grandTotalAmount ?? '0', updatedAt: new Date(row.updatedAt.getTime() + 1) });
        return { candidatesCreated: 0, committedUpdatedAt: capturedExpenses.get(expenseId)?.updatedAt };
      },
    } as any,
    { assertClean: async () => undefined } as any,
    { isRequired: async () => false } as any,
    { startSweep: () => ({ record: async () => ({ wouldBlock: false, reason: 'available' as const }), flush: async () => ({}) }) } as any,
    { assertLaunchRouteOpen: async () => undefined } as any,
    // initReceiptUpload — the expense DRAFT. One row per successful direct capture.
    {
      execute: async (ctx: any, cmd: any) => {
        initCalls.push(cmd);
        const row = {
          id: `expense-${initCalls.length}`, companyId: ctx.companyId, createdByUserId: ctx.userId,
          branchId: 'branch-1', captureSource: 'LINE_UPLOAD', status: 'DRAFT',
          primaryAttachmentId: `att-${initCalls.length}`, lineMessageId: cmd.lineCapture?.lineMessageId,
          expenseDate: new Date('2026-09-18'), updatedAt: new Date('2026-09-18T00:00:00Z'),
          grandTotalAmount: '0', vatAmount: '0', whtAmount: '0', netPayableAmount: '0', discountAmount: '0',
          vatMode: 'NO_VAT', sourceDocumentType: 'NEEDS_REVIEW', lines: [], attachments: [], charges: [],
          sourceChannelMetadataJson: { chatKeyHash: cmd.lineCapture?.chatKeyHash },
        };
        capturedExpenses.set(row.id, row);
        return { expenseId: row.id, attachmentId: row.primaryAttachmentId, uploadUrl: '/u', uploadMethod: 'PUT', expiresAt: new Date() };
      },
    } as any,
    { execute: async (_ctx: any, cmd: any) => { completeCalls.push(cmd); return capturedExpenses.get(cmd.expenseId); } } as any,
    undefined, // captureExpenseNote
    undefined, // initSignatureUpload
    undefined, // createSignatureAsset
    expenseRepo,
    ledger,
    // createUploadIntent / completeAttachmentUpload — the PENDING-MEDIA byte persistence.
    { execute: async (_ctx: any, cmd: any) => { uploadIntents.push(cmd); return { attachmentId: `pending-att-${uploadIntents.length}`, uploadUrl: '/u', uploadMethod: 'PUT', expiresAt: new Date() }; } } as any,
    { execute: async (_ctx: any, cmd: any) => { attachmentCompletions.push(cmd); return { id: cmd.attachmentId }; } } as any,
  );
  (useCase as any).readEvidence = { forTurn: async () => [], verify: async () => true, verifyDelivery: async () => false };
  (useCase as any).downloadLineMedia = async () => ({ ok: true, media: ({
    fileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: JPEG.byteLength,
    checksumSha256: 'receipt-checksum', contentBase64: JPEG.toString('base64'), bytes: JPEG,
  }) });
  (useCase as any).uploadLineMedia = async (intent: any) => { byteUploads.push(intent); };
  // `budgetScope` and `mediaState` are TELEMETRY, not columns: the only place they are observable
  // is the `line.ai.terminal` log line (`emitLineAiTerminalOutcome`).
  const logs: any[] = [];
  (useCase as any).logger = {
    log: (payload: any) => logs.push(payload),
    warn: (payload: any) => logs.push(payload),
    error: (payload: any) => logs.push(payload),
    debug: () => undefined,
  };

  const restore = () => { globalThis.fetch = originalFetch; };
  return {
    useCase, ledger, redis, money, tenant, ocr, gateway, config, calls, replies, logs, restore,
    initCalls, completeCalls, uploadIntents, attachmentCompletions, byteUploads, applied, capturedExpenses,
    /** The `line.ai.terminal` line for one event: status, class, errorCode, budgetScope, mediaState. */
    terminal: (webhookEventId: string) => logs.find((entry) => entry?.msg === 'line.ai.terminal' && entry.webhookEventId === webhookEventId),
    holds: () => [...money.reservations.values()],
    usage: () => [...money.events.values()],
    bucket: (name: 'CHAT' | 'OCR') => money.buckets.get(name)?.costSatang ?? 0,
  };
}

/** One usage row for a call made with NO envelope (a SHARED company), metered the legacy way. */
function plainUsage(tag: string) {
  return { usage: [{ modelId: MODEL, tag, ok: true, ...CALL_TOKENS, usageBasis: 'PROVIDER_REPORTED' }] };
}

/** The call index inside an attempt, read back off the fence the engine built. */
function ordinalOf(hold: { invocationKey: string }): number {
  return Number(hold.invocationKey.split('#').at(-1));
}

/** The ledger key for a LINE chat: `chatKey` is the push target or the LINE user id. */
const CHAT_LEDGER_KEY = ledgerKey(COMPANY, TEXT_EVENT.lineUserId);

/** Every reply the shop can see, flattened — a Flex card's copy lives in `altText`/`contents`. */
function customerReplies(replies: unknown[][]): string[] {
  return replies.map((batch) => JSON.stringify(batch));
}

/** Spec §9.1: a refusal explains the policy, never the balance. */
function assertNoMoneyFigure(rendered: string): void {
  assert.equal(/\d[\d,]*\s*(บาท|satang|สตางค์)/.test(rendered), false, `a refusal must carry no money figure: ${rendered}`);
}

describe('LINE AI combined regression: ledger + split budget + receipt persistence (plan D2)', () => {
  beforeEach(__resetCompanyAiBudgetCache);

  it('1. a direct text message on a brand-new chat is admitted, answered and metered', async () => {
    const h = makeHarness({
      shared: true,
      policy: { total: 1_000_000, chat: 0, ocr: 0 },
      intake: () => ({ ...ROUTED_READ, ...plainUsage('line.intake-route') }),
      turn: () => ({ ...TURN_ANSWER, ...plainUsage('line.loop') }),
    });
    try {
      // The stream does not exist: `XPENDING` raises NOGROUP, exactly as Redis does.
      assert.equal(h.redis.streams.size, 0);
      await h.useCase.execute({ ...TEXT_EVENT });
    } finally { h.restore(); }

    // (1) terminal state + class
    const terminal = h.terminal('evt-text');
    assert.equal(terminal?.status, 'completed');
    assert.equal(terminal?.terminalClass, 'delivered');
    assert.notEqual(terminal?.status, 'marker_unavailable');
    // The absence was CONFIRMED on the exact key and nothing was repaired on the read path.
    assert.deepEqual(h.redis.calls.slice(0, 2), ['xpending', 'exists']);
    // The turn's own durable ledger entry was appended after the read and acked after delivery
    // (consume-on-append means an empty PEL is exactly "nothing left for the reclaim drain").
    assert.equal(h.redis.streams.get(CHAT_LEDGER_KEY)?.length ?? 0, 1);
    assert.equal(h.redis.pels.get(CHAT_LEDGER_KEY)?.size, 0, 'the answered turn is acked');

    // (2) nothing was persisted — a read question creates no document
    assert.equal(h.initCalls.length, 0);
    assert.equal(h.tenant.pendingMedia.length, 0);
    assert.equal(h.uploadIntents.length, 0);

    // (3) usage: both provider calls of a text turn (intake route + turn) are metered
    assert.deepEqual(h.calls.map((call) => call.path), ['/internal/ai/line-intake-route', '/internal/ai/line-turn']);
    assert.equal(h.usage().length, 2);
    assert.equal(h.money.monthUsage.costSatang, 2 * COST_PER_CALL);
    // D1 keeps the bucket slice for SHARED rows as well, so a later SPLIT activation reads one aggregate.
    assert.equal(h.bucket('CHAT'), 2 * COST_PER_CALL);
    assert.equal(h.bucket('OCR'), 0);

    // (4) a SHARED company holds nothing: the legacy path has no reservation rows at all
    assert.deepEqual(h.holds(), []);
    assert.equal(JSON.stringify(h.calls[0].body).includes('budgetEnvelope'), false);

    // (5) exactly one customer-visible reply, carrying the answer
    assert.equal(h.replies.length, 1);
    assert.match(customerReplies(h.replies)[0], /ยอดขายวันนี้ 1,200/);
  });

  it('2. SPLIT with CHAT exhausted: the chat turn is refused by scope while the receipt still reads', async () => {
    const h = makeHarness({
      // CHAT is spent to its cap; OCR is untouched and can fund the whole receipt chain.
      policy: { total: 100_000, chat: 100, ocr: 5_000, spentChat: 100 },
      intake: async (body, chain) => body.attachments?.length
        ? { ...ROUTED_CAPTURE, documentText: 'ใบเสร็จ ร้านกาแฟ รวม 120.00', ...(await chain.run(body.budgetEnvelope, 1, 'line.intake-route')) }
        : { ...ROUTED_READ },
      turn: () => ({ ...TURN_ANSWER }),
      // read → extract: TWO invocations of the one `receipt-ocr` chain.
      receipt: async (body, chain) => ({
        status: 'ok', classification: receiptClassification('120.00'),
        fields: { vendorName: 'ร้านกาแฟ', documentNumber: 'R-1', grandTotalAmount: '120.00', confidence: 0.97 },
        ...(await chain.run(body.budgetEnvelope, 2, 'ocr.receipt.extract')),
      }),
    });
    try {
      await h.useCase.execute({ ...TEXT_EVENT });
      // ── phase A: the text turn ────────────────────────────────────────────
      const text = h.terminal('evt-text');
      assert.equal(text?.status, 'ai_budget_exceeded');                       // (1)
      assert.equal(text?.errorCode, AI_BUDGET_REFUSAL_CODES.exceeded);
      assert.equal(text?.budgetScope, 'CHAT');
      assert.equal(text?.terminalClass, 'budget_refusal');
      assert.equal(h.initCalls.length + h.tenant.pendingMedia.length, 0);      // (2)
      assert.equal(h.calls.length, 0, 'zero provider calls on a money refusal'); // (3)
      assert.deepEqual(h.usage(), []);
      assert.deepEqual(h.holds(), [], 'refused before a hold was inserted');  // (4)
      assert.equal(h.redis.streams.get(CHAT_LEDGER_KEY)?.length ?? 0, 0, 'no turn entry for a closed gate');
      assert.equal(h.replies.length, 1);                                      // (5)
      const card = customerReplies(h.replies)[0];
      assert.match(card, /เครดิต AI ส่วนแชตเดือนนี้หมดแล้ว/);
      assert.match(card, /ไม่เติมเครดิตแชตในเดือนนี้/);
      assert.match(card, /ติดต่อเจ้าหน้าที่/);
      assert.doesNotMatch(card, /ดูแพ็กเกจ|ขอเปลี่ยนแพ็กเกจ/);
      assertNoMoneyFigure(card);

      // ── phase B: the same user sends a receipt picture ────────────────────
      await h.useCase.executeReceiptUpload({ ...IMAGE_EVENT });
    } finally { h.restore(); }

    const image = h.terminal('evt-image');
    assert.equal(image?.status, 'completed');                                  // (1)
    assert.equal(image?.terminalClass, 'delivered');

    assert.equal(h.initCalls.length, 1, 'exactly one expense draft');          // (2)
    assert.equal(h.completeCalls.length, 1);
    assert.equal(h.byteUploads.length, 1);
    assert.equal(h.tenant.pendingMedia.length, 0, 'a successful read parks nothing');
    assert.equal(h.applied.length, 1, 'the read fields were applied to that draft');
    assert.ok(h.tenant.expenseUpdates.length >= 1, 'and the draft row itself was written');

    // (3) two metered invocations: the receipt read and extract. A caption-less photo is not routed
    // (UAT 2026-09-29), so there is no image intake call to pay for.
    assert.deepEqual(h.calls.map((call) => call.path), ['/internal/ai/receipt-ocr']);
    assert.equal(h.usage().length, 2);
    assert.equal(h.bucket('OCR'), 2 * COST_PER_CALL, 'the OCR bucket moved by what the chain cost');
    assert.equal(h.bucket('CHAT'), 100, 'the CHAT aggregate is untouched by a document read');
    assert.equal(h.money.monthUsage.costSatang, 100 + 2 * COST_PER_CALL);

    // (4) every hold settled; nothing live is left behind
    const holds = h.holds();
    assert.deepEqual(holds.map((hold) => hold.stepKind).sort(), ['receipt-ocr', 'receipt-ocr']);
    assert.deepEqual([...new Set(holds.map((hold) => hold.status))], ['SETTLED']);
    assert.deepEqual([...new Set(holds.map((hold) => hold.bucket))], ['OCR']);
    // The chain's second call won its own invocation through the real `budget-step` seam.
    assert.deepEqual(holds.filter((hold) => hold.stepKind === 'receipt-ocr').map(ordinalOf).sort(), [0, 1]);
    // One document read was counted, once, and NOT compensated (the result was usable).
    assert.equal(h.ocr.readEvents.length, 1);
    assert.deepEqual([...h.ocr.monthly.values()].map((row) => row.usedCount), [1]);

    // (5) one reply for the picture, naming the captured draft and no money figure
    assert.equal(h.replies.length, 2, 'one reply per turn');
    assert.match(customerReplies(h.replies)[1], /expense-1/);
  });

  it('3. SPLIT with OCR exhausted: the picture is kept unread and chat still works', async () => {
    const h = makeHarness({
      policy: { total: 100_000, chat: 5_000, ocr: 100, spentOcr: 100 },
      intake: async (body, chain) => body.attachments?.length
        ? { ...ROUTED_CAPTURE, ...(await chain.run(body.budgetEnvelope, 1, 'line.intake-route')) }
        : { ...ROUTED_READ, ...(await chain.run(body.budgetEnvelope, 1, 'line.intake-route')) },
      turn: async (body, chain) => ({ ...TURN_ANSWER, ...(await chain.run(body.budgetEnvelope, 1, 'line.loop')) }),
      receipt: () => { throw new Error('the OCR hop must never be reached with the OCR bucket closed'); },
    });
    try {
      await h.useCase.executeReceiptUpload({ ...IMAGE_EVENT });
      assertOcrExhaustedPicture(h);
      // ── and a text turn in the same month still runs on the CHAT bucket ───
      await h.useCase.execute({ ...TEXT_EVENT });
    } finally { h.restore(); }

    const text = h.terminal('evt-text');
    assert.equal(text?.status, 'completed');
    assert.equal(text?.terminalClass, 'delivered');
    assert.deepEqual(h.calls.map((call) => call.path), ['/internal/ai/line-intake-route', '/internal/ai/line-turn']);
    assert.equal(h.bucket('CHAT'), 2 * COST_PER_CALL, 'CHAT paid for the chat turn');
    assert.equal(h.bucket('OCR'), 100, 'and the closed OCR bucket did not move');
    assert.deepEqual([...new Set(h.holds().map((hold) => hold.status))], ['SETTLED']);
    assert.deepEqual(h.holds().map((hold) => hold.stepKind).sort(), ['line-intake-text', 'line-turn']);
    assert.equal(h.replies.length, 2);
    assert.match(customerReplies(h.replies)[1], /ยอดขายวันนี้ 1,200/);
  });

  /** The five assertions for the refused picture of scenario 3, checked before the chat half runs. */
  function assertOcrExhaustedPicture(h: ReturnType<typeof makeHarness>): void {
    const image = h.terminal('evt-image');
    assert.equal(image?.status, 'clarification_required');                     // (1)
    assert.equal(image?.errorCode, AI_BUDGET_REFUSAL_CODES.exceeded);
    assert.equal(image?.budgetScope, 'OCR');
    assert.equal(image?.mediaState, 'retained');
    assert.equal(image?.terminalClass, 'clarification');

    // (2) Phase B's fallback: the BYTES are persisted and parked, but no expense exists
    assert.equal(h.tenant.pendingMedia.length, 1);
    assert.equal(h.uploadIntents.length, 1);
    assert.equal(h.attachmentCompletions.length, 1);
    assert.equal(h.byteUploads.length, 1);
    assert.equal(h.initCalls.length, 0, 'no expense draft is created without a read');

    assert.equal(h.calls.length, 0, 'zero provider calls');                    // (3)
    assert.deepEqual(h.usage(), []);
    assert.equal(h.bucket('CHAT'), 0);

    assert.deepEqual(h.holds(), []);                                           // (4)
    assert.equal(h.ocr.readEvents.length, 0, 'no OCR read count is consumed by a money refusal');
    assert.equal(h.ocr.monthly.size, 0, 'the read was never even ADMITTED — money is reserved first (R-05)');

    const parked = customerReplies(h.replies)[0];                              // (5)
    assert.equal(h.replies.length, 1);
    assert.match(parked, /รับรูปไว้แล้วค่ะ/);
    assert.match(parked, /เครดิตสำหรับการอ่านเอกสารไม่พอ/);
    assert.match(parked, /ยังไม่ได้บันทึกรายการค่าใช้จ่าย/);
    assertNoMoneyFigure(parked);
    // The turn itself is durable, marked refused, so the next message has the same context.
    assert.equal(h.tenant.aiTurns.length, 1);
  }

  it('4. SPLIT with the TOTAL exhausted: both lanes refuse with TOTAL scope and nothing is spent', async () => {
    const h = makeHarness({
      // spent 120 + 80 = 200 = the total, while each bucket still looks partly open.
      policy: { total: 200, chat: 100, ocr: 100, spentChat: 120, spentOcr: 80 },
      intake: () => { throw new Error('the router must never be reached with the TOTAL closed'); },
      turn: () => { throw new Error('the turn must never be reached with the TOTAL closed'); },
      receipt: () => { throw new Error('the OCR hop must never be reached with the TOTAL closed'); },
    });
    try {
      await h.useCase.execute({ ...TEXT_EVENT });
      await h.useCase.executeReceiptUpload({ ...IMAGE_EVENT });
    } finally { h.restore(); }

    const text = h.terminal('evt-text');                                       // (1)
    assert.equal(text?.status, 'ai_budget_exceeded');
    assert.equal(text?.budgetScope, 'TOTAL');
    assert.equal(text?.terminalClass, 'budget_refusal');
    const image = h.terminal('evt-image');
    assert.equal(image?.errorCode, AI_BUDGET_REFUSAL_CODES.exceeded);
    assert.equal(image?.budgetScope, 'TOTAL');

    assert.equal(h.initCalls.length, 0);                                       // (2)
    assert.equal(h.calls.length, 0, 'nothing was spent');                      // (3)
    assert.deepEqual(h.usage(), []);
    assert.equal(h.bucket('CHAT'), 120);
    assert.equal(h.bucket('OCR'), 80);
    assert.deepEqual(h.holds(), [], 'nothing was held');                       // (4)
    assert.equal(h.ocr.readEvents.length, 0);

    const rendered = customerReplies(h.replies);                               // (5)
    assert.equal(rendered.length, 2, 'one reply per turn');
    assert.match(rendered[0], /เครดิต AI เดือนนี้หมดแล้ว/);
    assert.match(rendered[1], /เครดิตสำหรับการอ่านเอกสารไม่พอ/);
    rendered.forEach(assertNoMoneyFigure);
  });

  it('5. a receipt chain refused mid-way keeps the call that ran and never claims an expense', async () => {
    // OCR cap 70: a caption-less photo goes straight to the reader (UAT 2026-09-29). The read at
    // ordinal 0 (64) fits and settles at 10 satang, and the extract at ordinal 1 needs 10 + 64 > 70 —
    // insufficient, not exceeded, because money is LEFT. The TOTAL stays wide open, so the scope must be OCR.
    const h = makeHarness({
      policy: { total: 100_000, chat: 5_000, ocr: 70 },
      intake: () => { throw new Error('a caption-less photo never reaches the intake router'); },
      turn: () => ({ ...TURN_ANSWER }),
      receipt: async (body, chain) => {
        const outcome = await chain.run(body.budgetEnvelope, 2, 'ocr.receipt.image-read');
        // Exactly what E1c's gateway answers when its own `budget-step` refused the next call:
        // the typed money code, the scope, and the usage of the call that DID run.
        return outcome.refusal
          ? { status: 'failed', errorCode: outcome.refusal.errorCode, budgetScope: outcome.refusal.budgetScope, usage: outcome.usage }
          : { status: 'ok', classification: receiptClassification('120.00'), fields: { grandTotalAmount: '120.00', confidence: 0.9 }, ...outcome };
      },
    });
    try {
      await h.useCase.executeReceiptUpload({ ...IMAGE_EVENT });
    } finally { h.restore(); }

    const terminal = h.terminal('evt-image');                                  // (1)
    assert.equal(terminal?.status, 'clarification_required');
    assert.equal(terminal?.errorCode, AI_BUDGET_REFUSAL_CODES.insufficient);
    assert.equal(terminal?.budgetScope, 'OCR');
    assert.equal(terminal?.mediaState, 'retained');
    assert.equal(terminal?.terminalClass, 'clarification');

    // (2) the transcription's bytes are kept and parked; NO expense draft was created
    assert.equal(h.initCalls.length, 0, 'the reply may not claim a complete expense');
    assert.equal(h.tenant.pendingMedia.length, 1);
    assert.equal(h.attachmentCompletions.length, 1);
    assert.equal(h.applied.length, 0);

    // (3) the one invocation that ran is billed: the receipt read
    assert.equal(h.usage().length, 1);
    assert.equal(h.bucket('OCR'), COST_PER_CALL);
    assert.equal(h.bucket('CHAT'), 0);

    // (4) the read's hold is settled and there is NO child hold for the refused extract
    const holds = h.holds();
    assert.deepEqual(holds.map((hold) => `${hold.stepKind}#${ordinalOf(hold)}`).sort(), ['receipt-ocr#0']);
    assert.deepEqual([...new Set(holds.map((hold) => hold.status))], ['SETTLED']);

    // The OCR READ COUNT: E1b/ADR §13b keep count refunds structurally separate from money, and
    // the webhook's own compensation returns the read of a turn that produced no usable result.
    assert.equal(h.ocr.readEvents.length, 0, 'the read fence is released for a turn with no usable result');
    assert.deepEqual([...h.ocr.monthly.values()].map((row) => row.usedCount), [0],
      'the count was ADMITTED and then compensated — while the money that was spent stays spent (R-05)');

    const rendered = customerReplies(h.replies);                               // (5)
    assert.equal(rendered.length, 1);
    assert.match(rendered[0], /เครดิตสำหรับการอ่านเอกสารไม่พอ/);
    assert.equal(/เต็มแล้ว|ครบแล้ว/.test(rendered[0]), false, 'insufficient must never read as "full"');
    assert.match(rendered[0], /ยังไม่ได้บันทึกรายการค่าใช้จ่าย/);
    assertNoMoneyFigure(rendered[0]);
  });

  it('6. an unavailable store fails closed: Redis on the ledger read, then the budget store', async () => {
    // ── (a) Redis is down when the ledger is read ──────────────────────────
    const redisDown = makeHarness({
      policy: { total: 100_000, chat: 5_000, ocr: 5_000 },
      intake: () => { throw new Error('an unreadable question must never reach the router'); },
      turn: () => { throw new Error('an unreadable question must never reach the model'); },
    });
    try {
      redisDown.redis.failing = true;
      await redisDown.useCase.execute({ ...TEXT_EVENT });
    } finally { redisDown.restore(); }

    const failed = redisDown.terminal('evt-text');
    assert.equal(failed?.status, 'marker_unavailable');                        // (1)
    assert.equal(failed?.errorCode, 'CONSUMPTION_MARKER_UNAVAILABLE');
    assert.equal(failed?.terminalClass, 'failed_terminal');
    assert.equal(redisDown.tenant.pendingMedia.length, 0);                    // (2)
    assert.equal(redisDown.calls.length, 0, 'no provider call');              // (3)
    assert.deepEqual(redisDown.usage(), []);
    assert.deepEqual(redisDown.holds(), []);                                  // (4)
    assert.equal(redisDown.replies.length, 1);                                // (5)
    assert.match(customerReplies(redisDown.replies)[0], /ข้อผิดพลาดชั่วคราว/);
    // The operator can tell an outage from an absent stream.
    assert.equal(redisDown.logs.find((entry) => entry?.msg === 'line_ai_marker_unavailable')?.reason, 'redis_unavailable');

    // ── (b) the MONEY read fails: the live month aggregate is unreadable ───
    __resetCompanyAiBudgetCache();
    const moneyDown = makeHarness({
      policy: { total: 100_000, chat: 5_000, ocr: 5_000 },
      intake: () => { throw new Error('an unpriceable turn must never reach the router'); },
      turn: () => { throw new Error('an unpriceable turn must never reach the model'); },
    });
    try {
      moneyDown.money.prisma.client.companyAiMonthlyUsage.findUnique = async () => { throw new Error('budget store unavailable'); };
      await moneyDown.useCase.execute({ ...TEXT_EVENT });
    } finally { moneyDown.restore(); }

    const unavailable = moneyDown.terminal('evt-text');
    assert.equal(unavailable?.errorCode, AI_BUDGET_REFUSAL_CODES.unavailable); // (1)
    assert.equal(unavailable?.status, 'provider_unavailable');
    assert.equal(unavailable?.terminalClass, 'provider_unavailable');
    assert.equal(moneyDown.initCalls.length, 0);                              // (2)
    assert.equal(moneyDown.calls.length, 0, 'no provider call');              // (3)
    assert.deepEqual(moneyDown.usage(), []);
    assert.deepEqual(moneyDown.holds(), []);                                  // (4)
    assert.equal(moneyDown.redis.streams.get(CHAT_LEDGER_KEY)?.length ?? 0, 0, 'and no turn entry is appended');
    assert.equal(moneyDown.replies.length, 1);                                // (5)
    const copy = customerReplies(moneyDown.replies)[0];
    assert.match(copy, /ยังตรวจสอบเครดิต AI ของร้านไม่ได้/);
    assert.equal(/ครบแล้ว|เต็มแล้ว/.test(copy), false, 'an unreadable meter is not a full budget');
    assertNoMoneyFigure(copy);

    // ── (c) the RESERVATION store cannot take the hold ─────────────────────
    // The other half of "store unavailable": the money can be read but the durable hold cannot be
    // written. Same fail-closed answer, and still nothing queued for a retry that cannot succeed.
    __resetCompanyAiBudgetCache();
    const holdsDown = makeHarness({
      policy: { total: 100_000, chat: 5_000, ocr: 5_000 },
      intake: () => { throw new Error('an unreservable turn must never reach the router'); },
      turn: () => { throw new Error('an unreservable turn must never reach the model'); },
    });
    try {
      holdsDown.money.prisma.client.aiBudgetReservation.create = async () => { throw new Error('reservation store unavailable'); };
      await holdsDown.useCase.execute({ ...TEXT_EVENT });
    } finally { holdsDown.restore(); }

    assert.equal(holdsDown.terminal('evt-text')?.errorCode, AI_BUDGET_REFUSAL_CODES.unavailable);
    assert.equal(holdsDown.calls.length, 0, 'no provider call');
    assert.deepEqual(holdsDown.holds(), []);
    assert.deepEqual(holdsDown.usage(), []);
    assert.equal(holdsDown.redis.streams.get(CHAT_LEDGER_KEY)?.length ?? 0, 0, 'and no turn entry is appended');
    assert.match(customerReplies(holdsDown.replies)[0], /ยังตรวจสอบเครดิต AI ของร้านไม่ได้/);
  });

  it('7. a redelivered image and a retry after a lost response buy exactly one expense', async () => {
    const h = makeHarness({
      policy: { total: 100_000, chat: 5_000, ocr: 5_000 },
      intake: () => { throw new Error('a caption-less photo never reaches the intake router'); },
      turn: () => ({ ...TURN_ANSWER }),
      receipt: async (body, chain) => ({
        status: 'ok', classification: receiptClassification('120.00'),
        fields: { vendorName: 'ร้านกาแฟ', grandTotalAmount: '120.00', confidence: 0.95 },
        ...(await chain.run(body.budgetEnvelope, 2, 'ocr.receipt.extract')),
      }),
    });
    let replayed: string | undefined;
    try {
      await h.useCase.executeReceiptUpload({ ...IMAGE_EVENT });
      const afterFirst = { calls: h.calls.length, usage: h.usage().length, replies: h.replies.length };

      // ── (a) LINE delivers the SAME webhook event again ────────────────────
      await h.useCase.executeReceiptUpload({ ...IMAGE_EVENT });
      assert.equal(h.tenant.eventLog.get('evt-image')?.status, 'completed',
        'the event row already left `received`, which is what `claimWebhookEvent` refuses on');
      assert.equal(h.initCalls.length, 1, 'a redelivery creates no second expense draft');
      assert.equal(h.calls.length, afterFirst.calls, 'and buys no second provider call');
      assert.equal(h.usage().length, afterFirst.usage, 'and no second charge');
      assert.equal(h.replies.length, afterFirst.replies, 'and exactly one customer-visible outcome');

      // ── (a2) the OTHER redelivery shape: the same picture under a NEW event id ──
      // LINE really does mint a fresh webhook event for a retried media message, so the event-claim
      // fence cannot be the only guard; the capture itself is what must be idempotent.
      await h.useCase.executeReceiptUpload({ ...IMAGE_EVENT, webhookEventId: 'evt-image-redelivered', replyToken: 'reply-again' });
      assert.equal(h.initCalls.length, 1, 'the existing capture is resumed, never duplicated');
      assert.equal(h.calls.length, afterFirst.calls, 'and the router/OCR are not asked again');
      assert.equal(h.usage().length, afterFirst.usage);
      assert.equal(h.terminal('evt-image-redelivered')?.status, 'completed');
      assert.match(customerReplies(h.replies).at(-1)!, /expense-1/, 'and the answer names the SAME expense');

      // ── (b) the same evidence arriving twice (a lost response, then a retry) ──
      const settled = h.holds().find((hold) => hold.stepKind === 'receipt-ocr' && ordinalOf(hold) === 0);
      const seam = new InternalAiBudgetController(h.config, h.money.prisma);
      replayed = (await seam.budgetSettle(SECRET, {
        invocationKey: settled.invocationKey, sourceRoute: 'receipt-ocr',
        usage: { modelId: MODEL, tag: 'ocr.receipt.image-read', ok: true, ...CALL_TOKENS, usageBasis: 'PROVIDER_REPORTED' } as any,
      })).result;
    } finally { h.restore(); }

    const terminal = h.terminal('evt-image');                                  // (1)
    assert.equal(terminal?.status, 'completed');
    assert.equal(terminal?.terminalClass, 'delivered');

    assert.equal(h.initCalls.length, 1);                                       // (2)
    assert.equal(h.completeCalls.length, 1);
    assert.equal(h.byteUploads.length, 1);
    assert.equal(h.tenant.pendingMedia.length, 0);

    assert.equal(replayed, 'duplicate', 'the second arrival of the same evidence is a duplicate'); // (3)
    assert.equal(h.usage().length, 2, 'one usage row per invocation (read + extract), never two for one');
    assert.equal(h.bucket('OCR'), 2 * COST_PER_CALL, 'the aggregate moved exactly once per call');

    const holds = h.holds();                                                   // (4)
    assert.equal(holds.length, 2);
    assert.deepEqual([...new Set(holds.map((hold) => hold.status))], ['SETTLED']);
    assert.equal(h.ocr.readEvents.length, 1, 'one document read, counted once');

    assert.equal(h.replies.length, 2, 'the first capture plus the resumed answer — never two drafts'); // (5)
    assert.match(customerReplies(h.replies)[0], /expense-1/);
  });

  it('8. an unknown outcome keeps the hold DISPATCHED and an identical retry cannot double-spend', async () => {
    const h = makeHarness({
      policy: { total: 100_000, chat: 5_000, ocr: 5_000 },
      intake: async (body, chain) => ({ ...ROUTED_READ, ...(await chain.run(body.budgetEnvelope, 1, 'line.intake-route')) }),
      // The transport dies with no response at all: the API learns nothing about what was spent.
      turn: () => { const timeout: any = new Error('request expired'); timeout.name = 'TimeoutError'; throw timeout; },
    });
    let retried: unknown;
    try {
      await h.useCase.execute({ ...TEXT_EVENT });

      // The SAME attempt again. Driven at the `AiGatewayClient` seam rather than through the
      // webhook: a live LINE turn passes a 25 s busy-wait deadline, and the correct answer to a
      // live hold IS `busy`, so through the webhook this assertion would be a 25-second sleep.
      retried = await h.gateway.requestLineTurn({
        requestId: 'transport-2', webhookEventId: TEXT_EVENT.webhookEventId,
        userContext: { lineUserId: '[REDACTED]', internalUserId: 'user-1', companyId: COMPANY,
          membershipId: 'mem-1', permissions: [], roles: ['OWNER'], locale: 'th-TH' } as any,
        modelPolicy: { modelId: MODEL }, messageText: TEXT_EVENT.messageText, messagePreviewHash: 'hash',
      }).catch((error: any) => error);
    } finally { h.restore(); }

    const terminal = h.terminal('evt-text');                                   // (1)
    assert.equal(terminal?.status, 'ai_error');
    assert.equal(terminal?.errorCode, 'LINE_AI_AI_TIMEOUT');
    assert.equal(terminal?.terminalClass, 'timeout');

    assert.equal(h.initCalls.length, 0);                                       // (2)
    assert.equal(h.tenant.pendingMedia.length, 0);

    // (3) only the intake route produced evidence; the turn's cost is UNKNOWN, never zero
    assert.equal(h.usage().length, 1);
    assert.equal(h.bucket('CHAT'), COST_PER_CALL);

    // (4) the turn's hold is still DISPATCHED — money is never released on a timer
    const holds = h.holds();
    assert.equal(holds.length, 2, 'the retry created no third hold');
    const turnHold = holds.find((hold) => hold.stepKind === 'line-turn');
    assert.equal(turnHold?.status, 'DISPATCHED');
    assert.equal(turnHold?.upperBoundSatang, 44, 'held at the declared line-turn bound for this model');
    assert.equal(turnHold?.attemptKey, `line-text:${aiBudgetAttemptHash(TEXT_EVENT.webhookEventId)}`);
    assert.equal(holds.find((hold) => hold.stepKind === 'line-intake-text')?.status, 'SETTLED');
    // The retry is refused BECAUSE the invocation is already claimed — not run a second time.
    assert.equal((retried as any)?.getStatus?.(), 429);
    assert.equal((retried as any)?.getResponse?.().code, AI_BUDGET_REFUSAL_CODES.busy);
    assert.deepEqual(h.calls.map((call) => call.path), ['/internal/ai/line-intake-route', '/internal/ai/line-turn']);

    // (5) the existing transient copy, and the ledger entry stays open for the reclaim drain
    assert.equal(h.replies.length, 1);
    assert.match(customerReplies(h.replies)[0], /ระบบใช้เวลานานเกินไปจนต้องหยุดก่อน/);
    assertNoMoneyFigure(customerReplies(h.replies)[0]);
    assert.equal(h.redis.streams.get(CHAT_LEDGER_KEY)?.length, 1);
    // Consume-on-append: the PEL IS the set of unacked entries, so a turn still in it is one the
    // reclaim drain will re-run — a timeout must never be acked away.
    assert.equal(h.redis.pels.get(CHAT_LEDGER_KEY)?.size, 1,
      'the turn entry was appended and never acked, so the drain still owns it');
  });

  it('every declared bound the combined lanes rely on is the reviewed one (guard)', () => {
    assert.equal(AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls, 8, 'read, extract, reread and extract, with one timeout retry per read and extraction');
    assert.equal(AI_BUDGET_STEP_BOUNDS['line-intake-image'].maxCalls, 2);
    assert.equal(AI_BUDGET_STEP_BOUNDS['line-intake-text'].maxCalls, 1);
    assert.ok(AI_BUDGET_STEP_BOUNDS['line-turn'].maxCalls > 1);
    assert.equal(chatKeyHashOf(TEXT_EVENT).length > 0, true);
  });
});
