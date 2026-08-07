import { Controller, Get, Post, Patch, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { CreateBankAccountDto, UpdateBankAccountDto } from '@watchdog-bms/contracts';
import {
  ListBankAccountsUseCase,
  GetBankAccountUseCase,
  CreateBankAccountUseCase,
  UpdateBankAccountUseCase,
  DeactivateBankAccountUseCase,
} from '../../application/use-cases/bank-account.use-case';

@ApiTags('banking')
@Controller('companies/:companyId/banking/bank-accounts')
export class BankAccountController {
  constructor(
    private readonly listBankAccounts: ListBankAccountsUseCase,
    private readonly getBankAccount: GetBankAccountUseCase,
    private readonly createBankAccount: CreateBankAccountUseCase,
    private readonly updateBankAccount: UpdateBankAccountUseCase,
    private readonly deactivateBankAccount: DeactivateBankAccountUseCase,
  ) {}

  @Get()
  @RequirePermissions('bank.account.read')
  @ApiOperation({ summary: 'List bank accounts' })
  async list(@ReqCtx() ctx: RequestContext) {
    return this.listBankAccounts.execute(ctx);
  }

  @Get(':bankAccountId')
  @RequirePermissions('bank.account.read')
  @ApiOperation({ summary: 'Get bank account by id' })
  async getOne(@ReqCtx() ctx: RequestContext, @Param('bankAccountId') bankAccountId: string) {
    return this.getBankAccount.execute(ctx, bankAccountId);
  }

  @Post()
  @RequirePermissions('bank.account.manage')
  @ApiOperation({ summary: 'Create bank account' })
  async create(@ReqCtx() ctx: RequestContext, @Body() body: CreateBankAccountDto) {
    return this.createBankAccount.execute(ctx, body);
  }

  @Patch(':bankAccountId')
  @RequirePermissions('bank.account.manage')
  @ApiOperation({ summary: 'Update bank account' })
  async update(@ReqCtx() ctx: RequestContext, @Param('bankAccountId') bankAccountId: string, @Body() body: UpdateBankAccountDto) {
    return this.updateBankAccount.execute(ctx, bankAccountId, body);
  }

  @Post(':bankAccountId/deactivate')
  @RequirePermissions('bank.account.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate bank account' })
  async deactivate(@ReqCtx() ctx: RequestContext, @Param('bankAccountId') bankAccountId: string) {
    return this.deactivateBankAccount.execute(ctx, bankAccountId);
  }
}
