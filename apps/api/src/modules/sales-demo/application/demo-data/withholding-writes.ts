import { createHash } from 'node:crypto';
import type { Prisma } from '../../../../generated/prisma/client';
import type { PrismaService } from '../../../../common/database/prisma.service';
import type { AuditService } from '../../../audit/application/audit.service';
import { PrismaDocumentSequenceRepository } from '../../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { certificatePayment } from '../../../tax/application/services/wht-certificate-payment';
import { appendWhtCertificateHistory } from '../../../tax/application/services/wht-certificate-history';
import { demoId, documentDate, type DemoInput, type DemoRows } from './expense-writes';

/** Seed the same certificate, number ownership, payment snapshot and history as handoff issuance.
 * This is sample persistence, with no launch-control mutation or external artifact rendering.
 */
export async function writeDemoCertificate(
  tx: Prisma.TransactionClient, service: PrismaService, audit: AuditService, input: DemoInput, rows: DemoRows,
): Promise<void> {
  const expenseId = demoId(input.companyId, rows.certificate.expenseKey);
  const handoff = await tx.whtCertificateHandoff.findFirstOrThrow({ where: {
    companyId: input.companyId, sourcePaymentType: 'expense.record', sourcePaymentId: expenseId, status: 'REQUIRED',
  } });
  const payment = await certificatePayment(tx, input.companyId, handoff);
  if (Number(payment.grossAmount) !== 3500 || Number(payment.withheldAmount) !== 105) {
    throw new Error('Demo withholding payment does not match its repair expense');
  }
  const periodKey = documentDate(rows.certificate.date).toISOString().slice(0, 7);
  const period = await tx.taxPeriod.create({ data: {
    id: demoId(input.companyId, 'wht-period'), companyId: input.companyId,
    taxType: 'WHT', formType: 'PND3', periodKey,
  } });
  const numbers = new PrismaDocumentSequenceRepository(service);
  const reserved = await numbers.reserveNumberInTransaction(tx, {
    companyId: input.companyId, documentType: 'tax.wht_certificate', periodKey,
    idempotencyKey: demoId(input.companyId, 'wht-certificate-number'), reservedByUserId: input.ownerUserId,
  });
  const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId } });
  const category = await tx.whtIncomeCategory.findUniqueOrThrow({ where: { code: 'WHT_SERVICE_3' } });
  const certificate = await tx.whtCertificate.create({ data: {
    id: demoId(input.companyId, 'wht-certificate'), companyId: input.companyId,
    certificateNumber: reserved.documentNumber, status: 'ISSUED', taxPeriodId: period.id, periodKey,
    payeeSnapshotJson: payment.payeeSnapshot as unknown as Prisma.InputJsonObject,
    payerSnapshotJson: {
      companyName: company.name, taxId: '0994000000090', branchCode: '00000',
      address: '1 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพมหานคร 10110',
    },
    incomeCategoryCode: category.code, incomeCategoryName: category.nameTh,
    whtRate: rows.certificate.whtRate, grossAmount: payment.grossAmount, withheldAmount: payment.withheldAmount,
    paymentDate: new Date(payment.paymentDate), taxEventIdsJson: [],
    issuedAt: input.now, issuedByUserId: input.ownerUserId,
  } });
  await numbers.commitNumberInTransaction(tx, {
    id: reserved.id, companyId: input.companyId, ownerType: 'tax.wht_certificate', ownerId: certificate.id,
  });
  await tx.whtCertificateHandoff.update({ where: { id: handoff.id }, data: {
    status: 'SYSTEM_ISSUED', certificateId: certificate.id,
    prefillSnapshotJson: payment as unknown as Prisma.InputJsonObject,
    prefillSnapshotHash: createHash('sha256').update(JSON.stringify(payment)).digest('hex'),
  } });
  await appendWhtCertificateHistory(tx, handoff, {
    eventType: 'ISSUED', actorUserId: input.ownerUserId, isExternal: false,
    certificateId: certificate.id, certificateNumber: certificate.certificateNumber,
    certificateDate: certificate.issuedAt, reason: 'demo_seed',
  });
  for (const action of ['document.number.reserve', 'document.number.commit']) {
    await audit.log({ companyId: input.companyId, actorUserId: input.ownerUserId, action,
      targetType: 'document_number', targetId: reserved.id, requestId: demoId(input.companyId, 'seed'), result: 'SUCCESS',
    }, tx);
  }
  await audit.log({ companyId: input.companyId, actorUserId: input.ownerUserId,
    action: 'tax.wht_certificate.issue', targetType: 'wht_certificate', targetId: certificate.id,
    requestId: demoId(input.companyId, 'seed'), result: 'SUCCESS', riskLevel: 'HIGH',
    metadataJson: { source: 'handoff', handoffId: handoff.id, certificateNumber: certificate.certificateNumber, periodKey },
  }, tx);
}
