import type { StockMovementType, InventoryLocationType } from './inventory.model';

export const MOVEMENT_TYPE_LABELS: Record<StockMovementType, { th: string; en: string }> = {
  STOCK_IN: { th: 'รับเข้า', en: 'Stock In' },
  STOCK_OUT: { th: 'จ่ายออก', en: 'Stock Out' },
  TRANSFER_IN: { th: 'รับโอน', en: 'Transfer In' },
  TRANSFER_OUT: { th: 'โอนออก', en: 'Transfer Out' },
  COUNT_ADJUSTMENT_IN: { th: 'ปรับนับ (เพิ่ม)', en: 'Count Adj. (In)' },
  COUNT_ADJUSTMENT_OUT: { th: 'ปรับนับ (ลด)', en: 'Count Adj. (Out)' },
  ADJUSTMENT_IN: { th: 'ปรับเพิ่ม', en: 'Adjustment In' },
  ADJUSTMENT_OUT: { th: 'ปรับลด', en: 'Adjustment Out' },
};

export const LOCATION_TYPE_LABELS: Record<InventoryLocationType, { th: string; en: string }> = {
  MAIN: { th: 'หลัก', en: 'Main' },
  WAREHOUSE: { th: 'คลังสินค้า', en: 'Warehouse' },
  STOREFRONT: { th: 'หน้าร้าน', en: 'Storefront' },
  VEHICLE: { th: 'ยานพาหนะ', en: 'Vehicle' },
  VIRTUAL: { th: 'เสมือน', en: 'Virtual' },
  OTHER: { th: 'อื่นๆ', en: 'Other' },
};

export const OUTBOUND_MOVEMENT_TYPES: StockMovementType[] = [
  'STOCK_OUT', 'TRANSFER_OUT', 'COUNT_ADJUSTMENT_OUT', 'ADJUSTMENT_OUT',
];

export const ADJUSTMENT_MOVEMENT_TYPES: StockMovementType[] = [
  'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'COUNT_ADJUSTMENT_IN', 'COUNT_ADJUSTMENT_OUT',
];
