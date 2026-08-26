import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IncomeExpenseLedgerEntryType, RequestContext } from '@watchdog-bms/contracts';
import { RequireAnyPermission } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { IncomeExpenseLedgerUseCase } from '../../application/use-cases/income-expense-ledger.use-case';

const LEDGER_READ_PERMISSIONS = ['accounting.document.read', 'expense.read'];
const LEDGER_EXPORT_PERMISSIONS = ['accounting.document.export', 'expense.export'];

@ApiTags('income-expense-ledger')
@Controller('companies/:companyId/income-expense-ledger')
export class IncomeExpenseLedgerController {
  constructor(private readonly ledger: IncomeExpenseLedgerUseCase) {}

  @Get('summary')
  @RequireAnyPermission(...LEDGER_READ_PERMISSIONS)
  @ApiOperation({ summary: 'Get the permission-aware income and expense ledger summary' })
  summary(@ReqCtx() ctx: RequestContext, @Query('from') from?: string, @Query('to') to?: string) {
    return this.ledger.summary(ctx, from, to);
  }

  @Get('entries')
  @RequireAnyPermission(...LEDGER_READ_PERMISSIONS)
  @ApiOperation({ summary: 'List income and expense source entries' })
  entries(
    @ReqCtx() ctx: RequestContext,
    @Query('type') type?: IncomeExpenseLedgerEntryType,
    @Query('categoryId') categoryId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.ledger.entries(ctx, {
      type, categoryId, status, from, to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('export')
  @RequireAnyPermission(...LEDGER_EXPORT_PERMISSIONS)
  @ApiOperation({ summary: 'Export the selected ledger sources as CSV and XLSX' })
  export(
    @ReqCtx() ctx: RequestContext,
    @Query('type') type?: IncomeExpenseLedgerEntryType,
    @Query('categoryId') categoryId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.ledger.export(ctx, { type, categoryId, status, from, to });
  }
}
