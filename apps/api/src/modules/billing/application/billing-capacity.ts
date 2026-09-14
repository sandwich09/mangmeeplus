import { BadRequestException } from '@nestjs/common';
import type { BillingCapacityImpact, BillingCapacityOptions, BillingCapacitySelection, BillingOffer } from '@watchdog-bms/contracts';
import type { BillingAttempt, Prisma } from '../../../generated/prisma/client';
import { PLATFORM_SEAT_EXEMPT_ROLE } from '../../system-partner-management/application/plan-term-limit';
import { billingError, hashBilling } from '../domain/billing-policy';
import type { BillingSnapshot } from './billing.service';

const settled = ['PAID', 'REJECTED', 'CANCELLED', 'VOIDED'] as const;
export const capacityReview = () => billingError('BILLING_CAP_SELECTION_REQUIRED', 'กรุณาตรวจและเลือกสาขากับผู้ใช้ที่จะคงสิทธิ์ก่อนยืนยัน');
const exactKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;

export function parseCapacitySelection(value: unknown): BillingCapacitySelection {
  if (!exactKeys(value, ['sourceHash', 'branchIds', 'memberships']) || typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash) ||
    !Array.isArray(value.branchIds) || value.branchIds.length > 1000 || !value.branchIds.every(id) ||
    !Array.isArray(value.memberships) || value.memberships.length > 1000 || !value.memberships.every(m => exactKeys(m, ['id', 'defaultBranchId']) && id(m.id) && (m.defaultBranchId === null || id(m.defaultBranchId))))
    throw new BadRequestException('Invalid retained-resource selection');
  const selection = value as unknown as BillingCapacitySelection;
  if (new Set(selection.branchIds).size !== selection.branchIds.length || new Set(selection.memberships.map(m => m.id)).size !== selection.memberships.length)
    throw new BadRequestException('Duplicate retained resource');
  return { sourceHash: selection.sourceHash, branchIds: [...selection.branchIds].sort(), memberships: [...selection.memberships].sort((a,b) => a.id.localeCompare(b.id)) };
}

/** Call under the Company lock when accepting/applying a selection. No inactive resource is reactivated. */
export async function capacityOptions(tx: Prisma.TransactionClient, companyId: string, offer: BillingOffer): Promise<BillingCapacityOptions> {
  const branches = await tx.branch.findMany({ where: { companyId, status: 'ACTIVE' }, orderBy: { id: 'asc' },
    select: { id: true, name: true, type: true, taxBranchCode: true, updatedAt: true } });
  const members = await tx.companyMembership.findMany({ where: { companyId, status: 'ACTIVE', roles: { none: { role: PLATFORM_SEAT_EXEMPT_ROLE } } }, orderBy: { id: 'asc' },
    include: { user: { select: { displayName: true, status: true } }, employeeAccessProfile: { select: { id: true, displayName: true, status: true, updatedAt: true } },
      roles: { include: { role: true }, orderBy: { roleId: 'asc' } }, branchScopes: { orderBy: { branchId: 'asc' }, select: { branchId: true } } } });
  const requests = await tx.reimbursementRequest.findMany({ where: { companyId, status: { notIn: [...settled] } }, orderBy: { id: 'asc' },
    select: { id: true, branchId: true, requesterUserId: true, currentApproverUserId: true, status: true } });
  const headOffices = branches.filter(b => b.type === 'HEAD_OFFICE');
  const sourceHash = hashBilling([companyId, offer.offerKey, offer.interval, offer.branchLimit, offer.employeeLimit, branches,
    members.map(m => [m.id, m.userId, m.updatedAt, m.defaultBranchId, m.branchScopeMode, m.branchScopes, m.user.status, m.employeeAccessProfile,
      m.roles.map(r => [r.role.id, r.role.key, r.role.status, r.role.isSystem, r.role.scopeKey, r.role.companyId, r.role.updatedAt])]), requests]);
  return { companyId, offerKey: offer.offerKey, interval: offer.interval, sourceHash, branchLimit: offer.branchLimit, employeeLimit: offer.employeeLimit,
    overCapacity: branches.length > offer.branchLimit || members.length > offer.employeeLimit,
    branches: branches.map(b => { const openReimbursements = requests.filter(r => r.branchId === b.id).length;
      return { id: b.id, name: b.name, headOffice: b.type === 'HEAD_OFFICE', required: (b.type === 'HEAD_OFFICE' && headOffices.length === 1) || openReimbursements > 0, openReimbursements }; }),
    memberships: members.map(m => { const owner = m.roles.some(r => r.role.key === 'OWNER' && r.role.status === 'ACTIVE');
      return { id: m.id, name: m.employeeAccessProfile?.displayName ?? m.user.displayName ?? 'สมาชิก', owner,
        required: owner || requests.some(r => r.requesterUserId === m.userId || r.currentApproverUserId === m.userId),
        allBranches: m.branchScopeMode === 'ALL_BRANCHES', branchIds: m.branchScopeMode === 'DEFAULT_BRANCH_ONLY' ? (m.defaultBranchId ? [m.defaultBranchId] : []) : m.branchScopes.map(s => s.branchId), defaultBranchId: m.defaultBranchId }; }) };
}

export function capacityValid(options: BillingCapacityOptions, selection: BillingCapacitySelection): boolean {
  const branches = new Set(selection.branchIds), members = new Map(selection.memberships.map(m => [m.id, m]));
  if (options.sourceHash !== selection.sourceHash || branches.size !== selection.branchIds.length || members.size !== selection.memberships.length ||
    branches.size < 1 || branches.size > options.branchLimit || members.size < 1 || members.size > options.employeeLimit ||
    selection.branchIds.some(id => !options.branches.some(b => b.id === id)) || selection.memberships.some(m => !options.memberships.some(o => o.id === m.id)) ||
    options.branches.some(b => b.required && !branches.has(b.id)) || options.memberships.some(m => m.required && !members.has(m.id)) ||
    !options.branches.some(b => b.headOffice && branches.has(b.id)) || !options.memberships.some(m => m.owner && members.has(m.id))) return false;
  return options.memberships.every(member => {
    const chosen = members.get(member.id); if (!chosen) return true;
    const allowed = member.allBranches ? selection.branchIds : member.branchIds.filter(id => branches.has(id));
    return allowed.length > 0 && (chosen.defaultBranchId === null ? member.allBranches : allowed.includes(chosen.defaultBranchId));
  });
}

export function capacityImpact(options: BillingCapacityOptions, selection: BillingCapacitySelection): BillingCapacityImpact {
  return { retainedBranches: options.branches.filter(b => selection.branchIds.includes(b.id)).map(b => b.name),
    suspendedBranches: options.branches.filter(b => !selection.branchIds.includes(b.id)).map(b => b.name),
    retainedMembers: options.memberships.filter(m => selection.memberships.some(s => s.id === m.id)).map(m => m.name),
    suspendedMembers: options.memberships.filter(m => !selection.memberships.some(s => s.id === m.id)).map(m => m.name),
    defaults: selection.memberships.map(s => ({ member: options.memberships.find(m => m.id === s.id)!.name,
      branch: options.branches.find(b => b.id === s.defaultBranchId)?.name ?? null })) };
}

export async function attemptCapacity(tx: Prisma.TransactionClient, accountId: string, attempt: Pick<BillingAttempt, 'id' | 'quoteSnapshot'>): Promise<BillingCapacitySelection | undefined> {
  const snapshot = attempt.quoteSnapshot as unknown as BillingSnapshot;
  const repair = await tx.billingOperation.findFirst({ where: { companyId: snapshot.quote.companyId, type: 'CUSTOMER_CAP_SELECTION_REPAIR', referenceId: attempt.id, state: 'SUCCEEDED' },
    orderBy: [{ sourceVersion: 'desc' }, { id: 'desc' }] });
  if (!repair) return snapshot.capacity;
  const proposed = repair.proposedJson as unknown as { accountId: string; attemptId: string; offerHash: string; selection: BillingCapacitySelection };
  const account = await tx.billingAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (repair.stripeAccountId !== account.stripeAccountId || repair.livemode !== account.livemode || proposed.accountId !== accountId || proposed.attemptId !== attempt.id ||
    proposed.offerHash !== hashBilling(snapshot.quote.offer)) throw capacityReview();
  return parseCapacitySelection(proposed.selection);
}

/** Part of the paid invoice transaction, after all payment/security/source gates passed. */
export async function applyCapacity(tx: Prisma.TransactionClient, companyId: string, offer: BillingOffer, selection: BillingCapacitySelection, actorUserId: string, reference: string) {
  const options = await capacityOptions(tx, companyId, offer);
  if (!capacityValid(options, selection)) throw capacityReview();
  const branchIds = options.branches.filter(b => !selection.branchIds.includes(b.id)).map(b => b.id);
  const memberIds = options.memberships.filter(m => !selection.memberships.some(s => s.id === m.id)).map(m => m.id);
  await tx.branch.updateMany({ where: { companyId, id: { in: branchIds }, status: 'ACTIVE' }, data: { status: 'DISABLED', updatedByUserId: actorUserId } });
  await tx.companyMembership.updateMany({ where: { companyId, id: { in: memberIds }, status: 'ACTIVE' }, data: { status: 'SUSPENDED' } });
  await tx.employeeAccessProfile.updateMany({ where: { companyId, membershipId: { in: memberIds }, status: 'ACTIVE' }, data: { status: 'SUSPENDED', updatedByUserId: actorUserId } });
  for (const member of selection.memberships) await tx.companyMembership.update({ where: { id: member.id, companyId }, data: { defaultBranchId: member.defaultBranchId } });
  await tx.auditLog.create({ data: { companyId, actorUserId, action: 'billing.capacity.applied', targetType: 'BillingInvoice', targetId: reference,
    requestId: reference, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { sourceHash: selection.sourceHash, branchIds, membershipIds: memberIds,
      retained: selection as unknown as Prisma.InputJsonValue } } });
}
