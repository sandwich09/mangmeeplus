import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { DownloadSubstituteReceiptPdfUseCase } from './substitute-receipt.use-case';
import { SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON } from '../../infrastructure/prisma-expense.repository';

const issuedSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="850" height="180" viewBox="0 0 850 180">
    <rect width="850" height="180" fill="#fff"/>
    <text x="425" y="90" text-anchor="middle" font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="24">ใบรับรองแทนใบเสร็จรับเงิน</text>
  </svg>
`);

function useCase(status: 'ISSUED' | 'SUPERSEDED', supersedeReason: string | null) {
  const audit = { log: mock.fn(async (_entry: unknown) => undefined) };
  return {
    audit,
    instance: new DownloadSubstituteReceiptPdfUseCase(
      { execute: mock.fn(async () => ({ id: 'expense-1' })) } as any,
      {
        findSubstituteEvidence: mock.fn(async () => ({
          id: 'evidence-1', status, supersedeReason, documentNumber: 'SRC-202608-00001',
          artifactAttachmentId: 'artifact-1',
        })),
        findSubstituteArtifactAttachment: mock.fn(async () => ({
          bucket: 'bucket', objectKey: 'issued.svg', objectVersionId: 'version-1',
        })),
      } as any,
      { getObject: mock.fn(async () => ({ bytes: issuedSvg })) } as any,
      audit as any,
    ),
  };
}

describe('DownloadSubstituteReceiptPdfUseCase cancelled artifacts', () => {
  it('downloads an expense-voided certificate only as a visibly VOID-derived PDF', async () => {
    const { instance, audit } = useCase('SUPERSEDED', SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON);

    const result = await instance.execute({
      companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog', requestId: 'request-1',
    } as any, 'expense-1', 'evidence-1');

    const pdf = await PDFDocument.load(result.data);
    assert.match(pdf.getSubject() ?? '', /State: VOID/);
    assert.equal(result.fileName, 'SRC-202608-00001-VOID.pdf');
    assert.equal((audit.log.mock.calls[0]?.arguments[0] as any).metadataJson.derivedStamp, 'VOID');
  });

  it('marks a corrected historical certificate as SUPERSEDED instead of mislabelling it void', async () => {
    const { instance } = useCase('SUPERSEDED', 'NEW_VERSION_ISSUED');

    const result = await instance.execute({
      companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog',
    } as any, 'expense-1', 'evidence-1');

    const pdf = await PDFDocument.load(result.data);
    assert.match(pdf.getSubject() ?? '', /State: SUPERSEDED/);
    assert.equal(result.fileName, 'SRC-202608-00001-SUPERSEDED.pdf');
  });
});
