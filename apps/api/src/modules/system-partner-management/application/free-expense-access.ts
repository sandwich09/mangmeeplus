import { isBranchInScope } from '../../data-model-core/domain/logic/branch.logic';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { evaluateEntitledFeatureKeys } from '../../employee-access/application/entitlement.helper';
import { filterPermissionsByEntitlement } from '../../employee-access/domain/logic/feature-gate.logic';
import type { Prisma } from '../../../generated/prisma/client';

type FreeExpenseDb = Pick<Prisma.TransactionClient, 'company' | 'billingAccount' | 'billingInvoice' | 'billingReceiptGrant' | 'packageChangeRequest' | 'salesAttribution' | 'auditLog'>;

/** Derived access only: never changes lifecycle, terms, entitlements or purchased balances. */
export async function isFreeExpenseDraftCompany(db: FreeExpenseDb, companyId: string, now = new Date()): Promise<boolean> {
  try {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { status: true, disabledAt: true, archivedAt: true, planTerm: true },
    });
    const term = company?.planTerm;
    if (!company || company.archivedAt || !term || term.tierKey !== 'FREE_TRIAL_15'
      || term.termEndsAt > now || term.billingReceiptAccountId || term.capacityOverride
      || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && term.termDisabledAt))) return false;

    if (company.status === 'DISABLED') {
      const lifecycle = await db.auditLog.findFirst({ where: {
        targetType: 'company', targetId: companyId, action: 'system.partner_company.lifecycle.transition', result: 'SUCCESS',
      }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { actorUserId: true, metadataJson: true } });
      const metadata = lifecycle?.metadataJson as Record<string, unknown> | null;
      if (!company.disabledAt || !lifecycle || lifecycle.actorUserId !== null || metadata?.toStatus !== 'DISABLED'
        || !['no_package', 'term_expired'].includes(String(metadata.reason))) return false;
    }

    // Every historical provider account matters, including an old test/live/payment mode.
    // A cleared/refunded current mapping cannot erase evidence of a purchase or pending recovery.
    const accounts = await db.billingAccount.findMany({ where: { companyId }, select: {
      id: true, baseSubscriptionId: true, contractAttemptId: true, activeAttemptId: true,
      paidThrough: true, renewalMode: true, subscriptionState: true, termProjectionHash: true,
    } });
    if (accounts.some((account) => account.baseSubscriptionId || account.contractAttemptId || account.activeAttemptId
      || account.paidThrough || account.termProjectionHash || account.renewalMode !== 'NONE' || account.subscriptionState !== 'NONE')) return false;
    const [invoice, grant, request, attribution] = await Promise.all([
      db.billingInvoice.findFirst({ where: { billingAccountId: { in: accounts.map((account) => account.id) },
        OR: [{ paidSatang: { gt: 0 } }, { refundedSatang: { gt: 0 } }, { disputed: true }, { providerStatus: 'paid' }, { appliedAt: { not: null } }, { applyStatus: { not: 'PENDING' } }] }, select: { id: true } }),
      db.billingReceiptGrant.findFirst({ where: { companyId, OR: [
        { billingAccountId: { not: null } }, { kind: { not: 'ADMIN_ADJUSTMENT' } },
        { kind: 'ADMIN_ADJUSTMENT', revokedAt: null, availableAt: { lte: now }, expiresAt: { gt: now } },
      ] }, select: { id: true } }),
      db.packageChangeRequest.findFirst({ where: { companyId, OR: [
        { verifiedAt: { not: null } }, { paymentRef: { not: null } }, { slipAttachmentId: { not: null } },
        { status: { in: ['APPLIED', 'PAID'] } }, { paymentState: { notIn: ['NONE', 'CATALOG_SUPERSEDED'] } },
      ] }, select: { id: true } }),
      db.salesAttribution.findUnique({ where: { companyId }, select: { id: true } }),
    ]);
    return !invoice && !grant && !request && !attribution;
  } catch {
    // Missing/unavailable historical evidence must never turn paid recovery into free access.
    throw new ServiceUnavailableException({ code: 'FREE_EXPENSE_ACCESS_UNAVAILABLE', message: 'ไม่สามารถตรวจสอบสิทธิ์ร้านได้ในขณะนี้ กรุณาลองใหม่' });
  }
}

const FREE_EXPENSE_PERMISSIONS = new Set([
  'account.session.read', 'account.password.change', 'company.plan.manage',
  'company.setup.read', 'company.legal_identity.manage', 'company.vat_registration.read', 'company.vat_registration.manage',
  'company.branch.read', 'expense.read', 'expense.read_own', 'expense.read_related',
  'expense.update', 'expense.receipt.upload', 'expense.receipt.line_upload', 'expense.ocr.request',
  'attachment.read', 'attachment.create',
]);

/** Intersect existing grants; never grants review/confirm/create or other business capabilities. */
export function freeExpenseDraftPermissions(permissions: readonly string[]): string[] {
  return permissions.filter((permission) => FREE_EXPENSE_PERMISSIONS.has(permission));
}

/** Exact HTTP actions; record ownership, draft state and attachment purpose remain use-case gates. */
export function isFreeExpenseDraftRoute(method: string, path: string): boolean {
  const clean = (path.split('?')[0] ?? '').replace(/\/$/, '');
  const base = '/v1/companies/[^/]+';
  const expense = `${base}/expenses`;
  if (new RegExp(`^${expense}/(?:shared-evidence|accountant-package)$`).test(clean)) return false;
  if (method === 'GET') return new RegExp(`^${base}/(?:branches|expense-categories|identity|vat-registration|settings/address-master)$`).test(clean)
    || new RegExp(`^${expense}(?:/(?:capture-policy|capture-capability|capture-groups(?:/[^/]+(?:/read-status)?)?|[^/]+(?:/read-status)?))?$`).test(clean)
    || new RegExp(`^${base}/attachments/[^/]+/download-url$`).test(clean);
  if (method === 'PATCH') return new RegExp(`^${expense}/[^/]+$`).test(clean);
  if (method !== 'POST') return false;
  return new RegExp(`^${expense}/(?:receipt-uploads|capture-groups|capture-groups/[^/]+/(?:files(?:/[^/]+/(?:complete|detach))?|facts)|[^/]+/(?:totals-preview|extraction-request|receipt-uploads/[^/]+/complete))$`).test(clean)
    || new RegExp(`^${base}/attachments/upload-intent$`).test(clean);
}


/** Recheck the originating actor inside source persistence; an upgrade never broadens this write. */
export async function assertFreeExpenseSourceActor(
  db: FreeExpenseDb & Pick<Prisma.TransactionClient, 'companyMembership' | 'companyFeatureEntitlement' | 'branch'>,
  input: { companyId: string; userId: string; branchId?: string | null },
): Promise<void> {
  const free = await isFreeExpenseDraftCompany(db, input.companyId);
  if (!free) {
    const company = await db.company.findUnique({ where: { id: input.companyId }, select: { status: true, archivedAt: true, planTerm: { select: { termEndsAt: true, termDisabledAt: true } } } });
    if (!company || company.status !== 'ACTIVE' || company.archivedAt || company.planTerm && (company.planTerm.termDisabledAt || company.planTerm.termEndsAt <= new Date())) {
      throw new ForbiddenException({ code: 'FREE_EXPENSE_SOURCE_ACCESS_REVOKED' });
    }
  }
  const member = await db.companyMembership.findFirst({ where: { companyId: input.companyId, userId: input.userId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
    select: { branchScopeMode: true, defaultBranchId: true, branchScopes: { select: { branchId: true } },
      roles: { where: { role: { status: 'ACTIVE' } }, select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } } } });
  if (!member) throw new ForbiddenException({ code: 'FREE_EXPENSE_SOURCE_ACCESS_REVOKED' });
  const selectedIds = member.branchScopeMode === 'DEFAULT_BRANCH_ONLY'
    ? [member.defaultBranchId].filter((id): id is string => Boolean(id)) : member.branchScopes.map(scope => scope.branchId);
  const activeScopedBranches = member.branchScopeMode === 'ALL_BRANCHES' ? undefined
    : await db.branch.findMany({ where: { companyId: input.companyId, status: 'ACTIVE', id: { in: selectedIds } }, select: { id: true } });
  const branch = !input.branchId || await db.branch.findFirst({ where: { id: input.branchId, companyId: input.companyId, status: 'ACTIVE' }, select: { id: true } });
  if (activeScopedBranches && activeScopedBranches.length === 0 || !branch
    || !isBranchInScope({ branchIds: activeScopedBranches?.map(row => row.id) }, input.branchId)) {
    throw new ForbiddenException({ code: 'FREE_EXPENSE_SOURCE_ACCESS_REVOKED' });
  }
  const entitled = evaluateEntitledFeatureKeys(await db.companyFeatureEntitlement.findMany({ where: { companyId: input.companyId }, select: { featureKey: true, enabled: true } }));
  const permissions = filterPermissionsByEntitlement(member.roles.flatMap(link => link.role.permissions.map(grant => grant.permission.key)), entitled);
  if (!['expense.receipt.upload', 'expense.receipt.line_upload', 'expense.ocr.request'].some(permission => permissions.includes(permission))) {
    throw new ForbiddenException({ code: 'FREE_EXPENSE_SOURCE_ACCESS_REVOKED' });
  }
}
