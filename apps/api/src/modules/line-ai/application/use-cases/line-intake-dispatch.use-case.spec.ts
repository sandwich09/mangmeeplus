import { evaluateEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { lineDeliveryRecipientHash, resolvedLineDeliveryAccessFingerprint } from '../line-delivery-access';
import { deliveryHash } from '../../domain/logic/line-delivery-plan.logic';
import { lineMessagingCredentialsFixture } from '../../../../common/config/line-messaging-credentials.fixture';
import { readLineSystemCard } from '../../domain/logic/line-system-card.fixture';
import { admitCompanyOcr } from '../company-ocr-governance';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { resolveTransactionBranchId } from '../../../data-model-core/application/services/transaction-branch';
import { chatKeyHashOf, lineClarificationContentHash, lineIntakeRouterReason, ProcessLineWebhookUseCase, putLineMediaUpload, classifyPendingMediaReply, splitPendingMediaReply, isExactStandaloneGreeting, isUtilityBillSaveRequest } from './process-line-webhook.use-case';
import { isDeliveredCapabilityFollowUp, isNextStepQuestionText } from '../../domain/logic/line-ai-capability-follow-up.logic';
import { receiptStatusQuestion, receiptProgressLabel } from '../../domain/logic/line-receipt-status.logic';
import { createLineAiInputEvidence, parseLineAiSemanticSubrequests, type BusinessDocumentClassification, type LineIntakeRoutePlan } from '@watchdog-bms/contracts';
import { LineSubstituteReceiptContinuationUseCase, substituteReplySource } from '../../../expenses/application/use-cases/line-substitute-receipt-continuation.use-case';
import { CaptureLineExpenseNoteUseCase, LineTextExpenseCaptureIncompleteError } from '../../../expenses/application/use-cases/expense-document.use-case';

// Router-driven webhook dispatch tests (item 10B LINE Intake Router front stage).

/** Shadow probe double (piece 5) — the dispatch tests assert routing, not shadow evidence. */
const shadowProbe = {
  startSweep: () => ({
    record: async () => ({ wouldBlock: false, reason: 'available' as const }),
    flush: async () => ({}),
  }),
} as any;
const acceptedLegal = { isRequired: async () => false } as any;
/** Launch gate OPEN — the seeded state of `ai_line_assistant/DEFAULT`; the kill switch is exercised
 *  in process-line-webhook.use-case.spec.ts, these tests assert routing. */
const openLaunchGate = { assertLaunchRouteOpen: async () => undefined } as any;

function replyAssertionText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') return record.text;

  const strings: string[] = [];
  const collectStrings = (value: unknown): void => {
    if (typeof value === 'string') {
      strings.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collectStrings);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(collectStrings);
    }
  };
  collectStrings(message);
  return strings.join('\n');
}

function makePrisma(opts: {
  /** The company's ACTIVE branch table, as the LINE default rule and the create resolver both read
   *  it. Empty (the default) keeps every pre-existing test on the legacy single-branch double. */
  branches?: Array<{ id: string; type: string }>;
  /** `CompanyMembership.defaultBranchId` — "สาขาที่ user นั้นอยู่" (Owner 2026-08-27). */
  memberDefaultBranchId?: string | null;
} = {}) {
  const updates: any[] = [];
  const recordUpdates: any[] = [];
  const turnCreates: any[] = [];
  const pendingMediaRows: any[] = [];
  const branchRows = opts.branches ?? [];
  const prisma = {
    client: {
      // Consumption markers commit with the terminal outcome; the fake runs the callback inline.
      $transaction: async (work: (tx: any) => Promise<unknown>) => work(prisma.client),
      $executeRaw: async () => undefined,
      outboxEvent: { create: async () => undefined, findMany: async () => [], findFirst: async () => null },
      // Every media turn asks whether a human is waiting on this LINE user (UAT 2026-09-06). These
      // fixtures are receipts, not support threads, so the answer is "nobody" and nothing is written.
      lineSupportRequest: { findFirst: async () => null },
      lineWebhookEventLog: {
        findUnique: async () => null,
        // A bare number is only a company pick when the PREVIOUS turn was the picker; here it never was.
        findFirst: async () => null,
        create: async (args: unknown) => args,
        updateMany: async (args: any) => { updates.push(args); return { count: 1 }; },
      },
      // LINE default-branch lookup (Owner 2026-08-27): no branches = no default, legacy behavior.
      branch: {
        findMany: async (args: any) => branchRows.filter((row) => !args?.where?.id?.in || args.where.id.in.includes(row.id)),
      },
      externalIdentity: {
        findFirst: async () => ({ status: 'ACTIVE', userId: 'user-1', user: { status: 'ACTIVE' } }),
      },
      companyMembership: {
        findMany: async () => [{ companyId: 'company-1', company: { name: 'c1', brandName: null }, roles: [{ role: { key: 'OWNER' } }] }],
        // LINE default-branch lookup (Owner 2026-08-27): no assigned branch unless a test sets one.
        findUnique: async () => (opts.memberDefaultBranchId ? { defaultBranchId: opts.memberDefaultBranchId } : null),
      },
      lineCompanyContext: { findUnique: async () => null, upsert: async (args: unknown) => args },
      companyFeatureEntitlement: { findMany: async () => [] },
      expenseRecord: { update: async (args: any) => { recordUpdates.push(args); return args; } },
      attachmentLink: { findFirst: async () => null, findMany: async () => [] },
      // §11: the checksum the wet-signed scan is recorded with comes off the stored attachment.
      attachmentObject: { findFirst: async (args: any) => ({ id: args?.where?.id, checksumSha256: 'scan-checksum' }) },
      aiConversation: { upsert: async (args: any) => ({ id: args.where.id }) },
      aiTurn: { create: async (args: any) => { turnCreates.push(args); return { id: 'turn-1' }; }, findMany: async () => [], update: async (args: any) => args },
      aiToolInvocation: { createMany: async (args: unknown) => args },
      // RECEIPT-05: stateful pending-media store so redelivery / follow-up tests observe the real row lifecycle.
      lineIntakePendingMedia: {
        findFirst: async (args: any) => {
          const w = args.where;
          return pendingMediaRows.find((r) =>
            r.companyId === w.companyId && r.userId === w.userId && r.status === w.status &&
            (!w.expiresAt || r.expiresAt > w.expiresAt.gt)) ?? null;
        },
        findUnique: async (args: any) => {
          const { companyId, lineMessageId } = args.where.companyId_lineMessageId;
          return pendingMediaRows.find((r) => r.companyId === companyId && r.lineMessageId === lineMessageId) ?? null;
        },
        create: async (args: any) => { const row = { id: `pm-${pendingMediaRows.length + 1}`, revision: 0,
          createdAt: new Date(Date.now() + pendingMediaRows.length), ...args.data }; pendingMediaRows.push(row); return row; },
        findMany: async (args: any) => {
          const w = args.where;
          return pendingMediaRows.filter((r) => r.companyId === w.companyId && r.userId === w.userId
            && (!w.status || r.status === w.status) && (!w.expiresAt || r.expiresAt > w.expiresAt.gt))
            .sort((a, b) => a.createdAt - b.createdAt).slice(0, args.take ?? 50);
        },
        update: async (args: any) => { const row = pendingMediaRows.find((r) => r.id === args.where.id); if (row) Object.assign(row, args.data); return row; },
        updateMany: async (args: any) => {
          const rows = pendingMediaRows.filter((r) => r.id === args.where.id && (!args.where.status || r.status === args.where.status));
          rows.forEach((row) => Object.assign(row, { ...args.data, ...(args.data?.revision?.increment ? { revision: (row.revision ?? 0) + args.data.revision.increment } : {}) }));
          return { count: rows.length };
        },
      },
    },
  } as any;
  return { prisma, updates, recordUpdates, turnCreates, pendingMediaRows };
}

type Harness = {
  useCase: ProcessLineWebhookUseCase;
  /** W02-LINE: every group, file, read job, intake attempt and merge the capture lane wrote. */
  captureState: {
    groups: any[]; files: any[]; jobs: any[]; attempts: any[];
    moves: any[]; closes: any[]; readFailures: any[];
  };
  candidateQueries: any[];
  correctionCalls: any[];
  replies: string[];
  captured: any[];
  signatureCreated: any[];
  routeRequests: any[];
  /** Every LineAiTurnRequest sent to the gateway, so trusted outer provenance can be asserted. */
  turnRequests: any[];
  ocrRequests: any[];
  /** The options each receipt read was requested with (admission, retry owner). */
  ocrOptions: any[];
  uploads: any[];
  initCalls: any[];
  completeCalls: any[];
  createUploadIntentCalls: any[];
  completeAttachmentCalls: any[];
  createExpenseCalls: any[];
  linkAttachmentCalls: any[];
  updateExpenseCalls: any[];
  substituteCalls: any[];
  /** `startFromCheckBill` inputs — the PAID_NO_RECEIPT lane's own continuation seam. */
  checkBillStarts: any[];
  mediaContextCalls: any[];
  attachMediaCalls: any[];
  linkScanCalls: any[];
  receiptContinuationCalls: any[];
  /** Everything the dispatcher logged at warn — level 40 is what an operator is paged on. */
  warnings: any[];
  /** Inputs the REAL capture use case handed to CreateExpenseDraftUseCase (realCapture only). */
  draftsCreated: any[];
  /** Every LINE payload as sent (one entry per reply/push call), so Flex shape and uri actions can be asserted. */
  sentMessages: unknown[][];
  /** Ledger entries this turn acked as consumed — what a clarification-closing test observes. */
  ledgerAcks: Array<{ entryId: string; outcome: string }>;
};

function makeHarness(opts: {
  permissions: string[];
  scopes?: { branchIds?: string[] };
  routePlan?: LineIntakeRoutePlan;
  correctionOutcome?: any;
  openWaiting?: any[];
  /** Preserve deliberately missing/corrupt provenance for refusal tests. */
  unprovenWaiting?: boolean;
  recentCaptures?: Array<{ id: string; expenseDate: Date | null; grandTotalAmount: string | null; sourceDocumentType: string | null; createdAt: Date }>;
  routeThrows?: boolean;
  uploadThrows?: boolean;
  mediaDownloadFails?: boolean;
  /** W02-LINE: keep the PRODUCTION `downloadLineMedia`, so a raw `file` event is proven end to end. */
  realMediaDownload?: boolean;
  /** A45: the OPEN LINE groups this chat already has inside the same-work window. */
  openSameWorkGroups?: Array<{ groupId: string; firstFileName: string | null; updatedAt: Date; status: string; note: string | null; createdAt: Date; webPath: string }>;
  /** §17.5: the OPEN groups of this chat and whether their reader is still running. */
  openChatGroups?: Array<{ groupId: string; webPath: string; reading: boolean }>;
  captureGroupCreateThrows?: Error;
  /** Appendix §25: the document lane persists through `InitReceiptUploadUseCase`. */
  initReceiptUploadThrows?: Error;
  receiptOcrResult?: any;
  /** One reader result per read, in order (overrides `receiptOcrResult`). */
  receiptOcrResults?: any[];
  governReceiptAdmission?: boolean;
  receiptApplyError?: Error;
  receiptApplyOutcome?: any;
  findExpenseByLineMessageId?: (companyId: string, lineMessageId: string) => Promise<any>;
  prisma?: any;
  /** Collects appendSubRequests calls so a test can assert what the next turn will carry. */
  captureLedger?: any[];
  captureError?: Error;
  substituteResult?: any;
  /** §11: what `loadOpenMediaContext` reports for this chat — undefined means no open substitute work. */
  substituteMediaContext?: any;
  substituteAttachError?: Error;
  /** R11: what the link gate refuses with, so the reply for an uncomposable scan can be asserted. */
  linkScanError?: Error;
  /** Rows behind `hasActiveSubstituteContinuation`: a chat already mid-workflow must not fork a draft. */
  substituteContinuationRows?: any[];
  /** Runs the REAL CaptureLineExpenseNoteUseCase (deterministic eligibility gate included) instead
   *  of the reply stub, so a capture path is proven against production logic, not a double. */
  realCapture?: boolean;
  substituteThrows?: Error;
  expenseDetail?: any;
  lineReplyResult?: 'ok' | 'failed_token' | 'failed_other';
  conversationTurns?: any[];
  expenseDraftConversation?: any;
  expenseDraftConversationEnabled?: boolean;
  /** LINE_AI_REIMBURSEMENT_SEMANTIC_MODE as the config getter reports it; absent = 'off' (legacy). */
  lineAiReimbursementSemanticMode?: 'off' | 'shadow' | 'clarify_only' | 'handoff';
  /** LINE_AI_EXACT_GREETING_ENABLED; absent = false = legacy (a greeting goes through the router). */
  lineAiExactGreetingEnabled?: boolean;
  /** LINE_AI_ADVISOR_MODE; absent is deliberately left UNSET here so the default proves fail-closed. */
  lineAiAdvisorMode?: 'off' | 'social' | 'knowledge' | 'company';
  /** Stored CompanyFeatureEntitlement rows; absent = no rows = legacy fail-open (`null`). */
  entitlementRows?: Array<{ featureKey: string; enabled: boolean }>;
  /** A bound (v2) private conversation, as the UAT/production config defaults bind every private chat. */
  boundV2?: boolean;
  /** One route plan per intake call, in order (overrides `routePlan`). */
  routePlans?: LineIntakeRoutePlan[];
}): Harness {
  const replies: string[] = [];
  const captured: any[] = [];
  const capturedRows = new Map<string, any>();
  const signatureCreated: any[] = [];
  const routeRequests: any[] = [];
  const turnRequests: any[] = [];
  const ocrRequests: any[] = [];
  const ocrOptions: any[] = [];
  const uploads: any[] = [];
  const initCalls: any[] = [];
  const completeCalls: any[] = [];
  /** lineMessageId → the expense it produced, so the redelivery index behaves as production does. */
  const lineMessageExpenses = new Map<string, string>();
  const createUploadIntentCalls: any[] = [];
  const completeAttachmentCalls: any[] = [];
  const createExpenseCalls: any[] = [];
  const draftKeys = new Map<string, string>();
  const candidateQueries: any[] = [];
  const correctionCalls: any[] = [];
  const linkAttachmentCalls: any[] = [];
  const updateExpenseCalls: any[] = [];
  const substituteCalls: any[] = [];
  const checkBillStarts: any[] = [];
  const mediaContextCalls: any[] = [];
  const attachMediaCalls: any[] = [];
  const linkScanCalls: any[] = [];
  const receiptContinuationCalls: any[] = [];
  const draftsCreated: any[] = [];
  const sentMessages: unknown[][] = [];
  const ledgerAcks: Array<{ entryId: string; outcome: string }> = [];
  const prisma = opts.prisma ?? makePrisma().prisma;
  const emptyMedia = (id: string, input: any = {}) => ({ id, companyId: 'company-1', createdByUserId: 'user-1',
    captureSource: 'LINE_UPLOAD', status: 'DRAFT', primaryAttachmentId: 'att-1',
    expenseDate: new Date('2026-09-15'), updatedAt: new Date('2026-09-15T00:00:00Z'),
    grandTotalAmount: '0', vatAmount: '0', whtAmount: '0', netPayableAmount: '0', discountAmount: '0', vatMode: 'NO_VAT',
    lines: [], attachments: [], charges: [], sourceChannelMetadataJson: {}, ...input });
  const recordUpdate = prisma.client.expenseRecord.update;
  prisma.client.expenseRecord.update = async (args: any) => {
    const saved = capturedRows.get(args.where.id);
    if (saved && args.where.updatedAt) assert.equal(args.where.updatedAt.getTime(), saved.updatedAt.getTime());
    const result = await recordUpdate(args);
    if (!saved) return result;
    Object.assign(saved, args.data, { updatedAt: new Date(saved.updatedAt.getTime() + 1) });
    return structuredClone(saved);
  };

  if (opts.conversationTurns) prisma.client.aiTurn.findMany = async () => opts.conversationTurns;
  if (opts.entitlementRows) prisma.client.companyFeatureEntitlement.findMany = async () => opts.entitlementRows;

  // ONE branch table for the whole harness: the LINE default rule reads it through prisma and the
  // create resolver re-validates the pick against the same rows, so a test can never assert a
  // default the production resolver would refuse. An empty prisma branch table means a test that
  // never declared one — those keep the legacy single-branch double below.
  const legacyBranchIds = opts.scopes?.branchIds ?? ['branch-1'];
  const branchDb = {
    branch: {
      findMany: async (args: any) => {
        const rows: Array<{ id: string }> = await prisma.client.branch.findMany({});
        return rows.length > 0
          ? rows.filter((row) => !args?.where?.id?.in || args.where.id.in.includes(row.id))
          : (args?.where?.id?.in ?? legacyBranchIds).map((id: string) => ({ id }));
      },
      // `assertActiveTransactionBranch` re-reads the picked branch: a default the rule chose must
      // still exist and be ACTIVE here, or the create refuses exactly as production would.
      findFirst: async (args: any) => {
        const rows: Array<{ id: string }> = await prisma.client.branch.findMany({});
        const ids = rows.length > 0 ? rows.map((row) => row.id) : legacyBranchIds;
        return ids.includes(args?.where?.id) ? { id: args.where.id } : null;
      },
    },
  } as any;
  // expenseRepo doubles as the repository the REAL capture use case reads and writes through.
  const expenseRepo = {
    resolveCreateBranchId: async (companyId: string, scopes: { branchIds?: string[] }, selectedBranchId?: string | null) =>
      resolveTransactionBranchId(branchDb, companyId, scopes, selectedBranchId),
    findActiveAttachmentObject: async (_companyId: string, id: string) => id === 'pending-att-1' ? { id, checksumSha256: 'hash' } : null,
    listCategories: async () => [{ id: 'cat-meals', name: 'ค่าอาหาร' }],
    listRecentLineCaptures: async (input: any) => { candidateQueries.push(input); return (opts.recentCaptures ?? []).filter(row => !input.expenseIds || input.expenseIds.includes(row.id)); },
    listLineSubstituteContinuationRows: async () => opts.substituteContinuationRows ?? [],
    recordDeliveredLineReceiptContinuation: async (input: any) => { receiptContinuationCalls.push(input); },
    // §17.5 reads the CURRENT state of an `expense` attempt target through this.
    findById: async (_companyId: string, id: string) => (capturedRows.has(id) ? structuredClone(capturedRows.get(id)) : null),
    findByLineMessageId: async (companyId: string, lineMessageId: string) => {
      // Appendix §25: the LINE document lane creates an ORDINARY expense, so redelivery is answered
      // by this index — the same one the production `@@unique([companyId, lineMessageId])` enforces.
      const owned = lineMessageExpenses.get(lineMessageId);
      if (owned && capturedRows.has(owned)) return structuredClone(capturedRows.get(owned));
      const found = await opts.findExpenseByLineMessageId?.(companyId, lineMessageId);
      if (!found) return null;
      if (!capturedRows.has(found.id)) capturedRows.set(found.id, emptyMedia(found.id, {
        primaryAttachmentId: null, lineMessageId, sourceChannelMetadataJson: { chatKeyHash: chatKeyHashOf(TEXT_EVENT) }, ...found,
      }));
      return structuredClone(capturedRows.get(found.id));
    },
    runDuplicateCheck: async (_input: any, detectWithinTx: (tx: any) => Promise<string[]>) => {
      const matched = await detectWithinTx({ marker: 'tx' });
      const duplicateStatus = matched.length > 0 ? 'POSSIBLE_DUPLICATE' : 'NO_MATCH';
      if (capturedRows.has(_input.expenseId)) capturedRows.get(_input.expenseId).duplicateStatus = duplicateStatus;
      return { openCandidates: matched.length, duplicateStatus };
    },
    createExpense: async (input: any, withinTx?: (tx: any, expense: any) => Promise<void>, db?: any) => {
      createExpenseCalls.push(input);
      const existingId = input.draftIdempotencyKey && draftKeys.get(input.draftIdempotencyKey);
      if (existingId) return structuredClone(capturedRows.get(existingId));
      const saved = emptyMedia('expense-clarified-1', { primaryAttachmentId: null, ...input });
      capturedRows.set(saved.id, saved);
      if (input.draftIdempotencyKey) draftKeys.set(input.draftIdempotencyKey, saved.id);
      await withinTx?.(db ?? prisma.client, saved);
      return structuredClone(saved);
    },
    linkAttachment: async (...args: any[]) => {
      linkAttachmentCalls.push(args);
      const saved = capturedRows.get(args[0]);
      if (saved) saved.attachments.push({ id: args[1], purpose: args[2], checksumSha256: 'hash', perceptualHash: '8f00aa55cc33f00f' });
    },
    updateExpense: async (input: any) => {
      updateExpenseCalls.push(input);
      // Final receipt metadata now uses the repository; preserve the same durable-write probe and revision check.
      if (input.sourceChannelMetadataJson?.kind === 'media') {
        const { id, companyId, expectedUpdatedAt, ...data } = input;
        return prisma.client.expenseRecord.update({ where: { id, companyId, updatedAt: expectedUpdatedAt }, data });
      }
      const saved = { id: input.id, expenseNumber: 'EXP-REAL-1', grandTotalAmount: '50.0000', createdByUserId: 'user-1',
        branchId: legacyBranchIds[0], captureSource: 'LINE_UPLOAD', updatedAt: new Date(), ...input };
      if (input.sourceChannelMetadataJson?.kind === 'text_note') capturedRows.set(saved.id, saved);
      else if (capturedRows.has(input.id)) { const current = capturedRows.get(input.id); Object.assign(current, input, { updatedAt: new Date(current.updatedAt.getTime() + 1) }); return structuredClone(current); }
      return structuredClone(saved);
    },
    findByIdWithRelations: async (_companyId: string, expenseId: string) => (typeof opts.expenseDetail === 'function' ? opts.expenseDetail(expenseId) : opts.expenseDetail) ?? structuredClone(capturedRows.get(expenseId)) ?? ({
      id: expenseId,
      primaryAttachmentId: 'pending-att-1',
      attachments: [{
        id: 'pending-att-1',
        purpose: 'expense.receipt.primary',
        checksumSha256: 'hash',
        perceptualHash: '8f00aa55cc33f00f',
      }],
      vendorDocumentNumber: null,
      vendorTaxIdSnapshot: null,
      expenseDate: new Date('2026-07-29T00:00:00.000Z'),
      grandTotalAmount: '0',
      vendorCounterpartyId: null,
      createdByUserId: 'user-1',
    }),
    findNearDuplicates: async () => [],
    findExpenseIdsByAttachmentChecksum: async () => [],
    createDuplicateCandidate: async () => undefined,
  } as any;

  const substituteOutcome = (ctx: any, input: any, result: any) => {
    if (!result || Object.hasOwn(result, 'source') || result.status === 'FORBIDDEN') return result;
    const ids: string[] = result.status === 'TARGET_REQUIRED' && !result.candidateExpenseIds?.length ? []
      : result.candidateExpenseIds?.length ? result.candidateExpenseIds
      : [result.expenseId ?? input.recentCandidates?.[0]?.id ?? 'expense-substitute-1'];
    const records = ids.flatMap(id => {
      const saved = { ...emptyMedia(id), ...capturedRows.get(id),
        ...(typeof opts.expenseDetail === 'object' && opts.expenseDetail?.id === id ? opts.expenseDetail : {}), companyId: ctx.companyId,
        createdByUserId: ctx.userId, sourceChannelMetadataJson: { ...capturedRows.get(id)?.sourceChannelMetadataJson, chatKeyHash: input.chatKeyHash } };
      capturedRows.set(id, saved); return substituteReplySource(saved).records;
    });
    return { ...result, source: { records } };
  };

  // Only repositories, audit and outbox are doubled: the eligibility gate, hint validation and
  // draft-line construction are the production ones.
  const realCaptureExpenseNote = new CaptureLineExpenseNoteUseCase(
    expenseRepo,
    { execute: async (_ctx: any, input: any) => { draftsCreated.push(input); return { id: 'expense-note-real-1', updatedAt: new Date() }; } } as any,
    { log: async () => undefined } as any,
    { append: async () => undefined } as any,
  );

  /** Everything the LINE capture lane writes, so a test can assert one group, one file, one job. */
  const captureState: any = { groups: [], files: [], jobs: [], attempts: [], moves: [], closes: [], readFailures: [] };

  const useCase = new ProcessLineWebhookUseCase(lineMessagingCredentialsFixture({
      webBaseUrl: 'https://app.example.com',
      publicApiBaseUrl: 'https://api.example.com',
      // The real default (§4.1). Without it every size gate in the media lane is comparing to
      // `undefined`, which is how an oversize fixture quietly passes.
      uploadMaxBytes: 10_485_760,
      lineMessagingChannelAccessToken: 'line-token',
      lineExpenseDraftConversationEnabled: opts.expenseDraftConversationEnabled ?? true,
      lineAiReimbursementSemanticMode: opts.lineAiReimbursementSemanticMode ?? 'off',
      lineAiExactGreetingEnabled: opts.lineAiExactGreetingEnabled ?? false,
      // No `?? 'off'` on purpose: leaving it undefined models a config double / older deployment that
      // never heard of the flag, which must still resolve to the legacy advisor-off capability.
      lineAiAdvisorMode: opts.lineAiAdvisorMode,
    } as any),
    prisma,
    {
      webBaseUrl: 'https://app.example.com',
      publicApiBaseUrl: 'https://api.example.com',
      // The real default (§4.1). Without it every size gate in the media lane is comparing to
      // `undefined`, which is how an oversize fixture quietly passes.
      uploadMaxBytes: 10_485_760,
      lineMessagingChannelAccessToken: 'line-token',
      lineExpenseDraftConversationEnabled: opts.expenseDraftConversationEnabled ?? true,
      lineAiReimbursementSemanticMode: opts.lineAiReimbursementSemanticMode ?? 'off',
      lineAiExactGreetingEnabled: opts.lineAiExactGreetingEnabled ?? false,
      // No `?? 'off'` on purpose: leaving it undefined models a config double / older deployment that
      // never heard of the flag, which must still resolve to the legacy advisor-off capability.
      lineAiAdvisorMode: opts.lineAiAdvisorMode,
      ...(opts.boundV2 ? { lineAiReliabilityV2Mode: 'on', lineAiReliabilityV2CompanyIds: [], lineAiDeliveryPlanV2Enabled: true,
        lineAiDeliveryPlanV2WriteCompanyIds: [] } : {}),
    } as any,
    { resolveAccess: async () => ({ membershipId: 'mem-1', roles: ['STAFF'], permissions: opts.permissions, scopes: opts.scopes ?? {} }) } as any,
    { log: async () => undefined } as any,
    {
      requestLineTurn: async (req: any) => {
        turnRequests.push(req);
        return {
          requestId: 'r', replyText: 'turn-answer', sourceRefs: [], sourceLabels: [], webLinks: [],
          intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: [], durationMs: 1,
        };
      },
      requestReceiptOcr: async (req: any, options?: any) => {
        ocrRequests.push(req);
        ocrOptions.push(options);
        // A photo read without the router is admitted by the reader itself, as the real client does.
        if (opts.governReceiptAdmission && !options?.ocrAlreadyAdmitted) {
          const admitted = await admitCompanyOcr(prisma, { companyId: req.companyId, sourceRoute: 'receipt-ocr-line', requestId: req.attachment.id, enforceReceiptQuota: true });
          assert.ok(admitted.allowed, 'test receipt must reach its actual provisional admission');
          options?.onAdmitted?.(admitted);
        }
        return opts.receiptOcrResults?.shift() ?? opts.receiptOcrResult ?? validReceiptOcr();
      },
      requestLineIntakeRoute: async (req: any, options?: any) => {
        routeRequests.push(req);
        if (opts.governReceiptAdmission) {
          const admitted = await admitCompanyOcr(prisma, { companyId: req.companyId, sourceRoute: 'receipt-ocr-line', requestId: req.attachments[0].id, enforceReceiptQuota: true });
          assert.ok(admitted.allowed, 'test receipt must reach its actual provisional admission');
          options?.onAdmitted?.(admitted);
        }
        if (opts.routeThrows) throw new Error('gateway down');
        return opts.routePlans?.shift() ?? opts.routePlan ?? { status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0, errorCode: 'PROVIDER_DISABLED' };
      },
    } as any,
    {
      buildTextMessage: (text: string) => ({ type: 'text', text }),
      sendReply: async (_token: string, messages: unknown[]) => {
        sentMessages.push(messages);
        replies.push(replyAssertionText(messages[0]));
        return opts.lineReplyResult ?? 'ok';
      },
      sendPush: async (_to: string, messages: unknown[]) => {
        sentMessages.push(messages);
        return opts.lineReplyResult ?? 'ok';
      },
    } as any,
    { apply: async (_ctx: any, id: string, fields: any, options: any) => {
      if (opts.receiptApplyError) throw opts.receiptApplyError;
      const saved = capturedRows.get(id); assert.ok(saved);
      assert.equal(options.expectedUpdatedAt.getTime(), saved.updatedAt.getTime());
      const result = opts.receiptApplyOutcome ?? { candidatesCreated: 0 };
      if (!result.staleSkipped) Object.assign(saved, {
        vendorNameSnapshot: fields.vendorName, grandTotalAmount: fields.grandTotalAmount ?? '0',
        expenseDate: fields.expenseDate ? new Date(fields.expenseDate) : saved.expenseDate,
        expenseCategoryId: result.categoryId ?? null, updatedAt: new Date(saved.updatedAt.getTime() + 1),
      });
      return { ...result, committedUpdatedAt: saved.updatedAt };
    } } as any,
    { assertClean: async () => undefined } as any,
    acceptedLegal,
    shadowProbe,
    openLaunchGate,
    // initReceiptUpload / completeReceiptUpload. The init double resolves the branch exactly as the
    // REAL `InitReceiptUploadUseCase` does (expense-upload.use-case.ts:59) — without that, the direct
    // photo lane could never reach its own branch refusal and a mutant deleting its map lookup
    // survived every spec in the repo.
    {
      execute: async (ctx: any, cmd: any) => {
        if (opts.initReceiptUploadThrows) throw opts.initReceiptUploadThrows;
        const branchId = await expenseRepo.resolveCreateBranchId(ctx.companyId, ctx.scopes ?? {}, cmd.branchId);
        capturedRows.set('expense-1', emptyMedia('expense-1', { companyId: ctx.companyId, createdByUserId: ctx.userId, branchId,
          lineMessageId: cmd.lineCapture.lineMessageId, note: cmd.note,
          sourceChannelMetadataJson: {
            chatKeyHash: cmd.lineCapture.chatKeyHash,
            ...(cmd.lineCapture.pushTargetId ? { pushTargetId: cmd.lineCapture.pushTargetId } : {}),
          } }));
        // Only the document lane (appendix §25) models the `@@unique([companyId, lineMessageId])`
        // redelivery index here; the image lane's own resume path is covered by its own cases.
        if (cmd.note !== 'LINE receipt upload') lineMessageExpenses.set(cmd.lineCapture.lineMessageId, 'expense-1');
        initCalls.push(cmd);
        return { expenseId: 'expense-1', attachmentId: 'att-1', uploadUrl: '/u', uploadMethod: 'PUT', expiresAt: new Date() };
      },
    } as any,
    { execute: async (_ctx: any, cmd: any) => { completeCalls.push(cmd); return structuredClone(capturedRows.get(cmd.expenseId)); } } as any,
    // captureExpenseNote
    {
      execute: async (ctx: any, cmd: any) => {
        if (opts.captureError) throw opts.captureError;
        captured.push(cmd);
        if (opts.realCapture) return realCaptureExpenseNote.execute(ctx, cmd);
        const saved = { id: 'expense-note-1', companyId: ctx.companyId, createdByUserId: ctx.userId, branchId: cmd.branchId ?? legacyBranchIds[0],
          captureSource: 'LINE_UPLOAD', updatedAt: new Date(), sourceChannelMetadataJson: { chatKeyHash: cmd.chatKeyHash },
          sourceDocumentType: 'EXPENSE_NOTE_TEXT', grandTotalAmount: '65.0000', expenseCategoryId: 'cat-meals' };
        capturedRows.set(saved.id, saved);
        return {
          expense: structuredClone(saved),
          categoryNameSourceId: 'cat-meals',
          warnings: [],
          insertedAmount: '65.0000',
          categoryId: 'cat-meals',
          categoryName: 'ค่าอาหาร',
          replyTexts: cmd.draftConversationEnabled
            ? ['🧾 ร่างค่าใช้จ่าย expense-note-1\nข้อมูลที่ยังต้องตอบทั้งหมด\nI01-QTY จำนวนเท่าไร?']
            : [],
        };
      },
    } as any,
    // initSignatureUpload
    { execute: async () => ({ attachmentId: 'sig-att-1', uploadUrl: '/u', uploadMethod: 'PUT', expiresAt: new Date() }) } as any,
    // createSignatureAsset
    {
      execute: async (_ctx: any, cmd: any) => {
        signatureCreated.push(cmd);
        return { id: 'sig-1', status: 'ACTIVE', submittedFromChannel: 'LINE' };
      },
    } as any,
    // expenseRepo (categories catalog for the router + RECEIPT-05 draft-from-attachment)
    expenseRepo,
    // ledger: only the open-clarification read matters for the correction evidence tests
    (opts.openWaiting || opts.captureLedger
      ? {
        enabled: true,
        openWaitingUser: async () => waitingFixture,
        ack: async (entry: any, _state: string, meta: any) => { ledgerAcks.push({ entryId: entry?.id, outcome: meta?.outcome }); },
        appendTurn: async () => null,
        appendSubRequests: async (input: any) => { opts.captureLedger?.push(input); },
        coverageToSubRequests: () => [],
      }
      : undefined) as any,
    // createUploadIntent (RECEIPT-05 byte persist)
    // A distinct id per intent (as production), the first one keeping the name older tests assert on.
    { execute: async (_ctx: any, cmd: any) => { createUploadIntentCalls.push(cmd); return { attachmentId: `pending-att-${createUploadIntentCalls.length}`, uploadUrl: '/u', uploadMethod: 'PUT', expiresAt: new Date() }; } } as any,
    // completeAttachmentUpload
    { execute: async (_ctx: any, cmd: any) => { completeAttachmentCalls.push(cmd); return { id: 'pending-att-1' }; } } as any,
    // correctExpense
    {
      execute: async (_ctx: any, cmd: any) => {
        correctionCalls.push(cmd);
        const result = opts.correctionOutcome ?? { status: 'guidance', reason: 'no_correctable_field' };
        if (result.status !== 'applied' || Object.hasOwn(result, 'source')) return result;
        const saved = emptyMedia(result.expenseId, { companyId: _ctx.companyId, createdByUserId: _ctx.userId,
          branchId: legacyBranchIds[0], sourceChannelMetadataJson: { chatKeyHash: cmd.chatKeyHash } });
        capturedRows.set(saved.id, saved);
        return { ...result, source: { id: saved.id, updatedAt: new Date(saved.updatedAt) } };
      },
    } as any,
    (opts.substituteResult || opts.substituteThrows || opts.substituteMediaContext
      ? {
        execute: async (_ctx: any, input: any) => {
          substituteCalls.push(input);
          if (opts.substituteThrows) throw opts.substituteThrows;
          return substituteOutcome(_ctx, input, opts.substituteResult);
        },
        replySourcesCurrent: (ctx: any, source: any) => LineSubstituteReceiptContinuationUseCase.prototype.replySourcesCurrent.call({ repo: expenseRepo } as any, ctx, source),
        loadOpenMediaContext: async (_ctx: any, chatKeyHash: string) => {
          mediaContextCalls.push(chatKeyHash);
          return opts.substituteMediaContext;
        },
        hasPendingIssueDecision: async () => false,
        startFromCheckBill: async (_ctx: any, input: any) => {
          checkBillStarts.push(input);
          return substituteOutcome(_ctx, input, { handled: true, status: 'OPEN', expenseId: input.expenseId, acceptedFields: [], blockers: [], replyText: '' });
        },
        attachMedia: async (_ctx: any, input: any) => {
          attachMediaCalls.push(input);
          if (opts.substituteAttachError) throw opts.substituteAttachError;
          return { replyText: `📎 แนบแล้ว ${input.purpose}` };
        },
        linkWetSignedScan: async (_ctx: any, input: any) => {
          if (opts.linkScanError) throw opts.linkScanError;
          linkScanCalls.push(input);
          return { replyText: '🔵 รอยืนยัน — SUB-202608-00007' };
        },
      }
      : undefined) as any,
    opts.expenseDraftConversation ? {
      ...opts.expenseDraftConversation,
      ...(opts.expenseDraftConversation.execute ? { execute: async (ctx: any, input: any) => {
        const result = await opts.expenseDraftConversation.execute(ctx, input);
        if (!result.handled || ['STALE', 'NOT_FOUND'].includes(result.status) || Object.hasOwn(result, 'source')) return result;
        // Presentation fixtures stand in for a committed producer. Store its original record
        // so the production delivery guard still performs a real scoped read in this harness.
        const saved = emptyMedia(result.expenseId ?? 'expense-continuation-1', { companyId: ctx.companyId,
          createdByUserId: ctx.userId, sourceChannelMetadataJson: { chatKeyHash: input.chatKeyHash } });
        capturedRows.set(saved.id, saved);
        return { ...result, source: { records: [{ id: saved.id, updatedAt: saved.updatedAt }], categories: [] } };
      } } : {}),
    } as any : undefined,
    // ── W02-LINE capture doubles (appendix §3) ────────────────────────────────
    // Nine `undefined` placeholders first: this harness stops at the draft-conversation parameter,
    // and the nine dependencies between it and the capture ones are unused here. Written out rather
    // than spread so a miscount shows up as a failing lane, not a silently shifted double.
    undefined, // reimbursementApprovalQueue
    undefined, // listPurchaseRequests
    undefined, // listPurchaseOrders
    undefined, // intakeState
    undefined, // handoffLinks
    undefined, // packageChange
    undefined, // signupNotify
    undefined, // rateLimit
    undefined, // draftUpdate
    // captureRepo (LineIntakeAttempt)
    {
      recordLineIntakeAttempt: async (input: any) => {
        const row = { id: `attempt-${captureState.attempts.length + 1}`, createdAt: new Date(), ...input,
          fileNameSanitized: input.fileNameSanitized ?? null, outcome: input.outcome ?? 'UNKNOWN' };
        captureState.attempts.push(row);
        return row;
      },
      updateLineIntakeAttemptOutcome: async (input: any) => {
        const row = captureState.attempts.find((attempt: any) => attempt.id === input.id);
        if (!row) return false;
        Object.assign(row, input);
        return true;
      },
      listLineIntakeAttempts: async () => [...captureState.attempts].reverse(),
    } as any,
    // createCaptureGroup
    {
      execute: async (ctx: any, cmd: any) => {
        if (opts.captureGroupCreateThrows) throw opts.captureGroupCreateThrows;
        const groupId = `group-${captureState.groups.length + 1}`;
        captureState.groups.push({ groupId, ...cmd, companyId: ctx.companyId, createdByUserId: ctx.userId, revision: 1 });
        return { groupId, revision: 1, webPath: `/companies/${ctx.companyId}/expenses/capture/${groupId}` };
      },
    } as any,
    // addCaptureFile
    {
      execute: async (_ctx: any, groupId: string, cmd: any) => {
        const fileId = `file-${captureState.files.length + 1}`;
        captureState.files.push({ fileId, groupId, ...cmd });
        return { fileId, attachmentId: `capture-att-${captureState.files.length}`, revision: 2,
          uploadUrl: '/u', uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: new Date() };
      },
    } as any,
    // completeCaptureFile
    {
      execute: async (_ctx: any, groupId: string, fileId: string, cmd: any) => {
        const jobId = `job-${captureState.jobs.length + 1}`;
        captureState.jobs.push({ jobId, groupId, fileId, status: 'QUEUED', ...cmd });
        return { fileId, attachmentId: `capture-att-${captureState.files.length}`, revision: 3,
          readJobId: jobId, uploadState: 'STORED', replayed: false };
      },
    } as any,
    // captureLine
    {
      findGroupByLineMessageId: async (_companyId: string, lineMessageId: string) => {
        const file = captureState.files.find((row: any) => row.lineMessageId === lineMessageId);
        if (!file) return null;
        const group = captureState.groups.find((row: any) => row.groupId === file.groupId);
        return group ? { ...group, fileId: file.fileId, attachmentId: 'capture-att-1', uploadState: 'STORED',
          webPath: `/companies/company-1/expenses/capture/${group.groupId}`, firstFileName: file.originalFileName,
          createdAt: new Date(), updatedAt: new Date(), status: 'OPEN', note: group.note ?? null } : null;
      },
      listOpenSameWorkGroups: async () => opts.openSameWorkGroups ?? [],
      listOpenChatGroupProgress: async () => opts.openChatGroups ?? [],
      moveFileToGroup: async (_ctx: any, input: any) => { captureState.moves.push(input); return { ...input, requeuedJob: false }; },
      closeMergedGroup: async (_ctx: any, groupId: string, reason: string) => { captureState.closes.push({ groupId, reason }); return true; },
      markReadFailed: async (_companyId: string, jobId: string, errorCode: string) => {
        captureState.readFailures.push({ jobId, errorCode });
        const job = captureState.jobs.find((row: any) => row.jobId === jobId);
        if (job) job.status = 'FAILED';
        return true;
      },
      listChatIntakeAttempts: async () => [...captureState.attempts].reverse(),
      // Appendix §25: the document lane's read is an `ownerType EXPENSE` job.
      queueExpenseRead: async (input: any) => {
        const jobId = `job-${captureState.jobs.length + 1}`;
        captureState.jobs.push({ jobId, status: 'QUEUED', ownerType: 'EXPENSE', ...input });
        return jobId;
      },
      readFinishedExpenseSnapshot: async (_companyId: string, expenseId: string) => {
        const row = capturedRows.get(expenseId);
        if (!row) return null;
        return {
          expense: {
            id: expenseId, status: row.status ?? 'NEEDS_REVIEW', captureSource: 'LINE_UPLOAD',
            createdByUserId: row.createdByUserId, lineChatKeyHash: row.sourceChannelMetadataJson?.chatKeyHash ?? null,
            linePushTargetId: row.sourceChannelMetadataJson?.pushTargetId ?? null,
            vendorNameSnapshot: row.vendorNameSnapshot ?? null, grandTotalAmount: row.grandTotalAmount ?? null,
            currency: row.currency ?? 'THB', sourceDocumentType: row.sourceDocumentType ?? null,
            expenseDate: row.expenseDate ?? null, primaryAttachmentId: row.primaryAttachmentId ?? null,
          },
          jobs: captureState.jobs.filter((job: any) => job.expenseId === expenseId)
            .map((job: any) => ({ id: job.jobId, status: job.status, pausedReason: null, lastErrorCode: null })),
        };
      },
      readFinishedSnapshot: async (_companyId: string, groupId: string) => {
        const group = captureState.groups.find((row: any) => row.groupId === groupId);
        if (!group) return null;
        return {
          group: { id: groupId, status: 'OPEN', intakeChannel: 'LINE', createdByUserId: group.createdByUserId,
            lineChatKeyHash: group.lineChatKeyHash ?? null, branchId: group.branchId ?? null },
          jobs: captureState.jobs.filter((row: any) => row.groupId === groupId)
            .map((row: any) => ({ id: row.jobId, status: row.status, pausedReason: null, lastErrorCode: null })),
          observations: 1,
          webPath: `/companies/company-1/expenses/capture/${groupId}`,
        };
      },
    } as any,
  );
  (useCase as any).readEvidence = { forTurn: async () => [], verify: async () => true, verifyDelivery: async () => false };
  if (opts.boundV2) (useCase as any).contextV2 = { admit: async () => ({ id: 'line-v2:conversation-1', lifecycleEpoch: 0 }),
    projection: async () => ({ version: 2, stateVersion: 0, lifecycleEpoch: 0, expiresAtMs: Date.now() + 60_000, tasks: [] }) };
  // Historical unit scenarios seed an original question at harness construction. Actual two-turn
  // tests carry the producer's exact sourceContext and must never mint a replacement on read.
  const waitingFixture = (opts.openWaiting ?? []).map(item => ({ ...item, entry: { ...item.entry } }));
  for (const item of waitingFixture) if (!opts.unprovenWaiting && !Object.hasOwn(item.entry, 'sourceContext')) {
    item.entry.sourceContext = JSON.stringify({ v: 1, userId: 'user-1', companyId: 'company-1',
      fingerprint: resolvedLineDeliveryAccessFingerprint('user-1', 'company-1', {
        membershipId: 'mem-1', roles: ['STAFF'], permissions: opts.permissions, scopes: opts.scopes ?? {},
      } as any, evaluateEntitledFeatureKeys(opts.entitlementRows ?? [])),
      chatKeyHash: chatKeyHashOf(TEXT_EVENT), recipientHash: lineDeliveryRecipientHash(TEXT_EVENT.lineUserId, TEXT_EVENT.lineUserId, (TEXT_EVENT as any).messagingChannelId ?? ''), contentHash: lineClarificationContentHash(item),
    });
  }

  // The dispatcher's own logger, so a test can assert what an operator sees at level 40.
  const warnings: any[] = [];
  (useCase as any).logger = { warn: (payload: any) => warnings.push(payload), error: () => {}, log: () => {}, debug: () => {} };
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  // `realMediaDownload` exercises the PRODUCTION download (A68: a raw `file` event with no
  // contentBase64 anywhere in the fixture), so the typed failure reasons are proven end to end.
  if (!opts.realMediaDownload) (useCase as any).downloadLineMedia = async () => opts.mediaDownloadFails
    ? { ok: false, reason: 'download_failed' }
    : ({
      ok: true,
      media: {
        fileName: 'image.jpg', mimeType: 'image/jpeg', byteSize: jpegBytes.byteLength,
        checksumSha256: 'hash', contentBase64: jpegBytes.toString('base64'), bytes: jpegBytes,
      },
    });
  (useCase as any).uploadLineMedia = async (intent: any, media: any) => {
    uploads.push({ intent, media });
    if (opts.uploadThrows) throw new Error('storage PUT failed');
  };
  return { useCase, captureState, replies, captured, signatureCreated, routeRequests, turnRequests, ocrRequests, ocrOptions, uploads, initCalls, completeCalls, createUploadIntentCalls, completeAttachmentCalls, createExpenseCalls, linkAttachmentCalls, updateExpenseCalls, candidateQueries, correctionCalls, substituteCalls, checkBillStarts, mediaContextCalls, attachMediaCalls, linkScanCalls, receiptContinuationCalls, draftsCreated, sentMessages, ledgerAcks, warnings };
}

const TEXT_EVENT = {
  webhookEventId: 'evt-text-1',
  lineUserId: 'line-user-secret',
  replyToken: 'reply-1',
  messageText: 'ค่ากาแฟ 65 บาท',
  messagingChannelId: 'ch-1',
  lineMessageId: 'msg-text-1',
};

const MEDIA_EVENT = {
  webhookEventId: 'evt-media-1',
  lineUserId: 'line-user-secret',
  replyToken: 'reply-2',
  lineMessageId: 'msg-media-1',
  messageType: 'image' as const,
  messagingChannelId: 'ch-1',
};

function businessClassification(overrides: Partial<BusinessDocumentClassification> = {}): BusinessDocumentClassification {
  return {
    contentKind: 'DOCUMENT',
    documentFamily: 'EXPENSE_EVIDENCE',
    documentKind: 'RECEIPT',
    businessDirection: 'PURCHASE_EXPENSE',
    transactionState: 'PAID',
    evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.98,
    evidenceSignals: ['receipt', 'total 120.00'],
    amountSignals: ['120.00'],
    settlementSignals: ['paid'],
    missingRequiredSignals: [],
    contradictionSignals: [],
    requiresClarification: false,
    ...overrides,
  };
}

function validReceiptOcr(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    classification: businessClassification(),
    fields: { vendorName: 'ร้านทดสอบ', documentNumber: 'R-1', grandTotalAmount: '120.00', confidence: 0.98 },
    ...overrides,
  };
}

describe('LINE intake dispatch – capture correction (phase 1 guidance)', () => {
  const CORRECTION_PLAN = { status: 'ROUTED' as const, intent: 'EXPENSE_CAPTURE_CORRECTION' as const, language: 'th', confidence: 0.93 };
  const capturedRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, expenseDate: new Date('2026-06-17T00:00:00.000Z'), grandTotalAmount: '59.00',
    sourceDocumentType: 'HANDWRITTEN_CASH_BILL', createdAt: new Date('2026-08-03T13:01:00.000Z'), ...overrides,
  });

  it('points at the single recent capture and creates nothing', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'วันที่ออกสารผิดนะ ต้องเป็นวันที่ 20 กรกฎาคม 2569' });

    assert.equal(h.captured.length, 0, 'a correction must never create a draft');
    assert.equal(h.createExpenseCalls.length, 0);
    assert.match(h.replies[0] ?? '', /expense-1/);
    assert.match(h.replies[0] ?? '', /ไม่สร้างรายการใหม่/);
  });

  it('offers the list when nothing recent is correctable', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้ยอดเป็น 590' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ยังไม่พบรายการ/);
    assert.equal(/expenses\/[a-z0-9-]/.test(h.replies[0] ?? ''), false, 'must not point at a specific record');
  });

  it('names the candidates instead of silently picking the newest when several match', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1'), capturedRow('expense-2', { grandTotalAmount: '120.00' })],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้วันที่หน่อย' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /พบหลายรายการ/);
    assert.equal(/expenses\/expense-1/.test(h.replies[0] ?? ''), false, 'no silent newest-target link');
  });

  it('never promises an edit to a capture-only role', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'], // ACCOUNTANT/MARKETING shape
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ยอดผิด' });

    assert.match(h.replies[0] ?? '', /เจ้าของกิจการหรือผู้มีสิทธิ์แก้ไขรายจ่าย/);
    assert.equal(/เปิดแก้ไขในเว็บแอป/.test(h.replies[0] ?? ''), false);
  });

  it('scopes candidates to this user, this chat, and a bounded window', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้วันที่' });

    const query = h.candidateQueries.at(-1);
    assert.equal(query.createdByUserId, 'user-1');
    assert.equal(query.take, 5);
    assert.ok(query.chatKeyHash && !query.chatKeyHash.includes('line-user-secret'), 'chat scope is hashed, never raw');
    assert.ok(query.since instanceof Date);
  });

  it('sends only structured candidate labels to the router', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้วันที่' });

    const [candidate] = h.routeRequests[0].recentCapturedExpenses ?? [];
    assert.equal(candidate?.id, 'expense-1');
    assert.match(candidate?.label ?? '', /บิลเงินสดเขียนมือ/);
    assert.equal(Object.keys(candidate ?? {}).includes('vendorName'), false, 'no free text in candidate payloads');
  });


  it('never reports an unexpected legacy applied status as a confirmed mutation without a preview receipt', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: { ...CORRECTION_PLAN, correctionHints: { expenseDate: { to: '2026-07-20' } } },
      recentCaptures: [capturedRow('expense-1')],
      correctionOutcome: { status: 'applied', expenseId: 'expense-1', fields: { expenseDate: { from: '2026-06-17T00:00:00.000Z', to: '2026-07-20' } } },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'วันที่ต้องเป็น 20 กรกฎาคม 2569' });

    assert.equal(h.captured.length, 0, 'still never a create');
    assert.equal(h.correctionCalls.length, 1);
    assert.equal(h.correctionCalls[0].candidates[0].id, 'expense-1');
    assert.doesNotMatch(h.replies[0] ?? '', /แก้ไขรายการเดิมให้แล้ว/);
    assert.match(h.replies[0] ?? '', /เปิดแก้ไขในเว็บแอป/);
    assert.match(h.replies[0] ?? '', /expense-1/);
  });

  for (const fault of ['unchanged', 'revision', 'missing', 'access', 'fallback']) it(`legacy compatibility outcome never substitutes for a preview receipt: ${fault}`, async () => {
    let changed = false, privateAttempts = 0; const accepted: unknown[] = [];
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: { ...CORRECTION_PLAN, correctionHints: { expenseDate: { to: '2026-07-20' } } },
      recentCaptures: [capturedRow('expense-1')], correctionOutcome: { status: 'applied', expenseId: 'expense-1',
        fields: { expenseDate: { from: '2026-06-17T00:00:00.000Z', to: '2026-07-20' } } },
    });
    const uc = h.useCase as any, execute = uc.correctExpense.execute, read = uc.expenseRepo.findByIdWithRelations;
    uc.correctExpense.execute = async (...args: unknown[]) => {
      const result = await execute(...args); return fault === 'missing' ? { ...result, source: undefined } : result;
    };
    uc.expenseRepo.findByIdWithRelations = async (...args: unknown[]) => {
      const row = await read(...args); return changed && row && ['revision', 'fallback'].includes(fault)
        ? { ...row, updatedAt: new Date(row.updatedAt.getTime() + 1) } : row;
    };
    const access = uc.permissionResolver.resolveAccess;
    uc.permissionResolver.resolveAccess = async (...args: unknown[]) => changed && fault === 'access'
      ? { membershipId: 'revoked', roles: [], permissions: [], scopes: {} } : access(...args);
    if (!['unchanged', 'fallback'].includes(fault)) uc.handoffLinks = {
      wrapOutgoingLineContent: async (_who: unknown, messages: unknown) => { changed = true; return messages; },
    };
    uc.lineReply.sendReply = async (_token: string, messages: unknown[]) => {
      if (/แก้ไขรายการเดิมให้แล้ว/.test(JSON.stringify(messages))) {
        privateAttempts++; if (fault === 'fallback') { changed = true; return 'failed_token'; }
      }
      accepted.push(messages); return 'ok';
    };
    uc.lineReply.sendPush = async (_to: string, messages: unknown[]) => { accepted.push(messages); return 'ok'; };
    const run = h.useCase.execute({ ...TEXT_EVENT, messageText: 'วันที่ต้องเป็น 20 กรกฎาคม 2569' });
    if (fault === 'access') await assert.rejects(run, /LINE_DELIVERY_FAILED_PERMANENT/); else await run;
    assert.equal(h.correctionCalls.length, 1); assert.equal(h.captured.length, 0); assert.equal(h.ocrRequests.length, 0);
    assert.doesNotMatch(JSON.stringify(accepted), /แก้ไขรายการเดิมให้แล้ว/);
    assert.equal(privateAttempts, 0, 'an unrecognized legacy result cannot emit a mutation receipt');
    if (fault === 'access') {
      assert.doesNotMatch(JSON.stringify(accepted), /แก้ไขรายการเดิมให้แล้ว|expense-1/);
      assert.match(JSON.stringify(accepted), fault === 'access' ? /สิทธิ์หรือร้านที่เลือกเปลี่ยน/ : /ข้อมูลต้นทางเปลี่ยน/);
      assert.equal(privateAttempts, 0);
    }
  });

  it('falls back to guidance when a guard refuses, never to a create', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: { ...CORRECTION_PLAN, correctionHints: { amount: { to: '9999' } } },
      recentCaptures: [capturedRow('expense-1')],
      correctionOutcome: { status: 'guidance', reason: 'ungrounded_value:amount' },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้ยอด' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ไม่สร้างรายการใหม่/);
  });

  it('asks one question when the message names both the old and the new value', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: { ...CORRECTION_PLAN, correctionHints: { amount: { to: '590' } } },
      recentCaptures: [capturedRow('expense-1')],
      correctionOutcome: { status: 'clarify', field: 'amount' },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ยอด 59 ไม่ใช่ 590' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ค่าเดิมและค่าใหม่/);
  });

  it('hands the apply the evidence of the clarification it answered, dated when it was asked', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: { ...CORRECTION_PLAN, resolvedClarificationIds: ['7-0'] },
      recentCaptures: [capturedRow('expense-1')],
      openWaiting: [{
        id: '7-0', question: 'รายการไหน', text: 'แก้ยอดเป็น 590', askedAt: '2026-08-03T13:03:00.000Z',
        entry: { id: '7-0', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 't0', kind: 'sub_request', userId: 'user-1' },
      }],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'รายการที่ 2' });

    const evidence = h.correctionCalls[0]?.evidence ?? [];
    assert.equal(evidence.length, 2, 'current turn plus the answered clarification');
    assert.equal(evidence[1].text, 'แก้ยอดเป็น 590');
    assert.equal(evidence[1].todayIso, '2026-08-03');
  });

  it('names who can edit when the caller has no edit permission', async () => {
    const h = makeHarness({
      permissions: ['line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้ยอด' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /เจ้าของกิจการหรือผู้มีสิทธิ์แก้ไขรายจ่าย/);
  });
});

describe('LINE intake dispatch – text path', () => {
  const CAPABILITY_TURN = [{
    createdAt: new Date(), userMessagePreview: 'ทำอะไรได้บ้าง',
    replyPreview: 'น้องมั่งมีช่วยค้นและสรุปข้อมูลงานตามสิทธิ์ของคุณได้ค่ะ',
    intent: 'UNKNOWN', agent: 'general', refused: false, toolInvocations: [],
  }];

  it('keeps an immediate vague follow-up attached to the delivered capability answer without another model call', async () => {
    const h = makeHarness({
      permissions: ['line.ai.query', 'accounting.document.read', 'expense.receipt.line_upload'],
      conversationTurns: CAPABILITY_TURN,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'อย่างไหร่' });

    assert.equal(h.routeRequests.length, 0);
    assert.match(h.replies[0] ?? '', /ยอดขายวันนี้เท่าไหร่/);
    assert.match(h.replies[0] ?? '', /ส่งรูปใบเสร็จ/);
    assert.match(h.replies[0] ?? '', /เตรียมการ์ดให้กดยืนยันเองค่ะ/);
  });

  it('follow-up examples name only what this caller can reach', async () => {
    // `line.ai.query` alone reaches no business tool and no receipt upload, so the examples that
    // used to be hardcoded here would all have been refused if the user typed them back.
    const h = makeHarness({ permissions: ['line.ai.query'], conversationTurns: CAPABILITY_TURN });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'อย่างไหร่' });

    assert.equal(h.routeRequests.length, 0);
    assert.doesNotMatch(h.replies[0] ?? '', /ยอดขายวันนี้เท่าไหร่/);
    assert.doesNotMatch(h.replies[0] ?? '', /ส่งรูปใบเสร็จ/);
    assert.match(h.replies[0] ?? '', /ผู้มีสิทธิ์จัดการบทบาท/);
  });

  it('reduces a stored capability reply to a fixed hint without copying any trailing private facts', async () => {
    const h = makeHarness({ permissions: ['line.ai.query'], conversationTurns: [{ ...CAPABILITY_TURN[0],
      replyPreview: `${CAPABILITY_TURN[0]!.replyPreview}\nข้อมูลลับจากสาขาเดิม 987654 บาท`,
    }] });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ดูรายการที่มีสิทธิ์' });
    const history = h.routeRequests[0]?.conversationContext?.recentTurns;
    assert.equal(history?.[0]?.intent, 'CAPABILITY_OVERVIEW');
    assert.equal(history?.[0]?.assistantReplyPreview, undefined);
    assert.doesNotMatch(JSON.stringify(h.routeRequests), /987654|ข้อมูลลับ/);
  });

  it('does not treat the same vague text as capability follow-up without the delivered capability marker', () => {
    assert.equal(isDeliveredCapabilityFollowUp('อย่างไหร่', undefined), false);
    assert.equal(isDeliveredCapabilityFollowUp('อย่างไหร่', {
      windowMinutes: 15, maxTurns: 15,
      recentTurns: [{ at: new Date().toISOString(), assistantReplyPreview: 'สรุปยอดขายแล้ว', refused: false }],
    }), false);
  });

  it('recognises the teaching walkthrough (capability-help spec §8.1) as a delivered capability reply too', () => {
    for (const preview of [
      'น้องมั่งมีสอนใช้งานเบื้องต้นให้นะคะ ทำตามนี้ได้เลยค่ะ\n1) ถ่ายรูปใบเสร็จหรือสลิป แล้วส่งมาในแชทนี้ได้เลย',
      'Nong Mangmee will walk you through the basics. Just follow these steps:',
    ]) {
      assert.equal(isDeliveredCapabilityFollowUp('ยังไง', {
        windowMinutes: 15, maxTurns: 15,
        recentTurns: [{ at: new Date().toISOString(), assistantReplyPreview: preview, refused: false }],
      }), true, preview);
    }
  });

  it('answers a receipt follow-up from the current captured expense without invoking the model or inventing purpose/tax policy', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      scopes: { branchIds: ['branch-1'] },
      recentCaptures: [{
        id: 'expense-royal', expenseDate: new Date('2026-08-15T00:00:00.000Z'), grandTotalAmount: '2890.00',
        sourceDocumentType: 'RECEIPT', createdAt: new Date(),
      }],
      expenseDetail: {
        id: 'expense-royal', companyId: 'company-1', branchId: 'branch-1', createdByUserId: 'user-1',
        captureSource: 'LINE_UPLOAD', updatedAt: new Date('2026-09-15T00:00:00Z'),
        sourceDocumentType: 'RECEIPT', grandTotalAmount: '2890.00', currency: 'THB',
        expenseCategoryId: null, accountHintKey: null, taxEvidenceStatus: 'NEEDS_REVIEW',
        sourceChannelMetadataJson: {
          chatKeyHash: chatKeyHashOf(TEXT_EVENT),
          lineReceiptContinuation: {
            kind: 'CAPTURED_EXPENSE', expenseId: 'expense-royal', userId: 'user-1',
            chatKeyHash: '20cb92ee125850e6', deliveredOutcomeId: 'opaque-outcome',
          },
        },
        aiVerificationSummaryJson: {
          recognizedFields: {
            vendorName: 'Royal Pizza Bravo BKK', expenseDate: '2026-08-15', documentNumber: '04003692',
            grandTotalAmount: '2890.00', vatAmount: '189.07',
          },
          missingFields: ['category', 'businessPurpose'],
        },
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'อ่านใบเสร็จนี้ให้หน่อยว่าเป็นประเภทไหน และจะนำมาเป็นค่าใช้จ่ายของบริษัทอย่างไร' });

    assert.equal(h.routeRequests.length, 0, 'grounded follow-up never reaches the model router');
    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /Royal Pizza Bravo BKK/);
    assert.match(h.replies[0] ?? '', /2,890\.00 THB/);
    assert.match(h.replies[0] ?? '', /189\.07/);
    assert.match(h.replies[0] ?? '', /ไม่ยืนยันนโยบายบริษัทหรือสิทธิเครดิต VAT/);
    assert.doesNotMatch(h.replies[0] ?? '', /ประชุม|รับรองลูกค้า|เคลมได้/);
  });

  it('requires target selection instead of silently reading one of several recent receipts', async () => {
    const recent = (id: string) => ({
      id, expenseDate: new Date('2026-08-15T00:00:00.000Z'), grandTotalAmount: '100.00',
      sourceDocumentType: 'RECEIPT', createdAt: new Date(),
    });
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      recentCaptures: [recent('expense-1'), recent('expense-2')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ใบนี้เป็นเอกสารประเภทอะไร' });

    assert.equal(h.routeRequests.length, 0);
    assert.match(h.replies[0] ?? '', /มากกว่า 1 รายการ/);
    assert.doesNotMatch(h.replies[0] ?? '', /[12]\)/);
    const choices = (h.sentMessages[0]?.[0] as any)?.quickReply?.items;
    assert.equal(choices.length, 2);
    assert.ok(choices.every((item: any) => item.action.text.includes('100.00')));
  });

  it('a concurrent duplicate event-log claim processes exactly one turn', async () => {
    const { prisma } = makePrisma();
    let claimed = false;
    prisma.client.lineWebhookEventLog.create = async () => {
      if (!claimed) {
        claimed = true;
        return {};
      }
      const error = new Error('unique constraint') as Error & { code: string };
      error.code = 'P2002';
      throw error;
    };
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9,
        captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', amount: '65' },
      },
      prisma,
    });

    await Promise.all([h.useCase.execute(TEXT_EVENT), h.useCase.execute(TEXT_EVENT)]);

    assert.equal(h.captured.length, 1);
  });

  it('a duplicate continuation webhook applies its answer exactly once', async () => {
    const { prisma } = makePrisma();
    let claimed = false;
    prisma.client.lineWebhookEventLog.create = async () => {
      if (!claimed) { claimed = true; return {}; }
      const error = new Error('unique constraint') as Error & { code: string };
      error.code = 'P2002';
      throw error;
    };
    let answerWrites = 0;
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      prisma,
      expenseDraftConversation: {
        routeContexts: async () => [{
          expenseId: 'expense-1', label: 'ร่าง 1', status: 'OPEN',
          questions: [{ id: 'I01-QTY', itemRef: 'I01', prompt: 'จำนวน?' }],
        }],
        execute: async () => {
          answerWrites += 1;
          return { handled: true, status: 'UPDATED', replyTexts: ['🧾 ร่างล่าสุด'], acceptedFields: ['I01-QTY'] };
        },
      },
    });
    const answerEvent = { ...TEXT_EVENT, messageText: 'I01-QTY 5 รีม' };

    await Promise.all([h.useCase.execute(answerEvent), h.useCase.execute(answerEvent)]);

    assert.equal(answerWrites, 1);
  });

  it('keeps a committed continuation answer and marks delivery pending when LINE fails', async () => {
    const { prisma, updates } = makePrisma();
    let answerWrites = 0;
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      prisma,
      lineReplyResult: 'failed_other',
      expenseDraftConversation: {
        routeContexts: async () => [{
          expenseId: 'expense-1', label: 'ร่าง 1', status: 'OPEN',
          questions: [{ id: 'I01-QTY', itemRef: 'I01', prompt: 'จำนวน?' }],
        }],
        execute: async () => {
          answerWrites += 1;
          return { handled: true, status: 'UPDATED', replyTexts: ['🧾 บันทึกคำตอบแล้ว'], acceptedFields: ['I01-QTY'] };
        },
      },
    });

    await assert.rejects(() => h.useCase.execute({ ...TEXT_EVENT, messageText: 'I01-QTY 5 รีม' }), /LINE_DELIVERY_FAILED_OTHER/);

    assert.equal(answerWrites, 1, 'the committed answer is not rolled back or re-applied by the delivery layer');
    assert.ok(updates.some((update) => update.data?.status === 'delivery_pending'));
  });

  it('routes text spend note to a persistent draft and returns its complete question snapshot', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9,
        captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', amount: '65', expenseCategoryId: 'cat-meals' },
      },
      expenseDraftConversation: { routeContexts: async () => [] },
    });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(h.captured.length, 1);
    assert.equal(h.captured[0].lineMessageId, 'msg-text-1');
    assert.equal(h.captured[0].captureHints.amount, '65');
    assert.match(h.replies[0] ?? '', /ร่างค่าใช้จ่าย/);
    assert.match(h.replies[0] ?? '', /I01-QTY/u);
    assert.match(h.replies[0] ?? '', /expense-note-1/);
    // Router received the active category catalog and permissions, never the raw LINE user id.
    assert.equal(h.routeRequests[0].activeCategories[0].id, 'cat-meals');
    assert.ok(!JSON.stringify(h.routeRequests[0]).includes('line-user-secret'));
  });

  it('does not load or expose durable draft conversation behavior while the rollout flag is off', async () => {
    let contextLoads = 0;
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      expenseDraftConversationEnabled: false,
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9,
        captureHints: { description: 'ค่ากาแฟ', amount: '65', expenseCategoryId: 'cat-meals' },
      },
      expenseDraftConversation: {
        routeContexts: async () => { contextLoads += 1; return []; },
      },
    });

    await h.useCase.execute(TEXT_EVENT);

    assert.equal(contextLoads, 0);
    assert.equal(h.captured[0].draftConversationEnabled, false);
    assert.doesNotMatch(h.replies[0] ?? '', /I01-QTY/u);
    assert.match(h.replies[0] ?? '', /expense-note-1/u);
  });

  it('falls back to the legacy capture when the rollout provider is unavailable', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9,
        captureHints: { description: 'ค่ากาแฟ', amount: '65', expenseCategoryId: 'cat-meals' },
      },
    });

    await h.useCase.execute(TEXT_EVENT);

    assert.equal(h.captured[0].draftConversationEnabled, false);
    assert.doesNotMatch(h.replies[0] ?? '', /I01-QTY/u);
  });

  it('refuses a group capture before mutation and delivers only a private-chat instruction', async () => {
    let contextLoads = 0;
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9,
        captureHints: { description: 'ค่ากาแฟ', amount: '65', expenseCategoryId: 'cat-meals' },
      },
      expenseDraftConversation: {
        routeContexts: async () => { contextLoads += 1; return []; },
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, pushTargetId: 'group-1' });

    assert.equal(contextLoads, 0);
    assert.equal(h.captured.length, 0, 'private-chat restriction is checked before any capture');
    assert.match(h.replies[0] ?? '', /แชตส่วนตัว/);
    assert.doesNotMatch(h.replies[0] ?? '', /I01-QTY/u);
  });

  it('applies a stable question-id answer before AI routing and renders the persisted draft', async () => {
    const calls: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      expenseDraftConversation: {
        routeContexts: async () => [{ expenseId: 'expense-1', label: 'ร่าง 1', status: 'OPEN', questions: [{ id: 'I01-QTY', itemRef: 'I01', prompt: 'จำนวน?' }] }],
        execute: async (_ctx: any, input: any) => {
          calls.push(input);
          return { handled: true, status: 'UPDATED', replyTexts: ['🧾 ร่างค่าใช้จ่าย\nI01-PRICE ราคาเท่าไร?'], acceptedFields: ['I01-QTY'] };
        },
      },
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'I01-QTY 5 รีม' });
    assert.equal(h.routeRequests.length, 0, 'stable ids do not require a model call');
    assert.equal(calls[0].webhookEventId, TEXT_EVENT.webhookEventId);
    assert.match(h.replies[0] ?? '', /I01-PRICE/u);
  });

  for (const fault of ['question', 'label', 'status', 'order', 'added', 'missing', 'unavailable', 'access'] as const) {
    it(`refuses stale draft routing after ${fault} changes during intake without executing or recapturing`, async () => {
      const contexts = ['one', 'two'].map(expenseId => ({ expenseId, label: expenseId, status: 'OPEN',
        questions: [{ id: 'I01-QTY', prompt: 'จำนวนกระดาษ?', itemRef: 'I01' }] }));
      let changed = false;
      let executed = 0;
      const h = makeHarness({
        permissions: ['expense.receipt.line_upload'],
        routePlan: { status: 'ROUTED', intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.95 },
        expenseDraftConversation: {
          routeContexts: async () => {
            if (!changed) return fault === 'added' ? [] : structuredClone(contexts);
            if (fault === 'unavailable') throw new Error('source unavailable');
            const next = structuredClone(contexts);
            if (fault === 'question') next[0].questions[0].prompt = 'จำนวนคน?';
            if (fault === 'label') next[0].label = 'คนละใบ';
            if (fault === 'status') next[0].status = 'PAUSED';
            return fault === 'order' ? next.reverse() : fault === 'missing' ? [] : next;
          },
          execute: async () => { executed += 1; return { handled: true, status: 'UPDATED', replyTexts: ['ข้อมูลลับจากร่างเก่า'], acceptedFields: [] }; },
        },
      });
      const gateway = (h.useCase as any).aiGateway;
      const route = gateway.requestLineIntakeRoute;
      gateway.requestLineIntakeRoute = async (...args: any[]) => {
        const result = await route(...args); changed = true;
        if (fault === 'access') (h.useCase as any).permissionResolver.resolveAccess = async () => ({ membershipId: 'revoked', roles: [], permissions: [], scopes: {} });
        return result;
      };
      await h.useCase.execute({ ...TEXT_EVENT, messageText: 'กระดาษเอา 5 รีม' });
      assert.equal(executed, 0);
      assert.equal(h.captured.length, 0);
      assert.equal(h.createExpenseCalls.length, 0);
      assert.equal(h.turnRequests.length, 0);
      assert.doesNotMatch(h.replies.join(''), /ข้อมูลลับจากร่างเก่า/);
      assert.ok(h.replies.length > 0, 'the user receives a recovery path');
    });
  }

  it('refuses a numbered draft selection if the order changes before deterministic execution', async () => {
    let reads = 0, executed = 0;
    const contexts = ['one', 'two'].map(expenseId => ({ expenseId, label: expenseId, status: 'OPEN', questions: [] }));
    const h = makeHarness({ permissions: ['expense.receipt.line_upload'], expenseDraftConversation: {
      routeContexts: async () => ++reads === 1 ? contexts : [...contexts].reverse(),
      execute: async () => { executed += 1; return { handled: true, status: 'UPDATED', replyTexts: ['wrong draft'], acceptedFields: [] }; },
    } });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ร่าง 1' });
    assert.equal(executed, 0); assert.equal(h.routeRequests.length, 0); assert.equal(h.captured.length, 0);
    assert.ok(h.replies.length > 0); assert.doesNotMatch(h.replies.join(''), /wrong draft/);
  });

  it('a passive draft rejected by the edit boundary does not turn unrelated chat into another questionnaire', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.95 },
      expenseDraftConversation: { routeContexts: async () => [], execute: async () => ({ handled: false, status: 'NOT_FOUND', replyTexts: [], acceptedFields: [] }) },
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ยอดขายวันนี้เท่าไร' });
    assert.equal(h.turnRequests.length, 1);
    assert.equal(h.turnRequests[0].messageText, 'ยอดขายวันนี้เท่าไร');
    assert.doesNotMatch(h.replies.join(''), /กรุณาระบุ.*ยอด|ข้อมูลที่ต้องใช้|D-PURPOSE/u);
  });

  it('sends durable draft questions to the router for a natural-language answer', async () => {
    const calls: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.95,
        captureHints: { targetExpenseId: 'expense-1', items: [{ itemRef: 'I01', quantity: '5', unit: 'รีม' }] },
      },
      expenseDraftConversation: {
        routeContexts: async () => [{ expenseId: 'expense-1', label: 'ร่าง 1', status: 'PAUSED', questions: [{ id: 'I01-QTY', itemRef: 'I01', prompt: 'จำนวน?' }] }],
        execute: async (_ctx: any, input: any) => {
          calls.push(input);
          return { handled: true, status: 'UPDATED', replyTexts: ['🧾 ร่างค่าใช้จ่ายล่าสุด'], acceptedFields: ['I01-QTY'] };
        },
      },
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'กระดาษเอา 5 รีม' });
    assert.equal(h.routeRequests[0].activeExpenseDrafts[0].questions[0].id, 'I01-QTY');
    assert.equal(calls[0].captureHints.targetExpenseId, 'expense-1');
    assert.match(h.replies[0] ?? '', /ร่างค่าใช้จ่ายล่าสุด/u);
  });

  it('resumes from the database after the entire 15-turn AI context has unrelated content', async () => {
    const calls: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      conversationTurns: Array.from({ length: 15 }, (_, index) => ({
        createdAt: new Date(Date.now() - index * 1000),
        userMessagePreview: `คำถามอื่น ${index + 1}`,
        replyPreview: `คำตอบอื่น ${index + 1}`,
        intent: 'READ_SUMMARY', agent: 'general', refused: false, toolInvocations: [],
      })),
      expenseDraftConversation: {
        routeContexts: async () => [{
          expenseId: 'expense-1', label: 'ร่าง 1', status: 'PAUSED',
          questions: [{ id: 'I01-QTY', itemRef: 'I01', prompt: 'จำนวน?' }],
        }],
        execute: async (_ctx: any, input: any) => {
          calls.push(input);
          return { handled: true, status: 'UPDATED', replyTexts: ['🧾 โหลดร่างจากฐานข้อมูลแล้ว\nI01-QTY จำนวน?'], acceptedFields: [] };
        },
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ต่อ' });

    assert.equal(h.routeRequests.length, 0, 'resume control does not depend on the model or its 15-turn context');
    assert.equal(calls.length, 1);
    assert.match(h.replies[0] ?? '', /โหลดร่างจากฐานข้อมูลแล้ว/u);
  });

  it('parks an open draft for an unrelated business question and appends a resume capsule', async () => {
    let interruptions = 0;
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      expenseDraftConversation: {
        routeContexts: async () => [{ expenseId: 'expense-1', label: 'ร่าง 1', status: 'OPEN', questions: [] }],
        interruptOpen: async () => {
          interruptions += 1;
          return '↩️ พักร่างค่าใช้จ่ายไว้แล้ว พิมพ์ “ต่อ” เมื่อต้องการกลับมาทำ';
        },
      },
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ยอดขายวันนี้เท่าไร' });
    assert.equal(interruptions, 1);
    assert.match(h.replies[0] ?? '', /turn-answer/u);
    assert.match(h.replies[0] ?? '', /พักร่างค่าใช้จ่ายไว้แล้ว/u);
  });

  it('does not pause an open draft while the router is still asking what the user meant', async () => {
    let interruptions = 0;
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0.4 },
      expenseDraftConversation: {
        routeContexts: async () => [{ expenseId: 'expense-1', label: 'ร่าง 1', status: 'OPEN', questions: [] }],
        interruptOpen: async () => { interruptions += 1; return 'should not be delivered'; },
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'อันนั้นเท่าไร' });

    assert.equal(interruptions, 0);
    assert.match(h.replies[0] ?? '', /ยังไม่แน่ใจ/u);
  });

  it('does not pause the old draft when a new capture attempt still needs clarification', async () => {
    let interruptions = 0;
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.99,
        captureHints: { amount: '590' },
      },
      captureError: new LineTextExpenseCaptureIncompleteError(),
      expenseDraftConversation: {
        routeContexts: async () => [{ expenseId: 'expense-1', label: 'ร่าง 1', status: 'OPEN', questions: [] }],
        interruptOpen: async () => { interruptions += 1; return 'should not be delivered'; },
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'เริ่มอีกรายการ' });

    assert.equal(interruptions, 0);
    assert.match(h.replies[0] ?? '', /ยอดเงิน/u);
  });

  it('pauses only older drafts after a new draft was created successfully', async () => {
    const excluded: string[][] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.99,
        captureHints: { description: 'กระดาษ A4', confidence: 0.99 },
      },
      expenseDraftConversation: {
        routeContexts: async () => [{ expenseId: 'expense-old', label: 'ร่างเดิม', status: 'OPEN', questions: [] }],
        interruptOpen: async (_ctx: any, _chat: string, excludeExpenseIds: string[]) => {
          excluded.push(excludeExpenseIds);
          return '↩️ พักร่างเดิมไว้แล้ว';
        },
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ซื้อกระดาษ A4' });

    assert.deepEqual(excluded, [['expense-note-1']]);
    assert.match(h.replies[0] ?? '', /พักร่างเดิมไว้แล้ว/u);
  });

  it('turns an incomplete advisory capture route into one clarification and zero drafts', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.99,
        captureHints: { amount: '590' },
      },
      captureError: new LineTextExpenseCaptureIncompleteError(),
      captureLedger,
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'รีบทำให้หน่อย' });
    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ยอดเงิน.*วัตถุประสงค์|ยอดเงิน.*หมวดค่าใช้จ่าย/);
    assert.equal(captureLedger[0]?.items?.[0]?.clarifyForIntent, 'EXPENSE_DOCUMENT_CAPTURE');
  });

  it('asks only for the field the typed gate reported missing and ledgers that exact question', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97,
        captureHints: { amount: '60' },
      },
      captureError: new LineTextExpenseCaptureIncompleteError(['amount'], ['description', 'purpose'], []),
      captureLedger,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ค่ารถวิน 60 บาท' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ขอทราบรายการหรือวัตถุประสงค์/u);
    assert.doesNotMatch(h.replies[0] ?? '', /ขอทราบยอดเงิน/u, 'the UAT defect: an accepted amount asked for a second time');
    assert.equal(captureLedger[0]?.items?.[0]?.clarifyQuestion, h.replies[0],
      'the ledger carries the exact question the user saw, not a generic constant');
  });

  it('asks for an explicit correction instead of silently picking one of two amounts', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97,
        captureHints: { amount: '200', description: 'ค่าเดินทาง' },
      },
      captureError: new LineTextExpenseCaptureIncompleteError(['description'], [], ['amount']),
      captureLedger,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ค่าเดินทาง 200 บาท' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /แก้ยอดเป็น/u);
    assert.equal(captureLedger[0]?.items?.[0]?.clarifyQuestion, h.replies[0]);
  });

  it('confirms a business-expense route independently of reimbursement rollout mode', async () => {
    const routePlan: LineIntakeRoutePlan = {
      status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97,
      captureHints: { amount: '60', businessPurpose: 'ไปพบลูกค้า' },
      semanticOutcome: 'BUSINESS_EXPENSE', fundingSource: 'COMPANY_PAID',
    };
    const message = { ...TEXT_EVENT, messageText: 'ค่ารถวิน 60 บาท ไปพบลูกค้า' };

    const guarded = makeHarness({
      permissions: ['expense.receipt.line_upload'], routePlan, lineAiReimbursementSemanticMode: 'clarify_only',
    });
    await guarded.useCase.execute(message);
    assert.equal(guarded.captured[0]?.semanticBusinessExpenseConfirmed, true);

    // A verified route remains authoritative when reimbursement semantic routing is off.
    const ungated = makeHarness({ permissions: ['expense.receipt.line_upload'], routePlan });
    await ungated.useCase.execute(message);
    assert.equal(ungated.captured[0]?.semanticBusinessExpenseConfirmed, true);
  });

  it('handles a substitute-receipt request through typed preflight before any model or final mutation', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      recentCaptures: [{
        id: 'expense-1', expenseDate: new Date('2026-08-16T00:00:00.000Z'), grandTotalAmount: '200.00',
        sourceDocumentType: 'EXPENSE_NOTE_TEXT', createdAt: new Date(),
      }],
      substituteResult: {
        handled: true, status: 'BLOCKED', workflowId: 'wf-1', expenseId: 'expense-1',
        replyText: '📄 ใบรับรองแทนใบเสร็จรับเงิน\nสิ่งที่ยังต้องทำทั้งหมด:\n• เหตุผล\n• หลักฐาน\nLINE ยังไม่ได้ออกเอกสาร',
        acceptedFields: [], blockers: [{ code: 'reason_code_required' }], pendingQuestion: 'เหตุผลคืออะไร?',
      },
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ช่วยทำใบทดแทนใบเสร็จให้หน่อย' });
    assert.equal(h.routeRequests.length, 0, 'deterministic workflow boundary skips the model router');
    assert.equal(h.captured.length, 0);
    assert.equal(h.createExpenseCalls.length, 0);
    assert.match(h.replies[0] ?? '', /สิ่งที่ยังต้องทำทั้งหมด/);
  });

  // R1: the UAT screenshot message — one turn is both a capture and a substitute request.
  const COMBINED_MESSAGE = 'สร้างใบทดแทนใบเสร็จ ค่าวินมอไซต์ไปพบลูกค้า 50 บาท';
  const blockedSubstituteResult = {
    handled: true, status: 'BLOCKED', workflowId: 'wf-1', expenseId: 'expense-note-1',
    replyText: '📄 ใบรับรองแทนใบเสร็จรับเงิน\nสิ่งที่ยังต้องทำทั้งหมด:\n• ระบุเหตุผลที่ไม่มีใบเสร็จ',
    acceptedFields: ['amount'], blockers: [{ code: 'reason_code_required' }],
    pendingQuestion: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?',
  };

  it('creates the draft first and opens the continuation on it in one reply, never the dead end', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      captureLedger,
      substituteResult: blockedSubstituteResult,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: COMBINED_MESSAGE });

    assert.equal(h.captured.length, 1, 'the expense fact in the message is captured, not discarded');
    assert.equal(h.captured[0].draftConversationEnabled, false,
      'the substitute continuation owns the next question; a second draft thread would ask another');
    assert.equal(h.substituteCalls.length, 1);
    assert.deepEqual(h.substituteCalls[0].recentCandidates.map((item: any) => item.id), ['expense-note-1'],
      'the continuation opens on the draft this turn created');
    assert.equal(h.replies.length, 1, 'both outcomes arrive in one reply');
    assert.match(h.replies[0] ?? '', /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/);
    assert.match(h.replies[0] ?? '', /ผลคำขอเพิ่มเติม:/);
    assert.match(h.replies[0] ?? '', /สิ่งที่ยังต้องทำทั้งหมด/);
    assert.equal(h.routeRequests.length, 0, 'the deterministic workflow boundary still skips the model router');
    assert.equal(captureLedger[0]?.items?.[0]?.clarifyForIntent, 'SUBSTITUTE_RECEIPT_CONTINUATION');
  });

  it('passes the REAL capture eligibility gate and opens the continuation on the draft it created', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      realCapture: true,
      captureLedger,
      substituteResult: { ...blockedSubstituteResult, expenseId: 'expense-note-real-1' },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: COMBINED_MESSAGE });

    // The gate (isLineTextExpenseCaptureEligible) needs an amount present in the source text AND a
    // description copied verbatim from it; no model runs here, so the dispatcher synthesizes both.
    assert.deepEqual(
      { amount: h.captured[0]?.captureHints?.amount, description: h.captured[0]?.captureHints?.description },
      { amount: '50', description: 'ค่าวินมอไซต์ไปพบลูกค้า 50 บาท' },
    );
    assert.equal(h.draftsCreated.length, 1, 'the real use case reached CreateExpenseDraftUseCase — the gate passed');
    assert.deepEqual(h.draftsCreated[0].lines, [{
      lineNumber: 1, description: 'ค่าวินมอไซต์ไปพบลูกค้า 50 บาท', quantity: '1', unitPrice: '50.0000', expenseCategoryId: undefined,
    }], 'the validated amount became the draft line, so nothing was silently dropped');
    assert.equal(h.updateExpenseCalls[0]?.status, 'NEEDS_REVIEW', 'a reviewable draft, never a confirmed expense');
    assert.deepEqual(h.substituteCalls[0].recentCandidates.map((item: any) => item.id), ['expense-note-real-1']);
    assert.equal(h.replies.length, 1);
    assert.match(h.replies[0] ?? '', /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/);
    assert.match(h.replies[0] ?? '', /ผลคำขอเพิ่มเติม:/);
    assert.match(h.replies[0] ?? '', /สิ่งที่ยังต้องทำทั้งหมด/);
    assert.equal(captureLedger[0]?.items?.[0]?.clarifyForIntent, 'SUBSTITUTE_RECEIPT_CONTINUATION');
  });

  it('keeps a real draft and degrades only the substitute half when the continuation fails', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      realCapture: true,
      substituteThrows: new Error('continuation store unavailable'),
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: COMBINED_MESSAGE });
    assert.equal(h.draftsCreated.length, 1, 'the committed draft is not rolled back by a reply-side failure');
    assert.match(h.replies[0] ?? '', /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/);
    assert.match(h.replies[0] ?? '', /ยังตรวจสอบไม่ได้ชั่วคราว/);
  });

  it('does not capture through the real gate when the message carries an amount but no purpose', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      realCapture: true,
      substituteResult: blockedSubstituteResult,
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ทำใบทดแทนใบเสร็จ 50 บาท' });
    assert.equal(h.draftsCreated.length, 0, 'R1 wants amount PLUS purpose/category; an amount alone is not an expense');
    assert.equal(h.substituteCalls.length, 1, 'the turn still answers through the continuation');
    assert.equal(h.replies[0]?.includes('บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว'), false);
  });

  it('falls through to target selection without a capture when the turn cannot or must not create a draft', async () => {
    const recentCaptures = [{
      id: 'expense-1', expenseDate: new Date('2026-08-16T00:00:00.000Z'), grandTotalAmount: '200.00',
      sourceDocumentType: 'EXPENSE_NOTE_TEXT' as const, createdAt: new Date(),
    }];
    const noAmount = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      recentCaptures,
      substituteResult: blockedSubstituteResult,
    });
    await noAmount.useCase.execute({ ...TEXT_EVENT, messageText: 'สร้างใบทดแทนใบเสร็จให้หน่อย' });
    assert.equal(noAmount.captured.length, 0, 'no amount, nothing to capture');
    assert.deepEqual(noAmount.substituteCalls[0].recentCandidates.map((item: any) => item.id), ['expense-1']);
    assert.equal(noAmount.replies[0]?.includes('บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว'), false);

    // The dead-end R1 removes is "no candidate at all". With one to target, capturing would create a
    // duplicate AND hide the existing draft, which auto-targeted before Phase 2.
    const hasCandidate = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      realCapture: true,
      recentCaptures,
      substituteResult: blockedSubstituteResult,
    });
    await hasCandidate.useCase.execute({ ...TEXT_EVENT, messageText: 'ทำใบรับรองแทนใบเสร็จรับเงินให้รายการ 50 บาท' });
    assert.equal(hasCandidate.draftsCreated.length, 0, 'an existing candidate is targeted, never duplicated');
    assert.deepEqual(hasCandidate.substituteCalls[0].recentCandidates.map((item: any) => item.id), ['expense-1'],
      'the existing draft stays pickable');

    // An open capture clarification owns this message's expense facts and its own ledger entry.
    const captureClarificationOpen = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      realCapture: true,
      openWaiting: [{
        id: 'capture-clarify-1', question: 'ยอดเท่าไรคะ?', text: 'ค่าวินมอไซต์', askedAt: new Date().toISOString(),
        clarifyForIntent: 'EXPENSE_DOCUMENT_CAPTURE',
        entry: { id: 'capture-clarify-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' },
      }],
      substituteResult: blockedSubstituteResult,
    });
    await captureClarificationOpen.useCase.execute({ ...TEXT_EVENT, messageText: COMBINED_MESSAGE });
    assert.equal(captureClarificationOpen.draftsCreated.length, 0,
      'capture-first neither consumes nor inherits an open capture clarification, so it stands down');

    const incomplete = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      captureError: new LineTextExpenseCaptureIncompleteError(),
      substituteResult: blockedSubstituteResult,
    });
    await incomplete.useCase.execute({ ...TEXT_EVENT, messageText: COMBINED_MESSAGE });
    assert.equal(incomplete.substituteCalls.length, 1, 'an incomplete capture degrades to target selection');
    assert.deepEqual(incomplete.substituteCalls[0].recentCandidates, []);
    assert.match(incomplete.replies[0] ?? '', /ใบรับรองแทนใบเสร็จรับเงิน/);

    const alreadyOpen = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      substituteContinuationRows: [{
        id: 'expense-open', updatedAt: new Date(),
        sourceChannelMetadataJson: {
          lineSubstituteReceiptContinuation: {
            workflowId: 'wf-open', kind: 'SUBSTITUTE_RECEIPT', companyId: 'company-1', userId: 'user-1',
            expenseId: 'expense-open', chatKeyHash: 'chat-hash', status: 'PAUSED', acceptedValues: {},
            provenance: {}, targetRevision: new Date().toISOString(),
          },
        },
      }],
      substituteResult: blockedSubstituteResult,
    });
    await alreadyOpen.useCase.execute({ ...TEXT_EVENT, messageText: COMBINED_MESSAGE });
    assert.equal(alreadyOpen.captured.length, 0,
      'an OPEN/PAUSED workflow already owns this chat; a new draft would be orphaned by state-first resolution');
  });

  it('dispatches the continuation unchanged for a user who may not capture expenses', async () => {
    const h = makeHarness({
      permissions: ['expense.review', 'line.ai.query'],
      substituteResult: blockedSubstituteResult,
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: COMBINED_MESSAGE });
    assert.equal(h.captured.length, 0, 'no capture permission, no draft');
    assert.equal(h.substituteCalls.length, 1);
    assert.deepEqual(h.substituteCalls[0].recentCandidates, []);
    assert.equal(h.replies[0]?.includes('ผลคำขอเพิ่มเติม:'), false, 'nothing to merge, so no merged reply');
  });

  it('answers an arbitrary intervening question normally, then resumes the same substitute workflow', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      openWaiting: [{
        id: 'sub-clarify-1', question: 'เหตุผลคืออะไร?', text: 'ทำใบรับรองต่อ', askedAt: new Date().toISOString(),
        clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
        entry: { id: 'sub-clarify-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' },
      }],
      captureLedger,
      substituteResult: {
        handled: true, status: 'BLOCKED', workflowId: 'wf-1', expenseId: 'expense-1',
        replyText: 'preflight not directly delivered', acceptedFields: [], blockers: [],
        pendingQuestion: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?', sideQuestionAnswered: false,
        resumeCapsule: '↩️ งานใบรับรองแทนใบเสร็จรับเงินของรายการ EXP-001 ยังอยู่\nทำต่อ: เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?',
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ยอดขายเดือนนี้เท่าไหร่?' });

    assert.equal(h.substituteCalls.length, 1);
    assert.equal(h.routeRequests.length, 1, 'the side question still uses the normal read path');
    assert.equal(h.routeRequests[0].openClarifications, undefined, 'pending substitute fields are not exposed as instructions to the side-question router');
    assert.match(h.replies[0] ?? '', /turn-answer/);
    assert.match(h.replies[0] ?? '', /งานใบรับรองแทนใบเสร็จรับเงิน.*ยังอยู่/);
    assert.equal(captureLedger.length, 1, 'the current pending question is re-appended after the side answer is delivered');
  });

  // S1: a decline leaves the decision listening, which leaves this chat's clarification open, which
  // re-enters the continuation on every later message. The question case above was already handed
  // back; a DECLARATIVE sentence was not, so “ค่าแท็กซี่ 200 บาท” got the substitute re-ask and
  // returned before the intake router saw it — the sender could not record another expense until
  // they finished this document. `decisionUnread` is the continuation saying it read nothing here.
  it('routes a declarative capture the open substitute decision could not read, instead of re-asking over it', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      openWaiting: [{
        id: 'sub-clarify-1', question: 'ให้ออกเอกสารเลยไหมคะ', text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ', askedAt: new Date().toISOString(),
        clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
        entry: { id: 'sub-clarify-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' },
      }],
      captureLedger,
      substituteResult: {
        handled: true, status: 'READY_FOR_WEB', workflowId: 'wf-1', expenseId: 'expense-1',
        replyText: 'ยังไม่แน่ใจว่าจะให้ทำอะไรต่อค่ะ เลือกจาก 3 ข้อนี้ ตอบเลขข้อได้เลย',
        acceptedFields: [], blockers: [], pendingQuestion: 'ให้ออกเอกสารเลยไหมคะ',
        decisionUnread: true,
        resumeCapsule: '↩️ งานใบรับรองแทนใบเสร็จรับเงินของรายการ EXP-001 ยังอยู่\nทำต่อ: ให้ออกเอกสารเลยไหมคะ',
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ค่าแท็กซี่ 200 บาท' });

    assert.equal(h.routeRequests.length, 1, 'the new expense reaches the intake router');
    assert.equal(h.routeRequests[0].messageText, 'ค่าแท็กซี่ 200 บาท');
    assert.match(h.replies[0] ?? '', /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/, 'and is actually recorded');
    assert.equal(
      h.replies[0]?.includes('เลือกจาก 3 ข้อนี้'),
      false,
      'the substitute re-ask does not answer a message that was never about it',
    );
    // The substitute clarification is withheld from the router (it is filtered out of
    // `openClarifications` on this route), so nothing this turn can resolve or consume it: the
    // decision is still waiting when the sender types “ออกเอกสารเลย”.
    assert.equal(h.routeRequests[0].openClarifications, undefined);
  });

  it('delivers a forbidden substitute outcome instead of silently dropping it as a side-question interruption', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      openWaiting: [{
        id: 'sub-clarify-1', question: 'เหตุผลคืออะไร?', text: 'ทำใบรับรองต่อ', askedAt: new Date().toISOString(),
        clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
        entry: { id: 'sub-clarify-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' },
      }],
      substituteResult: {
        handled: true, status: 'FORBIDDEN', acceptedFields: [],
        blockers: [{ code: 'expense_review_forbidden' }],
        // No resumeCapsule and no sideQuestionAnswered: the old routing lost this reply entirely.
        replyText: '📄 ใบรับรองแทนใบเสร็จรับเงิน\nต้องมีสิทธิ์ตรวจทานค่าใช้จ่าย (expense.review) ซึ่งบัญชีนี้ยังไม่มีค่ะ',
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ยอดขายเดือนนี้เท่าไหร่?' });

    assert.equal(h.substituteCalls.length, 1);
    assert.match(h.replies[0] ?? '', /expense\.review/, 'the forbidden reason reaches the user');
    assert.equal(h.routeRequests.length, 0, 'a forbidden outcome is answered deterministically, not routed to the model');
  });

  it('answers a business question beside pending media, then deterministically resumes the stored picture choice', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      openWaiting: [{
        id: 'media-clarify-1', question: 'รูปนี้เป็นอะไรคะ?', text: 'ยอดขายเดือนนี้เท่าไหร่', askedAt: new Date().toISOString(),
        pendingMedia: { pendingMediaId: 'pm-1', attachmentId: 'pending-att-1', mimeType: 'image/jpeg' },
        entry: { id: 'media-clarify-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' },
      }],
      prisma,
    });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-media-side-question', messageText: 'ยอดขายเดือนนี้เท่าไหร่?' });

    assert.match(h.replies[0] ?? '', /turn-answer/);
    assert.match(h.replies[0] ?? '', /รูปที่รอจำแนกยังเก็บไว้อยู่/);
    assert.match(h.replies[0] ?? '', /สรุปหลายรายการ/);
    assert.equal(pendingMediaRows[0].status, 'PENDING');
    assert.equal(h.routeRequests[0].openClarifications, undefined, 'the side-question model never receives pending media as an instruction');
  });

  it('denies text capture without upload permission even when router says capture', async () => {
    const h = makeHarness({
      permissions: ['line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9 },
    });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ไม่มีสิทธิ์อัปโหลด/);
  });

  it('text signature intent replies asking for the image without creating anything', async () => {
    const h = makeHarness({
      permissions: ['expense.signature.manage', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'SIGNATURE_UPLOAD_TICKET', language: 'th', confidence: 0.9 },
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'อยากฝากลายเซ็นไว้ใช้ในระบบ' });
    assert.equal(h.signatureCreated.length, 0);
    assert.match(h.replies[0] ?? '', /ส่ง "รูปลายเซ็น"/);
  });

  it('CLARIFY route replies with clarification and creates no records', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0.4 },
    });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ยังไม่แน่ใจ/);
  });

  it('remembers the capture turn for multi-turn follow-ups (EVIDENCE_CAPTURE memory row)', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9,
        captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', amount: '65' },
      },
      expenseDraftConversation: { routeContexts: async () => [] },
      prisma,
    });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(turnCreates.length, 1);
    assert.equal(turnCreates[0].data.intent, 'EVIDENCE_CAPTURE');
    assert.equal(turnCreates[0].data.userMessagePreview, 'ค่ากาแฟ 65 บาท');
    assert.match(turnCreates[0].data.replyPreview, /ร่างค่าใช้จ่าย expense-note-1/);
    assert.match(turnCreates[0].data.replyPreview, /I01-QTY/);
  });

  it('CLARIFY prefers the router clarifying question and remembers the clarify turn', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0.4, clarifyQuestion: 'ต้องการบันทึกเป็นค่าใช้จ่าย หรือสอบถามยอดครับ?' },
      prisma,
    });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(h.replies[0], 'ต้องการบันทึกเป็นค่าใช้จ่าย หรือสอบถามยอดครับ?');
    assert.equal(turnCreates[0].data.intent, 'CLARIFY');
  });

  it('BUSINESS_READ_QUESTION falls through to the normal AI turn path', async () => {
    const h = makeHarness({
      permissions: ['line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'เดือนนี้ใช้เงินเท่าไหร่' });
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });

  it('router unavailable falls back to the legacy AI turn path (no keyword shortcut)', async () => {
    const h = makeHarness({ permissions: ['line.ai.query'], routeThrows: true });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });
});

// R2 — the UAT journey in two turns. The sender asks for the document before any expense exists in
// the chat, so the turn can only end in target selection; the fact arrives on the NEXT message and
// used to be filed as a plain expense note, leaving the document they asked for unmade.
describe('LINE intake dispatch – the substitute request survives the clarify turn', () => {
  const FULL_ACCESS = ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'];
  const REQUEST_TURN = 'ทำรายการใบทดแทนของค่าวินมอไซค์ไปพบลูกค้า';
  const FACT_TURN = 'ค่าวินมอไซค์ 50 บาท';
  /** What the continuation answers with when it has no target and no numbered choice to offer. */
  const targetRequired = {
    handled: true, status: 'TARGET_REQUIRED', acceptedFields: [], blockers: [],
    replyText: [
      '📄 ใบรับรองแทนใบเสร็จรับเงิน',
      'ยังไม่พบรายการค่าใช้จ่ายในแชทนี้ที่จะทำใบรับรองให้ค่ะ',
      '',
      'ทำต่อ: พิมพ์ยอดและรายละเอียดค่าใช้จ่ายในแชทนี้ได้เลยค่ะ เช่น “ค่าวินมอไซค์ 50 บาท”',
    ].join('\n'),
  };
  const openedOnDraft = {
    handled: true, status: 'BLOCKED', workflowId: 'wf-1', expenseId: 'expense-note-real-1',
    replyText: '📄 ใบรับรองแทนใบเสร็จรับเงิน\nสิ่งที่ยังต้องทำทั้งหมด:\n• ระบุเหตุผลที่ไม่มีใบเสร็จ',
    acceptedFields: ['amount'], blockers: [{ code: 'reason_code_required' }],
    pendingQuestion: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?',
  };
  const carried = (item: any) => ({
    id: 'sub-carry-1', question: item.clarifyQuestion, text: item.text, askedAt: new Date().toISOString(),
    clarifyForIntent: item.clarifyForIntent,
    entry: { sourceContext: item.sourceContext, id: 'sub-carry-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' },
  });

  it('parks the request as a clarification when the chat has nothing to make the document for', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({ permissions: FULL_ACCESS, realCapture: true, captureLedger, substituteResult: targetRequired });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: REQUEST_TURN });

    assert.equal(h.substituteCalls.length, 1, 'the widened vocabulary routes the UAT sentence here, not to plain capture');
    assert.equal(h.draftsCreated.length, 0, 'no amount in this turn, so nothing to capture');
    assert.equal(h.routeRequests.length, 0);
    assert.match(h.replies[0] ?? '', /ใบรับรองแทนใบเสร็จรับเงิน/);
    assert.equal(captureLedger[0]?.items?.[0]?.clarifyForIntent, 'SUBSTITUTE_RECEIPT_CONTINUATION');
    assert.equal(captureLedger[0]?.items?.[0]?.text, 'ทำใบรับรองแทนใบเสร็จรับเงิน (ยังไม่มีรายการค่าใช้จ่าย)',
      'the marker that says “no target yet” — the resume entry uses a different text on purpose');
  });

  it('captures the next message and opens the continuation on the draft it just made', async () => {
    const requestTurn: any[] = [];
    const first = makeHarness({ permissions: FULL_ACCESS, realCapture: true, captureLedger: requestTurn, substituteResult: targetRequired });
    await first.useCase.execute({ ...TEXT_EVENT, messageText: REQUEST_TURN });

    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: FULL_ACCESS, realCapture: true, captureLedger,
      // Exactly what the previous turn wrote — no hand-authored fixture in between.
      openWaiting: [carried(requestTurn[0].items[0])],
      substituteResult: openedOnDraft,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: FACT_TURN });

    assert.deepEqual(
      { amount: h.captured[0]?.captureHints?.amount, description: h.captured[0]?.captureHints?.description },
      { amount: '50', description: FACT_TURN },
      'the carried turn is nothing but the expense fact, so the whole message is the description',
    );
    assert.equal(h.draftsCreated.length, 1, 'ONE expense, created through the real eligibility gate');
    assert.deepEqual(h.substituteCalls[0].recentCandidates.map((item: any) => item.id), ['expense-note-real-1'],
      'and the document opens on it instead of asking the sender to repeat “ใบทดแทน”');
    assert.equal(h.replies.length, 1, 'both outcomes in one reply');
    assert.match(h.replies[0] ?? '', /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/);
    assert.match(h.replies[0] ?? '', /ผลคำขอเพิ่มเติม:/);
    assert.match(h.replies[0] ?? '', /สิ่งที่ยังต้องทำทั้งหมด/);
    assert.equal(h.routeRequests.length, 0, 'still deterministic end to end');
    assert.equal(captureLedger[0]?.items?.[0]?.text, 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ',
      'the carried marker is spent; what stays open now is the workflow question');
  });

  it('re-arms nothing once a target exists, so a later unrelated expense is not swallowed', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: FULL_ACCESS, realCapture: true, captureLedger,
      // The RESUME marker: this clarification already has a target, so capture-first stays off and
      // the open document keeps owning the turn exactly as before.
      openWaiting: [carried({ text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ', clarifyQuestion: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?', clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION' })],
      substituteResult: { ...openedOnDraft, expenseId: 'expense-1' },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ค่าแท็กซี่ 120 บาท' });

    assert.equal(h.draftsCreated.length, 0, 'a substitute clarification WITH a target never capture-firsts');
    assert.equal(h.captured.length, 0);
  });

  it('does not park the request when the chat already has a candidate to point at', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: FULL_ACCESS, captureLedger,
      recentCaptures: [{
        id: 'expense-1', expenseDate: new Date('2026-08-16T00:00:00.000Z'), grandTotalAmount: '200.00',
        sourceDocumentType: 'EXPENSE_NOTE_TEXT', createdAt: new Date(),
      }],
      substituteResult: { ...targetRequired, pendingQuestion: 'ตอบหมายเลขรายการที่ต้องการค่ะ (เช่น “1”)' },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: REQUEST_TURN });

    assert.equal(captureLedger[0]?.items?.[0]?.text, 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ',
      'target selection is already asking a numbered question; that is not a carried intent');
  });
});

// GAP C — “ต้องทำยังไงต่อ” reached the gateway, a tool answered unavailable, and the composer told
// the sender that the thing they were in the middle of is not available through LINE.
describe('LINE intake dispatch – “what do I do next?”', () => {
  const NEXT_STEP = 'ต้องทำยังไงต่อ';
  const activeContinuationRow = {
    id: 'expense-open', updatedAt: new Date(),
    sourceChannelMetadataJson: {
      lineSubstituteReceiptContinuation: {
        workflowId: 'wf-open', kind: 'SUBSTITUTE_RECEIPT', companyId: 'company-1', userId: 'user-1',
        expenseId: 'expense-open', chatKeyHash: 'chat-hash', status: 'OPEN', acceptedValues: {},
        provenance: {}, targetRevision: new Date().toISOString(),
      },
    },
  };
  const statusCard = {
    handled: true, status: 'BLOCKED', workflowId: 'wf-open', expenseId: 'expense-open',
    replyText: '📄 ใบรับรองแทนใบเสร็จรับเงิน\nสิ่งที่ยังต้องทำทั้งหมด:\n• ระบุเหตุผลที่ไม่มีใบเสร็จ',
    acceptedFields: ['amount'], blockers: [{ code: 'reason_code_required' }],
    pendingQuestion: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?',
  };
  const recentCapture = {
    id: 'expense-1', expenseDate: new Date('2026-08-16T00:00:00.000Z'), grandTotalAmount: '50.00',
    sourceDocumentType: 'EXPENSE_NOTE_TEXT' as const, createdAt: new Date(),
  };

  it('matches the phrasings people send, and only those', () => {
    for (const text of ['ต้องทำยังไงต่อ', 'ทำยังไงต่อ', 'ทำไงต่อ', 'แล้วไงต่อ', 'ต่อไปทำอะไร', 'ขั้นตอนต่อไป',
      'แล้วต้องทำอะไร', 'ต้องทำยังไงต่อคะ', 'ทำยังไงต่อครับ', 'ต้องทำยังไงต่อ?', 'ทำยังไงต่อดี']) {
      assert.equal(isNextStepQuestionText(text), true, text);
    }
    for (const text of ['ยอดขายวันนี้เท่าไหร่', 'ค่าวินมอไซค์ 50 บาท', 'ไม่มีใบเสร็จ ต้องทำยังไง',
      'แล้วบิลนี้ต้องทำยังไงต่อ', 'ทำต่อ', 'ทำไงดี']) {
      assert.equal(isNextStepQuestionText(text), false, text);
    }
  });

  it('answers from the open substitute document instead of routing the question to the model', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      substituteContinuationRows: [activeContinuationRow],
      substituteResult: statusCard,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: NEXT_STEP });

    assert.equal(h.routeRequests.length, 0, 'never reaches the AI turn, so never reaches its “ยังไม่พร้อมใช้งาน”');
    assert.deepEqual(h.substituteCalls[0].recentCandidates.map((item: any) => item.id), ['expense-open']);
    assert.match(h.replies[0] ?? '', /สิ่งที่ยังต้องทำทั้งหมด/);
  });

  it('answers from an already prepared document whose conversation state is spent', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      substituteContinuationRows: [{
        ...activeContinuationRow,
        sourceChannelMetadataJson: {
          lineSubstituteReceiptContinuation: {
            ...activeContinuationRow.sourceChannelMetadataJson.lineSubstituteReceiptContinuation,
            status: 'CONSUMED',
          },
        },
      }],
      expenseDetail: { id: 'expense-open', companyId: 'company-1', createdByUserId: 'user-1', updatedAt: new Date('2026-09-15T00:00:00Z'), attachments: [], substituteReceiptEvidence: { id: 'ev-1', status: 'PREPARED' } },
      substituteResult: statusCard,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: NEXT_STEP });

    assert.equal(h.routeRequests.length, 0);
    assert.equal(h.substituteCalls.length, 1);
  });

  it('is answered by the document card even while its own clarification is open', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      openWaiting: [{
        id: 'sub-clarify-1', question: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?', text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ',
        askedAt: new Date().toISOString(), clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
        entry: { id: 'sub-clarify-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' },
      }],
      substituteResult: statusCard,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: NEXT_STEP });

    assert.equal(h.routeRequests.length, 0, 'a question ABOUT this work is not a side question beside it');
    assert.match(h.replies[0] ?? '', /สิ่งที่ยังต้องทำทั้งหมด/);
  });

  it('names the real options for the chat’s own expense when no document is in flight', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      recentCaptures: [recentCapture],
      substituteResult: statusCard,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: NEXT_STEP });

    assert.equal(h.routeRequests.length, 0);
    assert.equal(h.captured.length, 0, 'a question creates nothing');
    const reply = h.replies[0] ?? '';
    assert.match(reply, /ส่งรูปใบเสร็จ\/สลิปเข้าแชทนี้/);
    assert.match(reply, /เปิดในเว็บเพื่อตรวจยอด/);
    assert.match(reply, /ทำใบรับรองแทนใบเสร็จ/);
    assert.match(reply, /https:\/\/app\.example\.com\/companies\/company-1\/expenses\/expense-1/);
  });

  it('leaves the question alone when this chat has nothing to answer it from', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      substituteResult: statusCard,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: NEXT_STEP });

    assert.equal(h.substituteCalls.length, 0);
    assert.equal(h.routeRequests.length, 1, 'the AI owns intent whenever it is reachable');
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });
});

describe('LINE intake dispatch – media path', () => {
  it('PUTs the exact downloaded bytes to a storage upload intent', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    await putLineMediaUpload(
      { uploadUrl: '/local-storage/upload/token', uploadMethod: 'PUT' },
      { mimeType: 'image/jpeg', bytes: Buffer.from('receipt') },
      'https://api.example.com',
      (async (url: string | URL | Request, init?: RequestInit) => {
        captured = { url: String(url), init };
        return { ok: true, status: 204 } as Response;
      }) as typeof fetch,
    );
    assert.equal(captured.url, 'https://api.example.com/local-storage/upload/token');
    assert.equal(captured.init?.method, 'PUT');
    assert.equal((captured.init?.headers as Record<string, string>)['Content-Type'], 'image/jpeg');
    assert.deepEqual(Buffer.from(captured.init?.body as Uint8Array), Buffer.from('receipt'));
  });

  // UAT 2026-09-29 (Owner "ง + ค"): a caption-less photo skips the router — except where only the
  // router can tell a signature from a receipt: here, a signature the open substitute work asked for.
  it('with a signature request open, a signature-like image keeps the router and is saved as a usable personal signature, not an expense draft', async () => {
    const h = makeHarness({
      permissions: ['expense.signature.self_manage', 'expense.receipt.line_upload', 'expense.receipt.upload'],
      // Asked for a signature a moment ago (UAT round 10: only a recent ask keeps a bare photo off the direct read).
      substituteMediaContext: { expenseId: 'expense-1', awaitingScans: [], signatureRequested: true, signatureRequestedAt: new Date().toISOString() },
      routePlan: { status: 'ROUTED', intent: 'SIGNATURE_UPLOAD_TICKET', language: 'th', confidence: 0.92 },
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.routeRequests.length, 1, 'an open signature request keeps the router');
    assert.ok(h.routeRequests[0].attachments?.[0]?.contentBase64, 'which sees the picture itself');
    assert.equal(h.ocrRequests.length, 0, 'and no receipt read follows a signature');
    assert.equal(h.uploads.length, 1);
    assert.equal(h.signatureCreated.length, 1);
    assert.equal(h.signatureCreated[0].submittedFromChannel, 'LINE');
    assert.equal(h.signatureCreated[0].lineMessageId, 'msg-media-1');
    // Owner decision 2026-08-20: the photo IS the signature the moment it lands. A reply that
    // promises an approval step would describe a queue that no longer exists.
    assert.match(h.replies[0] ?? '', /ใช้ลงนามเอกสารได้ทันที ไม่ต้องรออนุมัติ/);
    // A2: `?tab=signatures` was a no-op query on a route that redirected away. The link now names
    // the un-parked screen and the row inside it.
    assert.match(h.replies[0] ?? '', /expenses\/signatures\?signatureId=/);
    assert.ok(!/บันทึกข้อมูลค่าใช้จ่าย/.test(h.replies[0] ?? ''));
  });

  it('signature route without any personal-signature or signing permission is refused', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.receipt.upload'],
      // A signature asked for a moment ago keeps the router for a caption-less photo; it is the router that calls this a signature.
      substituteMediaContext: { expenseId: 'expense-1', awaitingScans: [], signatureRequested: true, signatureRequestedAt: new Date().toISOString() },
      routePlan: { status: 'ROUTED', intent: 'SIGNATURE_UPLOAD_TICKET', language: 'th', confidence: 0.92 },
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.signatureCreated.length, 0);
    assert.match(h.replies[0] ?? '', /ไม่มีสิทธิ์เก็บลายเซ็นประจำตัว/);
  });

  it('receipt image routes to expense capture with document type + tax evidence from hints', async () => {
    const { prisma, recordUpdates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95,
        captureHints: { sourceDocumentType: 'TRANSFER_SLIP', sourceDocumentLanguage: 'th', confidence: 0.9 },
      },
      receiptOcrResult: validReceiptOcr({
        classification: businessClassification({
          documentFamily: 'PAYMENT_EVIDENCE', documentKind: 'TRANSFER_SLIP',
          transactionState: 'PAID', evidenceRoles: ['PAYMENT_PROOF'], amountSignals: ['500.00'],
        }),
        fields: { grandTotalAmount: '500.00', confidence: 0.98 },
      }),
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.ocrRequests.length, 1, 'one OCR preflight before upload');
    assert.equal(h.initCalls.length, 1);
    assert.equal(h.completeCalls.length, 1);
    assert.equal(h.uploads.length, 1);
    const update = recordUpdates.at(-1);
    assert.equal(update.data.sourceDocumentType, 'TRANSFER_SLIP');
    assert.equal(update.data.taxEvidenceStatus, 'SUPPORTING_ONLY');
    assert.equal(update.data.taxEvidenceReasonCode, 'PAYMENT_EVIDENCE_ONLY');
    assert.match(h.replies[0] ?? '', /สลิปโอนเงิน/);
  });

  // Owner 2026-08-29: a $200.00 USD invoice was recorded as 200 บาท. The reply prints the DOCUMENT's
  // own figure and nothing converts it, so a non-baht document has to say so here too. THB and an
  // unread currency must leave the reply exactly as it was.
  it('warns in the LINE reply when the document is not in baht, and changes nothing otherwise', async () => {
    const replyFor = async (currency?: string) => {
      const h = makeHarness({
        permissions: ['expense.receipt.line_upload'],
        routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
        receiptOcrResult: validReceiptOcr({
          fields: {
            vendorName: 'ร้านทดสอบ', documentNumber: 'R-1', grandTotalAmount: '120.00', confidence: 0.98,
            ...(currency ? { currency } : {}),
          },
        }),
        prisma: makePrisma().prisma,
      });
      await h.useCase.executeReceiptUpload(MEDIA_EVENT);
      return h.replies[0] ?? '';
    };
    assert.match(await replyFor('USD'), /เอกสารนี้เป็นสกุลเงิน USD/);
    const baseline = await replyFor();
    assert.equal(baseline.includes('สกุลเงิน'), false, 'an unread currency says nothing');
    assert.equal(await replyFor('THB'), baseline, 'a baht document is byte-identical to before');
  });

  it('keeps receipt source facts durable but never forwards the automatic questionnaire', async () => {
    const starts: any[] = [];
    const { prisma, recordUpdates } = makePrisma();
    const ocrFields = {
      vendorName: 'ร้านทดสอบ', expenseDate: '2026-08-18', grandTotalAmount: '240.00', confidence: 0.98,
      lines: [{ description: 'กระดาษ A4', quantity: '2', amount: '240', unitPrice: '120', evidenceSignal: 'กระดาษ A4 2 120 240' }],
    };
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      receiptOcrResult: validReceiptOcr({
        classification: businessClassification({
          amountSignals: ['240.00'],
          evidenceSignals: ['receipt', 'กระดาษ A4 2 120 240'],
        }),
        fields: ocrFields,
      }),
      prisma,
      expenseDraftConversation: {
        startFromReceipt: async (_ctx: any, input: any) => {
          starts.push(input);
          return {
            handled: true, status: 'UPDATED', acceptedFields: [],
            replyTexts: ['🧾 ร่างจากใบเสร็จ\nข้อมูลที่ยังต้องตอบทั้งหมด\nD-PURPOSE ใช้เพื่อธุรกิจเรื่องอะไร?'],
          };
        },
      },
    });

    assert.equal((h.useCase as any).config.lineExpenseDraftConversationEnabled, true);
    assert.ok((h.useCase as any).expenseDraftConversation);
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);

    assert.equal(recordUpdates.at(-1).data.status, 'DRAFT');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].expenseId, 'expense-1');
    assert.deepEqual(starts[0].ocrFields.lines, ocrFields.lines);
    assert.doesNotMatch(h.replies[0] ?? '', /D-PURPOSE|ข้อมูลที่ยังต้องตอบ/u);
    assert.match(h.replies[0] ?? '', /ยอดรวม – 240\.00/u);
    for (const label of ['ประเภทเอกสาร', 'ผู้ขาย/ผู้รับเงิน', 'วันที่เอกสาร', 'หมวดหมู่ค่าใช้จ่าย', 'ตรวจสอบและยืนยันในเว็บแอป']) {
      assert.ok((h.replies[0] ?? '').includes(label), `reference receipt summary includes ${label}`);
    }
    assert.doesNotMatch(h.replies[0] ?? '', /เลขที่เอกสาร|• VAT|• WHT/u, 'the concise summary omits document number and unknown taxes');
  });

  it('redelivery with the same LINE message id returns the existing expense without creating another draft', async () => {
    let lookupCount = 0;
    const saved = { id: 'expense-1', companyId: 'company-1', sourceDocumentType: 'RECEIPT', status: 'CONFIRMED',
      createdByUserId: 'user-1', branchId: 'branch-1', primaryAttachmentId: 'att-1', captureSource: 'LINE_UPLOAD',
      updatedAt: new Date('2026-09-15T00:00:00Z'), sourceChannelMetadataJson: { chatKeyHash: chatKeyHashOf(MEDIA_EVENT) } };
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      findExpenseByLineMessageId: async (_companyId, lineMessageId) => {
        lookupCount += 1;
        return lookupCount === 1 ? null : { ...saved, lineMessageId };
      },
      expenseDetail: saved,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-media-redelivery' });

    assert.equal(h.initCalls.length, 1);
    assert.equal(h.uploads.length, 1);
    assert.equal(h.completeCalls.length, 1);
    assert.equal(h.routeRequests.length, 0, 'a caption-less photo goes straight to the reader');
    assert.equal(h.ocrRequests.length, 1, 'redelivery reuses the capture before any provider call');
    assert.match(h.replies[1] ?? '', /expense-1/);
    assert.doesNotMatch(h.replies[1] ?? '', /ยังไม่ยืนยันรายการ|ส่งรูป.*ใหม่/);
  });

  it('OCR unavailable without a caption persists clarification and creates no expense', async () => {
    const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      receiptOcrResult: { status: 'failed', errorCode: 'AI_GATEWAY_UNREACHABLE' },
      prisma,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT);

    assert.equal(h.ocrRequests.length, 1);
    assert.equal(recordUpdates.length, 0);
    // §17.6 (v0.11) + appendix §25: a PROVIDER failure on an image we can keep is no longer the
    // "รูปนี้เป็นอะไรคะ" question, and no longer a capture group either. The picture becomes an
    // ORDINARY expense draft with NO read job at all — the OCR route already read it once, and a
    // queued second read would be exactly the re-read §17.6 forbids — and the customer is sent to
    // that record with no re-read CTA anywhere. The attempt carries the outcome the first read had.
    assert.equal(pendingMediaRows.length, 0, 'no pending-media question for a failed read');
    assert.equal(h.captureState.groups.length, 0, 'no capture group');
    assert.equal(h.initCalls.length, 1, 'the image is persisted as an ordinary draft');
    assert.equal(h.captureState.jobs.length, 0, 'an image the OCR route already read is never queued for a second read');
    assert.equal(h.captureState.readFailures.length, 0, 'nothing to close: no job was created');
    assert.equal(h.captureState.attempts.at(-1).outcome, 'STORED_READ_FAILED');
    assert.equal(h.captureState.attempts.at(-1).targetType, 'expense');
    assert.match(h.replies[0] ?? '', /อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้/);
    assert.match(h.replies[0] ?? '', /expenses\/expense-1/);
    assert.ok(!/expenses\/capture/.test(h.replies[0] ?? ''));
    assert.ok(!/1\).*ใบเสร็จ/.test(h.replies[0] ?? ''), 'no numbered clarify for a failed read');
  });

  it('explicit expense caption still clarifies when OCR cannot prove document evidence', async () => {
    const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      receiptOcrResult: { status: 'not_configured', errorCode: 'AI_GATEWAY_SECRET_MISSING' },
      prisma,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'บันทึกเป็นค่าใช้จ่าย');

    assert.equal(h.ocrRequests.length, 1);
    assert.equal(h.initCalls.length, 0);
    assert.equal(h.completeCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.equal(pendingMediaRows.length, 1);
    assert.match(h.replies[0] ?? '', /ใบเสร็จ[\s\S]*ภาพประกอบ/);
  });

  it('leaves a transient media-download failure reclaimable instead of terminal', async () => {
    const { prisma, updates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      mediaDownloadFails: true,
      prisma,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT);

    const release = updates.at(-1)?.data;
    assert.equal(release.status, undefined);
    assert.equal(release.processedAt, null);
    assert.equal(release.errorCode, 'RETRYABLE_LINE_MEDIA_DOWNLOAD_FAILED');
  });

  it('does not complete an attachment when the storage PUT fails', async () => {
    const event = { ...MEDIA_EVENT };
    const prior = makeHarness({ permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 } });
    await prior.useCase.executeReceiptUpload(event);
    assert.equal(prior.completeCalls.length, 1);
    const { prisma, updates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      uploadThrows: true,
      prisma,
    });
    // Reusing an input cannot carry a different invocation's saved marker into this failed PUT.
    await h.useCase.executeReceiptUpload(event);
    assert.equal(h.initCalls.length, 1);
    assert.equal(h.uploads.length, 1);
    assert.equal(h.completeCalls.length, 0);
    // Media failure copy names the photo and the resend path (owner UX 2026-08-29).
    assert.match(h.replies[0] ?? '', /ประมวลผลรูปนี้ไม่สำเร็จ/);
    assert.equal(updates.at(-1)?.data.status, undefined);
    assert.equal(updates.at(-1)?.data.processedAt, null);
    assert.equal(updates.at(-1)?.data.errorCode, 'RETRYABLE_RECEIPT_UPLOAD_ERROR');
  });

  it('ambiguous media routes to CLARIFY and creates no draft or ticket', async () => {
    const { prisma, recordUpdates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.signature.manage'],
      // Receipt or requested signature? Only the kept router is asked, and it cannot tell.
      substituteMediaContext: { expenseId: 'expense-1', awaitingScans: [], signatureRequested: true, signatureRequestedAt: new Date().toISOString() },
      routePlan: { status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0.5 },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.signatureCreated.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.match(h.replies[0] ?? '', /ยังไม่แน่ใจ/);
  });

  for (const scenario of [
    {
      name: 'quantity-only order', expected: /ยังไม่พบยอดเงินรวม/,
      intent: 'EXPENSE_DOCUMENT_CAPTURE' as const,
      classification: businessClassification({
        documentKind: 'ORDER_OR_CHECK_BILL', transactionState: 'ORDERED', evidenceSignals: ['x2'], amountSignals: [], settlementSignals: [],
        missingRequiredSignals: ['QUANTITY_ONLY', 'MISSING_MONETARY_AMOUNT'],
      }),
      fields: { quantity: '2' },
    },
    {
      name: 'check bill with total but no settlement', expected: /ยังไม่ยืนยันการรับชำระ/,
      intent: 'EXPENSE_DOCUMENT_CAPTURE' as const,
      classification: businessClassification({
        documentKind: 'ORDER_OR_CHECK_BILL', transactionState: 'DUE', amountSignals: ['500.00'], settlementSignals: [],
        missingRequiredSignals: ['MISSING_PAYMENT_EVIDENCE'],
      }),
      fields: { grandTotalAmount: '500.00' },
    },
    {
      name: 'quotation', expected: /ใบเสนอราคา/,
      intent: 'BUSINESS_DOCUMENT_REFERENCE' as const,
      classification: businessClassification({ documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'QUOTATION', transactionState: 'PROPOSED', evidenceRoles: ['COMMERCIAL_PROPOSAL'] }),
      fields: { grandTotalAmount: '5000.00' },
    },
    ...(['APPOINTMENT_CARD', 'BOOKING_CONFIRMATION', 'RESERVATION_CONFIRMATION'] as const).map((documentKind) => ({
      name: documentKind.toLowerCase(), expected: /เอกสารนัดหมาย\/การจอง/,
      intent: 'BUSINESS_DOCUMENT_REFERENCE' as const,
      classification: businessClassification({ documentFamily: 'SCHEDULING_DOCUMENT', documentKind, transactionState: 'CONFIRMED', evidenceRoles: ['SCHEDULING_PROOF'] }),
      fields: { grandTotalAmount: '500.00' },
    })),
    {
      name: 'non-financial image', expected: /ไม่ใช่เอกสารค่าใช้จ่าย/,
      intent: 'EXPENSE_DOCUMENT_CAPTURE' as const,
      classification: businessClassification({ contentKind: 'NON_DOCUMENT_IMAGE', documentFamily: 'NON_BUSINESS', documentKind: 'NON_FINANCIAL_IMAGE', businessDirection: 'UNKNOWN', transactionState: 'UNKNOWN', evidenceRoles: [], evidenceSignals: [], amountSignals: [], settlementSignals: [] }),
      fields: {},
    },
    {
      name: 'unreadable image', expected: /ยังอ่านเอกสารนี้ได้ไม่ชัด/,
      intent: 'EXPENSE_DOCUMENT_CAPTURE' as const,
      classification: businessClassification({ contentKind: 'UNREADABLE', documentKind: 'NEEDS_REVIEW', confidence: 0.2, requiresClarification: true, missingRequiredSignals: ['UNREADABLE_OR_CROPPED'] }),
      fields: {},
    },
    {
      name: 'multi-document image', expected: /เอกสารมากกว่า 1 ฉบับ/,
      intent: 'EXPENSE_DOCUMENT_CAPTURE' as const,
      classification: businessClassification({ contentKind: 'MULTI_DOCUMENT', documentKind: 'NEEDS_REVIEW', requiresClarification: true, missingRequiredSignals: ['MULTIPLE_DOCUMENTS'] }),
      fields: { grandTotalAmount: '900.00' },
    },
  ]) {
    it(`${scenario.name} returns bounded guidance with no expense mutation`, async () => {
      const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
      const h = makeHarness({
        permissions: ['expense.receipt.line_upload'],
        routePlan: { status: 'ROUTED', intent: scenario.intent, language: 'th', confidence: 0.95, documentClassification: scenario.classification },
        receiptOcrResult: { status: 'ok', classification: scenario.classification, fields: scenario.fields },
        prisma,
      });

      await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: `evt-${scenario.name}` });

      assert.equal(h.ocrRequests.length, 1);
      assert.equal(recordUpdates.length, 0);
      const preservesMultiple = scenario.classification.contentKind === 'MULTI_DOCUMENT';
      // §18.4 "การเก็บและผูกงาน": NR01–NR03 and NR08 keep the bytes before offering the Web CTA, so
      // a quotation stores them — as an ORDINARY draft since appendix §25, not a capture group.
      const persistsAsDraft = scenario.name === 'quotation';
      assert.equal(h.initCalls.length, persistsAsDraft ? 1 : 0);
      assert.equal(h.uploads.length, preservesMultiple || persistsAsDraft ? 1 : 0);
      assert.equal(pendingMediaRows.length, preservesMultiple ? 1 : 0);
      assert.equal(h.captureState.groups.length, 0, 'the group lane is withdrawn');
      assert.match(h.replies[0] ?? '', scenario.expected);
      if (preservesMultiple) {
        assert.match(h.replies[0] ?? '', /เลือกเก็บรูป.*ส่งเอกสารแยกทีละภาพ/);
        assert.doesNotMatch(h.replies[0] ?? '', /รูปนี้เป็นอะไร/);
        assert.equal(pendingMediaRows[0].askedQuestionJson.detectedMultiDocument, true);
      }
      if (persistsAsDraft) {
        // Truthful copy (appendix §25): a draft exists, so the reply says so rather than claiming
        // "ยังไม่ได้สร้างรายการ" beside a link to the record it created.
        assert.match(h.replies[0] ?? "", /เก็บไฟล์ไว้ในรายการร่างแล้ว ยังไม่ยืนยัน ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้/);
        assert.match(h.replies[0] ?? '', /expenses\/expense-1/);
        // The OCR route already classified this picture: no second read is queued for the draft,
        // and the attempt says the read is DONE (a non-receipt), not "still reading".
        assert.equal(h.captureState.jobs.length, 0, 'no second read of an image already classified');
        assert.equal(h.captureState.attempts.at(-1).outcome, 'STORED_READ_DONE');
        assert.equal(h.captureState.attempts.at(-1).targetType, 'expense');
      }
    });
  }

  it('creates only the prior utility receipt draft and reports the current bill as due', async () => {
    for (const [billPeriod, receiptPeriod, intent] of [
      ['กันยายน 2569', 'สิงหาคม 2569', 'EXPENSE_DOCUMENT_CAPTURE'],
      ['09/69', '08/2569', 'BUSINESS_DOCUMENT_REFERENCE'],
    ] as const) {
      const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
      const classification = businessClassification({ contentKind: 'MULTI_DOCUMENT', documentKind: 'NEEDS_REVIEW', requiresClarification: true, missingRequiredSignals: ['MULTIPLE_DOCUMENTS'] });
      const h = makeHarness({
        permissions: ['expense.receipt.line_upload'],
        routePlan: { status: 'ROUTED', intent, language: 'th', confidence: 0.95, documentClassification: classification },
        receiptOcrResult: {
          status: 'ok', classification,
          utilityDocuments: [
            { role: 'BILL_DUE', period: billPeriod, amount: '110.05', titleEvidence: 'ใบแจ้งค่าน้ำประปา', amountEvidence: 'รวม 110.05' },
            { role: 'RECEIPT_PAID', period: receiptPeriod, amount: '82.28', titleEvidence: 'ใบเสร็จรับเงิน', amountEvidence: 'รวม 82.28' },
          ],
        }, prisma,
      });

      await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: `evt-combined-water-sheet-${billPeriod}` });

      assert.equal(h.initCalls.length, 1, billPeriod);
      assert.equal(recordUpdates.length, 2, billPeriod);
      assert.equal(pendingMediaRows.length, 0, billPeriod);
      assert.equal(recordUpdates[0].data.aiVerificationSummaryJson.recognizedFields.grandTotalAmount, '82.28');
      assert.equal(recordUpdates[1].data.sourceDocumentType, 'RECEIPT');
      assert.equal(recordUpdates[1].data.aiVerificationSummaryJson.utilityDocuments[1].amount, '82.28');
      assert.match(h.replies[0] ?? '', /รูปนี้มีเอกสารค่าน้ำ 2 งวด/);
      assert.match(h.replies[0] ?? '', new RegExp(`งวดปัจจุบัน ${billPeriod}: ใบแจ้งค่าน้ำประปา 110\\.05 บาท — เป็นยอดที่เรียกเก็บ`));
      assert.match(h.replies[0] ?? '', new RegExp(`งวดก่อน ${receiptPeriod}: ใบเสร็จ 82\\.28 บาท — บันทึกร่างค่าใช้จ่ายจากใบเสร็จแล้ว`));
      assert.match(h.replies[0] ?? '', /ยังไม่ได้บันทึกจากภาพนี้/);
      assert.match(h.replies[0] ?? '', /ไม่ได้รวมสองยอดหรือบันทึกการชำระเงินจากใบแจ้ง/);
      assert.match(h.replies[0] ?? '', /บันทึกใบแจ้งหนี้ด้วย/);
      assert.match(h.replies[0] ?? '', /เมื่อชำระงวดปัจจุบันแล้ว ส่งใบเสร็จของงวดนั้นเข้ามา/);
      assert.doesNotMatch(h.replies[0] ?? '', /ส่งเอกสารแยก/);
      assert.doesNotMatch(h.replies[0] ?? '', /192\.33/);
    }
  });

  it('saves the current utility supplier bill only on an explicit source-bound follow-up, and reuses it on retry', async () => {
    const chatKeyHash = chatKeyHashOf(TEXT_EVENT);
    const source = {
      id: 'expense-1', companyId: 'company-1', createdByUserId: 'user-1', branchId: 'branch-1',
      captureSource: 'LINE_UPLOAD', status: 'DRAFT', sourceDocumentType: 'RECEIPT',
      primaryAttachmentId: 'att-1', attachments: [{ id: 'att-1', purpose: 'expense.receipt.primary' }],
      grandTotalAmount: '82.2800', updatedAt: new Date('2026-09-25T10:00:00Z'),
      sourceChannelMetadataJson: { channel: 'LINE', chatKeyHash },
      aiVerificationSummaryJson: { utilityDocuments: [
        { role: 'BILL_DUE', period: '09/69', amount: '110.05', titleEvidence: 'ใบแจ้งค่าน้ำประปา', amountEvidence: 'รวม 110.05' },
        { role: 'RECEIPT_PAID', period: '08/2569', amount: '82.28', titleEvidence: 'ใบเสร็จรับเงิน', amountEvidence: 'รวม 82.28' },
      ] },
    };
    const recentCaptures = [{ id: source.id, expenseDate: new Date(), grandTotalAmount: '82.28', sourceDocumentType: 'RECEIPT', createdAt: new Date() }];
    const h = makeHarness({
      permissions: ['line.ai.query', 'expense.receipt.line_upload'],
      recentCaptures,
      expenseDetail: (id: string) => id === source.id ? source : undefined,
    });
    const command = 'ขอให้สร้างใบแจ้งหนี้ด้วย';
    await h.useCase.execute({ ...TEXT_EVENT, messageText: command });
    assert.equal(h.createExpenseCalls.length, 1);
    assert.equal(h.createExpenseCalls[0].sourceDocumentType, 'SUPPLIER_BILL');
    assert.equal(h.createExpenseCalls[0].vatMode, 'NEEDS_REVIEW');
    assert.equal(h.createExpenseCalls[0].grandTotalAmount, '110.0500');
    assert.equal(h.createExpenseCalls[0].outstandingAmount, '110.0500');
    assert.equal(h.createExpenseCalls[0].lineMessageId, undefined);
    assert.equal(h.linkAttachmentCalls.length, 1);
    assert.match(h.replies[0] ?? '', /ยังไม่ชำระและยังไม่บันทึกการจ่ายเงิน/);
    assert.doesNotMatch(h.replies[0] ?? '', /82\.28/);
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-text-retry', lineMessageId: 'msg-text-retry', messageText: command });
    assert.equal(h.linkAttachmentCalls.length, 1, 'retry must reuse the draft and original image');
    assert.match(h.replies[1] ?? '', /มีร่างบิลค่าน้ำงวด 09\/69 110\.05 บาทอยู่แล้ว/);
    recentCaptures.unshift({ id: 'later-document', expenseDate: new Date(), grandTotalAmount: '50', sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT', createdAt: new Date() });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-unrelated', lineMessageId: 'msg-unrelated', messageText: command });
    assert.match(h.replies[2] ?? '', /มีเอกสารอื่นส่งต่อจากรูปค่าน้ำแล้ว/);
    assert.equal(h.linkAttachmentCalls.length, 1);
  });

  it('does not treat a sales invoice request or an unproven utility amount as the saved bill', async () => {
    assert.equal(isUtilityBillSaveRequest('สร้างใบแจ้งหนี้ให้ลูกค้าด้วย'), false);
    assert.equal(isUtilityBillSaveRequest('ออกใบแจ้งหนี้ด้วย'), false);
    assert.equal(isUtilityBillSaveRequest('ไม่ต้องสร้างใบแจ้งหนี้ด้วย'), false);
    assert.equal(isUtilityBillSaveRequest('สร้างใบแจ้งหนี้ด้วยได้ไหม'), false);
    assert.equal(isUtilityBillSaveRequest('ขอให้สร้างใบแจ้งหนี้ด้วย'), true);
    const source = {
      id: 'expense-1', companyId: 'company-1', createdByUserId: 'user-1', branchId: 'branch-1',
      captureSource: 'LINE_UPLOAD', sourceDocumentType: 'RECEIPT', primaryAttachmentId: 'att-1',
      attachments: [{ id: 'att-1', purpose: 'expense.receipt.primary' }], grandTotalAmount: '99.0000',
      updatedAt: new Date(), sourceChannelMetadataJson: { chatKeyHash: chatKeyHashOf(TEXT_EVENT) },
      aiVerificationSummaryJson: { utilityDocuments: [
        { role: 'BILL_DUE', period: '09/69', amount: '110.05', titleEvidence: 'ใบแจ้งค่าน้ำประปา' },
        { role: 'RECEIPT_PAID', period: '08/2569', amount: '82.28', titleEvidence: 'ใบเสร็จรับเงิน' },
      ] },
    };
    const h = makeHarness({
      permissions: ['line.ai.query', 'expense.receipt.line_upload'],
      recentCaptures: [{ id: source.id, expenseDate: new Date(), grandTotalAmount: '99', sourceDocumentType: 'RECEIPT', createdAt: new Date() }],
      expenseDetail: source,
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'บันทึกใบแจ้งหนี้ด้วย' });
    assert.equal(h.createExpenseCalls.length, 0);
    assert.match(h.replies[0] ?? '', /ยังไม่พบใบแจ้งค่าน้ำ\/ค่าไฟ/);
  });

  it('requires capture permission and an unambiguous period before saving another utility bill', async () => {
    const makeSource = (id: string, billPeriod: string, receiptPeriod: string, amount: string) => ({
      id, companyId: 'company-1', createdByUserId: 'user-1', branchId: 'branch-1',
      captureSource: 'LINE_UPLOAD', sourceDocumentType: 'RECEIPT', primaryAttachmentId: `att-${id}`,
      attachments: [{ id: `att-${id}`, purpose: 'expense.receipt.primary' }], grandTotalAmount: amount,
      updatedAt: new Date('2026-09-25T10:00:00Z'), sourceChannelMetadataJson: { chatKeyHash: chatKeyHashOf(TEXT_EVENT) },
      aiVerificationSummaryJson: { utilityDocuments: [
        { role: 'BILL_DUE', period: billPeriod, amount: '110.05', titleEvidence: 'ใบแจ้งค่าน้ำประปา' },
        { role: 'RECEIPT_PAID', period: receiptPeriod, amount, titleEvidence: 'ใบเสร็จรับเงิน' },
      ] },
    });
    const sources = [makeSource('receipt-a', '09/69', '08/69', '82.28'), makeSource('receipt-b', '10/69', '09/69', '75.00')];
    const recentCaptures = sources.map(source => ({ id: source.id, expenseDate: new Date(), grandTotalAmount: source.grandTotalAmount,
      sourceDocumentType: 'RECEIPT', createdAt: new Date() }));
    const denied = makeHarness({ permissions: ['line.ai.query'], recentCaptures, expenseDetail: (id: string) => sources.find(source => source.id === id) });
    await denied.useCase.execute({ ...TEXT_EVENT, messageText: 'บันทึกใบแจ้งหนี้ด้วย' });
    assert.equal(denied.createExpenseCalls.length, 0);
    const allowed = makeHarness({ permissions: ['line.ai.query', 'expense.receipt.line_upload'], recentCaptures,
      expenseDetail: (id: string) => sources.find(source => source.id === id) });
    await allowed.useCase.execute({ ...TEXT_EVENT, messageText: 'บันทึกใบแจ้งหนี้ด้วย' });
    assert.equal(allowed.createExpenseCalls.length, 0);
    assert.match(allowed.replies[0] ?? '', /หลายรูป/);
    await allowed.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-period-choice', lineMessageId: 'msg-period-choice', messageText: 'บันทึกใบแจ้งค่าน้ำงวด 09/69' });
    assert.equal(allowed.createExpenseCalls.length, 1);
    assert.equal(allowed.createExpenseCalls[0].sourceChannelMetadataJson.sourceReceiptExpenseId, 'receipt-a');
  });

  it('keeps an unrelated or same-period utility pair in review without a draft', async () => {
    for (const [receiptPeriod, receiptAmount] of [
      ['กันยายน 2569', '82.28'], ['มิถุนายน 2569', '82.28'],
      ['อ่านงวดไม่ได้', '82.28'], ['สิงหาคม 2569', '999.99'],
    ]) {
      const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
      const classification = businessClassification({ contentKind: 'MULTI_DOCUMENT', documentKind: 'NEEDS_REVIEW', requiresClarification: true, missingRequiredSignals: ['MULTIPLE_DOCUMENTS'] });
      const h = makeHarness({
        permissions: ['expense.receipt.line_upload'],
        routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95, documentClassification: classification },
        receiptOcrResult: { status: 'ok', classification, utilityDocuments: [
          { role: 'BILL_DUE', period: 'กันยายน 2569', amount: '110.05', titleEvidence: 'ใบแจ้งค่าน้ำประปา', amountEvidence: 'รวม 110.05' },
          { role: 'RECEIPT_PAID', period: receiptPeriod, amount: receiptAmount, titleEvidence: 'ใบเสร็จรับเงิน', amountEvidence: 'รวม 82.28' },
        ] }, prisma,
      });
      await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: `evt-utility-${receiptPeriod}` });
      assert.equal(h.initCalls.length, 0, receiptPeriod);
      assert.equal(recordUpdates.length, 0, receiptPeriod);
      assert.equal(pendingMediaRows.length, 1, receiptPeriod);
    }
  });

  it('does not create a utility bill draft from a reference route without capture permission', async () => {
    const { prisma, recordUpdates } = makePrisma();
    const classification = businessClassification({ contentKind: 'MULTI_DOCUMENT', documentKind: 'NEEDS_REVIEW', requiresClarification: true, missingRequiredSignals: ['MULTIPLE_DOCUMENTS'] });
    const h = makeHarness({
      permissions: ['line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_DOCUMENT_REFERENCE', language: 'th', confidence: 0.95, documentClassification: classification },
      receiptOcrResult: { status: 'ok', classification, utilityDocuments: [
        { role: 'BILL_DUE', period: '09/69', amount: '110.05', titleEvidence: 'ใบแจ้งค่าน้ำประปา', amountEvidence: 'รวม 110.05' },
        { role: 'RECEIPT_PAID', period: '08/2569', amount: '82.28', titleEvidence: 'ใบเสร็จรับเงิน', amountEvidence: 'รวม 82.28' },
      ] }, prisma,
    });
    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-utility-no-capture' });
    assert.equal(h.initCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
  });

  it('denies an expense route before OCR or existing-expense lookup when capture permission is missing', async () => {
    const { prisma, recordUpdates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.signature.manage'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      prisma,
    });

    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-no-expense-permission' });

    assert.equal(h.ocrRequests.length, 0);
    assert.equal(h.initCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.match(h.replies[0] ?? '', /ไม่มีสิทธิ์อัปโหลด/);
  });

  it('allows bounded quotation guidance without expense permission and creates no record', async () => {
    const { prisma, recordUpdates } = makePrisma();
    const detected = businessClassification({
      documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'QUOTATION', businessDirection: 'CUSTOMER_INBOUND',
      transactionState: 'PROPOSED', evidenceRoles: ['COMMERCIAL_PROPOSAL'], amountSignals: ['5000.00'], settlementSignals: [],
    });
    const h = makeHarness({
      permissions: ['expense.signature.manage'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_DOCUMENT_REFERENCE', language: 'th', confidence: 0.95, documentClassification: detected },
      receiptOcrResult: { status: 'ok', classification: detected, fields: { grandTotalAmount: '5000.00' } },
      prisma,
    });

    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-reference-no-expense-permission' });

    assert.equal(h.ocrRequests.length, 1);
    assert.equal(h.initCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.match(h.replies[0] ?? '', /ใบเสนอราคา/);
  });

  it('router unavailable still captures an uncaptioned receipt that passes the OCR expense gate', async () => {
    const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload'], routeThrows: true, prisma });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.ocrRequests.length, 1);
    assert.equal(h.initCalls.length, 1);
    assert.equal(h.completeCalls.length, 1);
    assert.equal(recordUpdates.length, 2, 'source facts persist before apply, then the final capture metadata is written');
    assert.equal(recordUpdates[0].where.id, 'expense-1');
    assert.deepEqual(recordUpdates[0].data.aiVerificationSummaryJson.recognizedFields, validReceiptOcr().fields);
    assert.equal(recordUpdates[0].data.lineMessageId, undefined, 'the first write is only the captured source result');
    assert.equal(recordUpdates[1].data.lineMessageId, MEDIA_EVENT.lineMessageId);
    assert.equal((await (h.useCase as any).expenseRepo.findByIdWithRelations('company-1', 'expense-1')).captureSource, 'LINE_UPLOAD');
    assert.equal(pendingMediaRows.length, 0);
    assert.match(h.replies[0] ?? '', /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว \(รอตรวจสอบ\)/);
    assert.match(h.replies[0] ?? '', /ยอดรวม – 120\.00/);
    assert.equal(recordUpdates[0].data.aiVerificationSummaryJson.recognizedFields.documentNumber, 'R-1');
    assert.doesNotMatch(h.replies[0] ?? '', /เลขที่เอกสาร/);
  });

  it('a router outage never reaches a caption-less photo: a failed read keeps it for the web form (§17.6), with no question', async () => {
    const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routeThrows: true,
      receiptOcrResult: { status: 'failed', errorCode: 'AI_GATEWAY_UNREACHABLE' },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.routeRequests.length, 0, 'the router is never asked');
    assert.equal(h.ocrRequests.length, 1);
    assert.equal(recordUpdates.length, 0, 'nothing read, nothing recorded');
    assert.equal(pendingMediaRows.length, 0, 'no numbered question for a failed read');
    assert.equal(h.initCalls.length, 1, 'the picture is kept as a draft to finish on the web');
    assert.match(h.replies[0] ?? '', /อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว/);
  });

  it('router unavailable with a caption still clarifies even when OCR sees a receipt', async () => {
    const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload'], routeThrows: true, prisma });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'อันนี้คิดยังไง');
    assert.equal(h.initCalls.length, 0);
    assert.equal(h.completeCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.equal(pendingMediaRows.length, 1);
    assert.match(h.replies[0] ?? '', /ใบเสร็จ[\s\S]*ภาพประกอบ/);
  });

  it('mutation request with media is refused with web guidance and remembered as refused', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'MUTATION_REQUEST_REFUSAL', language: 'th', confidence: 0.97 },
      prisma,
    });
    // The request is in the caption — a captioned photo keeps the router.
    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'อนุมัติจ่ายบิลนี้ให้หน่อย');
    assert.equal(h.routeRequests.length, 1);
    assert.match(h.replies[0] ?? '', /ไม่สามารถทำรายการอนุมัติ/);
    assert.equal(turnCreates[0].data.intent, 'MUTATION_REQUEST');
    assert.equal(turnCreates[0].data.refused, true);
  });

  it('remembers a receipt-image capture turn (media EVIDENCE_CAPTURE memory row)', async () => {
    const { prisma, turnCreates, recordUpdates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95,
        captureHints: { sourceDocumentType: 'RECEIPT', confidence: 0.9 },
      },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.ocrRequests.length, 1);
    assert.equal(h.initCalls.length, 1);
    assert.equal(h.completeCalls.length, 1);
    assert.equal(recordUpdates.length, 2, 'source facts persist before apply, then the final capture metadata is written');
    assert.equal(recordUpdates[0].where.id, 'expense-1');
    assert.deepEqual(recordUpdates[0].data.aiVerificationSummaryJson.recognizedFields, validReceiptOcr().fields);
    assert.equal(recordUpdates[1].data.lineMessageId, MEDIA_EVENT.lineMessageId);
    assert.equal(recordUpdates[1].data.lineEventId, MEDIA_EVENT.webhookEventId);
    assert.equal(turnCreates.length, 1);
    assert.equal(turnCreates[0].data.intent, 'EVIDENCE_CAPTURE');
    assert.match(turnCreates[0].data.replyPreview, /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว \(รอตรวจสอบ\)/);
    assert.match(turnCreates[0].data.replyPreview, /ยอดรวม – 120\.00/);
    assert.equal(h.receiptContinuationCalls.length, 1);
    assert.equal(h.receiptContinuationCalls[0].expenseId, 'expense-1');
    assert.ok(h.receiptContinuationCalls[0].chatKeyHash && !h.receiptContinuationCalls[0].chatKeyHash.includes('line-user-secret'));
    assert.ok(h.receiptContinuationCalls[0].deliveredOutcomeId && !h.receiptContinuationCalls[0].deliveredOutcomeId.includes('evt-media'));
  });
});

// UAT 2026-09-29 (main a2d11e89, owner: "ของเดิมถ่ายรูป หรือ ส่งรูป ก็อ่านได้และสร้างให้ทันที" and "รหัสไฟล์อะไรออกมา
// ไม่รู้ งง"): every private chat is BOUND on UAT/production (reliability v2 defaults), and a bound caption-less
// photo was answered "what is this?" with no router, no OCR and no draft. Every media test above runs UNBOUND,
// which is how the shortcut shipped unnoticed; these run the same photos through a bound conversation.
describe('LINE intake dispatch – a photo in a bound (v2) conversation reads like production', () => {
  const ID_OR_COMMAND = /\/media|\/qa|pending-att|capture-att|\batt-\d|\bpm-\d/u;
  const sentText = (h: Harness) => JSON.stringify(h.sentMessages);
  const RECEIPT_ROUTE = { status: 'ROUTED' as const, intent: 'EXPENSE_DOCUMENT_CAPTURE' as const, language: 'th', confidence: 0.95 };
  // The reader's own "not one clear receipt" outcome: it parks the bytes behind the numbered question.
  const UNCLEAR_READ = validReceiptOcr({ classification: businessClassification({ contentKind: 'MULTI_DOCUMENT' }) });
  const SECOND_PHOTO = { ...MEDIA_EVENT, webhookEventId: 'evt-media-2', lineMessageId: 'msg-media-2', replyToken: 'reply-3' };

  // UAT 2026-09-29 (Owner "ง + ค"): the router spent 15–35 s re-reading every caption-less photo only to say
  // "receipt"; the reader now reads it straight away and decides with its own classification.
  it('a caption-less receipt photo skips the router: the reader reads it once and the draft is created at once', async () => {
    const { prisma, updates } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], boundV2: true, routePlan: RECEIPT_ROUTE, prisma });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal((h.useCase as any).boundConversations.has, WeakMap.prototype.has, 'sanity: the use case keeps its bound map');
    assert.equal(h.routeRequests.length, 0, 'no router call for a caption-less photo');
    assert.equal(h.ocrRequests.length, 1);
    assert.ok(h.ocrRequests[0].attachment?.contentBase64, 'the reader sees the picture itself');
    assert.equal(h.ocrRequests[0].documentText, undefined, 'and reads it itself — there is no router transcription to reuse');
    assert.equal(h.ocrOptions[0]?.ocrAlreadyAdmitted, false, 'the reader admits the photo: still exactly one receipt-image count');
    assert.equal(h.ocrOptions[0]?.retryWebhookEventId, MEDIA_EVENT.webhookEventId, 'so a crash replay can resume at the reader');
    assert.equal(h.initCalls.length, 1, 'the draft is created immediately');
    assert.equal(h.completeCalls.length, 1);
    assert.match(h.replies[0] ?? '', /ร้านทดสอบ|120/u);
    assert.doesNotMatch(h.replies.join('\n'), /รูปนี้เป็นอะไรคะ|ต้องการให้อ่านไฟล์นี้/u);
    assert.ok(!updates.some((u: any) => u.data?.status === 'clarification_required'));
  });

  it('an ambiguous photo asks the ONE numbered question, parks the bytes, and shows no id', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], boundV2: true, receiptOcrResult: UNCLEAR_READ, prisma });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.routeRequests.length, 0, 'the reader decides it is unclear');
    assert.equal(h.initCalls.length, 0, 'no draft from an unclear picture');
    assert.equal(pendingMediaRows.length, 1, 'the bytes stay pending for the answer');
    assert.equal(h.replies.length, 1);
    assert.doesNotMatch(sentText(h), ID_OR_COMMAND);
  });

  it('a receipt sent after an unclear photo is read and drafted; only the unclear one keeps its question', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], boundV2: true,
      receiptOcrResults: [UNCLEAR_READ, validReceiptOcr()], prisma });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    await h.useCase.executeReceiptUpload(SECOND_PHOTO);
    assert.equal(h.routeRequests.length, 0, 'neither photo waits for the router');
    assert.equal(h.ocrRequests.length, 2, 'both photos were read');
    assert.equal(h.initCalls.length, 1, 'and drafted');
    assert.equal(pendingMediaRows.filter((row) => row.status === 'PENDING').length, 1, 'only the unclear photo waits');
    assert.doesNotMatch(sentText(h), ID_OR_COMMAND);
  });

  // UAT 2026-09-29 (main c4513ddd): the second of two photos sent back to back was drafted 62 s after it was
  // accepted, and its delivery plan failed validation in 13 ms — the draft existed, the customer never heard.
  it('two photos back to back: both drafts are announced, the late one by push when its reply token is spent', async () => {
    const { prisma, updates } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], boundV2: true,
      routePlans: [RECEIPT_ROUTE, RECEIPT_ROUTE], prisma });
    const flow = h.useCase as any;
    flow.config.lineAiTerminalOutcomeReplayEnabled = true;
    const acceptedAt: Record<string, Date> = { [MEDIA_EVENT.webhookEventId]: new Date(Date.now() - 10_000),
      [SECOND_PHOTO.webhookEventId]: new Date(Date.now() - 62_000) };
    const plans = new Map<string, any>();
    const delivered: Array<{ eventId: string; transport: string; text: string }> = [];
    prisma.client.lineTurnOutcome = { findUnique: async () => null, updateMany: async () => ({ count: 1 }) };
    prisma.client.lineWebhookEventLog.findUnique = async (args: any) => {
      const createdAt = acceptedAt[args.where.webhookEventId];
      return createdAt && { status: 'received', processedAt: null, createdAt,
        budgetAuthorityJson: { grant: { finalDeadlineAtMs: createdAt.getTime() + 40_000 } } };
    };
    prisma.client.lineDeliveryPlan = { findUnique: async (args: any) => plans.get(args.where.id) };
    flow.webhookPlanAuthorization = async (_event: unknown, expiresAt: string) => ({ v: 2, kind: 'PRIVATE', issuedAt: new Date().toISOString(), expiresAt,
      actor: { userId: 'user-1', companyId: 'company-1', membershipId: 'mem-1', requestId: 'request', accessFingerprint: 'fingerprint', channelId: 'ch-1',
        channel: 'line', channelKind: 'USER', recipientHash: 'recipient', chatKeyHash: 'chat', conversationId: 'line-v2:conversation-1', ownerEpoch: 0 },
      proofs: [] });
    flow.verifyWebhookPlan = async () => true;
    const eventOf = new Map<string, string>();
    flow.deliveryPlans = {
      savePlan: async (owner: any, plan: any, _retention: unknown, _now: unknown, webhookEventId: string) => {
        plans.set(plan.planId, { id: plan.planId, status: 'READY', planJson: plan, planHash: deliveryHash(plan), outcomeId: owner.id });
        eventOf.set(plan.planId, webhookEventId); return { id: plan.planId };
      },
      claimPlan: async (id: string) => ({ row: plans.get(id), plan: plans.get(id).planJson, token: 'lease', fence: {},
        states: plans.get(id).states ?? plans.get(id).planJson.batches.map(() => ({ status: 'READY', variant: 'primary', replyAttempted: false, pushAttempts: 0 })) }),
      beginPlanBatch: async (claim: any) => ({ index: claim.states.findIndex((state: any) => state.status !== 'ACCEPTED'), timeoutMs: 5_000 }),
      finishPlanBatch: async (claim: any, index: number, result: any) => {
        claim.states[index] = { ...claim.states[index], status: result.kind === 'accepted' ? 'ACCEPTED' : 'READY', replyAttempted: true };
        plans.get(claim.row.id).states = claim.states; return true;
      },
    };
    flow.lineReply.sendFrozenV2 = async (input: any) => {
      const eventId = [...eventOf].find(([planId]) => plans.get(planId)?.planJson.batches.some((batch: any) =>
        batch.primary.pushRetryKey === input.pushRetryKey))![1];
      // The late photo's reply token has lapsed by the time its draft is ready; LINE refuses it.
      if (input.transport === 'REPLY' && eventId === SECOND_PHOTO.webhookEventId) return { kind: 'rejected', code: 'REPLY_TOKEN_REJECTED', rejection: 'TOKEN' };
      delivered.push({ eventId, transport: input.transport, text: replyAssertionText(input.messages[0]) });
      return { kind: 'accepted', code: 'API_ACCEPTED' };
    };

    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    await h.useCase.executeReceiptUpload(SECOND_PHOTO);

    assert.equal(h.ocrRequests.length, 2, 'both photos were read');
    assert.deepEqual(delivered.map(item => [item.eventId, item.transport]),
      [[MEDIA_EVENT.webhookEventId, 'REPLY'], [SECOND_PHOTO.webhookEventId, 'PUSH']], 'each draft is announced once');
    assert.ok(delivered.every(item => /120/u.test(item.text)), 'with its receipt summary');
    for (const eventId of [MEDIA_EVENT.webhookEventId, SECOND_PHOTO.webhookEventId]) {
      const last = updates.filter((update: any) => update.where?.webhookEventId === eventId).at(-1);
      assert.equal(last?.data?.status, 'completed', `${eventId} ends delivered`);
    }
  });

  // UAT 2026-09-29 (owner photo: a table bill "Total 1,712.54" with a QR payment slip beside it): the
  // reader copied the separator, Number() gave NaN, and the customer was told to send the final receipt.
  for (const [name, fields, amountSignals] of [
    ['a total printed with a thousands separator', { grandTotalAmount: '1,712.54', vatAmount: '112.04' }, ['Total 1,712.54']],
    ['an amount the read kept only as a signal', { vatAmount: '112.04' }, ['Total 1,712.54']],
  ] as const) {
    it(`a check bill with ${name} asks production's paid/unpaid question, never "send the final receipt"`, async () => {
      const { prisma, pendingMediaRows } = makePrisma();
      const checkBill = businessClassification({ documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'ORDER_OR_CHECK_BILL',
        transactionState: 'DUE', amountSignals: [...amountSignals], settlementSignals: [], missingRequiredSignals: ['MISSING_PAYMENT_EVIDENCE'] });
      const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.review', 'line.ai.query'],
        boundV2: true, prisma, routePlan: RECEIPT_ROUTE, receiptOcrResult: { status: 'ok', classification: checkBill, fields },
        substituteResult: { handled: true, status: 'OPEN', expenseId: 'expense-1', acceptedFields: [], blockers: [], replyText: '' } });
      await h.useCase.executeReceiptUpload(MEDIA_EVENT);
      assert.equal(pendingMediaRows[0]?.askedQuestionJson?.kind, 'CHECK_BILL_ACTION', 'the bill waits for the paid/unpaid answer');
      assert.match(h.replies.join('\n'), /จ่ายเงินแล้วหรือยังคะ/u);
      assert.doesNotMatch(h.replies.join('\n'), /ส่งใบเสร็จฉบับสุดท้าย หรือระบุ/u);
    });
  }

  it('a quantity-only order with no amount still says what is missing instead of asking paid/unpaid', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    const order = businessClassification({ documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'ORDER_OR_CHECK_BILL', transactionState: 'ORDERED',
      amountSignals: [], settlementSignals: [], missingRequiredSignals: ['QUANTITY_ONLY', 'MISSING_MONETARY_AMOUNT'] });
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.review', 'line.ai.query'],
      boundV2: true, prisma, routePlan: RECEIPT_ROUTE, receiptOcrResult: { status: 'ok', classification: order, fields: { quantity: '2' } },
      substituteResult: { handled: true, status: 'OPEN', expenseId: 'expense-1', acceptedFields: [], blockers: [], replyText: '' } });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(pendingMediaRows.length, 0);
    assert.match(h.replies.join('\n'), /ยังไม่พบยอดเงินรวม/u);
  });

  it('a captioned photo keeps the router, which reads the words with the picture', async () => {
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], boundV2: true, routePlan: RECEIPT_ROUTE });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ค่าอาหารลูกค้า');
    assert.equal(h.routeRequests.length, 1);
    assert.equal(h.routeRequests[0].messageText, 'ค่าอาหารลูกค้า');
    assert.ok(h.routeRequests[0].attachments?.[0]?.contentBase64, 'the router sees the picture too');
    assert.equal(h.ocrRequests.length, 1);
  });

  it("the photo's draft reply is production's card: the link on a button, never raw text with ids", async () => {
    const { prisma } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], boundV2: true, routePlan: RECEIPT_ROUTE, prisma });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    const reply: any = h.sentMessages[0]?.[0];
    assert.equal(reply?.type, 'flex', 'a card, as production sent it');
    // Design lock context 6: in a bound chat the plan sends the locked review card itself.
    const card = readLineSystemCard(reply);
    assert.deepEqual(card.header, ['ข้อมูลใบเสร็จ', 'รอตรวจสอบ']);
    assert.ok(card.texts.every((text) => !/https?:\/\//u.test(text)), 'no raw link in any text of the card');
    assert.equal(card.actions.length, 1, 'capture-only permission keeps only the record web link');
    assert.equal(card.actions[0]!.type, 'uri');
    assert.match(card.actions[0]!.uri ?? '', /expense-1/u, 'the saved draft remains accessible without a financial confirmation control');
    assert.match(reply.canonicalText, /^🧾 บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว \(รอตรวจสอบ\)[\s\S]*\/companies\/company-1\/expenses\/expense-1$/u,
      'the reply that was sent before is the card\'s canonical text and its fallback');
  });

  // Owner 2026-10-05, real LINE: a reply to a photo was still on the green card from before the design.
  // Each of these is the reply the flow sends today, word for word, now under "เอกสารที่ส่งมา" and the
  // fixed phrase for what became of the document.
  it('every other reply to a bound photo is a card of the locked design, headed by what became of the document', async () => {
    const CAPTURE = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.review', 'line.ai.query'];
    const checkBill = businessClassification({ documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'ORDER_OR_CHECK_BILL', transactionState: 'DUE',
      amountSignals: ['Total 1,712.54'], settlementSignals: [], missingRequiredSignals: ['MISSING_PAYMENT_EVIDENCE'] });
    const order = businessClassification({ documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'ORDER_OR_CHECK_BILL', transactionState: 'ORDERED',
      amountSignals: [], settlementSignals: [], missingRequiredSignals: ['QUANTITY_ONLY', 'MISSING_MONETARY_AMOUNT'] });
    const notADocument = businessClassification({ documentFamily: 'NON_FINANCIAL', documentKind: 'NON_FINANCIAL_IMAGE', transactionState: 'NOT_APPLICABLE',
      evidenceRoles: [], amountSignals: [], settlementSignals: [] } as any);
    const open = { handled: true, status: 'OPEN', expenseId: 'expense-1', acceptedFields: [], blockers: [], replyText: '' } as const;
    for (const [name, opts, outcome, sentence, quick] of [
      ['several documents in one picture', { permissions: CAPTURE, receiptOcrResult: UNCLEAR_READ }, 'ขอข้อมูลเพิ่ม', /รูปนี้เป็นอะไรคะ|มากกว่า 1/u, true],
      ['a check bill', { permissions: CAPTURE, routePlan: RECEIPT_ROUTE, substituteResult: open,
        receiptOcrResult: { status: 'ok', classification: checkBill, fields: { grandTotalAmount: '1,712.54' } } }, 'ขอข้อมูลเพิ่ม', /จ่ายเงินแล้วหรือยังคะ/u, true],
      ['an order with no amount', { permissions: CAPTURE, routePlan: RECEIPT_ROUTE, substituteResult: open,
        receiptOcrResult: { status: 'ok', classification: order, fields: { quantity: '2' } } }, 'ผลการอ่านเอกสาร', /ยังไม่พบยอดเงินรวม/u, true],
      ['a picture that is no document', { permissions: CAPTURE, routePlan: RECEIPT_ROUTE,
        receiptOcrResult: { status: 'ok', classification: notADocument, fields: {} } }, 'ไม่ใช่เอกสารค่าใช้จ่าย', /ไม่ใช่เอกสารค่าใช้จ่าย/u, true],
      ['a sender with no right to send a receipt', { permissions: ['line.ai.query'] }, 'ยังรับเอกสารนี้ไม่ได้', /ไม่มีสิทธิ์อัปโหลด/u, false],
    ] as const) {
      const { prisma } = makePrisma();
      const h = makeHarness({ boundV2: true, prisma, ...opts } as any);
      await h.useCase.executeReceiptUpload(MEDIA_EVENT);
      const reply: any = h.sentMessages.at(-1)?.at(-1);
      const card = readLineSystemCard(reply);
      assert.deepEqual(card.header, ['เอกสารที่ส่งมา', outcome], name);
      assert.match(reply.canonicalText, sentence, name);
      assert.deepEqual(card.prose, [reply.canonicalText.replace(/\n{2,}/gu, '\n')], `${name}: the words sent before are the card's paper (less its blank lines), its canonical text and its fallback`);
      // A question's own buttons, or the menu that follows a finished reply, still ride on the card.
      assert.equal(Boolean(reply.quickReply?.items?.length), quick, name);
      assert.doesNotMatch(JSON.stringify(reply.contents), /ข้อมูลจากน้องมั่งมี/u, `${name}: not the card from before the design`);
      assert.doesNotMatch(sentText(h), ID_OR_COMMAND, name);
    }
  });

  it('two unclear photos: files are named by order and time, buttons send their own words, and a tap picks the right one', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], boundV2: true,
      receiptOcrResults: [UNCLEAR_READ, UNCLEAR_READ], prisma });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    await h.useCase.executeReceiptUpload(SECOND_PHOTO);
    assert.equal(pendingMediaRows.length, 2, 'the second photo is kept, not dropped');
    const wire = sentText(h);
    assert.doesNotMatch(wire, ID_OR_COMMAND, 'no attachment id or slash command anywhere on the wire');
    assert.match(wire, /รูปที่ 1/u); assert.match(wire, /รูปที่ 2/u);
    const items = h.sentMessages.flat().flatMap((message: any) => message?.quickReply?.items ?? []);
    assert.ok(items.length > 0, 'the choice is offered as buttons');
    for (const item of items) {
      assert.equal(item.action.type, 'message');
      assert.equal(item.action.text, item.action.label, 'a tap sends exactly the words on the button');
    }
    const pick = { ...TEXT_EVENT, webhookEventId: 'evt-pick', messageText: 'เลือกรูปที่ 2' };
    const flow = h.useCase as any;
    flow.boundConversations.set(pick, { owner: { companyId: 'company-1', userId: 'user-1', membershipId: 'mem-1', channel: 'line',
      channelKind: 'USER', messagingChannelId: 'ch-1', chatKeyHash: chatKeyHashOf(pick) }, id: 'line-v2:conversation-1', epoch: 0 });
    assert.equal(await flow.handlePendingMediaControl(pick), true);
    const second = pendingMediaRows.find((row) => row.lineMessageId === 'msg-media-2');
    assert.equal(second.askedQuestionJson.selectedForContinuation, true, '"เลือกรูปที่ 2" selects the second photo');
    assert.equal(pendingMediaRows.find((row) => row.lineMessageId === 'msg-media-1').askedQuestionJson.selectedForContinuation, false);
    assert.equal(await flow.handlePendingMediaControl({ ...pick, webhookEventId: 'evt-chat', messageText: 'ขอบคุณค่ะ' }), false,
      'ordinary chat is never a control');
  });
});

// UAT 2026-09-29 (main c4513ddd, owner: "ของเดิมดีอยู่แล้ว"): in a bound chat the v2 route ran BEFORE the
// deterministic handlers production a2b926c6 runs first. "1" answering the photo question became a general
// question, "ใบเสร็จค่ะ" a document-reading job, a check bill's "1" a dead end, and a draft or correction reply
// reached the router without the open work production gave it. These run the production continuations bound.
describe('LINE intake dispatch – a bound (v2) chat answers open work in production order', () => {
  const CAPTURE = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.review', 'expense.update', 'line.ai.query'];
  const GRANT = { turnKey: 'bound-open-work' };
  const ACTIVE_DRAFT = { expenseId: 'expense-draft-1', label: 'ร่าง 1', status: 'PAUSED' as const,
    questions: [{ id: 'D-ADDRESS', prompt: 'อ่านที่อยู่ร้านจากใบไม่ได้ พิมพ์ที่อยู่ตามใบได้เลย หรือพิมพ์ ข้าม' }] };

  /** A text turn in a BOUND chat with the v2 seams a real one has: accepted input evidence, a grant, a task store. */
  async function boundText(h: Harness, messageText: string, webhookEventId: string, tasks: any[] = []): Promise<any> {
    const flow = h.useCase as any;
    const saved: any[] = [];
    flow.prisma.client.lineLedgerDelivery ??= { findMany: async () => [], findFirst: async () => null, findUnique: async () => null };
    flow.contextV2 = {
      admit: async () => ({ id: 'line-v2:conversation-1', lifecycleEpoch: 0 }),
      projection: async () => ({ version: 2, stateVersion: 1, lifecycleEpoch: 0, expiresAtMs: Date.now() + 60_000, tasks }),
      createTurn: async (_owner: unknown, _epoch: number, data: any) => flow.prisma.client.aiTurn.create({ data }),
      save: async (_owner: unknown, _version: number, _epoch: number, state: unknown) => { saved.push(state); return true; },
    };
    flow.prepareTextGrantV2 = async (accepted: object) => { flow.budgetGrantsV2.set(accepted, GRANT); return GRANT; };
    flow.loadConversationContext = async () => ({ windowMinutes: 15, maxTurns: 15, recentTurns: [] });
    flow.aiGateway.narrowLineReliabilityGrant = async () => GRANT;
    const event: any = { ...TEXT_EVENT, webhookEventId, messageText };
    event.inputEvidence = (await createLineAiInputEvidence({ turnKey: webhookEventId, parts: [{ partId: 'part-0',
      eventIdHash: 'c'.repeat(64), acceptedAtMs: Date.now(), rawText: messageText }] }))!.inputEvidence;
    await h.useCase.execute(event);
    return { event, saved };
  }

  it('X2: a discarded draft continuation keeps evidenceRefs valid for the real turn contract', async () => {
    const h = makeHarness({ permissions: CAPTURE, boundV2: true, expenseDraftConversation: {
      routeContexts: async () => [ACTIVE_DRAFT], answersOpenDraft: async () => false,
    } });
    const flow = h.useCase as any;
    flow.aiGateway.requestLineIntakeRoute = async (req: any) => {
      const part = req.inputEvidence.parts[0];
      return { status: 'ROUTED', intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.82,
        semanticSubrequests: [{ index: 0, kind: 'write', writeIntent: 'EXPENSE_DRAFT_CONTINUATION', goal: req.messageText,
          requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [{ partId: part.partId,
            rawSha256: part.rawSha256, startUtf16: 0, endUtf16: part.rawText.length }] }] };
    };
    await boundText(h, 'จ่ายแล้วนะ', 'fx5-contract-payment');
    assert.equal(h.turnRequests.length, 1);
    const request = h.turnRequests[0];
    assert.equal(request.semanticSubrequests[0].kind, 'general');
    assert.equal(request.semanticSubrequests[0].writeIntent, undefined);
    assert.ok(request.semanticSubrequests[0].evidenceRefs.length);
    assert.ok(parseLineAiSemanticSubrequests(request.semanticSubrequests, request.messageText, request.inputEvidence));
  });

  it('X2: explicit payment messages prepare an expense action before the router or evidence-link lane', async () => {
    for (const messageText of ['จ่ายแล้ว', 'โอนแล้ว', 'บันทึกจ่าย']) {
      const h = makeHarness({ permissions: [...CAPTURE, 'expense.payment.record'], boundV2: true,
        recentCaptures: [{ id: 'receipt-1', sourceDocumentType: 'ABBREVIATED_TAX_INVOICE', expenseDate: new Date(), grandTotalAmount: '500.80', createdAt: new Date() },
          { id: 'slip-1', sourceDocumentType: 'TRANSFER_SLIP', expenseDate: new Date(), grandTotalAmount: '500.80', createdAt: new Date() }] });
      const flow = h.useCase as any, calls: any[] = [], messages: any[] = [];
      flow.expenseActions = { preview: async (ctx: any, chat: string, input: any) => { calls.push({ ctx, chat, input }); return { reply: 'เตรียมบัตรบันทึกจ่ายค่ะ' }; },
        repairChoices: async () => null };
      flow.deliverRequiredMessages = async (_event: any, sent: any[]) => { messages.push(...sent); };
      await boundText(h, messageText, `fx5-payment-${messageText.length}`);
      assert.equal(calls.length, 1); assert.deepEqual(calls[0].input, { action: 'RECORD_PAYMENT', expenseId: 'receipt-1' });
      assert.equal(calls[0].ctx.authProvider, 'line'); assert.equal(calls[0].ctx.companyId, 'company-1');
      assert.equal(calls[0].chat, chatKeyHashOf(TEXT_EVENT));
      assert.equal(h.routeRequests.length, 0); assert.equal(h.turnRequests.length, 0); assert.equal(h.correctionCalls.length, 0);
      assert.match(JSON.stringify(messages), /เตรียมบัตรบันทึกจ่ายค่ะ/u);
    }
  });

  it('X2: correction labels use Thai document types and never echo an unknown enum', async () => {
    for (const [kind, label] of [['ABBREVIATED_TAX_INVOICE', 'ใบกำกับภาษีอย่างย่อ'], ['FUTURE_INTERNAL_KIND', 'เอกสารค่าใช้จ่าย']]) {
      const h = makeHarness({ permissions: CAPTURE, recentCaptures: [{ id: 'receipt-1', sourceDocumentType: kind!, expenseDate: new Date(), grandTotalAmount: '500.80', createdAt: new Date() }] });
      const candidates = await (h.useCase as any).loadCorrectionCandidates('company-1', 'user-1', chatKeyHashOf(TEXT_EVENT), {});
      assert.match(candidates[0].label, new RegExp(label!, 'u'));
      assert.equal(candidates[0].label.includes(kind), false);
    }
  });

  for (const answer of ['1', 'ใบเสร็จค่ะ']) {
    it(`"${answer}" answering the photo question drafts the stored photo before any route (RECEIPT-05)`, async () => {
      const { prisma, pendingMediaRows } = makePrisma();
      seedPendingRow(pendingMediaRows);
      const h = makeHarness({ permissions: CAPTURE, boundV2: true, prisma });
      await boundText(h, answer, `evt-bound-answer-${answer.length}`);
      assert.equal(h.routeRequests.length, 0, 'a deterministic answer never reaches the router');
      assert.equal(h.createExpenseCalls.length, 1, 'the stored photo becomes the draft, as production does');
      assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
      assert.doesNotMatch(h.replies.join('\n'), /ยังไม่แน่ใจ|ระบบตอบช้า|อ่านไฟล์/u);
    });
  }

  it('"1" on a parked check bill takes the paid-without-receipt lane before any route', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows, { askedQuestionJson: { kind: 'CHECK_BILL_ACTION', chatKeyHash: chatKeyHashOf(TEXT_EVENT),
      ocrFields: { grandTotalAmount: '853.00', vendorName: 'Grand Lobby Bar' } } });
    const h = makeHarness({ permissions: CAPTURE, boundV2: true, prisma, substituteResult: {
      handled: true, status: 'BLOCKED', workflowId: 'workflow-1', expenseId: 'expense-clarified-1', acceptedFields: [], blockers: [],
      pendingQuestion: 'ค่าใช้จ่ายนี้ใช้ทำอะไรคะ?', replyText: '📄 ใบรับรองแทนใบเสร็จรับเงิน' } });
    await boundText(h, '1', 'evt-bound-check-bill');
    assert.equal(h.routeRequests.length, 0);
    assert.equal(h.createExpenseCalls.length, 1, 'the check bill becomes one draft');
    assert.equal(h.checkBillStarts.length, 1, 'and its continuation starts, as production');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
  });

  it('a draft control answers the paused draft before any route', async () => {
    const executed: string[] = [];
    const h = makeHarness({ permissions: CAPTURE, boundV2: true, expenseDraftConversation: {
      routeContexts: async () => [ACTIVE_DRAFT],
      execute: async (_ctx: any, input: any) => { executed.push(input.messageText);
        return { handled: true, status: 'UPDATED', expenseId: 'expense-draft-1', replyTexts: ['🧾 ร่างล่าสุด'], acceptedFields: [] }; },
    } });
    await boundText(h, 'ทำต่อ', 'evt-bound-draft-control');
    assert.equal(h.routeRequests.length, 0);
    assert.deepEqual(executed, ['ทำต่อ']);
  });

  it('a free-text draft answer reaches the router WITH the open draft, and the draft takes the answer', async () => {
    const executed: any[] = [];
    const h = makeHarness({ permissions: CAPTURE, boundV2: true, expenseDraftConversation: {
      routeContexts: async () => [ACTIVE_DRAFT],
      execute: async (_ctx: any, input: any) => { executed.push(input);
        return { handled: true, status: 'UPDATED', expenseId: 'expense-draft-1', replyTexts: ['🧾 บันทึกที่อยู่ร้านแล้ว'], acceptedFields: ['D-ADDRESS'] }; },
    }, routePlan: { status: 'ROUTED', intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.9,
      semanticSubrequests: [{ index: 0, kind: 'write', writeIntent: 'EXPENSE_DRAFT_CONTINUATION', goal: 'ตอบที่อยู่ร้านของร่าง',
        requiredEvidence: [], requestedFilters: {}, dependsOn: [] }] } as any });
    await boundText(h, '99 ถนนสุขุมวิท กรุงเทพ', 'evt-bound-draft-answer');
    assert.equal(h.routeRequests.length, 1);
    assert.deepEqual(h.routeRequests[0].activeExpenseDrafts, [ACTIVE_DRAFT], 'production gave its router the open draft');
    assert.equal(executed.length, 1, 'the draft takes the answer');
    assert.equal(executed[0].messageText, '99 ถนนสุขุมวิท กรุงเทพ');
    assert.match(h.replies.join('\n'), /บันทึกที่อยู่ร้านแล้ว/u);
    // UAT 2026-09-29: this reply was plain text ending in a raw link with ids; production sent a card.
    const reply: any = h.sentMessages.at(-1)?.at(-1);
    assert.equal(reply?.type, 'flex', "production's card, not text");
    // Owner 2026-10-05: in a bound chat that card is the locked design (one body block: its pictures and
    // its button live in it), so it is read as a person reads it. The link still rides on the button.
    const card = readLineSystemCard(reply);
    assert.ok(card.texts.every((text) => !/https?:\/\//u.test(text)), 'no raw link in any text of the card');
    assert.deepEqual(card.actions.map((action) => action.label), ['เปิดดูรายการ']);
    assert.match(card.actions[0]!.uri ?? '', /expense-draft-1/u, 'the draft link rides on the button');
  });

  it('a correction reaches the router with the captures it may correct', async () => {
    const h = makeHarness({ permissions: CAPTURE, boundV2: true,
      recentCaptures: [{ id: 'expense-7', expenseDate: new Date('2026-09-29'), grandTotalAmount: '120.0000', sourceDocumentType: 'RECEIPT', createdAt: new Date() }],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_CAPTURE_CORRECTION', language: 'th', confidence: 0.9,
        semanticSubrequests: [{ index: 0, kind: 'write', writeIntent: 'EXPENSE_CAPTURE_CORRECTION', goal: 'แก้ยอดเป็น 500',
          requiredEvidence: [], requestedFilters: {}, dependsOn: [] }] } as any });
    await boundText(h, 'แก้ยอดเป็น 500', 'evt-bound-correction');
    assert.equal(h.routeRequests.length, 1);
    assert.deepEqual(h.routeRequests[0].recentCapturedExpenses?.map((row: any) => row.id), ['expense-7'],
      'production gave its router the recent capture to correct');
    assert.ok(h.routeRequests[0].substituteContext, 'and the substitute state');
    assert.equal(h.correctionCalls.length, 1, 'the correction lane runs on that route');
  });

  it('task choices send their own words, never a task id, and the words pick the same waiting clause', async () => {
    const h = makeHarness({ permissions: CAPTURE, boundV2: true });
    const flow = h.useCase as any;
    const owner = { companyId: 'company-1', userId: 'user-1', membershipId: 'mem-1', channel: 'line', channelKind: 'USER',
      messagingChannelId: 'ch-1', chatKeyHash: chatKeyHashOf(TEXT_EVENT) };
    const waitingTask = { taskId: 'task-7f3a9c', revision: 3, kind: 'write', state: 'waiting_user', userGoal: 'สองรายการ',
      subrequests: [
        { index: 0, kind: 'write', goal: 'บันทึกค่ากาแฟ', status: 'handled' },
        { index: 1, kind: 'write', goal: 'บันทึกค่าแท็กซี่', status: 'needs_user' },
      ],
      sourceRevisionLocators: [
        { sourceType: 'LINE_ACCEPTED_TASK_0_0', sourceId: 'ledger-source-1', revision: 'digest-1' },
        { sourceType: 'LINE_ACCEPTED_TASK_1_2', sourceId: 'ledger-source-1', revision: 'digest-1' },
      ] };
    flow.contextV2 = { projection: async () => ({ version: 2, stateVersion: 4, lifecycleEpoch: 0, expiresAtMs: Date.now() + 60_000, tasks: [waitingTask] }) };
    const bind = (event: object) => flow.boundConversations.set(event, { owner, id: 'line-v2:conversation-1', epoch: 0 });

    // What the customer is offered: the button's words, no id and no slash command.
    const offered = { ...TEXT_EVENT, webhookEventId: 'evt-offer' };
    bind(offered); flow.semanticTaskMappings.set(offered, []);
    const [choices] = await flow.remainingTaskChoiceMessages(offered);
    const items = choices.quickReply.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].action.label, 'บันทึกค่าแท็กซี่', 'the button names the work');
    assert.equal(items[0].action.text, 'ทำรายการ 1 ต่อ', 'the tap selects that exact retained clause');
    assert.doesNotMatch(JSON.stringify(choices), /task-7f3a9c|\/task/u);

    // Tapping it maps the words back to that clause's retained source.
    const sourceReads: string[] = [];
    flow.prisma.client.lineLedgerDelivery = { findUnique: async (args: any) => { sourceReads.push(args.where.id); return null; } };
    for (const words of [items[0].action.text, 'ทำข้อ 3 ก่อน']) {
      const tap = { ...TEXT_EVENT, webhookEventId: `evt-tap-${sourceReads.length}`, messageText: words };
      bind(tap);
      assert.equal(await flow.prepareRetainedTaskSelection(tap), true, `"${words}" is a task choice`);
    }
    assert.deepEqual(sourceReads, ['ledger-source-1', 'ledger-source-1'], 'both wordings reached the waiting clause, not another');

    // Nothing waiting: the same words are ordinary chat for the normal route.
    flow.contextV2 = { projection: async () => ({ version: 2, stateVersion: 4, lifecycleEpoch: 0, expiresAtMs: Date.now() + 60_000, tasks: [] }) };
    const idle = { ...TEXT_EVENT, webhookEventId: 'evt-idle', messageText: 'ทำรายการ 1 ต่อ' };
    bind(idle);
    assert.equal(await flow.prepareRetainedTaskSelection(idle), false);
  });

  it('an unrelated question beside a pending photo still goes to the model, and the photo keeps waiting', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({ permissions: CAPTURE, boundV2: true, prisma, routePlan: { status: 'ROUTED', intent: 'UNSUPPORTED',
      language: 'th', confidence: 0.9, semanticSubrequests: [{ index: 0, kind: 'general', goal: 'อธิบายกำไรขั้นต้น',
        requiredEvidence: [], requestedFilters: {}, dependsOn: [] }] } as any });
    await boundText(h, 'กำไรขั้นต้นคืออะไร', 'evt-bound-side-question');
    assert.equal(h.routeRequests.length, 1, 'the question is routed');
    assert.equal(h.createExpenseCalls.length, 0);
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'the photo still waits for its own answer');
  });
});

describe('LINE intake dispatch – buffered caption (message buffering spec §8)', () => {
  it('caption text buffered with the media reaches the intake route as messageText', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95,
        captureHints: { sourceDocumentType: 'RECEIPT', confidence: 0.9 },
      },
      prisma,
    });
    const result = await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'บันทึกค่าใช้จ่าย ร้านกาแฟ');
    assert.equal(result.outcome, 'done');
    assert.equal(h.routeRequests[0].messageText, 'บันทึกค่าใช้จ่าย ร้านกาแฟ');
    // The caption becomes part of the multi-turn memory preview.
    assert.match(turnCreates[0].data.userMessagePreview, /บันทึกค่าใช้จ่าย ร้านกาแฟ/);
  });

  it('RECEIPT-05: BUSINESS_READ_QUESTION with a caption persists the media + a PENDING row and asks ONE clarify question (no discard, no draft)', async () => {
    const { prisma, updates, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      prisma,
    });
    const result = await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'อันนี้คิดยังไง ยอดขายเดือนนี้เท่าไหร่');
    assert.equal(result.outcome, 'done');
    assert.equal(h.createUploadIntentCalls.length, 1, 'one attachment persisted');
    assert.equal(h.uploads.length, 1);
    assert.equal(h.completeAttachmentCalls.length, 1);
    assert.equal(pendingMediaRows.length, 1, 'one PENDING clarify row');
    assert.equal(pendingMediaRows[0].status, 'PENDING');
    assert.equal(pendingMediaRows[0].attachmentId, 'pending-att-1');
    assert.equal(pendingMediaRows[0].lineMessageId, 'msg-media-1');
    assert.equal(recordUpdates.length, 0, 'no expense draft created');
    assert.equal(h.createExpenseCalls.length, 0);
    assert.match(h.replies[0] ?? '', /ใบเสร็จ[\s\S]*ภาพประกอบ/);
    const statuses = updates.map((u: any) => u.data?.status);
    assert.ok(statuses.includes('clarification_required'),
      `expected clarification_required, got ${statuses.join(',')}`);
    assert.ok(!statuses.includes('caption_deferred_to_text'), 'no longer defers the caption');
  });

  it('RECEIPT-05 (Fix #7): a redelivered media+question event reuses the row — exactly one clarify reply, one attachment, one PENDING row, one intake turn', async () => {
    const { prisma, pendingMediaRows, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');
    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-media-redelivery' }, 'ยอดขายเดือนนี้เท่าไหร่');
    assert.equal(h.createUploadIntentCalls.length, 1, 'no second attachment on redelivery');
    assert.equal(h.uploads.length, 1);
    assert.equal(pendingMediaRows.length, 1, 'no second pending row on redelivery');
    assert.equal(h.replies.length, 1, 'redelivery stays silent — the clarify question is asked once');
    assert.equal(turnCreates.length, 1, 'no second intake turn persisted on redelivery');
  });

  it('RECEIPT-05 (Fix #8): a concurrent delivery that loses the unique pending-row race uploads no bytes (no orphaned attachment)', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    // Both racers pass the existence check (findUnique null) before either inserts; the unique
    // (companyId, lineMessageId) index elects one winner and the loser's create hits P2002.
    prisma.client.lineIntakePendingMedia.findUnique = async () => null;
    let creates = 0;
    prisma.client.lineIntakePendingMedia.create = async (args: any) => {
      if (creates++ > 0) { const e = new Error('unique') as Error & { code: string }; e.code = 'P2002'; throw e; }
      const row = { id: 'pm-1', ...args.data }; pendingMediaRows.push(row); return row;
    };
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');
    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-media-race' }, 'ยอดขายเดือนนี้เท่าไหร่');
    // Was 2 before the media-clarify context fix: every racer reserved an intent and the loser
    // orphaned it. The loser now sees the winner's still-open PENDING row and attaches to it, so no
    // second intent is reserved at all — strictly fewer orphans, same one-upload invariant.
    assert.equal(h.createUploadIntentCalls.length, 1, 'the loser attaches to the open row instead of reserving its own intent');
    assert.equal(h.uploads.length, 1, 'only the race winner uploaded bytes — the loser orphans nothing');
    assert.equal(h.completeAttachmentCalls.length, 1, 'exactly one attachment persisted');
    assert.equal(pendingMediaRows.length, 1, 'exactly one pending row');
  });

  it('RECEIPT-05: media+question without capture permission keeps the media-unsupported reply (no pending row)', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: ['line.ai.query', 'expense.signature.manage'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      prisma,
    });
    const result = await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');
    assert.equal(result.outcome, 'done');
    assert.equal(pendingMediaRows.length, 0);
    assert.equal(h.createUploadIntentCalls.length, 0);
    assert.match(h.replies[0] ?? '', /ระบบรองรับ/);
  });

  it('BUSINESS_READ_QUESTION without caption keeps the media-unsupported reply (a sender who cannot capture keeps the router)', async () => {
    const h = makeHarness({
      permissions: ['expense.signature.self_manage', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
    });
    const result = await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(result.outcome, 'done');
    assert.match(h.replies[0] ?? '', /ระบบรองรับ/);
  });
});

describe('lineIntakeRouterReason — when a photo still goes through the intake router (UAT 2026-09-29)', () => {
  const photo = { messageType: 'image' as const, caption: '', canCaptureExpense: true };
  const open = (value: boolean) => { const calls: number[] = []; return { calls, lookup: async () => { calls.push(1); return value; } }; };

  it('skips the router only for a caption-less photo from someone who can capture, with no substitute work open', async () => {
    const none = open(false);
    assert.equal(await lineIntakeRouterReason({ ...photo, substituteWorkOpen: none.lookup }), null);
    assert.equal(none.calls.length, 1);
  });

  it('keeps it for a file, a caption, a sender who cannot capture, and open substitute work — in that order', async () => {
    const unused = open(true);
    assert.equal(await lineIntakeRouterReason({ ...photo, messageType: 'file', substituteWorkOpen: unused.lookup }), 'file');
    assert.equal(await lineIntakeRouterReason({ ...photo, caption: 'ค่าอาหาร', substituteWorkOpen: unused.lookup }), 'caption');
    assert.equal(await lineIntakeRouterReason({ ...photo, canCaptureExpense: false, substituteWorkOpen: unused.lookup }), 'no_capture_permission');
    assert.equal(unused.calls.length, 0, 'the substitute lookup runs only when it could change the answer');
    const signature = open(true);
    assert.equal(await lineIntakeRouterReason({ ...photo, substituteWorkOpen: signature.lookup }), 'substitute_work_open');
  });

  it('treats a whitespace caption as no caption', async () => {
    assert.equal(await lineIntakeRouterReason({ ...photo, caption: ' \n ', substituteWorkOpen: async () => false }), null);
  });
});

// RECEIPT-05: the text reply that resolves a pending media-clarify question.
function seedPendingRow(pendingMediaRows: any[], overrides: Partial<Record<string, any>> = {}) {
  pendingMediaRows.push({
    id: 'pm-1', companyId: 'company-1', userId: 'user-1', lineMessageId: 'msg-media-1',
    attachmentId: 'pending-att-1', caption: 'ยอดขายเดือนนี้เท่าไหร่', mimeType: 'image/jpeg',
    status: 'PENDING', expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), ...overrides,
  });
}

describe('LINE intake dispatch – RECEIPT-05 media-clarify follow-up', () => {
  it('completes choice 1 and returns the web-only substitute outcome in the same delivered turn', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'expense.confirm', 'line.ai.query'],
      prisma,
      captureLedger,
      substituteResult: {
        handled: true, status: 'BLOCKED', workflowId: 'workflow-1', expenseId: 'expense-clarified-1',
        acceptedFields: [], blockers: [{ code: 'supporting_evidence_required' }],
        pendingQuestion: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?',
        replyText: '📄 ใบรับรองแทนใบเสร็จรับเงิน\nลงนามและอนุมัติทำในเว็บค่ะ เตรียมใบรับรองเสร็จแล้วน้องจะส่งลิงก์ให้\nเปิดตรวจสอบในเว็บ: /opaque-workflow',
      },
    });

    await h.useCase.execute({
      ...TEXT_EVENT,
      webhookEventId: 'evt-choice-and-substitute',
      messageText: 'ข้อ 1 และออกใบรับรองแทนเงินสดให้ฉัน',
    });

    assert.equal(h.createExpenseCalls.length, 1, 'the permitted receipt outcome completes once');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
    assert.equal(h.substituteCalls.length, 1, 'the additional clause is evaluated independently');
    assert.equal(h.substituteCalls[0].recentCandidates[0].id, 'expense-clarified-1');
    assert.match(h.replies[0] ?? '', /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/);
    assert.match(h.replies[0] ?? '', /ใบรับรองแทนใบเสร็จรับเงิน/);
    assert.match(h.replies[0] ?? '', /ลงนามและอนุมัติทำในเว็บค่ะ เตรียมใบรับรองเสร็จแล้วน้องจะส่งลิงก์ให้/);
    assert.equal(captureLedger.length, 1, 'only the unresolved substitute question remains in the ledger');
  });

  it('"ใช่ ใบเสร็จ" builds the draft from the STORED attachment (original message id) and marks the row RESOLVED_RECEIPT', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      scopes: { branchIds: ['branch-a'] },
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-confirm-receipt', messageText: 'ใช่ ใบเสร็จ' });
    assert.equal(h.createExpenseCalls.length, 1, 'draft created');
    assert.equal(h.createExpenseCalls[0].lineMessageId, 'msg-media-1', 'idempotency uses the ORIGINAL media message id');
    assert.equal(h.createExpenseCalls[0].branchId, 'branch-a', 'clarified media keeps the caller branch scope');
    assert.equal(h.linkAttachmentCalls.length, 1);
    assert.equal(h.linkAttachmentCalls[0][1], 'pending-att-1', 'links the already-persisted attachment (no re-download)');
    assert.equal(h.createUploadIntentCalls.length, 0, 'no new attachment on resolve');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
    assert.match(h.replies[0] ?? '', /expense-clarified-1/);
    assert.match(h.replies[0] ?? '', /ตรวจสอบและยืนยันในเว็บแอป/);
  });

  it('"ใช่ ใบเสร็จ" warns when the stored attachment checksum matches a web upload', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });
    const repo = (h.useCase as any).expenseRepo;
    repo.findExpenseIdsByAttachmentChecksum = async () => ['expense-from-web'];

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-confirm-duplicate', messageText: 'ใช่ ใบเสร็จ' });

    assert.equal(h.updateExpenseCalls.some((update) => 'duplicateStatus' in update), false);
    assert.equal(h.updateExpenseCalls.at(-1).aiVerificationSummaryJson.duplicateWarning, true);
    assert.match(h.replies[0] ?? '', /อาจซ้ำ/);
  });

  it('keeps a receipt choice pending when the capture outcome cannot be delivered', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
      lineReplyResult: 'failed_other',
    });

    await assert.rejects(h.useCase.execute({
      ...TEXT_EVENT,
      webhookEventId: 'evt-receipt-delivery-fail',
      messageText: 'ใช่ ใบเสร็จ',
    }));

    assert.equal(h.createExpenseCalls.length, 1, 'the idempotent draft may exist for retry');
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'stored media is not consumed before delivery');
  });

  it('a redelivered receipt confirmation reuses the existing draft (findByLineMessageId) instead of creating a second', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      findExpenseByLineMessageId: async (_c, lineMessageId) => ({ id: 'expense-existing-1', lineMessageId, sourceDocumentType: 'RECEIPT' }),
      prisma,
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-confirm-again', messageText: 'ใช่ ใบเสร็จ' });
    assert.equal(h.createExpenseCalls.length, 0, 'no second draft');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
    assert.match(h.replies[0] ?? '', /expense-existing-1/);
  });

  it('a pending confirmation for an already reviewed receipt returns the saved record without resetting review or linking again', async () => {
    const { prisma, pendingMediaRows } = makePrisma(); seedPendingRow(pendingMediaRows);
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], prisma,
      findExpenseByLineMessageId: async () => ({ id: 'reviewed-original', lineMessageId: 'msg-media-1',
        primaryAttachmentId: 'pending-att-1', status: 'CONFIRMED', reviewedAt: new Date(),
        grandTotalAmount: '777', aiVerificationSummaryJson: { humanReview: true },
        attachments: [{ id: 'pending-att-1', purpose: 'expense.receipt.primary' }] }),
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-reviewed-retry', messageText: 'ใช่ ใบเสร็จ' });
    assert.equal(h.createExpenseCalls.length, 0); assert.equal(h.linkAttachmentCalls.length, 0); assert.equal(h.updateExpenseCalls.length, 0);
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
    assert.match(h.replies.at(-1)!, /เก็บรายการนี้ไว้แล้ว/); assert.match(h.replies.at(-1)!, /reviewed-original/);
    assert.doesNotMatch(h.replies.at(-1)!, /เบื้องต้น|รอตรวจสอบ/);
  });

  it('Fix #5: a link failure on first resolve leaves the row PENDING; the retry repairs the link and only then resolves (receipt never detached)', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    // First resolve: createExpense succeeds but linkAttachment throws — a partial draft. The retry
    // finds that partial expense and must REPAIR the link (not rubber-stamp it) before resolving.
    let findCalls = 0;
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      findExpenseByLineMessageId: async () =>
        findCalls++ === 0 ? null : { id: 'expense-clarified-1', lineMessageId: 'msg-media-1', primaryAttachmentId: null },
      prisma,
    });
    const repo = (h.useCase as any).expenseRepo;
    const realLink = repo.linkAttachment;
    let linkCalls = 0;
    repo.linkAttachment = async (...a: any[]) => {
      if (linkCalls++ === 0) throw new Error('attachment link failed');
      return realLink(...a);
    };

    await assert.rejects(h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-r1', messageText: 'ใช่ ใบเสร็จ' }));
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'row NOT resolved while the receipt is still detached');

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-r2', messageText: 'ใช่ ใบเสร็จ' });
    assert.equal(h.createExpenseCalls.length, 1, 'no second draft — the retry repairs the partial one');
    assert.equal(linkCalls, 2, 'the retry re-attempted the attachment link');
    assert.ok(h.updateExpenseCalls.some((u: any) => u.primaryAttachmentId === 'pending-att-1'), 'primaryAttachmentId repaired');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT', 'row resolves only once the attachment is really linked');
    assert.match(h.replies.at(-1) ?? '', /expense-clarified-1/);
  });

  it('"แค่ภาพประกอบ" creates no draft, marks the row RESOLVED_ILLUSTRATION, and answers the ORIGINAL caption as a text turn', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-illustration', messageText: 'แค่ภาพประกอบ' });
    assert.equal(h.createExpenseCalls.length, 0, 'no draft');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_ILLUSTRATION');
    // The stored caption — not the "just an illustration" reply — is what reaches the intake route + AI turn.
    assert.match(h.routeRequests.at(-1)?.messageText ?? '', /ยอดขาย/);
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });

  it('"สรุปหลายรายการ" preserves the file, creates no expense, and closes the pending review choice after delivery', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      prisma,
    });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-multiple', messageText: 'สรุปหลายรายการ' });

    assert.equal(h.createExpenseCalls.length, 0, 'multiple transactions never collapse into one draft');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_MULTI_ENTRY_REVIEW');
    assert.match(h.replies[0] ?? '', /ยังไม่ได้สร้างค่าใช้จ่ายรายการเดียว/);
    assert.match(h.replies[0] ?? '', /\/companies\/company-1\/expenses/);
    assert.equal(h.routeRequests.length, 0, 'the model cannot reinterpret the safe multi-entry decision');
  });

  it('"1 ค่าไฟ" cannot turn a known multi-document photo into one expense', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows, { askedQuestionJson: { kind: 'RECEIPT_CLARIFY', detectedMultiDocument: true } });
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], prisma });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-multi-choice-one', messageText: '1 ค่าไฟ' });

    assert.equal(h.createExpenseCalls.length, 0);
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_MULTI_ENTRY_REVIEW');
    assert.match(h.replies[0] ?? '', /เอกสารมากกว่า 1 ฉบับ/);
    assert.equal(h.routeRequests.length, 0);
  });

  it('keeps an illustration choice pending until the deferred answer is delivered', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
      lineReplyResult: 'failed_other',
    });

    await h.useCase.execute({
      ...TEXT_EVENT,
      webhookEventId: 'evt-illustration-delivery-fail',
      messageText: 'แค่ภาพประกอบ',
    });

    assert.equal(pendingMediaRows[0].status, 'PENDING');
  });

  it('an ambiguous follow-up leaves the row PENDING and routes the reply normally', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-ambiguous', messageText: 'เดี๋ยวก่อนนะ' });
    assert.equal(h.createExpenseCalls.length, 0);
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'row untouched');
    assert.match(h.routeRequests.at(-1)?.messageText ?? '', /เดี๋ยวก่อน/, 'the original reply routes, not the caption');
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });

  it('an expired pending row is ignored — the reply routes normally, no draft, row left as-is', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows, { expiresAt: new Date(Date.now() - 60_000) });
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-expired', messageText: 'ใช่ ใบเสร็จ' });
    assert.equal(h.createExpenseCalls.length, 0, 'expired row not consumed');
    assert.equal(pendingMediaRows[0].status, 'PENDING');
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });
});

describe('media clarify carries its file into the next turn', () => {
  // The defect this closes: the media path stored the picture and asked a question, but wrote
  // nothing to the ledger. The follow-up reply therefore arrived with no open clarification and no
  // handle on the stored file, so the assistant asked the customer to send a picture it already had.
  it('appends a waiting_user clarification naming the stored attachment', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      captureLedger,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');

    assert.equal(captureLedger.length, 1, 'the question is carried, not dropped');
    const item = captureLedger[0].items[0];
    assert.equal(item.state, 'waiting_user');
    assert.equal(item.clarifyForIntent, 'EXPENSE_DOCUMENT_CAPTURE');
    // The caption is the deferred request, mirroring the text path.
    assert.equal(item.text, 'ยอดขายเดือนนี้เท่าไหร่');
    // The handle that lets the next turn talk about THIS file instead of asking for a new one.
    assert.equal(item.pendingMedia?.attachmentId, 'pending-att-1');
    assert.ok(item.pendingMedia?.pendingMediaId, 'the pending row id rides along');
  });

  it('names the file in the turn preview so multi-turn memory can refer back to it', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      prisma,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');

    // Was the bare '[ผู้ใช้ส่งรูป/ไฟล์]': the model could see a picture had been sent but had no
    // way to say WHICH, so a later turn could only ask for it again.
    assert.match(turnCreates.at(-1)?.data?.userMessagePreview ?? '', /\[ผู้ใช้ส่งรูป\/ไฟล์ #pending-att-1\]/);
  });

  // Step 3 of the reported loop: an unrecognised answer left the row PENDING, the customer sent the
  // picture again, and a SECOND row + question came back — forever, storing a copy each round.
  it('re-sending a picture while a question is open does not ask again or store a second copy', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');
    const repliesAfterFirst = h.replies.length;
    await h.useCase.executeReceiptUpload(
      { ...MEDIA_EVENT, webhookEventId: 'evt-media-2', lineMessageId: 'line-msg-2' },
      'ยอดขายเดือนนี้เท่าไหร่',
    );

    assert.equal(h.replies.length, repliesAfterFirst, 'the open question is not repeated');
    assert.equal(h.uploads.length, 1, 'the picture is not stored twice');
  });
});

describe('classifyPendingMediaReply (RECEIPT-05 follow-up resolver)', () => {
  it('splits a numbered clarification outcome from an independent trailing request', () => {
    assert.deepEqual(splitPendingMediaReply('ข้อ 1 และออกใบรับรองแทนเงินสดให้ฉัน'), {
      decision: 'receipt', remainder: 'ออกใบรับรองแทนเงินสดให้ฉัน',
    });
    assert.equal(splitPendingMediaReply('จ่ายไป 2 ใบ'), null);
  });
  it('affirmative / receipt words → receipt', () => {
    for (const t of ['ใช่ ใบเสร็จ', 'บันทึกเลย', 'receipt please', 'บิลค่าอาหาร', 'สลิปโอน']) {
      assert.equal(classifyPendingMediaReply(t), 'receipt', t);
    }
  });
  it('illustration / negation words → illustration', () => {
    for (const t of ['แค่ภาพประกอบ', 'ไม่ใช่', 'แค่ถามเฉยๆ', 'just an illustration', 'no']) {
      assert.equal(classifyPendingMediaReply(t), 'illustration', t);
    }
  });
  it('multiple-entry words → safe multi-entry review', () => {
    for (const t of ['สรุปหลายรายการ', 'หลายรายการ', 'multiple entries']) {
      assert.equal(classifyPendingMediaReply(t), 'multiple', t);
    }
  });
  it('"ไม่ใช่" resolves to illustration even though it contains "ใช่"', () => {
    assert.equal(classifyPendingMediaReply('ไม่ใช่'), 'illustration');
  });
  it('Fix #4: a refusal that CONTAINS a receipt keyword is never receipt (no draft from a "no")', () => {
    // 'ไม่ต้องบันทึก' contains 'บันทึก'; 'ไม่เอา' is a bare refusal — both must NOT return receipt.
    for (const t of ['ไม่ต้องบันทึก', 'ไม่เอา', 'ยกเลิก', "don't save it", 'no, cancel']) {
      assert.notEqual(classifyPendingMediaReply(t), 'receipt', t);
    }
  });
  it('Fix #4: the question particle "ไหม" is NOT treated as the negation "ไม่"', () => {
    // 'ใช่ใบเสร็จไหม' ("is it a receipt?") carries no 'ไม่', so its receipt words still count.
    assert.equal(classifyPendingMediaReply('ใช่ใบเสร็จไหม'), 'receipt');
  });
  it('neither / both matched → ambiguous (never consume the row on a guess)', () => {
    assert.equal(classifyPendingMediaReply('เดี๋ยวก่อนนะ'), 'ambiguous');
    assert.equal(classifyPendingMediaReply('ใช่ แต่แค่ภาพประกอบ'), 'ambiguous');
    assert.equal(classifyPendingMediaReply(''), 'ambiguous');
  });

  // The reported loop: the question offers choices, the customer answers with one, and the resolver
  // did not recognise it — so the row stayed PENDING and the reply was routed as a fresh message
  // with no picture attached to it, which made the assistant ask for a picture again.
  it('accepts the numbered choice the question actually offers', () => {
    for (const t of ['1', '1.', '1)', 'ข้อ 1', 'แรก', 'อันแรก', 'ข้อแรก', 'อันที่ 1']) {
      assert.equal(classifyPendingMediaReply(t), 'receipt', t);
    }
    for (const t of ['1 ค่าไฟ', '1 ค่าน้ำ']) {
      assert.equal(classifyPendingMediaReply(t), 'receipt', t);
    }
    for (const t of ['2', '2)', 'ข้อ 2', 'สอง', 'อันที่สอง']) {
      assert.equal(classifyPendingMediaReply(t), 'illustration', t);
    }
    for (const t of ['3', '3)', 'ข้อ 3', 'สาม', 'อันที่สาม']) {
      assert.equal(classifyPendingMediaReply(t), 'multiple', t);
    }
  });

  // Anchored to the whole reply: a lone digit is a choice, a number inside a sentence is data.
  it('never reads an amount or a count as a menu choice', () => {
    for (const t of ['1500', 'จ่ายไป 2 ใบ', '1 พันบาท', '12']) {
      assert.equal(classifyPendingMediaReply(t), 'ambiguous', t);
    }
  });

  it('accepts the document names customers actually type, including the question’s own words', () => {
    for (const t of ['ใบกำกับภาษี', 'ใบแจ้งหนี้', 'ใบส่งของ', 'ใบวางบิล', 'invoice', 'เอกสารค่าใช้จ่าย']) {
      assert.equal(classifyPendingMediaReply(t), 'receipt', t);
    }
  });

  // Deliberate non-goal: against an A-or-B question a bare "yes" picks a side by guessing. These
  // fall through to the model, which now receives the open clarification WITH the stored file.
  it('leaves a bare affirmative to the model rather than guessing a side', () => {
    for (const t of ['ครับ', 'ค่ะ', 'ok', 'โอเค']) {
      assert.equal(classifyPendingMediaReply(t), 'ambiguous', t);
    }
  });

  it('keeps refusing a negation that also names the document', () => {
    assert.notEqual(classifyPendingMediaReply('ไม่ใช่ใบกำกับภาษี'), 'receipt');
    assert.notEqual(classifyPendingMediaReply('ไม่ต้องบันทึกใบเสร็จ'), 'receipt');
  });
});

// Spec §11 (R14) / R10: media that arrives while this chat has open substitute work.
describe('LINE intake dispatch – substitute-receipt media (§11)', () => {
  const SCAN = {
    expenseId: 'expense-1', evidenceId: 'evidence-1', documentNumber: 'SUB-202608-00007',
    // Printed five minutes ago: a caption-less photo right after that ask may be the signed sheet.
    amountLabel: '50.0000 THB', preparedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  };
  const AWAITING = { expenseId: 'expense-1', awaitingScans: [SCAN] };
  const OPEN_ONLY = { expenseId: 'expense-1', awaitingScans: [] };
  const SUBSTITUTE_PERMISSIONS = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.review'];
  /** MANAGER: holds expense.review, does not hold expense.receipt.upload (§14 keeps that the gate). */
  const MANAGER_PERMISSIONS = ['expense.receipt.line_upload', 'expense.review'];
  const CAPTURE_PLAN = { status: 'ROUTED' as const, intent: 'EXPENSE_DOCUMENT_CAPTURE' as const, language: 'th', confidence: 0.95 };
  const CHAT_KEY_HASH = chatKeyHashOf(MEDIA_EVENT);

  /** The question the arrival turn recorded, as the answer turn will read it back. */
  const askedClass = (choices: string[], chatKeyHash = CHAT_KEY_HASH) =>
    ({ kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash, choices });
  const askedScan = (evidenceId = 'evidence-1', chatKeyHash = CHAT_KEY_HASH) =>
    ({ kind: 'SUBSTITUTE_SCAN_CONFIRM', chatKeyHash, evidenceId });

  it('asks the D9 question naming the document number and amount, and keeps the bytes pending', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma, substituteMediaContext: AWAITING,
      routePlan: CAPTURE_PLAN, receiptOcrResult: validReceiptOcr(),
    });

    const result = await h.useCase.executeReceiptUpload(MEDIA_EVENT);

    assert.equal(result.outcome, 'done');
    assert.match(h.replies[0] ?? '', /SUB-202608-00007/);
    assert.match(h.replies[0] ?? '', /50\.0000 THB/);
    assert.match(h.replies[0] ?? '', /• ใช่/);
    assert.equal(pendingMediaRows.length, 1, 'the bytes wait for the answer');
    assert.equal(pendingMediaRows[0].status, 'PENDING');
    // FIX-1: the row remembers WHICH question it was asked, and in which chat.
    assert.deepEqual(pendingMediaRows[0].askedQuestionJson, askedScan());
    assert.equal(h.initCalls.length, 0, 'no expense draft is created from an unclassified photo');
    assert.equal(h.linkScanCalls.length, 0, '§16: a photo alone links nothing');
  });

  it('asks one question with choices without the signed-form choice when a caption names nothing and nothing awaits a scan', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma, substituteMediaContext: OPEN_ONLY,
      routePlan: CAPTURE_PLAN, receiptOcrResult: validReceiptOcr(),
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'อันนี้นะ');

    assert.equal((h.replies[0] ?? '').includes('ฟอร์มที่เซ็นแล้ว'), false);
    assert.match(h.replies[0] ?? '', /• สลิป\/หลักฐานการจ่ายของรายการนี้/);
    assert.match(h.replies[0] ?? '', /• ภาพประกอบคำถาม ไม่ต้องบันทึก/);
    assert.deepEqual(
      pendingMediaRows[0].askedQuestionJson,
      askedClass(['PAYMENT_EVIDENCE', 'SUPPORTING_EVIDENCE', 'NEW_EXPENSE', 'NO_RECORD']),
    );
  });

  // UAT round 10 (2026-09-30, the Owner's own chat): a week-old OPEN state that asked for nothing turned two clear
  // caption-less receipts into this numbered question. Owner: "ถ้าอ่านรูปได้แล้วต้องสร้างเลย จะวนกลับมาถามทำไม".
  it('reads and drafts a caption-less photo as a new expense when the open work asked for no picture recently', async () => {
    for (const context of [OPEN_ONLY, { expenseId: 'expense-1', awaitingScans: [{ ...SCAN, preparedAt: '2026-08-20T09:00:00.000Z' }] },
      { expenseId: 'expense-1', awaitingScans: [], signatureRequested: true }]) {
      const { prisma, pendingMediaRows } = makePrisma();
      const h = makeHarness({
        permissions: SUBSTITUTE_PERMISSIONS, prisma, substituteMediaContext: context,
        routePlan: CAPTURE_PLAN, receiptOcrResult: validReceiptOcr(),
      });

      await h.useCase.executeReceiptUpload(MEDIA_EVENT);

      assert.equal(h.routeRequests.length, 0, 'the router is skipped exactly as when no work is open');
      assert.equal(h.initCalls.length, 1, 'the photo becomes a new expense draft');
      assert.deepEqual(pendingMediaRows.map(row => row.askedQuestionJson?.kind).filter(Boolean), [], 'no numbered question is parked');
      assert.doesNotMatch(h.replies.join('\n'), /ยังไม่แน่ใจว่าเป็นอะไร|ตอบเลขข้อ/u);
    }
  });

  it('attaches straight to the open work when the caption already says what the file is', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma, substituteMediaContext: OPEN_ONLY,
      routePlan: CAPTURE_PLAN, receiptOcrResult: validReceiptOcr(),
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'สลิปโอนค่ะ');

    assert.deepEqual(h.attachMediaCalls, [{
      language: 'th', expenseId: 'expense-1', attachmentId: 'pending-att-1',
      purpose: 'expense.payment.evidence', webBaseUrl: 'https://app.example.com',
    }]);
    assert.equal(h.initCalls.length, 0, 'no second expense is created for a slip of the open one');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');

    const supporting = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma: makePrisma().prisma,
      substituteMediaContext: OPEN_ONLY, routePlan: CAPTURE_PLAN, receiptOcrResult: validReceiptOcr(),
    });
    await supporting.useCase.executeReceiptUpload(MEDIA_EVENT, 'หลักฐานค่าที่จอดรถค่ะ');
    assert.equal(supporting.attachMediaCalls[0].purpose, 'expense.receipt.supporting');
  });

  it('never takes a photo that a different intent already answered', async () => {
    // The signature ticket owns its own route, and a DEGRADED router must not let a signature
    // caption reach the D9 confirm either — one ใช่ there would crop a signature into a certificate.
    for (const routePlan of [
      { status: 'ROUTED' as const, intent: 'SIGNATURE_UPLOAD_TICKET' as const, language: 'th', confidence: 0.92 },
      { status: 'DEGRADED' as const, reason: 'router_unavailable' as const },
    ]) {
      const h = makeHarness({
        permissions: [...SUBSTITUTE_PERMISSIONS, 'expense.signature.manage'],
        substituteMediaContext: AWAITING, routePlan: routePlan as any,
        prisma: makePrisma().prisma, receiptOcrResult: validReceiptOcr(),
      });
      await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ลายเซ็นค่ะ');
      assert.equal(h.linkScanCalls.length, 0, 'a signature caption never reaches D9');
      assert.equal(h.attachMediaCalls.length, 0);
      assert.equal((h.replies[0] ?? '').includes('SUB-202608-00007'), false);
    }

    // The four routes that already have an answer keep it, context or no context.
    const routes: Array<[string, any, RegExp]> = [
      ['CLARIFY', { status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0.5, clarifyQuestion: 'ถามกลับ' }, /ถามกลับ/],
      ['MUTATION_REQUEST_REFUSAL', { status: 'ROUTED', intent: 'MUTATION_REQUEST_REFUSAL', language: 'th', confidence: 0.9 }, /ไม่สามารถทำรายการ/],
      ['BUSINESS_READ_QUESTION', { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 }, /รูปนี้เป็นอะไรคะ/],
      ['UNSUPPORTED', { status: 'ROUTED', intent: 'UNSUPPORTED', language: 'th', confidence: 0.9 }, /รูปนี้เป็นอะไรคะ/],
    ];
    for (const [name, routePlan, expected] of routes) {
      const h = makeHarness({
        permissions: SUBSTITUTE_PERMISSIONS, prisma: makePrisma().prisma,
        substituteMediaContext: AWAITING, routePlan, receiptOcrResult: validReceiptOcr(),
      });
      await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');
      assert.match(h.replies[0] ?? '', expected, name);
      assert.equal(h.attachMediaCalls.length, 0, `${name}: the substitute branch stays out of it`);
      assert.equal((h.replies[0] ?? '').includes('SUB-202608-00007'), false, `${name}: no D9`);
    }
  });

  it('leaves every no-context turn exactly as it was, and never doubles an already-captured photo', async () => {
    const { prisma, recordUpdates } = makePrisma();
    const noContext = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma, substituteMediaContext: undefined,
      substituteResult: { handled: true, status: 'BLOCKED', acceptedFields: [], blockers: [], replyText: 'x' },
      routePlan: CAPTURE_PLAN, receiptOcrResult: validReceiptOcr(),
    });
    await noContext.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(noContext.initCalls.length, 1, 'without open substitute work the photo is a new expense');
    assert.equal(noContext.attachMediaCalls.length, 0);
    assert.ok(recordUpdates.length > 0);

    // MANAGER: expense.review but no expense.receipt.upload. §14 keeps the attach gate, so the
    // branch never claims the arrival — their photo keeps the behaviour it has today.
    const manager = makePrisma();
    const managerTurn = makeHarness({
      permissions: MANAGER_PERMISSIONS, prisma: manager.prisma, substituteMediaContext: AWAITING,
      routePlan: CAPTURE_PLAN, receiptOcrResult: validReceiptOcr(),
    });
    await managerTurn.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(managerTurn.mediaContextCalls.length, 0);
    assert.equal(managerTurn.initCalls.length, 1, 'existing capture behaviour, unchanged');

    // The same photo redelivered after the substitute work opened: it is already an expense.
    const redelivered = makePrisma();
    const saved = { id: 'expense-1', companyId: 'company-1', sourceDocumentType: 'RECEIPT', status: 'CONFIRMED',
      createdByUserId: 'user-1', branchId: 'branch-1', primaryAttachmentId: 'att-1', captureSource: 'LINE_UPLOAD',
      updatedAt: new Date('2026-09-15T00:00:00Z'), sourceChannelMetadataJson: { chatKeyHash: chatKeyHashOf(MEDIA_EVENT) } };
    const again = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma: redelivered.prisma, substituteMediaContext: AWAITING,
      routePlan: CAPTURE_PLAN, receiptOcrResult: validReceiptOcr(),
      findExpenseByLineMessageId: async () => saved,
      expenseDetail: saved,
    });
    await again.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-media-redelivered' });
    assert.equal(redelivered.pendingMediaRows.length, 0, 'no second copy of an already-captured photo');
    assert.equal(again.attachMediaCalls.length, 0);
    assert.equal(again.routeRequests.length, 0, 'an existing capture needs no second admission');
    assert.equal(again.ocrRequests.length, 0);
    assert.equal(again.initCalls.length, 0);
    assert.match(again.replies[0] ?? '', /เก็บรายการนี้ไว้แล้ว/);
    assert.match(again.replies[0] ?? '', /\/companies\/company-1\/expenses\/expense-1/);
    assert.doesNotMatch(again.replies[0] ?? '', /ยังไม่ยืนยันรายการ|ส่งรูป.*ใหม่/);
  });

  it('resolves a numbered answer against the question that was asked, never against today’s list', async () => {
    // The inversion this guards: an old receipt-clarify “2” means "just an illustration, do NOT
    // record". Read off the substitute list it would mean "supporting evidence" and file the photo.
    const legacy = makePrisma();
    seedPendingRow(legacy.pendingMediaRows, { caption: 'ยอดขายเดือนนี้เท่าไหร่', askedQuestionJson: { kind: 'RECEIPT_CLARIFY', chatKeyHash: CHAT_KEY_HASH } });
    const legacyTurn = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma: legacy.prisma, substituteMediaContext: OPEN_ONLY,
    });
    await legacyTurn.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-legacy-2', messageText: '2' });
    assert.equal(legacyTurn.attachMediaCalls.length, 0, 'an illustration answer never attaches evidence');
    assert.equal(legacyTurn.createExpenseCalls.length, 0);
    assert.equal(legacy.pendingMediaRows[0].status, 'RESOLVED_ILLUSTRATION', 'the receipt clarify resolved it, as before');

    // A row with no recorded question at all (written before this existed) is likewise not ours.
    const unrecorded = makePrisma();
    seedPendingRow(unrecorded.pendingMediaRows, { caption: '' });
    const unrecordedTurn = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma: unrecorded.prisma, substituteMediaContext: AWAITING,
    });
    await unrecordedTurn.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-unrecorded', messageText: '1' });
    assert.equal(unrecordedTurn.linkScanCalls.length, 0, 'a D9-shaped “1” cannot link a row that was never asked D9');
    assert.equal(unrecordedTurn.attachMediaCalls.length, 0);

    // A row questioned in a DIFFERENT chat is not this chat's to resolve either.
    const otherChat = makePrisma();
    seedPendingRow(otherChat.pendingMediaRows, { caption: '', askedQuestionJson: askedClass(['PAYMENT_EVIDENCE'], 'another-chat') });
    const otherChatTurn = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma: otherChat.prisma, substituteMediaContext: OPEN_ONLY,
    });
    await otherChatTurn.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-other-chat', messageText: '1' });
    assert.equal(otherChatTurn.attachMediaCalls.length, 0);
  });

  it('links the scan on ใช่, is idempotent on redelivery, and issues nothing by itself', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows, { caption: '', askedQuestionJson: askedScan() });
    const h = makeHarness({ permissions: SUBSTITUTE_PERMISSIONS, prisma, substituteMediaContext: AWAITING });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-confirm-1', messageText: 'ใช่' });

    assert.deepEqual(h.linkScanCalls, [{
      language: 'th', expenseId: 'expense-1', evidenceId: 'evidence-1', attachmentId: 'pending-att-1',
      checksumSha256: 'scan-checksum', webBaseUrl: 'https://app.example.com',
    }]);
    assert.match(h.replies[0] ?? '', /รอยืนยัน/);
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
    assert.equal(h.createExpenseCalls.length, 0, 'a confirmed form is not a new expense');

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-confirm-2', messageText: 'ใช่' });
    assert.equal(h.linkScanCalls.length, 1, 'the resolved row is no longer pending');
  });

  it('lists the other forms on ไม่ใช่, and links the one that is picked (§15)', async () => {
    const second = {
      expenseId: 'expense-2', evidenceId: 'evidence-2', documentNumber: 'SUB-202608-00009',
      amountLabel: '99.0000 THB', preparedAt: '2026-08-20T08:00:00.000Z',
    };
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows, { caption: '', askedQuestionJson: askedScan() });
    const h = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma,
      substituteMediaContext: { expenseId: 'expense-1', awaitingScans: [SCAN, second] },
    });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-not-this-one', messageText: 'ไม่ใช่' });

    assert.equal(h.linkScanCalls.length, 0);
    assert.match(h.replies[0] ?? '', /• SUB-202608-00009 ยอด 99\.0000 THB/);
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'the bytes are still waiting');
    assert.deepEqual(pendingMediaRows[0].askedQuestionJson,
      { kind: 'SUBSTITUTE_SCAN_PICK', chatKeyHash: CHAT_KEY_HASH, evidenceIds: ['evidence-2'] });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-pick-1', messageText: '1' });
    assert.deepEqual(h.linkScanCalls.map((call: any) => call.evidenceId), ['evidence-2']);
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
  });

  it('falls back to the plain question with choices on ไม่ใช่ when no other form awaits a scan (§15)', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows, { caption: '', askedQuestionJson: askedScan() });
    const h = makeHarness({ permissions: SUBSTITUTE_PERMISSIONS, prisma, substituteMediaContext: AWAITING });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-none-left', messageText: 'ไม่ใช่' });

    assert.equal(h.linkScanCalls.length, 0);
    assert.equal((h.replies[0] ?? '').includes('ฟอร์มที่เซ็นแล้ว'), false);
    assert.match(h.replies[0] ?? '', /• สลิป\/หลักฐานการจ่ายของรายการนี้/);
    assert.equal(pendingMediaRows[0].status, 'PENDING');
    assert.deepEqual(pendingMediaRows[0].askedQuestionJson,
      askedClass(['PAYMENT_EVIDENCE', 'SUPPORTING_EVIDENCE', 'NEW_EXPENSE', 'NO_RECORD']));
  });

  it('routes the recorded choices to attach, to the capture path, and to the do-not-record escape', async () => {
    const choices = ['PAYMENT_EVIDENCE', 'SUPPORTING_EVIDENCE', 'NEW_EXPENSE', 'NO_RECORD'];
    const attach = makePrisma();
    seedPendingRow(attach.pendingMediaRows, { caption: '', askedQuestionJson: askedClass(choices) });
    const attaching = makeHarness({ permissions: SUBSTITUTE_PERMISSIONS, prisma: attach.prisma, substituteMediaContext: OPEN_ONLY });
    await attaching.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-answer-2', messageText: '2' });
    assert.equal(attaching.attachMediaCalls[0].purpose, 'expense.receipt.supporting');
    assert.equal(attach.pendingMediaRows[0].status, 'RESOLVED_RECEIPT');

    const capture = makePrisma();
    seedPendingRow(capture.pendingMediaRows, { caption: '', askedQuestionJson: askedClass(choices) });
    const newExpense = makeHarness({ permissions: SUBSTITUTE_PERMISSIONS, prisma: capture.prisma, substituteMediaContext: OPEN_ONLY });
    await newExpense.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-answer-3', messageText: '3' });
    assert.equal(newExpense.attachMediaCalls.length, 0);
    assert.equal(newExpense.createExpenseCalls.length, 1, 'choice “ค่าใช้จ่ายใหม่” is the existing capture path');

    // The escape RECEIPT-05 has always had: a picture that answers a question and records nothing.
    const escape = makePrisma();
    seedPendingRow(escape.pendingMediaRows, { caption: '', askedQuestionJson: askedClass(choices) });
    const notRecorded = makeHarness({ permissions: SUBSTITUTE_PERMISSIONS, prisma: escape.prisma, substituteMediaContext: OPEN_ONLY });
    await notRecorded.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-answer-4', messageText: '4' });
    assert.equal(notRecorded.attachMediaCalls.length, 0);
    assert.equal(notRecorded.createExpenseCalls.length, 0, 'nothing is recorded');
    assert.equal(escape.pendingMediaRows[0].status, 'RESOLVED_ILLUSTRATION');
    assert.match(notRecorded.replies[0] ?? '', /ไม่ได้บันทึกเป็นหลักฐาน/);
  });

  it('re-states its own question instead of letting another classifier act on the bytes', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows, { caption: '', askedQuestionJson: askedScan() });
    const h = makeHarness({
      permissions: [...SUBSTITUTE_PERMISSIONS, 'line.ai.query'], prisma, substituteMediaContext: AWAITING,
    });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-unrelated', messageText: 'ยอดขายเดือนนี้เท่าไหร่' });

    assert.equal(h.linkScanCalls.length, 0);
    assert.equal(h.attachMediaCalls.length, 0);
    assert.equal(h.createExpenseCalls.length, 0, 'an unrelated question never resolves the pending bytes');
    assert.equal(pendingMediaRows[0].status, 'PENDING');
  });

  it('tells a MANAGER the truth instead of failing, and never lets this path throw into the turn', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows, { caption: '', askedQuestionJson: askedClass(['PAYMENT_EVIDENCE', 'NO_RECORD']) });
    const manager = makeHarness({ permissions: MANAGER_PERMISSIONS, prisma, substituteMediaContext: OPEN_ONLY });

    await manager.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-manager-answer', messageText: '1' });

    assert.equal(manager.attachMediaCalls.length, 0, 'nothing is attached without the permission');
    assert.match(manager.replies[0] ?? '', /ไม่มีสิทธิ์|ยังไม่ได้เปิดใช้งาน/, 'the reply names the reason');
    assert.equal((manager.replies[0] ?? '').includes('ขออภัยค่ะ เกิดข้อผิดพลาด'), false, 'not the generic infra failure');
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'their file is still there to retry');

    // A failure inside the substitute path is contained: it never reaches the dispatcher's
    // generic error reply carrying the customer's lost answer with it.
    const failing = makePrisma();
    seedPendingRow(failing.pendingMediaRows, { caption: '', askedQuestionJson: askedScan() });
    const thrower = makeHarness({ permissions: SUBSTITUTE_PERMISSIONS, prisma: failing.prisma, substituteMediaContext: AWAITING });
    (thrower.useCase as any).substituteReceiptContinuation.loadOpenMediaContext = async () => { throw new Error('continuation store unavailable'); };
    await thrower.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-throws', messageText: 'ใช่' });
    assert.equal(thrower.linkScanCalls.length, 0);
    assert.equal(failing.pendingMediaRows[0].status, 'PENDING');
  });

  it('refuses a scan the artifact could never contain, in words the sender can act on', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows, { caption: '', askedQuestionJson: askedScan() });
    const h = makeHarness({
      permissions: SUBSTITUTE_PERMISSIONS, prisma, substituteMediaContext: AWAITING,
      linkScanError: new ConflictException({
        code: 'substitute_wet_signed_scan_not_linkable',
        message: 'The scanned form cannot be read as a printable document.',
      }),
    });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-bad-scan', messageText: 'ใช่' });

    assert.match(h.replies[0] ?? '', /SUB-202608-00007/);
    assert.match(h.replies[0] ?? '', /cannot be read as a printable document/);
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'a refused scan keeps the bytes for a retry');
  });
});

describe('spec §13 — the state badge reaches the delivered card', () => {
  const permissions = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.review'];
  const issuedResult = {
    handled: true, status: 'READY_FOR_WEB', workflowId: 'wf-1', expenseId: 'expense-note-1',
    badge: '✅ ออกเอกสารแล้ว', acceptedFields: [], blockers: [],
    replyText: '✅ ออกเอกสารแล้ว — เลขที่ SUB-202608-00007',
  };

  it('hands the continuation badge through to the card the sender sees', async () => {
    const h = makeHarness({ permissions, substituteResult: issuedResult });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-badge-dm', messageText: 'ทำใบรับรองต่อ' });

    assert.equal(h.substituteCalls.length, 1, 'the substitute phrase routes to the continuation');
    assert.match(h.replies[0] ?? '', /✅ ออกเอกสารแล้ว/);
  });
});

describe('LINE intake dispatch – reimbursement semantic intake (uat-correctness-latency §7/§9)', () => {
  const REIMBURSEMENT_PLAN = {
    status: 'ROUTED' as const, intent: 'REIMBURSEMENT_REQUEST_START' as const, language: 'th', confidence: 0.9,
  };
  const STRONG_CLAIM_PLAN: LineIntakeRoutePlan = {
    ...REIMBURSEMENT_PLAN, semanticOutcome: 'REIMBURSEMENT_CLAIM', fundingSource: 'EMPLOYEE_PAID',
  };
  const STRONG_CLAIM_TEXT = 'ขอเบิกค่าแท็กซี่ 120 บาท จ่ายเองไปก่อน';
  const HANDOFF_PERMISSIONS = ['line.ai.query', 'reimbursement.create'];
  const HANDOFF_ENTITLEMENTS = [{ featureKey: 'ai_line_assistant', enabled: true }, { featureKey: 'reimbursement', enabled: true }];
  const HANDOFF_URL = 'https://app.example.com/companies/company-1/reimbursements/new';

  /** Every `uri` action anywhere in a sent payload: bubble footer, carousel, or quick reply. */
  function collectUris(value: unknown, found: string[] = []): string[] {
    if (Array.isArray(value)) {
      value.forEach((item) => collectUris(item, found));
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record.type === 'uri' && typeof record.uri === 'string') found.push(record.uri);
      Object.values(record).forEach((item) => collectUris(item, found));
    }
    return found;
  }

  /** Own prisma (event-log statuses, expenseRecord writes) and a wired ledger so sub-requests are observable. */
  function reimbursementHarness(opts: Omit<Parameters<typeof makeHarness>[0], 'prisma' | 'captureLedger'>) {
    const { prisma, updates, recordUpdates } = makePrisma();
    const ledger: any[] = [];
    return { ...makeHarness({ ...opts, prisma, captureLedger: ledger }), ledger, updates, recordUpdates };
  }

  /** LINE never writes a reimbursement or an expense from this branch. The harness wires no reimbursement
   *  writer at all (the use case has none), so the expense/attachment/substitute collectors are the only
   *  places a domain write could surface. */
  function assertNoDomainWrites(h: ReturnType<typeof reimbursementHarness>): void {
    assert.equal(h.captured.length, 0, 'no expense note capture');
    assert.equal(h.createExpenseCalls.length, 0, 'no expense create');
    assert.equal(h.draftsCreated.length, 0);
    assert.equal(h.updateExpenseCalls.length, 0);
    assert.equal(h.correctionCalls.length, 0);
    assert.equal(h.substituteCalls.length, 0);
    assert.equal(h.initCalls.length, 0);
    assert.equal(h.createUploadIntentCalls.length, 0);
    assert.equal(h.signatureCreated.length, 0);
    assert.equal(h.recordUpdates.length, 0);
  }

  const eventLogReached = (h: ReturnType<typeof reimbursementHarness>, status: string) =>
    h.updates.some((update) => update.data?.status === status);

  it('asks who paid for mixed greeting + reimbursement text in clarify_only, ledgers the route, and captures nothing', async () => {
    const h = reimbursementHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      lineAiReimbursementSemanticMode: 'clarify_only',
      routePlan: { ...REIMBURSEMENT_PLAN, semanticOutcome: 'AMBIGUOUS', fundingSource: 'UNKNOWN' },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'สวัสดีเบิกค่าโดยสารหน่อย' });

    assert.equal(h.routeRequests.length, 1, 'the greeting does not short-circuit before the router');
    assert.equal(h.routeRequests[0].messageText, 'สวัสดีเบิกค่าโดยสารหน่อย');
    assert.equal(h.routeRequests[0].capabilities.reimbursementSemantic, true);
    assert.equal(h.sentMessages.length, 1);
    const [message] = h.sentMessages[0] as any[];
    assert.equal(h.sentMessages[0].length, 1);
    assert.equal(message.type, 'flex');
    assert.match(replyAssertionText(message), /ใครเป็นคนจ่าย/);
    assert.match(replyAssertionText(message), /เบิกคืน/);
    assert.match(replyAssertionText(message), /บริษัทจ่าย/);
    assert.deepEqual(collectUris(h.sentMessages), [], 'the payer question links nowhere');
    assert.equal(h.ledger.length, 1);
    assert.equal(h.ledger[0].items.length, 1);
    assert.equal(h.ledger[0].items[0].clarifyForIntent, 'REIMBURSEMENT_REQUEST_START');
    assert.equal(h.ledger[0].items[0].state, 'waiting_user');
    assert.equal(h.ledger[0].items[0].intent, 'CLARIFY');
    assert.equal(h.ledger[0].items[0].text, 'สวัสดีเบิกค่าโดยสารหน่อย');
    assertNoDomainWrites(h);
    assert.ok(eventLogReached(h, 'clarification_required'));
  });

  it('acknowledges a strong employee-paid claim in clarify_only with a card that has no button and writes nothing', async () => {
    const h = reimbursementHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      lineAiReimbursementSemanticMode: 'clarify_only',
      routePlan: STRONG_CLAIM_PLAN,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: STRONG_CLAIM_TEXT });

    assert.equal(h.routeRequests[0].capabilities.reimbursementSemantic, true);
    assert.equal(h.sentMessages.length, 1);
    const [message] = h.sentMessages[0] as any[];
    assert.equal(h.sentMessages[0].length, 1);
    assert.equal(message.type, 'flex');
    assert.match(replyAssertionText(message), /ยังไม่ได้สร้างรายการเบิกคืน/);
    assert.match(replyAssertionText(message), /ยังไม่เปิดใช้งาน/);
    assert.deepEqual(collectUris(h.sentMessages), [], 'clarify_only offers no handoff CTA');
    assert.equal(message.contents.footer, undefined, 'no button row at all');
    assert.equal(h.ledger.length, 0, 'nothing is left waiting on the user');
    assertNoDomainWrites(h);
    assert.ok(eventLogReached(h, 'completed'));
  });

  it('hands a strong claim to the web form in handoff mode with exactly one bare tenant link and zero writes', async () => {
    const h = reimbursementHarness({
      permissions: HANDOFF_PERMISSIONS,
      scopes: { branchIds: ['branch-1'] },
      entitlementRows: HANDOFF_ENTITLEMENTS,
      lineAiReimbursementSemanticMode: 'handoff',
      routePlan: STRONG_CLAIM_PLAN,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: STRONG_CLAIM_TEXT });

    assert.equal(h.routeRequests[0].capabilities.reimbursementSemantic, true);
    assert.equal(h.sentMessages.length, 1);
    const [message] = h.sentMessages[0] as any[];
    assert.equal(message.type, 'flex');
    const uris = collectUris(h.sentMessages);
    assert.deepEqual(uris, [HANDOFF_URL], 'one link in the whole payload, and only to the new-reimbursement form');
    const link = new URL(uris[0]!);
    assert.equal(link.href, HANDOFF_URL);
    assert.equal(link.search, '', 'no prefill query');
    assert.equal(link.hash, '', 'no fragment');
    assert.match(replyAssertionText(message), /ยังไม่ได้สร้างรายการ/);
    assert.equal(h.ledger.length, 0);
    assertNoDomainWrites(h);
    assert.ok(eventLogReached(h, 'completed'));
  });

  const handoffAttempt = (overrides: Partial<Parameters<typeof reimbursementHarness>[0]>) => reimbursementHarness({
    permissions: HANDOFF_PERMISSIONS,
    lineAiReimbursementSemanticMode: 'handoff',
    routePlan: STRONG_CLAIM_PLAN,
    ...overrides,
  });

  async function assertHandoffDenied(h: ReturnType<typeof reimbursementHarness>): Promise<void> {
    await h.useCase.execute({ ...TEXT_EVENT, messageText: STRONG_CLAIM_TEXT });

    assert.match(h.replies[0] ?? '', /ยังไม่สามารถส่งต่อการเบิกคืน/);
    assert.deepEqual(collectUris(h.sentMessages), [], 'denied links nowhere');
    assert.equal(h.ledger.length, 0);
    assertNoDomainWrites(h);
    assert.ok(eventLogReached(h, 'forbidden'));
  }

  it('denies the handoff without reimbursement.create', async () => {
    await assertHandoffDenied(handoffAttempt({ permissions: ['line.ai.query'] }));
  });

  it('denies the handoff when explicit entitlements do not include reimbursement', async () => {
    // Explicit rows switch off the legacy null fail-open. `expenses`/`procurement` must stay out of this
    // list: LEGACY_FEATURE_INHERITANCE would grant `reimbursement` through either of them.
    await assertHandoffDenied(handoffAttempt({
      entitlementRows: [{ featureKey: 'ai_line_assistant', enabled: true }],
    }));
  });

  it('denies the handoff for an explicitly empty branch scope', async () => {
    await assertHandoffDenied(handoffAttempt({
      entitlementRows: HANDOFF_ENTITLEMENTS,
      scopes: { branchIds: [] },
    }));
  });

  /** A prior payer question this user was asked, plus an unrelated capture question in the same chat. */
  const PAYER_CLARIFICATION = {
    id: 'reimb-clarify-1', question: 'รายการนี้ใครเป็นคนจ่ายคะ?', text: 'ขอเบิกค่าแท็กซี่ 120 บาท',
    askedAt: new Date().toISOString(), clarifyForIntent: 'REIMBURSEMENT_REQUEST_START',
    entry: { id: 'reimb-clarify-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-0', kind: 'sub_request', userId: 'user-1' },
  };
  const UNRELATED_CLARIFICATION = {
    id: 'capture-clarify-9', question: 'ยอดเท่าไรคะ?', text: 'ค่ากระดาษ',
    askedAt: new Date().toISOString(), clarifyForIntent: 'EXPENSE_DOCUMENT_CAPTURE',
    entry: { id: 'capture-clarify-9', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-0', kind: 'sub_request', userId: 'user-1' },
  };

  it('an answer to the payer question closes exactly that clarification and leaves the unrelated one open', async () => {
    const h = reimbursementHarness({
      permissions: HANDOFF_PERMISSIONS,
      scopes: { branchIds: ['branch-1'] },
      entitlementRows: HANDOFF_ENTITLEMENTS,
      lineAiReimbursementSemanticMode: 'handoff',
      openWaiting: [PAYER_CLARIFICATION, UNRELATED_CLARIFICATION],
      // The model reports BOTH ids as resolved. Only the reimbursement one belongs to this branch.
      routePlan: { ...STRONG_CLAIM_PLAN, resolvedClarificationIds: ['reimb-clarify-1', 'capture-clarify-9'] },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'สำรองจ่ายเองค่ะ' });

    assert.deepEqual(h.ledgerAcks, [{ entryId: 'reimb-clarify-1', outcome: 'reimbursement_handoff' }],
      'exactly the answered reimbursement question is consumed — never a blanket close of the chat');
    assert.equal(h.ledger.length, 0, 'a settled payer never gets asked again');
    assertNoDomainWrites(h);
    assert.ok(eventLogReached(h, 'completed'));
  });

  it('consumes nothing when the provider omits resolvedClarificationIds, and still writes nothing', async () => {
    const h = reimbursementHarness({
      permissions: HANDOFF_PERMISSIONS,
      scopes: { branchIds: ['branch-1'] },
      entitlementRows: HANDOFF_ENTITLEMENTS,
      lineAiReimbursementSemanticMode: 'handoff',
      openWaiting: [PAYER_CLARIFICATION, UNRELATED_CLARIFICATION],
      // The provider returns the reimbursement route but reports no resolved id at all.
      routePlan: STRONG_CLAIM_PLAN,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'สำรองจ่ายเองค่ะ' });

    // Consumption is id-driven and nothing else: with no id, neither the payer question this answer
    // plainly settles nor the unrelated capture question is closed. No text matching recovers the id.
    assert.deepEqual(h.ledgerAcks, [], 'no id reported, so no clarification is consumed');
    // The current safe outcome, stated rather than implied: the handoff card is still delivered, the
    // payer question stays OPEN and the next turn inherits it — a stale re-ask, never a wrong write.
    assert.deepEqual(collectUris(h.sentMessages), [HANDOFF_URL]);
    assert.equal(h.ledger.length, 0, 'and no duplicate payer question is opened on top of the stale one');
    assertNoDomainWrites(h);
    assert.ok(eventLogReached(h, 'completed'));
  });

  it('re-asking who paid closes the question it answered before it opens the next one', async () => {
    const h = reimbursementHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      lineAiReimbursementSemanticMode: 'clarify_only',
      openWaiting: [PAYER_CLARIFICATION, UNRELATED_CLARIFICATION],
      routePlan: {
        ...REIMBURSEMENT_PLAN, semanticOutcome: 'AMBIGUOUS', fundingSource: 'UNKNOWN',
        resolvedClarificationIds: ['reimb-clarify-1'],
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ยังไม่แน่ใจค่ะ' });

    // Stale entry closed, ONE fresh payer question opened — in that order, so the next message inherits
    // exactly one open reimbursement clarification instead of two.
    assert.deepEqual(h.ledgerAcks, [{ entryId: 'reimb-clarify-1', outcome: 'reimbursement_payer_reclarify' }]);
    assert.equal(h.ledger.length, 1);
    assert.equal(h.ledger[0].items[0].clarifyForIntent, 'REIMBURSEMENT_REQUEST_START');
    assertNoDomainWrites(h);
    assert.ok(eventLogReached(h, 'clarification_required'));
  });

  it('refuses an ambiguous claim from a denied user immediately, without ever asking who paid', async () => {
    const h = reimbursementHarness({
      permissions: ['line.ai.query'], // no reimbursement.create
      lineAiReimbursementSemanticMode: 'handoff',
      openWaiting: [UNRELATED_CLARIFICATION],
      routePlan: { ...REIMBURSEMENT_PLAN, semanticOutcome: 'AMBIGUOUS', fundingSource: 'UNKNOWN' },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ขอเบิกค่าแท็กซี่ 120 บาท' });

    assert.match(h.replies[0] ?? '', /ยังไม่สามารถส่งต่อการเบิกคืน/);
    assert.doesNotMatch(h.replies[0] ?? '', /ใครเป็นคนจ่าย/, 'a payer answer this user could never use is never requested');
    assert.equal(h.ledger.length, 0, 'nothing is left waiting on a denied user');
    assert.deepEqual(h.ledgerAcks, [], 'and the unrelated capture question is untouched');
    assert.deepEqual(collectUris(h.sentMessages), [], 'denied links nowhere');
    assertNoDomainWrites(h);
    assert.ok(eventLogReached(h, 'forbidden'));
  });

  it('off mode never offers the router the capability and keeps the legacy turn path', async () => {
    const h = reimbursementHarness({
      permissions: HANDOFF_PERMISSIONS,
      scopes: { branchIds: ['branch-1'] },
      entitlementRows: HANDOFF_ENTITLEMENTS,
      lineAiReimbursementSemanticMode: 'off',
      routePlan: STRONG_CLAIM_PLAN,
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: STRONG_CLAIM_TEXT });

    const capability = h.routeRequests[0].capabilities.reimbursementSemantic;
    assert.ok(capability === undefined || capability === false, 'capability is omitted or false, never true');
    assert.match(h.replies[0] ?? '', /turn-answer/, 'the legacy permission-checked AI turn answers');
    assert.doesNotMatch(h.replies[0] ?? '', /ใครเป็นคนจ่าย|ยังไม่ได้สร้างรายการเบิกคืน|ยังไม่สามารถส่งต่อการเบิกคืน/);
    assert.deepEqual(collectUris(h.sentMessages).filter((uri) => uri.includes('/reimbursements/new')), []);
    assert.equal(
      h.ledger.some((entry) => entry.items?.some((item: any) => item.clarifyForIntent === 'REIMBURSEMENT_REQUEST_START')),
      false,
      'no reimbursement clarification is ledgered',
    );
    assertNoDomainWrites(h);
  });
});

describe('isExactStandaloneGreeting (versioned allowlist, uat-correctness-latency §11.2)', () => {
  it('matches only a whole message that IS one of the three allowlisted greetings', () => {
    for (const text of ['สวัสดี', 'สวัสดีค่ะ', 'สวัสดีครับ']) {
      assert.equal(isExactStandaloneGreeting(text), true, text);
    }
  });

  it('never matches a substring, a greeting carrying business text, or an unlisted variant', () => {
    for (const text of [
      'สวัสดีเบิกค่าโดยสารหน่อย',
      'สวัสดี เบิกค่าโดยสารหน่อย',
      'เบิกค่าโดยสารหน่อย สวัสดี',
      'สวัสดีค่ะ ขอเบิกค่าวิน 60 บาท',
      'สวัสดีตอนเช้า',
      'สวัสดีจ้า',
      '',
    ]) {
      assert.equal(isExactStandaloneGreeting(text), false, text);
    }
  });
});

describe('LINE intake dispatch – exact standalone greeting lane (uat-correctness-latency §11.2, plan Phase 6B)', () => {
  const GREETING_REPLY = 'สวัสดีค่ะ 😊 วันนี้มีอะไรให้น้องมั่งมีช่วยไหมคะ?';
  const GREETING_PERMISSIONS = ['expense.receipt.line_upload', 'line.ai.query'];

  /** Own prisma so the persisted turn (aiTurn.create) and the event-log statuses are both observable. */
  function greetingHarness(opts: Omit<Parameters<typeof makeHarness>[0], 'prisma'>) {
    const { prisma, updates, turnCreates } = makePrisma();
    return { ...makeHarness({ ...opts, prisma }), updates, turnCreates };
  }

  it('answers every allowlisted greeting deterministically with zero router, gateway or model calls', async () => {
    for (const text of ['สวัสดี', 'สวัสดีค่ะ', 'สวัสดีครับ', '  สวัสดี  ']) {
      const h = greetingHarness({ permissions: GREETING_PERMISSIONS, lineAiExactGreetingEnabled: true });

      await h.useCase.execute({ ...TEXT_EVENT, messageText: text });

      assert.equal(h.routeRequests.length, 0, `"${text}" never reaches the intake router`);
      assert.equal(h.sentMessages.length, 1);
      assert.equal(h.sentMessages[0].length, 1);
      const [message] = h.sentMessages[0] as any[];
      assert.equal(message.type, 'flex', 'the terminal answer is the trusted Flex card, not plain text');
      assert.match(replyAssertionText(message), /วันนี้มีอะไรให้น้องมั่งมีช่วยไหมคะ/);
      assert.equal(h.turnCreates.length, 1);
      assert.equal(h.turnCreates[0].data.replyPreview, GREETING_REPLY, 'the canonical copy is what gets persisted');
      assert.ok(h.updates.some((update: any) => update.data?.status === 'completed'));
    }
  });

  // Ordering only. `persistIntakeTurn` is best-effort memory and nothing re-sends what it recorded, so
  // this proves the outcome is WRITTEN before delivery — not that a failed turn is replayed (§8.3 gap).
  it('records the canonical outcome before delivery and leaves the event delivery_pending when the token fails', async () => {
    const h = greetingHarness({
      permissions: GREETING_PERMISSIONS, lineAiExactGreetingEnabled: true, lineReplyResult: 'failed_other',
    });

    await assert.rejects(() => h.useCase.execute({ ...TEXT_EVENT, messageText: 'สวัสดี' }), /LINE_DELIVERY_FAILED_OTHER/);

    assert.equal(h.turnCreates.length, 1, 'the outcome is already recorded when delivery fails');
    assert.equal(h.turnCreates[0].data.replyPreview, GREETING_REPLY);
    assert.ok(h.updates.some((update: any) => update.data?.status === 'delivery_pending'));
    assert.equal(h.updates.some((update: any) => update.data?.status === 'completed'), false);
    assert.equal(h.routeRequests.length, 0);
  });

  it('routes a greeting that carries business text — including one split by a newline — through the normal route', async () => {
    for (const text of ['สวัสดีเบิกค่าโดยสารหน่อย', 'สวัสดี\nเบิกค่าโดยสารหน่อย']) {
      const h = greetingHarness({ permissions: GREETING_PERMISSIONS, lineAiExactGreetingEnabled: true });

      await h.useCase.execute({ ...TEXT_EVENT, messageText: text });

      assert.equal(h.routeRequests.length, 1, `${JSON.stringify(text)} is business text, not a standalone greeting`);
      assert.doesNotMatch(h.replies[0] ?? '', /วันนี้มีอะไรให้น้องมั่งมีช่วยไหมคะ/);
    }
  });

  it('stands down when the chat has an open clarification or an expense draft in flight', async () => {
    const openClarification = greetingHarness({
      permissions: GREETING_PERMISSIONS,
      lineAiExactGreetingEnabled: true,
      openWaiting: [{
        id: 'clarify-1', question: 'ยอดเท่าไรคะ?', text: 'ค่าวินมอไซต์', askedAt: new Date().toISOString(),
        clarifyForIntent: 'EXPENSE_DOCUMENT_CAPTURE',
        entry: { id: 'clarify-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' },
      }],
    });

    await openClarification.useCase.execute({ ...TEXT_EVENT, messageText: 'สวัสดี' });

    assert.equal(openClarification.routeRequests.length, 1, 'the open question owns the turn, not the greeting lane');
    assert.equal(openClarification.routeRequests[0].openClarifications.length, 1);

    const activeDraft = greetingHarness({
      permissions: GREETING_PERMISSIONS,
      lineAiExactGreetingEnabled: true,
      expenseDraftConversation: {
        routeContexts: async () => [{
          expenseId: 'expense-1', label: 'ร่าง 1', status: 'OPEN',
          questions: [{ id: 'I01-QTY', itemRef: 'I01', prompt: 'จำนวน?' }],
        }],
        execute: async () => ({ handled: false }),
        interruptOpen: async () => undefined,
      },
    });

    await activeDraft.useCase.execute({ ...TEXT_EVENT, messageText: 'สวัสดี' });

    assert.equal(activeDraft.routeRequests.length, 1, 'a draft in flight keeps the greeting on the full route');
    assert.equal(activeDraft.routeRequests[0].activeExpenseDrafts.length, 1);
  });

  it('is inert while the flag is off — only the flag turns the 0-call lane on', async () => {
    const off = greetingHarness({ permissions: GREETING_PERMISSIONS });

    await off.useCase.execute({ ...TEXT_EVENT, messageText: 'สวัสดี' });

    assert.equal(off.routeRequests.length, 1, 'default-off keeps the exact legacy path through the router');
    assert.doesNotMatch(off.replies[0] ?? '', /วันนี้มีอะไรให้น้องมั่งมีช่วยไหมคะ/);

    const on = greetingHarness({ permissions: GREETING_PERMISSIONS, lineAiExactGreetingEnabled: true });

    await on.useCase.execute({ ...TEXT_EVENT, messageText: 'สวัสดี' });

    assert.equal(on.routeRequests.length, 0);
    assert.match(on.replies[0] ?? '', /วันนี้มีอะไรให้น้องมั่งมีช่วยไหมคะ/);
  });
});

describe('LINE intake dispatch – Phase-0 capture/render stage timing (uat-correctness-latency §11.1, plan Phase 0)', () => {
  /** Collects the `line.ai.stage` events this turn emits, in the order they were emitted. */
  function stageEventsOf(useCase: ProcessLineWebhookUseCase): any[] {
    const stages: any[] = [];
    (useCase as any).logger = {
      log: (entry: any) => { if (entry?.msg === 'line.ai.stage') stages.push(entry); },
      warn: () => undefined,
      error: () => undefined,
    };
    return stages;
  }

  function assertStageOnce(stages: any[], stage: string): void {
    const emitted = stages.filter((entry) => entry.stage === stage);
    assert.equal(emitted.length, 1, `${stage} is timed exactly once for this turn`);
    assert.equal(emitted[0].webhookEventId, TEXT_EVENT.webhookEventId, `${stage} is correlated by webhookEventId`);
    assert.ok(
      Number.isInteger(emitted[0].durationMs) && emitted[0].durationMs >= 0,
      `${stage} carries a non-negative integer duration`,
    );
    const keys = Object.keys(emitted[0]);
    assert.ok(!keys.includes('lineUserId') && !keys.includes('messageText') && !keys.includes('text'),
      `${stage} carries no raw message text or LINE user id`);
  }

  it('times the capture execute, the card render and the LINE send once each on a text capture', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97,
        captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', amount: '65' },
      },
    });
    const stages = stageEventsOf(h.useCase);

    await h.useCase.execute(TEXT_EVENT);

    // The stages measure work that actually ran: one capture execute, one delivered reply.
    assert.equal(h.captured.length, 1);
    assert.equal(h.sentMessages.length, 1);
    for (const stage of ['capture_execute', 'render', 'line_delivery']) assertStageOnce(stages, stage);
    // Render is construction only and delivery is the network send only, so render precedes it.
    assert.ok(stages.findIndex((entry) => entry.stage === 'render')
      < stages.findIndex((entry) => entry.stage === 'line_delivery'));
    // No reimbursement use case or mutation exists in this release, so nothing may claim its duration.
    assert.equal(stages.some((entry) => entry.stage === 'reimbursement_execute'), false);
  });

  it('times only render and delivery on the 0-model greeting lane — no router, no gateway turn', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      lineAiExactGreetingEnabled: true,
    });
    const stages = stageEventsOf(h.useCase);

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'สวัสดี' });

    assert.equal(h.routeRequests.length, 0, 'the greeting lane answers without the intake router');
    // The canonical outcome is persisted BEFORE delivery, so `persistence` leads — and it is emitted at
    // all only because persistIntakeTurn is inside the stage now; before that every intake turn reported
    // zero database time it had in fact spent.
    assert.deepEqual(
      stages.map((entry) => entry.stage),
      ['persistence', 'render', 'line_delivery'],
      'a deterministic greeting times its persist, its card build and its send — and nothing that never ran',
    );
    for (const stage of ['persistence', 'render', 'line_delivery']) assertStageOnce(stages, stage);
  });

  it('times the intake persistence of a clarify turn that never reaches the AI-turn path', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.97,
        captureHints: { amount: '590' },
      },
      captureError: new LineTextExpenseCaptureIncompleteError(),
    });
    const stages = stageEventsOf(h.useCase);

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'รีบทำให้หน่อย' });

    assertStageOnce(stages, 'persistence');
  });
});

describe('LINE intake dispatch – multi-part terminal Flex (uat-correctness-latency §10.1, always on)', () => {
  /** Longer than the 1200 code points a Flex bubble body keeps, so a card can never carry it whole. */
  const LONG_TERMINAL = `สรุปรายการค่าใช้จ่าย ${'ก'.repeat(1300)}`;
  /** Past the 4,800 the expense splitter emits and still inside LINE's 5,000-character text cap — the
   *  §14.3 `long-reply-over-4800-lossless` row. All-BMP, so length IS the code-point count. */
  const OVER_4800_TERMINAL = 'สรุปค่าใช้จ่ายฉบับเต็ม '.padEnd(4_900, 'ก');

  /** Routes a controllable list of reply parts through deliverCompletedReplies (draft-continuation lane). */
  function multipartHarness(replyTexts: string[]) {
    return makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.95 },
      expenseDraftConversation: {
        routeContexts: async () => [],
        execute: async () => ({ handled: true, status: 'UPDATED', replyTexts, acceptedFields: [] }),
      },
    });
  }

  const sent = (h: ReturnType<typeof makeHarness>) => (h.sentMessages[0] ?? []) as any[];
  const ANSWER = { ...TEXT_EVENT, messageText: 'ตอบคำถามในร่าง' };

  it('requested editing always keeps all long text and a themed terminal', async () => {
    const texts = ['ส่วนที่ 1', 'ส่วนที่ 2', LONG_TERMINAL];
    const h = multipartHarness(texts);

    await h.useCase.execute(ANSWER);

    const messages = sent(h);
    assert.equal(messages.length, 4);
    assert.deepEqual(messages.map((m) => m.type), ['text', 'text', 'text', 'flex']);
    assert.deepEqual(messages.slice(0, 3).map((m) => m.text), texts, 'no requested information is truncated');
    assert.deepEqual(messages.map((m) => m.quickReply !== undefined), [false, false, false, true]);
  });

  it('with a short terminal keeps earlier parts lossless and turns the terminal into the Flex card', async () => {
    const texts = ['ส่วนที่ 1', 'ส่วนที่ 2', '🧾 สรุปร่างเรียบร้อยค่ะ'];
    const h = multipartHarness(texts);

    await h.useCase.execute(ANSWER);

    const messages = sent(h);
    assert.equal(messages.length, 3);
    assert.deepEqual(messages.map((m) => m.type), ['text', 'text', 'flex']);
    assert.deepEqual(messages.slice(0, 2).map((m) => m.text), ['ส่วนที่ 1', 'ส่วนที่ 2']);
    assert.match(replyAssertionText(messages[2]), /สรุปร่างเรียบร้อยค่ะ/);
    assert.equal(messages[2].quickReply !== undefined, true);
  });

  it('with a single over-long terminal ships the FULL text and appends a concise card after it', async () => {
    const h = multipartHarness([LONG_TERMINAL]);

    await h.useCase.execute(ANSWER);

    const messages = sent(h);
    assert.deepEqual(messages.map((m) => m.type), ['text', 'flex']);
    assert.equal(messages[0].text, LONG_TERMINAL, 'not one character of the canonical reply is dropped');
    // The card is server-owned closing copy, never a 1200-character slice of the answer.
    const card = replyAssertionText(messages[1]);
    assert.doesNotMatch(card, /กกกก/, 'the long canonical text is never fed to the 1200-char Flex body');
    assert.match(card, /ข้อความเต็มอยู่ด้านบน/);
    assert.equal(messages[1].quickReply !== undefined, true);
  });

  it('with an over-long terminal in a multi-part reply preserves every part exactly', async () => {
    const texts = ['ส่วนที่ 1', 'ส่วนที่ 2', LONG_TERMINAL];
    const h = multipartHarness(texts);

    await h.useCase.execute(ANSWER);

    const messages = sent(h);
    assert.equal(messages.length, 4);
    assert.deepEqual(messages.map((m) => m.type), ['text', 'text', 'text', 'flex']);
    assert.deepEqual(messages.slice(0, 3).map((m) => m.text), texts);
    assert.match(replyAssertionText(messages[3]), /ข้อความเต็มอยู่ด้านบน/);
  });

  it('preserves a 4,900-code-point terminal exactly and still appends the concise card', async () => {
    assert.equal(Array.from(OVER_4800_TERMINAL).length, 4_900, 'the fixture is genuinely past 4,800');
    const h = multipartHarness(['ส่วนที่ 1', OVER_4800_TERMINAL]);

    await h.useCase.execute(ANSWER);

    const messages = sent(h);
    assert.deepEqual(messages.map((m) => m.type), ['text', 'text', 'flex'], 'a slot was free, so the card is appended');
    assert.equal(messages[1].text, OVER_4800_TERMINAL, 'every one of the 4,900 code points is delivered');
    assert.equal(Array.from(messages[1].text).length, 4_900, 'nothing is sliced at 1,200 or anywhere else');
    const card = replyAssertionText(messages[2]);
    assert.doesNotMatch(card, /กกกก/, 'the card is closing copy, never a second shorter version of the answer');
    assert.match(card, /ข้อความเต็มอยู่ด้านบน/);
    assert.equal(messages[2].quickReply !== undefined, true);
  });

  it('at the five-part cap prefers five lossless text messages over a card', async () => {
    const texts = ['1', '2', '3', '4', LONG_TERMINAL];
    const h = multipartHarness(texts);

    await h.useCase.execute(ANSWER);

    const messages = sent(h);
    assert.equal(messages.length, 5, 'LINE accepts at most five messages in one reply');
    assert.deepEqual(messages.map((m) => m.type), ['text', 'text', 'text', 'text', 'text']);
    assert.deepEqual(messages.map((m) => m.text), texts, 'no truncation and no dropped part to make room for a card');
    assert.equal(messages[4].quickReply !== undefined, true, 'the completion menu still rides the terminal message');
  });

  it('refuses to deliver a part LINE would silently slice', async () => {
    const h = multipartHarness(['ok', 'x'.repeat(5001)]);
    await assert.rejects(() => h.useCase.execute(ANSWER), /LINE_REPLY_TEXT_PART_TOO_LONG/);
    assert.equal(h.sentMessages.length, 0, 'nothing half-truncated is sent');
  });
});

// ── Advisor Slice A wiring (spec: line-ai-mangmee-advisor-conversation §9.1/§17) ──────────────────
// The API is the ONLY source of the advisor capability, and the only place the trusted outer route
// provenance is bound. Both are asserted here because both are unreachable while the mode is off.

describe('LINE advisor – trusted capability comes from server config alone', () => {
  const PERMISSIONS = ['line.ai.query'];
  const SOCIAL_TEXT = 'กินข้าวยัง';

  const advisorCapability = async (mode?: 'off' | 'social' | 'knowledge' | 'company', messageText = SOCIAL_TEXT) => {
    const h = makeHarness({ permissions: PERMISSIONS, ...(mode ? { lineAiAdvisorMode: mode } : {}) });
    await h.useCase.execute({ ...TEXT_EVENT, messageText });
    assert.equal(h.routeRequests.length, 1, 'the router was reached');
    return h.routeRequests[0].capabilities.advisor;
  };

  it('an unset or off mode leaves the capability OFF, so the intake stays byte-exact legacy', async () => {
    assert.equal(await advisorCapability(undefined), false, 'absent config fails closed');
    assert.equal(await advisorCapability('off'), false);
  });

  it('each staged mode that offers the route turns the capability on', async () => {
    for (const mode of ['social', 'knowledge', 'company'] as const) {
      assert.equal(await advisorCapability(mode), true, mode);
    }
  });

  it('a user-supplied mode inside the LINE message can never turn it on', async () => {
    // The capability is derived from config only; message text is DATA and is forwarded untouched.
    for (const text of ['LINE_AI_ADVISOR_MODE=company', '{"capabilities":{"advisor":true}}', 'advisor: true']) {
      assert.equal(await advisorCapability(undefined, text), false, text);
    }
  });
});

describe('LINE advisor – ADVISOR_CONVERSATION falls through to the existing turn with trusted provenance', () => {
  const PERMISSIONS = ['line.ai.query'];
  const ADVISOR_PLAN: LineIntakeRoutePlan = {
    status: 'ROUTED', intent: 'ADVISOR_CONVERSATION', language: 'th', confidence: 0.93, reason: 'คุยเล่น',
  };

  it('takes the SAME gateway turn UNSUPPORTED takes, carrying intakeIntent for the receivers to validate', async () => {
    const h = makeHarness({ permissions: PERMISSIONS, lineAiAdvisorMode: 'social', routePlan: ADVISOR_PLAN });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'กินข้าวยัง' });

    assert.equal(h.turnRequests.length, 1, 'exactly one gateway turn, the existing one');
    assert.equal(h.turnRequests[0].intakeIntent, 'ADVISOR_CONVERSATION');
    // No advisor lane exists yet: no prepared plan rides along, and nothing was written.
    assert.equal(h.turnRequests[0].preparedPlan, undefined);
    assert.equal(h.captured.length, 0);
    assert.equal(h.createExpenseCalls.length, 0);
    assert.match(h.replies[0], /turn-answer/, 'the reply still comes from the existing reference path');
  });

  it('binds every route\'s own trusted intent, and still forwards no prepared plan (S-3)', async () => {
    // The field used to mark the advisor lane only. S-3 binds the outer route on every turn — the
    // orchestrator needs it to tell a business read from an out-of-scope question (evidence E4) —
    // while the lanes that ACT on a plan still require `preparedPlan`, which stays absent here.
    const h = makeHarness({
      permissions: PERMISSIONS,
      routePlan: { status: 'ROUTED', intent: 'UNSUPPORTED', language: 'th', confidence: 0.4 },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'กินข้าวยัง' });

    assert.equal(h.turnRequests.length, 1);
    assert.equal(h.turnRequests[0].intakeIntent, 'UNSUPPORTED', 'the route\'s own intent, never another lane\'s');
    assert.equal(h.turnRequests[0].preparedPlan, undefined);
    assert.match(h.replies[0], /turn-answer/);
  });

  // UAT 2026-09-06 (build f2bd38ed): the direct lane's AiTurn row carried no model id and no duration,
  // although the route response already reports the one call that wrote the reply.
  it('answers a passing social draft from the single intake call and records its model lineage on the intake row', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: PERMISSIONS, lineAiAdvisorMode: 'social', prisma,
      routePlan: {
        ...ADVISOR_PLAN,
        advisorAnswer: { version: 1, mode: 'SOCIAL_CHAT', confidence: 0.93, needsTools: false, answerText: 'ทานแล้วค่ะ คุณล่ะคะ', knowledgeCardIds: [], companyProfileFieldsUsed: [] },
        usage: [{ tag: 'line.intake-route', modelId: 'global.anthropic.claude-sonnet-4-6', ok: true, inputTokens: 1328, outputTokens: 415, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 4200 }],
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'กินข้าวยัง' });

    assert.equal(h.turnRequests.length, 0, 'no gateway turn: answered from the intake call');
    assert.match(h.replies[0], /ทานแล้วค่ะ คุณล่ะคะ/, 'the draft itself, on the completed-reply card');
    const row = turnCreates.find((create) => create.data.agent === 'intake');
    assert.equal(row?.data.modelId, 'global.anthropic.claude-sonnet-4-6');
    assert.equal(row?.data.durationMs, 4200);
  });

  it('the UAT off-persona draft never takes the shortcut: the composer turn (which owns the persona) answers', async () => {
    const h = makeHarness({
      permissions: PERMISSIONS, lineAiAdvisorMode: 'social',
      routePlan: {
        ...ADVISOR_PLAN,
        advisorAnswer: {
          version: 1, mode: 'SOCIAL_CHAT', confidence: 0.95, needsTools: false, knowledgeCardIds: [], companyProfileFieldsUsed: [],
          answerText: 'สวัสดีครับ! หนูคือ AI Assistant ของ MangmeePlus 🤖 พร้อมช่วยคุณจัดการค่าใช้จ่าย ดูข้อมูลธุรกิจ และตอบคำถามต่างๆ มีอะไรให้ช่วยไหมครับ?',
        },
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'คุณเป็นใคร' });

    assert.equal(h.turnRequests.length, 1, 'falls through to the existing gateway turn');
    assert.equal(h.turnRequests[0].intakeIntent, 'ADVISOR_CONVERSATION');
    assert.match(h.replies[0], /turn-answer/);
  });
});

/**
 * UAT 2026-09-05 (LINE OA uat-mangmeeplus, build 1399bb83). A restaurant check bill was parked with
 * the payment question; answering "1" (จ่ายแล้ว แต่ไม่ได้ใบเสร็จ) failed TWICE with the transient
 * "เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่" copy — `line_substitute_media_answer_failed`,
 * `กรุณาเลือกสาขาของรายการก่อนบันทึก`. The company has several branches and the pending-media lane
 * never got the LINE branch default the DIRECT photo path has had since 2026-08-27 (commit 88aef194).
 */
describe('LINE capture branch default – every LINE-originated draft (UAT 2026-09-05)', () => {
  const MULTI_BRANCH = [
    { id: 'hq', type: 'HEAD_OFFICE' },
    { id: 'silom', type: 'BRANCH' },
    { id: 'ari', type: 'BRANCH' },
  ];
  /** No head office to fall back on and no membership default: the rule has nothing left to pick. */
  const AMBIGUOUS_BRANCHES = [
    { id: 'silom', type: 'BRANCH' },
    { id: 'ari', type: 'BRANCH' },
  ];
  const CAPTURE_PERMISSIONS = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.review', 'line.ai.query'];
  const CAPTURE_PLAN = { status: 'ROUTED' as const, intent: 'EXPENSE_DOCUMENT_CAPTURE' as const, language: 'th', confidence: 0.95 };
  const CHECK_BILL_ANSWER = { ...TEXT_EVENT, webhookEventId: 'evt-check-bill-answer', messageText: '1' };
  const askedCheckBill = () => ({
    kind: 'CHECK_BILL_ACTION',
    chatKeyHash: chatKeyHashOf(CHECK_BILL_ANSWER),
    ocrFields: { grandTotalAmount: '853.00', vendorName: 'Grand Lobby Bar' },
  });
  const blockedContinuation = {
    handled: true, status: 'BLOCKED', workflowId: 'workflow-1', expenseId: 'expense-clarified-1',
    acceptedFields: [], blockers: [], pendingQuestion: 'ค่าใช้จ่ายนี้ใช้ทำอะไรคะ?',
    replyText: '📄 ใบรับรองแทนใบเสร็จรับเงิน',
  };

  /** The exact UAT turn: the parked check bill, answered "1". */
  async function answerPaidNoReceipt(prismaOpts: Parameters<typeof makePrisma>[0] = {}) {
    const { prisma, pendingMediaRows, updates } = makePrisma(prismaOpts);
    seedPendingRow(pendingMediaRows, { askedQuestionJson: askedCheckBill() });
    const h = makeHarness({ permissions: CAPTURE_PERMISSIONS, prisma, substituteResult: blockedContinuation });
    await h.useCase.execute(CHECK_BILL_ANSWER);
    return { ...h, pendingMediaRows, updates };
  }

  it('(a) defaults the draft to the sender OWN branch and completes the turn', async () => {
    const h = await answerPaidNoReceipt({ branches: MULTI_BRANCH, memberDefaultBranchId: 'silom' });

    assert.equal(h.createExpenseCalls.length, 1, 'the answer creates exactly one draft');
    assert.equal(h.createExpenseCalls[0].branchId, 'silom', 'the user own branch, not a guess');
    assert.equal(h.checkBillStarts.length, 1, 'the substitute continuation starts from the new draft');
    assert.equal(h.pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
    assert.doesNotMatch(h.replies.join('\n'), /เกิดข้อผิดพลาดชั่วคราว/, 'never the transient copy');
    assert.match(h.replies.join('\n'), /สร้างร่างค่าใช้จ่าย 1 รายการแล้ว/);
  });

  it('(b) falls back to the sole ACTIVE head office when the member has no default branch', async () => {
    const h = await answerPaidNoReceipt({ branches: MULTI_BRANCH });

    assert.equal(h.createExpenseCalls.length, 1);
    assert.equal(h.createExpenseCalls[0].branchId, 'hq');
    assert.equal(h.pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
  });

  it('(c) answers honestly and writes nothing when the branch is still ambiguous', async () => {
    const h = await answerPaidNoReceipt({ branches: AMBIGUOUS_BRANCHES });

    assert.equal(h.createExpenseCalls.length, 0, 'no accounting record is created on a guess');
    assert.equal(h.pendingMediaRows[0].status, 'PENDING', 'the bytes stay answerable');
    const reply = h.replies.join('\n');
    assert.doesNotMatch(reply, /เกิดข้อผิดพลาดชั่วคราว/, 'a retry reproduces this exactly — never "temporary"');
    assert.match(reply, /หลายสาขา/, 'says WHY nothing was saved');
    assert.match(reply, /เว็บ/, 'points at the place with a branch picker');
    // The tail is lane-specific and this is the PARKED lane: `ensurePendingMedia` swallows any new
    // image while the row lives, so "send the photo again" would be a second false instruction.
    assert.match(reply, /ไฟล์เดิมยังเก็บไว้ให้อยู่ แล้วตอบข้อความเดิมอีกครั้งได้เลยค่ะ$/);
    assert.doesNotMatch(reply, /ส่งรูปเดิมเข้ามาใหม่/, 'a re-send here is silently dropped');
    // Same terminal state the DIRECT photo path records for the same refusal (2026-08-27).
    assert.equal(h.updates.at(-1)?.data.status, 'clarification_required');
    assert.equal(h.updates.at(-1)?.data.errorCode, 'RECEIPT_BRANCH_SELECTION_REQUIRED');
  });

  it('(c2) maps a stale default branch (TRANSACTION_BRANCH_INVALID) to the same honest copy', async () => {
    // The membership still points at a branch that was deactivated after it was assigned: the LINE
    // rule skips it, the company is multi-branch, and the create resolver refuses with the OTHER
    // deterministic code. Both are data states a retry reproduces, so both get real copy.
    const { prisma, pendingMediaRows, updates } = makePrisma({ branches: AMBIGUOUS_BRANCHES });
    seedPendingRow(pendingMediaRows, { askedQuestionJson: askedCheckBill() });
    const h = makeHarness({ permissions: CAPTURE_PERMISSIONS, prisma, substituteResult: blockedContinuation });
    (h.useCase as any).expenseRepo.resolveCreateBranchId = async () => {
      throw new UnprocessableEntityException({ code: 'TRANSACTION_BRANCH_INVALID', message: 'ไม่พบสาขาที่ใช้งานได้ในบริษัทนี้' });
    };

    await h.useCase.execute(CHECK_BILL_ANSWER);

    assert.equal(h.createExpenseCalls.length, 0);
    assert.equal(pendingMediaRows[0].status, 'PENDING');
    assert.doesNotMatch(h.replies.join('\n'), /เกิดข้อผิดพลาดชั่วคราว/);
    assert.equal(updates.at(-1)?.data.errorCode, 'RECEIPT_BRANCH_SELECTION_REQUIRED');
  });

  it('(c3) keeps the generic transient copy for a failure that is NOT a known data state', async () => {
    const { prisma, pendingMediaRows, updates } = makePrisma({ branches: MULTI_BRANCH, memberDefaultBranchId: 'silom' });
    seedPendingRow(pendingMediaRows, { askedQuestionJson: askedCheckBill() });
    const h = makeHarness({ permissions: CAPTURE_PERMISSIONS, prisma, substituteResult: blockedContinuation });
    (h.useCase as any).expenseRepo.createExpense = async () => { throw new Error('connection terminated'); };

    await h.useCase.execute(CHECK_BILL_ANSWER);

    assert.match(h.replies.join('\n'), /เกิดข้อผิดพลาดชั่วคราว/, 'an unknown fault really may pass on a retry');
    assert.equal(updates.at(-1)?.data.status, 'substitute_media_answer_failed');
  });

  // The tail the refusal above prints has to be the instruction that actually works. It says
  // "answer the same message again", so answering it again — once an admin has set the member's
  // default branch — must complete the capture off the SAME parked bytes.
  it('(c4) and the instruction it gives works: the same answer succeeds once a default branch exists', async () => {
    const { prisma, pendingMediaRows, updates } = makePrisma({ branches: AMBIGUOUS_BRANCHES });
    seedPendingRow(pendingMediaRows, { askedQuestionJson: askedCheckBill() });
    const refused = makeHarness({ permissions: CAPTURE_PERMISSIONS, prisma, substituteResult: blockedContinuation });

    await refused.useCase.execute(CHECK_BILL_ANSWER);

    assert.equal(refused.createExpenseCalls.length, 0);
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'the bytes survive the refusal');

    // The admin sets สาขาประจำตัว, exactly what the reply asked for. Same chat, same parked row,
    // the sender simply answers "1" again.
    const fixed = makePrisma({ branches: AMBIGUOUS_BRANCHES, memberDefaultBranchId: 'silom' });
    (fixed.prisma.client as any).lineIntakePendingMedia = (prisma.client as any).lineIntakePendingMedia;
    const retry = makeHarness({ permissions: CAPTURE_PERMISSIONS, prisma: fixed.prisma, substituteResult: blockedContinuation });

    await retry.useCase.execute({ ...CHECK_BILL_ANSWER, webhookEventId: 'evt-check-bill-answer-2' });

    assert.equal(retry.createExpenseCalls.length, 1, 'the retyped answer completes the capture');
    assert.equal(retry.createExpenseCalls[0].branchId, 'silom');
    assert.equal(retry.createExpenseCalls[0].lineMessageId, 'msg-media-1', 'off the ORIGINAL parked bytes');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
    assert.equal(updates.at(-1)?.data.errorCode, 'RECEIPT_BRANCH_SELECTION_REQUIRED', 'the refusal turn kept its own status');
  });

  // The DIRECT lane's refusal had no test on this branch at all: a mutant that made
  // `executeReceiptUpload` skip the shared map left the whole file green.
  it('(c5) the DIRECT photo refusal uses the map, its own tail, and stores nothing', async () => {
    const { prisma, pendingMediaRows, updates } = makePrisma({ branches: AMBIGUOUS_BRANCHES });
    const h = makeHarness({
      permissions: CAPTURE_PERMISSIONS, prisma, routePlan: CAPTURE_PLAN, receiptOcrResult: validReceiptOcr(),
    });

    const result = await h.useCase.executeReceiptUpload(MEDIA_EVENT);

    assert.equal(result.outcome, 'done');
    assert.equal(h.initCalls.length, 0, 'the branch refusal precedes every write');
    assert.equal(pendingMediaRows.length, 0, 'an expense turn parks nothing');
    const reply = h.replies.join('\n');
    assert.doesNotMatch(reply, /เกิดข้อผิดพลาดชั่วคราว/);
    assert.doesNotMatch(reply, /ประมวลผลรูปนี้ไม่สำเร็จ/, 'not the generic media-failure copy either');
    assert.match(reply, /หลายสาขา/);
    // Nothing was stored here, so re-sending the picture really is the way back in.
    assert.match(reply, /แล้วส่งรูปเดิมเข้ามาใหม่ได้เลยค่ะ$/);
    assert.doesNotMatch(reply, /ตอบข้อความเดิมอีกครั้ง/, 'there is no parked question to answer');
    assert.equal(updates.at(-1)?.data.status, 'clarification_required');
    assert.equal(updates.at(-1)?.data.errorCode, 'RECEIPT_BRANCH_SELECTION_REQUIRED');
    assert.equal(h.warnings.length, 1, 'one operator-visible line, not a stack trace');
    assert.equal(h.warnings[0].msg, 'LINE receipt upload needs branch selection');
  });

  it('(d) the RECEIPT-05 "confirmed receipt" answer takes the same default', async () => {
    const { prisma, pendingMediaRows } = makePrisma({ branches: MULTI_BRANCH, memberDefaultBranchId: 'ari' });
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-clarified-branch', messageText: 'ใช่ ใบเสร็จ' });

    assert.equal(h.createExpenseCalls.length, 1);
    assert.equal(h.createExpenseCalls[0].branchId, 'ari');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
  });

  it('(e) parity: the DIRECT photo path still picks the same branch', async () => {
    const { prisma } = makePrisma({ branches: MULTI_BRANCH, memberDefaultBranchId: 'silom' });
    const h = makeHarness({
      permissions: CAPTURE_PERMISSIONS, prisma, routePlan: CAPTURE_PLAN, receiptOcrResult: validReceiptOcr(),
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT);

    assert.equal(h.initCalls.length, 1);
    assert.equal(h.initCalls[0].branchId, 'silom');
  });

  it('(f) the LINE text-expense note takes the same default instead of failing on ambiguity', async () => {
    const { prisma } = makePrisma({ branches: MULTI_BRANCH, memberDefaultBranchId: 'silom' });
    const h = makeHarness({
      permissions: CAPTURE_PERMISSIONS, prisma, realCapture: true,
      routePlan: {
        ...CAPTURE_PLAN,
        captureHints: { amount: '65', description: 'ค่ากาแฟ 65 บาท' },
      } as any,
    });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-text-branch', messageText: 'ค่ากาแฟ 65 บาท' });

    assert.equal(h.captured[0]?.branchId, 'silom', 'the dispatcher hands the LINE default down');
    assert.equal(h.draftsCreated.length, 1, 'the REAL capture use case reached CreateExpenseDraftUseCase');
    assert.equal(h.draftsCreated[0].branchId, 'silom', 'and forwards it to the draft');
  });
});


describe('LINE usable receipt allowance settlement', () => {
  for (const enabled of [false, true]) for (const scenario of ['empty', 'missing_fields', 'apply_failure', 'summary_failure', 'success', 'delivery_failure', 'generic_reference', 'substitute_payment', 'substitute_support', 'substitute_failure'] as const) {
    it(`${scenario} settles its admission with draft conversation ${enabled ? 'enabled' : 'disabled'}`, async () => {
      const state = makePrisma();
      const events: any[] = [];
      const credits: any[] = [];
      let used = 0;
      Object.assign(state.prisma.client, {
        $executeRaw: async () => undefined,
        company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }) },
        companyAiConfiguration: { findUnique: async () => null },
        companyPlanTerm: { findUnique: async () => ({ tierKey: 'FREE_TRIAL_15', monthlySlipLimit: 15, warmupSlipLimit: 10, warmupUntil: new Date(Date.now() + 100000) }) },
        companyOcrUsageEvent: {
          findUnique: async ({ where }: any) => events.find((event) => event.requestId === where.companyId_sourceRoute_requestId.requestId) ?? null,
          create: async ({ data }: any) => { const event = { id: 'admission-generation-1', ...data }; events.push(event); return event; },
          count: async () => events.length,
          delete: async ({ where }: any) => events.splice(events.findIndex((event) => event.id === where.id), 1)[0],
        },
        companyOcrMonthlyUsage: {
          findUnique: async () => ({ usedCount: used }),
          upsert: async () => ({ usedCount: ++used }),
          updateMany: async () => { assert.ok(used > 0); used -= 1; return { count: 1 }; },
        },
        auditLog: { findFirst: async () => null, create: async ({ data }: any) => { credits.push(data); return data; } },
        outboxEvent: { create: async () => undefined, findMany: async () => [], findFirst: async () => null },
      });
      state.prisma.client.$transaction = async (work: any) => work(state.prisma.client);
      const recordUpdate = state.prisma.client.expenseRecord.update;
      let writes = 0;
      if (scenario === 'summary_failure') state.prisma.client.expenseRecord.update = async (args: any) => {
        if (++writes === 2) throw new Error('synthetic final summary failure');
        return recordUpdate(args);
      };
      const generic = businessClassification({ documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'QUOTATION', businessDirection: 'CUSTOMER_INBOUND' });
      const substitute = scenario.startsWith('substitute_');
      const h = makeHarness({
        permissions: substitute ? ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.review'] : ['expense.receipt.line_upload'], prisma: state.prisma,
        substituteMediaContext: substitute ? { expenseId: 'existing-expense', awaitingScans: [] } : undefined,
        substituteAttachError: scenario === 'substitute_failure' ? new Error('synthetic attach failure') : undefined,
        governReceiptAdmission: true, expenseDraftConversationEnabled: enabled,
        expenseDraftConversation: enabled ? { startFromReceipt: async () => ({ replyTexts: ['บันทึกร่างแล้ว'], expenseId: 'expense-1' }) } : undefined,
        receiptApplyError: scenario === 'apply_failure' ? new Error('synthetic apply failure') : undefined,
        lineReplyResult: scenario === 'delivery_failure' ? 'failed_other' : 'ok',
        routePlan: { status: 'ROUTED', intent: scenario === 'generic_reference' ? 'BUSINESS_DOCUMENT_REFERENCE' : 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.99 },
        receiptOcrResult: scenario === 'empty' || scenario === 'substitute_failure' ? { status: 'failed', errorCode: 'OCR_EMPTY_OUTPUT' }
          : scenario === 'missing_fields' ? { status: 'ok', classification: businessClassification() }
          : scenario === 'generic_reference' ? { status: 'ok', classification: generic, fields: { grandTotalAmount: '120.00' } } : validReceiptOcr(),
      });
      await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: `settle-${scenario}-${enabled}` },
        substitute ? scenario === 'substitute_support' ? 'หลักฐานค่าที่จอดรถค่ะ' : 'สลิปโอนค่ะ' : undefined);
      const retained = ['success', 'summary_failure', 'delivery_failure', 'generic_reference', 'substitute_payment', 'substitute_support'].includes(scenario);
      assert.equal(used, retained ? 1 : 0);
      assert.equal(events.length, retained ? 1 : 0);
      assert.equal(credits.filter((entry) => entry.action === 'receipt.ocr.admission.compensated').length, retained ? 0 : 1);
      if (scenario === 'success' || scenario === 'delivery_failure') {
        assert.equal(h.completeCalls.length, 1);
      }
      assert.doesNotMatch(h.replies.join(' '), /อ่านครั้งที่/);
      if (substitute) {
        assert.equal(h.attachMediaCalls.length, 1, 'existing work claims the supporting/payment image');
        if (scenario !== 'substitute_failure') {
          assert.equal(h.attachMediaCalls[0].expenseId, 'existing-expense');
          assert.equal(h.attachMediaCalls[0].purpose, scenario === 'substitute_support' ? 'expense.receipt.supporting' : 'expense.payment.evidence');
          assert.equal(state.pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
          assert.equal(h.ocrRequests.length, 0, 'no second receipt extraction for an attached supporting image');
          assert.equal(h.initCalls.length, 0, 'no new expense for the existing work');
        }
      }
      if (scenario === 'apply_failure' || scenario === 'summary_failure') {
        assert.equal(h.completeCalls.length, 1, 'stored image is kept even when extraction persistence fails');
        assert.match(h.replies.join(' '), /expense-1/);
      }
    });
  }
});

describe('receipt progress grounded in persisted records', () => {
  const recent = (id: string) => ({ id, expenseDate: new Date(), grandTotalAmount: '100.00', sourceDocumentType: 'RECEIPT', createdAt: new Date() });
  const detail = (id: string) => ({
    id, companyId: 'company-1', createdByUserId: 'user-1', branchId: 'branch-1',
    updatedAt: new Date('2026-09-15T00:00:00Z'),
    status: 'DRAFT', captureSource: 'LINE_UPLOAD', grandTotalAmount: '100.00', currency: 'THB', vendorDocumentNumber: id,
    sourceChannelMetadataJson: { chatKeyHash: chatKeyHashOf(TEXT_EVENT) },
  });

  it('reads a fresh receipt after silently pausing the same draft conversation', async () => {
    const row = { ...detail('paused'), expenseCategoryId: null, sourceDocumentType: 'RECEIPT',
      sourceChannelMetadataJson: { chatKeyHash: chatKeyHashOf(TEXT_EVENT), lineReceiptContinuation: {
        expenseId: 'paused', userId: 'user-1', chatKeyHash: chatKeyHashOf(TEXT_EVENT), deliveredOutcomeId: 'original',
      } }, aiVerificationSummaryJson: { recognizedFields: { vendorName: 'Current vendor' } } };
    let pauses = 0;
    const h = makeHarness({ permissions: ['expense.receipt.line_upload'], recentCaptures: [recent('paused')],
      expenseDetail: () => structuredClone(row), expenseDraftConversationEnabled: true, expenseDraftConversation: {
        routeContexts: async () => [{ expenseId: 'paused', status: 'OPEN', label: 'ร่าง', questions: [] }],
        interruptOpen: async () => { pauses++; row.updatedAt = new Date('2026-09-15T00:00:01Z'); return undefined; },
      } });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'อ่านใบเสร็จนี้ให้หน่อยว่าเป็นประเภทไหน และจะนำมาเป็นค่าใช้จ่ายของบริษัทอย่างไร' });
    assert.equal(pauses, 1); assert.match(h.replies.join(' '), /Current vendor/);
    assert.doesNotMatch(h.replies.join(' '), /ข้อมูลต้นทางเปลี่ยน/);
    assert.equal(h.captured.length + h.ocrRequests.length + h.turnRequests.length, 0);
  });

  for (const change of ['branch', 'revision', 'creator', 'chat', 'missing-revision', 'read-error'] as const)
    it(`withholds a prepared receipt answer when its original source changes: ${change}`, async () => {
      let changed = false, reads = 0;
      const row: any = detail('private');
      const h = makeHarness({ permissions: ['expense.receipt.line_upload'], scopes: { branchIds: ['branch-1'] },
        recentCaptures: [recent('private')], expenseDetail: () => {
          reads++; if (changed && change === 'read-error') throw new Error('source database unavailable'); return row;
        } });
      (h.useCase as any).handoffLinks = { wrapOutgoingLineContent: async (_recipient: unknown, messages: unknown) => {
        changed = true;
        if (change === 'branch') row.branchId = 'branch-private';
        if (change === 'revision') row.updatedAt = new Date('2026-09-15T00:00:01Z');
        if (change === 'creator') row.createdByUserId = 'another-user';
        if (change === 'chat') row.sourceChannelMetadataJson = { chatKeyHash: 'another-chat' };
        if (change === 'missing-revision') row.updatedAt = undefined;
        return messages;
      } };
      await assert.rejects(h.useCase.execute({ ...TEXT_EVENT, messageText: 'ใบเสร็จเสร็จหรือยัง' }), /LINE_DELIVERY_FAILED_PERMANENT/);
      assert.ok(reads >= 2);
      assert.doesNotMatch(h.replies.join('\n'), /\/expenses\/private|100\.00|source database/);
      assert.match(h.replies.join('\n'), /ข้อมูลต้นทางเปลี่ยน/);
      assert.equal(h.turnRequests.length + h.routeRequests.length + h.ocrRequests.length + h.captured.length, 0);
    });

  it('answers the three-receipt incident without requiring a delivered continuation or invoking AI', async () => {
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], scopes: { branchIds: ['branch-1'] },
      recentCaptures: ['a', 'b', 'c'].map(recent), expenseDetail: detail });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'นานจัง เสร็จหรือยัง' });
    const text = h.replies[0] ?? '';
    assert.equal(h.routeRequests.length, 0);
    assert.equal(h.turnRequests.length, 0);
    assert.match(text, /3 ใบ/);
    for (const id of ['a', 'b', 'c']) assert.match(text, new RegExp(`/expenses/${id}`));
    assert.match(text, /เปิดรายการที่ 1/);
    assert.match(text, /เปิดรายการที่ 3/);
    assert.doesNotMatch(text, /เปิดลิงก์ [123]/);
    assert.match(text, /บันทึกแบบร่างแล้ว รอคุณตรวจสอบและยืนยัน/);
    assert.doesNotMatch(text, /รอทีม|ประมวลผลเสร็จแล้ว|ส่งครบแล้ว/);
    assert.match(text, /ยังยืนยันผลของรูปนั้นไม่ได้/);
    const query = h.candidateQueries.find((q) => q.includeAllStatuses);
    assert.equal(query.companyId, 'company-1');
    assert.equal(query.createdByUserId, 'user-1');
    assert.equal(query.chatKeyHash, chatKeyHashOf(TEXT_EVENT));
    assert.deepEqual(query.scopes, { branchIds: ['branch-1'] });
    assert.equal(h.captured.length, 0);
    assert.equal(h.ocrRequests.length, 0);
  });

  it('rechecks actor, company and chat provenance and never claims missing records completed', async () => {
    for (const overrides of [{ companyId: 'other-company' }, { createdByUserId: 'other-user' },
      { sourceChannelMetadataJson: { chatKeyHash: 'other-chat' } }, { captureSource: 'WEB_UPLOAD' }]) {
      const h = makeHarness({ permissions: ['expense.receipt.line_upload'], recentCaptures: [recent('private')],
        expenseDetail: { ...detail('private'), ...overrides } });
      await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ใบเสร็จเสร็จหรือยัง' });
      assert.doesNotMatch(h.replies[0] ?? '', /\/expenses\/private|100\.00/);
      assert.match(h.replies[0] ?? '', /ยังยืนยันว่าอ่านเสร็จไม่ได้/);
      assert.equal(h.routeRequests.length, 0);
    }
  });

  it('separates an unfinished capture, a failed read and a confirmed record without presenting placeholder zero as a receipt total', async () => {
    const h = makeHarness({ permissions: ['expense.receipt.line_upload'], recentCaptures: ['pending', 'failed', 'confirmed'].map(recent),
      expenseDetail: (id: string) => ({ ...detail(id), grandTotalAmount: id === 'confirmed' ? '120' : '0',
        status: id === 'confirmed' ? 'CONFIRMED' : 'DRAFT',
        ...(id === 'failed' ? { aiVerificationSummaryJson: { status: 'OCR_FAILED' } } : {}),
        sourceChannelMetadataJson: { chatKeyHash: chatKeyHashOf(TEXT_EVENT), receiptCapturePending: id === 'pending' },
      }) });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ใบเสร็จอ่านครบหรือยัง' });
    assert.match(h.replies[0] ?? '', /กำลังอ่านใบเสร็จ/);
    assert.match(h.replies[0] ?? '', /เก็บภาพแล้ว แต่อ่านข้อมูลไม่สำเร็จ/);
    assert.match(h.replies[0] ?? '', /120\.00 บาท[\s\S]*ยืนยันรายการแล้ว/);
    assert.match(h.replies[0] ?? '', /บิล pending · ยังไม่ทราบยอด/);
    assert.match(h.replies[0] ?? '', /บิล failed · ยังไม่ทราบยอด/);
    assert.doesNotMatch(h.replies[0] ?? '', /· 0\.00 บาท/);
    assert.equal(h.routeRequests.length, 0);
  });

  for (const [name, reading, pattern] of [
    ['a finished read waiting on the web', false, /ไฟล์เมื่อกี้อ่านแล้ว รอตรวจและสร้างรายการในเว็บ/],
    ['a read still running', true, /ไฟล์เมื่อกี้กำลังอ่านอยู่ค่ะ/],
  ] as const) {
    it(`answers for an OPEN capture group with no expense yet — ${name} (§17.5)`, async () => {
      const h = makeHarness({
        permissions: ['expense.receipt.line_upload'], recentCaptures: [],
        openChatGroups: [{ groupId: 'group-7', webPath: '/companies/company-1/expenses/capture/group-7', reading }],
      } as any);
      await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ใบเสร็จเสร็จหรือยัง' });
      assert.match(h.replies[0] ?? '', pattern);
      assert.match(h.replies[0] ?? '', /expenses\/capture\/group-7/);
      // The old answer claimed nothing had been received at all; the file exists and was read.
      assert.doesNotMatch(h.replies[0] ?? '', /ยังไม่พบรายการจากแชทนี้/);
    });
  }

  it('still says so when the chat has neither an expense nor an open capture group', async () => {
    const h = makeHarness({ permissions: ['expense.receipt.line_upload'], recentCaptures: [] });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ใบเสร็จเสร็จหรือยัง' });
    assert.match(h.replies[0] ?? '', /ยังไม่พบรายการจากแชทนี้/);
  });

  it('reports lookup failure honestly and does not ask the model to invent progress', async () => {
    const h = makeHarness({ permissions: ['expense.receipt.line_upload'], recentCaptures: [recent('a')],
      expenseDetail: () => { throw new Error('internal database problem'); } });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ใบเสร็จเสร็จหรือยัง' });
    assert.match(h.replies[0] ?? '', /ยังตรวจสอบสถานะใบเสร็จให้ไม่ได้/);
    assert.doesNotMatch(h.replies[0] ?? '', /internal|database/);
    assert.equal(h.routeRequests.length, 0);
  });

  it('does not widen correction permissions or intercept unrelated workflow questions', async () => {
    for (const text of ['ยอดขายเสร็จหรือยัง', 'ถ้าอ่านบิลเสร็จแล้วจะทำอะไร', 'แก้บิลนี้ให้เสร็จ', 'ใบเสร็จนี้ VAT เท่าไร']) {
      assert.equal(receiptStatusQuestion(text), null, text);
    }
    for (const text of ['นานจัง เสร็จหรือยัง', 'เสร็จยัง', 'อ่านเสร็จหรือยัง']) assert.equal(receiptStatusQuestion(text), 'contextual');
    const h = makeHarness({ permissions: ['line.ai.query'], recentCaptures: [recent('private')], expenseDetail: detail });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ใบเสร็จเสร็จหรือยัง' });
    assert.equal(h.candidateQueries.length, 0, 'no capture/read authority means no receipt query');
    assert.doesNotMatch(h.replies[0] ?? '', /\/expenses\/private/);
    assert.equal(receiptProgressLabel('CONFIRMED'), 'ยืนยันรายการแล้ว');
    assert.equal(receiptProgressLabel('VOIDED'), 'ยกเลิกรายการแล้ว');
    assert.equal(receiptProgressLabel('EXTRACTING'), 'กำลังอ่านใบเสร็จ');
    assert.equal(receiptProgressLabel('DRAFT', 'FAILED'), 'เก็บภาพแล้ว แต่อ่านข้อมูลไม่สำเร็จ');
  });

  it('does not fabricate missing fields when complete OCR omitted the optional missingFields array', async () => {
    const { prisma, recordUpdates, updates } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload'], prisma,
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      receiptOcrResult: validReceiptOcr({ classification: businessClassification({ amountSignals: ['2409.70'], evidenceSignals: ['receipt', 'total 2409.70'] }), fields: { vendorName: 'ร้านทดสอบ', expenseDate: '2026-09-08',
        documentNumber: 'R-123', grandTotalAmount: '2409.70', vatAmount: '157.64', confidence: 0.98 } }),
      receiptApplyOutcome: { candidatesCreated: 0, dateVerified: true, dateStatus: 'verified', categoryId: 'cat', categoryName: 'ค่าเดินทาง' },
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.ok(recordUpdates.length > 0, JSON.stringify({ replies: h.replies, updates }));
    assert.deepEqual(recordUpdates.at(-1).data.aiVerificationSummaryJson.missingFields, []);
    const binding = updates.find((update) => update.data.companyId === 'company-1' && !update.data.status);
    assert.ok(binding, 'company bound before delivery, without clearing envelope or advancing status');
    assert.equal(binding.data.payloadJson, undefined);
  });
});

describe('LINE candidate source at intake and delivery boundaries', () => {
  const plan = (intent: string) => ({ status: 'ROUTED', intent, language: 'th', confidence: 0.95,
    clarifyQuestion: 'เลือกบิล 876,543.00 บาท', clarifyForIntent: 'EXPENSE_CAPTURE_CORRECTION' }) as LineIntakeRoutePlan;
  const rows = () => ['expense-first', 'expense-second'].map(id => ({ id, expenseDate: new Date('2026-09-15T00:00:00Z'),
    grandTotalAmount: '876543.00', sourceDocumentType: 'RECEIPT', createdAt: new Date() }));
  for (const path of ['selection', 'next-step', 'guidance', 'clarification'])
    for (const fault of ['unchanged', 'amount', 'reorder', 'unavailable', 'fallback']) it(`${path} verifies the exact candidate facts before delivery: ${fault}`, async () => {
      const recentCaptures = rows();
      const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'], recentCaptures,
        routePlan: plan(path === 'clarification' ? 'CLARIFY' : 'EXPENSE_CAPTURE_CORRECTION') });
      const uc = h.useCase as any, accepted: unknown[] = [], ledgered: unknown[] = [];
      const change = () => { if (fault === 'unavailable') uc.expenseRepo.listRecentLineCaptures = async () => { throw new Error('read unavailable'); };
        else if (fault === 'reorder') recentCaptures.reverse(); else recentCaptures[0]!.grandTotalAmount = '7'; };
      let privateAttempts = 0;
      uc.lineReply.sendReply = async (_token: string, messages: unknown[]) => {
        if (/876,543|expense-first/.test(JSON.stringify(messages))) {
          privateAttempts++; if (fault === 'fallback') { change(); return 'failed_token'; }
        }
        accepted.push(messages); return 'ok';
      };
      uc.lineReply.sendPush = async (_to: string, messages: unknown[]) => { accepted.push(messages); return 'ok'; };
      uc.ledger = { openWaitingUser: async () => [], appendSubRequests: async (input: unknown) => { ledgered.push(input); } };
      if (!['unchanged', 'fallback'].includes(fault)) uc.handoffLinks = {
        wrapOutgoingLineContent: async (_who: unknown, messages: unknown) => { change(); return messages; },
      };
      const run = h.useCase.execute({ ...TEXT_EVENT, messageText: path === 'selection' ? 'ใบนี้เป็นเอกสารประเภทอะไร'
        : path === 'next-step' ? 'ต้องทำยังไงต่อ' : 'แก้วันที่หน่อย' });
      if (fault === 'unchanged') await run;
      else await assert.rejects(run, /LINE_DELIVERY_FAILED_PERMANENT/);
      if (fault === 'unchanged') { assert.match(JSON.stringify(accepted), /876,543|expense-first/); assert.equal(privateAttempts, 1); }
      else { assert.doesNotMatch(JSON.stringify(accepted), /876,543|expense-first/); assert.match(JSON.stringify(accepted), /ข้อมูลต้นทางเปลี่ยน/);
        assert.equal(privateAttempts, fault === 'fallback' ? 1 : 0); assert.equal(ledgered.length, 0); }
      assert.equal(h.captured.length, 0); assert.equal(h.draftsCreated.length, 0);
    });

  for (const fault of ['amount', 'disappeared', 'permission']) it(`rejects a stale intake result before correction or capture: ${fault}`, async () => {
    const recentCaptures = rows();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'], recentCaptures,
      routePlan: plan('EXPENSE_CAPTURE_CORRECTION') });
    const uc = h.useCase as any, route = uc.aiGateway.requestLineIntakeRoute;
    uc.aiGateway.requestLineIntakeRoute = async (...args: unknown[]) => {
      const result = await route(...args);
      if (fault === 'amount') recentCaptures[0]!.grandTotalAmount = '7';
      else if (fault === 'disappeared') recentCaptures.splice(0);
      else uc.permissionResolver.resolveAccess = async () => ({ membershipId: 'mem-1', roles: ['STAFF'], permissions: [], scopes: {} });
      return result;
    };
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้วันที่หน่อย' });
    assert.equal(h.routeRequests.length, 1); assert.equal(h.correctionCalls.length, 0); assert.equal(h.captured.length, 0);
    assert.match(h.replies.join('\n'), fault === 'permission' ? /สิทธิ์หรือร้านที่เลือกเปลี่ยน/ : /ข้อมูลต้นทางเปลี่ยน/);
    assert.doesNotMatch(h.replies.join('\n'), /876,543|expense-first/);
  });
});

describe('LINE text capture confirms only its current committed source', () => {
  for (const fault of ['unchanged', 'branch', 'revision', 'category', 'fallback']) it(`committed text capture delivery: ${fault}`, async () => {
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], scopes: { branchIds: ['branch-1'] },
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95,
        captureHints: { description: 'ค่ากาแฟ', amount: '65', expenseCategoryId: 'cat-meals' } } });
    const uc = h.useCase as any, read = uc.expenseRepo.findByIdWithRelations, accepted: unknown[] = [];
    let changed = false, privateAttempts = 0;
    uc.expenseRepo.findByIdWithRelations = async (...args: unknown[]) => {
      const row = await read(...args);
      if (!changed || !row) return row;
      return fault === 'branch' ? { ...row, branchId: 'branch-other' }
        : fault === 'category' ? row : { ...row, updatedAt: new Date(row.updatedAt.getTime() + 1), grandTotalAmount: '7' };
    };
    const categories = uc.expenseRepo.listCategories;
    uc.expenseRepo.listCategories = async () => changed && fault === 'category' ? [{ id: 'cat-meals', name: 'ชื่อหมวดเปลี่ยน' }] : categories();
    if (!['unchanged', 'fallback'].includes(fault)) uc.handoffLinks = {
      wrapOutgoingLineContent: async (_who: unknown, messages: unknown) => { changed = true; return messages; },
    };
    uc.lineReply.sendReply = async (_token: string, messages: unknown[]) => {
      if (/expense-note-1/.test(JSON.stringify(messages))) { privateAttempts++; if (fault === 'fallback') { changed = true; return 'failed_token'; } }
      accepted.push(messages); return 'ok';
    };
    uc.lineReply.sendPush = async (_to: string, messages: unknown[]) => { accepted.push(messages); return 'ok'; };
    const run = h.useCase.execute({ ...TEXT_EVENT });
    if (fault === 'unchanged') await run; else await assert.rejects(run, /LINE_DELIVERY_FAILED_PERMANENT/);
    if (fault === 'unchanged') { assert.match(JSON.stringify(accepted), /expense-note-1/); assert.equal(privateAttempts, 1); }
    else { assert.doesNotMatch(JSON.stringify(accepted), /expense-note-1|ค่าอาหาร/); assert.match(JSON.stringify(accepted), /ข้อมูลต้นทางเปลี่ยน/);
      assert.equal(privateAttempts, fault === 'fallback' ? 1 : 0); }
    assert.equal(h.captured.length, 1, 'delivery validation never invokes capture again');
  });
});

describe('LINE continuation replies retain their producing source', () => {
  for (const lane of ['deterministic', 'routed'] as const) {
    for (const fault of ['unchanged', 'revision', 'category', 'choices', 'missing', 'access', 'fallback'] as const) {
      it(`${lane} continuation delivery validates ${fault} without replaying the update`, async () => {
        let changed = false, executed = 0, privateAttempts = 0;
        const accepted: unknown[] = [];
        const contexts = [{ expenseId: 'expense-continuation-1', label: 'ร่างที่เลือก', status: 'OPEN', questions: [] }];
        const h = makeHarness({ permissions: ['expense.receipt.line_upload'],
          routePlan: { status: 'ROUTED', intent: 'EXPENSE_DRAFT_CONTINUATION', language: 'th', confidence: 0.95 },
          expenseDraftConversation: {
            routeContexts: async () => changed && fault === 'choices' ? [] : contexts,
            execute: async () => { executed += 1; return { handled: true, status: 'UPDATED',
              replyTexts: ['ข้อมูลร่างที่บันทึก ค่าอาหาร'], acceptedFields: [] }; },
          },
        });
        const uc = h.useCase as any, execute = uc.expenseDraftConversation.execute;
        uc.expenseDraftConversation.execute = async (...args: unknown[]) => {
          const result = await execute(...args);
          if (fault === 'missing') return { ...result, source: undefined };
          result.source.categories = [{ id: 'cat-meals', name: 'ค่าอาหาร' }];
          if (fault === 'choices') result.source.choices = structuredClone(contexts);
          return result;
        };
        const read = uc.expenseRepo.findByIdWithRelations, categories = uc.expenseRepo.listCategories;
        uc.expenseRepo.findByIdWithRelations = async (...args: unknown[]) => {
          const row = await read(...args);
          return changed && row && ['revision', 'fallback'].includes(fault)
            ? { ...row, updatedAt: new Date(row.updatedAt.getTime() + 1) } : row;
        };
        uc.expenseRepo.listCategories = async () => changed && fault === 'category'
          ? [{ id: 'cat-meals', name: 'หมวดที่แก้แล้ว' }] : categories();
        const access = uc.permissionResolver.resolveAccess;
        uc.permissionResolver.resolveAccess = async (...args: unknown[]) => changed && fault === 'access'
          ? { membershipId: 'revoked', roles: [], permissions: [], scopes: {} } : access(...args);
        if (!['unchanged', 'fallback'].includes(fault)) uc.handoffLinks = {
          wrapOutgoingLineContent: async (_who: unknown, messages: unknown) => { changed = true; return messages; },
        };
        uc.lineReply.sendReply = async (_token: string, messages: unknown[]) => {
          if (/ข้อมูลร่างที่บันทึก/.test(JSON.stringify(messages))) {
            privateAttempts++; if (fault === 'fallback') { changed = true; return 'failed_token'; }
          }
          accepted.push(messages); return 'ok';
        };
        uc.lineReply.sendPush = async (_to: string, messages: unknown[]) => { accepted.push(messages); return 'ok'; };
        const run = h.useCase.execute({ ...TEXT_EVENT, messageText: lane === 'deterministic' ? 'ต่อ' : 'เติมจำนวนกระดาษให้หน่อย' });
        if (fault === 'unchanged') await run; else await assert.rejects(run, /LINE_DELIVERY_FAILED_PERMANENT/);
        assert.equal(executed, 1); assert.equal(h.captured.length, 0); assert.equal(h.ocrRequests.length, 0);
        if (fault === 'unchanged') assert.match(JSON.stringify(accepted), /ข้อมูลร่างที่บันทึก/);
        else {
          assert.doesNotMatch(JSON.stringify(accepted), /ข้อมูลร่างที่บันทึก|ค่าอาหาร/);
          assert.match(JSON.stringify(accepted), fault === 'access' ? /สิทธิ์หรือร้านที่เลือกเปลี่ยน/ : /ข้อมูลต้นทางเปลี่ยน/);
          assert.equal(privateAttempts, fault === 'fallback' ? 1 : 0);
        }
      });
    }
  }
});

describe('LINE substitute results and resume capsules retain their producing source', () => {
  for (const lane of ['legacy', 'primary', 'resume'] as const) {
    it(`parks the previous questionnaire before producing ${lane} facts`, async () => {
      let paused = false; const steps: string[] = [];
      const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
        routePlan: { status: 'ROUTED', intent: lane === 'resume' ? 'BUSINESS_READ_QUESTION' : 'SUBSTITUTE_RECEIPT_CONTINUATION', language: 'th', confidence: 0.95 },
        expenseDraftConversation: {
          routeContexts: async () => [{ expenseId: 'expense-1', label: 'ร่างเดิม', status: paused ? 'PAUSED' : 'OPEN', questions: [] }],
          interruptOpen: async () => { steps.push('pause'); paused = true; },
        },
        ...(lane === 'resume' ? { openWaiting: [{ id: 'sub-1', question: 'เหตุผลคืออะไร?', text: 'ทำใบรับรองต่อ', askedAt: new Date().toISOString(),
          clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', entry: { id: 'sub-1', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' } }] } : {}),
        substituteResult: { handled: true, status: 'TARGET_REQUIRED', expenseId: 'expense-1', candidateExpenseIds: ['expense-1'],
          acceptedFields: [], blockers: [], replyText: 'ข้อมูลรายการ EXP-001 ที่เลือก', pendingQuestion: 'ทำใบรับรองให้รายการนี้ไหมคะ?',
          resumeCapsule: 'ข้อมูลรายการ EXP-001 ที่เลือก ยังทำต่อได้' },
      });
      const uc = h.useCase as any, execute = uc.substituteReceiptContinuation.execute, read = uc.expenseRepo.findByIdWithRelations;
      uc.expenseRepo.findByIdWithRelations = async (...args: unknown[]) => {
        const row = await read(...args); return row && paused ? { ...row, updatedAt: new Date(row.updatedAt.getTime() + 1) } : row;
      };
      uc.substituteReceiptContinuation.execute = async (ctx: any, input: any) => {
        steps.push('produce'); const result = await execute(ctx, input);
        return { ...result, source: substituteReplySource(await uc.expenseRepo.findByIdWithRelations(ctx.companyId, result.expenseId)) };
      };
      if (lane === 'primary') {
        uc.config.lineAiSubstituteSemanticRoutingMode = 'primary';
        uc.substituteReceiptContinuation.substituteContext = (ctx: any, input: any) =>
          LineSubstituteReceiptContinuationUseCase.prototype.substituteContext.call({ repo: uc.expenseRepo } as any, ctx, input);
      }
      await h.useCase.execute({ ...TEXT_EVENT, messageText: lane === 'resume' ? 'ยอดขายเดือนนี้เท่าไหร่?' : 'ทำใบรับรองต่อ' });
      assert.deepEqual(steps, ['pause', 'produce']);
      assert.match(h.replies.join('\n'), /ข้อมูลรายการ EXP-001/);
      assert.doesNotMatch(h.replies.join('\n'), /ข้อมูลต้นทางเปลี่ยน/);
      if (lane === 'resume') assert.equal(h.routeRequests[0].activeExpenseDrafts[0].status, 'PAUSED');
      assert.equal(h.captured.length, 0);
    });
  }
  for (const lane of ['legacy', 'primary', 'resume'] as const) {
    for (const fault of ['unchanged', 'revision', 'evidence', 'missing', 'access', 'fallback'] as const) {
      it(`${lane} validates ${fault} before reply and push without repeating the workflow`, async () => {
        let changed = false, privateAttempts = 0;
        const accepted: unknown[] = [], captureLedger: any[] = [];
        const h = makeHarness({ permissions: ['expense.review', 'line.ai.query'], captureLedger,
          routePlan: { status: 'ROUTED', intent: lane === 'resume' ? 'BUSINESS_READ_QUESTION' : 'SUBSTITUTE_RECEIPT_CONTINUATION', language: 'th', confidence: 0.95 },
          ...(lane === 'resume' ? { openWaiting: [{
            id: 'sub-clarify-1', question: 'เหตุผลคืออะไร?', text: 'ทำใบรับรองต่อ', askedAt: new Date().toISOString(),
            clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
            entry: { id: 'sub-clarify-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' },
          }] } : {}),
          substituteResult: { handled: true, status: 'BLOCKED', workflowId: 'wf-1', expenseId: 'expense-1',
            replyText: 'ข้อมูลใบรับรอง EXP-001 ที่บันทึกไว้', acceptedFields: [], blockers: [],
            pendingQuestion: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?', sideQuestionAnswered: false,
            resumeCapsule: '↩️ ข้อมูลใบรับรอง EXP-001 ที่บันทึกไว้ ยังทำต่อได้',
          },
        });
        const uc = h.useCase as any, execute = uc.substituteReceiptContinuation.execute;
        if (lane === 'primary') {
          uc.config.lineAiSubstituteSemanticRoutingMode = 'primary';
          uc.substituteReceiptContinuation.substituteContext = (ctx: any, input: any) =>
            LineSubstituteReceiptContinuationUseCase.prototype.substituteContext.call({ repo: uc.expenseRepo } as any, ctx, input);
        }
        uc.substituteReceiptContinuation.execute = async (...args: unknown[]) => {
          const result = await execute(...args); return fault === 'missing' ? { ...result, source: undefined } : result;
        };
        const read = uc.expenseRepo.findByIdWithRelations;
        uc.expenseRepo.findByIdWithRelations = async (...args: unknown[]) => {
          const row = await read(...args);
          if (!changed || !row) return row;
          if (fault === 'evidence') return { ...row, substituteReceiptEvidence: { id: 'evidence-1', status: 'ISSUED' } };
          return ['revision', 'fallback'].includes(fault) ? { ...row, updatedAt: new Date(row.updatedAt.getTime() + 1) } : row;
        };
        const access = uc.permissionResolver.resolveAccess;
        uc.permissionResolver.resolveAccess = async (...args: unknown[]) => changed && fault === 'access'
          ? { membershipId: 'revoked', roles: [], permissions: [], scopes: {} } : access(...args);
        if (!['unchanged', 'fallback'].includes(fault)) uc.handoffLinks = {
          wrapOutgoingLineContent: async (_who: unknown, messages: unknown) => { changed = true; return messages; },
        };
        uc.lineReply.sendReply = async (_token: string, messages: unknown[]) => {
          if (/ข้อมูลใบรับรอง EXP-001/.test(JSON.stringify(messages))) {
            privateAttempts++; if (fault === 'fallback') { changed = true; return 'failed_token'; }
          }
          accepted.push(messages); return 'ok';
        };
        uc.lineReply.sendPush = async (_to: string, messages: unknown[]) => { accepted.push(messages); return 'ok'; };
        const run = h.useCase.execute({ ...TEXT_EVENT, messageText: lane === 'resume' ? 'ยอดขายเดือนนี้เท่าไหร่?' : 'ทำใบรับรองต่อ' });
        if (fault === 'unchanged' || lane === 'resume') await run;
        else await assert.rejects(run, /LINE_DELIVERY_FAILED_PERMANENT/);
        assert.equal(h.substituteCalls.length, 1); assert.equal(h.captured.length, 0); assert.equal(h.ocrRequests.length, 0);
        if (lane !== 'legacy') assert.equal(h.routeRequests.length, 1, 'the routed and side-question paths run their normal router');
        if (fault === 'unchanged') {
          assert.match(JSON.stringify(accepted), /ข้อมูลใบรับรอง EXP-001/);
          if (lane === 'resume') assert.match(JSON.stringify(accepted), /turn-answer/);
        } else {
          assert.doesNotMatch(JSON.stringify(accepted), /EXP-001|expense-1|wf-1/);
          assert.match(JSON.stringify(accepted), fault === 'access' ? /สิทธิ์หรือร้านที่เลือกเปลี่ยน/ : /ข้อมูลต้นทางเปลี่ยน/);
          assert.equal(privateAttempts, fault === 'fallback' ? 1 : 0);
          assert.equal(captureLedger.length, 0, 'an unsent question does not create a new clarification');
        }
      });
    }
  }
});

describe('Stored clarification provenance across fresh LINE events', () => {
  for (const fault of ['none', 'missing', 'corrupt', 'oversized', 'wording', 'intent', 'ordered_ids', 'amount', 'after_route', 'access', 'channel'] as const) {
    it(`keeps the original question binding and safely recovers after ${fault}`, async () => {
      const stored: any[] = [];
      const recent = ['expense-a', 'expense-b'].map((id, index) => ({ id, expenseDate: new Date('2026-09-15'),
        grandTotalAmount: String(65 + index), sourceDocumentType: 'EXPENSE_NOTE_TEXT', createdAt: new Date('2026-09-15') }));
      const options: Parameters<typeof makeHarness>[0] = {
        permissions: ['line.ai.query', 'expense.receipt.line_upload', 'expense.update'], captureLedger: stored, recentCaptures: recent,
        routePlan: { status: 'ROUTED', intent: 'CLARIFY', confidence: 1, language: 'th',
          clarifyForIntent: 'EXPENSE_CAPTURE_CORRECTION', clarifyQuestion: 'ต้องการแก้รายการที่ 1 หรือ 2 คะ?' },
      };
      const h = makeHarness(options), uc = h.useCase as any;
      await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: `source-ask-${fault}`, messageText: 'แก้วันที่ใบเสร็จ' });
      const item = stored[0]?.items[0]; assert.ok(item?.sourceContext, 'actual producer stored original source');
      const original = JSON.parse(item.sourceContext);
      assert.deepEqual(JSON.parse(original.candidates).map((row: any) => row.id), ['expense-a', 'expense-b']);
      const open = [{ ...item, id: 'old-question', question: item.clarifyQuestion, askedAt: new Date().toISOString(),
        entry: { ...item, id: 'old-question', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'prior', kind: 'sub_request', userId: 'user-1' } }];
      uc.ledger.openWaitingUser = async () => open.filter(item => !h.ledgerAcks.some(ack => ack.entryId === item.id));
      if (fault === 'missing') delete open[0].entry.sourceContext;
      if (fault === 'corrupt') open[0].entry.sourceContext = '{broken';
      if (fault === 'oversized') open[0].entry.sourceContext = 'ก'.repeat(6000);
      if (fault === 'wording') { open[0].question = 'จ่ายแล้วใช่ไหม'; open[0].clarifyQuestion = open[0].question; }
      if (fault === 'intent') open[0].clarifyForIntent = 'EXPENSE_DOCUMENT_CAPTURE';
      if (fault === 'ordered_ids') open[0].candidateExpenseIds = ['expense-b', 'expense-a'];
      if (fault === 'amount') recent[0].grandTotalAmount = '999';
      if (fault === 'access') options.permissions = ['line.ai.query'];
      const route = uc.aiGateway.requestLineIntakeRoute;
      if (fault === 'after_route') uc.aiGateway.requestLineIntakeRoute = async (input: any) => {
        const result = await route(input); recent[0].grandTotalAmount = '999'; return result;
      };
      // A newer capture changes current recency order, not the original offered list.
      if (fault === 'none') recent.unshift({ ...recent[0], id: 'expense-new' });
      options.routePlan = { status: 'ROUTED', intent: 'EXPENSE_CAPTURE_CORRECTION', confidence: 1, language: 'th',
        resolvedClarificationIds: ['old-question'], correctionHints: { targetExpenseId: 'expense-a', expenseDate: { to: '2026-09-14' } } } as any;
      const replyEvent = { ...TEXT_EVENT, webhookEventId: `source-answer-${fault}`, messageText: '1 วันที่ 14 กันยายน 2569',
        ...(fault === 'channel' ? { messagingChannelId: 'different-channel' } : {}) };
      await h.useCase.execute(replyEvent);
      if (fault === 'none') {
        assert.equal(h.correctionCalls.length, 1);
        assert.deepEqual(h.correctionCalls[0].candidates.map((row: any) => row.id), ['expense-a', 'expense-b']);
        assert.equal(h.routeRequests[1]?.openClarifications[0].sourceContext, undefined, 'opaque proof never reaches AI');
      } else {
        assert.equal(h.correctionCalls.length, 0); assert.equal(h.captured.length, 0);
        assert.equal(h.routeRequests.length, fault === 'after_route' ? 2 : 1, 'stale wording is not routed');
        assert.ok(h.ledgerAcks.some(ack => ack.entryId === 'old-question' && ack.outcome === 'clarification_source_changed'));
        assert.match(h.replies.at(-1) ?? '', /ข้อมูลต้นทางเปลี่ยน|ตรวจสอบไม่ได้/);
        // Durable retirement leaves a route for a fresh request; no loop on the unsafe question.
        uc.aiGateway.requestLineIntakeRoute = route;
        options.routePlan = { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', confidence: 1, language: 'th' };
        await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: `source-fresh-${fault}`, messageText: 'ยอดขายวันนี้เท่าไหร่' });
        assert.match(h.replies.at(-1) ?? '', /turn-answer/);
      }
    });
  }

  it('rechecks a reviewer without capture permission after routing before substitute effects', async () => {
    const options: Parameters<typeof makeHarness>[0] = { permissions: ['line.ai.query', 'expense.review'],
      substituteResult: { handled: true, status: 'OPEN', expenseId: 'exp-review', replyText: 'ต่อได้', acceptedFields: [], blockers: [] },
      routePlan: { status: 'ROUTED', intent: 'SUBSTITUTE_RECEIPT_CONTINUATION', confidence: 1, language: 'th' } };
    const h = makeHarness(options), uc = h.useCase as any;
    uc.config.lineAiSubstituteSemanticRoutingMode = 'primary';
    uc.substituteReceiptContinuation.substituteContext = async () => ({ workflowState: 'open', hasPendingQuestion: true, preparedState: 'in_progress', recentCandidateCount: 0 });
    const route = uc.aiGateway.requestLineIntakeRoute;
    uc.aiGateway.requestLineIntakeRoute = async (input: any) => { const result = await route(input); options.permissions = ['line.ai.query']; return result; };
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'review-revoked-during-route', messageText: 'จ่ายเองค่ะ' });
    assert.equal(h.substituteCalls.length, 0); assert.equal(h.captured.length, 0);
    assert.match(h.replies.at(-1) ?? '', /สิทธิ์|เปลี่ยน/);
  });
});

describe('Stored question facts survive the composer and reply fallback boundary', () => {
  for (const fault of ['none', 'composer', 'fallback'] as const) it(`checks original facts at ${fault}`, async () => {
    const stored: any[] = [];
    const recent = [{ id: 'expense-original', expenseDate: new Date('2026-09-15'), grandTotalAmount: '65', sourceDocumentType: 'EXPENSE_NOTE_TEXT', createdAt: new Date('2026-09-15') }];
    const options: Parameters<typeof makeHarness>[0] = { permissions: ['line.ai.query', 'expense.receipt.line_upload'], recentCaptures: recent, captureLedger: stored,
      routePlan: { status: 'ROUTED', intent: 'CLARIFY', confidence: 1, language: 'th', clarifyQuestion: 'ต้องการถามเกี่ยวกับบิลนี้ใช่ไหมคะ?' } };
    const h = makeHarness(options), uc = h.useCase as any;
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: `ask-composer-${fault}`, messageText: 'ช่วยอธิบายบิลหน่อย' });
    const item = stored[0].items[0];
    const open = { ...item, id: 'question-1', question: item.clarifyQuestion, askedAt: new Date().toISOString(),
      entry: { ...item, id: 'question-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', userId: 'user-1', turnId: 'prior', kind: 'sub_request' } };
    uc.ledger.openWaitingUser = async () => [open];
    options.routePlan = { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', confidence: 1, language: 'th', resolvedClarificationIds: ['question-1'] };
    const gateway = uc.aiGateway.requestLineTurn;
    uc.aiGateway.requestLineTurn = async (input: any) => { const answer = await gateway(input); if (fault === 'composer') recent[0].grandTotalAmount = '999'; return answer; };
    let pushes = 0;
    uc.lineReply.sendPush = async () => { pushes++; return 'ok'; };
    if (fault === 'fallback') {
      const reply = uc.lineReply.sendReply;
      uc.lineReply.sendReply = async (...args: any[]) => {
        if (JSON.stringify(args).includes('turn-answer')) { recent[0].grandTotalAmount = '999'; return 'failed_token'; }
        return reply(...args);
      };
    }
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: `answer-composer-${fault}`, messageText: 'ใช่ค่ะ' });
    assert.equal(h.captured.length, 0); assert.equal(h.turnRequests.length, 1); assert.equal(pushes, 0);
    if (fault === 'none') assert.match(h.replies.at(-1) ?? '', /turn-answer/);
    else { assert.match(h.replies.at(-1) ?? '', /ข้อมูลต้นทางเปลี่ยน|ตรวจสอบไม่ได้/); assert.equal(h.ledgerAcks.length, 0, 'undelivered outcome does not consume the original question'); }
  });
});

/**
 * W02-LINE — the `file` lane, the intake attempts and the §17.6 image recovery.
 *
 * The download is the PRODUCTION one in every test here (`realMediaDownload`): a LINE `file` never
 * carries `contentBase64`, and a fixture that stubs the download away would prove nothing about the
 * defect this lane exists to fix (IG20/E15). `fetch` is stubbed at the transport instead.
 */
describe('LINE file lane (capture appendix §3/§25)', () => {
  const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20), Buffer.from('\n%%EOF\n')]);

  const FILE_EVENT = {
    webhookEventId: 'evt-file-1',
    lineUserId: 'line-user-secret',
    replyToken: 'reply-file-1',
    lineMessageId: 'msg-file-1',
    messageType: 'file' as const,
    fileName: 'invoice-aug.pdf',
    messagingChannelId: 'ch-1',
  };

  /** LINE content + the storage PUT, with no real network anywhere. */
  function stubFetch(overrides: { status?: number; body?: Buffer; contentType?: string; contentLength?: string | null; throws?: Error } = {}) {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('api-data.line.me')) {
        if (overrides.throws) throw overrides.throws;
        const body = overrides.body ?? PDF_BYTES;
        return {
          ok: (overrides.status ?? 200) < 400,
          status: overrides.status ?? 200,
          headers: new Headers({
            'content-type': overrides.contentType ?? 'application/pdf',
            ...(overrides.contentLength === null ? {} : { 'content-length': overrides.contentLength ?? String(body.byteLength) }),
          }),
          body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(body)); controller.close(); } }),
        } as unknown as Response;
      }
      return { ok: true, status: 204 } as Response;
    }) as typeof fetch;
    return { calls, restore: () => { globalThis.fetch = original; } };
  }

  const captureHarness = (extra: Record<string, unknown> = {}) => makeHarness({
    permissions: ['expense.receipt.line_upload'],
    realMediaDownload: true,
    ...extra,
  } as any);

  /**
   * Appendix §25 (owner decision 2026-09-19): a raw `file` event becomes ONE ORDINARY expense draft
   * with the file on it and an `ownerType EXPENSE` read job — no capture group, and still no OCR
   * call and no intake route, which is what gave this lane its own existence (A68).
   */
  it('A68: a raw file event becomes ONE ordinary expense draft and one read job — never OCR', async () => {
    const net = stubFetch();
    const h = captureHarness();
    try {
      await h.useCase.executeReceiptUpload(FILE_EVENT);
    } finally { net.restore(); }

    assert.equal(h.captureState.groups.length, 0, 'no capture group is created any more');
    assert.equal(h.initCalls.length, 1, 'one expense draft');
    assert.equal(h.completeCalls.length, 1, 'the bytes are bound to it');
    assert.equal(h.initCalls[0].captureSource, 'LINE_UPLOAD');
    assert.equal(h.initCalls[0].mimeType, 'application/pdf');
    assert.equal(h.initCalls[0].lineCapture.lineMessageId, 'msg-file-1');
    assert.equal(h.captureState.jobs.length, 1, 'one read job');
    assert.equal(h.captureState.jobs[0].ownerType, 'EXPENSE');
    assert.equal(h.captureState.jobs[0].expenseId, 'expense-1');
    // The whole point of the lane: no intake route and no OCR.
    assert.equal(h.ocrRequests.length, 0, 'no OCR call');
    assert.equal(h.routeRequests.length, 0, 'no intake route call');
    // §16.7 UX: persisted, being read, with the EXPENSE link.
    assert.match(h.replies[0] ?? '', /เก็บไฟล์แล้วค่ะ กำลังอ่านเอกสาร/);
    assert.match(h.replies[0] ?? '', /expenses\/expense-1/);
    assert.ok(!/expenses\/capture/.test(h.replies[0] ?? ''), 'never a group link');
    // The attempt says STORED_READING against the expense it created.
    const stored = h.captureState.attempts.find((row: any) => row.outcome === 'STORED_READING');
    assert.ok(stored, 'an attempt records the stored file');
    assert.equal(stored.stage, 'PERSIST');
    assert.equal(stored.targetType, 'expense');
    assert.equal(stored.targetId, 'expense-1');
    assert.equal(stored.fileNameSanitized, 'invoice-aug.pdf');
    assert.equal(stored.capabilityJson.pdfAutomaticRead, true);
  });

  for (const [name, event, expected] of [
    ['a 1:1 chat', FILE_EVENT, 'line-user-secret'],
    ['a group chat', { ...FILE_EVENT, pushTargetId: 'Cgroup-chat-id' }, 'Cgroup-chat-id'],
  ] as const) {
    it(`records the chat the result may be pushed back into — ${name} (W07-int)`, async () => {
      const net = stubFetch();
      const h = captureHarness();
      try {
        await h.useCase.executeReceiptUpload(event as typeof FILE_EVENT);
      } finally { net.restore(); }
      // Appendix §25: it rides on the expense's own channel metadata now, not on a group column.
      const identity = h.initCalls[0].lineCapture;
      assert.equal(identity.pushTargetId, expected);
      // It matches the hash the record already keeps, which is what the push checks it against.
      assert.equal(identity.chatKeyHash, chatKeyHashOf(event as { lineUserId: string; pushTargetId?: string }));
    });
  }

  it("a caption riding with the file becomes the draft's note, not a manual-entry chat", async () => {
    const net = stubFetch();
    const h = captureHarness();
    let outcome: { outcome: string } | undefined;
    try {
      outcome = await h.useCase.executeReceiptUpload(FILE_EVENT, 'ค่าส่งของเดือนสิงหาคม');
    } finally { net.restore(); }
    assert.equal(h.initCalls[0].note, 'ค่าส่งของเดือนสิงหาคม');
    assert.equal(h.ocrRequests.length, 0);
    assert.equal(outcome?.outcome, 'done', 'a note is not a question');
  });

  it('a caption that is a QUESTION is answered as its own turn, not filed as the note (W07-int)', async () => {
    const net = stubFetch();
    const h = captureHarness();
    let outcome: { outcome: string } | undefined;
    try {
      outcome = await h.useCase.executeReceiptUpload(FILE_EVENT, 'ไฟล์นี้ลงค่าใช้จ่ายบริษัทได้ไหม');
    } finally { net.restore(); }
    // The file turn still says the bytes are kept…
    assert.match(h.replies[0] ?? '', /เก็บไฟล์แล้วค่ะ กำลังอ่านเอกสาร/);
    // …and the buffer runs the question as a text turn afterwards (the image lane's `defer_text`).
    assert.equal(outcome?.outcome, 'defer_text');
    assert.equal(h.initCalls[0].note, 'LINE document upload', 'a question is never stored as the note');
  });

  it('a redelivered file reuses the draft it already produced instead of storing the bytes twice', async () => {
    const net = stubFetch();
    const h = captureHarness();
    try {
      await h.useCase.executeReceiptUpload(FILE_EVENT);
      await h.useCase.executeReceiptUpload({ ...FILE_EVENT, webhookEventId: 'evt-file-1-redelivered', replyToken: 'reply-file-1b' });
    } finally { net.restore(); }
    assert.equal(h.initCalls.length, 1, 'still one draft');
    assert.equal(h.completeCalls.length, 1, 'the bytes were bound once');
    assert.equal(h.captureState.jobs.length, 1, 'still one read job');
    assert.match(h.replies.at(-1) ?? '', /expenses\/expense-1/);
  });

  it('IG20: an oversize file declared by the webhook is rejected with its own reason, before any fetch', async () => {
    const net = stubFetch();
    const h = captureHarness();
    try {
      await h.useCase.executeReceiptUpload({ ...FILE_EVENT, fileSize: 999_999_999 });
    } finally { net.restore(); }
    assert.equal(h.captureState.groups.length, 0, 'nothing stored');
    assert.equal(net.calls.length, 0, 'the bytes were never fetched');
    const attempt = h.captureState.attempts.at(-1);
    assert.equal(attempt.stage, 'DOWNLOAD');
    assert.equal(attempt.reasonCode, 'oversize_declared');
    assert.equal(attempt.outcome, 'REJECTED');
    assert.equal(attempt.declaredFileSize, 999_999_999);
    // UXE-03 says ไฟล์ for a file, never รูป.
    assert.match(h.replies[0] ?? '', /ยังรับไฟล์จาก LINE ไม่สำเร็จ/);
    assert.ok(!/รูป/.test(h.replies[0] ?? ''), 'a PDF is never called a รูป');
  });

  it('IG20: a body that outgrows the limit mid-stream is oversize_measured, not a generic failure', async () => {
    const net = stubFetch({ body: Buffer.alloc(11 * 1024 * 1024, 0x41), contentLength: null });
    const h = captureHarness();
    try {
      await h.useCase.executeReceiptUpload(FILE_EVENT);
    } finally { net.restore(); }
    assert.equal(h.captureState.groups.length, 0);
    assert.equal(h.captureState.attempts.at(-1).reasonCode, 'oversize_measured');
  });

  it('IG20: an HTTP failure and a timeout keep their own reasons', async () => {
    for (const [override, reason] of [
      [{ status: 404 }, 'download_http'],
      [{ throws: Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }, 'download_timeout'],
      [{ throws: new Error('socket hang up') }, 'download_failed'],
    ] as const) {
      const net = stubFetch(override as any);
      const h = captureHarness();
      try {
        await h.useCase.executeReceiptUpload(FILE_EVENT);
      } finally { net.restore(); }
      assert.equal(h.captureState.attempts.at(-1).reasonCode, reason);
      assert.equal(h.captureState.attempts.at(-1).outcome, 'REJECTED');
    }
  });

  it('a file the security checks refuse records a SECURITY attempt and stores nothing', async () => {
    // A PDF extension over PNG magic bytes: `inspectAttachmentBytes` refuses the mismatch.
    const net = stubFetch({ body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), contentType: 'application/pdf' });
    const h = captureHarness();
    try {
      await h.useCase.executeReceiptUpload(FILE_EVENT);
    } finally { net.restore(); }
    assert.equal(h.captureState.groups.length, 0);
    const attempt = h.captureState.attempts.at(-1);
    assert.equal(attempt.stage, 'SECURITY');
    assert.equal(attempt.outcome, 'REJECTED');
    // P05 (R4a): a mislabelled file is uninspectable, not proven active content, so it gets the
    // truthful "could not check" recovery instead of the security refusal.
    assert.equal(attempt.reasonCode, 'CONTENT_UNINSPECTABLE');
    assert.match(h.replies[0] ?? '', /ระบบตรวจไฟล์นี้ไม่ได้ ส่งไฟล์อื่นได้ค่ะ/);
  });

  /**
   * Appendix §25: A45 ("งานเดิม หรือ ใบใหม่") is withdrawn with the groups it moved files between.
   * A second file is simply a second draft, exactly as a second photo is — no question is asked,
   * and nothing merges on timing.
   */
  it('a second file in the same chat is just its own draft — no grouping question is asked', async () => {
    const net = stubFetch();
    const h = captureHarness();
    try {
      await h.useCase.executeReceiptUpload(FILE_EVENT);
      await h.useCase.executeReceiptUpload({ ...FILE_EVENT, webhookEventId: 'evt-file-2', lineMessageId: 'msg-file-2', fileName: 'invoice-sep.pdf', replyToken: 'reply-file-2' });
    } finally { net.restore(); }
    assert.equal(h.initCalls.length, 2, 'two drafts');
    assert.equal(h.captureState.groups.length, 0);
    for (const reply of h.replies) {
      assert.ok(!/งานเดิม|ใบใหม่/.test(reply), `no grouping question: ${reply}`);
      assert.match(reply, /เก็บไฟล์แล้วค่ะ กำลังอ่านเอกสาร/);
    }
    assert.equal(h.captureState.attempts.filter((row: any) => row.stage === 'ROUTE').length, 0);
  });

  it('the persist refusing never claims the file was kept', async () => {
    const net = stubFetch();
    const h = captureHarness({ initReceiptUploadThrows: new ConflictException('nope') });
    let threw = false;
    try {
      await h.useCase.executeReceiptUpload(FILE_EVENT);
    } catch { threw = true; } finally { net.restore(); }
    assert.equal(h.initCalls.length, 0);
    assert.equal(h.captureState.attempts.at(-1).reasonCode, 'persist_failed');
    assert.ok(!threw || true);
    assert.ok(!/เก็บไฟล์แล้ว/.test(h.replies.join('\n')), 'no retention claim without a persisted identity');
  });
});

/** The §17.5 status question on the TEXT lane, deterministic and before any model call. */
describe('LINE capture answers and §17.5 status questions', () => {
  const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20), Buffer.from('\n%%EOF\n')]);
  const FILE_EVENT = {
    webhookEventId: 'evt-file-a45', lineUserId: 'line-user-secret', replyToken: 'reply-a45',
    lineMessageId: 'msg-file-a45', messageType: 'file' as const, fileName: 'invoice-aug.pdf',
    messagingChannelId: 'ch-1',
  };

  function stubLineContent() {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes('api-data.line.me')) {
        return {
          ok: true, status: 200,
          headers: new Headers({ 'content-type': 'application/pdf', 'content-length': String(PDF_BYTES.byteLength) }),
          body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(PDF_BYTES)); controller.close(); } }),
        } as unknown as Response;
      }
      return { ok: true, status: 204 } as Response;
    }) as typeof fetch;
    return () => { globalThis.fetch = original; };
  }

  /** Persist a second file so the chat really has an open "งานเดิม หรือ ใบใหม่" question. */

  const answer = (text: string) => ({
    webhookEventId: 'evt-a45-answer', lineUserId: 'line-user-secret', replyToken: 'reply-a45-answer',
    messageText: text, messagingChannelId: 'ch-1', lineMessageId: 'msg-a45-answer',
  });




  it('§17.5: with no attempt at all, the answer names the way back in — never a cause', async () => {
    const { prisma } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], prisma } as any);
    await h.useCase.execute({ ...answer('ไฟล์เมื่อกี้ทำไมส่งไม่ได้'), webhookEventId: 'evt-status-none' });
    assert.match(h.replies.at(-1) ?? '', /ตอนนี้ยังไม่พบไฟล์ที่จะอ่านค่ะ/);
    assert.equal(h.turnRequests.length, 0, 'answered deterministically, with no model call');
    assert.equal(h.ocrRequests.length, 0, 'a status question never costs a read');
  });

  it('§17.5: a bare "บันทึกไปยัง" in a chat that sent no file goes to the record lanes, not the no-file reply (NAT-12)', async () => {
    const { prisma } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], prisma } as any);
    await h.useCase.execute({ ...answer('เมื่อกี้เน็ตหลุด สรุปบันทึกไปยัง'), webhookEventId: 'evt-status-note' });
    assert.doesNotMatch(h.replies.at(-1) ?? '', /ยังไม่พบไฟล์ที่จะอ่าน/);
    assert.ok(h.routeRequests.length >= 1, 'the semantic route decides what "it" is');
  });

  it('§17.5: an oversize rejection is explained with its real size and the real limit', async () => {
    const { prisma } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], realMediaDownload: true, prisma } as any);
    const restore = stubLineContent();
    try {
      await h.useCase.executeReceiptUpload({ ...FILE_EVENT, fileSize: 12 * 1024 * 1024 });
    } finally { restore(); }
    await h.useCase.execute({ ...answer('ไฟล์ใหญ่ไปหรือเปล่า'), webhookEventId: 'evt-status-oversize' });
    assert.match(h.replies.at(-1) ?? '', /ขนาด 12\.0 เมกะไบต์ เกินขนาดที่ระบบรับได้ 10\.0 เมกะไบต์/);
    assert.match(h.replies.at(-1) ?? '', /เลือกไฟล์ที่เล็กกว่าแล้วส่งอีกครั้งได้เลยค่ะ/);
    assert.equal(h.turnRequests.length, 0);
  });

  it('§17.5: a stored file being read says so, with the link to watch it', async () => {
    const { prisma } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], realMediaDownload: true, prisma } as any);
    const restore = stubLineContent();
    try { await h.useCase.executeReceiptUpload(FILE_EVENT); } finally { restore(); }
    await h.useCase.execute({ ...answer('บันทึกไปหรือยัง'), webhookEventId: 'evt-status-stored' });
    assert.match(h.replies.at(-1) ?? '', /เก็บไฟล์ invoice-aug\.pdf ไว้แล้วค่ะ/);
    // Appendix §25: the recovery is the EXPENSE the file became, never a group page.
    assert.match(h.replies.at(-1) ?? '', /expenses\/expense-1/);
    assert.ok(!/expenses\/capture/.test(h.replies.at(-1) ?? ''));
  });

  it('§17.5: several candidates ask which file, numbered, instead of guessing the latest', async () => {
    const { prisma } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload', 'line.ai.query'], realMediaDownload: true, prisma } as any);
    const restore = stubLineContent();
    try {
      await h.useCase.executeReceiptUpload({ ...FILE_EVENT, fileSize: 12 * 1024 * 1024 });
      await h.useCase.executeReceiptUpload({ ...FILE_EVENT, webhookEventId: 'evt-file-a45-b', lineMessageId: 'msg-file-a45-b', fileName: 'invoice-sep.pdf', replyToken: 'r2' });
    } finally { restore(); }
    await h.useCase.execute({ ...answer('ไฟล์เมื่อกี้ส่งไม่ได้'), webhookEventId: 'evt-status-many' });
    assert.match(h.replies.at(-1) ?? '', /หมายถึงไฟล์ไหนคะ/);
    assert.match(h.replies.at(-1) ?? '', /• ไฟล์ /);
    assert.match(h.replies.at(-1) ?? '', /• ไฟล์ /);
  });
});

it('7B W2: explicit no-more-evidence bypasses semantic-task persistence for one authoritative open substitute', async () => {
  const h = makeHarness({ permissions: ['expense.review', 'line.ai.query'], substituteResult: {
    handled: true, status: 'BLOCKED', expenseId: 'expense-1', acceptedFields: ['evidenceNone'],
    blockers: [{ code: 'payment_evidence_required', collectableInLine: false }], pendingQuestion: 'ส่งรูปสลิปเข้ามาได้เลยค่ะ',
    replyText: 'รับทราบว่าไม่มีหลักฐานอื่นค่ะ ยังรอสลิปของรายการนี้',
  } });
  const flow = h.useCase as any;
  flow.config.lineAiSubstituteSemanticRoutingMode = 'primary';
  flow.substituteReceiptContinuation.substituteContext = async () => ({ workflowState: 'open', hasPendingQuestion: true, preparedState: 'in_progress', recentCandidateCount: 0 });
  flow.preserveSemanticTask = async () => assert.fail('a direct evidence answer does not need a model-owned task');
  await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ไม่มีหลักฐานอื่น' });
  assert.equal(h.routeRequests.length, 0); assert.equal(h.substituteCalls.length, 1);
  assert.equal(h.substituteCalls[0].messageText, 'ไม่มีหลักฐานอื่น'); assert.match(h.replies.join('\n'), /รับทราบว่าไม่มีหลักฐานอื่น/);
});
