import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureLineExpenseNoteUseCase, CreateExpenseCategoryUseCase, UpdateExpenseCategoryUseCase, ListAllExpenseCategoriesUseCase } from './expense-document.use-case';
import { CreateSignatureAssetUseCase, ApproveSignatureAssetUseCase, RejectSignatureAssetUseCase, FillSignatureUseCase } from './signature-asset.use-case';
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
    return {
      updates,
      repo: {
        findByLineMessageId: async () => null,
        listCategories: async () => [{ id: 'cat-meals', name: 'ค่าอาหาร' }, { id: 'cat-travel', name: 'ค่าเดินทาง' }],
        updateExpense: async (input: any) => { updates.push(input); return { ...input, grandTotalAmount: '65.0000' }; },
        ...overrides,
      } as any,
    };
  }
  const createDraft = {
    execute: async (_c: any, input: any) => ({ id: 'exp-1', expenseCategoryId: input.expenseCategoryId ?? null, grandTotalAmount: '65.0000' }),
  } as any;

  it('creates a reviewable no-receipt draft from validated semantic hints', async () => {
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);
    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่ากาแฟ 65 บาท',
      captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', description: 'ค่ากาแฟ', amount: '65', expenseCategoryId: 'cat-meals', confidence: 0.9 },
      lineMessageId: 'msg-1',
      lineEventId: 'evt-1',
    });
    assert.equal(result.insertedAmount, '65.0000');
    assert.equal(result.categoryId, 'cat-meals');
    assert.equal(result.categoryName, 'ค่าอาหาร');
    const update = updates.at(-1);
    assert.equal(update.sourceDocumentType, 'EXPENSE_NOTE_TEXT');
    assert.equal(update.taxEvidenceStatus, 'SUPPORTING_ONLY');
    assert.equal(update.taxEvidenceReasonCode, 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE');
    assert.equal(update.status, 'NEEDS_REVIEW');
    assert.equal(update.lineMessageId, 'msg-1');
    // Bounded provenance only – no raw full message dump.
    assert.equal(update.sourceChannelMetadataJson.messagePreview, 'ค่ากาแฟ 65 บาท');
  });

  it('stores the chat hash so a later correction can only target this chat, never the raw id', async () => {
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่ากาแฟ 65 บาท', lineMessageId: 'msg-1', lineEventId: 'evt-1', chatKeyHash: 'hash-chat-1',
    });

    const metadata = updates.at(-1).sourceChannelMetadataJson;
    assert.equal(metadata.chatKeyHash, 'hash-chat-1');
    assert.equal(JSON.stringify(metadata).includes('U1234'), false);
  });

  it('omits chat provenance when the caller has none rather than inventing one', async () => {
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่ากาแฟ 65 บาท', lineMessageId: 'msg-2', lineEventId: 'evt-2',
    });

    assert.equal('chatKeyHash' in updates.at(-1).sourceChannelMetadataJson, false);
  });

  it('commits the consumed clarification with the draft, not after it', async () => {
    const seen: any[] = [];
    const { repo } = makeRepo({
      updateExpense: async (input: any, withinTx?: (tx: any) => Promise<void>) => {
        await withinTx?.({ outboxEvent: { create: async ({ data }: any) => { seen.push(data); } } });
        return { ...input, grandTotalAmount: '65.0000' };
      },
    });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่ากาแฟ 65 บาท', lineMessageId: 'msg-1', lineEventId: 'evt-1',
      consumption: { companyId: 'company-1', ledgerStreamKey: 'lineai:ledger:company-1:chat1', entryIds: ['7-0'], outcome: 'evidence_capture' },
    });

    assert.equal(seen.length, 1, 'the marker must be written inside the draft transaction');
    assert.equal(seen[0].eventType, 'ai.line.clarification.consumed');
  });

  it('rolls the draft back when the consumption marker cannot be written', async () => {
    const { repo } = makeRepo({
      updateExpense: async (_input: any, withinTx?: (tx: any) => Promise<void>) => {
        await withinTx?.({ outboxEvent: { create: async () => { throw new Error('marker_conflict'); } } });
        return { id: 'exp-1' };
      },
    });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await assert.rejects(() => useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่ากาแฟ 65 บาท', lineMessageId: 'msg-1', lineEventId: 'evt-1',
      consumption: { companyId: 'company-1', ledgerStreamKey: 'k', entryIds: ['7-0'], outcome: 'evidence_capture' },
    }), /marker_conflict/);
  });

  it('keeps the plain single-write shape when there is nothing to consume', async () => {
    let receivedCallback: unknown = 'unset';
    const { repo } = makeRepo({
      updateExpense: async (input: any, withinTx?: unknown) => { receivedCallback = withinTx; return { ...input }; },
    });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);

    await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่ากาแฟ 65 บาท', lineMessageId: 'msg-1', lineEventId: 'evt-1',
    });

    assert.equal(receivedCallback, undefined);
  });

  it('refuses invented category ids and keeps them out of the draft', async () => {
    const { repo, updates } = makeRepo();
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);
    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่าอะไรก็ไม่รู้ 100 บาท',
      captureHints: { amount: '100', expenseCategoryId: 'cat-invented' },
      lineMessageId: 'msg-2',
      lineEventId: 'evt-2',
    });
    assert.equal(result.categoryId, null);
    assert.ok(result.warnings.includes('category_not_active'));
    assert.equal(updates.at(-1).aiVerificationSummaryJson.insertedFields.expenseCategoryId, undefined);
  });

  it('is idempotent by LINE message id', async () => {
    const { repo } = makeRepo({ findByLineMessageId: async () => ({ id: 'existing-1', grandTotalAmount: '65.0000', expenseCategoryId: null }) });
    const useCase = new CaptureLineExpenseNoteUseCase(repo, createDraft, audit, outbox);
    const result = await useCase.execute(ctx(['expense.receipt.line_upload'], 'line'), {
      messageText: 'ค่ากาแฟ 65 บาท', lineMessageId: 'msg-1', lineEventId: 'evt-1',
    });
    assert.equal(result.expense.id, 'existing-1');
    assert.ok(result.warnings.includes('duplicate_line_message'));
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
  const completeUpload = { execute: async () => undefined } as any;

  function makeSigRepo(status = 'PENDING_OWNER_APPROVAL') {
    const updates: any[] = [];
    return {
      updates,
      repo: {
        findSignatureAssetByLineMessageId: async () => null,
        createSignatureAsset: async (input: any) => ({ id: 'sig-1', status: 'PENDING_OWNER_APPROVAL', ...input }),
        linkAttachmentToTarget: async () => undefined,
        findSignatureAssetById: async () => ({ id: 'sig-1', status, submittedByUserId: 'uploader-1' }),
        updateSignatureAsset: async (_c: string, id: string, data: any) => { updates.push(data); return { id, ...data }; },
        createSignatureFill: async (input: any) => ({ id: 'fill-1', appliedAt: new Date(), ...input }),
        findById: async () => ({ id: 'exp-1', status: 'NEEDS_REVIEW' }),
        linkAttachment: async () => undefined,
      } as any,
    };
  }

  it('creates pending assets and is idempotent by LINE message id', async () => {
    const { repo } = makeSigRepo();
    const useCase = new CreateSignatureAssetUseCase(repo, completeUpload, audit);
    const asset = await useCase.execute(ctx(['expense.signature.manage'], 'line'), {
      attachmentId: 'att-1', submittedFromChannel: 'LINE', lineMessageId: 'msg-1',
    });
    assert.equal(asset.status, 'PENDING_OWNER_APPROVAL');

    repo.findSignatureAssetByLineMessageId = async () => ({ id: 'sig-existing', status: 'PENDING_OWNER_APPROVAL' });
    const again = await useCase.execute(ctx(['expense.signature.manage'], 'line'), {
      attachmentId: 'att-2', submittedFromChannel: 'LINE', lineMessageId: 'msg-1',
    });
    assert.equal(again.id, 'sig-existing');
  });

  it('only expense.signature.approve can activate, and only from pending', async () => {
    const { repo, updates } = makeSigRepo();
    const approve = new ApproveSignatureAssetUseCase(repo, audit);
    await assert.rejects(() => approve.execute(ctx(['expense.signature.manage']), 'sig-1'), /expense.signature.approve/);
    await approve.execute(ctx(['expense.signature.approve']), 'sig-1');
    assert.equal(updates.at(-1).status, 'ACTIVE');

    const activeRepo = makeSigRepo('ACTIVE').repo;
    const approveActive = new ApproveSignatureAssetUseCase(activeRepo, audit);
    await assert.rejects(() => approveActive.execute(ctx(['expense.signature.approve']), 'sig-1'), /Cannot approve/);
  });

  it('reject requires a reason', async () => {
    const { repo } = makeSigRepo();
    const reject = new RejectSignatureAssetUseCase(repo, audit);
    await assert.rejects(() => reject.execute(ctx(['expense.signature.approve']), 'sig-1', ' '), /reason/i);
  });

  it('fill requires web channel, review permission, and an ACTIVE signature', async () => {
    const pending = makeSigRepo('PENDING_OWNER_APPROVAL');
    const fillPending = new FillSignatureUseCase(pending.repo, completeUpload, audit);
    await assert.rejects(
      () => fillPending.execute(ctx(['expense.review']), 'exp-1', { signatureAssetId: 'sig-1' }),
      /ACTIVE approved signatures/,
    );

    const active = makeSigRepo('ACTIVE');
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
            id: 'exp-1', expenseNumber: 'EXP-1', status: 'CONFIRMED', captureSource: 'LINE_UPLOAD',
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
        user: { findMany: async () => [{ id: 'user-1', displayName: 'สมชาย', email: null }] },
        expenseSubstituteReceiptEvidence: { findMany: async () => [] },
      },
    } as any;

    const useCase = new CreateAccountantPackageUseCase(repo, downloadUrl, audit, prisma);
    const result = await useCase.execute(ctx(['expense.export', 'expense.read', 'attachment.read']), {});
    assert.equal(result.rowCount, 1);
    assert.equal(result.totalMatched, 2);
    assert.equal(result.truncated, true);
    assert.equal(appliedFilter.status, 'CONFIRMED');
    assert.ok(result.indexCsv.startsWith('company_name,'));
    assert.ok(result.indexCsv.includes('TAX_INVOICE'));
    assert.equal(result.evidenceManifest.length, 1);
    assert.equal(result.evidenceManifest[0]?.download_url, '/local-storage/download/tok');
    assert.ok(!JSON.stringify(result).includes('objectKey'));
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
    const result = await new GetSharedEvidenceViewUseCase(repo).execute(ctx(['expense.evidence.read']), {});

    assert.deepEqual(filters.map((filter) => filter.status), ['CONFIRMED', 'CONFIRMED']);
    assert.equal(result.folders[0]?.evidenceCount, 1);
  });
});
