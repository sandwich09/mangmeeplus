/**
 * RUNOFF_MATRIX coverage catalog — the aggregate projection of
 * `docs/specs/feature-entitlement-runoff-matrix.json` (spec:334, F0.B).
 *
 * ── OWNER DECISION 2026-08-04: FREEZE IN PLACE, SO THIS IS NO LONGER A GATE ────────────────────
 * "ควรปิดได้และหยุดทำงาน แต่ถ้ามีข้อมูลเดิมค้างก็แค่ปิดไว้ไม่บล็อค" — a post-onboarding disable of a sellable
 * family is ALLOWED and residual data may never block it: the feature stops working (surfaces
 * hidden, APIs deny honestly, LINE AI refuses) and existing rows stay stored, dormant and
 * untouched until a re-enable resumes where it froze. Nothing runs off, so there is nothing for a
 * per-surface runoff verdict to admit or refuse, and `runoffPreflight` / `IN_SCOPE_FAMILIES` /
 * the `GLOBAL_BLOCK` veto switch are deleted rather than left dormant. The two refusals that
 * remain are the platform invariants and the dependency cascade
 * (`set-partner-features.use-case.ts`).
 *
 * What survives is DOCUMENTATION, not enforcement: the per-family aggregate below, and
 * `RUNOFF_MATRIX_VERSION`, which every `RunoffSnapshot` still stamps so a later matrix revision
 * cannot reinterpret an old snapshot.
 *
 * Why a code copy instead of reading the JSON: the production image ships
 * `apps/api/{prisma,src}` only (apps/api/Dockerfile:27-36) — `docs/` is not in the image, so
 * nothing at runtime can read the doc. `runoff-matrix.catalog.spec.ts` re-derives every number
 * below from the doc on every test run, so a matrix edit that changes a BLOCKED count fails the
 * suite instead of shipping.
 *
 * Server-only on purpose: matrix internals (surface ids, evidence owners, BLOCKED reasons) are
 * internal control-plane facts and must never reach a customer, partner or AI surface (spec:58,
 * runbook §2.3), so this does NOT live in `packages/contracts` (which the web bundle imports).
 */

/** One feature family's coverage, aggregated over its rows in the approved RUNOFF_MATRIX. */
export type RunoffMatrixFeatureRow = {
  /** A top-level `FEATURE_CATALOG` key, or one of the 7 non-feature survey buckets. */
  featureKey: string;
  totalRows: number;
  /**
   * Rows the matrix could not decide (`runoffPolicy = BLOCKED`). Recorded coverage only since the
   * freeze-in-place decision: an undecided surface no longer refuses the family's disable, because
   * `enabled=false` stops every surface of it, decided or not.
   */
  blockedRows: number;
  /**
   * Rows with `runoffPolicy = PRE_CUTOFF_RUNOFF_ONLY` — the only policy that would have carried
   * work PAST a disable. Freeze-in-place grants no such continuation, so this is a count of what
   * the matrix once proposed, and `buildRunoffRoots` snapshots an empty root list for every family.
   */
  runoffRootRows: number;
};

/**
 * The `generated` stamp of the matrix these aggregates came from. Recorded into every
 * `RunoffSnapshot.rootsJson` so a later matrix revision can never reinterpret an old snapshot
 * (the locked-decision-4 principle: policy is stamped into the work, not looked up afterwards).
 */
export const RUNOFF_MATRIX_VERSION = '2026-08-02';

/**
 * Aggregated from `docs/specs/feature-entitlement-runoff-matrix.json` (744 rows → 25 families).
 * Sorted by `featureKey`; the drift spec compares the whole array.
 */
export const RUNOFF_MATRIX_FEATURES: readonly RunoffMatrixFeatureRow[] = [
  { featureKey: 'AI_GATEWAY_PLANE', totalRows: 24, blockedRows: 24, runoffRootRows: 0 },
  { featureKey: 'ai_line_assistant', totalRows: 28, blockedRows: 0, runoffRootRows: 0 },
  { featureKey: 'bank_reconciliation', totalRows: 34, blockedRows: 5, runoffRootRows: 6 },
  { featureKey: 'company_settings', totalRows: 12, blockedRows: 4, runoffRootRows: 0 },
  { featureKey: 'crm', totalRows: 113, blockedRows: 11, runoffRootRows: 0 },
  { featureKey: 'dashboard_notifications', totalRows: 33, blockedRows: 1, runoffRootRows: 0 },
  { featureKey: 'double_entry_ledger', totalRows: 33, blockedRows: 4, runoffRootRows: 2 },
  { featureKey: 'employee_access', totalRows: 24, blockedRows: 2, runoffRootRows: 0 },
  { featureKey: 'expense_auto_post', totalRows: 3, blockedRows: 3, runoffRootRows: 0 },
  { featureKey: 'expenses', totalRows: 53, blockedRows: 6, runoffRootRows: 5 },
  { featureKey: 'inventory', totalRows: 25, blockedRows: 5, runoffRootRows: 0 },
  { featureKey: 'line_oa', totalRows: 11, blockedRows: 2, runoffRootRows: 0 },
  { featureKey: 'NONE', totalRows: 55, blockedRows: 22, runoffRootRows: 0 },
  { featureKey: 'PLATFORM', totalRows: 6, blockedRows: 1, runoffRootRows: 0 },
  { featureKey: 'PLATFORM_CONTROL_PLANE', totalRows: 1, blockedRows: 1, runoffRootRows: 0 },
  { featureKey: 'procurement', totalRows: 60, blockedRows: 7, runoffRootRows: 10 },
  { featureKey: 'product_catalog', totalRows: 12, blockedRows: 12, runoffRootRows: 0 },
  { featureKey: 'reimbursement', totalRows: 29, blockedRows: 4, runoffRootRows: 3 },
  { featureKey: 'reports', totalRows: 15, blockedRows: 0, runoffRootRows: 0 },
  { featureKey: 'sales_documents', totalRows: 31, blockedRows: 4, runoffRootRows: 3 },
  { featureKey: 'thai_tax', totalRows: 50, blockedRows: 10, runoffRootRows: 0 },
  { featureKey: 'UNGATED', totalRows: 1, blockedRows: 1, runoffRootRows: 0 },
  { featureKey: 'UNMAPPED', totalRows: 37, blockedRows: 37, runoffRootRows: 0 },
  { featureKey: 'UNRESOLVED', totalRows: 17, blockedRows: 17, runoffRootRows: 0 },
  { featureKey: 'workflow_automation', totalRows: 37, blockedRows: 0, runoffRootRows: 0 },
];

/**
 * The 7 survey buckets that are NOT a sellable feature: rows whose owning feature could not be
 * determined at F0 (`UNMAPPED`, `UNRESOLVED`, `NONE`, `AI_GATEWAY_PLANE`, `UNGATED`,
 * `PLATFORM_CONTROL_PLANE`) plus the platform bucket.
 *
 * ── COORDINATOR-RESOLVED DOCUMENTATION CONTRADICTION (2026-08-01) ──────────────────────────────
 * The approved matrix doc contradicts ITSELF about what these 103 BLOCKED rows block:
 *
 *   `feature-entitlement-runoff-matrix.md:10` (F0-exit ruling, owner-approved A0/A4):
 *     "The 100 BLOCKED rows in non-feature buckets (UNMAPPED/NONE/UNRESOLVED/AI_GATEWAY_PLANE)
 *      ... they block every feature's disable until resolved in F1 shadow."
 *
 *   the same file's §5 per-feature table (~line 1303) lists `ai_line_assistant`, `reports` and
 *   `workflow_automation` with "Disable preflight: clear".
 *
 * Both cannot be true. The coordinator adopted the SCOPED reading — a non-feature BLOCKED row
 * blocks its OWN surfaces, not every family's disable — because it is the only reading under which
 * the approved §5 table means anything, and because none of the 103 rows is a `reports` surface
 * (the sole FIN-owned one is `POST /v1/internal/ledger/expense-auto-post/drain`, owned by
 * `expense_auto_post`; the other 102 are PLATFORM auth/audit/admin and CRM AI-plane/webhook rows).
 *
 * ERRATUM, recorded without editing the approved artifact: the count is 103, not 100 — line 10's
 * parenthetical omits `PLATFORM`x1, `UNGATED`x1 and `PLATFORM_CONTROL_PLANE`x1.
 *
 * Moot since the 2026-08-04 freeze-in-place decision: no reading of these rows refuses a disable
 * any more. Kept because the bucket set is what tells the drift spec which keys are survey buckets
 * rather than sellable families.
 */
const NON_FEATURE_BUCKETS: ReadonlySet<string> = new Set([
  'UNMAPPED',
  'UNRESOLVED',
  'NONE',
  'AI_GATEWAY_PLANE',
  'UNGATED',
  'PLATFORM_CONTROL_PLANE',
  'PLATFORM',
]);

/** Whether a matrix key is one of the 7 non-feature survey buckets (see the block comment above). */
export function isNonFeatureBucket(featureKey: string): boolean {
  return NON_FEATURE_BUCKETS.has(featureKey);
}
