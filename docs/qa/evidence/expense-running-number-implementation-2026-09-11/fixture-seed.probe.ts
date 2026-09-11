import { PrismaClient } from './src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/expense_number_impl_20260911') throw new Error('local review database only');
  if (!['localhost', '127.0.0.1'].includes(new URL(process.env.S3_ENDPOINT!).hostname)) throw new Error('local object storage only');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const companyId = 'seed-local-company';
  const branch = await db.branch.findFirstOrThrow({ where: { companyId, name: { contains: 'สยาม' } } });
  const payer = await db.user.findFirstOrThrow({ where: { id: 'seed-local-owner' } });
  const id = 'qa-exp-number-impl-' + process.argv[2];
  if (await db.expenseRecord.findUnique({ where: { id } })) { console.log({ expenseId: id, exists: true }); await db.$disconnect(); return; }
  const bytes = await sharp(Buffer.from('<svg width="700" height="360" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" fill="black"><text x="40" y="60" font-size="28">LOCAL QA - REIMBURSEMENT EVIDENCE</text><text x="40" y="120" font-size="22">Date: 2026-08-22</text><text x="40" y="170" font-size="22">Travel 60.00 + Delivery 40.00</text><text x="40" y="230" font-size="28">TOTAL THB 100.00</text><text x="40" y="310" font-size="18">Test fixture only</text></g></svg>')).png().toBuffer();
  const key = `${companyId}/local-qa/${id}.png`;
  const s3 = new S3Client({ region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
  await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: bytes, ContentType: 'image/png' }));
  const file = await db.attachmentObject.create({ data: { companyId, branchId: branch.id, storageProvider: 's3', bucket: process.env.S3_BUCKET!, objectKey: key, originalFileName: 'LOCAL-QA-evidence-100.png', mimeType: 'image/png', byteSize: bytes.length, checksumSha256: createHash('sha256').update(bytes).digest('hex'), uploadedByUserId: payer.id, status: 'ACTIVE' } });
  await db.expenseRecord.create({ data: { id, companyId, branchId: branch.id, createdByUserId: payer.id, expenseDate: new Date('2026-08-22T00:00:00Z'), vendorNameSnapshot: 'LOCAL QA ร้านทดสอบใบเบิก', vendorDocumentNumber: 'QA-SOURCE-100', status: 'NEEDS_REVIEW', vatMode: 'NO_VAT', sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE', primaryAttachmentId: file.id, subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', netPayableAmount: '100', outstandingAmount: '100', lines: { create: [{ companyId, lineNumber: 1, description: 'ค่าเดินทาง QA', quantity: '1', unitPrice: '60', taxableAmount: '60', lineSubtotalAmount: '60', lineTotalAmount: '60', accountHintKey: 'travel' }, { companyId, lineNumber: 2, description: 'ค่าส่งสินค้า QA', quantity: '1', unitPrice: '40', taxableAmount: '40', lineSubtotalAmount: '40', lineTotalAmount: '40', accountHintKey: 'delivery' }] } } });
  await db.attachmentLink.create({ data: { companyId, attachmentId: file.id, targetType: 'expense.record', targetId: id, purpose: 'expense.receipt.primary', linkedByUserId: payer.id } });
  console.log({ expenseId: id, branchId: branch.id, requesterName: payer.displayName });
  await db.$disconnect();
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
