import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaExpenseRepository } from './prisma-expense.repository';
import { PreviewSubstituteReceiptUseCase, composeUnsignedSubstituteReceiptFormPdf } from '../application/use-cases/substitute-receipt.use-case';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { EXPENSE_EDIT_RESIGN_REASON } from './substitute-expense-edit';
import { RemoveExpenseReceiptUseCase } from '../application/use-cases/remove-expense-receipt.use-case';
import { PrismaAttachmentRepository } from '../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';

// Test-owned records only; DATABASE_URL is the isolated local review database.
describe('expense edit to signing and receipt removal (PostgreSQL)', () => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const prisma = { client } as any;
  const numbers = new PrismaDocumentSequenceRepository(prisma);
  const repo = new PrismaExpenseRepository(prisma, numbers);
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
    const number = await numbers.reserveNumber({ companyId, branchId, documentType: 'expense.substitute_receipt', periodKey: '2026-09', idempotencyKey: `fixture:${expense.id}`, reservedByUserId: userId });
    const evidence = await client.expenseSubstituteReceiptEvidence.create({ data: { companyId, branchId, expenseId: expense.id, version: 1, status: status as any,
      signatureMode: mode as any, fundingSource: 'COMPANY', documentNumber: number.documentNumber, idempotencyKey: `test-${++seq}`,
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'RECEIPT_UNAVAILABLE', missingReceiptReason: 'ไม่มีใบเสร็จ', businessPurpose: 'ใช้ในกิจการ',
      paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], paymentDate: at, paymentMethod: 'CASH', preparedByUserId: userId, preparedAt: at,
      expenseUpdatedAtAtPreparation: expense.updatedAt, payerUserId: mode === 'PAPER' ? null : userId, payerName: mode === 'PAPER' ? '' : 'ผู้รับรอง', payeeName: 'ร้านเดิม',
      ...(cert ? { payerPosition: '', payerSignatureAttachmentId: cert.id, payerSignatureChecksumSha256: cert.checksumSha256, certifiedArtifactAttachmentId: cert.id, certifiedArtifactChecksumSha256: cert.checksumSha256, snapshotJson: { schemaVersion: 2, company: { taxId: '0105569135722' }, expense: { grandTotalAmount: '100.0000', netPayableAmount: '100.0000', whtAmount: '0.0000' } }, snapshotChecksumSha256: 'old-snapshot', certifiedAt: at } : {}) } });
    await numbers.commitNumber({ id: number.id, companyId, ownerType: 'expense_substitute_receipt', ownerId: evidence.id });
    return { expense, evidence };
  }
  const edit = (expense: any, extra: any = {}) => repo.updateExpense({ id: expense.id, companyId, updatedByUserId: userId, expectedUpdatedAt: expense.updatedAt,
    refreshSubstituteEvidence: { requestId: `edit-${++seq}` }, expenseDate: new Date('2026-08-22T00:00:00Z'), vendorNameSnapshot: 'ร้านใหม่', ...extra });
  const amend = (expense: any, evidence: any, extra: any = {}) => repo.createPreparedSubstituteEvidence({
    companyId, expenseId: expense.id, branchId, expectedExpenseUpdatedAt: expense.updatedAt,
    amendment: { evidenceId: evidence.id, expectedUpdatedAt: evidence.updatedAt, keepDocumentNumberConfirmed: true },
    fundingSource: evidence.fundingSource, originalSourceDocumentType: evidence.originalSourceDocumentType,
    reasonCode: evidence.reasonCode, missingReceiptReason: evidence.missingReceiptReason, businessPurpose: evidence.businessPurpose,
    payeeName: evidence.payeeName, payeeAddress: evidence.payeeAddress, payeeTaxId: evidence.payeeTaxId,
    paymentDate: new Date('2026-08-14T00:00:00Z'), paymentMethod: evidence.paymentMethod,
    paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], note: evidence.note,
    signatureMode: evidence.signatureMode, payerUserId: evidence.payerUserId, payerName: evidence.payerName,
    preparedByUserId: userId, preparedFromChannel: 'WEB', idempotencyKey: `amend:${evidence.id}:${evidence.updatedAt.toISOString()}`,
    ...extra,
  });
  for (const mode of ['DIGITAL', 'PAPER']) it(`${mode}: changes a step-3 payment month with the same ID/number and invalidates the previous form`, async () => {
    const { expense, evidence } = await source(mode);
    const old = mode === 'PAPER'
      ? (await composeUnsignedSubstituteReceiptFormPdf(repo, companyId, (await repo.findByIdWithRelations(companyId, expense.id))!, (await repo.findSubstituteEvidence(companyId, expense.id))!), await repo.findSubstituteEvidence(companyId, expense.id))!
      : evidence;
    const updated = await amend(expense, old, { payeeName: 'ร้านแก้ไข' });
    assert.equal(updated.id, old.id); assert.equal(updated.version, old.version); assert.equal(updated.documentNumber, old.documentNumber); assert.equal(updated.revisionOfEvidenceId, null);
    assert.equal(updated.paymentDate?.toISOString(), '2026-08-14T00:00:00.000Z'); assert.equal(updated.paperFormSnapshotJson, null);
    const synced = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(synced.note, 'วัตถุประสงค์: ใช้ในกิจการ'); assert.equal(synced.missingReceiptReason, updated.missingReceiptReason);
    assert.equal(synced.updatedAt.getTime(), updated.expenseUpdatedAtAtPreparation.getTime());
    assert.equal(synced.vendorNameSnapshot, expense.vendorNameSnapshot);
    assert.equal(synced.netPayableAmount.toString(), expense.netPayableAmount.toString());
    assert.equal(synced.paidAmount.toString(), expense.paidAmount.toString());
    await assert.rejects(amend(expense, old), /โหลดข้อมูลล่าสุด/);
    if (mode === 'PAPER') {
      await assert.rejects(repo.freezeSubstitutePaperForm(companyId, expense.id, old.id, old.paperFormSnapshotJson as Record<string, unknown>, old.updatedAt, expense.updatedAt), /substitute_paper_form_changed/);
      await composeUnsignedSubstituteReceiptFormPdf(repo, companyId, (await repo.findByIdWithRelations(companyId, expense.id))!, updated);
      const frozen = (await repo.findSubstituteEvidence(companyId, expense.id))!;
      assert.equal((frozen.paperFormSnapshotJson as any).expense.paymentDate, '2026-08-14T00:00:00.000Z');
      assert.equal((frozen.paperFormSnapshotJson as any).documentNumber, updated.documentNumber);
    }
    assert.equal(await client.expenseSubstituteReceiptEvidence.count({ where: { expenseId: expense.id } }), 1);
  });
  it('keeps a signed no-op intact; a month edit retains the signed revision and resets signing with the same immutable number', async () => {
    const { expense, evidence } = await source('DIGITAL', 'PAYER_CERTIFIED');
    const unchanged = await amend(expense, evidence, { paymentDate: evidence.paymentDate });
    assert.equal(unchanged.updatedAt.getTime(), evidence.updatedAt.getTime()); assert.equal(unchanged.status, 'PAYER_CERTIFIED');
    const current = await amend(expense, evidence);
    assert.equal(current.documentNumber, evidence.documentNumber); assert.equal(current.version, 2); assert.equal(current.status, 'PREPARED');
    assert.equal(current.certifiedArtifactAttachmentId, null); assert.equal(current.payerSignatureAttachmentId, null);
    const old = await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(old.status, 'SUPERSEDED'); assert.equal(old.certifiedArtifactAttachmentId, evidence.certifiedArtifactAttachmentId);
    assert.equal(await client.expensePayment.count({ where: { expenseId: expense.id } }), 0);
  });
  it('edits a submitted paper without removing the old scan and rejects cross-tenant/stale/funding/signing changes', async () => {
    const { expense, evidence } = await source('PAPER');
    const old = await client.expenseSubstituteReceiptEvidence.update({ where: { id: evidence.id }, data: { wetSignedScanAttachmentId: 'old-scan', wetSignedScanChecksumSha256: 'old-hash', paperSubmissionJson: { payer: { name: 'ผู้รับรอง' } } } });
    await assert.rejects(amend(expense, old, { companyId: 'another-company' }), /โหลดข้อมูลล่าสุด/);
    await assert.rejects(amend(expense, old, { expectedExpenseUpdatedAt: at }), /โหลดข้อมูลล่าสุด/);
    await assert.rejects(amend(expense, old, { fundingSource: 'PERSONAL_ADVANCE' }), /แหล่งเงินเดิม/);
    await assert.rejects(amend(expense, old, { signatureMode: 'DIGITAL', payerUserId: userId }), /แหล่งเงินเดิม/);
    await assert.rejects(amend(expense, old, { supportingAttachmentIds: ['not-linked'] }), /หลักฐานเปลี่ยนแปลง/);
    const current = await amend(expense, old);
    assert.equal(current.documentNumber, evidence.documentNumber); assert.equal(current.paperSubmissionJson, null); assert.equal(current.wetSignedScanAttachmentId, null);
    assert.equal((await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: old.id } })).wetSignedScanAttachmentId, 'old-scan');
  });
  for (const status of ['ISSUED', 'SUPERSEDED']) it(`does not amend ${status} certificates`, async () => {
    const { expense, evidence: prepared } = await source('DIGITAL', 'PAYER_CERTIFIED');
    const evidence = await client.expenseSubstituteReceiptEvidence.update({ where: { id: prepared.id }, data: status === 'SUPERSEDED'
      ? { status, supersededAt: at, supersedeReason: 'test' }
      : { status: 'ISSUED', approverUserId: userId, approverName: 'ผู้อนุมัติ', approverPosition: '', approverSignatureAttachmentId: prepared.payerSignatureAttachmentId,
          approvedAt: at, issuedByUserId: userId, artifactAttachmentId: prepared.certifiedArtifactAttachmentId, checksumSha256: 'a'.repeat(64), issuedAt: at } });
    await assert.rejects(amend(expense, evidence), /โหลดข้อมูลล่าสุด/);
    if (status === 'ISSUED') await assert.rejects(edit(expense), /กรุณายกเลิกใบแทน/);
  });
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
  it('issued source edits require cancellation; metadata remains writable and all payment/history facts stay intact', async () => {
    const { expense, evidence } = await source('DIGITAL', 'PAYER_CERTIFIED');
    await repo.issueSubstituteEvidence({ companyId, expenseId: expense.id, evidenceId: evidence.id, approverUserId: userId, approverName: 'ผู้อนุมัติ', approverPosition: '', allowSelfApproval: true, approvedAt: at, approverSignatureAttachmentId: evidence.payerSignatureAttachmentId ?? undefined,
      expectedExpenseUpdatedAt: expense.updatedAt, referencedAttachmentIds: [], expectedVersion: evidence.version, expectedEvidenceUpdatedAt: evidence.updatedAt,
      artifact: { storageProvider: 'LOCAL', bucket: 'local', objectKey: `tests/${companyId}/${++seq}`, objectVersionId: '1', byteSize: 1, checksumSha256: 'a'.repeat(64), originalFileName: 'issued.svg' } });
    const paid = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    const issued = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    const payments = await client.expensePayment.findMany({ where: { expenseId: expense.id } });
    await assert.rejects(edit(paid), /กรุณายกเลิกใบแทน/);
    await assert.rejects(edit(paid, { netPayableAmount: '200', grandTotalAmount: '200' }), /กรุณายกเลิกใบแทน/);
    assert.deepEqual(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), paid);
    const reviewed = await repo.updateExpense({ companyId, id: expense.id, updatedByUserId: userId, expectedUpdatedAt: paid.updatedAt,
      vendorEntityKindSnapshot: 'JURISTIC', refreshSubstituteEvidence: { requestId: 'metadata-review' } });
    assert.equal(reviewed.vendorEntityKindSnapshot, 'JURISTIC');
    const after = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    assert.equal(after.id, issued.id); assert.equal(after.status, 'ISSUED');
    assert.equal(after.documentNumber, issued.documentNumber);
    assert.deepEqual(await client.expensePayment.findMany({ where: { expenseId: expense.id } }), payments);
  });

  it('cancels a paid unconfirmed draft atomically, retiring its active revision and root-owned number', async () => {
    const { expense, evidence } = await source('DIGITAL', 'PAYER_CERTIFIED');
    const revision = await amend(expense, evidence, { businessPurpose: 'ฉบับที่แก้ไขแล้ว' });
    const paid = await client.expenseRecord.update({ where: { id: expense.id }, data: {
      paidAmount: '100', outstandingAmount: '0', paymentStatus: 'PAID', paymentMethod: 'CASH', paidAt: at } });
    await client.expensePayment.create({ data: { companyId, expenseId: expense.id, amount: '100', paymentMethod: 'CASH', paidAt: at, createdByUserId: userId } });
    const result = await repo.voidExpenseTrueReversal(companyId, expense.id, userId, 'ยกเลิกรายจ่ายที่ลงวันที่จ่ายผิด');
    assert.equal(result.expense.status, 'VOIDED'); assert.equal(Number(result.expense.paidAmount), 0);
    assert.equal((await client.expensePayment.findFirstOrThrow({ where: { expenseId: expense.id } })).status, 'VOIDED');
    assert.equal((await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: revision.id } })).status, 'SUPERSEDED');
    const number = await client.documentNumber.findFirstOrThrow({ where: { companyId, documentNumber: evidence.documentNumber } });
    assert.equal(number.ownerId, evidence.id); assert.equal(number.status, 'VOIDED');
    await assert.rejects(repo.voidExpenseTrueReversal(companyId, expense.id, userId, 'กดซ้ำ'), /no longer eligible/);
    assert.equal(await client.expensePayment.count({ where: { expenseId: expense.id } }), 1);
    assert.notEqual(paid.status, 'CONFIRMED');
  });

  it('cannot use the financial cancellation path for an ordinary unpaid unconfirmed expense', async () => {
    const { expense, evidence } = await source();
    await assert.rejects(repo.voidExpenseTrueReversal(companyId, expense.id, userId, 'ยังไม่ได้จ่าย'), /no longer eligible/);
    assert.deepEqual(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), expense);
    assert.equal((await repo.findSubstituteEvidence(companyId, expense.id))!.id, evidence.id);
  });

  it('treats a time-only payment-date normalization as a signed no-op', async () => {
    const { expense, evidence } = await source('DIGITAL', 'PAYER_CERTIFIED');
    const timed = await client.expenseSubstituteReceiptEvidence.update({ where: { id: evidence.id }, data: { paymentDate: new Date('2026-09-09T09:45:00Z') } });
    const same = await amend(expense, timed, { paymentDate: at });
    assert.equal(same.id, timed.id); assert.equal(same.updatedAt.getTime(), timed.updatedAt.getTime());
    assert.equal(same.status, 'PAYER_CERTIFIED'); assert.equal(same.payerSignatureAttachmentId, timed.payerSignatureAttachmentId);
    assert.deepEqual(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), expense);
  });
  it('keeps incomplete source edits in draft and retains DB enforcement at certification', async () => {
    const { expense, evidence } = await source('DIGITAL', 'PAYER_CERTIFIED');
    const src = await client.expenseRecord.update({ where: { id: expense.id }, data: { note: 'ใช้ในกิจการ', missingReceiptReason: 'ไม่มีใบเสร็จ' } });
    await edit(src, { note: '', missingReceiptReason: '' });
    const incomplete = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    assert.equal(incomplete.status, 'PREPARED'); assert.equal(incomplete.documentNumber, evidence.documentNumber);
    assert.equal(incomplete.businessPurpose, ''); assert.equal(incomplete.missingReceiptReason, '');
    const cert = await artifact();
    await assert.rejects(client.expenseSubstituteReceiptEvidence.update({ where: { id: incomplete.id }, data: { status: 'PAYER_CERTIFIED', payerPosition: '', certifiedAt: at, payerSignatureAttachmentId: cert.id, payerSignatureChecksumSha256: cert.checksumSha256, certifiedArtifactAttachmentId: cert.id, certifiedArtifactChecksumSha256: cert.checksumSha256, snapshotChecksumSha256: 'blank-snapshot', snapshotJson: evidence.snapshotJson! as any } }), /check constraint/);
    const old = await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(old.status, 'SUPERSEDED'); assert.equal(old.businessPurpose, 'ใช้ในกิจการ');
  });
  it('synchronizes amended purpose/reason atomically, preserves notes and separately entered payee', async () => {
    const { expense, evidence } = await source('PAPER');
    const src = await client.expenseRecord.update({ where: { id: expense.id }, data: { note: 'LINE receipt upload · วัตถุประสงค์: เดิม · หมายเหตุอื่น' } });
    const changed = await amend(src, evidence, { payeeName: 'ผู้รับแทนร้าน', payeeTaxId: '1234567890123', businessPurpose: 'ซื้อวัสดุใหม่', missingReceiptReason: 'ผู้ขายทำหาย' });
    const synced = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(synced.vendorNameSnapshot, 'ร้านเดิม');
    assert.equal(synced.note, 'LINE receipt upload · หมายเหตุอื่น · วัตถุประสงค์: ซื้อวัสดุใหม่');
    assert.equal(synced.missingReceiptReason, changed.missingReceiptReason);
    assert.equal(synced.updatedAt.getTime(), changed.expenseUpdatedAtAtPreparation.getTime());
    await edit(synced, { vendorNameSnapshot: 'แก้ชื่อร้าน', vendorTaxIdSnapshot: '0105569135722' });
    const current = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    assert.equal(current.payeeName, 'ผู้รับแทนร้าน'); assert.equal(current.payeeTaxId, '1234567890123');
    await composeUnsignedSubstituteReceiptFormPdf(repo, companyId, (await repo.findByIdWithRelations(companyId, expense.id))!, current);
    const form = (await repo.findSubstituteEvidence(companyId, expense.id))!.paperFormSnapshotJson as any;
    assert.equal(form.payee.name, 'ผู้รับแทนร้าน'); assert.equal(form.expense.businessPurpose, 'ซื้อวัสดุใหม่');
    assert.equal(form.missingReceiptReason, 'ผู้ขายทำหาย');
  });
  it('preserves a full-length reviewed purpose and unrelated source notes without truncating either', async () => {
    const { expense, evidence } = await source();
    const notes = 'n'.repeat(500); const purpose = 'p'.repeat(500);
    const src = await client.expenseRecord.update({ where: { id: expense.id }, data: { note: notes } });
    const changed = await amend(src, evidence, { businessPurpose: purpose });
    const synced = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(synced.note, `${notes} · วัตถุประสงค์: ${purpose}`); assert.equal(changed.businessPurpose, purpose);
    await edit(synced, { note: `${notes} · วัตถุประสงค์: ${'q'.repeat(500)}` });
    const refreshed = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    assert.equal(refreshed.note, notes); assert.equal(refreshed.businessPurpose, 'q'.repeat(500));
    const currentSource = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    await amend(currentSource, refreshed, { missingReceiptReason: 'แก้ต่อได้หลังข้อความยาว' });
  });
  it('propagates plain/structured purpose changes and clearing; an incomplete form can be repaired under the same number', async () => {
    const { expense, evidence } = await source('PAPER');
    await edit(expense, { note: 'วัตถุประสงค์ใหม่แบบข้อความธรรมดา' });
    assert.equal((await repo.findSubstituteEvidence(companyId, expense.id))!.businessPurpose, 'วัตถุประสงค์ใหม่แบบข้อความธรรมดา');
    await edit(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), { note: 'LINE receipt upload · วัตถุประสงค์: แบบมีคำนำ', missingReceiptReason: 'เหตุผลใหม่' });
    assert.equal((await repo.findSubstituteEvidence(companyId, expense.id))!.businessPurpose, 'แบบมีคำนำ');
    await edit(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), { note: 'LINE receipt upload', missingReceiptReason: null });
    const incomplete = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    assert.equal(incomplete.businessPurpose, ''); assert.equal(incomplete.missingReceiptReason, '');
    await assert.rejects(composeUnsignedSubstituteReceiptFormPdf(repo, companyId, (await repo.findByIdWithRelations(companyId, expense.id))!, incomplete), /ข้อมูลใบแทนยังไม่ครบ/);
    const repaired = await amend(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), incomplete, { businessPurpose: 'ซ่อมอุปกรณ์', missingReceiptReason: 'ไม่มีต้นฉบับ', paymentDate: at });
    assert.equal(repaired.documentNumber, evidence.documentNumber); assert.equal(repaired.id, evidence.id);
    await composeUnsignedSubstituteReceiptFormPdf(repo, companyId, (await repo.findByIdWithRelations(companyId, expense.id))!, repaired);
  });
  it('clears company payment fields instead of retaining stale certificate values, preserving personal advance facts', async () => {
    for (const fundingSource of ['COMPANY', 'PERSONAL_ADVANCE']) {
      const { expense, evidence } = await source();
      const src = await client.expenseRecord.update({ where: { id: expense.id }, data: { paidAt: at, paymentMethod: 'CASH' } });
      await client.expenseSubstituteReceiptEvidence.update({ where: { id: evidence.id }, data: { fundingSource: fundingSource as any } });
      await edit(src, { paidAt: null, paymentMethod: null });
      const current = (await repo.findSubstituteEvidence(companyId, expense.id))!;
      assert.equal(current.paymentDate?.toISOString() ?? null, fundingSource === 'COMPANY' ? null : at.toISOString());
      assert.equal(current.paymentMethod, fundingSource === 'COMPANY' ? null : 'CASH');
    }
  });
  for (const financial of ['paid', 'posted']) it(`${financial} drafts require cancellation before material edits from either side`, async () => {
    const { expense, evidence } = await source('DIGITAL', 'PAYER_CERTIFIED');
    const locked = await client.expenseRecord.update({ where: { id: expense.id }, data: financial === 'paid'
      ? { paidAmount: '100', outstandingAmount: '0', paymentStatus: 'PAID', paidAt: at, paymentMethod: 'CASH' }
      : { journalEntryId: 'existing-journal', postingStatus: 'posted' } });
    await assert.rejects(amend(locked, evidence, { paymentDate: at, businessPurpose: 'แก้คำอธิบาย' }), /กรุณายกเลิกใบแทน/);
    await assert.rejects(edit(locked), /กรุณายกเลิกใบแทน/);
    assert.deepEqual(await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } }), evidence);
    assert.deepEqual(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), locked);
    assert.equal(await client.expensePayment.count({ where: { expenseId: expense.id } }), 0);
  });

  it('rejects an unacknowledged payment-month change atomically but allows a same-month day change', async () => {
    const { expense, evidence } = await source();
    const amendment = { evidenceId: evidence.id, expectedUpdatedAt: evidence.updatedAt };
    const count = await client.documentNumber.count({ where: { companyId } });
    await assert.rejects(amend(expense, evidence, { amendment }), /กรุณายืนยันเปลี่ยนเดือน/);
    assert.deepEqual(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), expense);
    assert.deepEqual(await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } }), evidence);
    const same = await amend(expense, evidence, { amendment, paymentDate: new Date('2026-09-14T00:00:00Z') });
    assert.equal(same.id, evidence.id); assert.equal(same.documentNumber, evidence.documentNumber);
    assert.equal(await client.documentNumber.count({ where: { companyId } }), count);
  });

  for (const mode of ['DIGITAL', 'PAPER']) it(`${mode}: September → August → September never changes the number or consumes a sequence`, async () => {
    const { expense, evidence } = await source(mode);
    const sourceNow = () => client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    const initialCount = await client.documentNumber.count({ where: { companyId } });
    const august = await amend(expense, evidence);
    const september = await amend(await sourceNow(), august, { paymentDate: at });
    assert.equal(september.documentNumber, evidence.documentNumber);
    assert.equal(september.id, august.id);
    const again = await amend(await sourceNow(), september);
    assert.equal(again.documentNumber, august.documentNumber);
    const sameMonth = await amend(await sourceNow(), again, { paymentDate: new Date('2026-08-22T00:00:00Z') });
    assert.equal(sameMonth.id, again.id); assert.equal(sameMonth.documentNumber, again.documentNumber);
    const noOp = await amend(await sourceNow(), sameMonth, { paymentDate: sameMonth.paymentDate });
    assert.equal(noOp.updatedAt.getTime(), sameMonth.updatedAt.getTime());
    assert.equal(await client.documentNumber.count({ where: { companyId } }), initialCount);
    const other = await source(mode);
    const otherAugust = await amend(other.expense, other.evidence);
    assert.notEqual(other.evidence.documentNumber, september.documentNumber);
    assert.notEqual(otherAugust.documentNumber, august.documentNumber);
    assert.equal(await client.documentNumber.count({ where: { companyId, ownerId: evidence.id, status: 'COMMITTED' } }), 1);
    const history = await repo.listSubstituteEvidenceHistory(companyId, expense.id);
    assert.equal(history.length, 1); assert.equal(history[0].id, september.id);
  });
  it('serializes concurrent month changes, rejects stale retry and rolls date changes back with source edits', async () => {
    const { expense, evidence } = await source();
    const count = await client.documentNumber.count({ where: { companyId } });
    const results = await Promise.allSettled([amend(expense, evidence), amend(expense, evidence)]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter(item => item.status === 'rejected').length, 1);
    assert.equal(await client.documentNumber.count({ where: { companyId } }), count);
    const current = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    const src = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    await assert.rejects(client.$transaction(async tx => {
      const { reviseSubstituteEvidence } = await import('./substitute-expense-edit');
      await reviseSubstituteEvidence(tx, current, { paymentDate: new Date('2026-07-14T00:00:00Z') }, userId, 'rollback-number', 'test');
      throw new Error('abort after date update');
    }), /abort after date update/);
    assert.equal(await client.documentNumber.count({ where: { companyId } }), count);
    assert.equal((await repo.findSubstituteEvidence(companyId, expense.id))!.id, current.id);
    assert.deepEqual(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), src);
  });
  it('keeps its number over a Bangkok year boundary and ignores expense-date-only edits', async () => {
    const { expense, evidence } = await source();
    const january = await amend(expense, evidence, { paymentDate: new Date('2025-12-31T17:00:00Z') });
    assert.equal(january.documentNumber, evidence.documentNumber);
    await edit(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), { expenseDate: new Date('2026-07-14T00:00:00Z') });
    assert.equal((await repo.findSubstituteEvidence(companyId, expense.id))!.documentNumber, january.documentNumber);
  });
  it('source date/branch edits keep the assigned number', async () => {
    const { expense, evidence } = await source();
    await edit(expense, { paidAt: new Date('2026-08-14T00:00:00Z'), paymentMethod: 'CASH' });
    const august = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    assert.equal(august.documentNumber, evidence.documentNumber);
    const second = await client.branch.create({ data: { companyId, code: 'B2', name: 'สาขา 2' } });
    await edit(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), { paidAt: at, branchId: second.id });
    assert.equal((await repo.findSubstituteEvidence(companyId, expense.id))!.documentNumber, evidence.documentNumber);
  });
  it('can edit a legacy document without a number registry; never creates or transfers a reservation', async () => {
    const { expense, evidence } = await source();
    await client.documentNumber.deleteMany({ where: { companyId, documentNumber: evidence.documentNumber } });
    const count = await client.documentNumber.count({ where: { companyId } });
    const current = await amend(expense, evidence);
    assert.equal(current.documentNumber, evidence.documentNumber);
    assert.equal(await client.documentNumber.count({ where: { companyId } }), count);
  });

  it('matches recorded payments and no-op amendments using the Bangkok day at midnight boundaries', async () => {
    const { expense, evidence } = await source();
    const instant = new Date('2026-08-31T17:30:00Z');
    const paid = await client.expenseRecord.update({ where: { id: expense.id }, data: { paidAmount: '100', outstandingAmount: '0', paymentStatus: 'PAID', paidAt: instant, paymentMethod: 'CASH' } });
    const current = await client.expenseSubstituteReceiptEvidence.update({ where: { id: evidence.id }, data: { paymentDate: instant, expenseUpdatedAtAtPreparation: paid.updatedAt } });
    const same = await amend(paid, current, { paymentDate: new Date('2026-09-01T00:00:00Z') });
    assert.equal(same.updatedAt.getTime(), current.updatedAt.getTime());
    assert.equal(same.documentNumber, evidence.documentNumber);
    await assert.rejects(amend(paid, current, { paymentDate: new Date('2026-08-31T00:00:00Z') }), /วันที่หรือวิธีจ่าย/);
  });

  it('keeps branch-specific numbers after template and branch changes', async () => {
    const beforeConfigChange = await source();
    await numbers.upsertConfig({ companyId, periodKey: '2026-10', documentType: 'expense.substitute_receipt', prefixTemplate: 'SRC-{BRANCH}-{YYYY}{MM}-{SEQ}', resetPolicy: 'MONTHLY', updatedByUserId: userId });
    await edit(beforeConfigChange.expense);
    assert.equal((await repo.findSubstituteEvidence(companyId, beforeConfigChange.expense.id))!.documentNumber, beforeConfigChange.evidence.documentNumber);
    const { expense, evidence } = await source();
    assert.match(evidence.documentNumber, /^SRC-HO-202609-/);
    const second = await client.branch.create({ data: { companyId, code: 'B3', name: 'สาขา 3' } });
    await edit(expense, { branchId: second.id });
    const inOtherBranch = (await repo.findSubstituteEvidence(companyId, expense.id))!;
    assert.equal(inOtherBranch.documentNumber, evidence.documentNumber);
    await edit(await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), { branchId });
    assert.equal((await repo.findSubstituteEvidence(companyId, expense.id))!.documentNumber, evidence.documentNumber);
    assert.equal(await client.documentNumber.count({ where: { companyId, ownerId: evidence.id } }), 1);
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
