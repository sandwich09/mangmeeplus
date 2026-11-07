import { Injectable } from '@nestjs/common';
import { MENU_REGISTRY, THAI_SYSTEM_ROLE_NAMES, type ToolResult } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { PERMISSIONS, SYSTEM_ROLES } from '../../../auth/permission-registry';
import { ListRolesUseCase } from '../../../employee-access/application/use-cases/list-roles.use-case';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { filterPermissionsByEntitlement } from '../../../employee-access/domain/logic/feature-gate.logic';
import { summarizeCapabilities } from '../../../employee-access/domain/logic/capability.logic';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';

const ACTIONS: Record<string, string> = { view: 'ดู', create: 'เพิ่ม', edit: 'แก้ไข', del: 'ลบ', approve: 'อนุมัติ' };
export const lineTeamRoleName = (role: { key: string; name: string; isSystem: boolean }) => role.isSystem || SYSTEM_ROLES.some(standard => standard.key === role.key && standard.name === role.name) ? (THAI_SYSTEM_ROLE_NAMES as Record<string, string>)[role.key] ?? role.name : role.name;

/** Same role visibility, feature filtering and labels as the web role picker/matrix. */
@Injectable()
export class CompanyGetRolesTool implements ErpReadToolPort {
  readonly toolName = 'company.get_roles';
  constructor(private readonly prisma: PrismaService, private readonly listRoles: ListRolesUseCase) {}
  async execute(ctx: ErpToolContext, input: { roleName?: string; employeeName?: string; permissionKey?: string } = {}): Promise<ToolResult> {
    const asOf = new Date().toISOString(), sourceRefs = [{ label: 'หน้าที่และสิทธิ์พนักงาน', module: 'employee-access', entityType: 'role_permissions', permissionChecked: true as const, webPath: `/companies/${ctx.companyId}/settings/access-overview` }];
    const readRoles = ctx.permissions.some(key => ['access.role.read', 'access.role.manage', 'access.employee.create', 'access.employee.update'].includes(key));
    if (!readRoles || input.employeeName && !ctx.permissions.includes('access.employee.read')) return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    if (input.permissionKey && !PERMISSIONS.some(p => p.key === input.permissionKey)) return { toolName: this.toolName, status: 'ok', data: { reply: 'ต้องการดูสิทธิ์ทำงานเรื่องอะไรคะ' }, sourceRefs, asOf };
    const [catalog, entitled] = await Promise.all([this.listRoles.execute(ctx.companyId, { permissions: ctx.permissions, entitlementDeniedPermissions: ctx.entitlementDeniedPermissions, isOwner: ctx.roles?.includes('OWNER') ?? false }), loadEntitledFeatureKeys(this.prisma, ctx.companyId)]);
    const roles = catalog.filter(role => !input.roleName || lineTeamRoleName(role) === input.roleName).map(role => {
      const permissionKeys = filterPermissionsByEntitlement(role.permissionKeys, entitled), keys = new Set(permissionKeys);
      return { id: role.id, name: lineTeamRoleName(role), status: role.status, assignable: role.assignableByCurrentUser, keys,
        capabilities: summarizeCapabilities(permissionKeys).map(c => c.nameTh),
        menus: MENU_REGISTRY.flatMap(menu => Object.entries(menu.actions).filter(([, permissions]) => permissions?.some(key => keys.has(key))).map(([action]) => `${ACTIONS[action]}${menu.labelTh}`)),
        // Raw keys stay server-side. Registry descriptions retain exact authority for Thai explanation.
        permissions: PERMISSIONS.filter(p => keys.has(p.key)).map(p => p.description) };
    });
    let employees: Array<{ name: string; status: string; roles: string[] }> | undefined;
    if (input.permissionKey) {
      const holders = roles.filter(role => role.status === 'ACTIVE' && role.keys.has(input.permissionKey!));
      roles.splice(0, roles.length, ...holders);
      if (!ctx.permissions.includes('access.employee.read')) return { toolName: this.toolName, status: 'ok', asOf, sourceRefs,
        data: { roles: roles.map(({ id: _id, keys: _keys, ...role }) => role),
          message: holders.length ? `หน้าที่ที่มีสิทธิ์ทำเรื่องนี้คือ ${holders.map(role => role.name).join(' · ')}ค่ะ` : 'ยังไม่มีหน้าที่ที่มีสิทธิ์ทำเรื่องนี้ในร้านค่ะ' } };
    }
    if (input.employeeName || input.permissionKey) {
      const allowedRoles = roles.filter(role => role.status === 'ACTIVE' && (!input.permissionKey || role.keys.has(input.permissionKey)));
      const memberships = await this.prisma.client.companyMembership.findMany({ where: { companyId: ctx.companyId,
        ...(input.employeeName ? { OR: [{ employeeAccessProfile: { displayName: { contains: input.employeeName, mode: 'insensitive' as const } } }, { user: { displayName: { contains: input.employeeName, mode: 'insensitive' as const } } }] } : { status: 'ACTIVE', user: { status: 'ACTIVE' } }),
        roles: { some: { roleId: { in: allowedRoles.map(role => role.id) } } },
        ...(ctx.branchIds !== undefined ? { branchScopeMode: { not: 'ALL_BRANCHES' as const }, AND: [{ OR: [{ defaultBranchId: null }, { defaultBranchId: { in: ctx.branchIds } }] }, { branchScopes: { none: { branchId: { notIn: ctx.branchIds } } } }] } : {}),
      }, select: { status: true, user: { select: { displayName: true } }, employeeAccessProfile: { select: { displayName: true } }, roles: { select: { roleId: true } } }, take: 51 });
      employees = memberships.slice(0, 50).map(m => ({ name: m.employeeAccessProfile?.displayName ?? m.user.displayName, status: m.status, roles: allowedRoles.filter(role => m.roles.some(mr => mr.roleId === role.id)).map(role => role.name) }));
      const held = new Set(memberships.flatMap(m => m.roles.map(mr => mr.roleId)));
      if (input.employeeName) roles.splice(0, roles.length, ...roles.filter(role => held.has(role.id)));
      return { toolName: this.toolName, status: 'ok', data: { roles: roles.map(({ id: _id, keys: _keys, ...role }) => role), employees, hasMore: memberships.length > 50,
        note: 'สิทธิ์ตามหน้าที่ค่ะ การอนุมัติใบเบิกจริงยังต้องเป็นผู้อนุมัติที่ขั้นตอนนั้นรออยู่' }, sourceRefs, asOf };
    }
    return { toolName: this.toolName, status: 'ok', data: { roles: roles.map(({ id: _id, keys: _keys, ...role }) => role) }, sourceRefs, asOf };
  }
}
