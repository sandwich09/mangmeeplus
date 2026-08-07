import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaBankingRepository } from '../../infrastructure/prisma-banking.repository';
import { PdfStatementTextExtractor } from '../../infrastructure/pdf-statement-text.extractor';
import { StatementAiExtractClient } from '../../infrastructure/statement-ai-extract.client';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import {
  inspectAttachmentBytes,
  validateAttachmentFileName,
} from '../../../data-model-core/domain/logic/attachment.logic';
import { AttachmentMalwareScanner } from '../../../data-model-core/infrastructure/attachment-malware-scanner';
import type {
  RequestContext,
  AiModelLineage,
  BankStatementImportPreviewResult,
  BankStatementImportPreviewRow,
  BankStatementExtractResult,
  BankStatementExtractionSourceKind,
} from '@watchdog-bms/contracts';
import type { BankStatementImportRecord, BankStatementLineRecord, CreateStatementLineInput } from '../../domain/models/banking.model';
import { normalizeStatementRow, statementLineHash, checkRunningBalanceContinuity } from '../../domain/logic/banking.logic';
import { randomUUID } from 'crypto';
import { requireBankAccountInScope } from './bank-branch-scope';

type PreviewInput = {
  bankAccountId: string;
  rows: any[];
  preset?: 'GENERIC_CSV_XLSX' | 'KASIKORNBANK_KBIZ' | 'SCB_BUSINESS_ANYWHERE';
  timezone?: string;
};

type CommitProvenance = {
  sourceKind: BankStatementExtractionSourceKind;
  extractionModelId?: string;
  extractionModelLineage?: AiModelLineage[];
};

type CommitInput = {
  bankAccountId: string;
  rows: any[];
  preset?: string;
  originalFileName?: string;
  fileHash?: string;
  duplicatePolicy?: 'skip' | 'flag';
  provenance?: CommitProvenance;
};

type ExtractInput = {
  bankAccountId: string;
  fileBase64: string;
  mimeType: string;
  fileName: string;
};

@Injectable()
export class ListStatementLinesUseCase {
  constructor(private readonly repo: PrismaBankingRepository) {}

  async execute(ctx: RequestContext, bankAccountId: string, status?: string): Promise<BankStatementLineRecord[]> {
    if (!ctx.permissions.includes('bank.statement.read')) throw new ForbiddenException('Missing permission: bank.statement.read');
    await requireBankAccountInScope(this.repo, ctx, bankAccountId);
    return this.repo.listStatementLines(ctx.companyId, bankAccountId, status);
  }
}

@Injectable()
export class ListStatementImportsUseCase {
  constructor(private readonly repo: PrismaBankingRepository) {}

  async execute(ctx: RequestContext, bankAccountId: string): Promise<BankStatementImportRecord[]> {
    if (!ctx.permissions.includes('bank.statement.read')) throw new ForbiddenException('Missing permission: bank.statement.read');
    await requireBankAccountInScope(this.repo, ctx, bankAccountId);
    return this.repo.listStatementImports(ctx.companyId, bankAccountId);
  }
}

const VALID_SOURCE_KINDS: BankStatementExtractionSourceKind[] = ['csv_xlsx', 'pdf_text', 'ocr'];

@Injectable()
export class ExtractStatementFileUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly pdfExtractor: PdfStatementTextExtractor,
    private readonly aiClient: StatementAiExtractClient,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly malwareScanner: AttachmentMalwareScanner,
  ) {}

  async execute(ctx: RequestContext, input: ExtractInput): Promise<BankStatementExtractResult> {
    if (!ctx.permissions.includes('bank.statement.import')) throw new ForbiddenException('Missing permission: bank.statement.import');

    await requireBankAccountInScope(this.repo, ctx, input.bankAccountId);

    let bytes: Buffer;
    try {
      bytes = Buffer.from(input.fileBase64, 'base64');
    } catch {
      throw new UnprocessableEntityException('extract_invalid_file');
    }
    if (bytes.length === 0) throw new UnprocessableEntityException('extract_invalid_file');
    // refuse, never truncate — same policy as attachment uploads
    if (bytes.length > this.config.uploadMaxBytes) throw new UnprocessableEntityException('extract_file_too_large');
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(input.mimeType)) {
      throw new UnprocessableEntityException('extract_unsupported_mime_type');
    }
    const unsafeFileReason = validateAttachmentFileName(input.fileName, input.mimeType)
      ?? inspectAttachmentBytes(input.mimeType, bytes);
    if (unsafeFileReason) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.statement.extract',
        targetType: 'bank_account', targetId: input.bankAccountId, requestId: ctx.requestId,
        result: 'DENIED', riskLevel: 'MEDIUM',
        metadataJson: { reason: 'unsafe_file', mimeType: input.mimeType },
      });
      throw new UnprocessableEntityException('extract_invalid_file');
    }
    try {
      await this.malwareScanner.assertClean(bytes);
    } catch {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.statement.extract',
        targetType: 'bank_account', targetId: input.bankAccountId, requestId: ctx.requestId,
        result: 'DENIED', riskLevel: 'HIGH',
        metadataJson: { reason: 'malware_scan_rejected', mimeType: input.mimeType },
      });
      throw new UnprocessableEntityException('extract_invalid_file');
    }

    let sourceKind: BankStatementExtractionSourceKind;
    let rows: Record<string, string>[];
    let rowConfidences: number[];
    let extractionModelId: string | undefined;
    let extractionModelLineage: AiModelLineage[] | undefined;

    if (input.mimeType === 'application/pdf') {
      const result = await this.pdfExtractor.extractRows(new Uint8Array(bytes));
      if (result.status === 'no_text_layer') throw new UnprocessableEntityException('extract_pdf_scanned_unsupported');
      if (result.status === 'no_table_header') throw new UnprocessableEntityException('extract_pdf_table_not_found');
      if (result.status === 'unreadable') throw new UnprocessableEntityException('extract_pdf_unreadable');
      sourceKind = 'pdf_text';
      rows = result.rows;
      rowConfidences = rows.map(() => 1);
    } else if (input.mimeType === 'image/jpeg' || input.mimeType === 'image/png') {
      const response = await this.aiClient.extract({
        requestId: ctx.requestId,
        companyId: ctx.companyId,
        userId: ctx.userId,
        attachment: { contentBase64: bytes.toString('base64'), mimeType: input.mimeType },
      });
      if (response.status === 'not_configured') throw new UnprocessableEntityException('extract_ocr_not_configured');
      if (response.status !== 'ok' || !response.rows) throw new UnprocessableEntityException('extract_ocr_failed');
      sourceKind = 'ocr';
      extractionModelId = response.modelId;
      extractionModelLineage = response.modelLineage?.slice(0, 4);
      rows = response.rows.map((r) => {
        const row: Record<string, string> = {};
        if (r.postedDate) row.postedDate = r.postedDate;
        if (r.description) row.description = r.description;
        if (r.debit) row.debit = r.debit;
        if (r.credit) row.credit = r.credit;
        if (r.amount) row.amount = r.amount;
        if (r.balance) row.balance = r.balance;
        if (r.bankReference) row.bankReference = r.bankReference;
        return row;
      });
      rowConfidences = response.rows.map((r) => (typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.5));
    } else throw new UnprocessableEntityException('extract_unsupported_mime_type');

    if (rows.length === 0) throw new UnprocessableEntityException('extract_no_rows_found');

    const normalized = rows.map((r) => normalizeStatementRow(r));
    const balanceChainBreaks = checkRunningBalanceContinuity(normalized);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.statement.extract',
      targetType: 'bank_account', targetId: input.bankAccountId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: {
        sourceKind, rowCount: rows.length, byteSize: bytes.length,
        mimeType: input.mimeType, fileName: input.fileName,
        extractionModelId, extractionModelLineage: extractionModelLineage ?? [],
        balanceChainBreakCount: balanceChainBreaks.length,
      },
    });

    return { sourceKind, rows, rowConfidences, balanceChainBreaks, extractionModelId, extractionModelLineage };
  }
}

@Injectable()
export class PreviewStatementImportUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, input: PreviewInput): Promise<BankStatementImportPreviewResult> {
    if (!ctx.permissions.includes('bank.statement.import')) throw new ForbiddenException('Missing permission: bank.statement.import');

    await requireBankAccountInScope(this.repo, ctx, input.bankAccountId);

    const previewRows: BankStatementImportPreviewRow[] = [];
    let duplicateRows = 0;
    let errorRows = 0;

    for (let i = 0; i < input.rows.length; i++) {
      const raw = input.rows[i];
      const normalized = normalizeStatementRow(raw);
      const errors: string[] = normalized.errors ?? [];

      let isDuplicate = false;
      if (!errors.length) {
        const hash = statementLineHash({
          companyId: ctx.companyId,
          bankAccountId: input.bankAccountId,
          postedDate: normalized.postedDate,
          signedAmount: normalized.signedAmount,
          currency: normalized.currency,
          bankReference: normalized.bankReference,
          runningBalanceAmount: normalized.runningBalanceAmount,
        });
        const existing = await this.repo.findLineByHash(ctx.companyId, input.bankAccountId, hash);
        if (existing) { isDuplicate = true; duplicateRows++; }
      }
      if (errors.length) errorRows++;

      previewRows.push({
        rowNumber: i + 1,
        postedDate: normalized.postedDate,
        description: normalized.description,
        signedAmount: normalized.signedAmount,
        direction: normalized.direction,
        currency: normalized.currency,
        bankReference: normalized.bankReference,
        runningBalanceAmount: normalized.runningBalanceAmount,
        isDuplicate,
        errors,
      });
    }

    const balanceChainBreaks = checkRunningBalanceContinuity(previewRows);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.statement.import.preview',
      targetType: 'bank_account', targetId: input.bankAccountId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { totalRows: input.rows.length, duplicateRows, errorRows, balanceChainBreakCount: balanceChainBreaks.length },
    });

    return {
      importId: randomUUID(),
      bankAccountId: input.bankAccountId,
      totalRows: input.rows.length,
      validRows: input.rows.length - errorRows,
      duplicateRows,
      errorRows,
      rows: previewRows,
      balanceChainBreaks,
    };
  }
}

@Injectable()
export class CommitStatementImportUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, input: CommitInput): Promise<{ import: BankStatementImportRecord; lines: BankStatementLineRecord[] }> {
    if (!ctx.permissions.includes('bank.statement.import')) throw new ForbiddenException('Missing permission: bank.statement.import');

    await requireBankAccountInScope(this.repo, ctx, input.bankAccountId);

    // provenance is whitelisted server-side — never store arbitrary client JSON
    const provenance = input.provenance && VALID_SOURCE_KINDS.includes(input.provenance.sourceKind)
      ? {
          sourceKind: input.provenance.sourceKind,
          ...(input.provenance.extractionModelId ? { extractionModelId: String(input.provenance.extractionModelId).slice(0, 200) } : {}),
          ...(input.provenance.extractionModelLineage?.length
            ? { extractionModelLineage: input.provenance.extractionModelLineage.slice(0, 4) }
            : {}),
        }
      : undefined;

    const importRecord = await this.repo.createStatementImport({
      companyId: ctx.companyId,
      bankAccountId: input.bankAccountId,
      sourceType: 'IMPORT',
      originalFileName: input.originalFileName,
      fileHash: input.fileHash,
      parserVersion: '1.0',
      mappingJson: provenance,
      createdByUserId: ctx.userId,
    });

    const duplicatePolicy = input.duplicatePolicy ?? 'skip';
    const lineInputs: (CreateStatementLineInput & { _skip?: boolean })[] = [];

    for (let i = 0; i < input.rows.length; i++) {
      const raw = input.rows[i];
      const normalized = normalizeStatementRow(raw);
      if (normalized.errors.length) continue;

      const hash = statementLineHash({
        companyId: ctx.companyId,
        bankAccountId: input.bankAccountId,
        postedDate: normalized.postedDate,
        signedAmount: normalized.signedAmount,
        currency: normalized.currency,
        bankReference: normalized.bankReference,
        runningBalanceAmount: normalized.runningBalanceAmount,
      });

      const existing = hash ? await this.repo.findLineByHash(ctx.companyId, input.bankAccountId, hash) : null;

      if (existing && duplicatePolicy === 'skip') continue;

      lineInputs.push({
        companyId: ctx.companyId,
        bankAccountId: input.bankAccountId,
        importId: importRecord.id,
        sourceType: 'IMPORT',
        rowNumber: i + 1,
        lineHash: hash,
        postedDate: normalized.postedDate,
        valueDate: raw.valueDate as string | undefined,
        description: normalized.description,
        normalizedDescription: normalized.description,
        counterpartyName: raw.counterpartyName as string | undefined,
        bankReference: normalized.bankReference,
        chequeNumber: raw.chequeNumber as string | undefined,
        direction: normalized.direction,
        signedAmount: normalized.signedAmount,
        debitAmount: normalized.debitAmount,
        creditAmount: normalized.creditAmount,
        runningBalanceAmount: normalized.runningBalanceAmount,
        currency: normalized.currency,
        duplicateOfLineId: existing && duplicatePolicy === 'flag' ? existing.id : undefined,
        createdByUserId: ctx.userId,
      });
    }

    const result = await this.repo.commitStatementImport(ctx.companyId, importRecord.id, lineInputs, ctx.userId);

    void this.outbox.append('banking.statement_import.committed', 'bank_statement_import', result.import.id, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'bank_statement_import', aggregateId: result.import.id, occurredAt: new Date().toISOString(),
      data: { importId: result.import.id, bankAccountId: input.bankAccountId, lineCount: result.lines.length },
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.statement.import.commit',
      targetType: 'bank_statement_import', targetId: result.import.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { bankAccountId: input.bankAccountId, lineCount: result.lines.length },
    });

    return result;
  }
}

@Injectable()
export class CreateManualStatementLineUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(
    ctx: RequestContext,
    bankAccountId: string,
    input: Omit<CreateStatementLineInput, 'companyId' | 'bankAccountId' | 'sourceType' | 'importId' | 'createdByUserId'>,
  ): Promise<BankStatementLineRecord> {
    if (!ctx.permissions.includes('bank.statement.manual_line')) throw new ForbiddenException('Missing permission: bank.statement.manual_line');

    await requireBankAccountInScope(this.repo, ctx, bankAccountId);

    const result = await this.repo.createManualStatementLine({
      ...input,
      companyId: ctx.companyId,
      bankAccountId,
      sourceType: 'MANUAL',
      createdByUserId: ctx.userId,
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.statement.line.create_manual',
      targetType: 'bank_statement_line', targetId: result.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { bankAccountId, signedAmount: input.signedAmount },
    });

    return result;
  }
}

@Injectable()
export class VoidStatementImportUseCase {
  constructor(
    private readonly repo: PrismaBankingRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, importId: string, reason: string): Promise<BankStatementImportRecord> {
    if (!ctx.permissions.includes('bank.statement.void')) throw new ForbiddenException('Missing permission: bank.statement.void');
    if (!reason || reason.trim().length < 3) throw new UnprocessableEntityException('Void reason must be at least 3 characters');

    const imp = await this.repo.findStatementImportById(ctx.companyId, importId, ctx.scopes.branchIds);
    if (!imp) throw new NotFoundException(`Statement import ${importId} not found`);
    if (imp.status === 'VOIDED') throw new UnprocessableEntityException('Statement import is already voided');
    if (await this.repo.hasImportLinesLockedByCompletedReconciliation(ctx.companyId, importId)) {
      throw new UnprocessableEntityException('Cannot void statement import with lines locked by completed reconciliation; reopen the session first');
    }

    const result = await this.repo.voidStatementImport(ctx.companyId, importId, ctx.userId, reason);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'bank.statement.import.void',
      targetType: 'bank_statement_import', targetId: importId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { reason },
    });

    return result;
  }
}
