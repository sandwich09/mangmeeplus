/**
 * Advisor S1 (spec §5.2): the caller's own substitute-receipt signature queue on real PostgreSQL — the
 * Prisma translation of every gate the web certify/approve/accept paths apply: branch scope, the payer,
 * a payer-certified receipt, a paper copy submitted and waiting to be accepted (and one not yet
 * submitted), self-approval by role, the paper "same person" flag, the original approver of a
 * correction, and OWNER_SELF vs DESIGNATED_APPROVERS. Rows satisfy the table's real check constraints.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import type { RequestContext } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import type { PrismaService } from '../../common/database/prisma.service';
import { PrismaExpenseRepository } from './infrastructure/prisma-expense.repository';
import { ListMySubstituteReceiptSignaturesUseCase } from './application/use-cases/substitute-receipt.use-case';

const url = process.env.BILLING_TEST_DATABASE_URL;

test('advisor S1: the caller-own substitute receipt signature queue on real PostgreSQL', { skip: !url }, async (t) => {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(url!).hostname));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 4 }) });
  const tag = `s1-queue-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-co`, b1 = `${tag}-b1`, b2 = `${tag}-b2`;
  const owner = `${tag}-owner`, staff = `${tag}-staff`, manager = `${tag}-manager`, accountant = `${tag}-accountant`;
  const at = new Date('2026-09-20T03:00:00.000Z');
  let sequence = 0;
  try {
    try { await client.$queryRaw`SELECT 1`; } catch (error) { return t.skip(`PostgreSQL unavailable: ${String(error)}`); }
    await client.company.create({ data: { id: companyId, name: 'S1 signature queue fixture' } });
    await client.user.createMany({ data: [owner, staff, manager, accountant].map((id) => ({ id, displayName: id })) });
    await client.branch.createMany({ data: [
      { id: b1, companyId, code: 'B1', name: 'สาขา 1', createdByUserId: owner },
      { id: b2, companyId, code: 'B2', name: 'สาขา 2', createdByUserId: owner },
    ] });
    const confirm = await client.permission.upsert({ where: { key: 'expense.confirm' }, update: {}, create: { key: 'expense.confirm', description: 'Confirm expense records' } });
    const role = async (key: string, confirms: boolean) => (await client.role.create({ data: {
      companyId, scopeKey: companyId, key, name: key, ...(confirms ? { permissions: { create: [{ permissionId: confirm.id }] } } : {}),
    } })).id;
    const roles = { OWNER: await role('OWNER', true), MANAGER: await role('MANAGER', true), ACCOUNTANT: await role('ACCOUNTANT', true), STAFF: await role('STAFF', false) };
    const member = (userId: string, roleId: string, branches?: string[]) => client.companyMembership.create({ data: {
      companyId, userId, roles: { create: { roleId } },
      ...(branches ? { branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: branches[0], branchScopes: { create: branches.map((branchId) => ({ branchId })) } } : {}),
    } });
    await member(owner, roles.OWNER); await member(staff, roles.STAFF); await member(manager, roles.MANAGER, [b1]); await member(accountant, roles.ACCOUNTANT);

    const attachment = async () => (await client.attachmentObject.create({ data: { companyId, branchId: b1, storageProvider: 'LOCAL', bucket: 'local',
      objectKey: `${tag}/${++sequence}`, objectVersionId: 'v1', originalFileName: 'artifact.svg', mimeType: 'image/svg+xml', byteSize: 1,
      checksumSha256: 'a'.repeat(64), uploadedByUserId: owner, status: 'ACTIVE' } })).id;
    // What a payer's certification writes (payer_certified_check); an issued row also carries the approval (issued_check).
    const certified = async (payerUserId: string) => ({ status: 'PAYER_CERTIFIED', payerUserId, snapshotJson: { v: 1 }, snapshotChecksumSha256: 'b'.repeat(64),
      payerPosition: 'พนักงาน', certifiedAt: at, payerSignatureAttachmentId: `${tag}-sig-${++sequence}`, payerSignatureChecksumSha256: 'c'.repeat(64),
      certifiedArtifactAttachmentId: await attachment(), certifiedArtifactChecksumSha256: 'd'.repeat(64) });
    const evidence = async (label: string, data: Record<string, unknown>) => {
      const expense = await client.expenseRecord.create({ data: { companyId, branchId: (data['branchId'] as string | null | undefined) ?? b1, expenseDate: at,
        createdByUserId: staff, status: 'NEEDS_REVIEW', vendorNameSnapshot: `ร้าน ${label}`, grandTotalAmount: '350.0000', subtotalAmount: '350.0000',
        taxableAmount: '350.0000', netPayableAmount: '350.0000', outstandingAmount: '350.0000', paidAmount: '0' } });
      const row = await client.expenseSubstituteReceiptEvidence.create({ data: { companyId, branchId: expense.branchId, expenseId: expense.id,
        version: 1, status: 'PREPARED', documentNumber: `${tag}-${label}`, idempotencyKey: `${tag}-${++sequence}`, originalSourceDocumentType: 'EXPENSE_NOTE_TEXT',
        reasonCode: 'RECEIPT_UNAVAILABLE', missingReceiptReason: 'ผู้ขายไม่ออกใบเสร็จ', businessPurpose: 'ใช้ในกิจการ', paymentEvidenceAttachmentIds: [],
        supportingAttachmentIds: [], preparedByUserId: owner, preparedAt: new Date(at.getTime() + sequence * 60_000), expenseUpdatedAtAtPreparation: expense.updatedAt,
        payerUserId: staff, payerName: 'staff', payeeName: `ผู้รับเงิน ${label}`, payeeTaxId: '1234567890123', payeeAddress: 'ที่อยู่ลับ',
        ...data, branchId: expense.branchId } });
      return row;
    };
    const paper = (samePerson: boolean) => ({ signatureMode: 'PAPER', payerUserId: null, payerName: 'ผู้จ่ายบนกระดาษ',
      wetSignedScanAttachmentId: `${tag}-scan-${++sequence}`, paperSubmissionJson: { samePerson, payer: { name: 'ก' }, approver: { name: samePerson ? 'ก' : 'ข' } } });

    await evidence('P1', {});                                                  // staff signs, branch 1
    await evidence('P2', { branchId: b2 });                                    // staff signs, branch 2
    await evidence('C1', await certified(staff));                               // approve, branch 1
    await evidence('C2', { ...await certified(staff), branchId: b2 });          // approve, branch 2
    await evidence('SELF', await certified(owner));                             // the owner paid it
    await evidence('PAPER-SAME', paper(true));                                 // submitted, one person signed twice
    await evidence('PAPER-TWO', paper(false));                                 // submitted, two signers
    await evidence('PAPER-UNSENT', { signatureMode: 'PAPER', payerUserId: null }); // form printed, nothing submitted
    await evidence('GONE', { status: 'SUPERSEDED', supersededAt: at, supersedeReason: 'ยกเลิก' });
    const original = await evidence('ORIG', { ...await certified(staff), status: 'ISSUED', approverUserId: owner, approverName: 'owner',
      approverPosition: 'เจ้าของ', approvedAt: at, approverSignatureAttachmentId: `${tag}-asig`, issuedByUserId: owner, issuedAt: at,
      artifactAttachmentId: await attachment(), checksumSha256: 'e'.repeat(64) });
    await evidence('FIX', { ...await certified(staff), correctionOfEvidenceId: original.id });

    const useCase = new ListMySubstituteReceiptSignaturesUseCase(new PrismaExpenseRepository({ client } as PrismaService));
    const ctx = (userId: string, roleKey: string, permissions: string[], branchIds?: string[]): RequestContext => ({
      requestId: tag, authSubject: userId, userId, companyId, membershipId: userId, roles: [roleKey], permissions,
      scopes: branchIds ? { branchIds } : {}, authProvider: 'line' });
    const docs = (step: { items: Array<{ documentNumber: string }> } | undefined) => (step?.items ?? []).map((item) => item.documentNumber.slice(tag.length + 1)).sort();
    const APPROVE = ['expense.read_own', 'expense.confirm'];

    await t.test('the payer sees exactly the receipts naming them, inside their branch scope, with no tax id or address', async () => {
      const all = await useCase.execute(ctx(staff, 'STAFF', ['expense.read_own']), { limit: 10 });
      assert.deepEqual(docs(all.asPayer), ['P1', 'P2']);
      assert.equal(all.asPayer!.count, 2);
      assert.deepEqual(all.asApprover, { count: 0, items: [] });
      const branchOne = await useCase.execute(ctx(staff, 'STAFF', ['expense.read_own'], [b1]), { role: 'payer', limit: 10 });
      assert.deepEqual(docs(branchOne.asPayer), ['P1']);
      assert.ok(!JSON.stringify(all).includes('1234567890123') && !JSON.stringify(all).includes('ที่อยู่ลับ'));
    });

    await t.test('OWNER_SELF: the owner approves everything eligible, their own and the same-person paper copy included', async () => {
      const result = await useCase.execute(ctx(owner, 'OWNER', APPROVE), { role: 'approver', limit: 10 });
      assert.deepEqual(docs(result.asApprover), ['C1', 'C2', 'FIX', 'PAPER-SAME', 'PAPER-TWO', 'SELF']);
      assert.equal(result.asApprover!.count, 6);
      assert.deepEqual(result.asApprover!.items.filter((item) => item.documentNumber.endsWith('PAPER-TWO')).map((item) => item.stepLabel), ['ฉบับกระดาษรอคุณตรวจรับ']);
    });

    await t.test('a branch manager sees their branch only, never a correction another approver owns', async () => {
      const result = await useCase.execute(ctx(manager, 'MANAGER', APPROVE, [b1]), { role: 'approver', limit: 10 });
      assert.deepEqual(docs(result.asApprover), ['C1', 'PAPER-SAME', 'PAPER-TWO', 'SELF']);
    });

    await t.test('a non-exempt role never counts the same-person paper copy', async () => {
      const result = await useCase.execute(ctx(accountant, 'ACCOUNTANT', APPROVE), { role: 'approver', limit: 10 });
      assert.deepEqual(docs(result.asApprover), ['C1', 'C2', 'PAPER-TWO', 'SELF']);
    });

    await t.test('the limit bounds the items, never the count', async () => {
      const result = await useCase.execute(ctx(owner, 'OWNER', APPROVE), { role: 'approver', limit: 2 });
      assert.equal(result.asApprover!.items.length, 2);
      assert.equal(result.asApprover!.count, 6);
    });

    await t.test('DESIGNATED_APPROVERS: only the designated approver, and never their own receipt', async () => {
      await client.expenseSubstituteReceiptPolicy.create({ data: { companyId, approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: [owner], createdByUserId: owner, updatedByUserId: owner } });
      assert.deepEqual((await useCase.execute(ctx(accountant, 'ACCOUNTANT', APPROVE), { role: 'approver', limit: 10 })).asApprover, { count: 0, items: [] });
      const designated = await useCase.execute(ctx(owner, 'OWNER', APPROVE), { role: 'approver', limit: 10 });
      assert.deepEqual(docs(designated.asApprover), ['C1', 'C2', 'FIX', 'PAPER-TWO']);
    });
  } finally {
    await client.expenseSubstituteReceiptPolicy.deleteMany({ where: { companyId } });
    await client.expenseSubstituteReceiptEvidence.deleteMany({ where: { companyId } });
    await client.expenseRecord.deleteMany({ where: { companyId } });
    await client.attachmentObject.deleteMany({ where: { companyId } });
    await client.companyMembership.deleteMany({ where: { companyId } });
    await client.role.deleteMany({ where: { companyId } });
    await client.branch.deleteMany({ where: { companyId } });
    await client.company.deleteMany({ where: { id: companyId } });
    await client.user.deleteMany({ where: { id: { in: [owner, staff, manager, accountant] } } });
    await client.$disconnect();
  }
});
