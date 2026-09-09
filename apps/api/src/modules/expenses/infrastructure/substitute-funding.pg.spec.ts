import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { canonicalSnapshotHash } from '../domain/logic/substitute-receipt.logic';
import { PrismaExpenseRepository } from './prisma-expense.repository';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';

// Required local integration gate: no skip that could be mistaken for concurrency evidence.
describe('full substitute funding boundaries (PostgreSQL)', () => {
  const clients = [0, 1].map(() => new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) }));
  const repos = clients.map(client => new PrismaExpenseRepository({ client } as any, new PrismaDocumentSequenceRepository({ client } as any)));

  const at = new Date('2026-09-09T00:00:00Z');
  let companyId: string; let branchId: string; let sequence = 0;
  before(async () => {
    companyId = (await clients[0]!.company.create({ data: { name: `substitute-pg-${process.pid}`, registeredName: 'บริษัท ทดสอบ จำกัด', taxId: '0105569135722' } })).id;
    branchId = (await clients[0]!.branch.create({ data: { companyId, code: 'HO', name: 'สำนักงานใหญ่' } })).id;
  });
  after(async () => {
    if (companyId) {
      await clients[0]!.expenseSubstituteReceiptEvidence.deleteMany({ where: { companyId } });
      await clients[0]!.company.delete({ where: { id: companyId } });
    }
    await Promise.all(clients.map(client => client.$disconnect()));
  });
  async function artifact() { return clients[0]!.attachmentObject.create({ data: { companyId, branchId, storageProvider: 'LOCAL', bucket: 'local', objectKey: `pg/${companyId}/${++sequence}`, objectVersionId: 'v1', originalFileName: 'signature.png', mimeType: 'image/png', byteSize: 1, checksumSha256: 'a'.repeat(64), uploadedByUserId: 'payer', status: 'ACTIVE' } }); }
  async function source(fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE', paidAmount = '0') {
    const expense = await clients[0]!.expenseRecord.create({ data: { companyId, branchId, expenseDate: at, createdByUserId: 'payer',
      status: 'NEEDS_REVIEW', sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE',
      netPayableAmount: '100', grandTotalAmount: '100', subtotalAmount: '100', taxableAmount: '100', outstandingAmount: '100', paidAmount } });
    const snapshot: any = { schemaVersion: 2, fundingSource, company: { name: 'บริษัท ทดสอบ จำกัด', taxId: '0105569135722' },
      payee: { name: 'ร้านต้นทาง' }, expense: { netPayableAmount: '100.0000', grandTotalAmount: '100.0000', whtAmount: '0.0000' } };
    const cert = await artifact();
    const evidence = await clients[0]!.expenseSubstituteReceiptEvidence.create({ data: { companyId, branchId, expenseId: expense.id,
      version: 1, status: 'PAYER_CERTIFIED', fundingSource, payerPosition: 'พนักงาน', payerSignatureAttachmentId: cert.id, payerSignatureChecksumSha256: cert.checksumSha256, certifiedArtifactAttachmentId: cert.id, certifiedArtifactChecksumSha256: cert.checksumSha256, certifiedAt: at, documentNumber: `PG-${++sequence}`, idempotencyKey: `pg-${sequence}`,
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'RECEIPT_UNAVAILABLE', missingReceiptReason: 'ผู้ขายไม่ออกใบเสร็จ', businessPurpose: 'ซื้อของใช้ในกิจการ',
      paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], paymentDate: at, paymentMethod: 'CASH', preparedByUserId: 'payer', preparedAt: at,
      expenseUpdatedAtAtPreparation: expense.updatedAt, payerUserId: 'payer', payerName: 'ผู้จ่าย', payeeName: 'ร้านต้นทาง', snapshotJson: snapshot, snapshotChecksumSha256: canonicalSnapshotHash(snapshot) } });
    return { expense, evidence };
  }
  const issueInput = (expense: any, evidence: any) => ({ companyId, expenseId: expense.id, evidenceId: evidence.id,
    approverSignatureAttachmentId: evidence.payerSignatureAttachmentId, approverUserId: 'approver', approverName: 'ผู้อนุมัติ', approverPosition: 'กรรมการบริษัท', allowSelfApproval: false, approvedAt: at,
    expectedExpenseUpdatedAt: expense.updatedAt, referencedAttachmentIds: [], expectedVersion: evidence.version, expectedEvidenceUpdatedAt: evidence.updatedAt,
    artifact: { storageProvider: 'LOCAL', bucket: 'local', objectKey: `pg/${evidence.id}`, objectVersionId: 'v1', byteSize: 1, checksumSha256: 'a'.repeat(64), originalFileName: 'issued.svg' } });
  it('concurrent company issue creates one full payment; partial history remains unchanged', async () => {
    const { expense, evidence } = await source('COMPANY');
    const result = await Promise.allSettled(repos.map(repo => repo.issueSubstituteEvidence(issueInput(expense, evidence))));
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
    const payments = await clients[0]!.expensePayment.findMany({ where: { expenseId: expense.id } });
    assert.equal(payments.length, 1); assert.equal(payments[0]!.amount.toString(), '100');
    const partial = await source('COMPANY', '40');
    await assert.rejects(repos[0]!.issueSubstituteEvidence(issueInput(partial.expense, partial.evidence)), /จ่ายเต็ม/);
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: partial.expense.id } })).paidAmount.toString(), '40');
    assert.equal(await clients[0]!.expensePayment.count({ where: { expenseId: partial.expense.id } }), 0);
  });
  it('personal full payment issues evidence without recording company money', async () => {
    const { expense, evidence } = await source('PERSONAL_ADVANCE');
    await repos[0]!.issueSubstituteEvidence(issueInput(expense, evidence));
    assert.equal(await clients[0]!.expensePayment.count({ where: { expenseId: expense.id } }), 0);
    const current = await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(current.paidAmount.toString(), '0'); assert.equal(current.status, 'NEEDS_REVIEW');
    await assert.rejects(repos[0]!.recordPaymentAtomic({ companyId, expenseId: expense.id, amount: '100', paymentMethod: 'CASH', paidAt: at, userId: 'payer' } as any), /พนักงานจ่ายร้านแล้ว/);
  });
  it('posted/paid document correction preserves expense, payment and original snapshot bytes', async () => {
    const { expense, evidence } = await source('COMPANY');
    const original = await repos[0]!.issueSubstituteEvidence(issueInput(expense, evidence));
    await clients[0]!.expenseRecord.update({ where: { id: expense.id }, data: { status: 'CONFIRMED', postingStatus: 'posted', journalEntryId: 'unchanged-journal' } });
    const before = await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    const paymentsBefore = await clients[0]!.expensePayment.findMany({ where: { expenseId: expense.id } });
    const correction = await repos[0]!.createPreparedSubstituteEvidence({ ...original, companyId, expenseId: expense.id, expectedExpenseUpdatedAt: before.updatedAt,
      correctionOfEvidenceId: original.id, correctionReason: 'แก้ชื่อจดทะเบียน', preparedByUserId: 'payer', preparedFromChannel: 'WEB', idempotencyKey: 'correction' } as any);
    assert.equal((await clients[0]!.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: original.id } })).status, 'ISSUED');
    const correctionArtifact = await artifact();
    const certified = await clients[0]!.expenseSubstituteReceiptEvidence.update({ where: { id: correction.id }, data: { status: 'PAYER_CERTIFIED', payerPosition: 'พนักงาน', payerSignatureAttachmentId: correctionArtifact.id, payerSignatureChecksumSha256: correctionArtifact.checksumSha256, certifiedArtifactAttachmentId: correctionArtifact.id, certifiedArtifactChecksumSha256: correctionArtifact.checksumSha256, certifiedAt: at, snapshotChecksumSha256: original.snapshotChecksumSha256 } });
    await repos[0]!.issueSubstituteEvidence(issueInput(before, certified));
    assert.deepEqual(await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), before);
    assert.deepEqual(await clients[0]!.expensePayment.findMany({ where: { expenseId: expense.id } }), paymentsBefore);
    const old = await clients[0]!.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(old.snapshotChecksumSha256, original.snapshotChecksumSha256); assert.equal(old.status, 'SUPERSEDED');
  });
  it('cancel/restart of a personal correction preserves the original and does not pay', async () => {
    const { expense, evidence } = await source('PERSONAL_ADVANCE');
    const original = await repos[0]!.issueSubstituteEvidence(issueInput(expense, evidence));
    const current = await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    const input = { ...original, companyId, expenseId: expense.id, expectedExpenseUpdatedAt: current.updatedAt,
      correctionOfEvidenceId: original.id, correctionReason: 'แก้ตำแหน่ง', preparedByUserId: 'payer', preparedFromChannel: 'WEB', idempotencyKey: 'personal-correction' } as any;
    const first = await repos[0]!.createPreparedSubstituteEvidence(input);
    await repos[0]!.supersedeSubstituteEvidence({ companyId, expenseId: expense.id, evidenceId: first.id, actorUserId: 'payer', reason: 'ยกเลิกร่างแก้ไข', expectedEvidenceUpdatedAt: first.updatedAt });
    const next = await repos[0]!.createPreparedSubstituteEvidence(input);
    assert.notEqual(next.id, first.id);
    assert.equal((await repos[0]!.createPreparedSubstituteEvidence(input)).id, next.id);
    const cert = await artifact();
    const certified = await clients[0]!.expenseSubstituteReceiptEvidence.update({ where: { id: next.id }, data: { status: 'PAYER_CERTIFIED', payerPosition: 'พนักงาน', payerSignatureAttachmentId: cert.id,
      payerSignatureChecksumSha256: cert.checksumSha256, certifiedArtifactAttachmentId: cert.id, certifiedArtifactChecksumSha256: cert.checksumSha256, certifiedAt: at, snapshotChecksumSha256: original.snapshotChecksumSha256 } });
    await repos[0]!.issueSubstituteEvidence(issueInput(current, certified));
    assert.equal(await clients[0]!.expensePayment.count({ where: { expenseId: expense.id } }), 0);
  });

  async function paperSource(fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE') {
    const { expense, evidence } = await source(fundingSource);
    const form = { ...evidence.snapshotJson as any, payer: { userId: null, name: '', position: '', certifiedAt: at.toISOString() } };
    const paper = await clients[0]!.expenseSubstituteReceiptEvidence.update({ where: { id: evidence.id }, data: {
      status: 'PREPARED', signatureMode: 'PAPER', payerUserId: null, payerName: '', payerSignatureAttachmentId: null,
      payerSignatureChecksumSha256: null, certifiedArtifactAttachmentId: null, certifiedArtifactChecksumSha256: null, certifiedAt: null,
      snapshotJson: form, paperFormSnapshotJson: form,
    } });
    const scan = await clients[0]!.attachmentObject.create({ data: { companyId, branchId, storageProvider: 'LOCAL', bucket: 'local', objectKey: `pg/paper/${++sequence}`,
      objectVersionId: 'v1', originalFileName: 'scan.pdf', mimeType: 'application/pdf', byteSize: 1, checksumSha256: 'b'.repeat(64), uploadedByUserId: 'uploader', status: 'ACTIVE',
      metadataJson: { generatedFor: 'substitute_receipt_paper', evidenceId: paper.id } } });
    const submission = { payer: { name: 'External payer', position: 'Employee', signedOn: '2026-09-09' }, approver: { name: 'External approver', position: 'Director', signedOn: '2026-09-09' }, samePerson: false, uploadedByUserId: 'uploader', uploadedAt: at.toISOString() };
    return { expense, paper, scan, form, submission };
  }
  for (const funding of ['COMPANY', 'PERSONAL_ADVANCE'] as const) it(`paper ${funding}: upload has no financial effect; concurrent acceptance issues once`, async () => {
    const { expense, paper, scan, form, submission } = await paperSource(funding);
    const saved = await repos[0]!.submitSubstitutePaper({ companyId, expenseId: expense.id, evidenceId: paper.id, expectedUpdatedAt: paper.updatedAt, attachmentId: scan.id, checksumSha256: scan.checksumSha256!, submission });
    assert.equal(saved.status, 'PREPARED'); assert.equal(saved.payerUserId, null);
    assert.deepEqual(await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } }), expense);
    assert.equal(await clients[0]!.expensePayment.count({ where: { expenseId: expense.id } }), 0);
    const snapshot = { ...form, payer: { userId: null, name: submission.payer.name, position: submission.payer.position, certifiedAt: submission.payer.signedOn } };
    const input = { ...issueInput(expense, saved), approverSignatureAttachmentId: undefined, referencedAttachmentIds: [scan.id], paperAcceptance: { snapshot, snapshotChecksumSha256: canonicalSnapshotHash(snapshot), scanChecksumSha256: scan.checksumSha256! } };
    const result = await Promise.allSettled(repos.map(repo => repo.issueSubstituteEvidence(input)));
    assert.equal(result.filter(value => value.status === 'fulfilled').length, 1);
    const final = await clients[0]!.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: paper.id } });
    assert.equal(final.approverUserId, null); assert.equal(final.paperReviewedByUserId, 'approver'); assert.equal(final.issuedByUserId, 'approver');
    assert.equal(await clients[0]!.expensePayment.count({ where: { expenseId: expense.id } }), funding === 'COMPANY' ? 1 : 0);
  });
  it('paper submission rejects wrong uploader, stale source, and a cancelled version without linking a scan', async () => {
    const { expense, paper, scan, submission } = await paperSource('COMPANY');
    const input = { companyId, expenseId: expense.id, evidenceId: paper.id, expectedUpdatedAt: paper.updatedAt, attachmentId: scan.id, checksumSha256: scan.checksumSha256!, submission };
    await assert.rejects(repos[0]!.submitSubstitutePaper({ ...input, submission: { ...submission, uploadedByUserId: 'other-user' } }), /upload_unavailable/);
    await repos[0]!.supersedeSubstituteEvidence({ companyId, expenseId: expense.id, evidenceId: paper.id, actorUserId: 'uploader', reason: 'wrong version', expectedEvidenceUpdatedAt: paper.updatedAt });
    await assert.rejects(repos[0]!.submitSubstitutePaper(input), /submission_changed/);
    assert.equal(await clients[0]!.attachmentLink.count({ where: { attachmentId: scan.id } }), 0);
    assert.equal(await clients[0]!.expensePayment.count({ where: { expenseId: expense.id } }), 0);
  });

});
