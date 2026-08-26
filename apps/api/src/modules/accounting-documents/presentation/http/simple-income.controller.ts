import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RequestContext } from '@watchdog-bms/contracts';
import { RequireAnyPermission } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { RecordSimpleIncomeUseCase } from '../../application/use-cases/record-simple-income.use-case';
import { RecordSimpleIncomeDto } from './accounting-money.dtos';

@ApiTags('accounting')
@Controller('companies/:companyId/accounting/simple-income')
export class SimpleIncomeController {
  constructor(private readonly recordSimpleIncome: RecordSimpleIncomeUseCase) {}

  @Post()
  @RequireAnyPermission('accounting.document.create', 'accounting.invoice.create')
  @ApiOperation({ summary: 'Record received income as one atomic invoice, payment, and receipt bundle' })
  record(@ReqCtx() ctx: RequestContext, @Body() body: RecordSimpleIncomeDto) {
    return this.recordSimpleIncome.execute(ctx, body);
  }
}
