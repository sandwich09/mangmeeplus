import * as evidenceUseCases from './expense-evidence.use-case';
import * as documentUseCases from './expense-document.use-case';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { GetExpenseUseCase, GetExpenseHistoryUseCase } from './expense-draft.use-case';
import { inflateRawSync } from 'node:zlib';
import { LineExpenseDraftConversationUseCase } from './line-expense-draft-conversation.use-case';
import { applyLineExpenseDraftAnswer, materializedLineExpenseDraftItems, buildInitialLineExpenseDraftContinuation, collectLineExpenseDraftQuestions, isLineExpenseDraftStartEligible } from '../../domain/logic/line-expense-draft-conversation.logic';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureLineExpenseNoteUseCase, CreateExpenseCategoryUseCase, UpdateExpenseCategoryUseCase, ListAllExpenseCategoriesUseCase, LineTextExpenseCaptureIncompleteError, lineDraftIdempotencyKey } from './expense-document.use-case';
import { PAYMENT_IDEMPOTENCY_KEY_PATTERN } from '../../../accounting-documents/domain/logic/accounting-money-validation.logic';
import sharp from 'sharp';
import { CreateSignatureAssetUseCase, ArchiveSignatureAssetUseCase, FillSignatureUseCase, ListSignatureAssetsUseCase, GetSignatureImageUseCase, InitSignatureUploadUseCase } from './signature-asset.use-case';
import { normalizeSignatureImage, SIGNATURE_MAX_BYTES } from '../../domain/logic/signature-image.logic';
import { loadExpenseEvidenceSources } from '../../infrastructure/expense-evidence-sources';
import { CreateAccountantPackageUseCase, GetSharedEvidenceViewUseCase } from './expense-evidence.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';

const audit = { log: async () => undefined } as any;
const outbox = { append: async () => undefined } as any;

function ctx(permissions: string[], authProvider: 'watchdog' | 'line' = 'watchdog'): RequestContext {
  return {
    requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
    membershipId: 'mem-1', roles: [], permissions, scopes: {}, authProvider,
  };
}

describe('CaptureLineExpenseNoteUseCase', () => {
  it('UAT2 W1: description-only text never creates a junk expense, even with invented money/date hints', async () => {
    const { repo } = makeRepo();
    const capture = new CaptureLineExpenseNoteUseCase(repo, { execute: async () => assert.fail('no new expense') } as any, audit, outbox);
    for (const draftConversationEnabled of [true, false]) for (const messageText of ['ค่าอาหาร', 'ซื้อกระดาษมาใช้ที่ออฟฟิศ']) {
      await assert.rejects(() => capture.execute(ctx(['expense.create'], 'line'), {
        messageText, captureHints: { description: messageText, amount: '1388', expenseDate: '2026-10-17', confidence: 1 },
        draftConversationEnabled, semanticBusinessExpenseConfirmed: true, lineMessageId: 'no-junk', lineEventId: 'no-junk',
      }), LineTextExpenseCaptureIncompleteError);
    }
  });
  it('Fix-up 24 D4: exact C05 source reaches real draft creation with 300 baht WHT and rejects conflicting rates before creation', async () => {
    const { CreateExpenseDraftUseCase } = await import('./expense-draft.use-case');
    const { readFileSync } = await import('node:fs');
    const live = JSON.parse(readFileSync(require.resolve('../../../../../../../docs/evidence/mangmee-advisor-fx24-router-replays.json'), 'utf8'));
    const text = live.C05.turns[1].body.events[0].message.text;
    let creates = 0, current: any; const lines: any[] = [];
    const { repo } = makeRepo({ resolveCreateBranchId: async () => 'branch-1',
      createExpense: async (input: any, within: any) => { creates++; current = { ...input, id: 'fx24-real-expense', updatedAt: new Date() }; await within({}, current); return current; },
      upsertLines: async (_company: string, _id: string, rows: any[]) => { lines.push(...rows); },
      updateExpense: async (input: any) => { current = { ...current, ...input }; return current; } });
    const create = new CreateExpenseDraftUseCase(repo, audit, { resolveLines: async (_ctx: any, _header: any, rows: any[]) => rows } as any, { assertLaunchRouteOpen: async () => undefined } as any);
    const capture = new CaptureLineExpenseNoteUseCase(repo, create, audit, outbox);
    const cmd: any = { messageText: text, captureHints: { amount: '10000', description: 'ทำป้ายหน้าร้าน', vendorName: 'บริษัท ป้ายสวย จำกัด', confidence: 1 },
      semanticBusinessExpenseConfirmed: true, lineMessageId: 'fx24-real-wht', lineEventId: 'fx24-real-wht',
      counterparty: { id: 'saved-counterparty', name: 'บริษัท ป้ายสวย จำกัด', taxId: '0105561234560', address: '12 ถนนลาดพร้าว แขวงจอมพล เขตจตุจักร กรุงเทพฯ 10900', entityKind: 'JURISTIC' } };
    const result = await capture.execute(ctx(['expense.create'], 'line'), cmd);
    assert.equal(creates, 1); assert.equal(Number(result.expense.grandTotalAmount), 10000); assert.equal(Number(result.expense.whtAmount), 300);
    assert.equal(Number(result.expense.netPayableAmount), 9700); assert.equal(Number(lines[0].whtRate), 0.03);
    assert.equal(result.expense.vendorCounterpartyId, 'saved-counterparty'); assert.equal(result.expense.vendorEntityKindSnapshot, 'JURISTIC');
    await assert.rejects(() => capture.execute(ctx(['expense.create'], 'line'), { ...cmd, messageText: text + ' WHT 5%' }), /อัตราหัก ณ ที่จ่ายเดียว/);
    assert.equal(creates, 1);
  });

  it('F1: accepts ordered grounded tokens, rejects invented/reversed tokens and keeps money/date grounding', () => {
    const hints = { confidence: 0.9, amount: '500' };
    assert.equal(isLineExpenseDraftStartEligible('อินฟลู 500 บาท', hints, true), true);
    assert.equal(isLineExpenseDraftStartEligible('อินฟลู 500 บาท', hints, false), false);
    assert.equal(isLineExpenseDraftStartEligible('อินฟลู 600 บาท', hints, true), false);
    assert.equal(isLineExpenseDraftStartEligible('รับเงินจากลูกค้า 500 บาท', hints, true), false);
    for (const [description, expected] of [['ค่าใช้จ่าย อินฟลู', 'ค่าใช้จ่าย อินฟลู'], ['อินฟลู ค่าใช้จ่าย', 'อินฟลู'], ['ค่าใช้จ่าย ไม่มีในข้อความ', 'อินฟลู']] as const) {
      const state = buildInitialLineExpenseDraftContinuation({ workflowId: 'wf', companyId: 'c', userId: 'u', expenseId: 'e',
        chatKeyHash: 'chat', targetRevision: 'rev', provisionalExpenseDate: '2026-10-15', categories: [],
        messageText: 'สร้างค่าใช้จ่ายให้ อินฟลู 500 บาท วันที่ 10 ตุลา 2569',
        hints: { confidence: 0.9, description, amount: '600', expenseDate: '2026-10-11' } });
      assert.equal(state.items[0]?.description, expected);
      assert.equal(state.items[0]?.totalAmount, '500', 'recover only the stated money, never the invented 600');
      assert.equal(state.header.expenseDate, '2026-10-10', 'date falls back only to the extracted source date');
    }
  });

  function makeRepo(overrides: Record<string, unknown> = {}) {
    const updates: any[] = [];
    const deleted: any[] = [];
    return {
      updates,
      deleted,
      repo: {
        findByLineMessageId: async () => null,
        listCategories: async () => [{ id: 'cat-meals', name: 'ค่าอาหาร' }, { id: 'cat-travel', name: 'ค่าเดินทาง' }],
        updateExpense: async (input: any) => { updates.push(input); return { ...input, grandTotalAmount: '65.0000' }; },
        deleteDraftExpense: async (...args: any[]) => { deleted.push(args); },
        ...overrides,
      } as any,
    };
  }
  const createDraft = {
    execute: async (_c: any, input: any) => ({
      id: 'exp-1', expenseCategoryId: input.expenseCategoryId ?? null, grandTotalAmount: '65.0000',
      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    }),
  } as any;

  it('F1: captures the exact real-model turn-0 route as one dated, total-only draft', async () => {
    // Verbatim router result from trace-t2.jsonl turn 0, kept here so tests never depend on live evidence files.
    const route = {"status":"ROUTED","intent":"EXPENSE_DOCUMENT_CAPTURE","language":"th","confidence":0.93,"captureHints":{"sourceDocumentType":"EXPENSE_NOTE_TEXT","sourceDocumentLanguage":"th","vendorName":"อินฟลู","description":"ค่าใช้จ่าย อินฟลู","expenseDate":"2026-10-10","amount":"500","vatMode":"NEEDS_REVIEW","confidence":0.88,"missingFields":["businessPurpose","vatMode"]},"semanticOutcome":"BUSINESS_EXPENSE","fundingSource":"COMPANY_PAID","semanticSubrequests":[{"index":0,"kind":"write","goal":"บันทึกค่าใช้จ่าย อินฟลู 500 บาท วันที่ 10 ตุลาคม 2569","requiredEvidence":[],"requestedFilters":{},"writeIntent":"EXPENSE_DOCUMENT_CAPTURE","dependsOn":[],"evidenceRefs":[{"partId":"part-0","startUtf16":0,"endUtf16":53,"rawSha256":"3d9cf8292aa61a3ac0a030c4c68390a2d4e07fb47cff82ea82f631ef9f9b07e9"}]}],"usage":[{"tag":"line.intake-route","modelId":"global.anthropic.claude-sonnet-4-6","ok":true,"inputTokens":3329,"outputTokens":247,"cacheReadInputTokens":19943,"cacheWriteInputTokens":0,"durationMs":5990,"usageBasis":"PROVIDER_REPORTED","invocationKey":"company-a#81d312a41abb205a470b48b0319c497fa261a8567edc8ab4864a64040c4a9594#provider-v2#0"}]};
    const creates: any[] = [];
    const { repo, updates } = makeRepo({ updateExpense: async (input: any) => {
      updates.push(input); return { ...input, grandTotalAmount: '500.0000' };
    } });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, { execute: async (_ctx: any, input: any) => {
      creates.push(input); return { id: 'exp-real', grandTotalAmount: '500.0000', updatedAt: new Date('2026-10-15T00:00:00Z') };
    } } as any, audit, outbox);
    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'สร้างค่าใช้จ่ายให้ อินฟลู 500 บาท วันที่ 10 ตุลา 2569',
      captureHints: route.captureHints as any,
      semanticBusinessExpenseConfirmed: route.semanticOutcome === 'BUSINESS_EXPENSE' && route.fundingSource === 'COMPANY_PAID',
      draftConversationEnabled: true, lineMessageId: 'real-model-turn-0', lineEventId: 'real-model-turn-0',
    });
    assert.equal(creates.length, 1);
    assert.equal(creates[0].expenseDate, '2026-10-10');
    assert.deepEqual(creates[0].lines.map(({ description, quantity, unitPrice }: any) => ({ description, quantity, unitPrice })),
      [{ description: 'ค่าใช้จ่าย อินฟลู', quantity: '1', unitPrice: '500' }]);
    assert.equal(result.insertedAmount, '500.0000');
    assert.equal(updates[0].status, 'DRAFT');
    const state = updates[0].sourceChannelMetadataJson.lineExpenseDraftContinuation;
    assert.equal(state.items.length, 1); assert.equal(state.items[0].totalAmount, '500');
    assert.ok(!state.unresolvedQuestions.some((q: any) => q.field === 'quantity'));
    assert.doesNotMatch(result.replyTexts.join(' '), /จำนวนเท่าไร|จำนวนและหน่วย/u);
  });

  it('G1: exact second live capture defaults the payee item and immediately saves 500', async () => {
    // Verbatim trace-t2-run2.jsonl turn 0 (no runtime dependency on live artifacts).
    const route = {"status":"ROUTED","intent":"EXPENSE_DOCUMENT_CAPTURE","language":"th","confidence":0.93,"captureHints":{"sourceDocumentType":"EXPENSE_NOTE_TEXT","sourceDocumentLanguage":"th","vendorName":"อินฟลู","description":"ค่าใช้จ่ายอินฟลู","expenseDate":"2026-10-10","amount":"500","vatMode":"NEEDS_REVIEW","confidence":0.88,"missingFields":["businessPurpose","vatMode"]},"semanticOutcome":"BUSINESS_EXPENSE","fundingSource":"COMPANY_PAID","semanticSubrequests":[{"index":0,"kind":"write","goal":"สร้างค่าใช้จ่าย อินฟลู 500 บาท วันที่ 10 ตุลาคม 2569","requiredEvidence":[],"requestedFilters":{},"writeIntent":"EXPENSE_DOCUMENT_CAPTURE","dependsOn":[],"evidenceRefs":[{"partId":"part-0","startUtf16":0,"endUtf16":53,"rawSha256":"3d9cf8292aa61a3ac0a030c4c68390a2d4e07fb47cff82ea82f631ef9f9b07e9"}]}],"usage":[{"tag":"line.intake-route","modelId":"global.anthropic.claude-sonnet-4-6","ok":true,"inputTokens":3329,"outputTokens":246,"cacheReadInputTokens":20595,"cacheWriteInputTokens":0,"durationMs":6001,"usageBasis":"PROVIDER_REPORTED","invocationKey":"company-a#9d833e7bf07032e9eb9ac4347330c3fb846140ccf91de41d4402ddcfd576c9f1#provider-v2#0"}]};
    const creates: any[] = [];
    const { repo, updates } = makeRepo({ updateExpense: async (input: any) => { updates.push(input); return { ...input, grandTotalAmount: '500' }; } });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, { execute: async (_ctx: any, input: any) => {
      creates.push(input); return { id: 'exp-live-2', grandTotalAmount: '500', updatedAt: new Date('2026-10-15T00:00:00Z') };
    } } as any, audit, outbox);
    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'สร้างค่าใช้จ่ายให้ อินฟลู 500 บาท วันที่ 10 ตุลา 2569', captureHints: route.captureHints as any,
      semanticBusinessExpenseConfirmed: true, draftConversationEnabled: true, lineMessageId: 'live-2', lineEventId: 'live-2',
    });
    assert.equal(creates.length, 1);
    assert.equal(creates[0].expenseDate, '2026-10-10');
    assert.deepEqual(creates[0].lines.map(({ description, quantity, unitPrice }: any) => ({ description, quantity, unitPrice })),
      [{ description: 'ค่าใช้จ่าย อินฟลู', quantity: '1', unitPrice: '500' }]);
    assert.equal(result.insertedAmount, '500');
    const state = updates[0].sourceChannelMetadataJson.lineExpenseDraftContinuation;
    assert.deepEqual(state.unresolvedQuestions.map((q: any) => q.id), ['I01-CATEGORY']);
    assert.match(result.replyTexts.join(' '), /รายการ: ค่าใช้จ่าย อินฟลู 1 งาน 500 บาท/u);
    assert.doesNotMatch(result.replyTexts.join(' '), /ชื่อสินค้า\/บริการ/u);
  });

  it('hands the draft create a key its own validator accepts, for LINE ids and 64-hex task ids alike (NAT12 2026-09-29)', async () => {
    const keys: string[] = [];
    const recording = { execute: async (c: any, input: any) => { keys.push(input.idempotencyKey); return createDraft.execute(c, input); } } as any;
    const { repo } = makeRepo();
    await new CaptureLineExpenseNoteUseCase(repo, recording, audit, outbox).execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่าส่งของ 300 บาท', captureHints: { description: 'ค่าส่งของ', amount: '300' },
      lineMessageId: '586153923437625359', lineEventId: '01JAQ7W8Z3M9K2T4B6D8F0H2J4' });
    for (const key of [...keys, lineDraftIdempotencyKey('a'.repeat(64)), lineDraftIdempotencyKey('replay-3d22c4088d3be6636a5c-0')]) {
      assert.match(key, PAYMENT_IDEMPOTENCY_KEY_PATTERN);
    }
    assert.equal(keys[0], 'line-draft-01JAQ7W8Z3M9K2T4B6D8F0H2J4');
    assert.notEqual(lineDraftIdempotencyKey('a'.repeat(64)), lineDraftIdempotencyKey('b'.repeat(64)));
  });

  it('preserves the proven single-turn capture while the rollout flag is off', async () => {
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่ากาแฟ 65 บาท',
      captureHints: { description: 'ค่ากาแฟ', amount: '65', expenseCategoryId: 'cat-meals' },
      lineMessageId: 'legacy-msg', lineEventId: 'legacy-evt',
    });

    assert.equal(result.insertedAmount, '65.0000');
    assert.equal(result.categoryId, 'cat-meals');
    assert.equal(result.categoryNameSourceId, 'cat-meals');
    assert.deepEqual(result.replyTexts, []);
    assert.equal(updates.at(-1).status, 'NEEDS_REVIEW');
    assert.equal(updates.at(-1).sourceChannelMetadataJson.lineExpenseDraftContinuation, undefined);
  });

  it('opens an incomplete multi-item draft only when the rollout flag and confidence gate pass', async () => {
    const { repo, updates } = makeRepo();
    const creates: any[] = [];
    const useCase = new CaptureLineExpenseNoteUseCase(repo, {
      execute: async (_c: any, input: any) => {
        creates.push(input);
        return { id: 'exp-1', expenseCategoryId: null, grandTotalAmount: '0.0000', updatedAt: new Date('2026-08-18T00:00:00.000Z') };
      },
    } as any, audit, outbox);

    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'ซื้อกระดาษ A4 กับโน้ตบุ๊ก โน้ตบุ๊ก 1 เครื่อง 25000 บาท',
      captureHints: {
        confidence: 0.95,
        items: [
          { sourceText: 'กระดาษ A4', description: 'กระดาษ A4' },
          { sourceText: 'โน้ตบุ๊ก 1 เครื่อง 25000 บาท', description: 'โน้ตบุ๊ก', quantity: '1', unit: 'เครื่อง', unitPrice: '25000' },
        ],
      },
      lineMessageId: 'multi-msg', lineEventId: 'multi-evt',
    });

    assert.equal(creates.length, 1);
    assert.equal(creates[0].lines.length, 1, 'the incomplete paper item is preserved in metadata, not fabricated as a line');
    assert.match(result.replyTexts.join('\n'), /วันไหนคะ/u);
    assert.doesNotMatch(result.replyTexts.join('\n'), /หมวดค่าใช้จ่าย|ซื้อจากร้าน/u, 'ask only for the first missing field');
    assert.equal(updates.at(-1).status, 'DRAFT');
  });

  it('creates a reviewable no-receipt draft from validated semantic hints', async () => {
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);
    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'ค่ากาแฟ 65 บาท',
      captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', description: 'ค่ากาแฟ', amount: '65', confidence: 0.9 },
      lineMessageId: 'msg-1',
      lineEventId: 'evt-1',
    });
    assert.equal(result.insertedAmount, '65.0000', 'a grounded total-only note uses quantity one (A2)');
    assert.equal(result.categoryId, null, 'no category is invented when the router names none');
    assert.doesNotMatch(result.replyTexts.join('\n'), /จำนวนและหน่วย/u);
    assert.doesNotMatch(result.replyTexts.join('\n'), /หมวดค่าใช้จ่าย|ซื้อจากร้าน/u, 'ask only for the first missing field');
    const update = updates.at(-1);
    assert.equal(update.sourceDocumentType, 'EXPENSE_NOTE_TEXT');
    assert.equal(update.taxEvidenceStatus, 'SUPPORTING_ONLY');
    assert.equal(update.taxEvidenceReasonCode, 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE');
    assert.equal(update.status, 'DRAFT');
    assert.equal(update.lineMessageId, 'msg-1');
    assert.equal(
      update.sourceChannelMetadataJson.lineExpenseDraftContinuation.targetRevision,
      update.updatedAt.toISOString(),
    );
    // Bounded provenance only – no raw full message dump.
    assert.equal(update.sourceChannelMetadataJson.messagePreview, 'ค่ากาแฟ 65 บาท');
  });

  it('files a text note under the category the router named, and keeps differing item categories off the document (Owner 2026-09-29)', async () => {
    const creates: any[] = [];
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, { execute: async (c: any, input: any) => { creates.push(input); return createDraft.execute(c, input); } } as any, audit, outbox);
    const single = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true, messageText: 'ค่ากาแฟ 65 บาท',
      captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', description: 'ค่ากาแฟ', amount: '65', expenseCategoryId: 'cat-meals', confidence: 0.8 },
      lineMessageId: 'msg-category', lineEventId: 'evt-category',
    });
    assert.equal(creates[0].expenseCategoryId, 'cat-meals');
    assert.equal(single.categoryName, 'ค่าอาหาร');
    assert.equal(updates.at(-1).sourceChannelMetadataJson.lineExpenseDraftContinuation.items[0].expenseCategoryId, 'cat-meals');
    assert.equal(updates.at(-1).aiVerificationSummaryJson.missingFields.includes('expenseCategoryId'), false);
    assert.doesNotMatch(single.replyTexts.join('\n'), /หมวดค่าใช้จ่าย/u);

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true, messageText: 'ค่ากาแฟ 2 แก้ว 130 บาท กับค่าแท็กซี่ 1 เที่ยว 90 บาท',
      captureHints: { confidence: 0.95, items: [
        { sourceText: 'ค่ากาแฟ 2 แก้ว 130 บาท', description: 'ค่ากาแฟ', quantity: '2', totalAmount: '130', expenseCategoryId: 'cat-meals' },
        { sourceText: 'ค่าแท็กซี่ 1 เที่ยว 90 บาท', description: 'ค่าแท็กซี่', quantity: '1', totalAmount: '90', expenseCategoryId: 'cat-travel' },
      ] },
      lineMessageId: 'msg-two-categories', lineEventId: 'evt-two-categories',
    });
    assert.equal(creates[1].expenseCategoryId, undefined);
    assert.deepEqual(creates[1].lines.map((line: any) => line.expenseCategoryId), ['cat-meals', 'cat-travel']);
  });

  it('stores the chat hash so a later correction can only target this chat, never the raw id', async () => {
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'ค่ากาแฟ 65 บาท', captureHints: { confidence: 0.9, amount: '65', description: 'ค่ากาแฟ' },
      lineMessageId: 'msg-1', lineEventId: 'evt-1', chatKeyHash: 'hash-chat-1',
    });

    const metadata = updates.at(-1).sourceChannelMetadataJson;
    assert.equal(metadata.chatKeyHash, 'hash-chat-1');
    assert.equal(JSON.stringify(metadata).includes('U1234'), false);
  });

  it('omits chat provenance when the caller has none rather than inventing one', async () => {
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'ค่ากาแฟ 65 บาท', captureHints: { confidence: 0.9, amount: '65', description: 'ค่ากาแฟ' },
      lineMessageId: 'msg-2', lineEventId: 'evt-2',
    });

    assert.equal('chatKeyHash' in updates.at(-1).sourceChannelMetadataJson, false);
  });

  it('commits the consumed clarification with the draft, not after it', async () => {
    const seen: any[] = [];
    const { repo, deleted } = makeRepo({
      updateExpense: async (input: any, withinTx?: (tx: any) => Promise<void>) => {
        await withinTx?.({ outboxEvent: { create: async ({ data }: any) => { seen.push(data); } } });
        return { ...input, grandTotalAmount: '65.0000' };
      },
    });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'ค่ากาแฟ 65 บาท', captureHints: { confidence: 0.9, amount: '65', description: 'ค่ากาแฟ' },
      lineMessageId: 'msg-1', lineEventId: 'evt-1',
      consumption: { companyId: 'company-1', ledgerStreamKey: 'lineai:ledger:company-1:chat1', entryIds: ['7-0'], outcome: 'evidence_capture' },
    });

    assert.equal(seen.length, 1, 'the marker must be written inside the draft transaction');
    assert.equal(seen[0].eventType, 'ai.line.clarification.consumed');
  });

  it('rolls the draft back when the consumption marker cannot be written', async () => {
    const { repo, deleted } = makeRepo({
      updateExpense: async (_input: any, withinTx?: (tx: any) => Promise<void>) => {
        await withinTx?.({ outboxEvent: { create: async () => { throw new Error('marker_conflict'); } } });
        return { id: 'exp-1' };
      },
    });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await assert.rejects(() => useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'ค่ากาแฟ 65 บาท', captureHints: { confidence: 0.9, amount: '65', description: 'ค่ากาแฟ' },
      lineMessageId: 'msg-1', lineEventId: 'evt-1',
      consumption: { companyId: 'company-1', ledgerStreamKey: 'k', entryIds: ['7-0'], outcome: 'evidence_capture' },
    }), /marker_conflict/);
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0][1], 'exp-1');
    assert.ok(deleted[0][2] instanceof Date);
  });

  it('writes the initial continuation audit inside the draft update transaction even with nothing to consume', async () => {
    let receivedCallback: unknown = 'unset';
    const { repo } = makeRepo({
      updateExpense: async (input: any, withinTx?: unknown) => { receivedCallback = withinTx; return { ...input }; },
    });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'ค่ากาแฟ 65 บาท', captureHints: { confidence: 0.9, amount: '65', description: 'ค่ากาแฟ' },
      lineMessageId: 'msg-1', lineEventId: 'evt-1',
    });

    assert.equal(typeof receivedCallback, 'function');
  });

  it('refuses invented category ids and keeps them out of the draft', async () => {
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);
    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'ค่าอะไรก็ไม่รู้ 100 บาท',
      captureHints: { amount: '100', description: 'ค่าอะไรก็ไม่รู้', expenseCategoryId: 'cat-invented' },
      lineMessageId: 'msg-2',
      lineEventId: 'evt-2',
    });
    assert.equal(result.categoryId, null);
    assert.ok(result.warnings.includes('category_not_active'));
    assert.equal(updates.at(-1).aiVerificationSummaryJson.insertedFields.expenseCategoryId, undefined);
  });

  it('rejects a model capture route when amount or source-grounded purpose/category is missing', async () => {
    const calls: any[] = [];
    const { repo } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, {
      execute: async (...args: any[]) => { calls.push(args); return { id: 'must-not-exist' }; },
    } as any, audit, outbox);

    for (const [messageText, captureHints] of [
      ['รีบทำให้หน่อย', { amount: '590', expenseCategoryId: 'cat-meals' }],
      ['ยอด 590 บาท', { amount: '590' }],
      ['ค่ากาแฟวันนี้', { description: 'ค่ากาแฟ' }],
    ] as const) {
      await assert.rejects(
        () => useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
          draftConversationEnabled: true,
          messageText, captureHints, lineMessageId: `msg-${messageText}`, lineEventId: `evt-${messageText}`,
        }),
        LineTextExpenseCaptureIncompleteError,
      );
    }
    assert.equal(calls.length, 0, 'the final mutation boundary creates no draft');
  });

  it('accepts a grounded businessPurpose only when the route was verified as company-paid business spend', async () => {
    const { repo } = makeRepo();
    const creates: any[] = [];
    const useCase = new CaptureLineExpenseNoteUseCase(repo, {
      execute: async (_c: any, input: any) => {
        creates.push(input);
        return { id: 'exp-1', expenseCategoryId: null, grandTotalAmount: '60.0000', updatedAt: new Date('2026-08-18T00:00:00.000Z') };
      },
    } as any, audit, outbox);
    // The exact UAT message: the purpose is in businessPurpose, and nothing else grounds it.
    const cmd = {
      messageText: 'ค่ารถวิน 60 บาท ไปพบลูกค้า',
      captureHints: { amount: '60', businessPurpose: 'ไปพบลูกค้า' },
      lineMessageId: 'msg-purpose', lineEventId: 'evt-purpose',
    };

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), { ...cmd, semanticBusinessExpenseConfirmed: true });
    assert.equal(creates.length, 1);
    assert.equal(creates[0].lines[0].unitPrice, '60.0000');

    await assert.rejects(
      () => useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
        ...cmd, lineMessageId: 'msg-purpose-2', lineEventId: 'evt-purpose-2',
      }),
      LineTextExpenseCaptureIncompleteError,
    );
    assert.equal(creates.length, 1, 'without the semantic guard the same purpose creates nothing');
  });

  it('reports a typed amount conflict, in enum fields only, and creates nothing on either lane', async () => {
    const calls: any[] = [];
    const { repo } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, {
      execute: async (...args: any[]) => { calls.push(args); return { id: 'must-not-exist' }; },
    } as any, audit, outbox);

    await assert.rejects(
      () => useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
        draftConversationEnabled: true,
        semanticBusinessExpenseConfirmed: true,
        messageText: 'ค่าเดินทาง 200 บาท',
        groundingTexts: ['ค่ารถวิน 60 บาท'],
        captureHints: { amount: '200', description: 'ค่าเดินทาง' },
        lineMessageId: 'msg-conflict', lineEventId: 'evt-conflict',
      }),
      (error: unknown) => {
        assert.ok(error instanceof LineTextExpenseCaptureIncompleteError);
        assert.deepEqual(error.conflictingFields, ['amount']);
        assert.deepEqual(error.acceptedFields, ['description'], 'the grounded purpose is not asked for again');
        assert.deepEqual(error.missingFields, []);
        assert.equal(/60|200/.test(error.message), false, 'the typed error carries field names, never values or text');
        return true;
      },
    );
    assert.equal(calls.length, 0);
  });

  it('DEFAULT-OFF keeps the exact legacy gate: category-as-purpose captures, two amounts do not conflict', async () => {
    const { repo } = makeRepo();
    const creates: any[] = [];
    const useCase = new CaptureLineExpenseNoteUseCase(repo, {
      execute: async (_c: any, input: any) => {
        creates.push(input);
        return { id: 'exp-legacy', expenseCategoryId: 'cat-meals', grandTotalAmount: '65.0000', updatedAt: new Date('2026-08-18T00:00:00.000Z') };
      },
    } as any, audit, outbox);

    // No description at all: only the ACTIVE category name, found verbatim in the text, makes this
    // complete — the one legacy behaviour the semantic lane removes.
    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่าอาหาร 65 บาท',
      captureHints: { amount: '65', expenseCategoryId: 'cat-meals' },
      lineMessageId: 'msg-legacy-1', lineEventId: 'evt-legacy-1',
    });
    assert.equal(creates.length, 1, 'the legacy category-purpose capture still creates its draft');

    // And an amount carried by the resolved clarification beside a new one is still not a conflict off.
    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่าเดินทาง 200 บาท',
      groundingTexts: ['ค่ารถวิน 60 บาท'],
      captureHints: { amount: '200', description: 'ค่าเดินทาง' },
      lineMessageId: 'msg-legacy-2', lineEventId: 'evt-legacy-2',
    });
    assert.equal(creates.length, 2);
  });

  // Spec `line-ai-draft-control-spec-th.md` §5.2. `expenseDate` falls back to today when the note
  // named no date, and with the conversation off there is nobody asking for one — so the flag is
  // the only thing standing between a placeholder and a value that reads as a fact.
  it('flags an unstated date as missing, so today is never a silent answer', async () => {
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่าอาหาร 65 บาท',
      captureHints: { amount: '65', expenseCategoryId: 'cat-meals' },
      lineMessageId: 'msg-nodate', lineEventId: 'evt-nodate',
    });
    assert.ok(updates.at(-1).aiVerificationSummaryJson.missingFields.includes('expenseDate'));

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่าอาหาร 65 บาท วันที่ 1 ส.ค. 2569',
      captureHints: { amount: '65', expenseCategoryId: 'cat-meals', expenseDate: '2026-08-01' },
      lineMessageId: 'msg-dated', lineEventId: 'evt-dated',
    });
    assert.equal(updates.at(-1).aiVerificationSummaryJson.missingFields.includes('expenseDate'), false,
      'a date the note actually stated raises nothing');
  });

  it('DEFAULT-OFF reports NO typed fields, so the dispatcher asks the exact previous question', async () => {
    const { repo } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, {
      execute: async () => { throw new Error('must not create'); },
    } as any, audit, outbox);

    await assert.rejects(
      () => useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
        messageText: 'ค่ารถวิน 60 บาท ไปพบลูกค้า',
        captureHints: { amount: '60', businessPurpose: 'ไปพบลูกค้า' },
        lineMessageId: 'msg-legacy-3', lineEventId: 'evt-legacy-3',
      }),
      (error: unknown) => {
        assert.ok(error instanceof LineTextExpenseCaptureIncompleteError);
        assert.deepEqual(error.acceptedFields, []);
        assert.deepEqual(error.missingFields, []);
        assert.deepEqual(error.conflictingFields, []);
        return true;
      },
    );
  });

  it('fails closed on a clearly non-expense direction even when model hints look complete', async () => {
    const calls: any[] = [];
    const { repo } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, {
      execute: async (...args: any[]) => { calls.push(args); return { id: 'must-not-exist' }; },
    } as any, audit, outbox);

    await assert.rejects(
      () => useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
        draftConversationEnabled: true,
        messageText: 'รับเงินค่าสินค้าจากลูกค้า 590 บาท',
        captureHints: { confidence: 0.99, amount: '590', description: 'ค่าสินค้า', expenseCategoryId: 'cat-meals' },
        lineMessageId: 'income-msg', lineEventId: 'income-evt',
      }),
      LineTextExpenseCaptureIncompleteError,
    );
    assert.equal(calls.length, 0);
  });

  it('UAT2 W1: a purpose-only clarification cannot open a new expense from an earlier request amount', async () => {
    const { repo } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, { execute: async () => assert.fail('continue or clarify the task without creating a junk expense') } as any, audit, outbox);
    await assert.rejects(() => useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'เป็นค่าเดินทาง',
      groundingTexts: ['ยอด 200 บาท'],
      captureHints: { confidence: 0.9, amount: '200', description: 'ค่าเดินทาง', expenseCategoryId: 'cat-travel' },
      lineMessageId: 'msg-follow-up', lineEventId: 'evt-follow-up',
    }), LineTextExpenseCaptureIncompleteError);
  });

  it('is idempotent by LINE message id', async () => {
    const existing = { id: 'existing-1', companyId: 'company-1', createdByUserId: 'user-1',
      captureSource: 'LINE_UPLOAD', branchId: null, grandTotalAmount: '65.0000', expenseCategoryId: null };
    const { repo } = makeRepo({ findByLineMessageId: async () => existing, findByIdWithRelations: async () => existing });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);
    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'ค่ากาแฟ 65 บาท', lineMessageId: 'msg-1', lineEventId: 'evt-1',
    });
    assert.equal(result.expense.id, 'existing-1');
    assert.ok(result.warnings.includes('duplicate_line_message'));
  });

  it('refuses duplicate-message evidence outside the current record scope without creating or updating', async () => {
    const original = { id: 'existing-1', companyId: 'company-1', createdByUserId: 'user-1', captureSource: 'LINE_UPLOAD',
      branchId: 'branch-1', sourceChannelMetadataJson: { chatKeyHash: 'chat-original' } };
    for (const changed of [null, { companyId: 'foreign' }, { createdByUserId: 'foreign' }, { captureSource: 'WEB' },
      { branchId: 'branch-other' }, { sourceChannelMetadataJson: { chatKeyHash: 'foreign' } }]) {
      const { repo, updates } = makeRepo({ findByLineMessageId: async () => original,
        findByIdWithRelations: async (companyId: string, id: string, _tx: unknown, scopes: unknown) => {
          assert.equal(companyId, 'company-1'); assert.equal(id, original.id); assert.deepEqual(scopes, { branchIds: ['branch-1'] });
          return changed === null ? null : { ...original, ...changed };
        } });
      const useCase = new CaptureLineExpenseNoteUseCase(repo, { execute: async () => assert.fail('must not recapture') } as any, audit, outbox);
      await assert.rejects(() => useCase.execute({ ...ctx(['expense.receipt.line_upload'], 'line'), scopes: { branchIds: ['branch-1'] } }, {
        messageText: 'ค่ากาแฟ 65 บาท', lineMessageId: 'msg-1', lineEventId: 'evt-1', chatKeyHash: 'chat-original',
      }), /outside current ownership or chat/);
      assert.equal(updates.length, 0);
    }
  });

  it('a duplicate text capture formats the current saved header rather than stale questionnaire memory', async () => {
    const revision = new Date('2026-09-15T00:00:00Z');
    const state = buildInitialLineExpenseDraftContinuation({ workflowId: 'wf-original', companyId: 'company-1', userId: 'user-1',
      expenseId: 'existing-1', chatKeyHash: 'chat-original', targetRevision: revision.toISOString(), provisionalExpenseDate: '2026-09-14',
      messageText: 'ร้านเก่า กาแฟ 65 บาท', hints: { vendorName: 'ร้านเก่า', amount: '65' }, categories: [] });
    const original = { id: 'existing-1', companyId: 'company-1', createdByUserId: 'user-1', captureSource: 'LINE_UPLOAD',
      branchId: null, status: 'DRAFT', grandTotalAmount: '65', expenseCategoryId: null, updatedAt: new Date(revision.getTime() + 1000),
      vendorNameSnapshot: 'ร้านแก้ไขจากเว็บ', expenseDate: new Date('2026-09-15T00:00:00Z'), note: null, lines: [],
      sourceChannelMetadataJson: { chatKeyHash: 'chat-original', lineExpenseDraftContinuation: state } };
    const { repo, updates } = makeRepo({ findByLineMessageId: async () => original, findByIdWithRelations: async () => original });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, { execute: async () => assert.fail('must not recapture') } as any, audit, outbox);
    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ร้านเก่า กาแฟ 65 บาท', lineMessageId: 'msg-1', lineEventId: 'evt-1', chatKeyHash: 'chat-original', draftConversationEnabled: true,
    });
    assert.match(result.replyTexts.join('\n'), /ร้านแก้ไขจากเว็บ/); assert.doesNotMatch(result.replyTexts.join('\n'), /ร้าน: ร้านเก่า/);
    assert.equal(result.expense.updatedAt, original.updatedAt); assert.equal(updates.length, 0);
    assert.equal(state.header.vendorName, 'ร้านเก่า', 'read-only refresh cannot rewrite the persisted original questionnaire');
    for (const key of ['companyId', 'expenseId']) {
      original.sourceChannelMetadataJson.lineExpenseDraftContinuation = { ...state, [key]: 'foreign' };
      const foreign = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
        messageText: 'ร้านเก่า กาแฟ 65 บาท', lineMessageId: 'msg-1', lineEventId: 'evt-1', chatKeyHash: 'chat-original', draftConversationEnabled: true,
      });
      assert.deepEqual(foreign.replyTexts, [], 'foreign questionnaire facts cannot be borrowed for the owned expense');
    }
  });

  it('denies capture without upload permission', async () => {
    const { repo } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);
    await assert.rejects(
      () => useCase.execute(ctx(['line.ai.query'], 'line'), { messageText: 'x', lineMessageId: 'm', lineEventId: 'e' }),
      /expense.receipt.line_upload/,
    );
  });
});

describe('expense category management', () => {
  it('creates, updates, and archives company categories with expense.category.manage', async () => {
    const created: any[] = [];
    const updated: any[] = [];
    const repo = {
      createCategory: async (_companyId: string, input: any) => { created.push(input); return { id: 'cat-1', ...input, companyId: 'company-1', status: 'ACTIVE', sortOrder: 0, taxCategory: null, inputVatDefault: 'NON_CLAIMABLE' }; },
      findCategoryById: async () => ({ id: 'cat-1', companyId: 'company-1', name: 'old', status: 'ACTIVE' }),
      updateCategory: async (_companyId: string, id: string, input: any) => { updated.push({ id, ...input }); return { id, companyId: 'company-1', name: input.name ?? 'old', accountHintKey: 'x', taxCategory: null, inputVatDefault: 'NON_CLAIMABLE', status: input.status ?? 'ACTIVE', sortOrder: 0 }; },
      listAllCategories: async () => [{ id: 'cat-1' }, { id: 'global-1' }],
    } as any;

    const create = new CreateExpenseCategoryUseCase(repo, audit);
    const category = await create.execute(ctx(['expense.category.manage']), { name: ' ค่าโฆษณาออนไลน์ ', accountHintKey: 'expense.marketing' });
    assert.equal(category.name, 'ค่าโฆษณาออนไลน์');

    const update = new UpdateExpenseCategoryUseCase(repo, audit);
    const archived = await update.execute(ctx(['expense.category.manage']), 'cat-1', { status: 'ARCHIVED' });
    assert.equal(archived.status, 'ARCHIVED');

    const listAll = new ListAllExpenseCategoriesUseCase(repo);
    assert.equal((await listAll.execute(ctx(['expense.category.manage']))).length, 2);
  });

  it('denies category admin without the manage permission and blocks global defaults', async () => {
    const repo = { findCategoryById: async () => null } as any;
    const create = new CreateExpenseCategoryUseCase(repo, audit);
    await assert.rejects(() => create.execute(ctx(['expense.review']), { name: 'x', accountHintKey: 'y' }), /expense.category.manage/);
    const update = new UpdateExpenseCategoryUseCase(repo, audit);
    await assert.rejects(() => update.execute(ctx(['expense.category.manage']), 'global-cat', { name: 'y' }), /read-only|not found/i);
  });
});

describe('signature asset lifecycle', () => {
  const currentSignatureAccess = {resolveAccess: async () => ctx(['expense.signature.self_manage'])} as any;
  const completeUpload = { execute: async () => undefined } as any;

  /** Bytes big enough to bust the certify budget: uniform colour compresses to nothing, so the
   *  source has to be noise. Built once — three cases share it, and each build is a 6 MB raw
   *  buffer plus sharp's own working set. */
  let noisyFixture: Promise<Buffer> | undefined;
  function noisyJpeg(): Promise<Buffer> {
    noisyFixture ??= (async () => {
      const width = 1700;
      const height = 1300;
      const raw = Buffer.allocUnsafe(width * height * 3);
      for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 2654435761) % 256;
      return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
    })();
    return noisyFixture;
  }

  /**
   * A signature-shaped photo: paper with dark ink through the middle.
   *
   * `paper` defaults to the WARM cast a real phone shot has under indoor light — a blue-channel
   * deficit. That is the case a per-channel rule gets wrong: normalising the colour image applies
   * one shared scale, the blue channel stays low, and an all-three-channels test lets blue alone
   * decide, erasing next to nothing. Noise is on by default for the same reason: a perfectly flat
   * fixture passes rules that real photos defeat.
   */
  async function inkOnPaper(paper: [number, number, number] = [246, 247, 236], noise = 6): Promise<Buffer> {
    const width = 400;
    const height = 200;
    const raw = Buffer.allocUnsafe(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const ink = y > 90 && y < 110;
        const jitter = noise ? ((((x * 7919) + (y * 104729)) % (noise * 2)) - noise) : 0;
        const offset = ((y * width) + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          const base = ink ? 22 : paper[channel]!;
          raw[offset + channel] = Math.max(0, Math.min(255, base + jitter));
        }
      }
    }
    return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  }

  /** Share of fully transparent pixels, and whether the ink band survived. */
  async function alphaProfile(png: Buffer) {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let clear = 0;
    for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
      if (data[(pixel * info.channels) + 3] === 0) clear += 1;
    }
    const alphaAt = (x: number, y: number) => data[(((y * info.width) + x) * info.channels) + 3]!;
    return { transparentShare: clear / (info.width * info.height), alphaAt, info };
  }

  function makeSigRepo(status = 'ACTIVE', options: { sourceBytes?: Buffer; submittedByUserId?: string } = {}) {
    const updates: any[] = [];
    const created: any[] = [];
    const generated: any[] = [];
    const links: any[] = [];
    const listed: any[] = [];
    let row: any = { id: 'sig-1', status, submittedByUserId: options.submittedByUserId ?? 'uploader-1' };
    return {
      updates,
      created,
      generated,
      links,
      listed,
      repo: {
        findSignatureAssetByLineMessageId: async () => null,
        createSignatureAsset: async (input: any) => { created.push(input); row = { id: 'sig-1', ...input }; return row; },
        linkAttachmentToTarget: async (...args: any[]) => { links.push(args); },
        findSignatureAssetById: async () => row,
        // Returns the row as it stands after the write, exactly like the real update.
        updateSignatureAsset: async (_c: string, id: string, data: any) => { updates.push(data); row = { ...row, id, ...data }; return row; },
        createSignatureFill: async (input: any) => ({ id: 'fill-1', appliedAt: new Date(), ...input }),
        findById: async () => ({ id: 'exp-1', status: 'NEEDS_REVIEW' }),
        findByIdWithRelations: async () => ({ id: 'exp-1', status: 'NEEDS_REVIEW' }),
        linkAttachment: async () => undefined,
        findActiveMemberIdentity: async () => ({ userId: 'user-1', displayName: 'สมชาย ใจดี' }),
        // Absent bytes means "not an image the transform can read": the derive is skipped, which is
        // the shape most of these lifecycle assertions want.
        findActiveAttachmentObject: async () => options.sourceBytes
          ? { bucket: 'b', objectKey: 'k', mimeType: 'image/jpeg', checksumSha256: null, byteSize: options.sourceBytes.byteLength, originalFileName: 'sig.jpg' }
          : null,
        createGeneratedSignatureAttachment: async (input: any) => { generated.push(input); return 'att-derived'; },
        listSignatureAssets: async (...args: any[]) => { listed.push(args); return []; },
      } as any,
      storage: {
        getObject: async () => ({ bytes: options.sourceBytes ?? Buffer.alloc(0) }),
        putObject: async (input: any) => ({
          bucket: 'b', objectKey: input.objectKey, storageProvider: 'local',
          byteSize: input.bytes.byteLength, checksumSha256: 'sum', objectVersionId: 'v1',
        }),
        createDownloadUrl: async () => ({ url: 'https://signed.example/sig.png', expiresAt: new Date() }),
      } as any,
    };
  }

  it('does not activate a personal signature after storage when membership or capability has changed', async () => {
    for (const fault of ['permission', 'member', 'membership-version']) {
      const h = makeSigRepo(); let stored = false;
      const resolver = { resolveAccess: async () => ({ ...ctx(stored && fault === 'permission' ? [] : ['expense.review']),
        membershipId: stored && fault === 'membership-version' ? 'new-membership' : 'mem-1' }) } as any;
      const identity = h.repo.findActiveMemberIdentity;
      h.repo.findActiveMemberIdentity = async (...args: any[]) => stored && fault === 'member' ? null : identity(...args);
      const create = new CreateSignatureAssetUseCase(h.repo, {execute: async () => {stored = true;}} as any, audit, h.storage, resolver);
      await assert.rejects(() => create.execute(ctx(['expense.review']), {attachmentId:'att-1'}), /permission|access changed/);
      assert.equal(stored, true); assert.equal(h.created.length, 0); assert.equal(h.links.length, 0);
    }
  });

  it('checks the internal LINE source after storage and refuses another submitter on replay', async () => {
    const h = makeSigRepo(); let stored = false, checked = 0;
    const create = new CreateSignatureAssetUseCase(h.repo, {execute: async () => {stored = true;}} as any, audit, h.storage, currentSignatureAccess);
    await assert.rejects(() => create.execute(ctx(['expense.review'], 'line'), {attachmentId:'att-1'}, {beforeCommit: async () => {
      checked++; assert.equal(stored, true); throw new Error('original LINE identity changed');
    }}), /original LINE identity changed/);
    assert.equal(checked, 1); assert.equal(h.created.length, 0); assert.equal(h.links.length, 0);
    h.repo.findSignatureAssetByLineMessageId = async () => ({id:'foreign-sig',submittedByUserId:'another-user',status:'ACTIVE'});
    await assert.rejects(() => create.execute(ctx(['expense.review'], 'line'), {attachmentId:'att-1',lineMessageId:'original'}), /another owner/);
    assert.equal(h.created.length, 0);
  });

  it('creates ACTIVE assets and is idempotent by LINE message id', async () => {
    const { repo, storage } = makeSigRepo();
    const useCase = new CreateSignatureAssetUseCase(repo, completeUpload, audit, storage, currentSignatureAccess);
    const asset = await useCase.execute(ctx(['expense.signature.manage'], 'line'), {
      attachmentId: 'att-1', submittedFromChannel: 'LINE', lineMessageId: 'msg-1',
    });
    assert.equal(asset.status, 'ACTIVE');

    repo.findSignatureAssetByLineMessageId = async () => ({ id: 'sig-existing', status: 'ACTIVE', submittedByUserId: 'user-1' });
    const again = await useCase.execute(ctx(['expense.signature.manage'], 'line'), {
      attachmentId: 'att-2', submittedFromChannel: 'LINE', lineMessageId: 'msg-1',
    });
    assert.equal(again.id, 'sig-existing');
  });

  // Owner decision 2026-08-20: the acts of signing are what authorise keeping a signature. A payer
  // holding only `expense.review` used to be refused outright, which is the F8 dead end at its root.
  it('accepts personal self-service, either signing act, or the legacy manage grant, and refuses anyone else', async () => {
    for (const permission of ['expense.signature.self_manage', 'expense.review', 'expense.confirm', 'expense.signature.manage']) {
      const { repo, storage } = makeSigRepo();
      const asset = await new CreateSignatureAssetUseCase(repo, completeUpload, audit, storage, currentSignatureAccess)
        .execute(ctx([permission]), { attachmentId: 'att-1' });
      assert.equal(asset.status, 'ACTIVE', permission);
    }
    const denied = makeSigRepo();
    await assert.rejects(
      () => new CreateSignatureAssetUseCase(denied.repo, completeUpload, audit, denied.storage, currentSignatureAccess)
        .execute(ctx(['expense.read', 'expense.signature.approve']), { attachmentId: 'att-1' }),
      /expense.signature.manage/,
    );
  });

  // A13: the read above loses the race under redelivery, so the unique index has to be the one that
  // decides — and losing it must return the winner rather than surface a Prisma error in LINE.
  it('returns the winning asset when the unique index rejects a raced LINE redelivery', async () => {
    const { repo, storage } = makeSigRepo();
    repo.createSignatureAsset = async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); };
    let lookups = 0;
    repo.findSignatureAssetByLineMessageId = async () => (lookups++ === 0 ? null : { id: 'sig-winner', status: 'ACTIVE', submittedByUserId: 'user-1' });
    const useCase = new CreateSignatureAssetUseCase(repo, completeUpload, audit, storage, currentSignatureAccess);
    const asset = await useCase.execute(ctx(['expense.signature.manage'], 'line'), {
      attachmentId: 'att-1', submittedFromChannel: 'LINE', lineMessageId: 'msg-1',
    });
    assert.equal(asset.id, 'sig-winner');

    // A web asset carries no lineMessageId, so a P2002 there is a real fault and must still throw.
    repo.createSignatureAsset = async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); };
    await assert.rejects(() => useCase.execute(ctx(['expense.signature.manage']), { attachmentId: 'att-2' }), /unique/);
  });

  // Owner decision 2026-08-20 (superseding D10/D11) + A14. Staff and owner land in exactly the same
  // place, which is the whole point: a signature is personal, so nobody is waiting on anybody.
  it('activates every signature at creation, by its own submitter, with no approval row', async () => {
    for (const permissions of [['expense.signature.manage', 'expense.signature.approve'], ['expense.review']]) {
      const harness = makeSigRepo();
      const audits: any[] = [];
      const asset = await new CreateSignatureAssetUseCase(
        harness.repo, completeUpload, { log: async (entry: any) => { audits.push(entry); } } as any, harness.storage, currentSignatureAccess,
      ).execute(ctx(permissions, 'line'), { attachmentId: 'att-1', submittedFromChannel: 'LINE' });

      assert.equal(asset.status, 'ACTIVE', permissions.join('+'));
      assert.equal(harness.created[0].status, 'ACTIVE');
      assert.equal(harness.created[0].approvedByUserId, 'user-1', 'activated by the person whose signature it is');
      assert.ok(harness.created[0].approvedAt instanceof Date);
      // A14: a LINE asset used to arrive with no label at all. The name it is given is read by its
      // owner in the signature list, so its date is the Thai short date of every other screen
      // (2 ต.ค. 2569, Buddhist era), not the machine form the owner reported on 2026-10-02.
      assert.match(harness.created[0].label, /^สมชาย ใจดี \d{1,2} (ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.) 25\d{2}$/);
      assert.doesNotMatch(harness.created[0].label, /\d{4}-\d{2}-\d{2}/);
      // One row, and it is not an approval: there is no second party to record.
      assert.deepEqual(audits.map((entry) => entry.action), ['expense.signature.create']);
      assert.equal(audits[0].metadataJson.activationMode, 'personal');
      assert.equal(audits[0].metadataJson.status, 'ACTIVE');
    }

    const labelled = makeSigRepo();
    await new CreateSignatureAssetUseCase(labelled.repo, completeUpload, audit, labelled.storage, currentSignatureAccess)
      .execute(ctx(['expense.confirm'], 'line'), { attachmentId: 'att-1', label: 'ลายเซ็นพนักงาน', submittedFromChannel: 'LINE' });
    assert.equal(labelled.created[0].label, 'ลายเซ็นพนักงาน');
  });

  // A5 + A9: one server-side pass fixes both the alpha channel LINE JPEG never had and the size
  // certification refuses, and it lands as the derived half of the same two-attachment shape the
  // web canvas produces — without demoting the asset it was just created with.
  it('derives a transparent, under-budget image at creation and leaves the new asset usable', async () => {
    const oversized = await noisyJpeg();
    assert.ok(oversized.byteLength > SIGNATURE_MAX_BYTES, 'fixture must exceed the certify budget');
    const { repo, storage, updates, generated } = makeSigRepo('ACTIVE', { sourceBytes: oversized });
    const asset = await new CreateSignatureAssetUseCase(repo, completeUpload, audit, storage, currentSignatureAccess)
      .execute(ctx(['expense.signature.manage'], 'line'), { attachmentId: 'att-raw', submittedFromChannel: 'LINE' });

    assert.equal(generated.length, 1);
    assert.ok(generated[0].byteSize <= SIGNATURE_MAX_BYTES, `derived render is ${generated[0].byteSize} bytes`);
    assert.ok(['image/png', 'image/jpeg'].includes(generated[0].mimeType));
    assert.equal(updates.at(-1).derivedAttachmentId, 'att-derived');
    // Only the derivative is written; the status the asset was created with is never touched again.
    assert.equal(updates.at(-1).status, undefined);
    assert.equal(asset.status, 'ACTIVE');
  });

  // F3: the case a per-channel rule silently fails. A warm phone photo keeps its blue deficit
  // through a shared-scale normalise, so an all-three-channels test erased ~0.1% of the paper and
  // the certificate still got an opaque white rectangle.
  it('clears warm-cast paper and keeps the ink, and does the same for neutral paper', async () => {
    for (const [label, paper] of [
      ['warm cast (blue-deficient), noisy', [246, 247, 236]],
      ['neutral, noisy', [244, 244, 244]],
    ] as Array<[string, [number, number, number]]>) {
      const cleaned = await normalizeSignatureImage(await inkOnPaper(paper), 'image/jpeg', { removeBackground: true });
      assert.equal(cleaned?.mimeType, 'image/png', label);
      const { transparentShare, alphaAt, info } = await alphaProfile(cleaned!.bytes);
      assert.ok(transparentShare >= 0.8, `${label}: only ${(transparentShare * 100).toFixed(1)}% transparent`);
      assert.equal(alphaAt(2, 2), 0, `${label}: paper must become transparent`);
      assert.equal(alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2)), 255, `${label}: ink must survive`);
    }

    const opaque = await normalizeSignatureImage(await inkOnPaper(), 'image/jpeg', { removeBackground: false });
    assert.equal(opaque?.mimeType, 'image/jpeg');
    assert.equal(await normalizeSignatureImage(Buffer.from('not an image'), 'image/jpeg', { removeBackground: true }), undefined);
  });

  // F4: an alpha PNG of a noisy photo can exceed the certify budget at every edge. Storing it would
  // point the reusable-signature lookup at an image certification refuses outright, in preference
  // to the original it would have accepted.
  it('never returns a render the certify gate would refuse, and falls back to the opaque encode', async () => {
    const noisy = await noisyJpeg();
    const transparent = await normalizeSignatureImage(noisy, 'image/jpeg', { removeBackground: true });
    assert.equal(transparent, undefined, 'an over-budget alpha PNG must not be returned');
    const fallback = await normalizeSignatureImage(noisy, 'image/jpeg', { removeBackground: false });
    assert.ok(fallback && fallback.bytes.byteLength <= SIGNATURE_MAX_BYTES, 'the opaque encode is the way under budget');
    assert.equal(fallback!.mimeType, 'image/jpeg');
  });

  // F5: the web canvas shows the user both renditions and posts its own derived PNG. Deriving here
  // too burns a second sharp pass on an attachment the client overwrites — and overrides a user who
  // looked at the preview and chose to keep the background.
  it('derives only for LINE; the web client owns that decision on its own channel', async () => {
    const photo = await inkOnPaper();
    for (const [channel, expected] of [['WEB', 0], ['LINE', 1]] as Array<['WEB' | 'LINE', number]>) {
      const harness = makeSigRepo('ACTIVE', { sourceBytes: photo });
      await new CreateSignatureAssetUseCase(harness.repo, completeUpload, audit, harness.storage, currentSignatureAccess)
        .execute(ctx(['expense.signature.manage']), { attachmentId: 'att-raw', submittedFromChannel: channel });
      assert.equal(harness.generated.length, expected, `${channel} derive count`);
    }
  });

  it('lets only the signature owner archive it, regardless of elevated role permissions', async () => {
    const own = makeSigRepo('ACTIVE', { submittedByUserId: 'user-1' });
    const ownAudits: any[] = [];
    await new ArchiveSignatureAssetUseCase(own.repo, { log: async (entry: any) => { ownAudits.push(entry); } } as any)
      .execute(ctx(['expense.review']), 'sig-1');
    assert.equal(own.updates.at(-1).status, 'ARCHIVED');
    assert.ok(own.updates.at(-1).archivedAt instanceof Date);
    assert.equal(ownAudits[0].metadataJson.submittedByUserId, 'user-1');

    const other = makeSigRepo('ACTIVE', { submittedByUserId: 'uploader-1' });
    await assert.rejects(
      () => new ArchiveSignatureAssetUseCase(other.repo, audit).execute(ctx(['expense.review', 'expense.confirm']), 'sig-1'),
      /only archive your own signature/,
    );
    assert.deepEqual(other.updates, [], 'a refused archive writes nothing');

    const keeper = makeSigRepo('ACTIVE', { submittedByUserId: 'uploader-1' });
    await assert.rejects(
      () => new ArchiveSignatureAssetUseCase(keeper.repo, audit).execute(ctx(['expense.signature.manage']), 'sig-1'),
      /only archive your own signature/,
    );
    assert.deepEqual(keeper.updates, []);

    const stranger = makeSigRepo('ACTIVE');
    await assert.rejects(
      () => new ArchiveSignatureAssetUseCase(stranger.repo, audit).execute(ctx(['expense.read']), 'sig-1'),
      /expense.signature.manage/,
    );
  });

  it('queries and returns only the caller’s own signatures even for a manage holder', async () => {
    const { repo } = makeSigRepo();
    const audits: any[] = [];
    const listArgs: any[] = [];
    const auditing = { log: async (entry: any) => { audits.push(entry); } } as any;
    repo.listSignatureAssets = async (...args: any[]) => {
      listArgs.push(args);
      return args[1] === 'user-1'
        ? [{ id: 'sig-mine', status: 'ACTIVE', submittedByUserId: 'user-1', originalAttachmentId: 'att-1', derivedAttachmentId: 'att-derived' }]
        : [{ id: 'sig-theirs', status: 'ACTIVE', submittedByUserId: 'uploader-1', originalAttachmentId: 'att-2', derivedAttachmentId: null }];
    };
    repo.findActiveAttachmentObject = async (_c: string, id: string) => ({ bucket: 'b', objectKey: id, mimeType: 'image/png', checksumSha256: null, byteSize: 10, originalFileName: 'x.png' });
    const useCase = new ListSignatureAssetsUseCase(repo, auditing);

    const keeper = await useCase.execute(ctx(['expense.signature.manage']));
    // Same-origin through this API, not a raw presigned storage URL: Chrome's ORB blocks the latter
    // in <img src>, which is why the saved signature never rendered and the signer certified blind.
    assert.equal(keeper[0]!.previewUrl, '/api/v1/companies/company-1/expense-signatures/images/att-derived', 'own row keeps its picture');
    assert.equal(keeper[0]!.originalAttachmentId, 'att-1', 'own row still names its own bytes');
    assert.equal(keeper[0]!.derivedAttachmentId, 'att-derived');
    assert.equal(keeper.some((asset) => asset.id === 'sig-theirs'), false);
    // F6: this path skips the audited generic download gate, so it writes its own row — naming the
    // asset and the attachment, never the URL or its token.
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'expense.signature.preview_url.create');
    assert.equal(audits[0].targetId, 'sig-mine');
    assert.equal(audits[0].metadataJson.attachmentId, 'att-derived');
    assert.equal(JSON.stringify(audits[0]).includes('signed.example'), false);
    assert.equal(listArgs[0][1], 'user-1');

    // Every accepted grant narrows the query itself to the caller: other people's rows are not
    // filtered out of a response; they are never read.
    const signer = await useCase.execute(ctx(['expense.review']));
    assert.equal(listArgs[1][1], 'user-1');
    assert.equal(signer.some((asset) => asset.id === 'sig-theirs'), false);

    await assert.rejects(() => useCase.execute(ctx(['expense.read', 'expense.signature.approve'])), /expense.signature.manage/);
  });

  it('serves the preview bytes itself, owner-only, with a real image type', async () => {
    // W1: the panel used to bind a raw presigned storage URL into <img src>, which Chrome's ORB
    // refuses cross-origin — a broken-image icon on every surface, so the signer certified blind.
    const pinned: any[] = [];
    const repo = {
      findReusableSignatureAsset: async (companyId: string, userId: string, attachmentId?: string) => {
        pinned.push([companyId, userId, attachmentId]);
        return userId === 'user-1'
          ? { id: attachmentId, bucket: 'b', objectKey: 'k', mimeType: 'image/png', originalFileName: 'sig.png' }
          : null;
      },
    } as any;
    const storage = { getObject: async () => ({ bytes: Buffer.from('png-bytes') }) } as any;
    const useCase = new GetSignatureImageUseCase(repo, storage);

    const served = await useCase.execute(ctx(['expense.review']), 'att-1');
    assert.equal(served.mimeType, 'image/png', 'an image content type is what keeps it usable in <img src>');
    assert.equal(served.fileName, 'sig.png');
    assert.equal(served.bytes.toString(), 'png-bytes');
    // The lookup IS the authorization: pinned to one attachment AND to this caller's own assets.
    assert.deepEqual(pinned[0], ['company-1', 'user-1', 'att-1']);

    // Somebody else's signature bytes are simply not there for this caller.
    await assert.rejects(
      () => useCase.execute({ ...ctx(['expense.review']), userId: 'other-user' }, 'att-1'),
      /not found/i,
    );
    await assert.rejects(() => useCase.execute(ctx(['expense.read']), 'att-1'), /Missing permission/);
  });

  it('refuses a web signature upload the certify gate could never accept', async () => {
    // W2: only LINE gets downscaled, so a 3 MB web upload landed in the library and then failed at
    // the 2 MB certify cap — at the moment of signing, which is the worst possible moment.
    const intents: any[] = [];
    const useCase = new InitSignatureUploadUseCase({ execute: async (_c: any, cmd: any) => { intents.push(cmd); return { attachmentId: 'att-1' }; } } as any);
    await assert.rejects(
      () => useCase.execute(ctx(['expense.review']), { originalFileName: 'big.png', mimeType: 'image/png', byteSize: 3_000_000 }),
      /2 MB/,
    );
    assert.equal(intents.length, 0, 'nothing is reserved for a file that can never sign');
    await useCase.execute(ctx(['expense.review']), { originalFileName: 'ok.png', mimeType: 'image/png', byteSize: SIGNATURE_MAX_BYTES });
    assert.equal(intents.length, 1, 'exactly at the cap is still fine');
  });

  it('fill requires web channel, review permission, ownership, and an ACTIVE signature', async () => {
    const archived = makeSigRepo('ARCHIVED', { submittedByUserId: 'user-1' });
    const fillArchived = new FillSignatureUseCase(archived.repo, completeUpload, audit, new GetExpenseUseCase(archived.repo));
    await assert.rejects(
      () => fillArchived.execute(ctx(['expense.review']), 'exp-1', { signatureAssetId: 'sig-1' }),
      /ACTIVE signatures/,
    );

    // The binding the module header claims every lookup enforces. Without it any `expense.review`
    // holder could sign a document with somebody else's ink, and with approval removed a signature
    // is fillable the instant it is saved.
    const theirs = makeSigRepo('ACTIVE', { submittedByUserId: 'other-user' });
    await assert.rejects(
      () => new FillSignatureUseCase(theirs.repo, completeUpload, audit, new GetExpenseUseCase(theirs.repo))
        .execute(ctx(['expense.review']), 'exp-1', { signatureAssetId: 'sig-1' }),
      /only apply your own signature/,
    );

    const active = makeSigRepo('ACTIVE', { submittedByUserId: 'user-1' });
    const fill = new FillSignatureUseCase(active.repo, completeUpload, audit, new GetExpenseUseCase(active.repo));
    await assert.rejects(
      () => fill.execute(ctx(['expense.review'], 'line'), 'exp-1', { signatureAssetId: 'sig-1' }),
      /web-only/,
    );
    const result = await fill.execute(ctx(['expense.review']), 'exp-1', { signatureAssetId: 'sig-1', placeholder: 'reviewer' });
    assert.equal(result.fillId, 'fill-1');
  });
});

describe('GetSharedEvidenceViewUseCase', () => {
  it('rejects an explicit branch outside the caller scope before reading or exporting', async () => {
    const scoped = { ...ctx(['expense.evidence.read', 'expense.export', 'expense.read']), scopes: { branchIds: ['b1'] } };
    await assert.rejects(() => new GetSharedEvidenceViewUseCase({} as any).execute(scoped, { branchId: 'b2' }), /branch/i);
    await assert.rejects(() => new CreateAccountantPackageUseCase({} as any, {} as any, audit, {} as any, {} as any, {} as any).execute(scoped, { branchId: 'b2' }), /branch/i);
  });
  const repo = {
    summarizeSharedEvidenceFolders: async () => [],
    listSharedEvidence: async () => ({ rows: [], total: 0, page: 1, pageSize: 20 }),
  } as any;

  it('uses the dedicated evidence permission independently of expense.read', async () => {
    const useCase = new GetSharedEvidenceViewUseCase(repo);
    const result = await useCase.execute(ctx(['expense.evidence.read']), {});
    assert.deepEqual(result.rows, []);
    assert.equal(result.dateField, 'expenseDate');
    await assert.rejects(() => useCase.execute(ctx(['expense.read']), {}), /expense.evidence.read/);
  });
});

function accountantDb(db: any) {
  return { whtCertificate: { findMany: async () => [] }, expenseRecord: { findMany: async () => [] }, whtFilingLine: { findMany: async () => [] }, taxPeriod: { findMany: async () => [] },
    whtIncomeCategory: { findMany: async () => [] }, disbursementVoucherLine: { findMany: async () => [] }, attachmentLink: { findMany: async () => [] },
    whtCertificateHandoff: { findMany: async () => [] }, ...db, branch: { count: async () => 1, ...db.branch } };
}

describe('accountant-v2 scoped reads and filing coverage', () => {
  function workbook(file: Buffer) {
    const parts = new Map<string, string>();
    for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
      const size = file.readUInt32LE(offset + 18), length = file.readUInt16LE(offset + 26);
      const start = offset + 30 + length + file.readUInt16LE(offset + 28), data = file.subarray(start, start + size);
      parts.set(file.subarray(offset + 30, offset + 30 + length).toString(), (file.readUInt16LE(offset + 8) === 8 ? inflateRawSync(data) : data).toString()); offset = start + size;
    }
    return [...parts.values()].join('');
  }
  function fixture(options: { legacyFiled?: boolean; moved?: boolean; locked?: boolean; invalid?: boolean; open?: boolean; external?: boolean; split?: boolean; unknown?: boolean; foreign?: boolean } = {}) {
    const context = { ...ctx(['expense.read', 'expense.export', 'attachment.read', 'wht.certificate.read']), scopes: { branchIds: ['b1'] } };
    const rows = ['A', 'B', 'C'].map(id => ({ id, companyId: context.companyId, branchId: id === 'C' ? 'b2' : 'b1', status: 'CONFIRMED', expenseNumber: `EXP-${id}`,
      expenseDate: new Date('2026-09-01'), uploadedAt: new Date('2026-09-01'), sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'USABLE_FOR_TAX', currency: 'USD',
      vendorNameSnapshot: 'ผู้ขาย', attachments: [{ id: `receipt-${id}`, purpose: 'expense.receipt.primary', originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 1, status: 'ACTIVE' }] }));
    const paid = options.moved ? '2026-11-02' : '2026-10-02';
    const live = rows.map(row => ({ id: row.id, companyId: row.companyId, branchId: row.branchId, expenseDate: new Date(paid), paymentId: `p-${row.id}`, sourceLineKey: `payment:p-${row.id}`,
      documentDate: row.expenseDate, grossAmount: '500', whtAmount: '15', whtRate: '3', vendorName: 'ผู้รับเงิน', vendorTaxId: options.invalid ? null : '1234567890123',
      vendorAddress: 'ที่อยู่ปัจจุบัน', vendorBranchCode: '00000', payeeEntityKind: options.unknown ? null : 'INDIVIDUAL', incomeCategoryCode: 'INTEREST', currency: 'USD', updatedAt: new Date(paid) })).flatMap(row => options.split ? [1, 2].map(n => ({ ...row, paymentId: `p-${row.id}-${n}`, sourceLineKey: `payment:p-${row.id}-${n}`, expenseDate: new Date(`2026-10-0${n}`) })) : [row]);
    const filed = rows.map(row => ({ id: `filed-${row.id}`, sourceType: 'expense.record', sourceId: row.id,
      filing: { companyId: context.companyId, status: 'FILED', periodKey: options.legacyFiled ? '2026-09' : '2026-10', formType: 'PND2' },
      lineJson: { payment: ['expense.record', row.id, options.legacyFiled ? '2026-09-02T00:00:00.000Z' : '2026-10-02T00:00:00.000Z', row.branchId, 'USD', 'INTEREST', '500', '15', '3', 'ผู้รับเงินที่ยื่น', '1234567890123', '00000', 'ที่อยู่ตามแบบที่ยื่น', ...(options.legacyFiled ? [] : [`payment:p-${row.id}`])] } }));
    const reads: any[] = [], sourceReads: any[] = [], audits: any[] = [];
    const db = accountantDb({ company: { findUnique: async () => ({ name: 'ร้านทดสอบ', status: 'ACTIVE', archivedAt: null, planTerm: null, timezone: 'Asia/Bangkok', baseCurrency: 'THB' }) },
      branch: { count: async () => 2, findMany: async () => [{ id: 'b1', code: 'HEAD', name: 'สาขาหลัก', taxBranchCode: '00000', isVatEstablishment: true }] },
      whtFilingLine: { findMany: async (query: any) => { reads.push(query); return (options.locked || options.invalid || options.open ? [] : filed).filter(line => line.filing.companyId === query.where.filing.companyId
        && (!query.where.sourceId || query.where.sourceId.in.includes(line.sourceId))
        && (!query.where.filing.periodKey || query.where.filing.periodKey.in.includes(line.filing.periodKey))); } },
      expensePayment: { findMany: async (query: any) => rows.filter(row => {
        if (query.where.expenseId) return query.where.expenseId.in.includes(row.id);
        const source = query.where.expense, date = new Date(paid), bounds = query.where.paidAt;
        return (!source?.id || source.id.in.includes(row.id)) && (!source?.branchId || (typeof source.branchId === 'string' ? source.branchId === row.branchId : source.branchId.in.includes(row.branchId)))
          && (!bounds?.gte || date >= bounds.gte) && (!bounds?.lt || date < bounds.lt);
      }).flatMap(row => (options.split ? [1, 2] : [0]).map(n => ({ id: n ? `p-${row.id}-${n}` : `p-${row.id}`, expenseId: row.id, amount: '485', paidAt: n ? new Date(`2026-10-0${n}`) : new Date(paid), paidAtConfirmed: true, paymentMethod: 'BANK_TRANSFER', status: 'RECORDED' }))) },
      whtCertificateHandoff: { findMany: async (query: any) => options.external && query.where.status.in && query.where.sourcePaymentId.in.includes('A')
        ? [{ sourcePaymentId: 'A', status: 'EXTERNAL_LINKED', certificateId: null, externalCertificateNumber: 'EXT-7' }] : [] },
      taxPeriod: { findMany: async () => options.locked ? [{ formType: 'PND2', periodKey: '2026-10', status: 'CLOSED' }] : [] },
      whtIncomeCategory: { findMany: async () => [{ code: 'INTEREST', nameTh: 'ดอกเบี้ย', formType: options.foreign ? 'PND3' : 'PND2', filingRoute: options.foreign ? 'SYSTEM_FILLS' : 'SEPARATE_PND2' }] },
    });
    const repo = { listSharedEvidence: async (_company: string, filter: any, scopes: any) => {
      const eligible = rows.filter(row => scopes.branchIds.includes(row.branchId) && row.status === filter.status
        && (filter.expenseIds === undefined || filter.expenseIds.includes(row.id)) && (!filter.yearMonth || row.expenseDate.toISOString().startsWith(filter.yearMonth)));
      return { rows: eligible.slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize), total: eligible.length, page: filter.page, pageSize: filter.pageSize };
    } };
    const source = { findConfirmedWithWhtByCompany: async (company: string, since: unknown, filter: any) => {
      sourceReads.push([company, since, filter]); return live.filter(row => filter.expenseIds.includes(row.id));
    } };
    const useCase = new CreateAccountantPackageUseCase(repo as any, { execute: async () => ({ downloadUrl: '/file', expiresAt: new Date() }), readBytes: async (_: any, input: any) => Buffer.from(input.attachmentId) } as any,
      { log: async (entry: any) => { audits.push(entry); } } as any, { client: accountantDb(db) } as any, {} as any, {} as any, source as any);
    return { useCase, context, reads, sourceReads, audits, workbook };
  }
  it('two paid installments retain two 500/15 withholding rows and latest payment dates', async () => {
    const h = fixture({ open: true, split: true });
    const result = await h.useCase.execute(h.context, { yearMonth: '2026-10', expenseIds: ['A'] });
    assert.equal(result.withholdingRowCount, 2); assert.equal(result.paymentRowCount, 2);
    const xml = h.workbook(Buffer.from(result.indexXlsxBase64, 'base64'));
    assert.equal((xml.match(/<v>500<\/v>/g) ?? []).length, 2); assert.equal((xml.match(/<v>15<\/v>/g) ?? []).length, 2);
    assert.match(xml, /ยังไม่ยื่น · ข้อมูลครบตามแบบ/);
    const main = await h.useCase.execute(h.context, { yearMonth: '2026-09', expenseIds: ['A'] });
    assert.match(h.workbook(Buffer.from(main.indexXlsxBase64, 'base64')), /2 ต.ค. 2569/);
    const moved = fixture({ moved: true });
    const updated = await moved.useCase.execute(moved.context, { yearMonth: '2026-09', expenseIds: ['A'] });
    assert.match(moved.workbook(Buffer.from(updated.indexXlsxBase64, 'base64')), /2 พ.ย. 2569/);
  });
  it('unknown payees and foreign system-filled rows remain visibly unfiled for review', async () => {
    for (const options of [{ open: true, unknown: true }, { open: true, foreign: true }]) {
      const h = fixture(options); const result = await h.useCase.execute(h.context, { yearMonth: '2026-10', expenseIds: ['A'] });
      const xml = h.workbook(Buffer.from(result.indexXlsxBase64, 'base64'));
      assert.match(xml, /ยังไม่ยื่น · ต้องตรวจ:/); assert.match(xml, options.unknown ? /ยังไม่รู้ว่า/ : /ไม่ได้ใช้สกุลเงินของร้าน/);
    }
  });
  it('both WHT reads use exactly loaded IDs, including empty selections and explicit pages', async () => {
    const h = fixture();
    for (const request of [{ yearMonth: '2026-10', expenseIds: ['A'] }, { yearMonth: '2026-10', expenseIds: [] },
      { yearMonth: '2026-09', page: 1, pageSize: 1 }, { yearMonth: '2026-09', page: 2, pageSize: 1 }, { yearMonth: '2026-09', page: 3, pageSize: 1 }]) {
      h.reads.length = 0; h.sourceReads.length = 0;
      const result = await h.useCase.execute(h.context, request);
      const expected = request.expenseIds ?? (request.page === 1 ? ['A'] : request.page === 2 ? ['B'] : []);
      const detail = h.reads.filter(query => !query.where.filing.periodKey);
      assert.ok(h.sourceReads.every(args => JSON.stringify(args) === JSON.stringify([h.context.companyId, undefined, { expenseIds: expected }])));
      assert.ok(detail.every(query => JSON.stringify(query.where.sourceId.in) === JSON.stringify(expected)));
      if (expected.length) { assert.equal(h.sourceReads.length, 1); assert.equal(detail.length, 1); }
      else { assert.equal(result.withholdingRowCount, 0); assert.equal(detail.length, 0); }
      const xml = h.workbook(Buffer.from(result.indexXlsxBase64, 'base64'));
      assert.ok(!xml.includes('EXP-C')); if (!expected.includes('B')) assert.ok(!xml.includes('EXP-B'));
      if (request.page) assert.match(xml, /หน้าที่/);
    }
  });
  it('filed coverage precedes date filtering and preserves the frozen address', async () => {
    const h = fixture({ legacyFiled: true });
    const october = await h.useCase.execute(h.context, { yearMonth: '2026-10', expenseIds: ['A'] });
    assert.equal(october.withholdingRowCount, 0);
    const octoberXml = h.workbook(Buffer.from(october.indexXlsxBase64, 'base64'));
    assert.match(octoberXml, /การจ่ายหัก ณ ที่จ่าย 1 รายการ/); assert.doesNotMatch(octoberXml, /ที่อยู่ตามแบบที่ยื่น/);
    const september = await h.useCase.execute(h.context, { yearMonth: '2026-09', expenseIds: ['A'] });
    assert.equal(september.withholdingRowCount, 1);
    const xml = h.workbook(Buffer.from(september.indexXlsxBase64, 'base64'));
    assert.match(xml, /ที่อยู่ตามแบบที่ยื่น/); assert.doesNotMatch(xml, /ที่อยู่ปัจจุบัน/); assert.match(xml, /ยื่นแล้ว/);
  });
  it('filed candidates retain October facts when the live payment moved to November', async () => {
    const h = fixture({ moved: true });
    assert.equal((await h.useCase.execute(h.context, { yearMonth: '2026-10', expenseIds: ['A'] })).withholdingRowCount, 1);
    assert.equal((await h.useCase.execute(h.context, { yearMonth: '2026-11', expenseIds: ['A'] })).withholdingRowCount, 0);
  });
  it('open and locked WHT statuses reuse row validation and keep paid facts separate from document month', async () => {
    for (const options of [{ locked: true }, { invalid: true }, { open: true, external: true }]) {
      const h = fixture(options);
      const result = await h.useCase.execute(h.context, { yearMonth: '2026-10', expenseIds: ['A'] });
      assert.equal(result.rowCount, 0); assert.equal(result.paymentRowCount, 1); assert.equal(result.withholdingRowCount, 1);
      const xml = h.workbook(Buffer.from(result.indexXlsxBase64, 'base64'));
      assert.match(xml, options.invalid ? /ยังไม่ยื่น · ต้องตรวจ:/ : options.locked ? /งวดปิดแล้ว ตรวจกับแบบที่ยื่น/ : /ยังไม่ยื่น · ข้อมูลครบตามแบบ/);
      if (options.external) assert.match(xml, /EXT-7/);
      assert.match(xml, /ดอลลาร์สหรัฐ/); assert.match(xml, /ภ.ง.ด.2/); assert.doesNotMatch(xml, /พร้อมยื่น|posting_status|journal_entry_number|เลขที่ใบสำคัญจ่าย/);
      assert.ok(h.audits.every(entry => entry.metadataJson.workbook === 'accountant-v2'));
    }
  });
});

describe('export cleanup 0.1 selection boundary', () => {
  function workbookParts(file: Buffer) {
    const parts = new Map<string, string>();
    for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
      const size = file.readUInt32LE(offset + 18), length = file.readUInt16LE(offset + 26);
      const start = offset + 30 + length + file.readUInt16LE(offset + 28);
      const bytes = file.subarray(start, start + size);
      parts.set(file.subarray(offset + 30, offset + 30 + length).toString(), (file.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes).toString());
      offset = start + size;
    }
    return parts;
  }

  it('selection excludes an unselected co-voucher expense from workbook, WHT and ZIP', async () => {
    const reader = { ...ctx(['expense.export', 'expense.read', 'attachment.read', 'expense.disbursement.read', 'wht.certificate.read']), scopes: { branchIds: ['b1'] } };
    for (const outsideBranch of [false, true]) {
      const rows = ['A', 'B'].map(id => ({ id, companyId: reader.companyId, branchId: id === 'B' && outsideBranch ? 'b2' : 'b1',
        status: 'CONFIRMED', expenseNumber: `EXP-${id}`, expenseDate: new Date('2026-09-01'), uploadedAt: new Date('2026-09-01'),
        attachments: [{ id: `receipt-${id}`, purpose: 'expense.receipt.primary', originalFileName: `${id}.jpg`, mimeType: 'image/jpeg', byteSize: 1, status: 'ACTIVE' }] }));
      const calls: string[] = [], filters: any[] = [];
      const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
        if (key === 'AND') return value.every((part: any) => matches(row, part));
        if (key === 'OR') return value.some((part: any) => matches(row, part));
        if (value && typeof value === 'object') {
          if ('in' in value) return value.in.includes(row[key]);
          if ('not' in value) return row[key] !== value.not;
          if ('gte' in value || 'lt' in value) return (!value.gte || row[key] >= value.gte) && (!value.lt || row[key] < value.lt);
        }
        return row[key] === value;
      });
      const whtReads: string[][] = [], filedReads: string[][] = [];
      const filed = rows.map(row => ({ id: `filed-${row.id}`, sourceType: 'expense.record', sourceId: row.id, filing: { companyId: reader.companyId, formType: 'PND3', periodKey: '2026-10', status: 'FILED' },
        lineJson: { payment: ['expense.record', row.id, '2026-10-02T00:00:00.000Z', row.branchId, 'THB', 'SERVICE', '100', '3', '3', 'ผู้รับเงิน', '1234567890123', '00000', 'ที่อยู่ที่ยื่น', `payment:p-${row.id}`] } }));
      const db = { whtFilingLine: { findMany: async (query: any) => { if (query.select.id) filedReads.push(query.where.sourceId.in); return filed.filter(line => (!query.where.sourceId || query.where.sourceId.in.includes(line.sourceId)) && (!query.where.filing.periodKey || query.where.filing.periodKey.in.includes(line.filing.periodKey))); } }, company: { findUnique: async () => ({ name: 'ร้าน', status: 'ACTIVE', archivedAt: null, planTerm: null }) }, user: { findMany: async () => [] }, branch: { findMany: async () => [] },
        expensePayment: { findMany: async () => [] },
        disbursementVoucher: { findMany: async ({ where }: any) => {
          const voucher = { companyId: reader.companyId, branchId: 'b1', status: 'PAID', paidDate: new Date('2026-10-02') };
          const { lines, AND, ...header } = where;
          const selected = AND?.[0].lines.some.expenseId.in;
          return matches(voucher, header) && rows.every(row => matches(row, lines.every.expense.is)) && (!selected || rows.some(row => selected.includes(row.id)))
            ? [{ id: 'V', documentNumber: 'PV-AB', slipAttachmentId: 'V-slip', lines: rows.map(row => ({ expenseId: row.id })) }] : [];
        } },
        whtCertificate: { findMany: async ({ where }: any) => rows.map(row => ({ id: `c-${row.id}`, certificateNumber: `WHT-${row.id}`, companyId: reader.companyId, status: 'ISSUED', paymentDate: new Date('2026-10-02') })).filter(row => matches(row, where)) },
        whtCertificateHandoff: { findMany: async ({ where }: any) => rows.map(row => ({ id: `h-${row.id}`, certificateId: `c-${row.id}`, sourcePaymentId: row.id, sourceBranchId: row.branchId, companyId: reader.companyId, status: 'SYSTEM_ISSUED', sourcePaymentType: 'expense.record' })).filter(row => matches(row, where)) },
      };
      const repo = { listSharedEvidence: async (companyId: string, filter: any, scopes: any, unavailable: boolean) => {
        filters.push(filter); assert.equal(companyId, reader.companyId); assert.deepEqual(scopes, reader.scopes); assert.equal(unavailable, true);
        const eligible = rows.filter(row => row.companyId === companyId && scopes.branchIds.includes(row.branchId)
          && (!filter.branchId || row.branchId === filter.branchId) && row.status === filter.status
          && (filter.expenseIds === undefined || filter.expenseIds.includes(row.id))
          && (!filter.yearMonth || row.expenseDate.toISOString().startsWith(filter.yearMonth)));
        return { rows: eligible.slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize), total: eligible.length, page: filter.page, pageSize: filter.pageSize };
      } };
      const voucherFile = async () => { calls.push('V'); return { data: Buffer.from('V'), mimeType: 'image/jpeg' }; };
      const vouchers = { documentPdf: voucherFile, slipBytes: voucherFile, supportingFiles: async () => { calls.push('V-support'); return [{ id: 'support' }]; }, supportingFileBytes: voucherFile };
      const downloads = { execute: async () => ({ downloadUrl: '/file', expiresAt: new Date() }), readBytes: async (_: any, c: any) => Buffer.from(c.attachmentId) };
      const wht = { download: async (_: any, id: string) => { calls.push(id); return { pdfArtifact: { contentBase64: Buffer.from(id).toString('base64') } }; } };
      const useCase = new CreateAccountantPackageUseCase(repo as any, downloads as any, audit, { client: accountantDb(db) } as any, vouchers as any, wht as any, { findConfirmedWithWhtByCompany: async (_: string, since: unknown, filter: any) => { assert.equal(since, undefined); whtReads.push(filter.expenseIds); return []; } } as any);
      for (const selection of [['A'], [], undefined]) {
        calls.length = 0; filters.length = 0; whtReads.length = 0; filedReads.length = 0;
        const request = { yearMonth: '2026-10', branchId: 'b1', ...(selection === undefined ? {} : { expenseIds: selection }) };
        const result = await useCase.execute(reader, request);
        const workbook = [...workbookParts(Buffer.from(result.indexXlsxBase64, 'base64')).values()].join('');
        const includeB = selection === undefined && !outsideBranch;
        assert.equal(workbook.includes('EXP-B'), includeB);
        assert.equal(workbook.includes('WHT-B'), includeB);
        assert.ok([...whtReads, ...filedReads].every(ids => ids.every(id => (selection === undefined || selection.includes(id)) && rows.some(row => row.id === id && row.branchId === 'b1'))));
        assert.equal(result.evidenceManifest.some(row => row.expense_id === 'B'), includeB);
        const plan = await useCase.planBundle(reader, request);
        if (selection?.length === 0) {
          assert.deepEqual(result.indexRows, []); assert.equal(plan.partCount, 0);
          await assert.rejects(() => useCase.downloadBundle(reader, request, 1), (e: any) => e.getStatus() === 404);
        } else {
          const zip = (await useCase.downloadBundle(reader, request, 1)).bytes.toString();
          assert.equal(zip.includes('receipt-B'), includeB);
          assert.equal(plan.counts.vouchers, includeB ? 1 : 0);
        }
        if (!includeB) assert.ok(!calls.some(call => call.startsWith('V')), 'full co-voucher artifacts must never be loaded');
        for (const page of [1, 2]) {
          const paged = await useCase.execute(reader, { ...request, page, pageSize: 1 });
          assert.deepEqual(paged.indexRows, []); assert.deepEqual(paged.evidenceManifest, []);
          const bundle = await useCase.planBundle(reader, { ...request, page, pageSize: 1 });
          assert.equal(bundle.partCount, plan.partCount, 'ZIP ignores workbook pagination');
        }
        if (selection) assert.ok(filters.every(filter => filter.expenseIds.every((id: string) => selection.includes(id))));
      }
      for (const page of [1, 2, 3]) {
        calls.length = 0;
        const result = await useCase.execute(reader, { branchId: 'b1', page, pageSize: 1 });
        const expected = page === 1 ? ['EXP-A'] : page === 2 && !outsideBranch ? ['EXP-B'] : [];
        assert.deepEqual(result.indexRows.map(row => row.expense_number), expected);
        assert.equal(result.evidenceManifest.length, expected.length); assert.equal(result.withholdingRowCount, expected.length);
        assert.ok(!calls.some(call => call.startsWith('V')), 'explicit workbook pages cannot add co-voucher sources');
      }
    }
  });
});

describe('export cleanup 0.2 commercial boundary', () => {
  it('free shops cannot export accountant files through HTTP or direct calls', async () => {
    const touched: string[] = [];
    const forbiddenWork = async () => { touched.push('export work'); throw new Error('export work reached'); };
    let company: any = { status: 'ACTIVE', archivedAt: null, planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date('2020-01-01'), billingReceiptAccountId: null, capacityOverride: null } };
    const db = { company: { findUnique: async () => company }, billingAccount: { findMany: async () => [] },
      billingInvoice: { findFirst: async () => null }, billingReceiptGrant: { findFirst: async () => null },
      packageChangeRequest: { findFirst: async () => null }, salesAttribution: { findUnique: async () => null },
      expensePayment: { findMany: forbiddenWork }, whtCertificate: { findMany: forbiddenWork } };
    const useCase = new CreateAccountantPackageUseCase({ listSharedEvidence: forbiddenWork } as any,
      { execute: forbiddenWork, readBytes: forbiddenWork } as any, { log: forbiddenWork } as any, { client: accountantDb(db) } as any,
      { documentPdf: forbiddenWork } as any, { download: forbiddenWork } as any);
    const customer = { ...ctx(['expense.export', 'expense.read', 'attachment.read', 'wht.certificate.read']), scopes: { branchIds: ['b1'] } };
    for (const freeExpenseDrafts of [true, undefined]) {
      for (const run of [() => useCase.execute({ ...customer, freeExpenseDrafts }, {}),
        () => useCase.planBundle({ ...customer, freeExpenseDrafts }, {}), () => useCase.downloadBundle({ ...customer, freeExpenseDrafts }, {}, 1)]) {
        await assert.rejects(run, (e: any) => e.getStatus?.() === 403 && e.getResponse().code === 'FREE_EXPENSE_DRAFTS_ONLY');
        assert.deepEqual(touched, [], 'denial precedes rows, files, WHT and successful audit');
      }
    }
    company = { status: 'ACTIVE', archivedAt: null, planTerm: { tierKey: 'STARTER_249', termEndsAt: new Date('2099-01-01'), termDisabledAt: null } };
    await assert.rejects(() => useCase.execute(customer, { branchId: 'b2' }), /branch/i);
    assert.deepEqual(touched, []);
    await assert.rejects(() => useCase.execute({ ...customer, permissions: ['expense.read'] }, {}), /expense.export/);
    assert.deepEqual(touched, []);
    await assert.rejects(() => useCase.execute(customer, {}), /export work reached/);
    assert.equal(touched.length, 1, 'paid customer still reaches scoped loader');
    company = null; touched.length = 0;
    await assert.rejects(() => useCase.execute({ ...customer, roles: ['SYSTEM_ADMIN'] }, {}), /export work reached/);
    assert.equal(touched.length, 1, 'SYSTEM_ADMIN keeps existing exception');
  });
});

describe('CreateAccountantPackageUseCase', () => {
  it('builds index CSV + manifest with signed links and no object keys', async () => {
    let appliedFilter: any;
    const repo = {
      listSharedEvidence: async (_companyId: string, filter: any) => {
        appliedFilter = filter;
        return {
          rows: [{
            id: 'exp-1', branchId: 'b1', expenseNumber: 'EXP-1', status: 'CONFIRMED', captureSource: 'LINE_UPLOAD',
            sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', taxEvidenceReasonCode: 'VALID_TAX_INVOICE_FIELDS',
            inputVatClaimStatus: 'CLAIMABLE', latestInputVatDecision: { reason: 'ตรวจใบแล้ว', decidedByName: 'ผู้ตรวจภาษี', decidedAt: '2026-07-02T03:00:00.000Z' },
            uploadedAt: new Date('2026-07-01T10:00:00Z'), expenseDate: new Date('2026-06-28T00:00:00Z'),
            createdByUserId: 'user-1', reviewedByUserId: null,
            vendorNameSnapshot: 'ผู้ขาย', vendorTaxIdSnapshot: '123', vendorBranchCodeSnapshot: null, vendorDocumentNumber: 'INV-1',
            categoryName: 'ค่าอาหาร', accountHintKey: 'expense.meals', note: 'กาแฟ', internalMemo: null,
            subtotalAmount: '100.0000', discountAmount: '0.0000', taxableAmount: '93.4579', vatAmount: '6.5421', whtAmount: '0.0000',
            grandTotalAmount: '100.0000', netPayableAmount: '100.0000', paidAmount: '0.0000', outstandingAmount: '100.0000',
            paymentMethod: null, paidAt: null, bankAccountRef: null, substituteReceiptGeneratedAt: null,
            postingStatus: 'posted', postingError: null, journalEntryNumber: 'JV-1',
            primaryAttachmentId: 'att-1',
            attachments: [{ id: 'att-1', purpose: 'expense.receipt.primary', originalFileName: 'r.jpg', mimeType: 'image/jpeg', byteSize: 10, checksumSha256: 'h', status: 'ACTIVE', createdAt: new Date() }],
          }],
          total: 2, page: 1, pageSize: 500,
        };
      },
    } as any;
    const downloadUrl = { execute: async () => ({ downloadUrl: '/local-storage/download/tok', expiresAt: new Date('2026-07-01T10:05:00Z') }) } as any;
    const prisma = {
      client: {
        company: { findUnique: async () => ({ name: 'บริษัท ทดสอบ', taxId: '0105', status: 'ACTIVE', archivedAt: null, planTerm: null }) },
        branch: { findMany: async () => [{ id: 'b1', code: 'SIAM' }] },
        user: { findMany: async () => [{ id: 'user-1', displayName: 'สมชาย', email: null }] },
        expenseSubstituteReceiptEvidence: { findMany: async () => [] },
        expensePayment: { findMany: async () => [] },
      },
    } as any;

    prisma.client = accountantDb(prisma.client);
    const useCase = new CreateAccountantPackageUseCase(repo, downloadUrl, audit, prisma, {} as any, {} as any);
    const result = await useCase.execute(ctx(['expense.export', 'expense.read', 'attachment.read']), { branchId: 'b1', expenseIds: ['exp-1'] });
    assert.equal(appliedFilter.branchId, 'b1');
    assert.deepEqual(appliedFilter.expenseIds, ['exp-1']);
    assert.equal(result.indexRows[0]?.branch_code, 'SIAM');
    assert.equal(result.indexRows[0]?.input_vat_right, 'CLAIMABLE');
    assert.equal(result.indexRows[0]?.input_vat_reason, 'ตรวจใบแล้ว');
    assert.equal(result.indexRows[0]?.input_vat_decided_by, 'ผู้ตรวจภาษี');
    assert.equal(result.indexRows[0]?.input_vat_decided_at, '2026-07-02T03:00:00.000Z');
    assert.equal(result.rowCount, 1);
    assert.equal(result.totalMatched, 2);
    assert.equal(result.truncated, true);
    assert.equal(appliedFilter.status, 'CONFIRMED');
    assert.equal(appliedFilter.dateField, 'expenseDate');
    assert.equal(result.indexRows[0]?.web_url, '/companies/company-1/expenses/exp-1');
    const { inflateRawSync } = await import('node:zlib');
    const workbook = Buffer.from(result.indexXlsxBase64, 'base64');
    let sheet = '';
    for (let offset = 0; workbook.readUInt32LE(offset) === 0x04034b50;) {
      const size = workbook.readUInt32LE(offset + 18), nameLength = workbook.readUInt16LE(offset + 26), extraLength = workbook.readUInt16LE(offset + 28);
      const start = offset + 30 + nameLength + extraLength;
      if (workbook.subarray(offset + 30, offset + 30 + nameLength).toString() === 'xl/worksheets/sheet1.xml') {
        const data = workbook.subarray(start, start + size);
        sheet = (workbook.readUInt16LE(offset + 8) === 8 ? inflateRawSync(data) : data).toString();
      }
      offset = start + size;
    }
    assert.doesNotMatch(sheet, /เปิดไฟล์|HYPERLINK|companies\/company-1\/expenses\/exp-1/);
    assert.doesNotMatch(sheet, /local-storage|download\/tok/);
    assert.ok(result.indexCsv.startsWith('company_name,'));
    assert.ok(result.indexCsv.includes('TAX_INVOICE'));
    assert.equal(result.evidenceManifest.length, 1);
    assert.equal(result.evidenceManifest[0]?.download_url, '/local-storage/download/tok');
    assert.deepEqual(result.skippedEvidence, []);
    assert.ok(!JSON.stringify(result).includes('objectKey'));

    // A denied file used to vanish from the manifest with nothing anywhere saying so, so the
    // accountant received a package that was short a document and looked complete.
    const denied = new CreateAccountantPackageUseCase(
      repo,
      { execute: async () => { throw new Error('A personal signature image is only available to the person it belongs to.'); } } as any,
      audit,
      prisma, {} as any, {} as any,
    );
    const short = await denied.execute(ctx(['expense.export', 'expense.read', 'attachment.read']), {});
    assert.equal(short.evidenceManifest.length, 0);
    assert.equal(short.skippedEvidence.length, 1);
    assert.equal(short.skippedEvidence[0]?.attachment_id, 'att-1');
    assert.equal(short.skippedEvidence[0]?.expense_number, 'EXP-1');
    assert.match(short.skippedEvidence[0]!.reason, /personal signature/);
  });

  it('requires expense.export', async () => {
    const useCase = new CreateAccountantPackageUseCase({} as any, {} as any, audit, {} as any, {} as any, {} as any);
    await assert.rejects(() => useCase.execute(ctx(['expense.read']), {}), /expense.export/);
  });
});

describe('GetSharedEvidenceViewUseCase', () => {
  it('defaults to confirmed rows and preserves real folder evidence counts', async () => {
    const filters: any[] = [];
    const repo = {
      summarizeSharedEvidenceFolders: async (_companyId: string, filter: any) => {
        filters.push(filter);
        return [{ yearMonth: '2026-07', expenseCount: 2, evidenceCount: 1, totalAmount: '200.0000' }];
      },
      listSharedEvidence: async (_companyId: string, filter: any) => {
        filters.push(filter);
        return { rows: [], total: 0, page: 1, pageSize: 50 };
      },
    } as any;

    // Evidence now has its own permission; this case is about the default status filter and the
    // folder counts, so it just needs a caller the use case admits.
    const result = await new GetSharedEvidenceViewUseCase(repo).execute(ctx(['expense.evidence.read']), { branchId: 'b1' });
    assert.deepEqual(filters.map((filter) => filter.branchId), ['b1', 'b1']);

    assert.deepEqual(filters.map((filter) => filter.status), ['CONFIRMED', 'CONFIRMED']);
    assert.deepEqual(filters.map((filter) => filter.dateField), ['expenseDate', 'expenseDate']);
    assert.equal(result.folders[0]?.evidenceCount, 1);
  });
});

describe('accountant evidence bundle', () => {
  const reader = { ...ctx(['expense.export', 'expense.read', 'attachment.read']), scopes: { branchIds: ['b1'] } };
  const file = (id: string, byteSize = 1, status = 'ACTIVE') => ({ id, byteSize, status, purpose: 'expense.receipt.primary', originalFileName: `${id}.jpeg`, mimeType: 'image/jpeg' });
  function fixture(rows: any[], readBytes = async (_ctx: any, cmd: any) => Buffer.from(cmd.attachmentId)) {
    rows = rows.map(row => ({ uploadedAt: new Date('2026-10-01'), expenseDate: new Date('2026-10-01'), ...row }));
    const queries: any[] = [], audits: any[] = [];
    const repo = { listSharedEvidence: async (companyId: string, filter: any, scopes: any, options: any) => {
      queries.push({ companyId, filter, scopes, options });
      return { rows: rows.slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize).map(row => ({ ...row, attachments: row.attachments.filter((file: any) => options || file.status === 'ACTIVE') })), total: rows.length, page: filter.page, pageSize: filter.pageSize };
    } } as any;
    return { queries, audits, useCase: new CreateAccountantPackageUseCase(repo, { readBytes, execute: async () => ({ downloadUrl: '/file', expiresAt: new Date() }) } as any, { log: async (entry: any) => { if (entry.action === 'expense.accountant_bundle.download') audits.push(entry); } } as any, { client: accountantDb({ expensePayment: { findMany: async () => [] }, company: { findUnique: async () => ({ name: 'ร้าน', status: 'ACTIVE', archivedAt: null, planTerm: null }) }, user: { findMany: async () => [] }, branch: { findMany: async () => [] } }) } as any, {} as any, {} as any) };
  }
  function unzip(bytes: Buffer) {
    const entries = new Map<string, Buffer>();
    let offset = 0;
    while (bytes.readUInt32LE(offset) === 0x04034b50) {
      const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26);
      const name = bytes.subarray(offset + 30, offset + 30 + length).toString('utf8');
      assert.equal(bytes.readUInt16LE(offset + 8), 0, 'store method');
      if (/[^\x00-\x7f]/.test(name)) assert.equal(bytes.readUInt16LE(offset + 6) & 0x800, 0x800);
      const start = offset + 30 + length + bytes.readUInt16LE(offset + 28);
      entries.set(name, bytes.subarray(start, start + size));
      offset = start + size;
    }
    let centralCount = 0;
    while (bytes.readUInt32LE(offset) === 0x02014b50) {
      const length = bytes.readUInt16LE(offset + 28);
      const name = bytes.subarray(offset + 46, offset + 46 + length).toString('utf8');
      assert.ok(entries.has(name));
      if (/[^\x00-\x7f]/.test(name)) assert.equal(bytes.readUInt16LE(offset + 8) & 0x800, 0x800);
      offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
      centralCount += 1;
    }
    assert.equal(bytes.readUInt32LE(offset), 0x06054b50);
    assert.equal(bytes.readUInt16LE(offset + 10), entries.size);
    assert.equal(centralCount, entries.size);
    return entries;
  }
  function workbookParts(file: Buffer) {
    const parts = new Map<string, string>();
    for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
      const size = file.readUInt32LE(offset + 18), length = file.readUInt16LE(offset + 26);
      const start = offset + 30 + length + file.readUInt16LE(offset + 28);
      const bytes = file.subarray(start, start + size);
      parts.set(file.subarray(offset + 30, offset + 30 + length).toString(), (file.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes).toString());
      offset = start + size;
    }
    return parts;
  }
  it('counts 3000 seeded expenses once by document month even when payment evidence follows later', async () => {
    let seed = 1223;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const rows = Array.from({ length: 3000 }, (_, i) => {
      const month = 1 + next() % 9, paidMonth = month + 1 + next() % 3;
      const date = `2026-${String(month).padStart(2, '0')}-12`;
      return { id: `e-${i}`, expenseNumber: `EXP-${i}`, uploadedAt: new Date(date), expenseDate: new Date(date),
        paidAt: new Date(`2026-${String(paidMonth).padStart(2, '0')}-15`), grandTotalAmount: ((next() % 10000000) / 100).toFixed(2), attachments: [] };
    });
    const repo = { listSharedEvidence: async (_: string, filter: any) => {
      const matched = filter.expenseIds ? rows.filter(row => filter.expenseIds.includes(row.id))
        : rows.filter(row => row.expenseDate.toISOString().startsWith(filter.yearMonth));
      return { rows: matched.slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize), total: matched.length, page: filter.page, pageSize: filter.pageSize };
    } };
    const useCase = new CreateAccountantPackageUseCase(repo as any, {} as any, audit, { client: accountantDb({
      company: { findUnique: async () => ({ name: 'ร้าน', status: 'ACTIVE', archivedAt: null, planTerm: null }) },
      expensePayment: { findMany: async (query: any) => rows.filter(row => query.where.expenseId ? query.where.expenseId.in.includes(row.id) : row.paidAt >= query.where.paidAt.gte && row.paidAt < query.where.paidAt.lt).map(row => ({ id: `pay-${row.id}`, expenseId: row.id, paidAt: row.paidAt, paidAtConfirmed: true, paymentMethod: 'CASH', amount: row.grandTotalAmount })) },
      attachmentLink: { findMany: async () => [] },
    }) } as any, {} as any, {} as any);
    const seen = new Set<string>();
    for (let month = 1; month <= 12; month++) {
      const yearMonth = `2026-${String(month).padStart(2, '0')}`;
      const index = await useCase.execute(reader, { yearMonth, columnSet: 'full' });
      const expected = rows.filter(row => row.expenseDate.toISOString().startsWith(yearMonth));
      assert.equal(index.rowCount, expected.length, yearMonth);
      assert.equal(index.totalMatched, expected.length);
      assert.equal(index.truncated, false);
      assert.deepEqual(index.indexRows.map(row => row.expense_number).sort(), expected.map(row => row.expenseNumber).sort());
      assert.equal(index.indexRows.reduce((sum, row) => sum + Math.round(Number(row.grand_total_amount) * 100), 0), expected.reduce((sum, row) => sum + Math.round(Number(row.grandTotalAmount) * 100), 0));
      for (const row of index.indexRows) { assert.ok(!seen.has(row.expense_number)); seen.add(row.expense_number); }
    }
    assert.equal(seen.size, 3000);
  });
  it('packages paid vouchers, direct-issued vouchers, slips and issued 50 ทวิ for an earlier expense with scoped month counts and index links', async () => {
    const row = { uploadedAt: new Date('2026-09-01'), expenseDate: new Date('2026-09-01'), id: 'e', expenseNumber: 'EXP-1', branchId: 'b1', attachments: [file('receipt')] };
    const queries: any = {}, calls: string[] = [];
    const db = { disbursementVoucherLine: { findMany: async () => ['PV-1', 'PV-2'].map(documentNumber => ({ expensePaymentId: 'pay', voucher: { documentNumber, status: 'PAID' } })) }, company: { findUnique: async () => ({ name: 'ร้าน', timezone: 'Asia/Bangkok', status: 'ACTIVE', archivedAt: null, planTerm: null }) },
      user: { findMany: async () => [] }, branch: { findMany: async () => [] },
      expensePayment: { findMany: async (q: any) => { if (q.where.expense) queries.payments = q; return [{ id: 'pay', expenseId: 'e', paidAt: new Date('2026-10-01'), paidAtConfirmed: true, paymentMethod: 'CASH', amount: '100' }]; } },
      attachmentLink: { findMany: async () => [{ targetId: 'pay', attachment: file('payment-slip') }] },
      disbursementVoucher: { findMany: async (q: any) => { queries.vouchers = q; return [
        { id: 'v', documentNumber: 'PV-1', slipAttachmentId: 'voucher-slip', lines: [{ expenseId: 'e' }] },
        { id: 'direct', documentNumber: 'PV-2', slipAttachmentId: null, lines: [{ expenseId: 'e' }] },
      ]; } },
      whtCertificate: { findMany: async (q: any) => { queries.certificates = q; return [{ id: 'c', certificateNumber: 'WHT-1' }]; } },
      whtCertificateHandoff: { findMany: async () => [{ id: 'h', certificateId: 'c', sourcePaymentType: 'expense.record', sourcePaymentId: 'e' }] },
    };
    const repo = { listSharedEvidence: async (_company: string, filter: any) => ({ rows: filter.yearMonth ? [] : [row], total: filter.yearMonth ? 0 : 1, page: 1, pageSize: 500 }) };
    const downloads = { execute: async () => ({ downloadUrl: '/file', expiresAt: new Date() }), readBytes: async (_: any, c: any) => Buffer.from(c.attachmentId) };
    const vouchers = { supportingFiles: async (_: any, id: string) => id === 'v' ? [{ id: 'support-1', name: 'bank.png', mimeType: 'image/png' }] : [], supportingFileBytes: async () => ({ data: Buffer.from('bank page'), mimeType: 'image/png' }), documentPdf: async (_: any, id: string) => { calls.push(id); return { data: Buffer.from('masked PDF'), fileName: id + '.pdf' }; },
      slipBytes: async () => ({ data: Buffer.from('slip'), fileName: 'slip.jpg', mimeType: 'image/jpeg' }) };
    const certificates = { download: async () => { calls.push('h'); return { pdfArtifact: { contentBase64: Buffer.from('issued PDF').toString('base64') } }; } };
    const useCase = new CreateAccountantPackageUseCase(repo as any, downloads as any, audit, { client: accountantDb(db) } as any, vouchers as any, certificates as any, { findConfirmedWithWhtByCompany: async () => [{ id: 'e', branchId: 'b1', expenseDate: new Date('2026-10-01'), paymentId: 'pay', sourceLineKey: 'payment:pay', vendorName: 'ผู้รับเงิน', vendorTaxId: '1234567890123', vendorAddress: 'ที่อยู่', vendorBranchCode: '00000', payeeEntityKind: 'INDIVIDUAL', grossAmount: '100', whtAmount: '3', whtRate: '3', currency: 'THB', incomeCategoryCode: null }] } as any);
    const allowed = { ...reader, permissions: [...reader.permissions, 'expense.disbursement.read', 'wht.certificate.read'] };
    const request = { yearMonth: '2026-10', branchId: 'b1' };
    const plan = await useCase.planBundle(allowed, request);
    assert.deepEqual(plan.counts, { receipts: 1, substituteReceipts: 0, paymentSlips: 2, vouchers: 2, supportingFiles: 1, whtCertificates: 1 });
    assert.equal(plan.missingReceiptCount, 0);
    assert.equal(plan.fileCount, 7);
    assert.equal(plan.counts.supportingFiles, 1);
    assert.equal(queries.vouchers.where.status, 'PAID');
    assert.equal(queries.vouchers.where.companyId, reader.companyId);
    assert.equal(queries.vouchers.where.branchId, 'b1');
    assert.equal(queries.vouchers.where.paidDate.gte.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(queries.vouchers.where.paidDate.lt.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(queries.certificates.where.status, 'ISSUED');
    assert.equal(queries.payments.where.paidAt.gte.toISOString(), '2026-09-30T17:00:00.000Z');
    assert.equal(queries.payments.where.paidAt.lt.toISOString(), '2026-10-31T17:00:00.000Z');
    assert.equal(queries.payments.where.expense.branchId, 'b1');
    assert.ok(queries.vouchers.where.lines.every.expense.is, 'the voucher must expose only readable source expenses');
    const entries = unzip((await useCase.downloadBundle(allowed, request, 1)).bytes);
    for (const name of ['เอกสารค่าใช้จ่าย/EXP-1-1.jpg', 'หลักฐานการจ่าย/EXP-1-จ่าย-1.jpg', 'ใบสำคัญจ่าย/PV-1.pdf', 'หนังสือรับรอง 50 ทวิ/WHT-1.pdf']) assert.ok(entries.has(name), name);
    assert.deepEqual([...new Set(calls)].sort(), ['direct', 'h', 'v']);
    assert.equal(entries.get('เอกสารประกอบการจ่าย/PV-1-1.png')?.toString(), 'bank page');
    assert.ok(entries.has('สารบัญ.xlsx'));
    const index = await useCase.execute(allowed, { ...request, columnSet: 'full' });
    assert.equal(index.rowCount, 0, 'September expenses cannot enter the October expense total');
    assert.equal(index.totalMatched, 0);
    assert.deepEqual(index.indexRows, []);
    const workbook = workbookParts(Buffer.from(index.indexXlsxBase64, 'base64'));
    assert.match(workbook.get('xl/workbook.xml')!, /name="การจ่าย"/);
    const paymentEvidence = workbook.get('xl/worksheets/sheet2.xml')!;
    assert.match(paymentEvidence, /EXP-1/);
    assert.match(paymentEvidence, /PV-1, PV-2/);
    assert.match(workbook.get('xl/worksheets/sheet3.xml')!, /WHT-1/);
    const zipIndex = [...workbookParts(entries.get('สารบัญ.xlsx')!).values()].join('');
    for (const name of [...entries.keys()].filter(name => name !== 'สารบัญ.xlsx')) assert.ok(zipIndex.includes(name), name);
    assert.doesNotMatch(paymentEvidence, /ยอดรวม|ยอดสุทธิ|ภาษีมูลค่าเพิ่ม/);
    const withoutTax = await useCase.planBundle(reader, request);
    assert.equal(withoutTax.counts.whtCertificates, 0);
    assert.equal(withoutTax.counts.vouchers, 0);
    calls.length = 0;
    const restricted = unzip((await useCase.downloadBundle(reader, request, 1)).bytes);
    assert.ok(![...restricted.keys()].some(name => name.startsWith('หนังสือรับรอง 50 ทวิ/') || name.startsWith('ใบสำคัญจ่าย/') || name.startsWith('เอกสารประกอบการจ่าย/')));
    assert.deepEqual(calls, []);
  });
  it('keeps substitute papers in their folder and warns when supporting evidence is not a receipt', async () => {
    const { useCase } = fixture([
      { id: 'e', expenseNumber: 'EXP-1', attachments: [file('sub')], evidenceSources: { certificates: [{ artifactAttachmentId: 'sub', status: 'ISSUED' }] } },
      { id: 'no-receipt', expenseNumber: 'EXP-2', attachments: [{ ...file('proof'), purpose: 'expense.review.evidence' }] },
    ]);
    const plan = await useCase.planBundle(reader, { yearMonth: '2026-10' });
    assert.equal(plan.counts.substituteReceipts, 1);
    assert.equal(plan.missingReceiptCount, 1);
    const entries = unzip((await useCase.downloadBundle(reader, { yearMonth: '2026-10' }, 1)).bytes);
    assert.ok(entries.has('ใบรับรองแทนใบเสร็จ/EXP-1-1.jpg'));
    assert.ok(entries.has('เอกสารค่าใช้จ่าย/EXP-2-1.jpg'));
  });
  describe('accountant-v2 substitute versions', () => {
  it('tracks a substitute correction chain to its issued terminal and distinguishes cancellation', async () => {
    const certificates = [
      { id: 'a', artifactAttachmentId: 'a', status: 'SUPERSEDED' },
      { id: 'b', artifactAttachmentId: 'b', status: 'SUPERSEDED', correctionOfEvidenceId: 'a' },
      { id: 'c', artifactAttachmentId: 'c', status: 'ISSUED', correctionOfEvidenceId: 'b', fundingSource: 'PERSONAL_ADVANCE', payerName: 'ผู้สำรองจ่าย', snapshotJson: { documentNumber: 'SR-3' } },
      { id: 'd', artifactAttachmentId: 'd', status: 'SUPERSEDED' },
    ];
    const { useCase } = fixture([{ id: 'e', expenseNumber: 'EXP-1', attachments: ['a', 'b', 'c', 'd'].map(id => ({ ...file(id), isHistorical: id !== 'c' })), evidenceSources: { certificates } }]);
    const entries = unzip((await useCase.downloadBundle(reader, { yearMonth: '2026-10' }, 1)).bytes);
    const xml = [...workbookParts(entries.get('สารบัญ.xlsx')!).values()].join('');
    assert.match(xml, /ฉบับเดิม \(มีฉบับใหม่แทนแล้ว\)/); assert.match(xml, /ยกเลิกแล้ว \(ไม่มีฉบับใหม่\)/);
    assert.match(xml, /ผู้สำรองจ่าย/); assert.match(xml, /SR-3/);
    assert.equal((xml.match(/HYPERLINK\(&quot;ใบรับรองแทนใบเสร็จ\/EXP-1-3.jpg/g) ?? []).length, 4, 'primary file, current file and both replacement links point to the terminal');
    const index = await useCase.execute(reader, { yearMonth: '2026-10' });
    assert.match(index.indexCsv, /ใบรับรองแทนใบเสร็จ\/EXP-1-1.jpg/); assert.doesNotMatch(index.indexCsv, /ฉบับเดิม.jpg/);
  });
  });
  it('keeps legacy CSV filenames while ZIP uses public filenames and preserves unavailable sequence slots', async () => {
    const { useCase } = fixture([{ id: 'e', expenseNumber: 'EXP-1', attachments: [file('pending', 1, 'PENDING_UPLOAD'), file('ready')] }]);
    const index = await useCase.execute(reader, { yearMonth: '2026-10', columnSet: 'full' });
    const entries = unzip((await useCase.downloadBundle(reader, { yearMonth: '2026-10' }, 1)).bytes);
    assert.ok(entries.has('เอกสารค่าใช้จ่าย/EXP-1-2.jpg'));
    assert.ok(index.indexRows[0].bundle_file_names.split('\n').includes('ใบเสร็จ/EXP-1-2.jpg'));
    assert.match(index.indexCsv, /ใบเสร็จ\/EXP-1-2.jpg/);
    assert.doesNotMatch(index.indexCsv, /เอกสารค่าใช้จ่าย\//);
    const zipXml = [...workbookParts(entries.get('สารบัญ.xlsx')!).values()].join('');
    assert.match(zipXml, /เอกสารค่าใช้จ่าย\/EXP-1-2.jpg/);
  });
  it('plans empty, single, count-limited, byte-limited and oversized parts', async () => {
    for (const [files, expectedParts] of [
      [[], 1], [[file('one')], 1], [Array.from({ length: 61 }, (_, i) => file(String(i))), 2],
      [[file('a', 40_000_000), file('b', 30_000_000)], 2],
      [[file('a', 60_000_001), file('b'), file('c')], 2],
      [[file('a', 60_000_000), file('b')], 2],
      [[file('a'), file('b', 60_000_001), file('c')], 3],
    ] as [any[], number][]) {
      const { useCase } = fixture([{ id: 'e', expenseNumber: 'EXP-1', attachments: files }]);
      assert.deepEqual(await useCase.planBundle(reader, { yearMonth: '2026-10' }), { fileCount: files.length, partCount: expectedParts, counts: { receipts: files.length, substituteReceipts: 0, paymentSlips: 0, vouchers: 0, supportingFiles: 0, whtCertificates: 0 }, missingReceiptCount: files.length ? 0 : 1 });
    }
  });
  it('uses all query pages with the package filters and caller scope, without a 500-row cutoff', async () => {
    const { useCase, queries } = fixture(Array.from({ length: 501 }, (_, i) => ({ id: `e${i}`, expenseNumber: `EXP-${String(i).padStart(3, '0')}`, attachments: [file(`a${i}`)] })));
    assert.deepEqual(await useCase.planBundle(reader, { yearMonth: '2026-10', dateField: 'uploadedAt', branchId: 'b1', expenseIds: ['selection'] }), { fileCount: 501, partCount: 9, counts: { receipts: 501, substituteReceipts: 0, paymentSlips: 0, vouchers: 0, supportingFiles: 0, whtCertificates: 0 }, missingReceiptCount: 0 });
    assert.equal(queries.length, 2);
    for (const query of queries) {
      assert.equal(query.companyId, 'company-1'); assert.deepEqual(query.scopes, reader.scopes);
      assert.equal(query.filter.yearMonth, '2026-10'); assert.equal(query.filter.dateField, 'uploadedAt');
      assert.equal(query.filter.branchId, 'b1'); assert.equal(query.filter.status, 'CONFIRMED');
      assert.deepEqual(query.filter.expenseIds, ['selection']);
    }
  });
  it('keeps part membership stable across query ordering and names each numbered download', async () => {
    const rows = Array.from({ length: 61 }, (_, i) => ({ id: `e${i}`, expenseNumber: `EXP-${String(i).padStart(3, '0')}`, attachments: [file(`a${i}`)] }));
    const first = await fixture(rows).useCase.downloadBundle(reader, { yearMonth: '2026-10' }, 2);
    const reversed = await fixture([...rows].reverse()).useCase.downloadBundle(reader, { yearMonth: '2026-10' }, 2);
    assert.equal(first.fileName, 'หลักฐาน-ร้าน-2026-10-ชุดที่-2.zip');
    assert.deepEqual([...unzip(first.bytes).keys()], [...unzip(reversed.bytes).keys()]);
    assert.deepEqual(unzip(first.bytes).get('เอกสารค่าใช้จ่าย/EXP-060-1.jpg'), unzip(reversed.bytes).get('เอกสารค่าใช้จ่าย/EXP-060-1.jpg')); // Workbook ZIP timestamps need not match.
    assert.deepEqual([...unzip(first.bytes).keys()], ['เอกสารค่าใช้จ่าย/EXP-060-1.jpg', 'สารบัญ.xlsx']);
    const xml = [...workbookParts(unzip(first.bytes).get('สารบัญ.xlsx')!).values()].join('');
    assert.match(xml, /อยู่ในชุดที่ 1:/);
    assert.ok((xml.match(/<f>/g) ?? []).length > 0);
    for (const formula of xml.match(/<f>.*?<\/f>/g) ?? []) { assert.ok(formula.includes('EXP-060')); assert.ok(!formula.includes('EXP-000')); }
  });
  it('checks export/read permission and branch scope before planning or downloading', async () => {
    const { useCase, queries } = fixture([]);
    for (const operation of [() => useCase.planBundle(ctx(['expense.read']), {}), () => useCase.downloadBundle(ctx(['expense.read']), {}, 1)]) await assert.rejects(operation, /expense.export/);
    await assert.rejects(() => useCase.planBundle(ctx(['expense.export']), {}), /expense.read/);
    for (const operation of [() => useCase.planBundle(reader, { branchId: 'b2' }), () => useCase.downloadBundle(reader, { branchId: 'b2' }, 1)]) await assert.rejects(operation, /branch/i);
    assert.equal(queries.length, 0);
  });
  it('returns shared 404 for a part outside the plan', async () => {
    const { useCase } = fixture([{ id: 'e', attachments: [file('one')] }]);
    for (const part of [0, -1, 2, 1.5, NaN]) await assert.rejects(() => useCase.downloadBundle(reader, {}, part), (error: any) => error.getStatus() === 404);
    await assert.rejects(() => fixture([]).useCase.downloadBundle(reader, {}, 1), (error: any) => error.getStatus() === 404);
  });
  it('writes a parseable UTF-8 ZIP in number/sequence order, reads sequentially and audits once', async () => {
    let reading = false;
    const reads: string[] = [];
    const { useCase, audits } = fixture([
      { id: 'later', expenseNumber: 'EXP-2', attachments: [file('three')] },
      { id: 'first', expenseNumber: 'EXP-1', attachments: [file('one'), { ...file('two'), mimeType: 'application/pdf' }] },
      { id: 'fallback-id', expenseNumber: null, attachments: [file('four')] },
      { id: 'thai', expenseNumber: 'รายจ่าย/1', attachments: [file('five')] },
    ], async (context, command) => {
      assert.equal(reading, false); reading = true; reads.push(command.attachmentId);
      assert.equal(context, reader); await Promise.resolve(); reading = false;
      return Buffer.from(command.attachmentId);
    });
    const result = await useCase.downloadBundle(reader, { yearMonth: '2026-10', dateField: 'uploadedAt', branchId: 'b1' }, 1);
    const entries = unzip(result.bytes);
    assert.deepEqual([...entries.keys()], ['เอกสารค่าใช้จ่าย/EXP-1-1.jpg', 'เอกสารค่าใช้จ่าย/EXP-1-2.pdf', 'เอกสารค่าใช้จ่าย/EXP-2-1.jpg', 'เอกสารค่าใช้จ่าย/ยังไม่มีเลขที่-1.jpg', 'เอกสารค่าใช้จ่าย/รายจ่าย_1-1.jpg', 'สารบัญ.xlsx']);
    assert.deepEqual(reads, ['one', 'two', 'three', 'four', 'five']);
    assert.equal(entries.get('เอกสารค่าใช้จ่าย/EXP-1-2.pdf')?.toString(), 'two');
    assert.equal(result.fileName, 'หลักฐาน-ร้าน-2026-10.zip');
    assert.equal(audits.length, 1); assert.equal(audits[0].actorUserId, 'user-1');
    assert.equal(audits[0].action, 'expense.accountant_bundle.download');
    assert.deepEqual(audits[0].metadataJson, { workbook: 'accountant-v2', yearMonth: '2026-10', dateField: 'uploadedAt', branchId: 'b1', part: 1, fileCount: 5, skippedCount: 0 });
    assert.doesNotMatch([...entries.keys()].join(','), /https?:|objectKey|downloadUrl/);
    // With no month chosen the file is named in Thai like the page's own choice, not with an English word.
    assert.equal((await useCase.downloadBundle(reader, { dateField: 'uploadedAt', branchId: 'b1' }, 1)).fileName, 'หลักฐาน-ร้าน-ทุกเดือน.zip');
  });
  it('omits refused, missing and unscanned files with a plain Thai manifest, retaining sequence gaps', async () => {
    const reads: string[] = [];
    const { useCase, audits } = fixture([{ id: 'e', expenseNumber: 'EXP-1', attachments: [file('denied'), file('pending', 1, 'PENDING_UPLOAD'), file('missing'), file('ok')] }], async (_context, command) => {
      reads.push(command.attachmentId);
      if (command.attachmentId === 'denied') throw Object.assign(new Error('private backend information'), { status: 403 });
      if (command.attachmentId === 'missing') throw Object.assign(new Error('private object key'), { code: 'ENOENT' });
      return Buffer.from('ok');
    });
    const entries = unzip((await useCase.downloadBundle(reader, {}, 1)).bytes);
    assert.deepEqual([...entries.keys()], ['เอกสารค่าใช้จ่าย/EXP-1-4.jpg', 'ไฟล์ที่ไม่ได้รวม.txt', 'สารบัญ.xlsx']);
    const manifest = entries.get('ไฟล์ที่ไม่ได้รวม.txt')!.toString();
    assert.match(manifest, /EXP-1.*denied.jpeg.*ไม่มีสิทธิ์เปิดไฟล์/);
    assert.match(manifest, /pending.jpeg.*ไฟล์ยังตรวจสอบไม่เสร็จ/);
    assert.match(manifest, /missing.jpeg.*ไม่พบไฟล์/);
    const xml = [...workbookParts(entries.get('สารบัญ.xlsx')!).values()].join(''); assert.match(xml, /ไม่ได้รวม: ไม่พบไฟล์/);
    for (const formula of xml.match(/<f>.*?<\/f>/g) ?? []) assert.ok(!formula.includes('EXP-1-3'));
    assert.doesNotMatch(manifest, /private/); assert.deepEqual(reads, ['denied', 'missing', 'ok']);
    assert.equal(audits[0].metadataJson.fileCount, 1); assert.equal(audits[0].metadataJson.skippedCount, 3);
  });
});


it('bundle planning retains unavailable linked-file metadata without relaxing the expense/source scope', async () => {
  const queries: any = {};
  const db: any = {
    expenseSubstituteReceiptEvidence: { findMany: async (query: any) => { queries.cert = query; return []; } },
    attachmentLink: { findMany: async (query: any) => {
      queries.links = query;
      return [{ targetId: 'source', attachmentId: 'pending', purpose: 'expense.receipt.primary', attachment: {
        id: 'pending', status: 'PENDING_UPLOAD', branchId: 'outside', originalFileName: 'pending.pdf', mimeType: 'application/pdf', byteSize: 20n, createdAt: new Date(),
      } }];
    } },
  };
  const evidence = (await loadExpenseEvidenceSources(db, 'co1', [{ id: 'source', branchId: 'b1' }], { branchIds: ['b1'] }, true)).get('source')!;
  assert.ok(evidence.attachments.some(file => file.id === 'pending'));
  assert.deepEqual(queries.links.where.attachment, { companyId: 'co1' });
  assert.deepEqual(queries.links.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
  assert.equal(queries.cert.where.companyId, 'co1');
  assert.deepEqual(queries.cert.where.OR, [{ branchId: { in: ['b1'] } }, { branchId: null }]);
});

describe('receipt absence in the evidence read model', () => {
  it('labels only the neutral type for missing or lost receipts without changing its stored value', async () => {
    for (const receiptProblem of ['NOT_AVAILABLE', 'LOST', 'NONE']) {
      const repo = { summarizeSharedEvidenceFolders: async () => [], listSharedEvidence: async () => ({ rows: [{
        id: 'e1', sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY', attachments: [],
        aiVerificationSummaryJson: { documentReview: { assessment: { route: 'SUBSTITUTE_RECEIPT', receiptProblem, reason: 'ไม่มีใบเสร็จ', attachmentIds: [] } } },
      }], total: 1, page: 1, pageSize: 50 }) } as any;
      const result = await new GetSharedEvidenceViewUseCase(repo).execute(ctx(['expense.evidence.read']), {});
      assert.equal(result.rows[0].sourceDocumentType, 'EXPENSE_NOTE_TEXT');
      assert.equal(result.rows[0].sourceDocumentTypeLabel, receiptProblem === 'NONE' ? undefined : 'ไม่มีใบเสร็จ');
    }
  });

});
it('G1: payee-only totals use a known category or neutral expense description and repair older empty items', () => {
  const serviceCategories = [{ id: 'service', companyId: 'c1', name: 'ค่าบริการ', status: 'ACTIVE' }] as any;
  for (const category of [undefined, 'service']) {
    const state = buildInitialLineExpenseDraftContinuation({ workflowId: 'g1', companyId: 'c1', userId: 'u1', expenseId: 'e1', chatKeyHash: 'chat',
      targetRevision: '2026-10-15T00:00:00.000Z', provisionalExpenseDate: '2026-10-15', categories: serviceCategories, applyCategoryHints: true,
      messageText: 'สร้างค่าใช้จ่ายให้ อินฟลู 500 บาท วันที่ 10 ตุลา 2569',
      hints: { confidence: 1, vendorName: 'อินฟลู', amount: '500', description: 'ค่าใช้จ่ายอินฟลู', ...(category ? { expenseCategoryId: category } : {}) } });
    assert.equal(state.items[0]!.description, `${category ? 'ค่าบริการ' : 'ค่าใช้จ่าย'} อินฟลู`);
    assert.equal(materializedLineExpenseDraftItems(state)[0]!.unitPrice, '500');
    assert.ok(!state.unresolvedQuestions.some(question => question.field === 'description'));
    delete state.items[0]!.description;
    const continued = applyLineExpenseDraftAnswer({ state, messageText: 'เป็นค่าบริการ', categories: serviceCategories,
      hints: { items: [{ itemRef: 'I01', sourceText: 'เป็นค่าบริการ', expenseCategoryId: 'service' }] } });
    assert.equal(continued.state.items[0]!.description, 'ค่าบริการ อินฟลู');
    assert.ok(continued.acceptedFields.includes('I01-DESC'));
    assert.equal(materializedLineExpenseDraftItems(continued.state)[0]!.unitPrice, '500');
  }
});

it('G3: exact second live router history hints do not answer the current message or write/re-show the draft', async () => {
  // Verbatim trace-t2-run2.jsonl turn 3, including its invented historic sourceText.
  const route = {"status":"ROUTED","intent":"EXPENSE_DRAFT_CONTINUATION","language":"th","confidence":0.82,"captureHints":{"sourceDocumentType":"EXPENSE_NOTE_TEXT","description":"ค่าบริการ อินฟลู","expenseCategoryId":"category-a-service","targetExpenseId":"cmv9idt23002bu9k1dw3isbqi","items":[{"itemRef":"I01","sourceText":"เป็นค่าบริการ","description":"ค่าบริการ อินฟลู","accountingClass":"OPEX","itemBehavior":"SERVICE","confidence":0.82,"missingFields":[]}],"confidence":0.82,"missingFields":[]},"semanticOutcome":"BUSINESS_EXPENSE","fundingSource":"COMPANY_PAID","semanticSubrequests":[{"index":0,"kind":"write","goal":"ระบุประเภทรายการ I01 ว่าเป็นค่าบริการ สำหรับอินฟลู","requiredEvidence":[],"requestedFilters":{},"writeIntent":"EXPENSE_DOCUMENT_CAPTURE","dependsOn":[],"evidenceRefs":[{"partId":"part-0","startUtf16":0,"endUtf16":14,"rawSha256":"5dfb046d01e1b12740c2de6c00fbc6aa89acfb8ea0222c2e017414cd3d24c749"}]}],"usage":[{"tag":"line.intake-route","modelId":"global.anthropic.claude-sonnet-4-6","ok":true,"inputTokens":3874,"outputTokens":349,"cacheReadInputTokens":20595,"cacheWriteInputTokens":0,"durationMs":8920,"usageBasis":"PROVIDER_REPORTED","invocationKey":"company-a#47c551cfc06f5ef191f7fc685b27d55ba8042ede828e9d906e14bc0eed46fd42#provider-v2#0"}]};
  const context = ctx(['expense.receipt.line_upload'], 'line');
  const id = route.captureHints.targetExpenseId;
  const state = buildInitialLineExpenseDraftContinuation({ workflowId: 'g3-live', companyId: context.companyId, userId: context.userId,
    expenseId: id, chatKeyHash: 'chat', targetRevision: '2026-10-15T00:00:00.000Z', provisionalExpenseDate: '2026-10-15', categories: [],
    messageText: 'สร้างค่าใช้จ่ายให้ อินฟลู 500 บาท วันที่ 10 ตุลา 2569', hints: { confidence: 1, vendorName: 'อินฟลู', amount: '500' } });
  const expense = { id, companyId: context.companyId, createdByUserId: context.userId, captureSource: 'LINE_UPLOAD', status: 'DRAFT',
    updatedAt: new Date(state.targetRevision), sourceChannelMetadataJson: { lineExpenseDraftContinuation: state }, lines: [] };
  const repo = { listLineExpenseDraftContinuationRows: async () => [expense],
    findByIdWithRelations: async (_company: string, requested: string) => requested === id ? expense : null, listCategories: async () => [] };
  const updates: unknown[] = [];
  const useCase = new LineExpenseDraftConversationUseCase(repo as any, { execute: async (...args: unknown[]) => { updates.push(args); } } as any);
  const before = structuredClone(expense.sourceChannelMetadataJson);
  for (const messageText of ['อ่าว ทำไมเงียบ', 'ทำไมไม่แก้รายการ']) {
    const result = await useCase.execute(context, { chatKeyHash: 'chat', messageText, captureHints: route.captureHints as any });
    assert.equal(result.handled, false);
    assert.deepEqual(result.acceptedFields, []); assert.deepEqual(result.replyTexts, []);
  }
  assert.deepEqual(expense.sourceChannelMetadataJson, before);
  assert.equal(updates.length, 0);
});

describe('cash-note questions stay separate from receipt completeness', () => {
  it('Exam F1: explicit edits reach intake and an incidental date never stands in for an amount edit', async () => {
    const context = ctx(['expense.receipt.line_upload'], 'line');
    const state = buildInitialLineExpenseDraftContinuation({ workflowId: 'f1', companyId: context.companyId, userId: context.userId, expenseId: 'e1', chatKeyHash: 'chat',
      targetRevision: '2026-10-17T00:00:00Z', provisionalExpenseDate: '2026-10-17', categories: [],
      messageText: 'ค่าซ่อมแอร์หน้าร้าน 1,800 บาท วันนี้', hints: { confidence: 1, amount: '1800', description: 'ค่าซ่อมแอร์หน้าร้าน' } });
    const expense = { id: state.expenseId, companyId: context.companyId, createdByUserId: context.userId, captureSource: 'LINE_UPLOAD', status: 'DRAFT',
      updatedAt: new Date(state.targetRevision), sourceChannelMetadataJson: { lineExpenseDraftContinuation: state }, lines: [] };
    let updates = 0;
    const repo: any = { listLineExpenseDraftContinuationRows: async () => [expense], findByIdWithRelations: async () => expense, listCategories: async () => [] };
    const useCase = new LineExpenseDraftConversationUseCase(repo, { execute: async () => { updates++; } } as any);
    for (const text of ['แก้ยอดรายการค่าซ่อมแอร์เมื่อกี้เป็น 1,850 บาท', 'ยืนยันรายการนี้ แล้วบันทึกว่าจ่ายเงินสดแล้ววันนี้', 'ลบรายการค่าซ่อมแอร์นี้ทิ้งเลย บันทึกผิด']) {
      assert.equal(await useCase.answersOpenDraft(context, 'chat', text), false, text);
    }
    const result = await useCase.execute(context, { chatKeyHash: 'chat', messageText: 'แก้ยอดรายการค่าซ่อมแอร์เมื่อกี้เป็น 1,850 บาท', captureHints: { expenseDate: '2026-10-17' } });
    assert.deepEqual(result.acceptedFields, []); assert.match(result.replyTexts.join('\n'), /ยังไม่ได้แก้ยอดเงินค่ะ/);
    assert.doesNotMatch(result.replyTexts.join('\n'), /แก้ร่างแล้ว: วันที่/); assert.equal(updates, 0);
  });
  it('asks once for the missing amount on a note and preserves receipt seller/quantity guards', () => {
    const input = { workflowId: 'wf', companyId: 'company', userId: 'user', expenseId: 'expense', chatKeyHash: 'chat',
      targetRevision: '2026-10-17T00:00:00Z', provisionalExpenseDate: '2026-10-17', messageText: 'ค่าเดินทาง วันนี้', categories: [],
      hints: { description: 'ค่าเดินทาง', confidence: 1 } };
    const note = buildInitialLineExpenseDraftContinuation(input);
    assert.equal(note.header.expenseDate, '2026-10-17');
    assert.ok(!note.unresolvedQuestions.some(question => ['vendorName', 'quantity'].includes(question.field)));
    const receipt = buildInitialLineExpenseDraftContinuation({ ...input, itemSource: 'LINE_MEDIA_OCR' });
    assert.ok(receipt.unresolvedQuestions.some(question => question.field === 'vendorName'));
    assert.ok(receipt.unresolvedQuestions.some(question => question.field === 'quantity'));
    delete receipt.itemSource;
    for (const entry of Object.values(receipt.provenance)) entry.source = 'LINE_MEDIA_OCR';
    assert.ok(collectLineExpenseDraftQuestions(receipt, []).some(question => question.field === 'vendorName'), 'legacy OCR drafts retain their evidence guards');
  });
});

  it('Exam F1: a one-item note retains stated money when the model bounds the item to its name', () => {
    const messageText = 'ทำให้หน่อย ค่าซ่อมแอร์หน้าร้าน 1,800 บาท ร้านเย็นฉ่ำแอร์ วันนี้ จ่ายเงินสดไปแล้ว';
    for (const amount of ['1800', undefined]) {
      const state = buildInitialLineExpenseDraftContinuation({ workflowId: 'f1', companyId: 'c1', userId: 'u1', expenseId: 'e1', chatKeyHash: 'chat',
        targetRevision: '2026-10-17T00:00:00Z', provisionalExpenseDate: '2026-10-17', messageText, categories: [],
        hints: { confidence: 1, amount, items: [{ sourceText: 'ค่าซ่อมแอร์หน้าร้าน', description: 'ค่าซ่อมแอร์หน้าร้าน', totalAmount: '1800', unitPrice: '1800' }] } });
      assert.equal(state.items[0]!.totalAmount, '1800');
      assert.equal(materializedLineExpenseDraftItems(state)[0]!.unitPrice, '1800');
      assert.equal(state.unresolvedQuestions.some(question => question.field === 'price'), false);
    }
    const multi = buildInitialLineExpenseDraftContinuation({ workflowId: 'f1', companyId: 'c1', userId: 'u1', expenseId: 'e1', chatKeyHash: 'chat',
      targetRevision: '2026-10-17T00:00:00Z', provisionalExpenseDate: '2026-10-17', messageText: 'ค่าซ่อมแอร์กับค่าล้างแอร์ รวม 1,800 บาท', categories: [],
      hints: { confidence: 1, amount: '1800', items: [{ sourceText: 'ค่าซ่อมแอร์', description: 'ค่าซ่อมแอร์' }, { sourceText: 'ค่าล้างแอร์', description: 'ค่าล้างแอร์' }] } });
    assert.equal(materializedLineExpenseDraftItems(multi).length, 0, 'a document total never becomes each of two item totals');
  });


it('R12 signature fill uses expense detail scope before mutation', async () => {
  for (const renderedAttachmentId of [undefined, 'rendered-1']) {
    for (const scenario of ['branch', 'tenant', 'missing', 'valid', 'central', 'unrestricted', 'database', 'closed', 'own-read'] as const) {
      const calls: string[] = [];
      const expense = { id: 'exp-1', companyId: 'company-1', status: scenario === 'closed' ? 'CONFIRMED' : 'DRAFT', createdByUserId: 'other-creator',
        branchId: scenario === 'central' ? null : scenario === 'branch' ? 'branch-b' : 'branch-a' };
      const failure = new Error('database unavailable');
      const repo = {
        findById: async () => expense,
        findByIdWithRelations: async (companyId: string, expenseId: string) => {
          if (scenario === 'database') throw failure;
          return companyId === expense.companyId && expenseId === expense.id ? expense : null;
        },
        findSignatureAssetById: async () => { calls.push('asset'); return { id: 'sig-1', submittedByUserId: 'user-1', status: 'ACTIVE' }; },
        linkAttachment: async () => { calls.push('link'); },
        createSignatureFill: async () => { calls.push('fill'); return { id: 'fill-1', appliedAt: new Date() }; },
      } as any;
      const complete = { execute: async () => { calls.push('complete'); } } as any;
      const audit = { log: async () => { calls.push('success'); } } as any;
      const useCase = new FillSignatureUseCase(repo, complete, audit, new GetExpenseUseCase(repo));
      const actor = { ...ctx(scenario === 'own-read' ? ['expense.read_own'] : ['expense.review', ...(renderedAttachmentId ? ['attachment.create'] : [])]), companyId: scenario === 'tenant' ? 'other-company' : 'company-1',
        scopes: scenario === 'unrestricted' ? undefined : { branchIds: scenario === 'central' ? [] : ['branch-a'] } };
      const run = () => useCase.execute(actor as RequestContext, scenario === 'missing' ? 'missing' : 'exp-1', { signatureAssetId: 'sig-1', renderedAttachmentId });
      if (['valid', 'central', 'unrestricted'].includes(scenario)) {
        assert.equal((await run()).fillId, 'fill-1');
        assert.deepEqual(calls, ['asset', ...(renderedAttachmentId ? ['complete', 'link'] : []), 'fill', 'success']);
      } else {
        await assert.rejects(run, (error: any) => scenario === 'database' ? error === failure : error.getStatus() === (scenario === 'closed' ? 400 : scenario === 'own-read' ? 403 : 404));
        assert.deepEqual(calls, []);
      }
    }
  }
});

it('R12 free source drafts cannot acquire a signature fill', async () => {
  for (const freeExpenseDrafts of [undefined, true]) {
    const calls: string[] = [];
    const repo = {
      commercialAccessDb: {
        company: { findUnique: async () => ({ status: 'ACTIVE', planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0) } }) },
        billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null },
        billingReceiptGrant: { findFirst: async () => null }, packageChangeRequest: { findFirst: async () => null }, salesAttribution: { findUnique: async () => null },
      },
      findById: async () => ({ id: 'exp-1', status: 'DRAFT' }),
      findByIdWithRelations: async () => { calls.push('read'); return { id: 'exp-1', status: 'DRAFT' }; },
      findSignatureAssetById: async () => { calls.push('asset'); return { id: 'sig-1', submittedByUserId: 'user-1', status: 'ACTIVE' }; },
      linkAttachment: async () => { calls.push('link'); },
      createSignatureFill: async () => { calls.push('fill'); return { id: 'fill-1', appliedAt: new Date() }; },
    } as any;
    const useCase = new FillSignatureUseCase(repo, { execute: async () => { calls.push('complete'); } } as any,
      { log: async () => { calls.push('success'); } } as any, new GetExpenseUseCase(repo));
    await assert.rejects(() => useCase.execute({ ...ctx(['expense.review']), freeExpenseDrafts }, 'exp-1', { signatureAssetId: 'sig-1', renderedAttachmentId: 'rendered-1' }),
      (error: any) => error.getStatus() === 403 && error.getResponse().code === 'FREE_EXPENSE_DRAFTS_ONLY');
    assert.deepEqual(calls, []);
  }
});


it('R11 upload callers preserve branch and identity', async () => {
  const actor = { ...ctx(['expense.review', 'attachment.create']), scopes: { branchIds: [] } };
  const calls: any[] = [];
  const useCase = new InitSignatureUploadUseCase({ execute: async (...args: any[]) => { calls.push(args); return { attachmentId: 'signature-upload' }; } } as any);
  await useCase.execute(actor, { originalFileName: 'signature.png', mimeType: 'image/png', byteSize: 1_000 });
  assert.deepEqual(calls[0][0], actor);
  assert.equal(calls[0][1].branchId, undefined);
  assert.equal(calls[0][0].userId, actor.userId);
  assert.equal(calls[0][0].membershipId, actor.membershipId);
  assert.equal(calls[0][0].companyId, actor.companyId);
});

describe('accountant office mapping', () => {
  function fixture(bootstrapped = true, reference: 'record' | 'line' = 'record') {
    const cats = [
      { id: 'own', companyId: 'company-1', name: 'ค่าเช่า', accountHintKey: 'rent', ledgerAccountCode: 'INTERNAL', ledgerAccountReviewedByUserId: bootstrapped ? 'system:expense-category-bootstrap' : null },
      { id: 'old', companyId: null, name: 'หมวดเก่า', accountHintKey: 'old', ledgerAccountCode: 'GLOBAL' },
      { id: 'unused', companyId: null, name: 'ไม่เกี่ยว', accountHintKey: 'unused' },
    ].map(c => ({ status: 'ACTIVE', sortOrder: 0, defaultInputTaxCode: null, ...c }));
    const writes: any[] = []; const logs: any[] = []; const mappings: any[] = [];
    const db: any = {
      expenseCategory: { findMany: async () => cats.map(c => ({ ...c, expenseRecords: c.id === 'old' && reference === 'record' ? [{ id: 'e' }] : [], expenseLines: c.id === 'old' && reference === 'line' ? [{ id: 'l' }] : [], accountantAccounts: mappings.filter(m => m.expenseCategoryId === c.id).map(({ accountCode, accountName }) => ({ accountCode, accountName })) })) },
      expenseCategoryAccountantAccount: {
        findMany: async () => mappings,
        upsert: async (args: any) => { writes.push(args); const row = { ...args.create }; mappings.splice(0, mappings.length, row); return row; },
        deleteMany: async (args: any) => { writes.push(args); mappings.length = 0; return { count: 1 }; },
      },
    };
    const repo = new PrismaExpenseRepository({ client: db } as any);
    // Commercial state uses the same resolver for current free and paid shops.
    db.company = { findUnique: async () => ({ status: 'ACTIVE', planTerm: { tierKey: 'STARTER', termEndsAt: new Date('2099-01-01') } }) };
    return { repo, cats, db, writes, logs, audit: { log: async (entry: any) => { logs.push(entry); } } as any };
  }
  it('office mapping allows referenced hidden categories without changing ledger codes and audits set/clear LOW', async () => {
    const f = fixture(); const context = ctx(['expense.category.manage']);
    const Set = (documentUseCases as any).SetExpenseCategoryAccountantAccountUseCase;
    const Clear = (documentUseCases as any).ClearExpenseCategoryAccountantAccountUseCase;
    assert.equal(typeof Set, 'function'); assert.equal(typeof Clear, 'function');
    const set = new Set(f.repo, f.audit); const clear = new Clear(f.repo, f.audit);
    for (const id of ['own', 'old']) await set.execute(context, id, { accountCode: '52031', accountName: 'ค่าเช่า' });
    const rows = await f.repo.listAllCategories(context.companyId);
    assert.equal(rows.find(c => c.id === 'old')?.referencedOnly, true);
    assert.deepEqual(rows.find(c => c.id === 'old')?.accountantAccount, { accountCode: '52031', accountName: 'ค่าเช่า' });
    await clear.execute(context, 'old');
    assert.deepEqual(f.logs.map(l => [l.action, l.riskLevel]), [
      ['expense.category.accountant_account.set', 'LOW'], ['expense.category.accountant_account.set', 'LOW'], ['expense.category.accountant_account.clear', 'LOW'],
    ]);
    assert.equal(f.cats[0].ledgerAccountCode, 'INTERNAL');
    assert.ok(f.writes.every(w => !JSON.stringify(w).includes('ledgerAccountCode')));
    for (const id of ['other-shop', 'unused']) {
      await assert.rejects(() => set.execute(context, id, { accountCode: '52031', accountName: 'ค่าเช่า' }), (e: any) => e.getStatus() === 404);
      await assert.rejects(() => clear.execute(context, id), (e: any) => e.getStatus() === 404);
    }
  });
  it('allows line-only historical references and preserves mappings when a category is archived', async () => {
    const f = fixture(true, 'line');
    const Set = (documentUseCases as any).SetExpenseCategoryAccountantAccountUseCase;
    await new Set(f.repo, f.audit).execute(ctx(['expense.category.manage']), 'old', { accountCode: 'H', accountName: 'หมวดเก่า' });
    f.cats.find(c => c.id === 'old')!.status = 'ARCHIVED';
    const category = (await f.repo.listAllCategories('company-1')).find(c => c.id === 'old');
    assert.equal(category?.referencedOnly, true); assert.equal(category?.accountantAccount?.accountCode, 'H');
  });
  it('allows visible global categories for a paid shop and refuses absent management permission on both paths', async () => {
    const f = fixture(false); const Set = (documentUseCases as any).SetExpenseCategoryAccountantAccountUseCase;
    const Clear = (documentUseCases as any).ClearExpenseCategoryAccountantAccountUseCase;
    assert.equal(typeof Set, 'function');
    await new Set(f.repo, f.audit).execute(ctx(['expense.category.manage']), 'unused', { accountCode: 'A', accountName: 'ค่าใช้จ่าย' });
    for (const freeExpenseDrafts of [false, true]) {
      const context = { ...ctx([]), freeExpenseDrafts };
      await assert.rejects(() => new Set(f.repo, f.audit).execute(context, 'own', { accountCode: 'A', accountName: 'ค่าใช้จ่าย' }), (e: any) => e.getStatus() === 403);
      await assert.rejects(() => new Clear(f.repo, f.audit).execute(context, 'own'), (e: any) => e.getStatus() === 403);
    }
  });
  it('rechecks never-paid free state with stale management permission before managing mappings', async () => {
    const f = fixture(); const Set = (documentUseCases as any).SetExpenseCategoryAccountantAccountUseCase;
    const Clear = (documentUseCases as any).ClearExpenseCategoryAccountantAccountUseCase;
    assert.equal(typeof Set, 'function');
    f.db.company.findUnique = async () => ({ status: 'ACTIVE', planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date('2020-01-01') } });
    f.db.billingAccount = { findMany: async () => [] };
    for (const key of ['billingInvoice', 'billingReceiptGrant', 'packageChangeRequest']) f.db[key] = { findFirst: async () => null };
    f.db.salesAttribution = { findUnique: async () => null };
    for (const action of [() => new Set(f.repo, f.audit).execute(ctx(['expense.category.manage']), 'own', { accountCode: 'A', accountName: 'ค่าใช้จ่าย' }),
      () => new Clear(f.repo, f.audit).execute(ctx(['expense.category.manage']), 'own'),
      () => new ListAllExpenseCategoriesUseCase(f.repo).execute(ctx(['expense.category.manage']))]) {
      await assert.rejects(action, (e: any) => e.getStatus() === 403 && e.getResponse().code === 'FREE_EXPENSE_DRAFTS_ONLY');
    }
    assert.equal(f.writes.length, 0); assert.equal(f.logs.length, 0);
  });
});

describe('purchase journal endpoint', () => {
  function fixture(free = false, records: any[] = []) {
    const reads: any[] = [], logs: any[] = [], queries: any[] = [];
    const db: any = {
      company: { findUnique: async () => ({ name: 'ร้านทดสอบ', status: 'ACTIVE', planTerm: { tierKey: free ? 'FREE_TRIAL_15' : 'STARTER', termEndsAt: new Date(free ? '2020-01-01' : '2099-01-01') } }) },
      billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null }, billingReceiptGrant: { findFirst: async () => null },
      packageChangeRequest: { findFirst: async () => null }, salesAttribution: { findUnique: async () => null },
      expenseLine: { findMany: async (q: any) => { queries.push(q); return records.flatMap(r => r.lines.map((l: any) => ({ ...l, expenseId: r.id }))); } },
      expensePayment: { findMany: async () => [] }, whtIncomeCategory: { findMany: async () => [] }, accountingCounterparty: { findMany: async () => [] },
    };
    const repo: any = { listSharedEvidence: async (...args: any[]) => { reads.push(args); return { rows: records, total: records.length }; },
      listCategoryNames: async () => [{ id: 'cat', name: 'ค่าใช้จ่าย' }], findCategoryAccountantAccounts: async () => [] };
    const UseCase = (evidenceUseCases as any).CreateAccountingSoftwareExportUseCase;
    assert.equal(typeof UseCase, 'function');
    return { useCase: new UseCase(repo, { client: db }, { log: async (e: any) => { logs.push(e); } }), reads, logs, queries };
  }
  const record = (patch: any = {}) => ({ id: 'expense', expenseNumber: 'EXP-1', currency: 'THB', status: 'CONFIRMED', expenseDate: new Date('2026-09-30'),
    expenseCategoryId: 'cat', taxableAmount: '100', vatAmount: '7', whtAmount: '0', inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'USABLE_FOR_TAX',
    sourceDocumentType: 'TAX_INVOICE', lines: [{ lineNumber: 1, description: 'ค่าใช้จ่าย', expenseCategoryId: 'cat', taxableAmount: '100', vatAmount: '7', vatRate: '0.07', whtAmount: '0',
      claimabilitySnapshot: 'CLAIMABLE', taxComponentsJson: [{ componentKey: 'VAT' }], taxEvidenceReviewStatus: 'VERIFIED' }], ...patch });
  const request = { preset: 'purchase_journal' };
  it('software export rechecks free access before loading rows despite stale trial permissions; paid controls reach the scoped loader', async () => {
    for (const freeExpenseDrafts of [true, undefined]) {
      const f = fixture(true, [record()]);
      await assert.rejects(() => f.useCase.execute({ ...ctx(['expense.export', 'expense.read']), freeExpenseDrafts }, request), (e: any) => e.getStatus() === 403 && e.getResponse().code === 'FREE_EXPENSE_DRAFTS_ONLY');
      assert.equal(f.reads.length, 0); assert.equal(f.queries.length, 0); assert.equal(f.logs.length, 0);
    }
    const f = fixture(); await f.useCase.execute(ctx(['expense.export', 'expense.read']), request);
    assert.equal(f.reads.length, 1); assert.equal(f.reads[0][1].status, 'CONFIRMED');
  });
  it('requires export/read permissions and branch scope on paid shops and rejects non-confirmed selection', async () => {
    const f = fixture();
    for (const permissions of [['expense.read'], ['expense.export'], []]) await assert.rejects(() => f.useCase.execute(ctx(permissions), request), (e: any) => e.getStatus() === 403);
    await assert.rejects(() => f.useCase.execute({ ...ctx(['expense.export', 'expense.read']), scopes: { branchIds: ['allowed'] } }, { ...request, branchId: 'other' }), (e: any) => e.getStatus() === 403);
    for (const status of ['VOIDED', 'NEEDS_REVIEW']) await assert.rejects(() => f.useCase.execute(ctx(['expense.export', 'expense.read']), { ...request, status }), (e: any) => e.getStatus() === 422 && e.getResponse().code === 'accounting_export_confirmed_only');
    assert.equal(f.reads.length, 0);
  });
  it('returns no files for empty or all-excluded selection and audits the exact owner payload', async () => {
    for (const records of [[], [record({ currency: 'USD' })]]) {
      const f = fixture(false, records); const result = await f.useCase.execute(ctx(['expense.export', 'expense.read']), request);
      assert.deepEqual(result.files, []); assert.equal(result.excluded.length, records.length);
      assert.equal(f.logs[0].riskLevel, 'MEDIUM');
      assert.deepEqual(f.logs[0].metadataJson, { preset: 'purchase_journal', documentCount: records.length, rowCount: 0, excludedCount: records.length, excludedByReason: records.length ? { foreign_currency: 1 } : {} });
    }
  });
  it('loads tenant-scoped line snapshots and projects the current header VAT refusal with unmapped categories and document dates', async () => {
    const current = record(); const f = fixture(false, [current]); const result = await f.useCase.execute(ctx(['expense.export', 'expense.read']), request);
    assert.equal(result.files.length, 1); assert.equal(result.rowCount, 1); assert.equal(result.unmappedCategories[0].id, 'cat');
    assert.ok(result.files[0].fileName.startsWith('สมุดรายวันซื้อ-'));
    const sheet = (result: any) => {
      const bytes = Buffer.from(result.files[0].xlsxBase64, 'base64'); let offset = 0;
      while (bytes.readUInt32LE(offset) === 0x04034b50) {
        const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), start = offset + 30 + length + bytes.readUInt16LE(offset + 28);
        const name = bytes.subarray(offset + 30, offset + 30 + length).toString();
        const data = bytes.subarray(start, start + size);
        if (name === 'xl/worksheets/sheet1.xml') return (bytes.readUInt16LE(offset + 8) === 8 ? inflateRawSync(data) : data).toString();
        offset = start + size;
      }
      assert.fail('purchase journal sheet missing');
    };
    assert.match(sheet(result), /ใช้ไม่ได้/); assert.doesNotMatch(sheet(result), /ใช้ได้ตามเงื่อนไข/);
    assert.match(sheet(result), /s="4"><v>46295<\/v>/);
    current.inputVatClaimStatus = 'CLAIMABLE';
    assert.match(sheet(await f.useCase.execute(ctx(['expense.export', 'expense.read']), request)), /ใช้ได้ตามเงื่อนไข/);

    assert.equal(f.queries[0].where.companyId, 'company-1'); assert.deepEqual(f.queries[0].where.expenseId.in, ['expense']);
    for (const field of ['claimabilitySnapshot', 'taxEvidenceReviewStatus', 'externalTaxCodeSnapshot', 'taxTreatmentSnapshot', 'taxComponentsJson']) assert.equal(f.queries[0].select[field], true);
  });
});

it('PWS-HISTORY-FREE-ACCESS preserves source-draft own, branch and tenant gates and paid financial history', async () => {
  for (const free of [true, false]) {
    let reads = 0;
    const record = { id: 'history-expense', createdByUserId: 'user-1', branchId: 'branch-1', status: 'DRAFT' };
    const repo = {
      commercialAccessDb: {
        company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: {
          tierKey: free ? 'FREE_TRIAL_15' : 'STARTER', termEndsAt: new Date(free ? 0 : '2099-01-01'),
          billingReceiptAccountId: null, capacityOverride: null,
        } }) },
        billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null },
        billingReceiptGrant: { findFirst: async () => null }, packageChangeRequest: { findFirst: async () => null },
        salesAttribution: { findUnique: async () => null },
      },
      findByIdWithRelations: async (companyId: string) => companyId === 'company-1' ? record : null,
      listExpenseHistory: async (companyId: string, expenseId: string, page: number) => {
        reads++;
        assert.equal(companyId, 'company-1'); assert.equal(expenseId, record.id);
        return { data: [{ action: 'expense.update' }], total: 1, page, pageSize: 20 };
      },
      findMemberDisplayName: async () => 'ผู้ส่งเอกสาร',
    } as any;
    const history = new GetExpenseHistoryUseCase(new GetExpenseUseCase(repo), repo);
    const actor = { ...ctx(['expense.read_own']), freeExpenseDrafts: free, scopes: { branchIds: ['branch-1'] } };
    const result = await history.execute(actor, record.id);
    assert.deepEqual(result.data, [{ action: 'expense.update' }]);
    assert.equal(result.creatorDisplayName, 'ผู้ส่งเอกสาร');
    for (const [viewer, expectedStatus] of [
      [{ ...actor, userId: 'another-user' }, 403],
      [{ ...actor, scopes: { branchIds: ['branch-2'] } }, 403],
      [{ ...actor, companyId: 'another-company' }, 404],
      [{ ...actor, permissions: [] }, 403],
    ] satisfies Array<[RequestContext, number]>) {
      await assert.rejects(() => history.execute(viewer, record.id), (error: any) => error.getStatus() === expectedStatus);
    }
    assert.equal(reads, 1, 'refused reads never load activity');
    record.status = 'CONFIRMED';
    if (free) await assert.rejects(() => history.execute(actor, record.id), (error: any) => error.getStatus() === 403);
    else await history.execute(actor, record.id);
    assert.equal(reads, free ? 1 : 2);
  }
});
