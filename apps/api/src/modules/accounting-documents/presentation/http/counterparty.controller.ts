import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import { BUYER_ENTITY_KINDS } from '@watchdog-bms/contracts';
import {
  CreateCounterpartyUseCase,
  UpdateCounterpartyUseCase,
  GetCounterpartyUseCase,
  ListCounterpartiesUseCase,
  PromoteSeenAddressUseCase,
} from '../../application/use-cases/counterparty.use-case';
import type { AccountingCounterpartyStatus, BuyerEntityKind } from '@watchdog-bms/contracts';

// Audit H-23: these two were `type` aliases named `...Dto`. A type is erased at runtime, so the
// global ValidationPipe saw metatype `Object` and skipped them entirely — worse than an obviously
// untyped body, because the name says the boundary is guarded when it is not. As classes they now
// actually get `whitelist` + `forbidNonWhitelisted`, so an unknown key is a 400 instead of being
// carried into the use case.
const COUNTERPARTY_STATUSES: AccountingCounterpartyStatus[] = ['ACTIVE', 'ARCHIVED'];

/**
 * A5/§12: `type` is gone from both bodies on purpose. There is no customer/vendor/both picker on
 * any screen any more — the server sets it (VENDOR when a purchase created the row, BOTH once the
 * sales side uses it, CON-1) and the screens show usage badges counted from real documents. With
 * `forbidNonWhitelisted` on, a client that still sends `type` gets a 400 naming the field rather
 * than having its choice quietly ignored.
 */
class CreateCounterpartyDto {
  @IsString() @IsNotEmpty() @MaxLength(255) displayName!: string;
  @IsString() @IsOptional() @MaxLength(255) legalName?: string;
  // Bounded, not shaped: the 13-digit rule belongs to the company's own identity, and a
  // counterparty tax id can legitimately be a foreign one.
  @IsString() @IsOptional() @MaxLength(32) taxId?: string;
  @IsString() @IsOptional() @MaxLength(16) branchCode?: string;
  @IsIn(BUYER_ENTITY_KINDS) @IsOptional() entityKind?: BuyerEntityKind;
  @IsEmail() @IsOptional() @MaxLength(255) email?: string | null;
  @IsString() @IsOptional() @MaxLength(32) phone?: string;
  // Length is checked in the use case, not here: §8 wants "ตัดให้สั้นลง" with the limit in it, and a
  // decorator would answer with the framework's generic sentence instead.
  @IsString() @IsOptional() addressText?: string;
  @IsString() @IsOptional() @MaxLength(16) postalCode?: string;
}

class UpdateCounterpartyDto {
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(255) displayName?: string;
  @IsString() @IsOptional() @MaxLength(255) legalName?: string;
  @IsString() @IsOptional() @MaxLength(32) taxId?: string;
  @IsString() @IsOptional() @MaxLength(16) branchCode?: string;
  @IsIn(BUYER_ENTITY_KINDS) @IsOptional() entityKind?: BuyerEntityKind;
  @IsEmail() @IsOptional() @MaxLength(255) email?: string | null;
  @IsString() @IsOptional() @MaxLength(32) phone?: string;
  @IsString() @IsOptional() addressText?: string;
  @IsString() @IsOptional() @MaxLength(16) postalCode?: string;
  /** A4 "ล็อกที่อยู่หลัก": a newer document address stops replacing this one. */
  @IsBoolean() @IsOptional() locked?: boolean;
  @IsIn(COUNTERPARTY_STATUSES) @IsOptional() status?: AccountingCounterpartyStatus;
  /** §11.1: the version the screen loaded. A mismatch answers `counterparty_conflict`. */
  @IsISO8601() @IsOptional() expectedUpdatedAt?: string;
}

class PromoteSeenAddressDto {
  @IsString() @IsNotEmpty() @MaxLength(500) addressText!: string;
  /** §11.1/§15: the version the screen loaded. A mismatch answers `counterparty_conflict`. */
  @IsISO8601() @IsOptional() expectedUpdatedAt?: string;
}

/**
 * Owner 2026-09-25: whoever added a counterparty (through their purchase or sales document, or by
 * hand) may open and edit it. The route admits the relation keys members hold for their own
 * documents: `expense.read_related` is in every built-in company role and the core pack, and
 * `accounting.document.read_related` covers the sales side. Each is entitlement-gated to its own
 * feature (`expenses.list` / `sales_documents`), so the door stays shut for a company with neither.
 * The use case then requires the counterparty permission or `createdByUserId === ctx.userId`.
 */
const ADDED_BY_PATH = ['expense.read_related', 'accounting.document.read_related'] as const;

@ApiTags('accounting')
@Controller('companies/:companyId/accounting/counterparties')
export class CounterpartyController {
  constructor(
    private readonly create: CreateCounterpartyUseCase,
    private readonly update: UpdateCounterpartyUseCase,
    private readonly get: GetCounterpartyUseCase,
    private readonly list: ListCounterpartiesUseCase,
    private readonly promoteSeenAddress: PromoteSeenAddressUseCase,
  ) {}

  @Get()
  @RequirePermissions('accounting.counterparty.read')
  @ApiOperation({ summary: 'List counterparties' })
  async listCounterparties(
    @ReqCtx() ctx: RequestContext,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('usage') usage?: string,
    @Query('addressMissing') addressMissing?: string,
  ) {
    return this.list.execute(ctx, Number(page ?? 1), Number(pageSize ?? 20), {
      ...(search ? { search } : {}),
      // A5: the chips are ทั้งหมด / เคยซื้อ / เคยขาย / ยังไม่มีที่อยู่ — no `type` filter exists.
      ...((usage === 'bought' || usage === 'sold') && { usage }),
      ...(addressMissing === 'true' && { addressMissing: true }),
    });
  }

  @Get(':counterpartyId')
  @RequireAnyPermission('accounting.counterparty.read', ...ADDED_BY_PATH)
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
  @RequireAnyPermission('accounting.counterparty.manage', ...ADDED_BY_PATH)
  @ApiOperation({ summary: 'Update counterparty' })
  async updateCounterparty(
    @ReqCtx() ctx: RequestContext,
    @Param('counterpartyId') counterpartyId: string,
    @Body() body: UpdateCounterpartyDto,
  ) {
    return this.update.execute(ctx, counterpartyId, body);
  }

  @Post(':counterpartyId/promote-seen-address')
  @RequireAnyPermission('accounting.counterparty.manage', ...ADDED_BY_PATH)
  @ApiOperation({ summary: 'Make an address seen on a document the primary one' })
  async promote(
    @ReqCtx() ctx: RequestContext,
    @Param('counterpartyId') counterpartyId: string,
    @Body() body: PromoteSeenAddressDto,
  ) {
    return this.promoteSeenAddress.execute(ctx, counterpartyId, body.addressText, body.expectedUpdatedAt);
  }
}
