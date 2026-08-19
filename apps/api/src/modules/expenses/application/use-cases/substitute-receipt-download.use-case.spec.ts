import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { DownloadSubstituteReceiptFormPdfUseCase, DownloadSubstituteReceiptPdfUseCase } from './substitute-receipt.use-case';
import { SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON } from '../../infrastructure/prisma-expense.repository';
import {
  buildSubstituteCertificationText,
  renderSubstituteReceiptSvg,
  SUBSTITUTE_RECEIPT_UNSIGNED_NOTICE,
  type SubstituteReceiptSnapshot,
} from '../../domain/logic/substitute-receipt.logic';

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

const preparedAt = new Date('2026-08-20T03:00:00.000Z');

function snapshot(): SubstituteReceiptSnapshot {
  return {
    documentNumber: 'SUB-202608-00007', version: 1,
    company: { name: 'บริษัท ทดสอบ จำกัด', branchName: null, taxId: '0105500000001' },
    expense: {
      id: 'expense-1', expenseNumber: 'EXP-001', expenseDate: preparedAt.toISOString(),
      paymentDate: preparedAt.toISOString(), currency: 'THB', grandTotalAmount: '50.00',
      paymentMethod: 'CASH', paymentReference: null, category: 'cat-travel',
      businessPurpose: 'ไปพบลูกค้า',
      lines: [{ description: 'ค่าวินมอเตอร์ไซค์', quantity: '1', amount: '50.00' }],
    },
    originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'PAYEE_CANNOT_ISSUE',
    missingReceiptReason: 'วินไม่ออกใบเสร็จ',
    payee: { name: 'วินมอเตอร์ไซค์', address: null, taxId: null },
    payer: { userId: 'user-1', name: 'สมชาย', position: '__________', certifiedAt: '0000-01-01T00:00:00.000Z' },
    certificationText: buildSubstituteCertificationText('สมชาย', '__________'),
    evidence: [], note: null,
  };
}

function formUseCase(status = 'PREPARED', expenseUpdatedAt = preparedAt) {
  const entries: any[] = [];
  const instance = new DownloadSubstituteReceiptFormPdfUseCase({
    findSubstituteEvidence: mock.fn(async () => ({
      id: 'evidence-1', status, documentNumber: 'SUB-202608-00007', version: 1,
      reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'วินไม่ออกใบเสร็จ', businessPurpose: 'ไปพบลูกค้า',
      paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [],
      paymentDate: preparedAt, paymentMethod: 'CASH', note: null,
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', expenseUpdatedAtAtPreparation: preparedAt,
      payerUserId: 'user-1', payerName: 'สมชาย', payeeName: 'วินมอเตอร์ไซค์', payeeAddress: null, payeeTaxId: null,
    })),
    findByIdWithRelations: mock.fn(async () => ({
      id: 'expense-1', branchId: null, expenseNumber: 'EXP-001', expenseDate: preparedAt, paidAt: preparedAt,
      currency: 'THB', grandTotalAmount: '50.00', paymentMethod: 'CASH', bankAccountRef: null,
      expenseCategoryId: 'cat-travel', accountHintKey: null, updatedAt: expenseUpdatedAt,
      lines: [{ description: 'ค่าวินมอเตอร์ไซค์', quantity: '1', lineTotalAmount: '50.00' }],
    })),
    findSubstituteEvidenceAttachments: mock.fn(async () => []),
    getSubstituteCompanyContext: mock.fn(async () => ({ name: 'บริษัท ทดสอบ จำกัด', branchName: null, taxId: '0105500000001' })),
  } as any, { log: async (entry: any) => { entries.push(entry); } } as any);
  return Object.assign(instance, { entries });
}

const webCtx = { companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog', permissions: ['expense.review'], scopes: {} } as any;

describe('R8 — แบบฟอร์มรอลงนาม', () => {
  it('renders a PREPARED evidence as an UNSIGNED-stamped PDF that is never stored, and audits the egress', async () => {
    const useCase = formUseCase();
    const result = await useCase.execute({ ...webCtx, requestId: 'request-9' }, 'expense-1', 'evidence-1');

    const pdf = await PDFDocument.load(result.data);
    assert.match(pdf.getSubject() ?? '', /State: UNSIGNED/);
    assert.equal(pdf.getTitle(), 'SUB-202608-00007');
    assert.equal(result.fileName, 'SUB-202608-00007-UNSIGNED.pdf');

    // Same shape as the issued-artifact download: this sheet carries payee name and amount too.
    assert.equal(useCase.entries.length, 1);
    assert.deepEqual(useCase.entries[0], {
      companyId: 'company-1', actorUserId: 'user-1', action: 'expense.substitute_receipt.form.download',
      targetType: 'expense_substitute_receipt', targetId: 'evidence-1', requestId: 'request-9',
      result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { expenseId: 'expense-1', evidenceStatus: 'PREPARED', version: 1, derivedStamp: 'UNSIGNED' },
    });
  });

  it('prints the incompleteness line and a large document number, and leaves the signed layout byte-identical', async () => {
    const form = renderSubstituteReceiptSvg(snapshot(), undefined, undefined, undefined, { unsignedForm: true }).toString('utf8');
    const signed = renderSubstituteReceiptSvg(snapshot()).toString('utf8');

    assert.ok(form.includes(SUBSTITUTE_RECEIPT_UNSIGNED_NOTICE));
    assert.equal(SUBSTITUTE_RECEIPT_UNSIGNED_NOTICE, 'เอกสารนี้ยังไม่สมบูรณ์จนกว่าจะมีลายเซ็นผู้จ่ายและผู้อนุมัติ');
    assert.match(form, /font-size="24" font-weight="700"[^>]*>เลขที่ SUB-202608-00007/u,
      'D9 reads this number off a photographed sheet, so it prints at title size');
    assert.ok(form.includes('รอลงนาม') && form.includes('รอผู้อนุมัติลงนาม'), 'both signature boxes stay blank');

    // The signed/issued path must be byte-for-byte what it was before the form option existed:
    // the exact heading line, no notice, and no whitespace-only line where the notice would go.
    assert.equal(signed.includes(SUBSTITUTE_RECEIPT_UNSIGNED_NOTICE), false);
    assert.ok(signed.includes('<text x="425" y="76" text-anchor="middle" fill="#555">เลขที่ SUB-202608-00007 · version 1</text>'));
    assert.ok(signed.endsWith('โดยลำพัง</text>\n  </g>\n</svg>'),
      'the optional notice row leaves no whitespace-only line behind it on the signed path');
    assert.deepEqual(
      renderSubstituteReceiptSvg(snapshot()),
      renderSubstituteReceiptSvg(snapshot(), undefined, undefined, undefined, {}),
      'an empty options object renders the same bytes as no options at all',
    );
  });

  it('exists only while the evidence is PREPARED, on the authenticated web, and only while the expense is unchanged', async () => {
    for (const status of ['PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED']) {
      await assert.rejects(
        () => formUseCase(status).execute(webCtx, 'expense-1', 'evidence-1'),
        /only while the evidence is PREPARED/,
      );
    }
    await assert.rejects(
      () => formUseCase().execute({ ...webCtx, authProvider: 'line' }, 'expense-1', 'evidence-1'),
      /authenticated web only/,
    );
    await assert.rejects(
      () => formUseCase().execute({ ...webCtx, permissions: [] }, 'expense-1', 'evidence-1'),
      /expense\.review/,
    );
    // Someone is about to sign this by hand: an expense edited after prepare must not print.
    const stale = formUseCase('PREPARED', new Date(preparedAt.getTime() + 1000));
    await assert.rejects(
      () => stale.execute(webCtx, 'expense-1', 'evidence-1'),
      /changed after preparation/,
    );
    assert.equal(stale.entries.length, 0, 'a refused form is not an egress');
  });
});
