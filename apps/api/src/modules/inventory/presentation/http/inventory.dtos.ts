// HTTP-boundary validation for the inventory bodies (G1). Same rule as
// procurement.dtos.ts: the field list of each class is the union of the use-case
// command type and what apps/web actually sends, never narrower — under
// `forbidNonWhitelisted` a missing field is a 400 on a live page.
//
// Two caller details this file exists to preserve:
//   * inventory.api.ts `createMovement` puts `movementType` in the body and picks
//     the endpoint from it, so /movements/receive and /movements/issue receive a
//     movementType even though the controller overrides it.
//   * the product edit form sends explicit `null` for description, salePrice, and
//     bookingDurationMinutes to clear those columns.
import {
  IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { DECIMAL_STRING_PATTERN } from '../../../../common/pipes/decimal-string.patterns';

// Prisma enums; kept local because they have no contracts-level runtime array.
const MOVEMENT_TYPES = ['STOCK_IN', 'STOCK_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_ADJUSTMENT_IN', 'COUNT_ADJUSTMENT_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] as const;
const MOVEMENT_DIRECTIONS = ['IN', 'OUT'] as const;
const PRODUCT_KINDS = ['STOCKABLE', 'SERVICE', 'NON_STOCK'] as const;
const LOCATION_TYPES = ['MAIN', 'WAREHOUSE', 'STOREFRONT', 'VEHICLE', 'VIRTUAL', 'OTHER'] as const;
const BARCODE_TYPES = ['INTERNAL_QR', 'EAN13', 'UPC', 'CODE128', 'SUPPLIER', 'OTHER'] as const;
const QR_ENTITY_TYPES = ['PRODUCT', 'LOCATION'] as const;

// ---- Movements ----

/**
 * /movements/receive, /movements/issue, /movements/adjust. The controller decides
 * the final movementType (STOCK_IN / STOCK_OUT / ADJUSTMENT_IN / ADJUSTMENT_OUT);
 * the caller-sent movementType and direction are inputs to that decision on
 * /adjust and ignored on the other two.
 */
export class CreateMovementDto {
  @IsString() @IsNotEmpty() @MaxLength(64) productId!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) locationId!: string;
  @Matches(DECIMAL_STRING_PATTERN) quantity!: string;
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
  @IsIn(MOVEMENT_TYPES) @IsOptional() movementType?: (typeof MOVEMENT_TYPES)[number];
  @IsIn(MOVEMENT_DIRECTIONS) @IsOptional() direction?: (typeof MOVEMENT_DIRECTIONS)[number];
  @IsString() @IsOptional() @MaxLength(80) referenceType?: string;
  @IsString() @IsOptional() @MaxLength(64) referenceId?: string;
}

export class TransferStockDto {
  @IsString() @IsNotEmpty() @MaxLength(64) productId!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) fromLocationId!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) toLocationId!: string;
  @Matches(DECIMAL_STRING_PATTERN) quantity!: string;
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
}

export class StockCountDto {
  @IsString() @IsNotEmpty() @MaxLength(64) productId!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) locationId!: string;
  @Matches(DECIMAL_STRING_PATTERN) countedQuantity!: string;
  // The use case already rejects a blank reason; saying so here names the field.
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

// ---- Products ----

export class CreateProductDto {
  @IsString() @IsNotEmpty() @MaxLength(80) sku!: string;
  @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
  @IsString() @IsOptional() @MaxLength(2_000) description?: string;
  @IsString() @IsOptional() @MaxLength(160) category?: string;
  @IsString() @IsNotEmpty() @MaxLength(40) unit!: string;
  @IsIn(PRODUCT_KINDS) @IsOptional() kind?: (typeof PRODUCT_KINDS)[number];
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() reorderPoint?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() salePrice?: string;
  @IsInt() @Min(0) @Max(1_440) @IsOptional() bookingDurationMinutes?: number;
  @IsBoolean() @IsOptional() customerVisible?: boolean;
}

export class UpdateProductDto {
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(300) name?: string;
  @IsString() @IsOptional() @MaxLength(2_000) description?: string | null;
  @IsString() @IsOptional() @MaxLength(160) category?: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(40) unit?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() reorderPoint?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() salePrice?: string | null;
  @IsInt() @Min(0) @Max(1_440) @IsOptional() bookingDurationMinutes?: number | null;
  @IsBoolean() @IsOptional() customerVisible?: boolean;
}

export class AddProductBarcodeDto {
  @IsIn(BARCODE_TYPES) type!: (typeof BARCODE_TYPES)[number];
  @IsString() @IsNotEmpty() @MaxLength(160) value!: string;
  @IsString() @IsOptional() @MaxLength(80) source?: string;
}

// ---- Locations ----

export class CreateLocationDto {
  @IsString() @IsNotEmpty() @MaxLength(40) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsIn(LOCATION_TYPES) @IsOptional() type?: (typeof LOCATION_TYPES)[number];
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
}

export class UpdateLocationDto {
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(160) name?: string;
  @IsIn(LOCATION_TYPES) @IsOptional() type?: (typeof LOCATION_TYPES)[number];
}

// ---- QR labels ----

/** POST .../internal-qr on a product or location — the entity comes from the path. */
export class GenerateEntityQrDto {
  @IsString() @IsOptional() @MaxLength(300) labelText?: string;
}

/** POST /inventory/labels/generate — the entity comes from the body. */
export class GenerateQrLabelDto {
  @IsIn(QR_ENTITY_TYPES) entityType!: (typeof QR_ENTITY_TYPES)[number];
  @IsString() @IsNotEmpty() @MaxLength(64) entityId!: string;
  @IsString() @IsOptional() @MaxLength(300) labelText?: string;
}
