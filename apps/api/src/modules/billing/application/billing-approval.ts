import type { BillingApprovalMode } from '@watchdog-bms/contracts';

type Access = { platformScope: boolean; capabilities: readonly string[] };
type Actors = { initiatorUserId: string; approverUserId: string | null };

// Single-admin confirmation never extends delegated billing authority.
export function canApproveBillingChange(access: Access, initiatorUserId: string, actorUserId: string, managePermission: string): boolean {
  return access.capabilities.includes('system.billing.approval.approve') &&
    (initiatorUserId !== actorUserId || (access.platformScope && access.capabilities.includes(managePermission)));
}

export function billingApprovalMode(row: Actors): BillingApprovalMode | null {
  return row.approverUserId === null ? null : row.approverUserId === row.initiatorUserId ? 'SINGLE_ADMIN' : 'SECOND_REVIEWER';
}
