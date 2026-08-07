import { Controller, Get, Post, Param, Query, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { AiModelLineage, BankStatementExtractionSourceKind, RequestContext } from '@watchdog-bms/contracts';
import {
  ListStatementLinesUseCase,
  ListStatementImportsUseCase,
  ExtractStatementFileUseCase,
  PreviewStatementImportUseCase,
  CommitStatementImportUseCase,
  CreateManualStatementLineUseCase,
  VoidStatementImportUseCase,
} from '../../application/use-cases/statement-import.use-case';
import { CreateManualStatementLineDto } from './banking.dtos';

@ApiTags('banking')
@Controller('companies/:companyId/banking')
export class StatementController {
  constructor(
    private readonly listStatementLines: ListStatementLinesUseCase,
    private readonly listStatementImports: ListStatementImportsUseCase,
    private readonly extractStatementFile: ExtractStatementFileUseCase,
    private readonly previewStatementImport: PreviewStatementImportUseCase,
    private readonly commitStatementImport: CommitStatementImportUseCase,
    private readonly createManualStatementLine: CreateManualStatementLineUseCase,
    private readonly voidStatementImport: VoidStatementImportUseCase,
  ) {}

  @Post('bank-accounts/:bankAccountId/statement-imports/extract')
  @RequirePermissions('bank.statement.import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Extract statement rows from a PDF or photo (spec §20)' })
  async extract(
    @ReqCtx() ctx: RequestContext,
    @Param('bankAccountId') bankAccountId: string,
    @Body() body: { fileBase64: string; mimeType: string; fileName: string },
  ) {
    return this.extractStatementFile.execute(ctx, { bankAccountId, ...body });
  }

  @Get('bank-accounts/:bankAccountId/statement-lines')
  @RequirePermissions('bank.statement.read')
  @ApiOperation({ summary: 'List statement lines for a bank account' })
  async listLines(
    @ReqCtx() ctx: RequestContext,
    @Param('bankAccountId') bankAccountId: string,
    @Query('status') status?: string,
  ) {
    return this.listStatementLines.execute(ctx, bankAccountId, status);
  }

  @Get('bank-accounts/:bankAccountId/statement-imports')
  @RequirePermissions('bank.statement.read')
  @ApiOperation({ summary: 'List statement imports for a bank account' })
  async listImports(
    @ReqCtx() ctx: RequestContext,
    @Param('bankAccountId') bankAccountId: string,
  ) {
    return this.listStatementImports.execute(ctx, bankAccountId);
  }

  @Post('bank-accounts/:bankAccountId/statement-imports/preview')
  @RequirePermissions('bank.statement.import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview statement import' })
  async preview(
    @ReqCtx() ctx: RequestContext,
    @Param('bankAccountId') bankAccountId: string,
    @Body() body: { rows: any[]; preset?: string; timezone?: string },
  ) {
    return this.previewStatementImport.execute(ctx, { bankAccountId, rows: body.rows, preset: body.preset as any, timezone: body.timezone });
  }

  @Post('bank-accounts/:bankAccountId/statement-imports/commit')
  @RequirePermissions('bank.statement.import')
  @ApiOperation({ summary: 'Commit statement import' })
  async commit(
    @ReqCtx() ctx: RequestContext,
    @Param('bankAccountId') bankAccountId: string,
    @Body() body: {
      rows: any[];
      preset?: string;
      originalFileName?: string;
      fileHash?: string;
      duplicatePolicy?: 'skip' | 'flag';
      provenance?: {
        sourceKind: BankStatementExtractionSourceKind;
        extractionModelId?: string;
        extractionModelLineage?: AiModelLineage[];
      };
    },
  ) {
    return this.commitStatementImport.execute(ctx, { bankAccountId, ...body });
  }

  @Post('bank-accounts/:bankAccountId/statement-lines')
  @RequirePermissions('bank.statement.manual_line')
  @ApiOperation({ summary: 'Create manual statement line' })
  async createManualLine(
    @ReqCtx() ctx: RequestContext,
    @Param('bankAccountId') bankAccountId: string,
    @Body() body: CreateManualStatementLineDto,
  ) {
    return this.createManualStatementLine.execute(ctx, bankAccountId, body);
  }

  @Post('statement-imports/:importId/void')
  @RequirePermissions('bank.statement.void')
  @HttpCode(200)
  @ApiOperation({ summary: 'Void statement import' })
  async void(
    @ReqCtx() ctx: RequestContext,
    @Param('importId') importId: string,
    @Body() body: { reason: string },
  ) {
    return this.voidStatementImport.execute(ctx, importId, body.reason);
  }
}
