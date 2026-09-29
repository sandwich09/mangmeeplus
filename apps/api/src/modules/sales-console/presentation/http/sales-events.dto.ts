/**
 * Request bodies of `/v1/sales/events/*` (sales-event-discounts spec §7.1). Classes, so the global
 * pipe whitelists them (`body-validation-coverage.spec.ts`). They bound the SHAPE; the rules that
 * need more than one field — whole baht, at least one reward, the window, the cap floor — are
 * `validateSalesEventBatch`'s, which also answers with the console's own error codes.
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';
import {
  SALES_DEAL_BASE_TIERS,
  SALES_EVENT_BATCH_ACTIONS,
  SALES_EVENT_NAME_MAX,
  SALES_EVENT_REASON_MAX,
  type SalesDealBaseTier,
  type SalesDealCadence,
  type SalesEventBatchAction,
  type SalesEventBatchInput,
  type SalesEventBatchStateBody,
  type SalesEventBatchUpdate,
  type SalesEventTicketRevokeBody,
} from '@watchdog-bms/contracts';

export class SalesEventScopeDto {
  @IsArray() @ArrayMaxSize(SALES_DEAL_BASE_TIERS.length) @IsIn([...SALES_DEAL_BASE_TIERS], { each: true }) tiers!: SalesDealBaseTier[];
  @IsArray() @ArrayMaxSize(2) @IsIn(['month', 'year'], { each: true }) intervals!: SalesDealCadence[];
}

export class SalesEventBatchDto implements SalesEventBatchInput {
  @IsString() @IsNotEmpty() @MaxLength(SALES_EVENT_NAME_MAX) eventName!: string;
  @IsString() @IsNotEmpty() @MaxLength(SALES_EVENT_NAME_MAX) batchName!: string;
  @IsInt() @Min(0) discountSatang!: number;
  @IsInt() @Min(0) rewardChatCreditUnits!: number;
  @IsInt() @Min(0) rewardReceiptImageUnits!: number;
  @IsInt() @Min(1) issueCap!: number;
  @IsISO8601() claimStartsAt!: string;
  @IsISO8601() claimEndsAt!: string;
  @IsObject() @ValidateNested() @Type(() => SalesEventScopeDto) scope!: SalesEventScopeDto;
  // The sales team is small (the team list itself reads at most 500), so is any one batch's crew.
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(64, { each: true }) agentUserIds!: string[];
}

export class SalesEventBatchUpdateDto extends SalesEventBatchDto implements SalesEventBatchUpdate {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class SalesEventBatchStateDto implements SalesEventBatchStateBody {
  @IsIn([...SALES_EVENT_BATCH_ACTIONS]) action!: SalesEventBatchAction;
  @IsInt() @Min(1) expectedVersion!: number;
  // Required for SUSPEND and LIFT; `batchActionReason` decides, so a PAUSE may leave it out.
  @IsOptional() @IsString() @MaxLength(SALES_EVENT_REASON_MAX) reason?: string;
}

export class SalesEventTicketRevokeDto implements SalesEventTicketRevokeBody {
  @IsString() @IsNotEmpty() @MaxLength(SALES_EVENT_REASON_MAX) reason!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}
