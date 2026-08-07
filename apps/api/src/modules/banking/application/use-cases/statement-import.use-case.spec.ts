import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  ListStatementLinesUseCase,
  ListStatementImportsUseCase,
  ExtractStatementFileUseCase,
  PreviewStatementImportUseCase,
  CommitStatementImportUseCase,
} from './statement-import.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';

const ctx: RequestContext = {
  requestId: 'req-1',
  authSubject: 'sub-1',
  userId: 'user-1',
  companyId: 'co-1',
  membershipId: 'mem-1',
  roles: ['ACCOUNTANT'],
  permissions: ['bank.statement.read'],
  scopes: {},
  authProvider: 'dev',
};

const importCtx: RequestContext = { ...ctx, permissions: ['bank.statement.import'] };

const account = { id: 'ba-1', companyId: 'co-1', displayName: 'KBank', status: 'ACTIVE' };
const line = { id: 'line-1', companyId: 'co-1', bankAccountId: 'ba-1', status: 'UNMATCHED' };
const imp = { id: 'imp-1', companyId: 'co-1', bankAccountId: 'ba-1', status: 'COMMITTED' };

function makeRepo(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    findBankAccountById: mock.fn(async () => account),
    listStatementLines: mock.fn(async () => [line]),
    listStatementImports: mock.fn(async () => [imp]),
    ...overrides,
  };
}

describe('ListStatementLinesUseCase', () => {
  it('lists lines and forwards the status filter', async () => {
    const repo = makeRepo();
    const uc = new ListStatementLinesUseCase(repo as any);
    const result = await uc.execute(ctx, 'ba-1', 'UNMATCHED');
    assert.equal(result.length, 1);
    assert.deepEqual((repo.listStatementLines.mock.calls[0] as any).arguments, ['co-1', 'ba-1', 'UNMATCHED']);
  });

  it('refuses without bank.statement.read', async () => {
    const repo = makeRepo();
    const uc = new ListStatementLinesUseCase(repo as any);
    await assert.rejects(() => uc.execute({ ...ctx, permissions: [] }, 'ba-1'), ForbiddenException);
    assert.equal(repo.listStatementLines.mock.calls.length, 0);
  });

  it('404s for an unknown bank account', async () => {
    const repo = makeRepo({ findBankAccountById: mock.fn(async () => null) });
    const uc = new ListStatementLinesUseCase(repo as any);
    await assert.rejects(() => uc.execute(ctx, 'missing'), NotFoundException);
  });
});

describe('ExtractStatementFileUseCase', () => {
  const audit = { log: mock.fn(async () => {}) };
  const config = { uploadMaxBytes: 1024 };
  const pdfBase64 = Buffer.from('%PDF-1.4 fake').toString('base64');
  const imageBase64 = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]).toString('base64');

  function makeUc(overrides: { pdf?: unknown; ai?: unknown; cfg?: unknown; scanner?: unknown } = {}) {
    const repo = makeRepo();
    const pdf = overrides.pdf ?? { extractRows: mock.fn(async () => ({ status: 'ok', rows: [{ postedDate: '2026-07-01', credit: '10.00' }] })) };
    const ai = overrides.ai ?? { extract: mock.fn(async () => ({ status: 'ok', rows: [{ postedDate: '2026-07-01', credit: '10.00', confidence: 0.9 }], modelId: 'typhoon-ocr' })) };
    const cfg = overrides.cfg ?? config;
    const scanner = overrides.scanner ?? { assertClean: mock.fn(async () => {}) };
    return { uc: new ExtractStatementFileUseCase(repo as any, pdf as any, ai as any, cfg as any, audit as any, scanner as any), pdf, ai, scanner };
  }

  it('refuses without bank.statement.import', async () => {
    const { uc } = makeUc();
    await assert.rejects(() => uc.execute(ctx, { bankAccountId: 'ba-1', fileBase64: pdfBase64, mimeType: 'application/pdf', fileName: 'statement.pdf' }), ForbiddenException);
  });

  it('refuses files over uploadMaxBytes without truncating', async () => {
    const { uc, pdf } = makeUc({ cfg: { uploadMaxBytes: 4 } });
    await assert.rejects(
      () => uc.execute(importCtx, { bankAccountId: 'ba-1', fileBase64: pdfBase64, mimeType: 'application/pdf', fileName: 'statement.pdf' }),
      (e: Error) => e instanceof UnprocessableEntityException && e.message === 'extract_file_too_large',
    );
    assert.equal((pdf as any).extractRows.mock.calls.length, 0);
  });

  it('extracts a text PDF deterministically: sourceKind pdf_text, confidence 1, no AI call', async () => {
    const { uc, ai } = makeUc();
    const result = await uc.execute(importCtx, { bankAccountId: 'ba-1', fileBase64: pdfBase64, mimeType: 'application/pdf', fileName: 'statement.pdf' });
    assert.equal(result.sourceKind, 'pdf_text');
    assert.deepEqual(result.rowConfidences, [1]);
    assert.equal(result.extractionModelId, undefined);
    assert.equal((ai as any).extract.mock.calls.length, 0);
  });

  it('rejects scanned PDFs with a stable code instead of calling AI', async () => {
    const { uc, ai } = makeUc({ pdf: { extractRows: mock.fn(async () => ({ status: 'no_text_layer' })) } });
    await assert.rejects(
      () => uc.execute(importCtx, { bankAccountId: 'ba-1', fileBase64: pdfBase64, mimeType: 'application/pdf', fileName: 'statement.pdf' }),
      (e: Error) => e.message === 'extract_pdf_scanned_unsupported',
    );
    assert.equal((ai as any).extract.mock.calls.length, 0);
  });

  it('routes images through the AI gateway: canonical keys, clamped confidence, model id', async () => {
    const modelLineage = [{
      provider: 'typhoon',
      modelId: 'typhoon-ocr',
      region: 'thailand',
      purpose: 'bank_statement_extract',
    }];
    const ai = {
      extract: mock.fn(async () => ({
        status: 'ok',
        modelId: 'typhoon-ocr',
        modelLineage,
        rows: [
          { postedDate: '2026-07-01', description: 'รับโอน', credit: '1500.00', balance: '11500.00', confidence: 0.95 },
          { postedDate: '2026-07-02', debit: '350.25', balance: '11149.75', confidence: 7 },
        ],
      })),
    };
    const { uc } = makeUc({ ai });
    const result = await uc.execute(importCtx, { bankAccountId: 'ba-1', fileBase64: imageBase64, mimeType: 'image/jpeg', fileName: 'statement.jpg' });
    assert.equal(result.sourceKind, 'ocr');
    assert.equal(result.extractionModelId, 'typhoon-ocr');
    assert.deepEqual(result.extractionModelLineage, modelLineage);
    assert.deepEqual(result.rows[0], { postedDate: '2026-07-01', description: 'รับโอน', credit: '1500.00', balance: '11500.00' });
    assert.deepEqual(result.rowConfidences, [0.95, 1]);
    assert.deepEqual(result.balanceChainBreaks, []);
  });

  it('flags balance-chain breaks in extracted rows (misread OCR figure)', async () => {
    const ai = {
      extract: mock.fn(async () => ({
        status: 'ok',
        rows: [
          { postedDate: '2026-07-01', credit: '1500.00', balance: '11500.00' },
          { postedDate: '2026-07-02', debit: '350.25', balance: '11199.75' }, // should be 11149.75
        ],
      })),
    };
    const { uc } = makeUc({ ai });
    const result = await uc.execute(importCtx, { bankAccountId: 'ba-1', fileBase64: imageBase64, mimeType: 'image/jpeg', fileName: 'statement.jpeg' });
    assert.deepEqual(result.balanceChainBreaks, [2]);
  });

  it('fails closed when OCR is not configured', async () => {
    const { uc } = makeUc({ ai: { extract: mock.fn(async () => ({ status: 'not_configured' })) } });
    await assert.rejects(
      () => uc.execute(importCtx, { bankAccountId: 'ba-1', fileBase64: imageBase64, mimeType: 'image/jpeg', fileName: 'statement.jpg' }),
      (e: Error) => e.message === 'extract_ocr_not_configured',
    );
  });

  it('rejects unsupported mime types', async () => {
    const { uc } = makeUc();
    await assert.rejects(
      () => uc.execute(importCtx, { bankAccountId: 'ba-1', fileBase64: imageBase64, mimeType: 'application/zip', fileName: 'statement.zip' }),
      (e: Error) => e.message === 'extract_unsupported_mime_type',
    );
  });

  it('rejects extension/MIME mismatches before scanning or parsing', async () => {
    const { uc, pdf, scanner } = makeUc();
    await assert.rejects(
      () => uc.execute(importCtx, { bankAccountId: 'ba-1', fileBase64: pdfBase64, mimeType: 'application/pdf', fileName: 'statement.jpg' }),
      (e: Error) => e.message === 'extract_invalid_file',
    );
    assert.equal((scanner as any).assertClean.mock.calls.length, 0);
    assert.equal((pdf as any).extractRows.mock.calls.length, 0);
  });

  it('rejects spoofed bytes before scanning or parsing', async () => {
    const { uc, ai, scanner } = makeUc();
    await assert.rejects(
      () => uc.execute(importCtx, { bankAccountId: 'ba-1', fileBase64: Buffer.from('not-jpeg').toString('base64'), mimeType: 'image/jpeg', fileName: 'statement.jpg' }),
      (e: Error) => e.message === 'extract_invalid_file',
    );
    assert.equal((scanner as any).assertClean.mock.calls.length, 0);
    assert.equal((ai as any).extract.mock.calls.length, 0);
  });

  it('fails closed when malware scanning fails before PDF parsing', async () => {
    const scanner = { assertClean: mock.fn(async () => { throw new Error('CLAMAV_SCAN_FAILED'); }) };
    const { uc, pdf } = makeUc({ scanner });
    await assert.rejects(
      () => uc.execute(importCtx, { bankAccountId: 'ba-1', fileBase64: pdfBase64, mimeType: 'application/pdf', fileName: 'statement.pdf' }),
      (e: Error) => e.message === 'extract_invalid_file',
    );
    assert.equal((pdf as any).extractRows.mock.calls.length, 0);
  });
});

describe('PreviewStatementImportUseCase balance guardrail', () => {
  const audit = { log: mock.fn(async () => {}) };

  it('returns balanceChainBreaks for inconsistent running balances', async () => {
    const repo = makeRepo({ findLineByHash: mock.fn(async () => null) });
    const uc = new PreviewStatementImportUseCase(repo as any, audit as any);
    const result = await uc.execute(importCtx, {
      bankAccountId: 'ba-1',
      rows: [
        { date: '2026-07-01', description: 'in', credit: '1500.00', balance: '11500.00' },
        { date: '2026-07-02', description: 'out', debit: '350.25', balance: '11199.75' },
      ],
    });
    assert.deepEqual(result.balanceChainBreaks, [2]);
  });
});

describe('CommitStatementImportUseCase provenance', () => {
  const audit = { log: mock.fn(async () => {}) };
  const outbox = { append: mock.fn(async () => {}) };

  function makeCommitRepo() {
    return makeRepo({
      findLineByHash: mock.fn(async () => null),
      createStatementImport: mock.fn(async (input: any) => ({ id: 'imp-9', ...input })),
      commitStatementImport: mock.fn(async () => ({ import: { id: 'imp-9' }, lines: [] })),
    });
  }

  it('stores whitelisted provenance in mappingJson', async () => {
    const repo = makeCommitRepo();
    const uc = new CommitStatementImportUseCase(repo as any, audit as any, outbox as any);
    await uc.execute(importCtx, {
      bankAccountId: 'ba-1',
      rows: [{ date: '2026-07-01', description: 'x', credit: '10.00' }],
      provenance: {
        sourceKind: 'ocr',
        extractionModelId: 'typhoon-ocr',
        extractionModelLineage: [{
          provider: 'typhoon',
          modelId: 'typhoon-ocr',
          region: 'thailand',
          purpose: 'bank_statement_extract',
        }],
        evil: 'ignore-me',
      } as any,
    });
    const created = (repo.createStatementImport as any).mock.calls[0].arguments[0];
    assert.deepEqual(created.mappingJson, {
      sourceKind: 'ocr',
      extractionModelId: 'typhoon-ocr',
      extractionModelLineage: [{
        provider: 'typhoon',
        modelId: 'typhoon-ocr',
        region: 'thailand',
        purpose: 'bank_statement_extract',
      }],
    });
  });

  it('drops invalid provenance instead of storing arbitrary JSON', async () => {
    const repo = makeCommitRepo();
    const uc = new CommitStatementImportUseCase(repo as any, audit as any, outbox as any);
    await uc.execute(importCtx, {
      bankAccountId: 'ba-1',
      rows: [{ date: '2026-07-01', description: 'x', credit: '10.00' }],
      provenance: { sourceKind: 'hacked' } as any,
    });
    const created = (repo.createStatementImport as any).mock.calls[0].arguments[0];
    assert.equal(created.mappingJson, undefined);
  });
});

describe('ListStatementImportsUseCase', () => {
  it('lists imports for the account', async () => {
    const repo = makeRepo();
    const uc = new ListStatementImportsUseCase(repo as any);
    const result = await uc.execute(ctx, 'ba-1');
    assert.equal(result.length, 1);
    assert.deepEqual((repo.listStatementImports.mock.calls[0] as any).arguments, ['co-1', 'ba-1']);
  });

  it('refuses without bank.statement.read', async () => {
    const repo = makeRepo();
    const uc = new ListStatementImportsUseCase(repo as any);
    await assert.rejects(() => uc.execute({ ...ctx, permissions: [] }, 'ba-1'), ForbiddenException);
    assert.equal(repo.listStatementImports.mock.calls.length, 0);
  });
});
