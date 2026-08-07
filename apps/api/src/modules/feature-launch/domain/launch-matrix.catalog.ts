/**
 * FEATURE_LAUNCH_MATRIX catalog — the seedable projection of
 * `docs/specs/feature-entitlement-launch-matrix.json` (spec:66, runbook §2.1).
 *
 * Why a code copy instead of reading the JSON: the production image ships
 * `apps/api/{prisma,src}` only (apps/api/Dockerfile) — `docs/` is not in the image, so a
 * deploy-time seeder cannot read the doc. `launch-matrix.catalog.spec.ts` re-derives this
 * table from the doc on every test run, so drift fails the suite instead of shipping.
 *
 * Server-only on purpose: gate/route keys are internal control-plane identifiers and must never
 * reach a customer, partner or AI surface (spec:65, runbook §2.3), so this does NOT live in
 * `packages/contracts` (which the web bundle imports).
 */
export type LaunchRouteClass = 'ORDINARY' | 'SPECIALIST_LEGAL';
export type LaunchGateState = 'OPEN' | 'CLOSED';
/**
 * Durable per-row prohibition (owner review P0-3). `FORBIDDEN_V5_1` means spec:272 allows NO OPEN
 * row for this gate in v5.1 at all — not "needs better evidence". The command rejects OPEN for such
 * a row before any shape, approval or evidence is even considered.
 */
export type LaunchOpenPolicy = 'ALLOWED' | 'FORBIDDEN_V5_1';

export type LaunchMatrixRow = {
  gateKey: string;
  routeKey: string;
  routeClass: LaunchRouteClass;
  /** Baseline state at bootstrap. Seeded OPEN rows are grandfathered live features (spec:236). */
  seedState: LaunchGateState;
  /** A BLOCKED matrix row must never be OPEN (plan §3 F0). */
  matrixRowStatus: 'RESOLVED' | 'BLOCKED';
  /** Absent = `ALLOWED`. Only the rows spec:272 forbids carry an explicit policy. */
  openPolicy?: LaunchOpenPolicy;
  specialistApprovalRequired: boolean;
  /**
   * `false` for namespace rows whose `routeKey` is a `<...>` template: the concrete route
   * catalog is not enumerable yet, so no gate row can be materialized for them.
   */
  materializable: boolean;
  notMaterializableReason?: string;
};

/** The build/release id recorded on every bootstrap OPEN transition. */
export const LAUNCH_GATE_SEED_BUILD_RELEASE_ID = 'F1-SEED';

export const FEATURE_LAUNCH_MATRIX: readonly LaunchMatrixRow[] = [
  {
    gateKey: 'inventory',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'product_catalog',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'sales_documents',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'expenses',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'reimbursement',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'double_entry_ledger',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'expense_auto_post',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'thai_tax',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'procurement',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'bank_reconciliation',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'crm',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'dashboard_notifications',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'ai_line_assistant',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'line_oa',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'reports',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'workflow_automation',
    routeKey: 'DEFAULT',
    routeClass: 'ORDINARY',
    seedState: 'OPEN',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: false,
    materializable: true,
  },
  {
    gateKey: 'cap.wht50bis',
    routeKey: 'SYSTEM_INITIAL_ISSUE',
    routeClass: 'SPECIALIST_LEGAL',
    seedState: 'CLOSED',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: true,
    materializable: true,
  },
  {
    gateKey: 'cap.wht50bis',
    routeKey: 'SYSTEM_CONTENT_CORRECTION',
    routeClass: 'SPECIALIST_LEGAL',
    seedState: 'CLOSED',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: true,
    materializable: true,
  },
  {
    gateKey: 'cap.wht50bis',
    routeKey: 'SYSTEM_REPLACEMENT_COPY',
    routeClass: 'SPECIALIST_LEGAL',
    seedState: 'CLOSED',
    matrixRowStatus: 'RESOLVED',
    specialistApprovalRequired: true,
    materializable: true,
  },
  {
    gateKey: 'cap.thai_tax.external_filing_correction',
    routeKey: '<formType:correctionRoute:channelVersion> (namespace — catalog not enumerable)',
    routeClass: 'SPECIALIST_LEGAL',
    seedState: 'CLOSED',
    matrixRowStatus: 'BLOCKED',
    specialistApprovalRequired: true,
    materializable: false,
    notMaterializableReason: 'namespace row: routeKey is a template placeholder, so the concrete route catalog is not enumerable (matrix status BLOCKED)',
  },
  {
    gateKey: 'cap.thai_tax.vat_scope_credit_transfer',
    routeKey: '<transitionKind> (namespace — catalog not enumerable)',
    routeClass: 'SPECIALIST_LEGAL',
    seedState: 'CLOSED',
    matrixRowStatus: 'BLOCKED',
    specialistApprovalRequired: true,
    materializable: false,
    notMaterializableReason: 'namespace row: routeKey is a template placeholder, so the concrete route catalog is not enumerable (matrix status BLOCKED)',
  },
  {
    gateKey: 'cap.thai_tax.vat_credit_in_product_offset',
    routeKey: 'DEFAULT',
    routeClass: 'SPECIALIST_LEGAL',
    seedState: 'CLOSED',
    matrixRowStatus: 'RESOLVED',
    // spec:272 — "no OPEN row in v5.1; a future v6 begins PP30-only". The row is materialized
    // CLOSED so the health view can show it, and no command of any shape may open it.
    openPolicy: 'FORBIDDEN_V5_1',
    specialistApprovalRequired: true,
    materializable: true,
  },
];

/** Rows a bootstrap may materialize as `FeatureLaunchGate` rows. */
export const MATERIALIZABLE_LAUNCH_MATRIX_ROWS: readonly LaunchMatrixRow[] =
  FEATURE_LAUNCH_MATRIX.filter((row) => row.materializable);

/** Namespace placeholders, kept visible so a skip is a recorded reason and never a silent drop. */
export const NON_MATERIALIZABLE_LAUNCH_MATRIX_ROWS: readonly LaunchMatrixRow[] =
  FEATURE_LAUNCH_MATRIX.filter((row) => !row.materializable);

export function findLaunchMatrixRow(gateKey: string, routeKey: string): LaunchMatrixRow | undefined {
  return FEATURE_LAUNCH_MATRIX.find((row) => row.gateKey === gateKey && row.routeKey === routeKey);
}
