import type { ActionId, MenuGroup, PermissionMatrixCell } from '@watchdog-bms/contracts';

export const ACTION_LABEL_TH: Record<ActionId, string> = {
  view: 'ดู',
  create: 'เพิ่ม',
  edit: 'แก้ไข',
  del: 'ลบ',
  approve: 'อนุมัติ',
};

export const MENU_GROUP_LABEL_TH: Record<MenuGroup, string> = {
  main: 'ทั่วไป',
  shop: 'หน้าร้าน',
  fin: 'การเงิน',
  settings: 'ตั้งค่า',
};

export const MENU_GROUP_ORDER: MenuGroup[] = ['main', 'shop', 'fin', 'settings'];

const ACTION_ORDER: ActionId[] = ['view', 'create', 'edit', 'del', 'approve'];

/** Actions this cell actually grants, in a stable display order. `view` first. */
export function grantedActions(cell: PermissionMatrixCell | undefined): ActionId[] {
  if (cell?.view !== true) return [];
  return ACTION_ORDER.filter((action) => cell[action] === true);
}

/** Thai capability labels for a cell — [] when the menu is not visible at all. */
export function capabilityLabels(cell: PermissionMatrixCell | undefined): string[] {
  return grantedActions(cell).map((action) => ACTION_LABEL_TH[action]);
}
