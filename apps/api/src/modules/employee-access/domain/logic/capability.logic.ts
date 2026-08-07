// Item 10C+ Phase 1: pure capability logic.
// Compiles capability packs / job presets into permission keys, and summarizes a key set back into
// human-readable capabilities. No DB, no framework — the runtime authorization path is untouched.
import type { EffectiveCapability, EffectivePermission, RiskLevel } from '@watchdog-bms/contracts';
import { COMPANY_PERMISSION_KEYS, PERMISSIONS } from '../../../auth/permission-registry';
import { CAPABILITY_PACKS, CAPABILITY_PACK_BY_KEY, CORE_PACK_KEYS } from '../registries/capability-pack.registry';
import { ROLE_TEMPLATE_BY_KEY } from '../registries/role-template.registry';

const COMPANY_KEYS = new Set(COMPANY_PERMISSION_KEYS);
const PERM_BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

// Keys contributed by core packs (auto-applied to every role). A role must add at least one
// capability BEYOND these to be meaningful.
const CORE_PERMISSION_KEYS = new Set(
  CAPABILITY_PACKS.filter((p) => p.isCore).flatMap((p) => p.permissionKeys),
);

export function hasNonCoreCapability(permissionKeys: string[]): boolean {
  return permissionKeys.some((k) => !CORE_PERMISSION_KEYS.has(k));
}

export type DropReason = 'not_entitled' | 'above_granter_scope' | 'unknown';

export type CompileInput = {
  capabilityPackKeys?: string[];
  permissionKeys?: string[];
  roleTemplateKey?: string;
  // null = treat every feature as entitled (no company entitlement config, or checked elsewhere)
  entitledFeatureKeys: Set<string> | null;
  // null/undefined = granter is OWNER or scope-check skipped (create/update backward-compat)
  granterPermissionKeys?: Set<string> | null;
};

export function compileRole(input: CompileInput): {
  permissionKeys: string[];
  dropped: Array<{ key: string; reason: DropReason }>;
} {
  const dropped: Array<{ key: string; reason: DropReason }> = [];
  const packKeys = new Set<string>(CORE_PACK_KEYS);

  if (input.roleTemplateKey) {
    const tpl = ROLE_TEMPLATE_BY_KEY.get(input.roleTemplateKey);
    if (tpl) for (const pk of tpl.capabilityPackKeys) packKeys.add(pk);
    else dropped.push({ key: input.roleTemplateKey, reason: 'unknown' });
  }
  for (const pk of input.capabilityPackKeys ?? []) packKeys.add(pk);

  const add = new Set<string>();
  for (const pk of packKeys) {
    const pack = CAPABILITY_PACK_BY_KEY.get(pk);
    if (!pack) {
      dropped.push({ key: pk, reason: 'unknown' });
      continue;
    }
    if (pack.featureEntitlementKey && input.entitledFeatureKeys && !input.entitledFeatureKeys.has(pack.featureEntitlementKey)) {
      dropped.push({ key: pk, reason: 'not_entitled' });
      continue;
    }
    for (const k of pack.permissionKeys) add.add(k);
  }
  // Raw advanced keys bypass pack entitlement but still respect company scope + granter scope.
  for (const k of input.permissionKeys ?? []) add.add(k);

  const granter = input.granterPermissionKeys ?? null;
  const result: string[] = [];
  for (const k of add) {
    if (!COMPANY_KEYS.has(k)) {
      dropped.push({ key: k, reason: 'unknown' });
      continue;
    }
    if (granter && !granter.has(k)) {
      dropped.push({ key: k, reason: 'above_granter_scope' });
      continue;
    }
    result.push(k);
  }
  return { permissionKeys: result.sort(), dropped };
}

// Packs fully covered by a permission-key set (excludes core packs to keep the summary meaningful).
export function summarizeCapabilities(permissionKeys: string[]): EffectiveCapability[] {
  const keys = new Set(permissionKeys);
  return CAPABILITY_PACKS.filter(
    (p) => !p.isCore && p.permissionKeys.length > 0 && p.permissionKeys.every((k) => keys.has(k)),
  ).map((p) => ({ packKey: p.key, nameTh: p.nameTh, nameEn: p.nameEn, riskLevel: p.riskLevel }));
}

export function toEffectivePermissions(permissionKeys: string[]): EffectivePermission[] {
  return permissionKeys
    .filter((k) => PERM_BY_KEY.has(k))
    .map((k) => {
      const p = PERM_BY_KEY.get(k)!;
      return { key: k, module: k.split('.')[0] ?? k, description: p.description, riskLevel: p.riskLevel as RiskLevel };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function highRiskCount(permissionKeys: string[]): number {
  return permissionKeys.filter((k) => {
    const r = PERM_BY_KEY.get(k)?.riskLevel;
    return r === 'HIGH' || r === 'CRITICAL';
  }).length;
}
