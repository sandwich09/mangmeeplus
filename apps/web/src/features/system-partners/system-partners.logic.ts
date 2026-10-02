import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  DEFAULT_ON_FEATURE_KEYS,
  FEATURE_CATALOG,
  FEATURE_PACKAGE_PRESETS,
  LEGACY_FEATURE_INHERITANCE,
  MENU_ENTITLEMENT_BINDINGS,
  unmetFeatureDependencies,
  type FeatureDefinition,
  type FeaturePackagePresetKey,
  type MenuEntitlementBinding,
  type SubFeatureDefinition,
} from '@watchdog-bms/contracts';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import {
  NAV_GROUP_ORDER,
  WORKSPACE_MODULES,
} from '@/features/web-core-workspace/web-core-workspace.constants';

export type Entitlement = { featureKey: string; enabled: boolean };

export type DisableReadiness = {
  featureKey: string;
  canDisable?: boolean;
  disableReason?: string;
};

export type DisableBlock = { reason: string; featureKeys: string[] };

export type MenuSubmenu = SubFeatureDefinition & {
  enabled: boolean;
};

export type MenuCard = MenuEntitlementBinding & {
  route: string;
  enabled: boolean;
  submenus: MenuSubmenu[];
};

export type FilteredMenuCard = MenuCard & {
  visibleSubmenus: MenuSubmenu[];
  autoExpand: boolean;
};

export type EntitlementDiffItem = {
  featureKey: string;
  labelTh: string;
  enabled: boolean;
};

export type PreviewNavGroup = {
  group: MenuEntitlementBinding['group'];
  labelTh: string;
  items: Array<Pick<MenuCard, 'navKey' | 'labelTh' | 'iconKey' | 'status' | 'enabled'>>;
};

const ROUTE_BY_NAV_KEY = new Map(
  WORKSPACE_MODULES.map((module) => [
    module.key,
    module.buildHref('__preview__').replace('/companies/__preview__', ''),
  ]),
);

const GROUP_LABELS: Record<MenuEntitlementBinding['group'], string> = {
  main: '',
  operate: workspaceDictionary.th['nav.group.operate'],
  finance: workspaceDictionary.th['nav.group.finance'],
  growth: workspaceDictionary.th['nav.group.growth'],
  admin: workspaceDictionary.th['nav.group.admin'],
};

function configuredEntitlements(entitlements: readonly Entitlement[]): Map<string, boolean> {
  if (entitlements.length === 0) {
    // Zero rows is the API's legacy fail-open sentinel: entitlement.helper.ts returns null and
    // every key — including expense_auto_post — reads as entitled. Display must show the same
    // effective set the API computes, so this screen never claims a company lacks something the
    // API would grant. The first WRITE still normalises auto-post off (editableEntitlements).
    return new Map(ALL_FEATURE_ENTITLEMENT_KEYS.map((key) => [key, true]));
  }

  const explicit = new Map(entitlements.map((row) => [row.featureKey, row.enabled]));
  const configured = new Map<string, boolean>();

  for (const feature of FEATURE_CATALOG) {
    // Mirrors entitlement.helper.ts exactly, including the platform-baseline rule "absent row =
    // on, explicit false still wins". SetPartnerFeaturesUseCase refuses to WRITE an explicit
    // false for a platform key, so this branch only ever renders pre-existing legacy rows.
    configured.set(
      feature.key,
      explicit.get(feature.key) ?? DEFAULT_ON_FEATURE_KEYS.includes(feature.key),
    );
  }

  for (const [featureKey, legacyKeys] of Object.entries(LEGACY_FEATURE_INHERITANCE)) {
    if (!explicit.has(featureKey)) {
      configured.set(featureKey, legacyKeys.some((key) => configured.get(key) === true));
    }
  }

  for (const feature of FEATURE_CATALOG) {
    for (const submenu of feature.submenus) {
      configured.set(submenu.key, explicit.get(submenu.key) ?? true);
    }
  }

  return configured;
}

function effectiveEntitlements(entitlements: readonly Entitlement[]): Map<string, boolean> {
  const configured = configuredEntitlements(entitlements);
  const effective = new Map(configured);

  for (const feature of FEATURE_CATALOG) {
    for (const submenu of feature.submenus) {
      effective.set(
        submenu.key,
        configured.get(feature.key) === true && configured.get(submenu.key) === true,
      );
    }
  }

  return effective;
}

function editableEntitlements(entitlements: readonly Entitlement[]): Entitlement[] {
  if (entitlements.length > 0) return [...entitlements];
  // A zero-row company is the API's legacy fail-open sentinel. Its first write must materialize
  // that snapshot or every unrelated absent feature becomes disabled. `expense_auto_post` is the
  // one deliberate exception: CC7 (spec:236) normalises it ON only with execution evidence, and
  // the API refuses to enable it until chart-posting readiness passes. The review diff therefore
  // shows it turning off, which is the truthful result of normalising a fail-open company.
  return ALL_FEATURE_ENTITLEMENT_KEYS.map((featureKey) => ({
    featureKey,
    enabled: featureKey !== 'expense_auto_post',
  }));
}

export function entitlementEnabled(
  entitlements: readonly Entitlement[],
  featureKey: string,
): boolean {
  return effectiveEntitlements(entitlements).get(featureKey) === true;
}

function cardSubmenus(
  binding: MenuEntitlementBinding,
  catalog: readonly FeatureDefinition[],
): SubFeatureDefinition[] {
  if (!binding.parentFeatureKey) return [];
  // ponytail: these children are notification routes, not dashboard routes.
  if (binding.parentFeatureKey === 'dashboard_notifications' && binding.navKey !== 'notifications') {
    return [];
  }
  const feature = catalog.find((candidate) => candidate.key === binding.parentFeatureKey);
  if (!feature) return [];

  if (
    binding.entitlementKeys.length === 0
    || (
      binding.entitlementKeys.length === 1
      && binding.entitlementKeys[0] === binding.parentFeatureKey
    )
  ) {
    return feature.submenus;
  }

  if (binding.entitlementKeys.length > 1) {
    const ownedKeys = new Set(binding.entitlementKeys);
    return feature.submenus.filter((submenu) => ownedKeys.has(submenu.key));
  }

  return [];
}

export function buildMenuCards(
  bindings: readonly MenuEntitlementBinding[],
  catalog: readonly FeatureDefinition[],
  entitlements: readonly Entitlement[],
): MenuCard[] {
  const effective = effectiveEntitlements(entitlements);

  return bindings.filter((binding) => binding.navigation !== 'contextual').map((binding) => {
    const parentKey = binding.parentFeatureKey;
    const foundation = binding.entitlementKeys.length === 0;
    const enabled = foundation || (
      parentKey !== null
      && effective.get(parentKey) === true
      && binding.entitlementKeys.some((key) => effective.get(key) === true)
    );

    return {
      ...binding,
      route: ROUTE_BY_NAV_KEY.get(binding.navKey) ?? '',
      enabled,
      submenus: cardSubmenus(binding, catalog).map((submenu) => ({
        ...submenu,
        enabled: effective.get(submenu.key) === true,
      })),
    };
  });
}

export function toggleMenuCard(
  state: readonly Entitlement[],
  binding: MenuEntitlementBinding,
  next: boolean,
): Entitlement[] {
  if (!binding.parentFeatureKey || binding.entitlementKeys.length === 0) return [...state];

  const editableState = editableEntitlements(state);
  const changes = new Map<string, boolean>();
  if (next) {
    changes.set(binding.parentFeatureKey, true);
    for (const key of binding.entitlementKeys) changes.set(key, true);
  } else if (
    binding.entitlementKeys.length === 1
    && binding.entitlementKeys[0] === binding.parentFeatureKey
  ) {
    changes.set(binding.parentFeatureKey, false);
  } else {
    for (const key of binding.entitlementKeys) changes.set(key, false);
  }

  const existingKeys = new Set(editableState.map((row) => row.featureKey));
  return [
    ...editableState.map((row) => (
      changes.has(row.featureKey)
        ? { ...row, enabled: changes.get(row.featureKey) === true }
        : row
    )),
    ...Array.from(changes, ([featureKey, enabled]) => ({ featureKey, enabled }))
      .filter((row) => !existingKeys.has(row.featureKey)),
  ];
}

export function toggleMenuGroup(
  state: readonly Entitlement[],
  bindings: readonly MenuEntitlementBinding[],
  next: boolean,
): Entitlement[] {
  return bindings
    .filter((binding) => binding.entitlementKeys.length > 0)
    .reduce<Entitlement[]>(
      (pending, binding) => toggleMenuCard(pending, binding, next),
      [...state],
    );
}

export function toggleSubmenu(
  state: readonly Entitlement[],
  submenuKey: string,
  next: boolean,
): Entitlement[] {
  const editableState = editableEntitlements(state);
  const changes = new Map([[submenuKey, next]]);
  if (next) {
    const parent = FEATURE_CATALOG.find((feature) => (
      feature.submenus.some((submenu) => submenu.key === submenuKey)
    ));
    if (parent) changes.set(parent.key, true);
  }
  const existingKeys = new Set(editableState.map((row) => row.featureKey));
  return [
    ...editableState.map((row) => (
      changes.has(row.featureKey)
        ? { ...row, enabled: changes.get(row.featureKey) === true }
        : row
    )),
    ...Array.from(changes, ([featureKey, enabled]) => ({ featureKey, enabled }))
      .filter((row) => !existingKeys.has(row.featureKey)),
  ];
}

export function applyPreset(
  _state: readonly Entitlement[],
  presetKey: FeaturePackagePresetKey,
): Entitlement[] {
  const enabledKeys = new Set(FEATURE_PACKAGE_PRESETS[presetKey].featureKeys);
  return ALL_FEATURE_ENTITLEMENT_KEYS.map((featureKey) => ({
    featureKey,
    // Belt-and-braces with FEATURE_PACKAGE_PRESETS (menu-entitlements.ts), which already omits
    // auto-post from every preset: a package must never silently switch on a feature whose
    // chart-posting readiness has not been proven. This is a preset policy, NOT a restatement of
    // FEATURE_DEPENDENCIES — the dependency rule itself lives only in packages/contracts.
    enabled: featureKey !== 'expense_auto_post' && enabledKeys.has(featureKey),
  }));
}

/**
 * Both-direction pre-check for the partner screen, driven by the contracts matrix. Returns the
 * Thai toast text for the first unmet dependency, or null when the proposed set is consistent.
 * The API re-validates the same matrix — this only saves a round-trip.
 */
export function dependencyBlockMessage(
  current: readonly Entitlement[],
  next: readonly Entitlement[],
): string | null {
  const before = effectiveEntitlements(current);
  const effective = effectiveEntitlements(next);
  // A child being newly enabled without its prerequisite is invalid. A prerequisite being turned
  // off under an already-enabled child is the separate explicit-cascade journey below.
  const violation = unmetFeatureDependencies((key) => effective.get(key) === true)
    .find(({ featureKey }) => before.get(featureKey) !== true && effective.get(featureKey) === true);
  if (!violation) return null;
  return `ต้องเปิด ${violation.requiresFeatureKey} ก่อน จึงจะเปิด ${violation.featureKey} ได้`;
}

function diffLabel(featureKey: string): string {
  for (const feature of FEATURE_CATALOG) {
    const submenu = feature.submenus.find((candidate) => candidate.key === featureKey);
    if (submenu) return submenu.labelTh;
  }

  const menuLabels = MENU_ENTITLEMENT_BINDINGS
    .filter((binding) => binding.navigation !== 'contextual')
    .filter((binding) => (
      binding.parentFeatureKey === featureKey || binding.entitlementKeys.includes(featureKey)
    ))
    .map((binding) => binding.labelTh)
    .filter((label, index, labels) => labels.indexOf(label) === index);
  if (menuLabels.length > 0) return menuLabels.join(' / ');

  return FEATURE_CATALOG.find((feature) => feature.key === featureKey)?.labelTh ?? featureKey;
}

/** Dependents the server will atomically turn off when this pending set is confirmed. */
export function cascadeOffItems(pending: readonly Entitlement[]): EntitlementDiffItem[] {
  const effective = effectiveEntitlements(pending);
  return unmetFeatureDependencies((key) => effective.get(key) === true)
    .map(({ featureKey }) => featureKey)
    .filter((featureKey, index, keys) => keys.indexOf(featureKey) === index)
    .sort()
    .map((featureKey) => ({ featureKey, labelTh: diffLabel(featureKey), enabled: false }));
}

/**
 * Directional lock: a readiness=false row blocks only ON→OFF. OFF→ON remains available. Missing
 * readiness fails closed during a mixed-version deploy instead of offering a command the API will
 * refuse. Cascade dependents are checked too because the server preflights the final affected set.
 */
export function disableBlockForChange(
  current: readonly Entitlement[],
  next: readonly Entitlement[],
  readiness: readonly DisableReadiness[],
): DisableBlock | null {
  const readinessByKey = new Map(readiness.map((row) => [row.featureKey, row]));
  const affectedKeys = [
    ...diffEntitlements(current, next).turningOff.map(({ featureKey }) => featureKey),
    ...cascadeOffItems(next).map(({ featureKey }) => featureKey),
  ].filter((featureKey, index, keys) => keys.indexOf(featureKey) === index);
  const blocked = affectedKeys.filter((featureKey) => readinessByKey.get(featureKey)?.canDisable !== true);
  if (blocked.length === 0) return null;
  const reason = blocked
    .map((featureKey) => readinessByKey.get(featureKey)?.disableReason)
    .find((value): value is string => Boolean(value))
    // Only reachable when an affected key has NO readiness row to borrow a reason from (a legacy or
    // partially materialized company, or a mixed-version deploy) — never the runoff refusal, which
    // no longer exists.
    ?? 'ข้อมูลสิทธิ์ของฟีเจอร์นี้ยังไม่ครบ จึงยังปิดไม่ได้';
  return { reason, featureKeys: blocked };
}

export function diffEntitlements(
  server: readonly Entitlement[],
  pending: readonly Entitlement[],
): { turningOn: EntitlementDiffItem[]; turningOff: EntitlementDiffItem[] } {
  const before = effectiveEntitlements(server);
  const after = effectiveEntitlements(pending);
  const turningOn: EntitlementDiffItem[] = [];
  const turningOff: EntitlementDiffItem[] = [];

  for (const featureKey of ALL_FEATURE_ENTITLEMENT_KEYS) {
    if (before.get(featureKey) === after.get(featureKey)) continue;
    const enabled = after.get(featureKey) === true;
    (enabled ? turningOn : turningOff).push({
      featureKey,
      labelTh: diffLabel(featureKey),
      enabled,
    });
  }

  return { turningOn, turningOff };
}

export function changedEntitlements(
  server: readonly Entitlement[],
  pending: readonly Entitlement[],
): Entitlement[] {
  const before = new Map(server.map((row) => [row.featureKey, row.enabled]));
  const after = new Map(pending.map((row) => [row.featureKey, row.enabled]));
  return ALL_FEATURE_ENTITLEMENT_KEYS.flatMap((featureKey) => (
    after.has(featureKey) && before.get(featureKey) !== after.get(featureKey)
      ? [{ featureKey, enabled: after.get(featureKey) === true }]
      : []
  ));
}

// ── "แสดงเมนูบันทึกด้วยมือบนเว็บ" (manual-expense-web-entry-flag spec §8) ─────────────────────────
// A per-company SCREEN SETTING shown under the "บันทึกด้วยมือ" submenu row. It is not an entitlement
// key: it is saved by its own command, behind its own version, and never enters the pending set, a
// preset, a group toggle or the review. Every sentence the operator reads about it is here.

/** The submenu row the switch hangs under. */
export const MANUAL_WEB_ENTRY_SUBMENU_KEY = 'expenses.manual';

export const MANUAL_WEB_ENTRY_COPY = {
  label: 'แสดงเมนูบันทึกด้วยมือบนเว็บ',
  description: 'ค่าเริ่มต้นของทุกร้านคือไม่แสดง เปิดเพื่อให้ร้านนี้เห็นเมนูและปุ่มที่พาไปหน้าบันทึกด้วยมือบนเว็บ การปิดไม่ได้ห้ามการบันทึกรายจ่ายด้วยมือ พนักงานยังบันทึกผ่านใบรับรองแทนใบเสร็จ การพิมพ์ใน LINE และการแก้รายการเดิมได้ตามสิทธิ์เดิม',
  shown: 'แสดง',
  notShown: 'ไม่แสดง',
  confirmHideLabel: 'ซ่อนเมนู',
  cancelHideLabel: 'ยังไม่ซ่อน',
  savedShown: 'แสดงเมนูบันทึกด้วยมือแล้ว',
  savedHidden: 'ซ่อนเมนูบันทึกด้วยมือแล้ว',
} as const;

const MANUAL_WEB_ENTRY_CONFIRM_HIDE = 'ซ่อนเมนูบันทึกด้วยมือของร้านนี้ใช่ไหม พนักงานที่กำลังกรอกอยู่จะบันทึกต่อได้ แต่ถ้าหน้าเว็บถูกโหลดใหม่จะกลับเข้าหน้านี้ไม่ได้ แนะนำให้ปิดนอกเวลางาน';
// "พนักงานที่ไม่มีสิทธิ์ตรวจสอบค่าใช้จ่าย", not every employee: a holder of expense.review and
// expense.create still creates an expense inside the substitute-receipt wizard. And "ไม่ได้แสดง", not
// "ยังไม่แสดง": the note is also true for a shop that was shown and then hidden.
const MANUAL_WEB_ENTRY_CONFIRM_UPLOAD_OFF = 'ร้านนี้ปิดอัปโหลดใบเสร็จอยู่ ถ้าซ่อนเมนูนี้ด้วย พนักงานที่ไม่มีสิทธิ์ตรวจสอบค่าใช้จ่ายจะไม่มีปุ่มสร้างรายจ่ายบนเว็บ';
const MANUAL_WEB_ENTRY_UPLOAD_OFF_NOTE = 'ร้านนี้ปิดอัปโหลดใบเสร็จอยู่ และไม่ได้แสดงเมนูบันทึกด้วยมือ พนักงานที่ไม่มีสิทธิ์ตรวจสอบค่าใช้จ่ายจึงไม่มีปุ่มสร้างรายจ่ายบนเว็บ';
// "และบันทึก": the rule reads the SAVED rows, so switching the feature on without saving is not enough.
const MANUAL_WEB_ENTRY_PARENT_OFF = 'เปิดฟีเจอร์บันทึกด้วยมือและบันทึกก่อน จึงจะตั้งค่านี้ได้';

/**
 * What the row says and allows, from the SAVED entitlements — never the pending set — and the
 * stored setting. With the manual-expense feature off nobody holds expense.create, so the stored
 * value is shown locked and the only message is how to unlock it.
 */
export function manualWebEntryRow(saved: readonly Entitlement[], setting: { enabled: boolean }): {
  parentOpen: boolean;
  parentOffMessage: string | null;
  uploadOffNote: string | null;
  /** What to ask before saving `next`. Empty when nothing needs asking: showing the menu never does. */
  confirmLines: (next: boolean) => string[];
} {
  const parentOpen = entitlementEnabled(saved, MANUAL_WEB_ENTRY_SUBMENU_KEY);
  const uploadOff = !entitlementEnabled(saved, 'expenses.upload');
  return {
    parentOpen,
    parentOffMessage: parentOpen ? null : MANUAL_WEB_ENTRY_PARENT_OFF,
    uploadOffNote: parentOpen && uploadOff && !setting.enabled ? MANUAL_WEB_ENTRY_UPLOAD_OFF_NOTE : null,
    confirmLines: (next) => (next ? [] : [MANUAL_WEB_ENTRY_CONFIRM_HIDE, ...(uploadOff ? [MANUAL_WEB_ENTRY_CONFIRM_UPLOAD_OFF] : [])]),
  };
}

/**
 * F1.5.1 item 1 — the API refuses every entitlement command until the company's rows are
 * normalized. The screen says the same sentence the API answers with, so the operator reads one
 * message whether they hit the banner or a toast.
 */
export const NORMALIZATION_PENDING_NOTICE = 'ระบบกำลังเตรียมสิทธิ์ให้ ไม่ต้องดำเนินการ';

/** Use the screen's existing lock state; copy must not promise an unavailable command. */
export function featurePackageEditingNotice(controlsLocked: boolean): string {
  return controlsLocked
    ? 'ขณะนี้ยังเปิดหรือปิดฟีเจอร์ไม่ได้'
    : 'ตรวจสอบรายการที่เลือกก่อนบันทึก การเปลี่ยนแปลงจะมีผลเมื่อบันทึกสำเร็จ';
}

/** A refused save changed NOTHING; a refused disable must say the switch is still on. */
export const NOT_DISABLED_NOTICE = 'ยังไม่ได้ปิด';

/**
 * F1.5.1 item 1 — mixed-version default. `entitlementNormalizationPending` is typed as required,
 * but during a rolling deploy this page can be served a response from an API build that predates
 * the field, and an absent field arrives as `undefined`. Reading that as "not pending" would leave
 * the toggles editable against a build that refuses every entitlement command, so the operator
 * would be offered a save that cannot succeed. Absent ⇒ pending (read-only); only an explicit
 * `false` unlocks the switches. Locking a normalized company for one refresh is recoverable —
 * unlocking a pending one is not.
 */
export function isNormalizationPending(value: boolean | undefined): boolean {
  return value !== false;
}

export function commandFailureMessage(message: string, turningOffCount: number): string {
  const text = message || 'บันทึกแพ็กเกจไม่สำเร็จ';
  return turningOffCount > 0 ? `${text} — ${NOT_DISABLED_NOTICE}` : text;
}

/** Failures where the server may already have committed and retrying the same commandId is safest. */
export function isAmbiguousCommandFailure(status: unknown): boolean {
  return typeof status !== 'number' || status >= 500 || status === 408 || status === 429;
}

export function previewNavGroups(cards: readonly MenuCard[]): PreviewNavGroup[] {
  return NAV_GROUP_ORDER.flatMap((group) => {
    const items = cards
      .filter((card) => card.group === group)
      .map(({ navKey, labelTh, iconKey, status, enabled }) => ({
        navKey,
        labelTh,
        iconKey,
        status,
        enabled,
      }));
    return items.length > 0 ? [{ group, labelTh: GROUP_LABELS[group], items }] : [];
  });
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function matches(values: string[], query: string): boolean {
  const haystack = normalized(values.join(' '));
  return normalized(query).split(' ').every((term) => haystack.includes(term));
}

export function filterMenuCards(
  cards: readonly MenuCard[],
  query: string,
): FilteredMenuCard[] {
  if (!normalized(query)) {
    return cards.map((card) => ({
      ...card,
      visibleSubmenus: card.submenus,
      autoExpand: false,
    }));
  }

  return cards.flatMap<FilteredMenuCard>((card) => {
    if (matches([
      card.labelTh,
      card.navKey,
      card.route,
      card.parentFeatureKey ?? '',
      ...card.entitlementKeys,
    ], query)) {
      return [{
        ...card,
        visibleSubmenus: card.submenus,
        autoExpand: false,
      }];
    }

    const visibleSubmenus = card.submenus.filter((submenu) => (
      matches([submenu.labelTh, submenu.key, submenu.route], query)
    ));
    return visibleSubmenus.length > 0
      ? [{ ...card, visibleSubmenus, autoExpand: true }]
      : [];
  });
}
