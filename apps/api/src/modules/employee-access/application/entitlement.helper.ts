import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../../common/database/prisma.service';
import {
  FEATURE_CATALOG,
  LEGACY_FEATURE_INHERITANCE,
  PLATFORM_INVARIANT_FEATURE_KEYS,
} from '@watchdog-bms/contracts';

/** Purchased availability is missing. Feature absence is never a 400 (spec:333). */
export const FEATURE_NOT_ENABLED = 'feature_not_enabled';
/**
 * Purchased, but its launch route is closed right now — a DISTINCT state from "not purchased"
 * (spec:65). Web must never render this as "ไม่ได้ซื้อ". Thrown by the CC1 launch-gate guard.
 */
export const FEATURE_TEMPORARILY_UNAVAILABLE = 'feature_temporarily_unavailable';

/**
 * The entitlement error contract (spec:333). `entitled === null` is the legacy fail-open
 * sentinel from `loadEntitledFeatureKeys` and passes, exactly like the evaluator's own reads.
 */
export function assertFeatureEnabled(entitled: ReadonlySet<string> | null, featureKey: string): void {
  if (entitled === null || entitled.has(featureKey)) return;
  throw new ForbiddenException({ code: FEATURE_NOT_ENABLED, featureKey });
}

/** The purchased-but-launch-gate-closed error. Consumed by the CC1 availability guard. */
export function featureTemporarilyUnavailable(featureKey: string): ForbiddenException {
  return new ForbiddenException({ code: FEATURE_TEMPORARILY_UNAVAILABLE, featureKey });
}

/** One stored `CompanyFeatureEntitlement` row, as the evaluator reads it. */
export type StoredEntitlementRow = { featureKey: string; enabled: boolean };

// THE canonical entitlement evaluator. Everything that needs to know what a company can actually
// do at runtime — the permission resolver AND the partner entitlement command's before-state —
// goes through this one function, so a refusal decision can never disagree with runtime truth.
// Returns null when the company has no entitlement config at all (legacy companies); null means
// "treat every feature as entitled".
// ponytail: fail-open when unconfigured; the real security boundary is the permission grant + guard,
// not this plan-visibility layer. Tighten to deny-by-default once every company is guaranteed to have
// entitlement rows seeded at onboarding.
export function evaluateEntitledFeatureKeys(rows: readonly StoredEntitlementRow[]): Set<string> | null {
  if (rows.length === 0) return null;
  const entitled = new Set(rows.filter((row) => row.enabled).map((row) => row.featureKey));
  const explicit = new Map(rows.map((row) => [row.featureKey, row.enabled]));
  // Platform baseline keys (spec:262): absent row = on. An explicit `false` still wins HERE, and
  // deliberately so — four feature-gate tests pin that an operator who disabled company_settings
  // really loses its permissions. SetPartnerFeaturesUseCase now refuses to WRITE such a row, so
  // no new one can appear; normalizing the rows that already exist is CC7/F2 work with its own
  // owner decision, not a silent read-time widening here.
  for (const featureKey of PLATFORM_INVARIANT_FEATURE_KEYS) {
    if (explicit.get(featureKey) !== false) entitled.add(featureKey);
  }
  for (const [featureKey, legacyFeatureKeys] of Object.entries(LEGACY_FEATURE_INHERITANCE)) {
    if (!explicit.has(featureKey) && legacyFeatureKeys.some((legacyKey) => entitled.has(legacyKey))) {
      entitled.add(featureKey);
    }
  }
  for (const feature of FEATURE_CATALOG) {
    for (const submenu of feature.submenus) {
      if (entitled.has(feature.key) && explicit.get(submenu.key) !== false) entitled.add(submenu.key);
    }
  }
  return entitled;
}

/** The evaluator over this company's stored rows. Same semantics, one database read. */
export async function loadEntitledFeatureKeys(prisma: PrismaService, companyId: string): Promise<Set<string> | null> {
  return evaluateEntitledFeatureKeys(
    await prisma.client.companyFeatureEntitlement.findMany({
      where: { companyId },
      select: { featureKey: true, enabled: true },
    }),
  );
}
