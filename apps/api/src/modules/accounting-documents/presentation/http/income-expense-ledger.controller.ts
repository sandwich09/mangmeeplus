import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IncomeExpenseLedgerEntryType, RequestContext } from '@watchdog-bms/contracts';
import { RequireAnyPermission } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { IncomeExpenseLedgerUseCase } from '../../application/use-cases/income-expense-ledger.use-case';
import { GetSalesDocumentRootAvailabilityUseCase } from '../../application/sales-document-launch-gate';

const LEDGER_READ_PERMISSIONS = ['accounting.document.read', 'expense.read'];
const LEDGER_EXPORT_PERMISSIONS = ['accounting.document.export', 'expense.export'];
const SALES_CREATE_PERMISSIONS = [
  'accounting.document.create', 'accounting.quotation.create', 'accounting.invoice.create',
  'accounting.billing_note.create', 'accounting.receipt.create', 'accounting.tax_invoice.create',
  'accounting.counterparty.manage', 'accounting.quotation.submit_approval',
];

@ApiTags('income-expense-ledger')
@Controller('companies/:companyId/income-expense-ledger')
export class IncomeExpenseLedgerController {
  constructor(
    private readonly ledger: IncomeExpenseLedgerUseCase,
    private readonly salesAvailability: GetSalesDocumentRootAvailabilityUseCase,
  ) {}

  @Get('availability')
  @RequireAnyPermission(...SALES_CREATE_PERMISSIONS)
  @ApiOperation({ summary: 'Check whether this deployment accepts new sales roots' })
  availability() {
    return this.salesAvailability.execute();
  }

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
