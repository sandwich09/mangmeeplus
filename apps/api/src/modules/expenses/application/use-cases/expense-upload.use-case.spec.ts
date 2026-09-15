import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  InitReceiptUploadUseCase,
  CompleteReceiptUploadUseCase,
  DuplicateCheckUseCase,
  GetExpenseSourcePostingInputUseCase,
  ResolveDuplicateUseCase,
} from './expense-upload.use-case';
import { PrismaExpenseRepository, requireExpenseBranchId } from '../../infrastructure/prisma-expense.repository';
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
function receiptRetirement(options: { primaries?: string[]; sharedLinks?: Record<string, number>; holds?: string[] } = {}) {
  const unlinked: string[] = [];
  const softDeleted: string[] = [];
  const tx = {
    $executeRaw: async () => 0,
    attachmentLink: {
      findMany: async ({ where }: any) => (where.OR ? [] : options.primaries ?? [])
        .filter((id) => id !== where.attachmentId.not)
        .map((attachmentId) => ({ attachmentId })),
      count: async ({ where }: any) => options.sharedLinks?.[where.attachmentId] ?? 0,
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
