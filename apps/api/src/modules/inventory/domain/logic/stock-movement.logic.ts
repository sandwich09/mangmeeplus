// Pure domain logic — no Prisma, no NestJS, no side effects

import { StockMovementType, StockMovementDirection, InternalQrEntityType } from '../models/inventory.model';

/** Map movement type to direction */
export function movementDirection(type: StockMovementType): StockMovementDirection {
  switch (type) {
    case 'STOCK_IN':
    case 'TRANSFER_IN':
    case 'COUNT_ADJUSTMENT_IN':
    case 'ADJUSTMENT_IN':
      return 'IN';
    case 'STOCK_OUT':
    case 'TRANSFER_OUT':
    case 'COUNT_ADJUSTMENT_OUT':
    case 'ADJUSTMENT_OUT':
      return 'OUT';
  }
}

/** True if the movement type decreases stock */
export function isOutbound(type: StockMovementType): boolean {
  return movementDirection(type) === 'OUT';
}

/** True if the movement type requires a reason field */
export function requiresReason(type: StockMovementType): boolean {
  return (
    type === 'ADJUSTMENT_IN' ||
    type === 'ADJUSTMENT_OUT' ||
    type === 'COUNT_ADJUSTMENT_IN' ||
    type === 'COUNT_ADJUSTMENT_OUT'
  );
}

/**
 * Calculate what movement types represent a stock count adjustment.
 * Returns 'IN', 'OUT', or 'NONE' if no movement is needed (counted = current).
 */
export function countAdjustmentDirection(
  currentQty: bigint,
  countedQty: bigint,
): 'IN' | 'OUT' | 'NONE' {
  if (countedQty > currentQty) return 'IN';
  if (countedQty < currentQty) return 'OUT';
  return 'NONE';
}

/**
 * Validate that quantity is positive and within safe decimal range.
 * Returns null on success or an error string.
 */
export function validateQuantity(rawQty: string): string | null {
  const parsed = parseDecimalUnits(rawQty);
  if (parsed === null || parsed <= 0n) return 'Quantity must be a positive number';
  return null;
}

/**
 * Check if an outbound movement would cause negative stock.
 * currentBalance and outboundQty must be comparable numeric strings.
 * Returns true if operation would go negative.
 */
export function wouldGoNegative(currentBalance: string, outboundQty: string): boolean {
  const balance = parseDecimalUnits(currentBalance);
  const qty = parseDecimalUnits(outboundQty);
  if (balance === null || qty === null) return true;
  return qty > balance;
}

export const DECIMAL_SCALE = 1_000_000n;

export function parseDecimalUnits(raw: string): bigint | null {
  const trimmed = String(raw ?? '').trim();
  const match = /^([0-9]+)(?:\.([0-9]{1,6}))?$/.exec(trimmed);
  if (!match) return null;
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? '').padEnd(6, '0'));
  return whole * DECIMAL_SCALE + fraction;
}

export function decimalUnitsToString(units: bigint): string {
  const sign = units < 0n ? '-' : '';
  const abs = units < 0n ? -units : units;
  const whole = abs / DECIMAL_SCALE;
  const fraction = (abs % DECIMAL_SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

export function decimalDifference(a: string, b: string): string {
  const left = parseDecimalUnits(a);
  const right = parseDecimalUnits(b);
  if (left === null || right === null) return '0';
  return decimalUnitsToString(left > right ? left - right : right - left);
}

// ---- QR payload helpers ----

const QR_PREFIX = 'WD1';

export function buildProductQrPayload(productId: string): string {
  return `${QR_PREFIX}:P:${productId}`;
}

export function buildLocationQrPayload(locationId: string): string {
  return `${QR_PREFIX}:LOC:${locationId}`;
}

export type QrScanResult = {
  entityType: InternalQrEntityType;
  entityId: string;
};

/**
 * Parse an internal QR payload.
 * Returns parsed result or null if malformed.
 */
export function parseQrPayload(payload: string): QrScanResult | null {
  if (!payload || !payload.startsWith(`${QR_PREFIX}:`)) return null;
  const parts = payload.split(':');
  // WD1:P:<id>
  if (parts.length === 3 && parts[1] === 'P') {
    return { entityType: 'PRODUCT', entityId: parts[2] };
  }
  // WD1:LOC:<id>
  if (parts.length === 3 && parts[1] === 'LOC') {
    return { entityType: 'LOCATION', entityId: parts[2] };
  }
  return null;
}

/** Compute balance delta sign. Returns positive decimal string for balance change. */
export function balanceDelta(direction: StockMovementDirection, quantity: string): string {
  const units = parseDecimalUnits(quantity);
  if (units === null) return '0';
  return decimalUnitsToString(direction === 'IN' ? units : -units);
}
