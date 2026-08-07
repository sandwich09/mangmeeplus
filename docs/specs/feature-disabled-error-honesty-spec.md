# Feature-Disabled Error Honesty Spec

Status: Implemented and exact-SHA deployed 2026-08-03 with targeted live-UAT
verification. The Reports cycle and initial Bedrock advisory are pre-deploy journey
evidence. AI-only application commit `544bdd25be6ba44feb26eb7008104fffe6f7bece`
then passed exact CI `30804548851`, exact UAT deploy `30805641789`, post-deploy AI
API/browser checks and final read-only post-condition `30808101502`. Shared translators
and representative screen paths are behavior-tested; all changed screens passed
typecheck and the full regression suite, but were not each browser-tested live. This
follows the UAT "สั่งพิมพ์เอกสารแล้วเปิดไฟล์ไม่ได้" diagnosis in
`docs/agent-memory/uat-print-file-open-diagnosis.md`.
Owner: platform/web
Related: `docs/specs/feature-entitlement-decoupling-spec.md` (§65 feature_not_enabled vs §335 feature_temporarily_unavailable), `docs/agent-memory/feature-verify-bill-reimburse-employee-2026-07-28.md` (shared translator seam decision)

## 1. Problem

Entitlement enforcement is working as designed: when a company's feature family is
disabled (`CompanyFeatureEntitlement.enabled=false`), the permission resolver strips that
family's permissions and the deny-by-default guard answers
`403 {"code":"feature_not_enabled","featureKey":...}` with **no `message` field**.

The client contract for that response is broken in three places, so a correct denial
presents as a broken app ("เปิดไฟล์ไม่ได้", "API error 403") instead of the truthful
"ยังไม่ได้เปิดฟีเจอร์นี้":

1. **Raw `err()` screens.** 12 feature screens render `e.message` directly. For a
   message-less coded 403, `authedApiFetch` synthesizes `API error 403`, which is what the
   user sees. Affected: `AccountingPages` (sales_documents), `TaxWorkspacePage` (thai_tax),
   `AccountsPayablePages`, `LedgerReportsPage`, `WorkflowPages`, `BankingPages`,
   `MatchingPanel`, `StatementImportPanel`, `ProcurementPages`, `CrmPages`,
   `Customer360Page`, `AiSuggestionsPages`. The shared translator
   `apps/web/src/common/api/api-error-message.ts` already maps `feature_not_enabled` and is
   already the deliberate single seam (expenses/ExpensesUi.err, reports err) — these
   screens just never adopted it.
2. **Per-domain translators that swallow the code.**
   - `transaction-tax.model.ts:transactionTaxErrorMessage` maps *every* 403 to
     "คุณไม่มีสิทธิ์ดำเนินการนี้" — a lie when the truth is "feature not enabled"
     (permission vs entitlement are distinct states per the decoupling spec).
   - `reimbursements.logic.ts:errorMessage` translates only the message *string*; the
     object-level `code` (the only signal a guard 403 carries) is never consulted.
3. **Retained-reports copy that instructs the impossible.** With `reports` disabled, the
   retained history stays reachable by design, but the `legacy_export_not_materialized`
   list projection says "กรุณาสร้างไฟล์ CSV ใหม่" — an action a disabled-family company
   cannot perform (reachable OFF shape: snapshot authorized, bytes never materialized).
   The sibling `report_export_expired` branch already varies its copy on
   `reportsEnabled`; this one predates that pattern. Implementation finding: the download
   410 sibling is provably unreachable while OFF (`ensureOriginalSourceAuthority` throws
   first), so it keeps its single message with a comment instead of a dead branch.

The live UAT journey also exposed a related AI review-safety gap: a Bedrock suggestion
correctly downgraded to `NEEDS_DATA` for missing citations, but the UI showed raw English
reasons, `CREATE_*`/status codes and JSON while still offering validate/create actions.
The direct API likewise checked only `status=NEW`, so a needs-data suggestion could call
a source adapter; `NO_SOURCE_DRAFT_AVAILABLE` could be recorded as a self-owned “source
draft created” even though no source draft exists.

Additionally, at discovery time UAT acceptance of document journeys stalled because all
7 UAT companies used the deny-by-default starter package (no `sales_documents`/
`thai_tax`/`reports`). That was provisioning, not code — covered by the runbook, not by
this spec. The later controlled Reports journey enabled one acceptance tenant and restored
it ON at handoff; this does not change the discovery diagnosis.

## 2. Required behavior

- **R1 — single seam.** Every feature screen surfaces API business errors through
  `apiErrorMessage` (directly, or via a domain translator that consults the shared code
  map first). No screen renders `Error.message` raw.
- **R2 — no synthetic codes to users.** A response carrying a stable `code` never surfaces
  as `API error <status>` or as a blanket permission sentence that contradicts the code.
  `feature_not_enabled` → "ยังไม่ได้เปิดฟีเจอร์นี้"; `feature_temporarily_unavailable`
  keeps its distinct copy (never merged — spec §65/§335 distinction).
- **R3 — actionable copy only.** Server messages about retained report artifacts must not
  instruct creating a new export when `reportsEnabled === false`; they follow the same
  branch shape as `report_export_expired` ("ติดต่อผู้ดูแลให้เปิดฟีเจอร์รายงาน...").
- **R4 — behavior otherwise unchanged.** Unknown messages still pass through untouched
  (English server sentences remain more useful than a generic fallback); domain-specific
  code labels (reimbursements `ERROR_CODE_LABELS`, tax 409/422 branches) keep priority
  over the shared map for their own codes; non-display logic that inspects `e.message`
  (e.g. `isStaleApprovalError`) is untouched.
- **R5 — needs-data is non-draftable.** A suggestion with any
  `needsDataReasons` cannot validate a candidate or create a source draft through UI or
  direct API, and cannot be accepted/escalated through the review API. Only regeneration
  or dismissal (including `MARK_NOT_USEFUL`) is allowed. `NO_SOURCE_DRAFT_AVAILABLE` is
  display-only and never becomes `SOURCE_DRAFT_CREATED`; normal evidence-complete
  CRM/source-draft behavior is unchanged.
- **R6 — human-first AI detail.** Primary Thai UI uses friendly risk/status/action/review
  labels, translates known needs-data reasons, renders checklist title/items instead of
  raw JSON and hides operator detail under an explicit support disclosure. A technical
  reason/code is never the only customer explanation.

## 3. Non-goals

- No change to entitlement enforcement, the resolver, menus/nav, or entitlement data.
- No per-page "feature disabled" panels beyond what already exists (reports historyOnly).
  Menus of disabled families are already hidden; deep links now get an honest message.
- No mutation of UAT entitlements from this work — enabling families for test companies
  is an owner action per the provisioning runbook
  (`docs/runbooks/uat-feature-package-provisioning.md`).

## 4. Acceptance criteria

- A company with `thai_tax`/`sales_documents`/`reports` disabled sees
  "ยังไม่ได้เปิดฟีเจอร์นี้" (not "API error 403", not "คุณไม่มีสิทธิ์ดำเนินการนี้") on
  TaxWorkspacePage, AccountingHubPage, and any swept screen when a gated call is denied.
- Reimbursement screens translate an object-coded 403 the same way while keeping all
  existing `ERROR_CODE_LABELS` behavior for message-coded errors.
- `ListReportExports` emits the "contact admin" variant of the
  `legacy_export_not_materialized` copy when reports is disabled. The download sibling
  remains unchanged because its earlier authority check makes that 410 branch
  unreachable while OFF; existing specs assert both reachable shapes.
- Workspace typecheck and the web/api test suites pass; each piece carries one focused
  spec that fails if its logic regresses.
- A Bedrock-backed `needsData` fixture shows a readable Thai explanation and checklist,
  with no validate/create-draft buttons. API calls to validate/create return stable
  `ai_suggestion_needs_data`; a no-source placeholder returns
  `ai_source_draft_unavailable`; neither calls the source adapter.
