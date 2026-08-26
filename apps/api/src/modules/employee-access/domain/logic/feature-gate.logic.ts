// Runtime feature-entitlement gate (item 10A AC-FE-2). Permissions that belong to features a
// company has NOT enabled are stripped at permission-resolve time, so API guards, workspace
// nav, and LINE AI tools deny/hide together from one chokepoint — including OWNER, whose role
// grants every company permission without going through packs.
//
// The permission->feature mapping is derived from the capability-pack registry
// (featureEntitlementKey -> permissionKeys). A permission that also appears in an ungated pack
// is not stripped unless a prefix rule explicitly owns it. PREFIX_FEATURE_RULES covers feature
// keys that have no gated capability pack yet. Permissions mapped to nothing are not feature-gated.
import { CAPABILITY_PACKS } from '../registries/capability-pack.registry';
import { FEATURE_CATALOG, REPORT_PERMISSION_KEYS } from '@watchdog-bms/contracts';

const SUBFEATURE_RULES = FEATURE_CATALOG.flatMap((feature) =>
  feature.submenus.map((submenu) => ({ ...submenu, parentKey: feature.key })),
);

// Prefix gates, checked BEFORE pack membership so they win even for permissions that live in an
// ungated capability pack. A permission is kept if ANY listed feature is enabled.
//  - inventory.product.*: the product/service catalog is sold independently from Inventory + CRM.
//  - report.*        : item 18 report catalog/BI has no pack; gate by the `reports` toggle.
//  - reimbursement.* : reimbursement packs carry no feature key (it's a spending flow), so gate it
//                      behind its own menu entitlement.
//  - dashboard./notification. : these read permissions also live in the ungated core pack, so the
//                      prefix rules make the existing dashboard_notifications entitlement effective.
//  - *.read_related : view-only relation ABAC is universal in core, but source documents still
//                      belong to their parent feature entitlement.
//  - crm.channel.    : LINE OA is sold independently from CRM. Listed BEFORE the crm. rule because
//                      the first matching prefix wins.
//  - crm.ai.         : CRM AI assist/read is AI functionality that happens to live under the crm
//                      key namespace — it must follow the AI toggle, not the CRM toggle, so turning
//                      ai_line_assistant off actually removes AI from the inbox. Listed BEFORE the
//                      crm. rule because the first matching prefix wins.
//  - crm.*           : the whole CRM domain follows the `crm` toggle. crm.customer/lead/etc. are
//                      already crm-packed; crm.inbox/channel/template (กล่องข้อความ) have no pack, so
//                      this prefix is what gates them too.
//  - ai.suggestion./ai.draft. : the "AI แนะนำ" workspace module has no pack; gate it behind the
//                      ai_line_assistant toggle (the AI entitlement). Core ai.tool.invoke/line.ai.query
//                      live in pack.core.basics and don't match these prefixes, so they stay on.
// (Module-scoped report keys like `ledger.report.read` don't start with `report.`, so they keep
// their own module's feature gate.)
const PREFIX_FEATURE_RULES: ReadonlyArray<{ prefix: string; featureKeys: readonly string[] }> = [
  { prefix: 'accounting.document.read_related', featureKeys: ['sales_documents'] },
  { prefix: 'accounting.revenue_category.', featureKeys: ['sales_documents'] },
  { prefix: 'expense.read_related', featureKeys: ['expenses.list'] },
  { prefix: 'procurement.purchase_request.read_related', featureKeys: ['procurement.purchase_requests'] },
  { prefix: 'procurement.purchase_order.read_related', featureKeys: ['procurement.purchase_orders'] },
  { prefix: 'procurement.goods_receipt.read_related', featureKeys: ['procurement.goods_receipts'] },
  { prefix: 'procurement.vendor_bill.read_related', featureKeys: ['procurement.vendor_bills'] },
  { prefix: 'procurement.supplier_payment.read_related', featureKeys: ['procurement.supplier_payments'] },
  { prefix: 'inventory.product.', featureKeys: ['product_catalog'] },
  { prefix: 'report.', featureKeys: ['reports'] },
  { prefix: 'reimbursement.', featureKeys: ['reimbursement'] },
  { prefix: 'dashboard.', featureKeys: ['dashboard_notifications'] },
  { prefix: 'notification.', featureKeys: ['dashboard_notifications'] },
  { prefix: 'crm.channel.', featureKeys: ['line_oa'] },
  { prefix: 'crm.ai.', featureKeys: ['ai_line_assistant'] },
  { prefix: 'crm.', featureKeys: ['crm'] },
  { prefix: 'ai.suggestion.', featureKeys: ['ai_line_assistant'] },
  { prefix: 'ai.draft.', featureKeys: ['ai_line_assistant'] },
];

// Reports is the first family with an explicit retained-artifact path. These permissions only let
// the request reach the reports use case; when the entitlement is OFF, that use case additionally
// requires report.snapshot.read, exact owner/role authority, current source visibility and an
// unexpired stored artifact. Every computation/mutation still calls assertFeatureEnabled first.
const RETAINED_REPORT_PERMISSIONS = new Set<string>([
  REPORT_PERMISSION_KEYS.VIEW_READ,
  REPORT_PERMISSION_KEYS.SNAPSHOT_READ,
  REPORT_PERMISSION_KEYS.EXPORT_READ_OWN,
  REPORT_PERMISSION_KEYS.EXPORT_MANAGE,
  REPORT_PERMISSION_KEYS.AUDIT_READ,
]);

// Reimbursement runoff (owner decision 2026-08-10, launch matrix §6.3 r5): disabling the
// feature blocks NEW claims but in-flight work keeps flowing — reads, approve/reject,
// finance review, payout/void and duplicate resolution stay alive. create/submit/draft-edit
// stay stripped, so nothing new can enter the pipe; everything still approvable is therefore
// pre-cutoff by construction and no per-row generation vector is needed.
const RETAINED_REIMBURSEMENT_PERMISSIONS = new Set<string>([
  'reimbursement.read',
  'reimbursement.read_own',
  'reimbursement.read_related',
  'reimbursement.approve',
  'reimbursement.reject',
  'reimbursement.finance_review',
  'reimbursement.payment.record',
  'reimbursement.payment.void',
  'reimbursement.duplicate.resolve',
]);

let index: { gatedFeaturesByPermission: Map<string, string[]>; ungatedPermissions: Set<string> } | null = null;

function permissionFeatureIndex() {
  if (index) return index;
  const gatedFeaturesByPermission = new Map<string, string[]>();
  const ungatedPermissions = new Set<string>();
  for (const pack of CAPABILITY_PACKS) {
    for (const permission of pack.permissionKeys) {
      if (!pack.featureEntitlementKey) {
        ungatedPermissions.add(permission);
        continue;
      }
      const features = gatedFeaturesByPermission.get(permission) ?? [];
      if (!features.includes(pack.featureEntitlementKey)) features.push(pack.featureEntitlementKey);
      gatedFeaturesByPermission.set(permission, features);
    }
  }
  index = { gatedFeaturesByPermission, ungatedPermissions };
  return index;
}

/** entitled === null means the company has no entitlement rows at all: legacy fail-open,
 *  same convention as loadEntitledFeatureKeys. */
export function filterPermissionsByEntitlement(permissions: string[], entitled: Set<string> | null): string[] {
  if (entitled === null) return permissions;
  return permissions.filter((permission) => featureKeyDeniedByEntitlement(permission, entitled) === undefined);
}

/** Returns the exact feature key that removed an otherwise-granted permission. */
export function featureKeyDeniedByEntitlement(permission: string, entitled: Set<string> | null): string | undefined {
  if (entitled === null) return undefined;
  const { gatedFeaturesByPermission, ungatedPermissions } = permissionFeatureIndex();
  const subfeature = SUBFEATURE_RULES.find((rule) => rule.permissionKeys.includes(permission));
  if (subfeature && !entitled.has(subfeature.parentKey)) return subfeature.parentKey;
  if (subfeature && !entitled.has(subfeature.key)) return subfeature.key;
  if (RETAINED_REPORT_PERMISSIONS.has(permission)) return undefined;
  if (RETAINED_REIMBURSEMENT_PERMISSIONS.has(permission)) return undefined;
  const rule = PREFIX_FEATURE_RULES.find((candidate) => permission.startsWith(candidate.prefix));
  if (rule && !rule.featureKeys.some((featureKey) => entitled.has(featureKey))) return rule.featureKeys[0];
  if (rule || ungatedPermissions.has(permission)) return undefined;
  const features = gatedFeaturesByPermission.get(permission);
  if (features && !features.some((featureKey) => entitled.has(featureKey))) return features[0];
  return undefined;
}
