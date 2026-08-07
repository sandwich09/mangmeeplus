import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  CreateCounterpartyUseCase,
  UpdateCounterpartyUseCase,
  GetCounterpartyUseCase,
  ListCounterpartiesUseCase,
} from '../../application/use-cases/counterparty.use-case';
import type { AccountingCounterpartyType, AccountingCounterpartyStatus } from '@watchdog-bms/contracts';

type CreateCounterpartyDto = {
  type: AccountingCounterpartyType;
  displayName: string;
  legalName?: string;
  taxId?: string;
  branchCode?: string;
  email?: string;
  phone?: string;
};

type UpdateCounterpartyDto = {
  displayName?: string;
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  status?: AccountingCounterpartyStatus;
};

@ApiTags('accounting')
@Controller('companies/:companyId/accounting/counterparties')
export class CounterpartyController {
  constructor(
    private readonly create: CreateCounterpartyUseCase,
    private readonly update: UpdateCounterpartyUseCase,
    private readonly get: GetCounterpartyUseCase,
    private readonly list: ListCounterpartiesUseCase,
  ) {}

  @Get()
  @RequirePermissions('accounting.counterparty.read')
  @ApiOperation({ summary: 'List counterparties' })
  async listCounterparties(
    @ReqCtx() ctx: RequestContext,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.list.execute(ctx, Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Get(':counterpartyId')
  @RequirePermissions('accounting.counterparty.read')
  @ApiOperation({ summary: 'Get counterparty by id' })
  async getCounterparty(
    @ReqCtx() ctx: RequestContext,
    @Param('counterpartyId') counterpartyId: string,
  ) {
    return this.get.execute(ctx, counterpartyId);
  }

  @Post()
  @RequirePermissions('accounting.counterparty.manage')
  @ApiOperation({ summary: 'Create counterparty' })
  async createCounterparty(
    @ReqCtx() ctx: RequestContext,
    @Body() body: CreateCounterpartyDto,
  ) {
    return this.create.execute(ctx, body);
  }

  @Patch(':counterpartyId')
  @RequirePermissions('accounting.counterparty.manage')
  @ApiOperation({ summary: 'Update counterparty' })
  async updateCounterparty(
    @ReqCtx() ctx: RequestContext,
    @Param('counterpartyId') counterpartyId: string,
    @Body() body: UpdateCounterpartyDto,
  ) {
    return this.update.execute(ctx, counterpartyId, body);
  }
}
