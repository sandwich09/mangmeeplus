import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RemoveExpenseReceiptUseCase } from './remove-expense-receipt.use-case';

const at = new Date('2026-09-10T00:00:00Z');
const ctx = { companyId: 'company', userId: 'owner', permissions: ['expense.update'], scopes: {}, requestId: 'req' } as any;
function fixture(options: Record<string, any> = {}) {
  const writes: any[] = [], deleted: string[] = [], audit: any[] = [];
  const expense = { id: 'expense', companyId: 'company', branchId: 'branch', createdByUserId: 'owner', status: 'NEEDS_REVIEW', paymentStatus: 'UNPAID', paidAmount: { gt: () => false }, postingStatus: 'not_required', updatedAt: at, primaryAttachmentId: 'receipt', ...options.expense };
  const tx = {
    $executeRaw: async () => 1,
    expenseRecord: {
      findFirst: async ({ where }: any) => where.companyId === expense.companyId && where.id === expense.id ? expense : null,
      updateMany: async (input: any) => { writes.push(input); return { count: options.conflict ? 0 : 1 }; },
    },
    attachmentLink: {
      findMany: async () => [],
      findFirst: async ({ where }: any) => typeof where.attachmentId === 'object' ? null : options.missingFile || where.attachmentId !== 'receipt' || where.purpose !== (options.purpose ?? 'expense.receipt.primary') ? null : { attachment: { originalFileName: 'receipt.jpg' } },
      deleteMany: async ({ where }: any) => { deleted.push(where.attachmentId); },
      count: async () => options.shared ? 1 : 0,
    },
    expenseSubstituteReceiptEvidence: { findFirst: async () => options.evidence ? { id: 'evidence' } : null },
    reimbursementLine: { findFirst: async () => options.claim ? { id: 'claim' } : null },
  };
  const softDeleted: string[] = [];
  const attachments = { findSubstituteEvidenceRetentionHold: async () => options.hold ? {} : null,
    markDeleted: async ({ id }: any) => { softDeleted.push(id); } };
  const repo = { runDuplicateCheck: async () => ({ openCandidates: 0, duplicateStatus: 'NO_MATCH' }) };
  const useCase = new RemoveExpenseReceiptUseCase({ client: { $transaction: async (work: any) => work(tx) } } as any, attachments as any, repo as any, { log: async (entry: any) => { audit.push(entry); } } as any);
  return { useCase, writes, deleted, softDeleted, audit };
}
describe('remove primary receipt', () => {
  it('removes without replacement, invalidates evidence, preserves expense amounts and lines, and audits', async () => {
    const f = fixture(); await f.useCase.execute(ctx, 'expense', 'receipt', at.toISOString());
    assert.deepEqual(f.deleted, ['receipt']); assert.deepEqual(f.softDeleted, ['receipt']);
    const data = f.writes[0].data;
    assert.equal(data.primaryAttachmentId, null); assert.equal(data.aiVerificationStatus, 'NEEDS_REVIEW');
    assert.equal(data.sourceDocumentType, 'NEEDS_REVIEW'); assert.equal(data.inputVatClaimStatus, 'NON_CLAIMABLE');
    for (const key of ['lines', 'grandTotalAmount', 'vendorNameSnapshot', 'expenseDate', 'paidAt']) assert.equal(key in data, false);
    assert.equal(f.audit[0].action, 'expense.receipt.remove');
  });
  it('detaches shared files without deleting bytes used by another record', async () => {
    const f = fixture({ shared: true }); await f.useCase.execute(ctx, 'expense', 'receipt', at.toISOString());
    assert.deepEqual(f.deleted, ['receipt']); assert.deepEqual(f.softDeleted, []);
  });
  for (const [label, options, actor, id, expected] of [
    ['tenant', {}, { ...ctx, companyId: 'other' }, 'receipt', at.toISOString()],
    ['ownership', {}, { ...ctx, userId: 'other' }, 'receipt', at.toISOString()],
    ['branch', {}, { ...ctx, scopes: { branchIds: ['other'] } }, 'receipt', at.toISOString()],
    ['wrong target', {}, ctx, 'supporting-file', at.toISOString()],
    ['ready', { expense: { status: 'READY_FOR_CONFIRMATION' } }, ctx, 'receipt', at.toISOString()],
    ['paid', { expense: { paymentStatus: 'PAID' } }, ctx, 'receipt', at.toISOString()],
    ['posted', { expense: { postingStatus: 'posted' } }, ctx, 'receipt', at.toISOString()],
    ['prepared evidence', { evidence: true }, ctx, 'receipt', at.toISOString()],
    ['retained source', { hold: true }, ctx, 'receipt', at.toISOString()],
    ['claim', { claim: true }, ctx, 'receipt', at.toISOString()],
    ['stale', {}, ctx, 'receipt', '2026-09-09T00:00:00Z'],
  ] as const) it(`refuses ${label} before mutation`, async () => {
    const f = fixture(options); await assert.rejects(() => f.useCase.execute(actor, 'expense', id, expected));
    assert.equal(f.writes.length, 0); assert.equal(f.deleted.length, 0);
  });
  it('checks the atomic expense revision before detaching the link', async () => {
    const f = fixture({ conflict: true }); await assert.rejects(() => f.useCase.execute(ctx, 'expense', 'receipt', at.toISOString()));
    assert.equal(f.deleted.length, 0); assert.equal(f.audit.length, 0);
  });
  for (const purpose of ['expense.payment.evidence', 'expense.receipt.supporting', 'expense.review.evidence']) it(`removes ${purpose} without clearing primary receipt verification`, async () => {
    const f = fixture({ purpose, expense: { primaryAttachmentId: 'different-primary' } });
    await f.useCase.execute(ctx, 'expense', 'receipt', at.toISOString(), purpose);
    assert.deepEqual(f.deleted, ['receipt']);
    assert.deepEqual(Object.keys(f.writes[0].data), ['updatedByUserId']);
    assert.equal(f.audit[0].metadataJson.purpose, purpose);
  });
  it('refuses signature asset removal through the expense file endpoint', async () => {
    const f = fixture(); await assert.rejects(f.useCase.execute(ctx, 'expense', 'receipt', at.toISOString(), 'expense.signature.asset'));
    assert.equal(f.writes.length, 0);
  });
  it('allows a reviewer to remove another employee’s draft receipt', async () => {
    const f = fixture(); await f.useCase.execute({ ...ctx, userId: 'reviewer', permissions: ['expense.review'] }, 'expense', 'receipt', at.toISOString());
    assert.equal(f.deleted.length, 1);
  });
});
