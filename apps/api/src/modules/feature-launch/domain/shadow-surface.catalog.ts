/**
 * SHADOW SURFACE catalog — which async surface's `would_block` evidence lands on which launch gate,
 * and by what means (piece 5, "shadow coverage expansion").
 *
 * WHY THIS FILE EXISTS. Runbook R1 step 2 lets a route open only when `counts.wouldBlock` is 0 with
 * `shadow.observed > 0`. That proves the observations that WERE taken carry no blocks. It cannot
 * prove that every surface of the family was measured at all — `shadowWindow.bySurface` is built
 * from whatever rows happen to exist, so a surface nobody instrumented is indistinguishable from a
 * surface that was quiet. Without an expected list, "full shadow" (the r2 ruling's precondition for
 * a per-family enforcement flip) is a judgement made by re-reading a 63-row inventory. With it, the
 * health view answers it (`shadow.surfacesMissing`, `shadow.coverageComplete`).
 *
 * Why a code copy instead of reading the JSON: the production image ships `apps/api/{prisma,src}`
 * only (apps/api/Dockerfile) — `docs/` is not in the image. `shadow-surface.catalog.spec.ts`
 * re-derives every `surfaceId` below from the approved matrix on every test run, so a matrix edit
 * that adds, drops or renames an ASYNC row fails the suite instead of shipping. Same mechanism as
 * `launch-matrix.catalog.ts` and `runoff-matrix.catalog.ts`.
 *
 * Server-only on purpose: gate keys, route keys and surface ids are internal control-plane
 * identifiers and must never reach a customer, partner or AI surface (spec:65, runbook §2.3), so
 * this does NOT live in `packages/contracts` (which the web bundle imports).
 *
 * ── THE GROUP-E TRAP, VERBATIM ────────────────────────────────────────────────────────────────
 *   INSTRUMENTING AFTER AN EXISTING FILTER PRODUCES EVIDENCE THAT READS PERFECT AND MEANS NOTHING.
 *
 * Two surfaces already refuse work themselves. `DrainExpenseAutoPostUseCase` selects companies with
 * `AUTO_POST_ENTITLEMENT_FILTER` BEFORE its loop (`expense-auto-post.use-case.ts:94-101`), and the
 * employee LINE webhook refuses at `lineAssistantDisabled` (`process-line-webhook.use-case.ts:596`).
 * A probe placed downstream of either can only ever record `available`, so `wouldBlock` is 0 by
 * construction and R1 is satisfied by a measurement that could not have failed. The webhook is
 * therefore instrumented UPSTREAM of its refusal (at `:594`, where `companyId` is first resolved).
 * `expense_auto_post` is DEFERRED (coordinator ruling OQ-5) precisely because doing it right needs
 * the UNFILTERED company set — whoever orders it in must probe the unfiltered candidates, never the
 * post-filter loop.
 */

/** How a matrix row's evidence is produced. */
export type ShadowCoverageKind =
  /** A `LaunchShadowProbe` sweep lives on this exact surface. */
  | 'INSTRUMENTED'
  /**
   * No code seam exists: the row is a BullMQ trigger or a permission list, not an execution site.
   * `apps/workers` is a pure HTTP dispatcher — every worker `fetch`es a worker-token internal
   * endpoint and contains no domain logic (`workflow-worker.ts`, `common/scan-worker.ts`,
   * `crm-sla-worker.ts`, `notification-jobs.ts`) — so instrumenting the API-side scanner IS
   * instrumenting the worker. Coordinator ruling OQ-1.
   */
  | 'PROXY'
  /**
   * An outbox PRODUCER row, discharged by `outbox.drain`: the drain records the PRODUCING feature
   * per event (`OUTBOX_EVENT_FEATURE_BY_PREFIX` in `workflow-outbox-drain.use-case.ts`), which is
   * exactly the ownership question the producer row asks. Coordinator ruling OQ-2.
   */
  | 'PRODUCER'
  /** Platform-level work with no tenant or feature dimension (`PLATFORM_EXEMPT` in the matrix). */
  | 'EXEMPT'
  /** Owning feature undecided in the approved matrix — records `null`, never a guess. */
  | 'BLOCKED_OWNERSHIP'
  /** Instrumentable and decided, but deliberately not done yet. Blocks its family's completeness. */
  | 'PENDING';

export type ShadowSurfaceRow = {
  /** Verbatim `surfaceId` from the approved RUNOFF_MATRIX ASYNC plane. The drift-spec join key. */
  surfaceId: string;
  /**
   * The gate this row's evidence lands on, or `null` when ownership is undecided. A `null` here is
   * the catalog's half of invariant 7: the probe records `featureKey: null`, which the sweep counts
   * under `UNMAPPED_GATE_KEY` and the health view reports in `shadowWindow.unmappedBySurface` —
   * inside the coverage denominator, attributed to no route.
   */
  gateKey: string | null;
  coverage: ShadowCoverageKind;
  /** The `surface` string whose buckets discharge this row. `null` iff nothing emits for it yet. */
  surface: string | null;
  note?: string;
};

/**
 * Every `surface` string any probe may pass to `startSweep`. Callers import from here rather than
 * writing a literal: a typo in a surface string is invisible (the bucket lands under a name nothing
 * expects, and the real surface reads as permanently missing), and this makes the caller and the
 * catalog the same source.
 *
 * The first two shipped in piece 3 as literals and keep their exact historical values — renaming
 * them would orphan every bucket row already written under the old name.
 */
export const SHADOW_SURFACES = {
  outboxDrain: 'outbox.drain',
  crmCampaignDelivery: 'crm.campaign.delivery',

  workflowScan: 'workflow.scan',
  workflowActionRetry: 'workflow.action.retry',
  workflowEventsIngest: 'workflow.events.ingest',
  workflowWebhookDispatch: 'workflow.webhook.dispatch',

  aiDraftDrain: 'ai.draft.drain',
  aiDraftGenerate: 'ai.draft.generate',
  aiLedgerDrain: 'ai.ledger.drain',
  lineWebhookEmployee: 'line.webhook.employee',

  crmSlaScan: 'crm.sla.scan',
  crmNewConversationScan: 'crm.newconv.scan',
  crmInboxRetry: 'crm.inbox.retry',
  expenseAutoPostDrain: 'expense.auto_post.drain',
  expenseCaptureReadDrain: 'expense.capture_read.drain',

  notificationsDeliverySweep: 'notifications.delivery.sweep',
  notificationsOndemandSnapshot: 'notifications.ondemand.snapshot',
  notificationsOndemandStockLow: 'notifications.ondemand.stock_low',
  notificationsOndemandDailySummary: 'notifications.ondemand.daily_owner_summary',
  notificationsOndemandDelivery: 'notifications.ondemand.delivery',
} as const;

/**
 * The three cross-tenant notification sweeps share ONE helper (`runSweep` in
 * `notification-sweeps.use-cases.ts`), which already carries the sweep's own name. Deriving the
 * surface from it means one diff instruments three matrix rows and the three rows keep distinct
 * surface names — a sweep that stops firing is still individually visible.
 */
export const notificationSweepSurface = (sweep: string): string => `notifications.sweep.${sweep}`;

/**
 * All 65 ASYNC rows of `docs/specs/feature-entitlement-runoff-matrix.json`, in matrix order.
 *
 * OQ-3 (shipped attribution stays, is never extended): four rows carry a gateKey the approved matrix
 * still records as UNRESOLVED, because piece 3 shipped that attribution in code and it is externally
 * reviewed. They are marked in `note`. NO NEW SURFACE MAY DO THIS — every ownership-undecided
 * surface added after piece 3 records `null`.
 */
export const SHADOW_SURFACE_CATALOG: readonly ShadowSurfaceRow[] = [
  // ── WORKER (11) — triggers, not execution sites (OQ-1) ──────────────────────────────────────
  { surfaceId: 'workers/main bootstrap + heartbeat', gateKey: null, coverage: 'EXEMPT', surface: null },
  { surfaceId: "startNotificationWorker (queue 'notifications')", gateKey: 'dashboard_notifications', coverage: 'PROXY', surface: SHADOW_SURFACES.notificationsDeliverySweep },
  { surfaceId: "startWorkflowWorker (queue 'workflow')", gateKey: 'workflow_automation', coverage: 'PROXY', surface: SHADOW_SURFACES.outboxDrain },
  { surfaceId: "startAiDraftWorker (queue 'ai-draft')", gateKey: 'ai_line_assistant', coverage: 'PROXY', surface: SHADOW_SURFACES.aiDraftDrain },
  { surfaceId: "startCrmSlaWorker (queue 'crm-inbox')", gateKey: 'crm', coverage: 'PROXY', surface: SHADOW_SURFACES.crmSlaScan },
  { surfaceId: "startCrmPdpaWorker (queue 'crm-pdpa')", gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'PDPA family: crm vs non-sellable legal obligation (matrix §9)' },
  { surfaceId: "startCrmTrustWorker (queue 'crm-trust')", gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'CRM-AI ownership: crm vs ai_line_assistant (matrix §9)' },
  { surfaceId: "startCrmCampaignWorker (queue 'crm-campaign-delivery')", gateKey: 'crm', coverage: 'PROXY', surface: SHADOW_SURFACES.crmCampaignDelivery, note: 'OQ-3 shipped attribution: matrix row is UNRESOLVED (crm vs line_oa); piece 3 recorded crm' },
  { surfaceId: "startLineAiLedgerWorker (queue 'line-ai-ledger')", gateKey: 'ai_line_assistant', coverage: 'PROXY', surface: SHADOW_SURFACES.aiLedgerDrain },
  { surfaceId: "startExpenseAutoPostWorker (queue 'expense-auto-post')", gateKey: 'expense_auto_post', coverage: 'PROXY', surface: SHADOW_SURFACES.expenseAutoPostDrain },
  { surfaceId: "startExpenseCaptureReadWorker (queue 'expense-capture-read')", gateKey: 'expenses', coverage: 'PROXY', surface: SHADOW_SURFACES.expenseCaptureReadDrain },
  { surfaceId: 'LineMessageBufferService (in-process per-chat worker)', gateKey: 'ai_line_assistant', coverage: 'PROXY', surface: SHADOW_SURFACES.lineWebhookEmployee, note: 'in-API timers, but the gate is downstream at the webhook turn this buffer releases' },

  // ── CRON (1) ────────────────────────────────────────────────────────────────────────────────
  { surfaceId: 'notifications daily_owner_summary cron', gateKey: 'dashboard_notifications', coverage: 'PROXY', surface: notificationSweepSurface('daily_owner_summary') },

  // ── SCANNER (26) ────────────────────────────────────────────────────────────────────────────
  { surfaceId: 'POST /v1/internal/notifications/delivery-sweep', gateKey: 'dashboard_notifications', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.notificationsDeliverySweep },
  { surfaceId: 'POST /v1/internal/notifications/snapshot-sweep', gateKey: 'dashboard_notifications', coverage: 'INSTRUMENTED', surface: notificationSweepSurface('snapshot') },
  { surfaceId: 'POST /v1/internal/notifications/stock-low-sweep', gateKey: 'dashboard_notifications', coverage: 'INSTRUMENTED', surface: notificationSweepSurface('stock_low') },
  { surfaceId: 'POST /v1/internal/notifications/daily-owner-summary-sweep', gateKey: 'dashboard_notifications', coverage: 'INSTRUMENTED', surface: notificationSweepSurface('daily_owner_summary') },
  { surfaceId: 'POST /v1/internal/companies/:companyId/dashboard/snapshots/generate', gateKey: 'dashboard_notifications', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.notificationsOndemandSnapshot },
  { surfaceId: 'POST /v1/internal/companies/:companyId/notifications/scan/stock-low', gateKey: 'dashboard_notifications', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.notificationsOndemandStockLow },
  { surfaceId: 'POST /v1/internal/companies/:companyId/notifications/daily-owner-summary', gateKey: 'dashboard_notifications', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.notificationsOndemandDailySummary },
  { surfaceId: 'POST /v1/internal/companies/:companyId/notification-deliveries/:deliveryId/process', gateKey: 'dashboard_notifications', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.notificationsOndemandDelivery },
  { surfaceId: 'POST /v1/internal/crm/sla-breach-scan', gateKey: 'crm', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.crmSlaScan },
  { surfaceId: 'POST /v1/internal/crm/new-conversation-scan', gateKey: 'crm', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.crmNewConversationScan },
  { surfaceId: 'POST /v1/internal/crm/inbox-retry-scan', gateKey: 'crm', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.crmInboxRetry },
  { surfaceId: 'POST /v1/internal/crm/autonomy-retry-scan', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'CRM-AI ownership; also: drain vs terminalize for queued jobs (matrix §9)' },
  { surfaceId: 'POST /v1/internal/crm/booking-reminder-scan', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'booking family: crm vs crm.bookings vs a new scheduling key (matrix §9)' },
  { surfaceId: 'POST /v1/internal/crm/booking-proposal-sweep', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'booking family (matrix §9)' },
  { surfaceId: 'POST /v1/internal/crm/pdpa-purge', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'PDPA family (matrix §9)' },
  { surfaceId: 'POST /v1/internal/crm/pdpa-erasure-process', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'PDPA family (matrix §9)' },
  { surfaceId: 'POST /v1/internal/crm/pdpa-post-restore-re-erasure', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'PDPA family; operator-only, no worker caller (matrix §9)' },
  { surfaceId: 'POST /v1/internal/crm/campaign-delivery-scan', gateKey: 'crm', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.crmCampaignDelivery, note: 'OQ-3 shipped attribution: matrix row is UNRESOLVED (crm vs line_oa); piece 3 recorded crm' },
  { surfaceId: 'POST /v1/internal/crm/trust-score-scan', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'CRM-AI ownership (matrix §9)' },
  { surfaceId: 'POST /v1/internal/workflow/scan (THRESHOLD_SCAN | SLA_SCAN | SCHEDULE)', gateKey: 'workflow_automation', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.workflowScan },
  { surfaceId: 'POST /v1/internal/workflow/action-runs/retry', gateKey: 'workflow_automation', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.workflowActionRetry },
  { surfaceId: 'POST /v1/internal/workflow/events/ingest', gateKey: 'workflow_automation', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.workflowEventsIngest },
  { surfaceId: 'POST /v1/internal/ai/draft-requests/drain', gateKey: 'ai_line_assistant', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.aiDraftDrain },
  { surfaceId: 'POST /v1/internal/ai/draft-requests/generate', gateKey: 'ai_line_assistant', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.aiDraftGenerate },
  { surfaceId: 'POST /v1/internal/ai/line-ledger/drain', gateKey: 'ai_line_assistant', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.aiLedgerDrain },
  { surfaceId: 'POST /v1/internal/ledger/expense-auto-post/drain', gateKey: 'expense_auto_post', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.expenseAutoPostDrain, note: 'probes every ACTIVE company before the entitlement filter (Group-E)' },
  { surfaceId: 'POST /v1/internal/expenses/capture-read/drain', gateKey: 'expenses', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.expenseCaptureReadDrain, note: 'probes every company whose read job was claimed, before the job runs (contract appendix §4.5)' },

  // ── OUTBOX (12) ─────────────────────────────────────────────────────────────────────────────
  { surfaceId: 'DrainWorkflowOutboxUseCase', gateKey: 'workflow_automation', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.outboxDrain },
  { surfaceId: 'OutboxAppendService.append (shared producer helper)', gateKey: null, coverage: 'EXEMPT', surface: null },
  { surfaceId: 'OUTBOX_PRODUCER: ledger', gateKey: 'double_entry_ledger', coverage: 'PRODUCER', surface: SHADOW_SURFACES.outboxDrain },
  { surfaceId: 'OUTBOX_PRODUCER: expenses', gateKey: 'expenses', coverage: 'PRODUCER', surface: SHADOW_SURFACES.outboxDrain },
  { surfaceId: 'OUTBOX_PRODUCER: crm (leads/opportunities/follow-ups/quotation link)', gateKey: 'crm', coverage: 'PRODUCER', surface: SHADOW_SURFACES.outboxDrain },
  { surfaceId: 'OUTBOX_PRODUCER: crm-inbox (conversations/channels/policy)', gateKey: 'crm', coverage: 'PRODUCER', surface: SHADOW_SURFACES.outboxDrain, note: 'OQ-3 shipped attribution: matrix row is UNRESOLVED (crm vs line_oa); the drain maps the crm. prefix to crm' },
  { surfaceId: 'OUTBOX_PRODUCER: accounting-documents', gateKey: 'sales_documents', coverage: 'PRODUCER', surface: SHADOW_SURFACES.outboxDrain },
  { surfaceId: 'OUTBOX_PRODUCER: tax', gateKey: 'thai_tax', coverage: 'PRODUCER', surface: SHADOW_SURFACES.outboxDrain },
  { surfaceId: 'OUTBOX_PRODUCER: procurement', gateKey: 'procurement', coverage: 'PRODUCER', surface: SHADOW_SURFACES.outboxDrain },
  { surfaceId: 'OUTBOX_PRODUCER: inventory', gateKey: 'inventory', coverage: 'PRODUCER', surface: SHADOW_SURFACES.outboxDrain, note: 'OQ-3 shipped attribution: matrix row is UNRESOLVED (product_catalog vs inventory); the drain maps the inventory. prefix to inventory' },
  { surfaceId: 'OUTBOX_PRODUCER: reimbursements', gateKey: 'reimbursement', coverage: 'PRODUCER', surface: SHADOW_SURFACES.outboxDrain },
  { surfaceId: 'OUTBOX_PRODUCER: banking', gateKey: 'bank_reconciliation', coverage: 'PRODUCER', surface: SHADOW_SURFACES.outboxDrain },

  // ── WEBHOOK (7) ─────────────────────────────────────────────────────────────────────────────
  { surfaceId: 'POST /v1/line/webhook and POST /v1/webhooks/line (shared WatchDog OA)', gateKey: 'ai_line_assistant', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.lineWebhookEmployee },
  { surfaceId: 'lineAssistantDisabled gate (process-line-webhook.use-case.ts)', gateKey: 'ai_line_assistant', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.lineWebhookEmployee, note: 'measured UPSTREAM of this refusal — see the Group-E trap at the head of this file' },
  { surfaceId: 'POST /v1/crm/line/webhook/:webhookKey (company OA, end customers)', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'highest-priority undecided row: fans into crm + line_oa + ai_line_assistant at once (matrix §9)' },
  { surfaceId: 'POST /v1/internal/ai/tools/invoke (AI Gateway → API tool bridge)', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'needs the per-tool feature map for ~50 tools across ~10 features first (matrix §9)' },
  { surfaceId: '@Public customer PDPA endpoints (consent-withdraw, data-export, erasure-request, erasure-status)', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'PDPA family (matrix §9)' },
  { surfaceId: '@Public customer LINE registration (POST /v1/line/customer-register, GET .../customer-register-page)', gateKey: null, coverage: 'BLOCKED_OWNERSHIP', surface: null, note: 'channel vs domain: crm vs line_oa (matrix §9)' },
  { surfaceId: 'OUTBOUND webhook dispatch (workflow CALL_WEBHOOK action)', gateKey: 'workflow_automation', coverage: 'INSTRUMENTED', surface: SHADOW_SURFACES.workflowWebhookDispatch },

  // ── SYSTEM_CONTEXT (6) — permission lists, not execution sites (OQ-1) ───────────────────────
  { surfaceId: 'systemWorkerContext (shared factory)', gateKey: null, coverage: 'EXEMPT', surface: null },
  { surfaceId: 'WORKER_NOTIFICATION_PERMISSIONS', gateKey: 'dashboard_notifications', coverage: 'PROXY', surface: notificationSweepSurface('snapshot') },
  { surfaceId: 'EXPENSE_AUTO_POST_WORKER_PERMISSIONS', gateKey: 'expense_auto_post', coverage: 'PROXY', surface: SHADOW_SURFACES.expenseAutoPostDrain },
  { surfaceId: 'workflow scan systemCtx', gateKey: 'workflow_automation', coverage: 'PROXY', surface: SHADOW_SURFACES.workflowScan },
  { surfaceId: 'assertWorkerToken (shared internal credential)', gateKey: null, coverage: 'EXEMPT', surface: null, note: 'one shared token; no company and no feature dimension exists to measure' },
  { surfaceId: "SYSTEM_ACTOR / actorType 'SYSTEM' (CRM sweeps)", gateKey: 'crm', coverage: 'PROXY', surface: SHADOW_SURFACES.crmInboxRetry },
];

/**
 * Rows whose owning feature the approved matrix has not decided. They are NOT charged against any
 * family's completeness, matching the coordinator-adopted SCOPED reading already in force for the
 * runoff preflight (`runoff-matrix.catalog.ts`): an undecided row blocks its OWN surface, not every
 * family's. They are exported so an operator can see them rather than infer their absence — the same
 * rows the runoff matrix counts in its `UNRESOLVED` bucket.
 */
export const UNOWNED_SHADOW_SURFACES: readonly ShadowSurfaceRow[] =
  SHADOW_SURFACE_CATALOG.filter((row) => row.coverage === 'BLOCKED_OWNERSHIP');

/**
 * Async surfaces contribute to the `DEFAULT` route only. Every probe call site passes the default
 * `routeKey`, and no async surface names a staged operational route — `cap.wht50bis/*` and the
 * `cap.thai_tax.*` rows are synchronous issuance paths with no scanner, worker or webhook behind
 * them, so their expected set is empty and their R1 evidence comes from elsewhere.
 */
const DEFAULT_ROUTE_KEY = 'DEFAULT';

const EXPECTED_BY_GATE = new Map<string, readonly string[]>();
const COMPLETE_BY_GATE = new Map<string, boolean>();
for (const row of SHADOW_SURFACE_CATALOG) {
  if (!row.gateKey) continue;
  if (row.surface) {
    const seen = EXPECTED_BY_GATE.get(row.gateKey) ?? [];
    if (!seen.includes(row.surface)) EXPECTED_BY_GATE.set(row.gateKey, [...seen, row.surface]);
    else EXPECTED_BY_GATE.set(row.gateKey, seen);
  }
  // One PENDING row is enough to make a family's shadow incomplete. `&&` rather than assignment so
  // a later covered row can never overwrite an earlier incomplete verdict.
  COMPLETE_BY_GATE.set(row.gateKey, (COMPLETE_BY_GATE.get(row.gateKey) ?? true) && row.coverage !== 'PENDING');
}

/** Surfaces that MUST report for this route before its shadow evidence is full. */
export function expectedShadowSurfaces(gateKey: string, routeKey: string): readonly string[] {
  if (routeKey !== DEFAULT_ROUTE_KEY) return [];
  return EXPECTED_BY_GATE.get(gateKey) ?? [];
}

/** True when this exact route owns async catalog rows, including a still-PENDING row. */
export function hasAsyncShadowCatalog(gateKey: string, routeKey: string): boolean {
  return routeKey === DEFAULT_ROUTE_KEY && COMPLETE_BY_GATE.has(gateKey);
}

/**
 * True when every async surface owned by this family emits evidence. FALSE is the honest answer for
 * a gate with no async surfaces at all (`reports`, `product_catalog`, `line_oa`) — they have nothing
 * to complete, so the question does not apply and `expectedShadowSurfaces` is empty; callers read
 * the two together.
 */
export function shadowCoverageComplete(gateKey: string): boolean {
  return COMPLETE_BY_GATE.get(gateKey) ?? false;
}
