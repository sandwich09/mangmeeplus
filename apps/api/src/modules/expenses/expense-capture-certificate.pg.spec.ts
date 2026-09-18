/**
 * Real-PostgreSQL proof for the certificate of a derived capture source (W06, spec §12.4/§14.3).
 *
 * A fake cannot state any of this. "Issue this shop twice and the company pays once" is a property
 * of a real unique index under real concurrency; "shop A stays issued while shop B is retried" is a
 * property of the real status fence; "a prepared certificate stops the group being rebuilt" is a
 * property of the real `ExpenseSubstituteReceiptEvidence` relation that `findHandoffConsumers`
 * reads; and "a partial prepayment blocks the whole issuance" is a guard over real money columns.
 *
 * Gated like every other `*.pg.spec.ts`: skipped without the URL, failing when CI names a database,
 * and refusing to run against anything but an explicit local host.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../common/database/pg-spec-guard';
import type { PrismaService } from '../../common/database/prisma.service';
import { PrismaExpenseRepository } from './infrastructure/prisma-expense.repository';
import { PrismaExpenseCaptureRepository } from './infrastructure/prisma-expense-capture.repository';
import { PrismaDocumentSequenceRepository } from '../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { EXPENSE_EDIT_RESIGN_REASON } from './infrastructure/substitute-expense-edit';

const databaseUrl = process.env.EXPENSE_CAPTURE_CERTIFICATE_TEST_DATABASE_URL;
const at = new Date('2026-09-18T00:00:00.000Z');

describe('substitute-receipt certificate on a derived capture source (PostgreSQL)', { skip: !databaseUrl }, () => {
  const tag = `cert-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-company`;
  const userId = `${tag}-user`;
  const approverId = `${tag}-approver`;
  let client: PrismaClient;
  let repo: PrismaExpenseRepository;
  let capture: PrismaExpenseCaptureRepository;
  let numbers: PrismaDocumentSequenceRepository;
  let branchId: string;
  let groupId: string;
  let allocationId: string;
  let unreachable: string | null = null;
  let seq = 0;

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'requires an explicit local test database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, max: 25 }) });
    const prisma = { client } as unknown as PrismaService;
    numbers = new PrismaDocumentSequenceRepository(prisma);
    repo = new PrismaExpenseRepository(prisma, numbers);
    capture = new PrismaExpenseCaptureRepository(prisma);
    unreachable = await pgSpecUnreachableReason(() => client.$queryRaw`SELECT 1`, 'EXPENSE_CAPTURE_CERTIFICATE_REQUIRE_POSTGRES');
    if (unreachable) return;
    await client.company.create({ data: { id: companyId, name: 'Synthetic certificate company', registeredName: 'บริษัท ทดสอบ จำกัด', taxId: '0105569135722' } });
    await client.user.createMany({ data: [
      { id: userId, displayName: 'ผู้รับรอง', status: 'ACTIVE' },
      { id: approverId, displayName: 'ผู้อนุมัติ', status: 'ACTIVE' },
    ] });
    branchId = (await client.branch.create({ data: { companyId, code: 'HO', name: 'สำนักงานใหญ่', type: 'HEAD_OFFICE' } })).id;
    groupId = (await capture.createGroup(client as never, {
      companyId, branchId, createdByUserId: userId, intakeChannel: 'WEB', note: 'two shops',
    })).id;
    allocationId = (await client.expenseCaptureAllocation.create({ data: {
      companyId, groupId, groupRevision: 4, policyVersion: 'shared-discount-v1+shipping-by-eligible-item-v1',
      selectionJson: {}, inputJson: {}, resultJson: {}, fundingRoute: 'COMPANY', computedByUserId: userId,
      computedAt: at, status: 'ACCEPTED', acceptedByUserId: userId, acceptedAt: at,
    } })).id;
    await client.expenseCaptureGroup.update({ where: { id: groupId }, data: {
      status: 'HANDED_OFF', handoffState: 'ACTIVE', acceptedAllocationId: allocationId,
      fundingRoute: 'COMPANY', businessUse: 'MIXED', handoffBatchKey: `${groupId}:${allocationId}`,
    } });
  });

  after(async () => {
    if (!client) return;
    try {
      if (!unreachable) {
        const where = { companyId };
        await client.auditLog.deleteMany({ where });
        await client.expensePayment.deleteMany({ where });
        await client.expenseSubstituteReceiptEvidence.deleteMany({ where });
        await client.documentSequence.deleteMany({ where }).catch(() => undefined);
        await client.attachmentLink.deleteMany({ where });
        await client.expenseLine.deleteMany({ where });
        await client.expenseRecord.deleteMany({ where });
        await client.attachmentObject.deleteMany({ where });
        await client.expenseCaptureAllocation.deleteMany({ where });
        await client.expenseCaptureGroup.deleteMany({ where });
        await client.branch.deleteMany({ where });
        await client.company.delete({ where: { id: companyId } });
        await client.user.deleteMany({ where: { id: { in: [userId, approverId] } } });
      }
    } finally {
      await client.$disconnect();
    }
  });

  const artifact = () => client.attachmentObject.create({ data: {
    companyId, branchId, storageProvider: 'LOCAL', bucket: 'local', objectKey: `${tag}/${++seq}`,
    originalFileName: 'signature.png', mimeType: 'image/png', byteSize: 1, checksumSha256: 'b'.repeat(64),
    uploadedByUserId: userId, status: 'ACTIVE',
  } });

  /** One shop of the group, exactly as the W05 handoff writes it (appendix §18.1). */
  async function derivedSource(scope: string, over: Record<string, unknown> = {}) {
    return client.expenseRecord.create({ data: {
      companyId, branchId, createdByUserId: userId, status: 'NEEDS_REVIEW', captureSource: 'WEB_UPLOAD',
      expenseDate: at, currency: 'THB', vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
      taxEvidenceStatus: 'SUPPORTING_ONLY', sourceDocumentType: 'MARKETPLACE_ORDER_SCREENSHOT',
      vendorNameSnapshot: `ร้าน${scope}`, accountHintKey: 'expense',
      subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', netPayableAmount: '100',
      outstandingAmount: '100', captureGroupId: groupId, captureAllocationId: allocationId,
      captureScopeKey: `issuer:${scope}`,
      aiVerificationSummaryJson: {
        captureGroupId: groupId, allocationId, scopeKey: `issuer:${scope}`,
        paidTotal: '160.00', companyAmount: '100.00', personalAmount: '60.00',
        policyVersion: 'shared-discount-v1+shipping-by-eligible-item-v1',
      },
      lines: { create: { companyId, lineNumber: 1, description: 'กระดาษ', quantity: '1', unitPrice: '100', lineTotalAmount: '100', taxableAmount: '100', lineSubtotalAmount: '100' } },
      ...over,
    } });
  }

  /** A certificate the payer has already signed — the state issuance starts from. */
  async function certified(expense: { id: string; updatedAt: Date }, status: 'PREPARED' | 'PAYER_CERTIFIED' = 'PAYER_CERTIFIED') {
    const signature = await artifact();
    const number = await numbers.reserveNumber({
      companyId, branchId, documentType: 'expense.substitute_receipt', periodKey: '2026-09',
      idempotencyKey: `fixture:${expense.id}`, reservedByUserId: userId,
    });
    const evidence = await client.expenseSubstituteReceiptEvidence.create({ data: {
      companyId, branchId, expenseId: expense.id, version: 1, status, signatureMode: 'DIGITAL',
      fundingSource: 'COMPANY', documentNumber: number.documentNumber, idempotencyKey: `${tag}-${++seq}`,
      originalSourceDocumentType: 'MARKETPLACE_ORDER_SCREENSHOT', reasonCode: 'PAYEE_CANNOT_ISSUE',
      missingReceiptReason: 'ร้านไม่ออกใบเสร็จ', businessPurpose: 'ใช้ในกิจการ',
      paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], paymentDate: at, paymentMethod: 'CASH',
      preparedByUserId: userId, preparedAt: at, expenseUpdatedAtAtPreparation: expense.updatedAt,
      payerUserId: userId, payerName: 'ผู้รับรอง', payeeName: 'ร้านค้า',
      ...(status === 'PAYER_CERTIFIED' ? {
        payerPosition: '', payerSignatureAttachmentId: signature.id, payerSignatureChecksumSha256: signature.checksumSha256,
        certifiedArtifactAttachmentId: signature.id, certifiedArtifactChecksumSha256: signature.checksumSha256,
        snapshotJson: { schemaVersion: 2, company: { taxId: '0105569135722' }, expense: { grandTotalAmount: '100.0000' } },
        snapshotChecksumSha256: 'snapshot', certifiedAt: at,
      } : {}),
    } });
    await numbers.commitNumber({ id: number.id, companyId, ownerType: 'expense_substitute_receipt', ownerId: evidence.id });
    return evidence;
  }

  const issue = async (expense: { id: string; updatedAt: Date }, evidence: { id: string; version: number; updatedAt: Date; payerSignatureAttachmentId: string | null }) => {
    const approverSignature = await artifact();
    return repo.issueSubstituteEvidence({
      companyId, expenseId: expense.id, evidenceId: evidence.id, approverUserId: approverId,
      approverName: 'ผู้อนุมัติ', approverPosition: 'ผู้จัดการ', allowSelfApproval: false,
      approverSignatureAttachmentId: approverSignature.id, approvedAt: new Date(),
      expectedExpenseUpdatedAt: expense.updatedAt,
      referencedAttachmentIds: [approverSignature.id, evidence.payerSignatureAttachmentId!],
      expectedVersion: evidence.version, expectedEvidenceUpdatedAt: evidence.updatedAt,
      artifact: {
        storageProvider: 'LOCAL', bucket: 'local', objectKey: `${tag}/issued-${++seq}`, objectVersionId: 'v1',
        byteSize: 10, checksumSha256: 'c'.repeat(64), originalFileName: 'issued.svg',
      },
    });
  };

  it('A20/A10: two approvers issuing the same shop at once record the company payment once', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expense = await derivedSource('race');
    const evidence = await certified(expense);

    const results = await Promise.allSettled([issue(expense, evidence), issue(expense, evidence)]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, 'exactly one issuance wins');
    const rows = await client.expenseSubstituteReceiptEvidence.findMany({ where: { companyId, expenseId: expense.id } });
    assert.deepEqual(rows.map((row) => row.status), ['ISSUED']);
    const payments = await client.expensePayment.findMany({ where: { companyId, expenseId: expense.id } });
    assert.equal(payments.length, 1, 'the company paid the shop once, not twice');
    assert.equal(payments[0]!.idempotencyKey, `substitute-receipt:${evidence.id}`);
    assert.equal(Number(payments[0]!.amount), 100);
    const after = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(after.paymentStatus, 'PAID');
    assert.equal(Number(after.paidAmount), 100);
  });

  it('A40: shop A stays issued while a failed shop B is retried, and only B changes', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const shopA = await derivedSource('a');
    const shopB = await derivedSource('b');
    const certificateA = await certified(shopA);
    const certificateB = await certified(shopB);

    await issue(shopA, certificateA);
    // B fails the way a slow tab does: it still holds the version it read before A was touched.
    await assert.rejects(() => issue(shopB, { ...certificateB, version: certificateB.version + 1 }), /changed/);

    // The retry is of the WHOLE job: A answers "already done" and writes nothing; B goes through.
    await assert.rejects(() => issue(shopA, certificateA), /changed/);
    const freshB = await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: certificateB.id } });
    await issue(await client.expenseRecord.findUniqueOrThrow({ where: { id: shopB.id } }), freshB);

    for (const id of [shopA.id, shopB.id]) {
      const payments = await client.expensePayment.findMany({ where: { companyId, expenseId: id } });
      assert.equal(payments.length, 1, `${id} paid exactly once`);
    }
    const issued = await client.expenseSubstituteReceiptEvidence.findMany({ where: { companyId, expenseId: { in: [shopA.id, shopB.id] } } });
    assert.deepEqual(issued.map((row) => row.status).sort(), ['ISSUED', 'ISSUED']);
    const artifacts = new Set(issued.map((row) => row.artifactAttachmentId));
    assert.equal(artifacts.size, 2, 'each shop keeps its own document');
  });

  it('A20/§12.4: a part-paid source blocks the whole issuance instead of topping the payment up', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expense = await derivedSource('partial');
    await client.expensePayment.create({ data: {
      companyId, expenseId: expense.id, amount: '40.0000', currency: 'THB', paymentMethod: 'CASH',
      paidAt: at, status: 'RECORDED', postingStatus: 'pending', createdByUserId: userId,
      idempotencyKey: `${tag}-partial`, payloadFingerprint: 'd'.repeat(64),
    } });
    const partly = await client.expenseRecord.update({ where: { id: expense.id }, data: {
      paidAmount: '40.0000', outstandingAmount: '60.0000', paymentStatus: 'PARTIALLY_PAID',
    } });
    const evidence = await certified(partly);

    await assert.rejects(() => issue(partly, evidence),
      (error: any) => (error.getResponse?.()?.code ?? error.response?.code) === 'substitute_full_payment_required');

    assert.equal(await client.expensePayment.count({ where: { companyId, expenseId: expense.id } }), 1,
      'no second payment was written to make the guard pass');
    assert.equal((await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).status, 'PAYER_CERTIFIED');
    assert.equal(Number((await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).paidAmount), 40);
  });

  it('A44/§12.4: a prepared certificate stops the group being rebuilt, and cancelling it releases the group', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expense = await derivedSource('regen');
    const evidence = await certified(expense, 'PREPARED');

    const consumers = await capture.findHandoffConsumers(client as never, companyId, groupId);
    assert.equal(consumers.some((row) => row.expenseId === expense.id && row.reason === 'certificate'), true,
      'W05 refuses to release a source whose certificate is being signed');

    await client.expenseSubstituteReceiptEvidence.update({ where: { id: evidence.id }, data: { status: 'SUPERSEDED', supersededAt: new Date(), supersedeReason: 'cancelled by test' } });
    const afterCancel = await capture.findHandoffConsumers(client as never, companyId, groupId);
    assert.equal(afterCancel.some((row) => row.expenseId === expense.id), false, 'a cancelled certificate holds nothing');
    // Cancelling touched neither the group nor the allocation it belongs to (§12.4 last bullet).
    const group = await client.expenseCaptureGroup.findUniqueOrThrow({ where: { id: groupId } });
    assert.equal(group.acceptedAllocationId, allocationId);
    assert.equal(group.handoffState, 'ACTIVE');
    assert.equal((await client.expenseCaptureAllocation.findUniqueOrThrow({ where: { id: allocationId } })).status, 'ACCEPTED');
  });

  it('§12.4/A22: editing a derived source re-signs its certificate exactly as an ordinary expense does', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expense = await derivedSource('edit');
    const evidence = await certified(expense);

    await repo.updateExpense({
      id: expense.id, companyId, updatedByUserId: userId, expectedUpdatedAt: expense.updatedAt,
      refreshSubstituteEvidence: { requestId: `${tag}-edit` },
      expenseDate: new Date('2026-09-10T00:00:00.000Z'), vendorNameSnapshot: 'ร้านแก้ไข',
    } as never);

    const rows = await client.expenseSubstituteReceiptEvidence.findMany({ where: { companyId, expenseId: expense.id }, orderBy: { version: 'asc' } });
    assert.equal(rows.length, 2, 'the signed version is kept and a fresh one is prepared');
    assert.equal(rows[0]!.status, 'SUPERSEDED');
    assert.equal(rows[0]!.supersedeReason, EXPENSE_EDIT_RESIGN_REASON);
    assert.equal(rows[1]!.status, 'PREPARED');
    assert.equal(rows[1]!.documentNumber, evidence.documentNumber, 'the number is immutable');
    assert.equal(rows[1]!.payerSignatureAttachmentId, null, 'the signature does not move to the new version');
    // The edit never disturbs what makes this expense a derived source (§14.3).
    const edited = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(edited.captureGroupId, groupId);
    assert.equal(edited.captureAllocationId, allocationId);
    assert.equal(edited.captureScopeKey, 'issuer:edit');
    assert.equal(await client.expensePayment.count({ where: { companyId, expenseId: expense.id } }), 0);
  });
});
