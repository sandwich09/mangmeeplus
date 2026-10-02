import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { NON_EDITABLE_ROLE_KEYS, type CreateRoleInput, type RoleDetail } from '@watchdog-bms/contracts';
import { uniqueConstraintFields } from '../../../../common/database/prisma-error';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { COMPANY_PERMISSION_KEYS, PLATFORM_ONLY_ROLE_KEYS, SYSTEM_ROLES } from '../../../auth/permission-registry';
import { compileRole, hasNonCoreCapability } from '../../domain/logic/capability.logic';
import { ownerGatedGrantViolation } from '../../domain/logic/employee-access.logic';
import { ROLE_TEMPLATE_BY_KEY } from '../../domain/registries/role-template.registry';
import { ROLE_INCLUDE, toRoleSummary } from '../dto/employee-access.mapper';

export type CreateRoleCommand = CreateRoleInput & {
  companyId: string;
  requestingUserId: string;
  requestId: string;
  // Set from request context so a non-owner cannot grant beyond their own permissions.
  // Omit (or isOwner=true) to skip the granter-scope check (owner / internal callers).
  granterPermissionKeys?: string[];
  isOwner?: boolean;
};

/**
 * Audit H-19: the slug keeps only ASCII, so every Thai name stripped to nothing and became `ROLE`.
 * Role keys are what routing compares — `approverRoleSnapshot: 'MANAGER'` is pinned on every
 * reimbursement — so the most natural setup a Thai company can do (add a member, give them the
 * "ผู้จัดการ" preset) produced a role that could never match anything. The employee saw an approval
 * screen with a permanently empty queue.
 *
 * When the name yields nothing, the preset the role was created from already carries the canonical
 * key: `tpl.x.manager` -> `MANAGER`, which is exactly what the routing expects. That is a lookup,
 * not a transliteration guess.
 *
 * A hand-typed Thai name with no preset still falls back to `ROLE`, and the caller's retry loop
 * numbers the collisions. Such a role does not match role-routed steps — the OWNER fallback in
 * matchesApproverRole is what keeps that company able to act, and naming a person on the step is
 * the other way.
 */
export function roleKeyFromName(name: string, roleTemplateKey?: string): string {
  const asciiSlug = (value: string) => value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  // The last segment is the role identity; the prefix is catalogue bookkeeping (industry tag).
  return asciiSlug(name) || asciiSlug(roleTemplateKey?.split('.').pop() ?? '') || 'ROLE';
}

const SYSTEM_ROLE_KEYS = new Set([...SYSTEM_ROLES.map((role) => role.key), ...PLATFORM_ONLY_ROLE_KEYS]);
/** Keys that are never a company's own role, whatever they were derived from. */
const NEVER_A_COMPANY_ROLE_KEY = new Set<string>([...NON_EDITABLE_ROLE_KEYS, ...PLATFORM_ONLY_ROLE_KEYS]);

/**
 * A new custom role may not take the key of a role the system defines. Owner checks, platform
 * checks, approval routing and branch scope all compare role KEYS, and the key came from free text:
 * a role named "System Admin" became `SYSTEM_ADMIN`, one named "Owner" became `OWNER`, and a Thai
 * name sent with any made-up preset key took that key's last segment. A company changes a standard
 * role by editing it, which copies it and moves its holders; a new role of the same name would
 * hide the standard one from the role list while its holders kept the original.
 *
 * The one way to a system key is the H-19 lookup above: a name with no Latin letters borrows the
 * key of a preset that exists in the catalogue. Those are ordinary company roles (MANAGER,
 * FINANCE, …) and never an owner or platform key.
 */
export function reservedRoleKey(name: string, roleTemplateKey?: string): boolean {
  const key = roleKeyFromName(name, roleTemplateKey);
  if (!SYSTEM_ROLE_KEYS.has(key)) return false;
  const borrowedFromPreset = roleKeyFromName(name) !== key && ROLE_TEMPLATE_BY_KEY.has(roleTemplateKey ?? '');
  return !borrowedFromPreset || NEVER_A_COMPANY_ROLE_KEY.has(key);
}

/**
 * Roles whose names give the same key are numbered `ROLE`, `ROLE_1`, `ROLE_2`, … with no cap. The
 * loop this replaces stopped at `_4`: a company's sixth Thai-named role was refused, and the role
 * page called it a duplicate of something, which it was not.
 *
 * Two creations at the same moment read the same free key, and the unique index on (scopeKey, key)
 * refuses one of them: that one reads the keys again and takes the next. A round is lost only to
 * another role saved in the same company in that instant.
 * ponytail: five rounds. Losing them all takes six roles of one base saved in one company at once;
 * nothing is written then, saving again works, and the answer says so. If a shop ever gets there,
 * take the company lock the edit path takes (`lockPlanTermCompany`).
 */
const ROLE_KEY_ATTEMPTS = 5;
const ROLE_KEY_ALLOCATION_FAILED = {
  code: 'role_key_allocation_failed',
  message: 'ยังไม่ได้สร้างบทบาทนี้ เพราะมีการบันทึกบทบาทอื่นในเวลาเดียวกัน กรุณากดบันทึกอีกครั้ง',
};

@Injectable()
export class CreateRoleUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: CreateRoleCommand): Promise<RoleDetail> {
    if (reservedRoleKey(cmd.name, cmd.roleTemplateKey)) {
      throw new ConflictException({ code: 'role_name_reserved', message: 'ชื่อนี้ซ้ำกับบทบาทมาตรฐานของระบบ กรุณาใช้ชื่ออื่น' });
    }
    const rawKeys = cmd.permissionKeys ?? [];
    const knownKeys = new Set(COMPANY_PERMISSION_KEYS);
    const unknown = rawKeys.filter((k) => !knownKeys.has(k));
    if (unknown.length) throw new ForbiddenException(`Unknown permission keys: ${unknown.join(', ')}`);

    // Fold capability packs / job preset into the raw keys, filtered by the granter's own scope.
    // ponytail: feature entitlement is enforced at the catalog/preview layer, not re-checked here.
    const granterScope = cmd.isOwner ? null : cmd.granterPermissionKeys ? new Set(cmd.granterPermissionKeys) : null;
    const { permissionKeys: finalKeys } = compileRole({
      capabilityPackKeys: cmd.capabilityPackKeys,
      permissionKeys: rawKeys,
      roleTemplateKey: cmd.roleTemplateKey,
      entitledFeatureKeys: null,
      granterPermissionKeys: granterScope,
    });
    if (!hasNonCoreCapability(finalKeys)) throw new ForbiddenException('At least one permission is required.');
    const ownerGated = ownerGatedGrantViolation(finalKeys, granterScope, cmd.isOwner === true);
    if (ownerGated) throw new ForbiddenException(ownerGated);

    const permissions = await this.prisma.client.permission.findMany({
      where: { key: { in: finalKeys } },
      select: { id: true },
    });

    const baseKey = roleKeyFromName(cmd.name, cmd.roleTemplateKey);
    const createWithFreeKey = () => this.prisma.client.$transaction(async (tx) => {
      // One read, whatever the number of roles. `startsWith` is a LIKE, where `_` matches any
      // character: it can only read more keys than the base's own, and the lookup below is exact.
      const taken = new Set((await tx.role.findMany({
        where: { scopeKey: cmd.companyId, key: { startsWith: baseKey } },
        select: { key: true },
      })).map((row) => row.key));
      let key = baseKey;
      for (let suffix = 1; taken.has(key); suffix++) key = `${baseKey}_${suffix}`;
      const created = await tx.role.create({
        data: { companyId: cmd.companyId, scopeKey: cmd.companyId, key, name: cmd.name, description: cmd.description, isSystem: false },
      });

      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: created.id, permissionId: p.id })),
      });

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_ROLE_CREATE,
          targetType: 'Role',
          targetId: created.id,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            key: created.key,
            permissionKeys: finalKeys,
            ...(cmd.capabilityPackKeys?.length ? { capabilityPackKeys: cmd.capabilityPackKeys } : {}),
            ...(cmd.roleTemplateKey ? { roleTemplateKey: cmd.roleTemplateKey } : {}),
          },
        },
      });

      return created;
    });

    let role: Awaited<ReturnType<typeof createWithFreeKey>> | undefined;
    for (let attempt = 0; !role && attempt < ROLE_KEY_ATTEMPTS; attempt++) {
      try {
        role = await createWithFreeKey();
      } catch (err) {
        // Only the key's own index: the transaction was rolled back, so the next round starts clean.
        if (!uniqueConstraintFields(err)?.includes('key')) throw err;
      }
    }
    if (!role) throw new ConflictException(ROLE_KEY_ALLOCATION_FAILED);

    const row = await this.prisma.client.role.findUniqueOrThrow({ where: { id: role.id }, include: ROLE_INCLUDE });
    return toRoleSummary(row);
  }
}
