import { Controller, Get, Post, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, AccountingPaymentDirection } from '@watchdog-bms/contracts';
import { CreateAccountingPaymentDto } from './accounting-money.dtos';
import {
  CreatePaymentUseCase,
  GetPaymentUseCase,
  ListPaymentsUseCase,
  VoidPaymentUseCase,
} from '../../application/use-cases/payment.use-case';

@ApiTags('accounting')
@Controller('companies/:companyId/accounting/payments')
export class AccountingPaymentController {
  constructor(
    private readonly createPayment: CreatePaymentUseCase,
    private readonly getPayment: GetPaymentUseCase,
    private readonly listPayments: ListPaymentsUseCase,
    private readonly voidPayment: VoidPaymentUseCase,
  ) {}

  @Get()
  @RequirePermissions('accounting.payment.read')
  @ApiOperation({ summary: 'List payments' })
  async list(
    @ReqCtx() ctx: RequestContext,
    @Query('direction') direction?: AccountingPaymentDirection,
    @Query('counterpartyId') counterpartyId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.listPayments.execute(ctx, {
      direction,
      counterpartyId,
      fromDate,
      toDate,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Get(':paymentId')
  @RequirePermissions('accounting.payment.read')
  @ApiOperation({ summary: 'Get payment by id' })
  async getOne(@ReqCtx() ctx: RequestContext, @Param('paymentId') paymentId: string) {
    return this.getPayment.execute(ctx, paymentId);
  }

  @Post()
  @RequirePermissions('accounting.payment.create')
  @ApiOperation({ summary: 'Record payment' })
  async create(@ReqCtx() ctx: RequestContext, @Body() body: CreateAccountingPaymentDto) {
    return this.createPayment.execute(ctx, body);
  }

  @Post(':paymentId/void')
  @RequirePermissions('accounting.payment.void')
  @HttpCode(200)
  @ApiOperation({ summary: 'Void payment record' })
  async void(
    @ReqCtx() ctx: RequestContext,
    @Param('paymentId') paymentId: string,
    @Body() body: { reason: string },
  ) {
    return this.voidPayment.execute(ctx, paymentId, body.reason);
  }
}
