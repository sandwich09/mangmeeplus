import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import { GetCrmCustomer360SummaryUseCase, GetCrmCustomer360TimelineUseCase } from '../../application/use-cases/crm-customer-360.use-case';
import { EraseCrmCustomerUseCase } from '../../application/use-cases/crm-pdpa.use-case';

// Item 15A Phase 3 — Customer 360 aggregate routes (spec "Customer 360
// aggregate"): gated crm.customer.read; finance and other blocks are redacted
// per the caller's source permissions inside the use cases, never a whole-page 403.
@ApiTags('crm')
@Controller('companies/:companyId/crm/customers/:customerId')
export class CrmCustomer360Controller {
  constructor(
    private readonly getSummary: GetCrmCustomer360SummaryUseCase,
    private readonly getTimeline: GetCrmCustomer360TimelineUseCase,
    private readonly eraseCustomer: EraseCrmCustomerUseCase,
  ) {}

  @Get('summary360')
  @RequirePermissions('crm.customer.read')
  @ApiOperation({ summary: 'Customer 360 aggregate read model (per-source permission redaction)' })
  summary360(@ReqCtx() ctx: RequestContext, @Param('customerId') customerId: string) {
    return this.getSummary.execute(ctx, customerId);
  }

  @Get('timeline')
  @RequirePermissions('crm.customer.read')
  @ApiOperation({ summary: 'Customer unified timeline, newest first (per-source permission redaction)' })
  timeline(
    @ReqCtx() ctx: RequestContext,
    @Param('customerId') customerId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.getTimeline.execute(ctx, customerId, { before, limit: limit ? Number(limit) : undefined });
  }

  @Post('erase')
  @RequirePermissions('crm.customer.erase')
  @ApiOperation({ summary: 'PDPA erasure: scrub a customer\'s personal data (finance-linked records retained; audited)' })
  erase(
    @ReqCtx() ctx: RequestContext,
    @Param('customerId') customerId: string,
    @Body() body?: { reason?: string },
  ) {
    return this.eraseCustomer.execute(ctx, customerId, body?.reason);
  }
}
