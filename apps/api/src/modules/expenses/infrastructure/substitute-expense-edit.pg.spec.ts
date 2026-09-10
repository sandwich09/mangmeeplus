import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaExpenseRepository } from './prisma-expense.repository';
import { PreviewSubstituteReceiptUseCase, composeUnsignedSubstituteReceiptFormPdf } from '../application/use-cases/substitute-receipt.use-case';
import { EXPENSE_EDIT_RESIGN_REASON } from './substitute-expense-edit';
import { RemoveExpenseReceiptUseCase } from '../application/use-cases/remove-expense-receipt.use-case';
import { PrismaAttachmentRepository } from '../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';

// Test-owned records only; DATABASE_URL is the isolated local review database.
describe('expense edit to signing and receipt removal (PostgreSQL)', () => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const prisma = { client } as any;
  const repo = new PrismaExpenseRepository(prisma);
  let companyId: string, branchId: string, userId: string;
  let seq = 0;
  const at = new Date('2026-09-09T00:00:00Z');
  before(async () => {
    companyId = (await client.company.create({ data: { name: `receipt-edit-test-${process.pid}`, registeredName: 'บริษัท ทดสอบ จำกัด', taxId: '0105569135722' } })).id;
    branchId = (await client.branch.create({ data: { companyId, code: 'HO', name: 'สำนักงานใหญ่' } })).id;
    userId = (await client.user.create({ data: { displayName: 'Receipt edit test' } })).id;
  });
  after(async () => {
    if (companyId) { await client.auditLog.deleteMany({ where: { companyId } }); await client.expenseSubstituteReceiptEvidence.deleteMany({ where: { companyId } }); await client.company.delete({ where: { id: companyId } }); }
    if (userId) await client.user.delete({ where: { id: userId } });
    await client.$disconnect();
  });
  const ctx = () => ({ companyId, userId, permissions: ['expense.review'], scopes: {}, requestId: `test-${++seq}`, authProvider: 'session' }) as any;
  async function artifact() { return client.attachmentObject.create({ data: { companyId, branchId, storageProvider: 'LOCAL', bucket: 'local', objectKey: `signature/${companyId}/${++seq}`, originalFileName: 'signature.png', mimeType: 'image/png', byteSize: 1, checksumSha256: 'b'.repeat(64), uploadedByUserId: userId, status: 'ACTIVE' } }); }
  async function source(mode = 'DIGITAL', status = 'PREPARED') {
    const cert = status !== 'PREPARED' ? await artifact() : null;
    const expense = await client.expenseRecord.create({ data: { companyId, branchId, expenseDate: at, createdByUserId: userId,
      vendorNameSnapshot: 'ร้านเดิม', status: 'NEEDS_REVIEW', accountHintKey: 'expense', sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE',
      netPayableAmount: '100', grandTotalAmount: '100', subtotalAmount: '100', taxableAmount: '100', outstandingAmount: '100',
      lines: { create: { companyId, lineNumber: 1, description: 'รายการเดิม', quantity: '1', unitPrice: '100', lineTotalAmount: '100' } } } });
    const evidence = await client.expenseSubstituteReceiptEvidence.create({ data: { companyId, branchId, expenseId: expense.id, version: 1, status: status as any,
      signatureMode: mode as any, fundingSource: 'COMPANY', documentNumber: `SRC-202609-TEST-${++seq}`, idempotencyKey: `test-${seq}`,
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'RECEIPT_UNAVAILABLE', missingReceiptReason: 'ไม่มีใบเสร็จ', businessPurpose: 'ใช้ในกิจการ',
      paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], paymentDate: at, paymentMethod: 'CASH', preparedByUserId: userId, preparedAt: at,
      expenseUpdatedAtAtPreparation: expense.updatedAt, payerUserId: mode === 'PAPER' ? null : userId, payerName: mode === 'PAPER' ? '' : 'ผู้รับรอง', payeeName: 'ร้านเดิม',
      ...(cert ? { payerPosition: '', payerSignatureAttachmentId: cert.id, payerSignatureChecksumSha256: cert.checksumSha256, certifiedArtifactAttachmentId: cert.id, certifiedArtifactChecksumSha256: cert.checksumSha256, snapshotJson: { schemaVersion: 2, company: { taxId: '0105569135722' }, expense: { grandTotalAmount: '100.0000', netPayableAmount: '100.0000', whtAmount: '0.0000' } }, snapshotChecksumSha256: 'old-snapshot', certifiedAt: at } : {}) } });
    return { expense, evidence };
  }
  const edit = (expense: any, extra: any = {}) => repo.updateExpense({ id: expense.id, companyId, updatedByUserId: userId, expectedUpdatedAt: expense.updatedAt,
    refreshSubstituteEvidence: { requestId: `edit-${++seq}` }, expenseDate: new Date('2026-08-22T00:00:00Z'), vendorNameSnapshot: 'ร้านใหม่', ...extra });
  for (const mode of ['DIGITAL', 'PAPER']) it(`${mode}: refreshes unsigned data under the same ID/number and invalidates an old form`, async () => {
    const { expense, evidence } = await source(mode);
    if (mode === 'PAPER') await composeUnsignedSubstituteReceiptFormPdf(repo, companyId, (await repo.findByIdWithRelations(companyId, expense.id))!, (await repo.findSubstituteEvidence(companyId, expense.id))!);
    await edit(expense);
    const current = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    assert.equal(current.id, evidence.id); assert.equal(current.documentNumber, evidence.documentNumber);
    assert.equal(current.paperFormSnapshotJson, null); assert.equal(current.payeeName, 'ร้านใหม่');
    const detail = (await repo.findByIdWithRelations(companyId, expense.id))!;
    assert.equal(current.expenseUpdatedAtAtPreparation.toISOString(), detail.updatedAt.toISOString());
    if (mode === 'PAPER') {
      await composeUnsignedSubstituteReceiptFormPdf(repo, companyId, detail, current);
      const fresh = (await repo.findSubstituteEvidence(companyId, expense.id))!;
      assert.equal((fresh.paperFormSnapshotJson as any).expense.expenseDate, '2026-08-22T00:00:00.000Z');
      assert.equal((fresh.paperFormSnapshotJson as any).payee.name, 'ร้านใหม่');
    } else {
      const preview = await new PreviewSubstituteReceiptUseCase(repo).execute(ctx(), expense.id, current.id, {});
      const svg = Buffer.from(preview.svgDataUrl.split(',')[1]!, 'base64').toString();
      assert.ok(svg.includes('22 ส.ค. 2569')); assert.ok(svg.includes('ร้านใหม่'));
    }
  });
  it('preserves signed history and starts an unsigned internal revision with the same number', async () => {
    const { expense, evidence } = await source('DIGITAL', 'PAYER_CERTIFIED');
    const lines = [{ lineNumber: 1, description: 'รายการใหม่', quantity: '1', unitPrice: '100', lineSubtotalAmount: '100', lineTotalAmount: '100', taxableAmount: '100', discountAmount: '0', vatAmount: '0', whtAmount: '0' }];
    await assert.rejects(repo.upsertLines(companyId, expense.id, lines as any), /Signed substitute evidence locks/);
    await repo.updateExpense({ id: expense.id, companyId, updatedByUserId: userId, expectedUpdatedAt: expense.updatedAt,
      refreshSubstituteEvidence: { requestId: 'signed-line-edit' } }, (tx) => repo.upsertLines(companyId, expense.id, lines as any, tx));
    const current = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    const old = await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(old.status, 'SUPERSEDED'); assert.equal(old.snapshotChecksumSha256, 'old-snapshot');
    assert.equal(current.status, 'PREPARED'); assert.equal(current.version, 2); assert.equal(current.documentNumber, evidence.documentNumber);
    assert.equal(current.certifiedAt, null); assert.equal(current.snapshotJson, null); assert.equal(current.artifactAttachmentId, null);
  });
  it('clears a submitted paper signature without losing the old scan association', async () => {
    const { expense, evidence } = await source('PAPER');
    await client.expenseSubstituteReceiptEvidence.update({ where: { id: evidence.id }, data: { wetSignedScanAttachmentId: `test-scan-${++seq}`, wetSignedScanChecksumSha256: 'scan-hash', paperSubmissionJson: { payer: { name: 'ผู้รับรอง' }, approver: { name: 'ผู้อนุมัติ' } } } });
    await edit(expense);
    const current = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    assert.equal(current.version, 2); assert.equal(current.wetSignedScanAttachmentId, null); assert.equal(current.paperSubmissionJson, null);
    assert.equal((await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).wetSignedScanChecksumSha256, 'scan-hash');
  });
  it('paid re-signing does not pay twice; changing paid amounts rolls the edit back', async () => {
    const { expense, evidence } = await source('DIGITAL', 'PAYER_CERTIFIED');
    const issue = (src: any, ev: any) => repo.issueSubstituteEvidence({ companyId, expenseId: src.id, evidenceId: ev.id, approverUserId: userId, approverName: 'ผู้อนุมัติ', approverPosition: '', allowSelfApproval: true, approvedAt: at, approverSignatureAttachmentId: ev.payerSignatureAttachmentId,
      expectedExpenseUpdatedAt: src.updatedAt, referencedAttachmentIds: [], expectedVersion: ev.version, expectedEvidenceUpdatedAt: ev.updatedAt,
      artifact: { storageProvider: 'LOCAL', bucket: 'local', objectKey: `tests/${companyId}/${++seq}`, objectVersionId: '1', byteSize: 1, checksumSha256: 'a'.repeat(64), originalFileName: 'issued.svg' } });
    await issue(expense, evidence);
    const paid = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    const payments = await client.expensePayment.findMany({ where: { expenseId: expense.id } });
    await assert.rejects(edit(paid, { netPayableAmount: '200', grandTotalAmount: '200' }), /Paid expense amounts/);
    assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).netPayableAmount.toString(), '100');
    await edit(paid);
    const revision = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    assert.equal(revision.correctionReason, EXPENSE_EDIT_RESIGN_REASON);
    const cert = await artifact();
    const certified = await client.expenseSubstituteReceiptEvidence.update({ where: { id: revision.id }, data: { status: 'PAYER_CERTIFIED', payerPosition: '', certifiedAt: at, payerSignatureAttachmentId: cert.id, payerSignatureChecksumSha256: cert.checksumSha256, certifiedArtifactAttachmentId: cert.id, certifiedArtifactChecksumSha256: cert.checksumSha256, snapshotChecksumSha256: 'new-snapshot', snapshotJson: evidence.snapshotJson! as any } });
    await issue(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), certified);
    assert.deepEqual(await client.expensePayment.findMany({ where: { expenseId: expense.id } }), payments);
  });
  it('removes a receipt without replacement and rejects a late OCR summary', async () => {
    const { expense, evidence } = await source(); await client.expenseSubstituteReceiptEvidence.delete({ where: { id: evidence.id } });
    const attachment = await client.attachmentObject.create({ data: { companyId, branchId, storageProvider: 'LOCAL', bucket: 'local', objectKey: `remove/${++seq}`, originalFileName: 'receipt.png', mimeType: 'image/png', byteSize: 1, uploadedByUserId: userId, status: 'ACTIVE' } });
    await client.attachmentLink.create({ data: { companyId, attachmentId: attachment.id, targetType: 'expense.record', targetId: expense.id, purpose: 'expense.receipt.primary', linkedByUserId: userId } });
    const current = await client.expenseRecord.update({ where: { id: expense.id }, data: { primaryAttachmentId: attachment.id } });
    const audit = new PrismaAuditRepository(prisma);
    await new RemoveExpenseReceiptUseCase(prisma, new PrismaAttachmentRepository(prisma), repo, { log: audit.log.bind(audit) } as any).execute(ctx(), expense.id, attachment.id, current.updatedAt.toISOString());
    assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).primaryAttachmentId, null);
    assert.equal((await client.attachmentObject.findUniqueOrThrow({ where: { id: attachment.id } })).status, 'DELETED');
    await assert.rejects(repo.updateExpense({ id: expense.id, companyId, updatedByUserId: userId, aiVerificationSummaryJson: { extractionAttachmentId: attachment.id, status: 'OCR_EXTRACTED_NEEDS_REVIEW' } }), /Receipt changed/);
  });
});
