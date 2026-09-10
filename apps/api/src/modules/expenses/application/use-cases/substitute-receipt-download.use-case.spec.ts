import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DownloadSubstituteReceiptFormPdfUseCase, DownloadSubstituteReceiptPdfUseCase } from './substitute-receipt.use-case';
import { SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON } from '../../infrastructure/prisma-expense.repository';
import {
  buildSubstituteCertificationText,
  renderSubstituteReceiptSvg,
  SUBSTITUTE_RECEIPT_UNSIGNED_NOTICE,
  type SubstituteReceiptSnapshot,
} from '../../domain/logic/substitute-receipt.logic';

const cleanIssuedSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="850" height="180" viewBox="0 0 850 180">
    <rect width="850" height="180" fill="#fff"/>
    <text x="425" y="90" text-anchor="middle" font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="24">ใบรับรองแทนใบเสร็จรับเงิน</text>
  </svg>
`);
const oldSystemFooter = '<text x="425" y="150" text-anchor="middle" font-size="12" fill="#555">เอกสารนี้เป็นหลักฐานประกอบรายจ่ายภายใน มิใช่ใบกำกับภาษี และไม่ก่อสิทธิภาษีซื้อโดยลำพัง</text>';
const issuedSvg = Buffer.from(cleanIssuedSvg.toString().replace('</svg>', `${oldSystemFooter}</svg>`));

async function assertNoPageFooter(bytes: Buffer, stateStamp?: string) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await task.promise;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ');
      assert.doesNotMatch(text, /ID:|SHA256:|Page \d+\/\d+/);
      if (stateStamp) assert.ok(text.includes(stateStamp));
    }
  } finally {
    await task.destroy();
  }
}

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
    await assertNoPageFooter(result.data, 'VOID');
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
    await assertNoPageFooter(result.data, 'SUPERSEDED');
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

function formExpense(expenseUpdatedAt = preparedAt) {
  return {
    id: 'expense-1', branchId: null, expenseNumber: 'EXP-001', expenseDate: preparedAt, paidAt: preparedAt,
    currency: 'THB', grandTotalAmount: '50.00', paymentMethod: 'CASH', bankAccountRef: null,
    expenseCategoryId: 'cat-travel', accountHintKey: null, updatedAt: expenseUpdatedAt,
    lines: [{ description: 'ค่าวินมอเตอร์ไซค์', quantity: '1', lineTotalAmount: '50.00' }],
  } as any;
}

function formRepo(status = 'PREPARED', expenseUpdatedAt = preparedAt) {
  return {
    findSubstituteEvidence: mock.fn(async () => ({
      id: 'evidence-1', status, signatureMode: 'DIGITAL', documentNumber: 'SUB-202608-00007', version: 1,
      reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'วินไม่ออกใบเสร็จ', businessPurpose: 'ไปพบลูกค้า',
      paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [],
      paymentDate: preparedAt, paymentMethod: 'CASH', note: null,
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', expenseUpdatedAtAtPreparation: preparedAt,
      payerUserId: 'user-1', payerName: 'สมชาย', payeeName: 'วินมอเตอร์ไซค์', payeeAddress: null, payeeTaxId: null,
    })),
    findByIdWithRelations: mock.fn(async () => formExpense(expenseUpdatedAt)),
    findSubstituteEvidenceAttachments: mock.fn(async () => []),
    getSubstituteCompanyContext: mock.fn(async () => ({ name: 'บริษัท ทดสอบ จำกัด', branchName: null, taxId: '0105500000001' })),
  } as any;
}

function formUseCase(status = 'PREPARED', expenseUpdatedAt = preparedAt) {
  const entries: any[] = [];
  const instance = new DownloadSubstituteReceiptFormPdfUseCase(
    formRepo(status, expenseUpdatedAt),
    { log: async (entry: any) => { entries.push(entry); } } as any,
  );
  return Object.assign(instance, { entries });
}

const webCtx = { companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog', permissions: ['expense.review'], scopes: {} } as any;

describe('R8 — แบบฟอร์มรอลงนาม', () => {
  it('renders a PREPARED evidence as an UNSIGNED-stamped PDF that is never stored, and audits the egress', async () => {
    const useCase = formUseCase();
    const result = await useCase.execute({ ...webCtx, requestId: 'request-9' }, 'expense-1', 'evidence-1');
    await assertNoPageFooter(result.data, 'UNSIGNED');

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

  it('keeps the unsigned status notice and omits the signed certificate footer', async () => {
    const form = renderSubstituteReceiptSvg(snapshot(), undefined, undefined, undefined, { unsignedForm: true }).toString('utf8');
    const signed = renderSubstituteReceiptSvg(snapshot()).toString('utf8');

    assert.ok(form.includes(SUBSTITUTE_RECEIPT_UNSIGNED_NOTICE));
    assert.equal(SUBSTITUTE_RECEIPT_UNSIGNED_NOTICE, 'เอกสารนี้ยังไม่สมบูรณ์จนกว่าจะมีลายเซ็นผู้จ่ายและผู้อนุมัติ');
    assert.match(form, /font-size="24" font-weight="700"[^>]*>เลขที่ SUB-202608-00007/u,
      'D9 reads this number off a photographed sheet, so it prints at title size');
    assert.ok(form.includes('รอลงนาม') && form.includes('รอผู้อนุมัติลงนาม'), 'both signature boxes stay blank');

    assert.equal(signed.includes(SUBSTITUTE_RECEIPT_UNSIGNED_NOTICE), false);
    assert.ok(signed.includes('<text x="425" y="76" text-anchor="middle" fill="#555">เลขที่ SUB-202608-00007 · version 1</text>'));
    assert.doesNotMatch(signed, /มิใช่ใบกำกับภาษี/);
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

/** R11: the paper route's issued document is the scan first, then the system attestation page. */
async function scanPdf(pages: Array<[number, number]>): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const [width, height] of pages) pdf.addPage([width, height]);
  return Buffer.from(await pdf.save());
}

function paperUseCase(scan: { bytes: Buffer; mimeType: string }, attestation = issuedSvg, recordedChecksum?: string) {
  const audit = { log: mock.fn(async (_entry: unknown) => undefined) };
  const lookups: any[] = [];
  const instance = new DownloadSubstituteReceiptPdfUseCase(
    { execute: mock.fn(async () => ({ id: 'expense-1' })) } as any,
    {
      findSubstituteEvidence: mock.fn(async () => ({
        id: 'evidence-1', status: 'ISSUED', supersedeReason: null, documentNumber: 'SUB-202608-00007',
        artifactAttachmentId: 'artifact-1', signatureMode: 'PAPER',
        wetSignedScanAttachmentId: 'scan-1',
        wetSignedScanChecksumSha256: recordedChecksum ?? createHash('sha256').update(scan.bytes).digest('hex'),
      })),
      findSubstituteArtifactAttachment: mock.fn(async (_companyId: string, _expenseId: string, attachmentId: string, mimeTypes?: string[]) => {
        lookups.push({ attachmentId, mimeTypes });
        return attachmentId === 'scan-1'
          ? { bucket: 'bucket', objectKey: 'scan', mimeType: scan.mimeType }
          : { bucket: 'bucket', objectKey: 'issued.svg', objectVersionId: 'version-1', mimeType: 'image/svg+xml' };
      }),
    } as any,
    { getObject: mock.fn(async (input: any) => (input.objectKey === 'scan' ? { bytes: scan.bytes } : { bytes: attestation })) } as any,
    audit as any,
  );
  return { instance, audit, lookups };
}

describe('R11 — the paper-route issued artifact', () => {
  it('previews every issued page and enforces the existing expense-read boundary', async () => {
    const { instance, audit } = paperUseCase({ bytes: await scanPdf([[200, 300], [200, 300]]), mimeType: 'application/pdf' });
    const ctx = { companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog' } as any;
    const preview = await instance.preview(ctx, 'expense-1', 'evidence-1');
    assert.equal(preview.pageImageDataUrls.length, 3);
    assert.match(preview.pdfDataUrl, /^data:application\/pdf;base64,/);
    assert.equal(audit.log.mock.callCount(), 1);
    (instance as any).getExpense.execute = async () => { throw new Error('expense read denied'); };
    await assert.rejects(() => instance.preview(ctx, 'expense-1', 'evidence-1'), /expense read denied/);
    assert.equal(audit.log.mock.callCount(), 1, 'refused read does not generate another artifact');
  });
  it('serves the scan pages first and the system attestation page last', async () => {
    const scan = await scanPdf([[200, 300], [200, 300]]);
    const { instance, audit, lookups } = paperUseCase({ bytes: scan, mimeType: 'application/pdf' });

    const result = await instance.execute({
      companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog', requestId: 'request-11',
    } as any, 'expense-1', 'evidence-1');

    const pdf = await PDFDocument.load(result.data);
    assert.equal(pdf.getPageCount(), 3, 'two scan pages plus one attestation page');
    assert.deepEqual(pdf.getPage(0).getSize(), { width: 200, height: 300 }, 'the scan is page one');
    assert.deepEqual(pdf.getPage(1).getSize(), { width: 200, height: 300 });
    assert.equal(Math.round(pdf.getPage(2).getSize().width), 595, 'the attestation is the A4 page behind it');
    assert.match(pdf.getSubject() ?? '', /Wet-signed scan \+ system attestation/);
    assert.equal(pdf.getTitle(), 'SUB-202608-00007');
    // The scan is read through the certification-chain lookup, widened to its own media types only.
    assert.deepEqual(lookups.map((item) => item.attachmentId), ['artifact-1', 'scan-1']);
    assert.deepEqual(lookups[1].mimeTypes, ['image/jpeg', 'image/png', 'application/pdf']);
    const entry = audit.log.mock.calls[0]?.arguments[0] as any;
    assert.equal(entry.metadataJson.signatureMode, 'PAPER');
    assert.equal(entry.metadataJson.wetSignedScanAttachmentId, 'scan-1');
  });

  it('refuses to hand over a scan that no longer matches the checksum recorded at certification', async () => {
    const { instance } = paperUseCase({ bytes: await scanPdf([[200, 300]]), mimeType: 'application/pdf' }, issuedSvg, 'a-different-checksum');

    await assert.rejects(
      () => instance.execute({ companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog' } as any, 'expense-1', 'evidence-1'),
      (error: any) => {
        // Printing different bytes under a certified document number would be a forged document.
        assert.equal(error.getResponse().code, 'substitute_wet_signed_scan_checksum_mismatch');
        return true;
      },
    );
  });

  it('reports an unreadable stored scan as a state, never as an unexplained failure', async () => {
    const { instance } = paperUseCase({ bytes: Buffer.from('no longer a pdf'), mimeType: 'application/pdf' });

    await assert.rejects(
      () => instance.execute({ companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog' } as any, 'expense-1', 'evidence-1'),
      (error: any) => {
        assert.equal(error.getResponse().code, 'substitute_wet_signed_scan_not_renderable');
        return true;
      },
    );
  });

  it('refuses to serve a paper certificate whose scan is gone', async () => {
    const { instance } = paperUseCase({ bytes: Buffer.alloc(0), mimeType: 'application/pdf' });
    (instance as any).repo.findSubstituteArtifactAttachment = async (_c: string, _e: string, attachmentId: string) =>
      attachmentId === 'scan-1' ? null : { bucket: 'bucket', objectKey: 'issued.svg', mimeType: 'image/svg+xml' };

    await assert.rejects(
      () => instance.execute({ companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog' } as any, 'expense-1', 'evidence-1'),
      /hand-signed scan .* no longer available/,
    );
  });

  it('downloads an existing digital certificate without generated footers and preserves its stored SVG', async () => {
    const { instance } = useCase('ISSUED', null);
    const storedDigest = createHash('sha256').update(issuedSvg).digest('hex');

    const result = await instance.execute({
      companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog',
    } as any, 'expense-1', 'evidence-1');

    const pdf = await PDFDocument.load(result.data);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal((pdf.getSubject() ?? '').includes('Wet-signed scan'), false);
    assert.equal(pdf.getSubject(), `Source SHA256: ${createHash('sha256').update(cleanIssuedSvg).digest('hex')}`);
    assert.equal(createHash('sha256').update(issuedSvg).digest('hex'), storedDigest);
    assert.ok(issuedSvg.toString().includes(oldSystemFooter));
    await assertNoPageFooter(result.data);
    assert.equal(result.fileName, 'SUB-202608-00001.pdf'.replace('SUB', 'SRC'));
  });
});

describe('hub printing follows the retained document state', () => {
  const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  function currentUseCase(evidence: Record<string, unknown>, bytes: Buffer = cleanIssuedSvg) {
    const repo = formRepo();
    const originalFind = repo.findSubstituteEvidence;
    repo.findSubstituteEvidence = async () => ({ ...await originalFind(), ...evidence });
    repo.findSubstituteArtifactAttachment = mock.fn(async () => ({ bucket: 'bucket', objectKey: 'retained', mimeType: evidence.signatureMode === 'PAPER' ? 'application/pdf' : 'image/svg+xml' }));
    const getExpense = { execute: mock.fn(async () => formExpense()) };
    const storage = { getObject: mock.fn(async () => ({ bytes })) };
    const audit = { log: mock.fn(async () => undefined) };
    return { repo, getExpense, storage, audit, instance: new DownloadSubstituteReceiptPdfUseCase(getExpense as any, repo, storage as any, audit as any) };
  }

  it('prints a current unsigned online form with read access and no signing writes', async () => {
    const { instance, repo, storage } = currentUseCase({ status: 'PREPARED' });
    const result = await instance.execute(webCtx, 'expense-1', 'evidence-1');
    await assertNoPageFooter(result.data, 'UNSIGNED');
    assert.equal(repo.findByIdWithRelations.mock.callCount(), 1);
    assert.equal(storage.getObject.mock.callCount(), 0);
  });

  it('prints the prepared blank paper form without adding signatures or a footer', async () => {
    const { instance, storage } = currentUseCase({ status: 'PREPARED', signatureMode: 'PAPER', payerUserId: null, paperFormSnapshotJson: snapshot() });
    const result = await instance.execute(webCtx, 'expense-1', 'evidence-1');
    assert.match(result.fileName, /PAPER-FORM/);
    await assertNoPageFooter(result.data);
    assert.equal(storage.getObject.mock.callCount(), 0);
  });

  it('prints the actual online certified artifact awaiting approval and verifies its checksum', async () => {
    const evidence = { status: 'PAYER_CERTIFIED', certifiedArtifactAttachmentId: 'signed', certifiedArtifactChecksumSha256: checksum(cleanIssuedSvg) };
    const { instance, repo } = currentUseCase(evidence);
    const result = await instance.execute(webCtx, 'expense-1', 'evidence-1');
    await assertNoPageFooter(result.data, 'AWAITING APPROVAL');
    assert.equal(repo.findByIdWithRelations.mock.callCount(), 0, 'must not rebuild signed content from current expense');
    await assert.rejects(currentUseCase({ ...evidence, certifiedArtifactChecksumSha256: 'wrong' }).instance.execute(webCtx, 'expense-1', 'evidence-1'), /ไม่ตรง/);
  });

  it('prints all uploaded scan pages awaiting acceptance without inventing a reviewer or attestation', async () => {
    const bytes = await scanPdf([[595, 842], [400, 600]]);
    const evidence = { status: 'PREPARED', signatureMode: 'PAPER', paperSubmissionJson: { payer: { name: 'ผู้ลงนามจริง' } }, wetSignedScanAttachmentId: 'scan', wetSignedScanChecksumSha256: checksum(bytes) };
    const { instance, repo } = currentUseCase(evidence, bytes);
    const result = await instance.execute(webCtx, 'expense-1', 'evidence-1');
    assert.equal((await PDFDocument.load(result.data)).getPageCount(), 2);
    await assertNoPageFooter(result.data, 'AWAITING REVIEW');
    assert.equal(repo.findByIdWithRelations.mock.callCount(), 0);
    await assert.rejects(currentUseCase({ ...evidence, wetSignedScanChecksumSha256: 'wrong' }, bytes).instance.execute(webCtx, 'expense-1', 'evidence-1'), /ไม่ตรง/);
  });

  it('prints cancelled certified and prepared snapshots only from retained history', async () => {
    for (const retained of [{ certifiedArtifactAttachmentId: 'signed', certifiedArtifactChecksumSha256: checksum(cleanIssuedSvg) }, { signatureMode: 'PAPER', payerUserId: null, paperFormSnapshotJson: snapshot() }]) {
      const { instance, repo } = currentUseCase({ status: 'SUPERSEDED', ...retained });
      await assertNoPageFooter((await instance.execute(webCtx, 'expense-1', 'evidence-1')).data, 'SUPERSEDED');
      assert.equal(repo.findByIdWithRelations.mock.callCount(), 0);
    }
    const missing = currentUseCase({ status: 'SUPERSEDED' });
    await assert.rejects(missing.instance.execute(webCtx, 'expense-1', 'evidence-1'), /ข้อมูลฉบับเดิมเพียงพอ/);
    assert.equal(missing.repo.findByIdWithRelations.mock.callCount(), 0);
  });

  it('refuses inaccessible, stale unsigned, incomplete signed and missing issued documents', async () => {
    const denied = currentUseCase({});
    denied.getExpense.execute.mock.mockImplementation(async () => { throw new Error('access denied'); });
    await assert.rejects(denied.instance.execute(webCtx, 'expense-1', 'evidence-1'), /access denied/);
    assert.equal(denied.storage.getObject.mock.callCount(), 0);
    const stale = currentUseCase({});
    stale.repo.findByIdWithRelations.mock.mockImplementation(async () => formExpense(new Date(preparedAt.getTime() + 1)));
    await assert.rejects(stale.instance.execute(webCtx, 'expense-1', 'evidence-1'), /changed after preparation/);
    for (const status of ['ISSUED', 'PAYER_CERTIFIED']) await assert.rejects(currentUseCase({ status }).instance.execute(webCtx, 'expense-1', 'evidence-1'));
    await assert.rejects(currentUseCase({ paperSubmissionJson: {}, signatureMode: 'PAPER' }).instance.execute(webCtx, 'expense-1', 'evidence-1'));
    assert.equal(stale.audit.log.mock.callCount(), 0);
  });
});
