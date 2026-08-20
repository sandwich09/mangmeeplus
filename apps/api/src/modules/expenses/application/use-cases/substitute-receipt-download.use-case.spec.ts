import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { DownloadSubstituteReceiptFormPdfUseCase, DownloadSubstituteReceiptPdfUseCase } from './substitute-receipt.use-case';
import {
  CreateDocumentDeliveryLinkUseCase,
  ResolveDocumentDeliveryLinkUseCase,
  RevokeDocumentDeliveryLinkUseCase,
} from './document-delivery-link.use-case';
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
      id: 'evidence-1', status, documentNumber: 'SUB-202608-00007', version: 1,
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

  it('leaves the digital route rendering exactly one page from the stored SVG', async () => {
    const { instance } = useCase('ISSUED', null);

    const result = await instance.execute({
      companyId: 'company-1', userId: 'user-1', authProvider: 'watchdog',
    } as any, 'expense-1', 'evidence-1');

    const pdf = await PDFDocument.load(result.data);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal((pdf.getSubject() ?? '').includes('Wet-signed scan'), false);
    assert.match(pdf.getSubject() ?? '', /^Source SHA256: [0-9a-f]{64}$/);
    assert.equal(result.fileName, 'SUB-202608-00001.pdf'.replace('SUB', 'SRC'));
  });
});

// ─── Spec §12/§14/§15/R16 — delivery links ───────────────────────────────────

function deliveryPrisma() {
  const rows: any[] = [];
  const client = {
    documentDeliveryLink: {
      create: async ({ data, select }: any) => {
        const row = { id: `link-${rows.length + 1}`, openCount: 0, revokedAt: null, lastOpenedAt: null, ...data };
        rows.push(row);
        return select ? { id: row.id, expiresAt: row.expiresAt } : row;
      },
      findUnique: async ({ where }: any) => rows.find((row) => row.tokenHashSha256 === where.tokenHashSha256) ?? null,
      // Honours the shapes the code actually issues: revoke looks up by id, `hasLiveLink` by
      // company + document + kind + recipient with the expiry/revocation filter.
      findFirst: async ({ where }: any) => rows.find((row) => {
        if (where.id !== undefined && row.id !== where.id) return false;
        for (const field of ['companyId', 'evidenceId', 'kind', 'recipientUserId'] as const) {
          if (where[field] !== undefined && row[field] !== where[field]) return false;
        }
        if (where.revokedAt === null && row.revokedAt !== null) return false;
        if (where.expiresAt?.gt && !(row.expiresAt > where.expiresAt.gt)) return false;
        return true;
      }) ?? null,
      update: async ({ where, data, select }: any) => {
        const row = rows.find((item) => item.id === where.id);
        if (data.openCount?.increment) row.openCount += data.openCount.increment;
        if (data.lastOpenedAt) row.lastOpenedAt = data.lastOpenedAt;
        if (data.revokedAt) row.revokedAt = data.revokedAt;
        return select ? { openCount: row.openCount } : row;
      },
    },
  };
  return { rows, service: { client } as any };
}

function deliveryStorage() {
  const objects = new Map<string, Buffer>();
  const deleted: string[] = [];
  const signed: any[] = [];
  return {
    objects,
    deleted,
    signed,
    port: {
      getObject: async () => ({ bytes: issuedSvg }),
      putObject: async ({ objectKey, bytes }: any) => {
        objects.set(objectKey, bytes);
        return { bucket: 'mangmee-attachments', objectKey, storageProvider: 's3', byteSize: bytes.byteLength, checksumSha256: 'x', objectVersionId: 'v1' };
      },
      deleteObject: async ({ objectKey }: any) => { objects.delete(objectKey); deleted.push(objectKey); },
      createDownloadUrl: async (input: any) => {
        if (!objects.has(input.objectKey)) throw new Error('the delivery object is gone');
        signed.push(input);
        return { url: `https://s3.test/${input.objectKey}?sig=1`, expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000) };
      },
    } as any,
  };
}

const deliveryEvidence = {
  id: 'evidence-1', status: 'ISSUED', supersedeReason: null, documentNumber: 'SRC-202608-00001',
  artifactAttachmentId: 'artifact-1', signatureMode: 'DIGITAL', wetSignedScanAttachmentId: null,
};

function deliveryHarness(overrides: {
  evidence?: Record<string, unknown>;
  /** FIX-6: the branch the evidence belongs to, for the revoke scope check. */
  scope?: { expenseId: string; branchId: string | null } | null;
} = {}) {
  const prisma = deliveryPrisma();
  const storage = deliveryStorage();
  const entries: any[] = [];
  const audit = { log: async (entry: any) => { entries.push(entry); } } as any;
  const repo = {
    findSubstituteEvidence: async () => ({ ...deliveryEvidence, ...(overrides.evidence ?? {}) }),
    findSubstituteArtifactAttachment: async () => ({ bucket: 'bucket', objectKey: 'issued.svg', objectVersionId: 'version-1' }),
    findSubstituteEvidenceScope: async () =>
      (overrides.scope === undefined ? { expenseId: 'expense-1', branchId: 'branch-1' } : overrides.scope),
  } as any;
  const getExpense = { execute: async () => ({ id: 'expense-1', branchId: null }) } as any;
  return {
    prisma, storage, entries,
    create: new CreateDocumentDeliveryLinkUseCase(
      getExpense, repo, prisma.service, storage.port, audit, { webBaseUrl: 'https://app.mangmeeplus.test' } as any,
    ),
    resolve: new ResolveDocumentDeliveryLinkUseCase(prisma.service, storage.port, audit),
    revoke: new RevokeDocumentDeliveryLinkUseCase(prisma.service, repo, storage.port, audit),
  };
}

const deliveryCtx = {
  companyId: 'company-1', userId: 'user-1', requestId: 'request-d1', authProvider: 'line',
  permissions: ['expense.review'], scopes: {},
} as any;

describe('§12 delivery links — token lifecycle', () => {
  it('mints an absolute /d/{token} link on the web origin whose token never reaches the row', async () => {
    const harness = deliveryHarness();

    const link = await harness.create.execute(deliveryCtx, {
      expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF',
    });

    const token = new URL(link.url).pathname.slice(3);
    assert.match(link.url, /^https:\/\/app\.mangmeeplus\.test\/d\/[A-Za-z0-9_-]{43}$/);
    assert.equal(harness.prisma.rows.length, 1);
    // R16: only the hash is stored, so a database reader can neither mint nor replay this link.
    assert.equal(harness.prisma.rows[0].tokenHashSha256, createHash('sha256').update(token, 'utf8').digest('hex'));
    assert.equal(JSON.stringify(harness.prisma.rows[0]).includes(token), false);
  });

  it('expires exactly 72 hours out — D7 is fixed, not configurable', async () => {
    const harness = deliveryHarness();
    const before = Date.now();

    const link = await harness.create.execute(deliveryCtx, {
      expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF',
    });

    const ttl = link.expiresAt.getTime() - before;
    assert.ok(ttl >= 72 * 60 * 60 * 1_000 && ttl <= 72 * 60 * 60 * 1_000 + 5_000, `ttl was ${ttl}ms`);
  });

  it('§12.2 — the object key carries no company, expense, document, user or date identifier', async () => {
    const harness = deliveryHarness();
    const keys: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });
      keys.push(harness.prisma.rows[index].tempObjectKey);
    }

    for (const key of keys) {
      assert.match(key, /^line-delivery\/[A-Za-z0-9_-]{43}\.pdf$/);
      for (const identifier of ['company-1', 'expense-1', 'evidence-1', 'user-1', 'SRC-202608-00001', '2026', '202608']) {
        assert.equal(key.includes(identifier), false, `${key} leaked ${identifier}`);
      }
    }
    assert.equal(new Set(keys).size, keys.length, 'every delivery copy gets its own key');
  });

  it('§12.1 — copies the artifact instead of moving it, and never deletes the source', async () => {
    const harness = deliveryHarness();

    await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });

    assert.deepEqual(harness.storage.deleted, []);
    assert.equal(harness.storage.objects.size, 1);
    const [key] = [...harness.storage.objects.keys()];
    assert.ok(key.startsWith('line-delivery/'));
    assert.equal(harness.storage.objects.get(key)!.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  it('resolves to a short-lived presigned URL, counts the open, and audits recipient + opener IP', async () => {
    const harness = deliveryHarness();
    const link = await harness.create.execute(deliveryCtx, {
      expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF',
    });
    const token = new URL(link.url).pathname.slice(3);

    const first = await harness.resolve.execute({ token, clientIp: '203.0.113.9', requestId: 'open-1' });
    const second = await harness.resolve.execute({ token, clientIp: '198.51.100.4', requestId: 'open-2' });

    assert.equal(first.status, 'OK');
    assert.equal(second.status, 'OK');
    assert.match((first as any).url, /^https:\/\/s3\.test\/line-delivery\//);
    assert.equal(harness.storage.signed[0].expiresInSeconds, 120);
    assert.equal(harness.prisma.rows[0].openCount, 2);
    assert.ok(harness.prisma.rows[0].lastOpenedAt instanceof Date);

    const opens = harness.entries.filter((entry) => entry.action === 'document.delivery.link.open');
    assert.equal(opens.length, 2);
    // A token is a bearer credential, so the opener is unknowable — the row names who it was minted
    // for and where the click came from, and never guesses an actorUserId.
    assert.equal(opens[0].actorUserId, undefined);
    assert.equal(opens[0].actorRefId, harness.prisma.rows[0].id);
    assert.equal(opens[0].metadataJson.recipientUserId, 'user-1');
    assert.equal(opens[0].metadataJson.clientIp, '203.0.113.9');
    assert.equal(opens[1].metadataJson.clientIp, '198.51.100.4');
    assert.equal(harness.entries[0].action, 'document.delivery.link.create');
    assert.equal(harness.entries[0].targetId, harness.prisma.rows[0].id);
  });

  it('§12.7 — a second link minted while the first is live leaves both valid on separate keys', async () => {
    const harness = deliveryHarness();
    const first = await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });
    const second = await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });

    const resolvedFirst = await harness.resolve.execute({ token: new URL(first.url).pathname.slice(3), clientIp: '203.0.113.9', requestId: 'r' });
    const resolvedSecond = await harness.resolve.execute({ token: new URL(second.url).pathname.slice(3), clientIp: '203.0.113.9', requestId: 'r' });

    assert.notEqual(first.url, second.url);
    assert.notEqual(harness.prisma.rows[0].tempObjectKey, harness.prisma.rows[1].tempObjectKey);
    assert.equal(resolvedFirst.status, 'OK');
    assert.equal(resolvedSecond.status, 'OK');
  });

  it('refuses an expired link with no document data, and records the denial', async () => {
    const harness = deliveryHarness();
    const link = await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });
    harness.prisma.rows[0].expiresAt = new Date(Date.now() - 1_000);

    const resolved = await harness.resolve.execute({
      token: new URL(link.url).pathname.slice(3), clientIp: '203.0.113.9', requestId: 'open-late',
    });

    assert.deepEqual(resolved, { status: 'REFUSED' });
    assert.equal(JSON.stringify(resolved).includes('SRC-202608-00001'), false);
    assert.equal(harness.prisma.rows[0].openCount, 0);
    const denied = harness.entries.find((entry) => entry.result === 'DENIED');
    assert.equal(denied.metadataJson.reason, 'expired');
  });

  it('§12.6 — revoking deletes the temp object so every presigned URL dies with it', async () => {
    const harness = deliveryHarness();
    const link = await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });
    const token = new URL(link.url).pathname.slice(3);
    assert.equal((await harness.resolve.execute({ token, clientIp: '203.0.113.9', requestId: 'r' })).status, 'OK');

    await harness.revoke.execute(deliveryCtx, link.linkId);

    assert.deepEqual(harness.storage.deleted, [harness.prisma.rows[0].tempObjectKey]);
    assert.equal(harness.storage.objects.size, 0);
    assert.ok(harness.prisma.rows[0].revokedAt instanceof Date);
    assert.deepEqual(await harness.resolve.execute({ token, clientIp: '203.0.113.9', requestId: 'r' }), { status: 'REFUSED' });
    assert.equal(harness.entries.filter((entry) => entry.action === 'document.delivery.link.revoke').length, 1);
  });

  it('refuses revocation without expense.review', async () => {
    const harness = deliveryHarness();
    const link = await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });

    await assert.rejects(
      () => harness.revoke.execute({ ...deliveryCtx, permissions: [] }, link.linkId),
      /expense\.review/,
    );
    assert.deepEqual(harness.storage.deleted, []);
  });

  it('refuses an unknown or malformed token without writing an audit row', async () => {
    const harness = deliveryHarness();

    for (const token of ['', 'x', '../../etc/passwd', 'A'.repeat(42), 'A'.repeat(44), 'A'.repeat(43)]) {
      assert.deepEqual(
        await harness.resolve.execute({ token, clientIp: '203.0.113.9', requestId: 'r' }),
        { status: 'REFUSED' },
      );
    }
    assert.deepEqual(harness.entries, []);
  });

  it('refuses a kind the evidence status cannot produce, in either direction', async () => {
    const issued = deliveryHarness();
    await assert.rejects(
      () => issued.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'UNSIGNED_FORM_PDF' }),
      /only while the evidence is PREPARED/,
    );

    const preparedOnly = deliveryHarness({ evidence: { status: 'PREPARED', artifactAttachmentId: null } });
    await assert.rejects(
      () => preparedOnly.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' }),
      /has not been issued yet/,
    );
  });

  it('Journey B — copies the UNSIGNED-stamped form so the sheet needs no web session', async () => {
    const prisma = deliveryPrisma();
    const storage = deliveryStorage();
    const create = new CreateDocumentDeliveryLinkUseCase(
      { execute: async () => formExpense() } as any,
      formRepo(), prisma.service, storage.port,
      { log: async () => undefined } as any, { webBaseUrl: 'https://app.mangmeeplus.test' } as any,
    );

    const link = await create.execute(deliveryCtx, {
      expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'UNSIGNED_FORM_PDF',
    });

    assert.equal(prisma.rows[0].kind, 'UNSIGNED_FORM_PDF');
    assert.match(prisma.rows[0].tempObjectKey, /^line-delivery\/[A-Za-z0-9_-]{43}\.pdf$/);
    const pdf = await PDFDocument.load(storage.objects.get(prisma.rows[0].tempObjectKey)!);
    assert.match(pdf.getSubject() ?? '', /State: UNSIGNED/);
    assert.equal(pdf.getTitle(), 'SUB-202608-00007');
    assert.match(link.url, /\/d\/[A-Za-z0-9_-]{43}$/);
  });
});

describe('§12 delivery links — throttling, orphans and branch scope', () => {
  it('FIX-3: reports a live link for this recipient, document and kind — and nothing else', async () => {
    const harness = deliveryHarness();
    assert.equal(await harness.create.hasLiveLink(deliveryCtx, 'evidence-1', 'ISSUED_PDF'), false);

    await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });

    assert.equal(await harness.create.hasLiveLink(deliveryCtx, 'evidence-1', 'ISSUED_PDF'), true);
    assert.equal(await harness.create.hasLiveLink(deliveryCtx, 'evidence-1', 'UNSIGNED_FORM_PDF'), false, 'a different kind');
    assert.equal(await harness.create.hasLiveLink(deliveryCtx, 'evidence-2', 'ISSUED_PDF'), false, 'a different document');
    assert.equal(
      await harness.create.hasLiveLink({ ...deliveryCtx, userId: 'user-2' }, 'evidence-1', 'ISSUED_PDF'),
      false,
      'another recipient has no link of their own',
    );
    assert.equal(
      await harness.create.hasLiveLink({ ...deliveryCtx, companyId: 'company-2' }, 'evidence-1', 'ISSUED_PDF'),
      false,
      'another tenant never sees it',
    );
  });

  it('FIX-3: an expired or revoked link is not live, so a re-ask can mint again', async () => {
    const harness = deliveryHarness();
    const link = await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });

    harness.prisma.rows[0].expiresAt = new Date(Date.now() - 1_000);
    assert.equal(await harness.create.hasLiveLink(deliveryCtx, 'evidence-1', 'ISSUED_PDF'), false);

    harness.prisma.rows[0].expiresAt = new Date(Date.now() + 60_000);
    await harness.revoke.execute(deliveryCtx, link.linkId);
    assert.equal(await harness.create.hasLiveLink(deliveryCtx, 'evidence-1', 'ISSUED_PDF'), false);
  });

  it('FIX-4: a failed row insert deletes the temp copy instead of stranding it', async () => {
    const harness = deliveryHarness();
    const boom = new Error('unique constraint');
    harness.prisma.service.client.documentDeliveryLink.create = async () => { throw boom; };

    await assert.rejects(
      () => harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' }),
      (error: unknown) => error === boom,
    );

    assert.equal(harness.storage.objects.size, 0, 'nothing could ever resolve or revoke that copy');
    assert.equal(harness.storage.deleted.length, 1);
    assert.match(harness.storage.deleted[0]!, /^line-delivery\//);
  });

  it('FIX-4: a cleanup failure never replaces the real error', async () => {
    const harness = deliveryHarness();
    const boom = new Error('unique constraint');
    harness.prisma.service.client.documentDeliveryLink.create = async () => { throw boom; };
    harness.storage.port.deleteObject = async () => { throw new Error('storage also down'); };

    await assert.rejects(
      () => harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' }),
      (error: unknown) => error === boom,
    );
  });

  it('FIX-6: revoke is branch-scoped like every other evidence mutation', async () => {
    const harness = deliveryHarness({ scope: { expenseId: 'expense-1', branchId: 'branch-A' } });
    const link = await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });

    await assert.rejects(
      () => harness.revoke.execute({ ...deliveryCtx, scopes: { branchIds: ['branch-B'] } }, link.linkId),
      /Branch is outside your assigned branch scope/,
    );
    assert.deepEqual(harness.storage.deleted, [], 'an out-of-scope reviewer deletes nothing');
    assert.equal(harness.prisma.rows[0].revokedAt, null);

    await harness.revoke.execute({ ...deliveryCtx, scopes: { branchIds: ['branch-A'] } }, link.linkId);
    assert.ok(harness.prisma.rows[0].revokedAt instanceof Date);
  });

  it('FIX-6: a link whose evidence has vanished is not revocable', async () => {
    const harness = deliveryHarness({ scope: null });
    const link = await harness.create.execute(deliveryCtx, { expenseId: 'expense-1', evidenceId: 'evidence-1', kind: 'ISSUED_PDF' });

    await assert.rejects(() => harness.revoke.execute(deliveryCtx, link.linkId), /Delivery link not found/);
    assert.deepEqual(harness.storage.deleted, []);
  });
});
