// Additive backfills applied to company-scoped (custom) roles by prisma/sync-permissions.ts.
//
// Why this registry has to exist: a Role stores MATERIALIZED RolePermission rows and does not
// persist which capability packs produced it. So when a permission is added to a pack, every
// role created before that moment keeps its old permission list forever — there is nothing to
// recompile from. System roles are fine (ROLE_GRANTS is code-defined and re-synced every
// deploy); custom roles are not.
//
// `anchor` is the permission that proves a role was built from the same pack, so the grant lands
// only on roles that would have received the key had they been created today. `anchor: null`
// means universal — every company role gets it.
//
// These are never revoked. Removing an entry stops future backfills; it does not take the
// permission away from roles that already have it.
export type CompanyRoleBackfill = {
  key: string;
  anchor: string | null;
  why: string;
};

export const COMPANY_ROLE_BACKFILLS: readonly CompanyRoleBackfill[] = [
  {
    key: 'account.password.change',
    anchor: null,
    why: 'Universal self-service (pack.core.basics). Roles compiled before 2026-07-25 by a granter '
      + 'lacking the key are missing it and would brick the forced password change.',
  },
  {
    key: 'dashboard.read',
    anchor: null,
    why: 'The แดชบอร์ด menu was ungated until it began requiring dashboard.read. Existing custom '
      + 'roles without the key would lose a menu they could see yesterday — a regression guard, '
      + 'not a new capability. Universal because pack.core.basics grants it to everyone.',
  },
  {
    key: 'accounting.document.read_related',
    anchor: null,
    why: 'Related-record visibility is a universal, view-only ABAC path. The sales_documents '
      + 'entitlement still strips this key when the feature is off, and the accounting source '
      + 'returns nothing unless the caller is persisted as an actor in the tenant/branch graph.',
  },
  {
    key: 'expense.evidence.read',
    anchor: 'expense.read',
    why: 'หลักฐานทางบัญชี moved off expense.read onto its own key. Without this the evidence menu '
      + 'and tab disappear for every custom role that could see them yesterday — a regression, not '
      + 'a new feature. Anchored on expense.read because every pack granting it also grants the '
      + 'evidence key (asserted in capability.logic.spec.ts).',
  },
  {
    key: 'expense.delete',
    anchor: 'expense.void',
    why: 'Draft hard-delete was added to pack.expense.finance. Anchored on expense.void — its '
      + 'closest sibling in that same pack — so it reaches finance roles only, never a read-only '
      + 'or self-service role. This key is CRITICAL: it destroys a draft permanently (an audit row '
      + 'is always written in the same transaction).',
  },
  {
    key: 'report.snapshot.read',
    anchor: 'report.query.run',
    why: 'Reports safe-OFF separates exact retained run/view/export reads from new computation. '
      + 'Existing custom report roles already holding report.query.run need the narrow snapshot '
      + 'authority so their own pre-disable history does not disappear.',
  },
];
