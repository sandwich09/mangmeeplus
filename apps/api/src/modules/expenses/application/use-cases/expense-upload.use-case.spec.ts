import { describe, it } from 'node:test';
import Decimal from 'decimal.js';
import { LinkLinePaymentEvidenceUseCase } from './link-line-payment-evidence.use-case';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  InitReceiptUploadUseCase,
  CompleteReceiptUploadUseCase,
  ConfirmBuyerMatchUseCase,
  DuplicateCheckUseCase,
  GetExpenseSourcePostingInputUseCase,
  ResolveDuplicateUseCase,
} from './expense-upload.use-case';
import { PrismaExpenseRepository, requireExpenseBranchId } from '../../infrastructure/prisma-expense.repository';
import { ExpenseController } from '../../presentation/http/expense.controller';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { EXPENSE_LAUNCH_ROUTE_CLOSED_MESSAGE } from '../expense-launch-gate';
import { FEATURE_TEMPORARILY_UNAVAILABLE, featureTemporarilyUnavailable } from '../../../employee-access/application/entitlement.helper';

const openLaunchGate = { assertLaunchRouteOpen: async () => undefined } as any;
const branchValidation = { resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, branchId?: string) =>
  requireExpenseBranchId(branchId ?? (scopes.branchIds?.length === 1 ? scopes.branchIds[0] : null)) };

const ctx = {
  requestId: 'req-1',
  authSubject: 'user-1',
  userId: 'user-1',
  companyId: 'co-1',
  membershipId: 'mem-1',
  roles: ['STAFF'],
  permissions: ['expense.receipt.line_upload', 'attachment.create'],
  scopes: {},
  authProvider: 'line',
} as any;

/**
 * Attachment collaborators for CompleteReceiptUploadUseCase's replace path.
 * `primaries` are the ACTIVE `expense.receipt.primary` links the expense already holds.
 */
function receiptRetirement(options: {
  primaries?: string[];
  sharedLinks?: Record<string, number>;
  holds?: string[];
  /** Real rows for the shared-link count, so the WHERE clause itself is under test. */
  otherLinks?: Array<{ attachmentId: string; targetType: string; targetId: string }>;
} = {}) {
  const unlinked: string[] = [];
  const softDeleted: string[] = [];
  const tx = {
    $executeRaw: async () => 0,
    attachmentLink: {
      findMany: async ({ where }: any) => (where.OR ? [] : options.primaries ?? [])
        .filter((id) => id !== where.attachmentId.not)
        .map((attachmentId) => ({ attachmentId })),
      count: async ({ where }: any) => (options.otherLinks
        ? options.otherLinks.filter((link) => link.attachmentId === where.attachmentId
          && !(link.targetType === where.NOT.targetType && link.targetId === where.NOT.targetId)).length
        : options.sharedLinks?.[where.attachmentId] ?? 0),
      deleteMany: async ({ where }: any) => { unlinked.push(where.attachmentId); return { count: 1 }; },
    },
  };
  return {
    attachments: {
      findSubstituteEvidenceRetentionHold: async ({ id }: any) => ((options.holds ?? []).includes(id) ? { evidenceId: 'ev-1' } : null),
      markDeleted: async ({ id }: any) => { softDeleted.push(id); return { id, status: 'DELETED' }; },
    } as any,
    prisma: { client: { user: { findFirst: async () => ({id: 'user-1'}) }, $transaction: async (run: any) => run(tx) } } as any,
    tx,
    unlinked,
    softDeleted,
  };
}

describe('receipt upload use cases', () => {
  it('allows LINE receipt upload permission to create LINE upload draft', async () => {
    const created: any[] = [];
    const uc = new InitReceiptUploadUseCase(
      {
        ...branchValidation,
        createExpense: async (input: any) => {
          created.push(input);
          return { id: 'expense-1' };
        },
      } as any,
      {
        execute: async () => ({
          attachmentId: 'att-1',
          uploadUrl: '/local-storage/upload/token',
          uploadMethod: 'PUT',
          expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      } as any,
      { log: async () => undefined } as any,
      // Capture policy: FULL keeps the pre-change NEEDS_REVIEW default these cases assert.
      { execute: async () => ({ mode: 'FULL' }) } as any,
      openLaunchGate,
    );

    const result = await uc.execute(ctx, {
      originalFileName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      byteSize: 123,
      expenseDate: '2026-06-27T00:00:00.000Z',
      captureSource: 'LINE_UPLOAD',
      branchId: 'branch-default',
    });

    assert.equal(result.expenseId, 'expense-1');
    assert.equal(created[0].captureSource, 'LINE_UPLOAD');
    assert.equal(created[0].inputVatClaimStatus, 'NEEDS_REVIEW');
  });

  // A company that is never asked Thai VAT questions cannot answer a claimability review either,
  // so the queue must not fill with a decision nobody can make.
  it('lands an upload NON_CLAIMABLE when the company is on simple capture', async () => {
    const created: any[] = [];
    const uc = new InitReceiptUploadUseCase(
      { ...branchValidation, createExpense: async (input: any) => { created.push(input); return { id: 'expense-1' }; } } as any,
      { execute: async () => ({ attachmentId: 'att-1', uploadUrl: '/upload', uploadMethod: 'PUT', expiresAt: new Date() }) } as any,
      { log: async () => undefined } as any,
      { execute: async () => ({ mode: 'SIMPLE' }) } as any,
      openLaunchGate,
    );

    await uc.execute(ctx, {
      originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 123,
      expenseDate: '2026-06-27T00:00:00.000Z', captureSource: 'LINE_UPLOAD', branchId: 'branch-default',
    });

    assert.equal(created[0].inputVatClaimStatus, 'NON_CLAIMABLE');
  });

  it('rejects Buddhist-era dates before creating an upload intent or expense', async () => {
    const writes: string[] = [];
    const uc = new InitReceiptUploadUseCase(
      { ...branchValidation, createExpense: async () => { writes.push('expense'); return { id: 'expense-1' }; } } as any,
      { execute: async () => { writes.push('intent'); return {}; } } as any,
      { log: async () => undefined } as any,
      { execute: async () => ({ mode: 'FULL' }) } as any,
      openLaunchGate,
    );

    await assert.rejects(() => uc.execute(ctx, {
      originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 123,
      expenseDate: '2569-03-15', captureSource: 'LINE_UPLOAD', branchId: 'branch-default',
    }), /invalid civil date/);
    assert.deepEqual(writes, []);
  });

  it('resolves the scoped branch consistently for the upload intent and expense', async () => {
    const created: any[] = [];
    const intents: any[] = [];
    const uc = new InitReceiptUploadUseCase(
      { ...branchValidation, createExpense: async (input: any) => { created.push(input); return { id: 'expense-1' }; } } as any,
      { execute: async (_ctx: any, input: any) => {
        intents.push(input);
        return { attachmentId: 'att-1', uploadUrl: '/upload', uploadMethod: 'PUT', expiresAt: new Date() };
      } } as any,
      { log: async () => undefined } as any,
      // Capture policy: FULL keeps the pre-change NEEDS_REVIEW default these cases assert.
      { execute: async () => ({ mode: 'FULL' }) } as any,
      openLaunchGate,
    );

    await uc.execute({ ...ctx, scopes: { branchIds: ['branch-default'] } }, {
      originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 123,
      expenseDate: '2026-07-13T00:00:00.000Z', captureSource: 'LINE_UPLOAD',
    });

    assert.equal(intents[0].branchId, 'branch-default');
    assert.equal(created[0].branchId, 'branch-default');
  });

  it('allows LINE receipt upload permission to complete own upload', async () => {
    const updates: any[] = [];
    const retirement = receiptRetirement();
    const uc = new CompleteReceiptUploadUseCase(
      {
        findById: async () => ({ updatedAt: new Date('2026-09-15T10:00:00Z'), id: 'expense-1', status: 'DRAFT', createdByUserId: 'user-1', duplicateStatus: 'NO_MATCH' }),
        runDuplicateCheck: async (_input: any, detectWithinTx: (tx: any) => Promise<string[]>) => {
          const matched = await detectWithinTx({ marker: 'tx' });
          return { openCandidates: matched.length, duplicateStatus: matched.length > 0 ? 'POSSIBLE_DUPLICATE' : 'NO_MATCH' };
        },
        findByIdWithRelations: async () => ({
          id: 'expense-1', primaryAttachmentId: 'att-1', attachments: [],
          vendorDocumentNumber: null, vendorTaxIdSnapshot: null, expenseDate: new Date(),
          grandTotalAmount: '0', vendorCounterpartyId: null,
        }),
        findNearDuplicates: async () => [],
        findExpenseIdsByAttachmentChecksum: async () => [],
        createDuplicateCandidate: async () => undefined,
        linkAttachment: async () => undefined,
        updateExpense: async (input: any, withinTx?: (tx: any) => Promise<void>) => {
          await withinTx?.(retirement.tx);
          updates.push(input);
          return { id: input.id };
        },
      } as any,
      { execute: async () => ({ id: 'att-1' }) } as any,
      { log: async () => undefined } as any,
      { append: async () => undefined } as any,
      retirement.attachments,
      retirement.prisma,
      {resolveAccess: async () => ctx} as any,
    );

    await uc.execute(ctx, { expenseId: 'expense-1', attachmentId: 'att-1', byteSize: 123 });

    assert.equal(updates[0].primaryAttachmentId, 'att-1');
    assert.equal(updates[0].status, 'NEEDS_REVIEW');
  });

  /**
   * A01 / A38 / IG13 (W08). §16.4 added `intent`, `expectedPrimaryAttachmentId` and `operationId`
   * to this route. A client that predates them — an old web bundle, a queued job, a raw caller —
   * sends none of the three, and must get the pre-feature behaviour byte for byte: no revision
   * fence, no stale-provenance rewrite, no operation ledger, and an audit row with exactly the two
   * keys it always had. Asserted with `deepEqual`, so a field added to the legacy branch fails here.
   */
  it('writes exactly the legacy row when a completion carries no intent', async () => {
    const updates: any[] = [];
    const links: any[] = [];
    const audits: any[] = [];
    const outboxes: any[] = [];
    const retirement = receiptRetirement();
    const expense = {
      updatedAt: new Date('2026-09-15T10:00:00Z'), id: 'expense-1', status: 'DRAFT',
      createdByUserId: 'user-1', duplicateStatus: 'NO_MATCH', primaryAttachmentId: 'att-old',
      sourceChannelMetadataJson: null, aiVerificationSummaryJson: { extractionAttachmentId: 'att-old' },
    };
    const uc = new CompleteReceiptUploadUseCase(
      {
        findById: async () => ({ ...expense }),
        runDuplicateCheck: async () => ({ openCandidates: 0, duplicateStatus: 'NO_MATCH' }),
        findByIdWithRelations: async () => ({ id: 'expense-1', primaryAttachmentId: 'att-1', attachments: [], vendorDocumentNumber: null, vendorTaxIdSnapshot: null, expenseDate: new Date(), grandTotalAmount: '0', vendorCounterpartyId: null }),
        findNearDuplicates: async () => [],
        findExpenseIdsByAttachmentChecksum: async () => [],
        createDuplicateCandidate: async () => undefined,
        linkAttachment: async (...args: unknown[]) => { links.push(args.slice(0, 3)); },
        updateExpense: async (input: any, withinTx?: (tx: any) => Promise<void>) => {
          await withinTx?.(retirement.tx);
          updates.push(input);
          return { id: input.id };
        },
      } as any,
      { execute: async () => ({ id: 'att-1' }) } as any,
      { log: async (entry: any) => { audits.push(entry); } } as any,
      { append: async (eventType: string, _t: string, _id: string, payload: any) => { outboxes.push({ eventType, payload }); } } as any,
      retirement.attachments,
      retirement.prisma,
      { resolveAccess: async () => ctx } as any,
    );

    await uc.execute(ctx, { expenseId: 'expense-1', attachmentId: 'att-1', byteSize: 123 });

    assert.deepEqual(updates, [{
      id: 'expense-1', companyId: 'co-1', updatedByUserId: 'user-1',
      expectedUpdatedAt: expense.updatedAt,
      primaryAttachmentId: 'att-1', status: 'NEEDS_REVIEW',
    }], 'no sourceStale, no aiVerificationStatus rewrite, no replaceOperations ledger');
    assert.deepEqual(links, [['expense-1', 'att-1', 'expense.receipt.primary']]);
    const uploadAudit = audits.find((entry) => entry.action === 'expense.upload.complete');
    assert.deepEqual(uploadAudit.metadataJson, { attachmentId: 'att-1', purpose: 'expense.receipt.primary' });
    assert.deepEqual(outboxes.map((event) => event.eventType), ['expense.receipt_uploaded']);
    assert.deepEqual(outboxes[0].payload.data, { expenseId: 'expense-1', attachmentId: 'att-1', purpose: 'expense.receipt.primary' });
  });

  it('flags the same verified file automatically for both web and LINE uploads', async () => {
    for (const captureSource of ['WEB_UPLOAD', 'LINE_UPLOAD']) {
      const candidates: any[] = [];
      const updates: any[] = [];
      const repo = {
        findById: async () => ({ updatedAt: new Date('2026-09-15T10:00:00Z'), id: `expense-${captureSource}`, status: 'DRAFT', createdByUserId: 'user-1', captureSource, duplicateStatus: candidates.length > 0 ? 'POSSIBLE_DUPLICATE' : 'NO_MATCH' }),
        runDuplicateCheck: async (_input: any, detectWithinTx: (tx: any) => Promise<string[]>) => {
          const matched = await detectWithinTx({ marker: 'tx' });
          return { openCandidates: matched.length, duplicateStatus: matched.length > 0 ? 'POSSIBLE_DUPLICATE' : 'NO_MATCH' };
        },
        findByIdWithRelations: async () => ({
          id: `expense-${captureSource}`, duplicateStatus: candidates.length > 0 ? 'POSSIBLE_DUPLICATE' : 'NO_MATCH',
          primaryAttachmentId: 'att-1',
          attachments: [{ id: 'att-1', purpose: 'expense.receipt.primary', checksumSha256: 'a'.repeat(64), perceptualHash: null }],
          vendorDocumentNumber: null,
          vendorTaxIdSnapshot: null,
          expenseDate: new Date(),
          grandTotalAmount: '0',
          vendorCounterpartyId: null,
        }),
        findNearDuplicates: async () => [],
        findExpenseIdsByAttachmentChecksum: async () => ['expense-existing'],
        createDuplicateCandidate: async (...args: any[]) => { candidates.push(args); },
        linkAttachment: async () => undefined,
        updateExpense: async (input: any, withinTx?: (tx: any) => Promise<void>) => {
          await withinTx?.(retirement.tx);
          updates.push(input);
          return { ...input };
        },
      } as any;
      const retirement = receiptRetirement();
      const uc = new CompleteReceiptUploadUseCase(
        repo,
        { execute: async () => ({ id: 'att-1', checksumSha256: 'a'.repeat(64) }) } as any,
        { log: async () => undefined } as any,
        { append: async () => undefined } as any,
        retirement.attachments,
        retirement.prisma,
        {resolveAccess: async () => ctx} as any,
      );

      const result = await uc.execute(
        { ...ctx, authProvider: captureSource === 'LINE_UPLOAD' ? 'line' : 'watchdog', permissions: ['expense.receipt.upload', 'expense.receipt.line_upload', 'attachment.create'] },
        { expenseId: `expense-${captureSource}`, attachmentId: 'att-1', byteSize: 123 },
      );

      assert.equal(candidates.length, 1);
      assert.deepEqual(candidates[0]?.slice(2, 5), ['expense-existing', ['same_checksum'], 40]);
      assert.equal(updates.some((update) => 'duplicateStatus' in update), false);
      assert.equal(result.duplicateStatus, 'POSSIBLE_DUPLICATE');
    }
  });

  // Owner report 2026-08-29 (UAT): "เปลี่ยนไฟล์ใบเสร็จ" appended — the wrong file stayed on the
  // record and the new one showed up as page 2 of 2, both ACTIVE primaries.
  describe('replacing the primary receipt', () => {
    const completeReplace = (options: {
      status?: string;
      primaries?: string[];
      sharedLinks?: Record<string, number>;
      holds?: string[];
      otherLinks?: Array<{ attachmentId: string; targetType: string; targetId: string }>;
    } = {}) => {
      const audits: any[] = [];
      const retirement = receiptRetirement(options);
      const uc = new CompleteReceiptUploadUseCase(
        {
          findById: async () => ({ updatedAt: new Date('2026-09-15T10:00:00Z'), id: 'expense-1', status: options.status ?? 'NEEDS_REVIEW', createdByUserId: 'user-1', duplicateStatus: 'NO_MATCH' }),
          runDuplicateCheck: async () => ({ openCandidates: 0, duplicateStatus: 'NO_MATCH' }),
          findByIdWithRelations: async () => ({
            id: 'expense-1', primaryAttachmentId: 'att-new', attachments: [],
            vendorDocumentNumber: null, vendorTaxIdSnapshot: null, expenseDate: new Date(),
            grandTotalAmount: '0', vendorCounterpartyId: null,
          }),
          findNearDuplicates: async () => [],
          findExpenseIdsByAttachmentChecksum: async () => [],
          createDuplicateCandidate: async () => undefined,
          linkAttachment: async () => undefined,
          updateExpense: async (input: any, withinTx?: (tx: any) => Promise<void>) => { await withinTx?.(retirement.tx); return { id: input.id }; },
        } as any,
        { execute: async () => ({ id: 'att-new' }) } as any,
        { log: async (entry: any) => { audits.push(entry); } } as any,
        { append: async () => undefined } as any,
        retirement.attachments,
        retirement.prisma,
        {resolveAccess: async () => ctx} as any,
      );
      return { uc, retirement, audits };
    };

    const run = (harness: ReturnType<typeof completeReplace>) => harness.uc.execute(
      { ...ctx, permissions: ['expense.receipt.upload', 'expense.receipt.line_upload', 'attachment.create'] },
      { expenseId: 'expense-1', attachmentId: 'att-new', purpose: 'expense.receipt.primary', byteSize: 123 },
    );

    it('retires the file it replaces while the record is still a draft — unlinked and soft-deleted, never hard-deleted', async () => {
      const harness = completeReplace({ status: 'NEEDS_REVIEW', primaries: ['att-old', 'att-new'] });
      await run(harness);
      assert.deepEqual(harness.retirement.unlinked, ['att-old'], 'the replaced receipt leaves the expense');
      assert.deepEqual(harness.retirement.softDeleted, ['att-old'], 'the object is soft-deleted, so the bytes and the row survive');
      const complete = harness.audits.find((entry) => entry.action === 'expense.upload.complete');
      assert.deepEqual(complete?.metadataJson?.replacedAttachmentIds, ['att-old'], 'the swap is on the audit trail');
    });

    it('leaves an approver-visible record alone — a receipt already sent for confirmation keeps its files', async () => {
      const harness = completeReplace({ status: 'READY_FOR_CONFIRMATION', primaries: ['att-old', 'att-new'] });
      await run(harness);
      assert.deepEqual(harness.retirement.unlinked, []);
      assert.deepEqual(harness.retirement.softDeleted, []);
      const complete = harness.audits.find((entry) => entry.action === 'expense.upload.complete');
      assert.equal(complete?.metadataJson?.replacedAttachmentIds, undefined);
    });

    it('keeps a file a certified substitute receipt retains, and one another record also links', async () => {
      const held = completeReplace({ primaries: ['att-old', 'att-new'], holds: ['att-old'] });
      await run(held);
      assert.deepEqual(held.retirement.softDeleted, [], 'retention hold wins over the replace');

      const shared = completeReplace({ primaries: ['att-old', 'att-new'], sharedLinks: { 'att-old': 1 } });
      await run(shared);
      assert.deepEqual(shared.retirement.softDeleted, [], 'a file another record points at is not ours to retire');
    });

    // Capture appendix §5: a file a capture group still lists is SHARED evidence. The replace path
    // must see the new `expense.capture_group` target through the same count it already runs — if
    // that clause ever narrows to `expense.record`, the group's manifest loses its bytes.
    it('keeps a file the capture group still links, through the existing shared-link count', async () => {
      const harness = completeReplace({
        primaries: ['att-old', 'att-new'],
        otherLinks: [{ attachmentId: 'att-old', targetType: 'expense.capture_group', targetId: 'group-1' }],
      });
      await run(harness);
      assert.deepEqual(harness.retirement.softDeleted, [], 'the group still needs this file');
      assert.deepEqual(harness.retirement.unlinked, []);
    });

    it('retires a file no capture group links, even when the group links a different one', async () => {
      const harness = completeReplace({
        primaries: ['att-old', 'att-new'],
        otherLinks: [{ attachmentId: 'att-other', targetType: 'expense.capture_group', targetId: 'group-1' }],
      });
      await run(harness);
      assert.deepEqual(harness.retirement.softDeleted, ['att-old']);
    });

    it('does nothing on a first upload — there is no earlier receipt to retire', async () => {
      const harness = completeReplace({ status: 'DRAFT', primaries: ['att-new'] });
      await run(harness);
      assert.deepEqual(harness.retirement.unlinked, []);
      assert.deepEqual(harness.retirement.softDeleted, []);
    });

    it('leaves supporting and payment evidence untouched — only the primary slot is replaced', async () => {
      const harness = completeReplace({ primaries: ['att-old', 'att-new'] });
      await harness.uc.execute(
        { ...ctx, permissions: ['expense.receipt.upload', 'expense.receipt.line_upload', 'attachment.create'] },
        { expenseId: 'expense-1', attachmentId: 'att-new', purpose: 'expense.receipt.supporting', byteSize: 123 },
      );
      assert.deepEqual(harness.retirement.unlinked, []);
      assert.deepEqual(harness.retirement.softDeleted, []);
    });
  });

  /**
   * Spec §16.4 as the server enforces it: which state may change a receipt, which one may only add
   * to it, and what a retry of a lost answer is allowed to do. Every case here is a 409 the UI
   * cannot fake its way around — the checks run before the bytes are even verified.
   */
  describe('file intents: replace and append (§16.4)', () => {
    const NOW = new Date('2026-09-18T10:00:00.000Z');

    function intentHarness(options: {
      expense?: Record<string, unknown>;
      certificate?: { status: string } | null;
      liveClaim?: boolean;
      permissions?: string[];
    } = {}) {
      const audits: any[] = [];
      const updates: any[] = [];
      const completionActors: any[] = [];
      const retirement = receiptRetirement({ primaries: ['att-old', 'att-new'] });
      const expense = {
        id: 'expense-1', updatedAt: NOW, status: 'NEEDS_REVIEW', createdByUserId: 'user-1',
        duplicateStatus: 'NO_MATCH', primaryAttachmentId: 'att-old', paymentStatus: 'UNPAID',
        paidAmount: '0', postingStatus: 'not_required', aiVerificationSummaryJson: null,
        sourceChannelMetadataJson: null, captureSource: 'WEB_UPLOAD', lineMessageId: null,
        ...options.expense,
      };
      const prisma = {
        client: {
          user: { findFirst: async () => ({ id: 'user-1' }) },
          $transaction: async (run: any) => run(retirement.tx),
          expenseSubstituteReceiptEvidence: { findFirst: async ({ where }: any) => (
            options.certificate && where.status.in.includes(options.certificate.status) ? { id: 'ev-1' } : null) },
          reimbursementLine: { findFirst: async () => (options.liveClaim ? { id: 'line-1' } : null) },
        },
      } as any;
      const ctxWithPermissions = {
        ...ctx, authProvider: 'watchdog',
        permissions: options.permissions ?? ['expense.receipt.upload', 'attachment.create'],
      };
      const uc = new CompleteReceiptUploadUseCase(
        {
          findById: async () => expense,
          runDuplicateCheck: async () => ({ openCandidates: 0, duplicateStatus: 'NO_MATCH' }),
          findByIdWithRelations: async () => ({
            id: 'expense-1', primaryAttachmentId: 'att-new', attachments: [],
            vendorDocumentNumber: null, vendorTaxIdSnapshot: null, expenseDate: new Date(),
            grandTotalAmount: '0', vendorCounterpartyId: null,
          }),
          findNearDuplicates: async () => [],
          findExpenseIdsByAttachmentChecksum: async () => [],
          createDuplicateCandidate: async () => undefined,
          linkAttachment: async () => undefined,
          updateExpense: async (input: any, withinTx?: (tx: any) => Promise<void>) => {
            await withinTx?.(retirement.tx);
            updates.push(input);
            return { id: input.id };
          },
        } as any,
        { execute: async (actor: any) => { completionActors.push(actor); return { id: 'att-new', uploadedByUserId: actor.userId }; } } as any,
        { log: async (entry: any) => { audits.push(entry); } } as any,
        { append: async () => undefined } as any,
        retirement.attachments,
        prisma,
        { resolveAccess: async () => ctxWithPermissions } as any,
      );
      const run = (cmd: Record<string, unknown>) => uc.execute(ctxWithPermissions, {
        expenseId: 'expense-1', attachmentId: 'att-new', byteSize: 123, ...cmd,
      } as any);
      return { run, updates, audits, retirement, completionActors, ctxWithPermissions };
    }

    const conflictCode = async (run: Promise<unknown>) => run.then(
      () => 'no-conflict',
      (error: any) => error.getResponse?.()?.code ?? error.message,
    );

    it('refuses a replace whose target primary is no longer the current one', async () => {
      const { run, updates } = intentHarness();
      assert.equal(
        await conflictCode(run({ intent: 'replace', expectedUpdatedAt: NOW.toISOString(), expectedPrimaryAttachmentId: 'att-someone-else' })),
        'expense_receipt_replace_conflict',
      );
      assert.deepEqual(updates, [], 'nothing was written');
    });

    it('refuses a replace that names no revision, and one that names a stale revision', async () => {
      for (const cmd of [
        { intent: 'replace', expectedPrimaryAttachmentId: 'att-old' },
        { intent: 'replace', expectedUpdatedAt: '2026-09-18T09:00:00.000Z', expectedPrimaryAttachmentId: 'att-old' },
      ]) {
        const { run, updates } = intentHarness();
        assert.equal(await conflictCode(run(cmd)), 'expense_revision_conflict');
        assert.deepEqual(updates, []);
      }
    });

    it('R1 reviewer completes their own receipt upload', async () => {
      const h = intentHarness({ expense: { createdByUserId: 'another-creator' }, permissions: ['expense.review', 'attachment.create'] });
      await h.run({ intent: 'replace', expectedUpdatedAt: NOW.toISOString(), expectedPrimaryAttachmentId: 'att-old' });
      assert.deepEqual(h.completionActors, [h.ctxWithPermissions]);
      assert.equal(h.completionActors[0].userId, 'user-1');
    });

    it('returns a record already sent for confirmation to review, for a reviewer only', async () => {
      const reviewer = intentHarness({
        expense: { status: 'READY_FOR_CONFIRMATION' },
        permissions: ['expense.review', 'attachment.create'],
      });
      await reviewer.run({ intent: 'replace', expectedUpdatedAt: NOW.toISOString(), expectedPrimaryAttachmentId: 'att-old' });
      assert.equal(reviewer.updates[0].status, 'NEEDS_REVIEW', 'READY may not survive its own evidence being swapped');
      const audited = reviewer.audits.find((entry) => entry.action === 'expense.upload.complete');
      assert.deepEqual(
        [audited?.metadataJson?.intent, audited?.metadataJson?.statusFrom, audited?.metadataJson?.statusTo],
        ['replace', 'READY_FOR_CONFIRMATION', 'NEEDS_REVIEW'],
      );

      const uploader = intentHarness({ expense: { status: 'READY_FOR_CONFIRMATION' } });
      assert.equal(
        await conflictCode(uploader.run({ intent: 'replace', expectedUpdatedAt: NOW.toISOString(), expectedPrimaryAttachmentId: 'att-old' })),
        'expense_receipt_replace_locked',
      );
      assert.deepEqual(uploader.updates, []);
    });

    it('file intent × state: paid open drafts allow append only; posting and final states refuse both', async () => {
      const states = [
        ...['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].flatMap(status => [
          { state: { status, paymentStatus: 'UNPAID', paidAmount: '0' }, append: true, replace: true },
          { state: { status, paymentStatus: 'PARTIALLY_PAID', paidAmount: '50' }, append: true, replace: false },
          { state: { status, paymentStatus: 'PAID', paidAmount: '100' }, append: true, replace: false },
          { state: { status, paymentStatus: 'UNPAID', paidAmount: '50' }, append: true, replace: false },
          { state: { status, postingStatus: 'posted' }, append: false, replace: false },
          { state: { status, postingStatus: 'posted', paymentStatus: 'PAID', paidAmount: '100' }, append: false, replace: false },
        ]),
        ...['CONFIRMED', 'REJECTED', 'VOIDED'].map(status => ({ state: { status }, append: false, replace: false })),
      ];
      for (const { state, ...allowed } of states) for (const intent of ['replace', 'append'] as const) {
        const { run, updates, audits, retirement } = intentHarness({ expense: state, permissions: ['expense.receipt.upload', 'attachment.create', 'expense.review'] });
        const outcome = await conflictCode(run({ intent, expectedUpdatedAt: NOW.toISOString(), expectedPrimaryAttachmentId: 'att-old' }));
        assert.equal(outcome, allowed[intent] ? 'no-conflict' : 'expense_receipt_replace_locked', `${intent} ${JSON.stringify(state)}`);
        assert.equal(updates.length, allowed[intent] ? 1 : 0);
        if (allowed[intent] && intent === 'append') {
          assert.equal(updates[0].primaryAttachmentId, undefined);
          assert.deepEqual(retirement.softDeleted, []);
          const audit = audits.find(entry => entry.action === 'expense.upload.complete');
          assert.equal(audit.actorUserId, ctx.userId);
          assert.equal(audit.metadataJson.intent, 'append');
          assert.equal(audit.metadataJson.attachmentId, 'att-new');
        }
      }
    });

    it('paid append still respects signed certificate and live claim locks', async () => {
      for (const status of ['PAYER_CERTIFIED', 'ISSUED']) {
        const h = intentHarness({ expense: { paymentStatus: 'PAID', paidAmount: '100' }, certificate: { status } });
        assert.equal(await conflictCode(h.run({ intent: 'append', expectedUpdatedAt: NOW.toISOString() })), 'substitute_evidence_locks_expense');
        assert.equal(h.updates.length, 0);
      }
      const h = intentHarness({ expense: { paymentStatus: 'PAID', paidAmount: '100' }, liveClaim: true });
      assert.equal(await conflictCode(h.run({ intent: 'append', expectedUpdatedAt: NOW.toISOString() })), 'substitute_source_has_live_claim');
      assert.equal(h.updates.length, 0);
    });

    it('a PREPARED certificate blocks the replace but still accepts supporting evidence', async () => {
      const replace = intentHarness({ certificate: { status: 'PREPARED' } });
      assert.equal(
        await conflictCode(replace.run({ intent: 'replace', expectedUpdatedAt: NOW.toISOString(), expectedPrimaryAttachmentId: 'att-old' })),
        'substitute_evidence_locks_expense',
      );

      const append = intentHarness({ certificate: { status: 'PREPARED' } });
      await append.run({ intent: 'append', expectedUpdatedAt: NOW.toISOString() });
      assert.equal(append.updates.length, 1, 'a supporting file that changes no fact is the existing flow');
      assert.equal(append.updates[0].primaryAttachmentId, undefined, 'append never moves the primary');
      assert.deepEqual(append.retirement.softDeleted, [], 'append never retires anything');

      const signed = intentHarness({ certificate: { status: 'ISSUED' } });
      assert.equal(
        await conflictCode(signed.run({ intent: 'append', expectedUpdatedAt: NOW.toISOString() })),
        'substitute_evidence_locks_expense',
      );
    });

    it('refuses either intent while a live claim points at the record', async () => {
      const { run } = intentHarness({ liveClaim: true });
      assert.equal(
        await conflictCode(run({ intent: 'replace', expectedUpdatedAt: NOW.toISOString(), expectedPrimaryAttachmentId: 'att-old' })),
        'substitute_source_has_live_claim',
      );
    });

    it('marks the kept values as read from the replaced file, without deleting them', async () => {
      const { run, updates } = intentHarness({
        expense: {
          aiVerificationSummaryJson: {
            status: 'OCR_EXTRACTED_NEEDS_REVIEW', extractionAttachmentId: 'att-old',
            recognizedFields: { vendorName: 'ร้านเดิม' },
          },
        },
      });
      await run({ intent: 'replace', expectedUpdatedAt: NOW.toISOString(), expectedPrimaryAttachmentId: 'att-old' });

      const summary = updates[0].aiVerificationSummaryJson;
      assert.equal(summary.sourceAttachmentId, 'att-old');
      assert.equal(summary.sourceStale, true);
      assert.deepEqual(summary.recognizedFields, { vendorName: 'ร้านเดิม' }, 'reviewed values survive the swap');
      assert.equal('extractionAttachmentId' in summary, false, 'the old read no longer claims a live primary');
      assert.equal(updates[0].aiVerificationStatus, 'NOT_VERIFIED');
    });

    it('answers a retried operation with the first result, and a different file with a conflict', async () => {
      const operationId = '11111111-2222-4333-8444-555555555555';
      const completed = {
        sourceChannelMetadataJson: {
          replaceOperations: [{ operationId, intent: 'replace', attachmentId: 'att-new', checksumSha256: null, at: NOW.toISOString() }],
        },
      };
      // The retry carries the revision the user saw BEFORE the first attempt landed, on purpose.
      const replay = intentHarness({ expense: completed });
      await replay.run({ intent: 'replace', operationId, expectedUpdatedAt: '2026-01-01T00:00:00.000Z', expectedPrimaryAttachmentId: 'whatever' });
      assert.deepEqual(replay.updates, [], 'the same operation writes exactly once');

      const different = intentHarness({ expense: completed });
      assert.equal(
        await conflictCode(different.run({ intent: 'replace', attachmentId: 'att-other', operationId, expectedUpdatedAt: NOW.toISOString(), expectedPrimaryAttachmentId: 'att-old' })),
        'expense_receipt_replace_operation_conflict',
      );
    });

    it('records the operation, bounded, so the history cannot grow without limit', async () => {
      const previous = Array.from({ length: 10 }, (_, index) => ({
        operationId: `op-${index}`, intent: 'replace', attachmentId: `att-${index}`, checksumSha256: null, at: NOW.toISOString(),
      }));
      const { run, updates } = intentHarness({ expense: { sourceChannelMetadataJson: { channel: 'LINE', replaceOperations: previous } } });
      await run({ intent: 'replace', operationId: '99999999-2222-4333-8444-555555555555', expectedUpdatedAt: NOW.toISOString(), expectedPrimaryAttachmentId: 'att-old' });

      const stored = updates[0].sourceChannelMetadataJson;
      assert.equal(stored.channel, 'LINE', 'the rest of the channel metadata is untouched');
      assert.equal(stored.replaceOperations.length, 10);
      assert.equal(stored.replaceOperations.at(-1).operationId, '99999999-2222-4333-8444-555555555555');
      assert.equal(stored.replaceOperations.at(0).operationId, 'op-1', 'the oldest row is the one that leaves');
    });

    it('leaves the legacy completion exactly as it was when no intent is named', async () => {
      const { run, updates, audits } = intentHarness({ expense: { status: 'READY_FOR_CONFIRMATION' }, liveClaim: true, certificate: { status: 'ISSUED' } });
      await run({});
      assert.equal(updates[0].primaryAttachmentId, 'att-new');
      assert.equal(updates[0].status, 'READY_FOR_CONFIRMATION', 'no intent, no status change');
      assert.equal(updates[0].aiVerificationSummaryJson, undefined, 'no intent, no provenance rewrite');
      assert.equal(updates[0].sourceChannelMetadataJson, undefined);
      const audited = audits.find((entry) => entry.action === 'expense.upload.complete');
      assert.equal(audited?.metadataJson?.intent, undefined);
    });

    it('refuses the two shapes that mean nothing: append onto the primary, replace of a supporting file', async () => {
      const { run } = intentHarness();
      await assert.rejects(
        () => run({ intent: 'append', purpose: 'expense.receipt.primary', expectedUpdatedAt: NOW.toISOString() }),
        /use "replace"/,
      );
      await assert.rejects(
        () => run({ intent: 'replace', purpose: 'expense.receipt.supporting', expectedUpdatedAt: NOW.toISOString() }),
        /targets the primary receipt/,
      );
    });
  });

  it('flags a visually equivalent primary receipt when its verified bytes changed', async () => {
    const created: any[] = [];
    const uc = new DuplicateCheckUseCase({
      runDuplicateCheck: async (_input: any, detectWithinTx: (tx: any) => Promise<string[]>) => {
        const matched = await detectWithinTx({ marker: 'tx' });
        return { openCandidates: matched.length, duplicateStatus: matched.length > 0 ? 'POSSIBLE_DUPLICATE' : 'NO_MATCH' };
      },
      findByIdWithRelations: async () => ({
        id: 'expense-line',
        primaryAttachmentId: 'att-line',
        attachments: [{
          id: 'att-line',
          purpose: 'expense.receipt.primary',
          checksumSha256: 'line-bytes',
          perceptualHash: '8f00aa55cc33f00f',
        }],
        vendorDocumentNumber: null,
        vendorTaxIdSnapshot: null,
        expenseDate: new Date('2026-07-29T00:00:00.000Z'),
        grandTotalAmount: '0',
        vendorCounterpartyId: null,
      }),
      findNearDuplicates: async () => [{
        id: 'expense-web',
        checksumSha256: 'web-bytes',
        perceptualHash: '8f00aa55cc33f00e',
        vendorDocumentNumber: null,
        vendorTaxId: null,
        expenseDate: '2026-07-20T00:00:00.000Z',
        grandTotalAmount: '0',
        vendorCounterpartyId: null,
      }],
      findExpenseIdsByAttachmentChecksum: async () => [],
      createDuplicateCandidate: async (...args: any[]) => { created.push(args); },
    } as any);

    const result = await uc.execute({ ...ctx, permissions: ['expense.review'] }, 'expense-line');

    assert.equal(result.candidatesCreated, 1);
    assert.deepEqual(created[0]?.slice(2, 5), ['expense-web', ['same_visual_fingerprint'], 35]);
    assert.equal(created[0]?.[5]?.marker, 'tx');
  });

  it('rechecks checksum and normalized vendor/date fields from the web review action', async () => {
    const created: any[] = [];
    const uc = new DuplicateCheckUseCase({
      runDuplicateCheck: async (_input: any, detectWithinTx: (tx: any) => Promise<string[]>) => {
        const matched = await detectWithinTx({ marker: 'tx' });
        return { openCandidates: matched.length, duplicateStatus: matched.length > 0 ? 'POSSIBLE_DUPLICATE' : 'NO_MATCH' };
      },
      findByIdWithRelations: async () => ({
        id: 'expense-1',
        primaryAttachmentId: 'att-1',
        attachments: [{ id: 'att-1', purpose: 'expense.receipt.primary', checksumSha256: 'a'.repeat(64) }],
        vendorDocumentNumber: null,
        vendorTaxIdSnapshot: '010555',
        expenseDate: new Date('2026-07-29T00:00:00.000Z'),
        grandTotalAmount: '120.00',
        vendorCounterpartyId: 'vendor-1',
      }),
      findNearDuplicates: async () => [{
        id: 'expense-existing',
        checksumSha256: 'a'.repeat(64),
        vendorDocumentNumber: null,
        vendorTaxId: '010555',
        expenseDate: '2026-07-29T00:00:00.000Z',
        grandTotalAmount: '120.00',
        vendorCounterpartyId: 'vendor-1',
      }],
      findExpenseIdsByAttachmentChecksum: async () => ['expense-existing'],
      createDuplicateCandidate: async (...args: any[]) => { created.push(args); },
    } as any);

    const result = await uc.execute({ ...ctx, permissions: ['expense.review'] }, 'expense-1');

    assert.equal(result.candidatesCreated, 1);
    assert.deepEqual(created[0]?.slice(2, 5), [
      'expense-existing',
      ['same_checksum', 'same_vendor_date_amount', 'same_vendor_tax_id_amount_near_date'],
      85,
    ]);
    assert.equal(created[0]?.[5]?.marker, 'tx');
  });

  it('carries tax evidence status into expense source posting input', async () => {
    const uc = new GetExpenseSourcePostingInputUseCase({
      findByIdWithRelations: async () => ({
        id: 'expense-1', companyId: 'co-1', branchId: null, status: 'CONFIRMED', expenseDate: new Date('2026-07-13T00:00:00.000Z'),
        uploadedAt: new Date('2026-07-13T01:00:00.000Z'),
        sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', taxEvidenceReasonCode: 'VALID_TAX_INVOICE_FIELDS',
        inputVatClaimStatus: 'CLAIMABLE', vatMode: 'VAT_INCLUDED', currency: 'THB', vatAmount: '7.0000', grandTotalAmount: '107.0000',
        lines: [], attachments: [],
      }),
    } as any);

    const result = await uc.execute({ ...ctx, authProvider: 'watchdog', permissions: ['expense.read'] }, 'expense-1');

    assert.equal(result.inputVatClaimStatus, 'CLAIMABLE');
    assert.equal(result.taxEvidenceStatus, 'USABLE_FOR_TAX');
  });
});

// The receipt-upload half of the expenses kill switch. `expenses/DEFAULT` is BLOCK_NEW_ROOT, so a
// CLOSE has to stop the upload before either durable write — the attachment intent and the draft.
describe('InitReceiptUploadUseCase launch gate', () => {
  function harness(launchGate: any) {
    const writes: string[] = [];
    const audits: any[] = [];
    const uc = new InitReceiptUploadUseCase(
      { ...branchValidation, createExpense: async () => { writes.push('expense'); return { id: 'expense-1' }; } } as any,
      { execute: async () => { writes.push('intent'); return { attachmentId: 'att-1', uploadUrl: '/upload', uploadMethod: 'PUT', expiresAt: new Date() }; } } as any,
      { log: async (entry: any) => { audits.push(entry); } } as any,
      { execute: async () => ({ mode: 'FULL' }) } as any,
      launchGate,
    );
    const run = () => uc.execute(ctx, {
      originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 123,
      expenseDate: '2026-06-27T00:00:00.000Z', captureSource: 'LINE_UPLOAD', branchId: 'branch-default',
    });
    return { run, writes, audits };
  }

  it('refuses in plain Thai, audits the denial and writes neither intent nor draft when closed', async () => {
    const { run, writes, audits } = harness({ assertLaunchRouteOpen: async () => { throw featureTemporarilyUnavailable('expenses'); } });

    await assert.rejects(run, (error: any) => {
      const body = error.getResponse();
      assert.equal(body.code, FEATURE_TEMPORARILY_UNAVAILABLE);
      assert.equal(body.message, EXPENSE_LAUNCH_ROUTE_CLOSED_MESSAGE);
      // The customer must never see which control-plane row is closed (runbook §2.3).
      assert.equal(body.message.includes('expenses'), false);
      return true;
    });

    assert.deepEqual(writes, []);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'expense.upload_intent.create');
    assert.equal(audits[0].result, 'DENIED');
    assert.deepEqual(audits[0].metadataJson, { reason: 'launch_route_closed' });
  });

  // Runbook R8 rule 2: "we could not tell" is not "the route is closed". A guard that cannot read
  // its own row must not be converted into a polite refusal that hides a broken control plane.
  it('rethrows a guard-infrastructure failure instead of refusing politely', async () => {
    const { run, writes, audits } = harness({ assertLaunchRouteOpen: async () => { throw new Error('gate read failed'); } });

    await assert.rejects(run, /gate read failed/);
    assert.deepEqual(writes, []);
    assert.equal(audits.length, 0);
  });

  it('asks for the expenses DEFAULT route and passes straight through when open', async () => {
    const asked: string[][] = [];
    const { run, writes } = harness({ assertLaunchRouteOpen: async (gateKey: string, routeKey: string) => { asked.push([gateKey, routeKey]); } });

    await run();

    assert.deepEqual(asked, [['expenses', 'DEFAULT']]);
    assert.deepEqual(writes, ['intent', 'expense']);
  });
});

describe('duplicate resolution access control', () => {
  const resolveCtx = { ...ctx, permissions: ['expense.duplicate.resolve'], authProvider: 'watchdog' } as any;

  it('passes branch scope and candidate identity into the locked repository operation and audit', async () => {
    const inputs: any[] = [];
    const auditCalls: any[] = [];
    const tx = { marker: 'tx' };
    const uc = new ResolveDuplicateUseCase(
      {
        resolveDuplicateCandidate: async (input: any, auditWithinTx: (tx: any) => Promise<void>) => {
          inputs.push(input);
          await auditWithinTx(tx);
        },
      } as any,
      { log: async (entry: any, passedTx: any) => { auditCalls.push({ entry, passedTx }); } } as any,
    );

    await uc.execute({ ...resolveCtx, scopes: { branchIds: ['branch-a'] } }, 'expense-1', 'cand-1', 'confirm', 'same receipt');

    assert.deepEqual(inputs[0].scopes, { branchIds: ['branch-a'] });
    assert.equal(inputs[0].candidateId, 'cand-1');
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].passedTx, tx);
    assert.equal(auditCalls[0].entry.action, 'expense.duplicate.confirm');
    assert.equal(auditCalls[0].entry.metadataJson.candidateId, 'cand-1');
    assert.equal(auditCalls[0].entry.metadataJson.reason, 'same receipt');
  });

  it('does not write an audit when the repository rejects the locked scope check', async () => {
    let auditCalls = 0;
    const uc = new ResolveDuplicateUseCase(
      { resolveDuplicateCandidate: async () => { throw new Error('Branch is outside your assigned branch scope.'); } } as any,
      { log: async () => { auditCalls += 1; } } as any,
    );

    await assert.rejects(() => uc.execute(resolveCtx, 'expense-1', 'cand-1', 'dismiss', 'not a duplicate'), /branch scope/i);
    assert.equal(auditCalls, 0);
  });

  it('requires a bounded reason before entering the repository transaction', async () => {
    let writes = 0;
    const uc = new ResolveDuplicateUseCase(
      { resolveDuplicateCandidate: async () => { writes += 1; } } as any,
      { log: async () => undefined } as any,
    );

    await assert.rejects(() => uc.execute(resolveCtx, 'expense-1', 'cand-1', 'confirm', '  '), /at least 3 characters/i);
    await assert.rejects(() => uc.execute(resolveCtx, 'expense-1', 'cand-1', 'dismiss', 'x'.repeat(501)), /at most 500 characters/i);
    assert.equal(writes, 0);
  });
});

describe('expense checksum duplicate lookup', () => {
  it('matches primary receipt links across channels and excludes voided records', async () => {
    const calls: any = {};
    const repo = new PrismaExpenseRepository({
      client: {
        attachmentObject: {
          findMany: async (args: any) => {
            calls.attachments = args;
            return [{ id: 'att-web' }];
          },
        },
        attachmentLink: {
          findMany: async (args: any) => {
            calls.links = args;
            return [{ targetId: 'expense-web' }];
          },
        },
        expenseRecord: {
          findMany: async (args: any) => {
            calls.expenses = args;
            return [{ id: 'expense-web' }];
          },
        },
      },
    } as any);

    const result = await repo.findExpenseIdsByAttachmentChecksum(
      'co-1',
      'expense-line',
      'a'.repeat(64),
      undefined,
      { branchIds: ['branch-a'] },
    );

    assert.deepEqual(result, ['expense-web']);
    assert.equal(calls.attachments.where.companyId, 'co-1');
    assert.equal(calls.links.where.purpose, 'expense.receipt.primary');
    assert.equal(calls.links.where.targetId.not, 'expense-line');
    assert.equal(calls.expenses.where.status.not, 'VOIDED');
    assert.deepEqual(calls.expenses.where.OR, [{ branchId: { in: ['branch-a'] } }, { branchId: null }]);
  });

  it('loads the primary receipt perceptual hash for the bounded duplicate scan', async () => {
    const calls: any = {};
    const repo = new PrismaExpenseRepository({
      client: {
        expenseRecord: {
          findMany: async (args: any) => {
            calls.expenses = args;
            return [{
              id: 'expense-web',
              primaryAttachmentId: 'att-web',
              vendorDocumentNumber: null,
              vendorTaxIdSnapshot: null,
              vendorNameSnapshot: 'ร้านกาแฟทดสอบ',
              expenseDate: new Date('2026-07-29T00:00:00.000Z'),
              grandTotalAmount: { toString: () => '120.00' },
              vendorCounterpartyId: null,
            }];
          },
        },
        attachmentObject: {
          findMany: async (args: any) => {
            calls.attachments = args;
            return [{ id: 'att-web', checksumSha256: 'web-bytes', perceptualHash: '8f00aa55cc33f00e' }];
          },
        },
      },
    } as any);

    const result = await repo.findNearDuplicates(
      'co-1',
      'expense-line',
      new Date('2026-01-01'),
      undefined,
      { branchIds: ['branch-a'] },
    );

    assert.equal(calls.attachments.select.perceptualHash, true);
    assert.equal(calls.expenses.select.vendorNameSnapshot, true);
    assert.deepEqual(calls.expenses.orderBy, { createdAt: 'desc' });
    assert.deepEqual(calls.expenses.where.OR, [{ branchId: { in: ['branch-a'] } }, { branchId: null }]);
    assert.equal(result[0]?.perceptualHash, '8f00aa55cc33f00e');
    assert.equal(result[0]?.vendorName, 'ร้านกาแฟทดสอบ');
  });
});

describe('LINE receipt durable identity and reserved attachment recovery', () => {
  it('recovers the original draft and reservation across a crash after each durable boundary', async () => {
    for (const failAfterReservation of [false, true]) {
      const expenses: any[] = [];
      const attachments: any[] = [];
      let fail = true;
      let resumes = 0;
      const repo = {
        ...branchValidation,
        findByLineMessageId: async (companyId: string, lineMessageId: string) => expenses.find((row) => row.companyId === companyId && row.lineMessageId === lineMessageId) ?? null,
        createExpense: async (input: any) => { const row = { ...input, id: 'durable-expense' }; expenses.push(row); return row; },
      };
      const createIntent = {
        execute: async (_ctx: any, input: any) => {
          assert.equal(expenses.length, 1, 'provider identity is durable before an attachment can be reserved');
          if (fail && !failAfterReservation) { fail = false; throw new Error('reservation unavailable'); }
          attachments.push({ id: 'reserved-image', ...input });
          if (fail) { fail = false; throw new Error('process lost the reservation response'); }
          return { attachmentId: 'reserved-image', uploadUrl: '/upload', uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: new Date() };
        },
        resume: async (_ctx: any, id: string) => { resumes += 1; return { attachmentId: id, uploadRequired: false, uploadUrl: '', uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: new Date() }; },
      };
      const prisma = { client: { $transaction: async (run: any) => run({
        $executeRaw: async () => undefined,
        attachmentObject: { findFirst: async ({ where }: any) => attachments.find((row) => row.metadataJson?.lineReceiptExpenseId === where.metadataJson.equals) ?? null },
      }) } };
      const construct = () => new InitReceiptUploadUseCase(repo as any, createIntent as any, { log: async () => {} } as any,
        { execute: async () => ({ mode: 'FULL' }) } as any, openLaunchGate, prisma as any);
      const command = { originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 123, expenseDate: '2026-09-07',
        branchId: 'branch-default', captureSource: 'LINE_UPLOAD' as const,
        lineCapture: { lineMessageId: 'immutable-message', lineEventId: 'original-event', chatKeyHash: 'chat-hash' } };
      await assert.rejects(() => construct().execute(ctx, command));
      assert.equal(expenses.length, 1);
      assert.equal(expenses[0].lineMessageId, 'immutable-message');
      const result = await construct().execute(ctx, { ...command, lineCapture: { ...command.lineCapture, lineEventId: 'redelivered-event' } });
      assert.equal(expenses.length, 1, 'new webhook identity cannot create another expense');
      assert.equal(attachments.length, 1, 'reservation response loss cannot create another attachment');
      assert.equal(expenses[0].lineEventId, 'original-event', 'the capture keeps its originating event');
      assert.equal(result.expenseId, 'durable-expense');
      assert.equal(result.attachmentId, 'reserved-image');
      assert.equal(resumes, failAfterReservation ? 1 : 0);
      if (failAfterReservation) assert.equal(result.uploadRequired, false, 'existing durable bytes are not uploaded again');
    }
  });

  it('does not let another uploader resume a scoped provider message', async () => {
    const uc = new InitReceiptUploadUseCase({
      ...branchValidation,
      findByLineMessageId: async () => ({ id: 'existing', createdByUserId: 'someone-else', branchId: 'branch-default' }),
    } as any, { execute: async () => { throw new Error('must not reserve an attachment'); } } as any,
    { log: async () => {} } as any, { execute: async () => ({ mode: 'FULL' }) } as any, openLaunchGate);
    await assert.rejects(() => uc.execute(ctx, { originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 123,
      expenseDate: '2026-09-07', branchId: 'branch-default', captureSource: 'LINE_UPLOAD',
      lineCapture: { lineMessageId: 'same-message', lineEventId: 'event', chatKeyHash: 'chat' } }), /Forbidden/);
  });
});


describe('receipt document date at intake', () => {
  for (const supplied of [undefined, '2026-09-12']) it(`keeps ${supplied ?? 'missing date'} distinct from the intake day`, async () => {
    let created: any;
    const uc = new InitReceiptUploadUseCase(
      { ...branchValidation, createExpense: async (input: any) => { created = input; return { id: 'date-test' }; } } as any,
      { execute: async () => ({ attachmentId: 'att', uploadUrl: '/upload', uploadMethod: 'PUT', expiresAt: new Date() }) } as any,
      { log: async () => undefined } as any,
      { execute: async () => ({ mode: 'SIMPLE' }) } as any, openLaunchGate,
    );
    await uc.execute(ctx, { originalFileName: 'receipt.png', mimeType: 'image/png', byteSize: 1, branchId: 'branch-default', ...(supplied ? { expenseDate: supplied } : {}) });
    const summary = created.aiVerificationSummaryJson;
    assert.equal(summary.dateStatus, supplied ? 'verified' : 'unverified');
    if (supplied) {
      assert.equal(created.expenseDate.toISOString().slice(0, 10), supplied);
      assert.equal(summary.dateResolution.expenseDate, supplied);
      assert.equal(summary.dateResolution.resolvedByUserId, ctx.userId);
    } else {
      assert.deepEqual(summary.missingFields, ['expenseDate']);
      assert.equal(summary.dateResolution, undefined);
    }
  });
});

/**
 * Vendor-address §8 Slice 2: "ยืนยันว่าใช้ได้ พร้อมเหตุผล". A person's judgement on a live MISMATCH,
 * audited, and nothing else — no claim or tax-evidence column moves (E11).
 */
describe('buyer-match confirm with reason', () => {
  const confirmCtx = { ...ctx, permissions: ['expense.confirm'], authProvider: 'watchdog', scopes: { branchIds: ['branch-a'] } } as any;
  const MISMATCH = {
    name: 'บริษัท ร้านอื่น จำกัด', addressText: '99 ถนนสีลม 10500', matchStatus: 'MISMATCH', reasons: ['NAME', 'POSTAL_CODE'],
    differences: [{ reason: 'NAME', printed: 'บริษัท ร้านอื่น จำกัด', registered: 'บริษัท มั่งมีพลัส จำกัด' }], checkedAt: '2026-09-21T00:00:00.000Z',
  };

  it('is guarded by expense.confirm on the route and in the use case', async () => {
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ExpenseController.prototype.confirmBuyerMatch), ['expense.confirm']);
    let writes = 0;
    const uc = new ConfirmBuyerMatchUseCase({ confirmBuyerMatch: async () => { writes += 1; } } as any, { log: async () => undefined } as any);
    await assert.rejects(() => uc.execute({ ...confirmCtx, permissions: ['expense.review'] }, 'expense-1', 'เหตุผล'), ForbiddenException);
    assert.equal(writes, 0);
  });

  it('refuses a missing, blank or over-long reason with a code the web puts into words', async () => {
    let writes = 0;
    const uc = new ConfirmBuyerMatchUseCase({ confirmBuyerMatch: async () => { writes += 1; } } as any, { log: async () => undefined } as any);
    for (const reason of [undefined, '', '   ', 'ก'.repeat(501)]) {
      await assert.rejects(() => uc.execute(confirmCtx, 'expense-1', reason), (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal((error.getResponse() as { code: string }).code, 'expense_buyer_match_reason_required');
        return true;
      });
    }
    assert.equal(writes, 0);
  });

  it('passes the trimmed reason and branch scope to the locked write, and audits the mismatch without printed values', async () => {
    const inputs: any[] = [];
    const audits: any[] = [];
    const tx = { marker: 'tx' };
    const uc = new ConfirmBuyerMatchUseCase(
      { confirmBuyerMatch: async (input: any, auditWithinTx: (tx: any, confirmed: any) => Promise<void>) => {
        inputs.push(input);
        await auditWithinTx(tx, { ...MISMATCH, overrideReason: input.reason });
      } } as any,
      { log: async (entry: any, passedTx: any) => { audits.push({ entry, passedTx }); } } as any,
    );

    await uc.execute(confirmCtx, 'expense-1', '  ผู้ขายยืนยันทางอีเมลว่าออกให้บริษัทเรา  ');

    assert.equal(inputs[0].reason, 'ผู้ขายยืนยันทางอีเมลว่าออกให้บริษัทเรา');
    assert.deepEqual(inputs[0].scopes, { branchIds: ['branch-a'] });
    assert.equal(audits[0].passedTx, tx, 'the audit row commits with the override or not at all');
    assert.equal(audits[0].entry.action, 'expense.buyer_match.confirm');
    assert.deepEqual(audits[0].entry.metadataJson, { matchStatus: 'MISMATCH', reasons: ['NAME', 'POSTAL_CODE'] });
    assert.doesNotMatch(JSON.stringify(audits[0].entry), /ร้านอื่น|ถนนสีลม|10500/, 'no printed name or address in the audit');
  });

  function repoWith(row: Record<string, unknown> | null, updatedCount = 1) {
    const writes: any[] = [];
    const tx = {
      expenseRecord: {
        findFirst: async () => row,
        updateMany: async (args: any) => { writes.push(args); return { count: updatedCount }; },
      },
    };
    const client = { $transaction: async (work: (db: typeof tx) => Promise<unknown>) => work(tx) };
    return { repo: new PrismaExpenseRepository({ client } as any), writes };
  }
  const input = { companyId: 'co-1', expenseId: 'expense-1', actorUserId: 'user-1', reason: 'เหตุผล', scopes: { branchIds: ['branch-a'] } };
  const row = { branchId: 'branch-a', status: 'CONFIRMED', postingStatus: 'posted', buyerAsPrintedJson: MISMATCH, updatedAt: new Date('2026-09-21T03:00:00.000Z') };

  it('writes the override on a live MISMATCH in any status a person can still act on, CAS-fenced on updatedAt', async () => {
    const { repo, writes } = repoWith(row);
    let audited: any;
    await repo.confirmBuyerMatch(input, async (_tx, confirmed) => { audited = confirmed; });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].where, { id: 'expense-1', companyId: 'co-1', updatedAt: row.updatedAt });
    assert.equal(writes[0].data.buyerAsPrintedJson.overrideReason, 'เหตุผล');
    assert.equal(writes[0].data.buyerAsPrintedJson.overriddenByUserId, 'user-1');
    assert.equal(writes[0].data.buyerAsPrintedJson.matchStatus, 'MISMATCH');
    assert.deepEqual(Object.keys(writes[0].data).sort(), ['buyerAsPrintedJson', 'updatedByUserId'], 'E11: nothing but the annotation');
    assert.equal(audited.overrideReason, 'เหตุผล');
  });

  it('refuses anything that is not a live MISMATCH with expense_buyer_match_not_mismatch', async () => {
    for (const buyerAsPrintedJson of [null, { ...MISMATCH, matchStatus: 'MATCH' }, { ...MISMATCH, matchStatus: 'UNCHECKED' }]) {
      const { repo, writes } = repoWith({ ...row, buyerAsPrintedJson });
      await assert.rejects(() => repo.confirmBuyerMatch(input, async () => undefined), (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal((error.getResponse() as { code: string }).code, 'expense_buyer_match_not_mismatch');
        return true;
      });
      assert.equal(writes.length, 0);
    }
  });

  it('refuses a voided or reversed expense, a branch outside scope, and a record that moved', async () => {
    for (const moved of [{ status: 'VOIDED' }, { postingStatus: 'reversed' }]) {
      const { repo } = repoWith({ ...row, ...moved });
      await assert.rejects(() => repo.confirmBuyerMatch(input, async () => undefined), BadRequestException);
    }
    const outside = repoWith({ ...row, branchId: 'branch-b' });
    await assert.rejects(() => outside.repo.confirmBuyerMatch(input, async () => undefined), ForbiddenException);
    const stale = repoWith(row, 0);
    let audits = 0;
    await assert.rejects(() => stale.repo.confirmBuyerMatch(input, async () => { audits += 1; }), ConflictException);
    assert.equal(audits, 0, 'no audit for an override that never landed');
  });
});

// Lane B uses the registered upload suite so CI executes these without changing package.json.
describe('LinkLinePaymentEvidenceUseCase', () => {
  function fixture() {
    const now = new Date(), receiptAt = new Date(now.getTime() - 60_000);
    const base = { companyId: 'co-1', createdByUserId: 'user-1', branchId: 'branch-1', captureSource: 'LINE_UPLOAD',
      status: 'DRAFT', expenseDate: new Date('2026-10-13'), grandTotalAmount: new Decimal('500.8000'),
      paidAmount: new Decimal(0), paymentStatus: 'UNPAID', postingStatus: 'not_required', currency: 'THB',
      reviewedAt: null, sourceReimbursementRequestId: null, reservedByDisbursementVoucherId: null,
      sourceChannelMetadataJson: { chatKeyHash: 'chat-1' }, updatedAt: receiptAt,
      aiVerificationSummaryJson: { recognizedFields: { expenseDate: '2026-10-13' }, missingFields: [] } };
    const rows = new Map<string, any>([
      ['receipt', { ...base, id: 'receipt', sourceDocumentType: 'RECEIPT', createdAt: receiptAt,
        primaryAttachmentId: 'receipt-file', lineMessageId: 'receipt-message', vendorNameSnapshot: 'ร้านอาหาร' }],
      ['slip', { ...base, id: 'slip', sourceDocumentType: 'TRANSFER_SLIP', createdAt: now,
        primaryAttachmentId: 'slip-file', lineMessageId: 'slip-message', vendorNameSnapshot: 'TANG FU JAS' }],
    ]);
    let links: any[] = [ { companyId: 'co-1', targetType: 'expense.record', targetId: 'receipt', attachmentId: 'receipt-file', purpose: 'expense.receipt.primary' },
      { companyId: 'co-1', targetType: 'expense.record', targetId: 'slip', attachmentId: 'slip-file', purpose: 'expense.receipt.primary' } ];
    const audits: any[] = [], options = { failAudit: false, retention: false, dependency: false, revoked: false, scopes: {} as { branchIds?: string[] } };
    const match = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
      if (key === 'OR') return value.some((entry: any) => match(row, entry));
      if (key === 'sourceChannelMetadataJson') return row.sourceChannelMetadataJson?.chatKeyHash === value.equals;
      if (key === 'createdAt') return (!value.gte || row.createdAt >= value.gte) && (!value.lte || row.createdAt <= value.lte);
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('in' in value) return value.in.includes(row[key]);
        if ('not' in value) return row[key] !== value.not;
      }
      return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
    });
    const db: any = {
      $executeRaw: async () => 0,
      expenseRecord: {
        findFirst: async ({ where }: any) => [...rows.values()].find(row => match(row, where)) ?? null,
        findMany: async ({ where }: any) => [...rows.values()].filter(row => match(row, where)).sort((a, b) => b.createdAt - a.createdAt),
        updateMany: async ({ where, data }: any) => { const row = [...rows.values()].find(row => match(row, where)); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
      },
      attachmentLink: {
        findMany: async ({ where }: any) => links.filter(row => match(row, where)),
        findFirst: async ({ where }: any) => links.find(row => match(row, where)) ?? null,
        deleteMany: async ({ where }: any) => { const kept = links.filter(row => !match(row, where)); const count = links.length - kept.length; links = kept; return { count }; },
      },
      attachmentObject: { findFirst: async () => ({ id: 'slip-file' }) },
      expenseDuplicateCandidate: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
      expenseSubstituteReceiptEvidence: { findFirst: async () => null },
      reimbursementLine: { findFirst: async () => null },
      user: { findFirst: async () => ({ id: 'user-1' }) },
    };
    for (const name of ['taxEvent', 'taxReviewIssue', 'taxReconciliationLine', 'tradeTaxEvidence', 'journalEntry', 'journalLine', 'bankReconciliationMatch',
      'workflowRun', 'workflowTask', 'workflowEventInbox', 'notificationEvent']) db[name] = { findFirst: async () => options.dependency ? { id: 'dependency' } : null };
    db.$transaction = async (run: any) => {
      const beforeRows = [...rows].map(([id, row]) => [id, { ...row }] as const), beforeLinks = [...links], auditCount = audits.length;
      try { return await run(db); } catch (error) { rows.clear(); beforeRows.forEach(([id, row]) => rows.set(id, row)); links = beforeLinks; audits.length = auditCount; throw error; }
    };
    const uc = new LinkLinePaymentEvidenceUseCase({ client: db } as any, {
      linkAttachment: async (targetId: string, attachmentId: string, purpose: string, companyId: string, _actor: string, tx: unknown) => {
        assert.equal(tx, db); links.push({ targetId, attachmentId, purpose, companyId, targetType: 'expense.record' });
      },
    } as any, { findSubstituteEvidenceRetentionHold: async () => options.retention ? { id: 'hold' } : null } as any,
    { log: async (entry: any, tx: unknown) => { assert.equal(tx, db); if (options.failAudit) throw new Error('audit unavailable'); audits.push(entry); } } as any,
    { resolveAccess: async () => ({ ...ctx, scopes: options.scopes, permissions: options.revoked ? [] : ctx.permissions }) } as any);
    return { uc, rows, get links() { return links; }, audits, options };
  }

  it('atomically links evidence, retires only the slip, replays once, and undoes to the original draft without re-reading', async () => {
    const h = fixture();
    const linked = await h.uc.link(ctx, 'chat-1', 'slip');
    assert.equal(linked.kind, 'LINKED');
    if (linked.kind !== 'LINKED') throw new Error('expected link');
    assert.equal(h.rows.get('slip').status, 'VOIDED');
    assert.equal(h.rows.get('receipt').status, 'DRAFT');
    assert.equal(h.rows.get('receipt').grandTotalAmount.toString(), '500.8');
    assert.equal(h.rows.get('receipt').paymentStatus, 'UNPAID');
    assert.equal(h.links.filter(link => link.purpose === 'expense.payment.evidence').length, 1);
    assert.deepEqual(await h.uc.link(ctx, 'chat-1', 'slip'), linked);
    assert.equal(h.audits.length, 1);
    await h.uc.undo(ctx, 'chat-1', 'slip', linked.operationId);
    await h.uc.undo(ctx, 'chat-1', 'slip', linked.operationId);
    assert.equal(h.rows.get('slip').status, 'DRAFT');
    assert.equal(h.links.filter(link => link.purpose === 'expense.payment.evidence').length, 0);
    assert.equal(h.links.filter(link => link.targetId === 'slip').length, 1);
    assert.equal((await h.uc.forCapture(ctx, 'chat-1', 'slip')).kind, 'NONE', 'undo is not immediately auto-paired again');
  });

  for (const [name, patch] of [ ['other company', { companyId: 'other' }], ['other chat', { sourceChannelMetadataJson: { chatKeyHash: 'other' } }],
    ['other creator', { createdByUserId: 'other' }], ['non-editable receipt', { status: 'CONFIRMED' }],
    ['posted receipt', { postingStatus: 'posted' }] ] as const) {
    it(`refuses ${name}`, async () => {
      const h = fixture(); Object.assign(h.rows.get('receipt'), patch);
      await assert.rejects(() => h.uc.link(ctx, 'chat-1', 'slip', 'receipt'));
      assert.equal(h.rows.get('slip').status, 'DRAFT'); assert.equal(h.links.length, 2);
    });
  }
  it('keeps the sold append-after-payment rule when LINE links evidence without changing payment facts', async () => {
    const h = fixture(), receipt = h.rows.get('receipt');
    receipt.paidAmount = new Decimal(1); receipt.paymentStatus = 'PARTIALLY_PAID';
    assert.equal((await h.uc.link(ctx, 'chat-1', 'slip', 'receipt')).kind, 'LINKED');
    assert.equal(receipt.paidAmount.toString(), '1'); assert.equal(receipt.paymentStatus, 'PARTIALLY_PAID');
    assert.equal(receipt.primaryAttachmentId, 'receipt-file');
  });
  it('asks on an exact amount mismatch, and only an explicit selection associates it without changing money', async () => {
    const h = fixture(); h.rows.get('receipt').grandTotalAmount = new Decimal('500.81');
    assert.equal((await h.uc.link(ctx, 'chat-1', 'slip')).kind, 'ASK');
    assert.equal(h.links.length, 2); assert.equal(h.rows.get('slip').status, 'DRAFT');
    assert.equal((await h.uc.link(ctx, 'chat-1', 'slip', 'receipt')).kind, 'LINKED');
    assert.equal(h.rows.get('receipt').grandTotalAmount.toString(), '500.81');
  });
  it('does not overwrite existing payment evidence', async () => {
    const h = fixture(); h.links.push({ companyId: 'co-1', targetType: 'expense.record', targetId: 'receipt', attachmentId: 'another', purpose: 'expense.payment.evidence' });
    await assert.rejects(() => h.uc.link(ctx, 'chat-1', 'slip', 'receipt'));
    assert.equal(h.rows.get('slip').status, 'DRAFT');
  });
  it('refuses missing or freshly revoked permission and out-of-branch sources', async () => {
    const h = fixture();
    await assert.rejects(() => h.uc.link({ ...ctx, permissions: [] }, 'chat-1', 'slip'), ForbiddenException);
    h.options.revoked = true;
    await assert.rejects(() => h.uc.link(ctx, 'chat-1', 'slip'), ForbiddenException);
    h.options.revoked = false;
    h.options.scopes = { branchIds: ['other'] };
    await assert.rejects(() => h.uc.link(ctx, 'chat-1', 'slip'), ForbiddenException);
    assert.equal(h.links.length, 2);
  });
  it('refuses reviewed/paid slip drafts, retention holds and linked business dependencies', async () => {
    for (const kind of ['reviewed', 'paid', 'retention', 'dependency']) {
      const h = fixture();
      if (kind === 'reviewed') h.rows.get('slip').reviewedAt = new Date();
      if (kind === 'paid') h.rows.get('slip').paidAmount = new Decimal(1);
      if (kind === 'retention') h.options.retention = true;
      if (kind === 'dependency') h.options.dependency = true;
      await assert.rejects(() => h.uc.link(ctx, 'chat-1', 'slip'));
      assert.equal(h.links.length, 2); assert.equal(h.rows.get('slip').status, 'DRAFT');
    }
  });
  it('rolls back attachment, retirement and receipt revision when the in-transaction audit fails', async () => {
    const h = fixture(), original = h.rows.get('receipt').updatedAt;
    h.options.failAudit = true;
    await assert.rejects(() => h.uc.link(ctx, 'chat-1', 'slip'), /audit unavailable/);
    assert.equal(h.rows.get('receipt').updatedAt, original);
    assert.equal(h.rows.get('slip').status, 'DRAFT'); assert.equal(h.links.length, 2);
  });
  it('pairs in reverse order and never reattaches a slip deliberately kept separate', async () => {
    const h = fixture();
    h.rows.get('receipt').createdAt = new Date(h.rows.get('slip').createdAt.getTime() + 1000);
    assert.equal((await h.uc.forCapture(ctx, 'chat-1', 'receipt')).kind, 'LINKED');
    const separate = fixture(); await separate.uc.separate(ctx, 'chat-1', 'slip');
    assert.equal((await separate.uc.forCapture(ctx, 'chat-1', 'receipt')).kind, 'NONE');
  });
  it('binds undo to the exact operation and refuses after receipt confirmation', async () => {
    const h = fixture(), result = await h.uc.link(ctx, 'chat-1', 'slip');
    if (result.kind !== 'LINKED') throw new Error('expected link');
    await assert.rejects(() => h.uc.undo(ctx, 'chat-1', 'slip', 'wrong-operation'));
    h.rows.get('receipt').status = 'CONFIRMED';
    await assert.rejects(() => h.uc.undo(ctx, 'chat-1', 'slip', result.operationId));
    assert.equal(h.rows.get('slip').status, 'VOIDED');
  });
});


it('R11 upload callers preserve branch and identity', async () => {
  for (const line of [false, true]) {
    const actor = { ...ctx, authProvider: line ? 'line' : 'watchdog', scopes: { branchIds: ['branch-a'] }, permissions: ['expense.receipt.upload', 'attachment.create'] };
    const intents: any[] = [];
    const resumes: any[] = [];
    let expense: any;
    let reserved = false;
    const repo = { ...branchValidation, findByLineMessageId: async () => expense ?? null,
      createExpense: async (input: any) => { expense = { id: 'expense-1', ...input }; return expense; } };
    const prisma = { client: { $transaction: async (run: any) => run({ $executeRaw: async () => undefined,
      attachmentObject: { findFirst: async ({ where }: any) => {
        assert.equal(where.companyId, actor.companyId); assert.equal(where.uploadedByUserId, actor.userId);
        return reserved ? { id: 'att-1' } : null;
      } } }) } };
    const uc = new InitReceiptUploadUseCase(repo as any, {
      execute: async (...args: any[]) => { intents.push(args); reserved = true; return { attachmentId: 'att-1' }; },
      resume: async (...args: any[]) => { resumes.push(args); return { attachmentId: 'att-1', uploadRequired: false }; },
    } as any, { log: async () => {} } as any, { execute: async () => ({ mode: 'SIMPLE' }) } as any, openLaunchGate, prisma as any);
    const command = { branchId: 'branch-a', originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 123,
      captureSource: line ? 'LINE_UPLOAD' as const : 'WEB_UPLOAD' as const,
      ...(line ? { lineCapture: { lineMessageId: 'message-1', lineEventId: 'event-1', chatKeyHash: 'chat' } } : {}) };
    await uc.execute(actor, command);
    assert.deepEqual(intents[0][0], actor);
    assert.equal(intents[0][1].branchId, 'branch-a');
    assert.deepEqual(intents[0][2], line ? { expenseId: 'expense-1' } : undefined);
    assert.equal(expense.createdByUserId, actor.userId);
    if (line) {
      await uc.execute(actor, command);
      assert.deepEqual(resumes, [[actor, 'att-1']]);
      assert.equal(intents.length, 1);
    }
  }
});


it('R11 admitted free LINE receipt forwards its original reservation across purchase', async () => {
  for (const upgraded of [false, true]) {
    const actor = { ...ctx, scopes: { branchIds: ['branch-a'] } };
    const reservation = { eventId: 'event-free', monthKey: '2026-10', sourceRoute: 'receipt-ocr-line' as const, requestId: 'line-message' };
    const event = { id: reservation.eventId, companyId: actor.companyId, ...reservation, quotaSource: 'FREE_MONTHLY_3', succeededAt: null, billingReceiptGrantId: null };
    const db = {
      company: { findUnique: async () => ({ status: 'ACTIVE', planTerm: { tierKey: upgraded ? 'STARTER_249' : 'FREE_TRIAL_15', termEndsAt: upgraded ? new Date('2099-01-01') : new Date(0) } }) },
      billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null }, billingReceiptGrant: { findFirst: async () => null },
      packageChangeRequest: { findFirst: async () => null }, salesAttribution: { findUnique: async () => null },
      companyOcrUsageEvent: { findUnique: async () => event, findMany: async () => [event] },
      attachmentObject: { count: async () => 0, findFirst: async () => null }, $executeRaw: async () => undefined,
    };
    let expense: any;
    const repo = { ...branchValidation, commercialAccessDb: db, findByLineMessageId: async () => expense ?? null,
      createExpense: async (input: any) => { expense = { id: 'expense-free', ...input }; return expense; } };
    const calls: any[] = [];
    const uc = new InitReceiptUploadUseCase(repo as any, { execute: async (...args: any[]) => { calls.push(args); return { attachmentId: 'att-free' }; } } as any,
      { log: async () => {} } as any, { execute: async () => ({ mode: 'SIMPLE' }) } as any, openLaunchGate,
      { client: { $transaction: async (run: any) => run(db) } } as any);
    await uc.execute(actor, { branchId: 'branch-a', originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 100,
      captureSource: 'LINE_UPLOAD', lineCapture: { lineMessageId: 'line-message', lineEventId: 'webhook', chatKeyHash: 'chat' } }, { freeOcrReservation: reservation });
    assert.deepEqual(calls[0][0], actor);
    assert.equal(calls[0][1].branchId, 'branch-a');
    assert.deepEqual(calls[0][2], { expenseId: 'expense-free', freeOcrReservation: reservation });
    assert.equal(calls[0][2].freeOcrReservation, reservation);
    assert.equal(expense.createdByUserId, actor.userId);
  }
});
