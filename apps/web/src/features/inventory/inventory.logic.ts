import type { StockBalance, StockMovementType } from './inventory.model';
import { OUTBOUND_MOVEMENT_TYPES, ADJUSTMENT_MOVEMENT_TYPES } from './inventory.constants';

export const INVENTORY_TABS = [
  'products',
  'locations',
  'movements',
  'stockAction',
  'stockCount',
  'stockReport',
  'scan',
] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

/**
 * The inventory hub is a card grid rather than a segmented tab bar, but follows
 * the same rule: offer a card only when at least one endpoint behind it is usable.
 */
const INVENTORY_TAB_PERMISSIONS: Record<InventoryTab, readonly string[]> = {
  products: ['inventory.product.read'],
  locations: ['inventory.location.read'],
  movements: ['inventory.movement.read'],
  stockAction: ['inventory.movement.create', 'inventory.stock_count.create', 'inventory.movement.adjust'],
  stockCount: ['inventory.stock_count.create'],
  stockReport: ['inventory.report.read'],
  scan: ['inventory.product.read'],
};

export function visibleInventoryTabs(permissions: readonly string[]): InventoryTab[] {
  return INVENTORY_TABS.filter((tab) =>
    INVENTORY_TAB_PERMISSIONS[tab].some((key) => permissions.includes(key)),
  );
}

/** Returns true if the movement type is outbound (decreases stock) */
export function isOutboundMovement(type: StockMovementType): boolean {
  return OUTBOUND_MOVEMENT_TYPES.includes(type);
}

/** Returns true if the movement type requires a reason field */
export function requiresReasonField(type: StockMovementType): boolean {
  return ADJUSTMENT_MOVEMENT_TYPES.includes(type);
}

/** Returns low-stock flag for a balance given product reorderPoint */
export function withLowStockFlag(
  balance: StockBalance,
  reorderPoint?: string,
): StockBalance {
  if (!reorderPoint) return balance;
  const isLowStock = parseFloat(balance.quantity) <= parseFloat(reorderPoint);
  return { ...balance, isLowStock };
}

/**
 * Parse an internal QR payload string for display.
 * Returns entityType and entityId or null if unrecognized.
 */
export function parseQrPayload(
  payload: string,
): { entityType: 'PRODUCT' | 'LOCATION'; entityId: string } | null {
  if (!payload?.startsWith('WD1:')) return null;
  const parts = payload.split(':');
  if (parts.length === 3 && parts[1] === 'P') return { entityType: 'PRODUCT', entityId: parts[2] };
  if (parts.length === 3 && parts[1] === 'LOC') return { entityType: 'LOCATION', entityId: parts[2] };
  return null;
}

/** Format a quantity string for display (removes trailing zeros) */
export function formatQty(qty: string): string {
  const n = parseFloat(qty);
  if (isNaN(n)) return qty;
  return n % 1 === 0 ? n.toFixed(0) : n.toString();
}
