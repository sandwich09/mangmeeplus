import type { AccountMergeCompanyOutcomeDto } from '@watchdog-bms/contracts';

/**
 * Review R05: what a merge would do to each shop, decided before anything is written.
 *
 * The rule the merge used to follow was "if the target is already a member here, disable the source
 * row" — with no look at the roles on either side and no look at whether the target's own membership
 * is even active. An owner merging into an account that happens to be an employee of the same shop
 * therefore ended up as that employee, and the shop lost its only owner. There is no safe automatic
 * answer to "which of these two role sets should win", so this fails closed and asks a human.
 */
export const OWNER_ROLE_KEY = 'OWNER';

export type MergeMembershipView = {
  companyId: string;
  companyName: string;
  status: string;
  roleKeys: readonly string[];
};

export type MergeCompanyPlan = AccountMergeCompanyOutcomeDto & { companyId: string };

/**
 * `source` is the ACTIVE memberships of the account being merged away; `target` is every membership
 * the surviving account holds in those same companies, in any status.
 */
export function planAccountMerge(
  source: readonly MergeMembershipView[],
  target: readonly MergeMembershipView[],
): MergeCompanyPlan[] {
  const targetByCompany = new Map(target.map((membership) => [membership.companyId, membership]));

  return source.map((membership) => {
    const base = { companyId: membership.companyId, companyName: membership.companyName };
    const counterpart = targetByCompany.get(membership.companyId);
    // No overlap: the membership row itself changes owner, so its roles and branch scopes ride along
    // and the shop keeps exactly the access it had.
    if (!counterpart) return { ...base, outcome: 'move' as const };
    // The survivor's own row is the one that would be kept, and a row that is not ACTIVE is not
    // access — merging into it would leave this person locked out of a shop they can use today.
    if (counterpart.status !== 'ACTIVE') {
      return { ...base, outcome: 'blocked' as const, reason: 'target_membership_inactive' as const };
    }
    // The invariant, checked on its own so it survives any later change to the role rule below:
    // a shop this merge touches must still have an ACTIVE owner when it is done.
    if (hasOwner(membership) && !hasOwner(counterpart)) {
      return { ...base, outcome: 'blocked' as const, reason: 'last_active_owner' as const };
    }
    if (!sameRoles(membership, counterpart)) {
      return { ...base, outcome: 'blocked' as const, reason: 'role_conflict' as const };
    }
    // Identical, active access on both sides: @@unique([companyId, userId]) forbids two rows, so the
    // duplicate is closed rather than moved, and nothing about the shop changes.
    return { ...base, outcome: 'close_duplicate' as const };
  });
}

const hasOwner = (membership: MergeMembershipView) => membership.roleKeys.includes(OWNER_ROLE_KEY);

function sameRoles(a: MergeMembershipView, b: MergeMembershipView): boolean {
  const left = [...new Set(a.roleKeys)].sort();
  const right = [...new Set(b.roleKeys)].sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}
