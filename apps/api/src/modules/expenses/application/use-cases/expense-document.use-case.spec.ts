import { buildInitialLineExpenseDraftContinuation } from '../../domain/logic/line-expense-draft-conversation.logic';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureLineExpenseNoteUseCase, CreateExpenseCategoryUseCase, UpdateExpenseCategoryUseCase, ListAllExpenseCategoriesUseCase, LineTextExpenseCaptureIncompleteError, lineDraftIdempotencyKey } from './expense-document.use-case';
import { PAYMENT_IDEMPOTENCY_KEY_PATTERN } from '../../../accounting-documents/domain/logic/accounting-money-validation.logic';
import sharp from 'sharp';
import { CreateSignatureAssetUseCase, ArchiveSignatureAssetUseCase, FillSignatureUseCase, ListSignatureAssetsUseCase, GetSignatureImageUseCase, InitSignatureUploadUseCase } from './signature-asset.use-case';
import { normalizeSignatureImage, SIGNATURE_MAX_BYTES } from '../../domain/logic/signature-image.logic';
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
    assert.match(result.replyTexts.join('\n'), /จำนวนและหน่วย/u);
    assert.match(result.replyTexts.join('\n'), /หมวดค่าใช้จ่าย/u);
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
    assert.equal(result.insertedAmount, null, 'amount stays staged until quantity is known');
    assert.equal(result.categoryId, null, 'no category is invented when the router names none');
    assert.match(result.replyTexts.join('\n'), /จำนวนและหน่วย/u);
    assert.match(result.replyTexts.join('\n'), /หมวดค่าใช้จ่าย/u);
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

  it('allows an amount from the exact clarification request after the user supplies its purpose', async () => {
    const { repo } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);
    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      draftConversationEnabled: true,
      messageText: 'เป็นค่าเดินทาง',
      groundingTexts: ['ยอด 200 บาท'],
      captureHints: { confidence: 0.9, amount: '200', description: 'ค่าเดินทาง', expenseCategoryId: 'cat-travel' },
      lineMessageId: 'msg-follow-up', lineEventId: 'evt-follow-up',
    });
    assert.equal(result.insertedAmount, null);
    assert.equal(result.categoryId, null);
    assert.match(result.replyTexts.join('\n'), /จำนวนและหน่วย/u);
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
      // A14: a LINE asset used to arrive with no label at all.
      assert.match(harness.created[0].label, /^สมชาย ใจดี \d{4}-\d{2}-\d{2}$/);
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
    const fillArchived = new FillSignatureUseCase(archived.repo, completeUpload, audit);
    await assert.rejects(
      () => fillArchived.execute(ctx(['expense.review']), 'exp-1', { signatureAssetId: 'sig-1' }),
      /ACTIVE signatures/,
    );

    // The binding the module header claims every lookup enforces. Without it any `expense.review`
    // holder could sign a document with somebody else's ink, and with approval removed a signature
    // is fillable the instant it is saved.
    const theirs = makeSigRepo('ACTIVE', { submittedByUserId: 'other-user' });
    await assert.rejects(
      () => new FillSignatureUseCase(theirs.repo, completeUpload, audit)
        .execute(ctx(['expense.review']), 'exp-1', { signatureAssetId: 'sig-1' }),
      /only apply your own signature/,
    );

    const active = makeSigRepo('ACTIVE', { submittedByUserId: 'user-1' });
    const fill = new FillSignatureUseCase(active.repo, completeUpload, audit);
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
    await assert.rejects(() => new CreateAccountantPackageUseCase({} as any, {} as any, audit, {} as any).execute(scoped, { branchId: 'b2' }), /branch/i);
  });
  const repo = {
    summarizeSharedEvidenceFolders: async () => [],
    listSharedEvidence: async () => ({ rows: [], total: 0, page: 1, pageSize: 20 }),
  } as any;

  it('uses the dedicated evidence permission independently of expense.read', async () => {
    const useCase = new GetSharedEvidenceViewUseCase(repo);
    const result = await useCase.execute(ctx(['expense.evidence.read']), {});
    assert.deepEqual(result.rows, []);
    await assert.rejects(() => useCase.execute(ctx(['expense.read']), {}), /expense.evidence.read/);
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
        company: { findUnique: async () => ({ name: 'บริษัท ทดสอบ', taxId: '0105' }) },
        branch: { findMany: async () => [{ id: 'b1', code: 'SIAM' }] },
        user: { findMany: async () => [{ id: 'user-1', displayName: 'สมชาย', email: null }] },
        expenseSubstituteReceiptEvidence: { findMany: async () => [] },
      },
    } as any;

    const useCase = new CreateAccountantPackageUseCase(repo, downloadUrl, audit, prisma);
    const result = await useCase.execute(ctx(['expense.export', 'expense.read', 'attachment.read']), { branchId: 'b1', expenseIds: ['exp-1'] });
    assert.equal(appliedFilter.branchId, 'b1');
    assert.deepEqual(appliedFilter.expenseIds, ['exp-1']);
    assert.equal(result.indexRows[0]?.branch_code, 'SIAM');
    assert.equal(result.rowCount, 1);
    assert.equal(result.totalMatched, 2);
    assert.equal(result.truncated, true);
    assert.equal(appliedFilter.status, 'CONFIRMED');
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
      prisma,
    );
    const short = await denied.execute(ctx(['expense.export', 'expense.read', 'attachment.read']), {});
    assert.equal(short.evidenceManifest.length, 0);
    assert.equal(short.skippedEvidence.length, 1);
    assert.equal(short.skippedEvidence[0]?.attachment_id, 'att-1');
    assert.equal(short.skippedEvidence[0]?.expense_number, 'EXP-1');
    assert.match(short.skippedEvidence[0]!.reason, /personal signature/);
  });

  it('requires expense.export', async () => {
    const useCase = new CreateAccountantPackageUseCase({} as any, {} as any, audit, {} as any);
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
    assert.equal(result.folders[0]?.evidenceCount, 1);
  });
});
