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
import { REIMBURSEMENT_SELF_SERVICE_PERMISSIONS } from '../../../auth/permission-registry';

export type CompanyRoleBackfill = {
  key: string;
  anchor: string | null;
  why: string;
};

export const COMPANY_ROLE_BACKFILLS: readonly CompanyRoleBackfill[] = [
  ...REIMBURSEMENT_SELF_SERVICE_PERMISSIONS.map((key) => ({
    key,
    anchor: null,
    why: 'Every company-member role has own reimbursement self-service (2026-08-27), including '
      + 'old custom/read-only roles. Branch selection and receipt upload/read are prerequisites; '
      + 'feature entitlement, requester/branch scope and approval/payment checks remain separate.',
  })),
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
    key: 'expense.read_related',
    anchor: null,
    why: 'Expense, payment and substitute-receipt actors must retain view-only access to the '
      + 'tenant/branch-scoped records they participated in. The expenses entitlement strips the '
      + 'key when the feature is off; mutation permissions and lifecycle checks remain separate.',
  },
  {
    key: 'reimbursement.read_related',
    anchor: null,
    why: 'Requester, approver, reviewer, payment, signature and linked-document actors retain '
      + 'view-only access to tenant/branch-scoped reimbursement records. The reimbursement '
      + 'entitlement still strips this key, and no mutation permission is implied.',
  },
  ...[
    'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
    'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related',
    'procurement.supplier_payment.read_related',
  ].map((key) => ({
    key,
    anchor: null,
    why: 'Persisted actors retain view-only access to their tenant/branch-scoped procurement chain. '
      + 'The exact document feature entitlement strips this key, while supplier master/bank details '
      + 'and every mutation remain separately authorized.',
  })),
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
    key: 'expense.signature.self_manage',
    anchor: 'expense.create',
    why: 'Personal signatures joined pack.expense.self. Existing custom roles that can create their '
      + 'own expense drafts receive only owner-scoped signature access; read-only and reviewer-only '
      + 'roles are not widened.',
  },
  ...['reimbursement.payment.record', 'reimbursement.payment.void'].map((key) => ({
    key,
    anchor: 'reimbursement.approve',
    why: 'Owner decision 2026-10-01 (payout-account spec §13.3 F1): whoever approves a claim can record its '
      + 'payment and void a payment recorded by mistake. pack.reimbursement.approve has granted both keys since '
      + '2026-09-21, but a custom role, or a system role the company edited, saved before that still approves '
      + 'without them, so its claims stopped at จ่ายเงินคืน. Anchored on reimbursement.approve, which only that pack '
      + 'grants (asserted in capability.logic.spec.ts). HIGH/CRITICAL: each grant writes an audit row in the '
      + 'role\'s company. A role that keeps reimbursement.approve gets them back on the next deploy if removed.',
  })),
  {
    key: 'report.snapshot.read',
    anchor: 'report.query.run',
    why: 'Reports safe-OFF separates exact retained run/view/export reads from new computation. '
      + 'Existing custom report roles already holding report.query.run need the narrow snapshot '
      + 'authority so their own pre-disable history does not disappear.',
  },
];
