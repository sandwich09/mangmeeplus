// P12-0 (LINE Login journey spec §4.2): pure classification for the read-only
// canonical-identity inventory. No I/O, no mutation — the mutating backfill
// (batch id + before/after checksums) is a later P12 slice.

export type LineIdentityClass = 'AUTO_REUSE' | 'BACKFILL' | 'CONFLICT' | 'DENY_REVIEW';

export interface LineIdentityRow {
  id: string;
  userId: string;
  providerUserId: string;
  providerChannelId: string;
  status: string;
  userStatus: string;
  activeMembershipCompanyIds: readonly string[];
}

export interface LineCompanyContextRow {
  lineUserId: string;
  companyId: string;
}

export interface LineIdentityInventoryEntry {
  identityId: string;
  userId: string;
  maskedLineUserId: string;
  providerChannelId: string;
  classification: LineIdentityClass;
  reasons: string[];
}

export interface LineContextFinding {
  maskedLineUserId: string;
  companyId: string;
  reason: 'orphan_context' | 'stale_company_context';
}

export interface LineIdentityInventoryReport {
  canonicalChannelId: string;
  totalRows: number;
  inactiveRows: number;
  entries: LineIdentityInventoryEntry[];
  contextFindings: LineContextFinding[];
  summary: Record<LineIdentityClass, number>;
}

/** Masked identifier for reports: never the full provider user id. */
export function maskLineUserId(raw: string): string {
  if (raw.length <= 9) return `${raw.slice(0, 2)}…`;
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
}

/**
 * Classify every ACTIVE LINE identity row against the canonical messaging
 * channel. Non-ACTIVE rows are never classified (they cannot log in) but they
 * still influence their group: an UNLINKED row can hold the canonical unique
 * slot, and any second user in a group makes the whole LINE account CONFLICT.
 */
export function classifyLineIdentityInventory(input: {
  canonicalChannelId: string;
  identities: readonly LineIdentityRow[];
  contexts: readonly LineCompanyContextRow[];
}): LineIdentityInventoryReport {
  const { canonicalChannelId, identities, contexts } = input;

  const byLineUserId = new Map<string, LineIdentityRow[]>();
  for (const row of identities) {
    const group = byLineUserId.get(row.providerUserId) ?? [];
    group.push(row);
    byLineUserId.set(row.providerUserId, group);
  }

  const entries: LineIdentityInventoryEntry[] = [];
  for (const row of identities) {
    if (row.status !== 'ACTIVE') continue;
    const group = byLineUserId.get(row.providerUserId) ?? [row];
    const distinctUsers = new Set(group.map((r) => r.userId));
    const reasons: string[] = [];
    let classification: LineIdentityClass;

    if (distinctUsers.size > 1) {
      // Different-user conflicts never auto-merge (spec §4.3).
      classification = 'CONFLICT';
      reasons.push(`line_account_mapped_to_${distinctUsers.size}_users`);
    } else if (row.userStatus !== 'ACTIVE') {
      classification = 'DENY_REVIEW';
      reasons.push(`user_status_${row.userStatus.toLowerCase()}`);
    } else if (row.activeMembershipCompanyIds.length === 0) {
      classification = 'DENY_REVIEW';
      reasons.push('no_active_membership');
    } else if (row.providerChannelId === canonicalChannelId) {
      const activeSiblings = group.filter((r) => r.id !== row.id && r.status === 'ACTIVE');
      if (activeSiblings.length > 0) {
        classification = 'BACKFILL';
        reasons.push('duplicate_active_rows_same_user');
      } else {
        classification = 'AUTO_REUSE';
        if (group.length > 1) reasons.push('inactive_sibling_rows');
      }
    } else {
      classification = 'BACKFILL';
      const canonicalSibling = group.find((r) => r.id !== row.id && r.providerChannelId === canonicalChannelId);
      if (canonicalSibling?.status === 'ACTIVE') reasons.push('legacy_duplicate_of_canonical');
      else if (canonicalSibling) reasons.push('canonical_slot_held_by_inactive_row');
      else reasons.push('legacy_channel');
    }

    entries.push({
      identityId: row.id,
      userId: row.userId,
      maskedLineUserId: maskLineUserId(row.providerUserId),
      providerChannelId: row.providerChannelId,
      classification,
      reasons,
    });
  }

  const activeByLineUserId = new Map<string, LineIdentityRow[]>();
  for (const row of identities) {
    if (row.status !== 'ACTIVE') continue;
    const list = activeByLineUserId.get(row.providerUserId) ?? [];
    list.push(row);
    activeByLineUserId.set(row.providerUserId, list);
  }

  const contextFindings: LineContextFinding[] = [];
  for (const context of contexts) {
    const activeRows = activeByLineUserId.get(context.lineUserId);
    if (!activeRows || activeRows.length === 0) {
      contextFindings.push({
        maskedLineUserId: maskLineUserId(context.lineUserId),
        companyId: context.companyId,
        reason: 'orphan_context',
      });
      continue;
    }
    const memberOfContextCompany = activeRows.some((r) => r.activeMembershipCompanyIds.includes(context.companyId));
    if (!memberOfContextCompany) {
      contextFindings.push({
        maskedLineUserId: maskLineUserId(context.lineUserId),
        companyId: context.companyId,
        reason: 'stale_company_context',
      });
    }
  }

  const summary: Record<LineIdentityClass, number> = { AUTO_REUSE: 0, BACKFILL: 0, CONFLICT: 0, DENY_REVIEW: 0 };
  for (const entry of entries) summary[entry.classification] += 1;

  return {
    canonicalChannelId,
    totalRows: identities.length,
    inactiveRows: identities.filter((r) => r.status !== 'ACTIVE').length,
    entries,
    contextFindings,
    summary,
  };
}

/** CONFLICT rows lacking a recorded disposition — the non-zero-exit driver (spec §4.2). */
export function undispositionedConflicts(
  report: LineIdentityInventoryReport,
  dispositionedIdentityIds: readonly string[],
): LineIdentityInventoryEntry[] {
  const acknowledged = new Set(dispositionedIdentityIds);
  return report.entries.filter((e) => e.classification === 'CONFLICT' && !acknowledged.has(e.identityId));
}
