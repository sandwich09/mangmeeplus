import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
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

// Audit H-23: these two were `type` aliases named `...Dto`. A type is erased at runtime, so the
// global ValidationPipe saw metatype `Object` and skipped them entirely — worse than an obviously
// untyped body, because the name says the boundary is guarded when it is not. As classes they now
// actually get `whitelist` + `forbidNonWhitelisted`, so an unknown key is a 400 instead of being
// carried into the use case.
const COUNTERPARTY_TYPES: AccountingCounterpartyType[] = ['CUSTOMER', 'VENDOR', 'BOTH'];
const COUNTERPARTY_STATUSES: AccountingCounterpartyStatus[] = ['ACTIVE', 'ARCHIVED'];

class CreateCounterpartyDto {
  @IsIn(COUNTERPARTY_TYPES) type!: AccountingCounterpartyType;
  @IsString() @IsNotEmpty() @MaxLength(255) displayName!: string;
  @IsString() @IsOptional() @MaxLength(255) legalName?: string;
  // Bounded, not shaped: the 13-digit rule belongs to the company's own identity, and a
  // counterparty tax id can legitimately be a foreign one.
  @IsString() @IsOptional() @MaxLength(32) taxId?: string;
  @IsString() @IsOptional() @MaxLength(16) branchCode?: string;
  @IsEmail() @IsOptional() @MaxLength(255) email?: string;
  @IsString() @IsOptional() @MaxLength(32) phone?: string;
}

class UpdateCounterpartyDto {
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(255) displayName?: string;
  @IsString() @IsOptional() @MaxLength(255) legalName?: string;
  @IsString() @IsOptional() @MaxLength(32) taxId?: string;
  @IsEmail() @IsOptional() @MaxLength(255) email?: string;
  @IsString() @IsOptional() @MaxLength(32) phone?: string;
  @IsIn(COUNTERPARTY_STATUSES) @IsOptional() status?: AccountingCounterpartyStatus;
}

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
