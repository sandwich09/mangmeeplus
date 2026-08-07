import { Controller, Get, Post, Patch, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  ListAccountsUseCase, GetAccountUseCase, CreateAccountUseCase, UpdateAccountUseCase,
} from '../../application/use-cases/account.use-case';
import {
  ListJournalsUseCase, GetJournalUseCase, CreateManualJournalUseCase,
  PostJournalUseCase, ReverseJournalUseCase, GenerateJournalFromSourceUseCase,
} from '../../application/use-cases/journal.use-case';
import {
  ListPeriodsUseCase, EnsurePeriodUseCase, RunPeriodCloseChecksUseCase,
  ClosePeriodUseCase, UnclosePeriodUseCase,
} from '../../application/use-cases/period.use-case';
import {
  GetGeneralLedgerUseCase, GetTrialBalanceUseCase, GetPnlReportUseCase,
  GetBalanceSheetUseCase, ExportReportUseCase,
} from '../../application/use-cases/report.use-case';
import {
  ApplyChartTemplateDto,
  CreateChartOfAccountDto,
  CreateManualJournalDto,
  GenerateJournalFromSourceDto,
  UpdateChartOfAccountDto,
} from './ledger.dtos';
import {
  PreviewExpenseBackfillUseCase,
  RunExpenseBackfillUseCase,
} from '../../application/use-cases/expense-backfill.use-case';
import { ChartTemplateService } from '../../application/services/chart-template.service.js';

@ApiTags('ledger')
@Controller('companies/:companyId')
export class LedgerController {
  constructor(
    private readonly listAccounts: ListAccountsUseCase,
    private readonly getAccount: GetAccountUseCase,
    private readonly createAccount: CreateAccountUseCase,
    private readonly updateAccount: UpdateAccountUseCase,
    private readonly chartTemplates: ChartTemplateService,
    private readonly listJournals: ListJournalsUseCase,
    private readonly getJournal: GetJournalUseCase,
    private readonly createManual: CreateManualJournalUseCase,
    private readonly postJournal: PostJournalUseCase,
    private readonly reverseJournal: ReverseJournalUseCase,
    private readonly generateJournal: GenerateJournalFromSourceUseCase,
    private readonly previewExpenseBackfill: PreviewExpenseBackfillUseCase,
    private readonly runExpenseBackfill: RunExpenseBackfillUseCase,
    private readonly listPeriods: ListPeriodsUseCase,
    private readonly ensurePeriod: EnsurePeriodUseCase,
    private readonly runCloseChecks: RunPeriodCloseChecksUseCase,
    private readonly closePeriod: ClosePeriodUseCase,
    private readonly unclosePeriod: UnclosePeriodUseCase,
    private readonly getGl: GetGeneralLedgerUseCase,
    private readonly getTrialBalance: GetTrialBalanceUseCase,
    private readonly getPnl: GetPnlReportUseCase,
    private readonly getBalanceSheet: GetBalanceSheetUseCase,
    private readonly exportReport: ExportReportUseCase,
  ) {}

  // ─── Chart of Accounts ────────────────────────────────────────────────────

  @Get('chart-of-accounts')
  @RequirePermissions('ledger.account.read')
  @ApiOperation({ summary: 'List chart of accounts' })
  async listAccountsHandler(@ReqCtx() ctx: RequestContext, @Query('accountClass') accountClass?: string, @Query('status') status?: string) {
    return this.listAccounts.execute(ctx, { accountClass, status });
  }

  @Get('chart-of-accounts/templates')
  @RequirePermissions('ledger.account.read')
  @ApiOperation({ summary: 'List available chart templates' })
  listChartTemplatesHandler(@ReqCtx() ctx: RequestContext) {
    return this.chartTemplates.list(ctx);
  }

  @Get('chart-of-accounts/templates/:templateKey/preview')
  @RequirePermissions('ledger.account.read')
  @ApiOperation({ summary: 'Preview chart template changes and dependencies' })
  previewChartTemplateHandler(
    @ReqCtx() ctx: RequestContext,
    @Param('templateKey') templateKey: string,
  ) {
    return this.chartTemplates.preview(ctx, templateKey);
  }

  @Post('chart-of-accounts/templates/:templateKey/apply')
  @RequirePermissions('ledger.account.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply a confirmed chart template preview' })
  applyChartTemplateHandler(
    @ReqCtx() ctx: RequestContext,
    @Param('templateKey') templateKey: string,
    @Body() body: ApplyChartTemplateDto,
  ) {
    return this.chartTemplates.apply(ctx, templateKey, body);
  }

  @Get('chart-of-accounts/readiness')
  @RequirePermissions('ledger.account.read')
  @ApiOperation({ summary: 'Get computed chart and automatic-posting readiness' })
  chartReadinessHandler(@ReqCtx() ctx: RequestContext) {
    return this.chartTemplates.readiness(ctx);
  }

  @Get('chart-of-accounts/:accountId')
  @RequirePermissions('ledger.account.read')
  @ApiOperation({ summary: 'Get account' })
  async getAccountHandler(@ReqCtx() ctx: RequestContext, @Param('accountId') accountId: string) {
    return this.getAccount.execute(ctx, accountId);
  }

  @Post('chart-of-accounts')
  @RequirePermissions('ledger.account.manage')
  @ApiOperation({ summary: 'Create account' })
  async createAccountHandler(@ReqCtx() ctx: RequestContext, @Body() body: CreateChartOfAccountDto) {
    return this.createAccount.execute(ctx, body);
  }

  @Patch('chart-of-accounts/:accountId')
  @RequirePermissions('ledger.account.manage')
  @ApiOperation({ summary: 'Update account' })
  async updateAccountHandler(@ReqCtx() ctx: RequestContext, @Param('accountId') accountId: string, @Body() body: UpdateChartOfAccountDto) {
    return this.updateAccount.execute(ctx, accountId, body);
  }

  // ─── Journal Entries ───────────────────────────────────────────────────────

  @Get('journal-entries')
  @RequirePermissions('ledger.journal.read')
  @ApiOperation({ summary: 'List journal entries' })
  async listJournalsHandler(@ReqCtx() ctx: RequestContext, @Query() query: any) {
    return this.listJournals.execute(ctx, query);
  }

  @Get('journal-entries/:journalId')
  @RequirePermissions('ledger.journal.read')
  @ApiOperation({ summary: 'Get journal entry' })
  async getJournalHandler(@ReqCtx() ctx: RequestContext, @Param('journalId') journalId: string) {
    return this.getJournal.execute(ctx, journalId);
  }

  @Post('journal-entries/manual')
  @RequirePermissions('journal.entry.create')
  @ApiOperation({ summary: 'Create draft manual journal' })
  async createManualHandler(@ReqCtx() ctx: RequestContext, @Body() body: CreateManualJournalDto) {
    return this.createManual.execute(ctx, body);
  }

  @Post('journal-entries/:journalId/post')
  @RequirePermissions('journal.entry.post')
  @HttpCode(200)
  @ApiOperation({ summary: 'Post journal entry' })
  async postJournalHandler(@ReqCtx() ctx: RequestContext, @Param('journalId') journalId: string) {
    return this.postJournal.execute(ctx, journalId);
  }

  @Post('journal-entries/:journalId/reverse')
  @RequirePermissions('journal.entry.reverse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reverse posted journal' })
  async reverseJournalHandler(@ReqCtx() ctx: RequestContext, @Param('journalId') journalId: string, @Body() body: { memo?: string }) {
    return this.reverseJournal.execute(ctx, journalId, body?.memo);
  }

  @Post('posting/generate')
  @RequirePermissions('journal.entry.create', 'journal.entry.post')
  @HttpCode(200)
  @ApiOperation({ summary: 'Generate journal from source document' })
  async generateJournalHandler(@ReqCtx() ctx: RequestContext, @Body() body: GenerateJournalFromSourceDto) {
    return this.generateJournal.execute(ctx, body);
  }

  @Get('posting/expense-backfill-preview')
  @RequirePermissions('expense.read', 'journal.entry.create', 'journal.entry.post')
  @ApiOperation({ summary: 'Preview historical pending expenses before explicit backfill' })
  async previewExpenseBackfillHandler(@ReqCtx() ctx: RequestContext) {
    return this.previewExpenseBackfill.execute(ctx);
  }

  @Post('posting/expense-backfill')
  @RequirePermissions('expense.read', 'journal.entry.create', 'journal.entry.post')
  @HttpCode(200)
  @ApiOperation({ summary: 'Explicitly backfill eligible historical pending expenses' })
  async runExpenseBackfillHandler(
    @ReqCtx() ctx: RequestContext,
    @Body() body: { confirmed: boolean; limit?: number },
  ) {
    return this.runExpenseBackfill.execute(ctx, body);
  }

  // ─── Periods ───────────────────────────────────────────────────────────────

  @Get('periods')
  @RequirePermissions('ledger.period.read')
  @ApiOperation({ summary: 'List accounting periods' })
  async listPeriodsHandler(@ReqCtx() ctx: RequestContext) {
    return this.listPeriods.execute(ctx);
  }

  @Post('periods/ensure/:periodKey')
  @RequirePermissions('ledger.period.read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ensure period exists' })
  async ensurePeriodHandler(@ReqCtx() ctx: RequestContext, @Param('periodKey') periodKey: string) {
    return this.ensurePeriod.execute(ctx, periodKey);
  }

  @Post('periods/:periodId/close-checks')
  @RequirePermissions('ledger.period.read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run period close checks' })
  async closeChecksHandler(@ReqCtx() ctx: RequestContext, @Param('periodId') periodId: string) {
    return this.runCloseChecks.execute(ctx, periodId);
  }

  @Post('periods/:periodId/close')
  @RequirePermissions('ledger.period.close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close period' })
  async closePeriodHandler(@ReqCtx() ctx: RequestContext, @Param('periodId') periodId: string, @Body() body: { note?: string }) {
    return this.closePeriod.execute(ctx, periodId, body?.note);
  }

  @Post('periods/:periodId/unclose')
  @RequirePermissions('ledger.period.unclose')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reopen closed period' })
  async unclosePeriodHandler(@ReqCtx() ctx: RequestContext, @Param('periodId') periodId: string, @Body() body: { note: string }) {
    return this.unclosePeriod.execute(ctx, periodId, body?.note);
  }

  // ─── Reports ───────────────────────────────────────────────────────────────

  @Get('reports/general-ledger')
  @RequirePermissions('ledger.report.read')
  @ApiOperation({ summary: 'General Ledger report' })
  async glHandler(@ReqCtx() ctx: RequestContext, @Query('periodKey') periodKey: string, @Query('accountId') accountId?: string) {
    return this.getGl.execute(ctx, periodKey, accountId);
  }

  @Get('reports/trial-balance')
  @RequirePermissions('ledger.report.read')
  @ApiOperation({ summary: 'Trial Balance' })
  async tbHandler(@ReqCtx() ctx: RequestContext, @Query('periodKey') periodKey: string) {
    return this.getTrialBalance.execute(ctx, periodKey);
  }

  @Get('reports/profit-and-loss')
  @RequirePermissions('ledger.report.read')
  @ApiOperation({ summary: 'Profit and Loss' })
  async pnlHandler(@ReqCtx() ctx: RequestContext, @Query('periodKey') periodKey: string) {
    return this.getPnl.execute(ctx, periodKey);
  }

  @Get('reports/balance-sheet')
  @RequirePermissions('ledger.report.read')
  @ApiOperation({ summary: 'Balance Sheet' })
  async bsHandler(@ReqCtx() ctx: RequestContext, @Query('periodKey') periodKey: string) {
    return this.getBalanceSheet.execute(ctx, periodKey);
  }

  @Post('reports/:reportType/export')
  @RequirePermissions('ledger.export')
  @HttpCode(200)
  @ApiOperation({ summary: 'Export ledger report (stub)' })
  async exportHandler(@ReqCtx() ctx: RequestContext, @Param('reportType') reportType: string, @Body() body: { periodKey: string }) {
    return this.exportReport.execute(ctx, reportType, body?.periodKey);
  }
}
