import type {
  ActionId,
  EmployeeAccessStatus,
  MenuDefinition,
  MenuGroup,
  MenuId,
  PermissionMatrixCell,
  PermissionMatrixRow,
} from '@watchdog-bms/contracts';

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

export function accountAccessNotice(status: EmployeeAccessStatus): string {
  if (status === 'ACTIVE') return 'ข้อมูลที่เห็นจริงยังขึ้นกับสาขาและขอบเขตของแต่ละรายการ';
  if (status === 'DRAFT') return 'สิทธิ์ชุดนี้จะเริ่มใช้งานได้หลังเปิดใช้งานบัญชี';
  return 'บัญชีนี้ปิดใช้งานอยู่ จึงยังใช้สิทธิ์ชุดนี้ไม่ได้';
}

export type GrantedMenuGroup = {
  group: MenuGroup;
  menus: Array<{ menu: MenuDefinition; labels: string[] }>;
};

export type GrantedMenuProjection =
  | { complete: true; groups: GrantedMenuGroup[]; grantedCount: number }
  | { complete: false; groups: []; grantedCount: 0; missingRoleIds: string[] };

/** Merge every assigned role, then keep only menu rows the employee can actually open. */
export function projectGrantedMenus(
  roleIds: string[],
  rows: PermissionMatrixRow[],
  menus: MenuDefinition[],
  supportedMenuIds: ReadonlySet<MenuId>,
): GrantedMenuProjection {
  const uniqueRoleIds = [...new Set(roleIds)];
  const rowByRoleId = new Map(rows.map((row) => [row.roleId, row]));
  const missingRoleIds = uniqueRoleIds.filter((roleId) => !rowByRoleId.has(roleId));
  if (missingRoleIds.length > 0) return { complete: false, groups: [], grantedCount: 0, missingRoleIds };

  const roleRows = uniqueRoleIds.map((roleId) => rowByRoleId.get(roleId)!);
  const grantedMenus = menus
    .filter((menu) => supportedMenuIds.has(menu.id))
    .map((menu) => {
      const cell: PermissionMatrixCell = {};
      for (const action of ACTION_ORDER) {
        if (roleRows.some((row) => row.menus[menu.id]?.[action] === true)) cell[action] = true;
      }
      return { menu, labels: capabilityLabels(cell) };
    })
    .filter(({ labels }) => labels.length > 0);

  return {
    complete: true,
    groups: MENU_GROUP_ORDER
      .map((group) => ({ group, menus: grantedMenus.filter(({ menu }) => menu.group === group) }))
      .filter(({ menus: groupMenus }) => groupMenus.length > 0),
    grantedCount: grantedMenus.length,
  };
}
