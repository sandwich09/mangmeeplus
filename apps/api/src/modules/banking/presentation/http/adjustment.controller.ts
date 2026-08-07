import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { CreateBankAdjustmentDto } from '@watchdog-bms/contracts';
import {
  ListBankAdjustmentsUseCase,
  GetBankAdjustmentUseCase,
  CreateBankAdjustmentUseCase,
  SubmitBankAdjustmentUseCase,
  ApproveBankAdjustmentUseCase,
  VoidBankAdjustmentUseCase,
} from '../../application/use-cases/bank-adjustment.use-case';

@ApiTags('banking')
@Controller('companies/:companyId/banking/adjustments')
export class AdjustmentController {
  constructor(
    private readonly listBankAdjustments: ListBankAdjustmentsUseCase,
    private readonly getBankAdjustment: GetBankAdjustmentUseCase,
    private readonly createBankAdjustment: CreateBankAdjustmentUseCase,
    private readonly submitBankAdjustment: SubmitBankAdjustmentUseCase,
    private readonly approveBankAdjustment: ApproveBankAdjustmentUseCase,
    private readonly voidBankAdjustment: VoidBankAdjustmentUseCase,
  ) {}

  @Get()
  @RequirePermissions('bank.adjustment.read')
  @ApiOperation({ summary: 'List bank adjustments' })
  async list(@ReqCtx() ctx: RequestContext) {
    return this.listBankAdjustments.execute(ctx);
  }

  @Get(':id')
  @RequirePermissions('bank.adjustment.read')
  @ApiOperation({ summary: 'Get bank adjustment by id' })
  async getOne(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.getBankAdjustment.execute(ctx, id);
  }

  @Post()
  @RequirePermissions('bank.adjustment.create')
  @ApiOperation({ summary: 'Create bank adjustment draft' })
  async create(@ReqCtx() ctx: RequestContext, @Body() body: CreateBankAdjustmentDto) {
    return this.createBankAdjustment.execute(ctx, body);
  }

  @Post(':id/submit')
  @RequirePermissions('bank.adjustment.create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit bank adjustment for approval' })
  async submit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.submitBankAdjustment.execute(ctx, id);
  }

  @Post(':id/approve')
  @RequirePermissions('bank.adjustment.approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve bank adjustment' })
  async approve(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: { ledgerDebitAccountId: string; ledgerCreditAccountId: string },
  ) {
    return this.approveBankAdjustment.execute(ctx, id, body);
  }

  @Post(':id/void')
  @RequirePermissions('bank.adjustment.void')
  @HttpCode(200)
  @ApiOperation({ summary: 'Void bank adjustment' })
  async void(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.voidBankAdjustment.execute(ctx, id, body.reason);
  }
}
